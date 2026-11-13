import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { usePlataforma } from '../lib/plataforma';
import { useTema } from '../lib/tema';
import { useDados } from '../lib/useDados';
import { useAtualizacao } from '../lib/useAtualizacao';
import { assinarMesa, rajada } from '../lib/tempoReal';
import { STATUS_PEDIDO, horaCurta, mensagemErro } from '../lib/restaurante';
import type { StatusPedido } from '../lib/restaurante';
import { PerfilDoPrato, PrecoDoPrato, gruposComOpcoes, grupoPendente, somaDasOpcoes } from './PerfilDoPrato';
import type { OpcaoDoPrato, PratoDoPerfil } from './PerfilDoPrato';
import { Avaliar } from './Avaliar';
import type { ContaPendente } from './Avaliar';
import { FaixaRolavel } from './FaixaRolavel';
import { idiomaDoNavegador, lerIdiomaSalvo, normalizarIdioma, salvarIdioma, textos } from './textos';
import type { Idioma, Textos } from './textos';
import { Aviso, Botao, Campo, AreaTexto, Carregando, Modal, Selo, formatarMoeda } from '../ui';
import { Icone } from '../ui/icones';
import './cliente.css';

// Cardápio da mesa: página pública que o cliente abre pelo QR code. Sem login.

interface ProdutoCliente extends PratoDoPerfil {
  id: number;
  recomendado: boolean;
}

interface CardapioDTO {
  recomendados: number[];
  origemRecomendados: 'CASA' | 'MAIS_PEDIDOS';
  mesa: { numero: number; nome: string | null; chamando: boolean };
  categorias: { id: number; nome: string; produtos: ProdutoCliente[] }[];
  // Idiomas ativos do cardápio e o idioma usado nesta resposta (APIs antigas não mandam).
  idiomas?: string[];
  idioma?: string;
}

interface PedidoCliente {
  id: number;
  status: StatusPedido;
  nomeCliente: string | null;
  observacao: string | null;
  total: number;
  criadoEm: string;
  itens: {
    nomeProduto: string;
    precoUnitario: number;
    quantidade: number;
    observacao: string | null;
    opcoes?: { grupo: string; opcao: string; precoExtra: number }[];
  }[];
}

interface PedidosDTO {
  pedidos: PedidoCliente[];
  total: number;
  desconto?: number;
  taxaPercentual?: number;
  taxa?: number;
  totalComTaxa?: number;
  pago?: number;
  restante?: number;
  chamando: boolean;
}

interface AvaliacaoDTO {
  pendente: ContaPendente | null;
}

type Sacola = Record<number, number>;

// Produto com opções: cada combinação de opções diferente é uma linha da sacola.
interface LinhaOpcoes {
  chave: string;
  produtoId: number;
  opcoes: number[];
  rotulos: string[];
  extra: number;
  quantidade: number;
}

interface LinhaAtual extends LinhaOpcoes {
  produto: ProdutoCliente;
}

const QUANTIDADE_MAXIMA = 20;

const NOME_IDIOMA: Record<Idioma, string> = { pt: 'Português', en: 'English', es: 'Español' };

function chaveDaLinha(produtoId: number, opcoes: number[]): string {
  return `${produtoId}:${[...opcoes].sort((a, b) => a - b).join(',')}`;
}

function lerSacola(chave: string): Sacola {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    if (!bruto) return {};
    const dados = JSON.parse(bruto) as Record<string, unknown>;
    const sacola: Sacola = {};
    for (const [id, quantidade] of Object.entries(dados)) {
      if (/^\d+$/.test(id) && typeof quantidade === 'number' && quantidade > 0) {
        sacola[Number(id)] = Math.min(QUANTIDADE_MAXIMA, Math.floor(quantidade));
      }
    }
    return sacola;
  } catch {
    return {};
  }
}

function lerLinhas(chave: string): LinhaOpcoes[] {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    if (!bruto) return [];
    const dados = JSON.parse(bruto) as unknown;
    if (!Array.isArray(dados)) return [];
    const linhas: LinhaOpcoes[] = [];
    for (const item of dados as Partial<LinhaOpcoes>[]) {
      if (!item || typeof item.produtoId !== 'number' || typeof item.quantidade !== 'number') continue;
      if (!Array.isArray(item.opcoes)) continue;
      const opcoes = item.opcoes.filter((id): id is number => typeof id === 'number');
      const quantidade = Math.min(QUANTIDADE_MAXIMA, Math.floor(item.quantidade));
      if (quantidade < 1) continue;
      linhas.push({
        chave: chaveDaLinha(item.produtoId, opcoes),
        produtoId: item.produtoId,
        opcoes,
        rotulos: [],
        extra: 0,
        quantidade,
      });
    }
    return linhas;
  } catch {
    return [];
  }
}

