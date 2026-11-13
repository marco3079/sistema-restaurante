import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type { BairroEntrega } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { exigirAcao } from '../../lib/autorizacao';
import { incluirPedido, inicioDoDia, itensSchema } from '../../lib/pedidos';
import { FORMAS_PAGAMENTO } from '../../lib/pagamentos';
import { lerConfiguracao, limparCacheConfiguracao } from '../../lib/email';
import { montarCardapioPublico } from '../../lib/cardapioPublico';
import {
  acompanhamentoDaEntrega,
  cancelarEntrega,
  concluirEntrega,
  criarPedidoDeDelivery,
  marcarSaiu,
  paraEntregasPedidoDTO,
} from '../../lib/delivery';

// Delivery e retirada. As rotas públicas (sem login) são do cliente pelo celular; as da equipe
// e a configuração pedem login (o servidor já exige login nas rotas do `router`).

export const publico = Router();
const router = Router();

// Limite em memória por IP: pedidos de entrega em uma janela de 10 minutos.
const JANELA_MS = 10 * 60 * 1000;
const LIMITE_PEDIDOS_POR_IP = 6;
const LIMITE_LEITURAS_CARDAPIO_POR_IP = 120;
const LIMITE_LEITURAS_ACOMPANHAMENTO_POR_IP = 240;
const usos = new Map<string, number[]>();

function dentroDoLimite(chave: string, limite: number): boolean {
  const agora = Date.now();
  const recentes = (usos.get(chave) ?? []).filter((instante) => agora - instante < JANELA_MS);
  if (recentes.length >= limite) {
    usos.set(chave, recentes);
    return false;
  }
  recentes.push(agora);
  usos.set(chave, recentes);
  return true;
}

setInterval(() => {
  const agora = Date.now();
  for (const [chave, instantes] of usos) {
    const recentes = instantes.filter((instante) => agora - instante < JANELA_MS);
    if (recentes.length === 0) usos.delete(chave);
    else usos.set(chave, recentes);
  }
}, JANELA_MS).unref();

// Texto opcional: vazio conta como não informado; quando informado, precisa ter o tamanho certo.
function textoOpcional(campo: string, min: number, max: number) {
  return z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    z
      .string()
      .trim()
      .min(min, `${campo} muito curto`)
      .max(max, `${campo} muito longo`)
      .nullish()
  );
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function paraBairro(b: BairroEntrega) {
  return { id: b.id, nome: b.nome, taxa: Number(b.taxa), ativo: b.ativo };
}

// Nome de bairro repetido vira 409 com mensagem clara; outros erros seguem.
function erroDeBairro(erro: unknown): unknown {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
    return new HttpError(409, 'Já existe um bairro com este nome');
  }
  return erro;
}

// ---------- Público (sem login) ----------

// Cardápio de delivery e retirada: o mesmo cardápio da mesa, mais o que o cliente precisa para pedir.
publico.get(
  '/delivery/cardapio',
  asyncHandler(async (req, res) => {
    if (!dentroDoLimite('cardapio|' + (req.ip ?? ''), LIMITE_LEITURAS_CARDAPIO_POR_IP)) {
      throw new HttpError(429, 'Muitas consultas. Aguarde um pouco.');
    }
    const configuracao = await lerConfiguracao();
    const cardapio = await montarCardapioPublico(
      typeof req.query.idioma === 'string' ? req.query.idioma : undefined
    );
    const bairros = await prisma.bairroEntrega.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, taxa: true },
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      aberto: { delivery: configuracao.deliveryAtivo, retirada: configuracao.retiradaAtiva },
      aviso: configuracao.deliveryAviso?.trim() || null,
      pedidoMinimo: Number(configuracao.deliveryPedidoMinimo),
      tempos: { delivery: configuracao.deliveryTempoMin, retirada: configuracao.retiradaTempoMin },
      bairros: bairros.map((b) => ({ id: b.id, nome: b.nome, taxa: Number(b.taxa) })),
      formasPagamento: [...FORMAS_PAGAMENTO],
      idiomas: cardapio.idiomas,
      idioma: cardapio.idioma,
      categorias: cardapio.categorias,
    });
  })
);

const telefoneSchema = z
  .string()
  .trim()
  .transform((t) => t.replace(/\D/g, ''))
  .refine((t) => t.length === 10 || t.length === 11, 'Informe o telefone com DDD');

