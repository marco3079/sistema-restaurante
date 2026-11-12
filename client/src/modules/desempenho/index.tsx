import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import type { DesempenhoDTO } from '../../lib/restaurante';
import { Avatar, Aviso, Carregando, Pagina, Tabela, formatarMoeda } from '../../ui';
import { Indicador } from '../pedidos/comum';

const PERIODOS: { dias: number; rotulo: string }[] = [
  { dias: 1, rotulo: 'Hoje' },
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];

function formas(porForma: Record<string, number>): string {
  const partes = Object.entries(porForma)
    .sort((a, b) => b[1] - a[1])
    .map(([forma, valor]) => `${forma}: ${formatarMoeda(valor)}`);
  return partes.length > 0 ? partes.join(' · ') : '—';
}

// Desempenho dos garçons: pedidos atendidos e contas recebidas (com e sem maquineta) no período.
export function Desempenho() {
  const [dias, setDias] = useState(30);
  const dados = useDados<DesempenhoDTO>(`/desempenho?dias=${dias}`);
  const d = dados.dados;
  const melhor = d?.garcons.find((g) => g.valorRecebido > 0);

  return (
    <Pagina titulo="Desempenho dos garçons">
      <div className="barra-ferramentas">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              className="segmentado-item"
              aria-pressed={dias === p.dias}
              onClick={() => setDias(p.dias)}
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
            <Indicador rotulo="Recebido no período" valor={formatarMoeda(d.totais.valorRecebido)} cor="azul" icone="financeiro" />
            <Indicador rotulo="Contas recebidas" valor={String(d.totais.contasRecebidas)} cor="verde" icone="visto" />
            <Indicador rotulo="Taxa de serviço" valor={formatarMoeda(d.totais.taxaServico)} cor="roxo" icone="estrela" />
            <Indicador rotulo="Gorjetas" valor={formatarMoeda(d.totais.gorjetas)} cor="verde" icone="financeiro" />
            <Indicador rotulo="Pedidos atendidos" valor={String(d.totais.pedidosAtendidos)} cor="roxo" icone="pedidos" />
            <Indicador rotulo="Quem mais recebeu" valor={melhor?.usuario.nome ?? '—'} cor="laranja" icone="estrela" />
          </div>

          <Tabela
            dados={d.garcons}
            chave={(g) => g.usuario.id}
            vazio="Nenhum garçom com movimento neste período."
            colunas={[
              {
                titulo: 'Garçom',
                celula: (g) => (
                  <span className="produto-celula">
                    <Avatar nome={g.usuario.nome} foto={g.usuario.foto} />
                    <span className="produto-texto">
                      <span className="produto-nome">{g.usuario.nome}</span>
                      <span className="produto-descricao">
                        {g.usuario.perfil === 'GESTOR' ? 'Gestor' : 'Garçom'}
                        {g.usuario.ativo ? '' : ' · desativado'}
                      </span>
                    </span>
                  </span>
                ),
              },
              { titulo: 'Pedidos atendidos', alinhar: 'direita', celula: (g) => String(g.pedidosAtendidos) },
              {
                titulo: 'Vendas nos pedidos',
                alinhar: 'direita',
                celula: (g) => <span className="sem-quebra">{formatarMoeda(g.vendasNosPedidos)}</span>,
              },
              { titulo: 'Contas recebidas', alinhar: 'direita', celula: (g) => String(g.contasRecebidas) },
              {
                titulo: 'Valor recebido',
                alinhar: 'direita',
                celula: (g) => (
                  <strong className="sem-quebra">{formatarMoeda(g.valorRecebido)}</strong>
                ),
              },
              {
                titulo: 'Taxa de serviço',
                alinhar: 'direita',
                celula: (g) => <span className="sem-quebra">{formatarMoeda(g.taxaServico)}</span>,
              },
              {
                titulo: 'Gorjetas',
                alinhar: 'direita',
                celula: (g) => <span className="sem-quebra">{formatarMoeda(g.gorjetas)}</span>,
              },
              {
                titulo: 'Na maquineta',
                alinhar: 'direita',
                celula: (g) => <span className="sem-quebra">{formatarMoeda(g.recebidoNaMaquineta)}</span>,
              },
              {
                titulo: 'Média por conta',
                alinhar: 'direita',
                celula: (g) => <span className="sem-quebra">{formatarMoeda(g.valorMedioPorConta)}</span>,
              },
              { titulo: 'Por forma de pagamento', celula: (g) => formas(g.porForma) },
            ]}
          />
          <Aviso tipo="info">
            "Pedidos atendidos" conta os pedidos que a pessoa lançou ou assumiu. "Valor recebido" conta as contas que ela
            recebeu: no modo em que cada garçom tem a sua maquineta, vale o dono da maquineta; no modo compartilhado,
            vale quem cobrou. "Taxa de serviço" é a parte da taxa dentro do valor recebido; "Gorjetas" é o que o
            cliente deu além da conta. As duas contam para quem recebeu.
          </Aviso>
        </>
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/desempenho',
    rotulo: 'Desempenho',
    icone: 'grafico',
    perfis: ['GESTOR'],
    elemento: <Desempenho />,
    ordem: 41,
  },
];
