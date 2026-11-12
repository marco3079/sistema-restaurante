import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { usePlataforma } from '../../lib/plataforma';
import { imprimirComprovante, imprimirConta } from '../../lib/imprimir';
import {
  FORMAS_PAGAMENTO,
  STATUS_NOTA,
  formatarDocumento,
  horaCurta,
  lerPreco,
  mensagemErro,
  nomeDaMesa,
  precoParaCampo,
  rotuloOperadora,
} from '../../lib/restaurante';
import type { ContaDTO, MaquinetasDTO, MesaDTO, NotaDTO, PagamentoDTO } from '../../lib/restaurante';
import { Aviso, Botao, Caixa, Campo, Carregando, Modal, Selecao, Selo, formatarMoeda } from '../../ui';
import { ListaItens, SeloStatus } from '../pedidos/comum';

const INTERVALO_MAQUINETA_MS = 2000;

// QR code do Pix copia e cola.
function QrDoPix({ codigo }: { codigo: string }) {
  const [imagem, setImagem] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(codigo, { width: 440, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (vivo) setImagem(url);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [codigo]);

  return (
    <div className="qr">
      {imagem ? <img className="qr-imagem" src={imagem} alt="QR code do Pix" /> : <Carregando />}
      <p className="qr-endereco">{codigo}</p>
      <Botao
        variante="secundario"
        aoClicar={() => {
          navigator.clipboard
            .writeText(codigo)
            .then(() => setCopiado(true))
            .catch(() => undefined);
        }}
      >
        {copiado ? 'Código copiado' : 'Copiar o Pix copia e cola'}
      </Botao>
    </div>
  );
}

// Conta da mesa: taxa de serviço, pagamento em partes (para dividir entre pessoas ou formas),
// gorjeta, Pix com QR code, maquineta, impressão e nota fiscal.
export function ContaDaMesa({
  mesa,
  aoFechar,
  aoPago,
}: {
  mesa: MesaDTO;
  aoFechar: () => void;
  aoPago: (mensagem: string) => void;
}) {
  const { plataforma } = usePlataforma();
  const conta = useDados<ContaDTO>(`/mesas/${mesa.id}/conta`);
  const maquinetas = useDados<MaquinetasDTO>('/maquinetas');
  const [forma, setForma] = useState('');
  const [maquinetaId, setMaquinetaId] = useState<string | null>(null);
  // Valor desta cobrança. Vazio = tudo o que falta.
  const [valor, setValor] = useState('');
  const [gorjeta, setGorjeta] = useState('');
  const [pessoas, setPessoas] = useState('');
  const [documento, setDocumento] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<PagamentoDTO | null>(null);
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Conta já quitada: guarda o retrato dela para imprimir o comprovante e emitir a nota.
  const [fechada, setFechada] = useState<ContaDTO | null>(null);
  const [nota, setNota] = useState<NotaDTO | null>(null);

  const dados = conta.dados;
  const disponiveis = maquinetas.dados?.maquinetas.filter((m) => m.ativa) ?? [];
  const usaMaquineta = forma !== '' && forma !== 'Dinheiro' && disponiveis.length > 0;
  // Com uma só maquineta disponível, ela já vem escolhida (menos no Pix com a chave do restaurante).
  const pixDoRestaurante = forma === 'Pix' && maquinetas.dados?.pixAtivo === true;
  const escolhida = maquinetaId ?? (disponiveis.length === 1 && !pixDoRestaurante ? String(disponiveis[0].id) : '');

  // Retoma a cobrança que já estava em andamento nesta mesa.
  useEffect(() => {
    if (dados?.pagamentoPendente && !pagamento) setPagamento(dados.pagamentoPendente);
  }, [dados, pagamento]);

  async function aposPagamento(p: PagamentoDTO) {
    setPagamento(null);
    setValor('');
    setPessoas('');
    setGorjeta('');
    setCodigo('');
    // Retrato de antes da resposta, para o comprovante (depois de fechar, a conta some da mesa).
    const antes = dados;
    try {
      const agora = await api.get<ContaDTO>(`/mesas/${mesa.id}/conta`);
      if (agora.conta === null && antes) {
        // Quitou: a conta fechou e a mesa foi para a limpeza.
        setFechada({
          ...antes,
          pago: antes.total,
          restante: 0,
          gorjetas: antes.gorjetas + p.gorjeta,
          pagamentos: [...antes.pagamentos, p],
          pagamentoPendente: null,
        });
        aoPago(`Conta da ${nomeDaMesa(mesa)} recebida: ${formatarMoeda(antes.total)}.`);
      } else {
        setAviso(`Recebido ${formatarMoeda(p.valor)} em ${p.formaPagamento}. Falta ${formatarMoeda(agora.restante)}.`);
        conta.recarregar();
      }
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function tratar(p: PagamentoDTO) {
    if (p.status === 'APROVADO') {
      void aposPagamento(p);
    } else if (p.status === 'PENDENTE') {
      setPagamento(p);
    } else {
      setPagamento(null);
      setErro(p.mensagem ?? 'O pagamento não foi concluído. A parte dele continua em aberto.');
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
    setAviso(null);
    setEnviando(true);
    try {
      tratar(await acao());
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function mudarConta(corpo: { taxaServico?: boolean; cpfCnpjCliente?: string | null }, mensagem: string) {
    setErro(null);
    setAviso(null);
    try {
      await api.put(`/mesas/${mesa.id}/conta`, corpo);
      setAviso(mensagem);
      setValor('');
      setPessoas('');
      conta.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function cobrar(e: FormEvent) {
    e.preventDefault();
    if (!dados) return;
    if (!forma) {
      setErro('Escolha a forma de pagamento.');
      return;
    }
    const parte = valor.trim() === '' ? dados.restante : lerPreco(valor);
    if (parte === null || parte <= 0) {
      setErro('Informe o valor a cobrar, por exemplo 45,00.');
      return;
    }
    if (parte > dados.restante + 0.001) {
      setErro(`O valor é maior do que o que falta (${formatarMoeda(dados.restante)}). Para dar a mais, use a gorjeta.`);
      return;
    }
    const extra = gorjeta.trim() === '' ? 0 : lerPreco(gorjeta);
    if (extra === null) {
      setErro('Informe a gorjeta em reais, por exemplo 5,00.');
      return;
    }
    void executar(() =>
      api.post<PagamentoDTO>(`/mesas/${mesa.id}/cobrar`, {
        formaPagamento: forma,
        maquinetaId: usaMaquineta && escolhida ? Number(escolhida) : null,
        valor: parte,
        gorjeta: extra,
      }),
    );
  }

  // Divide o que falta por N pessoas e preenche o valor da próxima cobrança.
  function dividirPor(n: number) {
    if (!dados || n < 1) return;
    setPessoas(String(n));
    setValor(precoParaCampo(n === 1 ? dados.restante : Math.ceil((dados.restante / n) * 100) / 100));
  }

  async function emitirNota() {
    if (!fechada?.conta) return;
    setErro(null);
    setEnviando(true);
    try {
      setNota(await api.post<NotaDTO>(`/contas/${fechada.conta.id}/nota`));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const pedidos = (fechada ?? dados)?.pedidos ?? [];
  const exibida = fechada ?? dados;
  const pendentes = pedidos.filter((p) => p.status !== 'ENTREGUE').length;
  const carregando = conta.carregando || (maquinetas.carregando && !maquinetas.dados);
  const percentual = exibida?.conta?.taxaPercentual ?? 0;
  const doc = documento ?? formatarDocumento(exibida?.conta?.cpfCnpjCliente ?? null);
  const numeroDePessoas = /^\d+$/.test(pessoas) ? Number(pessoas) : 0;

  return (
    <Modal aberto titulo={`Conta · ${nomeDaMesa(mesa)}`} aoFechar={aoFechar}>
      {conta.erro && <Aviso tipo="erro">{conta.erro}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && pedidos.length === 0 && !pagamento && !fechada && (
        <p className="fila-vazia">Esta mesa não tem conta aberta.</p>
      )}

      {exibida && pedidos.length > 0 && (
        <>
          {pedidos.map((p) => (
            <div className="conta-pedido" key={p.id}>
              <div className="conta-pedido-topo">
                <span>
                  Pedido #{p.id} · {horaCurta(p.criadoEm)}
                  {p.nomeCliente ? ` · ${p.nomeCliente}` : ''}
                </span>
                {!fechada && <SeloStatus status={p.status} />}
              </div>
              <ListaItens pedido={p} comValor />
            </div>
          ))}

          <dl className="conta-valores">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatarMoeda(exibida.subtotal)}</dd>
            </div>
            {exibida.taxa > 0 && (
              <div>
                <dt>Taxa de serviço ({percentual}%)</dt>
                <dd>{formatarMoeda(exibida.taxa)}</dd>
              </div>
            )}
            <div className="conta-valores-total">
              <dt>Total</dt>
              <dd>{formatarMoeda(exibida.total)}</dd>
            </div>
            {exibida.pagamentos.map((p) => (
              <div key={p.id} className="conta-valores-pago">
                <dt>
                  Pago em {p.formaPagamento}
                  {p.maquineta ? ` (${p.maquineta.nome})` : ''}
                  {p.gorjeta > 0 ? ` + gorjeta de ${formatarMoeda(p.gorjeta)}` : ''}
                </dt>
                <dd>− {formatarMoeda(p.valor)}</dd>
              </div>
            ))}
          </dl>

          {!fechada && (
            <div className="conta-total">
              <span>{exibida.pago > 0 ? 'Falta pagar' : 'Total da conta'}</span>
              <strong>{formatarMoeda(exibida.restante)}</strong>
            </div>
          )}
        </>
      )}

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {/* Conta quitada: comprovante e nota fiscal. */}
      {fechada && (
        <div className="cobranca">
          <Aviso tipo="sucesso">
            Conta recebida: {formatarMoeda(fechada.total)}
            {fechada.gorjetas > 0 ? `, mais ${formatarMoeda(fechada.gorjetas)} de gorjeta` : ''}. A mesa foi para a
            limpeza.
          </Aviso>
          {nota && (
            <Aviso tipo={nota.status === 'AUTORIZADA' ? 'sucesso' : nota.status === 'PROCESSANDO' ? 'info' : 'erro'}>
              Nota fiscal: <Selo cor={STATUS_NOTA[nota.status].cor}>{STATUS_NOTA[nota.status].rotulo}</Selo>
              {nota.numero ? ` · nº ${nota.numero}` : ''}
              {nota.mensagem ? ` · ${nota.mensagem}` : ''}
              {nota.urlDanfe && (
                <>
                  {' · '}
                  <a href={nota.urlDanfe} target="_blank" rel="noreferrer">
                    Abrir a nota
                  </a>
                </>
              )}
            </Aviso>
          )}
          <div className="cobranca-acoes">
            <Botao
              aoClicar={() =>
                imprimirComprovante(fechada, fechada.pagamentos, plataforma.nome, formatarDocumento(fechada.conta?.cpfCnpjCliente ?? null))
              }
            >
              Imprimir comprovante
            </Botao>
            {maquinetas.dados?.notaFiscalAtiva && (!nota || nota.status === 'ERRO' || nota.status === 'REJEITADA') && (
              <Botao variante="secundario" desabilitado={enviando} aoClicar={() => void emitirNota()}>
                {enviando ? 'Emitindo...' : nota ? 'Tentar a nota de novo' : 'Emitir nota fiscal'}
              </Botao>
            )}
            <Botao variante="secundario" aoClicar={aoFechar}>
              Fechar
            </Botao>
          </div>
        </div>
      )}

      {/* Passo 1: ajustar a conta e escolher como o cliente vai pagar. */}
      {dados && dados.conta && pedidos.length > 0 && !pagamento && !fechada && (
        <form onSubmit={cobrar}>
          {pendentes > 0 && (
            <Aviso tipo="info">
              {pendentes === 1
                ? 'Há 1 pedido que ainda não foi entregue. Quando a conta for quitada ele é dado como entregue.'
                : `Há ${pendentes} pedidos que ainda não foram entregues. Quando a conta for quitada eles são dados como entregues.`}
            </Aviso>
          )}

          {dados.conta.taxaPercentual > 0 && (
            <Caixa
              rotulo={`Cobrar a taxa de serviço (${dados.conta.taxaPercentual}%)`}
              marcado={dados.conta.taxaServico}
              aoMudar={(marcado) =>
                void mudarConta(
                  { taxaServico: marcado },
                  marcado ? 'Taxa de serviço incluída.' : 'Taxa de serviço tirada da conta.',
                )
              }
            />
          )}

          <fieldset className="ficha-grupo">
            <legend>Dividir a conta</legend>
            <div className="conta-dividir" role="group" aria-label="Dividir o que falta">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="segmentado-item"
                  aria-pressed={numeroDePessoas === n}
                  onClick={() => dividirPor(n)}
                >
                  {n === 1 ? 'Tudo' : `÷ ${n}`}
                </button>
              ))}
              <Campo rotulo="Outro número de pessoas" tipo="number" valor={pessoas} aoMudar={(v) => {
                setPessoas(v);
                if (/^\d+$/.test(v) && Number(v) >= 1) dividirPor(Number(v));
              }} />
            </div>
            <Campo
              rotulo={`Valor desta cobrança (falta ${formatarMoeda(dados.restante)}; em branco cobra tudo)`}
              valor={valor}
              aoMudar={setValor}
            />
          </fieldset>

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
              vazio={pixDoRestaurante ? 'Sem maquineta (QR code do Pix do restaurante)' : 'Sem maquineta (só registrar o recebimento)'}
              opcoes={disponiveis.map((m) => ({
                valor: String(m.id),
                rotulo: `${m.nome} · ${rotuloOperadora(m.operadora)}${m.integracao === 'AUTOMATICA' ? ' · automática' : ''}`,
              }))}
            />
          )}
          {pixDoRestaurante && !escolhida && (
            <Aviso tipo="info">O sistema vai mostrar o QR code do Pix com o valor. Você confirma quando o Pix cair.</Aviso>
          )}
          <Campo rotulo="Gorjeta além da conta (opcional)" valor={gorjeta} aoMudar={setGorjeta} />
          <Campo
            rotulo="CPF ou CNPJ na nota (opcional)"
            valor={doc}
            aoMudar={setDocumento}
          />
          {documento !== null && documento.replace(/\D/g, '') !== (dados.conta.cpfCnpjCliente ?? '') && (
            <p>
              <Botao
                variante="secundario"
                aoClicar={() =>
                  void mudarConta({ cpfCnpjCliente: documento.trim() || null }, 'CPF/CNPJ gravado na conta.').then(() =>
                    setDocumento(null),
                  )
                }
              >
                Gravar CPF/CNPJ
              </Botao>
            </p>
          )}

          <div className="cobranca-acoes">
            <Botao tipo="submit" desabilitado={enviando}>
              {enviando
                ? 'Enviando...'
                : usaMaquineta && escolhida
                  ? 'Cobrar na maquineta'
                  : pixDoRestaurante
                    ? 'Gerar o QR code do Pix'
                    : 'Receber'}
            </Botao>
            <Botao
              variante="secundario"
              aoClicar={() => imprimirConta(dados, plataforma.nome, numeroDePessoas > 1 ? numeroDePessoas : undefined)}
            >
              Imprimir conta
            </Botao>
            <Botao variante="secundario" aoClicar={aoFechar}>
              Voltar
            </Botao>
          </div>
        </form>
      )}

      {/* Passo 2: cobrança em andamento (maquineta ou Pix). */}
      {pagamento && pagamento.status === 'PENDENTE' && (
        <div className="cobranca">
          <p className="cobranca-titulo">
            {formatarMoeda(pagamento.valor + pagamento.gorjeta)} em {pagamento.formaPagamento}
            {pagamento.maquineta ? ` · ${pagamento.maquineta.nome}` : ''}
            {pagamento.gorjeta > 0 ? ` (inclui ${formatarMoeda(pagamento.gorjeta)} de gorjeta)` : ''}
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
              {pagamento.pix ? (
                <QrDoPix codigo={pagamento.pix} />
              ) : (
                <Aviso tipo="info">{pagamento.mensagem ?? 'Passe o valor na maquineta e confirme aqui.'}</Aviso>
              )}
              {!pagamento.pix && (
                <Campo rotulo="Código do comprovante (opcional)" valor={codigo} aoMudar={setCodigo} />
              )}
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
                  {pagamento.pix ? 'O Pix caiu' : 'Pagamento aprovado'}
                </Botao>
                {!pagamento.pix && (
                  <Botao
                    variante="secundario"
                    desabilitado={enviando}
                    aoClicar={() =>
                      void executar(() => api.post<PagamentoDTO>(`/pagamentos/${pagamento.id}/cancelar`, { recusado: true }))
                    }
                  >
                    Não aprovou
                  </Botao>
                )}
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
