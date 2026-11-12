import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { cifrar } from '../../lib/cripto';
import { lerConfiguracao, limparCacheConfiguracao } from '../../lib/email';
import { inicioDoDia } from '../../lib/pedidos';
import {
  cancelarNaMaquineta,
  iniciarNaMaquineta,
  listarTerminaisMercadoPago,
  maquinetasDoUsuario,
  OPERADORAS_COM_AUTOMATICA,
  ROTULO_OPERADORA,
} from '../../lib/maquinetas';
import {
  aprovarPagamento,
  atualizarPeloTerminal,
  carregarConta,
  carregarPagamento,
  encerrarSemPagar,
  FORMAS_PAGAMENTO,
  paraPagamentoDTO,
} from '../../lib/pagamentos';

// Maquinetas (cadastro do gestor), cobrança da conta da mesa e desempenho dos garçons.

const router = Router();
// A cozinha não cobra conta nem usa maquineta.
const equipeDoSalao = permitir('GESTOR', 'GARCOM');

// ---------- Maquinetas ----------

const incluirGarcom = { garcom: { select: { id: true, nome: true } } } as const;

const maquinetaSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(60, 'Nome muito longo'),
  operadora: z.enum(['SIMULADA', 'MERCADO_PAGO', 'STONE', 'PAGBANK', 'CIELO', 'OUTRA']),
  integracao: z.enum(['MANUAL', 'AUTOMATICA']),
  identificador: z.string().trim().max(120, 'Identificador muito longo').nullable().optional(),
  garcomId: z.number().int().positive().nullable().optional(),
  ativa: z.boolean().optional(),
});

async function validarMaquineta(dados: {
  operadora?: string;
  integracao?: string;
  identificador?: string | null;
  garcomId?: number | null;
}): Promise<void> {
  if (dados.integracao === 'AUTOMATICA') {
    if (!OPERADORAS_COM_AUTOMATICA.some((o) => o === dados.operadora)) {
      const nome = ROTULO_OPERADORA[dados.operadora as keyof typeof ROTULO_OPERADORA] ?? 'esta operadora';
      throw new HttpError(
        400,
        `A integração automática ainda não está disponível para ${nome}. Use a integração manual: o garçom passa o valor na maquineta e confirma no sistema.`
      );
    }
    if (dados.operadora === 'MERCADO_PAGO' && !dados.identificador) {
      throw new HttpError(400, 'Informe o identificador do terminal do Mercado Pago (use "Buscar terminais").');
    }
  }
  if (dados.garcomId) {
    const garcom = await prisma.usuario.findUnique({ where: { id: dados.garcomId }, select: { ativo: true } });
    if (!garcom || !garcom.ativo) {
      throw new HttpError(400, 'Garçom não encontrado ou desativado');
    }
  }
}

router.get(
  '/maquinetas',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const configuracao = await lerConfiguracao();
    const gestor = req.usuario.perfil === 'GESTOR';
    const maquinetas = gestor
      ? await prisma.maquineta.findMany({ include: incluirGarcom, orderBy: { nome: 'asc' } })
      : await prisma.maquineta.findMany({
          where: { id: { in: (await maquinetasDoUsuario(req.usuario)).map((m) => m.id) } },
          include: incluirGarcom,
          orderBy: { nome: 'asc' },
        });
    res.json({
      vinculo: configuracao.vinculoMaquineta,
      ...(gestor ? { mercadoPagoTokenDefinido: Boolean(configuracao.mercadoPagoTokenCifrado) } : {}),
      maquinetas,
    });
  })
);

const configuracaoSchema = z.object({
  vinculo: z.enum(['POR_GARCOM', 'COMPARTILHADA']).optional(),
  // Ausente: mantém o token gravado. Vazio: apaga. Outro texto: grava cifrado.
  mercadoPagoToken: z.string().trim().max(500, 'Token muito longo').optional(),
});

