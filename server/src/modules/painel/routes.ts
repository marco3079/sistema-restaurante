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
  if (perfil === 'GESTOR') return '/gestor';
  if (perfil === 'LIMPEZA') return '/limpeza';
  if (perfil === 'RECEPCAO') return '/recepcao';
  return perfil === 'COZINHA' ? '/cozinha' : '/garcom';
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
    prisma.mesa.findMany({ where: { ativa: true }, select: { id: true, chamandoDesde: true, estado: true } }),
    prisma.pedido.findMany({
      where: { pagoEm: null, status: { not: 'CANCELADO' } },
      select: { mesaId: true },
      distinct: ['mesaId'],
    }),
  ]);
  const ocupadas = new Set(abertas.map((p) => p.mesaId));
  return {
    ocupadas: mesas.filter((m) => ocupadas.has(m.id) || m.estado === 'OCUPADA').length,
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

// Situação das mesas ativas para quem acomoda os clientes: conta aberta também é mesa ocupada.
async function mesasParaRecepcao() {
  const [mesas, abertas] = await Promise.all([
    prisma.mesa.findMany({
      where: { ativa: true },
      select: { id: true, numero: true, nome: true, lugares: true, estado: true },
      orderBy: { numero: 'asc' },
    }),
    prisma.pedido.findMany({
      where: { pagoEm: null, status: { not: 'CANCELADO' } },
      select: { mesaId: true },
      distinct: ['mesaId'],
    }),
  ]);
  const comConta = new Set(abertas.map((p) => p.mesaId));
  return mesas.map((m) => ({ ...m, estado: comConta.has(m.id) ? ('OCUPADA' as const) : m.estado }));
}

async function cartoesRecepcao(): Promise<Cartao[]> {
  const mesas = await mesasParaRecepcao();
  const livres = mesas.filter((m) => m.estado === 'LIVRE');
  return [
    { chave: 'livres', rotulo: 'Mesas livres', valor: String(livres.length), icone: 'mesas', cor: 'verde', variacao: null },
    {
      chave: 'lugares',
      rotulo: 'Lugares livres',
      valor: String(livres.reduce((soma, m) => soma + m.lugares, 0)),
      icone: 'grafico',
      cor: 'azul',
      variacao: null,
    },
    {
      chave: 'limpeza',
      rotulo: 'Mesas em limpeza',
      valor: String(mesas.filter((m) => m.estado === 'LIMPEZA').length),
      icone: 'relogio',
      cor: 'laranja',
      variacao: null,
    },
    {
      chave: 'ocupadas',
      rotulo: 'Mesas ocupadas',
      valor: `${mesas.filter((m) => m.estado === 'OCUPADA').length}/${mesas.length}`,
      icone: 'pedidos',
      cor: 'roxo',
      variacao: null,
    },
  ];
}

async function destaqueRecepcao(): Promise<Destaque | null> {
  const livres = (await mesasParaRecepcao()).filter((m) => m.estado === 'LIVRE');
  if (livres.length === 0) return null;
  const maior = livres.reduce((a, b) => (b.lugares > a.lugares ? b : a));
  return {
    etiqueta: 'Maior mesa livre',
    titulo: nomeDaMesa(maior),
    subtitulo: `${maior.lugares} lugares`,
    caminho: '/recepcao/mesas',
  };
}

async function cartoesLimpeza(): Promise<Cartao[]> {
  const mesas = await prisma.mesa.findMany({ where: { ativa: true }, select: { estado: true, estadoDesde: true } });
  const paraLimpar = mesas.filter((m) => m.estado === 'LIMPEZA');
  const maisAntiga = paraLimpar.reduce<Date | null>(
    (menor, m) => (menor === null || m.estadoDesde < menor ? m.estadoDesde : menor),
    null
  );
  const minutos = maisAntiga ? Math.max(0, Math.floor((Date.now() - maisAntiga.getTime()) / 60000)) : 0;
  return [
    {
      chave: 'limpar',
      rotulo: 'Mesas para limpar',
      valor: String(paraLimpar.length),
      icone: 'mesas',
      cor: 'laranja',
      variacao: null,
    },
    {
      chave: 'espera',
      rotulo: 'Maior espera pela limpeza',
      valor: paraLimpar.length > 0 ? `${minutos} min` : '—',
      icone: 'relogio',
      cor: 'azul',
      variacao: null,
    },
    {
      chave: 'ocupadas',
      rotulo: 'Mesas ocupadas agora',
      valor: String(mesas.filter((m) => m.estado === 'OCUPADA').length),
      icone: 'pedidos',
      cor: 'roxo',
      variacao: null,
    },
    {
      chave: 'livres',
      rotulo: 'Mesas livres e limpas',
      valor: String(mesas.filter((m) => m.estado === 'LIVRE').length),
      icone: 'sino',
      cor: 'verde',
      variacao: null,
    },
  ];
}

async function destaqueLimpeza(): Promise<Destaque | null> {
  const mesa = await prisma.mesa.findFirst({
    where: { estado: 'LIMPEZA', ativa: true },
    orderBy: { estadoDesde: 'asc' },
    select: { numero: true, nome: true, estadoDesde: true },
  });
  if (!mesa) return null;
  const minutos = Math.max(0, Math.floor((Date.now() - mesa.estadoDesde.getTime()) / 60000));
  return {
    etiqueta: 'Limpar primeiro',
    titulo: nomeDaMesa(mesa),
    subtitulo: minutos < 1 ? 'Ficou vaga agora' : `Vaga há ${minutos} min`,
    caminho: '/limpeza/mesas',
  };
}

async function cartoesCozinha(): Promise<Cartao[]> {
  const [novos, preparo, prontos, esgotados] = await Promise.all([
    prisma.pedido.count({ where: { status: 'NOVO' } }),
    prisma.pedido.count({ where: { status: 'EM_PREPARO' } }),
    prisma.pedido.count({ where: { status: 'PRONTO' } }),
    prisma.produto.count({ where: { ativo: true, disponivel: false } }),
  ]);
  return [
    { chave: 'novos', rotulo: 'Pedidos novos', valor: String(novos), icone: 'pedidos', cor: 'azul', variacao: null },
    { chave: 'preparo', rotulo: 'Em preparo', valor: String(preparo), icone: 'relogio', cor: 'laranja', variacao: null },
    {
      chave: 'prontos',
      rotulo: 'Prontos esperando o garçom',
      valor: String(prontos),
      icone: 'sino',
      cor: 'verde',
      variacao: null,
    },
    {
      chave: 'esgotados',
      rotulo: 'Itens esgotados',
      valor: String(esgotados),
      icone: 'cardapio',
      cor: 'roxo',
      variacao: null,
    },
  ];
}

async function destaqueCozinha(): Promise<Destaque | null> {
  const proximo = await prisma.pedido.findFirst({
    where: { status: { in: ['NOVO', 'EM_PREPARO'] } },
    orderBy: { criadoEm: 'asc' },
    select: { id: true, mesa: { select: { numero: true, nome: true } }, itens: { select: { quantidade: true } } },
  });
  if (!proximo) return null;
  const itens = proximo.itens.reduce((soma, i) => soma + i.quantidade, 0);
  return {
    etiqueta: 'Há mais tempo na fila',
    titulo: nomeDaMesa(proximo.mesa),
    subtitulo: `Pedido #${proximo.id} · ${itens} ${itens === 1 ? 'item' : 'itens'}`,
    caminho: '/cozinha/pedidos',
  };
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
    const cozinha = u.perfil === 'COZINHA';
    const limpeza = u.perfil === 'LIMPEZA';
    const recepcao = u.perfil === 'RECEPCAO';
    const [cartoes, desempenho, destaque, recentes] = await Promise.all([
      gestor ? cartoesGestor() : cozinha ? cartoesCozinha() : limpeza ? cartoesLimpeza() : recepcao ? cartoesRecepcao() : cartoesGarcom(),
      // As vendas do restaurante são assunto do gestor: o garçom não recebe o gráfico.
      gestor ? vendasPorMes() : Promise.resolve([]),
      gestor ? destaqueGestor() : cozinha ? destaqueCozinha() : limpeza ? destaqueLimpeza() : recepcao ? destaqueRecepcao() : destaqueGarcom(),
      // A limpeza e a recepção não veem pedidos nem valores.
      limpeza || recepcao ? Promise.resolve([]) : pedidosRecentes(),
    ]);
    res.json({ primeiroNome, cartoes, desempenho, destaque, recentes });
  })
);

