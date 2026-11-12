import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { useAtualizacao } from '../../lib/useAtualizacao';
import type { RotaModulo } from '../../lib/rotas';
import { STATUS_PEDIDO, horaCurta, nomeDaMesa } from '../../lib/restaurante';
import type { MesaDTO, PedidoDTO, StatusPedido } from '../../lib/restaurante';
import { Aviso, Botao, Caixa, Carregando, Pagina, Selecao, Tabela, formatarData, formatarMoeda } from '../../ui';
import { imprimirComanda } from '../../lib/imprimir';
import { CartaoPedido, Indicador, NovoPedido, SeloStatus } from './comum';

type Visao = 'andamento' | 'hoje' | 'todos';

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: 'andamento', rotulo: 'Em andamento' },
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'todos', rotulo: 'Histórico' },
];

const COLUNAS: StatusPedido[] = ['NOVO', 'EM_PREPARO', 'PRONTO'];

const STATUS_OPCOES = (Object.keys(STATUS_PEDIDO) as StatusPedido[]).map((s) => ({
  valor: s,
  rotulo: STATUS_PEDIDO[s].rotulo,
}));

function resumoDosItens(p: PedidoDTO): string {
  return p.itens.map((i) => `${i.quantidade}x ${i.nomeProduto}`).join(', ');
}

const CHAVE_AUTO_IMPRIMIR = 'pedidos-imprimir-sozinho';

