import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { novoCodigoDeMesa } from '../../lib/pedidos';
import { carregarConta } from '../../lib/pagamentos';
import { valoresDaConta } from '../../lib/contas';
import { liberarParaLimpeza, marcarMesaLimpa, ocuparMesa } from '../../lib/mesas';

// Mesas do salão: cadastro (gestor), situação, garçons responsáveis, chamado do cliente e conta.
// A cobrança da conta fica em modules/pagamentos; áreas e planta ficam em modules/salao.
// A cozinha não usa estas rotas. A limpeza usa só a lista de mesas para limpar e o "mesa limpa".

const router = Router();
const equipeDoSalao = permitir('GESTOR', 'GARCOM');

const posicao = z.number().min(0).max(1).nullable().optional();

const mesaSchema = z.object({
  numero: z.number().int().min(1, 'Número inválido').max(9999, 'Número inválido'),
  nome: z.string().trim().max(60, 'Nome muito longo').nullable().optional(),
  lugares: z.number().int().min(1, 'Lugares inválidos').max(99, 'Lugares inválidos').optional(),
  ativa: z.boolean().optional(),
  areaId: z.number().int().positive().nullable().optional(),
  // Posição do centro da mesa na planta, de 0 a 1 (fração da largura e da altura). null = fora da planta.
  posX: posicao,
  posY: posicao,
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

async function garantirArea(id: number | null | undefined): Promise<void> {
  if (!id) return;
  const area = await prisma.area.findUnique({ where: { id }, select: { id: true } });
  if (!area) {
    throw new HttpError(400, 'Área não encontrada');
  }
}

function nomeOuNulo(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return valor.trim() === '' ? null : valor.trim();
}

// Mesas com a conta aberta e os garçons responsáveis de cada uma.
// Responsáveis: os garçons da área da mesa; sem área (ou área sem garçom), o garçom do pedido
// em aberto mais recente da mesa. Sem nenhum dos dois, a mesa não tem responsável.
async function situacaoDasMesas() {
  const [contas, mesas, abertos] = await Promise.all([
    prisma.conta.findMany({
      where: { status: 'ABERTA' },
      select: {
        mesaId: true,
        taxaServico: true,
        taxaPercentual: true,
        descontoManual: true,
        pontosUsados: true,
        valorDoPonto: true,
        cupom: { select: { percentual: true, valor: true, minimo: true } },
        pagamentos: { where: { status: 'APROVADO' }, select: { valor: true } },
      },
    }),
    prisma.mesa.findMany({
      orderBy: { numero: 'asc' },
      include: {
        area: {
          select: {
            id: true,
            nome: true,
            cor: true,
            garcons: { where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } },
          },
        },
      },
    }),
    prisma.pedido.findMany({
      where: { pagoEm: null, status: { not: 'CANCELADO' } },
      select: {
        mesaId: true,
        total: true,
        status: true,
        criadoEm: true,
        garcom: { select: { id: true, nome: true, perfil: true } },
      },
      orderBy: { criadoEm: 'asc' },
    }),
  ]);
  const porMesa = new Map<
    number,
    {
      total: number;
      pedidos: number;
      pendentes: number;
      desde: Date | null;
      garcom: { id: number; nome: string } | null;
    }
  >();
  for (const p of abertos) {
    const atual = porMesa.get(p.mesaId) ?? { total: 0, pedidos: 0, pendentes: 0, desde: null, garcom: null };
    atual.total += Number(p.total);
    atual.pedidos += 1;
    if (p.status !== 'ENTREGUE') atual.pendentes += 1;
    if (atual.desde === null) atual.desde = p.criadoEm;
    // A cozinha mexe no pedido, mas não atende a mesa.
    if (p.garcom && p.garcom.perfil !== 'COZINHA') atual.garcom = { id: p.garcom.id, nome: p.garcom.nome };
    porMesa.set(p.mesaId, atual);
  }
  return mesas.map((m) => {
    const conta = porMesa.get(m.id);
    // O que falta pagar: pedidos mais a taxa de serviço, menos o que já foi pago em partes.
    const contaAbertaDaMesa = contas.find((c) => c.mesaId === m.id) ?? null;
    const valores = valoresDaConta(
      contaAbertaDaMesa,
      conta?.total ?? 0,
      contaAbertaDaMesa?.pagamentos.reduce((soma, p) => soma + Number(p.valor), 0) ?? 0
    );
    const daArea = m.area?.garcons ?? [];
    const responsaveis = daArea.length > 0 ? daArea : conta?.garcom ? [conta.garcom] : [];
    return {
      id: m.id,
      numero: m.numero,
      nome: m.nome,
      lugares: m.lugares,
      codigo: m.codigo,
      ativa: m.ativa,
      area: m.area ? { id: m.area.id, nome: m.area.nome, cor: m.area.cor } : null,
      posX: m.posX,
      posY: m.posY,
      chamandoDesde: m.chamandoDesde ? m.chamandoDesde.toISOString() : null,
      // Mesa com conta aberta está sempre ocupada; sem conta, vale o estado gravado.
      situacao: conta ? ('OCUPADA' as const) : m.estado,
      estadoDesde: m.estadoDesde.toISOString(),
      totalAberto: conta ? valores.restante : 0,
      pedidosAbertos: conta?.pedidos ?? 0,
      pedidosPendentes: conta?.pendentes ?? 0,
      abertaDesde: conta?.desde ? conta.desde.toISOString() : null,
      responsaveis,
      origemResponsaveis: daArea.length > 0 ? ('AREA' as const) : conta?.garcom ? ('PEDIDO' as const) : null,
    };
  });
}

router.get(
  '/mesas',
  equipeDoSalao,
  asyncHandler(async (_req, res) => {
    res.json(await situacaoDasMesas());
  })
);

// Chamados que são para quem está logado: mesas chamando em que a pessoa é uma das responsáveis.
// Mesa sem responsável chama todos os garçons.
router.get(
  '/chamados',
  asyncHandler(async (req, res) => {
    if (req.usuario.perfil !== 'GESTOR' && req.usuario.perfil !== 'GARCOM') {
      res.json([]);
      return;
    }
    const mesas = await situacaoDasMesas();
    const garcom = req.usuario.perfil === 'GARCOM';
    res.json(
      mesas
        .filter((m) => m.ativa && m.chamandoDesde !== null)
        .filter((m) =>
          m.responsaveis.length > 0 ? m.responsaveis.some((r) => r.id === req.usuario.id) : garcom
        )
        .map((m) => ({
          mesaId: m.id,
          numero: m.numero,
          nome: m.nome,
          area: m.area?.nome ?? null,
          desde: m.chamandoDesde,
        }))
    );
  })
);

router.post(
  '/mesas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(mesaSchema, req.body);
    await garantirNumeroLivre(dados.numero);
    await garantirArea(dados.areaId);
    const mesa = await prisma.mesa.create({
      data: {
        numero: dados.numero,
        nome: nomeOuNulo(dados.nome) ?? null,
        lugares: dados.lugares ?? 4,
        ativa: dados.ativa ?? true,
        areaId: dados.areaId ?? null,
        posX: dados.posX ?? null,
        posY: dados.posY ?? null,
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
    await garantirArea(dados.areaId);
    const mesa = await prisma.mesa.update({
      where: { id },
      data: {
        numero: dados.numero,
        nome: nomeOuNulo(dados.nome),
        lugares: dados.lugares,
        ativa: dados.ativa,
        areaId: dados.areaId,
        posX: dados.posX,
        posY: dados.posY,
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
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await prisma.mesa.update({ where: { id }, data: { chamandoDesde: null } });
    res.status(204).end();
  })
);

// O garçom ou a recepção marca a mesa como ocupada (o cliente sentou e ainda não pediu).
router.post(
  '/mesas/:id/ocupar',
  permitir('GESTOR', 'GARCOM', 'RECEPCAO'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const mesa = await prisma.mesa.findUnique({ where: { id }, select: { ativa: true } });
    if (!mesa || !mesa.ativa) {
      throw new HttpError(404, 'Mesa não encontrada ou desativada');
    }
    await ocuparMesa(id);
    res.status(204).end();
  })
);

// O garçom libera a mesa ocupada que não tem conta aberta. Ela vai para a limpeza.
router.post(
  '/mesas/:id/liberar',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const liberada = await liberarParaLimpeza(id);
    if (!liberada) {
      throw new HttpError(400, 'Esta mesa tem conta aberta. Receba a conta antes de liberar a mesa.');
    }
    res.status(204).end();
  })
);

// Mesas para a recepção acomodar os clientes: situação, lugares e área, sem pedidos nem valores.
router.get(
  '/recepcao/mesas',
  permitir('GESTOR', 'RECEPCAO'),
  asyncHandler(async (_req, res) => {
    const mesas = await situacaoDasMesas();
    res.json(
      mesas
        .filter((m) => m.ativa)
        .map((m) => ({
          id: m.id,
          numero: m.numero,
          nome: m.nome,
          lugares: m.lugares,
          area: m.area,
          situacao: m.situacao,
          desde: m.estadoDesde,
        }))
    );
  })
);

// Mesas esperando limpeza, da que espera há mais tempo para a mais recente.
router.get(
  '/limpeza/mesas',
  permitir('GESTOR', 'GARCOM', 'LIMPEZA'),
  asyncHandler(async (_req, res) => {
    const mesas = await prisma.mesa.findMany({
      where: { estado: 'LIMPEZA', ativa: true },
      orderBy: { estadoDesde: 'asc' },
      select: {
        id: true,
        numero: true,
        nome: true,
        lugares: true,
        estadoDesde: true,
        area: { select: { nome: true, cor: true } },
      },
    });
    res.json(
      mesas.map((m) => ({
        id: m.id,
        numero: m.numero,
        nome: m.nome,
        lugares: m.lugares,
        area: m.area,
        desde: m.estadoDesde.toISOString(),
      }))
    );
  })
);

router.post(
  '/mesas/:id/limpa',
  permitir('GESTOR', 'GARCOM', 'LIMPEZA'),
  asyncHandler(async (req, res) => {
    await marcarMesaLimpa(idParam(req));
    res.status(204).end();
  })
);

router.get(
  '/mesas/:id/conta',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    res.json(await carregarConta(idParam(req)));
  })
);

export default router;