// Soma em centavos para não acumular erro de ponto flutuante.
function somaEmReais(itens: { valor: number; quantidade: number }[]): number {
  return itens.reduce((soma, i) => soma + Math.round(i.valor * 100) * i.quantidade, 0) / 100;
}

function Quantidade({
  nome,
  valor,
  aoSomar,
  t,
}: {
  nome: string;
  valor: number;
  aoSomar: (delta: number) => void;
  t: Textos;
}) {
  return (
    <div className="mesa-cli-quantidade">
      <button type="button" className="mesa-cli-passo" aria-label={t.tirarUm(nome)} onClick={() => aoSomar(-1)}>
        <Icone nome="menos" tamanho={16} />
      </button>
      <span className="mesa-cli-numero" aria-live="polite">
        {valor}
      </span>
      <button
        type="button"
        className="mesa-cli-passo"
        aria-label={t.adicionarUm(nome)}
        disabled={valor >= QUANTIDADE_MAXIMA}
        onClick={() => aoSomar(1)}
      >
        <Icone nome="somar" tamanho={16} />
      </button>
    </div>
  );
}

export function CardapioDaMesa() {
  const { codigo = '' } = useParams();
  const { plataforma, logoSrc } = usePlataforma();
  const { temaEfetivo, alternar } = useTema();
  // Idioma escolhido pelo cliente (salvo no aparelho). Sem escolha, vale o do navegador.
  const [idiomaEscolhido, setIdiomaEscolhido] = useState<Idioma | null>(() => lerIdiomaSalvo());
  const [idiomaAberto, setIdiomaAberto] = useState(false);
  const idiomaPedido: Idioma = idiomaEscolhido ?? idiomaDoNavegador();
  const cardapio = useDados<CardapioDTO>(
    `/cliente/mesas/${encodeURIComponent(codigo)}?idioma=${idiomaPedido}`,
  );
  const pedidos = useDados<PedidosDTO>(`/cliente/mesas/${encodeURIComponent(codigo)}/pedidos`);
  const avaliacao = useDados<AvaliacaoDTO>(`/cliente/mesas/${encodeURIComponent(codigo)}/avaliacao`);
  // Idioma da tela: o que o servidor usou; antes de carregar, o que foi pedido.
  const idioma: Idioma = normalizarIdioma(cardapio.dados?.idioma) ?? (cardapio.dados ? 'pt' : idiomaPedido);
  const t = textos(idioma);
  const idiomasAtivos = (cardapio.dados?.idiomas ?? [])
    .map((i) => normalizarIdioma(i))
    .filter((i): i is Idioma => i !== null);
  const chaveSacola = `restaurante.sacola.${codigo}`;
  const chaveLinhas = `${chaveSacola}.opcoes`;
  const [sacola, setSacola] = useState<Sacola>(() => lerSacola(chaveSacola));
  const [linhasOpcoes, setLinhasOpcoes] = useState<LinhaOpcoes[]>(() => lerLinhas(chaveLinhas));
  const [aba, setAba] = useState<'cardapio' | 'pedidos'>('cardapio');
  const [categoriaAtiva, setCategoriaAtiva] = useState<number | null>(null);
  const [sacolaAberta, setSacolaAberta] = useState(false);
  // Id do prato com o perfil aberto (o prato é lido da lista para refletir preço e disponibilidade atuais).
  const [pratoAberto, setPratoAberto] = useState<number | null>(null);
  // Opções escolhidas no perfil do prato que está aberto.
  const [escolhidas, setEscolhidas] = useState<number[]>([]);
  // Nesta visita, "Agora não" ou um envio tiram o cartão de avaliação.
  const [avaliacaoEncerrada, setAvaliacaoEncerrada] = useState(false);
  const [nomeCliente, setNomeCliente] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [chamando, setChamando] = useState(false);
  const secoes = useRef(new Map<number, HTMLElement>());

  // Cardápio e pedidos se atualizam sozinhos: item esgotado some e a situação do pedido muda na tela.
  useAtualizacao(pedidos.recarregar, 10000);
  useAtualizacao(cardapio.recarregar, 60000);

  // Tempo real da mesa (sem login): quando o servidor avisa uma mudança, recarrega pedidos e cardápio (no máximo a cada 400 ms).
  useEffect(() => {
    if (!codigo) return;
    const juntado = rajada(() => {
      pedidos.recarregar();
      cardapio.recarregar();
    }, 400);
    const pararDeOuvir = assinarMesa(codigo, () => juntado.disparar());
    return () => {
      pararDeOuvir();
      juntado.cancelar();
    };
  }, [codigo, pedidos.recarregar, cardapio.recarregar]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(chaveSacola, JSON.stringify(sacola));
    } catch {
      // Sem armazenamento, a sacola só vale até recarregar a página.
    }
  }, [sacola, chaveSacola]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(chaveLinhas, JSON.stringify(linhasOpcoes));
    } catch {
      // Sem armazenamento, a sacola só vale até recarregar a página.
    }
  }, [linhasOpcoes, chaveLinhas]);

  useEffect(() => {
    if (pedidos.dados) setChamando(pedidos.dados.chamando);
  }, [pedidos.dados]);

  const produtos = useMemo(
    () => new Map((cardapio.dados?.categorias ?? []).flatMap((c) => c.produtos).map((p) => [p.id, p])),
    [cardapio.dados],
  );

  // Produtos sem opções: só contam o que ainda está no cardápio e disponível.
  const linhasSimples = Object.entries(sacola)
    .map(([id, quantidade]) => ({ produto: produtos.get(Number(id)), quantidade }))
    .filter(
      (l): l is { produto: ProdutoCliente; quantidade: number } =>
        l.produto !== undefined &&
        l.produto.disponivel &&
        l.quantidade > 0 &&
        gruposComOpcoes(l.produto).length === 0,
    );

  // Produtos com opções: o rótulo e o acréscimo vêm do cardápio atual; linha que perdeu uma opção some.
  const linhasComOpcoes: LinhaAtual[] = linhasOpcoes.flatMap((linha) => {
    const produto = produtos.get(linha.produtoId);
    if (!produto?.disponivel) return [];
    const grupos = gruposComOpcoes(produto);
    const todas: OpcaoDoPrato[] = grupos.flatMap((g) => g.opcoes);
    const achadas = linha.opcoes.map((id) => todas.find((o) => o.id === id));
    if (achadas.some((o) => o === undefined)) return [];
    return [
      {
        ...linha,
        produto,
        rotulos: achadas.map((o) => o?.nome ?? ''),
        extra: somaDasOpcoes(grupos, linha.opcoes),
      },
    ];
  });

  const unidades =
    linhasSimples.reduce((soma, l) => soma + l.quantidade, 0) +
    linhasComOpcoes.reduce((soma, l) => soma + l.quantidade, 0);
  const total = somaEmReais([
    ...linhasSimples.map((l) => ({ valor: l.produto.preco, quantidade: l.quantidade })),
    ...linhasComOpcoes.map((l) => ({ valor: l.produto.preco + l.extra, quantidade: l.quantidade })),
  ]);

  function naSacolaDe(produtoId: number): number {
    return linhasComOpcoes.filter((l) => l.produtoId === produtoId).reduce((soma, l) => soma + l.quantidade, 0);
  }

  function somar(produtoId: number, delta: number) {
    setSacola((atual) => {
      const nova = Math.max(0, Math.min(QUANTIDADE_MAXIMA, (atual[produtoId] ?? 0) + delta));
      const copia = { ...atual };
      if (nova === 0) delete copia[produtoId];
      else copia[produtoId] = nova;
      return copia;
    });
  }

  // Com as opções escolhidas: a mesma combinação soma na linha; combinação nova vira outra linha.
  function adicionarComOpcoes(produto: ProdutoCliente, opcoes: number[]) {
    const ids = [...opcoes].sort((a, b) => a - b);
    const chave = chaveDaLinha(produto.id, ids);
    setLinhasOpcoes((atual) => {
      if (atual.some((l) => l.chave === chave)) {
        return atual.map((l) =>
          l.chave === chave ? { ...l, quantidade: Math.min(QUANTIDADE_MAXIMA, l.quantidade + 1) } : l,
        );
      }
      return [...atual, { chave, produtoId: produto.id, opcoes: ids, rotulos: [], extra: 0, quantidade: 1 }];
    });
  }

  function alterarLinha(chave: string, delta: number) {
    setLinhasOpcoes((atual) =>
      atual.flatMap((l) => {
        if (l.chave !== chave) return [l];
        const quantidade = Math.max(0, Math.min(QUANTIDADE_MAXIMA, l.quantidade + delta));
        return quantidade === 0 ? [] : [{ ...l, quantidade }];
      }),
    );
  }

  function abrirPrato(id: number) {
    setEscolhidas([]);
    setPratoAberto(id);
  }

  function irParaCategoria(id: number) {
    setCategoriaAtiva(id);
    secoes.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function trocarAba(nova: 'cardapio' | 'pedidos') {
    setAba(nova);
    if (nova === 'pedidos') avaliacao.recarregar();
  }

  function escolherIdioma(novo: Idioma) {
    setIdiomaEscolhido(novo);
    salvarIdioma(novo);
    setIdiomaAberto(false);
  }

  async function enviarPedido(e: FormEvent) {
    e.preventDefault();
    const itens = [
      ...linhasSimples.map((l) => ({ produtoId: l.produto.id, quantidade: l.quantidade, opcoes: [] as number[] })),
      ...linhasComOpcoes.map((l) => ({ produtoId: l.produto.id, quantidade: l.quantidade, opcoes: l.opcoes })),
    ];
    if (itens.length === 0) return;
    setErro(null);
    setEnviando(true);
    try {
      const pedido = await api.post<PedidoCliente>(`/cliente/mesas/${encodeURIComponent(codigo)}/pedidos`, {
        itens,
        nomeCliente: nomeCliente.trim() || null,
        observacao: observacao.trim() || null,
      });
      setSacola({});
      setLinhasOpcoes([]);
      setObservacao('');
      setSacolaAberta(false);
      setAviso(t.pedidoEnviado(pedido.id));
      setAba('pedidos');
      pedidos.recarregar();
      window.scrollTo({ top: 0 });
    } catch (err) {
      setErro(mensagemErro(err));
      cardapio.recarregar();
    } finally {
      setEnviando(false);
    }
  }

  async function chamarGarcom() {
    setErro(null);
    try {
      await api.post(`/cliente/mesas/${encodeURIComponent(codigo)}/chamar`);
      setChamando(true);
      setAviso(t.garcomAvisadoAviso);
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  const rotuloTema = temaEfetivo === 'escuro' ? t.mudarParaTemaClaro : t.mudarParaTemaEscuro;
  const mesa = cardapio.dados?.mesa;
  const categorias = cardapio.dados?.categorias ?? [];
  const recomendados = (cardapio.dados?.recomendados ?? [])
    .map((id) => produtos.get(id))
    .filter((p): p is ProdutoCliente => Boolean(p?.disponivel));
  const listaPedidos = pedidos.dados?.pedidos ?? [];
  const emAndamento = listaPedidos.filter((p) => p.status !== 'ENTREGUE' && p.status !== 'CANCELADO').length;
  const desconto = pedidos.dados?.desconto ?? 0;
  const mostrarDetalhesConta = (pedidos.dados?.taxa ?? 0) > 0 || desconto > 0;
  const pendenteAvaliacao = avaliacao.dados?.pendente ?? null;
  const mostrarAvaliacao = aba === 'pedidos' && pendenteAvaliacao !== null && !avaliacaoEncerrada;

  const pratoDaFicha = pratoAberto !== null ? produtos.get(pratoAberto) : undefined;
  const pratoComOpcoes = pratoDaFicha ? gruposComOpcoes(pratoDaFicha) : [];
  const pendenteDoPrato = pratoComOpcoes.length > 0 ? grupoPendente(pratoComOpcoes, escolhidas) : null;
  const extraDoPrato = somaDasOpcoes(pratoComOpcoes, escolhidas);

  const idiomaTitulo = `${t.idioma}: ${idioma.toUpperCase()}`;

  return (
    <div className="mesa-cli" lang={idioma}>
      <header className="mesa-cli-topo">
        <div className="mesa-cli-marca">
          <img src={logoSrc} alt="" className="mesa-cli-logo" width={44} height={44} />
          <div className="mesa-cli-marca-texto">
            <strong className="mesa-cli-nome">{plataforma.nome}</strong>
            <span className="mesa-cli-mesa">{mesa ? t.mesaNumero(mesa.numero, mesa.nome) : t.cardapio}</span>
          </div>
        </div>
        <div className="mesa-cli-topo-acoes">
          {cardapio.dados && (
            <button
              type="button"
              className={chamando ? 'mesa-cli-chamar-topo mesa-cli-chamar-topo-avisado' : 'mesa-cli-chamar-topo'}
              disabled={chamando}
              aria-label={chamando ? t.garcomAvisado : t.chamarGarcom}
              onClick={() => void chamarGarcom()}
            >
              <Icone nome={chamando ? 'visto' : 'sino'} tamanho={18} />
              {/* Em tela estreita cabe só o texto curto. */}
              <span className="mesa-cli-chamar-longo">{chamando ? t.garcomAvisado : t.chamarGarcom}</span>
              <span className="mesa-cli-chamar-curto">{chamando ? t.avisadoCurto : t.chamarCurto}</span>
            </button>
          )}
          {idiomasAtivos.length > 1 && (
            <div className="mesa-cli-idioma">
              <button
                type="button"
                className="mesa-cli-idioma-botao"
                aria-label={idiomaTitulo}
                aria-expanded={idiomaAberto}
                title={t.escolherIdioma}
                onClick={() => setIdiomaAberto((aberto) => !aberto)}
              >
                {idioma.toUpperCase()}
              </button>
              {idiomaAberto && (
                <div className="mesa-cli-idioma-opcoes" role="group" aria-label={t.escolherIdioma}>
                  {idiomasAtivos.map((i) => (
                    <button
                      key={i}
                      type="button"
                      className="mesa-cli-idioma-opcao"
                      aria-pressed={i === idioma}
                      onClick={() => escolherIdioma(i)}
                    >
                      {NOME_IDIOMA[i]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="button" className="mesa-cli-redondo" aria-label={rotuloTema} title={rotuloTema} onClick={() => alternar()}>
            <Icone nome={temaEfetivo === 'escuro' ? 'sol' : 'lua'} tamanho={20} />
          </button>
        </div>
      </header>

      {cardapio.carregando && !cardapio.dados && <Carregando />}

      {cardapio.erro && !cardapio.dados && (
        <main className="mesa-cli-corpo">
          <section className="cartao mesa-cli-vazio">
            <Icone nome="mesas" tamanho={40} />
            <h1>{t.naoEncontrada}</h1>
            <p>{t.naoEncontradaTexto}</p>
          </section>
        </main>
      )}

      {cardapio.dados && (
        <>
          <nav className="mesa-cli-abas" aria-label={t.secoes}>
            <button
              type="button"
              className={aba === 'cardapio' ? 'mesa-cli-aba mesa-cli-aba-ativa' : 'mesa-cli-aba'}
              aria-pressed={aba === 'cardapio'}
              onClick={() => trocarAba('cardapio')}
            >
              <Icone nome="cardapio" tamanho={18} />
              {t.abaCardapio}
            </button>
            <button
              type="button"
              className={aba === 'pedidos' ? 'mesa-cli-aba mesa-cli-aba-ativa' : 'mesa-cli-aba'}
              aria-pressed={aba === 'pedidos'}
              onClick={() => trocarAba('pedidos')}
            >
              <Icone nome="pedidos" tamanho={18} />
              {t.abaPedidos}
              {emAndamento > 0 && <span className="mesa-cli-contador">{emAndamento}</span>}
            </button>
          </nav>

          <main className="mesa-cli-corpo">
            {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
            {erro && !sacolaAberta && <Aviso tipo="erro">{erro}</Aviso>}

            {aba === 'cardapio' && (
              <>
                {categorias.length === 0 && (
                  <section className="cartao mesa-cli-vazio">
                    <Icone nome="cardapio" tamanho={40} />
                    <h1>{t.cardapioEmPreparo}</h1>
                    <p>{t.cardapioVazio}</p>
                  </section>
                )}

                {recomendados.length > 0 && (
                  <section className="mesa-cli-recomendados" aria-label={t.recomendados}>
                    <h2 className="mesa-cli-secao-titulo">
                      <Icone nome="estrela" tamanho={18} />
                      {cardapio.dados.origemRecomendados === 'CASA' ? t.recomendadosCasa : t.maisPedidos}
                    </h2>
                    <FaixaRolavel rotulo={t.recomendados} dica={t.arrastarParaVerMais}>
                      {recomendados.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="mesa-cli-recomendado"
                          aria-label={`${t.verDetalhes(p.nome)}, ${formatarMoeda(p.preco)}`}
                          onClick={() => abrirPrato(p.id)}
                        >
                          {p.imagem ? (
                            <img className="mesa-cli-recomendado-foto" src={p.imagem} alt="" loading="lazy" />
                          ) : (
                            <span className="mesa-cli-recomendado-foto mesa-cli-recomendado-sem-foto">
                              <Icone nome="cardapio" tamanho={28} />
                            </span>
                          )}
                          <span className="mesa-cli-recomendado-nome">{p.nome}</span>
                          <PrecoDoPrato
                            preco={p.preco}
                            precoOriginal={p.precoOriginal}
                            promocao={p.promocao}
                            idioma={idioma}
                            classe="mesa-cli-recomendado-preco"
                          />
                        </button>
                      ))}
                    </FaixaRolavel>
                  </section>
                )}

                {categorias.length > 1 && (
                  <div className="mesa-cli-categorias" role="group" aria-label={t.categorias}>
                    {categorias.map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        className="mesa-cli-categoria"
                        aria-pressed={categoriaAtiva === null ? i === 0 : categoriaAtiva === c.id}
                        onClick={() => irParaCategoria(c.id)}
                      >
                        {c.nome}
                      </button>
                    ))}
                  </div>
                )}

                {categorias.map((c) => (
                  <section
                    key={c.id}
                    className="mesa-cli-secao"
                    ref={(el) => {
                      if (el) secoes.current.set(c.id, el);
                      else secoes.current.delete(c.id);
                    }}
                  >
                    <h2 className="mesa-cli-secao-titulo">{c.nome}</h2>
                    <div className="mesa-cli-produtos">
                      {c.produtos.map((p) => {
                        const comOpcoes = gruposComOpcoes(p).length > 0;
                        const quantidade = sacola[p.id] ?? 0;
                        const naSacola = naSacolaDe(p.id);
                        return (
                          <article key={p.id} className={p.disponivel ? 'mesa-cli-produto' : 'mesa-cli-produto mesa-cli-esgotado'}>
                            <div className="mesa-cli-produto-texto">
                              <h3 className="mesa-cli-produto-nome">
                                <button
                                  type="button"
                                  className="mesa-cli-abrir"
                                  aria-label={t.verDetalhes(p.nome)}
                                  onClick={() => abrirPrato(p.id)}
                                >
                                  {p.nome}
                                </button>
                              </h3>
                              {p.combo && <Selo cor="azul">{t.combo}</Selo>}
                              {p.descricao && <p className="mesa-cli-produto-descricao">{p.descricao}</p>}
                              <span className="mesa-cli-ver" aria-hidden="true">
                                {t.verIngredientes}
                              </span>
                              <div className="mesa-cli-produto-base">
                                <PrecoDoPrato
                                  preco={p.preco}
                                  precoOriginal={p.precoOriginal}
                                  promocao={p.promocao}
                                  idioma={idioma}
                                  classe="mesa-cli-preco"
                                />
                                {!p.disponivel ? (
                                  <Selo cor="amarelo">{t.esgotado}</Selo>
                                ) : comOpcoes ? (
                                  <span className="mesa-cli-acao-opcoes">
                                    {naSacola > 0 && <span className="mesa-cli-na-sacola">{t.naSacola(naSacola)}</span>}
                                    <button
                                      type="button"
                                      className="mesa-cli-adicionar"
                                      aria-label={t.adicionarNome(p.nome)}
                                      onClick={() => abrirPrato(p.id)}
                                    >
                                      <Icone nome="somar" tamanho={16} />
                                      {t.adicionar}
                                    </button>
                                  </span>
                                ) : quantidade === 0 ? (
                                  <button
                                    type="button"
                                    className="mesa-cli-adicionar"
                                    aria-label={t.adicionarNome(p.nome)}
                                    onClick={() => somar(p.id, 1)}
                                  >
                                    <Icone nome="somar" tamanho={16} />
                                    {t.adicionar}
                                  </button>
                                ) : (
                                  <Quantidade nome={p.nome} valor={quantidade} aoSomar={(d) => somar(p.id, d)} t={t} />
                                )}
                              </div>
                            </div>
                            {p.imagem && <img className="mesa-cli-foto" src={p.imagem} alt="" loading="lazy" />}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </>
            )}

            {aba === 'pedidos' && (
              <>
                {mostrarAvaliacao && (
                  <Avaliar
                    codigo={codigo}
                    idioma={idioma}
                    aoEnviar={() => {
                      setAvaliacaoEncerrada(true);
                      setAviso(t.obrigadoAvaliacao);
                    }}
                    aoAdiar={() => setAvaliacaoEncerrada(true)}
                  />
                )}
                {pedidos.erro && <Aviso tipo="erro">{pedidos.erro}</Aviso>}
                {pedidos.carregando && !pedidos.dados && <Carregando />}
                {pedidos.dados && listaPedidos.length === 0 && (
                  <section className="cartao mesa-cli-vazio">
                    <Icone nome="pedidos" tamanho={40} />
                    <h1>{t.semPedidos}</h1>
                    <p>{t.semPedidosTexto}</p>
                    <Botao aoClicar={() => trocarAba('cardapio')}>{t.verCardapio}</Botao>
                  </section>
                )}
                {listaPedidos.map((p) => (
                  <article className="cartao mesa-cli-pedido" key={p.id}>
                    <div className="mesa-cli-pedido-topo">
                      <div>
                        <strong>{t.pedidoNumero(p.id)}</strong>
                        <span className="mesa-cli-pedido-meta">
                          {horaCurta(p.criadoEm)}
                          {p.nomeCliente ? ` · ${p.nomeCliente}` : ''}
                        </span>
                      </div>
                      <Selo cor={STATUS_PEDIDO[p.status].cor}>{t.statusRotulo[p.status]}</Selo>
                    </div>
                    <p className="mesa-cli-pedido-frase">{t.statusFrase[p.status]}</p>
                    <ul className="mesa-cli-pedido-itens">
                      {p.itens.map((item, i) => (
                        <li key={i}>
                          <span>
                            <strong>{item.quantidade}x</strong> {item.nomeProduto}
                            {item.opcoes && item.opcoes.length > 0 && (
                              <span className="mesa-cli-pedido-opcoes">
                                {item.opcoes.map((o) => `${o.grupo}: ${o.opcao}`).join(' · ')}
                              </span>
                            )}
                          </span>
                          <span>{formatarMoeda(item.precoUnitario * item.quantidade)}</span>
                        </li>
                      ))}
                    </ul>
                    {p.observacao && <p className="mesa-cli-pedido-nota">{p.observacao}</p>}
                    <div className="mesa-cli-pedido-total">
                      <span>{t.totalDoPedido}</span>
                      <strong>{formatarMoeda(p.total)}</strong>
                    </div>
                  </article>
                ))}
                {pedidos.dados && listaPedidos.length > 0 && (
                  <div className="mesa-cli-conta-bloco">
                    {mostrarDetalhesConta && (
                      <>
                        <div className="mesa-cli-conta-linha">
                          <span>{t.pedidos}</span>
                          <span>{formatarMoeda(pedidos.dados.total)}</span>
                        </div>
                        {desconto > 0 && (
                          <div className="mesa-cli-conta-linha">
                            <span>{t.desconto(formatarMoeda(desconto))}</span>
                          </div>
                        )}
                        {(pedidos.dados.taxa ?? 0) > 0 && (
                          <div className="mesa-cli-conta-linha">
                            <span>{t.taxaServico(pedidos.dados.taxaPercentual)}</span>
                            <span>{formatarMoeda(pedidos.dados.taxa ?? 0)}</span>
                          </div>
                        )}
                      </>
                    )}
                    {(pedidos.dados.pago ?? 0) > 0 && (
                      <div className="mesa-cli-conta-linha">
                        <span>{t.jaPago}</span>
                        <span>− {formatarMoeda(pedidos.dados.pago ?? 0)}</span>
                      </div>
                    )}
                    <div className="mesa-cli-conta">
                      <span>{(pedidos.dados.pago ?? 0) > 0 ? t.faltaPagar : t.totalAteAgora}</span>
                      <strong>
                        {formatarMoeda(
                          (pedidos.dados.pago ?? 0) > 0
                            ? (pedidos.dados.restante ?? 0)
                            : (pedidos.dados.totalComTaxa ?? pedidos.dados.total),
                        )}
                      </strong>
                    </div>
                  </div>
                )}
              </>
            )}

            <section className="cartao mesa-cli-chamar">
              <div>
                <strong>{t.precisaAjuda}</strong>
                <p>{chamando ? t.garcomJaAvisado : t.chameGarcomConta}</p>
              </div>
              <Botao variante="secundario" desabilitado={chamando} aoClicar={() => void chamarGarcom()}>
                {chamando ? t.garcomAvisado : t.chamarGarcom}
              </Botao>
            </section>
          </main>

          {unidades > 0 && aba === 'cardapio' && (
            <div className="mesa-cli-barra">
              <button type="button" className="mesa-cli-barra-botao" onClick={() => setSacolaAberta(true)}>
                <span className="mesa-cli-barra-itens">{t.itensNaBarra(unidades)}</span>
                <span>{t.verPedido}</span>
                <span>{formatarMoeda(total)}</span>
              </button>
            </div>
          )}

          {pratoDaFicha &&
            (() => {
              const prato = pratoDaFicha;
              const quantidade = sacola[prato.id] ?? 0;
              const comOpcoes = pratoComOpcoes.length > 0;
              return (
                <PerfilDoPrato
                  prato={prato}
                  idioma={idioma}
                  aoFechar={() => setPratoAberto(null)}
                  escolhidas={comOpcoes ? escolhidas : undefined}
                  aoEscolher={comOpcoes ? setEscolhidas : undefined}
                  rodape={
                    prato.disponivel ? (
                      comOpcoes ? (
                        <Botao
                          desabilitado={pendenteDoPrato !== null}
                          aoClicar={() => {
                            adicionarComOpcoes(prato, escolhidas);
                            setPratoAberto(null);
                          }}
                        >
                          {t.adicionarSacola(formatarMoeda(prato.preco + extraDoPrato))}
                        </Botao>
                      ) : (
                        <>
                          {quantidade > 0 && (
                            <Quantidade nome={prato.nome} valor={quantidade} aoSomar={(d) => somar(prato.id, d)} t={t} />
                          )}
                          <Botao
                            aoClicar={() => {
                              if (quantidade === 0) somar(prato.id, 1);
                              setPratoAberto(null);
                            }}
                          >
                            {quantidade === 0
                              ? t.adicionarAoPedido(formatarMoeda(prato.preco))
                              : t.prontoTotal(formatarMoeda(prato.preco * quantidade))}
                          </Botao>
                        </>
                      )
                    ) : (
                      <Botao variante="secundario" aoClicar={() => setPratoAberto(null)}>
                        {t.voltarCardapio}
                      </Botao>
                    )
                  }
                />
              );
            })()}

          {sacolaAberta && (
            <Modal aberto titulo={t.seuPedido} aoFechar={() => setSacolaAberta(false)}>
              <form onSubmit={enviarPedido}>
                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                {unidades === 0 && <p className="mesa-cli-sacola-vazia">{t.sacolaVazia}</p>}
                <ul className="mesa-cli-sacola">
                  {linhasSimples.map((l) => (
                    <li key={`p${l.produto.id}`}>
                      <div className="mesa-cli-sacola-texto">
                        <span className="mesa-cli-sacola-nome">{l.produto.nome}</span>
                        <span className="mesa-cli-sacola-valor">{formatarMoeda(l.produto.preco * l.quantidade)}</span>
                      </div>
                      <Quantidade nome={l.produto.nome} valor={l.quantidade} aoSomar={(d) => somar(l.produto.id, d)} t={t} />
                    </li>
                  ))}
                  {linhasComOpcoes.map((l) => (
                    <li key={`o${l.chave}`}>
                      <div className="mesa-cli-sacola-texto">
                        <span className="mesa-cli-sacola-nome">{l.produto.nome}</span>
                        {l.rotulos.length > 0 && <span className="mesa-cli-sacola-opcoes">{l.rotulos.join(', ')}</span>}
                        <span className="mesa-cli-sacola-valor">
                          {formatarMoeda((l.produto.preco + l.extra) * l.quantidade)}
                        </span>
                      </div>
                      <Quantidade nome={l.produto.nome} valor={l.quantidade} aoSomar={(d) => alterarLinha(l.chave, d)} t={t} />
                    </li>
                  ))}
                </ul>
                <div className="mesa-cli-conta">
                  <span>{t.total}</span>
                  <strong>{formatarMoeda(total)}</strong>
                </div>
                <Campo rotulo={t.seuNome} valor={nomeCliente} aoMudar={setNomeCliente} />
                <AreaTexto rotulo={t.observacao} valor={observacao} aoMudar={setObservacao} linhas={2} />
                <p className="mesa-cli-nota">{t.pagamentoNota}</p>
                <Botao tipo="submit" desabilitado={enviando || unidades === 0}>
                  {enviando ? t.enviando : t.enviarPedido}
                </Botao>{' '}
                <Botao variante="secundario" aoClicar={() => setSacolaAberta(false)}>
                  {t.continuarEscolhendo}
                </Botao>
              </form>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
