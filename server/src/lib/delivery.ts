import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import type { Entrega, StatusPedido, TipoMesa } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { criarPedido, incluirPedido, novoCodigoDeMesa, paraPedidoDTO } from './pedidos';
import type { ItemEntrada, PedidoDTO } from './pedidos';
import { fecharSeQuitada, FORMAS_PAGAMENTO } from './pagamentos';
import { incluirConta, valoresDaConta } from './contas';
import { devolverPorPedido } from './estoque';
import { devolverInsumosPorPedido } from './insumos';
import { lerConfiguracao } from './email';

// Delivery e retirada no balcão: cada pedido vira uma mesa virtual (tipo DELIVERY ou RETIRADA) com conta,
// pedido e a entrega (dados do cliente). A mesa virtual é encerrada quando a conta fecha ou o pedido é cancelado.

type PedidoCompleto = Prisma.PedidoGetPayload<{ include: typeof incluirPedido }>;

export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export type SituacaoEntrega = 'RECEBIDO' | 'EM_PREPARO' | 'PRONTO' | 'SAIU' | 'CONCLUIDO' | 'CANCELADO';

export interface ContaDaEntrega {
  subtotal: number;
  taxaEntrega: number;
  desconto: number;
  total: number;
  pago: number;
  restante: number;
}

export type EntregaPedidoDTO = PedidoDTO & { situacao: SituacaoEntrega; conta: ContaDaEntrega };

export interface DadosPedidoDelivery {
  tipo: 'DELIVERY' | 'RETIRADA';
  nome: string;
  telefone: string; // só dígitos (ou com pontuação: a função tira)
  endereco?: string | null;
  complemento?: string | null;
  bairroId?: number | null;
  referencia?: string | null;
  formaPagamento: FormaPagamento;
  trocoPara?: number | null;
  observacao?: string | null;
  itens: ItemEntrada[];
}

const MAXIMO_TENTATIVAS_NUMERO = 3;
const NUMERO_MINIMO_VIRTUAL = 9000;

// Texto sem espaços nas pontas; vazio vira nulo.
function texto(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

function moeda(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

function novoCodigoDeEntrega(): string {
  // 9 bytes aleatórios em base64url: 12 caracteres.
  return crypto.randomBytes(9).toString('base64url');
}

// Cria mesa virtual (número a partir de 9000) e a conta com a taxa de entrega. Tenta de novo se o número colidir.
async function criarMesaVirtual(dados: {
  tipo: 'DELIVERY' | 'RETIRADA';
  nome: string;
  taxaCentavos: number;
}): Promise<{ mesaId: number; contaId: number }> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const maior = await tx.mesa.aggregate({ _max: { numero: true } });
        const numero = Math.max(NUMERO_MINIMO_VIRTUAL, (maior._max.numero ?? 0) + 1);
        const mesa = await tx.mesa.create({
          data: {
            numero,
            nome: dados.nome,
            lugares: 1,
            codigo: novoCodigoDeMesa(),
            tipo: dados.tipo,
            estado: 'OCUPADA',
          },
        });
        const conta = await tx.conta.create({
          data: {
            mesaId: mesa.id,
            taxaServico: false,
            taxaPercentual: '0.00',
            taxaEntrega: (dados.taxaCentavos / 100).toFixed(2),
          },
        });
        return { mesaId: mesa.id, contaId: conta.id };
      });
    } catch (erro) {
      const conflito = erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
      if (!conflito || tentativa >= MAXIMO_TENTATIVAS_NUMERO) throw erro;
    }
  }
}

// Cancela o pedido: partes por setor, estoque e insumos devolvidos. Quem chama cuida da conta e da mesa.
async function cancelarPedido(pedidoId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.pedidoSetor.updateMany({ where: { pedidoId }, data: { status: 'CANCELADO' } });
    await tx.pedido.update({ where: { id: pedidoId }, data: { status: 'CANCELADO' } });
  });
  await devolverPorPedido(pedidoId);
  await devolverInsumosPorPedido(pedidoId);
}

