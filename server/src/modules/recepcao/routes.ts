import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { inicioDoDia } from '../../lib/pedidos';
import { ocuparMesa } from '../../lib/mesas';

// Recepção: fila de espera e reservas. Só o gestor e a recepção usam.

const router = Router();
const recepcao = permitir('GESTOR', 'RECEPCAO');

const MS_DIA = 24 * 60 * 60 * 1000;

const pessoa = {
  nome: z.string().trim().min(1, 'Nome obrigatório').max(60, 'Nome muito longo'),
  pessoas: z.number().int().min(1, 'Informe quantas pessoas').max(99, 'Número de pessoas inválido'),
  telefone: z.string().trim().max(30, 'Telefone muito longo').nullable().optional(),
  observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
};

function vazioViraNulo(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  return valor || null;
}

async function mesaLivre(mesaId: number) {
  const mesa = await prisma.mesa.findUnique({ where: { id: mesaId } });
  if (!mesa || !mesa.ativa) {
    throw new HttpError(400, 'Mesa não encontrada ou desativada');
  }
  const abertos = await prisma.pedido.count({ where: { mesaId, pagoEm: null, status: { not: 'CANCELADO' } } });
  if (mesa.estado !== 'LIVRE' || abertos > 0) {
    throw new HttpError(400, `A mesa ${mesa.numero} não está livre.`);
  }
  return mesa;
}

// ---------- Fila de espera ----------

function paraEsperaDTO(e: {
  id: number;
  nome: string;
  pessoas: number;
  telefone: string | null;
  observacao: string | null;
  status: string;
  mesaId: number | null;
  criadoEm: Date;
  chamadoEm: Date | null;
}) {
  return {
    id: e.id,
    nome: e.nome,
    pessoas: e.pessoas,
    telefone: e.telefone,
    observacao: e.observacao,
    status: e.status,
    mesaId: e.mesaId,
    criadoEm: e.criadoEm.toISOString(),
    chamadoEm: e.chamadoEm ? e.chamadoEm.toISOString() : null,
  };
}

// Quem está esperando agora (aguardando ou já chamado), por ordem de chegada.
router.get(
  '/espera',
  recepcao,
  asyncHandler(async (_req, res) => {
    const [fila, hoje] = await Promise.all([
      prisma.espera.findMany({
        where: { status: { in: ['AGUARDANDO', 'CHAMADO'] } },
        orderBy: { criadoEm: 'asc' },
      }),
      prisma.espera.findMany({
        where: { status: 'ACOMODADO', encerradoEm: { gte: inicioDoDia() } },
        select: { criadoEm: true, encerradoEm: true },
      }),
    ]);
    // Espera média de quem já foi acomodado hoje, em minutos.
    const esperas = hoje
      .filter((e) => e.encerradoEm !== null)
      .map((e) => ((e.encerradoEm as Date).getTime() - e.criadoEm.getTime()) / 60000);
    res.json({
      fila: fila.map(paraEsperaDTO),
      acomodadosHoje: hoje.length,
      esperaMediaMin: esperas.length > 0 ? Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length) : null,
    });
  })
);

router.post(
  '/espera',
  recepcao,
  asyncHandler(async (req, res) => {
    const dados = validar(z.object(pessoa), req.body);
    const espera = await prisma.espera.create({
      data: {
        nome: dados.nome,
        pessoas: dados.pessoas,
        telefone: dados.telefone || null,
        observacao: dados.observacao || null,
      },
    });
    res.status(201).json(paraEsperaDTO(espera));
  })
);

const andamentoSchema = z.object({
  // CHAMADO: a mesa está pronta e a pessoa foi chamada. ACOMODADO: sentou (precisa da mesa). DESISTIU: saiu da fila.
  status: z.enum(['AGUARDANDO', 'CHAMADO', 'ACOMODADO', 'DESISTIU']),
  mesaId: z.number().int().positive().nullable().optional(),
});

router.put(
  '/espera/:id/status',
  recepcao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(andamentoSchema, req.body);
    const atual = await prisma.espera.findUnique({ where: { id } });
    if (!atual) {
      throw new HttpError(404, 'Pessoa não encontrada na fila');
    }
    if (atual.status === 'ACOMODADO' || atual.status === 'DESISTIU') {
      throw new HttpError(400, 'Esta pessoa já saiu da fila.');
    }
    const agora = new Date();
    if (dados.status === 'ACOMODADO') {
      if (!dados.mesaId) {
        throw new HttpError(400, 'Escolha a mesa em que a pessoa vai sentar.');
      }
      const mesa = await mesaLivre(dados.mesaId);
      await ocuparMesa(mesa.id);
      const espera = await prisma.espera.update({
        where: { id },
        data: { status: 'ACOMODADO', mesaId: mesa.id, encerradoEm: agora },
      });
      res.json(paraEsperaDTO(espera));
      return;
    }
    const espera = await prisma.espera.update({
      where: { id },
      data: {
        status: dados.status,
        chamadoEm: dados.status === 'CHAMADO' ? agora : dados.status === 'AGUARDANDO' ? null : undefined,
        encerradoEm: dados.status === 'DESISTIU' ? agora : undefined,
      },
    });
    res.json(paraEsperaDTO(espera));
  })
);

