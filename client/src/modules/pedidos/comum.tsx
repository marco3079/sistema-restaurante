import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { imprimirComanda } from '../../lib/imprimir';
import { useDados } from '../../lib/useDados';
import {
  STATUS_PEDIDO,
  horaCurta,
  mensagemErro,
  nomeDaMesa,
  tempoDesde,
} from '../../lib/restaurante';
import type { MesaDTO, PedidoDTO, ProdutoDTO, StatusPedido } from '../../lib/restaurante';
import { AreaTexto, Aviso, Botao, Campo, Carregando, Modal, Selecao, Selo, formatarMoeda } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { PerfilDoPrato } from '../../cliente/PerfilDoPrato';
import { EscolherOpcoes, precoVigente, temOpcoes, textoOpcoes } from './EscolherOpcoes';
import type { ConfiguracaoItem } from './EscolherOpcoes';
import './restaurante.css';

// Setor de preparo de quem está logado (cozinha com setor).
export interface SetorDaPessoa {
  id: number;
  nome: string;
  cor: string;
}

// Linha da sacola do "Novo pedido": produto com opções escolhidas (um produto pode ter várias linhas).
export interface LinhaSacola {
  chave: string;
  produtoId: number;
  opcoes: number[];
  rotulos: string[];
  extra: number;
  quantidade: number;
  observacao: string;
}

// ---------- Peças comuns ----------

export function SeloStatus({ status }: { status: StatusPedido }) {
  const info = STATUS_PEDIDO[status];
  return (
    <span className="sem-quebra">
      <Selo cor={info.cor}>{info.rotulo}</Selo>
    </span>
  );
}

// Situação que vale para a pessoa: a da parte do setor (cozinha com setor) ou a do pedido.
export function situacaoDaFila(pedido: PedidoDTO, setor?: SetorDaPessoa | null): StatusPedido {
  if (!setor) return pedido.status;
  return pedido.setores?.find((s) => s.setorId === setor.id)?.status ?? pedido.status;
}

type CorResumo = 'azul' | 'roxo' | 'verde' | 'laranja' | 'vermelho';

