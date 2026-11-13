import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { entradaPorCompra } from '../../lib/estoque';
import { entradaDeInsumo } from '../../lib/insumos';

// Fornecedores e compras. O gestor monta o pedido de compra; ao receber a mercadoria, o estoque
// dos produtos e insumos sobe e a despesa entra no financeiro. A tela "O que comprar" sugere o que
// está abaixo do mínimo.

const router = Router();

const STATUS_COMPRA = ['PEDIDA', 'RECEBIDA', 'CANCELADA'] as const;

const incluirCompra = Prisma.validator<Prisma.CompraInclude>()({
  fornecedor: { select: { id: true, nome: true } },
  itens: { orderBy: { id: 'asc' }, include: { insumo: { select: { unidade: true } } } },
  lancamento: { select: { id: true } },
});

type CompraCompleta = Prisma.CompraGetPayload<{ include: typeof incluirCompra }>;

// Centavos inteiros para não acumular erro de ponto flutuante.
function centavos(valor: number): number {
  return Math.round(valor * 100);
}

function paraDTO(compra: CompraCompleta) {
  let totalCentavos = 0;
  const itens = compra.itens.map((i) => {
    const subtotalCentavos = centavos(Number(i.quantidade) * Number(i.custoUnitario));
    totalCentavos += subtotalCentavos;
    const tipo = i.produtoId !== null ? 'PRODUTO' : i.insumoId !== null ? 'INSUMO' : 'OUTRO';
    return {
      id: i.id,
      tipo,
      produtoId: i.produtoId,
      insumoId: i.insumoId,
      descricao: i.descricao,
      unidade: i.insumo ? i.insumo.unidade.toLowerCase() : 'un',
      quantidade: Number(i.quantidade),
      custoUnitario: Number(i.custoUnitario),
      subtotal: subtotalCentavos / 100,
    };
  });
  return {
    id: compra.id,
    fornecedor: compra.fornecedor,
    status: compra.status,
    observacao: compra.observacao,
    total: totalCentavos / 100,
    pedidaEm: compra.pedidaEm.toISOString(),
    recebidaEm: compra.recebidaEm ? compra.recebidaEm.toISOString() : null,
    criadaPorNome: compra.criadaPorNome,
    lancamentoId: compra.lancamento?.id ?? null,
    itens,
  };
}

async function nomeDoUsuario(usuarioId: number): Promise<string | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } });
  return usuario?.nome ?? null;
}

function mensagemDeStatus(status: string, acao: 'alterar' | 'receber'): string {
  if (status === 'RECEBIDA') {
    return acao === 'receber' ? 'Esta compra já foi recebida.' : 'Compra já recebida não pode ser alterada.';
  }
  return acao === 'receber' ? 'Compra cancelada não pode ser recebida.' : 'Compra cancelada não pode ser alterada.';
}

// Texto opcional: vazio vira null.
function textoOpcional(max: number) {
  return z
    .string()
    .trim()
    .max(max, 'Texto muito longo')
    .nullish()
    .transform((v) => (v && v.trim() !== '' ? v.trim() : null));
}

const DATA_DIA = /^\d{4}-\d{2}-\d{2}$/;

// Dia AAAA-MM-DD gravado ao meio-dia no fuso do servidor.
function diaAoMeioDia(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number);
  return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
}

function hojeAoMeioDia(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12, 0, 0, 0);
}

// ---------- Fornecedores ----------

const fornecedorSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(80, 'Nome muito longo'),
  cnpjCpf: textoOpcional(20),
  telefone: textoOpcional(30),
  email: textoOpcional(120),
  contato: textoOpcional(80),
  observacao: textoOpcional(500),
});

const fornecedorAtualizarSchema = fornecedorSchema.extend({ ativo: z.boolean() });

