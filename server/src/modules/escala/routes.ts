import { Router } from 'express';
import { z } from 'zod';
import type { Perfil } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Escala da equipe (turnos por pessoa, montados pelo gestor) e ponto (entrada e saída).
// Cada pessoa registra o próprio ponto; o id do usuário sempre vem de req.usuario.

const router = Router();

const TODOS_PERFIS: Perfil[] = ['GESTOR', 'GARCOM', 'COZINHA', 'LIMPEZA', 'RECEPCAO'];
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA_EM_MS = 24 * 60 * 60 * 1000;
const SELECT_PESSOA = { id: true, nome: true, perfil: true } as const;

interface PessoaResumo {
  id: number;
  nome: string;
  perfil: Perfil;
}

// ---------- Datas ----------

function dois(n: number): string {
  return String(n).padStart(2, '0');
}

// Dia local do servidor em AAAA-MM-DD.
function diaTexto(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function dataValida(texto: string): boolean {
  if (!REGEX_DIA.test(texto)) return false;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

// Meia-noite UTC: é como o Turno.data (coluna DATE) é gravado e lido.
function diaUtc(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}

function somarDias(texto: string, n: number): string {
  return new Date(diaUtc(texto).getTime() + n * DIA_EM_MS).toISOString().slice(0, 10);
}

// Quantos dias há de b até a (a − b).
function diasEntre(a: string, b: string): number {
  return Math.round((diaUtc(a).getTime() - diaUtc(b).getTime()) / DIA_EM_MS);
}

function ehSegunda(texto: string): boolean {
  return diaUtc(texto).getUTCDay() === 1;
}

function inicioLocal(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number);
  return new Date(ano, mes - 1, dia, 0, 0, 0, 0);
}

function fimLocal(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number);
  return new Date(ano, mes - 1, dia, 23, 59, 59, 999);
}

function textoDaQuery(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

// Período de dias (de e ate, os dois incluídos). Sem eles, do dia 1 do mês atual até hoje.
function lerPeriodo(query: Record<string, unknown>, maximo: number): { de: string; ate: string } {
  const hoje = new Date();
  const de = textoDaQuery(query.de) ?? diaTexto(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const ate = textoDaQuery(query.ate) ?? diaTexto(hoje);
  if (!dataValida(de) || !dataValida(ate)) throw new HttpError(400, 'Data inválida');
  const quantidade = diasEntre(ate, de) + 1;
  if (quantidade < 1) throw new HttpError(400, 'A data final é antes da inicial');
  if (quantidade > maximo) throw new HttpError(400, `Período máximo de ${maximo} dias`);
  return { de, ate };
}

// ---------- Escala ----------

const dataSchema = z
  .string()
  .regex(REGEX_DIA, 'Data inválida')
  .refine(dataValida, 'Data inválida');

const horaSchema = z.string().regex(REGEX_HORA, 'Horário inválido (use HH:mm)');

const turnoBaseSchema = z.object({
  usuarioId: z.number().int().positive(),
  data: dataSchema,
  inicio: horaSchema,
  fim: horaSchema,
  observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
});

const turnoEdicaoSchema = turnoBaseSchema.partial();

const copiarSchema = z.object({
  deSemana: dataSchema,
  paraSemana: dataSchema,
});

interface TurnoLinha {
  id: number;
  data: Date;
  inicio: string;
  fim: string;
  observacao: string | null;
  usuario: PessoaResumo;
}

function turnoDTO(t: TurnoLinha) {
  return {
    id: t.id,
    usuario: t.usuario,
    data: t.data.toISOString().slice(0, 10),
    inicio: t.inicio,
    fim: t.fim,
    observacao: t.observacao,
  };
}

async function garantirPessoa(usuarioId: number): Promise<void> {
  const pessoa = await prisma.usuario.findFirst({ where: { id: usuarioId, ativo: true }, select: { id: true } });
  if (!pessoa) throw new HttpError(404, 'Pessoa não encontrada');
}

async function checarConflito(usuarioId: number, data: string, inicio: string, ignorarId?: number): Promise<void> {
  const existente = await prisma.turno.findFirst({
    where: {
      usuarioId,
      data: diaUtc(data),
      inicio,
      ...(ignorarId !== undefined ? { id: { not: ignorarId } } : {}),
    },
    select: { id: true },
  });
  if (existente) {
    throw new HttpError(409, 'Essa pessoa já tem um turno neste dia com o mesmo horário de início');
  }
}

router.get(
  '/escala',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { de, ate } = lerPeriodo(req.query, 62);
    const [turnos, equipe] = await Promise.all([
      prisma.turno.findMany({
        where: { data: { gte: diaUtc(de), lte: diaUtc(ate) } },
        include: { usuario: { select: SELECT_PESSOA } },
        orderBy: [{ data: 'asc' }, { inicio: 'asc' }],
      }),
      prisma.usuario.findMany({
        where: { ativo: true },
        select: SELECT_PESSOA,
        orderBy: [{ perfil: 'asc' }, { nome: 'asc' }],
      }),
    ]);
    res.json({ turnos: turnos.map(turnoDTO), equipe });
  })
);