const pedidoDeliverySchema = z.object({
  tipo: z.enum(['DELIVERY', 'RETIRADA']),
  nome: z.string().trim().min(2, 'Informe o nome').max(60, 'Nome muito longo'),
  telefone: telefoneSchema,
  endereco: textoOpcional('Endereço', 5, 120),
  complemento: textoOpcional('Complemento', 1, 60),
  bairroId: z.number().int().positive().nullish(),
  referencia: textoOpcional('Referência', 1, 80),
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
  trocoPara: z.number().positive('Informe o valor do troco').max(100000, 'Troco muito alto').nullish(),
  observacao: textoOpcional('Observação', 1, 300),
  itens: itensSchema,
});

// Pedido de delivery ou retirada. O servidor calcula preço, taxa e total.
publico.post(
  '/delivery/pedidos',
  asyncHandler(async (req, res) => {
    const dados = validar(pedidoDeliverySchema, req.body ?? {});
    if (!dentroDoLimite('pedido|' + (req.ip ?? ''), LIMITE_PEDIDOS_POR_IP)) {
      throw new HttpError(429, 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.');
    }
    const criado = await criarPedidoDeDelivery({
      tipo: dados.tipo,
      nome: dados.nome,
      telefone: dados.telefone,
      endereco: dados.endereco ?? null,
      complemento: dados.complemento ?? null,
      bairroId: dados.bairroId ?? null,
      referencia: dados.referencia ?? null,
      formaPagamento: dados.formaPagamento,
      trocoPara: dados.trocoPara ?? null,
      observacao: dados.observacao ?? null,
      itens: dados.itens,
    });
    res.set('Cache-Control', 'no-store');
    res.status(201).json(criado);
  })
);

// Acompanhamento pelo código da entrega (12 caracteres aleatórios).
publico.get(
  '/delivery/acompanhar/:codigo',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!dentroDoLimite('acompanhar|' + (req.ip ?? ''), LIMITE_LEITURAS_ACOMPANHAMENTO_POR_IP)) {
      throw new HttpError(429, 'Muitas consultas. Aguarde um pouco.');
    }
    const codigo = req.params.codigo;
    if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{12,64}$/.test(codigo)) {
      throw new HttpError(404, 'Pedido não encontrado');
    }
    const dados = await acompanhamentoDaEntrega(codigo);
    if (!dados) {
      throw new HttpError(404, 'Pedido não encontrado');
    }
    res.json(dados);
  })
);

// ---------- Equipe (GESTOR, GARCOM, RECEPCAO) ----------

const equipe = permitir('GESTOR', 'GARCOM', 'RECEPCAO');
const gestor = permitir('GESTOR');

const verSchema = z.object({
  // andamento: não concluídos e não cancelados (mais antigo primeiro). hoje: tudo de hoje.
  ver: z.enum(['andamento', 'hoje']).optional(),
});

router.get(
  '/delivery/pedidos',
  equipe,
  asyncHandler(async (req, res) => {
    const filtro = validar(verSchema, req.query);
    const ver = filtro.ver ?? 'andamento';
    const where: Prisma.PedidoWhereInput = { mesa: { tipo: { in: ['DELIVERY', 'RETIRADA'] } } };
    if (ver === 'andamento') {
      where.status = { not: 'CANCELADO' };
      where.entrega = { is: { concluidoEm: null } };
    } else {
      where.criadoEm = { gte: inicioDoDia() };
    }
    const pedidos = await prisma.pedido.findMany({
      where,
      include: incluirPedido,
      orderBy: { criadoEm: ver === 'andamento' ? 'asc' : 'desc' },
      take: 200,
    });
    res.json(await paraEntregasPedidoDTO(pedidos));
  })
);

const saiuSchema = z.object({
  entregadorNome: z.string().trim().max(60, 'Nome muito longo').nullish(),
});

router.post(
  '/delivery/pedidos/:id/saiu',
  equipe,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(saiuSchema, req.body ?? {});
    res.json(await marcarSaiu(id, dados.entregadorNome ?? null));
  })
);

const concluirSchema = z.object({
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
});

router.post(
  '/delivery/pedidos/:id/concluir',
  equipe,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(concluirSchema, req.body);
    res.json(await concluirEntrega(id, dados.formaPagamento, { id: req.usuario.id }));
  })
);

router.post(
  '/delivery/pedidos/:id/cancelar',
  equipe,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    // Mesma permissão do cancelamento de pedido de mesa.
    await exigirAcao(req, 'CANCELAR_PEDIDO');
    res.json(await cancelarEntrega(id));
  })
);

