import { Request, Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Rateio da taxa de serviço. O gestor define como a taxa (e, se quiser, as gorjetas) de um período
// é dividida entre garçons, cozinha, limpeza, recepção e a casa. O sistema calcula quanto cabe a
// cada pessoa; ao fechar o período, o rateio fica guardado como repasse.

const router = Router();

type PerfilEquipe = 'GARCOM' | 'COZINHA' | 'LIMPEZA' | 'RECEPCAO';
const GRUPOS: PerfilEquipe[] = ['GARCOM', 'COZINHA', 'LIMPEZA', 'RECEPCAO'];
const CHAVES_PERCENTUAIS = ['GARCOM', 'COZINHA', 'LIMPEZA', 'RECEPCAO', 'CASA'] as const;

interface RegraDTO {
  percentuais: { GARCOM: number; COZINHA: number; LIMPEZA: number; RECEPCAO: number; CASA: number };
  divisaoInterna: 'IGUAL' | 'HORAS';
  gorjetasParaQuemRecebeu: boolean;
}

interface PessoaRateio {
  usuarioId: number;
  nome: string;
  minutos: number;
  valorTaxa: number;
  valorGorjeta: number;
  total: number;
}

interface GrupoRateio {
  perfil: PerfilEquipe;
  percentual: number;
  valor: number;
  pessoas: PessoaRateio[];
}

interface RateioDTO {
  de: string;
  ate: string;
  totalTaxa: number;
  totalGorjetas: number;
  base: number;
  regra: RegraDTO;
  grupos: GrupoRateio[];
  outros: { usuarioId: number; nome: string; valorGorjeta: number }[];
  casa: number;
  totalDistribuido: number;
}

interface Periodo {
  de: string;
  ate: string;
  inicio: Date;
  fim: Date;
}

// ---------- Datas ----------

function dois(n: number): string {
  return String(n).padStart(2, '0');
}

// Dia no formato AAAA-MM-DD, pelo fuso do servidor.
function formatarDia(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

// Lê AAAA-MM-DD e confere se é uma data de calendário de verdade (31/02 não passa).
function lerDia(texto: string): { ano: number; mes: number; dia: number } | null {
  const casamento = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!casamento) return null;
  const ano = Number(casamento[1]);
  const mes = Number(casamento[2]);
  const dia = Number(casamento[3]);
  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return { ano, mes, dia };
}

function periodoDe(de: string, ate: string): Periodo {
  const a = lerDia(de);
  const b = lerDia(ate);
  if (!a || !b) throw new HttpError(400, 'Data inválida. Use o formato AAAA-MM-DD');
  const inicio = new Date(a.ano, a.mes - 1, a.dia, 0, 0, 0, 0);
  const fim = new Date(b.ano, b.mes - 1, b.dia, 23, 59, 59, 999);
  if (fim < inicio) throw new HttpError(400, 'A data final é anterior à inicial');
  const dias = Math.round((Date.UTC(b.ano, b.mes - 1, b.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / 86400000) + 1;
  if (dias > 366) throw new HttpError(400, 'O período pode ter no máximo 366 dias');
  return { de, ate, inicio, fim };
}

// Período da query (de e ate). Sem eles, vai do dia 1 do mês atual até hoje.
function periodoDaQuery(req: Request): Periodo {
  const agora = new Date();
  const primeiroDoMes = `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-01`;
  const de = typeof req.query.de === 'string' && req.query.de !== '' ? req.query.de : primeiroDoMes;
  const ate = typeof req.query.ate === 'string' && req.query.ate !== '' ? req.query.ate : formatarDia(agora);
  return periodoDe(de, ate);
}

// ---------- Dinheiro e divisão ----------

function paraCentavos(valor: number): number {
  return Math.round(valor * 100);
}

function emReais(centavos: number): number {
  return centavos / 100;
}

// Reparte um total (em centavos) pelos pesos. Os centavos que sobram vão um a um para quem tem
// o maior peso, para a soma bater exatamente. Pesos todos zero: partes iguais.
function dividir(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, p) => s + p, 0);
  const usados = soma > 0 ? pesos : pesos.map(() => 1);
  const somaUsada = soma > 0 ? soma : usados.length;
  const partes = usados.map((p) => Math.floor((total * p) / somaUsada));
  const resto = total - partes.reduce((s, p) => s + p, 0);
  const ordem = usados.map((_, i) => i).sort((a, b) => usados[b] - usados[a] || a - b);
  for (let k = 0; k < resto; k++) {
    partes[ordem[k]] += 1;
  }
  return partes;
}

// ---------- Regra ----------

function regraDoBanco(linha: {
  percGarcom: Prisma.Decimal | string | number;
  percCozinha: Prisma.Decimal | string | number;
  percLimpeza: Prisma.Decimal | string | number;
  percRecepcao: Prisma.Decimal | string | number;
  percCasa: Prisma.Decimal | string | number;
  divisaoInterna: string;
  gorjetasParaQuemRecebeu: boolean;
}): RegraDTO {
  return {
    percentuais: {
      GARCOM: Number(linha.percGarcom),
      COZINHA: Number(linha.percCozinha),
      LIMPEZA: Number(linha.percLimpeza),
      RECEPCAO: Number(linha.percRecepcao),
      CASA: Number(linha.percCasa),
    },
    divisaoInterna: linha.divisaoInterna === 'HORAS' ? 'HORAS' : 'IGUAL',
    gorjetasParaQuemRecebeu: linha.gorjetasParaQuemRecebeu,
  };
}

async function lerRegra(): Promise<RegraDTO> {
  // A regra é uma linha só (id 1). Se ainda não existe, cria com os padrões do schema.
  const linha = await prisma.regraRateio.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return regraDoBanco(linha);
}

const percentual = z
  .number()
  .min(0, 'Percentual não pode ser negativo')
  .max(100, 'Percentual não pode passar de 100')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo 2 casas decimais no percentual');

const regraSchema = z.object({
  percentuais: z.object({
    GARCOM: percentual,
    COZINHA: percentual,
    LIMPEZA: percentual,
    RECEPCAO: percentual,
    CASA: percentual,
  }),
  divisaoInterna: z.enum(['IGUAL', 'HORAS'], { error: 'Divisão inválida' }),
  gorjetasParaQuemRecebeu: z.boolean(),
});

// ---------- Cálculo ----------

async function calcular(periodo: Periodo, regra: RegraDTO): Promise<RateioDTO> {
  const pagamentos = await prisma.pagamento.findMany({
    where: { status: 'APROVADO', concluidoEm: { gte: periodo.inicio, lte: periodo.fim } },
    select: { garcomId: true, valorServico: true, gorjeta: true },
  });

  let totalTaxaC = 0;
  let totalGorjetasC = 0;
  const gorjetaPorUsuario = new Map<number, number>();
  for (const p of pagamentos) {
    const taxa = paraCentavos(Number(p.valorServico));
    const gorjeta = paraCentavos(Number(p.gorjeta));
    totalTaxaC += taxa;
    totalGorjetasC += gorjeta;
    gorjetaPorUsuario.set(p.garcomId, (gorjetaPorUsuario.get(p.garcomId) ?? 0) + gorjeta);
  }

  // Base do rateio: com gorjeta direta, só a taxa; sem ela, a taxa mais as gorjetas.
  const baseC = regra.gorjetasParaQuemRecebeu ? totalTaxaC : totalTaxaC + totalGorjetasC;

  // Divide a base pelos cinco percentuais (em centésimos de %, somam 10000).
  const pesosC = [...CHAVES_PERCENTUAIS].map((k) => paraCentavos(regra.percentuais[k]));
  const partesC = dividir(baseC, pesosC);
  let casaC = partesC[4];

  const membros = await prisma.usuario.findMany({
    where: { ativo: true, perfil: { in: GRUPOS } },
    select: { id: true, nome: true, perfil: true },
    orderBy: { nome: 'asc' },
  });
  const idsDoRateio = new Set(membros.map((m) => m.id));

  const pontos = await prisma.registroPonto.findMany({
    where: { entrada: { gte: periodo.inicio, lte: periodo.fim }, saida: { not: null } },
    select: { usuarioId: true, entrada: true, saida: true },
  });
  const msPorUsuario = new Map<number, number>();
  for (const r of pontos) {
    if (!r.saida || !idsDoRateio.has(r.usuarioId)) continue;
    const ms = r.saida.getTime() - r.entrada.getTime();
    msPorUsuario.set(r.usuarioId, (msPorUsuario.get(r.usuarioId) ?? 0) + Math.max(0, ms));
  }
  const minutosDe = (id: number) => Math.round((msPorUsuario.get(id) ?? 0) / 60000);

  let distribuidoC = 0;
  const grupos: GrupoRateio[] = GRUPOS.map((perfil, i) => {
    const valorC = partesC[i];
    const ativos = membros.filter((m) => m.perfil === perfil);
    if (ativos.length === 0) {
      // Grupo sem ninguém ativo: o valor dele fica com a casa.
      casaC += valorC;
      return { perfil, percentual: regra.percentuais[perfil], valor: emReais(valorC), pessoas: [] };
    }
    const pesos = regra.divisaoInterna === 'HORAS' ? ativos.map((m) => minutosDe(m.id)) : ativos.map(() => 1);
    const partesPessoas = dividir(valorC, pesos);
    const pessoas: PessoaRateio[] = ativos.map((m, j) => {
      const taxaC = partesPessoas[j];
      const gorjetaC = regra.gorjetasParaQuemRecebeu ? gorjetaPorUsuario.get(m.id) ?? 0 : 0;
      distribuidoC += taxaC + gorjetaC;
      return {
        usuarioId: m.id,
        nome: m.nome,
        minutos: minutosDe(m.id),
        valorTaxa: emReais(taxaC),
        valorGorjeta: emReais(gorjetaC),
        total: emReais(taxaC + gorjetaC),
      };
    });
    return { perfil, percentual: regra.percentuais[perfil], valor: emReais(valorC), pessoas };
  });

  // Gorjetas diretas de quem não está em nenhum grupo (ex.: o gestor recebeu a conta).
  const outros: { usuarioId: number; nome: string; valorGorjeta: number }[] = [];
  if (regra.gorjetasParaQuemRecebeu) {
    const idsForaDoRateio = [...gorjetaPorUsuario.keys()].filter((id) => !idsDoRateio.has(id));
    const nomes = idsForaDoRateio.length
      ? await prisma.usuario.findMany({ where: { id: { in: idsForaDoRateio } }, select: { id: true, nome: true } })
      : [];
    for (const u of nomes) {
      const gorjetaC = gorjetaPorUsuario.get(u.id) ?? 0;
      if (gorjetaC > 0) {
        outros.push({ usuarioId: u.id, nome: u.nome, valorGorjeta: emReais(gorjetaC) });
        distribuidoC += gorjetaC;
      }
    }
    outros.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  return {
    de: periodo.de,
    ate: periodo.ate,
    totalTaxa: emReais(totalTaxaC),
    totalGorjetas: emReais(totalGorjetasC),
    base: emReais(baseC),
    regra,
    grupos,
    outros,
    casa: emReais(casaC),
    totalDistribuido: emReais(distribuidoC),
  };
}

// ---------- Rotas ----------

router.get(
  '/rateio/regra',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    res.json(await lerRegra());
  })
);

