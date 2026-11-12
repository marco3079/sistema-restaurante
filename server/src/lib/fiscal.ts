import type { ConfiguracaoPlataforma, NotaFiscal, StatusNota } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { cifrar, decifrar } from './cripto';
import { lerConfiguracao } from './email';

// Nota fiscal de consumidor (NFC-e) da conta fechada, emitida pelo serviço que o gestor conectou.
//
// WEBHOOK   : o sistema envia a venda em JSON para um endereço do restaurante. Serve para qualquer emissor
//             (um serviço próprio, uma automação, o integrador do contador).
// FOCUS_NFE : API da Focus NFe (v2/nfce), escrita pela documentação pública. Não testada com conta real.
// WEBMANIA  : API da WebmaniaBR (1/nfe/emissao, modelo 2), escrita pela documentação pública. Não testada
//             com conta real.
//
// Em todos os casos o emitente precisa estar habilitado no serviço escolhido (certificado digital, CSC e
// credenciamento na Secretaria da Fazenda). A nota leva só os produtos: a taxa de serviço e a gorjeta ficam
// fora, e os pagamentos vão ajustados para fechar com o valor dos produtos. Confirme a regra com o contador.

export const CAMPOS_DE_CREDENCIAL = {
  WEBHOOK: ['webhookToken'],
  FOCUS_NFE: ['token'],
  WEBMANIA: ['consumerKey', 'consumerSecret', 'accessToken', 'accessTokenSecret'],
  NENHUM: [],
} as const;

type Credenciais = Record<string, string>;

const TEMPO_LIMITE_MS = 25000;

export function lerCredenciais(configuracao: ConfiguracaoPlataforma): Credenciais {
  if (!configuracao.fiscalCredenciaisCifradas) return {};
  const texto = decifrar(configuracao.fiscalCredenciaisCifradas);
  if (!texto) return {};
  try {
    const dados = JSON.parse(texto) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(dados).filter(([, v]) => typeof v === 'string' && v !== '')) as Credenciais;
  } catch {
    return {};
  }
}

// Junta as credenciais novas com as gravadas. Valor vazio apaga a credencial.
export function juntarCredenciais(configuracao: ConfiguracaoPlataforma, novas: Record<string, string>): string | null {
  const atuais = lerCredenciais(configuracao);
  for (const [campo, valor] of Object.entries(novas)) {
    if (valor.trim() === '') delete atuais[campo];
    else atuais[campo] = valor.trim();
  }
  return Object.keys(atuais).length > 0 ? cifrar(JSON.stringify(atuais)) : null;
}

// ---------- A venda, no formato comum ----------

interface ItemDaVenda {
  numero: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}

interface Venda {
  referencia: string;
  contaId: number;
  mesa: number;
  fechadaEm: Date;
  cpfCnpjCliente: string | null;
  itens: ItemDaVenda[];
  // Já ajustados para somar o valor dos produtos.
  pagamentos: { forma: string; valor: number; naMaquineta: boolean }[];
  valorProdutos: number;
  valorServico: number;
  valorGorjetas: number;
}

