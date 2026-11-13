import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type Promocao } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { validarImagem } from '../../lib/imagem';
import {
  dadosDaFicha,
  fichaCampos,
  fichaDoProduto,
  limparTraducoes,
  traducoesProdutoSchema,
} from '../../lib/produtos';
import { precoAgora, promocoesValendo } from '../../lib/precos';
import { limparCacheConfiguracao, lerConfiguracao } from '../../lib/email';

// Cardápio: categorias, produtos (com opções, combos, promoção e traduções) e idiomas. O gestor cadastra; o garçom consulta e marca o que esgotou.

const router = Router();

const incluirProduto = {
  categoria: { select: { id: true, nome: true } },
  grupos: {
    include: { opcoes: { orderBy: { ordem: 'asc' } } },
    orderBy: { ordem: 'asc' },
  },
  comboItens: {
    include: { produto: { select: { nome: true } } },
    orderBy: { id: 'asc' },
  },
} as const;

type ProdutoCompleto = Prisma.ProdutoGetPayload<{ include: typeof incluirProduto }>;

// Monta o produto no formato da API. As promoções são lidas uma vez por quem chama.
function paraProdutoDTO(p: ProdutoCompleto, promocoes: Promocao[]) {
  const valendo = precoAgora(p, promocoes);
  return {
    id: p.id,
    categoriaId: p.categoriaId,
    categoria: p.categoria,
    nome: p.nome,
    descricao: p.descricao,
    preco: Number(p.preco),
    precoAtual: valendo.preco,
    promocao: valendo.promocao,
    imagem: p.imagem,
    disponivel: p.disponivel,
    recomendado: p.recomendado,
    controlaEstoque: p.controlaEstoque,
    estoque: p.estoque,
    estoqueMinimo: p.estoqueMinimo,
    ncm: p.ncm,
    cfop: p.cfop,
    combo: p.combo,
    comboItens: p.comboItens.map((i) => ({
      produtoId: i.produtoId,
      nome: i.produto.nome,
      quantidade: i.quantidade,
    })),
    grupos: p.grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      minimo: g.minimo,
      maximo: g.maximo,
      opcoes: g.opcoes.map((o) => ({
        id: o.id,
        nome: o.nome,
        precoExtra: Number(o.precoExtra),
        ativa: o.ativa,
      })),
    })),
    traducoes: limparTraducoes(p.traducoes),
    ...fichaDoProduto(p),
  };
}

// Resposta de uma única escrita: lê as promoções que valem agora.
async function produtoDaResposta(p: ProdutoCompleto) {
  return paraProdutoDTO(p, await promocoesValendo());
}

// ---------- Categorias ----------

const traducoesCategoriaSchema = z
  .object({
    en: z.object({ nome: z.string().trim().max(60, 'Nome muito longo').nullable().optional() }).nullable().optional(),
    es: z.object({ nome: z.string().trim().max(60, 'Nome muito longo').nullable().optional() }).nullable().optional(),
  })
  .nullable()
  .optional();

type TraducoesCategoria = { en?: { nome: string }; es?: { nome: string } };

// Só en e es, só o nome, sem espaços nas pontas e sem texto vazio. Nada sobrando = null.
function limparTraducoesCategoria(valor: unknown): TraducoesCategoria | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const origem = valor as Record<string, unknown>;
  const saida: TraducoesCategoria = {};
  for (const idioma of ['en', 'es'] as const) {
    const bruto = origem[idioma];
    const nome = typeof bruto === 'object' && bruto !== null ? (bruto as Record<string, unknown>).nome : undefined;
    if (typeof nome === 'string' && nome.trim() !== '') {
      saida[idioma] = { nome: nome.trim() };
    }
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

const categoriaSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(60, 'Nome muito longo'),
  ordem: z.number().int().min(0).max(999).optional(),
  ativa: z.boolean().optional(),
  setorId: z.number().int().positive().nullable().optional(),
  traducoes: traducoesCategoriaSchema,
});

