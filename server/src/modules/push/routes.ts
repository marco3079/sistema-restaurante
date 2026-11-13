import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { chavesVapid, notificar } from '../../lib/push';

// Notificações no celular: o aparelho do usuário se inscreve aqui. Todas as rotas exigem login (o servidor já exige).
// Os avisos disparados pelos gatilhos ficam em lib/push.ts, que é importado aqui para ser carregado com o servidor.

const router = Router();

// Serviços de push conhecidos. O servidor faz POST nesses endereços; só aceita os destes serviços.
const HOSTS_CONHECIDOS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const SUFIXOS_CONHECIDOS = ['.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com'];

function hostDeServicoConhecido(endereco: string): boolean {
  try {
    const { protocol, hostname } = new URL(endereco);
    if (protocol !== 'https:') return false;
    return HOSTS_CONHECIDOS.includes(hostname) || SUFIXOS_CONHECIDOS.some((sufixo) => hostname.endsWith(sufixo));
  } catch {
    return false;
  }
}

const inscricaoSchema = z.object({
  endpoint: z
    .string()
    .max(1000, 'Endereço da inscrição muito longo')
    .startsWith('https://', 'Endereço da inscrição inválido'),
  keys: z.object({
    p256dh: z.string().min(1, 'Chave da inscrição inválida').max(500),
    auth: z.string().min(1, 'Chave da inscrição inválida').max(500),
  }),
});

const cancelarSchema = z.object({
  endpoint: z.string().max(1000),
});

router.get(
  '/push/chave',
  asyncHandler(async (_req, res) => {
    const chaves = await chavesVapid();
    res.json({ chavePublica: chaves.publica });
  })
);

router.post(
  '/push/inscricoes',
  asyncHandler(async (req, res) => {
    const dados = validar(inscricaoSchema, req.body);
    if (!hostDeServicoConhecido(dados.endpoint)) {
      throw new HttpError(400, 'Endereço de notificação não reconhecido');
    }
    // Mesmo endpoint de novo: o aparelho passa a ser deste usuário.
    await prisma.inscricaoPush.upsert({
      where: { endpoint: dados.endpoint },
      create: {
        usuarioId: req.usuario.id,
        endpoint: dados.endpoint,
        p256dh: dados.keys.p256dh,
        auth: dados.keys.auth,
      },
      update: {
        usuarioId: req.usuario.id,
        p256dh: dados.keys.p256dh,
        auth: dados.keys.auth,
      },
    });
    res.status(201).json({ ok: true });
  })
);

router.delete(
  '/push/inscricoes',
  asyncHandler(async (req, res) => {
    const dados = validar(cancelarSchema, req.body);
    // Só apaga a inscrição do próprio usuário.
    await prisma.inscricaoPush.deleteMany({
      where: { endpoint: dados.endpoint, usuarioId: req.usuario.id },
    });
    res.json({ ok: true });
  })
);

router.post(
  '/push/teste',
  asyncHandler(async (req, res) => {
    const enviadas = await notificar([req.usuario.id], {
      titulo: 'Sistema de Restaurante',
      corpo: 'Notificações ligadas neste aparelho.',
      url: '/',
      marca: 'teste-push',
    });
    res.json({ enviadas });
  })
);

export default router;
