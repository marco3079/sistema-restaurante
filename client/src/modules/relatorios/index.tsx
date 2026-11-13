import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import type { RelatorioVendas, ResumoVendas, VendasPorDia } from '../../lib/relatorios';
import { Abas, Aviso, Botao, Campo, Cartao, Carregando, Pagina, Tabela, formatarData, formatarMoeda } from '../../ui';
import { Indicador } from '../pedidos/comum';
import './relatorios.css';

type Periodo = 'hoje' | '7' | '30' | 'mes' | 'personalizado';

const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: '7', rotulo: '7 dias' },
  { id: '30', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'personalizado', rotulo: 'Personalizado' },
];

const ORDENS: { id: 'mais' | 'menos' | 'semVenda'; rotulo: string }[] = [
  { id: 'mais', rotulo: 'Mais vendidos' },
  { id: 'menos', rotulo: 'Menos vendidos' },
  { id: 'semVenda', rotulo: 'Sem venda' },
];

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DIAS_SEMANA_COMPLETOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Datas e formatação ----------

// Dia AAAA-MM-DD no fuso do navegador.
function textoDoDia(data: Date): string {
  const ano = String(data.getFullYear()).padStart(4, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function deslocarDias(data: Date, dias: number): Date {
  const nova = new Date(data);
  nova.setDate(nova.getDate() + dias);
  return nova;
}

// Intervalo do período escolhido em AAAA-MM-DD; null quando faltam datas no personalizado.
function intervaloDo(periodo: Periodo, de: string, ate: string): { de: string; ate: string } | null {
  if (periodo === 'personalizado') {
    if (!FORMATO_DIA.test(de) || !FORMATO_DIA.test(ate)) return null;
    return { de, ate };
  }
  const hoje = new Date();
  if (periodo === 'mes') {
    return { de: textoDoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: textoDoDia(hoje) };
  }
  const dias = periodo === 'hoje' ? 1 : periodo === '7' ? 7 : 30;
  return { de: textoDoDia(deslocarDias(hoje, 1 - dias)), ate: textoDoDia(hoje) };
}

function formatarMinutos(min: number | null): string {
  if (min === null) return '—';
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const minutosRestantes = total % 60;
  return minutosRestantes === 0 ? `${horas} h` : `${horas} h ${minutosRestantes} min`;
}

function percentual(parte: number, total: number, casas = 0): string {
  const valor = total === 0 ? 0 : (parte / total) * 100;
  return `${valor.toFixed(casas).replace('.', ',')}%`;
}

const plural = (quantidade: number, singular: string, textoPlural: string) =>
  quantidade === 1 ? singular : textoPlural;

// ---------- Planilha ----------

function baixarPlanilha(dados: RelatorioVendas) {
  const celula = (valor: string | number) => `"${String(valor).replace(/"/g, '""')}"`;
  const numero = (valor: number) => valor.toFixed(2).replace('.', ',');
  const minutosCsv = (valor: number | null) => (valor === null ? '' : String(valor).replace('.', ','));
  const r = dados.resumo;
  const linhas: (string | number)[][] = [
    ['Período', `${formatarData(dados.de)} a ${formatarData(dados.ate)}`],
    ['Faturamento', numero(r.faturamento)],
    ['Pedidos', r.pedidos],
    ['Cancelados', r.cancelados],
    ['Itens vendidos', r.itens],
    ['Contas fechadas', r.contasFechadas],
    ['Ticket médio por conta', numero(r.ticketMedio)],
    ['Tempo médio de preparo (min)', minutosCsv(r.tempoMedioPreparoMin)],
    ['Tempo médio de mesa (min)', minutosCsv(r.tempoMedioMesaMin)],
    [],
    ['Produto', 'Categoria', 'Quantidade', 'Valor'],
    ...dados.produtos.map((p) => [p.nome, p.categoria, p.quantidade, numero(p.valor)]),
    [],
    ['Dia', 'Pedidos', 'Valor'],
    ...dados.porDia.map((d) => [formatarData(d.dia), d.pedidos, numero(d.valor)]),
  ];
  // O BOM no início faz o Excel abrir os acentos certo; ponto e vírgula é o separador do Excel em português.
  const texto = '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = endereco;
  link.download = `relatorio-vendas-${dados.de}-a-${dados.ate}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

// ---------- Gráfico de barras em CSS ----------

interface Barra {
  chave: string;
  rotulo: string;
  titulo: string;
  valor: number;
  destaque?: boolean;
}

function GraficoBarras({ barras }: { barras: Barra[] }) {
  const maximo = Math.max(0, ...barras.map((b) => b.valor));
  return (
    <div className="relatorios-grafico">
      {barras.map((b) => (
        <div key={b.chave} className="relatorios-barra" title={b.titulo}>
          <div className="relatorios-barra-area">
            <div
              className={b.destaque ? 'relatorios-barra-preench relatorios-barra-destaque' : 'relatorios-barra-preench'}
              style={{ height: `${maximo === 0 ? 0 : (b.valor / maximo) * 100}%` }}
            />
          </div>
          <span className="relatorios-barra-rotulo">{b.rotulo}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Abas ----------

function AbaProdutos({ dados }: { dados: RelatorioVendas }) {
  const [ordem, setOrdem] = useState<'mais' | 'menos' | 'semVenda'>('mais');
  const faturamento = dados.resumo.faturamento;
  const vendidos = (ordem === 'menos' ? [...dados.produtos].reverse() : dados.produtos).map((p, i) => ({
    ...p,
    posicao: i + 1,
  }));
  const maiorCategoria = Math.max(0, ...dados.categorias.map((c) => c.valor));

  return (
    <>
      <div className="segmentado" role="group" aria-label="Ordem dos produtos">
        {ORDENS.map((o) => (
          <button
            key={o.id}
            type="button"
            className="segmentado-item"
            aria-pressed={ordem === o.id}
            onClick={() => setOrdem(o.id)}
          >
            {o.rotulo}
          </button>
        ))}
      </div>

      {ordem === 'semVenda' ? (
        <div className="relatorios-duas-colunas">
          <div>
            <p className="relatorios-nota">Ativos no cardápio e sem nenhuma venda no período.</p>
            <Tabela
              dados={dados.semVenda}
              chave={(p) => p.produtoId}
              vazio="Todos os produtos ativos venderam no período."
              colunas={[
                {
                  titulo: 'Produto',
                  celula: (p) => (
                    <span className="produto-texto">
                      <span className="produto-nome">{p.nome}</span>
                      <span className="produto-descricao">{p.categoria}</span>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      ) : (
        <div className="relatorios-duas-colunas">
          <Tabela
            dados={vendidos}
            chave={(p) => p.produtoId}
            vazio="Nenhum produto vendido no período."
            colunas={[
              { titulo: 'Posição', celula: (p) => p.posicao },
              {
                titulo: 'Produto',
                celula: (p) => (
                  <span className="produto-texto">
                    <span className="produto-nome">{p.nome}</span>
                    <span className="produto-descricao">{p.categoria}</span>
                  </span>
                ),
              },
              { titulo: 'Quantidade', alinhar: 'direita', celula: (p) => <strong>{p.quantidade}</strong> },
              { titulo: 'Valor', alinhar: 'direita', celula: (p) => <span className="sem-quebra">{formatarMoeda(p.valor)}</span> },
              {
                titulo: 'Participação',
                celula: (p) => {
                  const participacao = faturamento > 0 ? (p.valor / faturamento) * 100 : 0;
                  return (
                    <span className="relatorios-participacao">
                      <span className="sem-quebra">{percentual(p.valor, faturamento, 1)}</span>
                      <span className="relatorios-participacao-barra" aria-hidden="true">
                        <span
                          className="relatorios-participacao-preench"
                          style={{ width: `${Math.min(100, participacao)}%` }}
                        />
                      </span>
                    </span>
                  );
                },
              },
            ]}
          />

          <Cartao titulo="Por categoria">
            {dados.categorias.length === 0 ? (
              <p className="relatorios-vazio">Sem movimento no período.</p>
            ) : (
              <ul className="relatorios-barras-h">
                {dados.categorias.map((c) => (
                  <li
                    key={c.categoria}
                    className="relatorios-barra-h"
                    title={`${c.categoria}: ${formatarMoeda(c.valor)} em ${c.quantidade} ${plural(c.quantidade, 'item', 'itens')}`}
                  >
                    <span className="relatorios-barra-h-topo">
                      <span>{c.categoria}</span>
                      <strong>{formatarMoeda(c.valor)}</strong>
                    </span>
                    <span className="relatorios-barra-h-trilho" aria-hidden="true">
                      <span
                        className="relatorios-barra-h-preench"
                        style={{ width: `${maiorCategoria === 0 ? 0 : (c.valor / maiorCategoria) * 100}%` }}
                      />
                    </span>
                    <span className="relatorios-barra-h-sub">
                      {c.quantidade} {plural(c.quantidade, 'item', 'itens')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </div>
      )}
    </>
  );
}

function AbaHorarios({ dados }: { dados: RelatorioVendas }) {
  const horas = dados.porHora;
  // Pico: a hora de maior valor (em empate, a de mais pedidos).
  const pico = horas.reduce((m, h) => (h.valor > m.valor || (h.valor === m.valor && h.pedidos > m.pedidos) ? h : m), horas[0]);
  const temValor = horas.some((h) => h.valor > 0);

  return (
    <>
      <h3 className="relatorios-subtitulo">Por hora</h3>
      {pico.pedidos > 0 && (
        <p className="relatorios-nota">
          Pico: {pico.hora}h, com {formatarMoeda(pico.valor)} em {pico.pedidos} {plural(pico.pedidos, 'pedido', 'pedidos')}.
        </p>
      )}
      <GraficoBarras
        barras={horas.map((h) => ({
          chave: String(h.hora),
          rotulo: `${h.hora}h`,
          titulo: `${h.hora}h: ${h.pedidos} ${plural(h.pedidos, 'pedido', 'pedidos')}, ${formatarMoeda(h.valor)}`,
          valor: h.valor,
          destaque: temValor && h.hora === pico.hora,
        }))}
      />

      <h3 className="relatorios-subtitulo">Por dia da semana</h3>
      <GraficoBarras
        barras={dados.porDiaSemana.map((d) => ({
          chave: String(d.dia),
          rotulo: DIAS_SEMANA[d.dia],
          titulo: `${DIAS_SEMANA_COMPLETOS[d.dia]}: ${d.pedidos} ${plural(d.pedidos, 'pedido', 'pedidos')}, ${formatarMoeda(d.valor)}`,
          valor: d.valor,
        }))}
      />
    </>
  );
}

interface Linha {
  chave: string;
  rotulo: string; // texto da barra
  nome: string; // texto da tabela e do título
  pedidos: number;
  valor: number;
}

// Mais de 31 dias: as barras e a tabela passam a ser por mês.
function linhasDoPeriodo(porDia: VendasPorDia[]): Linha[] {
  if (porDia.length <= 31) {
    return porDia.map((d) => ({
      chave: d.dia,
      rotulo: d.dia.slice(8),
      nome: formatarData(d.dia),
      pedidos: d.pedidos,
      valor: d.valor,
    }));
  }
  const meses = new Map<string, { pedidos: number; valor: number }>();
  for (const d of porDia) {
    const mes = d.dia.slice(0, 7);
    const acumulado = meses.get(mes) ?? { pedidos: 0, valor: 0 };
    acumulado.pedidos += d.pedidos;
    acumulado.valor = Math.round((acumulado.valor + d.valor) * 100) / 100;
    meses.set(mes, acumulado);
  }
  return [...meses.entries()].map(([mes, acc]) => {
    const [ano, numeroMes] = mes.split('-');
    return {
      chave: mes,
      rotulo: `${numeroMes}/${ano.slice(2)}`,
      nome: `${numeroMes}/${ano}`,
      pedidos: acc.pedidos,
      valor: acc.valor,
    };
  });
}

function AbaDias({ dados }: { dados: RelatorioVendas }) {
  const linhas = linhasDoPeriodo(dados.porDia);
  return (
    <>
      <GraficoBarras
        barras={linhas.map((l) => ({
          chave: l.chave,
          rotulo: l.rotulo,
          titulo: `${l.nome}: ${l.pedidos} ${plural(l.pedidos, 'pedido', 'pedidos')}, ${formatarMoeda(l.valor)}`,
          valor: l.valor,
        }))}
      />
      <Tabela
        dados={linhas}
        chave={(l) => l.chave}
        vazio="Nenhum pedido neste período."
        colunas={[
          { titulo: 'Dia', celula: (l) => <span className="sem-quebra">{l.nome}</span> },
          { titulo: 'Pedidos', alinhar: 'direita', celula: (l) => l.pedidos },
          { titulo: 'Valor', alinhar: 'direita', celula: (l) => <span className="sem-quebra">{formatarMoeda(l.valor)}</span> },
          {
            titulo: 'Ticket por pedido',
            alinhar: 'direita',
            celula: (l) => <span className="sem-quebra">{formatarMoeda(l.pedidos === 0 ? 0 : l.valor / l.pedidos)}</span>,
          },
        ]}
      />
    </>
  );
}

// ---------- Conteúdo com dados ----------

function Indicadores({ dados }: { dados: RelatorioVendas }) {
  const r: ResumoVendas = dados.resumo;
  const pedidosTotais = r.pedidos + r.cancelados;
  const doCliente = dados.porOrigem.find((o) => o.origem === 'CLIENTE')?.pedidos ?? 0;
  return (
    <>
      <div className="resumo">
        <Indicador rotulo="Faturamento" valor={formatarMoeda(r.faturamento)} cor="verde" icone="financeiro" />
        <Indicador rotulo="Pedidos" valor={String(r.pedidos)} cor="azul" icone="pedidos" />
        <Indicador rotulo="Ticket médio por conta" valor={formatarMoeda(r.ticketMedio)} cor="roxo" icone="estrela" />
        <Indicador rotulo="Itens vendidos" valor={String(r.itens)} cor="laranja" icone="cardapio" />
      </div>
      <div className="resumo">
        <Indicador rotulo="Tempo médio de preparo" valor={formatarMinutos(r.tempoMedioPreparoMin)} cor="azul" icone="relogio" />
        <Indicador rotulo="Tempo médio de mesa" valor={formatarMinutos(r.tempoMedioMesaMin)} cor="verde" icone="mesas" />
        <Indicador
          rotulo="Cancelados"
          valor={`${r.cancelados} · ${percentual(r.cancelados, pedidosTotais)}`}
          cor="vermelho"
          icone="fechar"
        />
        <Indicador rotulo="Feitos pelo cliente" valor={percentual(doCliente, r.pedidos)} cor="roxo" icone="perfil" />
      </div>
    </>
  );
}

// ---------- Tela ----------

export function Relatorios() {
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [aba, setAba] = useState('produtos');

  const intervalo = intervaloDo(periodo, de, ate);
  const invalido = intervalo !== null && intervalo.de > intervalo.ate;
  const caminho = intervalo && !invalido ? `/relatorios/vendas?de=${intervalo.de}&ate=${intervalo.ate}` : null;
  const relatorio = useDados<RelatorioVendas>(caminho);
  // Com erro na última busca, não mostra os dados do período anterior.
  const dados = relatorio.erro ? null : relatorio.dados;

  // Ao escolher o personalizado, começa com o período que estava na tela.
  function escolher(novo: Periodo) {
    if (novo === 'personalizado' && intervalo) {
      setDe(intervalo.de);
      setAte(intervalo.ate);
    }
    setPeriodo(novo);
  }

  return (
    <Pagina titulo="Relatórios de vendas">
      <div className="barra-ferramentas">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="segmentado-item"
              aria-pressed={periodo === p.id}
              onClick={() => escolher(p.id)}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <Botao variante="secundario" desabilitado={!dados} aoClicar={() => dados && baixarPlanilha(dados)}>
          Baixar planilha
        </Botao>
      </div>

      {periodo === 'personalizado' && (
        <div className="relatorios-datas">
          <Campo rotulo="Data inicial" tipo="date" valor={de} aoMudar={setDe} />
          <Campo rotulo="Data final" tipo="date" valor={ate} aoMudar={setAte} />
        </div>
      )}
      {intervalo === null && <Aviso tipo="info">Escolha a data inicial e a final.</Aviso>}
      {invalido && <Aviso tipo="erro">A data final é anterior à inicial.</Aviso>}
      {relatorio.erro && <Aviso tipo="erro">{relatorio.erro}</Aviso>}
      {relatorio.carregando && !dados && <Carregando />}

      {dados &&
        (dados.resumo.pedidos === 0 ? (
          <Aviso tipo="info">Nenhum pedido neste período.</Aviso>
        ) : (
          <>
            <p className="relatorios-periodo">
              {formatarData(dados.de)} a {formatarData(dados.ate)}
            </p>
            <Indicadores dados={dados} />
            <Abas
              abas={[
                { id: 'produtos', rotulo: 'Produtos' },
                { id: 'horarios', rotulo: 'Horários' },
                { id: 'dias', rotulo: 'Dias' },
              ]}
              ativa={aba}
              aoMudar={setAba}
            />
            {aba === 'produtos' && <AbaProdutos dados={dados} />}
            {aba === 'horarios' && <AbaHorarios dados={dados} />}
            {aba === 'dias' && <AbaDias dados={dados} />}
          </>
        ))}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/relatorios',
    rotulo: 'Relatórios',
    icone: 'grafico',
    perfis: ['GESTOR'],
    elemento: <Relatorios />,
    ordem: 33,
    grupo: 'Financeiro',
  },
];
