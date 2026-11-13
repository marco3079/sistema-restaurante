import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { imprimirHtml } from '../../lib/imprimir';
import { useAuth } from '../../lib/auth';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { horaCurta, lerPreco, mensagemErro } from '../../lib/restaurante';
import type { CaixaDTO, EstadoCaixaDTO, MovimentoCaixaDTO } from '../../lib/caixa';
import { ROTULO_MOVIMENTO_CAIXA } from '../../lib/caixa';
import {
  Abas,
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Modal,
  Pagina,
  Selo,
  Tabela,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import { Indicador } from '../pedidos/comum';
import './caixa.css';

const PERIODOS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Diferença em centavos (evita erro de ponto flutuante).
function centavosDe(valor: number): number {
  return Math.round(valor * 100);
}

// Texto da diferença para o aviso e o modal de fechamento: "Confere", "Sobra de R$ X" ou "Falta de R$ X".
function textoDiferenca(diferenca: number): string {
  const c = centavosDe(diferenca);
  if (c === 0) return 'Confere';
  if (c > 0) return `Sobra de ${formatarMoeda(c / 100)}`;
  return `Falta de ${formatarMoeda(-c / 100)}`;
}

// Selo da diferença na tabela do histórico.
function SeloDiferenca({ diferenca }: { diferenca: number | null }) {
  if (diferenca === null) return <Selo cor="cinza">Sem fechamento</Selo>;
  const c = centavosDe(diferenca);
  if (c === 0) return <Selo cor="verde">Confere</Selo>;
  if (c > 0) return <Selo cor="amarelo">{`Sobra ${formatarMoeda(c / 100)}`}</Selo>;
  return <Selo cor="vermelho">{`Falta ${formatarMoeda(-c / 100)}`}</Selo>;
}

// Linhas do fechamento, usadas na tela de detalhe e na impressão.
function linhasDoFechamento(c: CaixaDTO): { rotulo: string; valor: string }[] {
  const esperado = c.valorEsperado ?? c.resumo.esperado;
  return [
    { rotulo: 'Abertura', valor: formatarDataHora(c.abertoEm) },
    { rotulo: 'Fechamento', valor: c.fechadoEm ? formatarDataHora(c.fechadoEm) : '—' },
    { rotulo: 'Aberto por', valor: c.abertoPorNome },
    { rotulo: 'Fechado por', valor: c.fechadoPorNome ?? '—' },
    { rotulo: 'Troco inicial', valor: formatarMoeda(c.valorInicial) },
    { rotulo: 'Recebido em dinheiro', valor: formatarMoeda(c.resumo.dinheiro) },
    { rotulo: 'Sangrias', valor: formatarMoeda(c.resumo.sangrias) },
    { rotulo: 'Reforços', valor: formatarMoeda(c.resumo.reforcos) },
    { rotulo: 'Deve ter no caixa', valor: formatarMoeda(esperado) },
    { rotulo: 'Contado', valor: formatarMoeda(c.valorContado ?? 0) },
    { rotulo: 'Diferença', valor: textoDiferenca(c.diferenca ?? 0) },
  ];
}

// Monta o HTML da impressão do fechamento (todo texto do usuário passa por escapar).
function htmlDoFechamento(c: CaixaDTO): string {
  const linhas = linhasDoFechamento(c)
    .map((l) => `<div class="par"><span>${escapar(l.rotulo)}</span><span>${escapar(l.valor)}</span></div>`)
    .join('');
  const formas =
    Object.entries(c.resumo.porForma)
      .map(([forma, valor]) => `<div class="par"><span>${escapar(forma)}</span><span>${escapar(formatarMoeda(valor))}</span></div>`)
      .join('') || '<p>Sem recebimentos.</p>';
  const movimentos =
    c.movimentos
      .map(
        (m) =>
          `<div class="par"><span>${escapar(horaCurta(m.criadoEm))} ${escapar(ROTULO_MOVIMENTO_CAIXA[m.tipo])}${
            m.motivo ? ` · ${escapar(m.motivo)}` : ''
          }</span><span>${escapar(formatarMoeda(m.valor))}</span></div>` +
          `<p class="pequeno">${escapar(m.usuarioNome)}</p>`,
      )
      .join('') || '<p>Sem sangrias nem reforços.</p>';
  const observacao = c.observacao ? `<p>Obs.: ${escapar(c.observacao)}</p>` : '';
  return (
    `<h1>Fechamento de caixa</h1><div class="linha"></div>${linhas}` +
    `<div class="linha"></div><p><strong>Recebido por forma</strong></p>${formas}` +
    `<div class="linha"></div><p><strong>Sangrias e reforços</strong></p>${movimentos}${observacao}`
  );
}

function imprimirFechamento(c: CaixaDTO): void {
  imprimirHtml('Fechamento de caixa', htmlDoFechamento(c));
}

function TabelaMovimentos({ movimentos }: { movimentos: MovimentoCaixaDTO[] }) {
  return (
    <Tabela
      dados={movimentos}
      chave={(m) => m.id}
      vazio="Nenhum movimento ainda."
      colunas={[
        { titulo: 'Hora', celula: (m) => horaCurta(m.criadoEm) },
        {
          titulo: 'Tipo',
          celula: (m) => (
            <Selo cor={m.tipo === 'SANGRIA' ? 'amarelo' : 'verde'}>{ROTULO_MOVIMENTO_CAIXA[m.tipo]}</Selo>
          ),
        },
        { titulo: 'Valor', alinhar: 'direita', celula: (m) => <strong>{formatarMoeda(m.valor)}</strong> },
        { titulo: 'Motivo', celula: (m) => m.motivo ?? '—' },
        { titulo: 'Quem', celula: (m) => m.usuarioNome },
      ]}
    />
  );
}

// Abertura do caixa com o troco inicial.
function AbrirCaixa({
  ultimoFechado,
  aoAbriu,
}: {
  ultimoFechado: CaixaDTO | null;
  aoAbriu: () => void;
}) {
  const [troco, setTroco] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valor = lerPreco(troco);
    if (valor === null) {
      setErro('Informe o troco inicial. Use 0 se não houver troco.');
      return;
    }
    setEnviando(true);
    try {
      await api.post<CaixaDTO>('/caixa/abrir', { valorInicial: valor });
      aoAbriu();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <>
      <Cartao titulo="O caixa está fechado">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <form onSubmit={enviar}>
          <Campo rotulo="Troco inicial (R$)" valor={troco} aoMudar={setTroco} obrigatorio />
          <Botao tipo="submit" desabilitado={enviando}>
            Abrir caixa
          </Botao>
        </form>
      </Cartao>
      {ultimoFechado && (
        <Cartao titulo="Último fechamento">
          <p className="caixa-texto">
            Fechado em {formatarDataHora(ultimoFechado.fechadoEm ?? '')} por {ultimoFechado.fechadoPorNome ?? '—'}.
          </p>
          <p className="caixa-texto">Diferença: {textoDiferenca(ultimoFechado.diferenca ?? 0)}.</p>
        </Cartao>
      )}
    </>
  );
}

// Sangria (retirada) ou reforço (entrada) com valor e motivo.
function MovimentoModal({
  tipo,
  aoFechar,
  aoSalvo,
}: {
  tipo: 'SANGRIA' | 'REFORCO';
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const titulo = ROTULO_MOVIMENTO_CAIXA[tipo];

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = lerPreco(valor);
    if (n === null || n <= 0) {
      setErro('Informe o valor.');
      return;
    }
    setEnviando(true);
    try {
      await api.post<CaixaDTO>('/caixa/movimentos', { tipo, valor: n, motivo: motivo.trim() || null });
      aoSalvo(`${titulo} de ${formatarMoeda(n)} registrado.`);
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Valor (R$)" valor={valor} aoMudar={setValor} obrigatorio />
        <Campo rotulo="Motivo (opcional)" valor={motivo} aoMudar={setMotivo} />
        <Botao tipo="submit" desabilitado={enviando}>
          Registrar
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Fechamento: compara o dinheiro contado com o que deveria estar no caixa.
function FecharCaixa({
  caixa,
  aoFechar,
  aoFechou,
}: {
  caixa: CaixaDTO;
  aoFechar: () => void;
  aoFechou: (fechado: CaixaDTO) => void;
}) {
  const [contado, setContado] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const esperado = caixa.resumo.esperado;
  const valorContado = lerPreco(contado);
  const diferenca = valorContado === null ? null : centavosDe(valorContado) - centavosDe(esperado);
  const classeDiferenca =
    diferenca === null ? '' : diferenca === 0 ? 'caixa-dif-ok' : diferenca > 0 ? 'caixa-dif-sobra' : 'caixa-dif-falta';
  const textoAoVivo =
    diferenca === null
      ? ''
      : diferenca === 0
        ? 'Confere'
        : diferenca > 0
          ? `Sobra de ${formatarMoeda(diferenca / 100)}`
          : `Falta de ${formatarMoeda(-diferenca / 100)}`;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (valorContado === null) {
      setErro('Informe quanto dinheiro foi contado. Use 0 se não houver.');
      return;
    }
    if (!window.confirm('Fechar o caixa agora? Depois de fechado, não dá para lançar sangrias nem reforços neste caixa.')) {
      return;
    }
    setEnviando(true);
    try {
      const fechado = await api.post<CaixaDTO>('/caixa/fechar', {
        valorContado,
        observacao: observacao.trim() || null,
      });
      aoFechou(fechado);
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Fechar caixa" aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p>Deve ter: {formatarMoeda(esperado)}</p>
        <Campo rotulo="Dinheiro contado (R$)" valor={contado} aoMudar={setContado} obrigatorio />
        <p className={`caixa-diferenca ${classeDiferenca}`} aria-live="polite">
          {textoAoVivo}
        </p>
        <Campo rotulo="Observação (opcional)" valor={observacao} aoMudar={setObservacao} />
        <Botao tipo="submit" desabilitado={enviando}>
          Fechar caixa
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Tela do caixa aberto: indicadores, formas de pagamento, movimentos e ações.
function PainelCaixa({
  caixa,
  aoMudou,
  aoFechou,
}: {
  caixa: CaixaDTO;
  aoMudou: (mensagem: string) => void;
  aoFechou: (fechado: CaixaDTO) => void;
}) {
  const [modal, setModal] = useState<'SANGRIA' | 'REFORCO' | 'FECHAR' | null>(null);
  const r = caixa.resumo;
  const formas = Object.entries(r.porForma).sort((a, b) => b[1] - a[1]);
  const maior = formas.reduce((m, [, valor]) => Math.max(m, valor), 0);

  return (
    <>
      <div className="resumo">
        <Indicador rotulo="Troco inicial" valor={formatarMoeda(caixa.valorInicial)} cor="azul" icone="financeiro" />
        <Indicador rotulo="Recebido em dinheiro" valor={formatarMoeda(r.dinheiro)} cor="verde" icone="grafico" />
        <Indicador rotulo="Sangrias" valor={formatarMoeda(r.sangrias)} cor="laranja" icone="menos" />
        <Indicador rotulo="Reforços" valor={formatarMoeda(r.reforcos)} cor="azul" icone="mais-circulo" />
        <Indicador rotulo="Deve ter no caixa" valor={formatarMoeda(r.esperado)} cor="roxo" icone="lista" />
      </div>

      <p className="caixa-texto">
        Aberto por {caixa.abertoPorNome} em {formatarDataHora(caixa.abertoEm)}. {r.recebimentos} recebimentos desde
        então.
      </p>

      <div className="caixa-acoes">
        <Botao variante="secundario" aoClicar={() => setModal('SANGRIA')}>
          Sangria
        </Botao>
        <Botao variante="secundario" aoClicar={() => setModal('REFORCO')}>
          Reforço
        </Botao>
        <Botao variante="perigo" aoClicar={() => setModal('FECHAR')}>
          Fechar caixa
        </Botao>
      </div>

      <Cartao titulo="Recebido por forma de pagamento">
        {maior === 0 ? (
          <p className="caixa-texto">Sem movimento no período.</p>
        ) : (
          formas.map(([forma, valor]) => (
            <div className="caixa-forma" key={forma}>
              <div className="caixa-forma-topo">
                <span>{forma}</span>
                <strong>{formatarMoeda(valor)}</strong>
              </div>
              <div className="caixa-barra" aria-hidden="true">
                <span style={{ width: `${(valor / maior) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </Cartao>

      <Cartao titulo="Movimentos do caixa">
        <TabelaMovimentos movimentos={caixa.movimentos} />
      </Cartao>

      {(modal === 'SANGRIA' || modal === 'REFORCO') && (
        <MovimentoModal
          tipo={modal}
          aoFechar={() => setModal(null)}
          aoSalvo={(mensagem) => {
            setModal(null);
            aoMudou(mensagem);
          }}
        />
      )}
      {modal === 'FECHAR' && (
        <FecharCaixa
          caixa={caixa}
          aoFechar={() => setModal(null)}
          aoFechou={(fechado) => {
            setModal(null);
            aoFechou(fechado);
          }}
        />
      )}
    </>
  );
}

// Histórico dos caixas fechados (só gestor). Mostra o detalhe e permite imprimir de novo.
function Historico() {
  const [dias, setDias] = useState(30);
  const [detalhe, setDetalhe] = useState<CaixaDTO | null>(null);
  const lista = useDados<CaixaDTO[]>(`/caixa/historico?dias=${dias}`);
  const dados = lista.dados ?? [];

  return (
    <>
      <div className="segmentado" role="group" aria-label="Período">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            type="button"
            className="segmentado-item"
            aria-pressed={dias === p.dias}
            onClick={() => setDias(p.dias)}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}

      {lista.dados && (
        <Tabela
          dados={dados}
          chave={(c) => c.id}
          vazio="Nenhum caixa fechado neste período."
          colunas={[
            { titulo: 'Abertura', celula: (c) => formatarDataHora(c.abertoEm) },
            { titulo: 'Fechamento', celula: (c) => (c.fechadoEm ? formatarDataHora(c.fechadoEm) : '—') },
            { titulo: 'Aberto por', celula: (c) => c.abertoPorNome },
            { titulo: 'Fechado por', celula: (c) => c.fechadoPorNome ?? '—' },
            {
              titulo: 'Esperado',
              alinhar: 'direita',
              celula: (c) => formatarMoeda(c.valorEsperado ?? c.resumo.esperado),
            },
            { titulo: 'Contado', alinhar: 'direita', celula: (c) => formatarMoeda(c.valorContado ?? 0) },
            { titulo: 'Diferença', celula: (c) => <SeloDiferenca diferenca={c.diferenca} /> },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => (
                <Botao variante="texto" aoClicar={() => setDetalhe(c)}>
                  Ver e imprimir
                </Botao>
              ),
            },
          ]}
        />
      )}

      {detalhe && (
        <Modal aberto titulo="Fechamento do caixa" aoFechar={() => setDetalhe(null)}>
          {linhasDoFechamento(detalhe).map((l) => (
            <p className="caixa-linha" key={l.rotulo}>
              <span>{l.rotulo}</span>
              <strong>{l.valor}</strong>
            </p>
          ))}
          {detalhe.observacao && <p className="caixa-texto">Observação: {detalhe.observacao}</p>}
          <h3 className="caixa-subtitulo">Movimentos</h3>
          <TabelaMovimentos movimentos={detalhe.movimentos} />
          <div className="caixa-acoes">
            <Botao aoClicar={() => imprimirFechamento(detalhe)}>Imprimir fechamento</Botao>
          </div>
        </Modal>
      )}
    </>
  );
}

// Caixa da gaveta. Operadores abrem, lançam sangrias e reforços e fecham. Só o gestor vê o histórico.
export function Caixa() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const estado = useDados<EstadoCaixaDTO>('/caixa');
  useAtualizacao(estado.recarregar, 15000);
  const [aba, setAba] = useState<'hoje' | 'historico'>('hoje');
  const [fechamento, setFechamento] = useState<CaixaDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const mostrarHistorico = gestor && aba === 'historico';

  return (
    <Pagina titulo="Caixa">
      {gestor && (
        <Abas
          abas={[
            { id: 'hoje', rotulo: 'Caixa de hoje' },
            { id: 'historico', rotulo: 'Histórico' },
          ]}
          ativa={aba}
          aoMudar={(id) => setAba(id === 'historico' ? 'historico' : 'hoje')}
        />
      )}

      {mostrarHistorico ? (
        <Historico />
      ) : (
        <>
          {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
          {estado.carregando && !estado.dados && <Carregando />}

          {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
          {fechamento && (
            <Aviso tipo="sucesso">
              <span>
                Caixa fechado. {textoDiferenca(fechamento.diferenca ?? 0)}.{' '}
              </span>
              <Botao variante="secundario" aoClicar={() => imprimirFechamento(fechamento)}>
                Imprimir fechamento
              </Botao>
            </Aviso>
          )}

          {estado.dados &&
            (estado.dados.aberto ? (
              <PainelCaixa
                caixa={estado.dados.aberto}
                aoMudou={(mensagem) => {
                  setAviso(mensagem);
                  setFechamento(null);
                  estado.recarregar();
                }}
                aoFechou={(fechado) => {
                  setAviso(null);
                  setFechamento(fechado);
                  estado.recarregar();
                }}
              />
            ) : (
              <AbrirCaixa
                ultimoFechado={estado.dados.ultimoFechado}
                aoAbriu={() => {
                  setAviso(null);
                  setFechamento(null);
                  estado.recarregar();
                }}
              />
            ))}
        </>
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/caixa',
    rotulo: 'Caixa',
    icone: 'financeiro',
    perfis: ['GESTOR'],
    elemento: <Caixa />,
    ordem: 29,
    grupo: 'Financeiro',
  },
  {
    caminho: '/garcom/caixa',
    rotulo: 'Caixa',
    icone: 'financeiro',
    perfis: ['GARCOM'],
    elemento: <Caixa />,
    ordem: 29,
    grupo: 'Financeiro',
  },
  {
    caminho: '/recepcao/caixa',
    rotulo: 'Caixa',
    icone: 'financeiro',
    perfis: ['RECEPCAO'],
    elemento: <Caixa />,
    ordem: 29,
    grupo: 'Financeiro',
  },
];
