// Tempo real: o servidor avisa por um fluxo aberto (text/event-stream) que algo mudou.
// O evento traz só o nome do módulo; a tela recarrega os próprios dados.
// Lido com fetch (e não EventSource) para mandar o token no cabeçalho, nunca na URL.

type Ouvinte = (modulo: string) => void;

const CHAVE_TOKEN = 'restaurante.token';
const URL_EQUIPE = '/api/eventos';
const ESPERA_MIN_MS = 1000;
const ESPERA_MAX_MS = 30000;
// O servidor manda um ping a cada 25 s; sem nenhum sinal por este tempo, a conexão é refeita.
const SEM_SINAL_MS = 60000;

interface Fonte {
  url: string;
  comToken: boolean;
  ouvintes: Set<Ouvinte>;
  controle: AbortController | null;
  religar: number | null;
  vigia: number | null;
  espera: number;
  // Verdadeiro quando o servidor recusou (401): não tenta mais até alguém assinar de novo.
  desistiu: boolean;
}

const fontes = new Map<string, Fonte>();
let abaObservada = false;

function suportado(): boolean {
  return typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined' && typeof fetch === 'function';
}

function abaVisivel(): boolean {
  return document.visibilityState === 'visible';
}

function obterFonte(url: string, comToken: boolean): Fonte {
  let fonte = fontes.get(url);
  if (!fonte) {
    fonte = {
      url,
      comToken,
      ouvintes: new Set(),
      controle: null,
      religar: null,
      vigia: null,
      espera: ESPERA_MIN_MS,
      desistiu: false,
    };
    fontes.set(url, fonte);
  }
  return fonte;
}

// Para a conexão atual e os temporizadores (não remove os ouvintes).
function pararConexao(fonte: Fonte): void {
  if (fonte.religar !== null) {
    window.clearTimeout(fonte.religar);
    fonte.religar = null;
  }
  if (fonte.vigia !== null) {
    window.clearTimeout(fonte.vigia);
    fonte.vigia = null;
  }
  const controle = fonte.controle;
  fonte.controle = null;
  controle?.abort();
}

function avisarOuvintes(fonte: Fonte, modulo: string): void {
  for (const ouvinte of Array.from(fonte.ouvintes)) {
    try {
      ouvinte(modulo);
    } catch {
      // Um ouvinte com erro não pode impedir os outros.
    }
  }
}

// Trata um bloco de evento completo (linhas data: juntadas).
function tratarBloco(fonte: Fonte, linhas: string[]): void {
  if (linhas.length === 0) return;
  try {
    const dados = JSON.parse(linhas.join('\n')) as { modulo?: unknown };
    if (typeof dados.modulo === 'string') avisarOuvintes(fonte, dados.modulo);
  } catch {
    // Evento que não é JSON válido: ignora.
  }
}

// Abre a conexão e lê o fluxo até o fim (ou até erro/cancelamento).
async function abrir(fonte: Fonte, controle: AbortController): Promise<'recusado' | 'fim'> {
  const cabecalhos: Record<string, string> = { Accept: 'text/event-stream' };
  if (fonte.comToken) {
    const token = window.localStorage.getItem(CHAVE_TOKEN);
    if (!token) return 'recusado';
    cabecalhos.Authorization = `Bearer ${token}`;
  }

  // Sem sinal por SEM_SINAL_MS (inclusive na espera da resposta), a conexão é cancelada e refeita.
  const vigiar = () => {
    if (fonte.vigia !== null) window.clearTimeout(fonte.vigia);
    fonte.vigia = window.setTimeout(() => controle.abort(), SEM_SINAL_MS);
  };
  vigiar();

  const resposta = await fetch(fonte.url, {
    headers: cabecalhos,
    signal: controle.signal,
    cache: 'no-store',
  });
  if (resposta.status === 401) return 'recusado';
  if (!resposta.ok || !resposta.body) throw new Error('Tempo real indisponível');

  // Conectou: a espera volta ao mínimo.
  fonte.espera = ESPERA_MIN_MS;

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let resto = '';
  let linhas: string[] = [];

  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) return 'fim';
      vigiar();

      resto += decodificador.decode(value, { stream: true });
      const partes = resto.split('\n');
      resto = partes.pop() ?? '';
      for (const bruta of partes) {
        const linha = bruta.replace(/\r$/, '');
        if (linha === '') {
          // Linha em branco fecha o evento.
          tratarBloco(fonte, linhas);
          linhas = [];
        } else if (linha.startsWith('data:')) {
          const valor = linha.slice(5);
          linhas.push(valor.startsWith(' ') ? valor.slice(1) : valor);
        }
        // Comentários (': ping', ': ok') não fazem nada.
      }
    }
  } finally {
    if (fonte.vigia !== null) {
      window.clearTimeout(fonte.vigia);
      fonte.vigia = null;
    }
  }
}

