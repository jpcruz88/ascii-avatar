import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CLIP_FPS,
  CLIP_IDS,
  FRAME_IDS,
  INK,
  PAPER,
  WEB_EXPORT_FORMAT,
  WEB_EXPORT_VERSION,
  atlasMotion,
  clipFrameId,
  easeFrameId,
  loadAgent,
  loadAtlas,
  missingFaces,
  poseFrameId,
  validateAgentName,
  webExportFramesText,
  type AsciiFrame,
  type Atlas,
  type Rgb,
  type WebManifest,
} from '@ascii-avatar/core';

/** Ancho por defecto del paquete web: el navegador escala la letra, así que conviene más definición que en el panel. */
export const DEFAULT_WEB_COLS = 120;
const MIN_COLS = 20;
const MAX_COLS = 500;
const MANIFEST = 'manifest.json';
const FRAMES = 'frames.txt';

export interface ExportWebOptions {
  root: string;
  name: string;
  /** Carpeta de salida; por defecto `<cwd>/<nombre>-web`. */
  out?: string;
  cols?: number;
  /** Carpeta desde la que se resuelven las rutas relativas; por defecto `process.cwd()`. */
  cwd?: string;
}

export interface ExportWebResult {
  status: 'ok' | 'failed';
  message: string;
  outDir?: string;
  /** Bytes escritos (manifiesto y cuadros). */
  bytes?: number;
}

const hex = ({ r, g, b }: Readonly<Rgb>): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Las filas de un cuadro como texto: en modo grabado todas las celdas son tinta sobre papel. */
function frameRows(frame: AsciiFrame): string[] {
  const rows: string[] = [];
  for (let y = 0; y < frame.rows; y++) {
    rows.push(frame.cells.slice(y * frame.cols, (y + 1) * frame.cols).map((c) => c.ch).join(''));
  }
  return rows;
}

/** Ids de los cuadros del atlas en un orden fijo: base, cada pose con su regreso y los clips. */
function orderedIds(atlas: Atlas): string[] {
  const motion = atlasMotion(atlas);
  const ids: string[] = [...FRAME_IDS];
  for (const pose of motion.poses) {
    ids.push(poseFrameId(pose));
    if (easeFrameId(pose) in atlas) ids.push(easeFrameId(pose));
  }
  for (const clip of CLIP_IDS) {
    for (let i = 0; i < (motion.clips[clip] ?? 0); i++) ids.push(clipFrameId(clip, i));
  }
  return ids;
}

/** Una carpeta sirve de salida si no existe, está vacía o ya es un paquete web (se reescribe). */
function usableOutDir(dir: string): boolean {
  if (!existsSync(dir)) return true;
  const entries = readdirSync(dir);
  if (entries.length === 0) return true;
  try {
    const raw = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as { format?: unknown };
    return raw.format === WEB_EXPORT_FORMAT && entries.every((f) => f === MANIFEST || f === FRAMES);
  } catch {
    return false;
  }
}

/**
 * `avatar exportar-web <nombre> [--out <carpeta>] [--cols <n>]`: escribe en una carpeta los cuadros
 * del agente ya convertidos a caracteres (modo grabado) y su `manifest.json`, para el elemento
 * `<ascii-avatar>`. Nunca copia la foto original ni la llave de Gemini. Usa la caché de cuadros del
 * agente, como el panel. Determinista: el mismo agente y ancho dan los mismos bytes.
 */
export async function runExportWeb(opts: ExportWebOptions): Promise<ExportWebResult> {
  const { root, name } = opts;
  const cols = opts.cols ?? DEFAULT_WEB_COLS;
  const fail = (message: string): ExportWebResult => ({ status: 'failed', message });
  try {
    validateAgentName(name);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS) {
    return fail(`--cols debe ser un número entero entre ${MIN_COLS} y ${MAX_COLS}.`);
  }
  const cwd = opts.cwd ?? process.cwd();
  const outDir = resolve(cwd, opts.out ?? `${name}-web`);
  try {
    const agent = loadAgent(root, name);
    const missing = missingFaces(root, name);
    if (missing.length > 0) {
      return fail(`Al agente "${name}" le faltan caras (${missing.join(', ')}). Vuelve a correr \`avatar create\`.`);
    }
    if (!usableOutDir(outDir)) {
      return fail(`La carpeta ${outDir} no está vacía y no es un paquete web; elige otra con --out.`);
    }
    const atlas = await loadAtlas(root, name, { cols, mode: 'grabado' });
    const ids = orderedIds(atlas);
    const frames = ids.map((id) => frameRows(atlas[id as keyof Atlas]!));
    const motion = atlasMotion(atlas);
    const manifest: WebManifest = {
      format: WEB_EXPORT_FORMAT,
      version: WEB_EXPORT_VERSION,
      agent: agent.name,
      voice: agent.voice,
      ...(agent.voiceStyle === undefined ? {} : { voiceStyle: agent.voiceStyle }),
      cols: atlas.neutral.cols,
      rows: atlas.neutral.rows,
      ink: hex(INK),
      paper: hex(PAPER),
      clipFps: CLIP_FPS,
      frameFile: FRAMES,
      frames: ids,
      poses: [...motion.poses],
      clips: { ...motion.clips },
    };
    const text = webExportFramesText(frames);
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    mkdirSync(outDir, { recursive: true });
    // El manifiesto va al final: si existe, el paquete está completo.
    writeFileSync(join(outDir, FRAMES), text);
    writeFileSync(join(outDir, MANIFEST), json);
    const bytes = Buffer.byteLength(text) + Buffer.byteLength(json);
    return {
      status: 'ok',
      outDir,
      bytes,
      message:
        `Paquete web de "${name}" en ${outDir}: ${ids.length} cuadros de ${manifest.cols}×${manifest.rows} ` +
        `(${(bytes / 1024).toFixed(0)} KB). Súbelo junto con ascii-avatar.js y usa <ascii-avatar src="${basename(outDir)}/">.`,
    };
  } catch (error) {
    return fail(error instanceof Error ? (error.message.split('\n')[0] ?? 'Error.') : 'Error.');
  }
}
