// `avatar create <nombre> --caras <carpeta> [--poses <carpeta>] [--clips <carpeta>]`: importa un
// paquete de caras hecho a mano y, si se dan, poses y clips de movimiento. Las poses y los clips
// también se pueden importar solos a un agente que ya existe (sin tocar sus caras).
// No usa Gemini: no pide llave, no gasta y no escribe en el ledger.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIP_IDS,
  FACE_IDS,
  POSE_IDS,
  createAgent,
  listClips,
  listPoses,
  loadAgent,
  saveClips,
  saveFace,
  savePoses,
  validateAgentName,
  type ClipId,
  type FaceId,
  type PoseId,
} from '@ascii-avatar/core';
import { loadConfig, saveConfig } from '../config.js';
import { ImageInputError, assertSideRange, mimeFromBytes, readImageFile, readPhoto, readSize } from '../image-input.js';

export interface ImportFacesDeps {
  root: string;
  name: string;
  /** Carpeta con los ocho `<id>.png`. Opcional si el agente ya existe y se importan poses o clips. */
  facesDir?: string;
  /** Carpeta con poses `<id>.png` (ids de `POSE_IDS`). */
  posesDir?: string;
  /** Carpeta con una subcarpeta por clip (`nod/000.png`, `nod/001.png`…). */
  clipsDir?: string;
  /** Foto base opcional; si falta se usa `neutral.png`. Se ignora si el agente ya existe. */
  photoPath?: string;
  out: (line: string) => void;
}

export interface ImportFacesResult {
  status: 'done' | 'failed';
  message: string;
}

const FACE_MIN_SIDE = 64;
const CLIP_FRAME_RE = /^\d{3}\.png$/;
/** Un clip necesita al menos dos cuadros para moverse. */
const CLIP_MIN_FRAMES = 2;
/** Tope de cuadros por clip: 5 s a 24 fps (más no se nota y alarga la carga del panel). */
const CLIP_MAX_FRAMES = 120;

/** Qué se está importando, para nombrarlo si algo falla de forma inesperada. */
type Stage = 'las caras' | 'las poses' | 'los clips';

interface Size {
  width: number;
  height: number;
}

/** Lee y valida las ocho caras (PNG, tamaños iguales). No escribe nada. */
async function readFaces(facesDir: string): Promise<{ faces: Record<FaceId, Buffer>; size: Size }> {
  const missing = FACE_IDS.filter((id) => !existsSync(join(facesDir, `${id}.png`)));
  if (missing.length > 0) {
    throw new ImageInputError(
      `Faltan caras en ${facesDir}: ${missing.map((id) => `${id}.png`).join(', ')}.`,
    );
  }
  const faces = {} as Record<FaceId, Buffer>;
  let reference: { id: FaceId; width: number; height: number } | undefined;
  for (const id of FACE_IDS) {
    const label = `la cara ${id}.png`;
    const buf = readImageFile(join(facesDir, `${id}.png`), label);
    if (mimeFromBytes(buf) !== 'image/png') {
      throw new ImageInputError(`La cara ${id}.png debe ser un PNG; el archivo no tiene la cabecera de un PNG.`);
    }
    const { width, height } = await readSize(buf, label);
    assertSideRange(width, height, FACE_MIN_SIDE, label);
    if (reference === undefined) {
      reference = { id, width, height };
    } else if (width !== reference.width || height !== reference.height) {
      throw new ImageInputError(
        `La cara ${id}.png mide ${width}×${height} px, pero ${reference.id}.png mide ${reference.width}×${reference.height} px. ` +
          'Las ocho deben tener exactamente el mismo tamaño (contrato de encuadre).',
      );
    }
    faces[id] = buf;
  }
  return { faces, size: { width: reference!.width, height: reference!.height } };
}

/** Lee un PNG opcional (pose o cuadro de clip) y comprueba que mide lo mismo que las caras. */
async function readMotionPng(path: string, label: string, canvas: Size): Promise<Buffer> {
  const buf = readImageFile(path, label);
  if (mimeFromBytes(buf) !== 'image/png') {
    throw new ImageInputError(`${label} debe ser un PNG; el archivo no tiene la cabecera de un PNG.`);
  }
  const { width, height } = await readSize(buf, label);
  if (width !== canvas.width || height !== canvas.height) {
    throw new ImageInputError(
      `${label} mide ${width}×${height} px, pero las caras miden ${canvas.width}×${canvas.height} px. ` +
        'Las poses y los clips deben usar el mismo lienzo que las caras.',
    );
  }
  return buf;
}

