import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { NUTRIENTES, lerNumero, lerPreco, mensagemErro, precoParaCampo } from '../../lib/restaurante';
import type { CategoriaDTO, Nutricao, ProdutoDTO, SetorDTO } from '../../lib/restaurante';
import { PerfilDoPrato } from '../../cliente/PerfilDoPrato';
import {
  Abas,
  AreaTexto,
  Aviso,
  Botao,
  Caixa,
  Campo,
  Cartao,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import { Indicador } from '../pedidos/comum';
import { OpcoesProduto } from './Opcoes';
import type { CampoTraducao, RascunhoTraducoes } from './Traducoes';
import { Traducoes, montarTraducoes, mudarTraducao, rascunhoTraducoes } from './Traducoes';
import './cardapio.css';

const CAMPOS_PRODUTO: CampoTraducao[] = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'descricao', rotulo: 'Descrição curta (aparece na lista)', linhas: 2 },
  { chave: 'detalhes', rotulo: 'Apresentação do prato', linhas: 3 },
  { chave: 'ingredientes', rotulo: 'Ingredientes (separados por vírgula)', linhas: 2 },
  { chave: 'porcao', rotulo: 'Porção' },
  { chave: 'alergenicos', rotulo: 'Alergênicos' },
];

const CAMPOS_CATEGORIA: CampoTraducao[] = [{ chave: 'nome', rotulo: 'Nome' }];

// Quantos opções o produto tem somando todos os grupos.
function totalDeOpcoes(produto: ProdutoDTO): number {
  return (produto.grupos ?? []).reduce((total, grupo) => total + grupo.opcoes.length, 0);
}

// ---------- Imagem do produto ----------

const LADO_MAXIMO = 640;

// Reduz a foto no navegador e devolve um data URL JPEG pequeno (cabe no limite da API).
function reduzirImagem(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const endereco = URL.createObjectURL(arquivo);
    const imagem = new Image();
    imagem.onload = () => {
      URL.revokeObjectURL(endereco);
      const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
      const tela = document.createElement('canvas');
      tela.width = Math.max(1, Math.round(imagem.width * escala));
      tela.height = Math.max(1, Math.round(imagem.height * escala));
      const contexto = tela.getContext('2d');
      if (!contexto) {
        reject(new Error('Não foi possível ler a imagem.'));
        return;
      }
      contexto.fillStyle = '#ffffff';
      contexto.fillRect(0, 0, tela.width, tela.height);
      contexto.drawImage(imagem, 0, 0, tela.width, tela.height);
      // Baixa a qualidade até caber em 200.000 caracteres.
      for (const qualidade of [0.82, 0.7, 0.55, 0.4]) {
        const url = tela.toDataURL('image/jpeg', qualidade);
        if (url.length <= 200_000) {
          resolve(url);
          return;
        }
      }
      reject(new Error('A imagem é grande demais. Escolha uma menor.'));
    };
    imagem.onerror = () => {
      URL.revokeObjectURL(endereco);
      reject(new Error('Este arquivo não é uma imagem que o navegador consiga abrir.'));
    };
    imagem.src = endereco;
  });
}

function CampoImagem({
  valor,
  aoMudar,
  aoErro,
}: {
  valor: string | null;
  aoMudar: (valor: string | null) => void;
  aoErro: (mensagem: string | null) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);

  async function escolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    aoErro(null);
    try {
      aoMudar(await reduzirImagem(arquivo));
    } catch (err) {
      aoErro(mensagemErro(err));
    }
  }

  return (
    <div className="imagem-campo">
      <span className="imagem-previa">
        {valor ? <img src={valor} alt="Foto do produto" /> : <Icone nome="imagem" tamanho={28} />}
      </span>
      <div className="imagem-acoes">
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          className="oculto"
          aria-label="Escolher foto do produto"
          onChange={escolher}
        />
        <Botao variante="secundario" aoClicar={() => entrada.current?.click()}>
          {valor ? 'Trocar foto' : 'Escolher foto'}
        </Botao>
        {valor && (
          <Botao variante="texto" aoClicar={() => aoMudar(null)}>
            Remover
          </Botao>
        )}
      </div>
    </div>
  );
}

// ---------- Produto ----------

// Linha do combo: produto (id como texto, vazio = não escolhido) e quantidade digitada.
interface LinhaCombo {
  produtoId: string;
  quantidade: string;
}

