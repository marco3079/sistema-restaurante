import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Relatórios de vendas de um período (só o GESTOR). Só lê pedidos, contas e pagamentos.
// Dinheiro é somado em centavos; os tempos saem em minutos com 1 casa.

const router = Router();

const DIA_MS = 24 * 60 * 60 * 1000;
const MAXIMO_DIAS = 366;
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

interface Dia {
  ano: number;
  mes: number; // 1 a 12
  dia: number;
}

function textoQuery(valor: unknown): string | undefined {
  if (valor === undefined || valor === '') return undefined;
  if (typeof valor !== 'string') throw new HttpError(400, 'Período inválido');
  return valor;
}

// Lê AAAA-MM-DD e confere se o dia existe (ex.: 31 de fevereiro não existe).
function lerDia(texto: string, nome: string): Dia {
  if (!FORMATO_DIA.test(texto)) throw new HttpError(400, `Data ${nome} inválida`);
  const [ano, mes, dia] = texto.split('-').map(Number);
  const conferir = new Date(ano, mes - 1, dia, 12);
  if (conferir.getFullYear() !== ano || conferir.getMonth() !== mes - 1 || conferir.getDate() !== dia) {
    throw new HttpError(400, `Data ${nome} inválida`);
  }
  return { ano, mes, dia };
}

function hojeLocal(): Dia {
  const agora = new Date();
  return { ano: agora.getFullYear(), mes: agora.getMonth() + 1, dia: agora.getDate() };
}

function textoDoDia(d: Dia): string {
  return `${String(d.ano).padStart(4, '0')}-${String(d.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`;
}

function textoDaData(data: Date): string {
  return textoDoDia({ ano: data.getFullYear(), mes: data.getMonth() + 1, dia: data.getDate() });
}

// Soma n dias a um dia (o JavaScript ajusta mês e ano).
function somarDias(d: Dia, n: number): Dia {
  const data = new Date(d.ano, d.mes - 1, d.dia + n, 12);
  return { ano: data.getFullYear(), mes: data.getMonth() + 1, dia: data.getDate() };
}

// Sem de/ate: do dia 1 do mês atual até hoje. Com só um deles, o outro usa o mesmo padrão.
function periodoDaConsulta(query: Record<string, unknown>): { de: Dia; ate: Dia; dias: number } {
  const hoje = hojeLocal();
  const deTexto = textoQuery(query.de);
  const ateTexto = textoQuery(query.ate);
  const de = deTexto ? lerDia(deTexto, 'inicial') : { ...hoje, dia: 1 };
  const ate = ateTexto ? lerDia(ateTexto, 'final') : hoje;
  const dias =
    Math.round((Date.UTC(ate.ano, ate.mes - 1, ate.dia) - Date.UTC(de.ano, de.mes - 1, de.dia)) / DIA_MS) + 1;
  if (dias < 1) throw new HttpError(400, 'A data final é anterior à inicial');
  if (dias > MAXIMO_DIAS) throw new HttpError(400, 'O período pode ter no máximo 366 dias');
  return { de, ate, dias };
}

const centavos = (valor: number) => Math.round(valor * 100);
const reais = (c: number) => c / 100;
const minutos = (ms: number) => Math.round((ms / 60000) * 10) / 10;
const mediaMinutos = (valoresMs: number[]) =>
  valoresMs.length === 0 ? null : minutos(valoresMs.reduce((soma, v) => soma + v, 0) / valoresMs.length);

