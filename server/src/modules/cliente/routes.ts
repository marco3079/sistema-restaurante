import { Request, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { criarPedido, incluirPedido, itensSchema, paraPedidoDTO } from '../../lib/pedidos';
import { registrarLog } from '../../lib/log';
import { fichaDoProduto } from '../../lib/produtos';
import { ocuparMesa } from '../../lib/mesas';

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
    })),
  };
}

// Mesa e cardápio (só categorias ativas e produtos no cardápio).
publico.get(
  '/cliente/mesas/:codigo',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const categorias = await prisma.categoria.findMany({
      where: { ativa: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: { produtos: { where: { ativo: true }, orderBy: { nome: 'asc' } } },
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
      recomendados: recomendados.slice(0, 10),
      origemRecomendados,
      mesa: { numero: mesa.numero, nome: mesa.nome, chamando: mesa.chamandoDesde !== null },
      categorias: categorias
        .filter((c) => c.produtos.length > 0)
        .map((c) => ({
          id: c.id,
          nome: c.nome,
          produtos: c.produtos.map((p) => ({
            id: p.id,
            nome: p.nome,
            descricao: p.descricao,
            preco: Number(p.preco),
            imagem: p.imagem,
            disponivel: p.disponivel,
            recomendado: p.recomendado,
            ...fichaDoProduto(p),
          })),
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
    res.set('Cache-Control', 'no-store');
    res.json({
      pedidos: lista.map(paraPedidoCliente),
      total,
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
