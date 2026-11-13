import type { Perfil } from './tipos';

// Tipos e utilitários da escala e do ponto. Contrato com server/src/modules/escala/routes.ts.

export interface PessoaEscala {
  id: number;
  nome: string;
  perfil: Perfil;
}

export interface TurnoDTO {
  id: number;
  usuario: PessoaEscala;
  data: string; // AAAA-MM-DD
  inicio: string; // HH:mm
  fim: string; // HH:mm
  observacao: string | null;
}

export interface EscalaDTO {
  turnos: TurnoDTO[];
  equipe: PessoaEscala[];
}

export interface PontoDTO {
  id: number;
  usuario: PessoaEscala;
  entrada: string; // ISO 8601
  saida: string | null; // ISO 8601; null = em aberto
  minutos: number | null; // null = em aberto
  observacao: string | null;
  ajustadoPorNome: string | null;
}

export interface PontoMeuDTO {
  aberto: PontoDTO | null;
  recentes: PontoDTO[];
  minutosNaSemana: number;
}

export interface TotalPontoDTO {
  usuario: PessoaEscala;
  minutos: number;
  dias: number;
  abertos: number;
}

export interface PontoListaDTO {
  registros: PontoDTO[];
  totais: TotalPontoDTO[];
}

// ---------- Datas (sempre no fuso do navegador) ----------

const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function horaValida(texto: string): boolean {
  return REGEX_HORA.test(texto);
}

function dois(n: number): string {
  return String(n).padStart(2, '0');
}

// Dia local em AAAA-MM-DD.
export function diaTexto(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export function hojeTexto(): string {
  return diaTexto(new Date());
}

function partesDoDia(texto: string): [number, number, number] {
  const [ano, mes, dia] = texto.split('-').map(Number);
  return [ano, mes, dia];
}

export function somarDiasTexto(texto: string, n: number): string {
  const [ano, mes, dia] = partesDoDia(texto);
  return diaTexto(new Date(ano, mes - 1, dia + n));
}

// Segunda-feira da semana que contém o dia informado.
export function inicioDaSemanaTexto(texto: string): string {
  const [ano, mes, dia] = partesDoDia(texto);
  const deslocamento = (new Date(ano, mes - 1, dia).getDay() + 6) % 7;
  return somarDiasTexto(texto, -deslocamento);
}

export function diasDaSemanaTexto(segunda: string): string[] {
  return Array.from({ length: 7 }, (_, i) => somarDiasTexto(segunda, i));
}

const SIGLAS_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// "Seg" ... "Dom" para o dia AAAA-MM-DD.
export function siglaDoDia(texto: string): string {
  const [ano, mes, dia] = partesDoDia(texto);
  return SIGLAS_DIA[new Date(ano, mes - 1, dia).getDay()];
}

// "16/11" para o dia AAAA-MM-DD.
export function formatarDiaCurto(texto: string): string {
  const [, mes, dia] = partesDoDia(texto);
  return `${dois(dia)}/${dois(mes)}`;
}

// Campo datetime-local ("AAAA-MM-DDTHH:mm") a partir de um ISO.
export function paraCampoDataHora(iso: string): string {
  const d = new Date(iso);
  return `${diaTexto(d)}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

// Valor de um campo datetime-local (hora local) para ISO.
export function deCampoDataHora(texto: string): string {
  return new Date(texto).toISOString();
}

// ---------- Horas ----------

function horaParaMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

// Duração de um turno. Se o fim é menor que o início, o turno vira a noite (soma 24 h).
export function minutosDoTurno(inicio: string, fim: string): number {
  const a = horaParaMinutos(inicio);
  let b = horaParaMinutos(fim);
  if (b < a) b += 24 * 60;
  return b - a;
}

// "32 h 15 min"
export function formatarMinutos(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  return `${Math.floor(total / 60)} h ${total % 60} min`;
}