async function fornecedorComTotais(id: number) {
  const fornecedor = await prisma.fornecedor.findUniqueOrThrow({ where: { id } });
  const compras = await prisma.compra.count({ where: { fornecedorId: id } });
  const recebidas = await prisma.compra.aggregate({
    where: { fornecedorId: id, status: 'RECEBIDA' },
    _sum: { total: true },
  });
  return {
    id: fornecedor.id,
    nome: fornecedor.nome,
    cnpjCpf: fornecedor.cnpjCpf,
    telefone: fornecedor.telefone,
    email: fornecedor.email,
    contato: fornecedor.contato,
    observacao: fornecedor.observacao,
    ativo: fornecedor.ativo,
    compras,
    totalComprado: centavos(Number(recebidas._sum.total ?? 0)) / 100,
  };
}

router.get(
  '/fornecedores',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const todos = req.query.todos === '1';
    const lista = await prisma.fornecedor.findMany({
      where: todos ? {} : { ativo: true },
      orderBy: { nome: 'asc' },
      include: { _count: { select: { compras: true } } },
    });
    const recebidas = await prisma.compra.groupBy({
      by: ['fornecedorId'],
      where: { status: 'RECEBIDA' },
      _sum: { total: true },
    });
    const somas = new Map(recebidas.map((r) => [r.fornecedorId, Number(r._sum.total ?? 0)]));
    res.json(
      lista.map((f) => ({
        id: f.id,
        nome: f.nome,
        cnpjCpf: f.cnpjCpf,
        telefone: f.telefone,
        email: f.email,
        contato: f.contato,
        observacao: f.observacao,
        ativo: f.ativo,
        compras: f._count.compras,
        totalComprado: centavos(somas.get(f.id) ?? 0) / 100,
      }))
    );
  })
);

router.post(
  '/fornecedores',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(fornecedorSchema, req.body);
    const criado = await prisma.fornecedor.create({ data: dados });
    res.status(201).json(await fornecedorComTotais(criado.id));
  })
);

router.put(
  '/fornecedores/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(fornecedorAtualizarSchema, req.body);
    const existe = await prisma.fornecedor.findUnique({ where: { id }, select: { id: true } });
    if (!existe) {
      throw new HttpError(404, 'Fornecedor não encontrado');
    }
    await prisma.fornecedor.update({ where: { id }, data: dados });
    res.json(await fornecedorComTotais(id));
  })
);

router.delete(
  '/fornecedores/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existe = await prisma.fornecedor.findUnique({ where: { id }, select: { id: true } });
    if (!existe) {
      throw new HttpError(404, 'Fornecedor não encontrado');
    }
    const compras = await prisma.compra.count({ where: { fornecedorId: id } });
    const lancamentos = await prisma.lancamento.count({ where: { fornecedorId: id } });
    // Com histórico, não apaga: só desativa, para as compras e despesas continuarem ligadas ao nome.
    if (compras > 0 || lancamentos > 0) {
      await prisma.fornecedor.update({ where: { id }, data: { ativo: false } });
      res.json({ desativado: true });
      return;
    }
    await prisma.fornecedor.delete({ where: { id } });
    res.json({ desativado: false });
  })
);

// ---------- Itens de compra ----------

const itemSchema = z.object({
  produtoId: z.number().int().positive().nullish(),
  insumoId: z.number().int().positive().nullish(),
  descricao: z.string().trim().max(120, 'Descrição muito longa').nullish(),
  quantidade: z.number().positive('Quantidade inválida').max(1000000, 'Quantidade inválida'),
  custoUnitario: z.number().min(0, 'Custo inválido').max(1000000, 'Custo inválido'),
});

const compraSchema = z.object({
  fornecedorId: z.number().int().positive(),
  observacao: textoOpcional(500),
  itens: z.array(itemSchema).min(1, 'Inclua pelo menos um item').max(100, 'Itens demais na compra'),
});

interface LinhaItem {
  produtoId: number | null;
  insumoId: number | null;
  descricao: string;
  quantidade: number;
  custoUnitario: number;
}

