// Ações sensíveis do garçom e o que cada modo quer dizer (espelha server/src/lib/autorizacao.ts).

export type AcaoSensivel =
  | 'CANCELAR_PEDIDO'
  | 'TIRAR_TAXA'
  | 'DESCONTO_MANUAL'
  | 'TRANSFERIR_MESA'
  | 'USAR_PONTOS'
  | 'LIBERAR_MESA';

export type Modo = 'LIVRE' | 'COM_SENHA' | 'SO_GESTOR';

export const ACOES: AcaoSensivel[] = [
  'CANCELAR_PEDIDO',
  'TIRAR_TAXA',
  'DESCONTO_MANUAL',
  'TRANSFERIR_MESA',
  'USAR_PONTOS',
  'LIBERAR_MESA',
];

export const ROTULOS_ACOES: Record<AcaoSensivel, string> = {
  CANCELAR_PEDIDO: 'Cancelar pedido',
  TIRAR_TAXA: 'Tirar a taxa de serviço',
  DESCONTO_MANUAL: 'Dar desconto na conta',
  TRANSFERIR_MESA: 'Trocar, juntar e transferir mesas',
  USAR_PONTOS: 'Usar pontos do cliente',
  LIBERAR_MESA: 'Liberar a mesa sem conta',
};

export const ROTULOS_MODOS: Record<Modo, string> = {
  LIVRE: 'Livre',
  COM_SENHA: 'Com a senha do gestor',
  SO_GESTOR: 'Só o gestor',
};

// GET /permissoes e GET /permissoes/minhas (regras; a senha só aparece no GET /permissoes).
export interface RegrasDTO {
  regras: Record<AcaoSensivel, Modo>;
}

export interface PermissoesDTO extends RegrasDTO {
  senhaDefinida: boolean;
}

// Rótulo de uma ação; código desconhecido vira um texto genérico.
export function rotuloAcao(acao: string): string {
  return (ROTULOS_ACOES as Record<string, string>)[acao] ?? 'Ação do sistema';
}
