// Ponte entre o api.ts (que precisa da senha do gestor) e a janela SenhaGestor (montada no Layout).
// A senha não é guardada: só passa de volta para quem pediu, uma vez.

export interface PedidoSenha {
  acao: string; // código da ação (ex.: 'CANCELAR_PEDIDO'); o rótulo fica na janela
  erro?: string; // mensagem da tentativa anterior, se a senha estava errada
  responder(senha: string | null): void; // null = cancelou
}

type Abrir = (pedido: PedidoSenha) => void;

let janela: Abrir | null = null;

// A janela se liga ao montar e se solta ao desmontar (registrarJanela(null)).
export function registrarJanela(abrir: Abrir | null): void {
  janela = abrir;
}

// Sem janela montada, a ação não pode pedir a senha: resolve null (conta como cancelada).
export function pedirSenhaDoGestor(acao: string, erro?: string): Promise<string | null> {
  const abrir = janela;
  if (!abrir) return Promise.resolve(null);
  return new Promise<string | null>((responder) => {
    abrir({ acao, erro, responder });
  });
}
