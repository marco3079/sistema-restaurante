import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { lerPreco, mensagemErro, precoParaCampo } from '../../lib/restaurante';
import type { CategoriaDTO, ProdutoDTO } from '../../lib/restaurante';
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
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';
import { Indicador } from '../pedidos/comum';

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

function FormProduto({
  produto,
  categorias,
  aoFechar,
  aoSalvo,
}: {
  produto: ProdutoDTO | null;
  categorias: CategoriaDTO[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(produto?.nome ?? '');
  const [descricao, setDescricao] = useState(produto?.descricao ?? '');
  const [preco, setPreco] = useState(produto ? precoParaCampo(produto.preco) : '');
  const [categoriaId, setCategoriaId] = useState(produto ? String(produto.categoriaId) : '');
  const [imagem, setImagem] = useState<string | null>(produto?.imagem ?? null);
  const [disponivel, setDisponivel] = useState(produto?.disponivel ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valor = lerPreco(preco);
    if (valor === null) {
      setErro('Informe o preço em reais, por exemplo 24,90.');
      return;
    }
    if (!categoriaId) {
      setErro('Escolha a categoria.');
      return;
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
        <AreaTexto rotulo="Descrição" valor={descricao} aoMudar={setDescricao} linhas={3} />
        <CampoImagem valor={imagem} aoMudar={setImagem} aoErro={setErro} />
        <Caixa rotulo="Disponível para pedido" marcado={disponivel} aoMudar={setDisponivel} />
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
    if (!podeEditar) return [alternar];
    return [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setForm({ produto: p }) },
      alternar,
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
          <Indicador rotulo="Categorias" valor={String(categorias.length)} cor="roxo" icone="lista" />
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
          colunas={[
            {
              titulo: 'Produto',
              celula: (p) => (
                <div className="produto-celula">
                  <span className="produto-miniatura">
                    {p.imagem ? <img src={p.imagem} alt="" /> : <Icone nome="cardapio" tamanho={22} />}
                  </span>
                  <span className="produto-texto">
                    <span className="produto-nome">{p.nome}</span>
                    {p.descricao && <span className="produto-descricao">{p.descricao}</span>}
                  </span>
                </div>
              ),
            },
            { titulo: 'Categoria', celula: (p) => <span className="sem-quebra">{p.categoria.nome}</span> },
            {
              titulo: 'Preço',
              alinhar: 'direita',
              celula: (p) => <span className="sem-quebra">{formatarMoeda(p.preco)}</span>,
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

      {form && (
        <FormProduto
          produto={form.produto}
          categorias={categorias}
          aoFechar={() => setForm(null)}
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
      const corpo = { nome: nome.trim(), ordem: posicao, ativa };
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
        <Caixa rotulo="Aparece no cardápio do cliente" marcado={ativa} aoMudar={setAtiva} />
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
    </>
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
];
