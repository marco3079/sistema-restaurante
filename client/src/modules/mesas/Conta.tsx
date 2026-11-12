import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { FORMAS_PAGAMENTO, horaCurta, mensagemErro, nomeDaMesa, rotuloOperadora } from '../../lib/restaurante';
import type { ContaDTO, MaquinetasDTO, MesaDTO, PagamentoDTO } from '../../lib/restaurante';
import { Aviso, Botao, Campo, Carregando, Modal, Selecao, formatarMoeda } from '../../ui';
import { ListaItens, SeloStatus } from '../pedidos/comum';

const INTERVALO_MAQUINETA_MS = 2000;

// Conta da mesa e cobrança. Com maquineta manual, o garçom confirma o pagamento.
// Com maquineta automática, a tela acompanha a maquineta até ela responder.
export function ContaDaMesa({
  mesa,
  aoFechar,
  aoPago,
}: {
  mesa: MesaDTO;
  aoFechar: () => void;
  aoPago: (mensagem: string) => void;
}) {
  const conta = useDados<ContaDTO>(`/mesas/${mesa.id}/conta`);
  const maquinetas = useDados<MaquinetasDTO>('/maquinetas');
  const [forma, setForma] = useState('');
  const [maquinetaId, setMaquinetaId] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<PagamentoDTO | null>(null);
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const disponiveis = maquinetas.dados?.maquinetas.filter((m) => m.ativa) ?? [];
  const usaMaquineta = forma !== '' && forma !== 'Dinheiro' && disponiveis.length > 0;
  // Com uma só maquineta disponível, ela já vem escolhida.
  const escolhida = maquinetaId ?? (disponiveis.length === 1 ? String(disponiveis[0].id) : '');

  // Retoma a cobrança que já estava em andamento nesta mesa.
  useEffect(() => {
    if (conta.dados?.pagamentoPendente && !pagamento) setPagamento(conta.dados.pagamentoPendente);
  }, [conta.dados, pagamento]);

  function concluir(p: PagamentoDTO) {
    const onde = p.maquineta ? ` na maquineta ${p.maquineta.nome}` : '';
    aoPago(`Conta da ${nomeDaMesa(mesa)} recebida: ${formatarMoeda(p.valor)} em ${p.formaPagamento}${onde}.`);
    aoFechar();
  }

  function tratar(p: PagamentoDTO) {
    if (p.status === 'APROVADO') {
      concluir(p);
    } else if (p.status === 'PENDENTE') {
      setPagamento(p);
    } else {
      setPagamento(null);
      setErro(p.mensagem ?? 'O pagamento não foi concluído. A conta continua aberta.');
      conta.recarregar();
    }
  }

  // Maquineta automática: pergunta à maquineta até ela responder.
  const acompanhando = pagamento?.status === 'PENDENTE' && pagamento.maquineta?.integracao === 'AUTOMATICA';
  const pagamentoId = pagamento?.id;
  useEffect(() => {
    if (!acompanhando || pagamentoId === undefined) return;
    let vivo = true;
    const intervalo = window.setInterval(() => {
      api
        .get<PagamentoDTO>(`/pagamentos/${pagamentoId}`)
        .then((p) => {
          if (vivo) tratar(p);
        })
        .catch((e) => {
          if (vivo) setErro(mensagemErro(e));
        });
    }, INTERVALO_MAQUINETA_MS);
    return () => {
      vivo = false;
      window.clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acompanhando, pagamentoId]);

  async function executar(acao: () => Promise<PagamentoDTO>) {
    setErro(null);
    setEnviando(true);
    try {
      tratar(await acao());
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  function cobrar(e: FormEvent) {
    e.preventDefault();
    if (!forma) {
      setErro('Escolha a forma de pagamento.');
      return;
    }
    void executar(() =>
      api.post<PagamentoDTO>(`/mesas/${mesa.id}/cobrar`, {
        formaPagamento: forma,
        maquinetaId: usaMaquineta && escolhida ? Number(escolhida) : null,
      }),
    );
  }

  const pedidos = conta.dados?.pedidos ?? [];
  const pendentes = pedidos.filter((p) => p.status !== 'ENTREGUE').length;
  const carregando = conta.carregando || (maquinetas.carregando && !maquinetas.dados);

  return (
    <Modal aberto titulo={`Conta · ${nomeDaMesa(mesa)}`} aoFechar={aoFechar}>
      {conta.erro && <Aviso tipo="erro">{conta.erro}</Aviso>}
      {carregando && !conta.dados && <Carregando />}
      {conta.dados && pedidos.length === 0 && !pagamento && (
        <p className="fila-vazia">Esta mesa não tem conta aberta.</p>
      )}

      {conta.dados && pedidos.length > 0 && (
        <>
          {pedidos.map((p) => (
            <div className="conta-pedido" key={p.id}>
              <div className="conta-pedido-topo">
                <span>
                  Pedido #{p.id} · {horaCurta(p.criadoEm)}
                  {p.nomeCliente ? ` · ${p.nomeCliente}` : ''}
                </span>
                <SeloStatus status={p.status} />
              </div>
              <ListaItens pedido={p} comValor />
            </div>
          ))}
          <div className="conta-total">
            <span>Total da conta</span>
            <strong>{formatarMoeda(pagamento?.valor ?? conta.dados.total)}</strong>
          </div>
        </>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {/* Passo 1: escolher como o cliente vai pagar. */}
      {conta.dados && pedidos.length > 0 && !pagamento && (
        <form onSubmit={cobrar}>
          {pendentes > 0 && (
            <Aviso tipo="info">
              {pendentes === 1
                ? 'Há 1 pedido que ainda não foi entregue. Ao receber a conta ele é dado como entregue.'
                : `Há ${pendentes} pedidos que ainda não foram entregues. Ao receber a conta eles são dados como entregues.`}
            </Aviso>
          )}
          <Selecao
            rotulo="Forma de pagamento"
            valor={forma}
            aoMudar={setForma}
            obrigatorio
            opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: f }))}
          />
          {usaMaquineta && (
            <Selecao
              rotulo="Maquineta"
              valor={escolhida}
              aoMudar={setMaquinetaId}
              vazio="Sem maquineta (só registrar o recebimento)"
              opcoes={disponiveis.map((m) => ({
                valor: String(m.id),
                rotulo: `${m.nome} · ${rotuloOperadora(m.operadora)}${m.integracao === 'AUTOMATICA' ? ' · automática' : ''}`,
              }))}
            />
          )}
          {forma !== '' && forma !== 'Dinheiro' && maquinetas.dados && disponiveis.length === 0 && (
            <Aviso tipo="info">
              Nenhuma maquineta disponível para você. O recebimento será só registrado. O gestor cadastra as maquinetas
              em Maquinetas.
            </Aviso>
          )}
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Enviando...' : usaMaquineta && escolhida ? 'Cobrar na maquineta' : 'Receber e fechar conta'}
          </Botao>{' '}
          <Botao variante="secundario" aoClicar={aoFechar}>
            Voltar
          </Botao>
        </form>
      )}

      {/* Passo 2: cobrança em andamento na maquineta. */}
      {pagamento && pagamento.status === 'PENDENTE' && (
        <div className="cobranca">
          <p className="cobranca-titulo">
            {formatarMoeda(pagamento.valor)} em {pagamento.formaPagamento}
            {pagamento.maquineta ? ` · ${pagamento.maquineta.nome}` : ''}
          </p>
          {acompanhando ? (
            <>
              <div className="cobranca-espera" role="status">
                <span className="cobranca-pulso" aria-hidden="true" />
                {pagamento.mensagem ?? 'Aguardando a maquineta.'}
              </div>
              <Botao
                variante="secundario"
                desabilitado={enviando}
                aoClicar={() => void executar(() => api.post<PagamentoDTO>(`/pagamentos/${pagamento.id}/cancelar`, {}))}
              >
                Cancelar cobrança
              </Botao>
            </>
          ) : (
            <>
              <Aviso tipo="info">{pagamento.mensagem ?? 'Passe o valor na maquineta e confirme aqui.'}</Aviso>
              <Campo rotulo="Código do comprovante (opcional)" valor={codigo} aoMudar={setCodigo} />
              <div className="cobranca-acoes">
                <Botao
                  desabilitado={enviando}
                  aoClicar={() =>
                    void executar(() =>
                      api.post<PagamentoDTO>(`/pagamentos/${pagamento.id}/confirmar`, {
                        codigoAutorizacao: codigo.trim() || null,
                      }),
                    )
                  }
                >
                  Pagamento aprovado
                </Botao>
                <Botao
                  variante="secundario"
                  desabilitado={enviando}
                  aoClicar={() =>
                    void executar(() => api.post<PagamentoDTO>(`/pagamentos/${pagamento.id}/cancelar`, { recusado: true }))
                  }
                >
                  Não aprovou
                </Botao>
                <Botao
                  variante="texto"
                  desabilitado={enviando}
                  aoClicar={() => void executar(() => api.post<PagamentoDTO>(`/pagamentos/${pagamento.id}/cancelar`, {}))}
                >
                  Cancelar cobrança
                </Botao>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
