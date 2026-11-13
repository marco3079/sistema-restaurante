// Tipos das promoções por horário e dos cupons de desconto (respostas de /promocoes e /cupons).

export interface PromocaoDTO {
  id: number;
  nome: string;
  produto: { id: number; nome: string } | null;
  categoria: { id: number; nome: string } | null;
  percentual: number | null;
  precoFixo: number | null;
  // 0 = domingo .. 6 = sábado; vazio = todos os dias.
  diasSemana: number[];
  horaInicio: string;
  horaFim: string;
  dataInicio: string | null;
  dataFim: string | null;
  ativa: boolean;
  valendoAgora: boolean;
}

export type SituacaoCupom = 'VALENDO' | 'VENCIDO' | 'ESGOTADO' | 'DESATIVADO';

export interface CupomDTO {
  id: number;
  codigo: string;
  descricao: string | null;
  percentual: number | null;
  valor: number | null;
  minimo: number;
  validade: string | null;
  limiteUsos: number | null;
  usos: number;
  ativo: boolean;
  situacao: SituacaoCupom;
}

// Corpo enviado para criar ou alterar uma promoção.
export interface PromocaoCorpo {
  nome: string;
  produtoId: number | null;
  categoriaId: number | null;
  percentual: number | null;
  precoFixo: number | null;
  diasSemana: number[];
  horaInicio: string;
  horaFim: string;
  dataInicio: string | null;
  dataFim: string | null;
  ativa: boolean;
}

// Corpo enviado para criar ou alterar um cupom.
export interface CupomCorpo {
  codigo: string;
  descricao: string | null;
  percentual: number | null;
  valor: number | null;
  minimo: number;
  validade: string | null;
  limiteUsos: number | null;
  ativo: boolean;
}

// Abreviações dos dias, pela ordem do banco (0 = domingo).
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
