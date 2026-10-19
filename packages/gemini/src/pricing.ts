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

/**
 * Tarifas de la voz (TTS): entrada de texto, salida de audio y tokens por segundo de audio.
 * Para `gemini-3.8-flash-tts` la página de precios indica $0.50 / $9.00 por millón hasta el
 * 2026-12-31 y $1.00 / $18.00 desde el 2027-01-01; estas cifras quedan por encima, así que
 * el registro de gasto sobrestima un poco (lado seguro para el tope diario).
 */
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

/**
 * Costo estimado de una cara, calibrado con la corrida en vivo del 2026-10-18: 8 caras costaron
 * $0.4203 (~$0.0525 por cara, 47% más que los $0.0356 que daban 1300 tokens de entrada y 1120 de
 * salida: la API cobra más tokens de salida de los documentados). Se redondea hacia arriba a
 * $0.055 para que el estimado previo nunca quede por debajo de lo que se cobra de verdad.
 */
export const ESTIMATED_FACE_COST_USD = 0.055;

/** Estimación previa (antes de llamar a la API) de lo que cuesta crear `faceCount` caras. */
export function estimateCreationCostUsd(faceCount: number): number {
  return faceCount * ESTIMATED_FACE_COST_USD;
}