// Turnos de quem está logado, de hoje até 14 dias à frente.
router.get(
  '/escala/minha',
  permitir(...TODOS_PERFIS),
  asyncHandler(async (req, res) => {
    const hoje = diaTexto(new Date());
    const turnos = await prisma.turno.findMany({
      where: {
        usuarioId: req.usuario.id,
        data: { gte: diaUtc(hoje), lte: diaUtc(somarDias(hoje, 14)) },
      },
      include: { usuario: { select: SELECT_PESSOA } },
      orderBy: [{ data: 'asc' }, { inicio: 'asc' }],
    });
    res.json(turnos.map(turnoDTO));
  })
);

router.post(
  '/escala',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(turnoBaseSchema, req.body);
    await garantirPessoa(dados.usuarioId);
    await checarConflito(dados.usuarioId, dados.data, dados.inicio);
    const turno = await prisma.turno.create({
      data: {
        usuarioId: dados.usuarioId,
        data: diaUtc(dados.data),
        inicio: dados.inicio,
        fim: dados.fim,
        observacao: dados.observacao || null,
      },
      include: { usuario: { select: SELECT_PESSOA } },
    });
    res.status(201).json(turnoDTO(turno));
  })
);

// Copia os turnos de uma semana (segunda a domingo) para outra, sem repetir os que já existem.
router.post(
  '/escala/copiar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(copiarSchema, req.body);
    if (!ehSegunda(dados.deSemana) || !ehSegunda(dados.paraSemana)) {
      throw new HttpError(400, 'As datas precisam ser segundas-feiras');
    }
    const deslocamento = diasEntre(dados.paraSemana, dados.deSemana);
    const fimDeOrigem = somarDias(dados.deSemana, 6);
    const fimDeDestino = somarDias(dados.paraSemana, 6);

    const [origem, destino] = await Promise.all([
      prisma.turno.findMany({
        where: { data: { gte: diaUtc(dados.deSemana), lte: diaUtc(fimDeOrigem) } },
        orderBy: [{ data: 'asc' }, { inicio: 'asc' }],
      }),
      prisma.turno.findMany({
        where: { data: { gte: diaUtc(dados.paraSemana), lte: diaUtc(fimDeDestino) } },
        select: { usuarioId: true, data: true, inicio: true },
      }),
    ]);

    const chave = (usuarioId: number, dia: string, inicio: string) => `${usuarioId}|${dia}|${inicio}`;
    const existentes = new Set(
      destino.map((t) => chave(t.usuarioId, t.data.toISOString().slice(0, 10), t.inicio))
    );

    const novos: {
      usuarioId: number;
      data: Date;
      inicio: string;
      fim: string;
      observacao: string | null;
    }[] = [];
    for (const t of origem) {
      const diaDestino = somarDias(t.data.toISOString().slice(0, 10), deslocamento);
      const k = chave(t.usuarioId, diaDestino, t.inicio);
      if (existentes.has(k)) continue;
      existentes.add(k);
      novos.push({
        usuarioId: t.usuarioId,
        data: diaUtc(diaDestino),
        inicio: t.inicio,
        fim: t.fim,
        observacao: t.observacao,
      });
    }

    const resultado = novos.length > 0 ? await prisma.turno.createMany({ data: novos }) : { count: 0 };
    res.json({ copiados: resultado.count });
  })
);