// Confere cada item (referências, quantidade e custo) e monta as linhas que vão para o banco.
async function prepararItens(itens: z.infer<typeof itemSchema>[]): Promise<{ linhas: LinhaItem[]; total: number }> {
  const linhas: LinhaItem[] = [];
  for (const item of itens) {
    const produtoId = item.produtoId ?? null;
    const insumoId = item.insumoId ?? null;
    const texto = (item.descricao ?? '').trim();
    const usados = [produtoId !== null, insumoId !== null, texto !== ''].filter(Boolean).length;
    if (usados === 0) {
      throw new HttpError(400, 'Informe o produto, o insumo ou a descrição do item');
    }
    if (usados > 1) {
      throw new HttpError(400, 'Cada item leva só um produto, um insumo ou uma descrição');
    }

    const quantidade = Number(item.quantidade.toFixed(3));
    const custoUnitario = Number(item.custoUnitario.toFixed(4));
    if (quantidade <= 0) {
      throw new HttpError(400, 'Quantidade inválida');
    }

    let descricao = texto;
    if (produtoId !== null) {
      const produto = await prisma.produto.findUnique({
        where: { id: produtoId },
        select: { nome: true, ativo: true, controlaEstoque: true },
      });
      if (!produto || !produto.ativo) {
        throw new HttpError(400, 'Produto não encontrado');
      }
      if (!produto.controlaEstoque) {
        throw new HttpError(400, `"${produto.nome}" não tem controle de estoque`);
      }
      if (!Number.isInteger(quantidade)) {
        throw new HttpError(400, `Quantidade de "${produto.nome}" deve ser inteira`);
      }
      descricao = produto.nome;
    } else if (insumoId !== null) {
      const insumo = await prisma.insumo.findUnique({ where: { id: insumoId }, select: { nome: true, ativo: true } });
      if (!insumo || !insumo.ativo) {
        throw new HttpError(400, 'Insumo não encontrado');
      }
      descricao = insumo.nome;
    }

    linhas.push({ produtoId, insumoId, descricao, quantidade, custoUnitario });
  }
  const total = linhas.reduce((soma, l) => soma + centavos(l.quantidade * l.custoUnitario), 0) / 100;
  return { linhas, total };
}

// Valores do item como o banco guarda (Decimal, com as casas do schema).
function valoresDoItem(l: LinhaItem) {
  return {
    produtoId: l.produtoId,
    insumoId: l.insumoId,
    descricao: l.descricao,
    quantidade: l.quantidade.toFixed(3),
    custoUnitario: l.custoUnitario.toFixed(4),
  };
}

// ---------- Compras ----------

router.get(
  '/compras/itens-disponiveis',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const produtos = await prisma.produto.findMany({
      where: { ativo: true, controlaEstoque: true },
      select: { id: true, nome: true, estoque: true, estoqueMinimo: true },
      orderBy: { nome: 'asc' },
    });
    const insumos = await prisma.insumo.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, unidade: true, estoque: true, estoqueMinimo: true, custoUnitario: true },
      orderBy: { nome: 'asc' },
    });
    res.json({
      produtos,
      insumos: insumos.map((i) => ({
        id: i.id,
        nome: i.nome,
        unidade: i.unidade.toLowerCase(),
        estoque: Number(i.estoque),
        estoqueMinimo: Number(i.estoqueMinimo),
        custoUnitario: Number(i.custoUnitario),
      })),
    });
  })
);

// Último custo pago de cada item (compra RECEBIDA mais recente). Devolve um mapa por id.
async function ultimosCustos(campo: 'produtoId' | 'insumoId', ids: number[]): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  if (ids.length === 0) return mapa;
  const filtro: Prisma.CompraItemWhereInput =
    campo === 'produtoId' ? { produtoId: { in: ids } } : { insumoId: { in: ids } };
  const registros = await prisma.compraItem.findMany({
    where: { ...filtro, compra: { status: 'RECEBIDA' } },
    select: { produtoId: true, insumoId: true, custoUnitario: true },
    orderBy: [{ compra: { recebidaEm: 'desc' } }, { id: 'desc' }],
  });
  for (const r of registros) {
    const id = campo === 'produtoId' ? r.produtoId : r.insumoId;
    if (id !== null && !mapa.has(id)) mapa.set(id, Number(r.custoUnitario));
  }
  return mapa;
}

