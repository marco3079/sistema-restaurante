import { AreaTexto, Campo } from '../../ui';

// Campo que pode ser traduzido. Com `linhas`, vira área de texto.
export interface CampoTraducao {
  chave: string;
  rotulo: string;
  linhas?: number;
}

export type IdiomaTraducao = 'en' | 'es';

// Textos digitados por idioma: chave do campo -> texto (vazio = usa o português).
export type RascunhoTraducoes = Record<IdiomaTraducao, Record<string, string>>;

const IDIOMAS: { id: IdiomaTraducao; rotulo: string }[] = [
  { id: 'en', rotulo: 'Inglês' },
  { id: 'es', rotulo: 'Espanhol' },
];

// Preenche o rascunho com as traduções que já existem no cadastro.
export function rascunhoTraducoes(
  campos: CampoTraducao[],
  origem: { en?: object; es?: object } | null | undefined,
): RascunhoTraducoes {
  const rascunho = { en: {}, es: {} } as RascunhoTraducoes;
  for (const idioma of IDIOMAS) {
    const dados = (origem?.[idioma.id] ?? {}) as Record<string, string | undefined>;
    for (const campo of campos) {
      rascunho[idioma.id][campo.chave] = dados[campo.chave] ?? '';
    }
  }
  return rascunho;
}

// Monta o objeto que vai para a API: só idiomas e campos preenchidos. Sem nada → null.
export function montarTraducoes(
  campos: CampoTraducao[],
  rascunho: RascunhoTraducoes,
): Record<string, Record<string, string>> | null {
  const saida: Record<string, Record<string, string>> = {};
  for (const idioma of IDIOMAS) {
    const bloco: Record<string, string> = {};
    for (const campo of campos) {
      const texto = rascunho[idioma.id][campo.chave].trim();
      if (texto) bloco[campo.chave] = texto;
    }
    if (Object.keys(bloco).length > 0) saida[idioma.id] = bloco;
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

// Troca um campo de um idioma no rascunho (sem mexer no outro idioma).
export function mudarTraducao(
  atual: RascunhoTraducoes,
  idioma: IdiomaTraducao,
  chave: string,
  texto: string,
): RascunhoTraducoes {
  const bloco = { ...atual[idioma], [chave]: texto };
  return idioma === 'en' ? { ...atual, en: bloco } : { ...atual, es: bloco };
}

// Inglês e espanhol, cada um recolhível, com os campos informados.
export function Traducoes({
  campos,
  valor,
  aoMudar,
}: {
  campos: CampoTraducao[];
  valor: RascunhoTraducoes;
  aoMudar: (idioma: IdiomaTraducao, chave: string, texto: string) => void;
}) {
  return (
    <>
      <p className="cardapio-ajuda">Campo vazio usa o texto em português.</p>
      {IDIOMAS.map((idioma) => (
        <details key={idioma.id} className="cardapio-detalhes">
          <summary>{idioma.rotulo}</summary>
          <div className="cardapio-detalhes-corpo">
            {campos.map((campo) =>
              campo.linhas ? (
                <AreaTexto
                  key={campo.chave}
                  rotulo={campo.rotulo}
                  valor={valor[idioma.id][campo.chave] ?? ''}
                  aoMudar={(texto) => aoMudar(idioma.id, campo.chave, texto)}
                  linhas={campo.linhas}
                />
              ) : (
                <Campo
                  key={campo.chave}
                  rotulo={campo.rotulo}
                  valor={valor[idioma.id][campo.chave] ?? ''}
                  aoMudar={(texto) => aoMudar(idioma.id, campo.chave, texto)}
                />
              ),
            )}
          </div>
        </details>
      ))}
    </>
  );
}
