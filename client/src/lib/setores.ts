import type { Perfil } from './tipos';

// Tipos dos setores de preparo (cozinha, bar, sobremesas). O SetorDTO fica em restaurante.ts.
export type { SetorDTO } from './restaurante';

// Setor resumido, como vem em GET /setores/meu.
export interface SetorResumoDTO {
  id: number;
  nome: string;
  cor: string;
}

export interface SetorMeuDTO {
  setor: SetorResumoDTO | null;
}

// Usuário como vem em GET /usuarios (sem a senha).
export interface UsuarioSetorDTO {
  id: number;
  nome: string;
  perfil: Perfil;
  ativo: boolean;
  setorId: number | null;
}

// Corpo de POST /setores e PUT /setores/:id.
export interface SetorEntrada {
  nome: string;
  cor?: string;
  ordem?: number;
  ativo?: boolean;
}
