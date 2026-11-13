import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePlataforma } from '../lib/plataforma';
import { Aviso, Botao, Carregando, formatarMoeda } from '../ui';
import { Icone } from '../ui/icones';
import { idiomaDoNavegador, lerIdiomaSalvo, textos } from '../cliente/textos';
import type { Idioma } from '../cliente/textos';
import { textosDelivery } from './textosDelivery';
import type { TextosDelivery } from './textosDelivery';
import '../cliente/cliente.css';
import './delivery.css';

// Acompanhamento de um pedido de delivery ou retirada: página pública, atualiza sozinha.

type Situacao = 'RECEBIDO' | 'EM_PREPARO' | 'PRONTO' | 'SAIU' | 'CONCLUIDO' | 'CANCELADO';

interface OpcaoAcompanhada {
  grupo: string;
  opcao: string;
  precoExtra?: number;
}

interface Acompanhamento {
  tipo: 'DELIVERY' | 'RETIRADA';
  situacao: Situacao;
  nomeCliente: string | null;
  criadoEm: string;
  tempoMin: number;
  itens: {
    nomeProduto: string;
    quantidade: number;
    precoUnitario: number;
    opcoes?: OpcaoAcompanhada[];
  }[];
  subtotal: number;
  taxaEntrega: number;
  desconto: number;
  total: number;
  formaPagamento: string | null;
  trocoPara: number | null;
  bairro: string | null;
}

interface Etapa {
  chave: Situacao;
  rotulo: string;
}

// Ordem das situações: a etapa atual é a última cuja ordem não passa da situação do pedido.
const ORDEM: Record<Situacao, number> = { RECEBIDO: 0, EM_PREPARO: 1, PRONTO: 2, SAIU: 3, CONCLUIDO: 4, CANCELADO: -1 };
const INTERVALO_MS = 15000;

function etapasDo(tipo: 'DELIVERY' | 'RETIRADA', td: TextosDelivery): Etapa[] {
  if (tipo === 'DELIVERY') {
    return [
      { chave: 'RECEBIDO', rotulo: td.etapasEntrega.recebido },
      { chave: 'EM_PREPARO', rotulo: td.etapasEntrega.emPreparo },
      { chave: 'PRONTO', rotulo: td.etapasEntrega.pronto },
      { chave: 'SAIU', rotulo: td.etapasEntrega.saiu },
      { chave: 'CONCLUIDO', rotulo: td.etapasEntrega.concluido },
    ];
  }
  return [
    { chave: 'RECEBIDO', rotulo: td.etapasRetirada.recebido },
    { chave: 'EM_PREPARO', rotulo: td.etapasRetirada.emPreparo },
    { chave: 'PRONTO', rotulo: td.etapasRetirada.pronto },
    { chave: 'CONCLUIDO', rotulo: td.etapasRetirada.concluido },
  ];
}

