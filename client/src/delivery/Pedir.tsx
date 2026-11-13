import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlataforma } from '../lib/plataforma';
import { useTema } from '../lib/tema';
import { useAtualizacao } from '../lib/useAtualizacao';
import { lerPreco } from '../lib/restaurante';
import { PerfilDoPrato, PrecoDoPrato, gruposComOpcoes, grupoPendente, somaDasOpcoes } from '../cliente/PerfilDoPrato';
import type { OpcaoDoPrato, PratoDoPerfil } from '../cliente/PerfilDoPrato';
import { FaixaRolavel } from '../cliente/FaixaRolavel';
import { idiomaDoNavegador, lerIdiomaSalvo, normalizarIdioma, salvarIdioma, textos } from '../cliente/textos';
import type { Idioma, Textos } from '../cliente/textos';
import { Aviso, Botao, Campo, AreaTexto, Carregando, Modal, Selecao, Selo, formatarMoeda } from '../ui';
import { Icone } from '../ui/icones';
import { textosDelivery } from './textosDelivery';
import type { TextosDelivery } from './textosDelivery';
import '../cliente/cliente.css';
import './delivery.css';

// Pedir para entrega ou retirada: página pública (sem login), irmã do cardápio da mesa.

type TipoPedido = 'DELIVERY' | 'RETIRADA';

interface ProdutoDelivery extends PratoDoPerfil {
  id: number;
  recomendado?: boolean;
}

interface CardapioDelivery {
  aberto: { delivery: boolean; retirada: boolean };
  aviso: string | null;
  pedidoMinimo: number;
  tempos: { delivery: number; retirada: number };
  bairros: { id: number; nome: string; taxa: number }[];
  formasPagamento: string[];
  idiomas?: string[];
  idioma?: string;
  recomendados?: number[];
  origemRecomendados?: 'CASA' | 'MAIS_PEDIDOS';
  categorias: { id: number; nome: string; produtos: ProdutoDelivery[] }[];
}

interface DadosPedido {
  nome: string;
  telefone: string;
  endereco: string;
  complemento: string;
  bairroId: string;
  referencia: string;
  pagamento: string;
  troco: string;
  observacao: string;
}

// Linha da sacola: produto com opções (cada combinação de opções é uma linha).
interface LinhaOpcoes {
  chave: string;
  produtoId: number;
  opcoes: number[];
  rotulos: string[];
  extra: number;
  quantidade: number;
}

interface LinhaAtual extends LinhaOpcoes {
  produto: ProdutoDelivery;
}

type Sacola = Record<number, number>;

const QUANTIDADE_MAXIMA = 20;
const CHAVE_SACOLA = 'restaurante.delivery.sacola';
const CHAVE_DADOS = 'restaurante.delivery.dados';
const DADOS_GUARDADOS = ['nome', 'telefone', 'endereco', 'complemento', 'bairroId', 'referencia'] as const;
const DADOS_VAZIOS: DadosPedido = {
  nome: '',
  telefone: '',
  endereco: '',
  complemento: '',
  bairroId: '',
  referencia: '',
  pagamento: '',
  troco: '',
  observacao: '',
};
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

function lerDadosGuardados(): DadosPedido {
  try {
    const bruto = window.localStorage.getItem(CHAVE_DADOS);
    if (!bruto) return DADOS_VAZIOS;
    const dados = JSON.parse(bruto) as Record<string, unknown>;
    const novo: DadosPedido = { ...DADOS_VAZIOS };
    for (const campo of DADOS_GUARDADOS) {
      const valor = dados[campo];
      if (typeof valor === 'string') novo[campo] = valor;
    }
    return novo;
  } catch {
    return DADOS_VAZIOS;
  }
}

// Só os dados de entrega (não a forma de pagamento nem a observação, que mudam a cada pedido).
function guardarDados(dados: DadosPedido): void {
  try {
    const guardado: Partial<DadosPedido> = {};
    for (const campo of DADOS_GUARDADOS) guardado[campo] = dados[campo];
    window.localStorage.setItem(CHAVE_DADOS, JSON.stringify(guardado));
  } catch {
    // Sem armazenamento, os dados valem só nesta visita.
  }
}

function apagarDados(): void {
  try {
    window.localStorage.removeItem(CHAVE_DADOS);
  } catch {
    // Nada guardado para apagar.
  }
}

