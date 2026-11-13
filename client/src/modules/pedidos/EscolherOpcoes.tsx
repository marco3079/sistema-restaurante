import { useState } from 'react';
import type { FormEvent } from 'react';
import { AreaTexto, Botao, Modal, formatarMoeda } from '../../ui';
import type { GrupoOpcaoDTO, OpcaoEscolhidaDTO, ProdutoDTO } from '../../lib/restaurante';

// Escolha de opções do prato no "Novo pedido": grupos com regra (mínimo e máximo), total ao vivo e observação.

// Preço de venda agora (com promoção); se o servidor não mandou, o de tabela.
export function precoVigente(p: ProdutoDTO): number {
  return p.precoAtual ?? p.preco;
}

// O prato tem opções quando algum grupo tem opção ativa.
export function temOpcoes(p: ProdutoDTO): boolean {
  return (p.grupos ?? []).some((g) => g.opcoes.some((o) => o.ativa));
}

// Texto de uma opção: "+ Bacon" quando tem acréscimo, "Ao ponto" quando não tem.
export function rotuloOpcao(nome: string, precoExtra: number): string {
  return precoExtra > 0 ? `+ ${nome}` : nome;
}

// Opções já escolhidas em uma linha de texto: "Ao ponto · + Bacon".
export function textoOpcoes(opcoes: OpcaoEscolhidaDTO[] | undefined): string {
  return (opcoes ?? []).map((o) => rotuloOpcao(o.opcao, o.precoExtra)).join(' · ');
}

// O que o "Novo pedido" guarda quando o cliente confirma as opções.
export interface ConfiguracaoItem {
  // Ids das opções escolhidas, em ordem crescente.
  opcoes: number[];
  // Texto de cada opção escolhida, na ordem dos grupos.
  rotulos: string[];
  // Soma dos acréscimos das opções.
  extra: number;
  // Observação já sem espaços nas pontas ('' quando não há).
  observacao: string;
}

function regraDoGrupo(g: GrupoOpcaoDTO): string {
  if (g.minimo >= 1) {
    if (g.maximo === 1) return 'Escolha 1';
    if (g.minimo === g.maximo) return `Escolha ${g.minimo}`;
    return `Escolha de ${g.minimo} a ${g.maximo}`;
  }
  return g.maximo === 1 ? 'Opcional' : `Escolha até ${g.maximo}`;
}

export function EscolherOpcoes({
  produto,
  aoFechar,
  aoAdicionar,
}: {
  produto: ProdutoDTO;
  aoFechar: () => void;
  aoAdicionar: (configuracao: ConfiguracaoItem) => void;
}) {
  // Só os grupos com opção ativa; a opção inativa nunca aparece.
  const grupos = (produto.grupos ?? [])
    .map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => o.ativa) }))
    .filter((g) => g.opcoes.length > 0);
  // Ids das opções marcadas, por grupo.
  const [escolhidas, setEscolhidas] = useState<Record<number, number[]>>({});
  const [observacao, setObservacao] = useState('');

  const marcadasDoGrupo = (g: GrupoOpcaoDTO) => escolhidas[g.id] ?? [];

  // Resultado da escolha atual, na ordem dos grupos.
  const ids: number[] = [];
  const rotulos: string[] = [];
  let extra = 0;
  for (const g of grupos) {
    for (const o of g.opcoes) {
      if (marcadasDoGrupo(g).includes(o.id)) {
        ids.push(o.id);
        rotulos.push(rotuloOpcao(o.nome, o.precoExtra));
        extra += o.precoExtra;
      }
    }
  }
  const completo = grupos.every((g) => marcadasDoGrupo(g).length >= g.minimo);
  const total = precoVigente(produto) + extra;

  function alternar(g: GrupoOpcaoDTO, opcaoId: number) {
    setEscolhidas((atual) => {
      const lista = atual[g.id] ?? [];
      // Escolha única (rádio): a nova opção troca a anterior.
      if (g.maximo === 1) return { ...atual, [g.id]: [opcaoId] };
      if (lista.includes(opcaoId)) return { ...atual, [g.id]: lista.filter((i) => i !== opcaoId) };
      // Já no máximo: não marca mais.
      if (lista.length >= g.maximo) return atual;
      return { ...atual, [g.id]: [...lista, opcaoId] };
    });
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!completo) return;
    aoAdicionar({
      opcoes: [...ids].sort((a, b) => a - b),
      rotulos,
      extra,
      observacao: observacao.trim(),
    });
  }

  return (
    <Modal aberto titulo={produto.nome} aoFechar={aoFechar}>
      <form className="escolher" onSubmit={enviar}>
        {grupos.map((g) => {
          const marcadas = marcadasDoGrupo(g);
          const cheio = g.maximo > 1 && marcadas.length >= g.maximo;
          return (
            <fieldset className="escolher-grupo" key={g.id}>
              <legend className="escolher-titulo">
                {g.nome}
                <span className="escolher-regra">{regraDoGrupo(g)}</span>
              </legend>
              {g.opcoes.map((o) => {
                const marcada = marcadas.includes(o.id);
                const bloqueada = !marcada && cheio;
                return (
                  <label key={o.id} className={bloqueada ? 'escolher-opcao escolher-opcao-bloqueada' : 'escolher-opcao'}>
                    <input
                      type={g.maximo === 1 ? 'radio' : 'checkbox'}
                      name={`grupo-${g.id}`}
                      checked={marcada}
                      disabled={bloqueada}
                      onChange={() => alternar(g, o.id)}
                    />
                    <span className="escolher-opcao-nome">{o.nome}</span>
                    {o.precoExtra > 0 && <span className="escolher-opcao-preco">+ {formatarMoeda(o.precoExtra)}</span>}
                  </label>
                );
              })}
            </fieldset>
          );
        })}

        <AreaTexto rotulo="Observação (opcional)" valor={observacao} aoMudar={setObservacao} linhas={2} />

        <div className="escolher-total">
          <span>Total do item</span>
          <span>{formatarMoeda(total)}</span>
        </div>
        {!completo && <p className="escolher-aviso">Escolha as opções obrigatórias para adicionar.</p>}

        <Botao tipo="submit" desabilitado={!completo}>
          Adicionar
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}
