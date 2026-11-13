import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro } from '../../lib/restaurante';
import {
  ROTULO_TIPO_MOVIMENTO,
  ROTULO_UNIDADE,
  SIGLA_UNIDADE,
  formatarPercentual,
  formatarQuantidade,
  lerNumeroBr,
  numeroParaCampo,
} from '../../lib/insumos';
import type {
  FichaDTO,
  InsumoDTO,
  MovimentoInsumoDTO,
  SituacaoInsumo,
  UnidadeInsumo,
} from '../../lib/insumos';
import {
  Abas,
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
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import { Indicador } from '../pedidos/comum';
import './insumos.css';

const UNIDADES = Object.keys(ROTULO_UNIDADE) as UnidadeInsumo[];

const SITUACAO: Record<SituacaoInsumo, { rotulo: string; cor: 'verde' | 'amarelo' | 'vermelho' }> = {
  OK: { rotulo: 'Em dia', cor: 'verde' },
  BAIXO: { rotulo: 'Baixo', cor: 'amarelo' },
  ZERADO: { rotulo: 'Zerado', cor: 'vermelho' },
};

// Tipos que o gestor lança à mão (VENDA e DEVOLUCAO vêm dos pedidos).
type TipoLancado = 'ENTRADA' | 'SAIDA' | 'AJUSTE';

function SeloSituacao({ situacao }: { situacao: SituacaoInsumo }) {
  const s = SITUACAO[situacao];
  return <Selo cor={s.cor}>{s.rotulo}</Selo>;
}

// Texto sem acento e em minúsculas, para a busca de pratos.
function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// ---------- Insumos ----------

// Cadastro de insumo (novo ou edição). Quantidades e custo aceitam vírgula.
function FormularioInsumo({
  insumo,
  aoFechar,
  aoSalvo,
}: {
  insumo: InsumoDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(insumo?.nome ?? '');
  const [unidade, setUnidade] = useState<UnidadeInsumo>(insumo?.unidade ?? 'KG');
  const [minimo, setMinimo] = useState(insumo ? numeroParaCampo(insumo.estoqueMinimo) : '');
  const [custo, setCusto] = useState(insumo ? numeroParaCampo(insumo.custoUnitario, 4) : '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro('Informe o nome do insumo.');
      return;
    }
    const estoqueMinimo = minimo.trim() === '' ? 0 : lerNumeroBr(minimo);
    if (estoqueMinimo === null) {
      setErro('Estoque mínimo inválido.');
      return;
    }
    const custoUnitario = custo.trim() === '' ? 0 : lerNumeroBr(custo);
    if (custoUnitario === null) {
      setErro('Custo inválido.');
      return;
    }
    const corpo = { nome: nomeLimpo, unidade, estoqueMinimo, custoUnitario };
    setEnviando(true);
    try {
      if (insumo) {
        await api.put<InsumoDTO>(`/insumos/${insumo.id}`, corpo);
      } else {
        await api.post<InsumoDTO>('/insumos', corpo);
      }
      aoSalvo(`Insumo ${nomeLimpo} ${insumo ? 'atualizado' : 'cadastrado'}.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={insumo ? 'Editar insumo' : 'Novo insumo'} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Selecao
          rotulo="Unidade"
          valor={unidade}
          aoMudar={(v) => setUnidade(v as UnidadeInsumo)}
          opcoes={UNIDADES.map((u) => ({ valor: u, rotulo: ROTULO_UNIDADE[u] }))}
        />
        <Campo rotulo={`Estoque mínimo (${SIGLA_UNIDADE[unidade]})`} valor={minimo} aoMudar={setMinimo} />
        <Campo rotulo="Custo por unidade (R$)" valor={custo} aoMudar={setCusto} />
        <div className="insumos-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Salvar
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Entrada, saída ou acerto de contagem de um insumo.
function Movimento({
  insumo,
  tipoInicial,
  aoFechar,
  aoSalvo,
}: {
  insumo: InsumoDTO;
  tipoInicial: TipoLancado;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoLancado>(tipoInicial);
  const [quantidade, setQuantidade] = useState('');
  const [custo, setCusto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const sigla = SIGLA_UNIDADE[insumo.unidade];

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = lerNumeroBr(quantidade);
    if (n === null || (tipo !== 'AJUSTE' && n <= 0)) {
      setErro(tipo === 'AJUSTE' ? 'Informe quantos há agora na contagem.' : 'Informe a quantidade.');
      return;
    }
    let custoUnitario: number | null = null;
    if (tipo === 'ENTRADA' && custo.trim() !== '') {
      const c = lerNumeroBr(custo);
      if (c === null) {
        setErro('Custo inválido.');
        return;
      }
      custoUnitario = c;
    }
    setEnviando(true);
    try {
      const resposta = await api.post<{ saldo: number }>(`/insumos/${insumo.id}/movimentos`, {
        tipo,
        quantidade: n,
        custoUnitario,
        motivo: motivo.trim() || null,
      });
      aoSalvo(`${insumo.nome}: saldo de ${formatarQuantidade(resposta.saldo, insumo.unidade)}.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Movimento · ${insumo.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <p>Saldo atual: {formatarQuantidade(insumo.estoque, insumo.unidade)}</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao
          rotulo="O que aconteceu"
          valor={tipo}
          aoMudar={(v) => setTipo(v as TipoLancado)}
          opcoes={[
            { valor: 'ENTRADA', rotulo: 'Entrada (chegou mercadoria ou foi produzido)' },
            { valor: 'SAIDA', rotulo: 'Saída (perda, quebra, consumo da casa)' },
            { valor: 'AJUSTE', rotulo: 'Acerto de contagem (informar o saldo contado)' },
          ]}
        />
        <Campo
          rotulo={tipo === 'AJUSTE' ? `Saldo contado (${sigla})` : `Quantidade (${sigla})`}
          valor={quantidade}
          aoMudar={setQuantidade}
          obrigatorio
        />
        {tipo === 'ENTRADA' && (
          <>
            <Campo
              rotulo="Custo por unidade nesta entrada (opcional)"
              valor={custo}
              aoMudar={setCusto}
            />
            <p className="insumos-dica-custo">Com o custo informado, o sistema recalcula o custo médio.</p>
          </>
        )}
        <Campo rotulo="Motivo (opcional)" valor={motivo} aoMudar={setMotivo} />
        <div className="insumos-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Lançar
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

function Historico({ insumo, aoFechar }: { insumo: InsumoDTO; aoFechar: () => void }) {
  const movimentos = useDados<MovimentoInsumoDTO[]>(`/insumos/${insumo.id}/movimentos`);
  return (
    <Modal aberto titulo={`Movimentos · ${insumo.nome}`} aoFechar={aoFechar}>
      {movimentos.erro && <Aviso tipo="erro">{movimentos.erro}</Aviso>}
      {movimentos.carregando && <Carregando />}
      {movimentos.dados && (
        <Tabela
          dados={movimentos.dados}
          chave={(m) => m.id}
          vazio="Nenhum movimento ainda."
          colunas={[
            {
              titulo: 'Quando',
              celula: (m) => <span className="insumos-sem-quebra">{formatarDataHora(m.criadoEm)}</span>,
            },
            {
              titulo: 'Movimento',
              celula: (m) => (
                <span className="produto-texto">
                  <span className="produto-nome">{ROTULO_TIPO_MOVIMENTO[m.tipo]}</span>
                  {(m.motivo || m.usuarioNome) && (
                    <span className="produto-descricao">{[m.motivo, m.usuarioNome].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
              ),
            },
            {
              titulo: 'Quantidade',
              alinhar: 'direita',
              celula: (m) => (
                <span className="insumos-quantidade-sinal">
                  {m.quantidade > 0 ? '+' : ''}
                  {formatarQuantidade(m.quantidade, insumo.unidade)}
                </span>
              ),
            },
            {
              titulo: 'Saldo',
              alinhar: 'direita',
              celula: (m) => <strong>{formatarQuantidade(m.saldo, insumo.unidade)}</strong>,
            },
          ]}
        />
      )}
    </Modal>
  );
}

// Aba Insumos. A cozinha vê só a tabela (sem custo e sem ações).
function AbaInsumos({ gestor }: { gestor: boolean }) {
  const insumos = useDados<InsumoDTO[]>('/insumos');
  const [movimento, setMovimento] = useState<{ insumo: InsumoDTO; tipo: TipoLancado } | null>(null);
  const [historico, setHistorico] = useState<InsumoDTO | null>(null);
  const [editando, setEditando] = useState<InsumoDTO | 'novo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const lista = insumos.dados ?? [];

  async function excluir(insumo: InsumoDTO) {
    if (
      !window.confirm(
        `Excluir o insumo "${insumo.nome}"? Se ele já teve movimentos, ele só sai da lista e o histórico fica guardado.`
      )
    ) {
      return;
    }
    setErro(null);
    setAviso(null);
    try {
      await api.del(`/insumos/${insumo.id}`);
      setAviso(`${insumo.nome} removido.`);
      insumos.recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  const colunas: ColunaTabela<InsumoDTO>[] = [
    {
      titulo: 'Insumo',
      celula: (i) => <span className="produto-nome">{i.nome}</span>,
    },
    { titulo: 'Unidade', celula: (i) => ROTULO_UNIDADE[i.unidade] },
    {
      titulo: 'Saldo',
      alinhar: 'direita',
      celula: (i) => <strong>{formatarQuantidade(i.estoque, i.unidade)}</strong>,
    },
    { titulo: 'Mínimo', alinhar: 'direita', celula: (i) => formatarQuantidade(i.estoqueMinimo, i.unidade) },
    ...(gestor
      ? [
          {
            titulo: 'Custo por unidade',
            alinhar: 'direita' as const,
            celula: (i: InsumoDTO) => `${formatarMoeda(i.custoUnitario)} / ${SIGLA_UNIDADE[i.unidade]}`,
          },
        ]
      : []),
    { titulo: 'Situação', celula: (i) => <SeloSituacao situacao={i.situacao} /> },
    ...(gestor
      ? [
          {
            titulo: 'Ações',
            acoes: true,
            celula: (i: InsumoDTO) => (
              <MenuAcoes
                rotulo={`Ações do insumo ${i.nome}`}
                acoes={[
                  { rotulo: 'Entrada', icone: 'mais-circulo', aoClicar: () => setMovimento({ insumo: i, tipo: 'ENTRADA' }) },
                  { rotulo: 'Saída', icone: 'menos', aoClicar: () => setMovimento({ insumo: i, tipo: 'SAIDA' }) },
                  {
                    rotulo: 'Acerto de contagem',
                    icone: 'grade',
                    aoClicar: () => setMovimento({ insumo: i, tipo: 'AJUSTE' }),
                  },
                  { rotulo: 'Ver movimentos', icone: 'lista', aoClicar: () => setHistorico(i) },
                  { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(i) },
                  { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(i) },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      {gestor && (
        <div className="pagina-acoes">
          <Botao aoClicar={() => setEditando('novo')}>Novo insumo</Botao>
        </div>
      )}

      {insumos.dados && (
        <div className="resumo">
          <Indicador rotulo="Insumos" valor={String(lista.length)} cor="azul" icone="lista" />
          <Indicador
            rotulo="Estoque baixo"
            valor={String(lista.filter((i) => i.situacao === 'BAIXO').length)}
            cor="laranja"
            icone="relogio"
          />
          <Indicador
            rotulo="Zerados"
            valor={String(lista.filter((i) => i.situacao === 'ZERADO').length)}
            cor="vermelho"
            icone="fechar"
          />
        </div>
      )}

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {insumos.erro && <Aviso tipo="erro">{insumos.erro}</Aviso>}
      {insumos.carregando && !insumos.dados && <Carregando />}

      {insumos.dados && (
        <Tabela
          dados={lista}
          chave={(i) => i.id}
          vazio="Nenhum insumo cadastrado."
          colunas={colunas}
        />
      )}

      {movimento && (
        <Movimento
          insumo={movimento.insumo}
          tipoInicial={movimento.tipo}
          aoFechar={() => setMovimento(null)}
          aoSalvo={(mensagem) => {
            setErro(null);
            setAviso(mensagem);
            insumos.recarregar();
          }}
        />
      )}
      {historico && <Historico insumo={historico} aoFechar={() => setHistorico(null)} />}
      {editando && (
        <FormularioInsumo
          insumo={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={(mensagem) => {
            setErro(null);
            setAviso(mensagem);
            insumos.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Fichas técnicas e custos (gestor) ----------

interface LinhaFicha {
  chave: number;
  insumoId: string;
  quantidade: string;
}

let ultimaChave = 0;
function novaChave(): number {
  ultimaChave += 1;
  return ultimaChave;
}

// Editor da ficha: troca a lista inteira de insumos do prato. O custo e a margem são recalculados ao vivo.
function EditorFicha({
  ficha,
  insumos,
  aoFechar,
  aoSalvo,
}: {
  ficha: FichaDTO;
  insumos: InsumoDTO[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [linhas, setLinhas] = useState<LinhaFicha[]>(() =>
    ficha.itens.map((i) => ({
      chave: novaChave(),
      insumoId: String(i.insumoId),
      quantidade: numeroParaCampo(i.quantidade),
    }))
  );
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Insumos ativos mais os que já estão na ficha (mesmo que tenham sido desativados depois).
  const catalogo = new Map<number, { nome: string; unidade: UnidadeInsumo; custoUnitario: number }>();
  for (const i of ficha.itens) {
    catalogo.set(i.insumoId, { nome: i.nome, unidade: i.unidade, custoUnitario: i.custoUnitario });
  }
  for (const i of insumos) {
    catalogo.set(i.id, { nome: i.nome, unidade: i.unidade, custoUnitario: i.custoUnitario });
  }
  const opcoes = [...catalogo.entries()]
    .sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'))
    .map(([id, info]) => ({ valor: String(id), rotulo: info.nome }));

  const custoTotal = linhas.reduce(
    (soma, l) => soma + (lerNumeroBr(l.quantidade) ?? 0) * (catalogo.get(Number(l.insumoId))?.custoUnitario ?? 0),
    0
  );
  const margem = ficha.preco - custoTotal;
  const margemPercentual = ficha.preco > 0 && linhas.length > 0 ? (margem / ficha.preco) * 100 : null;

  function atualizar(chave: number, campos: Partial<Omit<LinhaFicha, 'chave'>>) {
    setLinhas((atuais) => atuais.map((l) => (l.chave === chave ? { ...l, ...campos } : l)));
  }

  function remover(chave: number) {
    setLinhas((atuais) => atuais.filter((l) => l.chave !== chave));
  }

  function adicionar() {
    setLinhas((atuais) => [...atuais, { chave: novaChave(), insumoId: '', quantidade: '' }]);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const itens: { insumoId: number; quantidade: number }[] = [];
    for (const l of linhas) {
      if (!l.insumoId) {
        setErro('Escolha o insumo em todas as linhas.');
        return;
      }
      const q = lerNumeroBr(l.quantidade);
      if (q === null || q <= 0) {
        setErro(`Informe a quantidade de ${catalogo.get(Number(l.insumoId))?.nome ?? 'cada insumo'}.`);
        return;
      }
      itens.push({ insumoId: Number(l.insumoId), quantidade: q });
    }
    const ids = itens.map((i) => i.insumoId);
    if (new Set(ids).size !== ids.length) {
      setErro('Um insumo aparece mais de uma vez na ficha.');
      return;
    }
    setEnviando(true);
    try {
      await api.put<FichaDTO>(`/fichas/${ficha.produtoId}`, { itens });
      aoSalvo(`Ficha de ${ficha.nome} salva.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Ficha técnica · ${ficha.nome}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {linhas.length === 0 && <p className="insumos-ajuda">Esta ficha está vazia. Salve para o prato ficar sem insumos.</p>}
        <ul className="insumos-linhas">
          {linhas.map((l) => {
            const info = catalogo.get(Number(l.insumoId));
            const q = lerNumeroBr(l.quantidade);
            const custoLinha = info && q !== null ? q * info.custoUnitario : null;
            return (
              <li key={l.chave} className="insumos-linha">
                <div className="insumos-linha-insumo">
                  <Selecao
                    rotulo="Insumo"
                    valor={l.insumoId}
                    aoMudar={(v) => atualizar(l.chave, { insumoId: v })}
                    opcoes={opcoes}
                    vazio="Escolha o insumo"
                  />
                </div>
                <div className="insumos-linha-quantidade">
                  <Campo
                    rotulo="Quantidade"
                    valor={l.quantidade}
                    aoMudar={(v) => atualizar(l.chave, { quantidade: v })}
                  />
                  {info && <span className="insumos-linha-unidade">{SIGLA_UNIDADE[info.unidade]}</span>}
                </div>
                <div className="insumos-linha-remover">
                  <Botao variante="texto" aoClicar={() => remover(l.chave)}>
                    Remover
                  </Botao>
                </div>
                <p className="insumos-linha-resumo">
                  Custo da linha: {custoLinha !== null ? formatarMoeda(custoLinha) : '—'}
                </p>
              </li>
            );
          })}
        </ul>

        <div className="insumos-acoes-modal">
          <Botao variante="secundario" aoClicar={adicionar}>
            Adicionar insumo
          </Botao>
        </div>

        <div className="insumos-total">
          <span>Custo do prato: {formatarMoeda(custoTotal)}</span>
          <span>Preço: {formatarMoeda(ficha.preco)}</span>
          <span>
            Margem: {formatarMoeda(margem)}
            {margemPercentual !== null && ` (${formatarPercentual(margemPercentual)})`}
          </span>
        </div>

        <div className="insumos-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Salvar ficha
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Planilha com o que está na tela (respeita os filtros). Vírgula decimal e ponto e vírgula, como o Excel em português.
function baixarPlanilha(lista: FichaDTO[]) {
  const celula = (valor: string) => `"${valor.replace(/"/g, '""')}"`;
  const numero = (valor: number | null) => (valor === null ? '' : valor.toFixed(2).replace('.', ','));
  const linhas = [
    ['Produto', 'Categoria', 'Preço', 'Custo', 'Margem', 'CMV %'],
    ...lista.map((f) => {
      const comFicha = f.itens.length > 0;
      return [
        f.nome,
        f.categoria,
        numero(f.preco),
        comFicha ? numero(f.custo) : '',
        comFicha ? numero(f.margem) : '',
        f.cmvPercentual === null ? '' : f.cmvPercentual.toFixed(1).replace('.', ','),
      ];
    }),
  ];
  // O BOM no início faz o Excel abrir os acentos certo.
  const texto = '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = endereco;
  link.download = `fichas-tecnicas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

function SeloCmv({ fichaVazia, cmv }: { fichaVazia: boolean; cmv: number | null }) {
  if (fichaVazia) return <Selo cor="cinza">Sem ficha</Selo>;
  if (cmv === null) return <Selo cor="cinza">Sem preço</Selo>;
  const cor = cmv <= 30 ? 'verde' : cmv <= 40 ? 'amarelo' : 'vermelho';
  return <Selo cor={cor}>{formatarPercentual(cmv)}</Selo>;
}

function AbaFichas() {
  const fichas = useDados<FichaDTO[]>('/fichas');
  const insumos = useDados<InsumoDTO[]>('/insumos');
  const [categoria, setCategoria] = useState('');
  const [busca, setBusca] = useState('');
  const [soSemFicha, setSoSemFicha] = useState(false);
  const [editando, setEditando] = useState<FichaDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista = fichas.dados ?? [];
  const categorias = [...new Set(lista.map((f) => f.categoria))];
  const termo = normalizarTexto(busca);
  const filtradas = lista.filter(
    (f) =>
      (categoria === '' || f.categoria === categoria) &&
      (!soSemFicha || f.itens.length === 0) &&
      (termo === '' || normalizarTexto(f.nome).includes(termo))
  );

  // Indicadores sobre todos os pratos ativos (não só os filtrados).
  const comFicha = lista.filter((f) => f.itens.length > 0);
  const cmvs = comFicha.map((f) => f.cmvPercentual).filter((v): v is number => v !== null);
  const cmvMedio = cmvs.length > 0 ? cmvs.reduce((a, b) => a + b, 0) / cmvs.length : null;
  const comMargem = comFicha.filter((f) => f.margemPercentual !== null);
  const menorMargem = comMargem.reduce<FichaDTO | null>(
    (menor, f) => (menor === null || (f.margemPercentual ?? 0) < (menor.margemPercentual ?? 0) ? f : menor),
    null
  );

  return (
    <>
      <p className="insumos-ajuda">
        A quantidade é o que vai em UMA unidade do prato. A cada pedido, o sistema baixa esses insumos do estoque.
      </p>

      {fichas.dados && (
        <div className="resumo">
          <Indicador
            rotulo="Pratos com ficha"
            valor={`${comFicha.length} de ${lista.length}`}
            cor="azul"
            icone="documento"
          />
          <Indicador
            rotulo="Custo médio (CMV)"
            valor={cmvMedio === null ? '—' : formatarPercentual(cmvMedio)}
            cor="laranja"
            icone="grafico"
          />
          <Indicador
            rotulo="Menor margem"
            valor={menorMargem ? menorMargem.nome : '—'}
            cor="roxo"
            icone="atividade"
          />
        </div>
      )}

      <div className="insumos-filtros">
        <Selecao
          rotulo="Categoria"
          valor={categoria}
          aoMudar={setCategoria}
          opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))}
          vazio="Todas as categorias"
        />
        <Campo rotulo="Buscar prato" valor={busca} aoMudar={setBusca} />
        <Caixa rotulo="Só sem ficha" marcado={soSemFicha} aoMudar={setSoSemFicha} />
        <Botao variante="secundario" desabilitado={filtradas.length === 0} aoClicar={() => baixarPlanilha(filtradas)}>
          Baixar planilha
        </Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {fichas.erro && <Aviso tipo="erro">{fichas.erro}</Aviso>}
      {insumos.erro && <Aviso tipo="erro">{insumos.erro}</Aviso>}
      {fichas.carregando && !fichas.dados && <Carregando />}

      {fichas.dados && (
        <Tabela
          dados={filtradas}
          chave={(f) => f.produtoId}
          vazio="Nenhum prato encontrado."
          colunas={[
            {
              titulo: 'Produto',
              celula: (f) => (
                <div className="produto-celula">
                  <span className="produto-miniatura">
                    {f.imagem ? <img src={f.imagem} alt="" /> : <Icone nome="cardapio" tamanho={22} />}
                  </span>
                  <span className="produto-texto">
                    <span className="produto-nome">{f.nome}</span>
                    <span className="produto-descricao">{f.categoria}</span>
                  </span>
                </div>
              ),
            },
            { titulo: 'Preço', alinhar: 'direita', celula: (f) => formatarMoeda(f.preco) },
            {
              titulo: 'Custo',
              alinhar: 'direita',
              celula: (f) => (f.itens.length > 0 ? formatarMoeda(f.custo) : '—'),
            },
            {
              titulo: 'Margem (R$)',
              alinhar: 'direita',
              celula: (f) => (f.itens.length > 0 ? formatarMoeda(f.margem) : '—'),
            },
            {
              titulo: 'CMV',
              celula: (f) => <SeloCmv fichaVazia={f.itens.length === 0} cmv={f.cmvPercentual} />,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (f) => (
                <MenuAcoes
                  rotulo={`Ações da ficha de ${f.nome}`}
                  acoes={[{ rotulo: 'Editar ficha', icone: 'lapis', aoClicar: () => setEditando(f) }]}
                />
              ),
            },
          ]}
        />
      )}

      {editando && insumos.dados && (
        <EditorFicha
          ficha={editando}
          insumos={insumos.dados}
          aoFechar={() => setEditando(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            fichas.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Tela ----------

export function Insumos() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const [aba, setAba] = useState<'insumos' | 'fichas'>('insumos');

  return (
    <Pagina titulo="Insumos e fichas técnicas">
      {gestor && (
        <Abas
          abas={[
            { id: 'insumos', rotulo: 'Insumos' },
            { id: 'fichas', rotulo: 'Fichas e custos' },
          ]}
          ativa={aba}
          aoMudar={(id) => setAba(id === 'fichas' ? 'fichas' : 'insumos')}
        />
      )}
      {gestor && aba === 'fichas' ? <AbaFichas /> : <AbaInsumos gestor={gestor} />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/insumos',
    rotulo: 'Insumos e fichas',
    icone: 'lista',
    perfis: ['GESTOR'],
    elemento: <Insumos />,
    grupo: 'Estoque e compras',
    ordem: 22,
  },
  {
    caminho: '/cozinha/insumos',
    rotulo: 'Insumos',
    icone: 'lista',
    perfis: ['COZINHA'],
    elemento: <Insumos />,
    grupo: 'Estoque e compras',
    ordem: 22,
  },
];
