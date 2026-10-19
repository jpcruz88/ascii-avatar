import { GoogleGenAI } from '@google/genai';
import { parseWav } from '@ascii-avatar/core';
import type { GeminiConfig } from './config.js';
import {
  extractUsage,
  refusalDetail,
  type InteractionResultBase,
  type InteractionsApi,
} from './interactions.js';
import { TTS_RATES } from './pricing.js';

/** Voz por defecto de la API de voz de Gemini. */
export const DEFAULT_VOICE = 'Kore';

/** Frecuencia de muestreo que se pide: la que espera el movimiento de boca. */
export const TTS_SAMPLE_RATE = 24_000;

/** Tiempo máximo de espera de una síntesis: pasado esto se abandona (sin audio no se registra gasto). */
export const DEFAULT_TTS_TIMEOUT_MS = 25_000;

/** Costo conservador cuando no hay tokens de uso ni se puede medir el WAV. */
export const FALLBACK_SPEECH_COST_USD = 0.01;

export interface SpeechInput {
  text: string;
  voice: string;
  /** Cómo debe sonar la voz (texto libre). Vacío o ausente: Gemini usa su estilo por defecto. */
  style?: string;
  /** Cancela la síntesis (por ejemplo, si ya nadie la va a oír). */
  signal?: AbortSignal;
}

export interface SpeechResult {
  /** WAV PCM de 16 bits, mono, a 24 kHz. */
  wav: Buffer;
  /** `null` si la API no informó el uso (o solo informó una de las dos cifras). */
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Gemini respondió sin audio: casi siempre es un rechazo de contenido (filtro de
 * seguridad). Los errores de red o del SDK no se envuelven en esta clase: llegan
 * tal cual para distinguirlos con `instanceof`.
 */
export class SpeechRefusedError extends Error {
  /** Texto, estado o errores que expuso la interacción, si hay alguno. */
  readonly detail: string | undefined;

  constructor(detail?: string) {
    super('Gemini no devolvió ningún audio (probable rechazo de contenido).');
    this.name = 'SpeechRefusedError';
    this.detail = detail;
  }
}

/** Gemini no respondió dentro del tiempo máximo: no hay audio y no se cobra nada aquí. */
export class SpeechTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Gemini no respondió la voz en ${Math.round(timeoutMs / 1000)} s.`);
    this.name = 'SpeechTimeoutError';
  }
}

/** Error con el que se rechaza una síntesis cancelada por quien la pidió. */
function abortError(): Error {
  const error = new Error('Síntesis de voz cancelada.');
  error.name = 'AbortError';
  return error;
}

/** Costura para poder probar sin red: el panel usa `createGeminiTtsClient`. */
export interface TtsClient {
  speak(input: SpeechInput): Promise<SpeechResult>;
}

interface SpeechInteraction extends InteractionResultBase {
  output_audio?: { data?: string };
}

export function createGeminiTtsClient(
  cfg: GeminiConfig,
  ai: InteractionsApi = new GoogleGenAI({ apiKey: cfg.apiKey }),
  opts: { timeoutMs?: number } = {},
): TtsClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;
  return {
    async speak({ text, voice, style, signal }) {
      if (signal?.aborted) throw abortError();
      const annotations =
        style !== undefined && style.trim() !== ''
          ? { annotations: [{ type: 'speech_metadata', style }] }
          : {};
      // Una sola señal para el SDK: se aborta al vencer el tiempo o si quien la pidió cancela. La
      // carrera con el temporizador garantiza el tiempo máximo aunque el SDK ignorara la señal.
      const abort = new AbortController();
      let fail: (error: Error) => void = () => undefined;
      const stopped = new Promise<never>((_resolve, reject) => (fail = reject));
      const timer = setTimeout(() => {
        abort.abort();
        fail(new SpeechTimeoutError(timeoutMs));
      }, timeoutMs);
      const onCancel = (): void => {
        abort.abort();
        fail(abortError());
      };
      signal?.addEventListener('abort', onCancel, { once: true });
      let result: SpeechInteraction;
      try {
        result = (await Promise.race([
          ai.interactions.create(
            {
              model: cfg.ttsModel,
              input: [{ type: 'user_input', content: [{ type: 'text', text, ...annotations }] }],
              response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: TTS_SAMPLE_RATE },
              generation_config: { speech_config: [{ voice }] },
            },
            { signal: abort.signal, timeout_ms: timeoutMs },
          ),
          stopped,
        ])) as SpeechInteraction;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onCancel);
      }

      const data = result.output_audio?.data;
      const wav = data === undefined ? Buffer.alloc(0) : Buffer.from(data, 'base64');
      // Sin datos, o datos que decodifican a cero bytes, no hay audio que reproducir ni cobrar.
      if (wav.length === 0) throw new SpeechRefusedError(refusalDetail(result));

      const { inputTokens, outputTokens } = extractUsage(result.usage);
      return {
        wav,
        inputTokens,
        outputTokens,
      };
    },
  };
}

/** Costo real en dólares de una síntesis, según los tokens que reporta la API. */
export function ttsCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * TTS_RATES.inputPerMTok + outputTokens * TTS_RATES.outputAudioPerMTok) / 1_000_000
  );
}

/**
 * Estimación cuando la API no informó el uso: el audio se cobra a 25 tokens por
 * segundo y el texto a ~4 caracteres por token. Si el WAV no se puede leer, se
 * devuelve un costo fijo y conservador.
 */
function estimateSpeechCostUsd(wav: Buffer, text: string): number {
  try {
    const { sampleRate, samples } = parseWav(wav);
    if (samples.length === 0) return FALLBACK_SPEECH_COST_USD;
    const seconds = samples.length / sampleRate;
    const outputTokens = seconds * TTS_RATES.audioTokensPerSecond;
    const inputTokens = Math.ceil(text.length / 4);
    const cost = ttsCostUsd(inputTokens, outputTokens);
    return Number.isFinite(cost) ? cost : FALLBACK_SPEECH_COST_USD;
  } catch {
    return FALLBACK_SPEECH_COST_USD;
  }
}

/**
 * Convierte `text` en voz. El costo sale de los tokens de uso; si la API no los
 * informó, se devuelve la estimación con `costEstimated: true`. Rechaza el texto
 * vacío sin llamar a la API: sería pagar por silencio.
 */
export async function synthesizeSpeech(
  client: TtsClient,
  text: string,
  voice: string,
  style?: string,
  signal?: AbortSignal,
): Promise<{ wav: Buffer; costUsd: number; costEstimated: boolean }> {
  if (text.trim() === '') {
    throw new Error('No hay texto que sintetizar: el texto está vacío.');
  }
  const { wav, inputTokens, outputTokens } = await client.speak({
    text,
    voice,
    ...(style === undefined ? {} : { style }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (inputTokens === null || outputTokens === null) {
    return { wav, costUsd: estimateSpeechCostUsd(wav, text), costEstimated: true };
  }
  return { wav, costUsd: ttsCostUsd(inputTokens, outputTokens), costEstimated: false };
}
