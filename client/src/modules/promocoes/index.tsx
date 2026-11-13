import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { lerPreco, mensagemErro, precoParaCampo } from '../../lib/restaurante';
import type { CategoriaDTO, ProdutoDTO } from '../../lib/restaurante';
import { DIAS_SEMANA } from '../../lib/promocoes';
import type { CupomCorpo, CupomDTO, PromocaoCorpo, PromocaoDTO } from '../../lib/promocoes';
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
  formatarData,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import './promocoes.css';

// ---------- Textos e conversões ----------

const DIAS_UTEIS = [1, 2, 3, 4, 5];

// 17.5 vira "17,5": número com vírgula, como se digita.
function numeroPt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function textoDias(dias: number[]): string {
  if (dias.length === 0) return 'Todos os dias';
  const ordem = [...dias].sort((a, b) => a - b);
  if (ordem.length === DIAS_UTEIS.length && ordem.every((d, i) => d === DIAS_UTEIS[i])) return 'Seg a Sex';
  return ordem.map((d) => DIAS_SEMANA[d]).join(', ');
}

function textoQuando(p: PromocaoDTO): string {
  const partes = [textoDias(p.diasSemana), `${p.horaInicio} às ${p.horaFim}`];
  if (p.dataInicio && p.dataFim) {
    partes.push(`de ${formatarData(p.dataInicio)} até ${formatarData(p.dataFim)}`);
  } else if (p.dataInicio) {
    partes.push(`a partir de ${formatarData(p.dataInicio)}`);
  } else if (p.dataFim) {
    partes.push(`até ${formatarData(p.dataFim)}`);
  }
  return partes.join(' · ');
}

function textoAlvo(p: PromocaoDTO): string {
  if (p.produto) return `Produto: ${p.produto.nome}`;
  if (p.categoria) return `Categoria: ${p.categoria.nome}`;
  return 'Todo o cardápio';
}

function textoDesconto(p: PromocaoDTO): string {
  if (p.percentual !== null) return `${numeroPt(p.percentual)}%`;
  return `Por ${formatarMoeda(p.precoFixo ?? 0)}`;
}

// Valor que vai para o campo do formulário ao editar.
function valorInicialPromocao(p: PromocaoDTO): string {
  if (p.precoFixo !== null) return precoParaCampo(p.precoFixo);
  if (p.percentual !== null) return numeroPt(p.percentual);
  return '';
}

// Corpo para salvar a promoção sem mudar nada, só a situação (ativar ou desativar).
function corpoDaPromocao(p: PromocaoDTO, ativa: boolean): PromocaoCorpo {
  return {
    nome: p.nome,
    produtoId: p.produto ? p.produto.id : null,
    categoriaId: p.categoria ? p.categoria.id : null,
    percentual: p.percentual,
    precoFixo: p.precoFixo,
    diasSemana: p.diasSemana,
    horaInicio: p.horaInicio,
    horaFim: p.horaFim,
    dataInicio: p.dataInicio,
    dataFim: p.dataFim,
    ativa,
  };
}

function corpoDoCupom(c: CupomDTO, ativo: boolean): CupomCorpo {
  return {
    codigo: c.codigo,
    descricao: c.descricao,
    percentual: c.percentual,
    valor: c.valor,
    minimo: c.minimo,
    validade: c.validade,
    limiteUsos: c.limiteUsos,
    ativo,
  };
}

function SeloPromocao({ promocao }: { promocao: PromocaoDTO }) {
  if (!promocao.ativa) return <Selo cor="cinza">Desativada</Selo>;
  if (promocao.valendoAgora) return <Selo cor="verde">Valendo agora</Selo>;
  return <Selo cor="cinza">Fora do horário</Selo>;
}

function SeloCupom({ situacao }: { situacao: CupomDTO['situacao'] }) {
  if (situacao === 'VALENDO') return <Selo cor="verde">Valendo</Selo>;
  if (situacao === 'VENCIDO') return <Selo cor="vermelho">Vencido</Selo>;
  if (situacao === 'ESGOTADO') return <Selo cor="amarelo">Esgotado</Selo>;
  return <Selo cor="cinza">Desativado</Selo>;
}

// ---------- Promoções ----------

type Alvo = 'TODO' | 'CATEGORIA' | 'PRODUTO';
type TipoDesconto = 'PERCENTUAL' | 'FIXO';

