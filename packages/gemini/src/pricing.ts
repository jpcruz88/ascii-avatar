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
 * Costo estimado de una imagen (cara, grabado base o pose), calibrado con el flujo grabado completo
 * corrido en vivo el 2026-10-18. Costos reales por imagen, en USD: grabado base 0.0679; caras
 * 0.0607, 0.0542, 0.0555, 0.0630, 0.0529, 0.0634, 0.0525; poses 0.0653, 0.0542, 0.0585, 0.0577,
 * 0.0662, 0.0512, 0.0786, 0.0624 (promedio ~0.060, máximo 0.079; total de las 16: 0.9642). La API
 * cobra más tokens de salida de los documentados (1300 de entrada y 1120 de salida darían 0.0356).
 * Se fija en 0.065 para que el estimado previo sea honesto: 16 imágenes = 1.04 USD, por encima de lo
 * cobrado de verdad y dentro del tope de creación.
 */
export const ESTIMATED_FACE_COST_USD = 0.065;

/** Estimación previa (antes de llamar a la API) de lo que cuesta crear `faceCount` caras. */
export function estimateCreationCostUsd(faceCount: number): number {
  return faceCount * ESTIMATED_FACE_COST_USD;
}
