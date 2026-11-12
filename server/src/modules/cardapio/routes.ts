import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { validarImagem } from '../../lib/imagem';
import { dadosDaFicha, fichaCampos, fichaDoProduto } from '../../lib/produtos';

// Cardápio: categorias e produtos. O gestor cadastra; o garçom consulta e marca o que esgotou.

const router = Router();

type ProdutoComCategoria = Prisma.ProdutoGetPayload<{
  include: { categoria: { select: { id: true; nome: true } } };
}>;

function paraProdutoDTO(p: ProdutoComCategoria) {
  return {
    id: p.id,
    categoriaId: p.categoriaId,
    categoria: p.categoria,
    nome: p.nome,
    descricao: p.descricao,
    preco: Number(p.preco),
    imagem: p.imagem,
    disponivel: p.disponivel,
    recomendado: p.recomendado,
    controlaEstoque: p.controlaEstoque,
    estoque: p.estoque,
    estoqueMinimo: p.estoqueMinimo,
    ncm: p.ncm,
    cfop: p.cfop,
    ...fichaDoProduto(p),
  };
}

const incluirCategoria = { categoria: { select: { id: true, nome: true } } } as const;

// ---------- Categorias ----------

const categoriaSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(60, 'Nome muito longo'),
  ordem: z.number().int().min(0).max(999).optional(),
  ativa: z.boolean().optional(),
});

router.get(
  '/categorias',
  asyncHandler(async (_req, res) => {
    const categorias = await prisma.categoria.findMany({
      where: { excluida: false },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: { _count: { select: { produtos: { where: { ativo: true } } } } },
    });
    res.json(
      categorias.map((c) => ({
        id: c.id,
        nome: c.nome,
        ordem: c.ordem,
        ativa: c.ativa,
        produtos: c._count.produtos,
      }))
    );
  })
);

router.post(
  '/categorias',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(categoriaSchema, req.body);
    const categoria = await prisma.categoria.create({
      data: { nome: dados.nome, ordem: dados.ordem ?? 0, ativa: dados.ativa ?? true },
    });
    res.status(201).json({ ...categoria, produtos: 0 });
  })
);

router.put(
  '/categorias/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(categoriaSchema.partial(), req.body);
    const categoria = await prisma.categoria.update({
      where: { id },
      data: { nome: dados.nome, ordem: dados.ordem, ativa: dados.ativa },
    });
    res.json(categoria);
  })
);

router.delete(
  '/categorias/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const produtos = await prisma.produto.count({ where: { categoriaId: id, ativo: true } });
    if (produtos > 0) {
      throw new HttpError(400, 'Esta categoria ainda tem produtos. Mova ou exclua os produtos antes.');
    }
    // Produtos já excluídos (inativos) ficam no histórico dos pedidos: a categoria só é desativada.
    const antigos = await prisma.produto.count({ where: { categoriaId: id } });
    if (antigos > 0) {
      const sufixo = ` (excluída ${Date.now().toString(36)})`;
      const atual = await prisma.categoria.findUnique({ where: { id }, select: { nome: true } });
      if (!atual) {
        throw new HttpError(404, 'Categoria não encontrada');
      }
      await prisma.categoria.update({
        where: { id },
        data: { ativa: false, excluida: true, nome: atual.nome.slice(0, 40) + sufixo },
      });
    } else {
      await prisma.categoria.delete({ where: { id } });
    }
    res.status(204).end();
  })
);

// ---------- Produtos ----------

const produtoCampos = {
  categoriaId: z.number().int().positive(),
  nome: z.string().trim().min(1, 'Nome obrigatório').max(80, 'Nome muito longo'),
  descricao: z.string().trim().max(400, 'Descrição muito longa').optional(),
  preco: z.number().min(0, 'Preço inválido').max(99999, 'Preço inválido'),
  imagem: z.string().nullable().optional(),
  disponivel: z.boolean().optional(),
  recomendado: z.boolean().optional(),
  // Estoque: o saldo muda só pelos movimentos (tela de Estoque); aqui se liga o controle e o mínimo.
  controlaEstoque: z.boolean().optional(),
  estoqueMinimo: z.number().int().min(0, 'Mínimo inválido').max(100000, 'Mínimo inválido').optional(),
  // Dados fiscais do item. Vazio usa o padrão das configurações fiscais.
  ncm: z.string().trim().regex(/^(\d{8})?$/, 'O NCM deve ter 8 dígitos').nullable().optional(),
  cfop: z.string().trim().regex(/^(\d{4})?$/, 'O CFOP deve ter 4 dígitos').nullable().optional(),
  ...fichaCampos,
};
const produtoCriarSchema = z.object(produtoCampos);
const produtoAtualizarSchema = z.object(produtoCampos).partial();

