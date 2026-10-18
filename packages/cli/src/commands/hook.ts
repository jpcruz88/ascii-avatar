import { socketPath } from '../config.js';
import { sendIfListening, type Msg } from '../ipc.js';

/** Espera máxima para entregar el mensaje al panel; el hook entero debe salir en menos de 500 ms. */
const SEND_TIMEOUT_MS = 200;

/** Tope de caracteres del texto: una línea del canal admite 64 KiB y un carácter puede ocupar hasta 3 bytes. */
const MAX_TEXT_CHARS = 16_000;

/**
 * Convierte el JSON que Claude Code manda por stdin en un mensaje para el panel.
 * `Stop` con `last_assistant_message` no vacío → `say`; `UserPromptSubmit` → `thinking`;
 * cualquier otra cosa (o JSON inválido) → `null`.
 */
export function extractHookMessage(stdin: string): Msg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (input.hook_event_name === 'UserPromptSubmit') return { type: 'thinking' };
  if (input.hook_event_name === 'Stop') {
    const text = input.last_assistant_message;
    if (typeof text !== 'string' || text.trim() === '') return null;
    return { type: 'say', text: text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text };
  }
  return null;
}

/** Entrega el mensaje del hook al panel si está abierto. Nunca lanza y siempre resuelve `0`. */
export async function runHook(stdin: string, root: string): Promise<0> {
  try {
    const msg = extractHookMessage(stdin);
    if (msg !== null) await sendIfListening(socketPath(root), msg, SEND_TIMEOUT_MS);
  } catch {
    // El hook nunca debe romper a Claude Code.
  }
  return 0;
}
