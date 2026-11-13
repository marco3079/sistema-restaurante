import { api } from './api';

// Notificações no celular e instalação do aplicativo (PWA). O servidor manda os avisos (lib/push.ts);
// aqui o aparelho pede a permissão, se inscreve e guarda o pedido de instalação do navegador.

export type EstadoPush = 'INDISPONIVEL' | 'BLOQUEADO' | 'DESLIGADO' | 'LIGADO';

const CHAVE_TOKEN = 'restaurante.token';
const TEMPO_ESPERA_SW_MS = 5000;

// ---------- Suporte ----------

export function suportaPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    window.isSecureContext
  );
}

// Aplicativo já instalado e aberto pela tela inicial (não pelo navegador).
export function estaInstalado(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

// Registro do service worker. Em desenvolvimento ele pode não existir: espera só um tempo limitado.
async function registroDoSite(): Promise<ServiceWorkerRegistration> {
  let timer: number | undefined;
  const limite = new Promise<never>((_, rejeita) => {
    timer = window.setTimeout(
      () => rejeita(new Error('O aplicativo ainda não está pronto neste aparelho. Atualize a página.')),
      TEMPO_ESPERA_SW_MS
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, limite]);
  } finally {
    window.clearTimeout(timer);
  }
}

// ---------- Estado e ligar/desligar ----------

export async function estadoDoPush(): Promise<EstadoPush> {
  if (!suportaPush()) return 'INDISPONIVEL';
  if (Notification.permission === 'denied') return 'BLOQUEADO';
  const registro = await navigator.serviceWorker.getRegistration();
  if (!registro) return 'DESLIGADO';
  const inscricao = await registro.pushManager.getSubscription();
  return inscricao && Notification.permission === 'granted' ? 'LIGADO' : 'DESLIGADO';
}

// A chave VAPID vem do servidor em base64url; o navegador pede bytes.
function base64UrlParaBytes(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const preenchido = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(preenchido);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function mesmaChave(inscricao: PushSubscription, chave: Uint8Array): boolean {
  const atual = inscricao.options?.applicationServerKey;
  if (!atual) return false;
  const bytesAtuais = new Uint8Array(atual);
  if (bytesAtuais.length !== chave.length) return false;
  return bytesAtuais.every((valor, i) => valor === chave[i]);
}

export async function ligarPush(): Promise<void> {
  if (!suportaPush()) {
    throw new Error('Este navegador não tem notificações, ou o site não está em HTTPS.');
  }
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    throw new Error('As notificações estão bloqueadas neste navegador. Libere nas configurações do site.');
  }
  const registro = await registroDoSite();
  const { chavePublica } = await api.get<{ chavePublica: string | null }>('/push/chave');
  if (!chavePublica) {
    throw new Error('As notificações não estão disponíveis agora.');
  }
  const chave = base64UrlParaBytes(chavePublica);

  let inscricao = await registro.pushManager.getSubscription();
  // Inscrição feita com outra chave do servidor não serve mais: refaz.
  if (inscricao && !mesmaChave(inscricao, chave)) {
    await inscricao.unsubscribe();
    inscricao = null;
  }
  if (!inscricao) {
    inscricao = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chave,
    });
  }

  const dados = inscricao.toJSON();
  if (!dados.endpoint || !dados.keys?.p256dh || !dados.keys?.auth) {
    throw new Error('Não foi possível ligar as notificações neste aparelho.');
  }
  await api.post('/push/inscricoes', {
    endpoint: dados.endpoint,
    keys: { p256dh: dados.keys.p256dh, auth: dados.keys.auth },
  });
}

export async function desligarPush(): Promise<void> {
  const registro = await registroDoSite();
  const inscricao = await registro.pushManager.getSubscription();
  if (!inscricao) return;
  // Primeiro o servidor (se falhar, a inscrição fica e dá para tentar de novo); depois o navegador.
  await apagarInscricaoNoServidor(inscricao.endpoint);
  await inscricao.unsubscribe();
}

// O cliente da API não manda corpo em DELETE, então esta chamada é feita aqui com o mesmo token da sessão.
async function apagarInscricaoNoServidor(endpoint: string): Promise<void> {
  const token = localStorage.getItem(CHAVE_TOKEN);
  const resposta = await fetch('/api/push/inscricoes', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ endpoint }),
  });
  if (!resposta.ok) {
    throw new Error('Não foi possível desligar as notificações agora.');
  }
}

export async function testarPush(): Promise<number> {
  const resultado = await api.post<{ enviadas: number }>('/push/teste');
  return resultado.enviadas;
}

// ---------- Instalação do aplicativo ----------

interface EventoInstalar extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let eventoInstalar: EventoInstalar | null = null;
const ouvintesInstalacao = new Set<() => void>();

function avisarInstalacao(): void {
  for (const ouvinte of Array.from(ouvintesInstalacao)) {
    try {
      ouvinte();
    } catch {
      // Um ouvinte com erro não impede os outros.
    }
  }
}

// Registrado quando este módulo carrega (o navegador pode disparar o evento antes; nesse caso ele se perde).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    eventoInstalar = evento as EventoInstalar;
    avisarInstalacao();
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalar = null;
    avisarInstalacao();
  });
}

export function podeInstalar(): boolean {
  return eventoInstalar !== null;
}

export async function instalar(): Promise<boolean> {
  const evento = eventoInstalar;
  if (!evento) return false;
  await evento.prompt();
  const escolha = await evento.userChoice;
  eventoInstalar = null;
  avisarInstalacao();
  return escolha.outcome === 'accepted';
}

// Chama o ouvinte quando a possibilidade de instalar muda. Devolve a função que cancela.
export function aoMudarInstalacao(ouvinte: () => void): () => void {
  ouvintesInstalacao.add(ouvinte);
  return () => {
    ouvintesInstalacao.delete(ouvinte);
  };
}
