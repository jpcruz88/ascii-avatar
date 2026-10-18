import { GoogleGenAI } from '@google/genai';
import { parseWav } from '@ascii-avatar/core';
import type { GeminiConfig } from './config.js';
import type { InteractionsApi } from './images.js';
import { TTS_RATES } from './pricing.js';

/** Voz por defecto de la API de voz de Gemini. */
export const DEFAULT_VOICE = 'Kore';

/** Frecuencia de muestreo que se pide: la que espera el movimiento de boca. */
export const TTS_SAMPLE_RATE = 24_000;

/** Costo conservador cuando no hay tokens de uso ni se puede medir el WAV. */
export const FALLBACK_SPEECH_COST_USD = 0.01;

export interface SpeechInput {
  text: string;
  voice: string;
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

/** Costura para poder probar sin red: el panel usa `createGeminiTtsClient`. */
export interface TtsClient {
  speak(input: SpeechInput): Promise<SpeechResult>;
}

interface SpeechInteraction {
  output_audio?: { data?: string };
  output_text?: string;
  status?: string;
  errors?: Array<{ code?: string; message?: string }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
  };
}

function refusalDetail(result: SpeechInteraction): string | undefined {
  const parts: string[] = [];
  if (result.output_text) parts.push(result.output_text);
  if (result.status && result.status !== 'completed') parts.push(`estado: ${result.status}`);
  for (const e of result.errors ?? []) {
    const text = [e.code, e.message].filter(Boolean).join(': ');
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' | ') : undefined;
}

export function createGeminiTtsClient(
  cfg: GeminiConfig,
  ai: InteractionsApi = new GoogleGenAI({ apiKey: cfg.apiKey }),
): TtsClient {
  return {
    async speak({ text, voice }) {
      const result = (await ai.interactions.create({
        model: cfg.ttsModel,
        input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
        response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: TTS_SAMPLE_RATE },
        generation_config: { speech_config: [{ voice }] },
      })) as SpeechInteraction;

      const data = result.output_audio?.data;
      if (data === undefined || data === '') throw new SpeechRefusedError(refusalDetail(result));

      // Sin uso no se pierde un audio ya pagado: los tokens faltantes van en null.
      // Los tokens de pensamiento (si los hubiera) se suman a la salida: si
      // `total_output_tokens` ya los incluyera se sobrestima, lo cual es seguro para el tope.
      const usage = result.usage;
      const outputTokens =
        usage?.total_output_tokens === undefined
          ? null
          : usage.total_output_tokens + (usage.total_thought_tokens ?? 0);
      return {
        wav: Buffer.from(data, 'base64'),
        inputTokens: usage?.total_input_tokens ?? null,
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
): Promise<{ wav: Buffer; costUsd: number; costEstimated: boolean }> {
  if (text.trim() === '') {
    throw new Error('No hay texto que sintetizar: el texto está vacío.');
  }
  const { wav, inputTokens, outputTokens } = await client.speak({ text, voice });
  if (inputTokens === null || outputTokens === null) {
    return { wav, costUsd: estimateSpeechCostUsd(wav, text), costEstimated: true };
  }
  return { wav, costUsd: ttsCostUsd(inputTokens, outputTokens), costEstimated: false };
}
