/**
 * Ids de modelo de Gemini. Cada uno se puede cambiar con una variable de
 * entorno, sin tocar el código, por si Google retira o renombra un modelo.
 */

/** Modelo de edición de imágenes (Nano Banana 2.1). */
export const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';

/**
 * Modelo de voz (TTS). `gemini-3.8-flash-tts` es el que la doc oficial usa en sus
 * ejemplos de la API de Interacciones (guía de generación de voz) y el que el
 * changelog del 2026-09-22 presenta como disponible general. El anterior,
 * `gemini-3.1-flash-tts-preview`, sigue en la página de precios y se puede forzar
 * con ASCII_AVATAR_TTS_MODEL. La prueba en vivo (RUN_LIVE=1) lo confirma con la llave.
 */
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts';

function fromEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

/** Resuelve el modelo de imagen: `ASCII_AVATAR_IMAGE_MODEL` o el valor por defecto. */
export function resolveImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return fromEnv(env, 'ASCII_AVATAR_IMAGE_MODEL', DEFAULT_IMAGE_MODEL);
}

/** Resuelve el modelo de voz: `ASCII_AVATAR_TTS_MODEL` o el valor por defecto. */
export function resolveTtsModel(env: NodeJS.ProcessEnv = process.env): string {
  return fromEnv(env, 'ASCII_AVATAR_TTS_MODEL', DEFAULT_TTS_MODEL);
}

/** Modelo de imagen vigente según el entorno del proceso. */
export const IMAGE_MODEL: string = resolveImageModel();

/** Modelo de voz vigente según el entorno del proceso. */
export const TTS_MODEL: string = resolveTtsModel();
