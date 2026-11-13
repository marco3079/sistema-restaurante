import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { formatarNota } from '../../lib/avaliacoes';
import type { AvaliacoesDTO } from '../../lib/avaliacoes';
import { Aviso, Cartao, Carregando, Pagina, Tabela, formatarDataHora } from '../../ui';
import { Indicador } from '../pedidos/comum';
import './avaliacoes.css';

type PeriodoId = 'hoje' | 'sete' | 'trinta' | 'mes';

const PERIODOS: { id: PeriodoId; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'sete', rotulo: '7 dias' },
  { id: 'trinta', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
];

// Dia no formato AAAA-MM-DD, pelo relógio do navegador.
function paraDia(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Intervalo do período escolhido (de e até incluídos; até = hoje).
function intervaloDoPeriodo(periodo: PeriodoId, agora: Date = new Date()): { de: string; ate: string } {
  const ate = paraDia(agora);
  const diasAtras = (n: number) => new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - n);
  switch (periodo) {
    case 'hoje':
      return { de: ate, ate };
    case 'sete':
      return { de: paraDia(diasAtras(6)), ate };
    case 'trinta':
      return { de: paraDia(diasAtras(29)), ate };
    case 'mes':
      return { de: paraDia(new Date(agora.getFullYear(), agora.getMonth(), 1)), ate };
  }
}

// Barras das cinco notas de uma das duas notas. Cada barra leva o número escrito e o título diz de qual nota é.
function NotasEmBarras({
  titulo,
  distribuicao,
  campo,
}: {
  titulo: string;
  distribuicao: AvaliacoesDTO['distribuicao'];
  campo: 'comida' | 'atendimento';
}) {
  const maior = Math.max(1, ...distribuicao.map((d) => d[campo]));
  return (
    <div>
      <h3 className="avaliacoes-serie-titulo">{titulo}</h3>
      {[5, 4, 3, 2, 1].map((nota) => {
        const quantidade = distribuicao.find((d) => d.nota === nota)?.[campo] ?? 0;
        const largura = Math.round((quantidade / maior) * 100);
        return (
          <div className="avaliacoes-barra-linha" key={nota}>
            <span className="avaliacoes-barra-rotulo">{nota} ★</span>
            <div className="avaliacoes-barra-trilho" aria-hidden="true">
              <div className="avaliacoes-barra-preench" style={{ width: `${largura}%` }} />
            </div>
            <span className="avaliacoes-barra-valor">{quantidade}</span>
          </div>
        );
      })}
    </div>
  );
}

// Avaliações que os clientes fazem pelo cardápio da mesa depois de pagar.
export function Avaliacoes() {
  const [periodo, setPeriodo] = useState<PeriodoId>('trinta');
  const { de, ate } = intervaloDoPeriodo(periodo);
  const dados = useDados<AvaliacoesDTO>(`/avaliacoes?de=${de}&ate=${ate}`);
  const d = dados.dados;

  return (
    <Pagina titulo="Avaliações dos clientes">
      <div className="barra-ferramentas">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="segmentado-item"
              aria-pressed={periodo === p.id}
              onClick={() => setPeriodo(p.id)}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>

      {dados.erro && <Aviso tipo="erro">{dados.erro}</Aviso>}
      {dados.carregando && !d && <Carregando />}

      {d && (
        <>
          <div className="resumo">
            <Indicador rotulo="Avaliações" valor={String(d.resumo.total)} cor="azul" icone="comentario" />
            <Indicador rotulo="Comida" valor={formatarNota(d.resumo.mediaComida)} cor="laranja" icone="estrela" />
            <Indicador rotulo="Atendimento" valor={formatarNota(d.resumo.mediaAtendimento)} cor="verde" icone="estrela" />
          </div>

          {d.resumo.total === 0 ? (
            <Aviso tipo="info">
              Ainda não há avaliações neste período. O cliente avalia pelo cardápio da mesa, depois de pagar.
            </Aviso>
          ) : (
            <>
              <Cartao titulo="Notas">
                <div className="avaliacoes-notas">
                  <NotasEmBarras titulo="Comida" distribuicao={d.distribuicao} campo="comida" />
                  <NotasEmBarras titulo="Atendimento" distribuicao={d.distribuicao} campo="atendimento" />
                </div>
              </Cartao>

              <Cartao titulo="Atendimento por garçom">
                <Tabela
                  dados={d.porGarcom}
                  chave={(g) => g.garcom.id}
                  vazio="Nenhum garçom avaliado no período."
                  colunas={[
                    { titulo: 'Garçom', celula: (g) => g.garcom.nome },
                    { titulo: 'Avaliações', alinhar: 'direita', celula: (g) => String(g.total) },
                    {
                      titulo: 'Média',
                      alinhar: 'direita',
                      celula: (g) => <strong className="sem-quebra">{formatarNota(g.mediaAtendimento)}</strong>,
                    },
                  ]}
                />
              </Cartao>

              <Cartao titulo="Avaliações">
                <Tabela
                  dados={d.lista}
                  chave={(a) => a.id}
                  vazio="Nenhuma avaliação no período."
                  colunas={[
                    {
                      titulo: 'Quando',
                      celula: (a) => <span className="sem-quebra">{formatarDataHora(a.criadoEm)}</span>,
                    },
                    {
                      titulo: 'Mesa',
                      celula: (a) => (a.mesa.nome ? `Mesa ${a.mesa.numero} · ${a.mesa.nome}` : `Mesa ${a.mesa.numero}`),
                    },
                    { titulo: 'Garçom', celula: (a) => a.garcom?.nome ?? '—' },
                    { titulo: 'Comida', celula: (a) => <span className="sem-quebra">{`${a.notaComida} ★`}</span> },
                    {
                      titulo: 'Atendimento',
                      celula: (a) => <span className="sem-quebra">{`${a.notaAtendimento} ★`}</span>,
                    },
                    { titulo: 'Comentário', celula: (a) => a.comentario ?? '—' },
                  ]}
                />
              </Cartao>
            </>
          )}
        </>
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/avaliacoes',
    rotulo: 'Avaliações',
    icone: 'estrela',
    perfis: ['GESTOR'],
    elemento: <Avaliacoes />,
    ordem: 44,
    grupo: 'Equipe',
  },
];
