// Tipos dos clientes da casa e da fidelidade (respostas de /clientes e /fidelidade/configuracao).

export interface ClienteDTO {
  id: number;
  nome: string;
  telefone: string; // só dígitos
  email: string | null;
  nascimento: string | null; // AAAA-MM-DD
  pontos: number;
  observacao: string | null;
  criadoEm: string;
  visitas: number; // contas fechadas
  ultimaVisita: string | null;
  totalGasto: number; // só o gestor vê; para os outros vem 0
}

export interface MovimentoPontosDTO {
  id: number;
  pontos: number; // positivo ganha, negativo usa
  motivo: string;
  contaId: number | null;
  criadoEm: string;
}

export interface ContaClienteDTO {
  id: number;
  fechadaEm: string | null;
  total: number;
}

// Ficha completa (só o gestor): extrato de pontos e últimas contas.
export interface ClienteDetalheDTO extends ClienteDTO {
  movimentos: MovimentoPontosDTO[];
  contas: ContaClienteDTO[];
}

export interface FidelidadeDTO {
  ativa: boolean;
  pontosPorReal: number;
  valorDoPonto: number;
}
