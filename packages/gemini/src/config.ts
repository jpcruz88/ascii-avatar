import { resolveImageModel, resolveTtsModel } from './models.js';

export interface GeminiConfig {
  apiKey: string;
  imageModel: string;
  ttsModel: string;
}

/** No hay llave de la API de Gemini ni en el entorno ni guardada por la CLI. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'Falta la llave de Gemini. Define GEMINI_API_KEY o guárdala con el comando de configuración.',
    );
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Arma la configuración de Gemini. La llave explícita (`apiKey`, p. ej. la que
 * la CLI guardó en su archivo de secretos) tiene prioridad sobre
 * `env.GEMINI_API_KEY`. La llave nunca se guarda en el repo.
 */
export function loadGeminiConfig(
  env: NodeJS.ProcessEnv = process.env,
  apiKey?: string,
): GeminiConfig {
  const key = apiKey !== undefined && apiKey !== '' ? apiKey : env['GEMINI_API_KEY'];
  if (key === undefined || key === '') throw new MissingApiKeyError();
  return { apiKey: key, imageModel: resolveImageModel(env), ttsModel: resolveTtsModel(env) };
}
