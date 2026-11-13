// Tipos e constantes do módulo financeiro (ganhos e gastos). Espelham a API em /api/financeiro.

export type TipoLancamento = 'DESPESA' | 'RECEITA';

export interface CategoriaDTO {
  id: number;
  nome: string;
  tipo: TipoLancamento;
  cor: string;
  ativa: boolean;
  lancamentos: number;
}

export interface LancamentoDTO {
  id: number;
  tipo: TipoLancamento;
  categoria: { id: number; nome: string; cor: string };
  descricao: string;
  valor: number;
  data: string; // AAAA-MM-DD
  pago: boolean;
  pagoEm: string | null;
  vencimento: string | null; // AAAA-MM-DD
  formaPagamento: string | null;
  fornecedor: { id: number; nome: string } | null;
  compraId: number | null;
  observacao: string | null;
  criadoPorNome: string | null;
}

export interface FornecedorOpcaoDTO {
  id: number;
  nome: string;
}

export interface ResumoFinanceiroDTO {
  de: string;
  ate: string;
  vendas: number;
  taxaServico: number;
  gorjetas: number;
  outrasReceitas: number;
  despesas: number;
  resultado: number;
  aPagar: number;
  aPagarVencidas: number;
  porDia: { dia: string; receitas: number; despesas: number }[];
  despesasPorCategoria: { categoria: string; cor: string; valor: number }[];
  receitasPorForma: { forma: string; valor: number }[];
}

export const FORMAS_PAGAMENTO_LANCAMENTO = [
  'Dinheiro',
  'Pix',
  'Cartão de débito',
  'Cartão de crédito',
  'Boleto',
  'Transferência',
] as const;