async function montarVenda(contaId: number, referencia: string, configuracao: ConfiguracaoPlataforma): Promise<Venda> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    include: {
      mesa: { select: { numero: true } },
      pedidos: {
        where: { status: { not: 'CANCELADO' } },
        include: { itens: { include: { produto: { select: { ncm: true, cfop: true } } } } },
      },
      pagamentos: { where: { status: 'APROVADO' }, orderBy: { id: 'asc' } },
    },
  });
  if (!conta) {
    throw new HttpError(404, 'Conta não encontrada');
  }
  if (conta.status !== 'FECHADA' || !conta.fechadaEm) {
    throw new HttpError(400, 'A nota só pode ser emitida depois que a conta for paga.');
  }

  // Um item por produto e preço.
  const porChave = new Map<string, ItemDaVenda>();
  for (const pedido of conta.pedidos) {
    for (const item of pedido.itens) {
      const unitario = Number(item.precoUnitario);
      const chave = `${item.produtoId}|${unitario.toFixed(2)}`;
      const atual = porChave.get(chave);
      if (atual) {
        atual.quantidade += item.quantidade;
        atual.valorTotal = Math.round(atual.quantidade * unitario * 100) / 100;
      } else {
        porChave.set(chave, {
          numero: 0,
          codigo: String(item.produtoId),
          descricao: item.nomeProduto.slice(0, 120),
          ncm: (item.produto.ncm || configuracao.fiscalNcmPadrao).replace(/\D/g, ''),
          cfop: (item.produto.cfop || configuracao.fiscalCfopPadrao).replace(/\D/g, ''),
          quantidade: item.quantidade,
          valorUnitario: unitario,
          valorTotal: Math.round(item.quantidade * unitario * 100) / 100,
        });
      }
    }
  }
  const itens = [...porChave.values()].map((item, i) => ({ ...item, numero: i + 1 }));
  if (itens.length === 0) {
    throw new HttpError(400, 'Esta conta não tem itens para a nota.');
  }
  const produtosCentavos = itens.reduce((soma, i) => soma + Math.round(i.valorTotal * 100), 0);

  // Os pagamentos incluem a taxa de serviço; a nota leva só os produtos. Cada pagamento entra na
  // proporção dele, e o último absorve a diferença de centavos.
  const pagosCentavos = conta.pagamentos.reduce((soma, p) => soma + Math.round(Number(p.valor) * 100), 0);
  let distribuido = 0;
  const pagamentos = conta.pagamentos.map((p, i) => {
    const ultimo = i === conta.pagamentos.length - 1;
    const parte = ultimo
      ? produtosCentavos - distribuido
      : pagosCentavos > 0
        ? Math.round((Math.round(Number(p.valor) * 100) * produtosCentavos) / pagosCentavos)
        : 0;
    distribuido += parte;
    return { forma: p.formaPagamento, valor: parte / 100, naMaquineta: p.maquinetaId !== null };
  });

  return {
    referencia,
    contaId,
    mesa: conta.mesa.numero,
    fechadaEm: conta.fechadaEm,
    cpfCnpjCliente: conta.cpfCnpjCliente,
    itens,
    pagamentos: pagamentos.filter((p) => p.valor > 0),
    valorProdutos: produtosCentavos / 100,
    valorServico: conta.pagamentos.reduce((soma, p) => soma + Number(p.valorServico), 0),
    valorGorjetas: conta.pagamentos.reduce((soma, p) => soma + Number(p.gorjeta), 0),
  };
}

// ---------- Resultado comum dos emissores ----------

interface Resultado {
  status: StatusNota;
  numero?: string | null;
  serie?: string | null;
  chave?: string | null;
  urlDanfe?: string | null;
  urlXml?: string | null;
  mensagem?: string | null;
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim() !== '') return valor.trim().slice(0, 500);
  if (typeof valor === 'number') return String(valor);
  return null;
}