router.put(
  '/maquinetas/configuracao',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(configuracaoSchema, req.body);
    await lerConfiguracao();
    const configuracao = await prisma.configuracaoPlataforma.update({
      where: { id: 1 },
      data: {
        vinculoMaquineta: dados.vinculo,
        mercadoPagoTokenCifrado:
          dados.mercadoPagoToken === undefined
            ? undefined
            : dados.mercadoPagoToken === ''
              ? null
              : cifrar(dados.mercadoPagoToken),
      },
    });
    limparCacheConfiguracao();
    res.json({
      vinculo: configuracao.vinculoMaquineta,
      mercadoPagoTokenDefinido: Boolean(configuracao.mercadoPagoTokenCifrado),
    });
  })
);

// Terminais Point da conta do Mercado Pago, para escolher no cadastro.
router.get(
  '/maquinetas/terminais-mercado-pago',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    res.json(await listarTerminaisMercadoPago());
  })
);

router.post(
  '/maquinetas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(maquinetaSchema, req.body);
    await validarMaquineta(dados);
    const maquineta = await prisma.maquineta.create({
      data: {
        nome: dados.nome,
        operadora: dados.operadora,
        integracao: dados.integracao,
        identificador: dados.identificador || null,
        garcomId: dados.garcomId ?? null,
        ativa: dados.ativa ?? true,
      },
      include: incluirGarcom,
    });
    res.status(201).json(maquineta);
  })
);

router.put(
  '/maquinetas/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(maquinetaSchema.partial(), req.body);
    const atual = await prisma.maquineta.findUnique({ where: { id } });
    if (!atual) {
      throw new HttpError(404, 'Maquineta não encontrada');
    }
    await validarMaquineta({
      operadora: dados.operadora ?? atual.operadora,
      integracao: dados.integracao ?? atual.integracao,
      identificador: dados.identificador === undefined ? atual.identificador : dados.identificador,
      garcomId: dados.garcomId,
    });
    const maquineta = await prisma.maquineta.update({
      where: { id },
      data: {
        nome: dados.nome,
        operadora: dados.operadora,
        integracao: dados.integracao,
        identificador: dados.identificador === undefined ? undefined : dados.identificador || null,
        garcomId: dados.garcomId,
        ativa: dados.ativa,
      },
      include: incluirGarcom,
    });
    res.json(maquineta);
  })
);

router.delete(
  '/maquinetas/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const usos = await prisma.pagamento.count({ where: { maquinetaId: id } });
    if (usos > 0) {
      throw new HttpError(400, 'Esta maquineta já recebeu pagamentos e fica no histórico. Desative em vez de excluir.');
    }
    await prisma.maquineta.delete({ where: { id } });
    res.status(204).end();
  })
);

// ---------- Cobrança da conta ----------

const cobrarSchema = z.object({
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
  maquinetaId: z.number().int().positive().nullable().optional(),
});

