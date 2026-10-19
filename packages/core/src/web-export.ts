// Formato del paquete que exporta `avatar exportar-web` y lee el elemento `<ascii-avatar>`.
// Código puro (sin Node): lo usan la CLI para escribir y el navegador para leer.

/** Identifica el `manifest.json` de un paquete web de ascii-avatar. */
export const WEB_EXPORT_FORMAT = 'ascii-avatar-web';
/** Sube si cambia el formato de forma incompatible. */
export const WEB_EXPORT_VERSION = 1;

/**
 * `manifest.json` del paquete web. Los cuadros vienen ya convertidos a caracteres (modo grabado:
 * tinta sobre papel, así que basta el carácter de cada celda) en `frameFile`, en el orden de
 * `frames`. Nunca lleva la foto original ni la llave de Gemini.
 */
export interface WebManifest {
  format: typeof WEB_EXPORT_FORMAT;
  version: typeof WEB_EXPORT_VERSION;
  /** Nombre del agente. */
  agent: string;
  /** Voz de Gemini del agente (la usa el proxy de voz, si lo hay). */
  voice: string;
  /** Estilo de voz del agente; ausente si no tiene. */
  voiceStyle?: string;
  cols: number;
  rows: number;
  /** Color de la tinta y del papel, en `#rrggbb`. */
  ink: string;
  paper: string;
  /** Cuadros por segundo de los clips. */
  clipFps: number;
  /** Archivo de cuadros, relativo al manifiesto. */
  frameFile: string;
  /** Ids de los cuadros (`neutral`, `mouth_q1`, `pose:look_left`, `clip:nod:0`…), en el orden del archivo. */
  frames: string[];
  /** Poses que tiene el agente. */
  poses: string[];
  /** Clips con su número de cuadros. */
  clips: Record<string, number>;
}

/** El paquete web no se puede usar: falta algo o no es de esta versión. */
export class InvalidWebExportError extends Error {
  constructor(reason: string) {
    super(`Paquete web inválido: ${reason}`);
    this.name = 'InvalidWebExportError';
  }
}

/**
 * Texto del archivo de cuadros: cada cuadro son `rows` líneas de `cols` caracteres, un cuadro tras
 * otro, sin separadores (el manifiesto dice cuántas filas tiene cada uno), con salto de línea final.
 */
export function webExportFramesText(frames: readonly (readonly string[])[]): string {
  return frames.map((rows) => `${rows.join('\n')}\n`).join('');
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Comprueba el manifiesto (ya leído como JSON). Lanza `InvalidWebExportError` si algo no cuadra. */
export function checkWebManifest(raw: unknown): WebManifest {
  if (!isObject(raw)) throw new InvalidWebExportError('manifest.json no es un objeto.');
  if (raw.format !== WEB_EXPORT_FORMAT) throw new InvalidWebExportError(`el formato no es "${WEB_EXPORT_FORMAT}".`);
  if (raw.version !== WEB_EXPORT_VERSION) {
    throw new InvalidWebExportError(`versión ${String(raw.version)} no admitida (se espera ${WEB_EXPORT_VERSION}); vuelve a exportar.`);
  }
  const bad = (field: string): never => {
    throw new InvalidWebExportError(`el campo "${field}" falta o tiene un tipo incorrecto.`);
  };
  if (typeof raw.agent !== 'string') bad('agent');
  if (typeof raw.voice !== 'string') bad('voice');
  if (raw.voiceStyle !== undefined && typeof raw.voiceStyle !== 'string') bad('voiceStyle');
  if (!isPositiveInt(raw.cols)) bad('cols');
  if (!isPositiveInt(raw.rows)) bad('rows');
  if (typeof raw.ink !== 'string' || !COLOR_RE.test(raw.ink)) bad('ink');
  if (typeof raw.paper !== 'string' || !COLOR_RE.test(raw.paper)) bad('paper');
  if (!isPositiveInt(raw.clipFps)) bad('clipFps');
  if (typeof raw.frameFile !== 'string' || raw.frameFile === '') bad('frameFile');
  if (!isStringArray(raw.frames)) bad('frames');
  if (!isStringArray(raw.poses)) bad('poses');
  if (!isObject(raw.clips) || !Object.values(raw.clips).every(isPositiveInt)) bad('clips');
  if (!(raw.frames as string[]).includes('neutral')) throw new InvalidWebExportError('falta el cuadro "neutral".');
  return raw as unknown as WebManifest;
}

/**
 * Lee un paquete web: el manifiesto (ya leído como JSON) y el texto de su archivo de cuadros.
 * Devuelve cada cuadro como texto de `rows` líneas unidas con `\n`, por su id.
 */
export function parseWebExport(rawManifest: unknown, text: string): { manifest: WebManifest; frames: Map<string, string> } {
  const manifest = checkWebManifest(rawManifest);
  const { cols, rows } = manifest;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const needed = manifest.frames.length * rows;
  if (lines.length < needed) {
    throw new InvalidWebExportError(`el archivo de cuadros tiene ${lines.length} filas y se esperaban ${needed}.`);
  }
  const frames = new Map<string, string>();
  manifest.frames.forEach((id, i) => {
    const block = lines.slice(i * rows, (i + 1) * rows);
    const wrong = block.findIndex((line) => [...line].length !== cols);
    if (wrong !== -1) {
      throw new InvalidWebExportError(`la fila ${i * rows + wrong + 1} del archivo de cuadros no tiene ${cols} columnas.`);
    }
    frames.set(id, block.join('\n'));
  });
  return { manifest, frames };
}
