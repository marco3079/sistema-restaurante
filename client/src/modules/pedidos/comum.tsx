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
import './restaurante.css';

// ---------- Peças comuns ----------

export function SeloStatus({ status }: { status: StatusPedido }) {
  const info = STATUS_PEDIDO[status];
  return (
    <span className="sem-quebra">
      <Selo cor={info.cor}>{info.rotulo}</Selo>
    </span>
  );
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

export function ListaItens({ pedido, comValor }: { pedido: PedidoDTO; comValor?: boolean }) {
  return (
    <ul className="pedido-itens">
      {pedido.itens.map((item, i) => (
        <li key={item.id ?? i}>
          <span className="pedido-quantidade">{item.quantidade}x</span>
          <span className="pedido-item-nome">
            {item.nomeProduto}
            {item.observacao && <span className="pedido-item-nota">{item.observacao}</span>}
          </span>
          {comValor && (
            <span className="pedido-item-valor">{formatarMoeda(item.precoUnitario * item.quantidade)}</span>
          )}
        </li>
      ))}
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
}: {
  pedido: PedidoDTO;
  agora: Date;
  aoMudar: () => void;
  aoErro: (mensagem: string) => void;
}) {
  const { usuario } = useAuth();
  const perfil = usuario?.perfil;
  const [ocupado, setOcupado] = useState(false);
  // Cozinha: inicia o preparo e marca como pronto. Garçom: entrega. Gestor: tudo.
  const passo = PROXIMO[pedido.status];
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
    proximo || pedido.status === 'ENTREGUE' || pedido.status === 'CANCELADO'
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
    <article className="pedido">
      <div className="pedido-topo">
        <div>
          <h3 className="pedido-mesa">{nomeDaMesa(pedido.mesa)}</h3>
          <span className="pedido-meta">
            #{pedido.id} · {horaCurta(pedido.criadoEm)} · {tempoDesde(pedido.criadoEm, agora)}
          </span>
          <span className="pedido-meta">{quem}</span>
        </div>
        <SeloStatus status={pedido.status} />
      </div>
      <ListaItens pedido={pedido} />
      {pedido.observacao && <p className="pedido-nota">{pedido.observacao}</p>}
      <div className="pedido-rodape">
        <span className="pedido-total">{formatarMoeda(pedido.total)}</span>
        <div className="pedido-acoes">
          {pedido.status !== 'CANCELADO' && (
            <Botao variante="texto" aoClicar={() => imprimirComanda(pedido)}>
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
  const [quantidades, setQuantidades] = useState<Record<number, number>>({});
  const [busca, setBusca] = useState('');
  const [nomeCliente, setNomeCliente] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Id do item com os detalhes abertos.
  const [detalhe, setDetalhe] = useState<number | null>(null);

  const lista = produtos.dados ?? [];
  const pratoAberto = detalhe === null ? null : lista.find((p) => p.id === detalhe) ?? null;
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? lista.filter((p) => p.nome.toLowerCase().includes(termo)) : lista;
  }, [lista, busca]);

  const escolhidos = lista.filter((p) => (quantidades[p.id] ?? 0) > 0);
  const total = escolhidos.reduce((soma, p) => soma + p.preco * (quantidades[p.id] ?? 0), 0);
  const unidades = escolhidos.reduce((soma, p) => soma + (quantidades[p.id] ?? 0), 0);

  function somar(produtoId: number, delta: number) {
    setQuantidades((atual) => {
      const nova = Math.max(0, Math.min(50, (atual[produtoId] ?? 0) + delta));
      return { ...atual, [produtoId]: nova };
    });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!mesaId) {
      setErro('Escolha a mesa.');
      return;
    }
    if (escolhidos.length === 0) {
      setErro('Escolha pelo menos um item.');
      return;
    }
    setEnviando(true);
    try {
      const pedido = await api.post<PedidoDTO>('/pedidos', {
        mesaId: Number(mesaId),
        itens: escolhidos.map((p) => ({ produtoId: p.id, quantidade: quantidades[p.id] })),
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
    return (
      <PerfilDoPrato
        prato={pratoAberto}
        aoFechar={() => setDetalhe(null)}
        rodape={
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
        }
      />
    );
  }

  return (
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
              const quantidade = quantidades[p.id] ?? 0;
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
                        <span className="itens-linha-nome">{p.nome}</span>
                        <span className="itens-linha-preco">
                          {formatarMoeda(p.preco)}
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
                        onClick={() => somar(p.id, -1)}
                      >
                        <Icone nome="menos" tamanho={16} />
                      </button>
                      <span className="quantidade-valor" aria-live="polite">
                        {quantidade}
                      </span>
                      <button
                        type="button"
                        className="quantidade-botao"
                        aria-label={`Adicionar um ${p.nome}`}
                        disabled={!p.disponivel}
                        onClick={() => somar(p.id, 1)}
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
  );
}