export function Indicador({
  rotulo,
  valor,
  cor,
  icone,
}: {
  rotulo: string;
  valor: string;
  cor: CorResumo;
  icone: NomeIcone;
}) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`}>
        <Icone nome={icone} tamanho={24} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

// Uma etiqueta por setor do pedido: nome e situação da parte, na cor do setor.
function EtiquetasDeSetor({ pedido }: { pedido: PedidoDTO }) {
  if (!pedido.setores || pedido.setores.length === 0) return null;
  return (
    <div className="pedido-setores">
      {pedido.setores.map((s) => (
        <span key={s.setorId} className="pedido-setor" style={{ borderColor: s.cor }}>
          <span className="pedido-setor-ponto" style={{ background: s.cor }} aria-hidden="true" />
          {s.nome}: {STATUS_PEDIDO[s.status].rotulo.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

// Com setorId, mostra só os itens desse setor.
export function ListaItens({
  pedido,
  comValor,
  setorId,
}: {
  pedido: PedidoDTO;
  comValor?: boolean;
  setorId?: number | null;
}) {
  const itens = setorId === undefined || setorId === null ? pedido.itens : pedido.itens.filter((i) => i.setorId === setorId);
  return (
    <ul className="pedido-itens">
      {itens.map((item, i) => {
        const opcoes = textoOpcoes(item.opcoes);
        return (
          <li key={item.id ?? i}>
            <span className="pedido-quantidade">{item.quantidade}x</span>
            <span className="pedido-item-nome">
              {item.nomeProduto}
              {opcoes && <span className="pedido-item-opcoes">{opcoes}</span>}
              {item.observacao && <span className="pedido-item-nota">{item.observacao}</span>}
            </span>
            {comValor && (
              <span className="pedido-item-valor">{formatarMoeda(item.precoUnitario * item.quantidade)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Próximo passo do pedido na fila.
const PROXIMO: Partial<Record<StatusPedido, { status: StatusPedido; rotulo: string }>> = {
  NOVO: { status: 'EM_PREPARO', rotulo: 'Iniciar preparo' },
  EM_PREPARO: { status: 'PRONTO', rotulo: 'Marcar pronto' },
  PRONTO: { status: 'ENTREGUE', rotulo: 'Entregar' },
};

export function CartaoPedido({
  pedido,
  agora,
  aoMudar,
  aoErro,
  setor,
  atrasoMin,
}: {
  pedido: PedidoDTO;
  agora: Date;
  aoMudar: () => void;
  aoErro: (mensagem: string) => void;
  // Cozinha com setor: o cartão segue a parte do setor e mostra só os itens dele.
  setor?: SetorDaPessoa | null;
  // Minutos desde que o pedido entrou, quando ele está atrasado. Sem valor, não há alerta.
  atrasoMin?: number;
}) {
  const { usuario } = useAuth();
  const perfil = usuario?.perfil;
  const [ocupado, setOcupado] = useState(false);
  const situacao = situacaoDaFila(pedido, setor);
  // Cozinha: inicia o preparo e marca como pronto. Garçom: entrega. Gestor: tudo.
  const passo = PROXIMO[situacao];
  const proximo =
    !passo || perfil === 'GESTOR'
      ? passo
      : perfil === 'COZINHA'
        ? passo.status !== 'ENTREGUE'
          ? passo
          : undefined
        : passo.status === 'ENTREGUE'
          ? passo
          : undefined;
  const podeCancelar =
    perfil !== 'COZINHA' && pedido.pagoEm === null && pedido.status !== 'CANCELADO' && pedido.status !== 'ENTREGUE';
  const espera =
    proximo || situacao === 'ENTREGUE' || situacao === 'CANCELADO'
      ? null
      : perfil === 'COZINHA'
        ? 'Aguardando o garçom entregar'
        : 'Aguardando a cozinha';

  async function mudar(status: StatusPedido) {
    if (status === 'CANCELADO' && !window.confirm(`Cancelar o pedido #${pedido.id} da ${nomeDaMesa(pedido.mesa)}?`)) {
      return;
    }
    setOcupado(true);
    try {
      await api.put(`/pedidos/${pedido.id}/status`, { status });
      aoMudar();
    } catch (e) {
      aoErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const quem =
    pedido.origem === 'CLIENTE'
      ? `Feito pelo cliente${pedido.nomeCliente ? ` (${pedido.nomeCliente})` : ''}`
      : `Lançado por ${pedido.garcom?.nome ?? 'equipe'}${pedido.nomeCliente ? ` · ${pedido.nomeCliente}` : ''}`;

  return (
    <article className={atrasoMin !== undefined ? 'pedido pedido-atrasado' : 'pedido'}>
      {atrasoMin !== undefined && <span className="pedido-atraso">Atrasado: {atrasoMin} min</span>}
      <div className="pedido-topo">
        <div>
          <h3 className="pedido-mesa">{nomeDaMesa(pedido.mesa)}</h3>
          <span className="pedido-meta">
            #{pedido.id} · {horaCurta(pedido.criadoEm)} · {tempoDesde(pedido.criadoEm, agora)}
          </span>
          <span className="pedido-meta">{quem}</span>
        </div>
        <SeloStatus status={situacao} />
      </div>
      <EtiquetasDeSetor pedido={pedido} />
      {setor && <p className="pedido-so-setor">Só os itens do seu setor ({setor.nome})</p>}
      <ListaItens pedido={pedido} setorId={setor?.id ?? null} />
      {pedido.observacao && <p className="pedido-nota">{pedido.observacao}</p>}
      <div className="pedido-rodape">
        <span className="pedido-total">{formatarMoeda(pedido.total)}</span>
        <div className="pedido-acoes">
          {pedido.status !== 'CANCELADO' && (
            <Botao variante="texto" aoClicar={() => imprimirComanda(pedido, setor?.id ?? null, setor?.nome)}>
              Imprimir
            </Botao>
          )}
          {podeCancelar && (
            <Botao variante="texto" desabilitado={ocupado} aoClicar={() => mudar('CANCELADO')}>
              Cancelar
            </Botao>
          )}
          {proximo && (
            <Botao desabilitado={ocupado} aoClicar={() => mudar(proximo.status)}>
              {proximo.rotulo}
            </Botao>
          )}
          {espera && <span className="pedido-espera">{espera}</span>}
        </div>
      </div>
    </article>
  );
}

// ---------- Lançar pedido pela equipe ----------

// Texto do combo: "1x Hambúrguer, 1x Batata".
function textoDoCombo(p: ProdutoDTO): string {
  return (p.comboItens ?? []).map((i) => `${i.quantidade}x ${i.nome}`).join(', ');
}

