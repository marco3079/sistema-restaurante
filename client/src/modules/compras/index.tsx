import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { imprimirHtml } from '../../lib/imprimir';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { FORMAS_PAGAMENTO, formatarDocumento, lerNumero, mensagemErro } from '../../lib/restaurante';
import type {
  CompraDTO,
  CompraItemDTO,
  FornecedorDTO,
  ItensDisponiveisDTO,
  LinhaCompra,
  StatusCompra,
  SugestaoDTO,
} from '../../lib/compras';
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
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Indicador } from '../pedidos/comum';
import './compras.css';

// ---------- Peças comuns ----------

const ROTULO_STATUS: Record<StatusCompra, { rotulo: string; cor: 'amarelo' | 'verde' | 'cinza' }> = {
  PEDIDA: { rotulo: 'Pedida', cor: 'amarelo' },
  RECEBIDA: { rotulo: 'Recebida', cor: 'verde' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'cinza' },
};

const ROTULO_TIPO: Record<CompraItemDTO['tipo'], string> = {
  PRODUTO: 'Produto',
  INSUMO: 'Insumo',
  OUTRO: 'Outro',
};

function SeloCompra({ status }: { status: StatusCompra }) {
  const info = ROTULO_STATUS[status];
  return <Selo cor={info.cor}>{info.rotulo}</Selo>;
}

// Número com vírgula decimal, como o gestor digita.
function numeroTexto(n: number): string {
  return String(n).replace('.', ',');
}

// Subtotal de uma linha do formulário, ou null enquanto a linha não estiver preenchida.
function subtotalDaLinha(l: LinhaCompra): number | null {
  const quantidade = lerNumero(l.quantidade);
  const custo = lerNumero(l.custo);
  if (typeof quantidade !== 'number' || typeof custo !== 'number' || quantidade <= 0) return null;
  return Math.round(quantidade * custo * 100) / 100;
}

// Resumo da lista: "3 itens: Farinha, Leite..."
function resumoItens(itens: CompraItemDTO[]): string {
  const n = itens.length;
  const nomes = itens.slice(0, 2).map((i) => i.descricao);
  return `${n} ${n === 1 ? 'item' : 'itens'}: ${nomes.join(', ')}${n > 2 ? '...' : ''}`;
}