// Desfaz a criação de uma entrega que falhou: cancela o pedido (se foi criado), fecha a conta e desativa a mesa.
async function desfazerMesaVirtual(mesaId: number, contaId: number, pedidoId: number | null): Promise<void> {
  if (pedidoId !== null) {
    await cancelarPedido(pedidoId).catch((erro) =>
      console.error('Falha ao cancelar pedido de delivery que não foi concluído', pedidoId, erro)
    );
  }
  await prisma.conta.updateMany({
    where: { id: contaId, status: 'ABERTA' },
    data: { status: 'FECHADA', fechadaEm: new Date() },
  });
  await prisma.mesa.update({
    where: { id: mesaId },
    data: { ativa: false, estado: 'LIVRE', estadoDesde: new Date(), chamandoDesde: null },
  });
}

// Cria o pedido de delivery ou retirada. O preço, a taxa e o total são sempre do servidor.
export async function criarPedidoDeDelivery(dados: DadosPedidoDelivery): Promise<{
  codigo: string;
  pedidoId: number;
  total: number;
  taxaEntrega: number;
  tempoMin: number;
}> {
  const telefone = dados.telefone.replace(/\D/g, '');
  if (telefone.length !== 10 && telefone.length !== 11) {
    throw new HttpError(400, 'Informe o telefone com DDD');
  }
  const nome = texto(dados.nome) ?? '';
  const endereco = texto(dados.endereco);
  const complemento = texto(dados.complemento);
  const referencia = texto(dados.referencia);
  const observacao = texto(dados.observacao);
  const trocoPara = dados.trocoPara ?? null;
  if (dados.tipo === 'DELIVERY' && endereco === null) {
    throw new HttpError(400, 'Informe o endereço de entrega');
  }
  if (dados.tipo === 'DELIVERY' && (dados.bairroId ?? null) === null) {
    throw new HttpError(400, 'Escolha o bairro da entrega');
  }
  if (trocoPara !== null && dados.formaPagamento !== 'Dinheiro') {
    throw new HttpError(400, 'O troco só vale para pagamento em dinheiro');
  }

  const configuracao = await lerConfiguracao();
  if (dados.tipo === 'DELIVERY' && !configuracao.deliveryAtivo) {
    throw new HttpError(400, 'No momento não estamos recebendo pedidos para entrega');
  }
  if (dados.tipo === 'RETIRADA' && !configuracao.retiradaAtiva) {
    throw new HttpError(400, 'No momento não estamos recebendo pedidos para retirada');
  }

  let taxaCentavos = 0;
  let bairroNome: string | null = null;
  if (dados.tipo === 'DELIVERY') {
    const bairro = await prisma.bairroEntrega.findFirst({ where: { id: dados.bairroId ?? -1, ativo: true } });
    if (!bairro) {
      throw new HttpError(400, 'Este bairro não é atendido. Escolha outro.');
    }
    taxaCentavos = Math.round(Number(bairro.taxa) * 100);
    bairroNome = bairro.nome;
  }
  const minimoCentavos = Math.round(Number(configuracao.deliveryPedidoMinimo) * 100);
  const tempoMin = dados.tipo === 'DELIVERY' ? configuracao.deliveryTempoMin : configuracao.retiradaTempoMin;

  const { mesaId, contaId } = await criarMesaVirtual({ tipo: dados.tipo, nome, taxaCentavos });
  let pedidoId: number | null = null;
  try {
    const pedido = await criarPedido({
      mesaId,
      contaId,
      origem: 'CLIENTE',
      itens: dados.itens,
      nomeCliente: nome,
      observacao,
    });
    pedidoId = pedido.id;
    const subtotalCentavos = Math.round(pedido.total * 100);
    if (subtotalCentavos < minimoCentavos) {
      throw new HttpError(400, `O pedido mínimo é R$ ${moeda(minimoCentavos / 100)}`);
    }
    const totalCentavos = subtotalCentavos + taxaCentavos;
    if (trocoPara !== null && Math.round(trocoPara * 100) <= totalCentavos) {
      throw new HttpError(400, 'O troco precisa ser maior que o total do pedido');
    }
    const codigo = novoCodigoDeEntrega();
    await prisma.entrega.create({
      data: {
        pedidoId: pedido.id,
        tipo: dados.tipo,
        codigo,
        nomeCliente: nome,
        telefone,
        endereco: dados.tipo === 'DELIVERY' ? endereco : null,
        complemento: dados.tipo === 'DELIVERY' ? complemento : null,
        bairro: bairroNome,
        referencia: dados.tipo === 'DELIVERY' ? referencia : null,
        taxaEntrega: (taxaCentavos / 100).toFixed(2),
        formaPagamento: dados.formaPagamento,
        trocoPara: trocoPara === null ? null : trocoPara.toFixed(2),
      },
    });
    return {
      codigo,
      pedidoId: pedido.id,
      total: totalCentavos / 100,
      taxaEntrega: taxaCentavos / 100,
      tempoMin,
    };
  } catch (erro) {
    await desfazerMesaVirtual(mesaId, contaId, pedidoId);
    throw erro;
  }
}

