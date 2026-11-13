import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { juntarMesas, trocarMesa, transferirItens } from '../../lib/transferencias';

// Trocar de mesa, juntar contas e transferir itens entre mesas. Só o gestor e o garçom.

const router = Router();
const equipeDoSalao = permitir('GESTOR', 'GARCOM');

const trocarSchema = z.object({
  paraMesaId: z.number({ message: 'Escolha a mesa de destino' }).int('Mesa inválida').positive('Mesa inválida'),
});

const juntarSchema = z.object({
  comMesaId: z.number({ message: 'Escolha a mesa para juntar' }).int('Mesa inválida').positive('Mesa inválida'),
});

const transferirSchema = z.object({
  paraMesaId: z.number({ message: 'Escolha a mesa de destino' }).int('Mesa inválida').positive('Mesa inválida'),
  itens: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        quantidade: z.number({ message: 'Informe a quantidade' }).int('Use um número inteiro').min(1, 'Quantidade inválida'),
      })
    )
    .min(1, 'Escolha ao menos um item')
    .max(50, 'Transfira no máximo 50 itens de uma vez'),
});

router.post(
  '/mesas/:id/trocar',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(trocarSchema, req.body);
    await trocarMesa(id, dados.paraMesaId);
    res.json({ ok: true });
  })
);

router.post(
  '/mesas/:id/juntar',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(juntarSchema, req.body);
    await juntarMesas(id, dados.comMesaId);
    res.json({ ok: true });
  })
);

router.post(
  '/mesas/:id/transferir-itens',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(transferirSchema, req.body);
    await transferirItens(id, dados.paraMesaId, dados.itens);
    res.json({ ok: true });
  })
);

export default router;
