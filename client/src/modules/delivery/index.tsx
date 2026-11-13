import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { imprimirHtml } from '../../lib/imprimir';
import type { RotaModulo } from '../../lib/rotas';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import { FORMAS_PAGAMENTO, horaCurta, mensagemErro, tempoDesde } from '../../lib/restaurante';
import type { EntregaDTO } from '../../lib/restaurante';
import { SITUACAO_ENTREGA } from '../../lib/delivery';
import type { EntregaPedidoDTO, SituacaoEntrega } from '../../lib/delivery';
import { Abas, Aviso, Botao, Campo, Carregando, Modal, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import { Indicador, ListaItens } from '../pedidos/comum';
import { Configuracao } from './Configuracao';
import './delivery.css';

type Aba = 'pedidos' | 'configuracao';
type Visao = 'andamento' | 'hoje';

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: 'andamento', rotulo: 'Em andamento' },
  { id: 'hoje', rotulo: 'Hoje' },
];

// Colunas da fila em andamento, na ordem em que o pedido anda.
const COLUNAS: { situacao: SituacaoEntrega; rotulo: string }[] = [
  { situacao: 'RECEBIDO', rotulo: 'Recebidos' },
  { situacao: 'EM_PREPARO', rotulo: 'Em preparo' },
  { situacao: 'PRONTO', rotulo: 'Prontos' },
  { situacao: 'SAIU', rotulo: 'A caminho' },
];

// ---------- Textos e formatação ----------

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

// (11) 98765-4321 ou (11) 3456-7890; sem 10 ou 11 dígitos, mostra como veio.
function telefoneFormatado(texto: string): string {
  const d = somenteDigitos(texto);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return texto;
}

function enderecoCompleto(e: EntregaDTO): string {
  return [e.endereco, e.complemento, e.bairro].filter(Boolean).join(', ');
}

function linkDoMapa(e: EntregaDTO): string {
  const endereco = [e.endereco, e.bairro].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
}

function linkDeAcompanhamento(codigo: string): string {
  return `${window.location.origin}/pedido/${codigo}`;
}

// "Dinheiro (troco para R$ 100,00)" ou só a forma de pagamento.
function textoDaForma(e: EntregaDTO): string {
  if (e.formaPagamento === 'Dinheiro' && e.trocoPara !== null) {
    return `${e.formaPagamento} (troco para ${formatarMoeda(e.trocoPara)})`;
  }
  return e.formaPagamento;
}

function rotuloTipo(e: EntregaDTO): string {
  return e.tipo === 'DELIVERY' ? 'Entrega' : 'Retirada';
}

// ---------- Impressão ----------

