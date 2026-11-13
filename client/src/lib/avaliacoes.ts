// Formatos da API de avaliações dos clientes (GET /avaliacoes do gestor e avaliação da conta na mesa).

// Uma avaliação da lista do gestor. Garçom null = quem recebeu a conta não está mais cadastrado.
export interface AvaliacaoDTO {
  id: number;
  criadoEm: string;
  mesa: { numero: number; nome: string | null };
  garcom: { id: number; nome: string } | null;
  notaComida: number;
  notaAtendimento: number;
  comentario: string | null;
}

export interface AvaliacoesDTO {
  // Médias com uma casa decimal; null quando não há avaliações no período.
  resumo: { total: number; mediaComida: number | null; mediaAtendimento: number | null };
  porGarcom: { garcom: { id: number; nome: string }; total: number; mediaAtendimento: number }[];
  // As cinco notas, sempre (1 a 5).
  distribuicao: { nota: number; comida: number; atendimento: number }[];
  lista: AvaliacaoDTO[];
}

// Resposta de GET /cliente/mesas/:codigo/avaliacao: conta que pode ser avaliada agora, ou null.
export interface AvaliacaoPendenteDTO {
  pendente: { contaId: number; fechadaEm: string } | null;
}

// Nota com uma casa decimal e vírgula ("4,6 ★"); sem nota = travessão.
export function formatarNota(nota: number | null): string {
  if (nota === null) return '—';
  return `${nota.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★`;
}
