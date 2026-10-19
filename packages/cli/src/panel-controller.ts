import {
  SPEECH_LEAD_IN_MS,
  formatMxn,
  mouthTimeline,
  parseWav,
  pickExpression,
  spokenSummary,
  syntheticMouthTimeline,
  type Animator,
  type ExpressionId,
  type Ledger,
  type MouthStep,
} from '@ascii-avatar/core';
import {
  DEFAULT_VOICE,
  SpeechRefusedError,
  synthesizeSpeech,
  type TtsClient,
} from '@ascii-avatar/gemini';
import { effectiveDailyLimitUsd, loadConfig, saveConfig, type CliConfig } from './config.js';
import type { Msg } from './ipc.js';
import type { AudioPlayer, Playback } from './player.js';

/**
 * El reproductor (`afplay`) empieza a sonar unas decenas de ms después de lanzarlo: el audio se
 * lanza este tanto antes de que la boca empiece a moverse, para que el sonido llegue a tiempo.
 * La boca sigue adelantándose `MOUTH_ANTICIPATION_MS` al sonido real.
 */
export const AUDIO_START_LATENCY_MS = 80;

/** Cuánto tiempo se muestra un aviso, en ms. */
const NOTICE_TTL_MS = 10_000;

export const NOTICE_NO_KEY = 'Voz no disponible: falta la llave de Gemini';
export const NOTICE_LIMIT = 'Límite diario de voz alcanzado';
const NOTICE_REFUSED = 'Gemini rechazó el texto; sin voz esta vez';
const NOTICE_TTS_FAILED = 'Voz no disponible: falló la síntesis';
const NOTICE_PLAYER_FAILED = 'Voz no disponible: no se pudo reproducir el audio';
export const NOTICE_BLOCKED = 'Voz bloqueada: no se pudo registrar el gasto';
const NOTICE_SPENT_UNREADABLE = 'No se pudo leer el gasto de hoy';

export interface PanelControllerDeps {
  root: string;
  animator: Animator;
  ledger: Ledger;
  /** `null` si no hay llave de Gemini (o no hay reproductor): la voz queda como gesto. */
  tts: TtsClient | null;
  player: AudioPlayer;
  config: CliConfig;
  agent: string;
  /** Voz de Gemini del agente; por defecto la de la API. */
  voice?: string;
  /** Estilo de voz del agente (cómo debe sonar); sin estilo, no se envía. */
  voiceStyle?: string;
  /** Reloj monótono en ms que arranca cerca de 0 (`performance.now`); es el que consume el animador. */
  now: () => number;
  /**
   * Programa `fn` dentro de `ms` milisegundos y devuelve con qué cancelarlo. Por defecto `setTimeout`;
   * en pruebas se inyecta uno controlable.
   */
  schedule?: (ms: number, fn: () => void) => () => void;
}

const defaultSchedule = (ms: number, fn: () => void): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** Une mensajes del canal, animador, voz y gasto. `handle` procesa de a un mensaje, en orden de llegada. */
export class PanelController {
  private queue: Promise<void> = Promise.resolve();
  private playback: Playback | null = null;
  /** Cancela el arranque de audio que espera a que termine el avance de la expresión. */
  private cancelPendingStart: (() => void) | null = null;
  private current: { text: string; untilMs: number } | null = null;
  /** Se cerró el panel: no se reproduce ni se anima nada más. */
  private closed = false;
  /** Un gasto no quedó registrado: la voz se bloquea hasta reiniciar el panel (el tope ya no se puede hacer cumplir). */
  private voiceBlocked = false;

  constructor(private readonly d: PanelControllerDeps) {}

  handle(m: Msg): Promise<void> {
    if (this.closed) return Promise.resolve();
    const run = this.queue.then(() => this.process(m));
    this.queue = run.catch(() => undefined);
    return run;
  }

  notice(): string | null {
    if (this.voiceBlocked) return NOTICE_BLOCKED;
    if (this.current === null) return null;
    if (this.d.now() >= this.current.untilMs) this.current = null;
    return this.current?.text ?? null;
  }

  spentToday(): number {
    return this.d.ledger.spentToday();
  }

  voiceOn(): boolean {
    return this.d.config.voice;
  }

  /** Enciende o apaga la voz y lo recuerda en el archivo, sin pisar otros cambios hechos en disco. */
  setVoice(on: boolean): void {
    this.d.config.voice = on;
    this.current = null;
    try {
      saveConfig(this.d.root, { ...loadConfig(this.d.root), voice: on });
    } catch {
      this.setNotice('No se pudo guardar la configuración');
    }
  }

  /** Cierra el panel: detiene el audio y deja de procesar mensajes. Una síntesis en vuelo se registra pero no suena. */
  close(): void {
    this.closed = true;
    this.stopAudio();
  }

