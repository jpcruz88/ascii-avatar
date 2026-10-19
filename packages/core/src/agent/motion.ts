// Poses y clips opcionales de un agente: dónde viven, cómo se listan y cómo se reemplazan.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLIP_IDS, POSE_IDS, type ClipId, type PoseId } from '../faces.js';

export const POSES_DIR = 'poses';
export const CLIPS_DIR = 'clips';

/** Nombre del cuadro `index` de un clip: `000.png`, `001.png`… */
export const clipFrameFile = (index: number): string => `${String(index).padStart(3, '0')}.png`;

const CLIP_FRAME_RE = /^\d{3}\.png$/;

/** Poses con PNG en `<dir>/poses/`, en el orden de `POSE_IDS`. */
export function posesIn(dir: string): PoseId[] {
  return POSE_IDS.filter((id) => existsSync(join(dir, POSES_DIR, `${id}.png`)));
}

/**
 * Clips de `<dir>/clips/` con su número de cuadros. Un clip vale si sus cuadros van de `000.png`
 * en adelante sin huecos; si no (o está vacío), se ignora.
 */
export function clipsIn(dir: string): Partial<Record<ClipId, number>> {
  const out: Partial<Record<ClipId, number>> = {};
  for (const clip of CLIP_IDS) {
    let files: string[];
    try {
      files = readdirSync(join(dir, CLIPS_DIR, clip)).filter((f) => CLIP_FRAME_RE.test(f));
    } catch {
      continue;
    }
    const numbers = files.map((f) => Number(f.slice(0, 3))).sort((a, b) => a - b);
    if (numbers.length > 0 && numbers.every((n, i) => n === i)) out[clip] = numbers.length;
  }
  return out;
}

/**
 * Arregla lo que dejó una importación interrumpida: si falta `<sub>/` pero quedó un
 * `<sub>.<tag>.old`, lo restaura (era el juego vigente); luego borra los `.tmp` y `.old` sobrantes.
 */
export function recoverDir(dir: string, sub: string): void {
  const leftover = new RegExp(`^${sub}\\.[0-9a-f]+\\.(tmp|old)$`);
  const entries = readdirSync(dir).filter((e) => leftover.test(e));
  const target = join(dir, sub);
  const old = entries.find((e) => e.endsWith('.old'));
  if (!existsSync(target) && old !== undefined) renameSync(join(dir, old), target);
  // El restaurado ya no existe con su nombre viejo: `force` lo salta.
  for (const e of entries) rmSync(join(dir, e), { recursive: true, force: true });
}

/**
 * Reemplaza `<dir>/<sub>/` entero por `files` (ruta relativa → contenido) casi de forma atómica:
 * escribe todo en una carpeta temporal y la cambia por la anterior con dos `rename`. Si algo falla,
 * la carpeta anterior queda como estaba y no quedan temporales. Antes, arregla lo que haya dejado
 * una importación interrumpida (ver `recoverDir`).
 */
export function replaceDir(dir: string, sub: string, files: ReadonlyMap<string, Buffer>): void {
  recoverDir(dir, sub);
  const tag = randomBytes(6).toString('hex');
  const staging = join(dir, `${sub}.${tag}.tmp`);
  const target = join(dir, sub);
  const old = join(dir, `${sub}.${tag}.old`);
  let movedOld = false;
  try {
    mkdirSync(staging, { recursive: true });
    for (const [rel, data] of files) {
      const path = join(staging, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data, { flag: 'wx' });
    }
    if (existsSync(target)) {
      renameSync(target, old);
      movedOld = true;
    }
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (movedOld && !existsSync(target)) renameSync(old, target);
    throw error;
  }
  if (movedOld) rmSync(old, { recursive: true, force: true });
}