// Situação para o cliente e para a equipe.
export function situacaoDaEntrega(pedido: { status: StatusPedido; entrega: Entrega | null }): SituacaoEntrega {
  if (pedido.status === 'CANCELADO') return 'CANCELADO';
  if (pedido.entrega?.concluidoEm) return 'CONCLUIDO';
  if (pedido.entrega?.saiuEm) return 'SAIU';
  if (pedido.status === 'NOVO') return 'RECEBIDO';
  if (pedido.status === 'EM_PREPARO') return 'EM_PREPARO';
  // PRONTO, e ENTREGUE sem conclusão: esperando a entrega ou a retirada.
  return 'PRONTO';
}

// Valores da conta de cada pedido (conta inteira, mesmo depois de fechada).
async function valoresDasEntregas(pedidos: PedidoCompleto[]): Promise<Map<number, ReturnType<typeof valoresDaConta>>> {
  const contaIds = [...new Set(pedidos.map((p) => p.contaId).filter((id): id is number => id !== null))];
  const [contas, pedidosDaConta, pagos] = await Promise.all([
    prisma.conta.findMany({ where: { id: { in: contaIds } }, include: incluirConta }),
    prisma.pedido.findMany({
      where: { contaId: { in: contaIds }, status: { not: 'CANCELADO' } },
      select: { contaId: true, total: true },
    }),
    prisma.pagamento.groupBy({
      by: ['contaId'],
      where: { contaId: { in: contaIds }, status: 'APROVADO' },
      _sum: { valor: true },
    }),
  ]);
  const resultado = new Map<number, ReturnType<typeof valoresDaConta>>();
  for (const pedido of pedidos) {
    const conta = contas.find((c) => c.id === pedido.contaId) ?? null;
    const subtotal =
      pedido.contaId === null
        ? Number(pedido.total)
        : Math.round(
            pedidosDaConta
              .filter((p) => p.contaId === pedido.contaId)
              .reduce((soma, p) => soma + Number(p.total), 0) * 100
          ) / 100;
    const pago =
      pedido.contaId === null ? 0 : Number(pagos.find((p) => p.contaId === pedido.contaId)?._sum.valor ?? 0);
    resultado.set(pedido.id, valoresDaConta(conta, subtotal, pago));
  }
  return resultado;
}

// Pedidos de entrega no formato da equipe: pedido + situação + valores da conta.
export async function paraEntregasPedidoDTO(pedidos: PedidoCompleto[]): Promise<EntregaPedidoDTO[]> {
  const valores = await valoresDasEntregas(pedidos);
  return pedidos.map((p) => {
    const v = valores.get(p.id) ?? valoresDaConta(null, 0, 0);
    return {
      ...paraPedidoDTO(p),
      situacao: situacaoDaEntrega(p),
      conta: {
        subtotal: v.subtotal,
        taxaEntrega: v.taxaEntrega,
        desconto: v.desconto,
        total: v.total,
        pago: v.pago,
        restante: v.restante,
      },
    };
  });
}

export async function paraEntregaPedidoDTO(pedido: PedidoCompleto): Promise<EntregaPedidoDTO> {
  const [dto] = await paraEntregasPedidoDTO([pedido]);
  return dto;
}

