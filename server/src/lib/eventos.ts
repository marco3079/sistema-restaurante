// Barramento de eventos em memória: avisa quem quiser quando uma mudança foi gravada pela API.
// Quem ouve (ex.: o módulo de delivery, notificações) não pode travar nem quebrar a requisição.

export interface Mudanca {
  metodo: string;            // POST, PUT, DELETE
  caminho: string;           // ex.: '/api/pedidos/12/status' (sem query string)
  modulo: string;            // primeiro trecho depois de /api/ (ex.: 'pedidos', 'mesas', 'cliente')
  status: number;            // status HTTP da resposta (sempre < 400 aqui)
  corpo: unknown;            // corpo JSON recebido (pode ser undefined)
  usuarioId: number | null;  // null em rota pública
  perfil: string | null;
}

type Ouvinte = (m: Mudanca) => void;

const ouvintes = new Set<Ouvinte>();

// Registra um ouvinte; devolve a função que cancela o registro.
export function aoMudar(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

// Avisa todos os ouvintes. Cada ouvinte roda em try/catch: um erro em um não afeta os outros nem a requisição.
export function publicarMudanca(m: Mudanca): void {
  for (const ouvinte of Array.from(ouvintes)) {
    try {
      ouvinte(m);
    } catch (erro) {
      console.error('Falha em ouvinte de mudança:', erro instanceof Error ? erro.message : erro);
    }
  }
}