// Setor da categoria: null solta; número precisa existir.
async function garantirSetor(id: number | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const setor = await prisma.setor.findUnique({ where: { id }, select: { id: true } });
  if (!setor) {
    throw new HttpError(400, 'Setor não encontrado');
  }
}

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
        setorId: c.setorId,
        traducoes: limparTraducoesCategoria(c.traducoes),
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
    await garantirSetor(dados.setorId);
    const categoria = await prisma.categoria.create({
      data: {
        nome: dados.nome,
        ordem: dados.ordem ?? 0,
        ativa: dados.ativa ?? true,
        setorId: dados.setorId ?? null,
        traducoes: limparTraducoesCategoria(dados.traducoes) ?? Prisma.JsonNull,
      },
    });
    res.status(201).json({
      ...categoria,
      traducoes: limparTraducoesCategoria(categoria.traducoes),
      produtos: 0,
    });
  })
);

router.put(
  '/categorias/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(categoriaSchema.partial(), req.body);
    await garantirSetor(dados.setorId);
    const categoria = await prisma.categoria.update({
      where: { id },
      data: {
        nome: dados.nome,
        ordem: dados.ordem,
        ativa: dados.ativa,
        setorId: dados.setorId,
        traducoes:
          dados.traducoes === undefined ? undefined : (limparTraducoesCategoria(dados.traducoes) ?? Prisma.JsonNull),
      },
    });
    res.json({ ...categoria, traducoes: limparTraducoesCategoria(categoria.traducoes) });
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

const comboItemSchema = z.object({
  produtoId: z.number().int().positive(),
  quantidade: z.number().int().min(1, 'Quantidade inválida').max(20, 'Quantidade inválida'),
});

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
  // Combo: os produtos que vêm nele (a lista troca inteira; com combo = false ela é esvaziada).
  combo: z.boolean().optional(),
  comboItens: z.array(comboItemSchema).optional(),
  traducoes: traducoesProdutoSchema,
  ...fichaCampos,
};
const produtoCriarSchema = z.object(produtoCampos);
const produtoAtualizarSchema = z.object(produtoCampos).partial();

const opcaoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome da opção obrigatório').max(60, 'Nome da opção muito longo'),
  precoExtra: z.number().min(0, 'Preço inválido').max(9999.99, 'Preço inválido'),
  ativa: z.boolean().optional(),
});

const grupoOpcaoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome do grupo obrigatório').max(40, 'Nome do grupo muito longo'),
  minimo: z.number().int().min(0, 'Mínimo inválido').max(10, 'Mínimo inválido'),
  maximo: z.number().int().min(1, 'Máximo inválido').max(10, 'Máximo inválido'),
  opcoes: z.array(opcaoSchema).min(1, 'Informe pelo menos uma opção').max(30, 'Opções demais no grupo'),
});

const opcoesProdutoSchema = z.object({
  grupos: z.array(grupoOpcaoSchema).max(10, 'Grupos demais'),
});

async function garantirCategoria(id: number): Promise<void> {
  const categoria = await prisma.categoria.findFirst({ where: { id, excluida: false }, select: { id: true } });
  if (!categoria) {
    throw new HttpError(400, 'Categoria não encontrada');
  }
}

// Regras do combo: sem repetir, sem ele mesmo, só produtos ativos e que não sejam combo.
async function validarItensDoCombo(
  tx: Prisma.TransactionClient,
  produtoId: number | null,
  itens: { produtoId: number; quantidade: number }[]
): Promise<void> {
  const ids = itens.map((i) => i.produtoId);
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Produto repetido no combo');
  }
  if (produtoId !== null && ids.includes(produtoId)) {
    throw new HttpError(400, 'Um combo não pode conter a si mesmo');
  }
  if (ids.length === 0) return;
  const encontrados = await tx.produto.findMany({
    where: { id: { in: ids }, ativo: true },
    select: { id: true, combo: true },
  });
  if (encontrados.length !== ids.length) {
    throw new HttpError(400, 'Produto do combo não encontrado');
  }
  if (encontrados.some((p) => p.combo)) {
    throw new HttpError(400, 'Um combo não pode conter outro combo');
  }
}

// Produto que já está dentro de um combo não pode virar combo.
async function garantirQueNaoEstaEmCombo(tx: Prisma.TransactionClient, produtoId: number): Promise<void> {
  const emCombos = await tx.comboItem.count({ where: { produtoId } });
  if (emCombos > 0) {
    throw new HttpError(400, 'Este produto faz parte de um combo');
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
      include: incluirProduto,
      orderBy: [{ categoria: { ordem: 'asc' } }, { categoria: { nome: 'asc' } }, { nome: 'asc' }],
    });
    const promocoes = await promocoesValendo();
    res.json(produtos.map((p) => paraProdutoDTO(p, promocoes)));
  })
);

