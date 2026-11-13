import { Prisma } from '@prisma/client';
import type { Promocao } from '@prisma/client';
import { prisma } from './prisma';
import { fichaDoProduto } from './produtos';
import { lerConfiguracao } from './email';
import { precoAgora, promocoesValendo } from './precos';

// Cardápio público (sem login): usado pela mesa (QR code) e pelo delivery e retirada.
// Não devolve dados da equipe nem de outras mesas.

type Idioma = 'pt' | 'en' | 'es';
const IDIOMAS: Idioma[] = ['pt', 'en', 'es'];
type CampoTraduzivel = 'nome' | 'descricao' | 'detalhes' | 'ingredientes' | 'porcao' | 'alergenicos';

// Idiomas ativos na configuração (o português está sempre).
function idiomasAtivos(gravados: string[]): Idioma[] {
  return IDIOMAS.filter((i) => i === 'pt' || gravados.includes(i));
}

// Idioma pedido na consulta; inválido ou não ativo vira português.
function idiomaDaConsulta(valor: unknown, ativos: Idioma[]): Idioma {
  const escolhido = IDIOMAS.find((i) => i === valor);
  return escolhido !== undefined && ativos.includes(escolhido) ? escolhido : 'pt';
}

// Texto do campo no idioma pedido; sem tradução (ou vazia) fica o original em português.
function traduzir<T extends string | null>(
  original: T,
  traducoes: unknown,
  idioma: Idioma,
  campo: CampoTraduzivel
): T | string {
  if (idioma === 'pt' || typeof traducoes !== 'object' || traducoes === null) return original;
  const bloco = (traducoes as Record<string, unknown>)[idioma];
  if (typeof bloco !== 'object' || bloco === null) return original;
  const texto = (bloco as Record<string, unknown>)[campo];
  return typeof texto === 'string' && texto.trim() !== '' ? texto : original;
}

// Dados do produto que o cardápio precisa: opções ativas e os itens do combo.
const incluirProdutoCardapio = {
  grupos: {
    orderBy: { ordem: 'asc' },
    include: { opcoes: { where: { ativa: true }, orderBy: { ordem: 'asc' } } },
  },
  comboItens: {
    orderBy: { id: 'asc' },
    include: { produto: { select: { nome: true, traducoes: true } } },
  },
} satisfies Prisma.ProdutoInclude;

type ProdutoDoCardapio = Prisma.ProdutoGetPayload<{ include: typeof incluirProdutoCardapio }>;

// Produto no formato do cardápio: sem traduções cruas e sem opções inativas.
function paraProdutoDoCardapio(p: ProdutoDoCardapio, promocoes: Promocao[], idioma: Idioma) {
  const preco = precoAgora(p, promocoes);
  const ficha = fichaDoProduto(p);
  return {
    id: p.id,
    nome: traduzir(p.nome, p.traducoes, idioma, 'nome'),
    descricao: traduzir(p.descricao, p.traducoes, idioma, 'descricao'),
    detalhes: traduzir(ficha.detalhes, p.traducoes, idioma, 'detalhes'),
    ingredientes: traduzir(ficha.ingredientes, p.traducoes, idioma, 'ingredientes'),
    porcao: traduzir(ficha.porcao, p.traducoes, idioma, 'porcao'),
    alergenicos: traduzir(ficha.alergenicos, p.traducoes, idioma, 'alergenicos'),
    imagem: p.imagem,
    preco: preco.preco,
    precoOriginal: preco.precoOriginal,
    promocao: preco.promocao,
    combo: p.combo,
    comboItens: p.comboItens.map((c) => ({
      nome: traduzir(c.produto.nome, c.produto.traducoes, idioma, 'nome'),
      quantidade: c.quantidade,
    })),
    grupos: p.grupos
      .filter((g) => g.opcoes.length > 0)
      .map((g) => ({
        id: g.id,
        nome: g.nome,
        minimo: g.minimo,
        maximo: g.maximo,
        opcoes: g.opcoes.map((o) => ({ id: o.id, nome: o.nome, precoExtra: Number(o.precoExtra) })),
      })),
    disponivel: p.disponivel,
    recomendado: p.recomendado,
    tempoPreparoMin: ficha.tempoPreparoMin,
    nutricao: ficha.nutricao,
  };
}

// Idiomas, idioma escolhido, recomendados e categorias com produtos (só categorias ativas e produtos no cardápio).
// `idiomaPedido` é o valor do parâmetro `idioma`; inválido ou não ativo vira português.
export async function montarCardapioPublico(idiomaPedido: string | undefined): Promise<{
  idiomas: Idioma[];
  idioma: Idioma;
  recomendados: number[];
  origemRecomendados: 'CASA' | 'MAIS_PEDIDOS';
  categorias: {
    id: number;
    nome: string;
    produtos: ReturnType<typeof paraProdutoDoCardapio>[];
  }[];
}> {
  const configuracao = await lerConfiguracao();
  const idiomas = idiomasAtivos(configuracao.idiomas);
  const idioma = idiomaDaConsulta(idiomaPedido, idiomas);
  // Promoções valendo agora, lidas uma vez para o cardápio todo.
  const promocoes = await promocoesValendo();
  const categorias = await prisma.categoria.findMany({
    where: { ativa: true },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    include: { produtos: { where: { ativo: true }, orderBy: { nome: 'asc' }, include: incluirProdutoCardapio } },
  });
  // Recomendados: os que o gestor marcou. Se ele não marcou nenhum, os mais pedidos dos últimos 30 dias.
  const noCardapio = categorias.flatMap((c) => c.produtos).filter((p) => p.disponivel);
  let recomendados = noCardapio.filter((p) => p.recomendado).map((p) => p.id);
  let origemRecomendados: 'CASA' | 'MAIS_PEDIDOS' = 'CASA';
  if (recomendados.length === 0) {
    origemRecomendados = 'MAIS_PEDIDOS';
    const ids = new Set(noCardapio.map((p) => p.id));
    const maisPedidos = await prisma.itemPedido.groupBy({
      by: ['produtoId'],
      where: {
        pedido: {
          status: { not: 'CANCELADO' },
          criadoEm: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      },
      _sum: { quantidade: true },
      orderBy: { _sum: { quantidade: 'desc' } },
      take: 20,
    });
    recomendados = maisPedidos
      .map((m) => m.produtoId)
      .filter((id) => ids.has(id))
      .slice(0, 6);
  }
  return {
    idiomas,
    idioma,
    recomendados: recomendados.slice(0, 10),
    origemRecomendados,
    categorias: categorias
      .filter((c) => c.produtos.length > 0)
      .map((c) => ({
        id: c.id,
        nome: traduzir(c.nome, c.traducoes, idioma, 'nome'),
        produtos: c.produtos.map((p) => paraProdutoDoCardapio(p, promocoes, idioma)),
      })),
  };
}
