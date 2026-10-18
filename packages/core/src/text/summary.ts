import { codeFreeLines, runLength } from './code.js';

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
const DATA_URL = /^data:[^/\s]{1,60}\//i;
/** `data:image/png;base64,…` suelto (puede ser enorme: va antes de imágenes y enlaces). */
const DATA_URI = /\bdata:[A-Za-z0-9.+-]{1,60}\/[A-Za-z0-9.+-]{1,60}[^\s)]*/gi;
/** Marca de comprobación que `pickExpression` necesita ver. */
const CHECK_MARKS = new Set(['\u2713', '\u2714']);
const MIN_OPAQUE_LENGTH = 20;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const PATH_SEGMENT = /^[\p{L}\p{N}_.@~+$=[\](){}-]+$/u;
const FILE_EXTENSION = /\.[\p{L}\p{N}]{1,8}$/u;
const HAS_WORD = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;

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
  const lower = core.slice(0, 7).toLowerCase();
  return (
    lower.startsWith('www.') || lower === 'mailto:' || URL_SCHEME.test(core) || DATA_URL.test(core)
  );
}

/** Quita un sufijo `:42` o `:10:5` (línea y columna) de una ruta. */
function withoutLineNumbers(core: string): string {
  let end = core.length;
  for (;;) {
    let digits = end;
    while (digits > 0 && core.charCodeAt(digits - 1) >= 48 && core.charCodeAt(digits - 1) <= 57) {
      digits--;
    }
    if (digits < end && digits > 0 && core[digits - 1] === ':') end = digits - 1;
    else return core.slice(0, end);
  }
}