export function Pedidos() {
  const { usuario } = useAuth();
  // A cozinha só mexe na fila: não lança pedido nem vê as mesas.
  const cozinha = usuario?.perfil === 'COZINHA';
  const [visao, setVisao] = useState<Visao>('andamento');
  const [mesaId, setMesaId] = useState('');
  const [status, setStatus] = useState('');
  const [novoAberto, setNovoAberto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  const params = new URLSearchParams({ ver: visao });
  if (mesaId) params.set('mesaId', mesaId);
  if (status && visao !== 'andamento') params.set('status', status);
  const pedidos = useDados<PedidoDTO[]>(`/pedidos?${params.toString()}`);
  const mesas = useDados<MesaDTO[]>(cozinha ? null : '/mesas');

  // A fila se atualiza sozinha: o pedido do cliente aparece sem recarregar a página.
  useAtualizacao(pedidos.recarregar, 8000);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  // Impressão automática: cada pedido novo que chega sai na impressora deste aparelho.
  const [autoImprimir, setAutoImprimir] = useState(() => {
    try {
      return window.localStorage.getItem(CHAVE_AUTO_IMPRIMIR) === '1';
    } catch {
      return false;
    }
  });
  const jaVistos = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!pedidos.dados || visao !== 'andamento') return;
    const primeiraVez = jaVistos.current === null;
    const vistos = jaVistos.current ?? new Set<number>();
    jaVistos.current = vistos;
    for (const p of pedidos.dados) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      // Os pedidos que já estavam na fila ao abrir a tela não são impressos de novo.
      if (!primeiraVez && autoImprimir && p.status === 'NOVO') imprimirComanda(p);
    }
  }, [pedidos.dados, visao, autoImprimir]);

  function mudarAutoImprimir(ligado: boolean) {
    setAutoImprimir(ligado);
    try {
      window.localStorage.setItem(CHAVE_AUTO_IMPRIMIR, ligado ? '1' : '0');
    } catch {
      // Sem armazenamento local, a escolha vale só enquanto a tela estiver aberta.
    }
  }

  const lista = pedidos.dados ?? [];
  const contar = (s: StatusPedido) => lista.filter((p) => p.status === s).length;

  function aposMudanca() {
    setErroAcao(null);
    pedidos.recarregar();
  }

  return (
    <Pagina
      titulo={cozinha ? 'Fila da cozinha' : 'Pedidos'}
      acoes={cozinha ? undefined : <Botao aoClicar={() => setNovoAberto(true)}>Novo pedido</Botao>}
    >
      {visao === 'andamento' && pedidos.dados && (
        <div className="resumo">
          <Indicador rotulo="Novos" valor={String(contar('NOVO'))} cor="azul" icone="pedidos" />
          <Indicador rotulo="Em preparo" valor={String(contar('EM_PREPARO'))} cor="laranja" icone="relogio" />
          <Indicador rotulo="Prontos para entregar" valor={String(contar('PRONTO'))} cor="verde" icone="visto" />
          <Indicador
            rotulo="Valor na fila"
            valor={formatarMoeda(lista.reduce((soma, p) => soma + p.total, 0))}
            cor="roxo"
            icone="financeiro"
          />
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
        <div className="filtros">
          {!cozinha && (
            <Selecao
              rotulo="Mesa"
              valor={mesaId}
              aoMudar={setMesaId}
              vazio="Todas"
              opcoes={(mesas.dados ?? []).map((m) => ({ valor: String(m.id), rotulo: nomeDaMesa(m) }))}
            />
          )}
          {visao === 'andamento' && (
            <Caixa rotulo="Imprimir os pedidos novos sozinho" marcado={autoImprimir} aoMudar={mudarAutoImprimir} />
          )}
          {visao !== 'andamento' && (
            <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} vazio="Todas" opcoes={STATUS_OPCOES} />
          )}
        </div>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {pedidos.erro && <Aviso tipo="erro">{pedidos.erro}</Aviso>}
      {pedidos.carregando && !pedidos.dados && <Carregando />}

      {pedidos.dados && visao === 'andamento' && (
        <div className="fila">
          {COLUNAS.map((coluna) => {
            const daColuna = lista.filter((p) => p.status === coluna);
            return (
              <section className="fila-coluna" key={coluna} aria-label={STATUS_PEDIDO[coluna].rotulo}>
                <h2 className="fila-coluna-titulo">
                  {STATUS_PEDIDO[coluna].rotulo}
                  <span className="fila-contagem">{daColuna.length}</span>
                </h2>
                {daColuna.length === 0 && <p className="fila-vazia">Nenhum pedido aqui.</p>}
                {daColuna.map((p) => (
                  <CartaoPedido key={p.id} pedido={p} agora={agora} aoMudar={aposMudanca} aoErro={setErroAcao} />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {pedidos.dados && visao !== 'andamento' && (
        <Tabela
          dados={lista}
          chave={(p) => p.id}
          vazio="Nenhum pedido encontrado."
          colunas={[
            { titulo: 'Pedido', celula: (p) => <span className="sem-quebra">#{p.id}</span> },
            { titulo: 'Mesa', celula: (p) => <span className="sem-quebra">{nomeDaMesa(p.mesa)}</span> },
            {
              titulo: 'Quando',
              celula: (p) => (
                <span className="sem-quebra">
                  {formatarData(p.criadoEm)} {horaCurta(p.criadoEm)}
                </span>
              ),
            },
            { titulo: 'Itens', celula: (p) => resumoDosItens(p) },
            { titulo: 'Origem', celula: (p) => (p.origem === 'CLIENTE' ? 'Cliente' : p.garcom?.nome ?? 'Equipe') },
            {
              titulo: 'Total',
              alinhar: 'direita',
              celula: (p) => <span className="sem-quebra">{formatarMoeda(p.total)}</span>,
            },
            { titulo: 'Pagamento', celula: (p) => (p.pagoEm ? p.formaPagamento ?? 'Pago' : 'Em aberto') },
            { titulo: 'Situação', celula: (p) => <SeloStatus status={p.status} /> },
          ]}
        />
      )}

      {novoAberto && (
        <NovoPedido
          aoFechar={() => setNovoAberto(false)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            pedidos.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/pedidos',
    rotulo: 'Pedidos',
    icone: 'pedidos',
    perfis: ['GESTOR'],
    elemento: <Pedidos />,
    ordem: 10,
  },
  {
    caminho: '/garcom/pedidos',
    rotulo: 'Pedidos',
    icone: 'pedidos',
    perfis: ['GARCOM'],
    elemento: <Pedidos />,
    ordem: 10,
  },
  {
    caminho: '/cozinha/pedidos',
    rotulo: 'Fila de pedidos',
    icone: 'pedidos',
    perfis: ['COZINHA'],
    elemento: <Pedidos />,
    ordem: 10,
  },
];