router.put(
  '/rateio/regra',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(regraSchema, req.body);
    const soma = CHAVES_PERCENTUAIS.reduce((s, k) => s + paraCentavos(dados.percentuais[k]), 0);
    if (soma !== 10000) throw new HttpError(400, 'Os percentuais precisam somar 100%');
    const campos = {
      percGarcom: dados.percentuais.GARCOM.toFixed(2),
      percCozinha: dados.percentuais.COZINHA.toFixed(2),
      percLimpeza: dados.percentuais.LIMPEZA.toFixed(2),
      percRecepcao: dados.percentuais.RECEPCAO.toFixed(2),
      percCasa: dados.percentuais.CASA.toFixed(2),
      divisaoInterna: dados.divisaoInterna,
      gorjetasParaQuemRecebeu: dados.gorjetasParaQuemRecebeu,
    };
    const linha = await prisma.regraRateio.upsert({
      where: { id: 1 },
      update: campos,
      create: { id: 1, ...campos },
    });
    res.json(regraDoBanco(linha));
  })
);

router.get(
  '/rateio/simular',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const periodo = periodoDaQuery(req);
    const regra = await lerRegra();
    res.json(await calcular(periodo, regra));
  })
);

const fecharSchema = z.object({
  de: z.string(),
  ate: z.string(),
});

