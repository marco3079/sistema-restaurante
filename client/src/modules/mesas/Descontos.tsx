import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { lerPreco, mensagemErro, precoParaCampo } from '../../lib/restaurante';
import type { ContaDTO } from '../../lib/restaurante';
import { Aviso, Botao, Campo, formatarMoeda } from '../../ui';

// Configuração da fidelidade (GET /fidelidade/configuracao).
interface FidelidadeDTO {
  ativa: boolean;
  pontosPorReal: number;
  valorDoPonto: number;
}

const ERRO_SEM_NOME = 'Informe o nome para cadastrar o cliente';

// "11999990000" → "(11) 99999-0000". Se não tiver 10 ou 11 números, mostra como veio.
export function formatarTelefone(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefone;
}

// Cupom, cliente, pontos e desconto da conta aberta. Cada ação devolve a ContaDTO
// atualizada e ela substitui a conta mostrada (aoMudar).
export function Descontos({
  mesaId,
  conta,
  aoMudar,
}: {
  mesaId: number;
  conta: ContaDTO;
  aoMudar: (nova: ContaDTO) => void;
}) {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const cliente = conta.conta?.cliente ?? null;
  const cupom = conta.conta?.cupom ?? null;
  const pontosUsados = conta.conta?.pontosUsados ?? 0;
  const descontoPontos = conta.descontoPontos ?? 0;
  const descontoManual = conta.descontoManual ?? 0;
  const fidelidade = useDados<FidelidadeDTO>(cliente ? '/fidelidade/configuracao' : null);
  const fidelidadeAtiva = cliente !== null && fidelidade.dados?.ativa === true;

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Aberto só se já houver cupom, cliente ou desconto (valor da primeira montagem).
  const [aberto] = useState(() => cupom !== null || cliente !== null || descontoManual > 0);

  const [telefone, setTelefone] = useState('');
  const [precisaNome, setPrecisaNome] = useState(false);
  const [nome, setNome] = useState('');
  const [pontosUsar, setPontosUsar] = useState('');
  const [codigo, setCodigo] = useState('');
  const [valorDesconto, setValorDesconto] = useState(descontoManual > 0 ? precoParaCampo(descontoManual) : '');
  const [motivo, setMotivo] = useState(conta.conta?.descontoMotivo ?? '');

  // Roda uma ação que devolve a conta atualizada. Erro do servidor vai para o aviso.
  async function executar(acao: () => Promise<ContaDTO>): Promise<boolean> {
    setErro(null);
    setEnviando(true);
    try {
      aoMudar(await acao());
      return true;
    } catch (e) {
      setErro(mensagemErro(e));
      return false;
    } finally {
      setEnviando(false);
    }
  }

  // A rota de DELETE não devolve a conta (api.del não lê a resposta): busca a conta de novo.
  async function apagarERecarregar(caminho: string): Promise<ContaDTO> {
    await api.del(caminho);
    return api.get<ContaDTO>(`/mesas/${mesaId}/conta`);
  }

  async function buscarCliente(nomeNovo?: string) {
    const numero = telefone.trim();
    if (numero === '') {
      setErro('Informe o telefone do cliente.');
      return;
    }
    if (nomeNovo !== undefined && nomeNovo.trim() === '') {
      setErro('Informe o nome do cliente.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const corpo = nomeNovo === undefined ? { telefone: numero } : { telefone: numero, nome: nomeNovo.trim() };
      aoMudar(await api.put<ContaDTO>(`/mesas/${mesaId}/conta/cliente`, corpo));
      setTelefone('');
      setNome('');
      setPrecisaNome(false);
    } catch (e) {
      const texto = mensagemErro(e);
      if (texto === ERRO_SEM_NOME && nomeNovo === undefined) {
        setPrecisaNome(true);
      } else {
        setErro(texto);
      }
    } finally {
      setEnviando(false);
    }
  }

  async function usarPontos() {
    const quantos = /^\d+$/.test(pontosUsar) ? Number(pontosUsar) : 0;
    if (quantos < 1) {
      setErro('Informe quantos pontos usar, por exemplo 100.');
      return;
    }
    if (await executar(() => api.post<ContaDTO>(`/mesas/${mesaId}/conta/pontos`, { pontos: quantos }))) {
      setPontosUsar('');
    }
  }

  async function aplicarCupom() {
    const texto = codigo.trim();
    if (texto === '') {
      setErro('Informe o código do cupom.');
      return;
    }
    if (await executar(() => api.post<ContaDTO>(`/mesas/${mesaId}/conta/cupom`, { codigo: texto }))) {
      setCodigo('');
    }
  }

  async function aplicarDesconto() {
    const texto = valorDesconto.trim();
    let valor = 0;
    if (texto !== '') {
      const numero = lerPreco(texto);
      if (numero === null) {
        setErro('Informe o desconto em reais, por exemplo 5,00.');
        return;
      }
      valor = numero;
    }
    const motivoLimpo = motivo.trim();
    await executar(() =>
      api.put<ContaDTO>(`/mesas/${mesaId}/conta/desconto`, {
        valor,
        motivo: motivoLimpo === '' ? undefined : motivoLimpo,
      }),
    );
  }

  const pontosNum = /^\d+$/.test(pontosUsar) ? Number(pontosUsar) : 0;
  const valorDoPonto = fidelidade.dados?.valorDoPonto ?? 0;

  return (
    <fieldset className="ficha-grupo mesas-descontos">
      <details open={aberto}>
        <summary>Descontos e cliente</summary>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {/* Cliente */}
        <div className="mesas-bloco">
          <p className="mesas-subtitulo">Cliente</p>
          {cliente ? (
            <div className="mesas-linha">
              <span className="mesas-texto">
                Cliente: {cliente.nome} · {formatarTelefone(cliente.telefone)} · {cliente.pontos} pontos
              </span>
              <Botao
                variante="texto"
                desabilitado={enviando}
                aoClicar={() =>
                  void executar(() => api.put<ContaDTO>(`/mesas/${mesaId}/conta/cliente`, { telefone: null }))
                }
              >
                Tirar
              </Botao>
            </div>
          ) : (
            <>
              <Campo
                rotulo="Telefone do cliente"
                valor={telefone}
                aoMudar={(v) => {
                  setTelefone(v);
                  setPrecisaNome(false);
                }}
              />
              {precisaNome && (
                <>
                  <Aviso tipo="info">Cliente novo. Informe o nome para cadastrar.</Aviso>
                  <Campo rotulo="Nome" valor={nome} aoMudar={setNome} />
                </>
              )}
              <div className="mesas-linha">
                <Botao
                  variante="secundario"
                  desabilitado={enviando}
                  aoClicar={() => void buscarCliente(precisaNome ? nome : undefined)}
                >
                  {precisaNome ? 'Cadastrar e ligar à conta' : 'Buscar'}
                </Botao>
              </div>
            </>
          )}
        </div>

        {/* Pontos de fidelidade */}
        {cliente && pontosUsados > 0 && (
          <div className="mesas-bloco">
            <div className="mesas-linha">
              <span className="mesas-texto">
                {pontosUsados} pontos usados (− {formatarMoeda(descontoPontos)})
              </span>
              <Botao
                variante="secundario"
                desabilitado={enviando}
                aoClicar={() =>
                  void executar(() => apagarERecarregar(`/mesas/${mesaId}/conta/pontos`))
                }
              >
                Devolver
              </Botao>
            </div>
          </div>
        )}
        {fidelidadeAtiva && (
          <div className="mesas-bloco">
            <Campo rotulo="Usar pontos" tipo="number" valor={pontosUsar} aoMudar={setPontosUsar} />
            {pontosNum > 0 && (
              <p className="mesas-texto-suave">
                {pontosNum} pontos valem {formatarMoeda(Math.round(pontosNum * valorDoPonto * 100) / 100)}
              </p>
            )}
            <div className="mesas-linha">
              <Botao variante="secundario" desabilitado={enviando} aoClicar={() => void usarPontos()}>
                Usar
              </Botao>
            </div>
          </div>
        )}

        {/* Cupom */}
        <div className="mesas-bloco">
          <p className="mesas-subtitulo">Cupom</p>
          {cupom ? (
            <div className="mesas-linha">
              <span className="mesas-texto">Cupom {cupom.codigo} aplicado</span>
              <Botao
                variante="texto"
                desabilitado={enviando}
                aoClicar={() => void executar(() => apagarERecarregar(`/mesas/${mesaId}/conta/cupom`))}
              >
                Tirar
              </Botao>
            </div>
          ) : (
            <>
              <Campo rotulo="Código do cupom" valor={codigo} aoMudar={setCodigo} />
              <div className="mesas-linha">
                <Botao variante="secundario" desabilitado={enviando} aoClicar={() => void aplicarCupom()}>
                  Aplicar
                </Botao>
              </div>
            </>
          )}
        </div>

        {/* Desconto do gestor */}
        {gestor && (
          <div className="mesas-bloco">
            <p className="mesas-subtitulo">Desconto do gestor</p>
            <Campo rotulo="Desconto (R$)" valor={valorDesconto} aoMudar={setValorDesconto} />
            <Campo rotulo="Motivo" valor={motivo} aoMudar={setMotivo} />
            <div className="mesas-linha">
              <Botao variante="secundario" desabilitado={enviando} aoClicar={() => void aplicarDesconto()}>
                Aplicar
              </Botao>
            </div>
          </div>
        )}
      </details>
    </fieldset>
  );
}