// Cobra a conta aberta da mesa.
// Dinheiro, ou sem maquineta: recebe e fecha na hora.
// Maquineta manual: fica pendente até o garçom confirmar. Automática: o sistema acompanha a maquineta.
router.post(
  '/mesas/:id/cobrar',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const mesaId = idParam(req);
    const dados = validar(cobrarSchema, req.body);
    const conta = await carregarConta(mesaId);
    if (conta.pagamentoPendente) {
      throw new HttpError(409, 'Esta mesa já tem uma cobrança em andamento. Conclua ou cancele essa cobrança.');
    }
    if (conta.pedidos.length === 0) {
      throw new HttpError(400, 'Esta mesa não tem conta aberta.');
    }

    let maquineta = null;
    if (dados.maquinetaId && dados.formaPagamento !== 'Dinheiro') {
      const permitidas = await maquinetasDoUsuario(req.usuario);
      maquineta = permitidas.find((m) => m.id === dados.maquinetaId) ?? null;
      if (!maquineta) {
        throw new HttpError(400, 'Você não pode usar esta maquineta.');
      }
    }

    // Quem leva o crédito: no modo "cada garçom tem a sua", o dono da maquineta; senão, quem cobrou.
    const configuracao = await lerConfiguracao();
    const garcomId =
      configuracao.vinculoMaquineta === 'POR_GARCOM' && maquineta?.garcomId ? maquineta.garcomId : req.usuario.id;

    const pagamento = await prisma.$transaction(async (tx) => {
      const criado = await tx.pagamento.create({
        data: {
          mesaId,
          valor: conta.total.toFixed(2),
          formaPagamento: dados.formaPagamento,
          maquinetaId: maquineta?.id ?? null,
          garcomId,
          iniciadoPorId: req.usuario.id,
        },
      });
      await tx.pedido.updateMany({
        where: { id: { in: conta.pedidos.map((p) => p.id) }, pagoEm: null },
        data: { pagamentoId: criado.id },
      });
      return criado;
    });

    if (!maquineta) {
      await aprovarPagamento(pagamento.id);
    } else if (maquineta.integracao === 'AUTOMATICA') {
      try {
        const nome = conta.mesa.nome ? `Mesa ${conta.mesa.numero} ${conta.mesa.nome}` : `Mesa ${conta.mesa.numero}`;
        const referencia = await iniciarNaMaquineta(pagamento, maquineta, `${configuracao.nome} - ${nome}`);
        await prisma.pagamento.update({
          where: { id: pagamento.id },
          data: { referenciaExterna: referencia, mensagem: 'Enviando a cobrança para a maquineta.' },
        });
      } catch (erro) {
        // A maquineta não recebeu a cobrança: desfaz para a conta voltar a ficar aberta.
        await encerrarSemPagar(pagamento.id, 'CANCELADO', 'A cobrança não chegou à maquineta.');
        throw erro;
      }
    } else {
      await prisma.pagamento.update({
        where: { id: pagamento.id },
        data: { mensagem: `Passe o valor na maquineta ${maquineta.nome} e confirme aqui.` },
      });
    }

    res.status(201).json(paraPagamentoDTO(await carregarPagamento(pagamento.id)));
  })
);

router.get(
  '/pagamentos/:id',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await carregarPagamento(id);
    await atualizarPeloTerminal(id);
    res.json(paraPagamentoDTO(await carregarPagamento(id)));
  })
);

const confirmarSchema = z.object({
  codigoAutorizacao: z.string().trim().max(40, 'Código muito longo').nullable().optional(),
});

// Maquineta manual: o garçom confirma que o pagamento passou.
router.post(
  '/pagamentos/:id/confirmar',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(confirmarSchema, req.body ?? {});
    const pagamento = await carregarPagamento(id);
    if (pagamento.status !== 'PENDENTE') {
      throw new HttpError(400, 'Esta cobrança já foi concluída.');
    }
    if (pagamento.maquineta?.integracao === 'AUTOMATICA') {
      throw new HttpError(400, 'Nesta maquineta a confirmação vem sozinha. Aguarde a resposta dela.');
    }
    await aprovarPagamento(id, dados.codigoAutorizacao || null);
    res.json(paraPagamentoDTO(await carregarPagamento(id)));
  })
);

