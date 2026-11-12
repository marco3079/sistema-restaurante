import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lerConfiguracao, limparCacheConfiguracao } from '../../lib/email';
import { inicioDoDia } from '../../lib/pedidos';
import { CAMPOS_DE_CREDENCIAL, consultarNota, emitirNota, juntarCredenciais, lerCredenciais } from '../../lib/fiscal';

// Nota fiscal: conexão com o serviço emissor (gestor), emissão da nota da conta fechada
// e relatório de vendas para o contador.

const router = Router();

const MS_DIA = 24 * 60 * 60 * 1000;

// ---------- Configuração ----------

async function configuracaoDTO() {
  const c = await lerConfiguracao();
  return {
    provedor: c.fiscalProvedor,
    ambiente: c.fiscalAmbiente,
    cnpj: c.fiscalCnpj,
    webhookUrl: c.fiscalWebhookUrl,
    emissaoAutomatica: c.fiscalEmissaoAutomatica,
    ncmPadrao: c.fiscalNcmPadrao,
    cfopPadrao: c.fiscalCfopPadrao,
    csosnPadrao: c.fiscalCsosnPadrao,
    classeImposto: c.fiscalClasseImposto,
    // Só os nomes das credenciais gravadas; os valores nunca saem.
    credenciaisDefinidas: Object.keys(lerCredenciais(c)),
  };
}

router.get(
  '/fiscal/configuracao',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    res.json(await configuracaoDTO());
  })
);

