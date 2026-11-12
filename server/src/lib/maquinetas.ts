import crypto from 'crypto';
import type { Maquineta, OperadoraMaquineta, Pagamento } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { decifrar } from './cripto';
import { lerConfiguracao } from './email';

// Conversa com a maquineta quando a integração é automática.
// MANUAL (qualquer operadora): o garçom passa o valor na maquineta e confirma no sistema.
// AUTOMATICA: o sistema manda o valor para a maquineta e acompanha o resultado. Disponível para
// a maquineta simulada (testes) e para o Mercado Pago Point (Orders API).

export const OPERADORAS_COM_AUTOMATICA: OperadoraMaquineta[] = ['SIMULADA', 'MERCADO_PAGO'];

export const ROTULO_OPERADORA: Record<OperadoraMaquineta, string> = {
  SIMULADA: 'Simulada (teste)',
  MERCADO_PAGO: 'Mercado Pago Point',
  STONE: 'Stone',
  PAGBANK: 'PagBank',
  CIELO: 'Cielo',
  OUTRA: 'Outra',
};

export interface ResultadoMaquineta {
  status: 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO';
  codigoAutorizacao?: string | null;
  mensagem?: string | null;
}

// ---------- Maquineta simulada ----------

// Aprova sozinha alguns segundos depois da cobrança. Com o identificador "RECUSAR", recusa.
const ESPERA_SIMULADA_MS = 6000;

function consultarSimulada(pagamento: Pagamento, maquineta: Maquineta): ResultadoMaquineta {
  if (Date.now() - pagamento.criadoEm.getTime() < ESPERA_SIMULADA_MS) {
    return { status: 'PENDENTE', mensagem: 'Aguardando o cliente passar o cartão na maquineta simulada.' };
  }
  if ((maquineta.identificador ?? '').trim().toUpperCase() === 'RECUSAR') {
    return { status: 'RECUSADO', mensagem: 'Pagamento recusado (maquineta simulada).' };
  }
  return { status: 'APROVADO', codigoAutorizacao: `SIM${String(pagamento.id).padStart(6, '0')}` };
}

// ---------- Mercado Pago Point (Orders API) ----------

const MP_BASE = 'https://api.mercadopago.com';
const MP_TEMPO_LIMITE_MS = 15000;

const MP_TIPO: Record<string, string> = {
  'Cartão de crédito': 'credit_card',
  'Cartão de débito': 'debit_card',
  Pix: 'qr',
};

async function tokenMercadoPago(): Promise<string> {
  const configuracao = await lerConfiguracao();
  const token = configuracao.mercadoPagoTokenCifrado ? decifrar(configuracao.mercadoPagoTokenCifrado) : null;
  if (!token) {
    throw new HttpError(
      400,
      'Falta o token do Mercado Pago. O gestor informa em Maquinetas (se já informou, precisa digitar de novo).'
    );
  }
  return token;
}

