import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro } from '../../lib/restaurante';
import { imprimirHtml } from '../../lib/imprimir';
import { ROTULO_PERFIL_EQUIPE } from '../../lib/rateio';
import type {
  ChavePercentual,
  PessoaRateioDTO,
  RateioDTO,
  RegraDTO,
  RepasseDetalheDTO,
  RepasseLinhaDTO,
} from '../../lib/rateio';
import {
  Abas,
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
  Tabela,
  formatarData,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Indicador } from '../pedidos/comum';
import './rateio.css';

// ---------- Datas e formatação ----------

function dois(n: number): string {
  return String(n).padStart(2, '0');
}

// Dia no formato AAAA-MM-DD, pelo fuso do navegador.
function diaISO(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function pct(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function horas(minutos: number): string {
  return `${Math.floor(minutos / 60)}h ${dois(minutos % 60)}min`;
}

function periodoTexto(de: string, ate: string): string {
  return `${formatarData(de)} a ${formatarData(ate)}`;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function regraTexto(r: RegraDTO): string {
  const partes = [
    `Garçons ${pct(r.percentuais.GARCOM)}`,
    `Cozinha ${pct(r.percentuais.COZINHA)}`,
    `Limpeza ${pct(r.percentuais.LIMPEZA)}`,
    `Recepção ${pct(r.percentuais.RECEPCAO)}`,
    `Casa ${pct(r.percentuais.CASA)}`,
  ];
  const dentro = r.divisaoInterna === 'HORAS' ? 'pelas horas do ponto' : 'partes iguais';
  const gorjeta = r.gorjetasParaQuemRecebeu
    ? 'A gorjeta fica com quem recebeu a conta.'
    : 'As gorjetas entram no bolo do rateio.';
  return `${partes.join(' · ')}. Dentro de cada grupo: ${dentro}. ${gorjeta}`;
}

// ---------- Impressão e planilha ----------

function htmlDoRateio(r: RateioDTO): string {
  const linhaValor = (rotulo: string, valor: number, classe = '') =>
    `<div class="par${classe}"><span>${escapar(rotulo)}</span><span>${formatarMoeda(valor)}</span></div>`;

  const grupos = r.grupos
    .map((g) => {
      const cabeca =
        `<div class="linha"></div><p class="item">${escapar(ROTULO_PERFIL_EQUIPE[g.perfil])} (${escapar(pct(g.percentual))})</p>` +
        linhaValor('Total do grupo', g.valor, ' destaque');
      if (g.pessoas.length === 0) {
        return cabeca + '<p class="nota">Ninguém ativo neste perfil: o valor fica com a casa.</p>';
      }
      return (
        cabeca +
        g.pessoas
          .map(
            (p) =>
              `<div class="par"><span>${escapar(p.nome)}</span><span>${formatarMoeda(p.total)}</span></div>` +
              `<p class="pequeno">&nbsp;&nbsp;${r.regra.divisaoInterna === 'HORAS' ? `${horas(p.minutos)} · ` : ''}Taxa ${formatarMoeda(p.valorTaxa)}${p.valorGorjeta > 0 ? ` · Gorjeta ${formatarMoeda(p.valorGorjeta)}` : ''}</p>`,
          )
          .join('')
      );
    })
    .join('');

  const outros =
    r.outros.length > 0
      ? '<div class="linha"></div><p class="item">Gorjetas fora do rateio</p>' +
        r.outros.map((o) => linhaValor(o.nome, o.valorGorjeta)).join('')
      : '';

  return (
    `<h1>Rateio da taxa de serviço</h1><p class="centro">${escapar(periodoTexto(r.de, r.ate))}</p>` +
    '<div class="linha"></div>' +
    linhaValor('Taxa de serviço', r.totalTaxa) +
    linhaValor('Gorjetas', r.totalGorjetas) +
    linhaValor('Base do rateio', r.base) +
    `<p class="pequeno">${escapar(regraTexto(r.regra))}</p>` +
    grupos +
    outros +
    '<div class="linha"></div>' +
    linhaValor('A distribuir para a equipe', r.totalDistribuido, ' destaque') +
    linhaValor('Fica com a casa', r.casa) +
    '<p class="centro pequeno">O pagamento à equipe é feito por fora. Não é documento fiscal.</p>'
  );
}

function imprimirRateio(r: RateioDTO) {
  imprimirHtml(`Rateio ${periodoTexto(r.de, r.ate)}`, htmlDoRateio(r));
}

function baixarPlanilha(r: RateioDTO) {
  const celula = (valor: string | number) => `"${String(valor).replace(/"/g, '""')}"`;
  const numero = (valor: number) => valor.toFixed(2).replace('.', ',');
  const linhas: (string | number)[][] = [['Perfil', 'Pessoa', 'Minutos', 'Taxa', 'Gorjeta', 'Total']];
  for (const g of r.grupos) {
    for (const p of g.pessoas) {
      linhas.push([ROTULO_PERFIL_EQUIPE[g.perfil], p.nome, p.minutos, numero(p.valorTaxa), numero(p.valorGorjeta), numero(p.total)]);
    }
  }
  for (const o of r.outros) {
    linhas.push(['Fora do rateio', o.nome, '', numero(0), numero(o.valorGorjeta), numero(o.valorGorjeta)]);
  }
  // O BOM no início faz o Excel abrir os acentos certo; ponto e vírgula é o separador do Excel em português.
  const texto = '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = endereco;
  link.download = `rateio-${r.de}-a-${r.ate}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

// ---------- Desenho do resultado (usado em Calcular e no modal de repasse) ----------

function Resultado({ rateio }: { rateio: RateioDTO }) {
  const semMovimento = rateio.totalTaxa === 0 && rateio.totalGorjetas === 0;
  const colunas: ColunaTabela<PessoaRateioDTO>[] = [
    { titulo: 'Pessoa', celula: (p) => p.nome },
    ...(rateio.regra.divisaoInterna === 'HORAS'
      ? [{ titulo: 'Horas no ponto', alinhar: 'direita' as const, celula: (p: PessoaRateioDTO) => horas(p.minutos) }]
      : []),
    { titulo: 'Taxa', alinhar: 'direita', celula: (p) => formatarMoeda(p.valorTaxa) },
    { titulo: 'Gorjeta', alinhar: 'direita', celula: (p) => formatarMoeda(p.valorGorjeta) },
    { titulo: 'Total', alinhar: 'direita', celula: (p) => <strong>{formatarMoeda(p.total)}</strong> },
  ];

  return (
    <>
      <div className="resumo">
        <Indicador rotulo="Taxa de serviço" valor={formatarMoeda(rateio.totalTaxa)} cor="roxo" icone="estrela" />
        <Indicador rotulo="Gorjetas" valor={formatarMoeda(rateio.totalGorjetas)} cor="laranja" icone="medalha" />
        <Indicador rotulo="A distribuir para a equipe" valor={formatarMoeda(rateio.totalDistribuido)} cor="verde" icone="grupo" />
        <Indicador rotulo="Fica com a casa" valor={formatarMoeda(rateio.casa)} cor="azul" icone="financeiro" />
      </div>
      <p className="rateio-regra">{regraTexto(rateio.regra)}</p>

      {semMovimento ? (
        <p className="rateio-vazio">Sem movimento no período.</p>
      ) : (
        rateio.grupos.map((g) => (
          <Cartao key={g.perfil} titulo={`${ROTULO_PERFIL_EQUIPE[g.perfil]} · ${pct(g.percentual)} · ${formatarMoeda(g.valor)}`}>
            {g.pessoas.length === 0 ? (
              <p className="rateio-vazio">Ninguém ativo neste perfil: o valor fica com a casa.</p>
            ) : (
              <Tabela dados={g.pessoas} chave={(p) => p.usuarioId} colunas={colunas} />
            )}
          </Cartao>
        ))
      )}

      {rateio.outros.length > 0 && (
        <Cartao titulo="Gorjetas de quem não entra no rateio">
          <Tabela
            dados={rateio.outros}
            chave={(o) => o.usuarioId}
            colunas={[
              { titulo: 'Pessoa', celula: (o) => o.nome },
              { titulo: 'Gorjeta', alinhar: 'direita', celula: (o) => formatarMoeda(o.valorGorjeta) },
            ]}
          />
        </Cartao>
      )}
    </>
  );
}

// ---------- Aba Calcular ----------

const PERIODOS = [
  { id: 'semana', rotulo: 'Esta semana' },
  { id: 'semana-passada', rotulo: 'Semana passada' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes-passado', rotulo: 'Mês passado' },
  { id: 'personalizado', rotulo: 'Personalizado' },
] as const;

type IdPeriodo = (typeof PERIODOS)[number]['id'];

// Semana começa na segunda-feira.
function intervaloDe(id: Exclude<IdPeriodo, 'personalizado'>): { de: string; ate: string } {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const dia = hoje.getDate();
  const desdeSegunda = (hoje.getDay() + 6) % 7;
  switch (id) {
    case 'semana':
      return { de: diaISO(new Date(ano, mes, dia - desdeSegunda)), ate: diaISO(hoje) };
    case 'semana-passada':
      return {
        de: diaISO(new Date(ano, mes, dia - desdeSegunda - 7)),
        ate: diaISO(new Date(ano, mes, dia - desdeSegunda - 1)),
      };
    case 'mes':
      return { de: diaISO(new Date(ano, mes, 1)), ate: diaISO(hoje) };
    case 'mes-passado':
      return { de: diaISO(new Date(ano, mes - 1, 1)), ate: diaISO(new Date(ano, mes, 0)) };
  }
}

function Calcular({ aoFechado }: { aoFechado: () => void }) {
  const [periodo, setPeriodo] = useState<IdPeriodo>('mes');
  const [deP, setDeP] = useState(() => {
    const h = new Date();
    return diaISO(new Date(h.getFullYear(), h.getMonth(), 1));
  });
  const [ateP, setAteP] = useState(() => diaISO(new Date()));
  const [erro, setErro] = useState<string | null>(null);
  const [fechando, setFechando] = useState(false);

  const intervalo = periodo === 'personalizado' ? { de: deP, ate: ateP } : intervaloDe(periodo);
  const valido = intervalo.de !== '' && intervalo.ate !== '' && intervalo.de <= intervalo.ate;
  const caminho = valido ? `/rateio/simular?de=${intervalo.de}&ate=${intervalo.ate}` : null;
  const rateio = useDados<RateioDTO>(caminho);
  const r = rateio.dados;

  async function fechar(atual: RateioDTO) {
    if (!window.confirm(`Fechar o rateio de ${formatarData(atual.de)} a ${formatarData(atual.ate)}? Ele fica guardado em Repasses fechados.`)) {
      return;
    }
    setErro(null);
    setFechando(true);
    try {
      await api.post<{ id: number }>('/rateio/fechar', { de: atual.de, ate: atual.ate });
      aoFechado();
    } catch (e) {
      setErro(mensagemErro(e));
      setFechando(false);
    }
  }

  return (
    <>
      <Aviso tipo="info">
        O sistema calcula e guarda o rateio. O pagamento à equipe é feito por fora (folha, Pix ou dinheiro).
      </Aviso>

      <div className="barra-ferramentas rateio-periodo">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="segmentado-item"
              aria-pressed={periodo === p.id}
              onClick={() => setPeriodo(p.id)}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>

      {periodo === 'personalizado' && (
        <>
          <div className="rateio-datas">
            <Campo rotulo="De" tipo="date" valor={deP} aoMudar={setDeP} />
            <Campo rotulo="Até" tipo="date" valor={ateP} aoMudar={setAteP} />
          </div>
          {!valido && <Aviso tipo="erro">Informe as duas datas, com a data final igual ou depois da inicial.</Aviso>}
        </>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {rateio.erro && <Aviso tipo="erro">{rateio.erro}</Aviso>}
      {rateio.carregando && <Carregando />}

      {r && !rateio.carregando && (
        <>
          <div className="barra-ferramentas">
            <Botao variante="secundario" aoClicar={() => imprimirRateio(r)}>
              Imprimir
            </Botao>
            <Botao variante="secundario" aoClicar={() => baixarPlanilha(r)}>
              Baixar planilha
            </Botao>
            <Botao
              desabilitado={fechando || (r.totalTaxa === 0 && r.totalGorjetas === 0)}
              aoClicar={() => void fechar(r)}
            >
              Fechar este período
            </Botao>
          </div>
          <Resultado rateio={r} />
        </>
      )}
    </>
  );
}

// ---------- Aba Regra ----------

const CHAVES: ChavePercentual[] = ['GARCOM', 'COZINHA', 'LIMPEZA', 'RECEPCAO', 'CASA'];

const ROTULO_CHAVE: Record<ChavePercentual, string> = {
  GARCOM: 'Garçons (%)',
  COZINHA: 'Cozinha (%)',
  LIMPEZA: 'Limpeza (%)',
  RECEPCAO: 'Recepção (%)',
  CASA: 'Casa (%)',
};

// Percentual válido: número de 0 a 100 com até 2 casas. Vazio ou inválido vira null.
function lerPercentual(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
  return n;
}

function FormularioRegra({ regra, aoSalvo }: { regra: RegraDTO; aoSalvo: () => void }) {
  const [valores, setValores] = useState<Record<ChavePercentual, string>>({
    GARCOM: String(regra.percentuais.GARCOM),
    COZINHA: String(regra.percentuais.COZINHA),
    LIMPEZA: String(regra.percentuais.LIMPEZA),
    RECEPCAO: String(regra.percentuais.RECEPCAO),
    CASA: String(regra.percentuais.CASA),
  });
  const [divisao, setDivisao] = useState<string>(regra.divisaoInterna);
  const [gorjetaDireta, setGorjetaDireta] = useState(regra.gorjetasParaQuemRecebeu);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const numeros = CHAVES.map((k) => lerPercentual(valores[k]));
  const todosValidos = numeros.every((n) => n !== null);
  const somaC = todosValidos ? numeros.reduce<number>((s, n) => s + Math.round((n ?? 0) * 100), 0) : null;
  const somaOk = somaC === 10000;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!somaOk) return;
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      const p = (k: ChavePercentual) => lerPercentual(valores[k]) ?? 0;
      await api.put<RegraDTO>('/rateio/regra', {
        percentuais: {
          GARCOM: p('GARCOM'),
          COZINHA: p('COZINHA'),
          LIMPEZA: p('LIMPEZA'),
          RECEPCAO: p('RECEPCAO'),
          CASA: p('CASA'),
        },
        divisaoInterna: divisao === 'HORAS' ? 'HORAS' : 'IGUAL',
        gorjetasParaQuemRecebeu: gorjetaDireta,
      });
      setAviso('Regra gravada.');
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="formulario-cartoes" noValidate>
      <Cartao titulo="Percentuais da taxa">
        <div className="rateio-percentuais">
          {CHAVES.map((k) => (
            <Campo
              key={k}
              rotulo={ROTULO_CHAVE[k]}
              tipo="number"
              valor={valores[k]}
              aoMudar={(texto) => setValores((atual) => ({ ...atual, [k]: texto }))}
            />
          ))}
        </div>
        <p className={`rateio-soma ${somaOk ? 'rateio-soma-ok' : 'rateio-soma-erro'}`} aria-live="polite">
          Soma: {somaC === null ? '—' : pct(somaC / 100)}
        </p>
      </Cartao>

      <Cartao titulo="Divisão">
        <Selecao
          rotulo="Dentro de cada grupo"
          valor={divisao}
          aoMudar={setDivisao}
          opcoes={[
            { valor: 'IGUAL', rotulo: 'Partes iguais' },
            { valor: 'HORAS', rotulo: 'Pelas horas do ponto' },
          ]}
        />
        <Caixa
          rotulo={gorjetaDireta ? 'A gorjeta fica com quem recebeu a conta' : 'As gorjetas entram no bolo do rateio'}
          marcado={gorjetaDireta}
          aoMudar={setGorjetaDireta}
        />
      </Cartao>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={enviando || !somaOk}>
          {enviando ? 'Salvando...' : 'Salvar regra'}
        </Botao>
      </div>
    </form>
  );
}

function Regra() {
  const regra = useDados<RegraDTO>('/rateio/regra');
  return (
    <>
      {regra.erro && <Aviso tipo="erro">{regra.erro}</Aviso>}
      {regra.carregando && !regra.dados && <Carregando />}
      {regra.dados && <FormularioRegra regra={regra.dados} aoSalvo={regra.recarregar} />}
    </>
  );
}

// ---------- Aba Repasses fechados ----------

function VerRepasse({ id, aoFechar }: { id: number; aoFechar: () => void }) {
  const detalhe = useDados<RepasseDetalheDTO>(`/rateio/repasses/${id}`);
  const d = detalhe.dados;
  const titulo = d ? `Repasse de ${periodoTexto(d.rateio.de, d.rateio.ate)}` : 'Repasse';
  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar}>
      {detalhe.erro && <Aviso tipo="erro">{detalhe.erro}</Aviso>}
      {detalhe.carregando && <Carregando />}
      {d && (
        <>
          <p className="rateio-regra">
            Fechado por {d.criadoPorNome ?? 'não informado'} em {formatarDataHora(d.criadoEm)}.
          </p>
          <div className="barra-ferramentas">
            <Botao variante="secundario" aoClicar={() => imprimirRateio(d.rateio)}>
              Imprimir
            </Botao>
            <Botao variante="secundario" aoClicar={() => baixarPlanilha(d.rateio)}>
              Baixar planilha
            </Botao>
          </div>
          <Resultado rateio={d.rateio} />
        </>
      )}
    </Modal>
  );
}

function Repasses() {
  const lista = useDados<RepasseLinhaDTO[]>('/rateio/repasses');
  const [abertoId, setAbertoId] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function excluir(repasse: RepasseLinhaDTO) {
    if (
      !window.confirm(
        `Excluir o repasse de ${periodoTexto(repasse.de, repasse.ate)}? Depois disso, o período pode ser fechado de novo.`,
      )
    ) {
      return;
    }
    setErro(null);
    setAviso(null);
    try {
      await api.del(`/rateio/repasses/${repasse.id}`);
      setAviso('Repasse excluído.');
      lista.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  return (
    <>
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}

      {lista.dados && (
        <Tabela
          dados={lista.dados}
          chave={(r) => r.id}
          vazio="Nenhum período fechado ainda."
          colunas={[
            {
              titulo: 'Período',
              celula: (r) => <span className="sem-quebra">{periodoTexto(r.de, r.ate)}</span>,
            },
            { titulo: 'Taxa', alinhar: 'direita', celula: (r) => formatarMoeda(r.totalTaxa) },
            { titulo: 'Gorjetas', alinhar: 'direita', celula: (r) => formatarMoeda(r.totalGorjetas) },
            { titulo: 'Fechado por', celula: (r) => r.criadoPorNome ?? '—' },
            { titulo: 'Em', celula: (r) => <span className="sem-quebra">{formatarDataHora(r.criadoEm)}</span> },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (r) => (
                <MenuAcoes
                  rotulo={`Ações do repasse de ${periodoTexto(r.de, r.ate)}`}
                  acoes={[
                    { rotulo: 'Ver e imprimir', icone: 'lista', aoClicar: () => setAbertoId(r.id) },
                    { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => void excluir(r) },
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      {abertoId !== null && <VerRepasse id={abertoId} aoFechar={() => setAbertoId(null)} />}
    </>
  );
}

// ---------- Tela ----------

export function Rateio() {
  const [aba, setAba] = useState('calcular');
  return (
    <Pagina titulo="Rateio da taxa de serviço">
      <Abas
        abas={[
          { id: 'calcular', rotulo: 'Calcular' },
          { id: 'regra', rotulo: 'Regra' },
          { id: 'repasses', rotulo: 'Repasses fechados' },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />
      {aba === 'calcular' && <Calcular aoFechado={() => setAba('repasses')} />}
      {aba === 'regra' && <Regra />}
      {aba === 'repasses' && <Repasses />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/rateio',
    rotulo: 'Rateio da taxa',
    icone: 'grupo',
    perfis: ['GESTOR'],
    elemento: <Rateio />,
    ordem: 43,
    grupo: 'Equipe',
  },
];
