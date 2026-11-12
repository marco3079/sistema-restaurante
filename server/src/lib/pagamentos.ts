import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { incluirPedido, paraPedidoDTO } from './pedidos';
import { consultarNaMaquineta } from './maquinetas';
import type { ResultadoMaquineta } from './maquinetas';
import { liberarParaLimpeza } from './mesas';
import { contaAberta, valoresDaConta } from './contas';
import { emitirSeAutomatico } from './fiscal';

// Conta da mesa e ciclo de cada pagamento (pendente, aprovado, recusado, cancelado).
// A conta pode ser paga em partes: ela fecha quando os pagamentos aprovados cobrem o total.

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
    contaId: p.contaId,
    mesa: p.mesa,
    // Parte da conta que este pagamento quita (já com a taxa de serviço proporcional).
    valor: Number(p.valor),
    // Gorjeta dada além da conta.
    gorjeta: Number(p.gorjeta),
    // Quanto do valor é taxa de serviço.
    valorServico: Number(p.valorServico),
    formaPagamento: p.formaPagamento,
    status: p.status,
    maquineta: p.maquineta,
    garcom: p.garcom,
    codigoAutorizacao: p.codigoAutorizacao,
    mensagem: p.mensagem,
    // Pix copia e cola, quando a cobrança é por Pix com a chave do restaurante.
    pix: p.status === 'PENDENTE' ? p.pix : null,
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

// Conta aberta da mesa: pedidos, taxa de serviço, o que já foi pago e o que falta.
export async function carregarConta(mesaId: number) {
  const mesa = await prisma.mesa.findUnique({ where: { id: mesaId } });
  if (!mesa) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  const conta = await contaAberta(mesaId);
  const [pedidos, pagamentos] = await Promise.all([
    conta
      ? prisma.pedido.findMany({
          where: { contaId: conta.id, status: { not: 'CANCELADO' } },
          include: incluirPedido,
          orderBy: { criadoEm: 'asc' },
        })
      : Promise.resolve([]),
    conta
      ? prisma.pagamento.findMany({
          where: { contaId: conta.id, status: { in: ['APROVADO', 'PENDENTE'] } },
          include: incluirPagamento,
          orderBy: { criadoEm: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  const lista = pedidos.map(paraPedidoDTO);
  const aprovados = pagamentos.filter((p) => p.status === 'APROVADO');
  const pendente = pagamentos.find((p) => p.status === 'PENDENTE') ?? null;
  const valores = valoresDaConta(
    conta,
    lista.reduce((soma, p) => soma + p.total, 0),
    aprovados.reduce((soma, p) => soma + Number(p.valor), 0)
  );
  return {
    mesa: { id: mesa.id, numero: mesa.numero, nome: mesa.nome },
    conta: conta
      ? {
          id: conta.id,
          taxaServico: conta.taxaServico,
          taxaPercentual: Number(conta.taxaPercentual),
          cpfCnpjCliente: conta.cpfCnpjCliente,
          abertaEm: conta.abertaEm.toISOString(),
        }
      : null,
    pedidos: lista,
    ...valores,
    gorjetas: Math.round(aprovados.reduce((soma, p) => soma + Number(p.gorjeta), 0) * 100) / 100,
    pagamentos: aprovados.map(paraPagamentoDTO),
    pagamentoPendente: pendente ? paraPagamentoDTO(pendente) : null,
  };
}

// Fecha a conta quando ela está quitada: os pedidos ficam pagos e a mesa vai para a limpeza.
// Devolve true se fechou.
export async function fecharSeQuitada(contaId: number): Promise<boolean> {
  const conta = await prisma.conta.findUnique({ where: { id: contaId } });
  if (!conta || conta.status !== 'ABERTA') return false;
  const resumo = await carregarConta(conta.mesaId);
  if (resumo.pedidos.length === 0 || resumo.restante > 0.004) return false;
  const agora = new Date();
  const formas = [...new Set(resumo.pagamentos.map((p) => p.formaPagamento))];
  await prisma.$transaction([
    prisma.pedido.updateMany({
      where: { contaId, pagoEm: null, status: { not: 'CANCELADO' } },
      data: { pagoEm: agora, formaPagamento: formas.length === 1 ? formas[0] : 'Dividido', status: 'ENTREGUE' },
    }),
    prisma.conta.update({ where: { id: contaId }, data: { status: 'FECHADA', fechadaEm: agora } }),
    prisma.mesa.update({ where: { id: conta.mesaId }, data: { chamandoDesde: null } }),
  ]);
  await liberarParaLimpeza(conta.mesaId, true);
  // Com a emissão automática ligada, a nota sai em segundo plano.
  emitirSeAutomatico(contaId);
  return true;
}

export async function aprovarPagamento(id: number, codigoAutorizacao?: string | null): Promise<void> {
  const atualizado = await prisma.pagamento.updateMany({
    where: { id, status: 'PENDENTE' },
    data: { status: 'APROVADO', concluidoEm: new Date(), codigoAutorizacao: codigoAutorizacao ?? null, mensagem: null },
  });
  if (atualizado.count === 0) return;
  const pagamento = await prisma.pagamento.findUnique({ where: { id }, select: { contaId: true } });
  if (pagamento?.contaId) {
    await fecharSeQuitada(pagamento.contaId);
  }
}

// Pagamento que não deu certo: a parte dele continua em aberto na conta.
export async function encerrarSemPagar(
  id: number,
  status: 'RECUSADO' | 'CANCELADO',
  mensagem?: string | null
): Promise<void> {
  await prisma.pagamento.updateMany({
    where: { id, status: 'PENDENTE' },
    data: { status, concluidoEm: new Date(), mensagem: mensagem ?? null },
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