async function requisitar(
  endereco: string,
  opcoes: { metodo: 'GET' | 'POST'; cabecalhos: Record<string, string>; corpo?: unknown }
): Promise<{ status: number; dados: Record<string, unknown> }> {
  let resposta: Response;
  try {
    resposta = await fetch(endereco, {
      method: opcoes.metodo,
      headers: { ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opcoes.cabecalhos },
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch {
    throw new HttpError(502, 'Não foi possível falar com o serviço de nota fiscal. Confira a internet e o endereço.');
  }
  const bruto = await resposta.text();
  let dados: Record<string, unknown> = {};
  try {
    const lido: unknown = bruto ? JSON.parse(bruto) : {};
    dados = Array.isArray(lido) ? ((lido[0] as Record<string, unknown>) ?? {}) : (lido as Record<string, unknown>);
  } catch {
    dados = {};
  }
  return { status: resposta.status, dados };
}

// ---------- Webhook genérico ----------

const STATUS_DO_WEBHOOK: Record<string, StatusNota> = {
  AUTORIZADA: 'AUTORIZADA',
  PROCESSANDO: 'PROCESSANDO',
  REJEITADA: 'REJEITADA',
  CANCELADA: 'CANCELADA',
  ERRO: 'ERRO',
};

function resultadoDoWebhook(dados: Record<string, unknown>, padrao: StatusNota, mensagemPadrao: string): Resultado {
  const informado = typeof dados.status === 'string' ? STATUS_DO_WEBHOOK[dados.status.toUpperCase()] : undefined;
  return {
    status: informado ?? padrao,
    numero: texto(dados.numero),
    serie: texto(dados.serie),
    chave: texto(dados.chave),
    urlDanfe: texto(dados.urlDanfe),
    urlXml: texto(dados.urlXml),
    mensagem: texto(dados.mensagem) ?? (informado ? null : mensagemPadrao),
  };
}

function cabecalhosDoWebhook(credenciais: Credenciais): Record<string, string> {
  return credenciais.webhookToken ? { Authorization: `Bearer ${credenciais.webhookToken}` } : {};
}

async function emitirPorWebhook(venda: Venda, c: ConfiguracaoPlataforma, credenciais: Credenciais): Promise<Resultado> {
  if (!c.fiscalWebhookUrl) {
    throw new HttpError(400, 'Falta o endereço do webhook nas configurações fiscais.');
  }
  const { status, dados } = await requisitar(c.fiscalWebhookUrl, {
    metodo: 'POST',
    cabecalhos: cabecalhosDoWebhook(credenciais),
    corpo: {
      evento: 'emitir_nfce',
      referencia: venda.referencia,
      ambiente: c.fiscalAmbiente,
      emitente: { cnpj: c.fiscalCnpj },
      cliente: { cpfCnpj: venda.cpfCnpjCliente },
      mesa: venda.mesa,
      fechadaEm: venda.fechadaEm.toISOString(),
      itens: venda.itens.map((i) => ({ ...i, csosn: c.fiscalCsosnPadrao, unidade: 'UN', origem: 0 })),
      pagamentos: venda.pagamentos.map((p) => ({ forma: p.forma, valor: p.valor })),
      valores: { produtos: venda.valorProdutos, servico: venda.valorServico, gorjetas: venda.valorGorjetas },
    },
  });
  if (status < 200 || status >= 300) {
    return { status: 'ERRO', mensagem: texto(dados.mensagem) ?? `O webhook respondeu com erro ${status}.` };
  }
  // Sem status na resposta, a venda só foi entregue: quem recebeu ainda vai emitir.
  return resultadoDoWebhook(dados, 'PROCESSANDO', 'Venda entregue ao webhook. Aguardando o retorno da emissão.');
}

async function consultarWebhook(nota: NotaFiscal, c: ConfiguracaoPlataforma, credenciais: Credenciais): Promise<Resultado> {
  if (!c.fiscalWebhookUrl) {
    throw new HttpError(400, 'Falta o endereço do webhook nas configurações fiscais.');
  }
  const separador = c.fiscalWebhookUrl.includes('?') ? '&' : '?';
  const { status, dados } = await requisitar(
    `${c.fiscalWebhookUrl}${separador}referencia=${encodeURIComponent(nota.referencia)}`,
    { metodo: 'GET', cabecalhos: cabecalhosDoWebhook(credenciais) }
  );
  if (status < 200 || status >= 300) {
    throw new HttpError(502, `O webhook respondeu com erro ${status} na consulta.`);
  }
  return resultadoDoWebhook(dados, nota.status, nota.mensagem ?? '');
}

// ---------- Códigos de forma de pagamento (tabela da NFC-e) ----------

// 01 dinheiro, 03 cartão de crédito, 04 cartão de débito, 17 Pix dinâmico, 20 Pix estático.
function codigoDaForma(forma: string, pixEstatico: boolean): string {
  if (forma === 'Dinheiro') return '01';
  if (forma === 'Cartão de crédito') return '03';
  if (forma === 'Cartão de débito') return '04';
  if (forma === 'Pix') return pixEstatico ? '20' : '17';
  return '99';
}

// ---------- Focus NFe ----------

function baseFocus(c: ConfiguracaoPlataforma): string {
  return c.fiscalAmbiente === 'PRODUCAO' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
}

function cabecalhosFocus(credenciais: Credenciais): Record<string, string> {
  if (!credenciais.token) {
    throw new HttpError(400, 'Falta o token da Focus NFe nas configurações fiscais.');
  }
  // HTTP Basic: o token é o usuário e a senha fica em branco.
  return { Authorization: `Basic ${Buffer.from(`${credenciais.token}:`).toString('base64')}` };
}

// Data com o fuso do servidor, como a Focus pede (ex.: 2026-11-11T21:30:00-03:00).
function dataComFuso(data: Date): string {
  const dois = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const desvio = -data.getTimezoneOffset();
  return (
    `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}` +
    `${desvio >= 0 ? '+' : '-'}${dois(desvio / 60)}:${dois(desvio % 60)}`
  );
}

function resultadoFocus(c: ConfiguracaoPlataforma, httpStatus: number, dados: Record<string, unknown>): Resultado {
  const caminho = (valor: unknown) => {
    const t = texto(valor);
    if (!t) return null;
    return t.startsWith('http') ? t : baseFocus(c) + t;
  };
  const situacao = typeof dados.status === 'string' ? dados.status : '';
  const mensagem = texto(dados.mensagem_sefaz) ?? texto(dados.mensagem);
  const comum = {
    numero: texto(dados.numero),
    serie: texto(dados.serie),
    chave: texto(dados.chave_nfe),
    urlDanfe: caminho(dados.caminho_danfe),
    urlXml: caminho(dados.caminho_xml_nota_fiscal),
  };
  if (situacao === 'autorizado') return { status: 'AUTORIZADA', mensagem, ...comum };
  if (situacao === 'cancelado') return { status: 'CANCELADA', mensagem, ...comum };
  if (situacao === 'processando_autorizacao') return { status: 'PROCESSANDO', mensagem, ...comum };
  if (situacao === 'erro_autorizacao' || situacao === 'denegado') return { status: 'REJEITADA', mensagem, ...comum };
  return { status: 'ERRO', mensagem: mensagem ?? `A Focus NFe respondeu com erro ${httpStatus}.` };
}

async function emitirPelaFocus(venda: Venda, c: ConfiguracaoPlataforma, credenciais: Credenciais): Promise<Resultado> {
  if (!c.fiscalCnpj) {
    throw new HttpError(400, 'Falta o CNPJ do restaurante nas configurações fiscais.');
  }
  const documento = venda.cpfCnpjCliente;
  const { status, dados } = await requisitar(
    `${baseFocus(c)}/v2/nfce?ref=${encodeURIComponent(venda.referencia)}`,
    {
      metodo: 'POST',
      cabecalhos: cabecalhosFocus(credenciais),
      corpo: {
        cnpj_emitente: c.fiscalCnpj.replace(/\D/g, ''),
        // A Focus aceita no máximo 5 minutos de diferença do horário atual.
        data_emissao: dataComFuso(new Date()),
        natureza_operacao: 'VENDA AO CONSUMIDOR',
        presenca_comprador: '1',
        modalidade_frete: '9',
        local_destino: '1',
        ...(documento && documento.length === 11 ? { cpf_destinatario: documento } : {}),
        ...(documento && documento.length === 14 ? { cnpj_destinatario: documento } : {}),
        items: venda.itens.map((i) => ({
          numero_item: String(i.numero),
          codigo_produto: i.codigo,
          descricao: i.descricao,
          codigo_ncm: i.ncm,
          cfop: i.cfop,
          unidade_comercial: 'un',
          unidade_tributavel: 'un',
          quantidade_comercial: i.quantidade,
          quantidade_tributavel: i.quantidade,
          valor_unitario_comercial: i.valorUnitario.toFixed(2),
          valor_unitario_tributavel: i.valorUnitario.toFixed(2),
          valor_bruto: i.valorTotal.toFixed(2),
          icms_origem: '0',
          icms_situacao_tributaria: c.fiscalCsosnPadrao,
        })),
        // O código 17 (Pix) é o da tabela da NFC-e; a página da Focus consultada não lista o Pix.
        formas_pagamento: venda.pagamentos.map((p) => ({
          forma_pagamento: codigoDaForma(p.forma, false),
          valor_pagamento: p.valor.toFixed(2),
        })),
      },
    }
  );
  return resultadoFocus(c, status, dados);
}

async function consultarFocus(nota: NotaFiscal, c: ConfiguracaoPlataforma, credenciais: Credenciais): Promise<Resultado> {
  const { status, dados } = await requisitar(`${baseFocus(c)}/v2/nfce/${encodeURIComponent(nota.referencia)}`, {
    metodo: 'GET',
    cabecalhos: cabecalhosFocus(credenciais),
  });
  return resultadoFocus(c, status, dados);
}

// ---------- WebmaniaBR ----------

const BASE_WEBMANIA = 'https://webmania.com.br/api/1/nfe';

function cabecalhosWebmania(credenciais: Credenciais): Record<string, string> {
  const faltando = CAMPOS_DE_CREDENCIAL.WEBMANIA.filter((campo) => !credenciais[campo]);
  if (faltando.length > 0) {
    throw new HttpError(400, 'Faltam credenciais da WebmaniaBR nas configurações fiscais (são quatro).');
  }
  return {
    'X-Consumer-Key': credenciais.consumerKey,
    'X-Consumer-Secret': credenciais.consumerSecret,
    'X-Access-Token': credenciais.accessToken,
    'X-Access-Token-Secret': credenciais.accessTokenSecret,
  };
}

// A WebmaniaBR pode responder HTTP 200 com o campo "error": o que vale é o corpo.
function resultadoWebmania(httpStatus: number, dados: Record<string, unknown>): Resultado {
  if (dados.error) {
    return { status: 'ERRO', mensagem: texto(dados.error) ?? 'A WebmaniaBR recusou a requisição.' };
  }
  const situacao = typeof dados.status === 'string' ? dados.status : '';
  const comum = {
    numero: texto(dados.nfe),
    serie: texto(dados.serie),
    chave: texto(dados.chave),
    urlDanfe: texto(dados.danfe),
    urlXml: texto(dados.xml),
    mensagem: texto(dados.motivo),
  };
  if (situacao === 'aprovado') return { status: 'AUTORIZADA', ...comum };
  if (situacao === 'cancelado') return { status: 'CANCELADA', ...comum };
  if (situacao === 'processamento' || situacao === 'contingencia') return { status: 'PROCESSANDO', ...comum };
  if (situacao === 'reprovado' || situacao === 'denegado') return { status: 'REJEITADA', ...comum };
  return { status: 'ERRO', mensagem: comum.mensagem ?? `A WebmaniaBR respondeu com erro ${httpStatus}.` };
}

async function emitirPelaWebmania(venda: Venda, c: ConfiguracaoPlataforma, credenciais: Credenciais): Promise<Resultado> {
  if (!c.fiscalClasseImposto) {
    throw new HttpError(400, 'Falta a classe de imposto da WebmaniaBR nas configurações fiscais.');
  }
  const documento = venda.cpfCnpjCliente;
  const { status, dados } = await requisitar(`${BASE_WEBMANIA}/emissao/`, {
    metodo: 'POST',
    cabecalhos: cabecalhosWebmania(credenciais),
    corpo: {
      ID: venda.referencia,
      operacao: 1,
      natureza_operacao: 'Venda ao consumidor',
      modelo: 2,
      finalidade: 1,
      ambiente: c.fiscalAmbiente === 'PRODUCAO' ? 1 : 2,
      ...(documento ? { cliente: documento.length === 14 ? { cnpj: documento } : { cpf: documento } } : {}),
      produtos: venda.itens.map((i) => ({
        nome: i.descricao,
        codigo: i.codigo,
        ncm: i.ncm,
        quantidade: String(i.quantidade),
        unidade: 'UN',
        origem: 0,
        subtotal: i.valorUnitario.toFixed(2),
        total: i.valorTotal.toFixed(2),
        classe_imposto: c.fiscalClasseImposto,
      })),
      pedido: {
        presenca: 1,
        modalidade_frete: 9,
        pagamento: 0,
        forma_pagamento: venda.pagamentos.map((p) => codigoDaForma(p.forma, !p.naMaquineta)),
        valor_pagamento: venda.pagamentos.map((p) => p.valor.toFixed(2)),
      },
    },
  });
  return resultadoWebmania(status, dados);
}

async function consultarWebmania(nota: NotaFiscal, credenciais: Credenciais): Promise<Resultado> {
  const filtro = nota.chave ? `chave=${encodeURIComponent(nota.chave)}` : `ID=${encodeURIComponent(nota.referencia)}`;
  const { status, dados } = await requisitar(`${BASE_WEBMANIA}/consulta/?${filtro}`, {
    metodo: 'GET',
    cabecalhos: cabecalhosWebmania(credenciais),
  });
  return resultadoWebmania(status, dados);
}

// ---------- Entrada única ----------

function semNulos(resultado: Resultado) {
  return {
    status: resultado.status,
    numero: resultado.numero ?? undefined,
    serie: resultado.serie ?? undefined,
    chave: resultado.chave ?? undefined,
    urlDanfe: resultado.urlDanfe ?? undefined,
    urlXml: resultado.urlXml ?? undefined,
    mensagem: resultado.mensagem ?? null,
  };
}

// Emite a nota da conta fechada. Nota rejeitada ou com erro pode ser tentada de novo.
export async function emitirNota(contaId: number): Promise<NotaFiscal> {
  const configuracao = await lerConfiguracao();
  if (configuracao.fiscalProvedor === 'NENHUM') {
    throw new HttpError(400, 'Nenhum serviço de nota fiscal está conectado. O gestor conecta em Notas fiscais.');
  }
  const existente = await prisma.notaFiscal.findUnique({ where: { contaId } });
  if (existente && (existente.status === 'AUTORIZADA' || existente.status === 'PROCESSANDO')) {
    throw new HttpError(409, 'Esta conta já tem nota emitida ou em processamento.');
  }
  if (existente?.status === 'CANCELADA') {
    throw new HttpError(409, 'A nota desta conta foi cancelada.');
  }
  // Referência curta (cabe no limite de 15 caracteres da WebmaniaBR) e nova a cada tentativa.
  const tentativa = existente ? Number(existente.referencia.split('T')[1] ?? '1') + 1 : 1;
  const referencia = `C${contaId}T${tentativa}`;
  const venda = await montarVenda(contaId, referencia, configuracao);
  const credenciais = lerCredenciais(configuracao);

  let resultado: Resultado;
  try {
    if (configuracao.fiscalProvedor === 'WEBHOOK') resultado = await emitirPorWebhook(venda, configuracao, credenciais);
    else if (configuracao.fiscalProvedor === 'FOCUS_NFE') resultado = await emitirPelaFocus(venda, configuracao, credenciais);
    else resultado = await emitirPelaWebmania(venda, configuracao, credenciais);
  } catch (erro) {
    // Falha antes de o emissor responder: fica registrada para o gestor ver e tentar de novo.
    resultado = { status: 'ERRO', mensagem: erro instanceof Error ? erro.message : 'Erro ao emitir a nota.' };
  }

  const dados = {
    provedor: configuracao.fiscalProvedor,
    ambiente: configuracao.fiscalAmbiente,
    referencia,
    cpfCnpjCliente: venda.cpfCnpjCliente,
    valor: venda.valorProdutos.toFixed(2),
    ...semNulos(resultado),
  };
  return prisma.notaFiscal.upsert({
    where: { contaId },
    create: { contaId, ...dados },
    update: { ...dados, numero: resultado.numero ?? null, chave: resultado.chave ?? null },
  });
}

// Pergunta ao emissor como ficou a nota (para as que estão em processamento).
export async function consultarNota(id: number): Promise<NotaFiscal> {
  const nota = await prisma.notaFiscal.findUnique({ where: { id } });
  if (!nota) {
    throw new HttpError(404, 'Nota não encontrada');
  }
  const configuracao = await lerConfiguracao();
  if (configuracao.fiscalProvedor !== nota.provedor) {
    throw new HttpError(400, 'Esta nota foi emitida por outro serviço, que não está mais conectado.');
  }
  const credenciais = lerCredenciais(configuracao);
  let resultado: Resultado;
  if (nota.provedor === 'WEBHOOK') resultado = await consultarWebhook(nota, configuracao, credenciais);
  else if (nota.provedor === 'FOCUS_NFE') resultado = await consultarFocus(nota, configuracao, credenciais);
  else resultado = await consultarWebmania(nota, credenciais);
  return prisma.notaFiscal.update({ where: { id }, data: semNulos(resultado) });
}

// Chamado quando a conta fecha: emite sozinho se o gestor ligou a emissão automática. Nunca derruba o pagamento.
export function emitirSeAutomatico(contaId: number): void {
  void (async () => {
    const configuracao = await lerConfiguracao();
    if (configuracao.fiscalProvedor === 'NENHUM' || !configuracao.fiscalEmissaoAutomatica) return;
    await emitirNota(contaId);
  })().catch((erro: unknown) => {
    console.error('Falha na emissão automática da nota:', erro instanceof Error ? erro.message : erro);
  });
}