// Pedido de entrega (ou retirada) pelo id; 404 se não for de delivery ou retirada.
async function buscarEntrega(id: number): Promise<{ pedido: PedidoCompleto; entrega: Entrega }> {
  const pedido = await prisma.pedido.findUnique({ where: { id }, include: incluirPedido });
  if (!pedido || !pedido.entrega || pedido.mesa.tipo === 'SALAO') {
    throw new HttpError(404, 'Pedido de entrega não encontrado');
  }
  return { pedido, entrega: pedido.entrega };
}

async function respostaDaEntrega(id: number): Promise<EntregaPedidoDTO> {
  const { pedido } = await buscarEntrega(id);
  return paraEntregaPedidoDTO(pedido);
}

// Entregador saiu com o pedido pronto (só entrega; retirada não sai).
export async function marcarSaiu(id: number, entregadorNome?: string | null): Promise<EntregaPedidoDTO> {
  const { pedido, entrega } = await buscarEntrega(id);
  if (entrega.tipo !== 'DELIVERY') {
    throw new HttpError(400, 'Só entrega sai para rua. Na retirada o cliente vem buscar.');
  }
  if (pedido.status === 'CANCELADO') {
    throw new HttpError(400, 'Este pedido foi cancelado.');
  }
  if (entrega.concluidoEm || pedido.status === 'ENTREGUE') {
    throw new HttpError(409, 'Este pedido já foi concluído');
  }
  if (entrega.saiuEm) {
    throw new HttpError(409, 'Este pedido já saiu para entrega');
  }
  if (pedido.status !== 'PRONTO') {
    throw new HttpError(400, 'O pedido só sai depois de ficar pronto');
  }
  const marcou = await prisma.entrega.updateMany({
    where: { id: entrega.id, saiuEm: null },
    data: { saiuEm: new Date(), entregadorNome: texto(entregadorNome) },
  });
  if (marcou.count === 0) {
    throw new HttpError(409, 'Este pedido já saiu para entrega');
  }
  return respostaDaEntrega(id);
}

// Entregue ou retirado: cria o pagamento do que falta (se houver), marca o pedido como entregue e fecha a conta se quitou.
export async function concluirEntrega(
  id: number,
  formaPagamento: FormaPagamento,
  usuario: { id: number }
): Promise<EntregaPedidoDTO> {
  const { pedido, entrega } = await buscarEntrega(id);
  if (pedido.status === 'CANCELADO') {
    throw new HttpError(400, 'Este pedido foi cancelado. Lance um novo pedido.');
  }
  if (entrega.concluidoEm) {
    throw new HttpError(409, 'Este pedido já foi concluído');
  }
  const contaId = pedido.contaId;
  if (contaId === null) {
    throw new HttpError(409, 'Esta entrega não tem conta aberta');
  }
  if (pedido.status !== 'PRONTO' && pedido.status !== 'ENTREGUE') {
    throw new HttpError(409, 'O pedido ainda não está pronto');
  }
  const agora = new Date();
  await prisma.$transaction(async (tx) => {
    // Só uma conclusão passa: a segunda chamada concorrente cai aqui.
    const marcou = await tx.entrega.updateMany({
      where: { id: entrega.id, concluidoEm: null },
      data: { concluidoEm: agora },
    });
    if (marcou.count === 0) {
      throw new HttpError(409, 'Este pedido já foi concluído');
    }
    const mudou = await tx.pedido.updateMany({
      where: { id, status: { not: 'CANCELADO' } },
      data: { status: 'ENTREGUE', entregueEm: agora },
    });
    if (mudou.count === 0) {
      throw new HttpError(409, 'Este pedido foi cancelado');
    }
    // O restante é lido dentro da transação, depois da mudança: pagamento paralelo não gera valor errado.
    const conta = await tx.conta.findUnique({ where: { id: contaId }, include: incluirConta });
    const pedidosDaConta = await tx.pedido.findMany({
      where: { contaId, status: { not: 'CANCELADO' } },
      select: { total: true },
    });
    const pagos = await tx.pagamento.aggregate({
      where: { contaId, status: 'APROVADO' },
      _sum: { valor: true },
    });
    const subtotal = Math.round(pedidosDaConta.reduce((soma, p) => soma + Number(p.total), 0) * 100) / 100;
    const restante = valoresDaConta(conta, subtotal, Number(pagos._sum.valor ?? 0)).restante;
    if (restante > 0) {
      await tx.pagamento.create({
        data: {
          mesaId: pedido.mesaId,
          contaId,
          valor: restante.toFixed(2),
          gorjeta: '0',
          valorServico: '0',
          formaPagamento,
          status: 'APROVADO',
          garcomId: usuario.id,
          iniciadoPorId: usuario.id,
          concluidoEm: agora,
        },
      });
    }
  });
  await fecharSeQuitada(contaId);
  return respostaDaEntrega(id);
}

