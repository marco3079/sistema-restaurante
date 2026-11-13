import type { Prisma } from '@prisma/client';
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

// Conta com o cupom e o cliente (quando houver).
export const incluirConta = {
  cupom: true,
  cliente: { select: { id: true, nome: true, telefone: true, pontos: true } },
} satisfies Prisma.ContaInclude;

export type ContaCompleta = Prisma.ContaGetPayload<{ include: typeof incluirConta }>;

export async function contaAberta(mesaId: number): Promise<ContaCompleta | null> {
  return prisma.conta.findFirst({
    where: { mesaId, status: 'ABERTA' },
    orderBy: { id: 'desc' },
    include: incluirConta,
  });
}

// Conta aberta da mesa; se não houver, abre uma com a taxa de serviço que o gestor configurou.
export async function garantirConta(mesaId: number): Promise<ContaCompleta> {
  const atual = await contaAberta(mesaId);
  if (atual) return atual;
  const configuracao = await lerConfiguracao();
  const percentual = Number(configuracao.taxaServicoPercentual);
  return prisma.conta.create({
    data: { mesaId, taxaPercentual: percentual.toFixed(2), taxaServico: percentual > 0 },
    include: incluirConta,
  });
}

// Dado da conta que entra no cálculo. Campos ausentes valem 0 ou nulo.
export interface ContaParaValores {
  taxaServico: boolean;
  taxaPercentual: unknown;
  descontoManual?: unknown;
  pontosUsados?: number;
  valorDoPonto?: unknown;
  cupom?: { percentual: unknown; valor: unknown; minimo: unknown } | null;
}

// Número a partir de um campo Decimal ou ausente; o que não é número vale 0.
function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

// Valores da conta, em reais. `pago` soma só os pagamentos aprovados; gorjeta não abate a conta.
// Descontos na ordem cupom -> pontos -> manual; cada um limitado ao que ainda resta do subtotal.
export function valoresDaConta(
  conta: ContaParaValores | null,
  subtotal: number,
  pago: number
): {
  subtotal: number;
  descontoCupom: number;
  descontoPontos: number;
  descontoManual: number;
  desconto: number;
  taxa: number;
  total: number;
  pago: number;
  restante: number;
} {
  const sub = centavos(subtotal);
  let resta = sub;

  // Cupom: só vale com consumo mínimo atingido. Percentual tem prioridade sobre valor fixo.
  let descontoCupom = 0;
  const cupom = conta?.cupom ?? null;
  if (cupom && sub >= centavos(numero(cupom.minimo))) {
    const percentual = numero(cupom.percentual);
    const bruto = percentual > 0 ? Math.round((sub * percentual) / 100) : centavos(numero(cupom.valor));
    descontoCupom = Math.min(Math.max(0, bruto), resta);
    resta -= descontoCupom;
  }

  // Pontos: cada ponto usado vale o valor do ponto configurado (em reais).
  const brutoPontos = Math.round((conta?.pontosUsados ?? 0) * numero(conta?.valorDoPonto) * 100);
  const descontoPontos = Math.min(Math.max(0, brutoPontos), resta);
  resta -= descontoPontos;

  // Desconto manual lançado pelo gestor.
  const brutoManual = centavos(numero(conta?.descontoManual));
  const descontoManual = Math.min(Math.max(0, brutoManual), resta);
  resta -= descontoManual;

  const desconto = sub - resta;
  const base = sub - desconto;
  const taxa = conta && conta.taxaServico ? Math.round((base * numero(conta.taxaPercentual)) / 100) : 0;
  const total = base + taxa;
  const quitado = centavos(pago);
  return {
    subtotal: reais(sub),
    descontoCupom: reais(descontoCupom),
    descontoPontos: reais(descontoPontos),
    descontoManual: reais(descontoManual),
    desconto: reais(desconto),
    taxa: reais(taxa),
    total: reais(total),
    pago: reais(quitado),
    restante: reais(Math.max(0, total - quitado)),
  };
}
