import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { lerPreco, mensagemErro, precoParaCampo } from '../../lib/restaurante';
import { FORMAS_PAGAMENTO_LANCAMENTO } from '../../lib/financeiro';
import type {
  CategoriaDTO,
  FornecedorOpcaoDTO,
  LancamentoDTO,
  ResumoFinanceiroDTO,
  TipoLancamento,
} from '../../lib/financeiro';
import {
  Abas,
  AreaTexto,
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
  Tabela,
  formatarData,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Indicador } from '../pedidos/comum';
import './financeiro.css';

// ---------- Datas e períodos ----------

type PeriodoId = 'HOJE' | 'SETE' | 'MES' | 'MES_PASSADO' | 'PERSONALIZADO';

const OPCOES_PERIODO: { id: PeriodoId; rotulo: string }[] = [
  { id: 'HOJE', rotulo: 'Hoje' },
  { id: 'SETE', rotulo: '7 dias' },
  { id: 'MES', rotulo: 'Este mês' },
  { id: 'MES_PASSADO', rotulo: 'Mês passado' },
  { id: 'PERSONALIZADO', rotulo: 'Personalizado' },
];

function dosDoisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

// Dia de calendário local no formato AAAA-MM-DD.
function textoDeData(d: Date): string {
  return `${d.getFullYear()}-${dosDoisDigitos(d.getMonth() + 1)}-${dosDoisDigitos(d.getDate())}`;
}

// "AAAA-MM-DD" para "dd/mm".
function dataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// "AAAA-MM-DD" para "dd/mm/aaaa".
function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function intervaloPredefinido(periodo: Exclude<PeriodoId, 'PERSONALIZADO'>): { de: string; ate: string } {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const dia = hoje.getDate();
  if (periodo === 'HOJE') return { de: textoDeData(hoje), ate: textoDeData(hoje) };
  if (periodo === 'SETE') return { de: textoDeData(new Date(ano, mes, dia - 6)), ate: textoDeData(hoje) };
  if (periodo === 'MES') return { de: textoDeData(new Date(ano, mes, 1)), ate: textoDeData(hoje) };
  return { de: textoDeData(new Date(ano, mes - 1, 1)), ate: textoDeData(new Date(ano, mes, 0)) };
}

interface EstadoPeriodo {
  periodo: PeriodoId;
  escolher(p: PeriodoId): void;
  de: string;
  ate: string;
  setDe(valor: string): void;
  setAte(valor: string): void;
  intervalo: { de: string; ate: string };
}

// Período dos cartões e filtros. "Personalizado" usa as duas datas digitadas.
function usarPeriodo(): EstadoPeriodo {
  const [periodo, setPeriodo] = useState<PeriodoId>('MES');
  const [de, setDe] = useState(() => intervaloPredefinido('MES').de);
  const [ate, setAte] = useState(() => intervaloPredefinido('MES').ate);
  const intervalo = periodo === 'PERSONALIZADO' ? { de, ate } : intervaloPredefinido(periodo);

  function escolher(p: PeriodoId) {
    // Ao entrar em "Personalizado", começa com o intervalo que estava na tela.
    if (p === 'PERSONALIZADO' && periodo !== 'PERSONALIZADO') {
      setDe(intervalo.de);
      setAte(intervalo.ate);
    }
    setPeriodo(p);
  }

  return { periodo, escolher, de, ate, setDe, setAte, intervalo };
}

