import { MAX_LINE_BYTES, sendIfListening, type Msg } from '../ipc.js';
import { socketPath } from '../paths.js';

/** Espera máxima para entregar el mensaje al panel; el hook entero debe salir en menos de 500 ms. */
const SEND_TIMEOUT_MS = 200;

/** ¿Cabe el mensaje `say` (más el salto de línea) en una línea del canal? */
const fits = (text: string): boolean =>
  Buffer.byteLength(JSON.stringify({ type: 'say', text })) + 1 <= MAX_LINE_BYTES;

/** Recorta `text` por puntos de código (nunca parte un par sustituto) hasta que el mensaje quepa en una línea. */
function fitText(text: string): string {
  if (fits(text)) return text;
  const points = Array.from(text);
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(points.slice(0, mid).join(''))) lo = mid;
    else hi = mid - 1;
  }
  return points.slice(0, lo).join('');
}

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
    return { type: 'say', text: fitText(text) };
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
