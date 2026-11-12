import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { usePlataforma } from '../../lib/plataforma';
import type { RotaModulo } from '../../lib/rotas';
import {
  FORMAS_PAGAMENTO,
  enderecoDaMesa,
  horaCurta,
  mensagemErro,
  nomeDaMesa,
  tempoDesde,
} from '../../lib/restaurante';
import type { ContaDTO, MesaDTO } from '../../lib/restaurante';
import {
  Aviso,
  Botao,
  Caixa,
  Campo,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';
import { Indicador, ListaItens, NovoPedido, SeloStatus } from '../pedidos/comum';

// ---------- Cadastro da mesa (gestor) ----------

function FormMesa({
  mesa,
  proximoNumero,
  aoFechar,
  aoSalvo,
}: {
  mesa: MesaDTO | null;
  proximoNumero: number;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [numero, setNumero] = useState(String(mesa?.numero ?? proximoNumero));
  const [nome, setNome] = useState(mesa?.nome ?? '');
  const [lugares, setLugares] = useState(String(mesa?.lugares ?? 4));
  const [ativa, setAtiva] = useState(mesa?.ativa ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = Number(numero);
    const l = Number(lugares);
    if (!Number.isInteger(n) || n < 1) {
      setErro('Informe o número da mesa.');
      return;
    }
    if (!Number.isInteger(l) || l < 1) {
      setErro('Informe quantos lugares a mesa tem.');
      return;
    }
    setEnviando(true);
    try {
      const corpo = { numero: n, nome: nome.trim() || null, lugares: l, ativa };
      if (mesa) {
        await api.put(`/mesas/${mesa.id}`, corpo);
        aoSalvo('Mesa atualizada.');
      } else {
        await api.post('/mesas', corpo);
        aoSalvo(`Mesa ${n} criada. O QR code dela já está pronto.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={mesa ? `Editar mesa ${mesa.numero}` : 'Nova mesa'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Número" tipo="number" valor={numero} aoMudar={setNumero} obrigatorio />
        <Campo rotulo="Nome ou local (opcional)" valor={nome} aoMudar={setNome} />
        <Campo rotulo="Lugares" tipo="number" valor={lugares} aoMudar={setLugares} obrigatorio />
        {mesa && <Caixa rotulo="Mesa ativa (aceita pedidos)" marcado={ativa} aoMudar={setAtiva} />}
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

// ---------- QR code da mesa ----------

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function QrDaMesa({ mesa, aoFechar }: { mesa: MesaDTO; aoFechar: () => void }) {
  const { plataforma } = usePlataforma();
  const endereco = enderecoDaMesa(mesa.codigo);
  const [imagem, setImagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(endereco, { width: 520, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (vivo) setImagem(url);
      })
      .catch(() => {
        if (vivo) setErro('Não foi possível gerar o QR code.');
      });
    return () => {
      vivo = false;
    };
  }, [endereco]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
    } catch {
      setErro('Não foi possível copiar. Selecione o endereço e copie à mão.');
    }
  }

  // Abre uma folha só com o QR code, pronta para imprimir e deixar na mesa.
  function imprimir() {
    if (!imagem) return;
    const janela = window.open('', '_blank', 'width=480,height=640');
    if (!janela) {
      setErro('O navegador bloqueou a janela de impressão.');
      return;
    }
    janela.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(nomeDaMesa(mesa))}</title>` +
        '<style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#0f172a}' +
        'h1{margin:0 0 4px;font-size:22px}h2{margin:0 0 20px;font-size:40px}img{width:320px;height:320px}' +
        'p{margin:16px 0 0;font-size:16px}</style></head><body>' +
        `<h1>${escapar(plataforma.nome)}</h1><h2>${escapar(nomeDaMesa(mesa))}</h2>` +
        `<img src="${imagem}" alt="QR code">` +
        '<p>Aponte a câmera do celular para ver o cardápio e pedir.</p>' +
        '</body></html>',
    );
    janela.document.close();
    janela.focus();
    janela.onload = () => janela.print();
  }

  return (
    <Modal aberto titulo={`QR code · ${nomeDaMesa(mesa)}`} aoFechar={aoFechar}>
      <div className="qr">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {imagem ? (
          <img className="qr-imagem" src={imagem} alt={`QR code do cardápio da ${nomeDaMesa(mesa)}`} />
        ) : (
          !erro && <Carregando />
        )}
        <p className="qr-endereco">{endereco}</p>
        <div className="qr-acoes">
          <Botao aoClicar={imprimir} desabilitado={!imagem}>
            Imprimir
          </Botao>
          <Botao variante="secundario" aoClicar={copiar}>
            {copiado ? 'Endereço copiado' : 'Copiar endereço'}
          </Botao>
          <a className="botao botao-secundario" href={endereco} target="_blank" rel="noreferrer">
            Abrir cardápio
          </a>
        </div>
        <Aviso tipo="info">
          O cliente abre este endereço pela câmera do celular. O celular dele precisa alcançar o sistema: use o
          endereço da rede do restaurante ou o endereço público do site.
        </Aviso>
      </div>
    </Modal>
  );
}

// ---------- Conta da mesa ----------

function ContaDaMesa({
  mesa,
  aoFechar,
  aoPago,
}: {
  mesa: MesaDTO;
  aoFechar: () => void;
  aoPago: (mensagem: string) => void;
}) {
  const conta = useDados<ContaDTO>(`/mesas/${mesa.id}/conta`);
  const [forma, setForma] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function fechar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!forma) {
      setErro('Escolha a forma de pagamento.');
      return;
    }
    setEnviando(true);
    try {
      const resposta = await api.post<{ total: number }>(`/mesas/${mesa.id}/fechar-conta`, {
        formaPagamento: forma,
      });
      aoPago(`Conta da ${nomeDaMesa(mesa)} fechada: ${formatarMoeda(resposta.total)} em ${forma}.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  const pedidos = conta.dados?.pedidos ?? [];
  const pendentes = pedidos.filter((p) => p.status !== 'ENTREGUE').length;

  return (
    <Modal aberto titulo={`Conta · ${nomeDaMesa(mesa)}`} aoFechar={aoFechar}>
      {conta.erro && <Aviso tipo="erro">{conta.erro}</Aviso>}
      {conta.carregando && <Carregando />}
      {conta.dados && pedidos.length === 0 && <p className="fila-vazia">Esta mesa não tem conta aberta.</p>}
      {conta.dados && pedidos.length > 0 && (
        <form onSubmit={fechar}>
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
            <strong>{formatarMoeda(conta.dados.total)}</strong>
          </div>
          {pendentes > 0 && (
            <Aviso tipo="info">
              {pendentes === 1
                ? 'Há 1 pedido que ainda não foi entregue. Ao fechar a conta ele é dado como entregue.'
                : `Há ${pendentes} pedidos que ainda não foram entregues. Ao fechar a conta eles são dados como entregues.`}
            </Aviso>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Selecao
            rotulo="Forma de pagamento"
            valor={forma}
            aoMudar={setForma}
            obrigatorio
            opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: f }))}
          />
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Fechando...' : 'Receber e fechar conta'}
          </Botao>{' '}
          <Botao variante="secundario" aoClicar={aoFechar}>
            Voltar
          </Botao>
        </form>
      )}
    </Modal>
  );
}

// ---------- Tela ----------

type Janela =
  | { tipo: 'form'; mesa: MesaDTO | null }
  | { tipo: 'qr'; mesa: MesaDTO }
  | { tipo: 'conta'; mesa: MesaDTO }
  | { tipo: 'pedido'; mesa: MesaDTO };

export function Mesas() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const mesas = useDados<MesaDTO[]>('/mesas');
  const [janela, setJanela] = useState<Janela | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  useAtualizacao(mesas.recarregar, 8000);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const lista = (mesas.dados ?? []).filter((m) => gestor || m.ativa);
  const ativas = lista.filter((m) => m.ativa);
  const ocupadas = ativas.filter((m) => m.situacao === 'OCUPADA');
  const chamando = ativas.filter((m) => m.chamandoDesde !== null);
  const emAberto = ocupadas.reduce((soma, m) => soma + m.totalAberto, 0);

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErroAcao(null);
    setAviso(null);
    try {
      await acao();
      setAviso(mensagem);
      mesas.recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  function acoesDoGestor(m: MesaDTO): AcaoMenu[] {
    return [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setJanela({ tipo: 'form', mesa: m }) },
      {
        rotulo: 'Gerar novo QR code',
        icone: 'cadeado',
        aoClicar: () => {
          if (!window.confirm(`Gerar um novo QR code para a mesa ${m.numero}? O QR code impresso para de funcionar.`)) {
            return;
          }
          void executar(() => api.post(`/mesas/${m.id}/novo-codigo`), `Novo QR code gerado para a mesa ${m.numero}.`);
        },
      },
      {
        rotulo: m.ativa ? 'Desativar' : 'Reativar',
        icone: m.ativa ? 'pausar' : 'reproduzir',
        aoClicar: () =>
          void executar(
            () => api.put(`/mesas/${m.id}`, { ativa: !m.ativa }),
            m.ativa ? `Mesa ${m.numero} desativada.` : `Mesa ${m.numero} reativada.`,
          ),
      },
      {
        rotulo: 'Excluir',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          if (!window.confirm(`Excluir a mesa ${m.numero}?`)) return;
          void executar(() => api.del(`/mesas/${m.id}`), `Mesa ${m.numero} excluída.`);
        },
      },
    ];
  }

  const proximoNumero = Math.max(0, ...(mesas.dados ?? []).map((m) => m.numero)) + 1;

  return (
    <Pagina
      titulo="Mesas"
      acoes={gestor ? <Botao aoClicar={() => setJanela({ tipo: 'form', mesa: null })}>Nova mesa</Botao> : undefined}
    >
      {mesas.dados && (
        <div className="resumo">
          <Indicador rotulo="Mesas ocupadas" valor={`${ocupadas.length}/${ativas.length}`} cor="azul" icone="mesas" />
          <Indicador rotulo="Mesas livres" valor={String(ativas.length - ocupadas.length)} cor="verde" icone="visto" />
          <Indicador rotulo="Chamando o garçom" valor={String(chamando.length)} cor="laranja" icone="sino" />
          <Indicador rotulo="Em contas abertas" valor={formatarMoeda(emAberto)} cor="roxo" icone="financeiro" />
        </div>
      )}

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {mesas.erro && <Aviso tipo="erro">{mesas.erro}</Aviso>}
      {mesas.carregando && !mesas.dados && <Carregando />}

      {mesas.dados && lista.length === 0 && (
        <p className="tabela-vazia">
          {gestor ? 'Nenhuma mesa cadastrada. Crie a primeira em "Nova mesa".' : 'Nenhuma mesa cadastrada.'}
        </p>
      )}

      <div className="mesas">
        {lista.map((m) => {
          const ocupada = m.situacao === 'OCUPADA';
          const classes = [
            'mesa',
            ocupada ? 'mesa-ocupada' : '',
            m.chamandoDesde ? 'mesa-chamando' : '',
            m.ativa ? '' : 'mesa-inativa',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <article className={classes} key={m.id}>
              <div className="mesa-topo">
                <div className="mesa-identidade">
                  <span className="mesa-numero">{m.numero}</span>
                  <div>
                    <span className="mesa-nome">{m.nome ?? `Mesa ${m.numero}`}</span>
                    <span className="mesa-detalhe">{m.lugares} lugares</span>
                  </div>
                </div>
                {gestor && <MenuAcoes rotulo={`Ações da mesa ${m.numero}`} acoes={acoesDoGestor(m)} />}
              </div>

              <div className="mesa-linha">
                {!m.ativa ? (
                  <Selo cor="cinza">Desativada</Selo>
                ) : ocupada ? (
                  <Selo cor="azul">Ocupada</Selo>
                ) : (
                  <Selo cor="verde">Livre</Selo>
                )}
                {ocupada && <span className="mesa-total">{formatarMoeda(m.totalAberto)}</span>}
              </div>

              {ocupada && (
                <span className="mesa-detalhe">
                  {m.pedidosAbertos} {m.pedidosAbertos === 1 ? 'pedido' : 'pedidos'}
                  {m.pedidosPendentes > 0 ? ` · ${m.pedidosPendentes} a entregar` : ''}
                  {m.abertaDesde ? ` · aberta ${tempoDesde(m.abertaDesde, agora)}` : ''}
                </span>
              )}

              {m.chamandoDesde && (
                <p className="mesa-chamado">
                  <Icone nome="sino" tamanho={18} />
                  Chamando {tempoDesde(m.chamandoDesde, agora)}
                </p>
              )}

              <div className="mesa-acoes">
                {m.chamandoDesde && (
                  <Botao
                    aoClicar={() =>
                      void executar(
                        () => api.post(`/mesas/${m.id}/atender-chamado`),
                        `Chamado da mesa ${m.numero} atendido.`,
                      )
                    }
                  >
                    Atender
                  </Botao>
                )}
                {m.ativa && (
                  <Botao variante="secundario" aoClicar={() => setJanela({ tipo: 'pedido', mesa: m })}>
                    Novo pedido
                  </Botao>
                )}
                {ocupada && (
                  <Botao variante="secundario" aoClicar={() => setJanela({ tipo: 'conta', mesa: m })}>
                    Conta
                  </Botao>
                )}
                <Botao variante="secundario" aoClicar={() => setJanela({ tipo: 'qr', mesa: m })}>
                  QR code
                </Botao>
              </div>
            </article>
          );
        })}
      </div>

      {janela?.tipo === 'form' && (
        <FormMesa
          mesa={janela.mesa}
          proximoNumero={proximoNumero}
          aoFechar={() => setJanela(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            mesas.recarregar();
          }}
        />
      )}
      {janela?.tipo === 'qr' && <QrDaMesa mesa={janela.mesa} aoFechar={() => setJanela(null)} />}
      {janela?.tipo === 'conta' && (
        <ContaDaMesa
          mesa={janela.mesa}
          aoFechar={() => setJanela(null)}
          aoPago={(mensagem) => {
            setAviso(mensagem);
            mesas.recarregar();
          }}
        />
      )}
      {janela?.tipo === 'pedido' && (
        <NovoPedido
          mesaFixa={janela.mesa}
          aoFechar={() => setJanela(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            mesas.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/mesas',
    rotulo: 'Mesas',
    icone: 'mesas',
    perfis: ['GESTOR'],
    elemento: <Mesas />,
    ordem: 11,
  },
  {
    caminho: '/garcom/mesas',
    rotulo: 'Mesas',
    icone: 'mesas',
    perfis: ['GARCOM'],
    elemento: <Mesas />,
    ordem: 11,
  },
];
