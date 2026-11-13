import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { BackupArquivoDTO, BackupAtivoDTO, BackupDTO } from '../../lib/backup';
import { mensagemErro } from '../../lib/restaurante';
import {
  Aviso,
  Botao,
  Caixa,
  Campo,
  Cartao,
  Carregando,
  MenuAcoes,
  Modal,
  Selo,
  Tabela,
  formatarDataHora,
} from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';

// Mesma chave do token que client/src/lib/api.ts usa (o download precisa do cabeçalho Authorization).
const CHAVE_TOKEN = 'restaurante.token';

// Etapas que só aparecem numa restauração (o servidor muda de etapa conforme a restauração avança).
const ETAPAS_RESTAURACAO: string[] = [
  'Guardando uma cópia do banco atual',
  'Parando o sistema',
  'Restaurando a cópia',
  'A cópia não pôde ser restaurada. Voltando ao banco anterior',
  'Ligando o sistema',
  'Cópia restaurada',
];

// Tamanho de arquivo para leitura: "512 B", "3,4 KB", "1,2 MB".
function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function textoUltimoDiario(ultimo: BackupAtivoDTO['ultimoDiario']): string {
  if (!ultimo) return 'Última cópia automática: ainda não houve';
  if (ultimo.ok) return `Última cópia automática: ${formatarDataHora(ultimo.em)} (ok)`;
  return `Última cópia automática: ${formatarDataHora(ultimo.em)} (falhou: ${ultimo.erro ?? 'motivo desconhecido'})`;
}

function SeloTipo({ tipo }: { tipo: BackupArquivoDTO['tipo'] }) {
  if (tipo === 'DIARIO') return <Selo cor="azul">Diária</Selo>;
  if (tipo === 'MANUAL') return <Selo cor="verde">Manual</Selo>;
  if (tipo === 'ANTES_RESTAURAR') return <Selo cor="amarelo">Antes de restaurar</Selo>;
  return <span className="selo backup-selo-roxo">Antes de atualizar</span>;
}