async function chamarMercadoPago(
  metodo: 'GET' | 'POST',
  caminho: string,
  opcoes: { corpo?: unknown; cabecalhos?: Record<string, string> } = {}
): Promise<Record<string, unknown>> {
  const token = await tokenMercadoPago();
  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${token}`, ...opcoes.cabecalhos };
  if (metodo === 'POST') {
    cabecalhos['X-Idempotency-Key'] = crypto.randomUUID();
    cabecalhos['Content-Type'] = 'application/json';
  }
  let resposta: Response;
  try {
    resposta = await fetch(MP_BASE + caminho, {
      method: metodo,
      headers: cabecalhos,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      signal: AbortSignal.timeout(MP_TEMPO_LIMITE_MS),
    });
  } catch {
    throw new HttpError(502, 'Não foi possível falar com o Mercado Pago. Confira a internet e tente de novo.');
  }
  const texto = await resposta.text();
  let dados: Record<string, unknown> = {};
  try {
    dados = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  } catch {
    dados = {};
  }
  if (!resposta.ok) {
    if (resposta.status === 401) {
      throw new HttpError(400, 'O Mercado Pago recusou o token. Confira o token em Maquinetas.');
    }
    const erros = Array.isArray(dados.errors) ? (dados.errors as { code?: string; message?: string }[]) : [];
    const codigo = erros[0]?.code ?? (typeof dados.code === 'string' ? dados.code : '');
    if (codigo === 'already_queued_order_for_terminal') {
      throw new HttpError(409, 'Esta maquineta já tem uma cobrança em espera. Conclua ou cancele na maquineta.');
    }
    if (codigo === 'forbidden_checking_terminal_owner') {
      throw new HttpError(400, 'Esta maquineta não pertence à conta do Mercado Pago do token informado.');
    }
    const detalhe = (erros[0]?.message ?? (typeof dados.message === 'string' ? dados.message : '')).slice(0, 200);
    throw new HttpError(502, `O Mercado Pago respondeu com erro ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`);
  }
  return dados;
}

function primeiroPagamento(order: Record<string, unknown>): Record<string, unknown> {
  const transacoes = order.transactions as { payments?: Record<string, unknown>[] } | undefined;
  return transacoes?.payments?.[0] ?? {};
}

// Terminais Point da conta do token, para o gestor escolher no cadastro da maquineta.
export async function listarTerminaisMercadoPago(): Promise<{ id: string; modo: string }[]> {
  const dados = await chamarMercadoPago('GET', '/terminals/v1/list?limit=50');
  const terminais = (dados.data as { terminals?: { id?: unknown; operating_mode?: unknown }[] } | undefined)?.terminals ?? [];
  return terminais
    .filter((t) => typeof t.id === 'string')
    .map((t) => ({ id: t.id as string, modo: typeof t.operating_mode === 'string' ? t.operating_mode : '' }));
}

async function iniciarMercadoPago(pagamento: Pagamento, maquineta: Maquineta, descricao: string): Promise<string> {
  if (!maquineta.identificador) {
    throw new HttpError(400, 'Esta maquineta está sem o identificador do terminal do Mercado Pago.');
  }
  const tipo = MP_TIPO[pagamento.formaPagamento];
  const order = await chamarMercadoPago('POST', '/v1/orders', {
    corpo: {
      type: 'point',
      external_reference: `pagamento-${pagamento.id}`,
      expiration_time: 'PT10M',
      description: descricao.slice(0, 150),
      transactions: { payments: [{ amount: Number(pagamento.valor).toFixed(2) }] },
      config: {
        point: { terminal_id: maquineta.identificador, print_on_terminal: 'no_ticket' },
        ...(tipo ? { payment_method: { default_type: tipo } } : {}),
      },
    },
  });
  if (typeof order.id !== 'string') {
    throw new HttpError(502, 'O Mercado Pago não devolveu o número da cobrança.');
  }
  return order.id;
}

async function consultarMercadoPago(pagamento: Pagamento): Promise<ResultadoMaquineta> {
  if (!pagamento.referenciaExterna) {
    return { status: 'PENDENTE' };
  }
  const order = await chamarMercadoPago('GET', `/v1/orders/${encodeURIComponent(pagamento.referenciaExterna)}`);
  const transacao = primeiroPagamento(order);
  const detalhe = typeof transacao.status_detail === 'string' ? transacao.status_detail : '';
  switch (order.status) {
    case 'processed':
      return {
        status: 'APROVADO',
        codigoAutorizacao:
          (typeof transacao.reference_id === 'string' && transacao.reference_id) ||
          (typeof transacao.id === 'string' && transacao.id) ||
          null,
      };
    case 'failed':
      return { status: 'RECUSADO', mensagem: `Pagamento não aprovado na maquineta${detalhe ? ` (${detalhe})` : ''}.` };
    case 'expired':
      return { status: 'CANCELADO', mensagem: 'A cobrança expirou na maquineta sem pagamento.' };
    case 'canceled':
    case 'refunded':
      return { status: 'CANCELADO', mensagem: 'A cobrança foi cancelada.' };
    case 'action_required':
      return { status: 'PENDENTE', mensagem: 'A maquineta pede uma confirmação. Confira na tela dela.' };
    case 'at_terminal':
      return { status: 'PENDENTE', mensagem: 'Cobrança na maquineta. Aguardando o cliente pagar.' };
    default:
      return { status: 'PENDENTE', mensagem: 'Enviando a cobrança para a maquineta.' };
  }
}

async function cancelarMercadoPago(pagamento: Pagamento): Promise<void> {
  if (!pagamento.referenciaExterna) return;
  await chamarMercadoPago('POST', `/v1/orders/${encodeURIComponent(pagamento.referenciaExterna)}/cancel`, {
    cabecalhos: { 'x-allow-cancelable-status': 'at_terminal' },
  });
}

// ---------- Entrada única ----------

// Manda a cobrança para a maquineta. Devolve a referência da operadora (se houver).
export async function iniciarNaMaquineta(
  pagamento: Pagamento,
  maquineta: Maquineta,
  descricao: string
): Promise<string | null> {
  if (maquineta.operadora === 'MERCADO_PAGO') return iniciarMercadoPago(pagamento, maquineta, descricao);
  return null;
}

export async function consultarNaMaquineta(pagamento: Pagamento, maquineta: Maquineta): Promise<ResultadoMaquineta> {
  if (maquineta.operadora === 'SIMULADA') return consultarSimulada(pagamento, maquineta);
  if (maquineta.operadora === 'MERCADO_PAGO') return consultarMercadoPago(pagamento);
  return { status: 'PENDENTE' };
}

export async function cancelarNaMaquineta(pagamento: Pagamento, maquineta: Maquineta): Promise<void> {
  if (maquineta.operadora === 'MERCADO_PAGO') await cancelarMercadoPago(pagamento);
}

// Maquinetas que o usuário pode usar para cobrar.
// Gestor: todas as ativas. Garçom: no modo "cada garçom tem a sua", só as dele; no compartilhado, todas.
export async function maquinetasDoUsuario(usuario: { id: number; perfil: string }): Promise<Maquineta[]> {
  const configuracao = await lerConfiguracao();
  const restrito = usuario.perfil !== 'GESTOR' && configuracao.vinculoMaquineta === 'POR_GARCOM';
  return prisma.maquineta.findMany({
    where: { ativa: true, ...(restrito ? { garcomId: usuario.id } : {}) },
    orderBy: { nome: 'asc' },
  });
}
