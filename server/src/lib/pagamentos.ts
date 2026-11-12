import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { incluirPedido, paraPedidoDTO } from './pedidos';
import { consultarNaMaquineta } from './maquinetas';
import type { ResultadoMaquineta } from './maquinetas';
import { liberarParaLimpeza } from './mesas';

// Conta da mesa e ciclo do pagamento (pendente, aprovado, recusado, cancelado).

export const FORMAS_PAGAMENTO = ['Dinheiro', 'Pix', 'Cartão de débito', 'Cartão de crédito'] as const;

export const incluirPagamento = {
  maquineta: { select: { id: true, nome: true, operadora: true, integracao: true } },
  garcom: { select: { id: true, nome: true } },
  mesa: { select: { id: true, numero: true, nome: true } },
} satisfies Prisma.PagamentoInclude;

type PagamentoCompleto = Prisma.PagamentoGetPayload<{ include: typeof incluirPagamento }>;

export function paraPagamentoDTO(p: PagamentoCompleto) {
  return {
    id: p.id,
    mesa: p.mesa,
    valor: Number(p.valor),
    formaPagamento: p.formaPagamento,
    status: p.status,
    maquineta: p.maquineta,
    garcom: p.garcom,
    codigoAutorizacao: p.codigoAutorizacao,
    mensagem: p.mensagem,
    criadoEm: p.criadoEm.toISOString(),
    concluidoEm: p.concluidoEm ? p.concluidoEm.toISOString() : null,
  };
}

export async function carregarPagamento(id: number): Promise<PagamentoCompleto> {
  const pagamento = await prisma.pagamento.findUnique({ where: { id }, include: incluirPagamento });
  if (!pagamento) {
    throw new HttpError(404, 'Pagamento não encontrado');
  }
  return pagamento;
}

// Conta aberta da mesa: pedidos não pagos e não cancelados, e a cobrança em andamento (se houver).
export async function carregarConta(mesaId: number) {
  const mesa = await prisma.mesa.findUnique({ where: { id: mesaId } });
  if (!mesa) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  const [pedidos, pendente] = await Promise.all([
    prisma.pedido.findMany({
      where: { mesaId, pagoEm: null, status: { not: 'CANCELADO' } },
      include: incluirPedido,
      orderBy: { criadoEm: 'asc' },
    }),
    prisma.pagamento.findFirst({
      where: { mesaId, status: 'PENDENTE' },
      include: incluirPagamento,
      orderBy: { criadoEm: 'desc' },
    }),
  ]);
  const lista = pedidos.map(paraPedidoDTO);
  const total = Math.round(lista.reduce((soma, p) => soma + p.total, 0) * 100) / 100;
  return {
    mesa: { id: mesa.id, numero: mesa.numero, nome: mesa.nome },
    pedidos: lista,
    total,
    pagamentoPendente: pendente ? paraPagamentoDTO(pendente) : null,
  };
}

// Pagamento aprovado: os pedidos da cobrança ficam pagos e a mesa vai para a limpeza.
export async function aprovarPagamento(id: number, codigoAutorizacao?: string | null): Promise<void> {
  const agora = new Date();
  const mesaId = await prisma.$transaction(async (tx) => {
    const atual = await tx.pagamento.findUnique({ where: { id } });
    if (!atual || atual.status !== 'PENDENTE') return null;
    await tx.pagamento.update({
      where: { id },
      data: { status: 'APROVADO', concluidoEm: agora, codigoAutorizacao: codigoAutorizacao ?? null, mensagem: null },
    });
    await tx.pedido.updateMany({
      where: { pagamentoId: id, pagoEm: null, status: { not: 'CANCELADO' } },
      data: { pagoEm: agora, formaPagamento: atual.formaPagamento, status: 'ENTREGUE' },
    });
    await tx.mesa.update({ where: { id: atual.mesaId }, data: { chamandoDesde: null } });
    return atual.mesaId;
  });
  if (mesaId !== null) {
    await liberarParaLimpeza(mesaId, true);
  }
}

// Pagamento que não deu certo: os pedidos voltam para a conta aberta.
export async function encerrarSemPagar(
  id: number,
  status: 'RECUSADO' | 'CANCELADO',
  mensagem?: string | null
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const atual = await tx.pagamento.findUnique({ where: { id } });
    if (!atual || atual.status !== 'PENDENTE') return;
    await tx.pagamento.update({
      where: { id },
      data: { status, concluidoEm: new Date(), mensagem: mensagem ?? null },
    });
    await tx.pedido.updateMany({ where: { pagamentoId: id, pagoEm: null }, data: { pagamentoId: null } });
  });
}

export async function aplicarResultado(id: number, resultado: ResultadoMaquineta): Promise<void> {
  if (resultado.status === 'APROVADO') {
    await aprovarPagamento(id, resultado.codigoAutorizacao);
  } else if (resultado.status === 'RECUSADO' || resultado.status === 'CANCELADO') {
    await encerrarSemPagar(id, resultado.status, resultado.mensagem);
  } else if (resultado.mensagem !== undefined) {
    await prisma.pagamento.updateMany({
      where: { id, status: 'PENDENTE' },
      data: { mensagem: resultado.mensagem },
    });
  }
}

// Para pagamento pendente em maquineta automática: pergunta à maquineta e grava o que mudou.
export async function atualizarPeloTerminal(id: number): Promise<void> {
  const pagamento = await prisma.pagamento.findUnique({ where: { id }, include: { maquineta: true } });
  if (!pagamento || pagamento.status !== 'PENDENTE' || !pagamento.maquineta) return;
  if (pagamento.maquineta.integracao !== 'AUTOMATICA') return;
  const resultado = await consultarNaMaquineta(pagamento, pagamento.maquineta);
  await aplicarResultado(id, resultado);
}