// ---------- Configuração e bairros (GESTOR) ----------

const configuracaoSchema = z.object({
  deliveryAtivo: z.boolean(),
  retiradaAtiva: z.boolean(),
  pedidoMinimo: z.number().min(0, 'Valor inválido').max(99999.99, 'Valor muito alto'),
  deliveryTempoMin: z.number().int('Use minutos inteiros').min(0).max(600),
  retiradaTempoMin: z.number().int('Use minutos inteiros').min(0).max(600),
  aviso: z.string().trim().max(300, 'Aviso muito longo').nullish(),
});

router.get(
  '/delivery/configuracao',
  gestor,
  asyncHandler(async (_req, res) => {
    const c = await lerConfiguracao();
    const bairros = await prisma.bairroEntrega.findMany({ orderBy: { nome: 'asc' } });
    res.json({
      deliveryAtivo: c.deliveryAtivo,
      retiradaAtiva: c.retiradaAtiva,
      pedidoMinimo: Number(c.deliveryPedidoMinimo),
      deliveryTempoMin: c.deliveryTempoMin,
      retiradaTempoMin: c.retiradaTempoMin,
      aviso: c.deliveryAviso?.trim() || null,
      bairros: bairros.map(paraBairro),
    });
  })
);

router.put(
  '/delivery/configuracao',
  gestor,
  asyncHandler(async (req, res) => {
    const dados = validar(configuracaoSchema, req.body);
    const aviso = dados.aviso?.trim() || null;
    const pedidoMinimo = arredondar(dados.pedidoMinimo);
    // A configuração já existe (lerConfiguracao cria a linha se faltar).
    await lerConfiguracao();
    await prisma.configuracaoPlataforma.update({
      where: { id: 1 },
      data: {
        deliveryAtivo: dados.deliveryAtivo,
        retiradaAtiva: dados.retiradaAtiva,
        deliveryPedidoMinimo: pedidoMinimo.toFixed(2),
        deliveryTempoMin: dados.deliveryTempoMin,
        retiradaTempoMin: dados.retiradaTempoMin,
        deliveryAviso: aviso,
      },
    });
    limparCacheConfiguracao();
    res.json({
      deliveryAtivo: dados.deliveryAtivo,
      retiradaAtiva: dados.retiradaAtiva,
      pedidoMinimo,
      deliveryTempoMin: dados.deliveryTempoMin,
      retiradaTempoMin: dados.retiradaTempoMin,
      aviso,
    });
  })
);

const bairroSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do bairro').max(60, 'Nome muito longo'),
  taxa: z.number().min(0, 'Taxa inválida').max(9999.99, 'Taxa muito alta'),
});

const bairroAlteracaoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do bairro').max(60, 'Nome muito longo').optional(),
  taxa: z.number().min(0, 'Taxa inválida').max(9999.99, 'Taxa muito alta').optional(),
  ativo: z.boolean().optional(),
});

router.post(
  '/delivery/bairros',
  gestor,
  asyncHandler(async (req, res) => {
    const dados = validar(bairroSchema, req.body);
    try {
      const bairro = await prisma.bairroEntrega.create({
        data: { nome: dados.nome, taxa: arredondar(dados.taxa).toFixed(2) },
      });
      res.status(201).json(paraBairro(bairro));
    } catch (erro) {
      throw erroDeBairro(erro);
    }
  })
);

router.put(
  '/delivery/bairros/:id',
  gestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(bairroAlteracaoSchema, req.body);
    const atual = await prisma.bairroEntrega.findUnique({ where: { id } });
    if (!atual) {
      throw new HttpError(404, 'Bairro não encontrado');
    }
    try {
      const bairro = await prisma.bairroEntrega.update({
        where: { id },
        data: {
          nome: dados.nome,
          taxa: dados.taxa === undefined ? undefined : arredondar(dados.taxa).toFixed(2),
          ativo: dados.ativo,
        },
      });
      res.json(paraBairro(bairro));
    } catch (erro) {
      throw erroDeBairro(erro);
    }
  })
);

router.delete(
  '/delivery/bairros/:id',
  gestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.bairroEntrega.findUnique({ where: { id } });
    if (!atual) {
      throw new HttpError(404, 'Bairro não encontrado');
    }
    // A entrega guarda o nome do bairro no momento do pedido, então apagar não quebra pedidos antigos.
    await prisma.bairroEntrega.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
