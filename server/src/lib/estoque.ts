import type { Prisma, TipoMovimento } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';

// Estoque por produto. Só vale para os produtos com o controle ligado.
// Cada pedido baixa o saldo; ao zerar, o item esgota sozinho; cancelar o pedido devolve.

type Cliente = Prisma.TransactionClient;

async function movimentar(
  tx: Cliente,
  produtoId: number,
  tipo: TipoMovimento,
  quantidade: number,
  motivo: string | null,
  usuarioNome: string | null
): Promise<number> {
  const produto = await tx.produto.update({
    where: { id: produtoId },
    data: { estoque: { increment: quantidade } },
    select: { estoque: true, disponivel: true, nome: true },
  });
  if (produto.estoque < 0) {
    throw new HttpError(400, `"${produto.nome}" não tem estoque suficiente.`);
  }
  // Zerou: esgota. Voltou a ter: fica disponível de novo.
  if (produto.estoque === 0 && produto.disponivel) {
    await tx.produto.update({ where: { id: produtoId }, data: { disponivel: false } });
  } else if (produto.estoque > 0 && !produto.disponivel && quantidade > 0) {
    await tx.produto.update({ where: { id: produtoId }, data: { disponivel: true } });
  }
  await tx.movimentoEstoque.create({
    data: { produtoId, tipo, quantidade, saldo: produto.estoque, motivo, usuarioNome },
  });
  return produto.estoque;
}

// Baixa do pedido. `itens` já vem somado por produto. Recusa o pedido se faltar estoque.
export async function baixarPorPedido(
  tx: Cliente,
  itens: { produtoId: number; quantidade: number }[],
  pedidoId: number
): Promise<void> {
  const controlados = await tx.produto.findMany({
    where: { id: { in: itens.map((i) => i.produtoId) }, controlaEstoque: true },
    select: { id: true, nome: true, estoque: true },
  });
  for (const produto of controlados) {
    const quantidade = itens.filter((i) => i.produtoId === produto.id).reduce((soma, i) => soma + i.quantidade, 0);
    if (quantidade > produto.estoque) {
      throw new HttpError(
        400,
        produto.estoque === 0
          ? `"${produto.nome}" acabou.`
          : `Só ${produto.estoque === 1 ? 'resta 1 unidade' : `restam ${produto.estoque} unidades`} de "${produto.nome}".`
      );
    }
    await movimentar(tx, produto.id, 'VENDA', -quantidade, `Pedido #${pedidoId}`, null);
  }
}

// Pedido cancelado: os itens com controle voltam para o estoque.
export async function devolverPorPedido(pedidoId: number): Promise<void> {
  const itens = await prisma.itemPedido.findMany({
    where: { pedidoId, produto: { controlaEstoque: true } },
    select: { produtoId: true, quantidade: true },
  });
  if (itens.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const item of itens) {
      await movimentar(tx, item.produtoId, 'DEVOLUCAO', item.quantidade, `Pedido #${pedidoId} cancelado`, null);
    }
  });
}

// Entrada, saída ou acerto de contagem lançado pelo gestor.
export async function lancarMovimento(dados: {
  produtoId: number;
  tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
  quantidade: number;
  motivo: string | null;
  usuarioNome: string | null;
}): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const produto = await tx.produto.findFirst({
      where: { id: dados.produtoId, ativo: true },
      select: { estoque: true, controlaEstoque: true },
    });
    if (!produto) {
      throw new HttpError(404, 'Produto não encontrado');
    }
    if (!produto.controlaEstoque) {
      throw new HttpError(400, 'Este produto não tem controle de estoque. Ligue o controle no cadastro do produto.');
    }
    // No AJUSTE a quantidade é o saldo contado; nos outros, quanto entra ou sai.
    const delta =
      dados.tipo === 'AJUSTE'
        ? dados.quantidade - produto.estoque
        : dados.tipo === 'ENTRADA'
          ? dados.quantidade
          : -dados.quantidade;
    if (delta === 0) return produto.estoque;
    return movimentar(tx, dados.produtoId, dados.tipo, delta, dados.motivo, dados.usuarioNome);
  });
}

// Entrada de produto por compra recebida, dentro da transação de quem chama.
// Devolve o saldo novo. Se o produto não tem controle de estoque, não faz nada e devolve null.
export async function entradaPorCompra(
  tx: Cliente,
  produtoId: number,
  quantidade: number,
  motivo: string | null,
  usuarioNome: string | null
): Promise<number | null> {
  const produto = await tx.produto.findUnique({ where: { id: produtoId }, select: { controlaEstoque: true } });
  if (!produto || !produto.controlaEstoque) return null;
  return movimentar(tx, produtoId, 'ENTRADA', quantidade, motivo, usuarioNome);
}
