import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import {
  criarPedido,
  incluirPedido,
  inicioDoDia,
  itensSchema,
  paraPedidoDTO,
  STATUS_EM_ANDAMENTO,
} from '../../lib/pedidos';

// Pedidos vistos pela equipe: fila, lançamento e mudança de situação.
// Quem muda o quê:
//   cozinha: inicia o preparo (NOVO -> EM_PREPARO) e marca como pronto (-> PRONTO);
//   garçom: entrega o que está pronto (PRONTO -> ENTREGUE) e cancela;
//   gestor: tudo.

const router = Router();
// A limpeza não vê nem mexe em pedidos.
const equipeDosPedidos = permitir('GESTOR', 'GARCOM', 'COZINHA');

const statusSchema = z.enum(['NOVO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO']);

const filtroSchema = z.object({
  // andamento: fila (novo, em preparo, pronto). hoje: tudo de hoje. todos: os mais recentes.
  ver: z.enum(['andamento', 'hoje', 'todos']).optional(),
  status: statusSchema.optional(),
  mesaId: z.coerce.number().int().positive().optional(),
});

router.get(
  '/pedidos',
  equipeDosPedidos,
  asyncHandler(async (req, res) => {
    const filtro = validar(filtroSchema, req.query);
    const ver = filtro.ver ?? 'andamento';
    const where: Prisma.PedidoWhereInput = {};
    if (ver === 'andamento') where.status = { in: STATUS_EM_ANDAMENTO };
    if (ver === 'hoje') where.criadoEm = { gte: inicioDoDia() };
    if (filtro.status) where.status = filtro.status;
    if (filtro.mesaId) where.mesaId = filtro.mesaId;
    const pedidos = await prisma.pedido.findMany({
      where,
      include: incluirPedido,
      // A fila mostra primeiro o pedido que espera há mais tempo.
      orderBy: { criadoEm: ver === 'andamento' ? 'asc' : 'desc' },
      take: 200,
    });
    res.json(pedidos.map(paraPedidoDTO));
  })
);

const criarSchema = z.object({
  mesaId: z.number().int().positive(),
  itens: itensSchema,
  nomeCliente: z.string().trim().max(60, 'Nome muito longo').nullable().optional(),
  observacao: z.string().trim().max(300, 'Observação muito longa').nullable().optional(),
});

router.post(
  '/pedidos',
  permitir('GESTOR', 'GARCOM'),
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    const mesa = await prisma.mesa.findUnique({ where: { id: dados.mesaId } });
    if (!mesa || !mesa.ativa) {
      throw new HttpError(400, 'Mesa não encontrada ou desativada');
    }
    const pedido = await criarPedido({
      mesaId: mesa.id,
      origem: 'GARCOM',
      itens: dados.itens,
      nomeCliente: dados.nomeCliente,
      observacao: dados.observacao,
      garcomId: req.usuario.id,
    });
    res.status(201).json(pedido);
  })
);

router.put(
  '/pedidos/:id/status',
  equipeDosPedidos,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { status } = validar(z.object({ status: statusSchema }), req.body);
    const atual = await prisma.pedido.findUnique({
      where: { id },
      select: { id: true, pagoEm: true, garcomId: true, status: true },
    });
    if (!atual) {
      throw new HttpError(404, 'Pedido não encontrado');
    }
    if (atual.pagoEm) {
      throw new HttpError(400, 'Este pedido já foi pago e não pode mais mudar.');
    }
    const perfil = req.usuario.perfil;
    if (perfil === 'COZINHA') {
      const preparo = status === 'EM_PREPARO' && atual.status === 'NOVO';
      const pronto = status === 'PRONTO' && (atual.status === 'NOVO' || atual.status === 'EM_PREPARO');
      if (!preparo && !pronto) {
        throw new HttpError(403, 'A cozinha inicia o preparo e marca o pedido como pronto. O garçom entrega.');
      }
    }
    if (perfil === 'GARCOM') {
      const entrega = status === 'ENTREGUE' && atual.status === 'PRONTO';
      const cancelamento = status === 'CANCELADO' && atual.status !== 'ENTREGUE';
      if (!entrega && !cancelamento) {
        throw new HttpError(
          403,
          status === 'ENTREGUE'
            ? 'Só dá para entregar o pedido depois que a cozinha marcar como pronto.'
            : 'Quem inicia o preparo e marca como pronto é a cozinha.'
        );
      }
    }
    const pedido = await prisma.pedido.update({
      where: { id },
      data: {
        status,
        // O primeiro garçom (ou gestor) que mexe em um pedido do cliente passa a responder por ele.
        garcomId: atual.garcomId ?? (perfil === 'COZINHA' ? null : req.usuario.id),
      },
      include: incluirPedido,
    });
    res.json(paraPedidoDTO(pedido));
  })
);

export default router;
