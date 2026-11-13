import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { Cupom } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { promocoesValendo, valeNoHorario } from '../../lib/precos';

// Promoções por horário (preço promocional de produto ou categoria) e cupons de desconto na conta.
// O garçom aplica o cupom na tela da conta; o preço promocional entra sozinho no cardápio.

const router = Router();

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// "AAAA-MM-DD" para número das partes. Data impossível (ex.: 31/02) = null.
function partesDoDia(texto: string): { ano: number; mes: number; dia: number } | null {
  if (!DATA_RE.test(texto)) return null;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia, 12, 0, 0, 0);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return { ano, mes, dia };
}

// Início do dia no fuso do servidor.
function inicioDoDia(texto: string): Date {
  const p = partesDoDia(texto)!;
  return new Date(p.ano, p.mes - 1, p.dia, 0, 0, 0, 0);
}

// Fim do dia no fuso do servidor.
function fimDoDia(texto: string): Date {
  const p = partesDoDia(texto)!;
  return new Date(p.ano, p.mes - 1, p.dia, 23, 59, 59, 999);
}

// Data do banco para "AAAA-MM-DD" (no fuso do servidor).
function paraDia(d: Date): string {
  const ano = String(d.getFullYear()).padStart(4, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

const dataSchema = z
  .string()
  .refine((v) => partesDoDia(v) !== null, 'Use uma data válida no formato AAAA-MM-DD');

const idOpcional = z.number().int('Use um número inteiro').positive('Escolha um item válido');

const promocaoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da promoção').max(60, 'Nome muito longo'),
  produtoId: idOpcional.nullable().optional(),
  categoriaId: idOpcional.nullable().optional(),
  percentual: z
    .number()
    .min(0.01, 'O percentual vai de 0,01 a 100')
    .max(100, 'O percentual vai de 0,01 a 100')
    .nullable()
    .optional(),
  precoFixo: z.number().min(0, 'O preço não pode ser negativo').max(99999999.99, 'Preço muito alto').nullable().optional(),
  diasSemana: z
    .array(z.number().int().min(0).max(6))
    .refine((dias) => new Set(dias).size === dias.length, 'Dia da semana repetido'),
  horaInicio: z.string().regex(HORA_RE, 'Use a hora no formato HH:mm'),
  horaFim: z.string().regex(HORA_RE, 'Use a hora no formato HH:mm'),
  dataInicio: dataSchema.nullable().optional(),
  dataFim: dataSchema.nullable().optional(),
  ativa: z.boolean().optional(),
});

const INCLUIR_PROMOCAO = {
  produto: { select: { id: true, nome: true } },
  categoria: { select: { id: true, nome: true } },
} as const;

type PromocaoLida = Prisma.PromocaoGetPayload<{ include: typeof INCLUIR_PROMOCAO }>;

function paraPromocaoDTO(p: PromocaoLida, valendo: Set<number>, agora: Date) {
  return {
    id: p.id,
    nome: p.nome,
    produto: p.produto,
    categoria: p.categoria,
    percentual: p.percentual !== null ? Number(p.percentual) : null,
    precoFixo: p.precoFixo !== null ? Number(p.precoFixo) : null,
    diasSemana: p.diasSemana,
    horaInicio: p.horaInicio,
    horaFim: p.horaFim,
    dataInicio: p.dataInicio ? paraDia(p.dataInicio) : null,
    dataFim: p.dataFim ? paraDia(p.dataFim) : null,
    ativa: p.ativa,
    valendoAgora: p.ativa && valendo.has(p.id) && valeNoHorario(p, agora),
  };
}

// Regras de "exatamente um" e de alvo, valendo para criar e para editar.
async function conferirPromocao(dados: z.infer<typeof promocaoSchema>) {
  const temPercentual = dados.percentual !== null && dados.percentual !== undefined;
  const temPrecoFixo = dados.precoFixo !== null && dados.precoFixo !== undefined;
  if (temPercentual === temPrecoFixo) {
    throw new HttpError(400, 'Escolha o desconto: percentual ou preço fixo, só um deles');
  }
  const temProduto = dados.produtoId !== null && dados.produtoId !== undefined;
  const temCategoria = dados.categoriaId !== null && dados.categoriaId !== undefined;
  if (temPrecoFixo && !temProduto) {
    throw new HttpError(400, 'O preço fixo só vale para um produto');
  }
  if (temProduto && temCategoria) {
    throw new HttpError(400, 'Escolha um produto ou uma categoria, não os dois');
  }
  if (dados.dataInicio && dados.dataFim && dados.dataFim < dados.dataInicio) {
    throw new HttpError(400, 'A data final não pode ser antes da inicial');
  }
  if (temProduto) {
    const produto = await prisma.produto.findUnique({ where: { id: dados.produtoId! }, select: { id: true } });
    if (!produto) throw new HttpError(400, 'Produto não encontrado');
  }
  if (temCategoria) {
    const categoria = await prisma.categoria.findUnique({ where: { id: dados.categoriaId! }, select: { id: true } });
    if (!categoria) throw new HttpError(400, 'Categoria não encontrada');
  }
}

