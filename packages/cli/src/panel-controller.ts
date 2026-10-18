import {
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
import { saveConfig, type CliConfig } from './config.js';
import type { Msg } from './ipc.js';
import type { AudioPlayer, Playback } from './player.js';

/** Cuánto tiempo se muestra un aviso, en ms. */
const NOTICE_TTL_MS = 10_000;

export const NOTICE_NO_KEY = 'Voz no disponible: falta la llave de Gemini';
export const NOTICE_LIMIT = 'Límite diario de voz alcanzado';
const NOTICE_REFUSED = 'Gemini rechazó el texto; sin voz esta vez';
const NOTICE_TTS_FAILED = 'Voz no disponible: falló la síntesis';
const NOTICE_PLAYER_FAILED = 'Voz no disponible: no se pudo reproducir el audio';
const NOTICE_LEDGER_FAILED = 'No se pudo registrar el gasto de voz';

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
  /** Reloj monótono en ms que arranca cerca de 0 (`performance.now`); es el que consume el animador. */
  now: () => number;
}

/** Une mensajes del canal, animador, voz y gasto. `handle` procesa de a un mensaje, en orden de llegada. */
export class PanelController {
  private queue: Promise<void> = Promise.resolve();
  private playback: Playback | null = null;
  private current: { text: string; untilMs: number } | null = null;

  constructor(private readonly d: PanelControllerDeps) {}

  handle(m: Msg): Promise<void> {
    const run = this.queue.then(() => this.process(m));
    this.queue = run.catch(() => undefined);
    return run;
  }

  notice(): string | null {
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

  /** Enciende o apaga la voz y lo recuerda en el archivo de configuración. */
  setVoice(on: boolean): void {
    this.d.config.voice = on;
    this.current = null;
    try {
      saveConfig(this.d.root, this.d.config);
    } catch {
      this.setNotice('No se pudo guardar la configuración');
    }
  }

  /** Detiene el audio en curso (al cerrar el panel). */
  stopAudio(): void {
    this.playback?.stop();
    this.playback = null;
  }

  private async process(m: Msg): Promise<void> {
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
    if (this.d.tts === null) return this.gesture(summary, expression, NOTICE_NO_KEY);
    if (this.d.ledger.spentToday() >= this.d.config.dailyLimitUsd) {
      return this.gesture(summary, expression, NOTICE_LIMIT);
    }

    let result;
    try {
      result = await synthesizeSpeech(this.d.tts, summary, this.d.voice ?? DEFAULT_VOICE);
    } catch (error) {
      // Sin reintento automático; el mensaje del error no se muestra (podría traer datos de la API).
      const notice = error instanceof SpeechRefusedError ? NOTICE_REFUSED : NOTICE_TTS_FAILED;
      return this.gesture(summary, expression, notice);
    }

    try {
      this.d.ledger.record('voice', this.d.agent, result.costUsd);
    } catch {
      this.setNotice(NOTICE_LEDGER_FAILED);
    }

    let steps: MouthStep[];
    let durationMs: number;
    try {
      const { sampleRate, samples } = parseWav(result.wav);
      steps = mouthTimeline(samples, sampleRate);
      durationMs = (samples.length / sampleRate) * 1000;
      this.startPlayback(result.wav);
    } catch {
      return this.gesture(summary, expression, NOTICE_PLAYER_FAILED);
    }
    this.d.animator.say(this.d.now(), { steps, durationMs, expression });
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