// Formulário de criar ou editar uma promoção.
function FormPromocao({
  promocao,
  aoFechar,
  aoSalvo,
}: {
  promocao: PromocaoDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const produtos = useDados<ProdutoDTO[]>('/produtos');

  const [nome, setNome] = useState(promocao?.nome ?? '');
  const [alvo, setAlvo] = useState<Alvo>(promocao?.produto ? 'PRODUTO' : promocao?.categoria ? 'CATEGORIA' : 'TODO');
  const [categoriaId, setCategoriaId] = useState(promocao?.categoria ? String(promocao.categoria.id) : '');
  const [produtoId, setProdutoId] = useState(promocao?.produto ? String(promocao.produto.id) : '');
  const [tipo, setTipo] = useState<TipoDesconto>(promocao && promocao.precoFixo !== null ? 'FIXO' : 'PERCENTUAL');
  const [valor, setValor] = useState(promocao ? valorInicialPromocao(promocao) : '');
  const [dias, setDias] = useState<number[]>(promocao?.diasSemana ?? []);
  const [horaInicio, setHoraInicio] = useState(promocao?.horaInicio ?? '00:00');
  const [horaFim, setHoraFim] = useState(promocao?.horaFim ?? '23:59');
  const [dataInicio, setDataInicio] = useState(promocao?.dataInicio ?? '');
  const [dataFim, setDataFim] = useState(promocao?.dataFim ?? '');
  const [ativa, setAtiva] = useState(promocao?.ativa ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Preço fixo só existe para um produto: trocar o alvo volta o tipo para percentual se preciso.
  function mudarAlvo(novo: string) {
    const proximo = novo as Alvo;
    setAlvo(proximo);
    if (proximo !== 'PRODUTO') setTipo('PERCENTUAL');
  }

  function alternarDia(dia: number) {
    setDias((atual) =>
      atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia].sort((a, b) => a - b),
    );
  }

  function happyHour() {
    setDias([1, 2, 3, 4, 5]);
    setHoraInicio('17:00');
    setHoraFim('19:00');
  }

  function fimDeSemana() {
    setDias([0, 6]);
    setHoraInicio('00:00');
    setHoraFim('23:59');
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const nomeLimpo = nome.trim();
    const numero = lerPreco(valor);

    if (!nomeLimpo) {
      setErro('Informe o nome da promoção.');
      return;
    }
    if (alvo === 'CATEGORIA' && !categoriaId) {
      setErro('Escolha a categoria.');
      return;
    }
    if (alvo === 'PRODUTO' && !produtoId) {
      setErro('Escolha o produto.');
      return;
    }
    if (numero === null || (tipo === 'PERCENTUAL' && (numero <= 0 || numero > 100))) {
      setErro(tipo === 'PERCENTUAL' ? 'Informe o percentual de desconto, de 0,01 a 100.' : 'Informe o preço final em reais.');
      return;
    }
    if (!horaInicio || !horaFim) {
      setErro('Informe a hora de início e a hora de fim.');
      return;
    }
    if (dataInicio && dataFim && dataFim < dataInicio) {
      setErro('A data final não pode ser antes da inicial.');
      return;
    }

    const corpo: PromocaoCorpo = {
      nome: nomeLimpo,
      produtoId: alvo === 'PRODUTO' ? Number(produtoId) : null,
      categoriaId: alvo === 'CATEGORIA' ? Number(categoriaId) : null,
      percentual: tipo === 'PERCENTUAL' ? numero : null,
      precoFixo: tipo === 'FIXO' ? numero : null,
      diasSemana: [...dias].sort((a, b) => a - b),
      horaInicio,
      horaFim,
      dataInicio: dataInicio || null,
      dataFim: dataFim || null,
      ativa,
    };

    setEnviando(true);
    try {
      if (promocao) {
        await api.put<PromocaoDTO>(`/promocoes/${promocao.id}`, corpo);
        aoSalvo(`Promoção "${nomeLimpo}" salva.`);
      } else {
        await api.post<PromocaoDTO>('/promocoes', corpo);
        aoSalvo(`Promoção "${nomeLimpo}" criada.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  const opcoesTipo = [{ valor: 'PERCENTUAL', rotulo: 'Percentual (% de desconto)' }];
  if (alvo === 'PRODUTO') opcoesTipo.push({ valor: 'FIXO', rotulo: 'Preço fixo (preço final do produto)' });

  return (
    <Modal aberto titulo={promocao ? 'Editar promoção' : 'Nova promoção'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="promocoes-grade">
          <div className="campo-completo">
            <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
          </div>
          <Selecao
            rotulo="Vale para"
            valor={alvo}
            aoMudar={mudarAlvo}
            opcoes={[
              { valor: 'TODO', rotulo: 'Todo o cardápio' },
              { valor: 'CATEGORIA', rotulo: 'Uma categoria' },
              { valor: 'PRODUTO', rotulo: 'Um produto' },
            ]}
          />
          {alvo === 'CATEGORIA' && (
            <Selecao
              rotulo="Categoria"
              valor={categoriaId}
              aoMudar={setCategoriaId}
              opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
              vazio="Escolha a categoria"
              obrigatorio
            />
          )}
          {alvo === 'PRODUTO' && (
            <Selecao
              rotulo="Produto"
              valor={produtoId}
              aoMudar={setProdutoId}
              opcoes={(produtos.dados ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
              vazio="Escolha o produto"
              obrigatorio
            />
          )}
          <Selecao
            rotulo="Tipo de desconto"
            valor={tipo}
            aoMudar={(v) => setTipo(v as TipoDesconto)}
            opcoes={opcoesTipo}
          />
          <Campo
            rotulo={tipo === 'PERCENTUAL' ? 'Desconto (%)' : 'Preço final (R$)'}
            valor={valor}
            aoMudar={setValor}
            obrigatorio
          />
        </div>

        <p className="promocoes-texto">Dias da semana (nenhum marcado = todos os dias):</p>
        <div className="promocoes-dias" role="group" aria-label="Dias da semana">
          {DIAS_SEMANA.map((rotulo, dia) => (
            <button
              key={dia}
              type="button"
              className="promocoes-dia"
              aria-pressed={dias.includes(dia)}
              onClick={() => alternarDia(dia)}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="promocoes-atalhos">
          <Botao variante="secundario" aoClicar={happyHour}>
            Happy hour (seg a sex, 17h às 19h)
          </Botao>
          <Botao variante="secundario" aoClicar={fimDeSemana}>
            Fim de semana
          </Botao>
        </div>

        <div className="promocoes-grade">
          <Campo rotulo="Hora de início" tipo="time" valor={horaInicio} aoMudar={setHoraInicio} obrigatorio />
          <Campo rotulo="Hora de fim" tipo="time" valor={horaFim} aoMudar={setHoraFim} obrigatorio />
          <Campo rotulo="Data de início (opcional)" tipo="date" valor={dataInicio} aoMudar={setDataInicio} />
          <Campo rotulo="Data de fim (opcional)" tipo="date" valor={dataFim} aoMudar={setDataFim} />
        </div>

        <Caixa rotulo="Ativa" marcado={ativa} aoMudar={setAtiva} />

        <div className="promocoes-acoes">
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

function AbaPromocoes() {
  const promocoes = useDados<PromocaoDTO[]>('/promocoes');
  const [formulario, setFormulario] = useState<{ promocao: PromocaoDTO | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const lista = promocoes.dados ?? [];

  async function alternarAtiva(p: PromocaoDTO) {
    setErro(null);
    setAviso(null);
    try {
      await api.put<PromocaoDTO>(`/promocoes/${p.id}`, corpoDaPromocao(p, !p.ativa));
      setAviso(`Promoção "${p.nome}" ${p.ativa ? 'desativada' : 'ativada'}.`);
      promocoes.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function excluir(p: PromocaoDTO) {
    if (!window.confirm(`Excluir a promoção "${p.nome}"? Esta ação não tem volta.`)) return;
    setErro(null);
    setAviso(null);
    try {
      await api.del(`/promocoes/${p.id}`);
      setAviso(`Promoção "${p.nome}" excluída.`);
      promocoes.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoesDe(p: PromocaoDTO): AcaoMenu[] {
    return [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setFormulario({ promocao: p }) },
      {
        rotulo: p.ativa ? 'Desativar' : 'Ativar',
        icone: p.ativa ? 'pausar' : 'visto',
        aoClicar: () => void alternarAtiva(p),
      },
      { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => void excluir(p) },
    ];
  }

  return (
    <>
      <Aviso tipo="info">O preço promocional entra sozinho no cardápio e nos pedidos, nos dias e horários marcados.</Aviso>

      <div className="promocoes-acoes">
        <Botao aoClicar={() => setFormulario({ promocao: null })}>Nova promoção</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {promocoes.erro && <Aviso tipo="erro">{promocoes.erro}</Aviso>}
      {promocoes.carregando && !promocoes.dados && <Carregando />}

      {promocoes.dados && (
        <Tabela
          dados={lista}
          chave={(p) => p.id}
          vazio="Nenhuma promoção cadastrada."
          colunas={[
            { titulo: 'Nome', celula: (p) => <strong>{p.nome}</strong> },
            { titulo: 'Vale para', celula: (p) => textoAlvo(p) },
            { titulo: 'Desconto', celula: (p) => textoDesconto(p) },
            { titulo: 'Quando', celula: (p) => textoQuando(p) },
            { titulo: 'Situação', celula: (p) => <SeloPromocao promocao={p} /> },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (p) => <MenuAcoes rotulo={`Ações da promoção ${p.nome}`} acoes={acoesDe(p)} />,
            },
          ]}
        />
      )}

      {formulario && (
        <FormPromocao
          promocao={formulario.promocao}
          aoFechar={() => setFormulario(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            promocoes.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Cupons ----------

// Formulário de criar ou editar um cupom.
function FormCupom({
  cupom,
  aoFechar,
  aoSalvo,
}: {
  cupom: CupomDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [codigo, setCodigo] = useState(cupom?.codigo ?? '');
  const [descricao, setDescricao] = useState(cupom?.descricao ?? '');
  const [tipo, setTipo] = useState<'PERCENTUAL' | 'VALOR'>(cupom && cupom.valor !== null ? 'VALOR' : 'PERCENTUAL');
  const [valor, setValor] = useState(
    cupom && cupom.valor !== null
      ? precoParaCampo(cupom.valor)
      : cupom && cupom.percentual !== null
        ? numeroPt(cupom.percentual)
        : '',
  );
  const [minimo, setMinimo] = useState(cupom && cupom.minimo > 0 ? precoParaCampo(cupom.minimo) : '');
  const [validade, setValidade] = useState(cupom?.validade ?? '');
  const [limite, setLimite] = useState(cupom && cupom.limiteUsos !== null ? String(cupom.limiteUsos) : '');
  const [ativo, setAtivo] = useState(cupom?.ativo ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const codigoLimpo = codigo.trim().toUpperCase();
    const numero = lerPreco(valor);
    const consumoMinimo = minimo.trim() === '' ? 0 : lerPreco(minimo);
    const limiteTexto = limite.trim();
    const limiteNumero = limiteTexto === '' ? null : Number(limiteTexto);

    if (!/^[A-Z0-9_-]{3,20}$/.test(codigoLimpo)) {
      setErro('O código tem de 3 a 20 caracteres: letras, números, - e _.');
      return;
    }
    if (numero === null || (tipo === 'PERCENTUAL' && (numero <= 0 || numero > 100)) || (tipo === 'VALOR' && numero <= 0)) {
      setErro(tipo === 'PERCENTUAL' ? 'Informe o percentual de desconto, de 0,01 a 100.' : 'Informe o valor do desconto em reais.');
      return;
    }
    if (consumoMinimo === null) {
      setErro('Informe o consumo mínimo em reais.');
      return;
    }
    if (limiteNumero !== null && (!Number.isInteger(limiteNumero) || limiteNumero < 1)) {
      setErro('O limite de usos é um número inteiro, a partir de 1.');
      return;
    }

    const corpo: CupomCorpo = {
      codigo: codigoLimpo,
      descricao: descricao.trim() || null,
      percentual: tipo === 'PERCENTUAL' ? numero : null,
      valor: tipo === 'VALOR' ? numero : null,
      minimo: consumoMinimo,
      validade: validade || null,
      limiteUsos: limiteNumero,
      ativo,
    };

    setEnviando(true);
    try {
      if (cupom) {
        await api.put<CupomDTO>(`/cupons/${cupom.id}`, corpo);
        aoSalvo(`Cupom ${codigoLimpo} salvo.`);
      } else {
        await api.post<CupomDTO>('/cupons', corpo);
        aoSalvo(`Cupom ${codigoLimpo} criado.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={cupom ? 'Editar cupom' : 'Novo cupom'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="promocoes-grade">
          <Campo rotulo="Código" valor={codigo} aoMudar={(v) => setCodigo(v.toUpperCase())} obrigatorio />
          <Campo rotulo="Descrição (opcional)" valor={descricao} aoMudar={setDescricao} />
          <Selecao
            rotulo="Tipo de desconto"
            valor={tipo}
            aoMudar={(v) => setTipo(v as 'PERCENTUAL' | 'VALOR')}
            opcoes={[
              { valor: 'PERCENTUAL', rotulo: 'Percentual (%)' },
              { valor: 'VALOR', rotulo: 'Valor em R$' },
            ]}
          />
          <Campo
            rotulo={tipo === 'PERCENTUAL' ? 'Desconto (%)' : 'Valor do desconto (R$)'}
            valor={valor}
            aoMudar={setValor}
            obrigatorio
          />
          <Campo rotulo="Consumo mínimo (R$, opcional)" valor={minimo} aoMudar={setMinimo} />
          <Campo rotulo="Validade (opcional)" tipo="date" valor={validade} aoMudar={setValidade} />
          <Campo rotulo="Limite de usos (opcional)" tipo="number" valor={limite} aoMudar={setLimite} />
        </div>

        <Caixa rotulo="Ativo" marcado={ativo} aoMudar={setAtivo} />

        <div className="promocoes-acoes">
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

function AbaCupons() {
  const cupons = useDados<CupomDTO[]>('/cupons');
  const [formulario, setFormulario] = useState<{ cupom: CupomDTO | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const lista = cupons.dados ?? [];

  async function alternarAtivo(c: CupomDTO) {
    setErro(null);
    setAviso(null);
    try {
      await api.put<CupomDTO>(`/cupons/${c.id}`, corpoDoCupom(c, !c.ativo));
      setAviso(`Cupom ${c.codigo} ${c.ativo ? 'desativado' : 'ativado'}.`);
      cupons.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function excluir(c: CupomDTO) {
    if (
      !window.confirm(
        `Excluir o cupom ${c.codigo}? Se ele já foi usado em alguma conta, o cupom só é desativado.`,
      )
    )
      return;
    setErro(null);
    setAviso(null);
    try {
      await api.del(`/cupons/${c.id}`);
      setAviso(`Cupom ${c.codigo}: exclusão feita. Cupons usados em contas ficam desativados.`);
      cupons.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoesDe(c: CupomDTO): AcaoMenu[] {
    return [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setFormulario({ cupom: c }) },
      {
        rotulo: c.ativo ? 'Desativar' : 'Ativar',
        icone: c.ativo ? 'pausar' : 'visto',
        aoClicar: () => void alternarAtivo(c),
      },
      { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => void excluir(c) },
    ];
  }

  return (
    <>
      <Aviso tipo="info">O garçom digita o código na tela da conta.</Aviso>

      <div className="promocoes-acoes">
        <Botao aoClicar={() => setFormulario({ cupom: null })}>Novo cupom</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {cupons.erro && <Aviso tipo="erro">{cupons.erro}</Aviso>}
      {cupons.carregando && !cupons.dados && <Carregando />}

      {cupons.dados && (
        <Tabela
          dados={lista}
          chave={(c) => c.id}
          vazio="Nenhum cupom cadastrado."
          colunas={[
            {
              titulo: 'Código',
              celula: (c) => (
                <span className="produto-texto">
                  <code className="promocoes-codigo">{c.codigo}</code>
                  {c.descricao && <span className="produto-descricao">{c.descricao}</span>}
                </span>
              ),
            },
            {
              titulo: 'Desconto',
              celula: (c) => (c.percentual !== null ? `${numeroPt(c.percentual)}%` : formatarMoeda(c.valor ?? 0)),
            },
            { titulo: 'Consumo mínimo', celula: (c) => (c.minimo > 0 ? formatarMoeda(c.minimo) : 'Sem mínimo') },
            { titulo: 'Validade', celula: (c) => (c.validade ? formatarData(c.validade) : 'Sem validade') },
            {
              titulo: 'Usos',
              alinhar: 'direita',
              celula: (c) => (c.limiteUsos !== null ? `${c.usos} de ${c.limiteUsos}` : String(c.usos)),
            },
            { titulo: 'Situação', celula: (c) => <SeloCupom situacao={c.situacao} /> },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => <MenuAcoes rotulo={`Ações do cupom ${c.codigo}`} acoes={acoesDe(c)} />,
            },
          ]}
        />
      )}

      {formulario && (
        <FormCupom
          cupom={formulario.cupom}
          aoFechar={() => setFormulario(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            cupons.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Tela ----------

export function PromocoesECupons() {
  const [aba, setAba] = useState('promocoes');
  return (
    <Pagina titulo="Promoções e cupons">
      <Abas
        abas={[
          { id: 'promocoes', rotulo: 'Promoções' },
          { id: 'cupons', rotulo: 'Cupons' },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />
      {aba === 'promocoes' ? <AbaPromocoes /> : <AbaCupons />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/promocoes',
    rotulo: 'Promoções e cupons',
    icone: 'estrela',
    perfis: ['GESTOR'],
    elemento: <PromocoesECupons />,
    ordem: 24,
    grupo: 'Cardápio',
  },
];