router.get(
  '/compras/sugestao',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const produtos = (
      await prisma.produto.findMany({
        where: { ativo: true, controlaEstoque: true },
        select: { id: true, nome: true, estoque: true, estoqueMinimo: true },
        orderBy: { nome: 'asc' },
      })
    ).filter((p) => p.estoque <= p.estoqueMinimo);

    const insumos = (
      await prisma.insumo.findMany({
        where: { ativo: true, estoqueMinimo: { gt: 0 } },
        select: { id: true, nome: true, unidade: true, estoque: true, estoqueMinimo: true, custoUnitario: true },
        orderBy: { nome: 'asc' },
      })
    ).filter((i) => Number(i.estoque) <= Number(i.estoqueMinimo));

    const custosProdutos = await ultimosCustos(
      'produtoId',
      produtos.map((p) => p.id)
    );
    const custosInsumos = await ultimosCustos(
      'insumoId',
      insumos.map((i) => i.id)
    );

    const sugestaoProdutos = produtos.map((p) => ({
      tipo: 'PRODUTO' as const,
      id: p.id,
      nome: p.nome,
      unidade: 'un',
      estoque: p.estoque,
      minimo: p.estoqueMinimo,
      sugerido: Math.max(p.estoqueMinimo * 2 - p.estoque, 1),
      ultimoCusto: custosProdutos.get(p.id) ?? null,
    }));

    const sugestaoInsumos = insumos.map((i) => {
      const estoque = Number(i.estoque);
      const minimo = Number(i.estoqueMinimo);
      return {
        tipo: 'INSUMO' as const,
        id: i.id,
        nome: i.nome,
        unidade: i.unidade.toLowerCase(),
        estoque: Number(estoque.toFixed(3)),
        minimo: Number(minimo.toFixed(3)),
        sugerido: Number(Math.max(minimo * 2 - estoque, 1).toFixed(3)),
        ultimoCusto: custosInsumos.get(i.id) ?? Number(i.custoUnitario),
      };
    });

    res.json([...sugestaoProdutos, ...sugestaoInsumos]);
  })
);

router.get(
  '/compras',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const status = req.query.status;
    let filtro: Prisma.CompraWhereInput = {};
    if (status !== undefined && status !== '') {
      if (typeof status !== 'string' || !(STATUS_COMPRA as readonly string[]).includes(status)) {
        throw new HttpError(400, 'Status inválido');
      }
      filtro = { status: status as (typeof STATUS_COMPRA)[number] };
    }
    const compras = await prisma.compra.findMany({
      where: filtro,
      include: incluirCompra,
      orderBy: [{ pedidaEm: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    res.json(compras.map(paraDTO));
  })
);

router.post(
  '/compras',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(compraSchema, req.body);
    const fornecedor = await prisma.fornecedor.findUnique({
      where: { id: dados.fornecedorId },
      select: { ativo: true },
    });
    if (!fornecedor || !fornecedor.ativo) {
      throw new HttpError(400, 'Fornecedor não encontrado ou inativo');
    }
    const { linhas, total } = await prepararItens(dados.itens);
    const criadaPorNome = await nomeDoUsuario(req.usuario.id);
    const compra = await prisma.compra.create({
      data: {
        fornecedorId: dados.fornecedorId,
        observacao: dados.observacao,
        total: total.toFixed(2),
        criadaPorNome,
        itens: { create: linhas.map(valoresDoItem) },
      },
      include: incluirCompra,
    });
    res.status(201).json(paraDTO(compra));
  })
);

router.put(
  '/compras/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(compraSchema, req.body);
    const atual = await prisma.compra.findUnique({ where: { id }, select: { status: true } });
    if (!atual) {
      throw new HttpError(404, 'Compra não encontrada');
    }
    if (atual.status !== 'PEDIDA') {
      throw new HttpError(409, mensagemDeStatus(atual.status, 'alterar'));
    }
    const fornecedor = await prisma.fornecedor.findUnique({
      where: { id: dados.fornecedorId },
      select: { ativo: true },
    });
    if (!fornecedor || !fornecedor.ativo) {
      throw new HttpError(400, 'Fornecedor não encontrado ou inativo');
    }
    const { linhas, total } = await prepararItens(dados.itens);

    const atualizada = await prisma.$transaction(async (tx) => {
      // A condição de status evita alterar uma compra que acabou de ser recebida ou cancelada.
      const marcada = await tx.compra.updateMany({
        where: { id, status: 'PEDIDA' },
        data: { fornecedorId: dados.fornecedorId, observacao: dados.observacao, total: total.toFixed(2) },
      });
      if (marcada.count === 0) {
        throw new HttpError(409, 'Compra já recebida ou cancelada não pode ser alterada.');
      }
      await tx.compraItem.deleteMany({ where: { compraId: id } });
      await tx.compraItem.createMany({ data: linhas.map((l) => ({ compraId: id, ...valoresDoItem(l) })) });
      return tx.compra.findUniqueOrThrow({ where: { id }, include: incluirCompra });
    });
    res.json(paraDTO(atualizada));
  })
);

