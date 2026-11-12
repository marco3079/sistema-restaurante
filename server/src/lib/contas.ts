import type { Conta } from '@prisma/client';
import { prisma } from './prisma';
import { lerConfiguracao } from './email';

// Conta da mesa: abre com o primeiro pedido e fecha quando o total (pedidos + taxa de serviço) é pago,
// em um ou em vários pagamentos.

export function centavos(valor: number): number {
  return Math.round(valor * 100);
}

export function reais(valorEmCentavos: number): number {
  return Math.round(valorEmCentavos) / 100;
}

export async function contaAberta(mesaId: number): Promise<Conta | null> {
  return prisma.conta.findFirst({ where: { mesaId, status: 'ABERTA' }, orderBy: { id: 'desc' } });
}

// Conta aberta da mesa; se não houver, abre uma com a taxa de serviço que o gestor configurou.
export async function garantirConta(mesaId: number): Promise<Conta> {
  const atual = await contaAberta(mesaId);
  if (atual) return atual;
  const configuracao = await lerConfiguracao();
  const percentual = Number(configuracao.taxaServicoPercentual);
  return prisma.conta.create({
    data: { mesaId, taxaPercentual: percentual.toFixed(2), taxaServico: percentual > 0 },
  });
}

// Valores da conta, em reais. `pago` soma só os pagamentos aprovados; gorjeta não abate a conta.
export function valoresDaConta(
  conta: { taxaServico: boolean; taxaPercentual: unknown } | null,
  subtotal: number,
  pago: number
): { subtotal: number; taxa: number; total: number; pago: number; restante: number } {
  const sub = centavos(subtotal);
  const taxa = conta && conta.taxaServico ? Math.round((sub * Number(conta.taxaPercentual)) / 100) : 0;
  const total = sub + taxa;
  const quitado = centavos(pago);
  return {
    subtotal: reais(sub),
    taxa: reais(taxa),
    total: reais(total),
    pago: reais(quitado),
    restante: reais(Math.max(0, total - quitado)),
  };
}
