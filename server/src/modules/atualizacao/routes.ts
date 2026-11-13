import { Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// A API só repassa estes pedidos para o serviço "atualizador", que roda em outro contêiner.
// O contêiner da API não tem acesso ao Docker, então é o atualizador que baixa o código novo
// e recria os serviços. Aqui apenas conferimos o perfil, acrescentamos o segredo e devolvemos a resposta.

interface EstadoDoAtualizador {
  ramo: string | null;
  instalada: { commit: string; curto: string; mensagem: string; data: string } | null;
  disponivel: { commit: string; curto: string; mensagem: string; data: string } | null;
  pendentes: { curto: string; mensagem: string; data: string; autor: string }[];
  alteracoesLocais: boolean;
  verificadoEm: string | null;
  erroVerificacao: string | null;
  tarefa: {
    estado: 'PARADA' | 'RODANDO' | 'CONCLUIDA' | 'FALHOU';
    etapa: string | null;
    iniciadaEm: string | null;
    terminadaEm: string | null;
    erro: string | null;
    de: string | null;
    para: string | null;
    log: string[];
  };
  backups: { arquivo: string; tamanho: number; criadoEm: string }[];
}

const MOTIVO_SEM_SEGREDO = 'O atualizador não está configurado neste servidor.';
const MOTIVO_SEM_RESPOSTA = 'O atualizador não está respondendo. Rode o instalador de novo para ligá-lo.';

const router = Router();

// Chamada ao atualizador. Devolve null se não há segredo, se houve erro de rede,
// tempo esgotado ou resposta que não é JSON.
async function chamar(
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo: unknown | undefined,
  tempoMs: number
): Promise<{ status: number; dados: unknown } | null> {
  const segredo = process.env.ATUALIZADOR_SEGREDO;
  if (!segredo) return null;
  const base = (process.env.ATUALIZADOR_URL ?? 'http://atualizador:4000').replace(/\/+$/, '');
  const cabecalhos: Record<string, string> = { 'x-atualizador-segredo': segredo };
  const opcoes: RequestInit = { method: metodo, headers: cabecalhos, signal: AbortSignal.timeout(tempoMs) };
  if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  try {
    const resposta = await fetch(`${base}${caminho}`, opcoes);
    const texto = await resposta.text();
    return { status: resposta.status, dados: JSON.parse(texto) as unknown };
  } catch {
    return null;
  }
}

// Converte a resposta do atualizador na resposta da API. Nunca inclui o segredo.
function responder(res: Response, resultado: { status: number; dados: unknown } | null): void {
  if (resultado === null) {
    const motivo = process.env.ATUALIZADOR_SEGREDO ? MOTIVO_SEM_RESPOSTA : MOTIVO_SEM_SEGREDO;
    res.json({ ativo: false, motivo });
    return;
  }
  if (resultado.status >= 200 && resultado.status <= 299) {
    res.json({ ativo: true, ...(resultado.dados as EstadoDoAtualizador) });
    return;
  }
  const dados = resultado.dados;
  const mensagem =
    typeof dados === 'object' && dados !== null && typeof (dados as { erro?: unknown }).erro === 'string'
      ? (dados as { erro: string }).erro
      : 'O atualizador respondeu com erro.';
  throw new HttpError(resultado.status, mensagem);
}

router.get(
  '/atualizacao',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const resultado = await chamar('GET', '/estado', undefined, 8000);
    responder(res, resultado);
  })
);

router.post(
  '/atualizacao/verificar',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const resultado = await chamar('POST', '/verificar', {}, 70000);
    responder(res, resultado);
  })
);

const aplicarSchema = z.object({
  forcar: z.boolean().optional(),
});

router.post(
  '/atualizacao/aplicar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(aplicarSchema, req.body);
    const resultado = await chamar('POST', '/atualizar', { forcar: dados.forcar === true }, 15000);
    responder(res, resultado);
  })
);

export default router;