function isPath(token: string): boolean {
  const core = withoutLineNumbers(token);
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

/** Cadena larga que mezcla letras y dígitos: llaves de API, hashes, base64… */
function isOpaque(core: string): boolean {
  if (core.length < MIN_OPAQUE_LENGTH) return false;
  let letters = false;
  let digits = false;
  for (let i = 0; i < core.length && !(letters && digits); i++) {
    const code = core.charCodeAt(i);
    if (code >= 48 && code <= 57) digits = true;
    else if (LETTER.test(core[i]!)) letters = true;
  }
  return letters && digits;
}

/** Posición del `=` en `CLAVE=valor` (clave de identificador y valor no vacío), o -1. */
function assignmentAt(word: string): number {
  const equals = word.indexOf('=');
  if (equals < 1 || equals === word.length - 1) return -1;
  for (let i = 0; i < equals; i++) {
    const code = word.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isIdentifier = isDigit || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
    if (!isIdentifier || (i === 0 && isDigit)) return -1;
  }
  return equals;
}

/** Palabras que anuncian un secreto (sin acentos y en minúsculas). */
const SECRET_LABELS = new Set([
  'password', 'passwords', 'passwd', 'pwd', 'contrasena', 'contrasenas', 'clave', 'claves', 'token',
  'tokens', 'secret', 'secrets', 'secreto', 'secretos', 'apikey', 'api_key', 'api-key', 'accesskey',
  'access_key', 'privatekey', 'private_key', 'llave', 'llaves',
]);
/** Primera palabra de «api key», «access key» y «private key». */
const KEY_PREFIXES = new Set(['api', 'access', 'private']);
/** Tokens tras una etiqueta en los que se busca el separador («del admin es:»). */
const LABEL_WINDOW = 4;
/** Largo máximo de un valor entre comillas que se descarta tras una etiqueta. */
const MAX_QUOTED_SECRET = 200;
const MAX_LABEL_LENGTH = 16;
/** Signos que cortan la búsqueda del separador tras una etiqueta. */
const WINDOW_BREAKERS = new Set([',', ';', '.', '!', '?', '…']);

/** Minúsculas y sin acentos, solo para palabras cortas (así el costo sigue siendo lineal). */
function fold(word: string): string {
  if (word.length > MAX_LABEL_LENGTH) return '';
  return word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isSecretLabel(word: string): boolean {
  return SECRET_LABELS.has(fold(word));
}

function hasBreaker(text: string): boolean {
  for (const char of text) if (WINDOW_BREAKERS.has(char)) return true;
  return false;
}

/** Posición de `:` o `=` en `etiqueta":"valor` (etiqueta de secreto pegada a su valor no vacío), o -1. */
function gluedLabelAt(word: string): number {
  const limit = Math.min(word.length, MAX_LABEL_LENGTH + 3);
  for (let i = 1; i < limit; i++) {
    const char = word[i];
    if (char !== ':' && char !== '=') continue;
    let end = i;
    while (end > 0 && (word[end - 1] === '"' || word[end - 1] === "'")) end--;
    return i < word.length - 1 && isSecretLabel(word.slice(0, end)) ? i : -1;
  }
  return -1;
}

/** Comilla de apertura de un valor que empieza en `from` y no se cierra dentro de `text`, o null. */
function unclosedQuote(text: string, from: number): string | null {
  const quote = text[from];
  if ((quote === '"' || quote === "'") && text.indexOf(quote, from + 1) === -1) return quote;
  return null;
}

/** Quita rutas, URLs, secretos, marcas sueltas y énfasis palabra por palabra. */
function cleanTokens(line: string): string {
  const out: string[] = [];
  let skipNext = false; // el valor que sigue a `Bearer`
  let openQuote: string | null = null; // valor entre comillas que sigue en otra palabra
  let quoteBudget = Infinity; // caracteres que aún se descartan dentro de ese valor
  let expectValue = false; // el valor que sigue a «clave:», «token es», «password =»…
  let labelWindow = 0; // tokens que quedan para hallar el separador tras una etiqueta
  let previous = ''; // palabra anterior (para «api key»)
  for (const token of line.split(/\s+/)) {
    if (token === '') continue;
    let start = 0;
    while (start < token.length && LEADING.has(token[start]!)) start++;
    let end = token.length;
    while (end > start && TRAILING.has(token[end - 1]!)) end--;
    const core = token.slice(start, end);
    const trail = token.slice(end);
    const word = token.slice(start);
    const folded = fold(core);

    // ¿Es el separador («:», «=», «es», «is») que sigue a una etiqueta de secreto?
    let separator = false;
    if (labelWindow > 0 && openQuote === null && !expectValue && !skipNext) {
      const ended = hasBreaker(trail);
      separator = token === ':' || token === '=' || ((folded === 'es' || folded === 'is') && !ended);
      labelWindow = separator || ended ? 0 : labelWindow - 1;
    }

    let dropped = false;
    const glued = openQuote === null && !expectValue && !skipNext ? gluedLabelAt(word) : -1;
    if (openQuote !== null) {
      dropped = true;
      quoteBudget -= token.length + 1;
      if (token.includes(openQuote) || quoteBudget <= 0) openQuote = null;
    } else if (expectValue) {
      dropped = true;
      expectValue = false;
      openQuote = unclosedQuote(token, 0);
      quoteBudget = MAX_QUOTED_SECRET - token.length;
    } else if (skipNext) {
      dropped = true;
      skipNext = false;
    } else if (core.length === 6 && core.toLowerCase() === 'bearer') {
      dropped = true;
      skipNext = true;
    } else if (token[0] === '-' && token.includes('=')) {
      // `--token=abc`: cualquier opción con valor pegado.
      dropped = true;
      openQuote = unclosedQuote(token, token.indexOf('=') + 1);
      quoteBudget = Infinity;
    } else if (glued > 0) {
      dropped = true;
      openQuote = unclosedQuote(token, start + glued + 1);
      quoteBudget = MAX_QUOTED_SECRET;
    } else {
      const equals = assignmentAt(word);
      if (equals > 0) {
        dropped = true;
        openQuote = unclosedQuote(token, start + equals + 1);
        quoteBudget = Infinity;
      } else {
        dropped = core === '' || isUrl(core) || isPath(core) || onlySymbols(core) || isOpaque(core);
      }
    }

    if (separator) expectValue = true;
    if (!dropped) {
      // Una etiqueta de secreto: «clave:», «clave es…», «api key», «"apiKey":».
      const base = core.endsWith('=') ? core.slice(0, -1) : core;
      if (isSecretLabel(base) || (fold(base) === 'key' && KEY_PREFIXES.has(previous))) {
        if (trail.includes(':') || core.endsWith('=')) expectValue = true;
        else if (!hasBreaker(trail)) labelWindow = LABEL_WINDOW;
      }
    }
    previous = folded;

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

function cleanLine(raw: string, keepChecks: boolean): string {
  let line = raw.trim();
  if (line === '' || isTableRow(line) || isRule(line)) return '';
  while (line.startsWith('>')) line = line.slice(1).trimStart();
  line = line.replace(HEADING_MARK, '').replace(LIST_MARK, '').replace(CHECKBOX, '');
  line = line
    .replace(DATA_URI, '')
    .replace(IMAGE, ' ')
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(PICTOGRAPH, (mark) => (keepChecks && CHECK_MARKS.has(mark) ? mark : ' '));
  return cleanTokens(line);
}

/**
 * Líneas de prosa: sin código, rutas, URLs, secretos, tablas, HTML, marcas de markdown ni emoji.
 * Con `keepChecks` conserva `✓`/`✔` (para `pickExpression`). Las líneas vacías se mantienen.
 */
export function proseLines(text: string, keepChecks = false): string[] {
  const clean = text.replace(LONE_SURROGATE, ' ').replace(INVISIBLE, ' ');
  return codeFreeLines(clean).map((raw) => cleanLine(raw, keepChecks));
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
  let summary = '';
  for (const line of proseLines(text)) {
    for (const sentence of splitSentences(line)) {
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
