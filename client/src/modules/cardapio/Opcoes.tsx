import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { lerPreco, mensagemErro, precoParaCampo } from '../../lib/restaurante';
import type { GrupoOpcaoDTO, ProdutoDTO } from '../../lib/restaurante';
import { Aviso, Botao, Caixa, Campo, Modal } from '../../ui';

const LIMITE_GRUPOS = 10;
const LIMITE_OPCOES = 30;

interface OpcaoRascunho {
  chave: number;
  nome: string;
  precoExtra: string;
  ativa: boolean;
}

interface GrupoRascunho {
  chave: number;
  nome: string;
  minimo: string;
  maximo: string;
  opcoes: OpcaoRascunho[];
}

interface ModeloGrupo {
  nome: string;
  minimo: string;
  maximo: string;
  opcoes: string[];
}

// Chave só para o React não confundir as linhas enquanto a tela está aberta.
let ultimaChave = 0;
function novaChave(): number {
  ultimaChave += 1;
  return ultimaChave;
}

const MODELOS: { rotulo: string; modelo: ModeloGrupo }[] = [
  {
    rotulo: 'Ponto da carne',
    modelo: { nome: 'Ponto da carne', minimo: '1', maximo: '1', opcoes: ['Mal passado', 'Ao ponto', 'Bem passado'] },
  },
  { rotulo: 'Adicionais', modelo: { nome: 'Adicionais', minimo: '0', maximo: '5', opcoes: [] } },
  { rotulo: 'Tirar ingredientes', modelo: { nome: 'Tirar ingredientes', minimo: '0', maximo: '5', opcoes: [] } },
];

function grupoNovo(modelo?: ModeloGrupo): GrupoRascunho {
  return {
    chave: novaChave(),
    nome: modelo?.nome ?? '',
    minimo: modelo?.minimo ?? '0',
    maximo: modelo?.maximo ?? '1',
    opcoes: (modelo?.opcoes ?? []).map((nome) => ({ chave: novaChave(), nome, precoExtra: '', ativa: true })),
  };
}

function grupoDoCadastro(grupo: GrupoOpcaoDTO): GrupoRascunho {
  return {
    chave: novaChave(),
    nome: grupo.nome,
    minimo: String(grupo.minimo),
    maximo: String(grupo.maximo),
    opcoes: grupo.opcoes.map((o) => ({
      chave: novaChave(),
      nome: o.nome,
      precoExtra: o.precoExtra > 0 ? precoParaCampo(o.precoExtra) : '',
      ativa: o.ativa,
    })),
  };
}

// Número inteiro digitado (sem vírgula). Inválido vira null.
function lerInteiro(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d+$/.test(limpo)) return null;
  return Number(limpo);
}

interface GrupoEnvio {
  nome: string;
  minimo: number;
  maximo: number;
  opcoes: { nome: string; precoExtra: number; ativa: boolean }[];
}

// Confere a tela antes de enviar. Devolve a frase do problema ou os grupos prontos.
function conferir(grupos: GrupoRascunho[]): { erro: string } | { grupos: GrupoEnvio[] } {
  if (grupos.length > LIMITE_GRUPOS) {
    return { erro: `Um produto aceita no máximo ${LIMITE_GRUPOS} grupos de opções.` };
  }
  const saida: GrupoEnvio[] = [];
  for (const grupo of grupos) {
    const nome = grupo.nome.trim();
    if (!nome) return { erro: 'Dê um nome a cada grupo de opções.' };
    if (nome.length > 40) return { erro: `O nome do grupo "${nome}" passa de 40 caracteres.` };

    const minimo = lerInteiro(grupo.minimo);
    if (minimo === null || minimo > 10) {
      return { erro: `No grupo "${nome}", o mínimo vai de 0 a 10.` };
    }
    const maximo = lerInteiro(grupo.maximo);
    if (maximo === null || maximo < 1 || maximo > 10) {
      return { erro: `No grupo "${nome}", o máximo vai de 1 a 10.` };
    }
    if (grupo.opcoes.length === 0) {
      return { erro: `O grupo "${nome}" precisa de pelo menos uma opção.` };
    }
    if (grupo.opcoes.length > LIMITE_OPCOES) {
      return { erro: `O grupo "${nome}" aceita no máximo ${LIMITE_OPCOES} opções.` };
    }

    const opcoes: GrupoEnvio['opcoes'] = [];
    for (const opcao of grupo.opcoes) {
      const nomeOpcao = opcao.nome.trim();
      if (!nomeOpcao) return { erro: `Dê um nome a todas as opções do grupo "${nome}".` };
      if (nomeOpcao.length > 60) return { erro: `A opção "${nomeOpcao}" passa de 60 caracteres.` };
      const acrescimo = opcao.precoExtra.trim() === '' ? 0 : lerPreco(opcao.precoExtra);
      if (acrescimo === null || acrescimo > 9999.99) {
        return { erro: `O acréscimo de "${nomeOpcao}" deve ser em reais, por exemplo 4,50 (até 9999,99).` };
      }
      opcoes.push({ nome: nomeOpcao, precoExtra: acrescimo, ativa: opcao.ativa });
    }

    const ativas = opcoes.filter((o) => o.ativa).length;
    if (minimo > maximo) return { erro: `No grupo "${nome}", o mínimo não pode ser maior que o máximo.` };
    if (maximo > ativas) {
      return {
        erro: `No grupo "${nome}", o máximo (${maximo}) é maior que o número de opções ativas (${ativas}).`,
      };
    }
    saida.push({ nome, minimo, maximo, opcoes });
  }
  return { grupos: saida };
}

