// Tipos do caixa (abertura, sangria, reforço e fechamento). Espelham o retorno da API em /caixa.

export interface MovimentoCaixaDTO {
  id: number;
  tipo: 'SANGRIA' | 'REFORCO';
  valor: number;
  motivo: string | null;
  usuarioNome: string;
  criadoEm: string;
}

export interface ResumoCaixaDTO {
  dinheiro: number;
  sangrias: number;
  reforcos: number;
  esperado: number;
  porForma: Record<string, number>;
  recebimentos: number;
}

export interface CaixaDTO {
  id: number;
  status: 'ABERTO' | 'FECHADO';
  abertoPorNome: string;
  abertoEm: string;
  valorInicial: number;
  fechadoPorNome: string | null;
  fechadoEm: string | null;
  valorContado: number | null;
  valorEsperado: number | null;
  diferenca: number | null;
  observacao: string | null;
  movimentos: MovimentoCaixaDTO[];
  resumo: ResumoCaixaDTO;
}

export interface EstadoCaixaDTO {
  aberto: CaixaDTO | null;
  ultimoFechado: CaixaDTO | null;
}

export const ROTULO_MOVIMENTO_CAIXA: Record<MovimentoCaixaDTO['tipo'], string> = {
  SANGRIA: 'Sangria',
  REFORCO: 'Reforço',
};