function agendarReconexao(fonte: Fonte): void {
  if (fonte.religar !== null || fonte.desistiu || fonte.ouvintes.size === 0) return;
  const atraso = fonte.espera;
  fonte.espera = Math.min(fonte.espera * 2, ESPERA_MAX_MS);
  fonte.religar = window.setTimeout(() => {
    fonte.religar = null;
    conectar(fonte);
  }, atraso);
}

function conectar(fonte: Fonte): void {
  if (fonte.controle !== null || fonte.desistiu || fonte.ouvintes.size === 0 || !abaVisivel()) return;

  const controle = new AbortController();
  fonte.controle = controle;

  abrir(fonte, controle)
    .then((resultado) => {
      if (resultado === 'recusado') fonte.desistiu = true;
    })
    .catch(() => {
      // Falha de rede ou aborto: tenta de novo abaixo (se ainda for a conexão atual).
    })
    .finally(() => {
      // Se a conexão foi parada de propósito (pausa ou sem assinantes), fonte.controle já não é este.
      if (fonte.controle !== controle) return;
      fonte.controle = null;
      if (fonte.vigia !== null) {
        window.clearTimeout(fonte.vigia);
        fonte.vigia = null;
      }
      agendarReconexao(fonte);
    });
}

// Ao esconder a aba, a conexão para; ao voltar, reconecta.
function observarAba(): void {
  if (abaObservada) return;
  abaObservada = true;
  document.addEventListener('visibilitychange', () => {
    for (const fonte of Array.from(fontes.values())) {
      if (abaVisivel()) {
        if (fonte.controle === null && fonte.ouvintes.size > 0) {
          pararConexao(fonte);
          fonte.espera = ESPERA_MIN_MS;
          conectar(fonte);
        }
      } else {
        pararConexao(fonte);
      }
    }
  });
}

function assinarFonte(fonte: Fonte, ouvinte: Ouvinte): () => void {
  if (!suportado()) return () => {};

  const primeiro = fonte.ouvintes.size === 0;
  fonte.ouvintes.add(ouvinte);
  if (primeiro) {
    fonte.desistiu = false;
    fonte.espera = ESPERA_MIN_MS;
    observarAba();
    conectar(fonte);
  }

  return () => {
    if (!fonte.ouvintes.delete(ouvinte)) return;
    if (fonte.ouvintes.size === 0) {
      pararConexao(fonte);
      if (fontes.get(fonte.url) === fonte) fontes.delete(fonte.url);
    }
  };
}

// Assina as mudanças da equipe (usa o token de login). Uma só conexão por aba.
export function assinar(ouvinte: Ouvinte): () => void {
  return assinarFonte(obterFonte(URL_EQUIPE, true), ouvinte);
}

// Assina as mudanças de uma mesa para a tela do cliente (sem login).
export function assinarMesa(codigo: string, ouvinte: Ouvinte): () => void {
  const url = `/api/cliente/mesas/${encodeURIComponent(codigo)}/eventos`;
  return assinarFonte(obterFonte(url, false), ouvinte);
}

// Junta uma rajada de chamadas: executa `acao` no máximo uma vez a cada `intervaloMs`.
// Devolve o disparador e a função que cancela o que estiver agendado.
export function rajada(acao: () => void, intervaloMs = 400): { disparar: () => void; cancelar: () => void } {
  let agendado: number | null = null;
  let ultima = 0;
  return {
    disparar() {
      if (agendado !== null) return;
      const espera = Math.max(0, ultima + intervaloMs - Date.now());
      agendado = window.setTimeout(() => {
        agendado = null;
        ultima = Date.now();
        acao();
      }, espera);
    },
    cancelar() {
      if (agendado !== null) window.clearTimeout(agendado);
      agendado = null;
    },
  };
}
