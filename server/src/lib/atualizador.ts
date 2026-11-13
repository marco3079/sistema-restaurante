// Chamadas ao contêiner "atualizador" (ele mexe no git, no Docker e no banco). A API só repassa:
// acrescenta o segredo e devolve a resposta. O segredo nunca vai para o cliente.

export const MOTIVO_SEM_SEGREDO = 'O atualizador não está configurado neste servidor.';
export const MOTIVO_SEM_RESPOSTA = 'O atualizador não está respondendo. Rode o instalador de novo para ligá-lo.';

function baseDoAtualizador(): string {
  return (process.env.ATUALIZADOR_URL ?? 'http://atualizador:4000').replace(/\/+$/, '');
}

// Motivo para mostrar quando o atualizador não responde: sem segredo ou sem resposta.
export function motivoIndisponivel(): string {
  return process.env.ATUALIZADOR_SEGREDO ? MOTIVO_SEM_RESPOSTA : MOTIVO_SEM_SEGREDO;
}

// Chamada ao atualizador. Devolve null se não há segredo, se houve erro de rede,
// tempo esgotado ou resposta que não é JSON.
export async function chamar(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  corpo: unknown | undefined,
  tempoMs: number
): Promise<{ status: number; dados: unknown } | null> {
  const segredo = process.env.ATUALIZADOR_SEGREDO;
  if (!segredo) return null;
  const cabecalhos: Record<string, string> = { 'x-atualizador-segredo': segredo };
  const opcoes: RequestInit = { method: metodo, headers: cabecalhos, signal: AbortSignal.timeout(tempoMs) };
  if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  try {
    const resposta = await fetch(`${baseDoAtualizador()}${caminho}`, opcoes);
    const texto = await resposta.text();
    return { status: resposta.status, dados: JSON.parse(texto) as unknown };
  } catch {
    return null;
  }
}

// Pedido de download: devolve a resposta crua (o corpo é o arquivo). Null se não há segredo ou houve erro.
export async function baixar(caminho: string, tempoMs: number): Promise<Response | null> {
  const segredo = process.env.ATUALIZADOR_SEGREDO;
  if (!segredo) return null;
  try {
    return await fetch(`${baseDoAtualizador()}${caminho}`, {
      method: 'GET',
      headers: { 'x-atualizador-segredo': segredo },
      signal: AbortSignal.timeout(tempoMs),
    });
  } catch {
    return null;
  }
}
