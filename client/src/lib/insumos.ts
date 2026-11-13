// Formatos da API de insumos, fichas técnicas e custo, e utilitários das telas de insumos.

export type UnidadeInsumo = 'KG' | 'G' | 'L' | 'ML' | 'UN';

export type SituacaoInsumo = 'OK' | 'BAIXO' | 'ZERADO';

export interface InsumoDTO {
  id: number;
  nome: string;
  unidade: UnidadeInsumo;
  estoque: number;
  estoqueMinimo: number;
  // Só o gestor recebe o custo real; para a cozinha vai sempre 0.
  custoUnitario: number;
  ativo: boolean;
  situacao: SituacaoInsumo;
  // Quantas fichas técnicas usam o insumo.
  usadoEm: number;
}

export type TipoMovimentoInsumo = 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'VENDA' | 'DEVOLUCAO';

export interface MovimentoInsumoDTO {
  id: number;
  tipo: TipoMovimentoInsumo;
  quantidade: number;
  saldo: number;
  motivo: string | null;
  usuarioNome: string | null;
  criadoEm: string;
}

export interface FichaItemDTO {
  insumoId: number;
  nome: string;
  unidade: UnidadeInsumo;
  quantidade: number;
  custoUnitario: number;
  custo: number;
}

export interface FichaDTO {
  produtoId: number;
  nome: string;
  categoria: string;
  imagem: string | null;
  preco: number;
  itens: FichaItemDTO[];
  custo: number;
  margem: number;
  margemPercentual: number | null;
  cmvPercentual: number | null;
}

export const ROTULO_UNIDADE: Record<UnidadeInsumo, string> = {
  KG: 'Quilo (kg)',
  G: 'Grama (g)',
  L: 'Litro (L)',
  ML: 'Mililitro (ml)',
  UN: 'Unidade (un)',
};

export const SIGLA_UNIDADE: Record<UnidadeInsumo, string> = {
  KG: 'kg',
  G: 'g',
  L: 'L',
  ML: 'ml',
  UN: 'un',
};

export const ROTULO_TIPO_MOVIMENTO: Record<TipoMovimentoInsumo, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  AJUSTE: 'Acerto de contagem',
  VENDA: 'Venda',
  DEVOLUCAO: 'Devolução',
};

const formatadorQuantidade = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

// 12.5 kg -> "12,5 kg"; vírgula decimal e até 3 casas, sem zeros à direita.
export function formatarQuantidade(valor: number, unidade: UnidadeInsumo): string {
  return `${formatadorQuantidade.format(valor)} ${SIGLA_UNIDADE[unidade]}`;
}

// Número para o campo de texto, sem separador de milhar (para o campo ler de volta):
// 0.25 -> "0,25"; 1000 -> "1000". Casas: 3 para quantidades, 4 para custo.
export function numeroParaCampo(valor: number, casas = 3): string {
  return valor.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: casas });
}

// Texto digitado ("0,250", "12.5") para número. Vazio ou inválido vira null; negativo também.
export function lerNumeroBr(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

// Percentual com 1 casa decimal e vírgula: 32.5 -> "32,5%".
export function formatarPercentual(valor: number): string {
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
