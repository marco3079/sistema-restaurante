import webpush from 'web-push';
import type { TipoMesa } from '@prisma/client';
import { prisma } from './prisma';
import { cifrar, decifrar } from './cripto';
import { lerConfiguracao, limparCacheConfiguracao } from './email';
import { aoMudar, Mudanca } from './eventos';

// Notificações no celular (Web Push): chaves VAPID, envio para as inscrições dos usuários
// e os gatilhos que avisam a equipe (chamado do cliente, pedido pronto, pedido novo).

export interface AvisoPush {
  titulo: string;
  corpo: string;
  url: string;
  marca?: string; // mesma marca substitui a notificação anterior no aparelho
}

export interface ChavesVapid {
  publica: string;
  privada: string;
}

const CONTATO_PADRAO = 'mailto:contato@localhost';
const TTL_SEGUNDOS = 60;

// ---------- Chaves VAPID ----------

let geracaoEmAndamento: Promise<ChavesVapid> | null = null;

async function lerOuGerarChaves(): Promise<ChavesVapid> {
  const configuracao = await lerConfiguracao();
  let recriada = false;
  if (configuracao.vapidPublica && configuracao.vapidPrivadaCifrada) {
    const privada = decifrar(configuracao.vapidPrivadaCifrada);
    if (privada !== null) {
      return { publica: configuracao.vapidPublica, privada };
    }
    recriada = true;
  }
  // Não existe par ainda, ou a privada não abre mais (o segredo do servidor mudou): gera um par novo.
  const par = webpush.generateVAPIDKeys();
  await prisma.configuracaoPlataforma.update({
    where: { id: 1 },
    data: { vapidPublica: par.publicKey, vapidPrivadaCifrada: cifrar(par.privateKey) },
  });
  limparCacheConfiguracao();
  if (recriada) {
    // As inscrições antigas foram feitas com a chave anterior e não funcionam mais.
    console.warn('As chaves de notificação foram geradas de novo; os aparelhos precisam ligar as notificações outra vez.');
    await prisma.inscricaoPush.deleteMany({});
  }
  return { publica: par.publicKey, privada: par.privateKey };
}

// Uma geração por vez: chamadas simultâneas esperam a mesma Promise.
export function chavesVapid(): Promise<ChavesVapid> {
  if (geracaoEmAndamento === null) {
    geracaoEmAndamento = lerOuGerarChaves().finally(() => {
      geracaoEmAndamento = null;
    });
  }
  return geracaoEmAndamento;
}

// ---------- Envio ----------

// Manda o aviso para todas as inscrições dos usuários. Nunca lança. Devolve quantas foram enviadas.
export async function notificar(usuarioIds: number[], aviso: AvisoPush): Promise<number> {
  if (usuarioIds.length === 0) {
    return 0;
  }
  try {
    const inscricoes = await prisma.inscricaoPush.findMany({
      where: { usuarioId: { in: usuarioIds } },
    });
    if (inscricoes.length === 0) {
      return 0;
    }
    const [chaves, configuracao] = await Promise.all([chavesVapid(), lerConfiguracao()]);
    const contato = configuracao.emailRemetente ? `mailto:${configuracao.emailRemetente}` : CONTATO_PADRAO;
    const payload = JSON.stringify({
      titulo: aviso.titulo,
      corpo: aviso.corpo,
      url: aviso.url,
      marca: aviso.marca,
    });
    const opcoes = {
      TTL: TTL_SEGUNDOS,
      vapidDetails: { subject: contato, publicKey: chaves.publica, privateKey: chaves.privada },
    };
    const resultados = await Promise.allSettled(
      inscricoes.map(async (inscricao) => {
        try {
          await webpush.sendNotification(
            { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
            payload,
            opcoes
          );
          return true;
        } catch (erro) {
          const status = (erro as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Inscrição expirou ou foi cancelada no aparelho: some daqui.
            await prisma.inscricaoPush.deleteMany({ where: { id: inscricao.id } });
          } else {
            console.error('Falha ao enviar notificação:', status ?? '', erro instanceof Error ? erro.message : erro);
          }
          return false;
        }
      })
    );
    return resultados.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  } catch (erro) {
    console.error('Falha ao notificar:', erro instanceof Error ? erro.message : erro);
    return 0;
  }
}

// ---------- Quem recebe ----------

async function garconsAtivos(): Promise<number[]> {
  const garcons = await prisma.usuario.findMany({
    where: { perfil: 'GARCOM', ativo: true },
    select: { id: true },
  });
  return garcons.map((g) => g.id);
}

// Garçons responsáveis pela mesa: os da área (como em lib/mesas do salão); sem área ou sem garçom nela, todos os ativos.
async function garconsDaMesa(areaId: number | null): Promise<number[]> {
  if (areaId !== null) {
    const area = await prisma.area.findUnique({
      where: { id: areaId },
      select: { garcons: { where: { ativo: true }, select: { id: true } } },
    });
    if (area && area.garcons.length > 0) {
      return area.garcons.map((g) => g.id);
    }
  }
  return garconsAtivos();
}

async function cozinheirosAtivos(): Promise<number[]> {
  const cozinha = await prisma.usuario.findMany({
    where: { perfil: 'COZINHA', ativo: true },
    select: { id: true },
  });
  return cozinha.map((u) => u.id);
}

// ---------- Gatilhos ----------

const RE_CHAMAR = /^\/api\/cliente\/mesas\/([^/]+)\/chamar$/;
const RE_PEDIDO_CLIENTE = /^\/api\/cliente\/mesas\/([^/]+)\/pedidos$/;
const RE_STATUS_PEDIDO = /^\/api\/pedidos\/(\d+)\/status$/;
const CAMINHO_DELIVERY_PEDIDOS = '/api/delivery/pedidos';

async function avisarChamado(codigo: string): Promise<void> {
  const mesa = await prisma.mesa.findUnique({
    where: { codigo },
    select: { id: true, numero: true, areaId: true },
  });
  if (!mesa) {
    return;
  }
  const ids = await garconsDaMesa(mesa.areaId);
  await notificar(ids, {
    titulo: `Mesa ${mesa.numero} está chamando`,
    corpo: 'Um cliente pediu o garçom.',
    url: '/garcom/mesas',
    marca: `chamado-mesa-${mesa.id}`,
  });
}

async function avisarPedidoPronto(pedidoId: number): Promise<void> {
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    select: {
      status: true,
      garcomId: true,
      mesa: { select: { numero: true, nome: true, tipo: true, areaId: true } },
    },
  });
  // Só avisa se o pedido está mesmo PRONTO no banco (com setores, pode ainda não estar).
  if (!pedido || pedido.status !== 'PRONTO') {
    return;
  }
  let ids: number[] = [];
  if (pedido.garcomId !== null) {
    const garcomDoPedido = await prisma.usuario.findUnique({
      where: { id: pedido.garcomId },
      select: { perfil: true, ativo: true },
    });
    if (garcomDoPedido && garcomDoPedido.ativo && garcomDoPedido.perfil === 'GARCOM') {
      ids = [pedido.garcomId];
    }
  }
  if (ids.length === 0) {
    ids = await garconsAtivos();
  }
  const mesa = pedido.mesa;
  const quem = mesa.tipo === 'SALAO' ? `da Mesa ${mesa.numero}` : rotuloVirtual(mesa.tipo, mesa.nome);
  await notificar(ids, {
    titulo: 'Pedido pronto',
    corpo: `Pedido ${quem} está pronto.`,
    url: '/garcom/mesas',
    marca: `pedido-${pedidoId}`,
  });
}

