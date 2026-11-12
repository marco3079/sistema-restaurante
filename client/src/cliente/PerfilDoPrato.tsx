import type { ReactNode } from 'react';
import { NUTRIENTES, listaDeIngredientes } from '../lib/restaurante';
import type { FichaProduto } from '../lib/restaurante';
import { Modal, Selo, formatarMoeda } from '../ui';
import { Icone } from '../ui/icones';
import './cliente.css';

// Perfil do prato: foto, apresentação, porção, tempo, alergênicos, ingredientes e tabela nutricional.
// O cliente abre tocando no item do cardápio; a equipe abre pela tela de Cardápio.

export interface PratoDoPerfil extends FichaProduto {
  nome: string;
  descricao: string;
  preco: number;
  imagem: string | null;
  disponivel: boolean;
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

export function PerfilDoPrato({
  prato,
  aoFechar,
  rodape,
}: {
  prato: PratoDoPerfil;
  aoFechar: () => void;
  rodape?: ReactNode;
}) {
  const ingredientes = listaDeIngredientes(prato.ingredientes);
  const linhas = prato.nutricao
    ? NUTRIENTES.flatMap((n) => {
        const valor = prato.nutricao?.[n.chave];
        return valor === null || valor === undefined ? [] : [{ ...n, valor }];
      })
    : [];
  const semFicha =
    !prato.detalhes && ingredientes.length === 0 && linhas.length === 0 && !prato.porcao && !prato.alergenicos;

  return (
    <Modal aberto titulo={prato.nome} aoFechar={aoFechar}>
      <div className="prato">
        {prato.imagem && <img className="prato-foto" src={prato.imagem} alt={`Foto de ${prato.nome}`} />}

        <div className="prato-topo">
          <span className="prato-preco">{formatarMoeda(prato.preco)}</span>
          {!prato.disponivel && <Selo cor="amarelo">Esgotado</Selo>}
        </div>

        {prato.descricao && <p className="prato-resumo">{prato.descricao}</p>}
        {prato.detalhes && <p className="prato-detalhes">{prato.detalhes}</p>}

        {(prato.porcao || prato.tempoPreparoMin !== null) && (
          <ul className="prato-fatos">
            {prato.porcao && (
              <li>
                <Icone nome="cardapio" tamanho={18} />
                <span>
                  <strong>Porção</strong>
                  {prato.porcao}
                </span>
              </li>
            )}
            {prato.tempoPreparoMin !== null && (
              <li>
                <Icone nome="relogio" tamanho={18} />
                <span>
                  <strong>Preparo</strong>
                  cerca de {prato.tempoPreparoMin} min
                </span>
              </li>
            )}
          </ul>
        )}

        {prato.alergenicos && (
          <p className="prato-alergenicos">
            <strong>Alergênicos:</strong> {prato.alergenicos}
          </p>
        )}

        {ingredientes.length > 0 && (
          <section>
            <h3 className="prato-titulo">Ingredientes</h3>
            <ul className="prato-ingredientes">
              {ingredientes.map((ingrediente) => (
                <li key={ingrediente}>{ingrediente}</li>
              ))}
            </ul>
          </section>
        )}

        {linhas.length > 0 && (
          <section>
            <h3 className="prato-titulo">Tabela nutricional</h3>
            <table className="prato-tabela">
              <caption>{prato.porcao ? `Valores da porção: ${prato.porcao}` : 'Valores da porção'}</caption>
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
            <p className="prato-nota">Valores aproximados, que podem variar conforme o preparo.</p>
          </section>
        )}

        {semFicha && <p className="prato-nota">Este item ainda não tem ficha com ingredientes e tabela nutricional.</p>}

        {rodape && <div className="prato-rodape">{rodape}</div>}
      </div>
    </Modal>
  );
}
