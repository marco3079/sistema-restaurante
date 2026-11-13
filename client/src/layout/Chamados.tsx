import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useDados } from '../lib/useDados';
import { useAtualizacao } from '../lib/useAtualizacao';
import { nomeDaMesa, tempoDesde } from '../lib/restaurante';
import type { ChamadoDTO } from '../lib/restaurante';
import { tocar } from '../lib/som';
import { Icone } from '../ui/icones';

const INTERVALO_MS = 5000;
// Depois de "Agora não", o mesmo chamado volta a aparecer se a mesa continuar esperando.
const REAVISAR_MS = 2 * 60 * 1000;

// Popup que avisa o garçom responsável quando a mesa dele chama. Mesa sem responsável avisa todos os garçons.
export function Chamados() {
  const { dados, recarregar } = useDados<ChamadoDTO[]>('/chamados');
  // "mesaId|desde" -> instante em que a pessoa adiou o aviso.
  const [adiados, setAdiados] = useState<Record<string, number>>({});
  const [agora, setAgora] = useState(() => Date.now());
  const [ocupado, setOcupado] = useState<number | null>(null);
  // Mesas da lista anterior; null até a primeira carga (que não toca).
  const mesasAnteriores = useRef<Set<number> | null>(null);

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

  // Toca quando aparece uma mesa que não estava na lista anterior.
  useEffect(() => {
    if (!dados) return;
    const anteriores = mesasAnteriores.current;
    mesasAnteriores.current = new Set(dados.map((c) => c.mesaId));
    if (anteriores === null) return;
    if (dados.some((c) => !anteriores.has(c.mesaId))) tocar('chamado', { sempre: true });
  }, [dados]);

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