router.post(
  '/produtos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(produtoCriarSchema, req.body);
    await garantirCategoria(dados.categoriaId);
    const combo = dados.combo ?? false;
    const itensDoCombo = combo ? (dados.comboItens ?? []) : [];
    const produto = await prisma.$transaction(async (tx) => {
      if (combo) {
        await validarItensDoCombo(tx, null, itensDoCombo);
      }
      return tx.produto.create({
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
          combo,
          traducoes: limparTraducoes(dados.traducoes) ?? Prisma.JsonNull,
          comboItens: {
            create: itensDoCombo.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
          },
        },
        include: incluirProduto,
      });
    });
    res.status(201).json(await produtoDaResposta(produto));
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
    const produto = await prisma.$transaction(async (tx) => {
      const existente = await tx.produto.findFirst({
        where: { id, ativo: true },
        select: { id: true, combo: true },
      });
      if (!existente) {
        throw new HttpError(404, 'Produto não encontrado');
      }
      const combo = dados.combo ?? existente.combo;
      // Lista nova se veio uma; sem combo a lista some; combo sem lista enviada mantém a atual.
      const trocarItens = !combo || dados.comboItens !== undefined;
      const itensDoCombo = combo ? (dados.comboItens ?? []) : [];
      if (combo) {
        await garantirQueNaoEstaEmCombo(tx, id);
        await validarItensDoCombo(tx, id, itensDoCombo);
      }
      return tx.produto.update({
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
          combo,
          comboItens: trocarItens
            ? {
                deleteMany: {},
                create: itensDoCombo.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
              }
            : undefined,
          traducoes:
            dados.traducoes === undefined ? undefined : (limparTraducoes(dados.traducoes) ?? Prisma.JsonNull),
        },
        include: incluirProduto,
      });
    });
    res.json(await produtoDaResposta(produto));
  })
);

// Grupos de opções do produto: troca todos (apaga e recria), na ordem em que vieram.
router.put(
  '/produtos/:id/opcoes',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(opcoesProdutoSchema, req.body);
    for (const grupo of dados.grupos) {
      if (grupo.minimo > grupo.maximo) {
        throw new HttpError(400, `O mínimo do grupo "${grupo.nome}" não pode ser maior que o máximo`);
      }
      const ativas = grupo.opcoes.filter((o) => o.ativa !== false).length;
      if (grupo.maximo > ativas) {
        throw new HttpError(400, `O grupo "${grupo.nome}" tem máximo maior que o número de opções ativas`);
      }
    }
    const produto = await prisma.$transaction(async (tx) => {
      const existente = await tx.produto.findFirst({ where: { id, ativo: true }, select: { id: true } });
      if (!existente) {
        throw new HttpError(404, 'Produto não encontrado');
      }
      await tx.grupoOpcao.deleteMany({ where: { produtoId: id } });
      return tx.produto.update({
        where: { id },
        data: {
          grupos: {
            create: dados.grupos.map((g, ordem) => ({
              nome: g.nome,
              minimo: g.minimo,
              maximo: g.maximo,
              ordem,
              opcoes: {
                create: g.opcoes.map((o, posicao) => ({
                  nome: o.nome,
                  precoExtra: o.precoExtra.toFixed(2),
                  ativa: o.ativa ?? true,
                  ordem: posicao,
                })),
              },
            })),
          },
        },
        include: incluirProduto,
      });
    });
    res.json(await produtoDaResposta(produto));
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
      include: incluirProduto,
    });
    res.json(await produtoDaResposta(produto));
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

// ---------- Idiomas do cardápio ----------

// Português sempre; inglês e espanhol são opcionais. Ordem fixa.
function idiomasDe(lista: readonly string[]): string[] {
  return ['pt', ...['en', 'es'].filter((i) => lista.includes(i))];
}

router.get(
  '/cardapio/idiomas',
  asyncHandler(async (_req, res) => {
    const configuracao = await lerConfiguracao();
    res.json({ idiomas: idiomasDe(configuracao.idiomas) });
  })
);

router.put(
  '/cardapio/idiomas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(z.object({ idiomas: z.array(z.enum(['pt', 'en', 'es'])) }), req.body);
    const idiomas = idiomasDe(dados.idiomas);
    await lerConfiguracao();
    await prisma.configuracaoPlataforma.update({ where: { id: 1 }, data: { idiomas } });
    limparCacheConfiguracao();
    res.json({ idiomas });
  })
);

export default router;
