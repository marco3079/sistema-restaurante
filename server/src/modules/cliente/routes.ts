import { Request, Router } from 'express';
import { Prisma } from '@prisma/client';
import type { Promocao } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { criarPedido, incluirPedido, itensSchema, paraPedidoDTO } from '../../lib/pedidos';
import { registrarLog } from '../../lib/log';
import { fichaDoProduto } from '../../lib/produtos';
import { ocuparMesa } from '../../lib/mesas';
import { contaAberta, valoresDaConta } from '../../lib/contas';
import { lerConfiguracao } from '../../lib/email';
import { precoAgora, promocoesValendo } from '../../lib/precos';

// Cardápio da mesa, aberto pelo cliente sem login. O acesso é pelo código da mesa (QR code).
// Estas rotas nunca devolvem dados da equipe nem de outras mesas.

export const publico = Router();

// Limites em memória por IP: pedidos e chamados em uma janela de 10 minutos.
const JANELA_MS = 10 * 60 * 1000;
const LIMITE_PEDIDOS_POR_IP = 20;
const LIMITE_CHAMADOS_POR_IP = 10;
const LIMITE_PEDIDOS_ESPERANDO_POR_MESA = 15;
const usos = new Map<string, number[]>();

function dentroDoLimite(chave: string, limite: number): boolean {
  const agora = Date.now();
  const recentes = (usos.get(chave) ?? []).filter((instante) => agora - instante < JANELA_MS);
  if (recentes.length >= limite) {
    usos.set(chave, recentes);
    return false;
  }
  recentes.push(agora);
  usos.set(chave, recentes);
  return true;
}

setInterval(() => {
  const agora = Date.now();
  for (const [chave, instantes] of usos) {
    const recentes = instantes.filter((instante) => agora - instante < JANELA_MS);
    if (recentes.length === 0) usos.delete(chave);
    else usos.set(chave, recentes);
  }
}, JANELA_MS).unref();

async function mesaDoCodigo(req: Request) {
  const codigo = req.params.codigo;
  if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(codigo)) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  const mesa = await prisma.mesa.findUnique({ where: { codigo } });
  if (!mesa || !mesa.ativa) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  return mesa;
}

// O que o cliente vê de um pedido da própria mesa (sem dados da equipe).
function paraPedidoCliente(p: ReturnType<typeof paraPedidoDTO>) {
  return {
    id: p.id,
    status: p.status,
    nomeCliente: p.nomeCliente,
    observacao: p.observacao,
    total: p.total,
    criadoEm: p.criadoEm,
    itens: p.itens.map((i) => ({
      nomeProduto: i.nomeProduto,
      precoUnitario: i.precoUnitario,
      quantidade: i.quantidade,
      observacao: i.observacao,
      // Opções escolhidas (grupo, opção e acréscimo); lista vazia quando não há.
      opcoes: i.opcoes,
    })),
  };
}

// ---------- Idioma e traduções do cardápio ----------

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

// Dados do produto que o cardápio da mesa precisa: opções ativas e os itens do combo.
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

// Produto no formato do cardápio da mesa: sem traduções cruas e sem opções inativas.
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

// Mesa e cardápio (só categorias ativas e produtos no cardápio).
publico.get(
  '/cliente/mesas/:codigo',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const configuracao = await lerConfiguracao();
    const idiomas = idiomasAtivos(configuracao.idiomas);
    const idioma = idiomaDaConsulta(req.query.idioma, idiomas);
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
    res.set('Cache-Control', 'no-store');
    res.json({
      idiomas,
      idioma,
      recomendados: recomendados.slice(0, 10),
      origemRecomendados,
      mesa: { numero: mesa.numero, nome: mesa.nome, chamando: mesa.chamandoDesde !== null },
      categorias: categorias
        .filter((c) => c.produtos.length > 0)
        .map((c) => ({
          id: c.id,
          nome: traduzir(c.nome, c.traducoes, idioma, 'nome'),
          produtos: c.produtos.map((p) => paraProdutoDoCardapio(p, promocoes, idioma)),
        })),
    });
  })
);

// Pedidos da conta aberta da mesa, para o cliente acompanhar.
publico.get(
  '/cliente/mesas/:codigo/pedidos',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const pedidos = await prisma.pedido.findMany({
      where: { mesaId: mesa.id, pagoEm: null },
      include: incluirPedido,
      orderBy: { criadoEm: 'desc' },
      take: 60,
    });
    const lista = pedidos.map(paraPedidoDTO);
    const total =
      Math.round(
        lista.filter((p) => p.status !== 'CANCELADO').reduce((soma, p) => soma + p.total, 0) * 100
      ) / 100;
    // Taxa de serviço e o que já foi pago, para o cliente saber quanto falta.
    const conta = await contaAberta(mesa.id);
    const pagos = conta
      ? await prisma.pagamento.aggregate({ where: { contaId: conta.id, status: 'APROVADO' }, _sum: { valor: true } })
      : null;
    const valores = valoresDaConta(conta, total, Number(pagos?._sum.valor ?? 0));
    res.set('Cache-Control', 'no-store');
    res.json({
      pedidos: lista.map(paraPedidoCliente),
      total,
      taxaPercentual: conta && conta.taxaServico ? Number(conta.taxaPercentual) : 0,
      taxa: valores.taxa,
      desconto: valores.desconto,
      totalComTaxa: valores.total,
      pago: valores.pago,
      restante: valores.restante,
      chamando: mesa.chamandoDesde !== null,
    });
  })
);

const pedidoSchema = z.object({
  itens: itensSchema,
  nomeCliente: z.string().trim().max(60, 'Nome muito longo').nullable().optional(),
  observacao: z.string().trim().max(300, 'Observação muito longa').nullable().optional(),
});

