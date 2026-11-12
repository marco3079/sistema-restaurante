import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Salão: planta do restaurante (imagem enviada pelo gestor) e áreas com seus garçons.
// A posição de cada mesa na planta fica na própria mesa (modules/mesas).

const router = Router();
const equipeDoSalao = permitir('GESTOR', 'GARCOM');

// ---------- Planta ----------

const PREFIXOS_IMAGEM = ['data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,'];
// A tela reduz a imagem antes de enviar; o limite do corpo da API é 1 MB.
const MAX_PLANTA = 950_000;

const plantaSchema = z.object({
  imagem: z.string().max(MAX_PLANTA, 'A imagem da planta é grande demais'),
  largura: z.number().int().min(50).max(10000),
  altura: z.number().int().min(50).max(10000),
});

router.get(
  '/planta',
  equipeDoSalao,
  asyncHandler(async (_req, res) => {
    const planta = await prisma.planta.findUnique({ where: { id: 1 } });
    res.json(
      planta
        ? {
            imagem: planta.imagem,
            largura: planta.largura,
            altura: planta.altura,
            atualizadaEm: planta.atualizadaEm.toISOString(),
          }
        : null
    );
  })
);

router.put(
  '/planta',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(plantaSchema, req.body);
    if (!PREFIXOS_IMAGEM.some((prefixo) => dados.imagem.startsWith(prefixo))) {
      throw new HttpError(400, 'A planta precisa ser uma imagem JPEG, PNG ou WebP.');
    }
    await prisma.planta.upsert({
      where: { id: 1 },
      create: { id: 1, ...dados },
      update: dados,
    });
    res.status(204).end();
  })
);

// Tira a planta. As mesas e as áreas continuam; só perdem o desenho de fundo.
router.delete(
  '/planta',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    await prisma.planta.deleteMany({ where: { id: 1 } });
    res.status(204).end();
  })
);

// ---------- Áreas ----------

const fracao = z.number().min(0).max(1);

const areaSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(40, 'Nome muito longo'),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
  // Retângulo da área na planta, em frações de 0 a 1. null = área sem desenho.
  x: fracao.nullable().optional(),
  y: fracao.nullable().optional(),
  largura: fracao.nullable().optional(),
  altura: fracao.nullable().optional(),
  // Garçons responsáveis pela área (pode ser mais de um).
  garconsIds: z.array(z.number().int().positive()).max(50).optional(),
});

const incluirArea = {
  garcons: { select: { id: true, nome: true, ativo: true }, orderBy: { nome: 'asc' as const } },
  _count: { select: { mesas: true } },
};

type AreaCompleta = Awaited<ReturnType<typeof carregarArea>>;

async function carregarArea(id: number) {
  const area = await prisma.area.findUnique({ where: { id }, include: incluirArea });
  if (!area) {
    throw new HttpError(404, 'Área não encontrada');
  }
  return area;
}

function paraAreaDTO(a: AreaCompleta) {
  return {
    id: a.id,
    nome: a.nome,
    cor: a.cor,
    x: a.x,
    y: a.y,
    largura: a.largura,
    altura: a.altura,
    garcons: a.garcons,
    mesas: a._count.mesas,
  };
}

async function garantirGarcons(ids: number[] | undefined): Promise<void> {
  if (!ids || ids.length === 0) return;
  const garcons = await prisma.usuario.count({ where: { id: { in: ids }, perfil: 'GARCOM' } });
  if (garcons !== new Set(ids).size) {
    throw new HttpError(400, 'Só garçons podem ser responsáveis por uma área');
  }
}

async function garantirNomeLivre(nome: string, ignorarId?: number): Promise<void> {
  const outra = await prisma.area.findFirst({
    where: { nome: { equals: nome, mode: 'insensitive' }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  if (outra) {
    throw new HttpError(409, `Já existe a área "${nome}"`);
  }
}

router.get(
  '/areas',
  equipeDoSalao,
  asyncHandler(async (_req, res) => {
    const areas = await prisma.area.findMany({ include: incluirArea, orderBy: { nome: 'asc' } });
    res.json(areas.map(paraAreaDTO));
  })
);

router.post(
  '/areas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(areaSchema, req.body);
    await garantirNomeLivre(dados.nome);
    await garantirGarcons(dados.garconsIds);
    const area = await prisma.area.create({
      data: {
        nome: dados.nome,
        cor: dados.cor.toLowerCase(),
        x: dados.x ?? null,
        y: dados.y ?? null,
        largura: dados.largura ?? null,
        altura: dados.altura ?? null,
        garcons: { connect: [...new Set(dados.garconsIds ?? [])].map((id) => ({ id })) },
      },
    });
    res.status(201).json(paraAreaDTO(await carregarArea(area.id)));
  })
);

router.put(
  '/areas/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(areaSchema.partial(), req.body);
    await carregarArea(id);
    if (dados.nome !== undefined) {
      await garantirNomeLivre(dados.nome, id);
    }
    await garantirGarcons(dados.garconsIds);
    await prisma.area.update({
      where: { id },
      data: {
        nome: dados.nome,
        cor: dados.cor?.toLowerCase(),
        x: dados.x,
        y: dados.y,
        largura: dados.largura,
        altura: dados.altura,
        garcons:
          dados.garconsIds === undefined
            ? undefined
            : { set: [...new Set(dados.garconsIds)].map((garcomId) => ({ id: garcomId })) },
      },
    });
    res.json(paraAreaDTO(await carregarArea(id)));
  })
);

// Excluir a área não exclui as mesas: elas ficam sem área.
router.delete(
  '/areas/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await carregarArea(id);
    await prisma.$transaction([
      prisma.mesa.updateMany({ where: { areaId: id }, data: { areaId: null } }),
      prisma.area.delete({ where: { id } }),
    ]);
    res.status(204).end();
  })
);

export default router;
