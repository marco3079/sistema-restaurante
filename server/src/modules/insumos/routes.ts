import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { entradaDeInsumo, movimentarInsumo } from '../../lib/insumos';

// Insumos (matéria-prima), fichas técnicas dos pratos e custo/margem. O gestor cadastra e lança
// movimentos; a cozinha só consulta a situação do estoque (sem custo).

const router = Router();

const UNIDADES = ['KG', 'G', 'L', 'ML', 'UN'] as const;
const LIMITE_QUANTIDADE = 999999999;

type Situacao = 'OK' | 'BAIXO' | 'ZERADO';

function arredondar(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

function situacaoDe(estoque: number, estoqueMinimo: number): Situacao {
  if (estoque <= 0) return 'ZERADO';
  if (estoqueMinimo > 0 && estoque <= estoqueMinimo) return 'BAIXO';
  return 'OK';
}

async function nomeDoUsuario(id: number): Promise<string | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } });
  return usuario?.nome ?? null;
}

// ---------- Insumos ----------

const insumoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(60, 'Nome muito longo'),
  unidade: z.enum(UNIDADES, { message: 'Unidade inválida' }),
  estoqueMinimo: z.number().min(0, 'Estoque mínimo inválido').max(LIMITE_QUANTIDADE, 'Estoque mínimo inválido').optional(),
  custoUnitario: z.number().min(0, 'Custo inválido').max(LIMITE_QUANTIDADE, 'Custo inválido').optional(),
});

const atualizarInsumoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(60, 'Nome muito longo').optional(),
  unidade: z.enum(UNIDADES, { message: 'Unidade inválida' }).optional(),
  estoqueMinimo: z.number().min(0, 'Estoque mínimo inválido').max(LIMITE_QUANTIDADE, 'Estoque mínimo inválido').optional(),
  custoUnitario: z.number().min(0, 'Custo inválido').max(LIMITE_QUANTIDADE, 'Custo inválido').optional(),
  ativo: z.boolean().optional(),
});

type InsumoComUso = {
  id: number;
  nome: string;
  unidade: (typeof UNIDADES)[number];
  estoque: Prisma.Decimal;
  estoqueMinimo: Prisma.Decimal;
  custoUnitario: Prisma.Decimal;
  ativo: boolean;
  _count: { fichas: number };
};

function paraInsumoDTO(i: InsumoComUso, comCusto: boolean) {
  const estoque = Number(i.estoque);
  const estoqueMinimo = Number(i.estoqueMinimo);
  return {
    id: i.id,
    nome: i.nome,
    unidade: i.unidade,
    estoque,
    estoqueMinimo,
    custoUnitario: comCusto ? Number(i.custoUnitario) : 0,
    ativo: i.ativo,
    situacao: situacaoDe(estoque, estoqueMinimo),
    usadoEm: i._count.fichas,
  };
}

const SELECT_INSUMO = {
  id: true,
  nome: true,
  unidade: true,
  estoque: true,
  estoqueMinimo: true,
  custoUnitario: true,
  ativo: true,
  _count: { select: { fichas: true } },
} as const;

async function buscarInsumo(id: number): Promise<InsumoComUso> {
  const insumo = await prisma.insumo.findUnique({ where: { id }, select: SELECT_INSUMO });
  if (!insumo) throw new HttpError(404, 'Insumo não encontrado');
  return insumo;
}

async function garantirNomeLivre(nome: string, ignorarId?: number): Promise<void> {
  const outro = await prisma.insumo.findUnique({ where: { nome }, select: { id: true } });
  if (outro && outro.id !== ignorarId) {
    throw new HttpError(409, 'Já existe um insumo com este nome');
  }
}

router.get(
  '/insumos',
  permitir('GESTOR', 'COZINHA'),
  asyncHandler(async (req, res) => {
    const gestor = req.usuario.perfil === 'GESTOR';
    const mostrarTodos = gestor && req.query.todos === '1';
    const insumos = await prisma.insumo.findMany({
      where: mostrarTodos ? {} : { ativo: true },
      select: SELECT_INSUMO,
      orderBy: { nome: 'asc' },
    });
    res.json(insumos.map((i) => paraInsumoDTO(i, gestor)));
  })
);

router.post(
  '/insumos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(insumoSchema, req.body);
    await garantirNomeLivre(dados.nome);
    const criado = await prisma.insumo.create({
      data: {
        nome: dados.nome,
        unidade: dados.unidade,
        estoqueMinimo: (dados.estoqueMinimo ?? 0).toFixed(3),
        custoUnitario: (dados.custoUnitario ?? 0).toFixed(4),
      },
      select: SELECT_INSUMO,
    });
    res.status(201).json(paraInsumoDTO(criado, true));
  })
);

