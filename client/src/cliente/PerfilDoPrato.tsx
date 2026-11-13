import type { ReactNode } from 'react';
import { NUTRIENTES, listaDeIngredientes } from '../lib/restaurante';
import type { FichaProduto } from '../lib/restaurante';
import { Modal, Selo, formatarMoeda } from '../ui';
import { Icone } from '../ui/icones';
import { textos } from './textos';
import type { Idioma } from './textos';
import './cliente.css';

// Perfil do prato: foto, apresentação, porção, tempo, alergênicos, ingredientes e tabela nutricional.
// O cliente abre tocando no item do cardápio; a equipe abre pela tela de Cardápio.
// Com `aoEscolher`, mostra também as opções do prato (grupos) para o cliente escolher.

export interface OpcaoDoPrato {
  id: number;
  nome: string;
  precoExtra: number;
}

export interface GrupoDoPrato {
  id: number;
  nome: string;
  minimo: number;
  maximo: number;
  opcoes: OpcaoDoPrato[];
}

export interface ComboItemDoPrato {
  nome: string;
  quantidade: number;
}

export interface PratoDoPerfil extends FichaProduto {
  nome: string;
  descricao: string;
  preco: number;
  imagem: string | null;
  disponivel: boolean;
  // Promoção, combo e opções: opcionais, porque nem toda tela recebe todos.
  precoOriginal?: number | null;
  promocao?: string | null;
  combo?: boolean;
  comboItens?: ComboItemDoPrato[];
  grupos?: GrupoDoPrato[];
}

// Grupos que têm opções de verdade (sem opção, o grupo não aparece para escolher).
export function gruposComOpcoes(prato: PratoDoPerfil): GrupoDoPrato[] {
  return (prato.grupos ?? []).filter((g) => g.opcoes.length > 0);
}

// Soma dos acréscimos das opções escolhidas, em reais (duas casas).
export function somaDasOpcoes(grupos: GrupoDoPrato[], escolhidas: number[]): number {
  const ids = new Set(escolhidas);
  let centavos = 0;
  for (const grupo of grupos) {
    for (const opcao of grupo.opcoes) {
      if (ids.has(opcao.id)) centavos += Math.round(opcao.precoExtra * 100);
    }
  }
  return centavos / 100;
}

// Primeiro grupo que ainda não tem o mínimo de escolhas; null se tudo está ok.
export function grupoPendente(grupos: GrupoDoPrato[], escolhidas: number[]): GrupoDoPrato | null {
  const ids = new Set(escolhidas);
  return grupos.find((g) => g.opcoes.filter((o) => ids.has(o.id)).length < g.minimo) ?? null;
}

