import {
  Animator,
  SPEECH_LEAD_IN_MS,
  mouthTimeline,
  parseWav,
  pickExpression,
  spokenSummary,
  syntheticMouthTimeline,
  type ExpressionId,
  type Motion,
  type MouthStep,
} from '@ascii-avatar/core/browser';

/** Audio ya decodificado, listo para sonar. */
export interface Prepared {
  /** Empieza a sonar dentro de `delayMs` (agendado por el reloj de audio, no por un temporizador). */
  start(delayMs: number): void;
  stop(): void;
}

/** Salida de audio (Web Audio en el navegador; una falsa en las pruebas). */
export interface AudioOut {
  /** Crea o reanuda el contexto de audio; conviene llamarlo durante un gesto del usuario. */
  unlock(): void;
  /** Cuánto tarda en oírse lo que se manda a sonar, en ms. */
  latencyMs(): number;
  prepare(wav: ArrayBuffer): Promise<Prepared>;
  /** Libera el contexto de audio (al quitar el elemento de la página). */
  close?(): void;
}

export interface TtsRequest {
  text: string;
  voice: string;
  style?: string;
}

/**
 * Pide la voz (un WAV) para un texto; lanza con un mensaje legible si no se pudo. `signal` se aborta
 * si ya nadie la va a oír (otro `say` o `stop`): conviene cancelar la petición para no pagarla.
 */
export type TtsFetch = (req: TtsRequest, signal?: AbortSignal) => Promise<ArrayBuffer>;

export type EngineEvent = 'hablando' | 'fin' | 'aviso';

export interface EngineDeps {
  /** Texto de cada cuadro por su id (ver `parseWebExport`). */
  frames: ReadonlyMap<string, string>;
  /** Poses y clips que tiene el agente. */
  motion: Motion;
  /** Reloj monótono en ms que arranca cerca de 0 (como `performance.now`). */
  now: () => number;
  /** Programa `fn` dentro de `ms`; devuelve con qué cancelarlo. Por defecto `setTimeout`. */
  schedule?: (ms: number, fn: () => void) => () => void;
  rng?: () => number;
  voice: string;
  voiceStyle?: string;
  /** Sin `tts` o sin `audio`, el avatar solo gesticula (boca sintética). */
  tts?: TtsFetch | null;
  audio?: AudioOut | null;
  onEvent?: (type: EngineEvent, detail?: unknown) => void;
}

export const NOTICE_TTS_FAILED = 'Voz no disponible: falló la síntesis';
export const NOTICE_AUDIO_FAILED = 'Voz no disponible: no se pudo reproducir el audio';

/**
 * Cuándo lanzar el audio tras `say`: el animador muestra primero la expresión (`SPEECH_LEAD_IN_MS`)
 * y la boca empieza con el audio, así que se lanza la latencia de salida antes, como hace el panel
 * con `afplay`. Una latencia inválida cuenta como 0.
 */
export function audioStartDelayMs(latencyMs: number): number {
  const latency = Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0;
  return Math.max(0, SPEECH_LEAD_IN_MS - latency);
}

const defaultSchedule = (ms: number, fn: () => void): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

interface Speech {
  id: number;
  resolve: () => void;
  /** Ya se avisó `hablando`: al terminar o cortarse se avisa `fin`. */
  announced: boolean;
  cancelEnd: () => void;
  prepared: Prepared | null;
  /** Cancela la petición de voz en curso. */
  abort: AbortController;
}

/**
 * El mismo motor que el panel, sin terminal: anima con `Animator` y decide la voz y la boca como
 * `PanelController` (resumen hablado, expresión, boca del audio o sintética, audio lanzado al
 * terminar el avance de la expresión). No toca el DOM: el elemento le pide el texto del cuadro.
 */
export class AvatarEngine {
  private readonly animator: Animator;
  private readonly schedule: (ms: number, fn: () => void) => () => void;
  private current: Speech | null = null;
  private seq = 0;

  constructor(private readonly d: EngineDeps) {
    this.animator = new Animator({ motion: d.motion, ...(d.rng === undefined ? {} : { rng: d.rng }) });
    this.animator.idle(d.now());
    this.schedule = d.schedule ?? defaultSchedule;
  }

  /** Texto del cuadro de ahora; un cuadro que no está en el paquete se dibuja como neutral. */
  frameText(): string {
    const id = this.animator.frame(this.d.now());
    return this.d.frames.get(id) ?? this.d.frames.get('neutral') ?? '';
  }

  speaking(): boolean {
    return this.animator.speaking(this.d.now());
  }

