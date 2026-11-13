import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDados } from '../lib/useDados';
import { mensagemErro, tempoDesde } from '../lib/restaurante';
import {
  aoMudarInstalacao,
  desligarPush,
  estadoDoPush,
  estaInstalado,
  EstadoPush,
  instalar,
  ligarPush,
  podeInstalar,
  testarPush,
} from '../lib/push';
import { Aviso } from '../ui';
import { Icone } from '../ui/icones';
import './aplicativo.css';

interface AvisoDTO {
  chave: string;
  titulo: string;
  meta: string;
  quando: string;
  caminho: string;
}

const MAXIMO_LISTA = 6;
const INTERVALO_MS = 15000;

// Sino do topo: o que espera uma ação da equipe agora (mesa chamando, pedido novo, pedido pronto).
// `raiz` é o caminho do portal (ex.: /gestor); a tela de pedidos fica em `${raiz}/pedidos`.
export function Notificacoes({ raiz }: { raiz: string }) {
  const navigate = useNavigate();
  const { dados, erro, recarregar } = useDados<AvisoDTO[]>('/notificacoes');
  const [aberto, setAberto] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const caminhoPedidos = `${raiz}/pedidos`;
  const [estadoPush, setEstadoPush] = useState<EstadoPush | null>(null);
  const [ocupadoPush, setOcupadoPush] = useState(false);
  const [erroPush, setErroPush] = useState<string | null>(null);
  const [resultadoTeste, setResultadoTeste] = useState<string | null>(null);
  const [instalavel, setInstalavel] = useState(() => podeInstalar());
  const [ocupadoInstalar, setOcupadoInstalar] = useState(false);
  const [erroInstalar, setErroInstalar] = useState<string | null>(null);
  const ehIphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const mostrarDicaIphone = ehIphone && !estaInstalado();

  // Ao abrir o painel, lê o estado das notificações neste aparelho.
  useEffect(() => {
    if (!aberto) return;
    let ativo = true;
    estadoDoPush()
      .then((estado) => {
        if (ativo) setEstadoPush(estado);
      })
      .catch(() => {
        if (ativo) setEstadoPush('INDISPONIVEL');
      });
    return () => {
      ativo = false;
    };
  }, [aberto]);

  // Mostra ou esconde o botão de instalar quando o navegador muda a possibilidade.
  useEffect(() => aoMudarInstalacao(() => setInstalavel(podeInstalar())), []);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (area.current && !area.current.contains(e.target as Node)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  // Atualiza a cada 15 s (só com a aba visível) e quando a janela volta a ter foco. recarregar é estável.
  useEffect(() => {
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') recarregar();
    }, INTERVALO_MS);
    const aoFocar = () => recarregar();
    window.addEventListener('focus', aoFocar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', aoFocar);
    };
  }, [recarregar]);

  const lista = dados ?? [];
  const total = lista.length;
  const recentes = lista.slice(0, MAXIMO_LISTA);

  function abrirAviso(aviso: AvisoDTO) {
    setAberto(false);
    navigate(aviso.caminho);
  }

  async function atualizarEstadoPush() {
    try {
      setEstadoPush(await estadoDoPush());
    } catch {
      setEstadoPush('INDISPONIVEL');
    }
  }

  async function alternarPush() {
    if (ocupadoPush || estadoPush === null) return;
    setOcupadoPush(true);
    setErroPush(null);
    setResultadoTeste(null);
    try {
      if (estadoPush === 'LIGADO') {
        await desligarPush();
      } else {
        await ligarPush();
      }
    } catch (e) {
      setErroPush(mensagemErro(e));
    } finally {
      setOcupadoPush(false);
      await atualizarEstadoPush();
    }
  }

  async function enviarTeste() {
    if (ocupadoPush) return;
    setOcupadoPush(true);
    setErroPush(null);
    setResultadoTeste(null);
    try {
      const enviadas = await testarPush();
      setResultadoTeste(
        enviadas > 0
          ? `Teste enviado para ${enviadas} ${enviadas === 1 ? 'aparelho' : 'aparelhos'}.`
          : 'Nenhum aparelho recebeu o teste. Desligue e ligue as notificações de novo.'
      );
    } catch (e) {
      setErroPush(mensagemErro(e));
    } finally {
      setOcupadoPush(false);
    }
  }

  async function instalarApp() {
    if (ocupadoInstalar) return;
    setOcupadoInstalar(true);
    setErroInstalar(null);
    try {
      await instalar();
    } catch (e) {
      setErroInstalar(mensagemErro(e));
    } finally {
      setOcupadoInstalar(false);
      setInstalavel(podeInstalar());
    }
  }

  return (
    <div className="casca-sino-area" ref={area}>
      <button
        type="button"
        className="casca-botao-redondo"
        aria-label={total > 0 ? `Avisos, ${total} pendentes` : 'Avisos'}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome="sino" tamanho={22} />
        {total > 0 && (
          <span className="casca-contador" aria-hidden="true">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <div className="casca-painel-avisos" role="dialog" aria-label="Avisos recentes">
          <div className="casca-painel-cabecalho">
            <strong>Avisos</strong>
            <Link to={caminhoPedidos} className="casca-link" onClick={() => setAberto(false)}>
              Ver pedidos
            </Link>
          </div>

          {erro && <p className="casca-painel-vazio">Não foi possível carregar os avisos.</p>}
          {!erro && recentes.length === 0 && <p className="casca-painel-vazio">Nada pendente agora.</p>}

          <ul className="casca-avisos-lista">
            {recentes.map((aviso) => (
              <li key={aviso.chave}>
                <button type="button" className="casca-aviso" onClick={() => abrirAviso(aviso)}>
                  <span className="casca-aviso-ponto" aria-hidden="true" />
                  <span className="casca-aviso-texto">
                    <span className="casca-aviso-titulo">{aviso.titulo}</span>
                    <span className="casca-aviso-meta">
                      {aviso.meta} · {tempoDesde(aviso.quando)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="casca-aparelho">
            <p className="casca-aparelho-titulo">Neste aparelho</p>

            {estadoPush === 'INDISPONIVEL' ? (
              <Aviso tipo="info">Este navegador não tem notificações, ou o site não está em HTTPS.</Aviso>
            ) : (
              <>
                <div className="casca-aparelho-linha">
                  <button
                    type="button"
                    className="casca-aparelho-alternar"
                    aria-pressed={estadoPush === 'LIGADO'}
                    disabled={ocupadoPush || estadoPush === null || estadoPush === 'BLOQUEADO'}
                    onClick={alternarPush}
                  >
                    Avisar com notificação
                  </button>
                  <span className="casca-aparelho-estado">
                    {estadoPush === 'LIGADO' ? 'Ligado' : estadoPush === 'BLOQUEADO' ? 'Bloqueado' : estadoPush === 'DESLIGADO' ? 'Desligado' : ''}
                  </span>
                </div>

                {estadoPush === 'BLOQUEADO' && (
                  <Aviso tipo="info">
                    As notificações estão bloqueadas neste navegador. Libere nas configurações do site.
                  </Aviso>
                )}

                {estadoPush === 'LIGADO' && (
                  <button type="button" className="casca-aparelho-acao-texto" disabled={ocupadoPush} onClick={enviarTeste}>
                    Enviar um teste
                  </button>
                )}

                {resultadoTeste && <p className="casca-aparelho-dica">{resultadoTeste}</p>}
                {erroPush && <Aviso tipo="erro">{erroPush}</Aviso>}
              </>
            )}

            {instalavel && (
              <button type="button" className="casca-aparelho-acao" disabled={ocupadoInstalar} onClick={instalarApp}>
                Instalar o aplicativo
              </button>
            )}
            {mostrarDicaIphone && (
              <p className="casca-aparelho-dica">
                No iPhone: toque em Compartilhar e depois em Adicionar à Tela de Início.
              </p>
            )}
            {erroInstalar && <Aviso tipo="erro">{erroInstalar}</Aviso>}
          </div>
        </div>
      )}
    </div>
  );
}
