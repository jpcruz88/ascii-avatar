import type { MouthLevel, MouthStep } from '../audio/mouth.js';
import type { ExpressionId, FaceId } from '../faces.js';

/** Cuánto dura la cara de parpadeo. */
const BLINK_MS = 150;
/** Al empezar a hablar se muestra la expresión antes de mover la boca. */
const LEAD_IN_MS = 500;
/** Al terminar de hablar se mantiene la expresión antes de volver a reposo. */
const HOLD_MS = 3000;
/** Rango [mínimo, máximo] en ms entre parpadeos, según el modo de reposo. */
const BLINK_EVERY_MS = { idle: [3000, 6000], thinking: [1500, 2500] } as const;

const MOUTH_FACE: Record<MouthLevel, FaceId> = {
  closed: 'neutral',
  mid: 'mouth_mid',
  open: 'mouth_open',
};

export interface AnimatorOptions {
  /** Fuente de números en [0, 1). Por defecto `Math.random`; en pruebas se inyecta una fija. */
  rng?: () => number;
}

export interface SayOptions {
  steps: MouthStep[];
  durationMs: number;
  expression: ExpressionId;
}

type RestMode = keyof typeof BLINK_EVERY_MS;

type Rest = { kind: 'rest'; mode: RestMode; nextBlinkMs: number };
type Speech = { kind: 'speech'; startMs: number; say: SayOptions };
type State = Rest | Speech;

/**
 * Máquina de estados de la cara. Es pura: el tiempo solo entra por los argumentos `nowMs`
 * (reloj monótono, en ms) y un `nowMs` menor al último visto se trata como igual a este.
 * Los parpadeos se agendan desde el inicio del anterior (o desde que se entra al reposo)
 * y `frame` pone la agenda al día aunque pase mucho tiempo entre llamadas.
 */
export class Animator {
  private readonly rng: () => number;
  private lastMs = 0;
  private state: State;

  constructor({ rng = Math.random }: AnimatorOptions = {}) {
    this.rng = rng;
    this.state = this.rest('idle', 0);
  }

  /** El usuario envió un mensaje; se ignora si la respuesta ya está sonando. */
  thinking(nowMs: number): void {
    const t = this.tick(nowMs);
    if (this.state.kind === 'speech' && t < this.speechEndMs(this.state)) return;
    this.state = this.rest('thinking', t);
  }

  /** Llegó la respuesta; reemplaza cualquier habla en curso. */
  say(nowMs: number, say: SayOptions): void {
    this.state = { kind: 'speech', startMs: this.tick(nowMs), say };
  }

  idle(nowMs: number): void {
    this.state = this.rest('idle', this.tick(nowMs));
  }

  frame(nowMs: number): FaceId {
    const t = this.tick(nowMs);
    let state = this.state;
    if (state.kind === 'speech') {
      const holdEndMs = this.speechEndMs(state) + HOLD_MS;
      if (t < holdEndMs) return this.speechFace(state, t);
      state = this.state = this.rest('idle', holdEndMs);
    }
    return this.restFace(state, t);
  }

  private tick(nowMs: number): number {
    this.lastMs = Math.max(this.lastMs, nowMs);
    return this.lastMs;
  }

  private speechEndMs({ startMs, say }: Speech): number {
    return startMs + LEAD_IN_MS + Math.max(0, say.durationMs);
  }

  /** Cara durante el habla y la espera posterior (la expresión, o la boca entre medias). */
  private speechFace(speech: Speech, t: number): FaceId {
    const { startMs, say } = speech;
    const elapsed = t - startMs - LEAD_IN_MS;
    if (elapsed < 0 || t >= this.speechEndMs(speech)) return say.expression;
    let level: MouthLevel = 'closed';
    for (const step of say.steps) {
      if (step.tMs > elapsed) break;
      level = step.level;
    }
    return MOUTH_FACE[level];
  }

  private rest(mode: RestMode, sinceMs: number): Rest {
    return { kind: 'rest', mode, nextBlinkMs: sinceMs + this.blinkInterval(mode) };
  }

  private blinkInterval(mode: RestMode): number {
    const [min, max] = BLINK_EVERY_MS[mode];
    return min + this.rng() * (max - min);
  }

  private restFace(state: Rest, t: number): FaceId {
    while (t >= state.nextBlinkMs + BLINK_MS) {
      state.nextBlinkMs += this.blinkInterval(state.mode);
    }
    return t >= state.nextBlinkMs ? 'blink' : 'neutral';
  }
}