/** Entradas visibles de una carpeta (sin las ocultas, como `.DS_Store` o `.cost.json`). */
function visibleEntries(dir: string, what: string): string[] {
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) throw new Error();
    entries = readdirSync(dir);
  } catch {
    throw new ImageInputError(`No se encontró la carpeta de ${what} o no se puede leer: ${dir}`);
  }
  return entries.filter((e) => !e.startsWith('.')).sort();
}

/** Lee y valida las poses de `dir`: cada `.png` debe llamarse como una pose conocida. No escribe nada. */
async function readPoses(dir: string, canvas: Size): Promise<Partial<Record<PoseId, Buffer>>> {
  const files = visibleEntries(dir, 'poses').filter((f) => f.toLowerCase().endsWith('.png'));
  const poses: Partial<Record<PoseId, Buffer>> = {};
  for (const file of files) {
    const id = file.slice(0, -4);
    if (!(POSE_IDS as readonly string[]).includes(id)) {
      throw new ImageInputError(
        `La pose ${file} no tiene un nombre conocido. Las poses se llaman ${POSE_IDS.map((p) => `${p}.png`).join(', ')}.`,
      );
    }
    poses[id as PoseId] = await readMotionPng(join(dir, file), `La pose ${file}`, canvas);
  }
  if (Object.keys(poses).length === 0) {
    throw new ImageInputError(`No hay poses en ${dir}: se esperaban archivos como ${POSE_IDS[0]}.png.`);
  }
  return poses;
}

/**
 * Lee y valida los clips de `dir`: una subcarpeta por clip conocido con sus cuadros `000.png`,
 * `001.png`… sin huecos y al menos dos. No escribe nada.
 */
async function readClips(dir: string, canvas: Size): Promise<Partial<Record<ClipId, Buffer[]>>> {
  const clips: Partial<Record<ClipId, Buffer[]>> = {};
  const names = CLIP_IDS.join(', ');
  for (const entry of visibleEntries(dir, 'clips')) {
    const path = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      throw new ImageInputError(`No se puede leer "${entry}" en la carpeta de clips (¿un enlace roto?): ${path}`);
    }
    if (!isDir) continue;
    if (!(CLIP_IDS as readonly string[]).includes(entry)) {
      throw new ImageInputError(`La carpeta de clip "${entry}" no tiene un nombre conocido. Los clips se llaman ${names}.`);
    }
    const files = visibleEntries(path, `el clip ${entry}`).filter((f) => f.toLowerCase().endsWith('.png'));
    const odd = files.find((f) => !CLIP_FRAME_RE.test(f));
    if (odd !== undefined) {
      throw new ImageInputError(`El cuadro ${entry}/${odd} no sigue la numeración 000.png, 001.png…`);
    }
    if (files.length < CLIP_MIN_FRAMES) {
      throw new ImageInputError(`El clip ${entry} necesita al menos ${CLIP_MIN_FRAMES} cuadros (000.png, 001.png…).`);
    }
    if (files.length > CLIP_MAX_FRAMES) {
      throw new ImageInputError(
        `El clip ${entry} tiene ${files.length} cuadros; el máximo es ${CLIP_MAX_FRAMES} (5 s a 24 cuadros por segundo).`,
      );
    }
    const expected = files.map((_, i) => `${String(i).padStart(3, '0')}.png`);
    const gap = expected.find((f, i) => files[i] !== f);
    if (gap !== undefined) {
      throw new ImageInputError(`Al clip ${entry} le falta el cuadro ${gap}: los cuadros van de 000.png en adelante, sin huecos.`);
    }
    const frames: Buffer[] = [];
    for (const file of files) frames.push(await readMotionPng(join(path, file), `El cuadro ${entry}/${file}`, canvas));
    clips[entry as ClipId] = frames;
  }
  if (Object.keys(clips).length === 0) {
    throw new ImageInputError(`No hay clips en ${dir}: se esperaba una subcarpeta por clip (${names}).`);
  }
  return clips;
}

