import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const secretsFile = (root: string): string => join(root, 'secrets.json');

/**
 * Guarda la llave de Gemini en `<root>/secrets.json` con permisos 0600.
 * Vive fuera de las carpetas de los agentes para no copiarla por accidente.
 */
export function saveApiKey(root: string, key: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = secretsFile(root);
  writeFileSync(file, `${JSON.stringify({ geminiApiKey: key })}\n`, { mode: 0o600 });
  // `mode` solo aplica al crear el archivo; esto cubre el caso de que ya existiera.
  chmodSync(file, 0o600);
}

/** Primero `GEMINI_API_KEY` (si no está vacía), luego el archivo; si no hay, `undefined`. */
export function loadApiKey(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.GEMINI_API_KEY;
  if (fromEnv) return fromEnv;
  try {
    const parsed: unknown = JSON.parse(readFileSync(secretsFile(root), 'utf8'));
    const key = (parsed as { geminiApiKey?: unknown } | null)?.geminiApiKey;
    return typeof key === 'string' && key !== '' ? key : undefined;
  } catch {
    return undefined;
  }
}
