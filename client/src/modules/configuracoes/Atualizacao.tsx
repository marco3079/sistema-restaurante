import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { AtualizacaoDTO } from '../../lib/atualizacao';
import { mensagemErro } from '../../lib/restaurante';
import { Aviso, Botao, Cartao, Carregando, Selo, Tabela, formatarDataHora } from '../../ui';

// Tamanho de arquivo para leitura: "512 B", "3,4 KB", "1,2 MB".
function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function Atualizacao() {
  const [dados, setDados] = useState<AtualizacaoDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'verificar' | 'aplicar' | null>(null);
  // O servidor não respondeu na última consulta (normal durante o reinício da atualização).
  const [semResposta, setSemResposta] = useState(false);
  // Marca que a atualização chegou a rodar nesta tela, para avisar quando terminar.
  const viuRodando = useRef<boolean>(false);

  const consultar = useCallback(async () => {
    try {
      const resposta = await api.get<AtualizacaoDTO>('/atualizacao');
      setDados(resposta);
      setSemResposta(false);
    } catch {
      setSemResposta(true);
    }
  }, []);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  const rodando = dados?.ativo === true && dados.tarefa.estado === 'RODANDO';

  useEffect(() => {
    if (!rodando && !semResposta) return;
    const id = window.setInterval(() => void consultar(), 3000);
    return () => window.clearInterval(id);
  }, [rodando, semResposta, consultar]);

  useEffect(() => {
    if (rodando) viuRodando.current = true;
  }, [rodando]);

  useEffect(() => {
    if (viuRodando.current && dados?.ativo === true && dados.tarefa.estado === 'CONCLUIDA' && !semResposta) {
      viuRodando.current = false;
      setAviso('Atualização concluída. A página vai recarregar.');
      window.setTimeout(() => window.location.reload(), 3000);
    }
  }, [dados, semResposta]);

  async function verificar() {
    setErro(null);
    setOcupado('verificar');
    try {
      const novo = await api.post<AtualizacaoDTO>('/atualizacao/verificar', {});
      setDados(novo);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function aplicar(forcar: boolean) {
    const confirmado = window.confirm(
      'O sistema vai ficar fora do ar por alguns minutos enquanto é atualizado. Pedidos em andamento não se perdem, mas ninguém consegue usar o sistema nesse tempo. Uma cópia do banco de dados é feita antes. Atualizar agora?',
    );
    if (!confirmado) return;
    setErro(null);
    setOcupado('aplicar');
    try {
      const novo = await api.post<AtualizacaoDTO>('/atualizacao/aplicar', { forcar });
      setDados(novo);
      viuRodando.current = true;
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  if (dados === null) {
    return semResposta ? (
      <Aviso tipo="erro">Não foi possível consultar a atualização.</Aviso>
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

  const pendentes = dados.pendentes;
  const emAndamento = rodando || (semResposta && viuRodando.current);

  return (
    <div className="atualizacao">
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados.erroVerificacao && <Aviso tipo="erro">{dados.erroVerificacao}</Aviso>}
      {dados.alteracoesLocais && (
        <Aviso tipo="info">
          A pasta do sistema neste computador tem arquivos alterados à mão. A atualização só entra se essas
          alterações não conflitarem com o commit novo.
        </Aviso>
      )}

      {emAndamento && (
        <Cartao titulo="Atualizando o sistema">
          <div className="atualizacao-andamento" role="status">
            <span className="atualizacao-pulso" aria-hidden="true" />
            {dados.tarefa.etapa ?? 'Começando...'}
          </div>
          {semResposta && (
            <p className="atualizacao-nota">O sistema está reiniciando. Esta tela volta sozinha em instantes.</p>
          )}
          <pre className="atualizacao-log">{dados.tarefa.log.slice(-40).join('\n')}</pre>
        </Cartao>
      )}

      {!emAndamento && dados.tarefa.estado === 'FALHOU' && (
        <>
          <Aviso tipo="erro">{dados.tarefa.erro ?? 'A atualização falhou.'}</Aviso>
          <details className="atualizacao-detalhes">
            <summary>Ver o registro</summary>
            <pre className="atualizacao-log">{dados.tarefa.log.slice(-80).join('\n')}</pre>
          </details>
        </>
      )}

      <Cartao titulo="Versão do sistema">
        <dl className="atualizacao-versoes">
          <div>
            <dt>Instalada</dt>
            <dd>
              {dados.instalada ? (
                <>
                  <code>{dados.instalada.curto}</code> {dados.instalada.mensagem}{' '}
                  <span className="atualizacao-data">{formatarDataHora(dados.instalada.data)}</span>
                </>
              ) : (
                'Desconhecida'
              )}
            </dd>
          </div>
          <div>
            <dt>Última no GitHub</dt>
            <dd>
              {dados.disponivel ? (
                <>
                  <code>{dados.disponivel.curto}</code> {dados.disponivel.mensagem}{' '}
                  <span className="atualizacao-data">{formatarDataHora(dados.disponivel.data)}</span>
                </>
              ) : (
                'Ainda não verificada'
              )}
            </dd>
          </div>
        </dl>

        {pendentes.length > 0 ? (
          <p>
            <Selo cor="amarelo">{pendentes.length === 1 ? '1 novidade' : `${pendentes.length} novidades`}</Selo>
          </p>
        ) : dados.disponivel ? (
          <p>
            <Selo cor="verde">Atualizado</Selo>
          </p>
        ) : null}

        <p className="atualizacao-nota">
          Última verificação: {dados.verificadoEm ? formatarDataHora(dados.verificadoEm) : 'nunca'}
        </p>
        <p className="atualizacao-nota">O sistema verifica sozinho a cada 6 horas.</p>

        {!emAndamento && (
          <div className="atualizacao-acoes">
            <Botao
              desabilitado={ocupado !== null || pendentes.length === 0}
              aoClicar={() => void aplicar(false)}
            >
              {ocupado === 'aplicar' ? 'Enviando...' : 'Atualizar agora'}
            </Botao>
            <Botao variante="secundario" desabilitado={ocupado !== null} aoClicar={() => void verificar()}>
              {ocupado === 'verificar' ? 'Verificando...' : 'Verificar agora'}
            </Botao>
            {pendentes.length === 0 && (
              <Botao variante="texto" desabilitado={ocupado !== null} aoClicar={() => void aplicar(true)}>
                Reconstruir mesmo sem novidades
              </Botao>
            )}
          </div>
        )}
      </Cartao>

      {pendentes.length > 0 && (
        <Cartao titulo="O que muda">
          <Tabela
            dados={pendentes}
            chave={(p) => p.curto}
            colunas={[
              { titulo: 'Commit', celula: (p) => <code>{p.curto}</code> },
              { titulo: 'Mudança', celula: (p) => p.mensagem },
              { titulo: 'Autor', celula: (p) => p.autor },
              { titulo: 'Data', celula: (p) => formatarDataHora(p.data) },
            ]}
          />
        </Cartao>
      )}

      {dados.backups.length > 0 && (
        <Cartao titulo="Cópias do banco de dados">
          <p className="atualizacao-nota">
            Antes de cada atualização o sistema grava uma cópia do banco na pasta <code>backups/</code> do projeto e
            guarda as 5 mais recentes.
          </p>
          <Tabela
            dados={dados.backups}
            chave={(b) => b.arquivo}
            colunas={[
              { titulo: 'Arquivo', celula: (b) => <code>{b.arquivo}</code> },
              { titulo: 'Tamanho', celula: (b) => tamanhoLegivel(b.tamanho) },
              { titulo: 'Quando', celula: (b) => formatarDataHora(b.criadoEm) },
            ]}
          />
        </Cartao>
      )}
    </div>
  );
}
