import { Request, Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { criarPedido, incluirPedido, itensSchema, paraPedidoDTO } from '../../lib/pedidos';
import { registrarLog } from '../../lib/log';
import { ocuparMesa } from '../../lib/mesas';
import { contaAberta, valoresDaConta } from '../../lib/contas';
import { montarCardapioPublico } from '../../lib/cardapioPublico';

// Cardápio da mesa, aberto pelo cliente sem login. O acesso é pelo código da mesa (QR code).
// Estas rotas nunca devolvem dados da equipe nem de outras mesas.

export const publico = Router();

// Limites em memória por IP: pedidos e chamados em uma janela de 10 minutos.
const JANELA_MS = 10 * 60 * 1000;
const LIMITE_PEDIDOS_POR_IP = 20;
const LIMITE_CHAMADOS_POR_IP = 10;
const LIMITE_PEDIDOS_ESPERANDO_POR_MESA = 15;
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

async function mesaDoCodigo(req: Request) {
  const codigo = req.params.codigo;
  if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(codigo)) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  const mesa = await prisma.mesa.findUnique({ where: { codigo } });
  if (!mesa || !mesa.ativa) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  return mesa;
}

// O que o cliente vê de um pedido da própria mesa (sem dados da equipe).
function paraPedidoCliente(p: ReturnType<typeof paraPedidoDTO>) {
  return {
    id: p.id,
    status: p.status,
    nomeCliente: p.nomeCliente,
    observacao: p.observacao,
    total: p.total,
    criadoEm: p.criadoEm,
    itens: p.itens.map((i) => ({
      nomeProduto: i.nomeProduto,
      precoUnitario: i.precoUnitario,
      quantidade: i.quantidade,
      observacao: i.observacao,
      // Opções escolhidas (grupo, opção e acréscimo); lista vazia quando não há.
      opcoes: i.opcoes,
    })),
  };
}

// Mesa e cardápio (só categorias ativas e produtos no cardápio).
publico.get(
  '/cliente/mesas/:codigo',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const cardapio = await montarCardapioPublico(typeof req.query.idioma === 'string' ? req.query.idioma : undefined);
    res.set('Cache-Control', 'no-store');
    res.json({
      idiomas: cardapio.idiomas,
      idioma: cardapio.idioma,
      recomendados: cardapio.recomendados,
      origemRecomendados: cardapio.origemRecomendados,
      mesa: { numero: mesa.numero, nome: mesa.nome, chamando: mesa.chamandoDesde !== null },
      categorias: cardapio.categorias,
    });
  })
);

// Pedidos da conta aberta da mesa, para o cliente acompanhar.
publico.get(
  '/cliente/mesas/:codigo/pedidos',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const pedidos = await prisma.pedido.findMany({
      where: { mesaId: mesa.id, pagoEm: null },
      include: incluirPedido,
      orderBy: { criadoEm: 'desc' },
      take: 60,
    });
    const lista = pedidos.map(paraPedidoDTO);
    const total =
      Math.round(
        lista.filter((p) => p.status !== 'CANCELADO').reduce((soma, p) => soma + p.total, 0) * 100
      ) / 100;
    // Taxa de serviço e o que já foi pago, para o cliente saber quanto falta.
    const conta = await contaAberta(mesa.id);
    const pagos = conta
      ? await prisma.pagamento.aggregate({ where: { contaId: conta.id, status: 'APROVADO' }, _sum: { valor: true } })
      : null;
    const valores = valoresDaConta(conta, total, Number(pagos?._sum.valor ?? 0));
    res.set('Cache-Control', 'no-store');
    res.json({
      pedidos: lista.map(paraPedidoCliente),
      total,
      taxaPercentual: conta && conta.taxaServico ? Number(conta.taxaPercentual) : 0,
      taxa: valores.taxa,
      desconto: valores.desconto,
      totalComTaxa: valores.total,
      pago: valores.pago,
      restante: valores.restante,
      chamando: mesa.chamandoDesde !== null,
    });
  })
);

const pedidoSchema = z.object({
  itens: itensSchema,
  nomeCliente: z.string().trim().max(60, 'Nome muito longo').nullable().optional(),
  observacao: z.string().trim().max(300, 'Observação muito longa').nullable().optional(),
});