router.post(
  '/compras/:id/receber',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(
      z.object({
        pago: z.boolean(),
        vencimento: z.string().regex(DATA_DIA, 'Data inválida').nullish(),
        formaPagamento: textoOpcional(40),
      }),
      req.body
    );
    const usuarioNome = await nomeDoUsuario(req.usuario.id);
    const agora = new Date();
    const vencimento = dados.vencimento ? diaAoMeioDia(dados.vencimento) : null;

    const recebida = await prisma.$transaction(async (tx) => {
      // Primeiro a troca de status: se outra requisição já recebeu ou cancelou, esta para aqui (409).
      const marcada = await tx.compra.updateMany({
        where: { id, status: 'PEDIDA' },
        data: { status: 'RECEBIDA', recebidaEm: agora },
      });
      if (marcada.count === 0) {
        const atual = await tx.compra.findUnique({ where: { id }, select: { status: true } });
        if (!atual) {
          throw new HttpError(404, 'Compra não encontrada');
        }
        throw new HttpError(409, mensagemDeStatus(atual.status, 'receber'));
      }

      const compra = await tx.compra.findUniqueOrThrow({ where: { id }, include: incluirCompra });
      const motivo = `Compra #${id}`;
      for (const item of compra.itens) {
        if (item.produtoId !== null) {
          await entradaPorCompra(tx, item.produtoId, Number(item.quantidade), motivo, usuarioNome);
        } else if (item.insumoId !== null) {
          await entradaDeInsumo(tx, {
            insumoId: item.insumoId,
            quantidade: Number(item.quantidade),
            custoUnitario: Number(item.custoUnitario),
            motivo,
            usuarioNome,
          });
        }
      }

      const categoria = await tx.categoriaFinanceira.upsert({
        where: { nome_tipo: { nome: 'Fornecedores', tipo: 'DESPESA' } },
        create: { nome: 'Fornecedores', tipo: 'DESPESA' },
        update: {},
        select: { id: true },
      });
      await tx.lancamento.create({
        data: {
          tipo: 'DESPESA',
          categoriaId: categoria.id,
          descricao: `Compra #${id} - ${compra.fornecedor.nome}`,
          valor: compra.total,
          data: hojeAoMeioDia(),
          pago: dados.pago,
          pagoEm: dados.pago ? agora : null,
          vencimento,
          formaPagamento: dados.formaPagamento,
          fornecedorId: compra.fornecedorId,
          compraId: id,
          criadoPorNome: usuarioNome,
        },
      });

      return tx.compra.findUniqueOrThrow({ where: { id }, include: incluirCompra });
    });
    res.json(paraDTO(recebida));
  })
);

router.post(
  '/compras/:id/cancelar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const marcada = await prisma.compra.updateMany({
      where: { id, status: 'PEDIDA' },
      data: { status: 'CANCELADA' },
    });
    if (marcada.count === 0) {
      const atual = await prisma.compra.findUnique({ where: { id }, select: { status: true } });
      if (!atual) {
        throw new HttpError(404, 'Compra não encontrada');
      }
      if (atual.status === 'RECEBIDA') {
        throw new HttpError(
          409,
          'Compra já recebida não pode ser cancelada. Faça o acerto pelo estoque e pelo financeiro.'
        );
      }
      throw new HttpError(409, 'Compra já cancelada');
    }
    const compra = await prisma.compra.findUniqueOrThrow({ where: { id }, include: incluirCompra });
    res.json(paraDTO(compra));
  })
);

export default router;