// Campos gravados de uma promoção (datas: início do dia e fim do dia).
function dadosDaPromocao(dados: z.infer<typeof promocaoSchema>, ativaPadrao: boolean) {
  const temPrecoFixo = dados.precoFixo !== null && dados.precoFixo !== undefined;
  return {
    nome: dados.nome,
    produtoId: dados.produtoId ?? null,
    categoriaId: dados.categoriaId ?? null,
    percentual: dados.percentual !== null && dados.percentual !== undefined ? dados.percentual.toFixed(2) : null,
    precoFixo: temPrecoFixo ? dados.precoFixo!.toFixed(2) : null,
    diasSemana: dados.diasSemana,
    horaInicio: dados.horaInicio,
    horaFim: dados.horaFim,
    dataInicio: dados.dataInicio ? inicioDoDia(dados.dataInicio) : null,
    dataFim: dados.dataFim ? fimDoDia(dados.dataFim) : null,
    ativa: dados.ativa ?? ativaPadrao,
  };
}

router.get(
  '/promocoes',
  permitir('GESTOR', 'GARCOM'),
  asyncHandler(async (_req, res) => {
    const agora = new Date();
    const [lista, valendo] = await Promise.all([
      prisma.promocao.findMany({ include: INCLUIR_PROMOCAO, orderBy: { nome: 'asc' } }),
      promocoesValendo(agora),
    ]);
    const ids = new Set(valendo.map((p) => p.id));
    res.json(lista.map((p) => paraPromocaoDTO(p, ids, agora)));
  })
);

router.post(
  '/promocoes',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(promocaoSchema, req.body);
    await conferirPromocao(dados);
    const criada = await prisma.promocao.create({
      data: dadosDaPromocao(dados, true),
      include: INCLUIR_PROMOCAO,
    });
    const agora = new Date();
    const valendo = await promocoesValendo(agora);
    res.status(201).json(paraPromocaoDTO(criada, new Set(valendo.map((p) => p.id)), agora));
  })
);

router.put(
  '/promocoes/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(promocaoSchema, req.body);
    const atual = await prisma.promocao.findUnique({ where: { id }, select: { id: true, ativa: true } });
    if (!atual) throw new HttpError(404, 'Promoção não encontrada');
    await conferirPromocao(dados);
    const alterada = await prisma.promocao.update({
      where: { id },
      data: dadosDaPromocao(dados, atual.ativa),
      include: INCLUIR_PROMOCAO,
    });
    const agora = new Date();
    const valendo = await promocoesValendo(agora);
    res.json(paraPromocaoDTO(alterada, new Set(valendo.map((p) => p.id)), agora));
  })
);

router.delete(
  '/promocoes/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.promocao.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new HttpError(404, 'Promoção não encontrada');
    await prisma.promocao.delete({ where: { id } });
    res.status(204).end();
  })
);

// ---------- Cupons ----------

const cupomSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(3, 'O código tem de 3 a 20 caracteres')
    .max(20, 'O código tem de 3 a 20 caracteres')
    .regex(/^[A-Za-z0-9_-]+$/, 'Use só letras, números, - e _'),
  descricao: z.string().trim().max(120, 'Descrição muito longa').nullable().optional(),
  percentual: z
    .number()
    .min(0.01, 'O percentual vai de 0,01 a 100')
    .max(100, 'O percentual vai de 0,01 a 100')
    .nullable()
    .optional(),
  valor: z.number().positive('O valor precisa ser maior que zero').max(99999999.99, 'Valor muito alto').nullable().optional(),
  minimo: z.number().min(0, 'O consumo mínimo não pode ser negativo').max(99999999.99, 'Valor muito alto').nullable().optional(),
  validade: dataSchema.nullable().optional(),
  limiteUsos: z.number().int('Use um número inteiro').min(1, 'O limite de usos vai de 1 em diante').nullable().optional(),
  ativo: z.boolean().optional(),
});

type CupomLido = Cupom;

