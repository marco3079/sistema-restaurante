import crypto from 'crypto';
import { z } from 'zod';
import type { OrigemPedido, Prisma, StatusPedido } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { ocuparMesa } from './mesas';
import { garantirConta } from './contas';
import { baixarPorPedido } from './estoque';
import { baixarInsumosPorPedido } from './insumos';
import { itensParaBaixa } from './combos';
import { precoAgora, promocoesValendo } from './precos';

// Regras comuns aos pedidos feitos pela equipe e pelo cardápio da mesa.

export const STATUS_EM_ANDAMENTO: StatusPedido[] = ['NOVO', 'EM_PREPARO', 'PRONTO'];

export const itensSchema = z
  .array(
    z.object({
      produtoId: z.number().int().positive(),
      quantidade: z.number().int().min(1, 'Quantidade mínima: 1').max(50, 'Quantidade máxima: 50'),
      observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
      // Ids das opções escolhidas (Opcao) dos grupos do produto.
      opcoes: z.array(z.number().int().positive()).max(30).optional(),
    })
  )
  .min(1, 'Escolha pelo menos um item')
  .max(40, 'Itens demais em um só pedido');

export type ItemEntrada = z.infer<typeof itensSchema>[number];

export const incluirPedido = {
  itens: { orderBy: { id: 'asc' } },
  mesa: { select: { id: true, numero: true, nome: true, tipo: true } },
  garcom: { select: { id: true, nome: true } },
  setores: { include: { setor: { select: { id: true, nome: true, cor: true } } }, orderBy: { setorId: 'asc' } },
  entrega: true,
} satisfies Prisma.PedidoInclude;

type PedidoCompleto = Prisma.PedidoGetPayload<{ include: typeof incluirPedido }>;

// Opções guardadas no item (coluna Json): lista vazia quando não há.
function lerOpcoes(valor: unknown): { grupo: string; opcao: string; precoExtra: number }[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
    .map((o) => ({ grupo: String(o.grupo ?? ''), opcao: String(o.opcao ?? ''), precoExtra: Number(o.precoExtra ?? 0) }));
}

export function paraPedidoDTO(p: PedidoCompleto) {
  const e = p.entrega;
  return {
    id: p.id,
    mesa: { id: p.mesa.id, numero: p.mesa.numero, nome: p.mesa.nome, tipo: p.mesa.tipo },
    status: p.status,
    origem: p.origem,
    nomeCliente: p.nomeCliente,
    observacao: p.observacao,
    garcom: p.garcom,
    total: Number(p.total),
    pagoEm: p.pagoEm ? p.pagoEm.toISOString() : null,
    formaPagamento: p.formaPagamento,
    criadoEm: p.criadoEm.toISOString(),
    atualizadoEm: p.atualizadoEm.toISOString(),
    entrega: e
      ? {
          tipo: e.tipo,
          codigo: e.codigo,
          nomeCliente: e.nomeCliente,
          telefone: e.telefone,
          endereco: e.endereco,
          complemento: e.complemento,
          bairro: e.bairro,
          referencia: e.referencia,
          taxaEntrega: Number(e.taxaEntrega),
          formaPagamento: e.formaPagamento,
          trocoPara: e.trocoPara === null ? null : Number(e.trocoPara),
          saiuEm: e.saiuEm ? e.saiuEm.toISOString() : null,
          concluidoEm: e.concluidoEm ? e.concluidoEm.toISOString() : null,
          entregadorNome: e.entregadorNome,
        }
      : null,
    setores: p.setores.map((s) => ({
      setorId: s.setorId,
      nome: s.setor.nome,
      cor: s.setor.cor,
      status: s.status,
    })),
    itens: p.itens.map((i) => ({
      id: i.id,
      produtoId: i.produtoId,
      nomeProduto: i.nomeProduto,
      precoUnitario: Number(i.precoUnitario),
      quantidade: i.quantidade,
      observacao: i.observacao,
      opcoes: lerOpcoes(i.opcoes),
      precoOriginal: i.precoOriginal === null ? null : Number(i.precoOriginal),
      setorId: i.setorId ?? null,
    })),
  };
}

export type PedidoDTO = ReturnType<typeof paraPedidoDTO>;

