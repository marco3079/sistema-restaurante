import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro } from '../../lib/restaurante';
import type { EstoqueItemDTO, MovimentoDTO } from '../../lib/restaurante';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
} from '../../ui';
import { Icone } from '../../ui/icones';
import { Indicador } from '../pedidos/comum';

const ROTULO_TIPO: Record<MovimentoDTO['tipo'], string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  AJUSTE: 'Acerto de contagem',
  VENDA: 'Venda',
  DEVOLUCAO: 'Devolução',
};

function SeloSituacao({ situacao }: { situacao: EstoqueItemDTO['situacao'] }) {
  if (situacao === 'ZERADO') return <Selo cor="vermelho">Zerado</Selo>;
  if (situacao === 'BAIXO') return <Selo cor="amarelo">Baixo</Selo>;
  return <Selo cor="verde">Em dia</Selo>;
}

// Entrada, saída ou acerto de contagem de um item.
function Movimento({
  item,
  tipoInicial,
  aoFechar,
  aoSalvo,
}: {
  item: EstoqueItemDTO;
  tipoInicial: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [tipo, setTipo] = useState<string>(tipoInicial);
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = Number(quantidade);
    if (quantidade.trim() === '' || !Number.isInteger(n) || n < 0 || (tipo !== 'AJUSTE' && n === 0)) {
      setErro(tipo === 'AJUSTE' ? 'Informe quantas unidades há agora.' : 'Informe a quantidade.');
      return;
    }
    setEnviando(true);
    try {
      const resposta = await api.post<{ saldo: number }>(`/estoque/${item.id}/movimentos`, {
        tipo,
        quantidade: n,
        motivo: motivo.trim() || null,
      });
      aoSalvo(`${item.nome}: saldo de ${resposta.saldo}.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Estoque · ${item.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <p>Saldo atual: {item.estoque}</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao
          rotulo="O que aconteceu"
          valor={tipo}
          aoMudar={setTipo}
          opcoes={[
            { valor: 'ENTRADA', rotulo: 'Entrada (chegou mercadoria ou foi produzido)' },
            { valor: 'SAIDA', rotulo: 'Saída (perda, quebra, consumo da casa)' },
            { valor: 'AJUSTE', rotulo: 'Acerto de contagem (informar o saldo contado)' },
          ]}
        />
        <Campo
          rotulo={tipo === 'AJUSTE' ? 'Quantas unidades há agora' : 'Quantidade'}
          tipo="number"
          valor={quantidade}
          aoMudar={setQuantidade}
          obrigatorio
        />
        <Campo rotulo="Motivo (opcional)" valor={motivo} aoMudar={setMotivo} />
        <Botao tipo="submit" desabilitado={enviando}>
          Lançar
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

function Historico({ item, aoFechar }: { item: EstoqueItemDTO; aoFechar: () => void }) {
  const movimentos = useDados<MovimentoDTO[]>(`/estoque/${item.id}/movimentos`);
  return (
    <Modal aberto titulo={`Movimentos · ${item.nome}`} aoFechar={aoFechar}>
      {movimentos.erro && <Aviso tipo="erro">{movimentos.erro}</Aviso>}
      {movimentos.carregando && <Carregando />}
      {movimentos.dados && (
        <Tabela
          dados={movimentos.dados}
          chave={(m) => m.id}
          vazio="Nenhum movimento ainda."
          colunas={[
            { titulo: 'Quando', celula: (m) => <span className="sem-quebra">{formatarDataHora(m.criadoEm)}</span> },
            {
              titulo: 'Movimento',
              celula: (m) => (
                <span className="produto-texto">
                  <span className="produto-nome">{ROTULO_TIPO[m.tipo]}</span>
                  {(m.motivo || m.usuarioNome) && (
                    <span className="produto-descricao">{[m.motivo, m.usuarioNome].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
              ),
            },
            {
              titulo: 'Quantidade',
              alinhar: 'direita',
              celula: (m) => (m.quantidade > 0 ? `+${m.quantidade}` : String(m.quantidade)),
            },
            { titulo: 'Saldo', alinhar: 'direita', celula: (m) => <strong>{m.saldo}</strong> },
          ]}
        />
      )}
    </Modal>
  );
}

// Estoque dos itens com controle ligado. A cozinha só consulta.
export function Estoque() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const itens = useDados<EstoqueItemDTO[]>('/estoque');
  const [movimento, setMovimento] = useState<{ item: EstoqueItemDTO; tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE' } | null>(null);
  const [historico, setHistorico] = useState<EstoqueItemDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista = itens.dados ?? [];

  return (
    <Pagina titulo="Estoque">
      {itens.dados && (
        <div className="resumo">
          <Indicador rotulo="Itens controlados" valor={String(lista.length)} cor="azul" icone="lista" />
          <Indicador
            rotulo="Estoque baixo"
            valor={String(lista.filter((i) => i.situacao === 'BAIXO').length)}
            cor="laranja"
            icone="relogio"
          />
          <Indicador
            rotulo="Zerados"
            valor={String(lista.filter((i) => i.situacao === 'ZERADO').length)}
            cor="vermelho"
            icone="fechar"
          />
        </div>
      )}

      <Aviso tipo="info">
        {gestor
          ? 'Aparecem aqui os produtos com "Controlar estoque" ligado no cadastro (Cardápio > Editar). Cada pedido baixa o saldo sozinho; ao zerar, o item sai do cardápio; ao cancelar o pedido, o saldo volta.'
          : 'Saldo dos itens que o gestor controla. Quando um item zera, ele sai do cardápio sozinho.'}
      </Aviso>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {itens.erro && <Aviso tipo="erro">{itens.erro}</Aviso>}
      {itens.carregando && !itens.dados && <Carregando />}

      {itens.dados && (
        <Tabela
          dados={lista}
          chave={(i) => i.id}
          vazio="Nenhum produto com controle de estoque."
          colunas={[
            {
              titulo: 'Produto',
              celula: (i) => (
                <div className="produto-celula">
                  <span className="produto-miniatura">
                    {i.imagem ? <img src={i.imagem} alt="" /> : <Icone nome="cardapio" tamanho={22} />}
                  </span>
                  <span className="produto-texto">
                    <span className="produto-nome">{i.nome}</span>
                    <span className="produto-descricao">{i.categoria.nome}</span>
                  </span>
                </div>
              ),
            },
            { titulo: 'Saldo', alinhar: 'direita', celula: (i) => <strong>{i.estoque}</strong> },
            { titulo: 'Mínimo', alinhar: 'direita', celula: (i) => String(i.estoqueMinimo) },
            { titulo: 'Situação', celula: (i) => <SeloSituacao situacao={i.situacao} /> },
            ...(gestor
              ? [
                  {
                    titulo: 'Ações',
                    acoes: true,
                    celula: (i: EstoqueItemDTO) => (
                      <MenuAcoes
                        rotulo={`Ações do estoque de ${i.nome}`}
                        acoes={[
                          { rotulo: 'Entrada', icone: 'mais-circulo', aoClicar: () => setMovimento({ item: i, tipo: 'ENTRADA' }) },
                          { rotulo: 'Saída', icone: 'menos', aoClicar: () => setMovimento({ item: i, tipo: 'SAIDA' }) },
                          { rotulo: 'Acerto de contagem', icone: 'lapis', aoClicar: () => setMovimento({ item: i, tipo: 'AJUSTE' }) },
                          { rotulo: 'Ver movimentos', icone: 'lista', aoClicar: () => setHistorico(i) },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {movimento && (
        <Movimento
          item={movimento.item}
          tipoInicial={movimento.tipo}
          aoFechar={() => setMovimento(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            itens.recarregar();
          }}
        />
      )}
      {historico && <Historico item={historico} aoFechar={() => setHistorico(null)} />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/estoque',
    rotulo: 'Estoque',
    icone: 'lista',
    perfis: ['GESTOR'],
    elemento: <Estoque />,
    ordem: 21,
  },
  {
    caminho: '/cozinha/estoque',
    rotulo: 'Estoque',
    icone: 'lista',
    perfis: ['COZINHA'],
    elemento: <Estoque />,
    ordem: 21,
  },
];
