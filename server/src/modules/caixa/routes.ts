import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Caixa da gaveta: abertura com o troco inicial, sangrias (retiradas), reforços (entradas) e
// fechamento conferindo o dinheiro que deveria estar no caixa com o que foi contado.
// Só pode haver um caixa aberto por vez. Dinheiro é somado em centavos.

const router = Router();
const operadores = permitir('GESTOR', 'GARCOM', 'RECEPCAO');

const FORMA_DINHEIRO = 'Dinheiro';

type Transacao = Prisma.TransactionClient;
type CaixaCompleto = Prisma.CaixaGetPayload<{ include: { movimentos: true } }>;

interface ResumoCaixa {
  dinheiro: number;
  sangrias: number;
  reforcos: number;
  esperado: number;
  porForma: Record<string, number>;
  recebimentos: number;
}

interface CaixaDTO {
  id: number;
  status: 'ABERTO' | 'FECHADO';
  abertoPorNome: string;
  abertoEm: string;
  valorInicial: number;
  fechadoPorNome: string | null;
  fechadoEm: string | null;
  valorContado: number | null;
  valorEsperado: number | null;
  diferenca: number | null;
  observacao: string | null;
  movimentos: {
    id: number;
    tipo: 'SANGRIA' | 'REFORCO';
    valor: number;
    motivo: string | null;
    usuarioNome: string;
    criadoEm: string;
  }[];
  resumo: ResumoCaixa;
}

function centavos(valor: Prisma.Decimal | number): number {
  return Math.round(Number(valor) * 100);
}

function reais(valorEmCentavos: number): number {
  return valorEmCentavos / 100;
}

// Valor digitado em reais para centavos inteiros. Recusa mais de duas casas decimais.
function emCentavos(valor: number): number {
  const centavosExatos = Math.round(valor * 100);
  if (Math.abs(centavosExatos - valor * 100) > 1e-6) {
    throw new HttpError(400, 'Use no máximo duas casas decimais');
  }
  return centavosExatos;
}

// Centavos para o texto de coluna Decimal(10, 2).
function paraDecimal(valorEmCentavos: number): string {
  return (valorEmCentavos / 100).toFixed(2);
}

// Todas as leituras e gravações do caixa passam por transação serializável: assim dois pedidos
// ao mesmo tempo não conseguem abrir dois caixas nem mexer no mesmo caixa ao mesmo tempo.
async function transacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2034') {
      throw new HttpError(409, 'Outra operação mexeu no caixa. Tente de novo');
    }
    throw erro;
  }
}

async function nomeDoUsuario(id: number): Promise<string> {
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } });
  if (!usuario) throw new HttpError(401, 'Não autenticado');
  return usuario.nome;
}

// Dinheiro esperado na gaveta: troco inicial + recebido em dinheiro + reforços − sangrias.
// Os recebimentos entram da hora de abertura até `fim` (fechamento, ou agora se ainda aberto).
async function calcularResumo(tx: Transacao, caixa: CaixaCompleto, fim: Date): Promise<ResumoCaixa> {
  const pagamentos = await tx.pagamento.findMany({
    where: { status: 'APROVADO', concluidoEm: { gte: caixa.abertoEm, lte: fim } },
    select: { valor: true, gorjeta: true, formaPagamento: true },
  });

  const porFormaCentavos: Record<string, number> = {};
  let dinheiro = 0;
  for (const p of pagamentos) {
    const total = centavos(p.valor) + centavos(p.gorjeta);
    porFormaCentavos[p.formaPagamento] = (porFormaCentavos[p.formaPagamento] ?? 0) + total;
    if (p.formaPagamento === FORMA_DINHEIRO) dinheiro += total;
  }

  let sangrias = 0;
  let reforcos = 0;
  for (const m of caixa.movimentos) {
    if (m.tipo === 'SANGRIA') sangrias += centavos(m.valor);
    else reforcos += centavos(m.valor);
  }

  const esperado = centavos(caixa.valorInicial) + dinheiro + reforcos - sangrias;

  const porForma: Record<string, number> = {};
  for (const [forma, total] of Object.entries(porFormaCentavos)) {
    porForma[forma] = reais(total);
  }

  return {
    dinheiro: reais(dinheiro),
    sangrias: reais(sangrias),
    reforcos: reais(reforcos),
    esperado: reais(esperado),
    porForma,
    recebimentos: pagamentos.length,
  };
}

async function montarDTO(tx: Transacao, caixa: CaixaCompleto): Promise<CaixaDTO> {
  const resumo = await calcularResumo(tx, caixa, caixa.fechadoEm ?? new Date());
  return {
    id: caixa.id,
    status: caixa.status,
    abertoPorNome: caixa.abertoPorNome,
    abertoEm: caixa.abertoEm.toISOString(),
    valorInicial: Number(caixa.valorInicial),
    fechadoPorNome: caixa.fechadoPorNome,
    fechadoEm: caixa.fechadoEm ? caixa.fechadoEm.toISOString() : null,
    valorContado: caixa.valorContado === null ? null : Number(caixa.valorContado),
    valorEsperado: caixa.valorEsperado === null ? null : Number(caixa.valorEsperado),
    diferenca: caixa.diferenca === null ? null : Number(caixa.diferenca),
    observacao: caixa.observacao,
    movimentos: caixa.movimentos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      valor: Number(m.valor),
      motivo: m.motivo,
      usuarioNome: m.usuarioNome,
      criadoEm: m.criadoEm.toISOString(),
    })),
    resumo,
  };
}

