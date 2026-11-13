import type { Promocao } from '@prisma/client';
import { prisma } from './prisma';

// Preço que vale agora para um produto, com as promoções por horário.
// Os valores de tabela ficam no banco em reais; as contas aqui são em centavos.

export interface PrecoDoProduto {
  preco: number;
  precoOriginal: number | null;
  promocao: string | null;
}

// "HH:mm" em minutos desde a meia-noite. Texto inválido = null.
function minutosDoDia(hora: string): number | null {
  const partes = hora.split(':');
  if (partes.length !== 2) return null;
  const h = Number(partes[0]);
  const m = Number(partes[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// A promoção vale neste horário (dia da semana, hora e data).
export function valeNoHorario(p: Promocao, agora: Date): boolean {
  if (p.dataInicio && agora.getTime() < p.dataInicio.getTime()) return false;
  if (p.dataFim && agora.getTime() > p.dataFim.getTime()) return false;
  if (p.diasSemana.length > 0 && !p.diasSemana.includes(agora.getDay())) return false;
  const inicio = minutosDoDia(p.horaInicio);
  const fim = minutosDoDia(p.horaFim);
  if (inicio === null || fim === null) return false;
  const hora = agora.getHours() * 60 + agora.getMinutes();
  // Se o fim é antes do início, a janela atravessa a meia-noite.
  if (fim < inicio) return hora >= inicio || hora <= fim;
  return hora >= inicio && hora <= fim;
}

// Promoções ativas e dentro da data, lidas uma vez por requisição.
export async function promocoesValendo(agora: Date = new Date()): Promise<Promocao[]> {
  const lista = await prisma.promocao.findMany({ where: { ativa: true } });
  return lista.filter((p) => {
    if (p.dataInicio && agora.getTime() < p.dataInicio.getTime()) return false;
    if (p.dataFim && agora.getTime() > p.dataFim.getTime()) return false;
    return true;
  });
}

// Preço que vale agora para o produto. Sem promoção: preço de tabela.
export function precoAgora(
  produto: { id: number; categoriaId: number; preco: unknown },
  promocoes: Promocao[],
  agora: Date = new Date()
): PrecoDoProduto {
  const tabela = Math.round(Number(produto.preco) * 100);
  let melhor: { centavos: number; nome: string } | null = null;

  for (const p of promocoes) {
    if (!p.ativa) continue;
    // Alvo: o produto; ou a categoria (sem produto); ou o cardápio todo (sem produto e sem categoria).
    const alvo =
      p.produtoId !== null && p.produtoId !== undefined
        ? p.produtoId === produto.id
        : p.categoriaId === null || p.categoriaId === undefined || p.categoriaId === produto.categoriaId;
    if (!alvo) continue;
    if (!valeNoHorario(p, agora)) continue;

    let precoPromo: number | null = null;
    if (p.produtoId !== null && p.produtoId !== undefined && p.precoFixo !== null && p.precoFixo !== undefined) {
      precoPromo = Math.round(Number(p.precoFixo) * 100);
    } else if (p.percentual !== null && p.percentual !== undefined) {
      precoPromo = Math.round(tabela * (1 - Number(p.percentual) / 100));
    }
    if (precoPromo === null) continue;
    // Nunca abaixo de 0 nem acima da tabela.
    const final = Math.min(tabela, Math.max(0, precoPromo));
    if (final >= tabela) continue;
    if (melhor === null || final < melhor.centavos) {
      melhor = { centavos: final, nome: p.nome };
    }
  }

  if (melhor === null) {
    return { preco: tabela / 100, precoOriginal: null, promocao: null };
  }
  return { preco: melhor.centavos / 100, precoOriginal: tabela / 100, promocao: melhor.nome };
}