async function garantirCategoria(id: number): Promise<void> {
  const categoria = await prisma.categoria.findFirst({ where: { id, excluida: false }, select: { id: true } });
  if (!categoria) {
    throw new HttpError(400, 'Categoria não encontrada');
  }
}

router.get(
  '/produtos',
  asyncHandler(async (req, res) => {
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
    const categoriaId = Number(req.query.categoriaId);
    const produtos = await prisma.produto.findMany({
      where: {
        ativo: true,
        ...(Number.isInteger(categoriaId) && categoriaId > 0 ? { categoriaId } : {}),
        ...(busca ? { nome: { contains: busca, mode: 'insensitive' } } : {}),
      },
      include: incluirCategoria,
      orderBy: [{ categoria: { ordem: 'asc' } }, { categoria: { nome: 'asc' } }, { nome: 'asc' }],
    });
    res.json(produtos.map(paraProdutoDTO));
  })
);

router.post(
  '/produtos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(produtoCriarSchema, req.body);
    await garantirCategoria(dados.categoriaId);
    const produto = await prisma.produto.create({
      data: {
        categoriaId: dados.categoriaId,
        nome: dados.nome,
        descricao: dados.descricao ?? '',
        preco: dados.preco.toFixed(2),
        imagem: validarImagem(dados.imagem, { aceitaEndereco: true }),
        disponivel: dados.disponivel ?? true,
        recomendado: dados.recomendado ?? false,
        controlaEstoque: dados.controlaEstoque ?? false,
        estoqueMinimo: dados.estoqueMinimo ?? 0,
        ncm: dados.ncm || null,
        cfop: dados.cfop || null,
        // Com controle de estoque, o produto nasce zerado e esgotado até a primeira entrada.
        ...(dados.controlaEstoque ? { disponivel: false } : {}),
        ...dadosDaFicha(dados),
        detalhes: dados.detalhes ?? '',
        ingredientes: dados.ingredientes ?? '',
      },
      include: incluirCategoria,
    });
    res.status(201).json(paraProdutoDTO(produto));
  })
);

router.put(
  '/produtos/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(produtoAtualizarSchema, req.body);
    if (dados.categoriaId !== undefined) {
      await garantirCategoria(dados.categoriaId);
    }
    const existente = await prisma.produto.findFirst({ where: { id, ativo: true }, select: { id: true } });
    if (!existente) {
      throw new HttpError(404, 'Produto não encontrado');
    }
    const produto = await prisma.produto.update({
      where: { id },
      data: {
        categoriaId: dados.categoriaId,
        nome: dados.nome,
        descricao: dados.descricao,
        preco: dados.preco === undefined ? undefined : dados.preco.toFixed(2),
        imagem:
          dados.imagem === undefined ? undefined : validarImagem(dados.imagem, { aceitaEndereco: true }),
        disponivel: dados.disponivel,
        recomendado: dados.recomendado,
        controlaEstoque: dados.controlaEstoque,
        estoqueMinimo: dados.estoqueMinimo,
        ncm: dados.ncm === undefined ? undefined : dados.ncm || null,
        cfop: dados.cfop === undefined ? undefined : dados.cfop || null,
        ...dadosDaFicha(dados),
      },
      include: incluirCategoria,
    });
    res.json(paraProdutoDTO(produto));
  })
);

// Marca o produto como disponível ou esgotado. O garçom também pode.
router.put(
  '/produtos/:id/disponivel',
  permitir('GESTOR', 'GARCOM', 'COZINHA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { disponivel } = validar(z.object({ disponivel: z.boolean() }), req.body);
    const existente = await prisma.produto.findFirst({
      where: { id, ativo: true },
      select: { id: true, controlaEstoque: true, estoque: true },
    });
    if (!existente) {
      throw new HttpError(404, 'Produto não encontrado');
    }
    if (disponivel && existente.controlaEstoque && existente.estoque === 0) {
      throw new HttpError(400, 'Este item está com o estoque zerado. Lance uma entrada no estoque para ele voltar.');
    }
    const produto = await prisma.produto.update({
      where: { id },
      data: { disponivel },
      include: incluirCategoria,
    });
    res.json(paraProdutoDTO(produto));
  })
);

// Excluir tira o produto do cardápio; os pedidos antigos continuam com o nome e o preço copiados.
router.delete(
  '/produtos/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const usos = await prisma.itemPedido.count({ where: { produtoId: id } });
    if (usos > 0) {
      await prisma.produto.update({ where: { id }, data: { ativo: false, disponivel: false } });
    } else {
      await prisma.produto.delete({ where: { id } });
    }
    res.status(204).end();
  })
);

export default router;
