import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDados } from '../lib/useDados';
import { tempoDesde } from '../lib/restaurante';
import { Icone } from '../ui/icones';

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
        </div>
      )}
    </div>
  );
}