function FormProduto({
  produto,
  categorias,
  produtos,
  aoFechar,
  aoSalvo,
}: {
  produto: ProdutoDTO | null;
  categorias: CategoriaDTO[];
  produtos: ProdutoDTO[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(produto?.nome ?? '');
  const [descricao, setDescricao] = useState(produto?.descricao ?? '');
  const [preco, setPreco] = useState(produto ? precoParaCampo(produto.preco) : '');
  const [categoriaId, setCategoriaId] = useState(produto ? String(produto.categoriaId) : '');
  const [imagem, setImagem] = useState<string | null>(produto?.imagem ?? null);
  const [disponivel, setDisponivel] = useState(produto?.disponivel ?? true);
  const [recomendado, setRecomendado] = useState(produto?.recomendado ?? false);
  const [detalhes, setDetalhes] = useState(produto?.detalhes ?? '');
  const [ingredientes, setIngredientes] = useState(produto?.ingredientes ?? '');
  const [porcao, setPorcao] = useState(produto?.porcao ?? '');
  const [tempo, setTempo] = useState(
    produto?.tempoPreparoMin === null || produto?.tempoPreparoMin === undefined ? '' : String(produto.tempoPreparoMin),
  );
  const [alergenicos, setAlergenicos] = useState(produto?.alergenicos ?? '');
  const [nutricao, setNutricao] = useState<Record<keyof Nutricao, string>>(() => {
    const inicial = {} as Record<keyof Nutricao, string>;
    for (const n of NUTRIENTES) {
      const valor = produto?.nutricao?.[n.chave];
      inicial[n.chave] = valor === null || valor === undefined ? '' : String(valor).replace('.', ',');
    }
    return inicial;
  });
  const [controlaEstoque, setControlaEstoque] = useState(produto?.controlaEstoque ?? false);
  const [estoqueMinimo, setEstoqueMinimo] = useState(String(produto?.estoqueMinimo ?? 0));
  const [ncm, setNcm] = useState(produto?.ncm ?? '');
  const [cfop, setCfop] = useState(produto?.cfop ?? '');
  const [combo, setCombo] = useState(produto?.combo ?? false);
  const [linhasCombo, setLinhasCombo] = useState<LinhaCombo[]>(() =>
    (produto?.comboItens ?? []).map((item) => ({ produtoId: String(item.produtoId), quantidade: String(item.quantidade) })),
  );
  const [traducoes, setTraducoes] = useState<RascunhoTraducoes>(() =>
    rascunhoTraducoes(CAMPOS_PRODUTO, produto?.traducoes),
  );
  // Só produtos que podem entrar num combo: não são combo e não são o próprio.
  const candidatos = produtos.filter((p) => !p.combo && p.id !== produto?.id);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function mudarLinhaCombo(indice: number, mudanca: Partial<LinhaCombo>) {
    setLinhasCombo((atual) => atual.map((linha, i) => (i === indice ? { ...linha, ...mudanca } : linha)));
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valor = lerPreco(preco);
    const minimo = Number(estoqueMinimo.trim() || '0');
    if (!Number.isInteger(minimo) || minimo < 0) {
      setErro('O estoque mínimo deve ser um número inteiro.');
      return;
    }
    if (!/^(\d{8})?$/.test(ncm.trim()) || !/^(\d{4})?$/.test(cfop.trim())) {
      setErro('O NCM tem 8 dígitos e o CFOP tem 4 dígitos (só números).');
      return;
    }
    if (valor === null) {
      setErro('Informe o preço em reais, por exemplo 24,90.');
      return;
    }
    if (!categoriaId) {
      setErro('Escolha a categoria.');
      return;
    }
    const minutos = lerNumero(tempo);
    if (minutos === undefined || (minutos !== null && !Number.isInteger(minutos))) {
      setErro('O tempo de preparo deve ser um número inteiro de minutos.');
      return;
    }
    const tabela = {} as Nutricao;
    for (const n of NUTRIENTES) {
      const lido = lerNumero(nutricao[n.chave]);
      if (lido === undefined) {
        setErro(`Na tabela nutricional, "${n.rotulo}" deve ser um número.`);
        return;
      }
      tabela[n.chave] = lido;
    }
    const itensCombo: { produtoId: number; quantidade: number }[] = [];
    if (combo) {
      for (const linha of linhasCombo) {
        const quantidadeCombo = Number(linha.quantidade.trim());
        if (!linha.produtoId) {
          setErro('Escolha o produto de cada linha do combo.');
          return;
        }
        if (!Number.isInteger(quantidadeCombo) || quantidadeCombo < 1 || quantidadeCombo > 20) {
          setErro('A quantidade de cada produto do combo vai de 1 a 20.');
          return;
        }
        itensCombo.push({ produtoId: Number(linha.produtoId), quantidade: quantidadeCombo });
      }
    }
    setEnviando(true);
    try {
      const corpo = {
        nome: nome.trim(),
        descricao: descricao.trim(),
        preco: valor,
        categoriaId: Number(categoriaId),
        imagem,
        disponivel,
        recomendado,
        detalhes: detalhes.trim(),
        ingredientes: ingredientes.trim(),
        porcao: porcao.trim() || null,
        tempoPreparoMin: minutos,
        alergenicos: alergenicos.trim() || null,
        nutricao: tabela,
        controlaEstoque,
        estoqueMinimo: minimo,
        ncm: ncm.trim() || null,
        cfop: cfop.trim() || null,
        combo,
        comboItens: combo ? itensCombo : [],
        traducoes: montarTraducoes(CAMPOS_PRODUTO, traducoes),
      };
      if (produto) {
        await api.put(`/produtos/${produto.id}`, corpo);
        aoSalvo('Produto atualizado.');
      } else {
        await api.post('/produtos', corpo);
        aoSalvo('Produto criado.');
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={produto ? 'Editar produto' : 'Novo produto'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Selecao
          rotulo="Categoria"
          valor={categoriaId}
          aoMudar={setCategoriaId}
          obrigatorio
          opcoes={categorias.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
        />
        <Campo rotulo="Preço (R$)" valor={preco} aoMudar={setPreco} obrigatorio />
        <AreaTexto rotulo="Descrição curta (aparece na lista)" valor={descricao} aoMudar={setDescricao} linhas={2} />
        <CampoImagem valor={imagem} aoMudar={setImagem} aoErro={setErro} />

        <fieldset className="ficha-grupo">
          <legend>Ficha do prato (aparece quando o cliente toca no item)</legend>
          <AreaTexto rotulo="Apresentação do prato" valor={detalhes} aoMudar={setDetalhes} linhas={3} />
          <AreaTexto
            rotulo="Ingredientes (separados por vírgula)"
            valor={ingredientes}
            aoMudar={setIngredientes}
            linhas={2}
          />
          <div className="ficha-grade">
            <Campo rotulo="Porção (ex.: 1 prato, 450 g)" valor={porcao} aoMudar={setPorcao} />
            <Campo rotulo="Tempo de preparo (min)" valor={tempo} aoMudar={setTempo} />
          </div>
          <Campo rotulo="Alergênicos (ex.: glúten, leite)" valor={alergenicos} aoMudar={setAlergenicos} />
        </fieldset>

        <fieldset className="ficha-grupo">
          <legend>Tabela nutricional da porção (deixe em branco o que não souber)</legend>
          <div className="ficha-grade">
            {NUTRIENTES.map((n) => (
              <Campo
                key={n.chave}
                rotulo={`${n.rotulo} (${n.unidade})`}
                valor={nutricao[n.chave]}
                aoMudar={(valor) => setNutricao((atual) => ({ ...atual, [n.chave]: valor }))}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="ficha-grupo">
          <legend>Estoque e nota fiscal</legend>
          <Caixa
            rotulo="Controlar estoque (cada pedido baixa o saldo; ao zerar, o item sai do cardápio)"
            marcado={controlaEstoque}
            aoMudar={setControlaEstoque}
          />
          {controlaEstoque && (
            <>
              <Campo
                rotulo="Estoque mínimo (avisa quando chegar nele)"
                tipo="number"
                valor={estoqueMinimo}
                aoMudar={setEstoqueMinimo}
              />
              <p className="maquinetas-texto">
                {produto?.controlaEstoque
                  ? `Saldo atual: ${produto.estoque}. As entradas e saídas são lançadas na tela Estoque.`
                  : 'O saldo começa em zero: depois de salvar, lance a entrada na tela Estoque para o item aparecer no cardápio.'}
              </p>
            </>
          )}
          <div className="ficha-grade">
            <Campo rotulo="NCM (opcional, 8 dígitos)" valor={ncm} aoMudar={setNcm} />
            <Campo rotulo="CFOP (opcional, 4 dígitos)" valor={cfop} aoMudar={setCfop} />
          </div>
        </fieldset>

        <fieldset className="ficha-grupo">
          <legend>Combo</legend>
          <Caixa
            rotulo="Este produto é um combo (vem com outros produtos)"
            marcado={combo}
            aoMudar={setCombo}
          />
          {combo && (
            <>
              <p className="cardapio-ajuda">
                O preço do combo é o deste cadastro. Ao vender, o estoque dos produtos do combo é baixado.
              </p>
              {linhasCombo.map((linha, indice) => (
                <div key={indice} className="cardapio-combo-linha">
                  <Selecao
                    rotulo="Produto"
                    valor={linha.produtoId}
                    aoMudar={(valor) => mudarLinhaCombo(indice, { produtoId: valor })}
                    opcoes={candidatos.map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
                  />
                  <Campo
                    rotulo="Quantidade"
                    tipo="number"
                    valor={linha.quantidade}
                    aoMudar={(valor) => mudarLinhaCombo(indice, { quantidade: valor })}
                  />
                  <Botao
                    variante="texto"
                    aoClicar={() => setLinhasCombo((atual) => atual.filter((_, i) => i !== indice))}
                  >
                    Remover
                  </Botao>
                </div>
              ))}
              <Botao
                variante="secundario"
                aoClicar={() => setLinhasCombo((atual) => [...atual, { produtoId: '', quantidade: '1' }])}
              >
                Adicionar produto ao combo
              </Botao>
            </>
          )}
        </fieldset>

        <fieldset className="ficha-grupo">
          <legend>Traduções (opcional)</legend>
          <Traducoes
            campos={CAMPOS_PRODUTO}
            valor={traducoes}
            aoMudar={(idioma, chave, texto) => setTraducoes((atual) => mudarTraducao(atual, idioma, chave, texto))}
          />
        </fieldset>

        <Caixa rotulo="Disponível para pedido" marcado={disponivel} aoMudar={setDisponivel} />
        <Caixa
          rotulo="Recomendado da casa (aparece em destaque no cardápio do cliente)"
          marcado={recomendado}
          aoMudar={setRecomendado}
        />
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

function AbaProdutos({ podeEditar, categorias }: { podeEditar: boolean; categorias: CategoriaDTO[] }) {
  const [categoriaId, setCategoriaId] = useState('');
  const [busca, setBusca] = useState('');
  // null = fechado; { produto: null } = novo; { produto } = editar
  const [form, setForm] = useState<{ produto: ProdutoDTO | null } | null>(null);
  const [ficha, setFicha] = useState<ProdutoDTO | null>(null);
  const [opcoesDe, setOpcoesDe] = useState<ProdutoDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const produtos = useDados<ProdutoDTO[]>('/produtos');

  const termo = busca.trim().toLowerCase();
  const todos = produtos.dados ?? [];
  const lista = todos.filter(
    (p) =>
      (!categoriaId || String(p.categoriaId) === categoriaId) &&
      (!termo || p.nome.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo)),
  );
  const esgotados = todos.filter((p) => !p.disponivel).length;

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErroAcao(null);
    setAviso(null);
    try {
      await acao();
      setAviso(mensagem);
      produtos.recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  function acoesDe(p: ProdutoDTO): AcaoMenu[] {
    const alternar: AcaoMenu = {
      rotulo: p.disponivel ? 'Marcar como esgotado' : 'Marcar como disponível',
      icone: p.disponivel ? 'pausar' : 'reproduzir',
      aoClicar: () =>
        void executar(
          () => api.put(`/produtos/${p.id}/disponivel`, { disponivel: !p.disponivel }),
          p.disponivel ? `"${p.nome}" marcado como esgotado.` : `"${p.nome}" voltou ao cardápio.`,
        ),
    };
    const verFicha: AcaoMenu = { rotulo: 'Ver ficha do prato', icone: 'documento', aoClicar: () => setFicha(p) };
    if (!podeEditar) return [verFicha, alternar];
    return [
      verFicha,
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setForm({ produto: p }) },
      { rotulo: 'Opções e adicionais', icone: 'lista', aoClicar: () => setOpcoesDe(p) },
      alternar,
      {
        rotulo: p.recomendado ? 'Tirar dos recomendados' : 'Pôr nos recomendados',
        icone: 'estrela',
        aoClicar: () =>
          void executar(
            () => api.put(`/produtos/${p.id}`, { recomendado: !p.recomendado }),
            p.recomendado ? `"${p.nome}" saiu dos recomendados.` : `"${p.nome}" entrou nos recomendados.`,
          ),
      },
      {
        rotulo: 'Excluir',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          if (!window.confirm(`Excluir "${p.nome}" do cardápio?`)) return;
          void executar(() => api.del(`/produtos/${p.id}`), 'Produto excluído.');
        },
      },
    ];
  }

  return (
    <>
      {produtos.dados && (
        <div className="resumo">
          <Indicador rotulo="Produtos no cardápio" valor={String(todos.length)} cor="azul" icone="cardapio" />
          <Indicador rotulo="Disponíveis" valor={String(todos.length - esgotados)} cor="verde" icone="visto" />
          <Indicador rotulo="Esgotados" valor={String(esgotados)} cor="laranja" icone="pausar" />
          <Indicador
            rotulo="Recomendados da casa"
            valor={String(todos.filter((p) => p.recomendado).length)}
            cor="roxo"
            icone="estrela"
          />
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="filtros">
          <Selecao
            rotulo="Categoria"
            valor={categoriaId}
            aoMudar={setCategoriaId}
            vazio="Todas"
            opcoes={categorias.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
          />
          <Campo rotulo="Buscar" valor={busca} aoMudar={setBusca} />
        </div>
        {podeEditar && (
          <Botao aoClicar={() => setForm({ produto: null })} desabilitado={categorias.length === 0}>
            Novo produto
          </Botao>
        )}
      </div>

      {podeEditar && categorias.length === 0 && (
        <Aviso tipo="info">Crie uma categoria na aba "Categorias" antes de cadastrar produtos.</Aviso>
      )}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {produtos.erro && <Aviso tipo="erro">{produtos.erro}</Aviso>}
      {produtos.carregando && !produtos.dados && <Carregando />}

      {produtos.dados && (
        <Tabela
          dados={lista}
          chave={(p) => p.id}
          vazio="Nenhum produto encontrado."
          aoClicarLinha={setFicha}
          colunas={[
            {
              titulo: 'Produto',
              celula: (p) => (
                <div className="produto-celula">
                  <span className="produto-miniatura">
                    {p.imagem ? <img src={p.imagem} alt="" /> : <Icone nome="cardapio" tamanho={22} />}
                  </span>
                  <span className="produto-texto">
                    <span className="produto-nome">
                      {p.nome}
                      {p.recomendado && (
                        <span className="produto-estrela" title="Recomendado da casa">
                          <Icone nome="estrela" tamanho={14} />
                          <span className="oculto">Recomendado da casa</span>
                        </span>
                      )}
                      {(p.combo || (p.grupos ?? []).length > 0) && (
                        <span className="cardapio-selos">
                          {p.combo && <Selo cor="azul">Combo</Selo>}
                          {(p.grupos ?? []).length > 0 && (
                            <Selo cor="cinza">
                              {totalDeOpcoes(p)} {totalDeOpcoes(p) === 1 ? 'opção' : 'opções'}
                            </Selo>
                          )}
                        </span>
                      )}
                    </span>
                    {p.descricao && <span className="produto-descricao">{p.descricao}</span>}
                  </span>
                </div>
              ),
            },
            { titulo: 'Categoria', celula: (p) => <span className="sem-quebra">{p.categoria.nome}</span> },
            {
              titulo: 'Preço',
              alinhar: 'direita',
              celula: (p) =>
                p.promocao ? (
                  <span className="cardapio-preco">
                    <span className="sem-quebra">{formatarMoeda(p.precoAtual)}</span>
                    <s className="sem-quebra cardapio-preco-tabela">{formatarMoeda(p.preco)}</s>
                    <Selo cor="verde">{p.promocao}</Selo>
                  </span>
                ) : (
                  <span className="sem-quebra">{formatarMoeda(p.preco)}</span>
                ),
            },
            {
              titulo: 'Situação',
              celula: (p) =>
                p.disponivel ? <Selo cor="verde">Disponível</Selo> : <Selo cor="amarelo">Esgotado</Selo>,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (p) => <MenuAcoes rotulo={`Ações do produto ${p.nome}`} acoes={acoesDe(p)} />,
            },
          ]}
        />
      )}

      {ficha && <PerfilDoPrato prato={ficha} aoFechar={() => setFicha(null)} />}

      {form && (
        <FormProduto
          produto={form.produto}
          categorias={categorias}
          produtos={todos}
          aoFechar={() => setForm(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            produtos.recarregar();
          }}
        />
      )}

      {opcoesDe && (
        <OpcoesProduto
          produto={opcoesDe}
          aoFechar={() => setOpcoesDe(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            produtos.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Categorias ----------

function FormCategoria({
  categoria,
  aoFechar,
  aoSalvo,
}: {
  categoria: CategoriaDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [ordem, setOrdem] = useState(String(categoria?.ordem ?? 0));
  const [ativa, setAtiva] = useState(categoria?.ativa ?? true);
  const [setorId, setSetorId] = useState(categoria?.setorId ? String(categoria.setorId) : '');
  const [traducoes, setTraducoes] = useState<RascunhoTraducoes>(() =>
    rascunhoTraducoes(CAMPOS_CATEGORIA, categoria?.traducoes),
  );
  const setores = useDados<SetorDTO[]>('/setores');
  const listaSetores = setores.dados ?? [];
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const posicao = Number(ordem);
    if (!Number.isInteger(posicao) || posicao < 0) {
      setErro('A ordem deve ser um número a partir de 0.');
      return;
    }
    setEnviando(true);
    try {
      const corpo = {
        nome: nome.trim(),
        ordem: posicao,
        ativa,
        setorId: setorId ? Number(setorId) : null,
        traducoes: montarTraducoes(CAMPOS_CATEGORIA, traducoes),
      };
      if (categoria) {
        await api.put(`/categorias/${categoria.id}`, corpo);
        aoSalvo('Categoria atualizada.');
      } else {
        await api.post('/categorias', corpo);
        aoSalvo('Categoria criada.');
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
        <Campo rotulo="Ordem no cardápio (menor aparece primeiro)" tipo="number" valor={ordem} aoMudar={setOrdem} />
        {listaSetores.length > 0 && (
          <Selecao
            rotulo="Setor de preparo"
            valor={setorId}
            aoMudar={setSetorId}
            vazio="Nenhum (fila geral)"
            opcoes={listaSetores.map((s) => ({ valor: String(s.id), rotulo: s.nome }))}
          />
        )}
        <Caixa rotulo="Aparece no cardápio do cliente" marcado={ativa} aoMudar={setAtiva} />
        <details className="cardapio-detalhes">
          <summary>Traduções do nome</summary>
          <div className="cardapio-detalhes-corpo">
            <Traducoes
              campos={CAMPOS_CATEGORIA}
              valor={traducoes}
              aoMudar={(idioma, chave, texto) => setTraducoes((atual) => mudarTraducao(atual, idioma, chave, texto))}
            />
          </div>
        </details>
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

function AbaCategorias({
  categorias,
  aoMudar,
}: {
  categorias: CategoriaDTO[];
  aoMudar: () => void;
}) {
  const [form, setForm] = useState<{ categoria: CategoriaDTO | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // Inclui setores desativados, para a categoria mostrar o nome do setor que ela ainda tem.
  const setores = useDados<SetorDTO[]>('/setores?todos=1');
  const listaSetores = setores.dados ?? [];
  const mostrarSetor = listaSetores.length > 0;
  const colunaSetor: ColunaTabela<CategoriaDTO>[] = mostrarSetor
    ? [
        {
          titulo: 'Setor',
          celula: (c) => listaSetores.find((s) => s.id === c.setorId)?.nome ?? '—',
        },
      ]
    : [];

  async function excluir(c: CategoriaDTO) {
    if (!window.confirm(`Excluir a categoria "${c.nome}"?`)) return;
    setErroAcao(null);
    setAviso(null);
    try {
      await api.del(`/categorias/${c.id}`);
      setAviso('Categoria excluída.');
      aoMudar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  return (
    <>
      <div className="pagina-acoes">
        <Botao aoClicar={() => setForm({ categoria: null })}>Nova categoria</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      <Tabela
        dados={categorias}
        chave={(c) => c.id}
        vazio="Nenhuma categoria cadastrada."
        colunas={[
          { titulo: 'Nome', celula: (c) => c.nome },
          ...colunaSetor,
          { titulo: 'Ordem', celula: (c) => String(c.ordem) },
          { titulo: 'Produtos', celula: (c) => String(c.produtos) },
          {
            titulo: 'No cardápio',
            celula: (c) => (c.ativa ? <Selo cor="verde">Sim</Selo> : <Selo cor="cinza">Não</Selo>),
          },
          {
            titulo: 'Ações',
            acoes: true,
            celula: (c) => (
              <MenuAcoes
                rotulo={`Ações da categoria ${c.nome}`}
                acoes={[
                  { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setForm({ categoria: c }) },
                  { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => void excluir(c) },
                ]}
              />
            ),
          },
        ]}
      />

      {form && (
        <FormCategoria
          categoria={form.categoria}
          aoFechar={() => setForm(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            aoMudar();
          }}
        />
      )}

      <CartaoIdiomas />
    </>
  );
}

// ---------- Idiomas do cardápio do cliente ----------

function CartaoIdiomas() {
  const idiomas = useDados<{ idiomas: string[] }>('/cardapio/idiomas');
  const [ingles, setIngles] = useState(false);
  const [espanhol, setEspanhol] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Quando a lista chega do servidor, marca o que já está ligado.
  useEffect(() => {
    if (!idiomas.dados) return;
    setIngles(idiomas.dados.idiomas.includes('en'));
    setEspanhol(idiomas.dados.idiomas.includes('es'));
  }, [idiomas.dados]);

  async function salvar() {
    setAviso(null);
    setErro(null);
    setEnviando(true);
    const lista = ['pt', ...(ingles ? ['en'] : []), ...(espanhol ? ['es'] : [])];
    try {
      await api.put('/cardapio/idiomas', { idiomas: lista });
      setAviso('Idiomas do cardápio salvos.');
      idiomas.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Idiomas do cardápio do cliente">
      <p className="cardapio-ajuda">
        Com outro idioma ligado, o cliente escolhe a língua no cardápio da mesa. O que não tiver tradução aparece em
        português.
      </p>
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {idiomas.erro && <Aviso tipo="erro">{idiomas.erro}</Aviso>}
      {idiomas.carregando && !idiomas.dados && <Carregando />}
      {idiomas.dados && (
        <>
          <div className="cardapio-idiomas-caixas">
            <label className="caixa">
              <input type="checkbox" checked disabled />
              <span>Português (sempre ligado)</span>
            </label>
            <Caixa rotulo="Inglês" marcado={ingles} aoMudar={setIngles} />
            <Caixa rotulo="Espanhol" marcado={espanhol} aoMudar={setEspanhol} />
          </div>
          <Botao aoClicar={() => void salvar()} desabilitado={enviando}>
            Salvar idiomas
          </Botao>
        </>
      )}
    </Cartao>
  );
}

// ---------- Tela ----------

export function Cardapio() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const [aba, setAba] = useState('produtos');
  const lista = categorias.dados ?? [];

  return (
    <Pagina titulo="Cardápio">
      {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
      {categorias.carregando && !categorias.dados && <Carregando />}
      {gestor && (
        <Abas
          abas={[
            { id: 'produtos', rotulo: 'Produtos' },
            { id: 'categorias', rotulo: 'Categorias' },
          ]}
          ativa={aba}
          aoMudar={setAba}
        />
      )}
      {!gestor && (
        <Aviso tipo="info">Quando um item acabar, marque como esgotado: ele sai do cardápio do cliente na hora.</Aviso>
      )}
      {categorias.dados &&
        (aba === 'produtos' || !gestor ? (
          <AbaProdutos podeEditar={gestor} categorias={lista} />
        ) : (
          <AbaCategorias categorias={lista} aoMudar={categorias.recarregar} />
        ))}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/cardapio',
    rotulo: 'Cardápio',
    icone: 'cardapio',
    perfis: ['GESTOR'],
    elemento: <Cardapio />,
    ordem: 20,
  },
  {
    caminho: '/garcom/cardapio',
    rotulo: 'Cardápio',
    icone: 'cardapio',
    perfis: ['GARCOM'],
    elemento: <Cardapio />,
    ordem: 20,
  },
  {
    caminho: '/cozinha/cardapio',
    rotulo: 'Cardápio',
    icone: 'cardapio',
    perfis: ['COZINHA'],
    elemento: <Cardapio />,
    ordem: 20,
  },
];
