export type Perfil = 'GESTOR' | 'GARCOM';

// Mantido por compatibilidade com as telas herdadas: o perfil verdadeiro é o próprio perfil.
export type PerfilReal = Perfil;

export interface UsuarioLogado {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  perfilReal: PerfilReal;
  foto: string | null; // data URL ou endereço http(s); null sem foto
}

export const PERFIS: { valor: Perfil; rotulo: string }[] = [
  { valor: 'GESTOR', rotulo: 'Gestor' },
  { valor: 'GARCOM', rotulo: 'Garçom' },
];

export function rotuloPerfil(valor: string): string {
  return PERFIS.find((p) => p.valor === valor)?.rotulo ?? valor;
}