function fraseDaSituacao(pedido: Acompanhamento, td: TextosDelivery): string {
  const entrega = pedido.tipo === 'DELIVERY';
  switch (pedido.situacao) {
    case 'RECEBIDO':
      return td.situacaoRecebido;
    case 'EM_PREPARO':
      return td.situacaoEmPreparo;
    case 'PRONTO':
      return entrega ? td.situacaoProntoEntrega : td.situacaoProntoRetirada;
    case 'SAIU':
      return td.situacaoSaiu;
    case 'CONCLUIDO':
      return entrega ? td.situacaoConcluidoEntrega : td.situacaoConcluidoRetirada;
    case 'CANCELADO':
      return td.cancelado;
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

export function Acompanhar() {
  const { codigo = '' } = useParams();
  const { plataforma, logoSrc } = usePlataforma();
  // Idioma escolhido no aparelho (o mesmo do cardápio). Sem escolha, vale o do navegador.
  const [idiomaEscolhido] = useState<Idioma | null>(() => lerIdiomaSalvo());
  const idioma: Idioma = idiomaEscolhido ?? idiomaDoNavegador();
  const t = textos(idioma);
  const td = textosDelivery(idioma);

  const [pedido, setPedido] = useState<Acompanhamento | null>(null);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copia, setCopia] = useState<string | null>(null);
  const finalizado = pedido !== null && (pedido.situacao === 'CONCLUIDO' || pedido.situacao === 'CANCELADO');

  // Atualiza a cada 15 s enquanto o pedido não foi concluído nem cancelado; pausa com a aba escondida.
  useEffect(() => {
    if (!codigo || finalizado) return;
    const textoPadrao = textosDelivery(idioma).erroConexao;
    let cancelado = false;
    let intervalo: number | null = null;

    async function carregar() {
      try {
        const resposta = await fetch(`/api/delivery/acompanhar/${encodeURIComponent(codigo)}`);
        if (cancelado) return;
        if (resposta.status === 404) {
          setNaoEncontrado(true);
          return;
        }
        if (!resposta.ok) {
          setErro(await erroDaResposta(resposta, textoPadrao));
          return;
        }
        const dados = (await resposta.json()) as Acompanhamento;
        if (cancelado) return;
        setNaoEncontrado(false);
        setErro(null);
        setPedido(dados);
      } catch {
        if (!cancelado) setErro(textoPadrao);
      }
    }

    function parar() {
      if (intervalo !== null) {
        window.clearInterval(intervalo);
        intervalo = null;
      }
    }

    function iniciar() {
      parar();
      intervalo = window.setInterval(() => {
        void carregar();
      }, INTERVALO_MS);
    }

    function aoMudarVisibilidade() {
      if (document.visibilityState === 'visible') {
        void carregar();
        iniciar();
      } else {
        parar();
      }
    }

    void carregar();
    if (document.visibilityState === 'visible') iniciar();
    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    return () => {
      cancelado = true;
      parar();
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [codigo, finalizado, idioma]);

  async function copiarEndereco() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopia(td.enderecoCopiado);
    } catch {
      setCopia(td.enderecoNaoCopiado);
    }
  }

  const etapas = pedido ? etapasDo(pedido.tipo, td) : [];
  const atual = pedido
    ? etapas.reduce((indice, etapa, i) => (ORDEM[etapa.chave] <= ORDEM[pedido.situacao] ? i : indice), -1)
    : -1;
  const emAndamento = pedido !== null && !finalizado;

  return (
    <div className="mesa-cli delivery-pagina" lang={idioma}>
      <header className="mesa-cli-topo">
        <div className="mesa-cli-marca">
          <img src={logoSrc} alt="" className="mesa-cli-logo" width={44} height={44} />
          <div className="mesa-cli-marca-texto">
            <strong className="mesa-cli-nome">{plataforma.nome}</strong>
            <span className="mesa-cli-mesa">{td.tituloAcompanhar}</span>
          </div>
        </div>
      </header>

      <main className="mesa-cli-corpo">
        {!pedido && !naoEncontrado && !erro && <Carregando />}

        {naoEncontrado && (
          <section className="cartao mesa-cli-vazio">
            <Icone nome="pedidos" tamanho={40} />
            <h1>{td.naoEncontrado}</h1>
            <p>{td.naoEncontradoTexto}</p>
            <Link className="botao botao-primario" to="/pedir">
              {td.fazerPedido}
            </Link>
          </section>
        )}

        {erro && !naoEncontrado && <Aviso tipo="erro">{erro}</Aviso>}

        {pedido && (
          <>
            <section className="cartao delivery-status">
              <span className="mesa-cli-pedido-meta">
                {td.pedidoNumeroCodigo(codigo)} · {td.tipoDoPedido(pedido.tipo)}
              </span>
              {pedido.nomeCliente && <p className="delivery-saudacao">{td.primeiroNome(pedido.nomeCliente)}</p>}
              <h1 className="delivery-frase">{fraseDaSituacao(pedido, td)}</h1>
              {emAndamento && (
                <p className="delivery-tempo">
                  <Icone nome="relogio" tamanho={16} />
                  {td.tempoEstimado(pedido.tempoMin)}
                </p>
              )}
              {pedido.situacao === 'CANCELADO' && <Aviso tipo="erro">{td.canceladoTexto}</Aviso>}
              {emAndamento && <p className="delivery-nota">{td.atualizando}</p>}
            </section>

            {pedido.situacao !== 'CANCELADO' && (
              <section className="cartao">
                <h2 className="mesa-cli-secao-titulo">{td.linhaTempo}</h2>
                <ol className="delivery-etapas">
                  {etapas.map((etapa, i) => {
                    const feita = i < atual;
                    const esta = i === atual;
                    const classe = feita
                      ? 'delivery-etapa delivery-etapa-feita'
                      : esta
                        ? 'delivery-etapa delivery-etapa-atual'
                        : 'delivery-etapa delivery-etapa-futura';
                    return (
                      <li key={etapa.chave} className={classe} aria-current={esta ? 'step' : undefined}>
                        <span className="delivery-etapa-marca" aria-hidden="true">
                          {feita && <Icone nome="visto" tamanho={16} />}
                        </span>
                        <span className="delivery-etapa-rotulo">{etapa.rotulo}</span>
                        <span className="delivery-etapa-estado">{feita ? td.feita : esta ? td.atual : td.futura}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            <section className="cartao">
              <h2 className="mesa-cli-secao-titulo">{t.seuPedido}</h2>
              <ul className="mesa-cli-pedido-itens">
                {pedido.itens.map((item, i) => (
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

              <div className="mesa-cli-conta-bloco">
                <div className="mesa-cli-conta-linha">
                  <span>{td.subtotal}</span>
                  <span>{formatarMoeda(pedido.subtotal)}</span>
                </div>
                {pedido.tipo === 'DELIVERY' && (
                  <div className="mesa-cli-conta-linha">
                    <span>{td.taxaEntrega}</span>
                    <span>{pedido.taxaEntrega > 0 ? formatarMoeda(pedido.taxaEntrega) : td.taxaEntregaGratis}</span>
                  </div>
                )}
                {pedido.desconto > 0 && (
                  <div className="mesa-cli-conta-linha">
                    <span>{td.descontoResumo(formatarMoeda(pedido.desconto))}</span>
                  </div>
                )}
                <div className="mesa-cli-conta">
                  <span>{t.total}</span>
                  <strong>{formatarMoeda(pedido.total)}</strong>
                </div>
              </div>

              <div className="delivery-info">
                {pedido.tipo === 'DELIVERY' && pedido.bairro && <p>{td.bairroDoPedido(pedido.bairro)}</p>}
                {pedido.formaPagamento && (
                  <p>
                    {td.pagamento}: {pedido.formaPagamento}
                  </p>
                )}
                {typeof pedido.trocoPara === 'number' && <p>{td.trocoPara(formatarMoeda(pedido.trocoPara))}</p>}
              </div>
            </section>

            <div className="delivery-acoes">
              <Link className="botao botao-primario" to="/pedir">
                {td.fazerOutroPedido}
              </Link>
              <Botao variante="secundario" aoClicar={() => void copiarEndereco()}>
                {td.copiarEndereco}
              </Botao>
            </div>
            {copia && (
              <p className="delivery-nota" role="status">
                {copia}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