// Cancela o pedido que não foi entregue. Fecha a conta vazia e desativa a mesa virtual.
export async function cancelarEntrega(id: number): Promise<EntregaPedidoDTO> {
  const { pedido, entrega } = await buscarEntrega(id);
  if (pedido.status === 'CANCELADO') {
    throw new HttpError(409, 'Este pedido já foi cancelado');
  }
  if (entrega.concluidoEm || pedido.status === 'ENTREGUE') {
    throw new HttpError(409, 'Pedido já concluído não pode ser cancelado');
  }
  const contaId = pedido.contaId;
  if (contaId !== null) {
    const pagos = await prisma.pagamento.count({ where: { contaId, status: 'APROVADO' } });
    if (pagos > 0) {
      throw new HttpError(409, 'Esta entrega já tem pagamento. Não dá para cancelar.');
    }
  }
  await cancelarPedido(id);
  if (contaId !== null) {
    await prisma.conta.updateMany({
      where: { id: contaId, status: 'ABERTA' },
      data: { status: 'FECHADA', fechadaEm: new Date() },
    });
  }
  await prisma.mesa.update({
    where: { id: pedido.mesaId },
    data: { ativa: false, estado: 'LIVRE', estadoDesde: new Date(), chamandoDesde: null },
  });
  return respostaDaEntrega(id);
}

// Acompanhamento público pelo código da entrega. Não devolve telefone nem endereço.
export async function acompanhamentoDaEntrega(codigo: string): Promise<{
  tipo: TipoMesa;
  situacao: SituacaoEntrega;
  nomeCliente: string;
  criadoEm: string;
  tempoMin: number;
  itens: { nomeProduto: string; quantidade: number; precoUnitario: number; opcoes: { grupo: string; opcao: string; precoExtra: number }[] }[];
  subtotal: number;
  taxaEntrega: number;
  desconto: number;
  total: number;
  formaPagamento: string;
  trocoPara: number | null;
  bairro: string | null;
} | null> {
  const entrega = await prisma.entrega.findUnique({
    where: { codigo },
    include: { pedido: { include: incluirPedido } },
  });
  if (!entrega) return null;
  const configuracao = await lerConfiguracao();
  const dto = await paraEntregaPedidoDTO(entrega.pedido);
  return {
    tipo: entrega.tipo,
    situacao: dto.situacao,
    nomeCliente: entrega.nomeCliente.trim().split(/\s+/)[0],
    criadoEm: dto.criadoEm,
    tempoMin: entrega.tipo === 'DELIVERY' ? configuracao.deliveryTempoMin : configuracao.retiradaTempoMin,
    itens: dto.itens.map((i) => ({
      nomeProduto: i.nomeProduto,
      quantidade: i.quantidade,
      precoUnitario: i.precoUnitario,
      opcoes: i.opcoes,
    })),
    subtotal: dto.conta.subtotal,
    taxaEntrega: dto.conta.taxaEntrega,
    desconto: dto.conta.desconto,
    total: dto.conta.total,
    formaPagamento: entrega.formaPagamento,
    trocoPara: entrega.trocoPara === null ? null : Number(entrega.trocoPara),
    bairro: entrega.bairro,
  };
}
