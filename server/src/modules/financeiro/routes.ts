import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Financeiro: despesas e outras receitas lançadas pelo gestor, e o resumo de ganhos e gastos.
// As vendas das mesas não ficam em Lancamento: vêm da tabela Pagamento.

const router = Router();

type Tipo = 'DESPESA' | 'RECEITA';
const TIPOS: Tipo[] = ['DESPESA', 'RECEITA'];

const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMO_DIAS = 366;
const DIA_MS = 86400000;

const CATEGORIAS_PADRAO: Prisma.CategoriaFinanceiraCreateManyInput[] = [
  { nome: 'Fornecedores', tipo: 'DESPESA' },
  { nome: 'Salários', tipo: 'DESPESA' },
  { nome: 'Aluguel', tipo: 'DESPESA' },
  { nome: 'Água, luz e gás', tipo: 'DESPESA' },
  { nome: 'Impostos e taxas', tipo: 'DESPESA' },
  { nome: 'Manutenção', tipo: 'DESPESA' },
  { nome: 'Marketing', tipo: 'DESPESA' },
  { nome: 'Outras despesas', tipo: 'DESPESA' },
  { nome: 'Outras receitas', tipo: 'RECEITA' },
];

// ---------- Datas ----------

interface Dia {
  ano: number;
  mes: number;
  dia: number;
}

// "AAAA-MM-DD" para dia de calendário válido; null se não for.
function lerDia(texto: string): Dia | null {
  if (!REGEX_DIA.test(texto)) return null;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return { ano, mes, dia };
}

function diaOuErro(texto: string): Dia {
  const dia = lerDia(texto);
  if (!dia) throw new HttpError(400, 'Data inválida');
  return dia;
}

function paraTexto(d: Dia): string {
  return `${String(d.ano).padStart(4, '0')}-${String(d.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`;
}

// Dia de um instante, pelo fuso do servidor.
function textoDoInstante(data: Date): string {
  return paraTexto({ ano: data.getFullYear(), mes: data.getMonth() + 1, dia: data.getDate() });
}

function diaDeHoje(): Dia {
  const h = new Date();
  return { ano: h.getFullYear(), mes: h.getMonth() + 1, dia: h.getDate() };
}

function inicioDe(d: Dia): Date {
  return new Date(d.ano, d.mes - 1, d.dia, 0, 0, 0, 0);
}

function fimDe(d: Dia): Date {
  return new Date(d.ano, d.mes - 1, d.dia, 23, 59, 59, 999);
}

// Dia sem hora gravado em coluna DateTime: meio-dia, para não cair no dia anterior por fuso.
function meioDia(d: Dia): Date {
  return new Date(d.ano, d.mes - 1, d.dia, 12, 0, 0, 0);
}

function textoQuery(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

function contarDias(de: Dia, ate: Dia): number {
  return Math.round((Date.UTC(ate.ano, ate.mes - 1, ate.dia) - Date.UTC(de.ano, de.mes - 1, de.dia)) / DIA_MS) + 1;
}

// Período da consulta: `de` e `ate` incluídos. Sem eles, do dia 1 do mês atual até hoje.
function lerPeriodo(query: Record<string, unknown>): { de: Dia; ate: Dia } {
  const hoje = diaDeHoje();
  const textoDe = textoQuery(query.de);
  const textoAte = textoQuery(query.ate);
  const de = textoDe ? lerDia(textoDe) : { ...hoje, dia: 1 };
  const ate = textoAte ? lerDia(textoAte) : hoje;
  if (!de || !ate) throw new HttpError(400, 'Data inválida');
  const dias = contarDias(de, ate);
  if (dias < 1) throw new HttpError(400, 'A data final é anterior à inicial');
  if (dias > MAXIMO_DIAS) throw new HttpError(400, 'O período passa de 366 dias');
  return { de, ate };
}

function diasDoPeriodo(de: Dia, ate: Dia): string[] {
  const lista: string[] = [];
  const total = contarDias(de, ate);
  for (let i = 0; i < total; i++) {
    lista.push(textoDoInstante(new Date(de.ano, de.mes - 1, de.dia + i, 12)));
  }
  return lista;
}

// Dinheiro em centavos, para somar sem erro de ponto flutuante.
function centavos(valor: unknown): number {
  return Math.round(Number(valor) * 100);
}

function reais(c: number): number {
  return c / 100;
}

function ehTipo(valor: string | undefined): valor is Tipo {
  return valor !== undefined && (TIPOS as string[]).includes(valor);
}

// ---------- Categorias ----------

function paraCategoriaDTO(c: {
  id: number;
  nome: string;
  tipo: Tipo;
  cor: string;
  ativa: boolean;
  _count: { lancamentos: number };
}) {
  return {
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    cor: c.cor,
    ativa: c.ativa,
    lancamentos: c._count.lancamentos,
  };
}

const corSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida');

const categoriaSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(40, 'Nome muito longo'),
  tipo: z.enum(['DESPESA', 'RECEITA'], 'Tipo inválido'),
  cor: corSchema.optional(),
});

const categoriaEdicaoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(40, 'Nome muito longo').optional(),
  cor: corSchema.optional(),
  ativa: z.boolean().optional(),
});

router.get(
  '/financeiro/categorias',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const total = await prisma.categoriaFinanceira.count();
    if (total === 0) {
      await prisma.categoriaFinanceira.createMany({ data: CATEGORIAS_PADRAO, skipDuplicates: true });
    }
    const categorias = await prisma.categoriaFinanceira.findMany({
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
      include: { _count: { select: { lancamentos: true } } },
    });
    res.json(categorias.map(paraCategoriaDTO));
  })
);

router.post(
  '/financeiro/categorias',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(categoriaSchema, req.body);
    const existe = await prisma.categoriaFinanceira.findFirst({ where: { nome: dados.nome, tipo: dados.tipo } });
    if (existe) throw new HttpError(409, 'Já existe uma categoria com este nome');
    const criada = await prisma.categoriaFinanceira.create({
      data: { nome: dados.nome, tipo: dados.tipo, ...(dados.cor ? { cor: dados.cor } : {}) },
      include: { _count: { select: { lancamentos: true } } },
    });
    res.status(201).json(paraCategoriaDTO(criada));
  })
);

router.put(
  '/financeiro/categorias/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(categoriaEdicaoSchema, req.body);
    const atual = await prisma.categoriaFinanceira.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Categoria não encontrada');
    if (dados.nome !== undefined && dados.nome !== atual.nome) {
      const outra = await prisma.categoriaFinanceira.findFirst({
        where: { nome: dados.nome, tipo: atual.tipo, NOT: { id } },
      });
      if (outra) throw new HttpError(409, 'Já existe uma categoria com este nome');
    }
    const alterada = await prisma.categoriaFinanceira.update({
      where: { id },
      data: { nome: dados.nome, cor: dados.cor, ativa: dados.ativa },
      include: { _count: { select: { lancamentos: true } } },
    });
    res.json(paraCategoriaDTO(alterada));
  })
);

router.delete(
  '/financeiro/categorias/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.categoriaFinanceira.findUnique({
      where: { id },
      include: { _count: { select: { lancamentos: true } } },
    });
    if (!atual) throw new HttpError(404, 'Categoria não encontrada');
    if (atual._count.lancamentos > 0) {
      throw new HttpError(409, 'Esta categoria tem lançamentos. Desative-a em vez de excluir.');
    }
    await prisma.categoriaFinanceira.delete({ where: { id } });
    res.status(204).end();
  })
);

// ---------- Lançamentos ----------

const INCLUIR_LANCAMENTO = {
  categoria: { select: { id: true, nome: true, cor: true } },
  fornecedor: { select: { id: true, nome: true } },
} as const;

type LancamentoLido = Prisma.LancamentoGetPayload<{ include: typeof INCLUIR_LANCAMENTO }>;

function paraLancamentoDTO(l: LancamentoLido) {
  return {
    id: l.id,
    tipo: l.tipo,
    categoria: { id: l.categoria.id, nome: l.categoria.nome, cor: l.categoria.cor },
    descricao: l.descricao,
    valor: Number(l.valor),
    data: textoDoInstante(l.data),
    pago: l.pago,
    pagoEm: l.pagoEm ? l.pagoEm.toISOString() : null,
    vencimento: l.vencimento ? textoDoInstante(l.vencimento) : null,
    formaPagamento: l.formaPagamento,
    fornecedor: l.fornecedor ? { id: l.fornecedor.id, nome: l.fornecedor.nome } : null,
    compraId: l.compraId,
    observacao: l.observacao,
    criadoPorNome: l.criadoPorNome,
  };
}

const dataSchema = z.string().regex(REGEX_DIA, 'Data inválida');

const lancamentoSchema = z.object({
  tipo: z.enum(['DESPESA', 'RECEITA'], 'Tipo inválido'),
  categoriaId: z.number('Informe a categoria').int('Categoria inválida').positive('Categoria inválida'),
  descricao: z.string().trim().min(1, 'Informe a descrição').max(120, 'Descrição muito longa'),
  valor: z
    .number('Informe o valor')
    .positive('Valor deve ser maior que zero')
    .max(9999999.99, 'Valor muito alto')
    .refine((v) => Number(v.toFixed(2)) === v, 'Use no máximo 2 casas decimais'),
  data: dataSchema,
  pago: z.boolean(),
  vencimento: dataSchema.nullable().optional(),
  formaPagamento: z.string().trim().max(40, 'Forma de pagamento muito longa').nullable().optional(),
  fornecedorId: z.number().int().positive().nullable().optional(),
  observacao: z.string().trim().max(500, 'Observação muito longa').nullable().optional(),
});