function rotuloVirtual(tipo: TipoMesa, nome: string | null): string {
  // Sem o nome do cliente: o texto da notificação passa pelos servidores do fabricante do navegador.
  void nome;
  return tipo === 'RETIRADA' ? 'de retirada' : 'de delivery';
}

async function avisarPedidoNovoDoCliente(codigo: string): Promise<void> {
  const mesa = await prisma.mesa.findUnique({ where: { codigo }, select: { numero: true } });
  const ids = await cozinheirosAtivos();
  await notificar(ids, {
    titulo: 'Novo pedido',
    corpo: mesa ? `Mesa ${mesa.numero}` : 'Chegou um pedido do cardápio.',
    url: '/cozinha/pedidos',
  });
}

async function avisarPedidoDelivery(corpo: unknown): Promise<void> {
  const dados = (corpo ?? {}) as { tipo?: unknown };
  const tipo = dados.tipo === 'RETIRADA' ? 'Retirada' : 'Delivery';
  const ids = await cozinheirosAtivos();
  await notificar(ids, {
    titulo: 'Novo pedido',
    corpo: `Pedido para ${tipo === 'Retirada' ? 'retirada' : 'entrega'}`,
    url: '/cozinha/pedidos',
  });
}

// Recebe cada mudança já gravada. Tudo em try/catch: um erro aqui nunca afeta a requisição.
function ouvirMudanca(m: Mudanca): void {
  try {
    if (m.metodo === 'POST') {
      const chamar = RE_CHAMAR.exec(m.caminho);
      if (chamar) {
        void avisarChamado(chamar[1]).catch(registrarFalha);
        return;
      }
      const pedidoCliente = RE_PEDIDO_CLIENTE.exec(m.caminho);
      if (pedidoCliente) {
        void avisarPedidoNovoDoCliente(pedidoCliente[1]).catch(registrarFalha);
        return;
      }
      if (m.caminho === CAMINHO_DELIVERY_PEDIDOS) {
        void avisarPedidoDelivery(m.corpo).catch(registrarFalha);
      }
      return;
    }
    if (m.metodo === 'PUT') {
      const status = RE_STATUS_PEDIDO.exec(m.caminho);
      const corpo = (m.corpo ?? {}) as { status?: unknown };
      if (status && corpo.status === 'PRONTO') {
        void avisarPedidoPronto(Number(status[1])).catch(registrarFalha);
      }
    }
  } catch (erro) {
    registrarFalha(erro);
  }
}

function registrarFalha(erro: unknown): void {
  console.error('Falha ao enviar aviso no celular:', erro instanceof Error ? erro.message : erro);
}

// Registrado uma vez, quando o módulo é carregado.
aoMudar(ouvirMudanca);