router.post(
  '/rateio/fechar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(fecharSchema, req.body);
    const periodo = periodoDe(dados.de, dados.ate);
    const regra = await lerRegra();
    const rateio = await calcular(periodo, regra);

    if (rateio.totalTaxa === 0 && rateio.totalGorjetas === 0) {
      throw new HttpError(400, 'Não há taxa de serviço nem gorjeta neste período');
    }

    const sobreposto = await prisma.repasse.findFirst({
      where: { de: { lte: periodo.fim }, ate: { gte: periodo.inicio } },
      select: { id: true },
    });
    if (sobreposto) {
      throw new HttpError(409, 'Já existe um repasse fechado que inclui dias deste período');
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const repasse = await prisma.repasse.create({
      data: {
        de: periodo.inicio,
        ate: periodo.fim,
        totalTaxa: rateio.totalTaxa.toFixed(2),
        totalGorjetas: rateio.totalGorjetas.toFixed(2),
        itens: rateio as unknown as Prisma.InputJsonValue,
        criadoPorNome: usuario?.nome ?? null,
      },
      select: { id: true },
    });
    res.status(201).json({ id: repasse.id });
  })
);

router.get(
  '/rateio/repasses',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const lista = await prisma.repasse.findMany({
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        de: true,
        ate: true,
        totalTaxa: true,
        totalGorjetas: true,
        criadoPorNome: true,
        criadoEm: true,
      },
    });
    res.json(
      lista.map((r) => ({
        id: r.id,
        de: formatarDia(r.de),
        ate: formatarDia(r.ate),
        totalTaxa: Number(r.totalTaxa),
        totalGorjetas: Number(r.totalGorjetas),
        criadoPorNome: r.criadoPorNome,
        criadoEm: r.criadoEm.toISOString(),
      }))
    );
  })
);

router.get(
  '/rateio/repasses/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const repasse = await prisma.repasse.findUnique({
      where: { id },
      select: { id: true, criadoPorNome: true, criadoEm: true, itens: true },
    });
    if (!repasse) throw new HttpError(404, 'Repasse não encontrado');
    res.json({
      id: repasse.id,
      criadoPorNome: repasse.criadoPorNome,
      criadoEm: repasse.criadoEm.toISOString(),
      rateio: repasse.itens as unknown as RateioDTO,
    });
  })
);

router.delete(
  '/rateio/repasses/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const apagados = await prisma.repasse.deleteMany({ where: { id } });
    if (apagados.count === 0) throw new HttpError(404, 'Repasse não encontrado');
    res.status(204).end();
  })
);

export default router;