router.put(
  '/escala/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.turno.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Turno não encontrado');
    const dados = validar(turnoEdicaoSchema, req.body);
    if (dados.usuarioId !== undefined) await garantirPessoa(dados.usuarioId);

    const usuarioId = dados.usuarioId ?? atual.usuarioId;
    const data = dados.data ?? atual.data.toISOString().slice(0, 10);
    const inicio = dados.inicio ?? atual.inicio;
    const fim = dados.fim ?? atual.fim;
    await checarConflito(usuarioId, data, inicio, id);

    const turno = await prisma.turno.update({
      where: { id },
      data: {
        usuarioId,
        data: diaUtc(data),
        inicio,
        fim,
        observacao: dados.observacao === undefined ? atual.observacao : dados.observacao || null,
      },
      include: { usuario: { select: SELECT_PESSOA } },
    });
    res.json(turnoDTO(turno));
  })
);

router.delete(
  '/escala/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.turno.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new HttpError(404, 'Turno não encontrado');
    await prisma.turno.delete({ where: { id } });
    res.status(204).end();
  })
);

// ---------- Ponto ----------

const dataHoraSchema = z.string().refine((t) => !Number.isNaN(Date.parse(t)), 'Data e hora inválidas');

const pontoManualSchema = z.object({
  usuarioId: z.number().int().positive(),
  entrada: dataHoraSchema,
  saida: dataHoraSchema.nullable().optional(),
  observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
});

const pontoAjusteSchema = z.object({
  entrada: dataHoraSchema.optional(),
  saida: dataHoraSchema.nullable().optional(),
  observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
});

interface PontoLinha {
  id: number;
  entrada: Date;
  saida: Date | null;
  observacao: string | null;
  ajustadoPorNome: string | null;
  usuario: PessoaResumo;
}

function minutosEntre(entrada: Date, saida: Date): number {
  return Math.round((saida.getTime() - entrada.getTime()) / 60000);
}

function pontoDTO(r: PontoLinha) {
  return {
    id: r.id,
    usuario: r.usuario,
    entrada: r.entrada.toISOString(),
    saida: r.saida ? r.saida.toISOString() : null,
    minutos: r.saida ? minutosEntre(r.entrada, r.saida) : null,
    observacao: r.observacao,
    ajustadoPorNome: r.ajustadoPorNome,
  };
}

async function nomeDoUsuarioLogado(id: number): Promise<string | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } });
  return usuario?.nome ?? null;
}

// Início da semana (segunda 00:00, no fuso do servidor).
function inicioDaSemana(agora: Date): Date {
  const deslocamento = (agora.getDay() + 6) % 7;
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - deslocamento, 0, 0, 0, 0);
}

router.get(
  '/ponto/meu',
  permitir(...TODOS_PERFIS),
  asyncHandler(async (req, res) => {
    const usuarioId = req.usuario.id;
    const inicioSemana = inicioDaSemana(new Date());
    const fimSemana = new Date(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate() + 7);

    const [aberto, recentes, semana] = await Promise.all([
      prisma.registroPonto.findFirst({
        where: { usuarioId, saida: null },
        include: { usuario: { select: SELECT_PESSOA } },
        orderBy: { entrada: 'desc' },
      }),
      prisma.registroPonto.findMany({
        where: { usuarioId, saida: { not: null } },
        include: { usuario: { select: SELECT_PESSOA } },
        orderBy: { entrada: 'desc' },
        take: 10,
      }),
      prisma.registroPonto.findMany({
        where: { usuarioId, saida: { not: null }, entrada: { gte: inicioSemana, lt: fimSemana } },
        select: { entrada: true, saida: true },
      }),
    ]);

    const minutosNaSemana = semana.reduce(
      (total, r) => total + (r.saida ? minutosEntre(r.entrada, r.saida) : 0),
      0
    );
    res.json({
      aberto: aberto ? pontoDTO(aberto) : null,
      recentes: recentes.map(pontoDTO),
      minutosNaSemana,
    });
  })
);

router.post(
  '/ponto/entrada',
  permitir(...TODOS_PERFIS),
  asyncHandler(async (req, res) => {
    const aberto = await prisma.registroPonto.findFirst({
      where: { usuarioId: req.usuario.id, saida: null },
      select: { id: true },
    });
    if (aberto) throw new HttpError(409, 'Você já registrou a entrada');
    const registro = await prisma.registroPonto.create({
      data: { usuarioId: req.usuario.id, entrada: new Date() },
      include: { usuario: { select: SELECT_PESSOA } },
    });
    res.status(201).json(pontoDTO(registro));
  })
);

