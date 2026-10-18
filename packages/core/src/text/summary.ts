/** Máximo de caracteres que el avatar dice en voz alta por defecto. */
const DEFAULT_MAX_CHARS = 220;

/*
 * Todo el procesamiento es lineal: nada de regex con cuantificadores anidados ni sin tope, para
 * que un texto de 100 000+ caracteres no pueda disparar un backtracking catastrófico.
 */

/** Surrogates sueltos (sin su pareja). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Controles, ceros de ancho, marcas de dirección y separadores raros. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g;
/** Emoji y pictogramas (incluye ✓, flechas y dibujo de cajas). */
const PICTOGRAPH =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u200D\u20E3\u2190-\u21FF\u2500-\u259F\u2700-\u27BF]/gu;
const IMAGE = /!\[[^[\]]{0,300}\]\([^()\s]{0,1000}(?:\s+"[^"()]{0,200}")?\)/g;
const LINK = /\[([^[\]]{0,300})\]\([^()\s]{0,1000}(?:\s+"[^"()]{0,200}")?\)/g;
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]{0,30}(?:\s[^<>]{0,300})?\/?>|<!--[^<>]{0,300}-->/g;
const HEADING_MARK = /^#{1,6}\s+/;
const LIST_MARK = /^(?:[-*+•]|\d{1,3}[.)])\s+/;
const CHECKBOX = /^\[[ xX]\]\s+/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]{0,20}:\/\//;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const PATH_SEGMENT = /^[\p{L}\p{N}_.@~+-]+$/u;
const FILE_EXTENSION = /\.[\p{L}\p{N}]{1,8}$/u;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** Cierres que pueden seguir a un signo de fin de frase. */
const CLOSERS = new Set([')', ']', '"', "'", '”', '’', '»']);
const TERMINATORS = new Set(['.', '!', '?', '…']);
/** Signos que envuelven una palabra por delante / por detrás. */
const LEADING = new Set(['(', '[', '{', '<', '"', "'", '“', '‘', '«', '*', '_']);
const TRAILING = new Set([
  '.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '"', "'", '”', '’', '»', '…', '*', '_', '~',
]);
/** Caracteres que, solos, no se leen (guiones, barras de tabla, marcas de cita…). */
const SYMBOL_ONLY = new Set(['-', '=', '|', '#', '>', '+']);

function normalizeMax(maxChars: number | undefined): number {
  if (maxChars === undefined || !Number.isFinite(maxChars) || maxChars < 1) return DEFAULT_MAX_CHARS;
  return Math.floor(maxChars);
}