export function Backup() {
  const [dados, setDados] = useState<BackupDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'manual' | 'config' | 'restaurar' | null>(null);
  // O servidor não respondeu na última consulta (normal durante a restauração).
  const [semResposta, setSemResposta] = useState(false);
  // Formulário do backup automático (preenchido com a configuração gravada).
  const [formulario, setFormulario] = useState<{ diario: boolean; hora: string; manterDiarios: string } | null>(null);
  // Cópia escolhida para restaurar (abre o modal) e o texto de confirmação digitado.
  const [restaurarDe, setRestaurarDe] = useState<BackupArquivoDTO | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  // Operação que esta tela iniciou ('manual' ou 'restaurar'), para avisar quando terminar.
  const operacao = useRef<'manual' | 'restaurar' | null>(null);
  const recarregarEm = useRef<number | null>(null);

  const consultar = useCallback(async () => {
    try {
      const resposta = await api.get<BackupDTO>('/backup');
      setDados(resposta);
      setSemResposta(false);
    } catch {
      setSemResposta(true);
    }
  }, []);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  useEffect(() => {
    return () => {
      if (recarregarEm.current !== null) window.clearTimeout(recarregarEm.current);
    };
  }, []);

  const ativo = dados?.ativo === true ? dados : null;
  const rodando = ativo !== null && ativo.tarefa.estado === 'RODANDO';

  useEffect(() => {
    if (!rodando && !semResposta) return;
    const id = window.setInterval(() => void consultar(), 3000);
    return () => window.clearInterval(id);
  }, [rodando, semResposta, consultar]);

  // Preenche o formulário com a configuração gravada, uma vez (sem apagar o que for digitado depois).
  useEffect(() => {
    if (dados?.ativo === true && formulario === null) {
      setFormulario({
        diario: dados.config.diario,
        hora: dados.config.hora,
        manterDiarios: String(dados.config.manterDiarios),
      });
    }
  }, [dados, formulario]);

  // Acompanha a operação que esta tela iniciou e avisa quando ela termina.
  useEffect(() => {
    if (dados?.ativo !== true) return;
    const tarefa = dados.tarefa;
    if (tarefa.estado === 'RODANDO' && ETAPAS_RESTAURACAO.includes(tarefa.etapa ?? '')) {
      operacao.current = 'restaurar';
    }
    if (tarefa.estado === 'FALHOU') {
      operacao.current = null;
    }
    if (tarefa.estado === 'CONCLUIDA' && !semResposta && operacao.current !== null) {
      const feita = operacao.current;
      operacao.current = null;
      if (feita === 'restaurar') {
        setAviso('Cópia restaurada. A página vai recarregar.');
        recarregarEm.current = window.setTimeout(() => window.location.reload(), 3000);
      } else {
        setAviso('Cópia feita.');
      }
    }
  }, [dados, semResposta]);

  async function salvarConfig() {
    if (!formulario) return;
    const manter = Number(formulario.manterDiarios);
    if (!/^\d{2}:\d{2}$/.test(formulario.hora)) {
      setErro('Informe a hora no formato HH:mm.');
      return;
    }
    if (!Number.isInteger(manter) || manter < 1 || manter > 60) {
      setErro('Guarde de 1 a 60 cópias diárias.');
      return;
    }
    setErro(null);
    setAviso(null);
    setOcupado('config');
    try {
      const novo = await api.put<BackupDTO>('/backup/config', {
        diario: formulario.diario,
        hora: formulario.hora,
        manterDiarios: manter,
      });
      setDados(novo);
      if (novo.ativo) {
        setFormulario({
          diario: novo.config.diario,
          hora: novo.config.hora,
          manterDiarios: String(novo.config.manterDiarios),
        });
      }
      setAviso('Configuração salva.');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function fazerCopia() {
    setErro(null);
    setAviso(null);
    setOcupado('manual');
    operacao.current = 'manual';
    try {
      setDados(await api.post<BackupDTO>('/backup'));
    } catch (e) {
      operacao.current = null;
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function baixar(b: BackupArquivoDTO) {
    setErro(null);
    try {
      const token = localStorage.getItem(CHAVE_TOKEN);
      const resposta = await fetch(`/api/backup/baixar?nome=${encodeURIComponent(b.arquivo)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resposta.ok) throw new Error('Não foi possível baixar a cópia.');
      const arquivo = await resposta.blob();
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement('a');
      link.href = url;
      link.download = b.arquivo;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function restaurar() {
    if (!restaurarDe) return;
    setErro(null);
    setAviso(null);
    setOcupado('restaurar');
    operacao.current = 'restaurar';
    try {
      setDados(await api.post<BackupDTO>('/backup/restaurar', { arquivo: restaurarDe.arquivo, confirmacao: 'RESTAURAR' }));
    } catch (e) {
      operacao.current = null;
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
      setRestaurarDe(null);
    }
  }

  async function excluir(b: BackupArquivoDTO) {
    const confirmado = window.confirm(
      `Excluir a cópia ${b.arquivo}? Depois de excluída, ela não pode ser recuperada.`,
    );
    if (!confirmado) return;
    setErro(null);
    try {
      await api.del(`/backup/arquivo?nome=${encodeURIComponent(b.arquivo)}`);
      await consultar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  if (dados === null) {
    return semResposta ? (
      <Aviso tipo="erro">Não foi possível consultar os backups.</Aviso>
    ) : (
      <Carregando />
    );
  }

  if (dados.ativo === false) {
    return (
      <div className="atualizacao">
        <Aviso tipo="info">
          <p>{dados.motivo}</p>
          <p>
            O botão de atualizar precisa do contêiner "atualizador". Rode o instalador de novo (
            <code>instalar.ps1</code> no Windows, <code>./instalar.sh</code> no Linux ou Mac) para criá-lo.
          </p>
        </Aviso>
      </div>
    );
  }

  const tarefa = dados.tarefa;
  const emAndamento = rodando || (semResposta && operacao.current !== null);

  const colunas: ColunaTabela<BackupArquivoDTO>[] = [
    { titulo: 'Arquivo', celula: (b) => <code>{b.arquivo}</code> },
    { titulo: 'Tipo', celula: (b) => <SeloTipo tipo={b.tipo} /> },
    { titulo: 'Tamanho', celula: (b) => tamanhoLegivel(b.tamanho) },
    { titulo: 'Quando', celula: (b) => formatarDataHora(b.criadoEm) },
  ];
  if (!emAndamento) {
    colunas.push({
      titulo: 'Ações',
      acoes: true,
      celula: (b) => {
        const acoes: AcaoMenu[] = [
          { rotulo: 'Baixar', aoClicar: () => void baixar(b) },
          {
            rotulo: 'Restaurar esta cópia',
            aoClicar: () => {
              setConfirmacao('');
              setRestaurarDe(b);
            },
          },
          { rotulo: 'Excluir', perigo: true, aoClicar: () => void excluir(b) },
        ];
        return <MenuAcoes acoes={acoes} rotulo={`Ações da cópia ${b.arquivo}`} />;
      },
    });
  }

  return (
    <div className="atualizacao">
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {emAndamento && (
        <Cartao titulo="Trabalhando">
          <div className="atualizacao-andamento" role="status">
            <span className="atualizacao-pulso" aria-hidden="true" />
            {tarefa.etapa ?? 'Começando...'}
          </div>
          {semResposta && operacao.current === 'restaurar' && (
            <p className="atualizacao-nota">O sistema está reiniciando. Esta tela volta sozinha em instantes.</p>
          )}
          <pre className="atualizacao-log">{tarefa.log.slice(-40).join('\n')}</pre>
        </Cartao>
      )}

      {!emAndamento && tarefa.estado === 'FALHOU' && (
        <>
          <Aviso tipo="erro">{tarefa.erro ?? 'A operação falhou.'}</Aviso>
          <details className="atualizacao-detalhes">
            <summary>Ver o registro</summary>
            <pre className="atualizacao-log">{tarefa.log.slice(-80).join('\n')}</pre>
          </details>
        </>
      )}

      <Cartao titulo="Backup automático">
        {formulario && (
          <>
            <Caixa
              rotulo="Fazer uma cópia do banco todo dia"
              marcado={formulario.diario}
              aoMudar={(diario) => setFormulario({ ...formulario, diario })}
            />
            <div className="backup-campos">
              <Campo
                rotulo="Hora"
                tipo="time"
                valor={formulario.hora}
                aoMudar={(hora) => setFormulario({ ...formulario, hora })}
              />
              <Campo
                rotulo="Quantas cópias diárias guardar"
                tipo="number"
                valor={formulario.manterDiarios}
                aoMudar={(manterDiarios) => setFormulario({ ...formulario, manterDiarios })}
              />
            </div>
            <p className="atualizacao-nota">{textoUltimoDiario(dados.ultimoDiario)}</p>
            {!emAndamento && (
              <div className="atualizacao-acoes">
                <Botao desabilitado={ocupado !== null} aoClicar={() => void salvarConfig()}>
                  {ocupado === 'config' ? 'Salvando...' : 'Salvar'}
                </Botao>
              </div>
            )}
          </>
        )}
      </Cartao>

      <Cartao titulo="Cópias guardadas">
        {!emAndamento && (
          <div className="atualizacao-acoes">
            <Botao desabilitado={ocupado !== null} aoClicar={() => void fazerCopia()}>
              {ocupado === 'manual' ? 'Copiando...' : 'Fazer uma cópia agora'}
            </Botao>
          </div>
        )}
        <Tabela dados={dados.backups} chave={(b) => b.arquivo} colunas={colunas} vazio="Nenhuma cópia guardada ainda." />
      </Cartao>

      <Modal
        aberto={restaurarDe !== null}
        titulo="Restaurar cópia"
        aoFechar={() => setRestaurarDe(null)}
      >
        {restaurarDe && (
          <>
            <p className="backup-destaque">
              Restaurar troca TODO o banco pelo conteúdo desta cópia, de {formatarDataHora(restaurarDe.criadoEm)}. Tudo o
              que foi lançado depois dela (pedidos, pagamentos, cadastros) será perdido. Antes, o sistema guarda uma
              cópia do banco de agora. O sistema fica fora do ar por alguns minutos.
            </p>
            <Campo rotulo="Digite RESTAURAR para confirmar" valor={confirmacao} aoMudar={setConfirmacao} />
            <div className="atualizacao-acoes">
              <Botao
                variante="perigo"
                desabilitado={confirmacao !== 'RESTAURAR' || ocupado !== null}
                aoClicar={() => void restaurar()}
              >
                {ocupado === 'restaurar' ? 'Restaurando...' : 'Restaurar'}
              </Botao>
              <Botao variante="secundario" aoClicar={() => setRestaurarDe(null)}>
                Cancelar
              </Botao>
            </div>
          </>
        )}
      </Modal>

      <p className="atualizacao-nota">
        As cópias ficam na pasta <code>backups/</code> do projeto, no computador onde o sistema está instalado. Para
        ficar protegido contra perda do computador, copie essa pasta para outro lugar (um HD externo ou a nuvem).
      </p>
    </div>
  );
}
