import { Response, Router } from 'express';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { baixar, chamar, motivoIndisponivel } from '../../lib/atualizador';

// Cópias do banco pela aba Backup de Configurações (só gestor). Quem faz a cópia, guarda os arquivos
// e restaura é o contêiner "atualizador"; aqui conferimos o perfil, validamos o que chega e repassamos.

const router = Router();

const nomeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^(banco|diario|manual|antes-restaurar)_[A-Za-z0-9._-]+\.sql\.gz$/, 'Arquivo inválido');

const configSchema = z.object({
  diario: z.boolean(),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o horário no formato HH:mm'),
  manterDiarios: z.number().int().min(1).max(60),
});

const restaurarSchema = z.object({
  arquivo: nomeSchema,
  confirmacao: z.literal('RESTAURAR'),
});

// Converte a resposta do atualizador na resposta da API. Nunca inclui o segredo.
function responder(res: Response, resultado: { status: number; dados: unknown } | null): void {
  if (resultado === null) {
    res.json({ ativo: false, motivo: motivoIndisponivel() });
    return;
  }
  if (resultado.status >= 200 && resultado.status <= 299) {
    res.json({ ativo: true, ...(resultado.dados as Record<string, unknown>) });
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
  '/backup',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    responder(res, await chamar('GET', '/backups', undefined, 8000));
  })
);

router.put(
  '/backup/config',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(configSchema, req.body);
    responder(res, await chamar('PUT', '/backups/config', dados, 8000));
  })
);

router.post(
  '/backup',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    responder(res, await chamar('POST', '/backups', undefined, 15000));
  })
);

router.post(
  '/backup/restaurar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(restaurarSchema, req.body);
    responder(res, await chamar('POST', '/backups/restaurar', { arquivo: dados.arquivo }, 15000));
  })
);

router.delete(
  '/backup/arquivo',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const nome = validar(nomeSchema, req.query.nome);
    responder(res, await chamar('DELETE', `/backups?nome=${encodeURIComponent(nome)}`, undefined, 8000));
  })
);

router.get(
  '/backup/baixar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const nome = validar(nomeSchema, req.query.nome);
    const resposta = await baixar(`/backups/arquivo?nome=${encodeURIComponent(nome)}`, 120000);
    if (resposta === null) {
      throw new HttpError(502, 'Não foi possível baixar a cópia');
    }
    if (resposta.status !== 200 || !resposta.body) {
      await resposta.body?.cancel().catch(() => {});
      throw new HttpError(502, 'Não foi possível baixar a cópia');
    }
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    const corpo = Readable.fromWeb(resposta.body as any);
    corpo.on('error', () => res.destroy());
    corpo.pipe(res);
  })
);

export default router;