function runLength(text: string, from: number, char: string): number {
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

/** El texto sin bloques de código ni código en línea. */
export function removeCode(text: string): string {
  return codeFreeLines(text).join('\n');
}

function isTableRow(line: string): boolean {
  let pipes = 0;
  for (let i = 0; i < line.length; i++) if (line[i] === '|') pipes++;
  if (pipes === 0) return false;
  if (pipes >= 2 || line.startsWith('|') || line.endsWith('|')) return true;
  // Separador de columnas sin bordes: `---|---`.
  return line.includes('-') && /^[\s|:-]+$/.test(line);
}

/** `---`, `***`, `___`, `===` (con o sin espacios). */
function isRule(line: string): boolean {
  const compact = line.replaceAll(' ', '');
  const first = compact[0];
  if (compact.length < 3 || (first !== '-' && first !== '*' && first !== '_' && first !== '=')) {
    return false;
  }
  return runLength(compact, 0, first) === compact.length;
}

function isUrl(core: string): boolean {
  return core.slice(0, 4).toLowerCase() === 'www.' || URL_SCHEME.test(core);
}

function isPath(core: string): boolean {
  if (core.length < 2) return false;
  if (core.startsWith('/') || core.startsWith('~/') || core.startsWith('./') || core.startsWith('../')) {
    return true;
  }
  if (WINDOWS_PATH.test(core)) return true;
  if (!core.includes('/')) return false;
  const parts = core.split('/');
  if (parts.at(-1) === '') parts.pop();
  if (parts.length < 2 || !parts.every((part) => PATH_SEGMENT.test(part))) return false;
  // `entrada/salida` o `y/o` son palabras; `src/a.ts` y `a/b/c` son rutas.
  return parts.length >= 3 || FILE_EXTENSION.test(parts.at(-1)!);
}

function onlySymbols(core: string): boolean {
  for (const char of core) if (!SYMBOL_ONLY.has(char)) return false;
  return true;
}

function keptTerminators(text: string): string {
  let kept = '';
  for (const char of text) if (TERMINATORS.has(char)) kept += char;
  return kept;
}

function withoutMarks(text: string, marks: ReadonlySet<string>): string {
  let out = '';
  for (const char of text) if (!marks.has(char)) out += char;
  return out;
}
const EMPHASIS_LEADING = new Set(['*', '_']);
const EMPHASIS_TRAILING = new Set(['*', '_', '~']);

/** Quita rutas, URLs, marcas sueltas y énfasis palabra por palabra. */
function cleanTokens(line: string): string {
  const out: string[] = [];
  for (const token of line.split(/\s+/)) {
    if (token === '') continue;
    let start = 0;
    while (start < token.length && LEADING.has(token[start]!)) start++;
    let end = token.length;
    while (end > start && TRAILING.has(token[end - 1]!)) end--;
    const core = token.slice(start, end);
    const trail = token.slice(end);

    const dropped =
      core === '' ||
      isUrl(core) ||
      isPath(core) ||
      onlySymbols(core);
    if (dropped) {
      // Conserva el punto final de la frase para no pegar frases entre sí.
      const kept = keptTerminators(trail);
      if (kept !== '' && out.length > 0) out[out.length - 1] += kept;
      continue;
    }
    const lead = withoutMarks(token.slice(0, start), EMPHASIS_LEADING);
    out.push(
      lead + core.replaceAll('*', '').replaceAll('~~', '') + withoutMarks(trail, EMPHASIS_TRAILING),
    );
  }
  return out.join(' ');
}

function cleanLine(raw: string): string {
  let line = raw.trim();
  if (line === '' || isTableRow(line) || isRule(line)) return '';
  while (line.startsWith('>')) line = line.slice(1).trimStart();
  line = line.replace(HEADING_MARK, '').replace(LIST_MARK, '').replace(CHECKBOX, '');
  line = line
    .replace(IMAGE, ' ')
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(PICTOGRAPH, ' ');
  return cleanTokens(line);
}

/** Parte una línea ya limpia (palabras separadas por un espacio) en frases. */
function splitSentences(line: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  let i = 0;
  while (i < line.length) {
    if (TERMINATORS.has(line[i]!)) {
      let j = i + 1;
      while (j < line.length && (TERMINATORS.has(line[j]!) || CLOSERS.has(line[j]!))) j++;
      if (j >= line.length || line[j] === ' ') {
        sentences.push(line.slice(start, j));
        start = j;
      }
      i = j;
    } else i++;
  }
  sentences.push(line.slice(start));
  return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence !== '');
}

/** Corta una frase demasiado larga en el último límite de palabra y la cierra con `…`. */
function cutSentence(sentence: string, maxChars: number): string {
  if (maxChars <= 1) return '…';
  const head = sentence.slice(0, maxChars - 1);
  let end = head.length;
  if (sentence[maxChars - 1] !== ' ') {
    const space = head.lastIndexOf(' ');
    if (space > 0) end = space;
  }
  let cut = head.slice(0, end).trimEnd();
  while (cut !== '' && /[,;:.\-–—]/.test(cut.at(-1)!)) cut = cut.slice(0, -1).trimEnd();
  return `${cut}…`;
}

/**
 * Resumen corto para decir en voz alta. Quita código (bloques y en línea), rutas, URLs, tablas,
 * HTML, marcas de markdown y emoji; conserva acentos y `¿ ¡`. Toma frases completas, en orden,
 * mientras quepan en `maxChars` (220 por defecto); si la primera ya no cabe, la corta en el
 * último límite de palabra y la cierra con `…`. Devuelve `''` si no queda nada hablable.
 */
export function spokenSummary(text: string, opts: { maxChars?: number } = {}): string {
  const maxChars = normalizeMax(opts.maxChars);
  const clean = text.replace(LONE_SURROGATE, ' ').replace(INVISIBLE, ' ');
  let summary = '';
  for (const raw of codeFreeLines(clean)) {
    for (const sentence of splitSentences(cleanLine(raw))) {
      if (!HAS_WORD.test(sentence)) continue;
      if (summary === '') {
        if (sentence.length > maxChars) return cutSentence(sentence, maxChars).replace(LONE_SURROGATE, '');
        summary = sentence;
        continue;
      }
      const candidate = `${summary} ${sentence}`;
      if (candidate.length > maxChars) return summary;
      summary = candidate;
    }
  }
  return summary;
}