publico.post(
  '/cliente/mesas/:codigo/pedidos',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const dados = validar(pedidoSchema, req.body);
    if (!dentroDoLimite('pedido|' + (req.ip ?? ''), LIMITE_PEDIDOS_POR_IP)) {
      throw new HttpError(429, 'Muitos pedidos em pouco tempo. Chame o garçom, por favor.');
    }
    const esperando = await prisma.pedido.count({
      where: { mesaId: mesa.id, pagoEm: null, status: { in: ['NOVO', 'EM_PREPARO'] } },
    });
    if (esperando >= LIMITE_PEDIDOS_ESPERANDO_POR_MESA) {
      throw new HttpError(429, 'Esta mesa já tem muitos pedidos em preparo. Chame o garçom, por favor.');
    }
    const pedido = await criarPedido({
      mesaId: mesa.id,
      origem: 'CLIENTE',
      itens: dados.itens,
      nomeCliente: dados.nomeCliente,
      observacao: dados.observacao,
    });
    const navegador = req.get('user-agent');
    registrarLog({
      usuarioId: null,
      usuarioNome: `Cliente da mesa ${mesa.numero}`,
      tipo: 'CRIACAO',
      modulo: 'Pedidos',
      descricao: `Pedido #${pedido.id} feito pelo cardápio da mesa ${mesa.numero}`,
      metodo: 'POST',
      caminho: '/api/cliente/mesas/pedidos',
      status: 201,
      ip: req.ip ?? null,
      navegador: navegador ? navegador.slice(0, 200) : null,
    });
    res.status(201).json(paraPedidoCliente(pedido));
  })
);

// Cliente chama o garçom (ou pede a conta). Fica marcado até alguém da equipe atender.
publico.post(
  '/cliente/mesas/:codigo/chamar',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    if (!dentroDoLimite('chamado|' + (req.ip ?? ''), LIMITE_CHAMADOS_POR_IP)) {
      throw new HttpError(429, 'O garçom já foi avisado. Aguarde um instante.');
    }
    if (mesa.chamandoDesde === null) {
      await prisma.mesa.update({ where: { id: mesa.id }, data: { chamandoDesde: new Date() } });
    }
    // Quem chama o garçom já está sentado: a mesa fica ocupada.
    await ocuparMesa(mesa.id);
    res.status(204).end();
  })
);

// ---------- Avaliação da conta pelo cliente ----------

// A conta fechada mais recente da mesa vale para avaliar por 3 horas, enquanto não tiver avaliação.
const HORAS_PARA_AVALIAR = 3;

async function contaParaAvaliar(mesaId: number): Promise<{ id: number; fechadaEm: Date } | null> {
  const ultima = await prisma.conta.findFirst({
    // Só conta com consumo pago: conta fechada sem nenhum pagamento aprovado não vale para avaliar.
    where: {
      mesaId,
      status: 'FECHADA',
      fechadaEm: { not: null },
      pagamentos: { some: { status: 'APROVADO' } },
    },
    orderBy: { fechadaEm: 'desc' },
    select: { id: true, fechadaEm: true, avaliacao: { select: { id: true } } },
  });
  if (!ultima || !ultima.fechadaEm || ultima.avaliacao) return null;
  if (Date.now() - ultima.fechadaEm.getTime() > HORAS_PARA_AVALIAR * 60 * 60 * 1000) return null;
  return { id: ultima.id, fechadaEm: ultima.fechadaEm };
}

// Conta que o cliente pode avaliar agora, se houver.
publico.get(
  '/cliente/mesas/:codigo/avaliacao',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    const conta = await contaParaAvaliar(mesa.id);
    res.set('Cache-Control', 'no-store');
    res.json({
      pendente: conta ? { contaId: conta.id, fechadaEm: conta.fechadaEm.toISOString() } : null,
    });
  })
);

const notaSchema = z
  .number()
  .int('Use uma nota de 1 a 5')
  .min(1, 'Use uma nota de 1 a 5')
  .max(5, 'Use uma nota de 1 a 5');

const avaliacaoSchema = z.object({
  notaComida: notaSchema,
  notaAtendimento: notaSchema,
  comentario: z.string().trim().max(500, 'Comentário muito longo').nullable().optional(),
});

publico.post(
  '/cliente/mesas/:codigo/avaliacao',
  asyncHandler(async (req, res) => {
    const mesa = await mesaDoCodigo(req);
    if (!dentroDoLimite('avaliacao|' + (req.ip ?? ''), LIMITE_CHAMADOS_POR_IP)) {
      throw new HttpError(429, 'Muitas avaliações em pouco tempo. Aguarde um instante.');
    }
    const dados = validar(avaliacaoSchema, req.body);
    const conta = await contaParaAvaliar(mesa.id);
    if (!conta) {
      throw new HttpError(400, 'Não há conta para avaliar agora.');
    }
    // Quem recebeu a conta: o garçom do último pagamento aprovado.
    const ultimoPagamento = await prisma.pagamento.findFirst({
      where: { contaId: conta.id, status: 'APROVADO' },
      orderBy: { concluidoEm: 'desc' },
      select: { garcomId: true },
    });
    try {
      await prisma.avaliacao.create({
        data: {
          contaId: conta.id,
          mesaId: mesa.id,
          garcomId: ultimoPagamento?.garcomId ?? null,
          notaComida: dados.notaComida,
          notaAtendimento: dados.notaAtendimento,
          comentario: dados.comentario || null,
        },
      });
    } catch (erro) {
      // A conta tem uma avaliação só (coluna única): outra aba ou clique chegou antes.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new HttpError(400, 'Esta conta já foi avaliada.');
      }
      throw erro;
    }
    res.status(201).json({ ok: true });
  })
);
