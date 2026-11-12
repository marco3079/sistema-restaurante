import crypto from 'crypto';
import { z } from 'zod';
import type { OrigemPedido, Prisma, StatusPedido } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';

// Regras comuns aos pedidos feitos pela equipe e pelo cardápio da mesa.

export const STATUS_EM_ANDAMENTO: StatusPedido[] = ['NOVO', 'EM_PREPARO', 'PRONTO'];

export const itensSchema = z
  .array(
    z.object({
      produtoId: z.number().int().positive(),
      quantidade: z.number().int().min(1, 'Quantidade mínima: 1').max(50, 'Quantidade máxima: 50'),
      observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
    })
  )
  .min(1, 'Escolha pelo menos um item')
  .max(40, 'Itens demais em um só pedido');

export type ItemEntrada = z.infer<typeof itensSchema>[number];

export const incluirPedido = {
  itens: { orderBy: { id: 'asc' } },
  mesa: { select: { id: true, numero: true, nome: true } },
  garcom: { select: { id: true, nome: true } },
} satisfies Prisma.PedidoInclude;

type PedidoCompleto = Prisma.PedidoGetPayload<{ include: typeof incluirPedido }>;

export function paraPedidoDTO(p: PedidoCompleto) {
  return {
    id: p.id,
    mesa: p.mesa,
    status: p.status,
    origem: p.origem,
    nomeCliente: p.nomeCliente,
    observacao: p.observacao,
    garcom: p.garcom,
    total: Number(p.total),
    pagoEm: p.pagoEm ? p.pagoEm.toISOString() : null,
    formaPagamento: p.formaPagamento,
    criadoEm: p.criadoEm.toISOString(),
    atualizadoEm: p.atualizadoEm.toISOString(),
    itens: p.itens.map((i) => ({
      id: i.id,
      produtoId: i.produtoId,
      nomeProduto: i.nomeProduto,
      precoUnitario: Number(i.precoUnitario),
      quantidade: i.quantidade,
      observacao: i.observacao,
    })),
  };
}

export type PedidoDTO = ReturnType<typeof paraPedidoDTO>;

function textoOuNulo(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// Cria o pedido com o preço e o nome dos produtos copiados do cardápio no momento.
// Recusa produto fora do cardápio ou esgotado.
export async function criarPedido(entrada: {
  mesaId: number;
  origem: OrigemPedido;
  itens: ItemEntrada[];
  nomeCliente?: string | null;
  observacao?: string | null;
  garcomId?: number | null;
}): Promise<PedidoDTO> {
  // Junta linhas repetidas do mesmo produto sem observação.
  const ids = [...new Set(entrada.itens.map((i) => i.produtoId))];
  const produtos = await prisma.produto.findMany({
    where: { id: { in: ids } },
    include: { categoria: { select: { ativa: true } } },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));

  let totalCentavos = 0;
  const linhas = entrada.itens.map((item) => {
    const produto = porId.get(item.produtoId);
    if (!produto || !produto.ativo || !produto.categoria.ativa) {
      throw new HttpError(400, 'Um dos itens não está mais no cardápio. Atualize a página.');
    }
    if (!produto.disponivel) {
      throw new HttpError(400, `"${produto.nome}" está esgotado no momento.`);
    }
    totalCentavos += Math.round(Number(produto.preco) * 100) * item.quantidade;
    return {
      produtoId: produto.id,
      nomeProduto: produto.nome,
      precoUnitario: produto.preco,
      quantidade: item.quantidade,
      observacao: textoOuNulo(item.observacao),
    };
  });

  const pedido = await prisma.pedido.create({
    data: {
      mesaId: entrada.mesaId,
      origem: entrada.origem,
      nomeCliente: textoOuNulo(entrada.nomeCliente),
      observacao: textoOuNulo(entrada.observacao),
      garcomId: entrada.garcomId ?? null,
      total: (totalCentavos / 100).toFixed(2),
      itens: { create: linhas },
    },
    include: incluirPedido,
  });
  return paraPedidoDTO(pedido);
}

// Segredo do endereço do cardápio da mesa (vai no QR code).
export function novoCodigoDeMesa(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function inicioDoDia(base = new Date()): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}
