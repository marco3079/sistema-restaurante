// Tipos da resposta de GET /relatorios/vendas (só o gestor).

export interface ResumoVendas {
  pedidos: number; // pedidos não cancelados do período
  cancelados: number;
  itens: number; // soma das quantidades
  faturamento: number; // reais
  contasFechadas: number;
  ticketMedio: number; // reais por conta fechada
  tempoMedioPreparoMin: number | null;
  tempoMedioMesaMin: number | null;
}

export interface ProdutoVendido {
  produtoId: number;
  nome: string;
  categoria: string;
  quantidade: number;
  valor: number;
}

export interface ProdutoSemVenda {
  produtoId: number;
  nome: string;
  categoria: string;
}

export interface CategoriaVendida {
  categoria: string;
  quantidade: number;
  valor: number;
}

export interface VendasPorHora {
  hora: number; // 0 a 23
  pedidos: number;
  valor: number;
}

export interface VendasPorDiaSemana {
  dia: number; // 0 = domingo ... 6 = sábado
  pedidos: number;
  valor: number;
}

export interface VendasPorDia {
  dia: string; // AAAA-MM-DD
  pedidos: number;
  valor: number;
}

export interface VendasPorOrigem {
  origem: 'CLIENTE' | 'GARCOM';
  pedidos: number;
  valor: number;
}

export interface RelatorioVendas {
  de: string; // AAAA-MM-DD
  ate: string; // AAAA-MM-DD
  resumo: ResumoVendas;
  produtos: ProdutoVendido[]; // maior quantidade primeiro
  semVenda: ProdutoSemVenda[];
  categorias: CategoriaVendida[]; // maior valor primeiro
  porHora: VendasPorHora[]; // sempre 24
  porDiaSemana: VendasPorDiaSemana[]; // sempre 7
  porDia: VendasPorDia[]; // um por dia do período
  porOrigem: VendasPorOrigem[];
}
