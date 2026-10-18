/**
 * Ids de modelo de Gemini. Cada uno se puede cambiar con una variable de
 * entorno, sin tocar el código, por si Google retira o renombra un modelo.
 */

/** Modelo de edición de imágenes (Nano Banana 2.1). */
export const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';

/**
 * Modelo de voz (TTS). Este id aún no se ha verificado contra la doc oficial:
 * se confirma al construir la voz (Task 10). Mientras tanto se puede forzar con
 * ASCII_AVATAR_TTS_MODEL.
 */
export const DEFAULT_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

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
