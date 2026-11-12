import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { usePlataforma } from '../lib/plataforma';
import { useTema } from '../lib/tema';
import { useDados } from '../lib/useDados';
import { useAtualizacao } from '../lib/useAtualizacao';
import { STATUS_PEDIDO, horaCurta, mensagemErro, nomeDaMesa } from '../lib/restaurante';
import type { StatusPedido } from '../lib/restaurante';
import { AreaTexto, Aviso, Botao, Campo, Carregando, Modal, Selo, formatarMoeda } from '../ui';
import { Icone } from '../ui/icones';
import './cliente.css';

// Cardápio da mesa: página pública que o cliente abre pelo QR code. Sem login.

interface ProdutoCliente {
  id: number;
  nome: string;
  descricao: string;
  preco: number;
  imagem: string | null;
  disponivel: boolean;
}

interface CardapioDTO {
  mesa: { numero: number; nome: string | null; chamando: boolean };
  categorias: { id: number; nome: string; produtos: ProdutoCliente[] }[];
}

interface PedidoCliente {
  id: number;
  status: StatusPedido;
  nomeCliente: string | null;
  observacao: string | null;
  total: number;
  criadoEm: string;
  itens: { nomeProduto: string; precoUnitario: number; quantidade: number; observacao: string | null }[];
}

interface PedidosDTO {
  pedidos: PedidoCliente[];
  total: number;
  chamando: boolean;
}

type Sacola = Record<number, number>;

const QUANTIDADE_MAXIMA = 20;