router.get(
  '/caixa',
  operadores,
  asyncHandler(async (_req, res) => {
    const resposta = await transacao(async (tx) => {
      const aberto = await tx.caixa.findFirst({
        where: { status: 'ABERTO' },
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      const ultimo = await tx.caixa.findFirst({
        where: { status: 'FECHADO' },
        orderBy: { fechadoEm: 'desc' },
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      return {
        aberto: aberto ? await montarDTO(tx, aberto) : null,
        ultimoFechado: ultimo ? await montarDTO(tx, ultimo) : null,
      };
    });
    res.json(resposta);
  })
);

const abrirSchema = z.object({
  valorInicial: z.number().min(0, 'Informe o troco inicial'),
});

router.post(
  '/caixa/abrir',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(abrirSchema, req.body);
    const valorInicial = emCentavos(dados.valorInicial);
    const abertoPorNome = await nomeDoUsuario(req.usuario.id);
    const dto = await transacao(async (tx) => {
      const existente = await tx.caixa.findFirst({ where: { status: 'ABERTO' }, select: { id: true } });
      if (existente) throw new HttpError(409, 'Já há um caixa aberto');
      const caixa = await tx.caixa.create({
        data: {
          status: 'ABERTO',
          abertoPorId: req.usuario.id,
          abertoPorNome,
          valorInicial: paraDecimal(valorInicial),
        },
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      return montarDTO(tx, caixa);
    });
    res.status(201).json(dto);
  })
);

const movimentoSchema = z.object({
  tipo: z.enum(['SANGRIA', 'REFORCO']),
  valor: z.number().positive('Informe o valor'),
  motivo: z.string().trim().max(120, 'Motivo muito longo').nullable().optional(),
});

router.post(
  '/caixa/movimentos',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(movimentoSchema, req.body);
    const valor = emCentavos(dados.valor);
    const usuarioNome = await nomeDoUsuario(req.usuario.id);
    const dto = await transacao(async (tx) => {
      const caixa = await tx.caixa.findFirst({
        where: { status: 'ABERTO' },
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      if (!caixa) throw new HttpError(409, 'Abra o caixa primeiro');

      if (dados.tipo === 'SANGRIA') {
        const resumo = await calcularResumo(tx, caixa, new Date());
        if (valor > centavos(resumo.esperado)) {
          throw new HttpError(400, 'A sangria é maior que o dinheiro do caixa');
        }
      }

      await tx.movimentoCaixa.create({
        data: {
          caixaId: caixa.id,
          tipo: dados.tipo,
          valor: paraDecimal(valor),
          motivo: dados.motivo || null,
          usuarioNome,
        },
      });

      const atualizado = await tx.caixa.findUniqueOrThrow({
        where: { id: caixa.id },
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      return montarDTO(tx, atualizado);
    });
    res.status(201).json(dto);
  })
);

const fecharSchema = z.object({
  valorContado: z.number().min(0, 'Informe o dinheiro contado'),
  observacao: z.string().trim().nullable().optional(),
});

router.post(
  '/caixa/fechar',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(fecharSchema, req.body);
    const contado = emCentavos(dados.valorContado);
    const fechadoPorNome = await nomeDoUsuario(req.usuario.id);
    const dto = await transacao(async (tx) => {
      const caixa = await tx.caixa.findFirst({
        where: { status: 'ABERTO' },
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      if (!caixa) throw new HttpError(409, 'Não há caixa aberto');

      const fechadoEm = new Date();
      const resumo = await calcularResumo(tx, caixa, fechadoEm);
      const esperado = centavos(resumo.esperado);

      await tx.caixa.update({
        where: { id: caixa.id },
        data: {
          status: 'FECHADO',
          fechadoPorNome,
          fechadoEm,
          valorContado: paraDecimal(contado),
          valorEsperado: paraDecimal(esperado),
          diferenca: paraDecimal(contado - esperado),
          observacao: dados.observacao || null,
        },
      });

      const fechado = await tx.caixa.findUniqueOrThrow({
        where: { id: caixa.id },
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      return montarDTO(tx, fechado);
    });
    res.json(dto);
  })
);

router.get(
  '/caixa/historico',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dias = req.query.dias === undefined ? 30 : Number(req.query.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      throw new HttpError(400, 'Período inválido');
    }
    // Inclui hoje: o primeiro dia é meia-noite de (hoje − (dias − 1)).
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (dias - 1), 0, 0, 0, 0);

    const lista = await transacao(async (tx) => {
      const fechados = await tx.caixa.findMany({
        where: { status: 'FECHADO', fechadoEm: { gte: inicio } },
        orderBy: { fechadoEm: 'desc' },
        take: 200,
        include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
      });
      const saida: CaixaDTO[] = [];
      for (const caixa of fechados) {
        saida.push(await montarDTO(tx, caixa));
      }
      return saida;
    });
    res.json(lista);
  })
);

export default router;