router.put(
  '/insumos/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarInsumoSchema, req.body);
    await buscarInsumo(id);
    if (dados.nome !== undefined) {
      await garantirNomeLivre(dados.nome, id);
    }
    const atualizado = await prisma.insumo.update({
      where: { id },
      data: {
        ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
        ...(dados.unidade !== undefined ? { unidade: dados.unidade } : {}),
        ...(dados.estoqueMinimo !== undefined ? { estoqueMinimo: dados.estoqueMinimo.toFixed(3) } : {}),
        ...(dados.custoUnitario !== undefined ? { custoUnitario: dados.custoUnitario.toFixed(4) } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
      },
      select: SELECT_INSUMO,
    });
    res.json(paraInsumoDTO(atualizado, true));
  })
);

router.delete(
  '/insumos/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const insumo = await prisma.insumo.findUnique({
      where: { id },
      select: { id: true, _count: { select: { fichas: true, movimentos: true, compraItens: true } } },
    });
    if (!insumo) throw new HttpError(404, 'Insumo não encontrado');

    if (insumo._count.fichas > 0) {
      throw new HttpError(409, 'Este insumo está em fichas técnicas. Tire-o das fichas ou desative-o.');
    }
    // Com histórico (movimentos ou compras), não apaga: só desativa, para não perder o registro.
    if (insumo._count.movimentos > 0 || insumo._count.compraItens > 0) {
      await prisma.insumo.update({ where: { id }, data: { ativo: false } });
      res.json({ desativado: true });
      return;
    }
    await prisma.insumo.delete({ where: { id } });
    res.json({ desativado: false });
  })
);

// ---------- Movimentos de insumo ----------

const movimentoInsumoSchema = z.object({
  tipo: z.enum(['ENTRADA', 'SAIDA', 'AJUSTE'], { message: 'Tipo inválido' }),
  // ENTRADA e SAIDA: quantas unidades. AJUSTE: o saldo contado.
  quantidade: z.number().min(0, 'Quantidade inválida').max(LIMITE_QUANTIDADE, 'Quantidade inválida'),
  custoUnitario: z.number().min(0, 'Custo inválido').max(LIMITE_QUANTIDADE, 'Custo inválido').nullable().optional(),
  motivo: z.string().trim().max(120, 'Motivo muito longo').nullable().optional(),
});

router.get(
  '/insumos/:id/movimentos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await buscarInsumo(id);
    const movimentos = await prisma.movimentoInsumo.findMany({
      where: { insumoId: id },
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    res.json(
      movimentos.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        quantidade: Number(m.quantidade),
        saldo: Number(m.saldo),
        motivo: m.motivo,
        usuarioNome: m.usuarioNome,
        criadoEm: m.criadoEm.toISOString(),
      }))
    );
  })
);

router.post(
  '/insumos/:id/movimentos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const insumoId = idParam(req);
    const dados = validar(movimentoInsumoSchema, req.body);
    const quantidade = arredondar(dados.quantidade, 3);
    if (dados.tipo !== 'AJUSTE' && quantidade <= 0) {
      throw new HttpError(400, 'Informe a quantidade.');
    }
    const motivo = dados.motivo || null;
    const usuarioNome = await nomeDoUsuario(req.usuario.id);

    const saldo = await prisma.$transaction(async (tx) => {
      const atual = await tx.insumo.findUnique({ where: { id: insumoId }, select: { estoque: true } });
      if (!atual) throw new HttpError(404, 'Insumo não encontrado');

      if (dados.tipo === 'ENTRADA') {
        return entradaDeInsumo(tx, {
          insumoId,
          quantidade,
          custoUnitario: dados.custoUnitario ?? null,
          motivo,
          usuarioNome,
        });
      }
      if (dados.tipo === 'SAIDA') {
        return movimentarInsumo(tx, insumoId, 'SAIDA', -quantidade, motivo, usuarioNome);
      }
      // Acerto de contagem: a quantidade é o saldo contado; grava só a diferença.
      const delta = arredondar(quantidade - Number(atual.estoque), 3);
      if (delta === 0) return Number(atual.estoque);
      return movimentarInsumo(tx, insumoId, 'AJUSTE', delta, motivo, usuarioNome);
    });

    res.json({ saldo });
  })
);