export function OpcoesProduto({
  produto,
  aoFechar,
  aoSalvo,
}: {
  produto: ProdutoDTO;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [grupos, setGrupos] = useState<GrupoRascunho[]>(() => (produto.grupos ?? []).map(grupoDoCadastro));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function mudarGrupo(chaveGrupo: number, mudanca: Partial<GrupoRascunho>) {
    setGrupos((atual) => atual.map((g) => (g.chave === chaveGrupo ? { ...g, ...mudanca } : g)));
  }

  function mudarOpcao(chaveGrupo: number, chaveOpcao: number, mudanca: Partial<OpcaoRascunho>) {
    setGrupos((atual) =>
      atual.map((g) =>
        g.chave !== chaveGrupo
          ? g
          : { ...g, opcoes: g.opcoes.map((o) => (o.chave === chaveOpcao ? { ...o, ...mudanca } : o)) },
      ),
    );
  }

  function adicionarOpcao(chaveGrupo: number) {
    setGrupos((atual) =>
      atual.map((g) =>
        g.chave !== chaveGrupo
          ? g
          : {
              ...g,
              opcoes: [...g.opcoes, { chave: novaChave(), nome: '', precoExtra: '', ativa: true }],
            },
      ),
    );
  }

  function removerOpcao(chaveGrupo: number, chaveOpcao: number) {
    setGrupos((atual) =>
      atual.map((g) =>
        g.chave !== chaveGrupo ? g : { ...g, opcoes: g.opcoes.filter((o) => o.chave !== chaveOpcao) },
      ),
    );
  }

  function removerGrupo(grupo: GrupoRascunho) {
    const nome = grupo.nome.trim() || 'sem nome';
    if (!window.confirm(`Remover o grupo "${nome}" e as suas opções?`)) return;
    setGrupos((atual) => atual.filter((g) => g.chave !== grupo.chave));
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const resultado = conferir(grupos);
    if ('erro' in resultado) {
      setErro(resultado.erro);
      return;
    }
    setEnviando(true);
    try {
      await api.put(`/produtos/${produto.id}/opcoes`, { grupos: resultado.grupos });
      aoSalvo('Opções e adicionais salvos.');
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Opções e adicionais: ${produto.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p className="cardapio-ajuda">Mínimo 1 obriga o cliente a escolher. Máximo 1 deixa escolher só uma.</p>

        <div className="cardapio-modelos">
          <Botao
            variante="secundario"
            aoClicar={() => setGrupos((atual) => [...atual, grupoNovo()])}
            desabilitado={grupos.length >= LIMITE_GRUPOS}
          >
            Adicionar grupo
          </Botao>
          {MODELOS.map((m) => (
            <Botao
              key={m.rotulo}
              variante="texto"
              aoClicar={() => setGrupos((atual) => [...atual, grupoNovo(m.modelo)])}
              desabilitado={grupos.length >= LIMITE_GRUPOS}
            >
              Modelo: {m.rotulo}
            </Botao>
          ))}
        </div>

        {grupos.length === 0 && (
          <p className="cardapio-ajuda">Este prato ainda não tem opções. O cliente pede o prato como está.</p>
        )}

        {grupos.map((grupo, indice) => (
          <fieldset key={grupo.chave} className="ficha-grupo cardapio-grupo">
            <legend>Grupo {indice + 1}</legend>
            <Campo
              rotulo="Nome do grupo"
              valor={grupo.nome}
              aoMudar={(valor) => mudarGrupo(grupo.chave, { nome: valor })}
              obrigatorio
            />
            <div className="ficha-grade">
              <Campo
                rotulo="Escolher no mínimo"
                tipo="number"
                valor={grupo.minimo}
                aoMudar={(valor) => mudarGrupo(grupo.chave, { minimo: valor })}
              />
              <Campo
                rotulo="Escolher no máximo"
                tipo="number"
                valor={grupo.maximo}
                aoMudar={(valor) => mudarGrupo(grupo.chave, { maximo: valor })}
              />
            </div>

            {grupo.opcoes.map((opcao) => (
              <div key={opcao.chave} className="cardapio-opcao">
                <Campo
                  rotulo="Nome da opção"
                  valor={opcao.nome}
                  aoMudar={(valor) => mudarOpcao(grupo.chave, opcao.chave, { nome: valor })}
                />
                <Campo
                  rotulo="Acréscimo (R$, vazio = sem acréscimo)"
                  valor={opcao.precoExtra}
                  aoMudar={(valor) => mudarOpcao(grupo.chave, opcao.chave, { precoExtra: valor })}
                />
                <div className="cardapio-opcao-acoes">
                  <Caixa
                    rotulo="Ativa"
                    marcado={opcao.ativa}
                    aoMudar={(marcado) => mudarOpcao(grupo.chave, opcao.chave, { ativa: marcado })}
                  />
                  <Botao variante="texto" aoClicar={() => removerOpcao(grupo.chave, opcao.chave)}>
                    Remover opção
                  </Botao>
                </div>
              </div>
            ))}

            <div className="cardapio-linha-acoes">
              <Botao
                variante="secundario"
                aoClicar={() => adicionarOpcao(grupo.chave)}
                desabilitado={grupo.opcoes.length >= LIMITE_OPCOES}
              >
                Adicionar opção
              </Botao>
              <Botao variante="perigo" aoClicar={() => removerGrupo(grupo)}>
                Remover grupo
              </Botao>
            </div>
          </fieldset>
        ))}

        <div className="cardapio-rodape">
          <Botao tipo="submit" desabilitado={enviando}>
            Salvar
          </Botao>{' '}
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