// Folha para o entregador ou para o balcão: cliente, endereço, itens, valores e pagamento.
function imprimirEntrega(pedido: EntregaPedidoDTO): void {
  const e = pedido.entrega;
  if (!e) return;
  const conta = pedido.conta;
  const itens = pedido.itens
    .map((i) => {
      const opcoes = (i.opcoes ?? []).map((o) => (o.precoExtra > 0 ? `+ ${o.opcao}` : o.opcao)).join(' · ');
      return (
        `<div class="par"><span>${i.quantidade}x ${escapar(i.nomeProduto)}</span>` +
        `<span>${formatarMoeda(i.precoUnitario * i.quantidade)}</span></div>` +
        (opcoes ? `<p class="opcoes">${escapar(opcoes)}</p>` : '') +
        (i.observacao ? `<p class="nota">&gt; ${escapar(i.observacao)}</p>` : '')
      );
    })
    .join('');
  const linhaValor = (rotulo: string, valor: number) =>
    `<div class="par"><span>${escapar(rotulo)}</span><span>${formatarMoeda(valor)}</span></div>`;
  const pagamento =
    `${e.tipo === 'DELIVERY' ? 'Paga na entrega com' : 'Paga na retirada com'}: ${escapar(textoDaForma(e))}`;

  imprimirHtml(
    `Pedido ${pedido.id}`,
    `<h2>${e.tipo === 'DELIVERY' ? 'ENTREGA' : 'RETIRADA'}</h2>` +
      `<p class="centro">Pedido #${pedido.id} · ${horaCurta(pedido.criadoEm)}</p>` +
      `<div class="linha"></div>` +
      `<p class="destaque">${escapar(e.nomeCliente)}</p>` +
      `<p>Telefone: ${escapar(telefoneFormatado(e.telefone))}</p>` +
      (e.tipo === 'DELIVERY' && enderecoCompleto(e) ? `<p>${escapar(enderecoCompleto(e))}</p>` : '') +
      (e.referencia ? `<p>Referência: ${escapar(e.referencia)}</p>` : '') +
      `<div class="linha"></div>${itens}<div class="linha"></div>` +
      linhaValor('Subtotal', conta.subtotal) +
      (conta.taxaEntrega > 0 ? linhaValor('Taxa de entrega', conta.taxaEntrega) : '') +
      (conta.desconto > 0 ? linhaValor('Desconto', -conta.desconto) : '') +
      `<div class="par destaque"><span>TOTAL</span><span>${formatarMoeda(conta.total)}</span></div>` +
      (conta.pago > 0
        ? linhaValor('Já pago', conta.pago) + `<div class="par destaque"><span>A RECEBER</span><span>${formatarMoeda(conta.restante)}</span></div>`
        : '') +
      `<p>${pagamento}</p>` +
      (pedido.observacao ? `<div class="obs">OBS: ${escapar(pedido.observacao)}</div>` : '') +
      `<div class="linha"></div><p class="centro pequeno">${new Date().toLocaleString('pt-BR')}</p>`,
  );
}

// ---------- Modais de ação ----------

