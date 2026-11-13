import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro } from '../../lib/restaurante';
import type { CategoriaDTO, SetorDTO } from '../../lib/restaurante';
import type { SetorEntrada, UsuarioSetorDTO } from '../../lib/setores';
import { Aviso, Botao, Campo, Caixa, Carregando, MenuAcoes, Modal, Pagina, Selo, Tabela } from '../../ui';
import './setores.css';

// Setores de preparo: cada categoria do cardápio vai para a fila do seu setor.
// Só o gestor mexe aqui.

// Nome do setor de um id, pela lista já carregada.
function nomeDoSetor(setores: SetorDTO[], id: number | null): string | null {
  if (id === null) return null;
  return setores.find((s) => s.id === id)?.nome ?? null;
}

// Escolha das pessoas da cozinha que trabalham no setor.
function EscolherPessoas({
  setor,
  setores,
  aoFechar,
  aoSalvo,
}: {
  setor: SetorDTO;
  setores: SetorDTO[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const usuarios = useDados<UsuarioSetorDTO[]>('/usuarios');
  // Quem já está no setor começa marcado (inclusive quem está desativado, que não aparece aqui).
  const [marcados, setMarcados] = useState<number[]>(() => setor.usuarios.map((u) => u.id));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cozinha = (usuarios.dados ?? []).filter((u) => u.perfil === 'COZINHA' && u.ativo);

  function alternar(id: number, marcado: boolean) {
    setMarcados((atual) => (marcado ? [...atual.filter((x) => x !== id), id] : atual.filter((x) => x !== id)));
  }

  async function salvar() {
    setErro(null);
    setEnviando(true);
    try {
      await api.put(`/setores/${setor.id}/usuarios`, { usuarioIds: marcados });
      aoSalvo(`Pessoas do setor ${setor.nome} salvas.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Pessoas · ${setor.nome}`} aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {usuarios.erro && <Aviso tipo="erro">{usuarios.erro}</Aviso>}
      {usuarios.carregando && !usuarios.dados && <Carregando />}
      {usuarios.dados && cozinha.length === 0 && (
        <p>Nenhuma pessoa ativa com o perfil Cozinha. Cadastre antes uma pessoa da cozinha.</p>
      )}
      {cozinha.map((u) => {
        const outro = u.setorId !== null && u.setorId !== setor.id ? nomeDoSetor(setores, u.setorId) : null;
        return (
          <Caixa
            key={u.id}
            rotulo={outro ? `${u.nome} (está no setor ${outro})` : u.nome}
            marcado={marcados.includes(u.id)}
            aoMudar={(marcado) => alternar(u.id, marcado)}
          />
        );
      })}
      <div className="setores-acoes-modal">
        <Botao desabilitado={enviando || !usuarios.dados} aoClicar={salvar}>
          Salvar
        </Botao>
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </Modal>
  );
}

// Escolha das categorias que vão para o setor.
function EscolherCategorias({
  setor,
  setores,
  aoFechar,
  aoSalvo,
}: {
  setor: SetorDTO;
  setores: SetorDTO[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  // Null até o usuário mexer: enquanto isso vale a escolha que vem do banco.
  const [escolhidas, setEscolhidas] = useState<number[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const lista = categorias.dados ?? [];
  const selecao =
    escolhidas ?? lista.filter((c) => c.setorId === setor.id).map((c) => c.id);

  function alternar(id: number, marcado: boolean) {
    setEscolhidas(marcado ? [...selecao.filter((x) => x !== id), id] : selecao.filter((x) => x !== id));
  }

  async function salvar() {
    setErro(null);
    setEnviando(true);
    // Só manda as categorias que mudaram.
    const mudar = lista.filter((c) => selecao.includes(c.id) !== (c.setorId === setor.id));
    try {
      for (const c of mudar) {
        await api.put(`/categorias/${c.id}`, { setorId: selecao.includes(c.id) ? setor.id : null });
      }
      aoSalvo(`Categorias do setor ${setor.nome} salvas.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Categorias · ${setor.nome}`} aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
      {categorias.carregando && !categorias.dados && <Carregando />}
      {categorias.dados && lista.length === 0 && <p>Nenhuma categoria cadastrada ainda.</p>}
      {lista.map((c) => {
        const outro = c.setorId !== null && c.setorId !== setor.id ? nomeDoSetor(setores, c.setorId) : null;
        return (
          <Caixa
            key={c.id}
            rotulo={outro ? `${c.nome} (está no setor ${outro})` : c.nome}
            marcado={selecao.includes(c.id)}
            aoMudar={(marcado) => alternar(c.id, marcado)}
          />
        );
      })}
      <div className="setores-acoes-modal">
        <Botao desabilitado={enviando || !categorias.dados} aoClicar={salvar}>
          Salvar
        </Botao>
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </Modal>
  );
}

// Novo setor (setor = null) ou edição de nome e cor.
function FormSetor({
  setor,
  aoFechar,
  aoSalvo,
}: {
  setor: SetorDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(setor?.nome ?? '');
  const [cor, setCor] = useState(setor?.cor ?? '#2563eb');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const limpo = nome.trim();
    if (limpo === '') {
      setErro('Informe o nome do setor.');
      return;
    }
    setEnviando(true);
    try {
      if (setor) {
        // Na edição, mantém a ordem e a situação do setor.
        const corpo: SetorEntrada = { nome: limpo, cor, ordem: setor.ordem, ativo: setor.ativo };
        await api.put(`/setores/${setor.id}`, corpo);
        aoSalvo(`Setor ${limpo} atualizado.`);
      } else {
        await api.post('/setores', { nome: limpo, cor } satisfies SetorEntrada);
        aoSalvo(`Setor ${limpo} criado.`);
      }
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={setor ? 'Editar setor' : 'Novo setor'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <label className="campo">
          <span className="campo-rotulo">Cor</span>
          <input className="setores-cor" type="color" value={cor} onChange={(e) => setCor(e.target.value)} />
        </label>
        <div className="setores-acoes-modal">
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

export function Setores() {
  // Todos os setores, inclusive os desativados (o gestor é o único que chega aqui).
  const setores = useDados<SetorDTO[]>('/setores?todos=1');
  const lista = setores.dados ?? [];
  const [editando, setEditando] = useState<SetorDTO | 'novo' | null>(null);
  const [pessoasDe, setPessoasDe] = useState<SetorDTO | null>(null);
  const [categoriasDe, setCategoriasDe] = useState<SetorDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  function salvou(mensagem: string) {
    setAviso(mensagem);
    setEditando(null);
    setPessoasDe(null);
    setCategoriasDe(null);
    setores.recarregar();
  }

  // Sugestão para começar: os três setores mais comuns.
  async function criarPadrao() {
    setErroAcao(null);
    setCriando(true);
    try {
      const padrao: SetorEntrada[] = [
        { nome: 'Cozinha', cor: '#ea580c', ordem: 0 },
        { nome: 'Bar', cor: '#2563eb', ordem: 1 },
        { nome: 'Sobremesas', cor: '#db2777', ordem: 2 },
      ];
      for (const s of padrao) {
        await api.post('/setores', s);
      }
      setAviso('Setores criados: Cozinha, Bar e Sobremesas.');
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setCriando(false);
      setores.recarregar();
    }
  }

  async function alternarAtivo(s: SetorDTO) {
    setErroAcao(null);
    try {
      await api.put(`/setores/${s.id}`, { nome: s.nome, cor: s.cor, ordem: s.ordem, ativo: !s.ativo } satisfies SetorEntrada);
      setAviso(s.ativo ? `Setor ${s.nome} desativado.` : `Setor ${s.nome} reativado.`);
      setores.recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  async function excluir(s: SetorDTO) {
    if (!window.confirm(`Excluir o setor "${s.nome}"? As categorias e as pessoas dele ficam sem setor. Não tem volta.`)) {
      return;
    }
    setErroAcao(null);
    try {
      await api.del(`/setores/${s.id}`);
      setAviso(`Setor ${s.nome} excluído.`);
      setores.recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  return (
    <Pagina
      titulo="Setores de preparo"
      acoes={
        <Botao aoClicar={() => setEditando('novo')}>Novo setor</Botao>
      }
    >
      <Aviso tipo="info">
        Com setores, cada categoria do cardápio vai para a fila do seu setor: o bar vê só as bebidas, a cozinha só os
        pratos. Quem é da cozinha e não está em nenhum setor continua vendo tudo. Sem nenhum setor cadastrado, tudo
        funciona como antes.
      </Aviso>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {setores.erro && <Aviso tipo="erro">{setores.erro}</Aviso>}
      {setores.carregando && !setores.dados && <Carregando />}

      {setores.dados && lista.length === 0 && (
        <div className="setores-sugestao">
          <p>Nenhum setor cadastrado. Tudo vai para a mesma fila.</p>
          <Botao aoClicar={criarPadrao} desabilitado={criando}>
            Criar Cozinha, Bar e Sobremesas
          </Botao>
        </div>
      )}

      {setores.dados && lista.length > 0 && (
        <Tabela
          dados={lista}
          chave={(s) => s.id}
          colunas={[
            {
              titulo: 'Cor',
              celula: (s) => <span className="setores-bolinha" style={{ background: s.cor }} aria-hidden="true" />,
            },
            { titulo: 'Setor', celula: (s) => <strong>{s.nome}</strong> },
            { titulo: 'Categorias', alinhar: 'direita', celula: (s) => String(s.categorias) },
            {
              titulo: 'Pessoas',
              celula: (s) => (s.usuarios.length > 0 ? s.usuarios.map((u) => u.nome).join(', ') : 'Ninguém'),
            },
            {
              titulo: 'Situação',
              celula: (s) => (s.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo cor="cinza">Desativado</Selo>),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (s) => (
                <MenuAcoes
                  rotulo={`Ações do setor ${s.nome}`}
                  acoes={[
                    { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(s) },
                    { rotulo: 'Escolher pessoas', icone: 'usuarios', aoClicar: () => setPessoasDe(s) },
                    { rotulo: 'Escolher categorias', icone: 'cardapio', aoClicar: () => setCategoriasDe(s) },
                    s.ativo
                      ? { rotulo: 'Desativar', icone: 'pausar', aoClicar: () => alternarAtivo(s) }
                      : { rotulo: 'Reativar', icone: 'reproduzir', aoClicar: () => alternarAtivo(s) },
                    { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(s) },
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      {editando !== null && (
        <FormSetor
          setor={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={salvou}
        />
      )}
      {pessoasDe && (
        <EscolherPessoas
          setor={pessoasDe}
          setores={lista}
          aoFechar={() => setPessoasDe(null)}
          aoSalvo={salvou}
        />
      )}
      {categoriasDe && (
        <EscolherCategorias
          setor={categoriasDe}
          setores={lista}
          aoFechar={() => setCategoriasDe(null)}
          aoSalvo={salvou}
        />
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/setores',
    rotulo: 'Setores de preparo',
    icone: 'grade',
    perfis: ['GESTOR'],
    elemento: <Setores />,
    grupo: 'Cardápio',
    ordem: 25,
  },
];