// Desiste da cobrança (ou registra que a maquineta manual não aprovou). A conta volta a ficar aberta.
router.post(
  '/pagamentos/:id/cancelar',
  equipeDoSalao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { recusado } = validar(z.object({ recusado: z.boolean().optional() }), req.body ?? {});
    const pagamento = await prisma.pagamento.findUnique({ where: { id }, include: { maquineta: true } });
    if (!pagamento) {
      throw new HttpError(404, 'Pagamento não encontrado');
    }
    if (pagamento.status !== 'PENDENTE') {
      throw new HttpError(400, 'Esta cobrança já foi concluída.');
    }
    if (pagamento.maquineta?.integracao === 'AUTOMATICA') {
      // Pode já ter sido paga enquanto a pessoa decidia cancelar.
      await atualizarPeloTerminal(id);
      const agora = await carregarPagamento(id);
      if (agora.status !== 'PENDENTE') {
        res.json(paraPagamentoDTO(agora));
        return;
      }
      await cancelarNaMaquineta(pagamento, pagamento.maquineta);
    }
    await encerrarSemPagar(
      id,
      recusado ? 'RECUSADO' : 'CANCELADO',
      recusado ? 'Pagamento não aprovado na maquineta.' : 'Cobrança cancelada pela equipe.'
    );
    res.json(paraPagamentoDTO(await carregarPagamento(id)));
  })
);

// ---------- Desempenho dos garçons (gestor) ----------

const periodoSchema = z.object({ dias: z.coerce.number().int().min(1).max(365).optional() });

router.get(
  '/desempenho',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { dias = 30 } = validar(periodoSchema, req.query);
    // "1 dia" é hoje; "7 dias" é hoje e os seis dias anteriores.
    const desde = new Date(inicioDoDia().getTime() - (dias - 1) * 24 * 60 * 60 * 1000);

    const [usuarios, pedidos, pagamentos] = await Promise.all([
      prisma.usuario.findMany({ select: { id: true, nome: true, perfil: true, ativo: true, foto: true } }),
      prisma.pedido.groupBy({
        by: ['garcomId'],
        where: { criadoEm: { gte: desde }, status: { not: 'CANCELADO' }, garcomId: { not: null } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.pagamento.findMany({
        where: { status: 'APROVADO', concluidoEm: { gte: desde } },
        select: { garcomId: true, valor: true, formaPagamento: true, maquinetaId: true },
      }),
    ]);

    const linhas = usuarios.map((u) => {
      const doPedido = pedidos.find((p) => p.garcomId === u.id);
      const recebidos = pagamentos.filter((p) => p.garcomId === u.id);
      const valorRecebido = recebidos.reduce((soma, p) => soma + Number(p.valor), 0);
      const porForma: Record<string, number> = {};
      for (const p of recebidos) {
        porForma[p.formaPagamento] = Math.round(((porForma[p.formaPagamento] ?? 0) + Number(p.valor)) * 100) / 100;
      }
      return {
        usuario: u,
        pedidosAtendidos: doPedido?._count._all ?? 0,
        vendasNosPedidos: Number(doPedido?._sum.total ?? 0),
        contasRecebidas: recebidos.length,
        valorRecebido: Math.round(valorRecebido * 100) / 100,
        recebidoNaMaquineta:
          Math.round(recebidos.filter((p) => p.maquinetaId !== null).reduce((s, p) => s + Number(p.valor), 0) * 100) / 100,
        valorMedioPorConta: recebidos.length > 0 ? Math.round((valorRecebido / recebidos.length) * 100) / 100 : 0,
        porForma,
      };
    });

    // Mostra os garçons ativos e qualquer pessoa que tenha tido movimento no período.
    const visiveis = linhas
      .filter((l) => (l.usuario.perfil === 'GARCOM' && l.usuario.ativo) || l.pedidosAtendidos > 0 || l.contasRecebidas > 0)
      .sort((a, b) => b.valorRecebido - a.valorRecebido || b.pedidosAtendidos - a.pedidosAtendidos);

    res.json({
      dias,
      desde: desde.toISOString(),
      totais: {
        contasRecebidas: pagamentos.length,
        valorRecebido: Math.round(pagamentos.reduce((soma, p) => soma + Number(p.valor), 0) * 100) / 100,
        pedidosAtendidos: visiveis.reduce((soma, l) => soma + l.pedidosAtendidos, 0),
      },
      garcons: visiveis,
    });
  })
);

export default router;
