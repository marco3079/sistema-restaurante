import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Icone } from '../ui/icones';

// Faixa que rola para os lados e deixa isso claro: setas para avançar e voltar,
// esmaecido na borda quando há mais itens, e arrastar com o dedo ou com o mouse.
// Com o dedo, a rolagem é a do próprio celular; com o mouse, o arrasto é tratado aqui.
export function FaixaRolavel({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const lista = useRef<HTMLDivElement>(null);
  const [podeVoltar, setPodeVoltar] = useState(false);
  const [podeAvancar, setPodeAvancar] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  // Arrasto com o mouse: posição inicial e se já andou (para não virar clique no cartão).
  const arrasto = useRef<{ x: number; rolagem: number; andou: boolean; ponteiro: number } | null>(null);

  const medir = useCallback(() => {
    const el = lista.current;
    if (!el) return;
    setPodeVoltar(el.scrollLeft > 4);
    setPodeAvancar(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    medir();
    const el = lista.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [medir, children]);

  function rolar(sentido: 1 | -1) {
    const el = lista.current;
    if (!el) return;
    el.scrollBy({ left: sentido * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' });
  }

  function aoApertar(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !lista.current) return;
    arrasto.current = { x: e.clientX, rolagem: lista.current.scrollLeft, andou: false, ponteiro: e.pointerId };
  }

  function aoMover(e: ReactPointerEvent<HTMLDivElement>) {
    const a = arrasto.current;
    if (!a || !lista.current) return;
    const distancia = e.clientX - a.x;
    if (!a.andou && Math.abs(distancia) > 5) {
      a.andou = true;
      setArrastando(true);
      // Segura o ponteiro: o arrasto continua mesmo se o mouse sair da faixa.
      try {
        lista.current.setPointerCapture(a.ponteiro);
      } catch {
        // Sem captura, o arrasto vale enquanto o mouse estiver sobre a faixa.
      }
    }
    if (a.andou) lista.current.scrollLeft = a.rolagem - distancia;
  }

  function aoSoltar() {
    if (!arrasto.current) return;
    setArrastando(false);
    // O clique que vem logo depois de um arrasto é descartado em onClickCapture.
    window.setTimeout(() => {
      arrasto.current = null;
    }, 0);
  }

  return (
    <div className="mesa-cli-faixa">
      <div
        ref={lista}
        className={
          'mesa-cli-recomendados-lista' +
          (podeVoltar ? ' mesa-cli-faixa-mais-antes' : '') +
          (podeAvancar ? ' mesa-cli-faixa-mais-depois' : '') +
          (arrastando ? ' mesa-cli-faixa-arrastando' : '')
        }
        role="group"
        aria-label={rotulo}
        onScroll={medir}
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        // Sem isto o navegador tenta "arrastar a foto" do cartão e a faixa não rola.
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          if (arrasto.current?.andou) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {children}
      </div>
      {podeVoltar && (
        <button
          type="button"
          className="mesa-cli-faixa-seta mesa-cli-faixa-seta-antes"
          aria-label="Ver os anteriores"
          onClick={() => rolar(-1)}
        >
          <Icone nome="seta-esquerda" tamanho={18} />
        </button>
      )}
      {podeAvancar && (
        <button
          type="button"
          className="mesa-cli-faixa-seta mesa-cli-faixa-seta-depois"
          aria-label="Ver mais"
          onClick={() => rolar(1)}
        >
          <Icone nome="seta-direita" tamanho={18} />
        </button>
      )}
      {podeAvancar && !podeVoltar && (
        <p className="mesa-cli-faixa-dica" aria-hidden="true">
          Arraste para o lado para ver mais
          <Icone nome="seta-direita" tamanho={14} />
        </p>
      )}
    </div>
  );
}