export function NovoPedido({
  mesaFixa,
  aoFechar,
  aoSalvo,
}: {
  mesaFixa?: { id: number; numero: number; nome: string | null };
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const mesas = useDados<MesaDTO[]>(mesaFixa ? null : '/mesas');
  const produtos = useDados<ProdutoDTO[]>('/produtos');
  const [mesaId, setMesaId] = useState(mesaFixa ? String(mesaFixa.id) : '');
  // Produtos sem opções: quantidade por produto.
  const [quantidades, setQuantidades] = useState<Record<number, number>>({});
  // Produtos com opções: uma linha por combinação de opções e observação.
  const [linhas, setLinhas] = useState<LinhaSacola[]>([]);
  // Produto cujas opções estão sendo escolhidas.
  const [escolhendo, setEscolhendo] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const [nomeCliente, setNomeCliente] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Id do item com os detalhes abertos.
  const [detalhe, setDetalhe] = useState<number | null>(null);

  const lista = produtos.dados ?? [];
  const pratoAberto = detalhe === null ? null : lista.find((p) => p.id === detalhe) ?? null;
  const produtoEscolhendo = escolhendo === null ? null : lista.find((p) => p.id === escolhendo) ?? null;
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? lista.filter((p) => p.nome.toLowerCase().includes(termo)) : lista;
  }, [lista, busca]);

  // Quantidade do produto na sacola (com opções: soma das linhas dele).
  function quantidadeDo(p: ProdutoDTO): number {
    if (!temOpcoes(p)) return quantidades[p.id] ?? 0;
    return linhas.filter((l) => l.produtoId === p.id).reduce((soma, l) => soma + l.quantidade, 0);
  }

  const escolhidos = lista.filter((p) => (quantidades[p.id] ?? 0) > 0);
  const unidades =
    escolhidos.reduce((soma, p) => soma + (quantidades[p.id] ?? 0), 0) +
    linhas.reduce((soma, l) => soma + l.quantidade, 0);
  // Estimativa com os preços da tela; o valor que vale é o do servidor.
  const total =
    escolhidos.reduce((soma, p) => soma + precoVigente(p) * (quantidades[p.id] ?? 0), 0) +
    linhas.reduce((soma, l) => {
      const p = lista.find((x) => x.id === l.produtoId);
      return soma + ((p ? precoVigente(p) : 0) + l.extra) * l.quantidade;
    }, 0);

  function somar(produtoId: number, delta: number) {
    setQuantidades((atual) => {
      const nova = Math.max(0, Math.min(50, (atual[produtoId] ?? 0) + delta));
      return { ...atual, [produtoId]: nova };
    });
  }

  function adicionarComOpcoes(produto: ProdutoDTO, configuracao: ConfiguracaoItem) {
    const chave = `${produto.id}|${configuracao.opcoes.join(',')}|${configuracao.observacao}`;
    setLinhas((atual) => {
      if (atual.some((l) => l.chave === chave)) {
        return atual.map((l) => (l.chave === chave ? { ...l, quantidade: Math.min(50, l.quantidade + 1) } : l));
      }
      return [
        ...atual,
        {
          chave,
          produtoId: produto.id,
          opcoes: configuracao.opcoes,
          rotulos: configuracao.rotulos,
          extra: configuracao.extra,
          quantidade: 1,
          observacao: configuracao.observacao,
        },
      ];
    });
  }

  // Muda a quantidade de uma linha; zero tira a linha da sacola.
  function mudarLinha(chave: string, delta: number) {
    setLinhas((atual) =>
      atual.flatMap((l) => {
        if (l.chave !== chave) return [l];
        const quantidade = l.quantidade + delta;
        return quantidade <= 0 ? [] : [{ ...l, quantidade: Math.min(50, quantidade) }];
      }),
    );
  }

  // Tira uma unidade do produto com opções (a última linha dele).
  function tirarUmDoProduto(produtoId: number) {
    const ultima = [...linhas].reverse().find((l) => l.produtoId === produtoId);
    if (ultima) mudarLinha(ultima.chave, -1);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!mesaId) {
      setErro('Escolha a mesa.');
      return;
    }
    if (unidades === 0) {
      setErro('Escolha pelo menos um item.');
      return;
    }
    setEnviando(true);
    try {
      const pedido = await api.post<PedidoDTO>('/pedidos', {
        mesaId: Number(mesaId),
        itens: [
          ...escolhidos.map((p) => ({ produtoId: p.id, quantidade: quantidades[p.id] })),
          ...linhas.map((l) => ({
            produtoId: l.produtoId,
            quantidade: l.quantidade,
            opcoes: l.opcoes,
            observacao: l.observacao || null,
          })),
        ],
        nomeCliente: nomeCliente.trim() || null,
        observacao: observacao.trim() || null,
      });
      aoSalvo(`Pedido #${pedido.id} lançado para a ${nomeDaMesa(pedido.mesa)}.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  // Com os detalhes abertos, eles tomam o lugar da lista; ao fechar, o pedido volta como estava.
  if (pratoAberto) {
    const quantidade = quantidades[pratoAberto.id] ?? 0;
    const comOpcoes = temOpcoes(pratoAberto);
    return (
      <PerfilDoPrato
        prato={{ ...pratoAberto, preco: precoVigente(pratoAberto) }}
        aoFechar={() => setDetalhe(null)}
        rodape={
          comOpcoes ? (
            pratoAberto.disponivel ? (
              <Botao
                aoClicar={() => {
                  setDetalhe(null);
                  setEscolhendo(pratoAberto.id);
                }}
              >
                Escolher opções
              </Botao>
            ) : (
              <Botao variante="secundario" aoClicar={() => setDetalhe(null)}>
                Voltar ao pedido
              </Botao>
            )
          ) : (
            <>
              {pratoAberto.disponivel && quantidade > 0 && (
                <div className="quantidade">
                  <button
                    type="button"
                    className="quantidade-botao"
                    aria-label={`Tirar um ${pratoAberto.nome}`}
                    onClick={() => somar(pratoAberto.id, -1)}
                  >
                    <Icone nome="menos" tamanho={16} />
                  </button>
                  <span className="quantidade-valor" aria-live="polite">
                    {quantidade}
                  </span>
                  <button
                    type="button"
                    className="quantidade-botao"
                    aria-label={`Adicionar um ${pratoAberto.nome}`}
                    onClick={() => somar(pratoAberto.id, 1)}
                  >
                    <Icone nome="somar" tamanho={16} />
                  </button>
                </div>
              )}
              {pratoAberto.disponivel && quantidade === 0 ? (
                <Botao
                  aoClicar={() => {
                    somar(pratoAberto.id, 1);
                    setDetalhe(null);
                  }}
                >
                  Adicionar ao pedido
                </Botao>
              ) : (
                <Botao variante={pratoAberto.disponivel ? 'primario' : 'secundario'} aoClicar={() => setDetalhe(null)}>
                  Voltar ao pedido
                </Botao>
              )}
            </>
          )
        }
      />
    );
  }

  return (
    <>
      <Modal aberto titulo={mesaFixa ? `Novo pedido · ${nomeDaMesa(mesaFixa)}` : 'Novo pedido'} aoFechar={aoFechar}>
        <form onSubmit={enviar}>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {mesas.erro && <Aviso tipo="erro">{mesas.erro}</Aviso>}
          {produtos.erro && <Aviso tipo="erro">{produtos.erro}</Aviso>}
          {!mesaFixa && (
            <Selecao
              rotulo="Mesa"
              valor={mesaId}
              aoMudar={setMesaId}
              obrigatorio
              opcoes={(mesas.dados ?? [])
                .filter((m) => m.ativa)
                .map((m) => ({ valor: String(m.id), rotulo: nomeDaMesa(m) }))}
            />
          )}
          <Campo rotulo="Buscar item" valor={busca} aoMudar={setBusca} />
          {produtos.carregando && !produtos.dados && <Carregando />}
          {produtos.dados && (
            <div className="itens-lista">
              {visiveis.length === 0 && <p className="fila-vazia">Nenhum item encontrado.</p>}
              {visiveis.map((p, i) => {
                const quantidade = quantidadeDo(p);
                const comOpcoes = temOpcoes(p);
                const novaCategoria = i === 0 || visiveis[i - 1].categoriaId !== p.categoriaId;
                return (
                  <div key={p.id}>
                    {novaCategoria && <p className="itens-categoria">{p.categoria.nome}</p>}
                    <div className="itens-linha">
                      {/* Foto e nome abrem os detalhes do item (ingredientes, alergênicos, tabela nutricional). */}
                      <button
                        type="button"
                        className="itens-abrir"
                        aria-label={`Ver detalhes de ${p.nome}`}
                        onClick={() => setDetalhe(p.id)}
                      >
                        <span className="produto-miniatura" aria-hidden="true">
                          {p.imagem ? <img src={p.imagem} alt="" loading="lazy" /> : <Icone nome="cardapio" tamanho={20} />}
                        </span>
                        <span className="itens-linha-texto">
                          <span className="itens-linha-nome">
                            {p.nome}
                            {p.combo && (
                              <>
                                {' '}
                                <Selo cor="azul">Combo</Selo>
                              </>
                            )}
                          </span>
                          {p.combo && textoDoCombo(p) && <span className="novo-pedido-combo">{textoDoCombo(p)}</span>}
                          {p.promocao && (
                            <span className="novo-pedido-promocao">
                              <Selo cor="verde">Promoção</Selo>
                            </span>
                          )}
                          <span className="itens-linha-preco">
                            {p.promocao && <s className="novo-pedido-antes">{formatarMoeda(p.preco)}</s>}
                            {formatarMoeda(precoVigente(p))}
                            {!p.disponivel && ' · esgotado'}
                          </span>
                        </span>
                      </button>
                      <div className="quantidade">
                        <button
                          type="button"
                          className="quantidade-botao"
                          aria-label={`Tirar um ${p.nome}`}
                          disabled={quantidade === 0}
                          onClick={() => (comOpcoes ? tirarUmDoProduto(p.id) : somar(p.id, -1))}
                        >
                          <Icone nome="menos" tamanho={16} />
                        </button>
                        <span className="quantidade-valor" aria-live="polite">
                          {quantidade}
                        </span>
                        <button
                          type="button"
                          className="quantidade-botao"
                          aria-label={comOpcoes ? `Escolher opções de ${p.nome}` : `Adicionar um ${p.nome}`}
                          disabled={!p.disponivel}
                          onClick={() => (comOpcoes ? setEscolhendo(p.id) : somar(p.id, 1))}
                        >
                          <Icone nome="somar" tamanho={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {linhas.length > 0 && (
            <ul className="novo-pedido-linhas">
              {linhas.map((l) => {
                const produto = lista.find((p) => p.id === l.produtoId);
                const nome = produto?.nome ?? 'Item';
                return (
                  <li key={l.chave} className="novo-pedido-linha">
                    <div className="novo-pedido-linha-texto">
                      <span className="novo-pedido-linha-nome">{nome}</span>
                      {l.rotulos.length > 0 && <span className="novo-pedido-linha-opcoes">{l.rotulos.join(' · ')}</span>}
                      {l.observacao && <span className="novo-pedido-linha-opcoes">{l.observacao}</span>}
                    </div>
                    <div className="quantidade">
                      <button
                        type="button"
                        className="quantidade-botao"
                        aria-label={`Tirar um ${nome}`}
                        onClick={() => mudarLinha(l.chave, -1)}
                      >
                        <Icone nome="menos" tamanho={16} />
                      </button>
                      <span className="quantidade-valor" aria-live="polite">
                        {l.quantidade}
                      </span>
                      <button
                        type="button"
                        className="quantidade-botao"
                        aria-label={`Adicionar um ${nome}`}
                        disabled={l.quantidade >= 50}
                        onClick={() => mudarLinha(l.chave, 1)}
                      >
                        <Icone nome="somar" tamanho={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="itens-resumo">
            <span>
              {unidades} {unidades === 1 ? 'item' : 'itens'}
            </span>
            <span>{formatarMoeda(total)}</span>
          </div>
          <Campo rotulo="Nome do cliente (opcional)" valor={nomeCliente} aoMudar={setNomeCliente} />
          <AreaTexto rotulo="Observação (opcional)" valor={observacao} aoMudar={setObservacao} linhas={2} />
          <Botao tipo="submit" desabilitado={enviando || produtos.carregando}>
            {enviando ? 'Enviando...' : 'Lançar pedido'}
          </Botao>{' '}
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </form>
      </Modal>
      {produtoEscolhendo && (
        <EscolherOpcoes
          key={produtoEscolhendo.id}
          produto={produtoEscolhendo}
          aoFechar={() => setEscolhendo(null)}
          aoAdicionar={(configuracao) => {
            adicionarComOpcoes(produtoEscolhendo, configuracao);
            setEscolhendo(null);
          }}
        />
      )}
    </>
  );
}