const so = (tamanho: number, nome: string) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${tamanho}}$`), `${nome} deve ter ${tamanho} dígitos`);

const configuracaoSchema = z.object({
  provedor: z.enum(['NENHUM', 'WEBHOOK', 'FOCUS_NFE', 'WEBMANIA']).optional(),
  ambiente: z.enum(['HOMOLOGACAO', 'PRODUCAO']).optional(),
  cnpj: z.string().trim().max(18).nullable().optional(),
  webhookUrl: z.string().trim().max(500, 'Endereço muito longo').nullable().optional(),
  emissaoAutomatica: z.boolean().optional(),
  ncmPadrao: so(8, 'O NCM').optional(),
  cfopPadrao: so(4, 'O CFOP').optional(),
  csosnPadrao: z.string().trim().regex(/^\d{2,3}$/, 'Situação tributária inválida').optional(),
  classeImposto: z.string().trim().max(60).nullable().optional(),
  // Credenciais do emissor escolhido. Campo ausente: mantém. Vazio: apaga.
  credenciais: z.record(z.string(), z.string().max(500)).optional(),
});

router.put(
  '/fiscal/configuracao',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(configuracaoSchema, req.body);
    const atual = await lerConfiguracao();
    const provedor = dados.provedor ?? atual.fiscalProvedor;

    let cnpj: string | null | undefined;
    if (dados.cnpj !== undefined) {
      const digitos = (dados.cnpj ?? '').replace(/\D/g, '');
      if (digitos !== '' && digitos.length !== 14) {
        throw new HttpError(400, 'O CNPJ deve ter 14 dígitos.');
      }
      cnpj = digitos || null;
    }
    let webhookUrl: string | null | undefined;
    if (dados.webhookUrl !== undefined) {
      webhookUrl = dados.webhookUrl || null;
      if (webhookUrl && !/^https?:\/\/\S+$/i.test(webhookUrl)) {
        throw new HttpError(400, 'O endereço do webhook deve começar com http:// ou https://');
      }
    }
    let credenciais: string | null | undefined;
    if (dados.credenciais) {
      const permitidos: readonly string[] = CAMPOS_DE_CREDENCIAL[provedor];
      const estranho = Object.keys(dados.credenciais).find((campo) => !permitidos.includes(campo));
      if (estranho) {
        throw new HttpError(400, `Credencial desconhecida para este serviço: ${estranho}`);
      }
      credenciais = juntarCredenciais(atual, dados.credenciais);
    }
    // Trocar de serviço apaga as credenciais do anterior.
    if (dados.provedor && dados.provedor !== atual.fiscalProvedor && !dados.credenciais) {
      credenciais = null;
    }

    await prisma.configuracaoPlataforma.update({
      where: { id: 1 },
      data: {
        fiscalProvedor: dados.provedor,
        fiscalAmbiente: dados.ambiente,
        fiscalCnpj: cnpj,
        fiscalWebhookUrl: webhookUrl,
        fiscalEmissaoAutomatica: dados.emissaoAutomatica,
        fiscalNcmPadrao: dados.ncmPadrao,
        fiscalCfopPadrao: dados.cfopPadrao,
        fiscalCsosnPadrao: dados.csosnPadrao,
        fiscalClasseImposto: dados.classeImposto === undefined ? undefined : dados.classeImposto || null,
        fiscalCredenciaisCifradas: credenciais,
      },
    });
    limparCacheConfiguracao();
    res.json(await configuracaoDTO());
  })
);

// ---------- Contas fechadas e notas ----------

const periodoSchema = z.object({ dias: z.coerce.number().int().min(1).max(366).optional() });

function notaDTO(n: {
  id: number;
  status: string;
  provedor: string;
  ambiente: string;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  urlDanfe: string | null;
  urlXml: string | null;
  mensagem: string | null;
  atualizadaEm: Date;
}) {
  return {
    id: n.id,
    status: n.status,
    provedor: n.provedor,
    ambiente: n.ambiente,
    numero: n.numero,
    serie: n.serie,
    chave: n.chave,
    urlDanfe: n.urlDanfe,
    urlXml: n.urlXml,
    mensagem: n.mensagem,
    atualizadaEm: n.atualizadaEm.toISOString(),
  };
}

// Contas pagas no período, com a nota de cada uma (se houver). É a lista da tela de notas fiscais
// e a base do relatório para o contador.
router.get(
  '/fiscal/contas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { dias = 7 } = validar(periodoSchema, req.query);
    const desde = new Date(inicioDoDia().getTime() - (dias - 1) * MS_DIA);
    const contas = await prisma.conta.findMany({
      where: { status: 'FECHADA', fechadaEm: { gte: desde }, pagamentos: { some: { status: 'APROVADO' } } },
      include: {
        mesa: { select: { numero: true, nome: true } },
        pagamentos: { where: { status: 'APROVADO' } },
        pedidos: { where: { status: { not: 'CANCELADO' } }, select: { total: true } },
        nota: true,
      },
      orderBy: { fechadaEm: 'desc' },
      take: 500,
    });
    res.json(
      contas.map((c) => {
        const formas: Record<string, number> = {};
        for (const p of c.pagamentos) {
          formas[p.formaPagamento] = Math.round(((formas[p.formaPagamento] ?? 0) + Number(p.valor)) * 100) / 100;
        }
        const soma = (campo: 'valor' | 'valorServico' | 'gorjeta') =>
          Math.round(c.pagamentos.reduce((s, p) => s + Number(p[campo]), 0) * 100) / 100;
        return {
          id: c.id,
          mesa: c.mesa,
          fechadaEm: c.fechadaEm ? c.fechadaEm.toISOString() : null,
          cpfCnpjCliente: c.cpfCnpjCliente,
          produtos: Math.round(c.pedidos.reduce((s, p) => s + Number(p.total), 0) * 100) / 100,
          servico: soma('valorServico'),
          gorjetas: soma('gorjeta'),
          total: soma('valor'),
          formas,
          nota: c.nota ? notaDTO(c.nota) : null,
        };
      })
    );
  })
);

// Emite a nota de uma conta paga. O garçom também pode, logo depois de receber.
router.post(
  '/contas/:id/nota',
  permitir('GESTOR', 'GARCOM'),
  asyncHandler(async (req, res) => {
    const nota = await emitirNota(idParam(req));
    res.status(201).json(notaDTO(nota));
  })
);

// Nota da última conta fechada da mesa, para o garçom emitir ou reimprimir depois de receber.
router.get(
  '/contas/:id/nota',
  permitir('GESTOR', 'GARCOM'),
  asyncHandler(async (req, res) => {
    const nota = await prisma.notaFiscal.findUnique({ where: { contaId: idParam(req) } });
    res.json(nota ? notaDTO(nota) : null);
  })
);

router.post(
  '/notas/:id/consultar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    res.json(notaDTO(await consultarNota(idParam(req))));
  })
);

export default router;