  /** Si conviene dibujar a 24 fps (hablando o en un clip). */
  fast(): boolean {
    return this.animator.fastFrames(this.d.now());
  }

  /** Cambia (o quita, con `null`) la voz para lo próximo que diga. */
  setTts(tts: TtsFetch | null): void {
    this.d.tts = tts;
  }

  /** El usuario escribió algo: cara de pensar (se ignora si ya está hablando). */
  think(): void {
    this.animator.thinking(this.d.now());
  }

  /** Corta lo que esté diciendo y vuelve a reposo. */
  stop(): void {
    const had = this.current !== null;
    this.finish(this.current);
    if (had) this.animator.idle(this.d.now());
  }

  /** Dice `text` (su resumen hablado); resuelve cuando termina o cuando otro `say`/`stop` lo corta. */
  say(text: string): Promise<void> {
    this.finish(this.current);
    return new Promise<void>((resolve) => {
      const speech: Speech = {
        id: ++this.seq,
        resolve,
        announced: false,
        cancelEnd: () => undefined,
        prepared: null,
        abort: new AbortController(),
      };
      this.current = speech;
      // Pase lo que pase dentro, `say` siempre resuelve.
      this.run(speech, text).catch(() => this.finish(speech));
    });
  }

  private async run(speech: Speech, text: string): Promise<void> {
    const summary = spokenSummary(text);
    const expression = pickExpression(text);
    const { tts, audio } = this.d;
    if (summary === '' || tts == null || audio == null) return this.gesture(speech, summary, expression);

    audio.unlock();
    // Mientras llega la voz, cara de pensar.
    this.animator.thinking(this.d.now());
    let data: ArrayBuffer;
    try {
      const req = { text: summary, voice: this.d.voice, ...(this.d.voiceStyle ? { style: this.d.voiceStyle } : {}) };
      data = await tts(req, speech.abort.signal);
    } catch (error) {
      if (!this.live(speech)) return;
      const message = error instanceof Error && error.message !== '' ? error.message : NOTICE_TTS_FAILED;
      return this.gesture(speech, summary, expression, message);
    }
    if (!this.live(speech)) return;

    let steps: MouthStep[];
    let durationMs: number;
    let prepared: Prepared;
    try {
      const { sampleRate, samples } = parseWav(new Uint8Array(data));
      steps = mouthTimeline(samples, sampleRate);
      durationMs = (samples.length / sampleRate) * 1000;
      // `decodeAudioData` se queda con el búfer: se le pasa una copia.
      prepared = await audio.prepare(data.slice(0));
    } catch {
      if (!this.live(speech)) return;
      return this.gesture(speech, summary, expression, NOTICE_AUDIO_FAILED);
    }
    if (!this.live(speech)) return;

    speech.prepared = prepared;
    this.animator.say(this.d.now(), { steps, durationMs, expression });
    try {
      prepared.start(audioStartDelayMs(audio.latencyMs()));
    } catch {
      // La boca ya se mueve con el audio: sigue sin sonido, como un gesto.
      this.notice(NOTICE_AUDIO_FAILED);
    }
    this.announce(speech, summary, true, durationMs);
  }

  /** Solo gesto: la boca se mueve con el texto y no suena nada. */
  private gesture(speech: Speech, summary: string, expression: ExpressionId, notice?: string): void {
    if (notice !== undefined) this.notice(notice);
    const { steps, durationMs } = syntheticMouthTimeline(summary);
    this.animator.say(this.d.now(), { steps, durationMs, expression });
    this.announce(speech, summary, false, durationMs);
  }

  private announce(speech: Speech, summary: string, voz: boolean, durationMs: number): void {
    speech.announced = true;
    this.d.onEvent?.('hablando', { texto: summary, voz });
    speech.cancelEnd = this.schedule(SPEECH_LEAD_IN_MS + Math.max(0, durationMs), () => this.finish(speech));
  }

  private notice(mensaje: string): void {
    this.d.onEvent?.('aviso', { mensaje });
  }

  private live(speech: Speech): boolean {
    return this.current === speech;
  }

  /** Termina `speech` (si sigue vigente): calla su audio, avisa `fin` si había empezado y resuelve. */
  private finish(speech: Speech | null): void {
    if (speech === null || this.current !== speech) return;
    this.current = null;
    speech.cancelEnd();
    speech.abort.abort();
    try {
      speech.prepared?.stop();
    } catch {
      // Ya no sonaba.
    }
    if (speech.announced) this.d.onEvent?.('fin');
    speech.resolve();
  }
}
