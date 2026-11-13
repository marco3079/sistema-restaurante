import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import type { Perfil } from '../../lib/tipos';
import { NOME_DO_PERFIL } from '../../lib/tipos';
import { horaCurta, mensagemErro } from '../../lib/restaurante';
import {
  deCampoDataHora,
  diaTexto,
  diasDaSemanaTexto,
  formatarDiaCurto,
  formatarMinutos,
  hojeTexto,
  horaValida,
  inicioDaSemanaTexto,
  minutosDoTurno,
  paraCampoDataHora,
  siglaDoDia,
  somarDiasTexto,
} from '../../lib/escala';
import type { EscalaDTO, PessoaEscala, PontoDTO, PontoListaDTO, PontoMeuDTO, TurnoDTO } from '../../lib/escala';
import {
  Abas,
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
} from '../../ui';
import { Indicador } from '../pedidos/comum';
import './escala.css';

// ---------- Utilitários de arquivo ----------

// Planilha para o contador: ponto e vírgula e BOM, como no fiscal.
function baixarPlanilhaPonto(registros: PontoDTO[]) {
  const celula = (valor: string | number) => `"${String(valor).replace(/"/g, '""')}"`;
  const linhas: (string | number)[][] = [
    ['Pessoa', 'Entrada', 'Saída', 'Minutos', 'Observação'],
    ...registros.map((r) => [
      r.usuario.nome,
      formatarDataHora(r.entrada),
      r.saida ? formatarDataHora(r.saida) : 'Em aberto',
      r.minutos ?? '',
      r.observacao ?? '',
    ]),
  ];
  const texto = '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = endereco;
  link.download = `ponto-${hojeTexto()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

// ---------- Escala da semana ----------

interface EdicaoTurno {
  turno: TurnoDTO | null; // null = turno novo
  pessoa: PessoaEscala;
  data: string;
}

// Início, fim e observação de um turno (novo ou existente).
function FormularioTurno({
  edicao,
  aoFechar,
  aoSalvo,
}: {
  edicao: EdicaoTurno;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const { turno, pessoa, data } = edicao;
  const [inicio, setInicio] = useState(turno?.inicio ?? '');
  const [fim, setFim] = useState(turno?.fim ?? '');
  const [observacao, setObservacao] = useState(turno?.observacao ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!horaValida(inicio) || !horaValida(fim)) {
      setErro('Informe o início e o fim da forma 18:00.');
      return;
    }
    const corpo = { inicio, fim, observacao: observacao.trim() || null };
    setEnviando(true);
    try {
      if (turno) {
        await api.put(`/escala/${turno.id}`, corpo);
        aoSalvo('Turno atualizado.');
      } else {
        await api.post('/escala', { ...corpo, usuarioId: pessoa.id, data });
        aoSalvo('Turno adicionado.');
      }
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  async function excluir() {
    if (!turno) return;
    if (!window.confirm(`Excluir o turno de ${pessoa.nome} em ${formatarDiaCurto(data)} (${turno.inicio}–${turno.fim})? Não tem volta.`)) {
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.del(`/escala/${turno.id}`);
      aoSalvo('Turno excluído.');
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={turno ? 'Editar turno' : 'Novo turno'} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <p className="escala-formulario-info">
          {pessoa.nome} · {siglaDoDia(data)} {formatarDiaCurto(data)}
        </p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Início" tipo="time" valor={inicio} aoMudar={setInicio} obrigatorio />
        <Campo rotulo="Fim" tipo="time" valor={fim} aoMudar={setFim} obrigatorio />
        <Campo rotulo="Observação (opcional)" valor={observacao} aoMudar={setObservacao} />
        <Botao tipo="submit" desabilitado={enviando}>
          Salvar
        </Botao>{' '}
        {turno && (
          <Botao variante="perigo" desabilitado={enviando} aoClicar={excluir}>
            Excluir
          </Botao>
        )}{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

function EscalaSemana() {
  const [segunda, setSegunda] = useState(() => inicioDaSemanaTexto(hojeTexto()));
  const dias = diasDaSemanaTexto(segunda);
  const hoje = hojeTexto();
  const escala = useDados<EscalaDTO>(`/escala?de=${segunda}&ate=${dias[6]}`);
  const [edicao, setEdicao] = useState<EdicaoTurno | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiando, setCopiando] = useState(false);

  const equipe = escala.dados?.equipe ?? [];
  const turnos = escala.dados?.turnos ?? [];
  const semanaAnterior = somarDiasTexto(segunda, -7);

  function turnosDe(usuarioId: number, dia: string): TurnoDTO[] {
    return turnos.filter((t) => t.usuario.id === usuarioId && t.data === dia);
  }

  async function copiarSemanaAnterior() {
    const de = formatarDiaCurto(semanaAnterior);
    if (!window.confirm(`Copiar os turnos da semana de ${de} para esta semana? Turnos que já existem não são repetidos.`)) {
      return;
    }
    setAviso(null);
    setErro(null);
    setCopiando(true);
    try {
      const resposta = await api.post<{ copiados: number }>('/escala/copiar', {
        deSemana: semanaAnterior,
        paraSemana: segunda,
      });
      setAviso(resposta.copiados === 0 ? 'Nenhum turno novo para copiar.' : `${resposta.copiados} turno(s) copiado(s).`);
      escala.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCopiando(false);
    }
  }

  // Horas da semana por pessoa (só quem tem turno).
  const horas = equipe
    .map((p) => {
      const lista = turnos.filter((t) => t.usuario.id === p.id);
      return {
        id: p.id,
        nome: p.nome,
        perfil: p.perfil,
        quantidade: lista.length,
        minutos: lista.reduce((soma, t) => soma + minutosDoTurno(t.inicio, t.fim), 0),
      };
    })
    .filter((h) => h.quantidade > 0);

  return (
    <>
      <div className="barra-ferramentas escala-navegacao">
        <Botao variante="secundario" aoClicar={() => setSegunda(somarDiasTexto(segunda, -7))}>
          ‹ Semana anterior
        </Botao>
        <strong className="escala-titulo-semana">
          Semana de {formatarDiaCurto(dias[0])} a {formatarDiaCurto(dias[6])}
        </strong>
        <Botao variante="secundario" aoClicar={() => setSegunda(somarDiasTexto(segunda, 7))}>
          Próxima semana ›
        </Botao>
        <Botao variante="texto" aoClicar={() => setSegunda(inicioDaSemanaTexto(hoje))}>
          Hoje
        </Botao>
        <Botao variante="secundario" desabilitado={copiando} aoClicar={copiarSemanaAnterior}>
          Copiar a semana anterior para esta
        </Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {escala.erro && <Aviso tipo="erro">{escala.erro}</Aviso>}
      {escala.carregando && !escala.dados && <Carregando />}

      {escala.dados && equipe.length === 0 && (
        <p className="tabela-vazia">Nenhuma pessoa ativa na equipe.</p>
      )}

      {escala.dados && equipe.length > 0 && (
        <div className="escala-rolagem">
          <table className="escala-grade">
            <thead>
              <tr>
                <th scope="col" className="escala-coluna-nome">
                  Pessoa
                </th>
                {dias.map((d) => (
                  <th key={d} scope="col" className={d === hoje ? 'escala-hoje' : undefined}>
                    {siglaDoDia(d)} <span className="escala-data">{formatarDiaCurto(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipe.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="escala-coluna-nome">
                    <span className="escala-nome">{p.nome}</span>
                    <span className="escala-perfil">{NOME_DO_PERFIL[p.perfil]}</span>
                  </th>
                  {dias.map((d) => (
                    <td key={d} className={d === hoje ? 'escala-hoje' : undefined}>
                      <div className="escala-celula">
                        {turnosDe(p.id, d).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className="escala-turno"
                            onClick={() => setEdicao({ turno: t, pessoa: p, data: d })}
                          >
                            {t.inicio}–{t.fim}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="escala-mais"
                          aria-label={`Adicionar turno de ${p.nome} em ${formatarDiaCurto(d)}`}
                          onClick={() => setEdicao({ turno: null, pessoa: p, data: d })}
                        >
                          +
                        </button>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {escala.dados && equipe.length > 0 && (
        <Cartao titulo="Horas na escala desta semana">
          <Tabela
            dados={horas}
            chave={(h) => h.id}
            vazio="Ninguém escalado nesta semana."
            colunas={[
              {
                titulo: 'Pessoa',
                celula: (h) => (
                  <span>
                    <span className="escala-nome">{h.nome}</span>
                    <span className="escala-perfil">{NOME_DO_PERFIL[h.perfil]}</span>
                  </span>
                ),
              },
              { titulo: 'Turnos', alinhar: 'direita', celula: (h) => String(h.quantidade) },
              { titulo: 'Horas', alinhar: 'direita', celula: (h) => <strong>{formatarMinutos(h.minutos)}</strong> },
            ]}
          />
        </Cartao>
      )}

      {edicao && (
        <FormularioTurno
          edicao={edicao}
          aoFechar={() => setEdicao(null)}
          aoSalvo={(mensagem) => {
            setEdicao(null);
            setAviso(mensagem);
            setErro(null);
            escala.recarregar();
          }}
        />
      )}
    </>
  );
}

// ---------- Ponto (gestor) ----------

const PERIODOS_PONTO = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: '7dias', rotulo: '7 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mesPassado', rotulo: 'Mês passado' },
] as const;

type PeriodoPonto = (typeof PERIODOS_PONTO)[number]['id'];

function intervaloDoPeriodo(periodo: PeriodoPonto): { de: string; ate: string } {
  const hoje = hojeTexto();
  const [ano, mes] = hoje.split('-').map(Number);
  switch (periodo) {
    case 'hoje':
      return { de: hoje, ate: hoje };
    case '7dias':
      return { de: somarDiasTexto(hoje, -6), ate: hoje };
    case 'mes':
      return { de: diaTexto(new Date(ano, mes - 1, 1)), ate: hoje };
    case 'mesPassado':
      return { de: diaTexto(new Date(ano, mes - 2, 1)), ate: diaTexto(new Date(ano, mes - 1, 0)) };
  }
}

// Lançamento manual (novo) ou correção de um registro existente.
function FormularioRegistro({
  registro,
  equipe,
  aoFechar,
  aoSalvo,
}: {
  registro: PontoDTO | null;
  equipe: PessoaEscala[];
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [usuarioId, setUsuarioId] = useState(registro ? String(registro.usuario.id) : '');
  const [entrada, setEntrada] = useState(registro ? paraCampoDataHora(registro.entrada) : '');
  const [saida, setSaida] = useState(registro?.saida ? paraCampoDataHora(registro.saida) : '');
  const [observacao, setObservacao] = useState(registro?.observacao ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!registro && usuarioId === '') {
      setErro('Escolha a pessoa.');
      return;
    }
    if (entrada === '') {
      setErro('Informe a data e a hora da entrada.');
      return;
    }
    if (saida !== '' && new Date(saida).getTime() < new Date(entrada).getTime()) {
      setErro('A saída não pode ser antes da entrada.');
      return;
    }
    const corpo = {
      entrada: deCampoDataHora(entrada),
      saida: saida !== '' ? deCampoDataHora(saida) : null,
      observacao: observacao.trim() || null,
    };
    setEnviando(true);
    try {
      if (registro) {
        await api.put(`/ponto/${registro.id}`, corpo);
        aoSalvo('Registro corrigido.');
      } else {
        await api.post('/ponto', { ...corpo, usuarioId: Number(usuarioId) });
        aoSalvo('Registro lançado.');
      }
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={registro ? 'Corrigir registro' : 'Lançar registro'} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {registro ? (
          <p className="escala-formulario-info">{registro.usuario.nome}</p>
        ) : (
          <Selecao
            rotulo="Pessoa"
            valor={usuarioId}
            aoMudar={setUsuarioId}
            obrigatorio
            opcoes={equipe.map((p) => ({ valor: String(p.id), rotulo: `${p.nome} (${NOME_DO_PERFIL[p.perfil]})` }))}
          />
        )}
        <Campo rotulo="Data e hora de entrada" tipo="datetime-local" valor={entrada} aoMudar={setEntrada} obrigatorio />
        <Campo rotulo="Data e hora de saída (se já saiu)" tipo="datetime-local" valor={saida} aoMudar={setSaida} />
        <Campo rotulo="Observação (opcional)" valor={observacao} aoMudar={setObservacao} />
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

function PontoGestor() {
  const [periodo, setPeriodo] = useState<PeriodoPonto>('hoje');
  const [pessoa, setPessoa] = useState('');
  const { de, ate } = intervaloDoPeriodo(periodo);
  const caminho = `/ponto?de=${de}&ate=${ate}${pessoa !== '' ? `&usuarioId=${pessoa}` : ''}`;
  const ponto = useDados<PontoListaDTO>(caminho);
  const equipeQuery = useDados<EscalaDTO>(`/escala?de=${hojeTexto()}&ate=${hojeTexto()}`);
  const equipe = equipeQuery.dados?.equipe ?? [];
  const [formulario, setFormulario] = useState<{ registro: PontoDTO | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const registros = ponto.dados?.registros ?? [];
  const totais = ponto.dados?.totais ?? [];

  async function excluirRegistro(r: PontoDTO) {
    if (!window.confirm(`Excluir o registro de ${r.usuario.nome} de ${formatarDataHora(r.entrada)}? Não tem volta.`)) {
      return;
    }
    setAviso(null);
    setErro(null);
    try {
      await api.del(`/ponto/${r.id}`);
      setAviso('Registro excluído.');
      ponto.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  return (
    <>
      <div className="barra-ferramentas">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS_PONTO.map((p) => (
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
        <Selecao
          rotulo="Pessoa"
          valor={pessoa}
          aoMudar={setPessoa}
          vazio="Todas"
          opcoes={equipe.map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
        />
        <Botao aoClicar={() => setFormulario({ registro: null })} desabilitado={equipe.length === 0}>
          Lançar registro
        </Botao>
        <Botao variante="secundario" desabilitado={registros.length === 0} aoClicar={() => baixarPlanilhaPonto(registros)}>
          Baixar planilha
        </Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ponto.erro && <Aviso tipo="erro">{ponto.erro}</Aviso>}
      {ponto.carregando && !ponto.dados && <Carregando />}

      {ponto.dados && (
        <>
          <Cartao titulo="Horas por pessoa">
            <Tabela
              dados={totais}
              chave={(t) => t.usuario.id}
              vazio="Nenhum registro no período."
              colunas={[
                {
                  titulo: 'Pessoa',
                  celula: (t) => (
                    <span>
                      <span className="escala-nome">{t.usuario.nome}</span>
                      <span className="escala-perfil">{NOME_DO_PERFIL[t.usuario.perfil]}</span>
                    </span>
                  ),
                },
                { titulo: 'Dias', alinhar: 'direita', celula: (t) => String(t.dias) },
                { titulo: 'Horas', alinhar: 'direita', celula: (t) => <strong>{formatarMinutos(t.minutos)}</strong> },
                {
                  titulo: 'Em aberto',
                  alinhar: 'direita',
                  celula: (t) => (t.abertos > 0 ? <Selo cor="amarelo">{t.abertos}</Selo> : '0'),
                },
              ]}
            />
          </Cartao>

          <Cartao titulo="Registros">
            <Tabela
              dados={registros}
              chave={(r) => r.id}
              vazio="Nenhum registro no período."
              colunas={[
                {
                  titulo: 'Pessoa',
                  celula: (r) => (
                    <span>
                      <span className="escala-nome">{r.usuario.nome}</span>
                      <span className="escala-perfil">{NOME_DO_PERFIL[r.usuario.perfil]}</span>
                    </span>
                  ),
                },
                { titulo: 'Entrada', celula: (r) => <span className="sem-quebra">{formatarDataHora(r.entrada)}</span> },
                {
                  titulo: 'Saída',
                  celula: (r) =>
                    r.saida ? (
                      <span className="sem-quebra">{formatarDataHora(r.saida)}</span>
                    ) : (
                      <Selo cor="amarelo">Em aberto</Selo>
                    ),
                },
                { titulo: 'Horas', alinhar: 'direita', celula: (r) => (r.minutos === null ? '—' : formatarMinutos(r.minutos)) },
                {
                  titulo: 'Observação',
                  celula: (r) => (
                    <span>
                      {r.observacao ?? '—'}
                      {r.ajustadoPorNome && <span className="escala-ajuste">Ajustado por {r.ajustadoPorNome}</span>}
                    </span>
                  ),
                },
                {
                  titulo: 'Ações',
                  acoes: true,
                  celula: (r) => (
                    <MenuAcoes
                      rotulo={`Ações do registro de ${r.usuario.nome}`}
                      acoes={[
                        { rotulo: 'Corrigir', icone: 'lapis', aoClicar: () => setFormulario({ registro: r }) },
                        { rotulo: 'Excluir', icone: 'lixeira', aoClicar: () => excluirRegistro(r) },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Cartao>
        </>
      )}

      {formulario && (
        <FormularioRegistro
          registro={formulario.registro}
          equipe={equipe}
          aoFechar={() => setFormulario(null)}
          aoSalvo={(mensagem) => {
            setFormulario(null);
            setAviso(mensagem);
            setErro(null);
            ponto.recarregar();
          }}
        />
      )}
    </>
  );
}

function EscalaEPonto() {
  const [aba, setAba] = useState<'escala' | 'ponto'>('escala');
  return (
    <Pagina titulo="Escala e ponto">
      <Abas
        abas={[
          { id: 'escala', rotulo: 'Escala da semana' },
          { id: 'ponto', rotulo: 'Ponto' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id === 'ponto' ? 'ponto' : 'escala')}
      />
      {aba === 'escala' ? <EscalaSemana /> : <PontoGestor />}
    </Pagina>
  );
}

// ---------- Meu ponto (todos os perfis) ----------

export function MeuPonto() {
  const meu = useDados<PontoMeuDTO>('/ponto/meu');
  const turnos = useDados<TurnoDTO[]>('/escala/minha');
  const [agora, setAgora] = useState(() => new Date());
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Relógio da tela: atualiza a cada 30 s.
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const aberto = meu.dados?.aberto ?? null;

  async function registrar() {
    setErro(null);
    setOcupado(true);
    try {
      await api.post(aberto ? '/ponto/saida' : '/ponto/entrada');
      meu.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const decorridoMinutos = aberto ? Math.floor((agora.getTime() - new Date(aberto.entrada).getTime()) / 60000) : 0;

  return (
    <Pagina titulo="Meu ponto">
      <Cartao>
        <div className="ponto-relogio">
          <p className="ponto-hora">{agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
          <p className="ponto-data">{agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <button
            type="button"
            className="botao botao-primario ponto-acao"
            disabled={ocupado || !meu.dados}
            onClick={registrar}
          >
            {aberto ? 'Registrar saída' : 'Registrar entrada'}
          </button>
          {aberto && (
            <p className="ponto-situacao">
              Entrada às {horaCurta(aberto.entrada)} · há {formatarMinutos(decorridoMinutos)}
            </p>
          )}
        </div>
      </Cartao>

      {meu.erro && <Aviso tipo="erro">{meu.erro}</Aviso>}
      {meu.carregando && !meu.dados && <Carregando />}

      {meu.dados && (
        <div className="resumo">
          <Indicador
            rotulo="Horas nesta semana"
            valor={formatarMinutos(meu.dados.minutosNaSemana)}
            cor="azul"
            icone="relogio"
          />
        </div>
      )}

      <Cartao titulo="Meus próximos turnos">
        {turnos.erro && <Aviso tipo="erro">{turnos.erro}</Aviso>}
        {turnos.carregando && !turnos.dados && <Carregando />}
        {turnos.dados &&
          (turnos.dados.length === 0 ? (
            <p className="escala-vazio">Nenhum turno marcado nos próximos 14 dias.</p>
          ) : (
            <ul className="escala-lista">
              {turnos.dados.map((t) => (
                <li key={t.id} className="escala-lista-item">
                  <strong>
                    {siglaDoDia(t.data)}, {formatarDiaCurto(t.data)}
                  </strong>
                  <span>
                    {t.inicio}–{t.fim}
                  </span>
                  {t.observacao && <span className="escala-perfil">{t.observacao}</span>}
                </li>
              ))}
            </ul>
          ))}
      </Cartao>

      <Cartao titulo="Meus últimos registros">
        {meu.dados && (
          <Tabela
            dados={meu.dados.recentes}
            chave={(r) => r.id}
            vazio="Nenhum registro ainda."
            colunas={[
              { titulo: 'Entrada', celula: (r) => <span className="sem-quebra">{formatarDataHora(r.entrada)}</span> },
              {
                titulo: 'Saída',
                celula: (r) => (r.saida ? <span className="sem-quebra">{formatarDataHora(r.saida)}</span> : '—'),
              },
              { titulo: 'Horas', alinhar: 'direita', celula: (r) => (r.minutos === null ? '—' : formatarMinutos(r.minutos)) },
            ]}
          />
        )}
      </Cartao>
    </Pagina>
  );
}

// Ordem: gestor tem a escala e o ponto da equipe; todos têm o próprio ponto.
const PERFIS_PONTO: { raiz: string; perfil: Perfil }[] = [
  { raiz: 'gestor', perfil: 'GESTOR' },
  { raiz: 'garcom', perfil: 'GARCOM' },
  { raiz: 'cozinha', perfil: 'COZINHA' },
  { raiz: 'limpeza', perfil: 'LIMPEZA' },
  { raiz: 'recepcao', perfil: 'RECEPCAO' },
];

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/escala',
    rotulo: 'Escala e ponto',
    icone: 'calendario',
    perfis: ['GESTOR'],
    elemento: <EscalaEPonto />,
    ordem: 42,
    grupo: 'Equipe',
  },
  ...PERFIS_PONTO.map(({ raiz, perfil }): RotaModulo => ({
    caminho: `/${raiz}/ponto`,
    rotulo: 'Meu ponto',
    icone: 'relogio',
    perfis: [perfil],
    elemento: <MeuPonto />,
    ordem: 90,
    grupo: 'Conta',
  })),
];
