import { useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { mensagemErro, nomeDaMesa } from '../../lib/restaurante';
import type { ContaDTO, MesaDTO } from '../../lib/restaurante';
import { Aviso, Botao, Carregando, Modal, Selecao, formatarMoeda } from '../../ui';

interface PropsAcaoMesa {
  mesa: MesaDTO;
  // Lista de mesas da tela (já filtrada pelo perfil).
  mesas: MesaDTO[];
  aoFechar: () => void;
  // Chamada quando a operação deu certo: quem chama mostra o aviso e recarrega as mesas.
  aoFeito: (mensagem: string) => void;
}

const SITUACAO_TEXTO: Record<MesaDTO['situacao'], string> = {
  LIVRE: 'livre',
  OCUPADA: 'ocupada',
  LIMPEZA: 'aguardando limpeza',
};

function rotuloComSituacao(m: MesaDTO): string {
  return `${nomeDaMesa(m)} · ${SITUACAO_TEXTO[m.situacao]}`;
}

// ---------- Trocar de mesa ----------

export function TrocarMesa({ mesa, mesas, aoFechar, aoFeito }: PropsAcaoMesa) {
  const livres = mesas.filter((m) => m.ativa && m.situacao === 'LIVRE' && m.id !== mesa.id);
  const [destino, setDestino] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const escolhida = livres.find((m) => String(m.id) === destino) ?? null;

  async function trocar() {
    if (!escolhida) {
      setErro('Escolha a mesa de destino.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/mesas/${mesa.id}/trocar`, { paraMesaId: escolhida.id });
      aoFeito(`Conta da ${nomeDaMesa(mesa)} trocada para ${nomeDaMesa(escolhida)}.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Trocar de mesa · ${nomeDaMesa(mesa)}`} aoFechar={aoFechar}>
      <p className="mesas-texto">A conta e os pedidos vão para a outra mesa. Esta mesa vai para a limpeza.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {livres.length === 0 ? (
        <p className="mesas-texto-suave">Nenhuma mesa livre no momento.</p>
      ) : (
        <Selecao
          rotulo="Mesa de destino"
          valor={destino}
          aoMudar={setDestino}
          obrigatorio
          opcoes={livres.map((m) => ({
            valor: String(m.id),
            rotulo: `${nomeDaMesa(m)} · ${m.lugares} lugares`,
          }))}
        />
      )}
      <div className="cobranca-acoes">
        <Botao desabilitado={enviando || !escolhida} aoClicar={() => void trocar()}>
          {enviando ? 'Trocando...' : 'Trocar de mesa'}
        </Botao>
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </Modal>
  );
}

// ---------- Juntar com outra mesa ----------

export function JuntarMesas({ mesa, mesas, aoFechar, aoFeito }: PropsAcaoMesa) {
  const outras = mesas.filter((m) => m.ativa && m.situacao === 'OCUPADA' && m.id !== mesa.id);
  const [escolhida, setEscolhida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const destino = outras.find((m) => String(m.id) === escolhida) ?? null;

  async function juntar() {
    if (!destino) {
      setErro('Escolha a mesa com a conta que vai juntar.');
      return;
    }
    if (
      !window.confirm(
        `Juntar a conta da ${nomeDaMesa(destino)} nesta conta? A ${nomeDaMesa(destino)} vai para a limpeza.`,
      )
    ) {
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/mesas/${mesa.id}/juntar`, { comMesaId: destino.id });
      aoFeito(`Conta da ${nomeDaMesa(destino)} juntada a ${nomeDaMesa(mesa)}.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Juntar com outra mesa · ${nomeDaMesa(mesa)}`} aoFechar={aoFechar}>
      <p className="mesas-texto">
        Os pedidos e os pagamentos da mesa escolhida vêm para esta conta. A outra mesa vai para a limpeza.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {outras.length === 0 ? (
        <p className="mesas-texto-suave">Nenhuma outra mesa com conta aberta.</p>
      ) : (
        <Selecao
          rotulo="Mesa com a conta a juntar"
          valor={escolhida}
          aoMudar={setEscolhida}
          obrigatorio
          opcoes={outras.map((m) => ({ valor: String(m.id), rotulo: rotuloComSituacao(m) }))}
        />
      )}
      <div className="cobranca-acoes">
        <Botao desabilitado={enviando || !destino} aoClicar={() => void juntar()}>
          {enviando ? 'Juntando...' : 'Juntar contas'}
        </Botao>
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </Modal>
  );
}

// ---------- Transferir itens ----------

interface LinhaItem {
  itemId: number;
  pedidoId: number;
  nome: string;
  observacao: string | null;
  opcoes: string;
  quantidade: number;
  precoUnitario: number;
}

export function TransferirItens({ mesa, mesas, aoFechar, aoFeito }: PropsAcaoMesa) {
  const conta = useDados<ContaDTO>(`/mesas/${mesa.id}/conta`);
  // Quantidade a transferir de cada item (chave: id do item).
  const [quantidades, setQuantidades] = useState<Record<number, number>>({});
  const [destino, setDestino] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const dados = conta.dados;
  const linhas: LinhaItem[] = (dados?.pedidos ?? []).flatMap((p) =>
    p.itens.flatMap((i) =>
      i.id === undefined
        ? []
        : [
            {
              itemId: i.id,
              pedidoId: p.id,
              nome: i.nomeProduto,
              observacao: i.observacao,
              opcoes: (i.opcoes ?? []).map((o) => o.opcao).join(', '),
              quantidade: i.quantidade,
              precoUnitario: i.precoUnitario,
            },
          ],
    ),
  );

  const destinos = mesas.filter((m) => m.ativa && m.id !== mesa.id);
  const mesaDestino = destinos.find((m) => String(m.id) === destino) ?? null;

  function quantidadeDe(itemId: number): number {
    return quantidades[itemId] ?? 0;
  }

  function ajustar(linha: LinhaItem, delta: number) {
    setQuantidades((atual) => {
      const nova = Math.min(linha.quantidade, Math.max(0, (atual[linha.itemId] ?? 0) + delta));
      return { ...atual, [linha.itemId]: nova };
    });
  }

  // Total em centavos, para não acumular erro de ponto flutuante.
  const totalCentavos = linhas.reduce(
    (soma, l) => soma + Math.round(l.precoUnitario * 100) * quantidadeDe(l.itemId),
    0,
  );
  const total = totalCentavos / 100;
  const itens = linhas
    .filter((l) => quantidadeDe(l.itemId) > 0)
    .map((l) => ({ itemId: l.itemId, quantidade: quantidadeDe(l.itemId) }));

  async function transferir() {
    if (!mesaDestino) {
      setErro('Escolha a mesa de destino.');
      return;
    }
    if (itens.length === 0) {
      setErro('Escolha ao menos um item para transferir.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/mesas/${mesa.id}/transferir-itens`, { paraMesaId: mesaDestino.id, itens });
      aoFeito(`Itens transferidos para ${nomeDaMesa(mesaDestino)}.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Transferir itens · ${nomeDaMesa(mesa)}`} aoFechar={aoFechar}>
      {conta.erro && <Aviso tipo="erro">{conta.erro}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {conta.carregando && !dados && <Carregando />}
      {dados && !dados.conta && <p className="mesas-texto-suave">Esta mesa não tem conta aberta.</p>}
      {dados && dados.conta && linhas.length === 0 && (
        <p className="mesas-texto-suave">Esta mesa não tem itens para transferir.</p>
      )}

      {linhas.length > 0 && (
        <>
          <ul className="mesas-itens">
            {linhas.map((l) => {
              const quantos = quantidadeDe(l.itemId);
              return (
                <li key={l.itemId} className="mesas-item">
                  <div className="mesas-item-texto">
                    <span className="mesas-item-nome">
                      {l.quantidade}x {l.nome}
                    </span>
                    {l.opcoes && <span className="mesas-item-detalhe">{l.opcoes}</span>}
                    {l.observacao && <span className="mesas-item-detalhe">{l.observacao}</span>}
                    <span className="mesas-item-detalhe">
                      Pedido #{l.pedidoId} · {formatarMoeda(l.precoUnitario * l.quantidade)}
                    </span>
                  </div>
                  <div className="mesas-qtd">
                    <Botao variante="secundario" desabilitado={quantos <= 0} aoClicar={() => ajustar(l, -1)}>
                      −
                    </Botao>
                    <span className="mesas-qtd-valor">
                      {quantos} de {l.quantidade}
                    </span>
                    <Botao
                      variante="secundario"
                      desabilitado={quantos >= l.quantidade}
                      aoClicar={() => ajustar(l, 1)}
                    >
                      +
                    </Botao>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mesas-total">
            Total a transferir <strong>{formatarMoeda(total)}</strong>
          </p>

          {destinos.length === 0 ? (
            <p className="mesas-texto-suave">Não há outra mesa ativa para receber os itens.</p>
          ) : (
            <Selecao
              rotulo="Mesa de destino"
              valor={destino}
              aoMudar={setDestino}
              obrigatorio
              opcoes={destinos.map((m) => ({ valor: String(m.id), rotulo: rotuloComSituacao(m) }))}
            />
          )}
        </>
      )}

      <div className="cobranca-acoes">
        <Botao
          desabilitado={enviando || !mesaDestino || itens.length === 0}
          aoClicar={() => void transferir()}
        >
          {enviando ? 'Transferindo...' : 'Transferir'}
        </Botao>
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </Modal>
  );
}
