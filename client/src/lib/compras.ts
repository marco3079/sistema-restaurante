// Formatos da API de fornecedores e compras, e o estado do formulário de compra.

export interface FornecedorDTO {
  id: number;
  nome: string;
  cnpjCpf: string | null;
  telefone: string | null;
  email: string | null;
  contato: string | null;
  observacao: string | null;
  ativo: boolean;
  compras: number;
  totalComprado: number;
}

export type StatusCompra = 'PEDIDA' | 'RECEBIDA' | 'CANCELADA';

export interface CompraItemDTO {
  id: number;
  tipo: 'PRODUTO' | 'INSUMO' | 'OUTRO';
  produtoId: number | null;
  insumoId: number | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
  subtotal: number;
}

export interface CompraDTO {
  id: number;
  fornecedor: { id: number; nome: string };
  status: StatusCompra;
  observacao: string | null;
  total: number;
  pedidaEm: string;
  recebidaEm: string | null;
  criadaPorNome: string | null;
  lancamentoId: number | null;
  itens: CompraItemDTO[];
}

export interface ItensDisponiveisDTO {
  produtos: { id: number; nome: string; estoque: number; estoqueMinimo: number }[];
  insumos: { id: number; nome: string; unidade: string; estoque: number; estoqueMinimo: number; custoUnitario: number }[];
}

export interface SugestaoDTO {
  tipo: 'PRODUTO' | 'INSUMO';
  id: number;
  nome: string;
  unidade: string;
  estoque: number;
  minimo: number;
  sugerido: number;
  ultimoCusto: number | null;
}

// Uma linha do formulário de compra. `itemId` é o id do produto ou do insumo escolhido (texto do select).
export interface LinhaCompra {
  chave: number;
  tipo: '' | 'PRODUTO' | 'INSUMO' | 'OUTRO';
  itemId: string;
  descricao: string;
  quantidade: string;
  custo: string;
}