async function conferirCategoria(categoriaId: number, tipo: Tipo): Promise<void> {
  const categoria = await prisma.categoriaFinanceira.findUnique({ where: { id: categoriaId } });
  if (!categoria) throw new HttpError(400, 'Categoria inválida');
  if (categoria.tipo !== tipo) throw new HttpError(400, 'Esta categoria não serve para este tipo de lançamento');
}

async function conferirFornecedor(fornecedorId: number | null | undefined): Promise<void> {
  if (fornecedorId === null || fornecedorId === undefined) return;
  const fornecedor = await prisma.fornecedor.findUnique({ where: { id: fornecedorId } });
  if (!fornecedor) throw new HttpError(400, 'Fornecedor inválido');
}

router.get(
  '/financeiro/lancamentos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const tipoTexto = textoQuery(query.tipo);
    if (tipoTexto !== undefined && !ehTipo(tipoTexto)) throw new HttpError(400, 'Tipo inválido');
    const situacao = textoQuery(query.situacao);
    if (situacao !== undefined && situacao !== 'PAGO' && situacao !== 'ABERTO') {
      throw new HttpError(400, 'Situação inválida');
    }
    const categoriaTexto = textoQuery(query.categoriaId);
    if (categoriaTexto !== undefined && !/^\d+$/.test(categoriaTexto)) throw new HttpError(400, 'Categoria inválida');

    const where: Prisma.LancamentoWhereInput = {};
    if (ehTipo(tipoTexto)) where.tipo = tipoTexto;
    if (categoriaTexto !== undefined) where.categoriaId = Number(categoriaTexto);
    if (situacao === 'ABERTO') {
      // Em aberto mostra tudo, sem olhar o período.
      where.pago = false;
    } else {
      const { de, ate } = lerPeriodo(query);
      where.data = { gte: inicioDe(de), lte: fimDe(ate) };
      if (situacao === 'PAGO') where.pago = true;
    }

    const lancamentos = await prisma.lancamento.findMany({
      where,
      include: INCLUIR_LANCAMENTO,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    res.json(lancamentos.map(paraLancamentoDTO));
  })
);

router.post(
  '/financeiro/lancamentos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(lancamentoSchema, req.body);
    await conferirCategoria(dados.categoriaId, dados.tipo);
    await conferirFornecedor(dados.fornecedorId);
    const data = diaOuErro(dados.data);
    const vencimento = dados.vencimento ? diaOuErro(dados.vencimento) : null;
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const criado = await prisma.lancamento.create({
      data: {
        tipo: dados.tipo,
        categoriaId: dados.categoriaId,
        descricao: dados.descricao,
        valor: dados.valor.toFixed(2),
        data: meioDia(data),
        pago: dados.pago,
        pagoEm: dados.pago ? new Date() : null,
        vencimento: vencimento ? meioDia(vencimento) : null,
        formaPagamento: dados.formaPagamento || null,
        fornecedorId: dados.fornecedorId ?? null,
        observacao: dados.observacao || null,
        criadoPorNome: usuario?.nome ?? null,
      },
      include: INCLUIR_LANCAMENTO,
    });
    res.status(201).json(paraLancamentoDTO(criado));
  })
);

router.put(
  '/financeiro/lancamentos/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(lancamentoSchema.partial(), req.body);
    const atual = await prisma.lancamento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Lançamento não encontrado');

    const tipo = dados.tipo ?? atual.tipo;
    const categoriaId = dados.categoriaId ?? atual.categoriaId;
    await conferirCategoria(categoriaId, tipo);
    await conferirFornecedor(dados.fornecedorId);

    const pago = dados.pago ?? atual.pago;
    // Mantém a hora do pagamento se já estava pago; marca agora se passou a pago; limpa se voltou a aberto.
    const pagoEm = !pago ? null : atual.pago && atual.pagoEm ? atual.pagoEm : new Date();

    const alterado = await prisma.lancamento.update({
      where: { id },
      data: {
        tipo,
        categoriaId,
        descricao: dados.descricao,
        valor: dados.valor === undefined ? undefined : dados.valor.toFixed(2),
        data: dados.data === undefined ? undefined : meioDia(diaOuErro(dados.data)),
        pago,
        pagoEm,
        vencimento:
          dados.vencimento === undefined ? undefined : dados.vencimento ? meioDia(diaOuErro(dados.vencimento)) : null,
        formaPagamento: dados.formaPagamento === undefined ? undefined : dados.formaPagamento || null,
        fornecedorId: dados.fornecedorId,
        observacao: dados.observacao === undefined ? undefined : dados.observacao || null,
      },
      include: INCLUIR_LANCAMENTO,
    });
    res.json(paraLancamentoDTO(alterado));
  })
);

