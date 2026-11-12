export type Perfil = 'GESTOR' | 'GARCOM' | 'COZINHA' | 'LIMPEZA' | 'RECEPCAO';

const PERFIS_VALIDOS: Perfil[] = ['GESTOR', 'GARCOM', 'COZINHA', 'LIMPEZA', 'RECEPCAO'];

// Perfil vindo da API ou do navegador; qualquer valor estranho vira garçom (o servidor é quem decide o acesso).
export function lerPerfil(valor: unknown): Perfil {
  return PERFIS_VALIDOS.includes(valor as Perfil) ? (valor as Perfil) : 'GARCOM';
}

// Início de cada perfil.
export const RAIZ_DO_PERFIL: Record<Perfil, string> = {
  GESTOR: '/gestor',
  GARCOM: '/garcom',
  COZINHA: '/cozinha',
  LIMPEZA: '/limpeza',
  RECEPCAO: '/recepcao',
};

export const NOME_DO_PERFIL: Record<Perfil, string> = {
  GESTOR: 'Gestor',
  GARCOM: 'Garçom',
  COZINHA: 'Cozinha',
  LIMPEZA: 'Limpeza',
  RECEPCAO: 'Recepção',
};

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
  { valor: 'COZINHA', rotulo: 'Cozinha' },
  { valor: 'LIMPEZA', rotulo: 'Limpeza' },
  { valor: 'RECEPCAO', rotulo: 'Recepção' },
];

export function rotuloPerfil(valor: string): string {
  return PERFIS.find((p) => p.valor === valor)?.rotulo ?? valor;
}
