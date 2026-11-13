// Formatos da API de atualização do sistema (GET /api/atualizacao e ações de atualizar).

export interface CommitDTO {
  commit: string;
  curto: string;
  mensagem: string;
  data: string;
}

export interface TarefaAtualizacaoDTO {
  estado: 'PARADA' | 'RODANDO' | 'CONCLUIDA' | 'FALHOU';
  etapa: string | null;
  iniciadaEm: string | null;
  terminadaEm: string | null;
  erro: string | null;
  de: string | null;
  para: string | null;
  log: string[];
}

export interface AtualizacaoAtivaDTO {
  ativo: true;
  ramo: string | null;
  instalada: CommitDTO | null;
  disponivel: CommitDTO | null;
  pendentes: { curto: string; mensagem: string; data: string; autor: string }[];
  alteracoesLocais: boolean;
  verificadoEm: string | null;
  erroVerificacao: string | null;
  tarefa: TarefaAtualizacaoDTO;
  backups: { arquivo: string; tamanho: number; criadoEm: string }[];
}

export type AtualizacaoDTO = AtualizacaoAtivaDTO | { ativo: false; motivo: string };
