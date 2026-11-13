import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Setores de preparo (cozinha, bar, sobremesas). Cada categoria do cardápio pode ir para um setor
// e cada pessoa da cozinha pode estar em um setor. O gestor cadastra; a equipe lê.

const router = Router();
const qualquerPerfil = permitir('GESTOR', 'GARCOM', 'COZINHA', 'LIMPEZA', 'RECEPCAO');
const gestor = permitir('GESTOR');

const incluirSetor = {
  // Categorias excluídas pelo gestor não contam.
  categorias: { where: { excluida: false }, select: { id: true } },
  usuarios: { select: { id: true, nome: true }, orderBy: { nome: 'asc' } },
} satisfies Prisma.SetorInclude;

type SetorCompleto = Prisma.SetorGetPayload<{ include: typeof incluirSetor }>;

function paraSetorDTO(s: SetorCompleto) {
  return {
    id: s.id,
    nome: s.nome,
    cor: s.cor,
    ativo: s.ativo,
    ordem: s.ordem,
    categorias: s.categorias.length,
    usuarios: s.usuarios,
  };
}

const setorSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do setor').max(40, 'Nome muito longo'),
  cor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
    .optional(),
  ordem: z.number().int('Use um número inteiro').min(0, 'Ordem inválida').optional(),
  ativo: z.boolean().optional(),
});

const usuariosSchema = z.object({
  usuarioIds: z.array(z.number().int().positive()).max(500),
});

const todosSchema = z.object({
  todos: z.enum(['0', '1']).optional(),
});

async function garantirNomeLivre(nome: string, ignorarId?: number): Promise<void> {
  const outro = await prisma.setor.findFirst({
    where: ignorarId === undefined ? { nome } : { nome, id: { not: ignorarId } },
    select: { id: true },
  });
  if (outro) {
    throw new HttpError(409, 'Já existe um setor com este nome');
  }
}

async function garantirSetor(id: number): Promise<void> {
  const setor = await prisma.setor.findUnique({ where: { id }, select: { id: true } });
  if (!setor) {
    throw new HttpError(404, 'Setor não encontrado');
  }
}

router.get(
  '/setores',
  qualquerPerfil,
  asyncHandler(async (req, res) => {
    const filtro = validar(todosSchema, req.query);
    // Só o gestor vê os setores desativados.
    const verTodos = filtro.todos === '1' && req.usuario.perfil === 'GESTOR';
    const setores = await prisma.setor.findMany({
      where: verTodos ? {} : { ativo: true },
      include: incluirSetor,
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
    res.json(setores.map(paraSetorDTO));
  })
);

// Setor do usuário logado, lido do banco.
router.get(
  '/setores/meu',
  qualquerPerfil,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: { setor: { select: { id: true, nome: true, cor: true } } },
    });
    res.json({ setor: usuario?.setor ?? null });
  })
);

router.post(
  '/setores',
  gestor,
  asyncHandler(async (req, res) => {
    const dados = validar(setorSchema, req.body);
    await garantirNomeLivre(dados.nome);
    const criado = await prisma.setor.create({
      data: {
        nome: dados.nome,
        cor: dados.cor,
        ordem: dados.ordem,
        ativo: dados.ativo,
      },
      include: incluirSetor,
    });
    res.status(201).json(paraSetorDTO(criado));
  })
);

router.put(
  '/setores/:id',
  gestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(setorSchema, req.body);
    await garantirSetor(id);
    await garantirNomeLivre(dados.nome, id);
    const atualizado = await prisma.setor.update({
      where: { id },
      data: {
        nome: dados.nome,
        cor: dados.cor,
        ordem: dados.ordem,
        ativo: dados.ativo,
      },
      include: incluirSetor,
    });
    res.json(paraSetorDTO(atualizado));
  })
);

router.delete(
  '/setores/:id',
  gestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await garantirSetor(id);
    await prisma.$transaction(async (tx) => {
      // O banco não desliga sozinho essas relações: tira o setor das categorias e das pessoas antes.
      await tx.categoria.updateMany({ where: { setorId: id }, data: { setorId: null } });
      await tx.usuario.updateMany({ where: { setorId: id }, data: { setorId: null } });
      await tx.setor.delete({ where: { id } });
    });
    res.json({ ok: true });
  })
);

// Define quem trabalha no setor. Só a cozinha pode estar em um setor.
router.put(
  '/setores/:id/usuarios',
  gestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(usuariosSchema, req.body);
    await garantirSetor(id);
    const ids = [...new Set(dados.usuarioIds)];
    const usuarios = await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, perfil: true } });
    if (usuarios.length !== ids.length) {
      throw new HttpError(400, 'Um dos usuários não existe');
    }
    if (usuarios.some((u) => u.perfil !== 'COZINHA')) {
      throw new HttpError(400, 'Só quem é da cozinha pode entrar em um setor');
    }
    await prisma.$transaction(async (tx) => {
      // Quem estava no setor e saiu da lista fica sem setor.
      await tx.usuario.updateMany({ where: { setorId: id, id: { notIn: ids } }, data: { setorId: null } });
      await tx.usuario.updateMany({ where: { id: { in: ids } }, data: { setorId: id } });
    });
    const setor = await prisma.setor.findUniqueOrThrow({ where: { id }, include: incluirSetor });
    res.json(paraSetorDTO(setor));
  })
);

export default router;
