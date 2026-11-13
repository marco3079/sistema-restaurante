import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// Combos: um produto com combo = true vem com outros produtos (comboItens).

// Troca cada item que é combo pelos produtos que o compõem (quantidade do combo x quantidade no combo),
// somando por produto. Item que não é combo passa igual. Usado só para baixa de estoque e de insumos.
export async function expandirCombos(
  tx: Prisma.TransactionClient | typeof prisma,
  itens: { produtoId: number; quantidade: number }[]
): Promise<{ produtoId: number; quantidade: number }[]> {
  const ids = [...new Set(itens.map((i) => i.produtoId))];
  const combos = await tx.produto.findMany({
    where: { id: { in: ids }, combo: true },
    select: { id: true, comboItens: { select: { produtoId: true, quantidade: true } } },
  });
  const componentesDo = new Map(combos.map((c) => [c.id, c.comboItens]));
  const somados = new Map<number, number>();
  const somar = (produtoId: number, quantidade: number) => {
    somados.set(produtoId, (somados.get(produtoId) ?? 0) + quantidade);
  };
  for (const item of itens) {
    const componentes = componentesDo.get(item.produtoId);
    if (!componentes) {
      somar(item.produtoId, item.quantidade);
      continue;
    }
    for (const c of componentes) {
      somar(c.produtoId, item.quantidade * c.quantidade);
    }
  }
  return [...somados].map(([produtoId, quantidade]) => ({ produtoId, quantidade }));
}

// Tudo o que um pedido baixa (estoque e insumos) e devolve no cancelamento: os componentes dos combos
// (expandirCombos) mais o próprio combo, porque ele pode ter estoque ou ficha técnica próprios.
export async function itensParaBaixa(
  tx: Prisma.TransactionClient,
  itens: { produtoId: number; quantidade: number }[]
): Promise<{ produtoId: number; quantidade: number }[]> {
  const expandidos = await expandirCombos(tx, itens);
  const ids = [...new Set(itens.map((i) => i.produtoId))];
  const combos = await tx.produto.findMany({ where: { id: { in: ids }, combo: true }, select: { id: true } });
  const idsDeCombo = new Set(combos.map((c) => c.id));
  return [...expandidos, ...itens.filter((i) => idsDeCombo.has(i.produtoId))];
}
