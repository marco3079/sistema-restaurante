import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { AtualizacaoDTO } from '../lib/atualizacao';
import { RAIZ_DO_PERFIL } from '../lib/tipos';
import type { Perfil } from '../lib/tipos';
import { useDados } from '../lib/useDados';
import { Aviso, Carregando, formatarData } from '../ui';
import { Icone } from '../ui/icones';
import type { NomeIcone } from '../ui/icones';
import { GraficoLinha } from './GraficoLinha';
import './painel.css';

// ---------- Contrato de GET /api/painel/resumo ----------

type CorCartao = 'azul' | 'roxo' | 'verde' | 'laranja';

interface CartaoIndicador {
  chave: string;
  rotulo: string;
  valor: string;
  icone: NomeIcone;
  cor: CorCartao;
  variacao: number | null;
}

interface PontoDesempenho {
  mes: string;
  rotulo: string;
  valor: number | null;
}

interface Destaque {
  etiqueta: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

interface RespostaResumo {
  primeiroNome: string;
  cartoes: CartaoIndicador[];
  desempenho: PontoDesempenho[];
  destaque: Destaque | null;
  recentes: PedidoRecente[];
}

interface PedidoRecente {
  id: number;
  titulo: string;
  corpo: string;
  valor: string;
  criadoEm: string;
}

// ---------- Atalhos por perfil ----------

interface Atalho {
  rotulo: string;
  icone: NomeIcone;
  caminho: string;
}

const ATALHOS_GESTOR: Atalho[] = [
  { rotulo: 'Ver pedidos', icone: 'pedidos', caminho: '/gestor/pedidos' },
  { rotulo: 'Mesas e contas', icone: 'mesas', caminho: '/gestor/mesas' },
  { rotulo: 'Salão e planta', icone: 'grade', caminho: '/gestor/salao' },
  { rotulo: 'Maquinetas', icone: 'financeiro', caminho: '/gestor/maquinetas' },
  { rotulo: 'Desempenho', icone: 'grafico', caminho: '/gestor/desempenho' },
  { rotulo: 'Editar cardápio', icone: 'cardapio', caminho: '/gestor/cardapio' },
  { rotulo: 'Equipe', icone: 'usuarios', caminho: '/gestor/usuarios' },
  { rotulo: 'Atividades', icone: 'atividade', caminho: '/gestor/atividades' },
  { rotulo: 'Configurações', icone: 'engrenagem', caminho: '/gestor/configuracoes' },
];

const ATALHOS_GARCOM: Atalho[] = [
  { rotulo: 'Ver pedidos', icone: 'pedidos', caminho: '/garcom/pedidos' },
  { rotulo: 'Mesas e contas', icone: 'mesas', caminho: '/garcom/mesas' },
  { rotulo: 'Salão', icone: 'grade', caminho: '/garcom/salao' },
  { rotulo: 'Cardápio', icone: 'cardapio', caminho: '/garcom/cardapio' },
  { rotulo: 'Meu perfil', icone: 'perfil', caminho: '/garcom/perfil' },
];

const ATALHOS_COZINHA: Atalho[] = [
  { rotulo: 'Fila de pedidos', icone: 'pedidos', caminho: '/cozinha/pedidos' },
  { rotulo: 'Marcar item esgotado', icone: 'cardapio', caminho: '/cozinha/cardapio' },
  { rotulo: 'Meu perfil', icone: 'perfil', caminho: '/cozinha/perfil' },
];

const ATALHOS_LIMPEZA: Atalho[] = [
  { rotulo: 'Mesas para limpar', icone: 'mesas', caminho: '/limpeza/mesas' },
  { rotulo: 'Meu perfil', icone: 'perfil', caminho: '/limpeza/perfil' },
];

const ATALHOS_RECEPCAO: Atalho[] = [
  { rotulo: 'Ver mesas', icone: 'mesas', caminho: '/recepcao/mesas' },
  { rotulo: 'Meu perfil', icone: 'perfil', caminho: '/recepcao/perfil' },
];

function atalhosDoPerfil(perfil: Perfil | undefined): Atalho[] {
  if (perfil === 'LIMPEZA') return ATALHOS_LIMPEZA;
  if (perfil === 'RECEPCAO') return ATALHOS_RECEPCAO;
  if (perfil === 'COZINHA') return ATALHOS_COZINHA;
  if (perfil === 'GESTOR') return ATALHOS_GESTOR;
  if (perfil === 'GARCOM') return ATALHOS_GARCOM;
  return [];
}

function prefixoDoPerfil(perfil: Perfil | undefined): string {
  return perfil ? RAIZ_DO_PERFIL[perfil] : '/gestor';
}

// ---------- Formatação ----------

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CORES_AVISOS: CorCartao[] = ['azul', 'roxo', 'verde'];
const PERIODOS: { valor: number; rotulo: string }[] = [
  { valor: 3, rotulo: 'Últimos 3 meses' },
  { valor: 6, rotulo: 'Últimos 6 meses' },
  { valor: 12, rotulo: 'Últimos 12 meses' },
];

function dataPorExtenso(d: Date): string {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function horaCurta(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function tempoRelativo(iso: string, agora: Date): string {
  const diferenca = agora.getTime() - new Date(iso).getTime();
  if (Number.isNaN(diferenca)) return '';
  const minutos = Math.floor(diferenca / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  return formatarData(iso);
}

function formatarVariacao(variacao: number): string {
  const sinal = variacao >= 0 ? '+' : '-';
  const numero = Math.abs(variacao).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${sinal}${numero}%`;
}

function primeiroNomeDe(nome: string | undefined): string {
  return nome?.trim().split(/\s+/)[0] ?? '';
}

// ---------- Tela inicial ----------

export function Painel() {
  const { usuario } = useAuth();
  const resumo = useDados<RespostaResumo>('/painel/resumo');
  const [agora, setAgora] = useState<Date>(() => new Date());
  const [periodo, setPeriodo] = useState<number>(6);

  // A cada 30 s: acerta o relógio e busca os números de novo (só com a aba visível).
  const { recarregar } = resumo;
  useEffect(() => {
    const id = window.setInterval(() => {
      setAgora(new Date());
      if (document.visibilityState === 'visible') recarregar();
    }, 30000);
    return () => window.clearInterval(id);
  }, [recarregar]);

  const dados = resumo.dados;
  const primeiroNome = dados?.primeiroNome || primeiroNomeDe(usuario?.nome);
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!';
  const prefixo = prefixoDoPerfil(usuario?.perfil);
  const atalhos = atalhosDoPerfil(usuario?.perfil);
  // O gráfico de vendas é só do gestor; sem ele, a linha fica com duas colunas.
  const gestor = usuario?.perfil === 'GESTOR';
  // Aviso de atualização só para o gestor. Erro nessa consulta é ignorado.
  const atualizacao = useDados<AtualizacaoDTO>(gestor ? '/atualizacao' : null);
  // Limpeza e recepção não veem pedidos: o painel delas fica só com o destaque e os atalhos.
  const semPedidos = usuario?.perfil === 'LIMPEZA' || usuario?.perfil === 'RECEPCAO';

  const pontos = dados ? dados.desempenho.slice(-periodo) : [];
  const temVenda = pontos.some((p) => p.valor !== null);

  const avisos = dados?.recentes ?? [];

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <div className="painel-boas-vindas">
          <h1 className="painel-saudacao">{saudacao}</h1>
          <p className="painel-subtitulo">Aqui está um resumo do restaurante.</p>
          <span className="painel-traco" aria-hidden="true" />
        </div>
        <div className="painel-relogio">
          <p className="painel-data">
            <Icone nome="calendario" tamanho={18} />
            <span>{dataPorExtenso(agora)}</span>
          </p>
          <p className="painel-hora">{horaCurta(agora)}</p>
        </div>
      </div>

      {resumo.carregando && !dados && <Carregando />}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {atualizacao.dados?.ativo === true &&
        atualizacao.dados.pendentes.length > 0 &&
        atualizacao.dados.tarefa.estado !== 'RODANDO' && (
          <Aviso tipo="info">
            Há uma atualização do sistema (
            {atualizacao.dados.pendentes.length === 1
              ? '1 novidade'
              : `${atualizacao.dados.pendentes.length} novidades`}
            ).{' '}
            <Link to="/gestor/configuracoes?aba=atualizacao">Ver e atualizar</Link>
          </Aviso>
        )}
      {dados && (
        <div className="painel-indicadores">
          {dados.cartoes.map((c) => (
            <article key={c.chave} className="painel-indicador">
              <div className={`painel-indicador-icone painel-cor-${c.cor}`}>
                <Icone nome={c.icone} tamanho={26} />
              </div>
              <div className="painel-indicador-texto">
                <span className="painel-indicador-valor">{c.valor}</span>
                <span className="painel-indicador-rotulo">{c.rotulo}</span>
              </div>
              {c.variacao !== null && (
                <span
                  className={`painel-variacao ${
                    c.variacao >= 0 ? 'painel-variacao-alta' : 'painel-variacao-baixa'
                  }`}
                >
                  <Icone nome={c.variacao >= 0 ? 'seta-cima' : 'seta-baixo'} tamanho={14} />
                  {formatarVariacao(c.variacao)}
                </span>
              )}
            </article>
          ))}
        </div>
      )}

      <div
        className={
          gestor ? 'painel-linha' : semPedidos ? 'painel-linha painel-linha-unica' : 'painel-linha painel-linha-dupla'
        }
      >
        {gestor && (
          <section className="painel-cartao painel-desempenho">
            <header className="painel-cartao-cabecalho">
              <Icone nome="grafico" tamanho={20} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Vendas por Mês</h2>
              <select
                className="painel-seletor"
                aria-label="Período do gráfico"
                value={periodo}
                disabled={!dados}
                onChange={(e) => setPeriodo(Number(e.target.value))}
              >
                {PERIODOS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
            </header>
            {resumo.carregando && !dados && <Carregando />}
            {dados &&
              (temVenda ? (
                <div className="painel-grafico-corpo">
                  <GraficoLinha pontos={pontos} />
                </div>
              ) : (
                <p className="painel-vazio">Ainda não há vendas neste período.</p>
              ))}
          </section>
        )}

        {!semPedidos && (
          <section className="painel-cartao painel-avisos">
            <header className="painel-cartao-cabecalho">
              <Icone nome="pedidos" tamanho={20} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Pedidos Recentes</h2>
              <Link className="painel-ver-todos" to={`${prefixo}/pedidos`}>
                Ver todos
                <Icone nome="seta-direita" tamanho={14} />
              </Link>
            </header>
            {resumo.carregando && !dados && <Carregando />}
            {dados && avisos.length === 0 && <p className="painel-vazio">Nenhum pedido por enquanto.</p>}
            {avisos.length > 0 && (
              <ul className="painel-avisos-lista">
                {avisos.map((c, i) => (
                  <li key={c.id} className="painel-aviso">
                    <span className={`painel-aviso-marca painel-cor-${CORES_AVISOS[i % 3]}`}>
                      <span className="painel-aviso-bolinha" />
                    </span>
                    <div className="painel-aviso-texto">
                      <span className="painel-aviso-titulo">{c.titulo}</span>
                      <span className="painel-aviso-corpo">
                        {c.valor} · {c.corpo}
                      </span>
                    </div>
                    <span className="painel-aviso-tempo">{tempoRelativo(c.criadoEm, agora)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="painel-coluna">
          {dados?.destaque && (
            <section className="painel-cartao painel-destaque">
              <div className="painel-destaque-texto">
                <span className="painel-destaque-etiqueta">
                  <Icone nome="estrela" tamanho={18} />
                  {dados.destaque.etiqueta}
                </span>
                <h2 className="painel-destaque-titulo">{dados.destaque.titulo}</h2>
                <p className="painel-destaque-subtitulo">{dados.destaque.subtitulo}</p>
                <Link className="painel-pilula" to={dados.destaque.caminho}>
                  Ver detalhes
                  <Icone nome="seta-direita" tamanho={14} />
                </Link>
              </div>
            </section>
          )}

          <section className="painel-cartao painel-atalhos">
            <header className="painel-cartao-cabecalho">
              <Icone nome="raio" tamanho={18} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Atalhos Rápidos</h2>
            </header>
            <div className="painel-atalhos-grade">
              {atalhos.map((a) => (
                <Link key={a.rotulo} to={a.caminho} className="painel-atalho">
                  <Icone nome={a.icone} tamanho={22} />
                  <span>{a.rotulo}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