// Saída para entrega: o nome do entregador é opcional.
function ModalSaida({
  pedido,
  aoFechar,
  aoSalvo,
}: {
  pedido: EntregaPedidoDTO;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const [entregador, setEntregador] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const nome = entregador.trim();
      await api.post(`/delivery/pedidos/${pedido.id}/saiu`, nome ? { entregadorNome: nome } : {});
      aoSalvo();
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Saiu para entrega · #${pedido.id}`} aoFechar={aoFechar}>
      <form onSubmit={confirmar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p>Cliente: {pedido.entrega?.nomeCliente}</p>
        <Campo rotulo="Nome do entregador (opcional)" valor={entregador} aoMudar={setEntregador} />
        <Botao tipo="submit" desabilitado={enviando}>
          Confirmar saída
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Entregue ou retirado, com pagamento: a forma já vem a que o cliente escolheu.
function ModalConcluir({
  pedido,
  aoFechar,
  aoSalvo,
}: {
  pedido: EntregaPedidoDTO;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const e = pedido.entrega;
  const [forma, setForma] = useState(e && FORMAS_PAGAMENTO.includes(e.formaPagamento) ? e.formaPagamento : '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const entregue = e?.tipo === 'DELIVERY';

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    if (!forma) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/delivery/pedidos/${pedido.id}/concluir`, { formaPagamento: forma });
      aoSalvo();
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto
      titulo={entregue ? `Entregue e pago · #${pedido.id}` : `Retirado e pago · #${pedido.id}`}
      aoFechar={aoFechar}
    >
      <form onSubmit={confirmar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p>
          Total: <strong>{formatarMoeda(pedido.conta.total)}</strong>
        </p>
        {pedido.conta.pago > 0 && <p>Já pago: {formatarMoeda(pedido.conta.pago)}</p>}
        <p>A receber: <strong>{formatarMoeda(pedido.conta.restante)}</strong></p>
        <Selecao
          rotulo="Forma de pagamento"
          valor={forma}
          aoMudar={setForma}
          opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: f }))}
          obrigatorio
        />
        <Botao tipo="submit" desabilitado={enviando || !forma}>
          {entregue ? 'Confirmar entrega e pagamento' : 'Confirmar retirada e pagamento'}
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// ---------- Cartão de um pedido na fila ----------

function CartaoEntrega({
  pedido,
  agora,
  aoMudar,
  aoErro,
  aoAviso,
}: {
  pedido: EntregaPedidoDTO;
  agora: Date;
  aoMudar: () => void;
  aoErro: (mensagem: string) => void;
  aoAviso: (mensagem: string) => void;
}) {
  const [modal, setModal] = useState<'saida' | 'concluir' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const e = pedido.entrega;
  if (!e) return null;

  const situacao = pedido.situacao;
  const ehEntrega = e.tipo === 'DELIVERY';
  const pendente = situacao === 'RECEBIDO' || situacao === 'EM_PREPARO';

  async function cancelar() {
    if (!e) return;
    if (!window.confirm(`Cancelar o pedido #${pedido.id} de ${e.nomeCliente}? Esta ação não tem volta.`)) return;
    setOcupado(true);
    try {
      await api.post(`/delivery/pedidos/${pedido.id}/cancelar`);
      aoMudar();
    } catch (err) {
      aoErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function copiarLink() {
    if (!e) return;
    const link = linkDeAcompanhamento(e.codigo);
    try {
      await navigator.clipboard.writeText(link);
      aoAviso(`Link do pedido #${pedido.id} copiado.`);
    } catch {
      aoErro(`Não foi possível copiar. Link: ${link}`);
    }
  }

  return (
    <article className="entrega-cartao">
      <div className="entrega-topo">
        <div className="entrega-identificacao">
          {ehEntrega ? <Selo cor="azul">Entrega</Selo> : <span className="entrega-selo-retirada">Retirada</span>}
          <h3 className="entrega-nome">{e.nomeCliente}</h3>
          <a className="entrega-telefone" href={`tel:${somenteDigitos(e.telefone)}`}>
            {telefoneFormatado(e.telefone)}
          </a>
          <span className="entrega-meta">
            #{pedido.id} · {horaCurta(pedido.criadoEm)} · {tempoDesde(pedido.criadoEm, agora)}
          </span>
        </div>
        <Selo cor={SITUACAO_ENTREGA[situacao].cor}>{SITUACAO_ENTREGA[situacao].rotulo}</Selo>
      </div>

      {ehEntrega && (
        <div className="entrega-bloco">
          {e.endereco && <p>{e.endereco}</p>}
          {e.complemento && <p>{e.complemento}</p>}
          {e.bairro && <p>Bairro: {e.bairro}</p>}
          {e.referencia && <p>Referência: {e.referencia}</p>}
          {e.endereco && (
            <a className="botao botao-texto" href={linkDoMapa(e)} target="_blank" rel="noopener noreferrer">
              Abrir no mapa
            </a>
          )}
        </div>
      )}

      <ListaItens pedido={pedido} />
      {pedido.observacao && <p className="entrega-observacao">{pedido.observacao}</p>}

      <div className="entrega-valores">
        <div className="entrega-linha">
          <span>Subtotal</span>
          <span>{formatarMoeda(pedido.conta.subtotal)}</span>
        </div>
        {pedido.conta.taxaEntrega > 0 && (
          <div className="entrega-linha">
            <span>Taxa de entrega</span>
            <span>{formatarMoeda(pedido.conta.taxaEntrega)}</span>
          </div>
        )}
        {pedido.conta.desconto > 0 && (
          <div className="entrega-linha">
            <span>Desconto</span>
            <span>-{formatarMoeda(pedido.conta.desconto)}</span>
          </div>
        )}
        <div className="entrega-linha entrega-total">
          <span>Total</span>
          <span>{formatarMoeda(pedido.conta.total)}</span>
        </div>
      </div>
      <p className="entrega-pagamento">
        {ehEntrega ? 'Paga na entrega com' : 'Paga na retirada com'}: {textoDaForma(e)}
      </p>

      <div className="entrega-acoes">
        {pendente && <span className="entrega-espera">A cozinha prepara pela fila de pedidos</span>}
        {(pendente || situacao === 'PRONTO' || situacao === 'SAIU') && (
          <Botao variante="texto" desabilitado={ocupado} aoClicar={() => void cancelar()}>
            Cancelar pedido
          </Botao>
        )}
        {situacao === 'PRONTO' && ehEntrega && (
          <Botao desabilitado={ocupado} aoClicar={() => setModal('saida')}>
            Saiu para entrega
          </Botao>
        )}
        {situacao === 'PRONTO' && !ehEntrega && (
          <Botao desabilitado={ocupado} aoClicar={() => setModal('concluir')}>
            Cliente retirou e pagou
          </Botao>
        )}
        {situacao === 'SAIU' && (
          <Botao desabilitado={ocupado} aoClicar={() => setModal('concluir')}>
            Entregue e pago
          </Botao>
        )}
        <Botao variante="texto" aoClicar={() => imprimirEntrega(pedido)}>
          Imprimir
        </Botao>
        <Botao variante="texto" aoClicar={() => void copiarLink()}>
          Copiar link de acompanhamento
        </Botao>
      </div>

      {modal === 'saida' && (
        <ModalSaida pedido={pedido} aoFechar={() => setModal(null)} aoSalvo={aoMudar} />
      )}
      {modal === 'concluir' && (
        <ModalConcluir pedido={pedido} aoFechar={() => setModal(null)} aoSalvo={aoMudar} />
      )}
    </article>
  );
}

// ---------- Fila de pedidos (todas as pessoas da equipe) ----------

function FilaEntregas() {
  const [visao, setVisao] = useState<Visao>('andamento');
  const andamento = useDados<EntregaPedidoDTO[]>('/delivery/pedidos?ver=andamento');
  const hoje = useDados<EntregaPedidoDTO[]>('/delivery/pedidos?ver=hoje');
  const [agora, setAgora] = useState(() => new Date());
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // A fila se atualiza sozinha: o pedido do cliente aparece sem recarregar a página.
  useAtualizacao(andamento.recarregar, 10000);
  useAtualizacao(hoje.recarregar, 10000);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  function aposMudanca() {
    setErro(null);
    andamento.recarregar();
    hoje.recarregar();
  }

  const lista = andamento.dados ?? [];
  const daSituacao = (s: SituacaoEntrega) => lista.filter((p) => p.situacao === s).length;
  const emPreparo = daSituacao('RECEBIDO') + daSituacao('EM_PREPARO');
  const concluidosHoje = (hoje.dados ?? []).filter((p) => p.situacao === 'CONCLUIDO').length;

  return (
    <>
      {andamento.dados && hoje.dados && (
        <div className="resumo">
          <Indicador rotulo="Em preparo" valor={String(emPreparo)} cor="laranja" icone="relogio" />
          <Indicador rotulo="Prontos" valor={String(daSituacao('PRONTO'))} cor="verde" icone="visto" />
          <Indicador rotulo="A caminho" valor={String(daSituacao('SAIU'))} cor="azul" icone="enviar" />
          <Indicador rotulo="Concluídos hoje" valor={String(concluidosHoje)} cor="roxo" icone="financeiro" />
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="segmentado" role="group" aria-label="Quais pedidos mostrar">
          {VISOES.map((v) => (
            <button
              key={v.id}
              type="button"
              className="segmentado-item"
              aria-pressed={visao === v.id}
              onClick={() => setVisao(v.id)}
            >
              {v.rotulo}
            </button>
          ))}
        </div>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {visao === 'andamento' && (
        <>
          {andamento.erro && <Aviso tipo="erro">{andamento.erro}</Aviso>}
          {andamento.carregando && !andamento.dados && <Carregando />}
          {andamento.dados &&
            (lista.length === 0 ? (
              <p className="entrega-vazio">Nenhum pedido de delivery em andamento.</p>
            ) : (
              <div className="entrega-fila">
                {COLUNAS.map((coluna) => {
                  const daColuna = lista.filter((p) => p.situacao === coluna.situacao);
                  return (
                    <section className="entrega-coluna" key={coluna.situacao} aria-label={coluna.rotulo}>
                      <h2 className="entrega-coluna-titulo">
                        {coluna.rotulo}
                        <span className="entrega-contagem">{daColuna.length}</span>
                      </h2>
                      {daColuna.length === 0 && <p className="entrega-vazio-coluna">Nenhum pedido aqui.</p>}
                      {daColuna.map((p) => (
                        <CartaoEntrega
                          key={p.id}
                          pedido={p}
                          agora={agora}
                          aoMudar={() => {
                            setAviso(null);
                            aposMudanca();
                          }}
                          aoErro={setErro}
                          aoAviso={setAviso}
                        />
                      ))}
                    </section>
                  );
                })}
              </div>
            ))}
        </>
      )}

      {visao === 'hoje' && (
        <>
          {hoje.erro && <Aviso tipo="erro">{hoje.erro}</Aviso>}
          {hoje.carregando && !hoje.dados && <Carregando />}
          {hoje.dados && (
            <Tabela<EntregaPedidoDTO>
              dados={hoje.dados}
              chave={(p) => p.id}
              vazio="Nenhum pedido de delivery ou retirada hoje."
              colunas={[
                { titulo: 'Hora', celula: (p) => <span className="entrega-sem-quebra">{horaCurta(p.criadoEm)}</span> },
                {
                  titulo: 'Tipo',
                  celula: (p) => (p.entrega ? rotuloTipo(p.entrega) : '—'),
                },
                { titulo: 'Cliente', celula: (p) => p.entrega?.nomeCliente ?? '—' },
                { titulo: 'Bairro', celula: (p) => p.entrega?.bairro ?? '—' },
                {
                  titulo: 'Total',
                  alinhar: 'direita',
                  celula: (p) => <strong className="entrega-sem-quebra">{formatarMoeda(p.conta.total)}</strong>,
                },
                {
                  titulo: 'Situação',
                  celula: (p) => (
                    <Selo cor={SITUACAO_ENTREGA[p.situacao].cor}>{SITUACAO_ENTREGA[p.situacao].rotulo}</Selo>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </>
  );
}

// ---------- Tela ----------

export function Delivery() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const [aba, setAba] = useState<Aba>('pedidos');

  return (
    <Pagina titulo="Delivery e retirada">
      {gestor && (
        <Abas
          abas={[
            { id: 'pedidos', rotulo: 'Pedidos' },
            { id: 'configuracao', rotulo: 'Configuração' },
          ]}
          ativa={aba}
          aoMudar={(id) => setAba(id === 'configuracao' ? 'configuracao' : 'pedidos')}
        />
      )}
      {gestor && aba === 'configuracao' ? <Configuracao /> : <FilaEntregas />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/delivery',
    rotulo: 'Delivery',
    icone: 'enviar',
    perfis: ['GESTOR'],
    elemento: <Delivery />,
    ordem: 15,
    grupo: 'Atendimento',
  },
  {
    caminho: '/garcom/delivery',
    rotulo: 'Delivery',
    icone: 'enviar',
    perfis: ['GARCOM'],
    elemento: <Delivery />,
    ordem: 15,
    grupo: 'Atendimento',
  },
  {
    caminho: '/recepcao/delivery',
    rotulo: 'Delivery',
    icone: 'enviar',
    perfis: ['RECEPCAO'],
    elemento: <Delivery />,
    ordem: 15,
    grupo: 'Atendimento',
  },
];
