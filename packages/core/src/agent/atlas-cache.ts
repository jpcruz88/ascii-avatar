// Caché en disco de cuadros ya convertidos a ASCII, para que el panel abra rápido aunque el agente
// tenga decenas de poses y cuadros de clips. Un archivo por (modo, columnas):
//
//   'AAC1' · uint32 largo del encabezado · encabezado JSON · cuadros comprimidos uno tras otro
//
// Cada cuadro es una celda tras otra de 9 bytes (código UTF-16 del carácter, frente r g b, si hay
// fondo, fondo r g b), comprimido con deflate. Cada cuadro guarda la clave con que se hizo (fecha y
// tamaño de sus archivos, columnas, modo y tono); quien lee solo usa los que coinciden.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { GrabadoTone } from '../ascii/convert.js';
import type { AsciiFrame, Cell, Rgb } from '../ascii/types.js';
import { writeFileAtomic } from './atomic.js';

const MAGIC = 'AAC1';
const CELL_BYTES = 9;
/** Archivos de caché (uno por modo y ancho) que se conservan por agente; los más viejos se borran. */
export const CACHE_FILES_KEPT = 3;
const CACHE_FILE_RE = /^atlas-.+\.bin$/;

export interface CacheMeta {
  /** Versión del formato y de la conversión: una caché de otra versión no se usa. */
  version: number;
  /** Fecha y tamaño de las 8 caras: si no cambian, el tono guardado sigue valiendo. */
  facesSig: string;
  tone: GrabadoTone | null;
}

interface FrameRecord {
  id: string;
  key: string;
  cols: number;
  rows: number;
  offset: number;
  length: number;
}

export interface AtlasCache {
  meta: CacheMeta;
  /** Cuántos cuadros guarda. */
  size: number;
  /** Cuadro guardado con esa clave, o `undefined` si no hay o la clave no coincide. */
  get(id: string, key: string): AsciiFrame | undefined;
}

/**
 * Lee la caché; si no existe, está dañada o es de otra `version` devuelve `undefined` (se rehará).
 * Los colores de los cuadros leídos se toman de `colors` (compartidos con los recién convertidos).
 * Nunca lanza.
 */
export function readAtlasCache(file: string, version: number, colors: Map<number, Rgb> = new Map()): AtlasCache | undefined {
  try {
    if (!existsSync(file)) return undefined;
    const buf = readFileSync(file);
    if (buf.length < 8 || buf.toString('latin1', 0, 4) !== MAGIC) return undefined;
    const headerLength = buf.readUInt32LE(4);
    const header = JSON.parse(buf.toString('utf8', 8, 8 + headerLength)) as {
      meta: CacheMeta;
      frames: FrameRecord[];
    };
    if (header.meta?.version !== version || typeof header.meta.facesSig !== 'string' || !Array.isArray(header.frames)) {
      return undefined;
    }
    const payload = buf.subarray(8 + headerLength);
    const records = new Map(header.frames.map((f) => [f.id, f]));
    return {
      meta: header.meta,
      size: records.size,
      get(id, key) {
        const record = records.get(id);
        if (record === undefined || record.key !== key) return undefined;
        try {
          // Un cuadro que se infla a más de lo que dice su encabezado está dañado: cuenta como fallo.
          const maxOutputLength = Math.max(1, record.cols * record.rows * CELL_BYTES);
          const raw = inflateRawSync(payload.subarray(record.offset, record.offset + record.length), { maxOutputLength });
          return decodeFrame(record, raw, colors);
        } catch {
          return undefined;
        }
      },
    };
  } catch {
    return undefined;
  }
}

/** Escribe la caché de forma atómica. Los cuadros con caracteres de más de una unidad UTF-16 no se guardan. */
export function writeAtlasCache(
  file: string,
  meta: CacheMeta,
  frames: ReadonlyArray<{ id: string; key: string; frame: AsciiFrame }>,
): void {
  const records: FrameRecord[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const { id, key, frame } of frames) {
    const raw = encodeFrame(frame);
    if (raw === undefined) continue;
    const packed = deflateRawSync(raw, { level: 1 });
    records.push({ id, key, cols: frame.cols, rows: frame.rows, offset, length: packed.length });
    chunks.push(packed);
    offset += packed.length;
  }
  const header = Buffer.from(JSON.stringify({ meta, frames: records }), 'utf8');
  const head = Buffer.alloc(8);
  head.write(MAGIC, 0, 'latin1');
  head.writeUInt32LE(header.length, 4);
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, Buffer.concat([head, header, ...chunks]));
  pruneCache(dirname(file), basename(file));
}

/** Deja en `dir` solo los `CACHE_FILES_KEPT` archivos de caché más recientes (siempre `keep`). */
function pruneCache(dir: string, keep: string): void {
  const others = readdirSync(dir)
    .filter((f) => CACHE_FILE_RE.test(f) && f !== keep)
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { f } of others.slice(CACHE_FILES_KEPT - 1)) rmSync(join(dir, f), { force: true });
}

/**
 * Reemplaza los colores de las celdas por objetos compartidos de `colors` (uno por color): un cuadro
 * recién convertido trae un objeto por celda, y con decenas de cuadros eso son cientos de MB.
 */
export function internColors(frame: AsciiFrame, colors: Map<number, Rgb>): AsciiFrame {
  for (const cell of frame.cells) {
    cell.fg = color(colors, cell.fg.r, cell.fg.g, cell.fg.b);
    if (cell.bg !== null) cell.bg = color(colors, cell.bg.r, cell.bg.g, cell.bg.b);
  }
  return frame;
}

function encodeFrame(frame: AsciiFrame): Buffer | undefined {
  const out = Buffer.alloc(frame.cells.length * CELL_BYTES);
  for (let i = 0; i < frame.cells.length; i++) {
    const { ch, fg, bg } = frame.cells[i]!;
    if (ch.length !== 1) return undefined;
    const o = i * CELL_BYTES;
    out.writeUInt16LE(ch.charCodeAt(0), o);
    out[o + 2] = fg.r;
    out[o + 3] = fg.g;
    out[o + 4] = fg.b;
    out[o + 5] = bg === null ? 0 : 1;
    out[o + 6] = bg?.r ?? 0;
    out[o + 7] = bg?.g ?? 0;
    out[o + 8] = bg?.b ?? 0;
  }
  return out;
}

/** Los colores se comparten entre celdas (son de solo lectura): ahorra memoria con muchos cuadros. */
function color(colors: Map<number, Rgb>, r: number, g: number, b: number): Rgb {
  const k = (r << 16) | (g << 8) | b;
  let c = colors.get(k);
  if (c === undefined) {
    c = { r, g, b };
    colors.set(k, c);
  }
  return c;
}

function decodeFrame(record: FrameRecord, raw: Buffer, colors: Map<number, Rgb>): AsciiFrame | undefined {
  const count = record.cols * record.rows;
  if (raw.length !== count * CELL_BYTES) return undefined;
  const cells: Cell[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * CELL_BYTES;
    cells[i] = {
      ch: String.fromCharCode(raw.readUInt16LE(o)),
      fg: color(colors, raw[o + 2]!, raw[o + 3]!, raw[o + 4]!),
      bg: raw[o + 5] === 0 ? null : color(colors, raw[o + 6]!, raw[o + 7]!, raw[o + 8]!),
    };
  }
  return { cols: record.cols, rows: record.rows, cells };
}