function SeletorPeriodo({ estado }: { estado: EstadoPeriodo }) {
  return (
    <div className="financeiro-periodo">
      <div className="segmentado" role="group" aria-label="Período">
        {OPCOES_PERIODO.map((o) => (
          <button
            key={o.id}
            type="button"
            className="segmentado-item"
            aria-pressed={estado.periodo === o.id}
            onClick={() => estado.escolher(o.id)}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
      {estado.periodo === 'PERSONALIZADO' && (
        <div className="financeiro-datas">
          <Campo rotulo="De" tipo="date" valor={estado.de} aoMudar={estado.setDe} />
          <Campo rotulo="Até" tipo="date" valor={estado.ate} aoMudar={estado.setAte} />
        </div>
      )}
    </div>
  );
}

// ---------- Resumo ----------

function baixarCsv(resumo: ResumoFinanceiroDTO) {
  const celula = (valor: string | number) => `"${String(valor).replace(/"/g, '""')}"`;
  const numero = (valor: number) => valor.toFixed(2).replace('.', ',');
  const linhas = [
    ['Dia', 'Receitas', 'Despesas', 'Resultado'],
    ...resumo.porDia.map((d) => [
      dataBr(d.dia),
      numero(d.receitas),
      numero(d.despesas),
      numero(Math.round((d.receitas - d.despesas) * 100) / 100),
    ]),
  ];
  // O BOM no início faz o Excel abrir os acentos certo; ponto e vírgula é o separador do Excel em português.
  const texto = '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = endereco;
  link.download = `ganhos-e-gastos-${resumo.de}-a-${resumo.ate}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

interface LinhaGrafico {
  chave: string;
  rotulo: string;
  titulo: string;
  receitas: number;
  despesas: number;
}

// Mais de 31 dias: uma barra por mês.
function agruparPorMes(dias: ResumoFinanceiroDTO['porDia']): LinhaGrafico[] {
  const meses = new Map<string, LinhaGrafico>();
  for (const d of dias) {
    const chave = d.dia.slice(0, 7);
    const atual = meses.get(chave) ?? {
      chave,
      rotulo: `${d.dia.slice(5, 7)}/${d.dia.slice(0, 4)}`,
      titulo: `${d.dia.slice(5, 7)}/${d.dia.slice(0, 4)}`,
      receitas: 0,
      despesas: 0,
    };
    atual.receitas += d.receitas;
    atual.despesas += d.despesas;
    meses.set(chave, atual);
  }
  return Array.from(meses.values());
}

function alturaDaBarra(valor: number, maior: number): number {
  return maior > 0 ? (valor / maior) * 100 : 0;
}

function GraficoDias({ dias }: { dias: ResumoFinanceiroDTO['porDia'] }) {
  const movimento = dias.reduce((soma, d) => soma + d.receitas + d.despesas, 0);
  if (movimento === 0) return <p className="financeiro-vazio">Sem movimento no período.</p>;

  const linhas: LinhaGrafico[] =
    dias.length > 31
      ? agruparPorMes(dias)
      : dias.map((d) => ({
          chave: d.dia,
          rotulo: dataCurta(d.dia),
          titulo: dataBr(d.dia),
          receitas: d.receitas,
          despesas: d.despesas,
        }));

  const maior = Math.max(0, ...linhas.map((l) => l.receitas), ...linhas.map((l) => l.despesas));

  return (
    <>
      <div className="financeiro-legenda">
        <span>
          <i className="financeiro-marca financeiro-marca-receita" aria-hidden="true" /> Entradas (receitas)
        </span>
        <span>
          <i className="financeiro-marca financeiro-marca-despesa" aria-hidden="true" /> Saídas (despesas)
        </span>
      </div>
      <div className="financeiro-grafico" role="img" aria-label="Entradas e saídas por dia">
        <div className="financeiro-colunas">
          {linhas.map((l) => (
            <div className="financeiro-coluna" key={l.chave}>
              <div className="financeiro-barras">
                <div
                  className="financeiro-barra financeiro-barra-receita"
                  style={{ height: `${alturaDaBarra(l.receitas, maior)}%` }}
                  title={`${l.titulo} · entradas: ${formatarMoeda(l.receitas)}`}
                />
                <div
                  className="financeiro-barra financeiro-barra-despesa"
                  style={{ height: `${alturaDaBarra(l.despesas, maior)}%` }}
                  title={`${l.titulo} · saídas: ${formatarMoeda(l.despesas)}`}
                />
              </div>
              <span className="financeiro-rotulo-dia">{l.rotulo}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

interface ItemLista {
  chave: string;
  rotulo: string;
  valor: number;
  cor?: string;
}

// Lista com barra proporcional ao maior item. O percentual é do total da lista.
function ListaBarras({ itens, vazio }: { itens: ItemLista[]; vazio: string }) {
  if (itens.length === 0) return <p className="financeiro-vazio">{vazio}</p>;
  const total = itens.reduce((soma, i) => soma + i.valor, 0);
  const maior = Math.max(0, ...itens.map((i) => i.valor));
  return (
    <ul className="financeiro-lista">
      {itens.map((i) => {
        const percentual = total > 0 ? Math.round((i.valor / total) * 100) : 0;
        return (
          <li key={i.chave} className="financeiro-lista-item">
            <div className="financeiro-lista-topo">
              <span>{i.rotulo}</span>
              <span>
                <strong>{formatarMoeda(i.valor)}</strong> · {percentual}%
              </span>
            </div>
            <div className="financeiro-trilha">
              <div
                className="financeiro-preenchimento"
                style={{
                  width: `${maior > 0 ? (i.valor / maior) * 100 : 0}%`,
                  ...(i.cor ? { background: i.cor } : {}),
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Resumo({ aoVerEmAberto }: { aoVerEmAberto: () => void }) {
  const periodo = usarPeriodo();
  const invertido = periodo.intervalo.de > periodo.intervalo.ate;
  const resumo = useDados<ResumoFinanceiroDTO>(
    invertido ? null : `/financeiro/resumo?de=${periodo.intervalo.de}&ate=${periodo.intervalo.ate}`
  );
  const dados = resumo.dados;

  return (
    <>
      <SeletorPeriodo estado={periodo} />

      {invertido && <Aviso tipo="erro">A data final é anterior à inicial.</Aviso>}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="resumo">
            <Indicador rotulo="Vendas" valor={formatarMoeda(dados.vendas)} cor="azul" icone="pedidos" />
            <Indicador
              rotulo="Outras receitas"
              valor={formatarMoeda(dados.outrasReceitas)}
              cor="verde"
              icone="mais-circulo"
            />
            <Indicador rotulo="Despesas" valor={formatarMoeda(dados.despesas)} cor="laranja" icone="menos" />
            <Indicador
              rotulo="Resultado"
              valor={formatarMoeda(dados.resultado)}
              cor={dados.resultado >= 0 ? 'verde' : 'vermelho'}
              icone="grafico"
            />
          </div>

          <p className="financeiro-nota">
            Dentro das vendas, {formatarMoeda(dados.taxaServico)} é taxa de serviço. Gorjetas no período:{' '}
            {formatarMoeda(dados.gorjetas)} (não entram no resultado).
          </p>

          {dados.aPagar > 0 && (
            <Aviso tipo="info">
              <span>
                Há {formatarMoeda(dados.aPagar)} em despesas a pagar
                {dados.aPagarVencidas > 0
                  ? `, ${dados.aPagarVencidas} ${dados.aPagarVencidas === 1 ? 'vencida' : 'vencidas'}`
                  : ''}
                .{' '}
              </span>
              <Botao variante="texto" aoClicar={aoVerEmAberto}>
                Ver
              </Botao>
            </Aviso>
          )}

          <section className="cartao">
            <h2 className="cartao-titulo">Entradas e saídas por dia</h2>
            <GraficoDias dias={dados.porDia} />
          </section>

          <div className="financeiro-cartoes">
            <section className="cartao">
              <h2 className="cartao-titulo">Despesas por categoria</h2>
              <ListaBarras
                vazio="Nenhuma despesa paga no período."
                itens={dados.despesasPorCategoria.map((c) => ({
                  chave: c.categoria,
                  rotulo: c.categoria,
                  valor: c.valor,
                  cor: c.cor,
                }))}
              />
            </section>
            <section className="cartao">
              <h2 className="cartao-titulo">Vendas por forma de pagamento</h2>
              <ListaBarras
                vazio="Nenhuma venda no período."
                itens={dados.receitasPorForma.map((f) => ({ chave: f.forma, rotulo: f.forma, valor: f.valor }))}
              />
            </section>
          </div>

          <div className="pagina-acoes">
            <Botao variante="secundario" desabilitado={dados.porDia.length === 0} aoClicar={() => baixarCsv(dados)}>
              Baixar planilha
            </Botao>
          </div>
        </>
      )}
    </>
  );
}

// ---------- Lançamentos ----------

function SeloSituacao({ lancamento }: { lancamento: LancamentoDTO }) {
  if (lancamento.pago) return <Selo cor="verde">Pago</Selo>;
  const hoje = textoDeData(new Date());
  const vencido = lancamento.vencimento !== null && lancamento.vencimento < hoje;
  if (vencido) {
    return (
      <span className="financeiro-situacao">
        <Selo cor="vermelho">Vencido</Selo>
        <span className="financeiro-detalhe">venceu em {formatarData(lancamento.vencimento ?? '')}</span>
      </span>
    );
  }
  return (
    <span className="financeiro-situacao">
      <Selo cor="amarelo">A pagar</Selo>
      {lancamento.vencimento && (
        <span className="financeiro-detalhe">vence em {formatarData(lancamento.vencimento)}</span>
      )}
    </span>
  );
}

function FormularioLancamento({
  tipo,
  lancamento,
  categorias,
  aoFechar,
  aoSalvo,
}: {
  tipo: TipoLancamento;
  lancamento: LancamentoDTO | null;
  categorias: CategoriaDTO[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const fornecedores = useDados<FornecedorOpcaoDTO[]>(tipo === 'DESPESA' ? '/financeiro/fornecedores' : null);
  const [categoriaId, setCategoriaId] = useState(lancamento ? String(lancamento.categoria.id) : '');
  const [descricao, setDescricao] = useState(lancamento?.descricao ?? '');
  const [valor, setValor] = useState(lancamento ? precoParaCampo(lancamento.valor) : '');
  const [data, setData] = useState(lancamento?.data ?? textoDeData(new Date()));
  const [pago, setPago] = useState(lancamento ? lancamento.pago : true);
  const [vencimento, setVencimento] = useState(lancamento?.vencimento ?? '');
  const [forma, setForma] = useState(lancamento?.formaPagamento ?? '');
  const [fornecedorId, setFornecedorId] = useState(lancamento?.fornecedor ? String(lancamento.fornecedor.id) : '');
  const [observacao, setObservacao] = useState(lancamento?.observacao ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Só as categorias ativas do tipo; a da própria edição aparece mesmo se estiver desativada.
  const opcoesCategoria = categorias
    .filter((c) => c.tipo === tipo && (c.ativa || c.id === lancamento?.categoria.id))
    .map((c) => ({ valor: String(c.id), rotulo: c.ativa ? c.nome : `${c.nome} (desativada)` }));

  const opcoesFornecedor = (fornecedores.dados ?? []).map((f) => ({ valor: String(f.id), rotulo: f.nome }));
  if (lancamento?.fornecedor && !opcoesFornecedor.some((o) => o.valor === String(lancamento.fornecedor?.id))) {
    opcoesFornecedor.push({ valor: String(lancamento.fornecedor.id), rotulo: lancamento.fornecedor.nome });
  }

  const titulo = `${lancamento ? 'Editar' : 'Nova'} ${tipo === 'DESPESA' ? 'despesa' : 'receita'}`;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const numero = lerPreco(valor);
    if (!categoriaId) return setErro('Escolha a categoria.');
    if (descricao.trim() === '') return setErro('Informe a descrição.');
    if (numero === null || numero <= 0) return setErro('Informe um valor maior que zero.');
    if (numero > 9999999.99) return setErro('Valor muito alto.');
    if (!data) return setErro('Informe a data.');

    const corpo = {
      tipo,
      categoriaId: Number(categoriaId),
      descricao: descricao.trim(),
      valor: numero,
      data,
      pago,
      vencimento: pago ? null : vencimento || null,
      formaPagamento: forma || null,
      fornecedorId: tipo === 'DESPESA' && fornecedorId ? Number(fornecedorId) : null,
      observacao: observacao.trim() || null,
    };

    setEnviando(true);
    try {
      if (lancamento) {
        await api.put<LancamentoDTO>(`/financeiro/lancamentos/${lancamento.id}`, corpo);
        aoSalvo(`${corpo.descricao} atualizada.`);
      } else {
        await api.post<LancamentoDTO>('/financeiro/lancamentos', corpo);
        aoSalvo(`${corpo.descricao} lançada.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao
          rotulo="Categoria"
          valor={categoriaId}
          aoMudar={setCategoriaId}
          opcoes={opcoesCategoria}
          vazio="Escolha uma categoria"
          obrigatorio
        />
        <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} obrigatorio />
        <div className="financeiro-linha">
          <Campo rotulo="Valor (R$)" valor={valor} aoMudar={setValor} obrigatorio />
          <Campo rotulo="Data" tipo="date" valor={data} aoMudar={setData} obrigatorio />
        </div>
        <Caixa rotulo="Já está pago" marcado={pago} aoMudar={setPago} />
        {!pago && <Campo rotulo="Vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} />}
        <Selecao
          rotulo="Forma de pagamento"
          valor={forma}
          aoMudar={setForma}
          vazio="Não informada"
          opcoes={FORMAS_PAGAMENTO_LANCAMENTO.map((f) => ({ valor: f, rotulo: f }))}
        />
        {tipo === 'DESPESA' && (
          <Selecao
            rotulo="Fornecedor"
            valor={fornecedorId}
            aoMudar={setFornecedorId}
            vazio="Nenhum"
            opcoes={opcoesFornecedor}
          />
        )}
        <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={2} />
        <Botao tipo="submit" desabilitado={enviando}>
          {enviando ? 'Salvando...' : 'Salvar'}
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

function Lancamentos({ situacaoInicial }: { situacaoInicial: string }) {
  const periodo = usarPeriodo();
  const [tipo, setTipo] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [situacao, setSituacao] = useState(situacaoInicial);
  const [formulario, setFormulario] = useState<{ tipo: TipoLancamento; lancamento: LancamentoDTO | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const categorias = useDados<CategoriaDTO[]>('/financeiro/categorias');

  const invertido = situacao !== 'ABERTO' && periodo.intervalo.de > periodo.intervalo.ate;
  const partes = new URLSearchParams();
  if (situacao !== 'ABERTO') {
    partes.set('de', periodo.intervalo.de);
    partes.set('ate', periodo.intervalo.ate);
  }
  if (tipo) partes.set('tipo', tipo);
  if (categoriaId) partes.set('categoriaId', categoriaId);
  if (situacao) partes.set('situacao', situacao);
  const lancamentos = useDados<LancamentoDTO[]>(invertido ? null : `/financeiro/lancamentos?${partes.toString()}`);

  const lista = lancamentos.dados ?? [];
  const totalDespesas = lista.filter((l) => l.tipo === 'DESPESA').reduce((s, l) => s + l.valor, 0);
  const totalReceitas = lista.filter((l) => l.tipo === 'RECEITA').reduce((s, l) => s + l.valor, 0);
  const cheio = lista.length >= 500;

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    setErro(null);
    setAviso(null);
    try {
      await acao();
      setAviso(sucesso);
      lancamentos.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoesDe(l: LancamentoDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [];
    if (!l.pago) {
      acoes.push({
        rotulo: 'Marcar como pago',
        icone: 'visto',
        aoClicar: () =>
          void executar(() => api.post(`/financeiro/lancamentos/${l.id}/pagar`), `${l.descricao} marcada como paga.`),
      });
    }
    acoes.push({
      rotulo: 'Editar',
      icone: 'lapis',
      aoClicar: () => setFormulario({ tipo: l.tipo, lancamento: l }),
    });
    if (l.compraId === null) {
      acoes.push({
        rotulo: 'Excluir',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          if (!window.confirm(`Excluir o lançamento "${l.descricao}"? Não tem volta.`)) return;
          void executar(() => api.del(`/financeiro/lancamentos/${l.id}`), `${l.descricao} excluída.`);
        },
      });
    }
    return acoes;
  }

  return (
    <>
      <SeletorPeriodo estado={periodo} />

      <div className="barra-ferramentas">
        <div className="financeiro-filtros">
          <Selecao
            rotulo="Tipo"
            valor={tipo}
            aoMudar={setTipo}
            vazio="Todos"
            opcoes={[
              { valor: 'DESPESA', rotulo: 'Despesas' },
              { valor: 'RECEITA', rotulo: 'Receitas' },
            ]}
          />
          <Selecao
            rotulo="Categoria"
            valor={categoriaId}
            aoMudar={setCategoriaId}
            vazio="Todas"
            opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
          />
          <Selecao
            rotulo="Situação"
            valor={situacao}
            aoMudar={setSituacao}
            vazio="Todas"
            opcoes={[
              { valor: 'PAGO', rotulo: 'Pagas' },
              { valor: 'ABERTO', rotulo: 'Em aberto' },
            ]}
          />
        </div>
        <div className="pagina-acoes">
          <Botao variante="secundario" aoClicar={() => setFormulario({ tipo: 'DESPESA', lancamento: null })}>
            Nova despesa
          </Botao>
          <Botao aoClicar={() => setFormulario({ tipo: 'RECEITA', lancamento: null })}>Nova receita</Botao>
        </div>
      </div>

      {situacao === 'ABERTO' && <Aviso tipo="info">Mostrando tudo o que está em aberto, em qualquer data.</Aviso>}
      {invertido && <Aviso tipo="erro">A data final é anterior à inicial.</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lancamentos.erro && <Aviso tipo="erro">{lancamentos.erro}</Aviso>}
      {lancamentos.carregando && !lancamentos.dados && <Carregando />}

      {lancamentos.dados && (
        <>
          <Tabela
            dados={lista}
            chave={(l) => l.id}
            vazio="Nenhum lançamento neste filtro."
            colunas={[
              {
                titulo: 'Data',
                celula: (l) => <span className="sem-quebra">{formatarData(l.data)}</span>,
              },
              {
                titulo: 'Descrição',
                celula: (l) => (
                  <span className="financeiro-texto">
                    <span className="financeiro-nome">
                      {l.descricao}
                      {l.compraId !== null && <span className="financeiro-detalhe"> · Compra #{l.compraId}</span>}
                    </span>
                    <span className="financeiro-detalhe">
                      {[l.categoria.nome, l.fornecedor?.nome].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                ),
              },
              {
                titulo: 'Tipo',
                celula: (l) =>
                  l.tipo === 'DESPESA' ? <Selo cor="vermelho">Despesa</Selo> : <Selo cor="verde">Receita</Selo>,
              },
              {
                titulo: 'Valor',
                alinhar: 'direita',
                celula: (l) => <strong className="sem-quebra">{formatarMoeda(l.valor)}</strong>,
              },
              { titulo: 'Situação', celula: (l) => <SeloSituacao lancamento={l} /> },
              {
                titulo: 'Ações',
                acoes: true,
                celula: (l) => <MenuAcoes rotulo={`Ações de ${l.descricao}`} acoes={acoesDe(l)} />,
              },
            ]}
          />

          <div className="financeiro-totais">
            <span>
              Despesas no filtro: <strong>{formatarMoeda(totalDespesas)}</strong>
            </span>
            <span>
              Receitas no filtro: <strong>{formatarMoeda(totalReceitas)}</strong>
            </span>
          </div>
          {cheio && (
            <Aviso tipo="info">Mostrando os 500 lançamentos mais recentes. Escolha um período menor para ver o resto.</Aviso>
          )}
        </>
      )}

      {formulario && categorias.dados && (
        <FormularioLancamento
          tipo={formulario.tipo}
          lancamento={formulario.lancamento}
          categorias={categorias.dados}
          aoFechar={() => setFormulario(null)}
          aoSalvo={(mensagem) => {
            setErro(null);
            setAviso(mensagem);
            lancamentos.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Categorias ----------

function FormularioCategoria({
  categoria,
  aoFechar,
  aoSalvo,
}: {
  categoria: CategoriaDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [tipo, setTipo] = useState<string>(categoria?.tipo ?? 'DESPESA');
  const [cor, setCor] = useState(categoria?.cor ?? '#64748b');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim() === '') return setErro('Informe o nome da categoria.');
    setEnviando(true);
    try {
      if (categoria) {
        await api.put(`/financeiro/categorias/${categoria.id}`, { nome: nome.trim(), cor });
        aoSalvo(`Categoria ${nome.trim()} atualizada.`);
      } else {
        await api.post('/financeiro/categorias', { nome: nome.trim(), tipo, cor });
        aoSalvo(`Categoria ${nome.trim()} criada.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={categoria ? 'Editar categoria' : 'Nova categoria'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        {categoria ? (
          <p className="financeiro-detalhe">Tipo: {categoria.tipo === 'DESPESA' ? 'Despesa' : 'Receita'}</p>
        ) : (
          <Selecao
            rotulo="Tipo"
            valor={tipo}
            aoMudar={setTipo}
            opcoes={[
              { valor: 'DESPESA', rotulo: 'Despesa' },
              { valor: 'RECEITA', rotulo: 'Receita' },
            ]}
            obrigatorio
          />
        )}
        <label className="campo">
          <span className="campo-rotulo">Cor</span>
          <input
            className="financeiro-cor"
            type="color"
            value={cor}
            onChange={(e) => setCor(e.target.value)}
          />
        </label>
        <Botao tipo="submit" desabilitado={enviando}>
          {enviando ? 'Salvando...' : 'Salvar'}
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

function Categorias() {
  const categorias = useDados<CategoriaDTO[]>('/financeiro/categorias');
  const [formulario, setFormulario] = useState<CategoriaDTO | 'NOVA' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    setErro(null);
    setAviso(null);
    try {
      await acao();
      setAviso(sucesso);
      categorias.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoesDe(c: CategoriaDTO): AcaoMenu[] {
    return [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setFormulario(c) },
      c.ativa
        ? {
            rotulo: 'Desativar',
            icone: 'cadeado',
            aoClicar: () =>
              void executar(() => api.put(`/financeiro/categorias/${c.id}`, { ativa: false }), `${c.nome} desativada.`),
          }
        : {
            rotulo: 'Reativar',
            icone: 'visto',
            aoClicar: () =>
              void executar(() => api.put(`/financeiro/categorias/${c.id}`, { ativa: true }), `${c.nome} reativada.`),
          },
      {
        rotulo: 'Excluir',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          if (!window.confirm(`Excluir a categoria "${c.nome}"? Não tem volta.`)) return;
          void executar(() => api.del(`/financeiro/categorias/${c.id}`), `${c.nome} excluída.`);
        },
      },
    ];
  }

  const lista = categorias.dados ?? [];

  return (
    <>
      <div className="barra-ferramentas">
        <span className="financeiro-detalhe">
          Desative a categoria que não usa mais: ela some das listas, mas os lançamentos antigos continuam.
        </span>
        <div className="pagina-acoes">
          <Botao aoClicar={() => setFormulario('NOVA')}>Nova categoria</Botao>
        </div>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
      {categorias.carregando && !categorias.dados && <Carregando />}

      {categorias.dados && (
        <Tabela
          dados={lista}
          chave={(c) => c.id}
          vazio="Nenhuma categoria."
          colunas={[
            {
              titulo: 'Cor',
              celula: (c) => <span className="financeiro-bolinha" style={{ background: c.cor }} aria-hidden="true" />,
            },
            { titulo: 'Nome', celula: (c) => <strong>{c.nome}</strong> },
            {
              titulo: 'Tipo',
              celula: (c) =>
                c.tipo === 'DESPESA' ? <Selo cor="vermelho">Despesa</Selo> : <Selo cor="verde">Receita</Selo>,
            },
            { titulo: 'Lançamentos', alinhar: 'direita', celula: (c) => String(c.lancamentos) },
            {
              titulo: 'Situação',
              celula: (c) => (c.ativa ? <Selo cor="verde">Ativa</Selo> : <Selo cor="cinza">Desativada</Selo>),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => <MenuAcoes rotulo={`Ações da categoria ${c.nome}`} acoes={acoesDe(c)} />,
            },
          ]}
        />
      )}

      {formulario && (
        <FormularioCategoria
          categoria={formulario === 'NOVA' ? null : formulario}
          aoFechar={() => setFormulario(null)}
          aoSalvo={(mensagem) => {
            setErro(null);
            setAviso(mensagem);
            categorias.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Tela ----------

export function GanhosEGastos() {
  const [aba, setAba] = useState('resumo');
  const [situacaoInicial, setSituacaoInicial] = useState('');

  return (
    <Pagina titulo="Ganhos e gastos">
      <Abas
        abas={[
          { id: 'resumo', rotulo: 'Resumo' },
          { id: 'lancamentos', rotulo: 'Lançamentos' },
          { id: 'categorias', rotulo: 'Categorias' },
        ]}
        ativa={aba}
        aoMudar={(id) => {
          if (id !== 'lancamentos') setSituacaoInicial('');
          setAba(id);
        }}
      />
      {aba === 'resumo' && (
        <Resumo
          aoVerEmAberto={() => {
            setSituacaoInicial('ABERTO');
            setAba('lancamentos');
          }}
        />
      )}
      {aba === 'lancamentos' && <Lancamentos situacaoInicial={situacaoInicial} />}
      {aba === 'categorias' && <Categorias />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/financeiro',
    rotulo: 'Ganhos e gastos',
    icone: 'grafico',
    perfis: ['GESTOR'],
    elemento: <GanhosEGastos />,
    ordem: 28,
    grupo: 'Financeiro',
  },
];
