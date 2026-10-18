/*
 * Quita el código de un texto markdown. Módulo hoja: no depende de nada del resto de `text/`.
 * Todo el procesamiento es lineal (sin regex con cuantificadores anidados ni sin tope).
 */

export function runLength(text: string, from: number, char: string): number {
  let end = from;
  while (end < text.length && text[end] === char) end++;
  return end - from;
}

/** Valla de código que abre en esta línea (` ``` ` o `~~~`), o `null`. */
function openingFence(trimmed: string): { char: string; length: number } | null {
  const char = trimmed[0];
  if (char !== '`' && char !== '~') return null;
  const length = runLength(trimmed, 0, char);
  if (length < 3) return null;
  // Una valla de acentos graves no lleva acentos graves en la línea: eso es código en línea.
  if (char === '`' && trimmed.includes('`', length)) return null;
  return { char, length };
}

function closesFence(trimmed: string, fence: { char: string; length: number }): boolean {
  if (trimmed[0] !== fence.char) return false;
  const length = runLength(trimmed, 0, fence.char);
  return length >= fence.length && trimmed.slice(length).trim() === '';
}

/** Quita los tramos entre rachas de acentos graves de igual longitud, y los acentos sueltos. */
function stripInlineCode(line: string): string {
  if (!line.includes('`')) return line;
  const runs: { start: number; length: number }[] = [];
  for (let i = 0; i < line.length; ) {
    if (line[i] === '`') {
      const length = runLength(line, i, '`');
      runs.push({ start: i, length });
      i += length;
    } else i++;
  }
  // Para cada racha, la siguiente de la misma longitud (una sola pasada hacia atrás).
  const next: (number | undefined)[] = new Array<number | undefined>(runs.length);
  const seen = new Map<number, number>();
  for (let k = runs.length - 1; k >= 0; k--) {
    next[k] = seen.get(runs[k]!.length);
    seen.set(runs[k]!.length, k);
  }
  let out = '';
  let cursor = 0;
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k]!;
    const close = next[k];
    out += line.slice(cursor, run.start);
    if (close === undefined) {
      cursor = run.start + run.length; // sin pareja: se descartan los acentos
    } else {
      const closing = runs[close]!;
      out += ' ';
      cursor = closing.start + closing.length;
      k = close;
    }
  }
  return out + line.slice(cursor);
}

/**
 * Líneas del texto sin bloques de código (``` y ~~~; una valla sin cerrar descarta todo lo que
 * sigue) y sin código en línea.
 */
export function codeFreeLines(text: string): string[] {
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trimStart();
    if (fence !== null) {
      if (closesFence(trimmed, fence)) fence = null;
      continue;
    }
    fence = openingFence(trimmed);
    if (fence === null) out.push(stripInlineCode(line));
  }
  return out;
}