  /** Detiene el audio en curso y cancela el que estaba por arrancar. */
  stopAudio(): void {
    this.cancelPendingStart?.();
    this.cancelPendingStart = null;
    this.playback?.stop();
    this.playback = null;
  }

  private async process(m: Msg): Promise<void> {
    if (this.closed) return;
    switch (m.type) {
      case 'thinking':
        this.d.animator.thinking(this.d.now());
        return;
      case 'voice':
        this.setVoice(m.on);
        return;
      case 'say':
        try {
          await this.say(m.text);
        } catch {
          // Nada de lo que pase al hablar puede tumbar el panel.
        }
    }
  }

  private async say(text: string): Promise<void> {
    this.current = null;
    this.stopAudio();
    const summary = spokenSummary(text);
    const expression = pickExpression(text);

    if (summary === '') return this.gesture('', expression);
    if (!this.d.config.voice) return this.gesture(summary, expression);
    if (this.voiceBlocked) return this.gesture(summary, expression);
    if (this.d.tts === null) return this.gesture(summary, expression, NOTICE_NO_KEY);
    let spent: number;
    try {
      spent = this.d.ledger.spentToday();
    } catch {
      return this.gesture(summary, expression, NOTICE_SPENT_UNREADABLE);
    }
    const limitUsd = effectiveDailyLimitUsd(this.d.config);
    if (spent >= limitUsd) {
      return this.gesture(summary, expression, `${NOTICE_LIMIT} (${formatMxn(limitUsd, this.d.config.mxnPorUsd)})`);
    }

    let result;
    try {
      result = await synthesizeSpeech(this.d.tts, summary, this.d.voice ?? DEFAULT_VOICE, this.d.voiceStyle);
    } catch (error) {
      // Sin reintento automático; el mensaje del error no se muestra (podría traer datos de la API).
      const notice = error instanceof SpeechRefusedError ? NOTICE_REFUSED : NOTICE_TTS_FAILED;
      return this.gesture(summary, expression, notice);
    }

    // Un costo inválido o un registro que falla dejarían gasto sin contar: se bloquea la voz.
    if (!Number.isFinite(result.costUsd) || result.costUsd < 0) {
      this.voiceBlocked = true;
    } else {
      try {
        this.d.ledger.record('voice', this.d.agent, result.costUsd);
      } catch {
        this.voiceBlocked = true;
      }
    }
    if (this.closed) return;

    let steps: MouthStep[];
    let durationMs: number;
    try {
      const { sampleRate, samples } = parseWav(result.wav);
      steps = mouthTimeline(samples, sampleRate);
      durationMs = (samples.length / sampleRate) * 1000;
    } catch {
      return this.gesture(summary, expression, NOTICE_PLAYER_FAILED);
    }
    this.d.animator.say(this.d.now(), { steps, durationMs, expression });
    this.schedulePlayback(result.wav);
  }

  /**
   * El animador muestra primero la expresión (`SPEECH_LEAD_IN_MS`) y luego mueve la boca desde el
   * inicio del audio: el reproductor se lanza `AUDIO_START_LATENCY_MS` antes, para que empiece a
   * sonar justo entonces y boca y voz vayan juntas. Cancela cualquier arranque pendiente anterior.
   */
  private schedulePlayback(wav: Buffer): void {
    this.cancelPendingStart?.();
    this.cancelPendingStart = null;
    const schedule = this.d.schedule ?? defaultSchedule;
    const pending = { cancelled: false, started: false, cancelTimer: (): void => undefined };
    const cancel = (): void => {
      pending.cancelled = true;
      pending.cancelTimer();
    };
    this.cancelPendingStart = cancel;
    pending.cancelTimer = schedule(Math.max(0, SPEECH_LEAD_IN_MS - AUDIO_START_LATENCY_MS), () => {
      if (pending.cancelled || pending.started || this.closed) return;
      pending.started = true;
      if (this.cancelPendingStart === cancel) this.cancelPendingStart = null;
      try {
        this.startPlayback(wav);
      } catch {
        // La boca ya se mueve con el audio: sigue sin sonido, como un gesto.
        this.setNotice(NOTICE_PLAYER_FAILED);
      }
    });
  }

  private startPlayback(wav: Buffer): void {
    const playback = this.d.player.play(wav);
    this.playback = playback;
    void playback.done.then(
      () => this.clearPlayback(playback),
      () => this.clearPlayback(playback),
    );
  }

  private clearPlayback(playback: Playback): void {
    if (this.playback === playback) this.playback = null;
  }

  /** Solo gesto: la boca se mueve con el texto y no suena nada. */
  private gesture(summary: string, expression: ExpressionId, notice?: string): void {
    if (notice !== undefined) this.setNotice(notice);
    const { steps, durationMs } = syntheticMouthTimeline(summary);
    this.d.animator.say(this.d.now(), { steps, durationMs, expression });
  }

  private setNotice(text: string): void {
    this.current = { text, untilMs: this.d.now() + NOTICE_TTL_MS };
  }
}