// Preço com promoção: o preço atual em destaque, o original riscado e a etiqueta da promoção.
export function PrecoDoPrato({
  preco,
  precoOriginal,
  promocao,
  idioma = 'pt',
  classe,
}: {
  preco: number;
  precoOriginal?: number | null;
  promocao?: string | null;
  idioma?: Idioma;
  classe: string;
}) {
  const t = textos(idioma);
  const emPromocao = precoOriginal !== null && precoOriginal !== undefined && precoOriginal > preco;
  return (
    <span className="preco-bloco">
      <span className={classe}>{formatarMoeda(preco)}</span>
      {emPromocao && (
        <>
          <s className="preco-original">{formatarMoeda(precoOriginal)}</s>
          <span className="preco-promocao">{promocao || t.promocao}</span>
        </>
      )}
    </span>
  );
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

export function PerfilDoPrato({
  prato,
  aoFechar,
  rodape,
  idioma = 'pt',
  escolhidas,
  aoEscolher,
}: {
  prato: PratoDoPerfil;
  aoFechar: () => void;
  rodape?: ReactNode;
  idioma?: Idioma;
  escolhidas?: number[];
  aoEscolher?: (ids: number[]) => void;
}) {
  const t = textos(idioma);
  const ingredientes = listaDeIngredientes(prato.ingredientes);
  const linhas = prato.nutricao
    ? NUTRIENTES.flatMap((n) => {
        const valor = prato.nutricao?.[n.chave];
        return valor === null || valor === undefined ? [] : [{ ...n, valor }];
      })
    : [];
  const grupos = gruposComOpcoes(prato);
  const escolhendo = aoEscolher !== undefined && grupos.length > 0;
  const selecionadas = escolhidas ?? [];
  const pendente = escolhendo ? grupoPendente(grupos, selecionadas) : null;
  const comboItens = prato.comboItens ?? [];
  const semFicha =
    !prato.detalhes && ingredientes.length === 0 && linhas.length === 0 && !prato.porcao && !prato.alergenicos;

  // Marca ou desmarca uma opção respeitando o máximo do grupo (no máximo 1, troca a escolha).
  function alternar(grupo: GrupoDoPrato, opcao: OpcaoDoPrato, marcado: boolean) {
    if (!aoEscolher) return;
    const ids = new Set(selecionadas);
    if (grupo.maximo === 1) {
      for (const o of grupo.opcoes) ids.delete(o.id);
      if (marcado) ids.add(opcao.id);
    } else if (marcado) {
      const noGrupo = grupo.opcoes.filter((o) => ids.has(o.id)).length;
      if (noGrupo >= grupo.maximo) return;
      ids.add(opcao.id);
    } else {
      ids.delete(opcao.id);
    }
    aoEscolher(Array.from(ids));
  }

  return (
    <Modal aberto titulo={prato.nome} aoFechar={aoFechar}>
      <div className="prato">
        {prato.imagem && <img className="prato-foto" src={prato.imagem} alt={t.fotoDe(prato.nome)} />}

        <div className="prato-topo">
          <PrecoDoPrato
            preco={prato.preco}
            precoOriginal={prato.precoOriginal}
            promocao={prato.promocao}
            idioma={idioma}
            classe="prato-preco"
          />
          {prato.combo && <Selo cor="azul">{t.combo}</Selo>}
          {!prato.disponivel && <Selo cor="amarelo">{t.esgotado}</Selo>}
        </div>

        {prato.descricao && <p className="prato-resumo">{prato.descricao}</p>}
        {prato.detalhes && <p className="prato-detalhes">{prato.detalhes}</p>}

        {prato.combo && comboItens.length > 0 && (
          <section>
            <h3 className="prato-titulo">{t.comboInclui}</h3>
            <ul className="prato-combo">
              {comboItens.map((item, i) => (
                <li key={i}>{t.quantidadeX(item.quantidade, item.nome)}</li>
              ))}
            </ul>
          </section>
        )}

        {escolhendo && (
          <section className="prato-opcoes" aria-label={t.opcoes}>
            <h3 className="prato-titulo">{t.opcoes}</h3>
            {grupos.map((grupo) => {
              const marcadasNoGrupo = grupo.opcoes.filter((o) => selecionadas.includes(o.id)).length;
              const radio = grupo.maximo === 1;
              return (
                <fieldset key={grupo.id} className="prato-grupo">
                  <legend className="prato-grupo-titulo">
                    <span>{grupo.nome}</span>
                    <span className="prato-grupo-regra">{t.regraGrupo(grupo.minimo, grupo.maximo)}</span>
                  </legend>
                  {grupo.opcoes.map((opcao) => {
                    const marcada = selecionadas.includes(opcao.id);
                    const cheia = !radio && !marcada && marcadasNoGrupo >= grupo.maximo;
                    return (
                      <label key={opcao.id} className={cheia ? 'prato-opcao prato-opcao-cheia' : 'prato-opcao'}>
                        <input
                          type={radio ? 'radio' : 'checkbox'}
                          name={`grupo-${grupo.id}`}
                          checked={marcada}
                          disabled={cheia}
                          onChange={(e) => alternar(grupo, opcao, e.target.checked)}
                        />
                        <span className="prato-opcao-nome">{opcao.nome}</span>
                        {opcao.precoExtra > 0 && (
                          <span className="prato-opcao-preco">{t.acrescimo(formatarMoeda(opcao.precoExtra))}</span>
                        )}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
            {pendente && (
              <p className="prato-falta" aria-live="polite">
                {t.faltaEscolher(pendente.nome)}
              </p>
            )}
            <p className="prato-total-item">
              {t.totalDoItem(formatarMoeda(prato.preco + somaDasOpcoes(grupos, selecionadas)))}
            </p>
          </section>
        )}

        {(prato.porcao || prato.tempoPreparoMin !== null) && (
          <ul className="prato-fatos">
            {prato.porcao && (
              <li>
                <Icone nome="cardapio" tamanho={18} />
                <span>
                  <strong>{t.porcao}</strong>
                  {prato.porcao}
                </span>
              </li>
            )}
            {prato.tempoPreparoMin !== null && (
              <li>
                <Icone nome="relogio" tamanho={18} />
                <span>
                  <strong>{t.preparo}</strong>
                  {t.tempoPreparo(prato.tempoPreparoMin)}
                </span>
              </li>
            )}
          </ul>
        )}

        {prato.alergenicos && (
          <p className="prato-alergenicos">
            <strong>{t.alergenicos}</strong> {prato.alergenicos}
          </p>
        )}

        {ingredientes.length > 0 && (
          <section>
            <h3 className="prato-titulo">{t.ingredientes}</h3>
            <ul className="prato-ingredientes">
              {ingredientes.map((ingrediente) => (
                <li key={ingrediente}>{ingrediente}</li>
              ))}
            </ul>
          </section>
        )}

        {linhas.length > 0 && (
          <section>
            <h3 className="prato-titulo">{t.tabelaNutricional}</h3>
            <table className="prato-tabela">
              <caption>{t.valoresPorcao(prato.porcao)}</caption>
              <tbody>
                {linhas.map((linha) => (
                  <tr key={linha.chave} className={linha.sub ? 'prato-tabela-sub' : undefined}>
                    <th scope="row">{linha.rotulo}</th>
                    <td>
                      {formatarNumero(linha.valor)} {linha.unidade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="prato-nota">{t.valoresAproximados}</p>
          </section>
        )}

        {semFicha && <p className="prato-nota">{t.semFicha}</p>}

        {rodape && <div className="prato-rodape">{rodape}</div>}
      </div>
    </Modal>
  );
}