router.post(
  '/ponto/saida',
  permitir(...TODOS_PERFIS),
  asyncHandler(async (req, res) => {
    const aberto = await prisma.registroPonto.findFirst({
      where: { usuarioId: req.usuario.id, saida: null },
      orderBy: { entrada: 'desc' },
      select: { id: true },
    });
    if (!aberto) throw new HttpError(409, 'Registre a entrada primeiro');
    const registro = await prisma.registroPonto.update({
      where: { id: aberto.id },
      data: { saida: new Date() },
      include: { usuario: { select: SELECT_PESSOA } },
    });
    res.json(pontoDTO(registro));
  })
);

router.get(
  '/ponto',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { de, ate } = lerPeriodo(req.query, 366);
    const bruto = textoDaQuery(req.query.usuarioId);
    let usuarioId: number | undefined;
    if (bruto !== undefined) {
      if (!/^\d+$/.test(bruto)) throw new HttpError(400, 'Pessoa inválida');
      usuarioId = Number(bruto);
    }

    const todos = await prisma.registroPonto.findMany({
      where: {
        entrada: { gte: inicioLocal(de), lte: fimLocal(ate) },
        ...(usuarioId !== undefined ? { usuarioId } : {}),
      },
      include: { usuario: { select: SELECT_PESSOA } },
      orderBy: { entrada: 'desc' },
    });

    const porPessoa = new Map<number, { usuario: PessoaResumo; minutos: number; dias: Set<string>; abertos: number }>();
    for (const r of todos) {
      let total = porPessoa.get(r.usuarioId);
      if (!total) {
        total = { usuario: r.usuario, minutos: 0, dias: new Set<string>(), abertos: 0 };
        porPessoa.set(r.usuarioId, total);
      }
      total.dias.add(diaTexto(r.entrada));
      if (r.saida) total.minutos += minutosEntre(r.entrada, r.saida);
      else total.abertos += 1;
    }

    const totais = Array.from(porPessoa.values())
      .map((t) => ({ usuario: t.usuario, minutos: t.minutos, dias: t.dias.size, abertos: t.abertos }))
      .sort((a, b) => a.usuario.nome.localeCompare(b.usuario.nome, 'pt-BR'));

    res.json({ registros: todos.slice(0, 1000).map(pontoDTO), totais });
  })
);

// Registro manual feito pelo gestor (esquecimento, por exemplo).
router.post(
  '/ponto',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(pontoManualSchema, req.body);
    await garantirPessoa(dados.usuarioId);
    const entrada = new Date(dados.entrada);
    const saida = dados.saida ? new Date(dados.saida) : null;
    if (saida && saida.getTime() < entrada.getTime()) {
      throw new HttpError(400, 'A saída não pode ser antes da entrada');
    }
    const registro = await prisma.registroPonto.create({
      data: {
        usuarioId: dados.usuarioId,
        entrada,
        saida,
        observacao: dados.observacao || null,
        ajustadoPorNome: await nomeDoUsuarioLogado(req.usuario.id),
      },
      include: { usuario: { select: SELECT_PESSOA } },
    });
    res.status(201).json(pontoDTO(registro));
  })
);

router.put(
  '/ponto/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.registroPonto.findUnique({ where: { id }, select: { id: true, entrada: true, saida: true, observacao: true } });
    if (!atual) throw new HttpError(404, 'Registro não encontrado');
    const dados = validar(pontoAjusteSchema, req.body);

    const entrada = dados.entrada !== undefined ? new Date(dados.entrada) : atual.entrada;
    const saida = dados.saida !== undefined ? (dados.saida ? new Date(dados.saida) : null) : atual.saida;
    if (saida && saida.getTime() < entrada.getTime()) {
      throw new HttpError(400, 'A saída não pode ser antes da entrada');
    }

    const registro = await prisma.registroPonto.update({
      where: { id },
      data: {
        entrada,
        saida,
        observacao: dados.observacao === undefined ? atual.observacao : dados.observacao || null,
        ajustadoPorNome: await nomeDoUsuarioLogado(req.usuario.id),
      },
      include: { usuario: { select: SELECT_PESSOA } },
    });
    res.json(pontoDTO(registro));
  })
);

router.delete(
  '/ponto/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.registroPonto.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new HttpError(404, 'Registro não encontrado');
    await prisma.registroPonto.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
