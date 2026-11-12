import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { inicioDoDia, STATUS_EM_ANDAMENTO } from '../../lib/pedidos';

const router = Router();

// Painel inicial (GET /api/painel/resumo), busca do topo (GET /api/busca)
// e sino de avisos (GET /api/notificacoes).

type IconePainel = 'financeiro' | 'pedidos' | 'mesas' | 'grafico' | 'relogio' | 'sino' | 'cardapio';
type CorCartao = 'azul' | 'roxo' | 'verde' | 'laranja';

interface Cartao {
  chave: string;
  rotulo: string;
  valor: string;
  icone: IconePainel;
  cor: CorCartao;
  variacao: number | null;
}

interface Destaque {
  etiqueta: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

interface PontoDesempenho {
  mes: string;
  rotulo: string;
  valor: number | null;
}

interface ItemBusca {
  tipo: 'Produto' | 'Mesa' | 'Usuário';
  titulo: string;
  subtitulo: string;
  caminho: string;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const ROTULO_STATUS: Record<string, string> = {
  NOVO: 'Novo',
  EM_PREPARO: 'Em preparo',
  PRONTO: 'Pronto',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function variacao(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

function nomeDaMesa(mesa: { numero: number; nome: string | null }): string {
  return mesa.nome ? `Mesa ${mesa.numero} · ${mesa.nome}` : `Mesa ${mesa.numero}`;
}

function prefixo(perfil: string): string {
  return perfil === 'GESTOR' ? '/gestor' : '/garcom';
}

// Soma e quantidade dos pedidos não cancelados criados no intervalo.
async function vendas(de: Date, ate: Date): Promise<{ total: number; pedidos: number }> {
  const r = await prisma.pedido.aggregate({
    where: { status: { not: 'CANCELADO' }, criadoEm: { gte: de, lt: ate } },
    _sum: { total: true },
    _count: { _all: true },
  });
  return { total: Number(r._sum.total ?? 0), pedidos: r._count._all };
}

async function ocupacao(): Promise<{ ocupadas: number; total: number; chamando: number }> {
  const [mesas, abertas] = await Promise.all([
    prisma.mesa.findMany({ where: { ativa: true }, select: { id: true, chamandoDesde: true } }),
    prisma.pedido.findMany({
      where: { pagoEm: null, status: { not: 'CANCELADO' } },
      select: { mesaId: true },
      distinct: ['mesaId'],
    }),
  ]);
  const ocupadas = new Set(abertas.map((p) => p.mesaId));
  return {
    ocupadas: mesas.filter((m) => ocupadas.has(m.id)).length,
    total: mesas.length,
    chamando: mesas.filter((m) => m.chamandoDesde !== null).length,
  };
}

async function cartoesGestor(): Promise<Cartao[]> {
  const hoje = inicioDoDia();
  const amanha = new Date(hoje.getTime() + MS_POR_DIA);
  const ontem = new Date(hoje.getTime() - MS_POR_DIA);
  const [deHoje, deOntem, mesas] = await Promise.all([
    vendas(hoje, amanha),
    vendas(ontem, hoje),
    ocupacao(),
  ]);
  const ticket = deHoje.pedidos > 0 ? deHoje.total / deHoje.pedidos : 0;
  return [
    {
      chave: 'vendas',
      rotulo: 'Vendas hoje',
      valor: moeda(deHoje.total),
      icone: 'financeiro',
      cor: 'azul',
      variacao: variacao(deHoje.total, deOntem.total),
    },
    {
      chave: 'pedidos',
      rotulo: 'Pedidos hoje',
      valor: String(deHoje.pedidos),
      icone: 'pedidos',
      cor: 'roxo',
      variacao: variacao(deHoje.pedidos, deOntem.pedidos),
    },
    {
      chave: 'mesas',
      rotulo: 'Mesas ocupadas',
      valor: `${mesas.ocupadas}/${mesas.total}`,
      icone: 'mesas',
      cor: 'verde',
      variacao: null,
    },
    {
      chave: 'ticket',
      rotulo: 'Valor médio por pedido',
      valor: moeda(ticket),
      icone: 'grafico',
      cor: 'laranja',
      variacao: null,
    },
  ];
}

async function cartoesGarcom(): Promise<Cartao[]> {
  const [andamento, prontos, mesas] = await Promise.all([
    prisma.pedido.count({ where: { status: { in: ['NOVO', 'EM_PREPARO'] } } }),
    prisma.pedido.count({ where: { status: 'PRONTO' } }),
    ocupacao(),
  ]);
  return [
    {
      chave: 'andamento',
      rotulo: 'Pedidos em preparo',
      valor: String(andamento),
      icone: 'relogio',
      cor: 'azul',
      variacao: null,
    },
    {
      chave: 'prontos',
      rotulo: 'Prontos para entregar',
      valor: String(prontos),
      icone: 'pedidos',
      cor: 'verde',
      variacao: null,
    },
    {
      chave: 'mesas',
      rotulo: 'Mesas ocupadas',
      valor: `${mesas.ocupadas}/${mesas.total}`,
      icone: 'mesas',
      cor: 'roxo',
      variacao: null,
    },
    {
      chave: 'chamando',
      rotulo: 'Mesas chamando',
      valor: String(mesas.chamando),
      icone: 'sino',
      cor: 'laranja',
      variacao: null,
    },
  ];
}

// Vendas por mês nos últimos 12 meses (pedidos não cancelados, pelo dia em que foram feitos).
async function vendasPorMes(): Promise<PontoDesempenho[]> {
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth() - 11, 1);
  const pedidos = await prisma.pedido.findMany({
    where: { status: { not: 'CANCELADO' }, criadoEm: { gte: inicio } },
    select: { total: true, criadoEm: true },
  });
  const somas = new Map<string, number>();
  for (const p of pedidos) {
    const chave = `${p.criadoEm.getFullYear()}-${String(p.criadoEm.getMonth() + 1).padStart(2, '0')}`;
    somas.set(chave, (somas.get(chave) ?? 0) + Number(p.total));
  }
  const pontos: PontoDesempenho[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const soma = somas.get(chave);
    pontos.push({
      mes: chave,
      rotulo: MESES_CURTOS[d.getMonth()],
      valor: soma === undefined ? null : Math.round(soma * 100) / 100,
    });
  }
  return pontos;
}

async function destaqueGestor(): Promise<Destaque | null> {
  const itens = await prisma.itemPedido.groupBy({
    by: ['nomeProduto'],
    where: { pedido: { status: { not: 'CANCELADO' }, criadoEm: { gte: inicioDoDia() } } },
    _sum: { quantidade: true },
    orderBy: { _sum: { quantidade: 'desc' } },
    take: 1,
  });
  const primeiro = itens[0];
  if (!primeiro) return null;
  const unidades = primeiro._sum.quantidade ?? 0;
  return {
    etiqueta: 'Mais pedido hoje',
    titulo: primeiro.nomeProduto,
    subtitulo: `${unidades} ${unidades === 1 ? 'unidade vendida' : 'unidades vendidas'}`,
    caminho: '/gestor/cardapio',
  };
}

async function destaqueGarcom(): Promise<Destaque | null> {
  const pronto = await prisma.pedido.findFirst({
    where: { status: 'PRONTO' },
    orderBy: { atualizadoEm: 'asc' },
    select: { id: true, mesa: { select: { numero: true, nome: true } }, itens: { select: { quantidade: true } } },
  });
  if (!pronto) return null;
  const itens = pronto.itens.reduce((soma, i) => soma + i.quantidade, 0);
  return {
    etiqueta: 'Próxima entrega',
    titulo: nomeDaMesa(pronto.mesa),
    subtitulo: `Pedido #${pronto.id} · ${itens} ${itens === 1 ? 'item' : 'itens'}`,
    caminho: '/garcom/pedidos',
  };
}

async function pedidosRecentes() {
  const pedidos = await prisma.pedido.findMany({
    orderBy: { criadoEm: 'desc' },
    take: 4,
    select: {
      id: true,
      status: true,
      total: true,
      criadoEm: true,
      mesa: { select: { numero: true, nome: true } },
      itens: { select: { quantidade: true, nomeProduto: true } },
    },
  });
  return pedidos.map((p) => ({
    id: p.id,
    titulo: `${nomeDaMesa(p.mesa)} · ${ROTULO_STATUS[p.status] ?? p.status}`,
    corpo: p.itens.map((i) => `${i.quantidade}x ${i.nomeProduto}`).join(', '),
    valor: moeda(Number(p.total)),
    criadoEm: p.criadoEm.toISOString(),
  }));
}

router.get(
  '/painel/resumo',
  asyncHandler(async (req, res) => {
    const u = req.usuario;
    const usuario = await prisma.usuario.findUnique({ where: { id: u.id }, select: { nome: true } });
    if (!usuario) {
      throw new HttpError(404, 'Usuário não encontrado');
    }
    const primeiroNome = usuario.nome.trim().split(/\s+/)[0] ?? '';
    const gestor = u.perfil === 'GESTOR';
    const [cartoes, desempenho, destaque, recentes] = await Promise.all([
      gestor ? cartoesGestor() : cartoesGarcom(),
      vendasPorMes(),
      gestor ? destaqueGestor() : destaqueGarcom(),
      pedidosRecentes(),
    ]);
    res.json({ primeiroNome, cartoes, desempenho, destaque, recentes });
  })
);

// Sino do topo: o que espera uma ação da equipe agora.
router.get(
  '/notificacoes',
  asyncHandler(async (req, res) => {
    const raiz = prefixo(req.usuario.perfil);
    const [chamando, pedidos] = await Promise.all([
      prisma.mesa.findMany({
        where: { chamandoDesde: { not: null }, ativa: true },
        orderBy: { chamandoDesde: 'asc' },
      }),
      prisma.pedido.findMany({
        where: { status: { in: ['NOVO', 'PRONTO'] } },
        orderBy: { criadoEm: 'asc' },
        take: 30,
        select: {
          id: true,
          status: true,
          origem: true,
          criadoEm: true,
          atualizadoEm: true,
          mesa: { select: { numero: true, nome: true } },
        },
      }),
    ]);
    const avisos = [
      ...chamando.map((m) => ({
        chave: `mesa-${m.id}`,
        titulo: `${nomeDaMesa(m)} está chamando`,
        meta: 'Chamado do cliente',
        quando: (m.chamandoDesde ?? new Date()).toISOString(),
        caminho: `${raiz}/mesas`,
      })),
      ...pedidos.map((p) => ({
        chave: `pedido-${p.id}-${p.status}`,
        titulo:
          p.status === 'PRONTO'
            ? `Pedido #${p.id} pronto para entregar`
            : `Novo pedido #${p.id}`,
        meta:
          nomeDaMesa(p.mesa) +
          (p.status === 'NOVO' ? (p.origem === 'CLIENTE' ? ' · feito pelo cliente' : ' · lançado pela equipe') : ''),
        quando: (p.status === 'PRONTO' ? p.atualizadoEm : p.criadoEm).toISOString(),
        caminho: `${raiz}/pedidos`,
      })),
    ];
    res.json(avisos);
  })
);

router.get(
  '/busca',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const u = req.usuario;
    const raiz = prefixo(u.perfil);
    const texto = { contains: q, mode: 'insensitive' as const };
    const itens: ItemBusca[] = [];

    const produtos = await prisma.produto.findMany({
      where: { ativo: true, OR: [{ nome: texto }, { descricao: texto }] },
      select: { nome: true, preco: true, categoria: { select: { nome: true } } },
      orderBy: { nome: 'asc' },
      take: 5,
    });
    itens.push(
      ...produtos.map(
        (p): ItemBusca => ({
          tipo: 'Produto',
          titulo: p.nome,
          subtitulo: `${p.categoria.nome} · ${moeda(Number(p.preco))}`,
          caminho: `${raiz}/cardapio`,
        })
      )
    );

    const numero = /^\d{1,4}$/.test(q) ? Number(q) : null;
    const mesas = await prisma.mesa.findMany({
      where: { OR: [{ nome: texto }, ...(numero !== null ? [{ numero }] : [])] },
      select: { numero: true, nome: true, lugares: true },
      orderBy: { numero: 'asc' },
      take: 4,
    });
    itens.push(
      ...mesas.map(
        (m): ItemBusca => ({
          tipo: 'Mesa',
          titulo: nomeDaMesa(m),
          subtitulo: `${m.lugares} lugares`,
          caminho: `${raiz}/mesas`,
        })
      )
    );

    if (u.perfil === 'GESTOR') {
      const usuarios = await prisma.usuario.findMany({
        where: { OR: [{ nome: texto }, { email: texto }] },
        select: { nome: true, perfil: true },
        orderBy: { nome: 'asc' },
        take: 4,
      });
      itens.push(
        ...usuarios.map(
          (p): ItemBusca => ({
            tipo: 'Usuário',
            titulo: p.nome,
            subtitulo: p.perfil === 'GESTOR' ? 'Gestor' : 'Garçom',
            caminho: '/gestor/usuarios',
          })
        )
      );
    }

    res.json(itens);
  })
);

export default router;
