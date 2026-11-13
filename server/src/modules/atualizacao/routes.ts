import { Response, Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { chamar, motivoIndisponivel } from '../../lib/atualizador';

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

const router = Router();

// Converte a resposta do atualizador na resposta da API. Nunca inclui o segredo.
function responder(res: Response, resultado: { status: number; dados: unknown } | null): void {
  if (resultado === null) {
    res.json({ ativo: false, motivo: motivoIndisponivel() });
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
