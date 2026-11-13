import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { limparCacheConfiguracao, lerConfiguracao } from '../../lib/email';

// Operação da fila: configurações usadas pela cozinha e pelo salão (ex.: alerta de atraso).
// Leitura para qualquer perfil logado; gravação só do gestor.

const router = Router();

router.get(
  '/operacao/configuracao',
  asyncHandler(async (_req, res) => {
    const configuracao = await lerConfiguracao();
    res.json({ alertaAtrasoMin: configuracao.alertaAtrasoMin });
  })
);

router.put(
  '/operacao/configuracao',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(
      z.object({
        alertaAtrasoMin: z
          .number({ message: 'Informe o alerta de atraso em minutos' })
          .int('Use um número inteiro')
          .min(0, 'Use um valor entre 0 e 240')
          .max(240, 'Use um valor entre 0 e 240'),
      }),
      req.body
    );
    await lerConfiguracao();
    const atualizada = await prisma.configuracaoPlataforma.update({
      where: { id: 1 },
      data: { alertaAtrasoMin: dados.alertaAtrasoMin },
    });
    limparCacheConfiguracao();
    res.json({ alertaAtrasoMin: atualizada.alertaAtrasoMin });
  })
);

export default router;
