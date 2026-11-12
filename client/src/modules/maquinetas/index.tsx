import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { OPERADORAS, mensagemErro, rotuloOperadora } from '../../lib/restaurante';
import type {
  IntegracaoMaquineta,
  MaquinetaDTO,
  MaquinetasDTO,
  OperadoraMaquineta,
  VinculoMaquineta,
} from '../../lib/restaurante';
import {
  Aviso,
  Botao,
  Caixa,
  Campo,
  Carregando,
  Cartao,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
} from '../../ui';
import { Indicador } from '../pedidos/comum';

interface GarcomLista {
  id: number;
  nome: string;
  perfil: string;
  ativo: boolean;
}

const VINCULOS: { valor: VinculoMaquineta; titulo: string; texto: string }[] = [
  {
    valor: 'POR_GARCOM',
    titulo: 'Cada garçom tem a sua',
    texto: 'Cada maquineta tem um dono. O garçom só cobra na dele, e tudo que passa nela conta para ele.',
  },
  {
    valor: 'COMPARTILHADA',
    titulo: 'Maquinetas compartilhadas',
    texto: 'Qualquer garçom usa qualquer maquineta. O recebimento conta para quem cobrou a conta.',
  },
];

// ---------- Cadastro ----------

function FormMaquineta({
  maquineta,
  garcons,
  tokenDefinido,
  aoFechar,
  aoSalvo,
}: {
  maquineta: MaquinetaDTO | null;
  garcons: GarcomLista[];
  tokenDefinido: boolean;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(maquineta?.nome ?? '');
  const [operadora, setOperadora] = useState<string>(maquineta?.operadora ?? '');
  const [integracao, setIntegracao] = useState<string>(maquineta?.integracao ?? 'MANUAL');
  const [identificador, setIdentificador] = useState(maquineta?.identificador ?? '');
  const [garcomId, setGarcomId] = useState(maquineta?.garcomId ? String(maquineta.garcomId) : '');
  const [ativa, setAtiva] = useState(maquineta?.ativa ?? true);
  const [terminais, setTerminais] = useState<{ id: string; modo: string }[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const dados = OPERADORAS.find((o) => o.valor === operadora);
  const podeAutomatica = dados?.automatica === true;
  const automatica = podeAutomatica && integracao === 'AUTOMATICA';

  async function buscarTerminais() {
    setErro(null);
    setBuscando(true);
    try {
      const lista = await api.get<{ id: string; modo: string }[]>('/maquinetas/terminais-mercado-pago');
      setTerminais(lista);
      if (lista.length === 0) setErro('A conta do Mercado Pago não tem nenhuma maquineta Point.');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setBuscando(false);
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!operadora) {
      setErro('Escolha a operadora.');
      return;
    }
    setEnviando(true);
    try {
      const corpo = {
        nome: nome.trim(),
        operadora: operadora as OperadoraMaquineta,
        integracao: (automatica ? 'AUTOMATICA' : 'MANUAL') as IntegracaoMaquineta,
        identificador: identificador.trim() || null,
        garcomId: garcomId ? Number(garcomId) : null,
        ativa,
      };
      if (maquineta) {
        await api.put(`/maquinetas/${maquineta.id}`, corpo);
        aoSalvo('Maquineta atualizada.');
      } else {
        await api.post('/maquinetas', corpo);
        aoSalvo('Maquineta cadastrada.');
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={maquineta ? 'Editar maquineta' : 'Nova maquineta'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome (ex.: Maquineta da Ana, Caixa)" valor={nome} aoMudar={setNome} obrigatorio />
        <Selecao
          rotulo="Operadora"
          valor={operadora}
          aoMudar={setOperadora}
          obrigatorio
          opcoes={OPERADORAS.map((o) => ({ valor: o.valor, rotulo: o.rotulo }))}
        />
        {operadora && (
          <Selecao
            rotulo="Como o sistema fala com a maquineta"
            valor={automatica ? 'AUTOMATICA' : 'MANUAL'}
            aoMudar={setIntegracao}
            opcoes={[
              { valor: 'MANUAL', rotulo: 'Manual: o garçom passa o valor e confirma no sistema' },
              ...(podeAutomatica
                ? [{ valor: 'AUTOMATICA', rotulo: 'Automática: o sistema manda o valor para a maquineta' }]
                : []),
            ]}
          />
        )}
        {operadora && !podeAutomatica && (
          <Aviso tipo="info">
            Para {rotuloOperadora(operadora)} a integração é manual: o garçom digita o valor na maquineta e confirma no
            sistema. O recebimento fica registrado na maquineta e no nome do garçom do mesmo jeito.
          </Aviso>
        )}
        {operadora === 'SIMULADA' && (
          <Aviso tipo="info">
            Maquineta de teste: aprova sozinha alguns segundos depois da cobrança. Para testar uma recusa, escreva
            RECUSAR no identificador.
          </Aviso>
        )}
        {operadora === 'MERCADO_PAGO' && automatica && (
          <>
            {!tokenDefinido && (
              <Aviso tipo="erro">Falta o token do Mercado Pago. Informe na tela de Maquinetas antes de cobrar.</Aviso>
            )}
            {terminais && terminais.length > 0 ? (
              <Selecao
                rotulo="Terminal Point"
                valor={identificador}
                aoMudar={setIdentificador}
                obrigatorio
                opcoes={terminais.map((t) => ({ valor: t.id, rotulo: t.modo ? `${t.id} (${t.modo})` : t.id }))}
              />
            ) : (
              <Campo rotulo="Identificador do terminal Point" valor={identificador} aoMudar={setIdentificador} />
            )}
            <p>
              <Botao variante="secundario" desabilitado={buscando || !tokenDefinido} aoClicar={() => void buscarTerminais()}>
                {buscando ? 'Buscando...' : 'Buscar terminais na conta do Mercado Pago'}
              </Botao>
            </p>
            <Aviso tipo="info">
              A maquineta precisa estar no modo PDV (ponto de venda integrado) no Mercado Pago para receber a cobrança
              do sistema.
            </Aviso>
          </>
        )}
        {operadora && !(operadora === 'MERCADO_PAGO' && automatica) && (
          <Campo
            rotulo="Número de série ou identificação (opcional)"
            valor={identificador}
            aoMudar={setIdentificador}
          />
        )}
        <Selecao
          rotulo="Garçom dono da maquineta"
          valor={garcomId}
          aoMudar={setGarcomId}
          vazio="Sem dono"
          opcoes={garcons.filter((g) => g.ativo).map((g) => ({ valor: String(g.id), rotulo: g.nome }))}
        />
        {maquineta && <Caixa rotulo="Maquineta ativa" marcado={ativa} aoMudar={setAtiva} />}
        <Botao tipo="submit" desabilitado={enviando}>
          Salvar
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// ---------- Token do Mercado Pago ----------

function TokenMercadoPago({ definido, aoSalvo }: { definido: boolean; aoSalvo: (mensagem: string) => void }) {
  const [token, setToken] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gravar(valor: string, mensagem: string) {
    setErro(null);
    setEnviando(true);
    try {
      await api.put('/maquinetas/configuracao', { mercadoPagoToken: valor });
      setToken('');
      aoSalvo(mensagem);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Mercado Pago Point (integração automática)">
      <p className="maquinetas-texto">
        Para o sistema mandar o valor direto para a maquineta Point, informe o token de acesso (Access Token) da sua
        conta do Mercado Pago. Ele fica guardado cifrado e não aparece mais na tela.{' '}
        {definido ? <Selo cor="verde">Token gravado</Selo> : <Selo cor="cinza">Sem token</Selo>}
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo={definido ? 'Trocar o token' : 'Token de acesso'} tipo="password" valor={token} aoMudar={setToken} />
      <Botao desabilitado={enviando || token.trim() === ''} aoClicar={() => void gravar(token.trim(), 'Token gravado.')}>
        Gravar token
      </Botao>{' '}
      {definido && (
        <Botao variante="texto" desabilitado={enviando} aoClicar={() => void gravar('', 'Token apagado.')}>
          Apagar token
        </Botao>
      )}
    </Cartao>
  );
}

// ---------- Tela ----------

export function Maquinetas() {
  const dados = useDados<MaquinetasDTO>('/maquinetas');
  const usuarios = useDados<GarcomLista[]>('/usuarios');
  const [form, setForm] = useState<{ maquineta: MaquinetaDTO | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const lista = dados.dados?.maquinetas ?? [];
  const vinculo = dados.dados?.vinculo;

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErroAcao(null);
    setAviso(null);
    try {
      await acao();
      setAviso(mensagem);
      dados.recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  const semDono = vinculo === 'POR_GARCOM' ? lista.filter((m) => m.ativa && !m.garcom).length : 0;

  return (
    <Pagina titulo="Maquinetas" acoes={<Botao aoClicar={() => setForm({ maquineta: null })}>Nova maquineta</Botao>}>
      {dados.erro && <Aviso tipo="erro">{dados.erro}</Aviso>}
      {dados.carregando && !dados.dados && <Carregando />}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados.dados && (
        <>
          <div className="resumo">
            <Indicador rotulo="Maquinetas ativas" valor={String(lista.filter((m) => m.ativa).length)} cor="azul" icone="financeiro" />
            <Indicador
              rotulo="Com integração automática"
              valor={String(lista.filter((m) => m.ativa && m.integracao === 'AUTOMATICA').length)}
              cor="verde"
              icone="raio"
            />
            <Indicador
              rotulo="Com garçom dono"
              valor={String(lista.filter((m) => m.ativa && m.garcom).length)}
              cor="roxo"
              icone="usuarios"
            />
          </div>

          <Cartao titulo="Como as maquinetas se ligam aos garçons">
            <div className="maquinetas-vinculos" role="radiogroup" aria-label="Como as maquinetas se ligam aos garçons">
              {VINCULOS.map((v) => (
                <button
                  key={v.valor}
                  type="button"
                  role="radio"
                  aria-checked={vinculo === v.valor}
                  className={vinculo === v.valor ? 'maquinetas-vinculo maquinetas-vinculo-ativo' : 'maquinetas-vinculo'}
                  onClick={() => {
                    if (vinculo === v.valor) return;
                    void executar(() => api.put('/maquinetas/configuracao', { vinculo: v.valor }), `Modo alterado: ${v.titulo.toLowerCase()}.`);
                  }}
                >
                  <strong>{v.titulo}</strong>
                  <span>{v.texto}</span>
                </button>
              ))}
            </div>
            {semDono > 0 && (
              <Aviso tipo="info">
                {semDono === 1
                  ? 'Há 1 maquineta ativa sem dono. Neste modo, só o gestor consegue cobrar nela.'
                  : `Há ${semDono} maquinetas ativas sem dono. Neste modo, só o gestor consegue cobrar nelas.`}
              </Aviso>
            )}
          </Cartao>

          <Tabela
            dados={lista}
            chave={(m) => m.id}
            vazio='Nenhuma maquineta cadastrada. Sem maquineta, o recebimento da conta é só registrado. Cadastre em "Nova maquineta".'
            colunas={[
              { titulo: 'Maquineta', celula: (m) => <strong>{m.nome}</strong> },
              { titulo: 'Operadora', celula: (m) => rotuloOperadora(m.operadora) },
              {
                titulo: 'Integração',
                celula: (m) =>
                  m.integracao === 'AUTOMATICA' ? <Selo cor="verde">Automática</Selo> : <Selo cor="azul">Manual</Selo>,
              },
              { titulo: 'Garçom dono', celula: (m) => m.garcom?.nome ?? 'Sem dono' },
              { titulo: 'Identificação', celula: (m) => m.identificador ?? '—' },
              { titulo: 'Situação', celula: (m) => (m.ativa ? <Selo cor="verde">Ativa</Selo> : <Selo cor="cinza">Desativada</Selo>) },
              {
                titulo: 'Ações',
                acoes: true,
                celula: (m) => (
                  <MenuAcoes
                    rotulo={`Ações da maquineta ${m.nome}`}
                    acoes={[
                      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setForm({ maquineta: m }) },
                      {
                        rotulo: m.ativa ? 'Desativar' : 'Reativar',
                        icone: m.ativa ? 'pausar' : 'reproduzir',
                        aoClicar: () =>
                          void executar(
                            () => api.put(`/maquinetas/${m.id}`, { ativa: !m.ativa }),
                            m.ativa ? 'Maquineta desativada.' : 'Maquineta reativada.',
                          ),
                      },
                      {
                        rotulo: 'Excluir',
                        icone: 'lixeira',
                        perigo: true,
                        aoClicar: () => {
                          if (!window.confirm(`Excluir a maquineta "${m.nome}"?`)) return;
                          void executar(() => api.del(`/maquinetas/${m.id}`), 'Maquineta excluída.');
                        },
                      },
                    ]}
                  />
                ),
              },
            ]}
          />

          <TokenMercadoPago
            definido={dados.dados.mercadoPagoTokenDefinido === true}
            aoSalvo={(mensagem) => {
              setAviso(mensagem);
              dados.recarregar();
            }}
          />
        </>
      )}

      {form && (
        <FormMaquineta
          maquineta={form.maquineta}
          garcons={usuarios.dados ?? []}
          tokenDefinido={dados.dados?.mercadoPagoTokenDefinido === true}
          aoFechar={() => setForm(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            dados.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/maquinetas',
    rotulo: 'Maquinetas',
    icone: 'financeiro',
    perfis: ['GESTOR'],
    elemento: <Maquinetas />,
    ordem: 30,
  },
];