router.post(
  '/financeiro/lancamentos/:id/pagar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.lancamento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Lançamento não encontrado');
    if (atual.pago) throw new HttpError(409, 'Este lançamento já está pago');
    const pago = await prisma.lancamento.update({
      where: { id },
      data: { pago: true, pagoEm: new Date() },
      include: INCLUIR_LANCAMENTO,
    });
    res.json(paraLancamentoDTO(pago));
  })
);

router.delete(
  '/financeiro/lancamentos/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.lancamento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Lançamento não encontrado');
    if (atual.compraId !== null) {
      throw new HttpError(400, 'Este lançamento veio de uma compra. Cancele pela tela de Compras.');
    }
    await prisma.lancamento.delete({ where: { id } });
    res.status(204).end();
  })
);

router.get(
  '/financeiro/fornecedores',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const fornecedores = await prisma.fornecedor.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    res.json(fornecedores);
  })
);

// ---------- Resumo ----------

router.get(
  '/financeiro/resumo',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { de, ate } = lerPeriodo(req.query as Record<string, unknown>);
    const inicio = inicioDe(de);
    const fim = fimDe(ate);
    const hoje = inicioDe(diaDeHoje());

    const [pagamentos, pagos, aPagarLista] = await Promise.all([
      prisma.pagamento.findMany({
        where: { status: 'APROVADO', concluidoEm: { gte: inicio, lte: fim } },
        select: { valor: true, gorjeta: true, valorServico: true, formaPagamento: true, concluidoEm: true },
      }),
      prisma.lancamento.findMany({
        where: { pago: true, data: { gte: inicio, lte: fim } },
        select: {
          tipo: true,
          valor: true,
          data: true,
          categoria: { select: { id: true, nome: true, cor: true } },
        },
      }),
      prisma.lancamento.findMany({
        where: { tipo: 'DESPESA', pago: false },
        select: { valor: true, vencimento: true },
      }),
    ]);

    let vendas = 0;
    let taxaServico = 0;
    let gorjetas = 0;
    const porForma = new Map<string, number>();
    const receitasDia = new Map<string, number>();
    const despesasDia = new Map<string, number>();

    for (const p of pagamentos) {
      const valor = centavos(p.valor);
      vendas += valor;
      taxaServico += centavos(p.valorServico);
      gorjetas += centavos(p.gorjeta);
      porForma.set(p.formaPagamento, (porForma.get(p.formaPagamento) ?? 0) + valor);
      if (p.concluidoEm) {
        const dia = textoDoInstante(p.concluidoEm);
        receitasDia.set(dia, (receitasDia.get(dia) ?? 0) + valor);
      }
    }

    let outrasReceitas = 0;
    let despesas = 0;
    const despesasCategoria = new Map<number, { nome: string; cor: string; valor: number }>();
    for (const l of pagos) {
      const valor = centavos(l.valor);
      const dia = textoDoInstante(l.data);
      if (l.tipo === 'RECEITA') {
        outrasReceitas += valor;
        receitasDia.set(dia, (receitasDia.get(dia) ?? 0) + valor);
      } else {
        despesas += valor;
        despesasDia.set(dia, (despesasDia.get(dia) ?? 0) + valor);
        const atual = despesasCategoria.get(l.categoria.id) ?? { nome: l.categoria.nome, cor: l.categoria.cor, valor: 0 };
        atual.valor += valor;
        despesasCategoria.set(l.categoria.id, atual);
      }
    }

    let aPagar = 0;
    let aPagarVencidas = 0;
    for (const a of aPagarLista) {
      aPagar += centavos(a.valor);
      if (a.vencimento && a.vencimento.getTime() < hoje.getTime()) aPagarVencidas++;
    }

    res.json({
      de: paraTexto(de),
      ate: paraTexto(ate),
      vendas: reais(vendas),
      taxaServico: reais(taxaServico),
      gorjetas: reais(gorjetas),
      outrasReceitas: reais(outrasReceitas),
      despesas: reais(despesas),
      resultado: reais(vendas + outrasReceitas - despesas),
      aPagar: reais(aPagar),
      aPagarVencidas,
      porDia: diasDoPeriodo(de, ate).map((dia) => ({
        dia,
        receitas: reais(receitasDia.get(dia) ?? 0),
        despesas: reais(despesasDia.get(dia) ?? 0),
      })),
      despesasPorCategoria: Array.from(despesasCategoria.values())
        .sort((a, b) => b.valor - a.valor)
        .map((c) => ({ categoria: c.nome, cor: c.cor, valor: reais(c.valor) })),
      receitasPorForma: Array.from(porForma.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([forma, valor]) => ({ forma, valor: reais(valor) })),
    });
  })
);

export default router;