// ---------- Reservas ----------

const incluirMesa = { mesa: { select: { id: true, numero: true, nome: true, lugares: true } } } as const;

const reservaCampos = {
  ...pessoa,
  dataHora: z.string().refine((valor) => !Number.isNaN(new Date(valor).getTime()), 'Data e hora inválidas'),
  mesaId: z.number().int().positive().nullable().optional(),
};

// Mesma mesa não recebe duas reservas ativas a menos de duas horas uma da outra.
async function garantirMesaDisponivel(mesaId: number | null | undefined, quando: Date, ignorarId?: number) {
  if (!mesaId) return;
  const mesa = await prisma.mesa.findUnique({ where: { id: mesaId }, select: { ativa: true, numero: true } });
  if (!mesa || !mesa.ativa) {
    throw new HttpError(400, 'Mesa não encontrada ou desativada');
  }
  const janela = 2 * 60 * 60 * 1000;
  const conflito = await prisma.reserva.findFirst({
    where: {
      mesaId,
      status: 'ATIVA',
      dataHora: { gt: new Date(quando.getTime() - janela), lt: new Date(quando.getTime() + janela) },
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { nome: true, dataHora: true },
  });
  if (conflito) {
    const hora = conflito.dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    throw new HttpError(409, `A mesa ${mesa.numero} já está reservada para ${conflito.nome} às ${hora}.`);
  }
}

// Reservas de um dia (padrão: hoje) ou, com proximas=1, as ativas daqui para a frente.
router.get(
  '/reservas',
  recepcao,
  asyncHandler(async (req, res) => {
    const proximas = req.query.proximas === '1';
    const dia = typeof req.query.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dia) ? req.query.dia : null;
    let where;
    if (proximas) {
      where = { status: 'ATIVA' as const, dataHora: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } };
    } else {
      const inicio = dia ? new Date(`${dia}T00:00:00`) : inicioDoDia();
      where = { dataHora: { gte: inicio, lt: new Date(inicio.getTime() + MS_DIA) } };
    }
    const reservas = await prisma.reserva.findMany({
      where,
      include: incluirMesa,
      orderBy: { dataHora: 'asc' },
      take: 200,
    });
    res.json(reservas.map((r) => ({ ...r, dataHora: r.dataHora.toISOString(), criadoEm: r.criadoEm.toISOString() })));
  })
);

router.post(
  '/reservas',
  recepcao,
  asyncHandler(async (req, res) => {
    const dados = validar(z.object(reservaCampos), req.body);
    const quando = new Date(dados.dataHora);
    if (quando.getTime() < Date.now() - 10 * 60 * 1000) {
      throw new HttpError(400, 'A reserva precisa ser para um horário que ainda não passou.');
    }
    await garantirMesaDisponivel(dados.mesaId, quando);
    const reserva = await prisma.reserva.create({
      data: {
        nome: dados.nome,
        pessoas: dados.pessoas,
        telefone: dados.telefone || null,
        observacao: dados.observacao || null,
        dataHora: quando,
        mesaId: dados.mesaId ?? null,
      },
      include: incluirMesa,
    });
    res.status(201).json(reserva);
  })
);

router.put(
  '/reservas/:id',
  recepcao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(z.object(reservaCampos).partial(), req.body);
    const atual = await prisma.reserva.findUnique({ where: { id } });
    if (!atual) {
      throw new HttpError(404, 'Reserva não encontrada');
    }
    const quando = dados.dataHora ? new Date(dados.dataHora) : atual.dataHora;
    const mesaId = dados.mesaId === undefined ? atual.mesaId : dados.mesaId;
    await garantirMesaDisponivel(mesaId, quando, id);
    const reserva = await prisma.reserva.update({
      where: { id },
      data: {
        nome: dados.nome,
        pessoas: dados.pessoas,
        telefone: vazioViraNulo(dados.telefone),
        observacao: vazioViraNulo(dados.observacao),
        dataHora: dados.dataHora ? quando : undefined,
        mesaId: dados.mesaId,
      },
      include: incluirMesa,
    });
    res.json(reserva);
  })
);

const situacaoSchema = z.object({
  // CHEGOU: o cliente chegou e foi acomodado (ocupa a mesa escolhida). CANCELADA e NAO_COMPARECEU encerram.
  status: z.enum(['ATIVA', 'CHEGOU', 'CANCELADA', 'NAO_COMPARECEU']),
  mesaId: z.number().int().positive().nullable().optional(),
});

router.put(
  '/reservas/:id/status',
  recepcao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(situacaoSchema, req.body);
    const atual = await prisma.reserva.findUnique({ where: { id } });
    if (!atual) {
      throw new HttpError(404, 'Reserva não encontrada');
    }
    let mesaId = atual.mesaId;
    if (dados.status === 'CHEGOU') {
      mesaId = dados.mesaId ?? atual.mesaId;
      if (!mesaId) {
        throw new HttpError(400, 'Escolha a mesa em que o cliente vai sentar.');
      }
      const mesa = await mesaLivre(mesaId);
      await ocuparMesa(mesa.id);
    }
    const reserva = await prisma.reserva.update({
      where: { id },
      data: { status: dados.status, mesaId },
      include: incluirMesa,
    });
    res.json(reserva);
  })
);

export default router;
