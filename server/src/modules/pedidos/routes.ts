import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, StatusPedido } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { exigirAcao } from '../../lib/autorizacao';
import { devolverPorPedido } from '../../lib/estoque';
import { devolverInsumosPorPedido } from '../../lib/insumos';
import { fecharSeQuitada } from '../../lib/pagamentos';
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

// Setor do usuário quando ele é da cozinha e tem setor; nulo nos demais casos.
// Lido do banco a cada chamada.
async function setorDaCozinha(usuarioId: number, perfil: string): Promise<number | null> {
  if (perfil !== 'COZINHA') return null;
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { setorId: true } });
  return usuario?.setorId ?? null;
}

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
    // Cozinha com setor vê só as partes do próprio setor.
    const setorDoUsuario = await setorDaCozinha(req.usuario.id, req.usuario.perfil);
    if (setorDoUsuario !== null) {
      where.setores = {
        some: {
          setorId: setorDoUsuario,
          ...(ver === 'andamento' ? { status: { in: STATUS_EM_ANDAMENTO } } : {}),
        },
      };
    }
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
    if (atual.status === 'CANCELADO') {
      throw new HttpError(400, 'Este pedido foi cancelado. Lance um novo pedido.');
    }
    const perfil = req.usuario.perfil;
    const setorDoUsuario = await setorDaCozinha(req.usuario.id, perfil);
    if (setorDoUsuario !== null) {
      // Cozinha com setor: muda só a parte do pedido que é do seu setor.
      const parte = await prisma.pedidoSetor.findUnique({
        where: { pedidoId_setorId: { pedidoId: id, setorId: setorDoUsuario } },
        select: { status: true },
      });
      if (!parte) {
        throw new HttpError(403, 'Este pedido não tem itens do seu setor');
      }
      const naoEntregue = atual.status !== 'ENTREGUE';
      const preparo = status === 'EM_PREPARO' && parte.status === 'NOVO' && naoEntregue;
      const pronto = status === 'PRONTO' && (parte.status === 'NOVO' || parte.status === 'EM_PREPARO') && naoEntregue;
      if (!preparo && !pronto) {
        throw new HttpError(403, 'A cozinha inicia o preparo e marca o pedido como pronto. O garçom entrega.');
      }
      const agora = new Date();
      const pedido = await prisma.$transaction(async (tx) => {
        // Trava a linha do pedido: dois setores marcando pronto ao mesmo tempo esperam um pelo outro.
        await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${id} FOR UPDATE`;
        await tx.pedidoSetor.update({
          where: { pedidoId_setorId: { pedidoId: id, setorId: setorDoUsuario } },
          data: { status },
        });
        // O pedido segue as partes: todas prontas -> PRONTO; todas novas -> NOVO; senão -> EM_PREPARO.
        const partes = await tx.pedidoSetor.findMany({ where: { pedidoId: id }, select: { status: true } });
        const novoStatus: StatusPedido = partes.every((p) => p.status === 'PRONTO')
          ? 'PRONTO'
          : partes.every((p) => p.status === 'NOVO')
            ? 'NOVO'
            : 'EM_PREPARO';
        const horasDoPedido: { preparoIniciadoEm?: Date; prontoEm?: Date } = {};
        if (novoStatus !== atual.status) {
          if (novoStatus === 'EM_PREPARO') horasDoPedido.preparoIniciadoEm = agora;
          if (novoStatus === 'PRONTO') {
            horasDoPedido.prontoEm = agora;
            if (atual.status === 'NOVO') horasDoPedido.preparoIniciadoEm = agora;
          }
        }
        return tx.pedido.update({
          where: { id },
          data: { status: novoStatus, ...horasDoPedido },
          include: incluirPedido,
        });
      });
      return res.json(paraPedidoDTO(pedido));
    }
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
    // Cancelar pode pedir a senha do gestor (regra CANCELAR_PEDIDO).
    if (status === 'CANCELADO') {
      await exigirAcao(req, 'CANCELAR_PEDIDO');
    }
    // Horas da operação: quando a cozinha começou, quando ficou pronto e quando foi entregue.
    const agora = new Date();
    const horas: { preparoIniciadoEm?: Date; prontoEm?: Date; entregueEm?: Date } = {};
    if (status === 'EM_PREPARO') horas.preparoIniciadoEm = agora;
    if (status === 'PRONTO') {
      horas.prontoEm = agora;
      // Se o pedido pulou de NOVO direto para PRONTO, o preparo também começou agora.
      if (atual.status === 'NOVO') horas.preparoIniciadoEm = agora;
    }
    if (status === 'ENTREGUE') horas.entregueEm = agora;
    const pedido = await prisma.$transaction(async (tx) => {
      // As partes por setor acompanham o pedido (antes de ler o pedido, para a resposta já vir com elas).
      if (status === 'ENTREGUE' || status === 'CANCELADO') {
        await tx.pedidoSetor.updateMany({ where: { pedidoId: id }, data: { status } });
      } else if (status === 'EM_PREPARO') {
        await tx.pedidoSetor.updateMany({ where: { pedidoId: id, status: 'NOVO' }, data: { status } });
      } else if (status === 'PRONTO') {
        await tx.pedidoSetor.updateMany({ where: { pedidoId: id }, data: { status } });
      }
      const atualizado = await tx.pedido.update({
        where: { id },
        data: {
          status,
          ...horas,
          // O primeiro garçom (ou gestor) que mexe em um pedido do cliente passa a responder por ele.
          garcomId: atual.garcomId ?? (perfil === 'COZINHA' ? null : req.usuario.id),
        },
        include: incluirPedido,
      });
      return atualizado;
    });
    if (status === 'CANCELADO') {
      // Os itens com controle de estoque voltam para o saldo.
      await devolverPorPedido(id);
      // Os insumos das fichas técnicas também voltam.
      await devolverInsumosPorPedido(id);
      // Conta que ficou quitada com o cancelamento (já tinha pagamento parcial) é fechada.
      if (pedido.contaId) {
        await fecharSeQuitada(pedido.contaId);
      }
    }
    res.json(paraPedidoDTO(pedido));
  })
);

export default router;