function textoOuNulo(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

type ProdutoComGrupos = Prisma.ProdutoGetPayload<{ include: { grupos: { include: { opcoes: true } } } }>;

// Confere as opções escolhidas com os grupos do produto e devolve as escolhas na ordem do cardápio.
function escolhasDoItem(
  produto: ProdutoComGrupos,
  escolhidas: number[]
): { grupo: string; opcao: string; precoExtra: number }[] {
  const grupos = [...produto.grupos].sort((a, b) => a.ordem - b.ordem);
  const achadas = new Map<number, { grupoId: number; ordem: number; opcao: string; precoExtra: number }>();
  for (const g of grupos) {
    for (const o of g.opcoes) {
      if (o.ativa) achadas.set(o.id, { grupoId: g.id, ordem: o.ordem, opcao: o.nome, precoExtra: Number(o.precoExtra) });
    }
  }
  const semRepetir = new Set(escolhidas);
  if (semRepetir.size !== escolhidas.length || escolhidas.some((id) => !achadas.has(id))) {
    throw new HttpError(400, 'Uma das opções escolhidas não existe mais. Atualize a página.');
  }
  const resultado: { grupo: string; opcao: string; precoExtra: number }[] = [];
  for (const g of grupos) {
    const deste = escolhidas
      .filter((id) => achadas.get(id)?.grupoId === g.id)
      .sort((a, b) => (achadas.get(a)?.ordem ?? 0) - (achadas.get(b)?.ordem ?? 0));
    const quantidade = deste.length;
    if (quantidade > g.maximo) {
      throw new HttpError(
        400,
        `Escolha no máximo ${g.maximo} ${g.maximo === 1 ? 'opção' : 'opções'} em "${g.nome}" de "${produto.nome}"`
      );
    }
    if (quantidade < g.minimo) {
      throw new HttpError(
        400,
        `Escolha ${g.minimo} ${g.minimo === 1 ? 'opção' : 'opções'} em "${g.nome}" de "${produto.nome}"`
      );
    }
    for (const id of deste) {
      const escolha = achadas.get(id);
      if (escolha) resultado.push({ grupo: g.nome, opcao: escolha.opcao, precoExtra: escolha.precoExtra });
    }
  }
  return resultado;
}

// Cria o pedido com o preço e o nome dos produtos copiados do cardápio no momento.
// Recusa produto fora do cardápio ou esgotado.
export async function criarPedido(entrada: {
  mesaId: number;
  origem: OrigemPedido;
  itens: ItemEntrada[];
  nomeCliente?: string | null;
  observacao?: string | null;
  garcomId?: number | null;
  // Conta já aberta pelo chamador (ex.: delivery, com a taxa de entrega). Sem ele, usa a conta da mesa.
  contaId?: number;
}): Promise<PedidoDTO> {
  // Junta linhas repetidas do mesmo produto sem observação.
  const ids = [...new Set(entrada.itens.map((i) => i.produtoId))];
  const produtos = await prisma.produto.findMany({
    where: { id: { in: ids } },
    include: {
      categoria: { select: { ativa: true, setorId: true } },
      grupos: { include: { opcoes: true } },
    },
  });
  const promocoes = await promocoesValendo();
  const porId = new Map(produtos.map((p) => [p.id, p]));

  let totalCentavos = 0;
  const setoresDoPedido = new Set<number>();
  const linhas = entrada.itens.map((item) => {
    const produto = porId.get(item.produtoId);
    if (!produto || !produto.ativo || !produto.categoria.ativa) {
      throw new HttpError(400, 'Um dos itens não está mais no cardápio. Atualize a página.');
    }
    if (!produto.disponivel) {
      throw new HttpError(400, `"${produto.nome}" está esgotado no momento.`);
    }
    const escolhas = escolhasDoItem(produto, item.opcoes ?? []);
    const preco = precoAgora(produto, promocoes);
    const extrasCentavos = escolhas.reduce((soma, e) => soma + Math.round(e.precoExtra * 100), 0);
    const unitarioCentavos = Math.round(preco.preco * 100) + extrasCentavos;
    const originalCentavos =
      preco.precoOriginal === null ? null : Math.round(preco.precoOriginal * 100) + extrasCentavos;
    totalCentavos += unitarioCentavos * item.quantidade;
    const setorId = produto.categoria.setorId ?? null;
    if (setorId !== null) setoresDoPedido.add(setorId);
    return {
      produtoId: produto.id,
      nomeProduto: produto.nome,
      precoUnitario: (unitarioCentavos / 100).toFixed(2),
      precoOriginal: originalCentavos === null ? null : (originalCentavos / 100).toFixed(2),
      quantidade: item.quantidade,
      observacao: textoOuNulo(item.observacao),
      opcoes: escolhas.length > 0 ? escolhas : undefined,
      setorId,
    };
  });

  const contaId = entrada.contaId ?? (await garantirConta(entrada.mesaId)).id;
  // O pedido e a baixa do estoque entram juntos: se faltar estoque, o pedido não é criado.
  const pedido = await prisma.$transaction(async (tx) => {
    const criado = await tx.pedido.create({
      data: {
        mesaId: entrada.mesaId,
        contaId,
        origem: entrada.origem,
        nomeCliente: textoOuNulo(entrada.nomeCliente),
        observacao: textoOuNulo(entrada.observacao),
        garcomId: entrada.garcomId ?? null,
        total: (totalCentavos / 100).toFixed(2),
        itens: { create: linhas },
        setores: { create: [...setoresDoPedido].map((setorId) => ({ setorId, status: 'NOVO' as const })) },
      },
      include: incluirPedido,
    });
    // Combos viram os componentes na baixa (e o próprio combo, se ele tiver estoque ou ficha).
    const baixa = await itensParaBaixa(tx, entrada.itens);
    await baixarPorPedido(tx, baixa, criado.id);
    await baixarInsumosPorPedido(tx, baixa, criado.id);
    return criado;
  });
  // Mesa com pedido é mesa ocupada.
  await ocuparMesa(entrada.mesaId);
  return paraPedidoDTO(pedido);
}

// Segredo do endereço do cardápio da mesa (vai no QR code).
export function novoCodigoDeMesa(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function inicioDoDia(base = new Date()): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}
