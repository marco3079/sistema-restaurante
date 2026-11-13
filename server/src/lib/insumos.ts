import type { Prisma, TipoMovimento } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { itensParaBaixa } from './combos';

// Insumos (matéria-prima) e ficha técnica. O saldo do insumo pode ficar negativo:
// a venda não é barrada por falta de insumo. Quantidades são Decimal no banco (3 casas) e custo com 4.

type Cliente = Prisma.TransactionClient;

// Soma `delta` ao saldo do insumo (negativo = saída) e grava o movimento. O saldo PODE ficar negativo
// (a venda não é barrada por falta de insumo). Devolve o saldo novo.
export async function movimentarInsumo(
  tx: Cliente,
  insumoId: number,
  tipo: TipoMovimento,
  delta: number,
  motivo: string | null,
  usuarioNome: string | null
): Promise<number> {
  const valor = Number(delta.toFixed(3));
  const insumo = await tx.insumo.update({
    where: { id: insumoId },
    data: { estoque: { increment: valor } },
    select: { estoque: true },
  });
  const saldo = Number(insumo.estoque);
  await tx.movimentoInsumo.create({
    data: {
      insumoId,
      tipo,
      quantidade: valor.toFixed(3),
      saldo: saldo.toFixed(3),
      motivo,
      usuarioNome,
    },
  });
  return saldo;
}

// Entrada com custo: soma a quantidade e recalcula o custo médio ponderado
// (novoCusto = (saldoAntes * custoAntes + quantidade * custoUnitario) / (saldoAntes + quantidade); se saldoAntes <= 0, novoCusto = custoUnitario).
// Com custoUnitario null, o custo não muda. Devolve o saldo novo.
export async function entradaDeInsumo(
  tx: Cliente,
  dados: {
    insumoId: number;
    quantidade: number;
    custoUnitario: number | null;
    motivo: string | null;
    usuarioNome: string | null;
  }
): Promise<number> {
  const insumo = await tx.insumo.findUnique({
    where: { id: dados.insumoId },
    select: { estoque: true, custoUnitario: true },
  });
  if (!insumo) {
    throw new HttpError(404, 'Insumo não encontrado');
  }
  const saldoAntes = Number(insumo.estoque);
  const custoAntes = Number(insumo.custoUnitario);

  let novoCusto: number | null = null;
  if (dados.custoUnitario !== null) {
    novoCusto =
      saldoAntes <= 0
        ? dados.custoUnitario
        : (saldoAntes * custoAntes + dados.quantidade * dados.custoUnitario) / (saldoAntes + dados.quantidade);
  }

  const saldo = await movimentarInsumo(tx, dados.insumoId, 'ENTRADA', dados.quantidade, dados.motivo, dados.usuarioNome);
  if (novoCusto !== null) {
    await tx.insumo.update({
      where: { id: dados.insumoId },
      data: { custoUnitario: novoCusto.toFixed(4) },
    });
  }
  return saldo;
}

// Soma, por insumo, quanto cada item do pedido consome segundo a ficha técnica do produto.
async function consumoDasFichas(
  tx: Cliente,
  itens: { produtoId: number; quantidade: number }[]
): Promise<Map<number, number>> {
  const fichas = await tx.fichaItem.findMany({
    where: { produtoId: { in: itens.map((i) => i.produtoId) } },
    select: { produtoId: true, insumoId: true, quantidade: true },
  });
  const consumo = new Map<number, number>();
  for (const item of itens) {
    for (const ficha of fichas) {
      if (ficha.produtoId !== item.produtoId) continue;
      const anterior = consumo.get(ficha.insumoId) ?? 0;
      consumo.set(ficha.insumoId, anterior + Number(ficha.quantidade) * item.quantidade);
    }
  }
  return consumo;
}

// Baixa os insumos das fichas técnicas dos produtos do pedido (quantidade da ficha x quantidade do item),
// somando por insumo. Tipo VENDA, motivo `Pedido #<id>`. Produto sem ficha: nada acontece.
export async function baixarInsumosPorPedido(
  tx: Cliente,
  itens: { produtoId: number; quantidade: number }[],
  pedidoId: number
): Promise<void> {
  const consumo = await consumoDasFichas(tx, itens);
  for (const [insumoId, quantidade] of consumo) {
    await movimentarInsumo(tx, insumoId, 'VENDA', -quantidade, `Pedido #${pedidoId}`, null);
  }
}

// Pedido cancelado: devolve os insumos (tipo DEVOLUCAO, motivo `Pedido #<id> cancelado`). Abre a própria transação.
export async function devolverInsumosPorPedido(pedidoId: number): Promise<void> {
  const itens = await prisma.itemPedido.findMany({
    where: { pedidoId },
    select: { produtoId: true, quantidade: true },
  });
  if (itens.length === 0) return;
  await prisma.$transaction(async (tx) => {
    // Mesma conta da baixa: combos trocados pelos componentes (e o próprio combo).
    const baixados = await itensParaBaixa(tx, itens);
    const consumo = await consumoDasFichas(tx, baixados);
    for (const [insumoId, quantidade] of consumo) {
      await movimentarInsumo(tx, insumoId, 'DEVOLUCAO', quantidade, `Pedido #${pedidoId} cancelado`, null);
    }
  });
}
