// Avisos sonoros da fila e dos chamados. Feitos com Web Audio (sem arquivo de áudio).
// A preferência é de cada aparelho (localStorage) e começa desligada.

export type TipoSom = 'novoPedido' | 'pronto' | 'chamado' | 'atraso';

const CHAVE_SOM = 'sistema-restaurante-som';

let contexto: AudioContext | null = null;

export function somLigado(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_SOM) === '1';
  } catch {
    return false;
  }
}

export function ligarSom(ligado: boolean): void {
  try {
    window.localStorage.setItem(CHAVE_SOM, ligado ? '1' : '0');
  } catch {
    // Sem armazenamento local, a escolha vale só enquanto a tela estiver aberta.
  }
}

// Cria ou retoma o áudio. Os navegadores só deixam tocar depois de um gesto da pessoa:
// chamar no clique que liga o som.
export function destravarSom(): void {
  try {
    if (!contexto) {
      const Contexto =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Contexto) return;
      contexto = new Contexto();
    }
    if (contexto.state === 'suspended') {
      void contexto.resume().catch(() => undefined);
    }
  } catch {
    // Sem áudio: a tela segue normal.
  }
}

// Uma nota com subida e descida suaves (sem estalo).
function nota(ctx: AudioContext, freq: number, inicio: number, duracao: number, onda: OscillatorType, pico: number): void {
  const quando = ctx.currentTime + inicio;
  const oscilador = ctx.createOscillator();
  const volume = ctx.createGain();
  oscilador.type = onda;
  oscilador.frequency.value = freq;
  volume.gain.setValueAtTime(0.0001, quando);
  volume.gain.exponentialRampToValueAtTime(pico, quando + 0.02);
  volume.gain.exponentialRampToValueAtTime(0.0001, quando + duracao);
  oscilador.connect(volume).connect(ctx.destination);
  oscilador.start(quando);
  oscilador.stop(quando + duracao + 0.02);
  oscilador.onended = () => {
    oscilador.disconnect();
    volume.disconnect();
  };
}

function reproduzir(ctx: AudioContext, tipo: TipoSom): void {
  switch (tipo) {
    case 'novoPedido':
      // Dois toques agudos.
      nota(ctx, 1320, 0, 0.12, 'sine', 0.2);
      nota(ctx, 1320, 0.2, 0.12, 'sine', 0.2);
      return;
    case 'pronto':
      // Três notas subindo.
      nota(ctx, 523, 0, 0.14, 'triangle', 0.2);
      nota(ctx, 659, 0.15, 0.14, 'triangle', 0.2);
      nota(ctx, 784, 0.3, 0.2, 'triangle', 0.2);
      return;
    case 'chamado':
      // Dois toques graves.
      nota(ctx, 330, 0, 0.15, 'sine', 0.22);
      nota(ctx, 330, 0.25, 0.15, 'sine', 0.22);
      return;
    case 'atraso':
      // Um toque longo e grave.
      nota(ctx, 196, 0, 0.9, 'triangle', 0.16);
      return;
  }
}

export interface OpcoesTocar {
  // Toca mesmo com a preferência de som desligada (ex.: chamado de mesa para o garçom).
  sempre?: boolean;
}

// Toca um aviso. Sem som ligado (e sem `sempre`), ou se o navegador não deixar, não faz nada e não lança erro.
export function tocar(tipo: TipoSom, opcoes?: OpcoesTocar): void {
  try {
    if (!opcoes?.sempre && !somLigado()) return;
    destravarSom();
    if (!contexto) return;
    const ctx = contexto;
    if (ctx.state === 'suspended') {
      // Toca quando o navegador liberar o áudio.
      void ctx.resume().then(() => reproduzir(ctx, tipo)).catch(() => undefined);
      return;
    }
    reproduzir(ctx, tipo);
  } catch {
    // Sem áudio: nada a fazer.
  }
}