publico.post(
  '/cliente/mesas/:codigo/pedidos',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const dados = validar(pedidoSchema, req.body);
    if (!dentroDoLimite('pedido|' + (req.ip ?? ''), LIMITE_PEDIDOS_POR_IP)) {
      throw new HttpError(429, 'Muitos pedidos em pouco tempo. Chame o garçom, por favor.');
    }
    const esperando = await prisma.pedido.count({
      where: { mesaId: mesa.id, pagoEm: null, status: { in: ['NOVO', 'EM_PREPARO'] } },
    });
    if (esperando >= LIMITE_PEDIDOS_ESPERANDO_POR_MESA) {
      throw new HttpError(429, 'Esta mesa já tem muitos pedidos em preparo. Chame o garçom, por favor.');
    }
    const pedido = await criarPedido({
      mesaId: mesa.id,
      origem: 'CLIENTE',
      itens: dados.itens,
      nomeCliente: dados.nomeCliente,
      observacao: dados.observacao,
    });
    const navegador = req.get('user-agent');
    registrarLog({
      usuarioId: null,
      usuarioNome: `Cliente da mesa ${mesa.numero}`,
      tipo: 'CRIACAO',
      modulo: 'Pedidos',
      descricao: `Pedido #${pedido.id} feito pelo cardápio da mesa ${mesa.numero}`,
      metodo: 'POST',
      caminho: '/api/cliente/mesas/pedidos',
      status: 201,
      ip: req.ip ?? null,
      navegador: navegador ? navegador.slice(0, 200) : null,
    });
    res.status(201).json(paraPedidoCliente(pedido));
  })
);

// Cliente chama o garçom (ou pede a conta). Fica marcado até alguém da equipe atender.
publico.post(
  '/cliente/mesas/:codigo/chamar',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    if (!dentroDoLimite('chamado|' + (req.ip ?? ''), LIMITE_CHAMADOS_POR_IP)) {
      throw new HttpError(429, 'O garçom já foi avisado. Aguarde um instante.');
    }
    if (mesa.chamandoDesde === null) {
      await prisma.mesa.update({ where: { id: mesa.id }, data: { chamandoDesde: new Date() } });
    }
    // Quem chama o garçom já está sentado: a mesa fica ocupada.
    await ocuparMesa(mesa.id);
    res.status(204).end();
  })
);

// ---------- Avaliação da conta pelo cliente ----------

// A conta fechada mais recente da mesa vale para avaliar por 3 horas, enquanto não tiver avaliação.
const HORAS_PARA_AVALIAR = 3;

async function contaParaAvaliar(mesaId: number): Promise<{ id: number; fechadaEm: Date } | null> {
  const ultima = await prisma.conta.findFirst({
    // Só conta com consumo pago: conta fechada sem nenhum pagamento aprovado não vale para avaliar.
    where: {
      mesaId,
      status: 'FECHADA',
      fechadaEm: { not: null },
      pagamentos: { some: { status: 'APROVADO' } },
    },
    orderBy: { fechadaEm: 'desc' },
    select: { id: true, fechadaEm: true, avaliacao: { select: { id: true } } },
  });
  if (!ultima || !ultima.fechadaEm || ultima.avaliacao) return null;
  if (Date.now() - ultima.fechadaEm.getTime() > HORAS_PARA_AVALIAR * 60 * 60 * 1000) return null;
  return { id: ultima.id, fechadaEm: ultima.fechadaEm };
}

// Conta que o cliente pode avaliar agora, se houver.
publico.get(
  '/cliente/mesas/:codigo/avaliacao',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const conta = await contaParaAvaliar(mesa.id);
    res.set('Cache-Control', 'no-store');
    res.json({
      pendente: conta ? { contaId: conta.id, fechadaEm: conta.fechadaEm.toISOString() } : null,
    });
  })
);

const notaSchema = z
  .number()
  .int('Use uma nota de 1 a 5')
  .min(1, 'Use uma nota de 1 a 5')
  .max(5, 'Use uma nota de 1 a 5');

const avaliacaoSchema = z.object({
  notaComida: notaSchema,
  notaAtendimento: notaSchema,
  comentario: z.string().trim().max(500, 'Comentário muito longo').nullable().optional(),
});

publico.post(
  '/cliente/mesas/:codigo/avaliacao',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    if (!dentroDoLimite('avaliacao|' + (req.ip ?? ''), LIMITE_CHAMADOS_POR_IP)) {
      throw new HttpError(429, 'Muitas avaliações em pouco tempo. Aguarde um instante.');
    }
    const dados = validar(avaliacaoSchema, req.body);
    const conta = await contaParaAvaliar(mesa.id);
    if (!conta) {
      throw new HttpError(400, 'Não há conta para avaliar agora.');
    }
    // Quem recebeu a conta: o garçom do último pagamento aprovado.
    const ultimoPagamento = await prisma.pagamento.findFirst({
      where: { contaId: conta.id, status: 'APROVADO' },
      orderBy: { concluidoEm: 'desc' },
      select: { garcomId: true },
    });
    try {
      await prisma.avaliacao.create({
        data: {
          contaId: conta.id,
          mesaId: mesa.id,
          garcomId: ultimoPagamento?.garcomId ?? null,
          notaComida: dados.notaComida,
          notaAtendimento: dados.notaAtendimento,
          comentario: dados.comentario || null,
        },
      });
    } catch (erro) {
      // A conta tem uma avaliação só (coluna única): outra aba ou clique chegou antes.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new HttpError(400, 'Esta conta já foi avaliada.');
      }
      throw erro;
    }
    res.status(201).json({ ok: true });
  })
);