export async function runImportFaces(deps: ImportFacesDeps): Promise<ImportFacesResult> {
  const { root, name, facesDir, posesDir, clipsDir, out } = deps;
  let stage: Stage = 'las caras';
  try {
    validateAgentName(name);
    if (facesDir === undefined && posesDir === undefined && clipsDir === undefined) {
      throw new ImageInputError('Indica qué importar: --caras, --poses o --clips.');
    }
    const dir = join(root, 'agents', name);
    const exists = existsSync(join(dir, 'agent.json'));
    // Todo se valida antes de escribir el primer archivo: si algo falla, no cambia nada.
    const imported = facesDir === undefined ? undefined : await readFaces(facesDir);
    if (imported === undefined && !exists) {
      throw new ImageInputError(`El agente "${name}" no existe: importa primero sus 8 caras con --caras.`);
    }
    if (exists) {
      loadAgent(root, name);
      if (deps.photoPath !== undefined) out(`El agente "${name}" ya existe: se conserva su foto y se ignora --foto.`);
    }
    // Tamaño de las caras actuales; si no se puede leer (p. ej. una creación interrumpida dejó el
    // agente sin neutral.png), las caras nuevas de --caras mandan y no se bloquea nada.
    const current = exists ? await agentCanvas(dir) : undefined;
    const canvas = imported?.size ?? current;
    if (canvas === undefined) {
      throw new ImageInputError(
        `No se pudo leer la cara neutral del agente "${name}" para comprobar el tamaño. ` +
          'Vuelve a importar sus 8 caras con --caras (puedes sumar --poses y --clips en el mismo comando).',
      );
    }
    stage = 'las poses';
    const poses = posesDir === undefined ? undefined : await readPoses(posesDir, canvas);
    stage = 'los clips';
    const clips = clipsDir === undefined ? undefined : await readClips(clipsDir, canvas);
    stage = 'las caras';
    const photo =
      exists || imported === undefined
        ? undefined
        : deps.photoPath === undefined
          ? imported.faces.neutral
          : (await readPhoto(deps.photoPath)).buf;

    if (photo !== undefined) createAgent(root, name, photo, { promptsVersion: 0 });
    if (imported !== undefined) for (const id of FACE_IDS) saveFace(root, name, id, imported.faces[id]);
    stage = 'las poses';
    if (poses !== undefined) savePoses(root, name, poses);
    stage = 'los clips';
    if (clips !== undefined) saveClips(root, name, clips);
    stage = 'las caras';
    if (imported !== undefined && current !== undefined) warnCanvasChange(root, name, current, imported.size, poses, clips, out);

    const config = loadConfig(root);
    if (config.activeAgent === null) saveConfig(root, { ...config, activeAgent: name });
    const parts: string[] = [];
    if (imported !== undefined) parts.push(`sus ${FACE_IDS.length} caras desde ${facesDir}`);
    if (poses !== undefined) parts.push(`${Object.keys(poses).length} poses desde ${posesDir}`);
    if (clips !== undefined) {
      const frames = Object.values(clips).reduce((n, f) => n + f.length, 0);
      parts.push(`${Object.keys(clips).length} clips (${frames} cuadros) desde ${clipsDir}`);
    }
    return {
      status: 'done',
      message: `Listo: el agente "${name}" tiene importadas ${parts.join(', ')}. No se usó Gemini ni se gastó nada.`,
    };
  } catch (error) {
    if (error instanceof ImageInputError) return { status: 'failed', message: error.message };
    const first = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
    return { status: 'failed', message: `No se pudieron importar ${stage}: ${first}` };
  }
}

/** Tamaño de las caras que ya tiene el agente (su `neutral.png`), o `undefined` si falta o está dañada. */
async function agentCanvas(dir: string): Promise<Size | undefined> {
  const label = 'la cara neutral del agente';
  try {
    return await readSize(readImageFile(join(dir, 'faces', 'neutral.png'), label), label);
  } catch {
    return undefined;
  }
}

/**
 * Si las caras nuevas miden distinto que las anteriores, las poses y clips que el agente ya tenía
 * (y que no se reemplazaron en esta importación) ya no coinciden: el panel los ignorará.
 */
function warnCanvasChange(
  root: string,
  name: string,
  before: Size,
  after: Size,
  poses: unknown,
  clips: unknown,
  out: (line: string) => void,
): void {
  if (before.width === after.width && before.height === after.height) return;
  const stale: string[] = [];
  if (poses === undefined && listPoses(root, name).length > 0) stale.push('poses');
  if (clips === undefined && Object.keys(listClips(root, name)).length > 0) stale.push('clips');
  if (stale.length === 0) return;
  const what = stale.map((s) => (s === 'poses' ? 'las poses' : 'los clips')).join(' y ');
  out(
    `Aviso: las caras nuevas miden ${after.width}×${after.height} px y las anteriores ${before.width}×${before.height} px. ` +
      `El panel va a ignorar ${what} que ya tenía el agente (no coinciden con el lienzo nuevo) hasta que los vuelvas ` +
      `a importar con ${stale.map((s) => `--${s}`).join(' y ')}.`,
  );
}
