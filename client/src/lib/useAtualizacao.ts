import { useEffect } from 'react';
import { assinar, rajada } from './tempoReal';

// Chama `recarregar` a cada `intervaloMs` enquanto a aba estiver visível e quando a janela volta ao foco.
// Também recarrega quando o servidor avisa que algo mudou (tempo real); eventos em rajada viram no máximo uma chamada a cada 400 ms.
// `recarregar` precisa ser estável (o de useDados é).
export function useAtualizacao(recarregar: () => void, intervaloMs: number): void {
  useEffect(() => {
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') recarregar();
    }, intervaloMs);
    const aoFocar = () => recarregar();
    window.addEventListener('focus', aoFocar);

    const juntado = rajada(() => recarregar(), 400);
    const pararDeOuvir = assinar(() => juntado.disparar());

    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', aoFocar);
      pararDeOuvir();
      juntado.cancelar();
    };
  }, [recarregar, intervaloMs]);
}