// O que cada situação quer dizer para quem está na mesa.
const FRASE_STATUS: Record<StatusPedido, string> = {
  NOVO: 'Recebido pelo restaurante',
  EM_PREPARO: 'Sendo preparado',
  PRONTO: 'Pronto, a caminho da mesa',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

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

function Quantidade({
  nome,
  valor,
  aoSomar,
}: {
  nome: string;
  valor: number;
  aoSomar: (delta: number) => void;
}) {
  return (
    <div className="mesa-cli-quantidade">
      <button type="button" className="mesa-cli-passo" aria-label={`Tirar um ${nome}`} onClick={() => aoSomar(-1)}>
        <Icone nome="menos" tamanho={16} />
      </button>
      <span className="mesa-cli-numero" aria-live="polite">
        {valor}
      </span>
      <button
        type="button"
        className="mesa-cli-passo"
        aria-label={`Adicionar um ${nome}`}
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
  const cardapio = useDados<CardapioDTO>(`/cliente/mesas/${encodeURIComponent(codigo)}`);
  const pedidos = useDados<PedidosDTO>(`/cliente/mesas/${encodeURIComponent(codigo)}/pedidos`);
  const chaveSacola = `restaurante.sacola.${codigo}`;
  const [sacola, setSacola] = useState<Sacola>(() => lerSacola(chaveSacola));
  const [aba, setAba] = useState<'cardapio' | 'pedidos'>('cardapio');
  const [categoriaAtiva, setCategoriaAtiva] = useState<number | null>(null);
  const [sacolaAberta, setSacolaAberta] = useState(false);
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

  useEffect(() => {
    try {
      window.sessionStorage.setItem(chaveSacola, JSON.stringify(sacola));
    } catch {
      // Sem armazenamento, a sacola só vale até recarregar a página.
    }
  }, [sacola, chaveSacola]);

  useEffect(() => {
    if (pedidos.dados) setChamando(pedidos.dados.chamando);
  }, [pedidos.dados]);

  const produtos = useMemo(
    () => new Map((cardapio.dados?.categorias ?? []).flatMap((c) => c.produtos).map((p) => [p.id, p])),
    [cardapio.dados],
  );

  // Só conta o que ainda está no cardápio e disponível.
  const linhas = Object.entries(sacola)
    .map(([id, quantidade]) => ({ produto: produtos.get(Number(id)), quantidade }))
    .filter((l): l is { produto: ProdutoCliente; quantidade: number } => Boolean(l.produto?.disponivel) && l.quantidade > 0);
  const unidades = linhas.reduce((soma, l) => soma + l.quantidade, 0);
  const total = linhas.reduce((soma, l) => soma + l.produto.preco * l.quantidade, 0);

  function somar(produtoId: number, delta: number) {
    setSacola((atual) => {
      const nova = Math.max(0, Math.min(QUANTIDADE_MAXIMA, (atual[produtoId] ?? 0) + delta));
      const copia = { ...atual };
      if (nova === 0) delete copia[produtoId];
      else copia[produtoId] = nova;
      return copia;
    });
  }

  function irParaCategoria(id: number) {
    setCategoriaAtiva(id);
    secoes.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function enviarPedido(e: FormEvent) {
    e.preventDefault();
    if (linhas.length === 0) return;
    setErro(null);
    setEnviando(true);
    try {
      const pedido = await api.post<PedidoCliente>(`/cliente/mesas/${encodeURIComponent(codigo)}/pedidos`, {
        itens: linhas.map((l) => ({ produtoId: l.produto.id, quantidade: l.quantidade })),
        nomeCliente: nomeCliente.trim() || null,
        observacao: observacao.trim() || null,
      });
      setSacola({});
      setObservacao('');
      setSacolaAberta(false);
      setAviso(`Pedido #${pedido.id} enviado. Acompanhe por aqui.`);
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
      setAviso('O garçom foi avisado e já vem até a mesa.');
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  const rotuloTema = `Mudar para o tema ${temaEfetivo === 'escuro' ? 'claro' : 'escuro'}`;
  const mesa = cardapio.dados?.mesa;
  const categorias = cardapio.dados?.categorias ?? [];
  const listaPedidos = pedidos.dados?.pedidos ?? [];
  const emAndamento = listaPedidos.filter((p) => p.status !== 'ENTREGUE' && p.status !== 'CANCELADO').length;

  return (
    <div className="mesa-cli">
      <header className="mesa-cli-topo">
        <div className="mesa-cli-marca">
          <img src={logoSrc} alt="" className="mesa-cli-logo" width={44} height={44} />
          <div className="mesa-cli-marca-texto">
            <strong className="mesa-cli-nome">{plataforma.nome}</strong>
            <span className="mesa-cli-mesa">{mesa ? nomeDaMesa(mesa) : 'Cardápio'}</span>
          </div>
        </div>
        <button type="button" className="mesa-cli-redondo" aria-label={rotuloTema} title={rotuloTema} onClick={() => alternar()}>
          <Icone nome={temaEfetivo === 'escuro' ? 'sol' : 'lua'} tamanho={20} />
        </button>
      </header>

      {cardapio.carregando && !cardapio.dados && <Carregando />}

      {cardapio.erro && !cardapio.dados && (
        <main className="mesa-cli-corpo">
          <section className="cartao mesa-cli-vazio">
            <Icone nome="mesas" tamanho={40} />
            <h1>Não encontramos esta mesa</h1>
            <p>O QR code pode ter sido trocado. Peça ajuda ao garçom para abrir o cardápio.</p>
          </section>
        </main>
      )}

      {cardapio.dados && (
        <>
          <nav className="mesa-cli-abas" aria-label="Seções">
            <button
              type="button"
              className={aba === 'cardapio' ? 'mesa-cli-aba mesa-cli-aba-ativa' : 'mesa-cli-aba'}
              aria-pressed={aba === 'cardapio'}
              onClick={() => setAba('cardapio')}
            >
              <Icone nome="cardapio" tamanho={18} />
              Cardápio
            </button>
            <button
              type="button"
              className={aba === 'pedidos' ? 'mesa-cli-aba mesa-cli-aba-ativa' : 'mesa-cli-aba'}
              aria-pressed={aba === 'pedidos'}
              onClick={() => setAba('pedidos')}
            >
              <Icone nome="pedidos" tamanho={18} />
              Meus pedidos
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
                    <h1>Cardápio em preparo</h1>
                    <p>Ainda não há itens no cardápio. Chame o garçom para fazer o pedido.</p>
                  </section>
                )}

                {categorias.length > 1 && (
                  <div className="mesa-cli-categorias" role="group" aria-label="Categorias">
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
                        const quantidade = sacola[p.id] ?? 0;
                        return (
                          <article key={p.id} className={p.disponivel ? 'mesa-cli-produto' : 'mesa-cli-produto mesa-cli-esgotado'}>
                            <div className="mesa-cli-produto-texto">
                              <h3 className="mesa-cli-produto-nome">{p.nome}</h3>
                              {p.descricao && <p className="mesa-cli-produto-descricao">{p.descricao}</p>}
                              <div className="mesa-cli-produto-base">
                                <span className="mesa-cli-preco">{formatarMoeda(p.preco)}</span>
                                {!p.disponivel ? (
                                  <Selo cor="amarelo">Esgotado</Selo>
                                ) : quantidade === 0 ? (
                                  <button
                                    type="button"
                                    className="mesa-cli-adicionar"
                                    aria-label={`Adicionar ${p.nome}`}
                                    onClick={() => somar(p.id, 1)}
                                  >
                                    <Icone nome="somar" tamanho={16} />
                                    Adicionar
                                  </button>
                                ) : (
                                  <Quantidade nome={p.nome} valor={quantidade} aoSomar={(d) => somar(p.id, d)} />
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
                {pedidos.erro && <Aviso tipo="erro">{pedidos.erro}</Aviso>}
                {pedidos.carregando && !pedidos.dados && <Carregando />}
                {pedidos.dados && listaPedidos.length === 0 && (
                  <section className="cartao mesa-cli-vazio">
                    <Icone nome="pedidos" tamanho={40} />
                    <h1>Nenhum pedido ainda</h1>
                    <p>Escolha os itens no cardápio e envie o pedido. Ele aparece aqui.</p>
                    <Botao aoClicar={() => setAba('cardapio')}>Ver cardápio</Botao>
                  </section>
                )}
                {listaPedidos.map((p) => (
                  <article className="cartao mesa-cli-pedido" key={p.id}>
                    <div className="mesa-cli-pedido-topo">
                      <div>
                        <strong>Pedido #{p.id}</strong>
                        <span className="mesa-cli-pedido-meta">
                          {horaCurta(p.criadoEm)}
                          {p.nomeCliente ? ` · ${p.nomeCliente}` : ''}
                        </span>
                      </div>
                      <Selo cor={STATUS_PEDIDO[p.status].cor}>{STATUS_PEDIDO[p.status].rotulo}</Selo>
                    </div>
                    <p className="mesa-cli-pedido-frase">{FRASE_STATUS[p.status]}</p>
                    <ul className="mesa-cli-pedido-itens">
                      {p.itens.map((item, i) => (
                        <li key={i}>
                          <span>
                            <strong>{item.quantidade}x</strong> {item.nomeProduto}
                          </span>
                          <span>{formatarMoeda(item.precoUnitario * item.quantidade)}</span>
                        </li>
                      ))}
                    </ul>
                    {p.observacao && <p className="mesa-cli-pedido-nota">{p.observacao}</p>}
                    <div className="mesa-cli-pedido-total">
                      <span>Total do pedido</span>
                      <strong>{formatarMoeda(p.total)}</strong>
                    </div>
                  </article>
                ))}
                {pedidos.dados && listaPedidos.length > 0 && (
                  <div className="mesa-cli-conta">
                    <span>Total da mesa até agora</span>
                    <strong>{formatarMoeda(pedidos.dados.total)}</strong>
                  </div>
                )}
              </>
            )}

            <section className="cartao mesa-cli-chamar">
              <div>
                <strong>Precisa de ajuda?</strong>
                <p>
                  {chamando
                    ? 'O garçom já foi avisado e vem até a mesa.'
                    : 'Chame o garçom para tirar dúvidas ou pedir a conta.'}
                </p>
              </div>
              <Botao variante="secundario" desabilitado={chamando} aoClicar={() => void chamarGarcom()}>
                {chamando ? 'Garçom avisado' : 'Chamar garçom'}
              </Botao>
            </section>
          </main>

          {unidades > 0 && aba === 'cardapio' && (
            <div className="mesa-cli-barra">
              <button type="button" className="mesa-cli-barra-botao" onClick={() => setSacolaAberta(true)}>
                <span className="mesa-cli-barra-itens">
                  {unidades} {unidades === 1 ? 'item' : 'itens'}
                </span>
                <span>Ver pedido</span>
                <span>{formatarMoeda(total)}</span>
              </button>
            </div>
          )}

          {sacolaAberta && (
            <Modal aberto titulo="Seu pedido" aoFechar={() => setSacolaAberta(false)}>
              <form onSubmit={enviarPedido}>
                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                {linhas.length === 0 && <p className="mesa-cli-sacola-vazia">Sua sacola está vazia.</p>}
                <ul className="mesa-cli-sacola">
                  {linhas.map((l) => (
                    <li key={l.produto.id}>
                      <div className="mesa-cli-sacola-texto">
                        <span className="mesa-cli-sacola-nome">{l.produto.nome}</span>
                        <span className="mesa-cli-sacola-valor">{formatarMoeda(l.produto.preco * l.quantidade)}</span>
                      </div>
                      <Quantidade nome={l.produto.nome} valor={l.quantidade} aoSomar={(d) => somar(l.produto.id, d)} />
                    </li>
                  ))}
                </ul>
                <div className="mesa-cli-conta">
                  <span>Total</span>
                  <strong>{formatarMoeda(total)}</strong>
                </div>
                <Campo rotulo="Seu nome (opcional)" valor={nomeCliente} aoMudar={setNomeCliente} />
                <AreaTexto
                  rotulo="Observação (opcional): ponto da carne, sem cebola..."
                  valor={observacao}
                  aoMudar={setObservacao}
                  linhas={2}
                />
                <p className="mesa-cli-nota">O pagamento é feito com o garçom, ao fechar a conta.</p>
                <Botao tipo="submit" desabilitado={enviando || linhas.length === 0}>
                  {enviando ? 'Enviando...' : 'Enviar pedido'}
                </Botao>{' '}
                <Botao variante="secundario" aoClicar={() => setSacolaAberta(false)}>
                  Continuar escolhendo
                </Botao>
              </form>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