// Mensagem que o servidor manda (campo `erro`); sem ela, a frase padrão.
async function erroDaResposta(resposta: Response, padrao: string): Promise<string> {
  try {
    const dados = (await resposta.json()) as { erro?: unknown };
    return typeof dados.erro === 'string' ? dados.erro : padrao;
  } catch {
    return padrao;
  }
}

// Tipo que vale agora: o escolhido, se ainda estiver aberto; senão, o outro (que está aberto).
function escolherTipo(escolhido: TipoPedido, abertoDelivery: boolean, abertoRetirada: boolean): TipoPedido {
  if (escolhido === 'DELIVERY') return abertoDelivery || !abertoRetirada ? 'DELIVERY' : 'RETIRADA';
  return abertoRetirada || !abertoDelivery ? 'RETIRADA' : 'DELIVERY';
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

export function Pedir() {
  const navigate = useNavigate();
  const { plataforma, logoSrc } = usePlataforma();
  const { temaEfetivo, alternar } = useTema();
  // Idioma escolhido no aparelho (o mesmo do cardápio da mesa). Sem escolha, vale o do navegador.
  const [idiomaEscolhido, setIdiomaEscolhido] = useState<Idioma | null>(() => lerIdiomaSalvo());
  const [idiomaAberto, setIdiomaAberto] = useState(false);
  const idiomaPedido: Idioma = idiomaEscolhido ?? idiomaDoNavegador();

  const [cardapio, setCardapio] = useState<CardapioDelivery | null>(null);
  const [carregandoCardapio, setCarregandoCardapio] = useState(true);
  const [erroCardapio, setErroCardapio] = useState<string | null>(null);
  const [versaoCardapio, setVersaoCardapio] = useState(0);
  const recarregarCardapio = useCallback(() => setVersaoCardapio((v) => v + 1), []);

  // Idioma da tela: o que o servidor usou; antes de carregar, o que foi pedido.
  const idioma: Idioma = normalizarIdioma(cardapio?.idioma) ?? idiomaPedido;
  const t = textos(idioma);
  const td: TextosDelivery = textosDelivery(idioma);
  const idiomasAtivos = (cardapio?.idiomas ?? [])
    .map((i) => normalizarIdioma(i))
    .filter((i): i is Idioma => i !== null);

  const [sacola, setSacola] = useState<Sacola>(() => lerSacola(CHAVE_SACOLA));
  const [linhasOpcoes, setLinhasOpcoes] = useState<LinhaOpcoes[]>(() => lerLinhas(`${CHAVE_SACOLA}.opcoes`));
  const [tipo, setTipo] = useState<TipoPedido>('DELIVERY');
  const [passo, setPasso] = useState<'cardapio' | 'dados'>('cardapio');
  const [categoriaAtiva, setCategoriaAtiva] = useState<number | null>(null);
  const [sacolaAberta, setSacolaAberta] = useState(false);
  // Id do prato com o perfil aberto (o prato é lido da lista para refletir preço e disponibilidade atuais).
  const [pratoAberto, setPratoAberto] = useState<number | null>(null);
  const [escolhidas, setEscolhidas] = useState<number[]>([]);
  const [dados, setDados] = useState<DadosPedido>(() => lerDadosGuardados());
  const [lembrar, setLembrar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const secoes = useRef(new Map<number, HTMLElement>());

  useAtualizacao(recarregarCardapio, 60000);

  // Carrega o cardápio de delivery e retirada (de novo quando muda o idioma ou a tela pede).
  useEffect(() => {
    let cancelado = false;
    const padrao = textosDelivery(idiomaPedido).erroConexao;
    setCarregandoCardapio(true);
    setErroCardapio(null);
    fetch(`/api/delivery/cardapio?idioma=${encodeURIComponent(idiomaPedido)}`)
      .then(async (resposta) => {
        if (!resposta.ok) throw new Error(await erroDaResposta(resposta, padrao));
        return (await resposta.json()) as CardapioDelivery;
      })
      .then((dadosCardapio) => {
        if (!cancelado) setCardapio(dadosCardapio);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErroCardapio(e instanceof Error ? e.message : padrao);
      })
      .finally(() => {
        if (!cancelado) setCarregandoCardapio(false);
      });
    return () => {
      cancelado = true;
    };
  }, [idiomaPedido, versaoCardapio]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(CHAVE_SACOLA, JSON.stringify(sacola));
    } catch {
      // Sem armazenamento, a sacola só vale até recarregar a página.
    }
  }, [sacola]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(`${CHAVE_SACOLA}.opcoes`, JSON.stringify(linhasOpcoes));
    } catch {
      // Sem armazenamento, a sacola só vale até recarregar a página.
    }
  }, [linhasOpcoes]);

  useEffect(() => {
    if (lembrar) guardarDados(dados);
    else apagarDados();
  }, [dados, lembrar]);

  const produtos = useMemo(
    () => new Map((cardapio?.categorias ?? []).flatMap((c) => c.produtos).map((p) => [p.id, p] as const)),
    [cardapio],
  );

  // Produtos sem opções: só contam o que ainda está no cardápio e disponível.
  const linhasSimples = Object.entries(sacola)
    .map(([id, quantidade]) => ({ produto: produtos.get(Number(id)), quantidade }))
    .filter(
      (l): l is { produto: ProdutoDelivery; quantidade: number } =>
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
  const subtotal = somaEmReais([
    ...linhasSimples.map((l) => ({ valor: l.produto.preco, quantidade: l.quantidade })),
    ...linhasComOpcoes.map((l) => ({ valor: l.produto.preco + l.extra, quantidade: l.quantidade })),
  ]);

  const abertoDelivery = cardapio?.aberto.delivery ?? false;
  const abertoRetirada = cardapio?.aberto.retirada ?? false;
  // Se a opção escolhida fechou, vale a outra que está aberta.
  const tipoAtual: TipoPedido = escolherTipo(tipo, abertoDelivery, abertoRetirada);
  const bairro = cardapio?.bairros.find((b) => String(b.id) === dados.bairroId);
  const taxaEntrega = tipoAtual === 'DELIVERY' && bairro ? Math.round(bairro.taxa * 100) / 100 : 0;
  const totalEstimado = Math.round((subtotal + taxaEntrega) * 100) / 100;
  const pedidoMinimo = cardapio?.pedidoMinimo ?? 0;
  const minimoAtingido = Math.round(subtotal * 100) >= Math.round(pedidoMinimo * 100);
  const faltaParaMinimo = Math.round((pedidoMinimo - subtotal) * 100) / 100;
  const tempoMin = cardapio ? (tipoAtual === 'DELIVERY' ? cardapio.tempos.delivery : cardapio.tempos.retirada) : 0;

  function somar(produtoId: number, delta: number) {
    setSacola((atual) => {
      const nova = Math.max(0, Math.min(QUANTIDADE_MAXIMA, (atual[produtoId] ?? 0) + delta));
      const copia = { ...atual };
      if (nova === 0) delete copia[produtoId];
      else copia[produtoId] = nova;
      return copia;
    });
  }

  function naSacolaDe(produtoId: number): number {
    return linhasComOpcoes.filter((l) => l.produtoId === produtoId).reduce((soma, l) => soma + l.quantidade, 0);
  }

  // Com as opções escolhidas: a mesma combinação soma na linha; combinação nova vira outra linha.
  function adicionarComOpcoes(produto: ProdutoDelivery, opcoes: number[]) {
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

  function escolherIdioma(novo: Idioma) {
    setIdiomaEscolhido(novo);
    salvarIdioma(novo);
    setIdiomaAberto(false);
  }

  function alterarDado(campo: keyof DadosPedido, valor: string) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  function rotuloPagamento(valor: string): string {
    if (valor === 'Dinheiro') return td.pagamentoDinheiro;
    if (valor === 'Pix') return td.pagamentoPix;
    if (valor === 'Cartão de débito') return td.pagamentoDebito;
    if (valor === 'Cartão de crédito') return td.pagamentoCredito;
    return valor;
  }

  // Primeira falha encontrada, em texto; null quando o pedido pode seguir.
  function validarDados(): string | null {
    if (unidades === 0) return td.pedidoSemItens;
    const nome = dados.nome.trim();
    if (nome.length < 2) return td.informeNome;
    if (nome.length > 60) return td.textoMuitoLongo(td.campoNome, 60);
    const telefone = dados.telefone.replace(/\D/g, '');
    if (!/^\d{10,11}$/.test(telefone)) return td.informeTelefone;
    if (tipoAtual === 'DELIVERY') {
      const endereco = dados.endereco.trim();
      if (endereco.length < 5) return td.informeEndereco;
      if (endereco.length > 120) return td.textoMuitoLongo(td.campoEndereco, 120);
      if (dados.complemento.trim().length > 60) return td.textoMuitoLongo(td.campoComplemento, 60);
      if (!bairro) return td.informeBairro;
      if (dados.referencia.trim().length > 80) return td.textoMuitoLongo(td.campoReferencia, 80);
    }
    if (!dados.pagamento) return td.informePagamento;
    if (dados.pagamento === 'Dinheiro' && dados.troco.trim()) {
      const troco = lerPreco(dados.troco);
      if (troco === null) return td.trocoInvalido;
      if (Math.round(troco * 100) <= Math.round(totalEstimado * 100)) return td.trocoMenorQueTotal;
    }
    if (dados.observacao.trim().length > 300) return td.textoMuitoLongo(td.observacaoLabel, 300);
    if (!minimoAtingido) return td.faltaMinimo(formatarMoeda(faltaParaMinimo));
    return null;
  }

  async function enviarPedido(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const falha = validarDados();
    if (falha) {
      setErro(falha);
      return;
    }
    const itens = [
      ...linhasSimples.map((l) => ({ produtoId: l.produto.id, quantidade: l.quantidade, opcoes: [] as number[] })),
      ...linhasComOpcoes.map((l) => ({ produtoId: l.produto.id, quantidade: l.quantidade, opcoes: l.opcoes })),
    ];
    // Campos vazios não são enviados (o servidor aceita a ausência, não o texto vazio).
    const corpo: Record<string, unknown> = {
      tipo: tipoAtual,
      nome: dados.nome.trim(),
      telefone: dados.telefone.replace(/\D/g, ''),
      formaPagamento: dados.pagamento,
      itens,
    };
    if (tipoAtual === 'DELIVERY') {
      corpo.endereco = dados.endereco.trim();
      corpo.bairroId = Number(dados.bairroId);
      if (dados.complemento.trim()) corpo.complemento = dados.complemento.trim();
      if (dados.referencia.trim()) corpo.referencia = dados.referencia.trim();
    }
    const troco = dados.pagamento === 'Dinheiro' && dados.troco.trim() ? lerPreco(dados.troco) : null;
    if (troco !== null) corpo.trocoPara = troco;
    if (dados.observacao.trim()) corpo.observacao = dados.observacao.trim();

    setErro(null);
    setEnviando(true);
    try {
      const resposta = await fetch('/api/delivery/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (!resposta.ok) throw new Error(await erroDaResposta(resposta, td.erroConexao));
      const pedido = (await resposta.json()) as { codigo: string };
      setSacola({});
      setLinhasOpcoes([]);
      setDados((atual) => ({ ...atual, pagamento: '', troco: '', observacao: '' }));
      navigate(`/pedido/${encodeURIComponent(pedido.codigo)}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : td.erroConexao);
      recarregarCardapio();
    } finally {
      setEnviando(false);
    }
  }

  const pratoDaFicha = pratoAberto !== null ? produtos.get(pratoAberto) : undefined;
  const pratoComOpcoes = pratoDaFicha ? gruposComOpcoes(pratoDaFicha) : [];
  const pendenteDoPrato = pratoComOpcoes.length > 0 ? grupoPendente(pratoComOpcoes, escolhidas) : null;
  const extraDoPrato = somaDasOpcoes(pratoComOpcoes, escolhidas);
  const rotuloTema = temaEfetivo === 'escuro' ? t.mudarParaTemaClaro : t.mudarParaTemaEscuro;
  const idiomaTitulo = `${t.idioma}: ${idioma.toUpperCase()}`;
  const categorias = cardapio?.categorias ?? [];
  const recomendadosIds = cardapio?.recomendados ?? categorias.flatMap((c) => c.produtos).filter((p) => p.recomendado).map((p) => p.id);
  const recomendados = recomendadosIds
    .map((id) => produtos.get(id))
    .filter((p): p is ProdutoDelivery => Boolean(p?.disponivel));
  const fechadoTudo = cardapio !== null && !abertoDelivery && !abertoRetirada;

  return (
    <div className="mesa-cli delivery-pagina" lang={idioma}>
      <header className="mesa-cli-topo">
        <div className="mesa-cli-marca">
          <img src={logoSrc} alt="" className="mesa-cli-logo" width={44} height={44} />
          <div className="mesa-cli-marca-texto">
            <strong className="mesa-cli-nome">{plataforma.nome}</strong>
            <span className="mesa-cli-mesa">{td.subtituloDelivery}</span>
          </div>
        </div>
        <div className="mesa-cli-topo-acoes">
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

      {carregandoCardapio && !cardapio && !erroCardapio && <Carregando />}

      {erroCardapio && !cardapio && (
        <main className="mesa-cli-corpo">
          <section className="cartao mesa-cli-vazio">
            <Icone nome="pedidos" tamanho={40} />
            <Aviso tipo="erro">{erroCardapio}</Aviso>
            <Botao variante="secundario" aoClicar={recarregarCardapio}>
              {td.tentarDeNovo}
            </Botao>
          </section>
        </main>
      )}

      {fechadoTudo && (
        <main className="mesa-cli-corpo">
          <section className="cartao mesa-cli-vazio">
            <Icone nome="relogio" tamanho={40} />
            <h1>{td.fechado}</h1>
            {cardapio?.aviso && <p>{cardapio.aviso}</p>}
          </section>
        </main>
      )}

      {cardapio && !fechadoTudo && (
        <main className="mesa-cli-corpo">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          <section className="cartao delivery-topo" aria-label={td.tituloDelivery}>
            <div className="delivery-tipos" role="group" aria-label={td.tituloDelivery}>
              {abertoDelivery && (
                <button
                  type="button"
                  className="delivery-tipo"
                  aria-pressed={tipoAtual === 'DELIVERY'}
                  onClick={() => setTipo('DELIVERY')}
                >
                  <Icone nome="enviar" tamanho={18} />
                  {td.tipoEntrega}
                </button>
              )}
              {abertoRetirada && (
                <button
                  type="button"
                  className="delivery-tipo"
                  aria-pressed={tipoAtual === 'RETIRADA'}
                  onClick={() => setTipo('RETIRADA')}
                >
                  <Icone nome="pedidos" tamanho={18} />
                  {td.tipoRetirada}
                </button>
              )}
            </div>
            <p className="delivery-tempo">
              <Icone nome="relogio" tamanho={16} />
              {tipoAtual === 'DELIVERY' ? td.tempoEntrega(tempoMin) : td.tempoRetirada(tempoMin)}
            </p>
            {cardapio.aviso && <Aviso tipo="info">{cardapio.aviso}</Aviso>}
            {pedidoMinimo > 0 && <p className="delivery-nota">{td.pedidoMinimoAviso(formatarMoeda(pedidoMinimo))}</p>}
          </section>

          {passo === 'cardapio' && (
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
                    {cardapio.origemRecomendados === 'MAIS_PEDIDOS' ? t.maisPedidos : t.recomendadosCasa}
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

          {passo === 'dados' && (
            <section className="cartao delivery-dados">
              <h2 className="mesa-cli-secao-titulo">{td.etapaDados}</h2>
              {unidades === 0 ? (
                <>
                  <p className="mesa-cli-sacola-vazia">{td.pedidoSemItens}</p>
                  <Botao variante="secundario" aoClicar={() => setPasso('cardapio')}>
                    {td.voltarAoCardapio}
                  </Botao>
                </>
              ) : (
                <form className="delivery-form" onSubmit={enviarPedido} noValidate>
                  <h3 className="delivery-subtitulo">{tipoAtual === 'DELIVERY' ? td.dadosEntrega : td.dadosRetirada}</h3>
                  <div className="delivery-campos">
                    <Campo rotulo={td.campoNome} valor={dados.nome} aoMudar={(v) => alterarDado('nome', v)} />
                    <Campo rotulo={td.campoTelefone} valor={dados.telefone} aoMudar={(v) => alterarDado('telefone', v)} />
                    {tipoAtual === 'DELIVERY' && (
                      <>
                        <Campo rotulo={td.campoEndereco} valor={dados.endereco} aoMudar={(v) => alterarDado('endereco', v)} />
                        <Campo rotulo={td.campoComplemento} valor={dados.complemento} aoMudar={(v) => alterarDado('complemento', v)} />
                        <Selecao
                          rotulo={td.campoBairro}
                          valor={dados.bairroId}
                          aoMudar={(v) => alterarDado('bairroId', v)}
                          vazio={td.escolhaBairro}
                          opcoes={(cardapio.bairros ?? []).map((b) => ({
                            valor: String(b.id),
                            rotulo: td.opcaoBairro(b.nome, formatarMoeda(b.taxa)),
                          }))}
                        />
                        <Campo rotulo={td.campoReferencia} valor={dados.referencia} aoMudar={(v) => alterarDado('referencia', v)} />
                      </>
                    )}
                  </div>

                  <fieldset className="delivery-grupo">
                    <legend className="delivery-legenda">
                      {tipoAtual === 'DELIVERY' ? td.campoPagamentoEntrega : td.campoPagamentoRetirada}
                    </legend>
                    {(cardapio.formasPagamento ?? []).map((forma) => (
                      <label key={forma} className="delivery-opcao">
                        <input
                          type="radio"
                          name="delivery-pagamento"
                          value={forma}
                          checked={dados.pagamento === forma}
                          onChange={() => alterarDado('pagamento', forma)}
                        />
                        <span>{rotuloPagamento(forma)}</span>
                      </label>
                    ))}
                  </fieldset>

                  {dados.pagamento === 'Dinheiro' && (
                    <Campo rotulo={td.campoTroco} valor={dados.troco} aoMudar={(v) => alterarDado('troco', v)} />
                  )}
                  <AreaTexto rotulo={td.campoObservacao} valor={dados.observacao} aoMudar={(v) => alterarDado('observacao', v)} linhas={2} />

                  <label className="delivery-opcao">
                    <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
                    <span>{td.lembrarDados}</span>
                  </label>

                  <section className="delivery-resumo" aria-label={td.resumo}>
                    <h3 className="delivery-subtitulo">{td.resumo}</h3>
                    <ul className="mesa-cli-sacola">
                      {linhasSimples.map((l) => (
                        <li key={`p${l.produto.id}`}>
                          <span>
                            {l.quantidade}x {l.produto.nome}
                          </span>
                          <span>{formatarMoeda(l.produto.preco * l.quantidade)}</span>
                        </li>
                      ))}
                      {linhasComOpcoes.map((l) => (
                        <li key={`o${l.chave}`}>
                          <span>
                            {l.quantidade}x {l.produto.nome}
                            {l.rotulos.length > 0 && <span className="mesa-cli-sacola-opcoes"> · {l.rotulos.join(', ')}</span>}
                          </span>
                          <span>{formatarMoeda((l.produto.preco + l.extra) * l.quantidade)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mesa-cli-conta-linha">
                      <span>{td.subtotal}</span>
                      <span>{formatarMoeda(subtotal)}</span>
                    </div>
                    {tipoAtual === 'DELIVERY' && (
                      <div className="mesa-cli-conta-linha">
                        <span>{td.taxaEntrega}</span>
                        <span>
                          {!bairro ? '—' : taxaEntrega > 0 ? formatarMoeda(taxaEntrega) : td.taxaEntregaGratis}
                        </span>
                      </div>
                    )}
                    <div className="mesa-cli-conta">
                      <span>{t.total}</span>
                      <strong>{formatarMoeda(totalEstimado)}</strong>
                    </div>
                    <p className="delivery-nota">{td.estimativa}</p>
                  </section>

                  <Botao tipo="submit" desabilitado={enviando || !minimoAtingido}>
                    {enviando
                      ? t.enviando
                      : !minimoAtingido
                        ? td.faltaMinimo(formatarMoeda(faltaParaMinimo))
                        : t.enviarPedido}
                  </Botao>
                  <Botao variante="secundario" aoClicar={() => setPasso('cardapio')}>
                    {td.voltarAoCardapio}
                  </Botao>
                </form>
              )}
            </section>
          )}
        </main>
      )}

      {cardapio && !fechadoTudo && passo === 'cardapio' && unidades > 0 && (
        <div className="mesa-cli-barra">
          <button type="button" className="mesa-cli-barra-botao" onClick={() => setSacolaAberta(true)}>
            <span className="mesa-cli-barra-itens">{t.itensNaBarra(unidades)}</span>
            <span>{td.continuar}</span>
            <span>{formatarMoeda(subtotal)}</span>
          </button>
        </div>
      )}

      {pratoDaFicha && (() => {
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
                  <span className="mesa-cli-sacola-valor">{formatarMoeda((l.produto.preco + l.extra) * l.quantidade)}</span>
                </div>
                <Quantidade nome={l.produto.nome} valor={l.quantidade} aoSomar={(d) => alterarLinha(l.chave, d)} t={t} />
              </li>
            ))}
          </ul>
          <div className="mesa-cli-conta">
            <span>{t.total}</span>
            <strong>{formatarMoeda(subtotal)}</strong>
          </div>
          <p className="mesa-cli-nota">{td.estimativa}</p>
          <Botao
            desabilitado={unidades === 0}
            aoClicar={() => {
              setSacolaAberta(false);
              setPasso('dados');
              window.scrollTo({ top: 0 });
            }}
          >
            {td.continuar}
          </Botao>{' '}
          <Botao variante="secundario" aoClicar={() => setSacolaAberta(false)}>
            {t.continuarEscolhendo}
          </Botao>
        </Modal>
      )}
    </div>
  );
}
