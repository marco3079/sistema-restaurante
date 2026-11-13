import type { TarefaAtualizacaoDTO } from './atualizacao';

// Formatos da API de backup (GET /api/backup e ações de cópia, baixar, restaurar e excluir).

export interface BackupArquivoDTO {
  arquivo: string;
  tipo: 'ATUALIZACAO' | 'DIARIO' | 'MANUAL' | 'ANTES_RESTAURAR';
  tamanho: number;
  criadoEm: string;
}

export interface BackupConfigDTO {
  diario: boolean;
  hora: string;
  manterDiarios: number;
}

export interface BackupAtivoDTO {
  ativo: true;
  config: BackupConfigDTO;
  ultimoDiario: { em: string; ok: boolean; erro: string | null } | null;
  backups: BackupArquivoDTO[];
  tarefa: TarefaAtualizacaoDTO;
}

export type BackupDTO = BackupAtivoDTO | { ativo: false; motivo: string };
