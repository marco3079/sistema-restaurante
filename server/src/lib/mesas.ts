import { prisma } from './prisma';

// Estado da mesa: LIVRE -> OCUPADA -> LIMPEZA -> LIVRE.
// Ocupa: o cliente chama o garçom ou faz um pedido, ou o garçom marca a mesa como ocupada.
// Vai para a limpeza: a conta é paga, ou o garçom libera a mesa.
// Fica livre: a limpeza (ou o garçom, ou o gestor) marca a mesa como limpa.

export async function ocuparMesa(mesaId: number): Promise<void> {
  await prisma.mesa.updateMany({
    where: { id: mesaId, estado: { not: 'OCUPADA' } },
    data: { estado: 'OCUPADA', estadoDesde: new Date() },
  });
}

// Só manda para a limpeza se não sobrou pedido em aberto na mesa.
// `aposPagamento`: a mesa tinha conta, então estava ocupada mesmo que o estado gravado diga outra coisa
// (mesas com conta aberta de antes de existir o estado).
export async function liberarParaLimpeza(mesaId: number, aposPagamento = false): Promise<boolean> {
  const abertos = await prisma.pedido.count({
    where: { mesaId, pagoEm: null, status: { not: 'CANCELADO' } },
  });
  if (abertos > 0) return false;
  await prisma.mesa.updateMany({
    where: { id: mesaId, estado: aposPagamento ? { not: 'LIMPEZA' } : 'OCUPADA' },
    data: { estado: 'LIMPEZA', estadoDesde: new Date(), chamandoDesde: null },
  });
  return true;
}

export async function marcarMesaLimpa(mesaId: number): Promise<void> {
  await prisma.mesa.updateMany({
    where: { id: mesaId, estado: 'LIMPEZA' },
    data: { estado: 'LIVRE', estadoDesde: new Date() },
  });
}