function noMesAtual(iso: string | null): boolean {
  if (!iso) return false;
  const data = new Date(iso);
  const agora = new Date();
  return data.getFullYear() === agora.getFullYear() && data.getMonth() === agora.getMonth();
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Pedido de compra para mandar ao fornecedor (impressora comum ou térmica).
function imprimirPedido(compra: CompraDTO) {
  const itens = compra.itens
    .map(
      (i) =>
        `<p class="item">${escapar(numeroTexto(i.quantidade))} ${escapar(i.unidade)} ${escapar(i.descricao)}</p>` +
        `<div class="par"><span>${formatarMoeda(i.custoUnitario)} cada</span><span>${formatarMoeda(i.subtotal)}</span></div>`,
    )
    .join('');
  imprimirHtml(
    `Pedido de compra ${compra.id}`,
    `<h1>Pedido de compra #${compra.id}</h1>` +
      `<p class="centro">${escapar(compra.fornecedor.nome)}</p>` +
      `<p class="centro pequeno">Pedido em ${escapar(formatarDataHora(compra.pedidaEm))}` +
      `${compra.criadaPorNome ? ` · ${escapar(compra.criadaPorNome)}` : ''}</p>` +
      `<div class="linha"></div>${itens}<div class="linha"></div>` +
      `<div class="par destaque"><span>TOTAL</span><span>${formatarMoeda(compra.total)}</span></div>` +
      (compra.observacao ? `<p class="pequeno">Obs.: ${escapar(compra.observacao)}</p>` : ''),
  );
}

function TabelaItens({ itens }: { itens: CompraItemDTO[] }) {
  return (
    <Tabela
      dados={itens}
      chave={(i) => i.id}
      vazio="Sem itens."
      colunas={[
        {
          titulo: 'Item',
          celula: (i) => (
            <span className="compras-texto">
              <span className="compras-nome">{i.descricao}</span>
              <span className="compras-detalhe">{ROTULO_TIPO[i.tipo]}</span>
            </span>
          ),
        },
        { titulo: 'Quantidade', alinhar: 'direita', celula: (i) => `${numeroTexto(i.quantidade)} ${i.unidade}` },
        { titulo: 'Custo', alinhar: 'direita', celula: (i) => formatarMoeda(i.custoUnitario) },
        { titulo: 'Subtotal', alinhar: 'direita', celula: (i) => <strong>{formatarMoeda(i.subtotal)}</strong> },
      ]}
    />
  );
}

// ---------- Formulário de compra ----------

// Monta os itens para a API. Devolve a primeira falha em português.
function montarItens(linhas: LinhaCompra[]): { itens: Record<string, number | string>[] } | { erro: string } {
  const itens: Record<string, number | string>[] = [];
  for (let n = 0; n < linhas.length; n += 1) {
    const l = linhas[n];
    const pos = `Item ${n + 1}: `;
    const quantidade = lerNumero(l.quantidade);
    const custo = lerNumero(l.custo);
    if (l.tipo === '') return { erro: `${pos}escolha o tipo.` };
    if (l.tipo !== 'OUTRO' && l.itemId === '') {
      return { erro: `${pos}escolha o ${l.tipo === 'PRODUTO' ? 'produto' : 'insumo'}.` };
    }
    if (l.tipo === 'OUTRO' && l.descricao.trim() === '') return { erro: `${pos}informe a descrição.` };
    if (typeof quantidade !== 'number' || quantidade <= 0) return { erro: `${pos}informe a quantidade.` };
    if (l.tipo === 'PRODUTO' && !Number.isInteger(quantidade)) {
      return { erro: `${pos}produto leva quantidade inteira.` };
    }
    if (typeof custo !== 'number') return { erro: `${pos}informe o custo unitário.` };
    if (l.tipo === 'PRODUTO') itens.push({ produtoId: Number(l.itemId), quantidade, custoUnitario: custo });
    else if (l.tipo === 'INSUMO') itens.push({ insumoId: Number(l.itemId), quantidade, custoUnitario: custo });
    else itens.push({ descricao: l.descricao.trim(), quantidade, custoUnitario: custo });
  }
  if (itens.length === 0) return { erro: 'Inclua pelo menos um item.' };
  return { itens };
}

function FormularioCompra({
  compra,
  itensIniciais,
  aoFechar,
  aoSalvo,
}: {
  compra?: CompraDTO;
  itensIniciais?: Omit<LinhaCompra, 'chave'>[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const fornecedores = useDados<FornecedorDTO[]>('/fornecedores');
  const disponiveis = useDados<ItensDisponiveisDTO>('/compras/itens-disponiveis');

  const contador = useRef(0);
  const proximaChave = () => {
    contador.current += 1;
    return contador.current;
  };

  const [linhas, setLinhas] = useState<LinhaCompra[]>(() => {
    const base: Omit<LinhaCompra, 'chave'>[] = compra
      ? compra.itens.map((i) => ({
          tipo: i.tipo,
          itemId: i.tipo === 'PRODUTO' ? String(i.produtoId) : i.tipo === 'INSUMO' ? String(i.insumoId) : '',
          descricao: i.tipo === 'OUTRO' ? i.descricao : '',
          quantidade: numeroTexto(i.quantidade),
          custo: numeroTexto(i.custoUnitario),
        }))
      : (itensIniciais ?? []);
    return base.map((l) => ({ ...l, chave: proximaChave() }));
  });
  const [fornecedorId, setFornecedorId] = useState(compra ? String(compra.fornecedor.id) : '');
  const [observacao, setObservacao] = useState(compra?.observacao ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const produtos = disponiveis.dados?.produtos ?? [];
  const insumos = disponiveis.dados?.insumos ?? [];
  const opcoesFornecedor = (fornecedores.dados ?? []).map((f) => ({ valor: String(f.id), rotulo: f.nome }));
  if (compra && !opcoesFornecedor.some((o) => o.valor === String(compra.fornecedor.id))) {
    opcoesFornecedor.unshift({ valor: String(compra.fornecedor.id), rotulo: compra.fornecedor.nome });
  }
  const opcoesProdutos = produtos.map((p) => ({ valor: String(p.id), rotulo: p.nome }));
  const opcoesInsumos = insumos.map((i) => ({ valor: String(i.id), rotulo: `${i.nome} (${i.unidade})` }));
  const total = linhas.reduce((soma, l) => soma + (subtotalDaLinha(l) ?? 0), 0);
  const carregado = fornecedores.dados !== null && disponiveis.dados !== null;
  const falhaAoCarregar = fornecedores.erro ?? disponiveis.erro;

  function mudar(chave: number, mudanca: Partial<LinhaCompra>) {
    setLinhas((atuais) => atuais.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)));
  }

  function remover(chave: number) {
    setLinhas((atuais) => atuais.filter((l) => l.chave !== chave));
  }

  function adicionar() {
    const chave = proximaChave();
    setLinhas((atuais) => [...atuais, { chave, tipo: '', itemId: '', descricao: '', quantidade: '', custo: '' }]);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!fornecedorId) {
      setErro('Escolha o fornecedor.');
      return;
    }
    const montado = montarItens(linhas);
    if ('erro' in montado) {
      setErro(montado.erro);
      return;
    }
    setEnviando(true);
    const corpo = {
      fornecedorId: Number(fornecedorId),
      observacao: observacao.trim() || null,
      itens: montado.itens,
    };
    try {
      const salva = compra
        ? await api.put<CompraDTO>(`/compras/${compra.id}`, corpo)
        : await api.post<CompraDTO>('/compras', corpo);
      aoSalvo(compra ? `Compra #${salva.id} atualizada.` : `Compra #${salva.id} criada como pedida.`);
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={compra ? `Editar compra #${compra.id}` : 'Nova compra'} aoFechar={aoFechar}>
      {falhaAoCarregar && <Aviso tipo="erro">{falhaAoCarregar}</Aviso>}
      {!carregado && !falhaAoCarregar && <Carregando />}
      {carregado && (
        <form onSubmit={salvar} className="compras-formulario">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Selecao
            rotulo="Fornecedor"
            valor={fornecedorId}
            aoMudar={setFornecedorId}
            opcoes={opcoesFornecedor}
            obrigatorio
          />

          <div className="compras-linhas">
            {linhas.map((l) => {
              const subtotal = subtotalDaLinha(l);
              const opcoesDoItem = l.tipo === 'INSUMO' ? opcoesInsumos : l.tipo === 'PRODUTO' ? opcoesProdutos : [];
              return (
                <div className="compras-linha" key={l.chave}>
                  <Selecao
                    rotulo="Tipo"
                    valor={l.tipo}
                    aoMudar={(valor) =>
                      mudar(l.chave, { tipo: valor as LinhaCompra['tipo'], itemId: '', descricao: '' })
                    }
                    opcoes={[
                      { valor: 'PRODUTO', rotulo: 'Produto do cardápio' },
                      { valor: 'INSUMO', rotulo: 'Insumo' },
                      { valor: 'OUTRO', rotulo: 'Outro (descrição livre)' },
                    ]}
                  />
                  {l.tipo === 'OUTRO' ? (
                    <Campo rotulo="Descrição" valor={l.descricao} aoMudar={(valor) => mudar(l.chave, { descricao: valor })} />
                  ) : (
                    <Selecao
                      rotulo={l.tipo === 'INSUMO' ? 'Insumo' : 'Produto'}
                      valor={l.itemId}
                      aoMudar={(valor) => mudar(l.chave, { itemId: valor })}
                      opcoes={opcoesDoItem}
                    />
                  )}
                  <Campo
                    rotulo="Quantidade"
                    valor={l.quantidade}
                    aoMudar={(valor) => mudar(l.chave, { quantidade: valor })}
                  />
                  <Campo
                    rotulo="Custo unitário (R$)"
                    valor={l.custo}
                    aoMudar={(valor) => mudar(l.chave, { custo: valor })}
                  />
                  <span className="compras-subtotal">
                    Subtotal: <strong>{subtotal === null ? '—' : formatarMoeda(subtotal)}</strong>
                  </span>
                  <Botao variante="texto" aoClicar={() => remover(l.chave)}>
                    Remover
                  </Botao>
                </div>
              );
            })}
          </div>

          <div className="compras-acoes-linha">
            <Botao variante="secundario" aoClicar={adicionar}>
              Adicionar item
            </Botao>
          </div>

          <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={2} />
          <p className="compras-total">
            Total: <strong>{formatarMoeda(total)}</strong>
          </p>
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar compra'}
          </Botao>{' '}
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </form>
      )}
    </Modal>
  );
}

// ---------- Receber e detalhes ----------

function ReceberCompra({
  compra,
  aoFechar,
  aoSalvo,
}: {
  compra: CompraDTO;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [pago, setPago] = useState(true);
  const [vencimento, setVencimento] = useState('');
  const [forma, setForma] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!window.confirm('Confirmar o recebimento? O estoque sobe e a despesa entra em Ganhos e gastos.')) return;
    setEnviando(true);
    try {
      await api.post(`/compras/${compra.id}/receber`, {
        pago,
        vencimento: !pago && vencimento ? vencimento : null,
        formaPagamento: forma || null,
      });
      aoSalvo(`Compra #${compra.id} recebida. Estoque e despesa atualizados.`);
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Receber mercadoria · compra #${compra.id}`} aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="compras-formulario">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p>
          <strong>{compra.fornecedor.nome}</strong>
        </p>
        <TabelaItens itens={compra.itens} />
        <p className="compras-total">
          Total: <strong>{formatarMoeda(compra.total)}</strong>
        </p>
        <p className="compras-ajuda">
          Ao receber, o estoque dos produtos e insumos aumenta e a despesa entra em Ganhos e gastos.
        </p>
        <Caixa rotulo="Já foi paga" marcado={pago} aoMudar={setPago} />
        {!pago && <Campo rotulo="Vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} />}
        <Selecao
          rotulo="Forma de pagamento (opcional)"
          valor={forma}
          aoMudar={setForma}
          vazio="Não informada"
          opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: f }))}
        />
        <Botao tipo="submit" desabilitado={enviando}>
          Confirmar recebimento
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

function DetalheCompra({ compra, aoFechar }: { compra: CompraDTO; aoFechar: () => void }) {
  return (
    <Modal aberto titulo={`Compra #${compra.id}`} aoFechar={aoFechar}>
      <p>
        <strong>{compra.fornecedor.nome}</strong> · <SeloCompra status={compra.status} />
      </p>
      <p className="compras-detalhe">
        Pedida em {formatarDataHora(compra.pedidaEm)}
        {compra.recebidaEm ? ` · recebida em ${formatarDataHora(compra.recebidaEm)}` : ''}
        {compra.criadaPorNome ? ` · por ${compra.criadaPorNome}` : ''}
      </p>
      {compra.observacao && <p>Obs.: {compra.observacao}</p>}
      <TabelaItens itens={compra.itens} />
      <p className="compras-total">
        Total: <strong>{formatarMoeda(compra.total)}</strong>
      </p>
      {compra.lancamentoId !== null && <p className="compras-detalhe">Despesa lançada em Ganhos e gastos.</p>}
    </Modal>
  );
}

// ---------- Aba Compras ----------

const FILTROS: { valor: 'TODAS' | StatusCompra; rotulo: string }[] = [
  { valor: 'TODAS', rotulo: 'Todas' },
  { valor: 'PEDIDA', rotulo: 'Pedidas' },
  { valor: 'RECEBIDA', rotulo: 'Recebidas' },
  { valor: 'CANCELADA', rotulo: 'Canceladas' },
];

function ListaCompras() {
  const compras = useDados<CompraDTO[]>('/compras');
  const [filtro, setFiltro] = useState<'TODAS' | StatusCompra>('TODAS');
  const [formulario, setFormulario] = useState<{
    compra?: CompraDTO;
    itens?: Omit<LinhaCompra, 'chave'>[];
  } | null>(null);
  const [recebendo, setRecebendo] = useState<CompraDTO | null>(null);
  const [detalhe, setDetalhe] = useState<CompraDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const lista = compras.dados ?? [];
  const visiveis = filtro === 'TODAS' ? lista : lista.filter((c) => c.status === filtro);
  const pedidas = lista.filter((c) => c.status === 'PEDIDA').length;
  const recebidasNoMes = lista.filter((c) => c.status === 'RECEBIDA' && noMesAtual(c.recebidaEm));
  const totalNoMes = recebidasNoMes.reduce((soma, c) => soma + c.total, 0);

  async function cancelar(compra: CompraDTO) {
    if (!window.confirm(`Cancelar a compra #${compra.id} de ${compra.fornecedor.nome}? Ela deixa de valer.`)) return;
    setErro(null);
    setAviso(null);
    try {
      await api.post(`/compras/${compra.id}/cancelar`);
      setAviso(`Compra #${compra.id} cancelada.`);
      compras.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoesDe(c: CompraDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [{ rotulo: 'Ver', icone: 'lista', aoClicar: () => setDetalhe(c) }];
    if (c.status === 'PEDIDA') {
      acoes.push({ rotulo: 'Editar', icone: 'lapis', aoClicar: () => setFormulario({ compra: c }) });
      acoes.push({ rotulo: 'Receber mercadoria', icone: 'visto', aoClicar: () => setRecebendo(c) });
      acoes.push({ rotulo: 'Cancelar', icone: 'fechar', perigo: true, aoClicar: () => void cancelar(c) });
    }
    acoes.push({ rotulo: 'Imprimir pedido', icone: 'documento', aoClicar: () => imprimirPedido(c) });
    return acoes;
  }

  return (
    <>
      {compras.dados && (
        <div className="resumo">
          <Indicador rotulo="Pedidas (aguardando)" valor={String(pedidas)} cor="laranja" icone="relogio" />
          <Indicador rotulo="Recebidas no mês" valor={String(recebidasNoMes.length)} cor="verde" icone="visto" />
          <Indicador rotulo="Comprado no mês (R$)" valor={formatarMoeda(totalNoMes)} cor="azul" icone="financeiro" />
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="segmentado" role="group" aria-label="Situação">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              className="segmentado-item"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        <Botao aoClicar={() => setFormulario({})}>Nova compra</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {compras.erro && <Aviso tipo="erro">{compras.erro}</Aviso>}
      {compras.carregando && !compras.dados && <Carregando />}

      {compras.dados && (
        <Tabela
          dados={visiveis}
          chave={(c) => c.id}
          vazio="Nenhuma compra nesta situação."
          colunas={[
            { titulo: 'Nº', celula: (c) => <strong>#{c.id}</strong> },
            { titulo: 'Fornecedor', celula: (c) => c.fornecedor.nome },
            { titulo: 'Itens', celula: (c) => resumoItens(c.itens) },
            { titulo: 'Total', alinhar: 'direita', celula: (c) => <strong className="sem-quebra">{formatarMoeda(c.total)}</strong> },
            { titulo: 'Pedida em', celula: (c) => <span className="sem-quebra">{formatarDataHora(c.pedidaEm)}</span> },
            { titulo: 'Situação', celula: (c) => <SeloCompra status={c.status} /> },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => <MenuAcoes rotulo={`Ações da compra ${c.id}`} acoes={acoesDe(c)} />,
            },
          ]}
        />
      )}

      {formulario && (
        <FormularioCompra
          compra={formulario.compra}
          itensIniciais={formulario.itens}
          aoFechar={() => setFormulario(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            setFormulario(null);
            compras.recarregar();
          }}
        />
      )}
      {recebendo && (
        <ReceberCompra
          compra={recebendo}
          aoFechar={() => setRecebendo(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            setRecebendo(null);
            compras.recarregar();
          }}
        />
      )}
      {detalhe && <DetalheCompra compra={detalhe} aoFechar={() => setDetalhe(null)} />}
    </>
  );
}

// ---------- Aba O que comprar ----------

function OQueComprar() {
  const sugestao = useDados<SugestaoDTO[]>('/compras/sugestao');
  const [marcados, setMarcados] = useState<string[]>([]);
  const [formulario, setFormulario] = useState<Omit<LinhaCompra, 'chave'>[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista = sugestao.dados ?? [];
  const chaveDe = (s: SugestaoDTO) => `${s.tipo}-${s.id}`;
  const escolhidos = lista.filter((s) => marcados.includes(chaveDe(s)));

  function alternar(chave: string, marcado: boolean) {
    setMarcados((atuais) => (marcado ? [...atuais, chave] : atuais.filter((c) => c !== chave)));
  }

  return (
    <>
      <p className="compras-ajuda">Itens no estoque mínimo ou abaixo dele.</p>

      <div className="barra-ferramentas">
        <Botao
          desabilitado={escolhidos.length === 0}
          aoClicar={() =>
            setFormulario(
              escolhidos.map((s) => ({
                tipo: s.tipo,
                itemId: String(s.id),
                descricao: '',
                quantidade: numeroTexto(s.sugerido),
                custo: numeroTexto(s.ultimoCusto ?? 0),
              })),
            )
          }
        >
          Montar compra com os marcados
        </Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {sugestao.erro && <Aviso tipo="erro">{sugestao.erro}</Aviso>}
      {sugestao.carregando && !sugestao.dados && <Carregando />}

      {sugestao.dados && (
        <Tabela
          dados={lista}
          chave={chaveDe}
          vazio="Nada abaixo do mínimo."
          colunas={[
            {
              titulo: 'Comprar',
              celula: (s) => (
                <input
                  type="checkbox"
                  className="compras-marcar"
                  aria-label={`Comprar ${s.nome}`}
                  checked={marcados.includes(chaveDe(s))}
                  onChange={(e) => alternar(chaveDe(s), e.target.checked)}
                />
              ),
            },
            { titulo: 'Item', celula: (s) => <span className="compras-nome">{s.nome}</span> },
            { titulo: 'Tipo', celula: (s) => (s.tipo === 'PRODUTO' ? 'Produto' : 'Insumo') },
            {
              titulo: 'Saldo',
              alinhar: 'direita',
              celula: (s) => `${numeroTexto(s.estoque)} ${s.unidade}`,
            },
            { titulo: 'Mínimo', alinhar: 'direita', celula: (s) => `${numeroTexto(s.minimo)} ${s.unidade}` },
            { titulo: 'Sugerido', alinhar: 'direita', celula: (s) => <strong>{numeroTexto(s.sugerido)}</strong> },
            {
              titulo: 'Último custo',
              alinhar: 'direita',
              celula: (s) => (s.ultimoCusto === null ? '—' : formatarMoeda(s.ultimoCusto)),
            },
          ]}
        />
      )}

      {formulario && (
        <FormularioCompra
          itensIniciais={formulario}
          aoFechar={() => setFormulario(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            setFormulario(null);
            setMarcados([]);
            sugestao.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Aba Fornecedores ----------

function corpoDoFornecedor(f: FornecedorDTO) {
  return {
    nome: f.nome,
    cnpjCpf: f.cnpjCpf,
    telefone: f.telefone,
    email: f.email,
    contato: f.contato,
    observacao: f.observacao,
  };
}

function FormularioFornecedor({
  fornecedor,
  aoFechar,
  aoSalvo,
}: {
  fornecedor?: FornecedorDTO;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(fornecedor?.nome ?? '');
  const [cnpjCpf, setCnpjCpf] = useState(fornecedor?.cnpjCpf ?? '');
  const [telefone, setTelefone] = useState(fornecedor?.telefone ?? '');
  const [email, setEmail] = useState(fornecedor?.email ?? '');
  const [contato, setContato] = useState(fornecedor?.contato ?? '');
  const [observacao, setObservacao] = useState(fornecedor?.observacao ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!nome.trim()) {
      setErro('Informe o nome do fornecedor.');
      return;
    }
    setEnviando(true);
    const corpo = {
      nome: nome.trim(),
      cnpjCpf,
      telefone,
      email,
      contato,
      observacao,
      ...(fornecedor ? { ativo: fornecedor.ativo } : {}),
    };
    try {
      if (fornecedor) await api.put(`/fornecedores/${fornecedor.id}`, corpo);
      else await api.post('/fornecedores', corpo);
      aoSalvo(fornecedor ? `${nome.trim()} atualizado.` : `${nome.trim()} cadastrado.`);
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={fornecedor ? 'Editar fornecedor' : 'Novo fornecedor'} aoFechar={aoFechar}>
      <form onSubmit={salvar} className="compras-formulario">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="CNPJ ou CPF" valor={cnpjCpf} aoMudar={setCnpjCpf} />
        <Campo rotulo="Telefone" valor={telefone} aoMudar={setTelefone} />
        <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} />
        <Campo rotulo="Pessoa de contato" valor={contato} aoMudar={setContato} />
        <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={2} />
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

function TelaFornecedores() {
  // Inclui os inativos, para o gestor poder reativar.
  const fornecedores = useDados<FornecedorDTO[]>('/fornecedores?todos=1');
  const [edicao, setEdicao] = useState<FornecedorDTO | 'novo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const lista = fornecedores.dados ?? [];

  async function alternarSituacao(f: FornecedorDTO) {
    setErro(null);
    setAviso(null);
    try {
      await api.put(`/fornecedores/${f.id}`, { ...corpoDoFornecedor(f), ativo: !f.ativo });
      setAviso(`${f.nome} ${f.ativo ? 'desativado' : 'reativado'}.`);
      fornecedores.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function excluir(f: FornecedorDTO) {
    if (!window.confirm(`Excluir o fornecedor ${f.nome}? Se ele tiver compras ou despesas, só será desativado.`)) return;
    setErro(null);
    setAviso(null);
    try {
      await api.del(`/fornecedores/${f.id}`);
      setAviso(`${f.nome}: exclusão feita. Com compras ou despesas, ele fica desativado.`);
      fornecedores.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoesDe(f: FornecedorDTO): AcaoMenu[] {
    return [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEdicao(f) },
      f.ativo
        ? { rotulo: 'Desativar', icone: 'fechar', aoClicar: () => void alternarSituacao(f) }
        : { rotulo: 'Reativar', icone: 'visto', aoClicar: () => void alternarSituacao(f) },
      { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => void excluir(f) },
    ];
  }

  return (
    <>
      <div className="barra-ferramentas">
        <Botao aoClicar={() => setEdicao('novo')}>Novo fornecedor</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {fornecedores.erro && <Aviso tipo="erro">{fornecedores.erro}</Aviso>}
      {fornecedores.carregando && !fornecedores.dados && <Carregando />}

      {fornecedores.dados && (
        <Tabela
          dados={lista}
          chave={(f) => f.id}
          vazio="Nenhum fornecedor cadastrado."
          colunas={[
            { titulo: 'Nome', celula: (f) => <span className="compras-nome">{f.nome}</span> },
            {
              titulo: 'Contato',
              celula: (f) => (
                <span className="compras-texto">
                  <span className="compras-nome">{f.contato || '—'}</span>
                  <span className="compras-detalhe">{[f.telefone, f.email].filter(Boolean).join(' · ')}</span>
                </span>
              ),
            },
            { titulo: 'CNPJ/CPF', celula: (f) => formatarDocumento(f.cnpjCpf) || '—' },
            { titulo: 'Compras', alinhar: 'direita', celula: (f) => String(f.compras) },
            {
              titulo: 'Total comprado',
              alinhar: 'direita',
              celula: (f) => <strong className="sem-quebra">{formatarMoeda(f.totalComprado)}</strong>,
            },
            {
              titulo: 'Situação',
              celula: (f) => (f.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo cor="cinza">Inativo</Selo>),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (f) => <MenuAcoes rotulo={`Ações do fornecedor ${f.nome}`} acoes={acoesDe(f)} />,
            },
          ]}
        />
      )}

      {edicao && (
        <FormularioFornecedor
          fornecedor={edicao === 'novo' ? undefined : edicao}
          aoFechar={() => setEdicao(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            setEdicao(null);
            fornecedores.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Tela ----------

export function Compras() {
  const [aba, setAba] = useState('compras');

  return (
    <Pagina titulo="Compras">
      <Abas
        abas={[
          { id: 'compras', rotulo: 'Compras' },
          { id: 'oque', rotulo: 'O que comprar' },
          { id: 'fornecedores', rotulo: 'Fornecedores' },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />
      {aba === 'compras' && <ListaCompras />}
      {aba === 'oque' && <OQueComprar />}
      {aba === 'fornecedores' && <TelaFornecedores />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/compras',
    rotulo: 'Compras',
    icone: 'lista',
    perfis: ['GESTOR'],
    elemento: <Compras />,
    ordem: 23,
    grupo: 'Estoque e compras',
  },
];
