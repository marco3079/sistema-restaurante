import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lancarMovimento } from '../../lib/estoque';

// Estoque dos produtos com controle ligado. O gestor lança entradas, saídas e acertos;
// a cozinha consulta para saber o que está acabando.

const router = Router();

router.get(
  '/estoque',
  permitir('GESTOR', 'COZINHA'),
  asyncHandler(async (_req, res) => {
    const produtos = await prisma.produto.findMany({
      where: { ativo: true, controlaEstoque: true },
      select: {
        id: true,
        nome: true,
        imagem: true,
        estoque: true,
        estoqueMinimo: true,
        disponivel: true,
        categoria: { select: { nome: true } },
      },
      orderBy: [{ categoria: { ordem: 'asc' } }, { nome: 'asc' }],
    });
    res.json(
      produtos.map((p) => ({
        ...p,
        situacao: p.estoque === 0 ? 'ZERADO' : p.estoque <= p.estoqueMinimo ? 'BAIXO' : 'OK',
      }))
    );
  })
);

router.get(
  '/estoque/:id/movimentos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const produtoId = idParam(req);
    const movimentos = await prisma.movimentoEstoque.findMany({
      where: { produtoId },
      orderBy: { criadoEm: 'desc' },
      take: 60,
    });
    res.json(movimentos.map((m) => ({ ...m, criadoEm: m.criadoEm.toISOString() })));
  })
);

const movimentoSchema = z.object({
  tipo: z.enum(['ENTRADA', 'SAIDA', 'AJUSTE']),
  // ENTRADA e SAIDA: quantas unidades. AJUSTE: o saldo contado.
  quantidade: z.number().int('Use um número inteiro').min(0, 'Quantidade inválida').max(100000, 'Quantidade inválida'),
  motivo: z.string().trim().max(120, 'Motivo muito longo').nullable().optional(),
});

router.post(
  '/estoque/:id/movimentos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const produtoId = idParam(req);
    const dados = validar(movimentoSchema, req.body);
    if (dados.tipo !== 'AJUSTE' && dados.quantidade === 0) {
      throw new HttpError(400, 'Informe a quantidade.');
    }
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const saldo = await lancarMovimento({
      produtoId,
      tipo: dados.tipo,
      quantidade: dados.quantidade,
      motivo: dados.motivo || null,
      usuarioNome: usuario?.nome ?? null,
    });
    res.status(201).json({ saldo });
  })
);

export default router;