router.get(
  '/relatorios/vendas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { de, ate, dias } = periodoDaConsulta(req.query);
    const periodo = {
      gte: new Date(de.ano, de.mes - 1, de.dia, 0, 0, 0, 0),
      lte: new Date(ate.ano, ate.mes - 1, ate.dia, 23, 59, 59, 999),
    };

    const [pedidos, contas, pagos, produtos] = await Promise.all([
      prisma.pedido.findMany({
        where: { criadoEm: periodo },
        select: {
          status: true,
          origem: true,
          total: true,
          criadoEm: true,
          prontoEm: true,
          itens: { select: { produtoId: true, quantidade: true, precoUnitario: true } },
        },
      }),
      prisma.conta.findMany({
        where: { status: 'FECHADA', fechadaEm: periodo },
        select: { abertaEm: true, fechadaEm: true },
      }),
      prisma.pagamento.aggregate({
        where: { status: 'APROVADO', conta: { status: 'FECHADA', fechadaEm: periodo } },
        _sum: { valor: true },
      }),
      prisma.produto.findMany({
        select: { id: true, nome: true, ativo: true, categoria: { select: { nome: true } } },
      }),
    ]);

    // Pedidos cancelados ficam fora de todos os totais; só são contados.
    const validos = pedidos.filter((p) => p.status !== 'CANCELADO');
    const cancelados = pedidos.length - validos.length;

    let itens = 0;
    let faturamentoCentavos = 0;
    const porProduto = new Map<number, { quantidade: number; centavos: number }>();
    const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, pedidos: 0, centavos: 0 }));
    const porDiaSemana = Array.from({ length: 7 }, (_, dia) => ({ dia, pedidos: 0, centavos: 0 }));
    const porDia = new Map<string, { pedidos: number; centavos: number }>();
    for (let i = 0; i < dias; i++) {
      porDia.set(textoDoDia(somarDias(de, i)), { pedidos: 0, centavos: 0 });
    }
    const porOrigem = {
      CLIENTE: { pedidos: 0, centavos: 0 },
      GARCOM: { pedidos: 0, centavos: 0 },
    };
    const temposPreparo: number[] = [];

    for (const p of validos) {
      const valorPedido = centavos(Number(p.total));
      faturamentoCentavos += valorPedido;

      const hora = porHora[p.criadoEm.getHours()];
      hora.pedidos += 1;
      hora.centavos += valorPedido;

      const diaSemana = porDiaSemana[p.criadoEm.getDay()];
      diaSemana.pedidos += 1;
      diaSemana.centavos += valorPedido;

      const chaveDia = textoDaData(p.criadoEm);
      const dataDoPeriodo = porDia.get(chaveDia) ?? { pedidos: 0, centavos: 0 };
      dataDoPeriodo.pedidos += 1;
      dataDoPeriodo.centavos += valorPedido;
      porDia.set(chaveDia, dataDoPeriodo);

      const origem = porOrigem[p.origem];
      origem.pedidos += 1;
      origem.centavos += valorPedido;

      if (p.prontoEm) temposPreparo.push(p.prontoEm.getTime() - p.criadoEm.getTime());

      for (const item of p.itens) {
        itens += item.quantidade;
        const acumulado = porProduto.get(item.produtoId) ?? { quantidade: 0, centavos: 0 };
        acumulado.quantidade += item.quantidade;
        acumulado.centavos += centavos(Number(item.precoUnitario) * item.quantidade);
        porProduto.set(item.produtoId, acumulado);
      }
    }

    const mapaProdutos = new Map(produtos.map((p) => [p.id, p] as const));
    const vendidos = [...porProduto.entries()]
      .map(([produtoId, acc]) => {
        const produto = mapaProdutos.get(produtoId);
        return {
          produtoId,
          nome: produto?.nome ?? 'Produto removido',
          categoria: produto?.categoria.nome ?? 'Sem categoria',
          quantidade: acc.quantidade,
          centavos: acc.centavos,
        };
      })
      .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'));

    const porCategoria = new Map<string, { quantidade: number; centavos: number }>();
    for (const v of vendidos) {
      const acumulado = porCategoria.get(v.categoria) ?? { quantidade: 0, centavos: 0 };
      acumulado.quantidade += v.quantidade;
      acumulado.centavos += v.centavos;
      porCategoria.set(v.categoria, acumulado);
    }

    const vendidosIds = new Set(porProduto.keys());
    const semVenda = produtos
      .filter((p) => p.ativo && !vendidosIds.has(p.id))
      .map((p) => ({ produtoId: p.id, nome: p.nome, categoria: p.categoria.nome }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));

    const contasFechadas = contas.length;
    const pagoCentavos = centavos(Number(pagos._sum.valor ?? 0));
    const temposMesa = contas.flatMap((c) =>
      c.fechadaEm ? [c.fechadaEm.getTime() - c.abertaEm.getTime()] : []
    );

    res.json({
      de: textoDoDia(de),
      ate: textoDoDia(ate),
      resumo: {
        pedidos: validos.length,
        cancelados,
        itens,
        faturamento: reais(faturamentoCentavos),
        contasFechadas,
        ticketMedio: contasFechadas === 0 ? 0 : reais(Math.round(pagoCentavos / contasFechadas)),
        tempoMedioPreparoMin: mediaMinutos(temposPreparo),
        tempoMedioMesaMin: mediaMinutos(temposMesa),
      },
      produtos: vendidos.map((v) => ({
        produtoId: v.produtoId,
        nome: v.nome,
        categoria: v.categoria,
        quantidade: v.quantidade,
        valor: reais(v.centavos),
      })),
      semVenda,
      categorias: [...porCategoria.entries()]
        .map(([categoria, acc]) => ({ categoria, quantidade: acc.quantidade, valor: reais(acc.centavos) }))
        .sort((a, b) => b.valor - a.valor || a.categoria.localeCompare(b.categoria, 'pt-BR')),
      porHora: porHora.map((h) => ({ hora: h.hora, pedidos: h.pedidos, valor: reais(h.centavos) })),
      porDiaSemana: porDiaSemana.map((d) => ({ dia: d.dia, pedidos: d.pedidos, valor: reais(d.centavos) })),
      porDia: [...porDia.entries()].map(([dia, acc]) => ({ dia, pedidos: acc.pedidos, valor: reais(acc.centavos) })),
      porOrigem: (['CLIENTE', 'GARCOM'] as const).map((origem) => ({
        origem,
        pedidos: porOrigem[origem].pedidos,
        valor: reais(porOrigem[origem].centavos),
      })),
    });
  })
);

export default router;