// Sino do topo: o que espera uma ação da equipe agora.
router.get(
  '/notificacoes',
  asyncHandler(async (req, res) => {
    const raiz = prefixo(req.usuario.perfil);
    const perfil = req.usuario.perfil;
    if (perfil === 'RECEPCAO') {
      res.json([]);
      return;
    }
    if (perfil === 'LIMPEZA') {
      const paraLimpar = await prisma.mesa.findMany({
        where: { estado: 'LIMPEZA', ativa: true },
        orderBy: { estadoDesde: 'asc' },
      });
      res.json(
        paraLimpar.map((m) => ({
          chave: `limpar-${m.id}-${m.estadoDesde.getTime()}`,
          titulo: `${nomeDaMesa(m)} para limpar`,
          meta: 'Mesa vaga',
          quando: m.estadoDesde.toISOString(),
          caminho: '/limpeza/mesas',
        }))
      );
      return;
    }
    // Cozinha: pedidos novos. Garçom: mesas chamando e pedidos prontos. Gestor: tudo.
    const situacoes: ('NOVO' | 'PRONTO')[] =
      perfil === 'COZINHA' ? ['NOVO'] : perfil === 'GARCOM' ? ['PRONTO'] : ['NOVO', 'PRONTO'];
    const [chamando, pedidos] = await Promise.all([
      prisma.mesa.findMany({
        where: { chamandoDesde: perfil === 'COZINHA' ? { equals: new Date(0) } : { not: null }, ativa: true },
        orderBy: { chamandoDesde: 'asc' },
      }),
      prisma.pedido.findMany({
        where: { status: { in: situacoes } },
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
    if (u.perfil === 'LIMPEZA' || u.perfil === 'RECEPCAO') {
      res.json([]);
      return;
    }
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
    const mesas = u.perfil === 'COZINHA' ? [] : await prisma.mesa.findMany({
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
            subtitulo: p.perfil === 'GESTOR' ? 'Gestor' : p.perfil === 'COZINHA' ? 'Cozinha' : p.perfil === 'LIMPEZA' ? 'Limpeza' : p.perfil === 'RECEPCAO' ? 'Recepção' : 'Garçom',
            caminho: '/gestor/usuarios',
          })
        )
      );
    }

    res.json(itens);
  })
);

export default router;
