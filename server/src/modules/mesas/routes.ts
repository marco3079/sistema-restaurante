import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { incluirPedido, novoCodigoDeMesa, paraPedidoDTO } from '../../lib/pedidos';

// Mesas do salão: cadastro (gestor), situação, chamado do cliente e conta (gestor e garçom).

const router = Router();

const mesaSchema = z.object({
  numero: z.number().int().min(1, 'Número inválido').max(9999, 'Número inválido'),
  nome: z.string().trim().max(60, 'Nome muito longo').nullable().optional(),
  lugares: z.number().int().min(1, 'Lugares inválidos').max(99, 'Lugares inválidos').optional(),
  ativa: z.boolean().optional(),
});

async function garantirNumeroLivre(numero: number, ignorarId?: number): Promise<void> {
  const outra = await prisma.mesa.findFirst({
    where: ignorarId === undefined ? { numero } : { numero, id: { not: ignorarId } },
    select: { id: true },
  });
  if (outra) {
    throw new HttpError(409, `Já existe a mesa ${numero}`);
  }
}

function nomeOuNulo(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return valor.trim() === '' ? null : valor.trim();
}

// Lista as mesas com a situação da conta aberta de cada uma.
router.get(
  '/mesas',
  asyncHandler(async (_req, res) => {
    const [mesas, abertos] = await Promise.all([
      prisma.mesa.findMany({ orderBy: { numero: 'asc' } }),
      prisma.pedido.findMany({
        where: { pagoEm: null, status: { not: 'CANCELADO' } },
        select: { mesaId: true, total: true, status: true, criadoEm: true },
      }),
    ]);
    const porMesa = new Map<
      number,
      { total: number; pedidos: number; pendentes: number; desde: Date | null }
    >();
    for (const p of abertos) {
      const atual = porMesa.get(p.mesaId) ?? { total: 0, pedidos: 0, pendentes: 0, desde: null };
      atual.total += Number(p.total);
      atual.pedidos += 1;
      if (p.status !== 'ENTREGUE') atual.pendentes += 1;
      if (atual.desde === null || p.criadoEm < atual.desde) atual.desde = p.criadoEm;
      porMesa.set(p.mesaId, atual);
    }
    res.json(
      mesas.map((m) => {
        const conta = porMesa.get(m.id);
        return {
          id: m.id,
          numero: m.numero,
          nome: m.nome,
          lugares: m.lugares,
          codigo: m.codigo,
          ativa: m.ativa,
          chamandoDesde: m.chamandoDesde ? m.chamandoDesde.toISOString() : null,
          situacao: conta ? 'OCUPADA' : 'LIVRE',
          totalAberto: conta ? Math.round(conta.total * 100) / 100 : 0,
          pedidosAbertos: conta?.pedidos ?? 0,
          pedidosPendentes: conta?.pendentes ?? 0,
          abertaDesde: conta?.desde ? conta.desde.toISOString() : null,
        };
      })
    );
  })
);

router.post(
  '/mesas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(mesaSchema, req.body);
    await garantirNumeroLivre(dados.numero);
    const mesa = await prisma.mesa.create({
      data: {
        numero: dados.numero,
        nome: nomeOuNulo(dados.nome) ?? null,
        lugares: dados.lugares ?? 4,
        ativa: dados.ativa ?? true,
        codigo: novoCodigoDeMesa(),
      },
    });
    res.status(201).json(mesa);
  })
);

router.put(
  '/mesas/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(mesaSchema.partial(), req.body);
    if (dados.numero !== undefined) {
      await garantirNumeroLivre(dados.numero, id);
    }
    const mesa = await prisma.mesa.update({
      where: { id },
      data: {
        numero: dados.numero,
        nome: nomeOuNulo(dados.nome),
        lugares: dados.lugares,
        ativa: dados.ativa,
      },
    });
    res.json(mesa);
  })
);

// Troca o segredo do endereço da mesa: o QR code antigo para de funcionar.
router.post(
  '/mesas/:id/novo-codigo',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const mesa = await prisma.mesa.update({ where: { id }, data: { codigo: novoCodigoDeMesa() } });
    res.json(mesa);
  })
);

router.delete(
  '/mesas/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const abertos = await prisma.pedido.count({
      where: { mesaId: id, pagoEm: null, status: { not: 'CANCELADO' } },
    });
    if (abertos > 0) {
      throw new HttpError(400, 'Esta mesa tem conta aberta. Feche a conta antes de excluir.');
    }
    const historico = await prisma.pedido.count({ where: { mesaId: id } });
    if (historico > 0) {
      throw new HttpError(
        400,
        'Esta mesa já teve pedidos e fica no histórico. Desative a mesa em vez de excluir.'
      );
    }
    await prisma.mesa.delete({ where: { id } });
    res.status(204).end();
  })
);

router.post(
  '/mesas/:id/atender-chamado',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await prisma.mesa.update({ where: { id }, data: { chamandoDesde: null } });
    res.status(204).end();
  })
);

async function carregarConta(mesaId: number) {
  const mesa = await prisma.mesa.findUnique({ where: { id: mesaId } });
  if (!mesa) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  const pedidos = await prisma.pedido.findMany({
    where: { mesaId, pagoEm: null, status: { not: 'CANCELADO' } },
    include: incluirPedido,
    orderBy: { criadoEm: 'asc' },
  });
  const lista = pedidos.map(paraPedidoDTO);
  const total = Math.round(lista.reduce((soma, p) => soma + p.total, 0) * 100) / 100;
  return {
    mesa: { id: mesa.id, numero: mesa.numero, nome: mesa.nome },
    pedidos: lista,
    total,
  };
}

router.get(
  '/mesas/:id/conta',
  asyncHandler(async (req, res) => {
    res.json(await carregarConta(idParam(req)));
  })
);

const fecharSchema = z.object({
  formaPagamento: z.enum(['Dinheiro', 'Pix', 'Cartão de débito', 'Cartão de crédito']),
});

// Fecha a conta: marca como pagos todos os pedidos em aberto da mesa e libera a mesa.
router.post(
  '/mesas/:id/fechar-conta',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { formaPagamento } = validar(fecharSchema, req.body);
    const conta = await carregarConta(id);
    if (conta.pedidos.length === 0) {
      throw new HttpError(400, 'Esta mesa não tem conta aberta.');
    }
    const agora = new Date();
    const ids = conta.pedidos.map((p) => p.id);
    await prisma.$transaction([
      prisma.pedido.updateMany({
        where: { id: { in: ids }, pagoEm: null },
        data: { pagoEm: agora, formaPagamento, status: 'ENTREGUE' },
      }),
      prisma.mesa.update({ where: { id }, data: { chamandoDesde: null } }),
    ]);
    res.json({ total: conta.total, pedidos: ids.length });
  })
);

export default router;