// ---------- Fichas técnicas e custo ----------

const fichaSchema = z.object({
  itens: z.array(
    z.object({
      insumoId: z.number().int('Insumo inválido').positive('Insumo inválido'),
      quantidade: z
        .number()
        .positive('Quantidade inválida')
        .max(LIMITE_QUANTIDADE, 'Quantidade inválida'),
    })
  ),
});

type ProdutoDaFicha = {
  id: number;
  nome: string;
  imagem: string | null;
  preco: Prisma.Decimal;
  categoria: { nome: string };
  fichaItens: {
    quantidade: Prisma.Decimal;
    insumo: { id: number; nome: string; unidade: string; custoUnitario: Prisma.Decimal };
  }[];
};

const SELECT_FICHA = {
  id: true,
  nome: true,
  imagem: true,
  preco: true,
  categoria: { select: { nome: true } },
  fichaItens: {
    select: {
      quantidade: true,
      insumo: { select: { id: true, nome: true, unidade: true, custoUnitario: true } },
    },
    orderBy: { insumo: { nome: 'asc' } },
  },
} as const;

// Custo: soma com 4 casas; a resposta sai com 2 casas. Margem e CMV em percentual com 1 casa.
function paraFichaDTO(p: ProdutoDaFicha) {
  const preco = Number(p.preco);
  const itens = p.fichaItens.map((fi) => {
    const quantidade = Number(fi.quantidade);
    const custoUnitario = Number(fi.insumo.custoUnitario);
    const custo4 = quantidade * custoUnitario;
    return {
      insumoId: fi.insumo.id,
      nome: fi.insumo.nome,
      unidade: fi.insumo.unidade,
      quantidade,
      custoUnitario,
      custo4,
    };
  });
  const custo4Total = arredondar(itens.reduce((soma, i) => soma + i.custo4, 0), 4);
  const semFicha = itens.length === 0;
  const margem4 = preco - custo4Total;
  return {
    produtoId: p.id,
    nome: p.nome,
    categoria: p.categoria.nome,
    imagem: p.imagem,
    preco: arredondar(preco, 2),
    itens: itens.map(({ custo4, ...i }) => ({ ...i, custo: arredondar(custo4, 2) })),
    custo: arredondar(custo4Total, 2),
    margem: arredondar(margem4, 2),
    margemPercentual: semFicha || preco === 0 ? null : arredondar((margem4 / preco) * 100, 1),
    cmvPercentual: semFicha || preco === 0 ? null : arredondar((custo4Total / preco) * 100, 1),
  };
}

async function buscarFicha(produtoId: number) {
  const produto = await prisma.produto.findUnique({ where: { id: produtoId }, select: SELECT_FICHA });
  if (!produto) throw new HttpError(404, 'Produto não encontrado');
  return paraFichaDTO(produto);
}

router.get(
  '/fichas',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const produtos = await prisma.produto.findMany({
      where: { ativo: true },
      select: SELECT_FICHA,
      orderBy: [{ categoria: { ordem: 'asc' } }, { nome: 'asc' }],
    });
    res.json(produtos.map(paraFichaDTO));
  })
);

router.put(
  '/fichas/:produtoId',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const produtoId = idParam(req, 'produtoId');
    const dados = validar(fichaSchema, req.body);

    const produto = await prisma.produto.findUnique({ where: { id: produtoId }, select: { id: true } });
    if (!produto) throw new HttpError(404, 'Produto não encontrado');

    const linhas = dados.itens.map((i) => ({
      insumoId: i.insumoId,
      quantidade: arredondar(i.quantidade, 3),
    }));
    if (linhas.some((l) => l.quantidade <= 0)) {
      throw new HttpError(400, 'Quantidade inválida');
    }
    const ids = linhas.map((l) => l.insumoId);
    if (new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'Insumo repetido na ficha');
    }
    if (ids.length > 0) {
      const insumos = await prisma.insumo.findMany({
        where: { id: { in: ids }, ativo: true },
        select: { id: true },
      });
      if (insumos.length !== ids.length) {
        throw new HttpError(400, 'Insumo inexistente ou inativo');
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.fichaItem.deleteMany({ where: { produtoId } });
      if (linhas.length > 0) {
        await tx.fichaItem.createMany({
          data: linhas.map((l) => ({
            produtoId,
            insumoId: l.insumoId,
            quantidade: l.quantidade.toFixed(3),
          })),
        });
      }
    });

    res.json(await buscarFicha(produtoId));
  })
);

export default router;