// Situação do cupom: desativado, vencido, esgotado ou valendo.
function situacaoDoCupom(c: CupomLido, agora: Date): 'VALENDO' | 'VENCIDO' | 'ESGOTADO' | 'DESATIVADO' {
  if (!c.ativo) return 'DESATIVADO';
  // A validade é gravada no fim do dia; passou dela = vencido.
  if (c.validade && c.validade.getTime() < agora.getTime()) return 'VENCIDO';
  if (c.limiteUsos !== null && c.usos >= c.limiteUsos) return 'ESGOTADO';
  return 'VALENDO';
}

function paraCupomDTO(c: CupomLido, agora: Date) {
  return {
    id: c.id,
    codigo: c.codigo,
    descricao: c.descricao,
    percentual: c.percentual !== null ? Number(c.percentual) : null,
    valor: c.valor !== null ? Number(c.valor) : null,
    minimo: Number(c.minimo),
    validade: c.validade ? paraDia(c.validade) : null,
    limiteUsos: c.limiteUsos,
    usos: c.usos,
    ativo: c.ativo,
    situacao: situacaoDoCupom(c, agora),
  };
}

// Grava o cupom. Se duas requisições gravarem o mesmo código ao mesmo tempo, o banco recusa (P2002): vira 409.
async function gravarCupom(gravar: () => Promise<Cupom>): Promise<Cupom> {
  try {
    return await gravar();
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      throw new HttpError(409, 'Já existe um cupom com este código');
    }
    throw erro;
  }
}

// Código em maiúsculas; repetido = 409. `ignorarId` é o próprio cupom na edição.
async function conferirCodigo(codigo: string, ignorarId?: number) {
  const outro = await prisma.cupom.findFirst({
    where: { codigo, ...(ignorarId !== undefined ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  });
  if (outro) throw new HttpError(409, 'Já existe um cupom com este código');
}

function conferirDesconto(dados: z.infer<typeof cupomSchema>) {
  const temPercentual = dados.percentual !== null && dados.percentual !== undefined;
  const temValor = dados.valor !== null && dados.valor !== undefined;
  if (temPercentual === temValor) {
    throw new HttpError(400, 'Escolha o desconto: percentual ou valor em R$, só um deles');
  }
}

function dadosDoCupom(dados: z.infer<typeof cupomSchema>, ativoPadrao: boolean) {
  return {
    codigo: dados.codigo.toUpperCase(),
    descricao: dados.descricao || null,
    percentual: dados.percentual !== null && dados.percentual !== undefined ? dados.percentual.toFixed(2) : null,
    valor: dados.valor !== null && dados.valor !== undefined ? dados.valor.toFixed(2) : null,
    minimo: (dados.minimo ?? 0).toFixed(2),
    validade: dados.validade ? fimDoDia(dados.validade) : null,
    limiteUsos: dados.limiteUsos ?? null,
    ativo: dados.ativo ?? ativoPadrao,
  };
}

router.get(
  '/cupons',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const lista = await prisma.cupom.findMany({ orderBy: { codigo: 'asc' } });
    const agora = new Date();
    res.json(lista.map((c) => paraCupomDTO(c, agora)));
  })
);

router.post(
  '/cupons',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(cupomSchema, req.body);
    conferirDesconto(dados);
    const codigo = dados.codigo.toUpperCase();
    await conferirCodigo(codigo);
    const criado = await gravarCupom(() => prisma.cupom.create({ data: dadosDoCupom(dados, true) }));
    res.status(201).json(paraCupomDTO(criado, new Date()));
  })
);

router.put(
  '/cupons/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(cupomSchema, req.body);
    const atual = await prisma.cupom.findUnique({ where: { id }, select: { id: true, ativo: true } });
    if (!atual) throw new HttpError(404, 'Cupom não encontrado');
    conferirDesconto(dados);
    await conferirCodigo(dados.codigo.toUpperCase(), id);
    const alterado = await gravarCupom(() => prisma.cupom.update({ where: { id }, data: dadosDoCupom(dados, atual.ativo) }));
    res.json(paraCupomDTO(alterado, new Date()));
  })
);

// Sem contas ligadas, apaga. Com contas no histórico, só desativa (a conta guarda o cupom).
router.delete(
  '/cupons/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.cupom.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new HttpError(404, 'Cupom não encontrado');
    const contas = await prisma.conta.count({ where: { cupomId: id } });
    if (contas > 0) {
      await prisma.cupom.update({ where: { id }, data: { ativo: false } });
      res.json({ desativado: true });
      return;
    }
    await prisma.cupom.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
