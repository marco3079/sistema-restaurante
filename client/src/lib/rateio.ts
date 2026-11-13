// Tipos do rateio da taxa de serviço (espelham as respostas de /api/rateio).

export type PerfilEquipe = 'GARCOM' | 'COZINHA' | 'LIMPEZA' | 'RECEPCAO';

export const ROTULO_PERFIL_EQUIPE: Record<PerfilEquipe, string> = {
  GARCOM: 'Garçons',
  COZINHA: 'Cozinha',
  LIMPEZA: 'Limpeza',
  RECEPCAO: 'Recepção',
};

export type ChavePercentual = PerfilEquipe | 'CASA';

export interface RegraDTO {
  percentuais: Record<ChavePercentual, number>;
  divisaoInterna: 'IGUAL' | 'HORAS';
  gorjetasParaQuemRecebeu: boolean;
}

export interface PessoaRateioDTO {
  usuarioId: number;
  nome: string;
  minutos: number;
  valorTaxa: number;
  valorGorjeta: number;
  total: number;
}

export interface GrupoRateioDTO {
  perfil: PerfilEquipe;
  percentual: number;
  // Valor reservado ao grupo. Sem ninguém ativo no perfil, este valor fica com a casa.
  valor: number;
  pessoas: PessoaRateioDTO[];
}

export interface OutroRateioDTO {
  usuarioId: number;
  nome: string;
  valorGorjeta: number;
}

export interface RateioDTO {
  de: string; // AAAA-MM-DD
  ate: string; // AAAA-MM-DD
  totalTaxa: number;
  totalGorjetas: number;
  base: number;
  regra: RegraDTO;
  grupos: GrupoRateioDTO[];
  // Gorjetas diretas de quem não está em nenhum grupo (ex.: gestor).
  outros: OutroRateioDTO[];
  casa: number;
  // Tudo o que vai para pessoas (rateio e gorjetas diretas).
  totalDistribuido: number;
}

export interface RepasseLinhaDTO {
  id: number;
  de: string; // AAAA-MM-DD
  ate: string; // AAAA-MM-DD
  totalTaxa: number;
  totalGorjetas: number;
  criadoPorNome: string | null;
  criadoEm: string; // ISO 8601
}

export interface RepasseDetalheDTO {
  id: number;
  criadoPorNome: string | null;
  criadoEm: string; // ISO 8601
  rateio: RateioDTO;
}
