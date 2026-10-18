/**
 * Tarifas de la API de Gemini, en dólares por millón de tokens.
 * Fuente: https://ai.google.dev/gemini-api/docs/pricing (verificadas el 2026-10-18).
 * Si Google las cambia, se actualizan aquí: es el único lugar donde viven.
 */

/** Tarifas de Nano Banana 2.1: entrada (texto e imagen) y salida de imagen. */
export const IMAGE_RATES = {
  inputPerMTok: 1.5,
  outputImagePerMTok: 30,
} as const;

/** Tarifas de la voz (TTS): entrada de texto, salida de audio y tokens por segundo de audio. */
export const TTS_RATES = {
  inputPerMTok: 1.0,
  outputAudioPerMTok: 20,
  audioTokensPerSecond: 25,
} as const;

/** Costo real en dólares de una edición de imagen, según los tokens que reporta la API. */
export function imageCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * IMAGE_RATES.inputPerMTok + outputTokens * IMAGE_RATES.outputImagePerMTok) /
    1_000_000
  );
}

/** Costo estimado de una cara: foto de entrada (~1300 tokens) y una imagen de 1K (1120 tokens). */
export const ESTIMATED_FACE_COST_USD: number = imageCostUsd(1300, 1120);

/** Estimación previa (antes de llamar a la API) de lo que cuesta crear `faceCount` caras. */
export function estimateCreationCostUsd(faceCount: number): number {
  return faceCount * ESTIMATED_FACE_COST_USD;
}
