// Formatos da API do restaurante e rótulos comuns às telas.

export type StatusPedido = 'NOVO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';

export interface CategoriaDTO {
  id: number;
  nome: string;
  ordem: number;
  ativa: boolean;
  produtos: number;
}

export interface ProdutoDTO {
  id: number;
  categoriaId: number;
  categoria: { id: number; nome: string };
  nome: string;
  descricao: string;
  preco: number;
  imagem: string | null;
  disponivel: boolean;
}

export interface MesaDTO {
  id: number;
  numero: number;
  nome: string | null;
  lugares: number;
  codigo: string;
  ativa: boolean;
  chamandoDesde: string | null;
  situacao: 'LIVRE' | 'OCUPADA';
  totalAberto: number;
  pedidosAbertos: number;
  pedidosPendentes: number;
  abertaDesde: string | null;
}

export interface ItemPedidoDTO {
  id?: number;
  produtoId?: number;
  nomeProduto: string;
  precoUnitario: number;
  quantidade: number;
  observacao: string | null;
}

export interface PedidoDTO {
  id: number;
  mesa: { id: number; numero: number; nome: string | null };
  status: StatusPedido;
  origem: 'CLIENTE' | 'GARCOM';
  nomeCliente: string | null;
  observacao: string | null;
  garcom: { id: number; nome: string } | null;
  total: number;
  pagoEm: string | null;
  formaPagamento: string | null;
  criadoEm: string;
  atualizadoEm: string;
  itens: ItemPedidoDTO[];
}

export interface ContaDTO {
  mesa: { id: number; numero: number; nome: string | null };
  pedidos: PedidoDTO[];
  total: number;
}

export const STATUS_PEDIDO: Record<
  StatusPedido,
  { rotulo: string; cor: 'azul' | 'amarelo' | 'verde' | 'cinza' | 'vermelho' }
> = {
  NOVO: { rotulo: 'Novo', cor: 'azul' },
  EM_PREPARO: { rotulo: 'Em preparo', cor: 'amarelo' },
  PRONTO: { rotulo: 'Pronto', cor: 'verde' },
  ENTREGUE: { rotulo: 'Entregue', cor: 'cinza' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'vermelho' },
};

export const FORMAS_PAGAMENTO = ['Dinheiro', 'Pix', 'Cartão de débito', 'Cartão de crédito'];

export function nomeDaMesa(mesa: { numero: number; nome: string | null }): string {
  return mesa.nome ? `Mesa ${mesa.numero} · ${mesa.nome}` : `Mesa ${mesa.numero}`;
}

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// "há 5 min", "há 2 h". Para pedidos e chamados recentes.
export function tempoDesde(iso: string, agora: Date = new Date()): string {
  const minutos = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutos)) return '';
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

export function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Endereço do cardápio da mesa, a partir do endereço em que o sistema está aberto.
export function enderecoDaMesa(codigo: string): string {
  return `${window.location.origin}/mesa/${codigo}`;
}

// Texto de preço digitado ("12,50") para número. Devolve null se não for um valor válido.
export function lerPreco(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (limpo === '' || !/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Number(limpo);
}

export function precoParaCampo(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}
