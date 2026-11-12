import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useDados } from '../lib/useDados';
import { useAtualizacao } from '../lib/useAtualizacao';
import { nomeDaMesa, tempoDesde } from '../lib/restaurante';
import type { ChamadoDTO } from '../lib/restaurante';
import { Icone } from '../ui/icones';

const INTERVALO_MS = 5000;
// Depois de "Agora não", o mesmo chamado volta a aparecer se a mesa continuar esperando.
const REAVISAR_MS = 2 * 60 * 1000;

// Dois toques curtos. Sem som se o navegador ainda não deixou tocar (antes do primeiro clique).
function tocarAviso(): void {
  try {
    const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const audio = new Contexto();
    [0, 0.22].forEach((inicio) => {
      const oscilador = audio.createOscillator();
      const volume = audio.createGain();
      oscilador.frequency.value = 880;
      volume.gain.setValueAtTime(0.0001, audio.currentTime + inicio);
      volume.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + inicio + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + inicio + 0.18);
      oscilador.connect(volume).connect(audio.destination);
      oscilador.start(audio.currentTime + inicio);
      oscilador.stop(audio.currentTime + inicio + 0.2);
    });
    window.setTimeout(() => void audio.close(), 800);
  } catch {
    // Sem áudio: o popup aparece do mesmo jeito.
  }
}

// Popup que avisa o garçom responsável quando a mesa dele chama. Mesa sem responsável avisa todos os garçons.
export function Chamados() {
  const { dados, recarregar } = useDados<ChamadoDTO[]>('/chamados');
  // "mesaId|desde" -> instante em que a pessoa adiou o aviso.
  const [adiados, setAdiados] = useState<Record<string, number>>({});
  const [agora, setAgora] = useState(() => Date.now());
  const [ocupado, setOcupado] = useState<number | null>(null);
  const jaTocou = useRef(new Set<string>());

  useAtualizacao(recarregar, INTERVALO_MS);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const chave = (c: ChamadoDTO) => `${c.mesaId}|${c.desde}`;
  const visiveis = (dados ?? []).filter((c) => {
    const adiadoEm = adiados[chave(c)];
    return adiadoEm === undefined || agora - adiadoEm >= REAVISAR_MS;
  });

  // Toca uma vez por chamado novo.
  useEffect(() => {
    const novos = visiveis.filter((c) => !jaTocou.current.has(chave(c)));
    if (novos.length === 0) return;
    novos.forEach((c) => jaTocou.current.add(chave(c)));
    tocarAviso();
  }, [visiveis]);

  if (visiveis.length === 0) return null;

  async function atender(chamado: ChamadoDTO) {
    setOcupado(chamado.mesaId);
    try {
      await api.post(`/mesas/${chamado.mesaId}/atender-chamado`);
    } catch {
      // Se falhar, o chamado continua na lista e a pessoa pode tentar de novo.
    } finally {
      setOcupado(null);
      recarregar();
    }
  }

  function adiar() {
    const instante = Date.now();
    setAgora(instante);
    setAdiados((atual) => {
      const novo = { ...atual };
      visiveis.forEach((c) => {
        novo[chave(c)] = instante;
      });
      return novo;
    });
  }

  const titulo =
    visiveis.length === 1 ? `${nomeDaMesa(visiveis[0])} está chamando` : `${visiveis.length} mesas estão chamando`;

  return (
    <div className="casca-chamado-fundo">
      <div className="casca-chamado" role="alertdialog" aria-modal="true" aria-labelledby="casca-chamado-titulo">
        <span className="casca-chamado-icone" aria-hidden="true">
          <Icone nome="sino" tamanho={30} />
        </span>
        <h2 id="casca-chamado-titulo" className="casca-chamado-titulo">
          {titulo}
        </h2>
        <p className="casca-chamado-texto">O cliente pediu o garçom pelo cardápio da mesa.</p>
        <ul className="casca-chamado-lista">
          {visiveis.map((c) => (
            <li key={chave(c)}>
              <span>
                <strong>
                  {nomeDaMesa(c)}
                  {c.area && c.area !== c.nome ? ` · ${c.area}` : ''}
                </strong>
                <span className="casca-chamado-tempo">chamou {tempoDesde(c.desde, new Date(agora))}</span>
              </span>
              <button
                type="button"
                className="botao botao-primario"
                disabled={ocupado === c.mesaId}
                onClick={() => void atender(c)}
              >
                {ocupado === c.mesaId ? 'Marcando...' : 'Estou indo'}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="botao botao-texto" onClick={adiar}>
          Agora não
        </button>
      </div>
    </div>
  );
}
