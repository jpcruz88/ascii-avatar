import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic.js';

const secretsFile = (root: string): string => join(root, 'secrets.json');

/**
 * Guarda la llave de Gemini en `<root>/secrets.json` con permisos 0600.
 * Vive fuera de las carpetas de los agentes para no copiarla por accidente.
 */
export function saveApiKey(root: string, key: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // `mode` de mkdir no toca una carpeta que ya existía: se fuerza aparte.
  chmodSync(root, 0o700);
  // El temporal nace con 0600 y se renombra encima, así que el archivo final
  // tiene 0600 aunque ya existiera con otros permisos.
  writeFileAtomic(secretsFile(root), `${JSON.stringify({ geminiApiKey: key })}\n`, 0o600);
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
