import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decodeImage } from '../ascii/decode.js';
import { grabadoTone, imageToAscii, type GrabadoTone } from '../ascii/convert.js';
import type { AsciiFrame, AsciiMode, RawImage } from '../ascii/types.js';
import { blendImages } from '../ascii/blend.js';
import {
  CLIP_IDS,
  FACE_IDS,
  MOUTH_BLENDS,
  POSE_IDS,
  clipFrameId,
  easeFrameId,
  poseFrameId,
  type BaseFrameId,
  type BlendFrameId,
  type ClipFrameId,
  type ClipId,
  type EaseFrameId,
  type FaceId,
  type Motion,
  type PoseFrameId,
  type PoseId,
} from '../faces.js';
import { readAtlasCache, writeAtlasCache, type AtlasCache } from './atlas-cache.js';
import { writeFileAtomic } from './atomic.js';
import { CLIPS_DIR, POSES_DIR, clipFrameFile, clipsIn, posesIn, replaceDir } from './motion.js';

/** Datos del agente que se guardan en `agent.json`. */
export interface AgentConfig {
  name: string;
  voice: string;
  /** Cómo debe sonar la voz (texto libre, hasta `MAX_VOICE_STYLE_LENGTH` caracteres). Ausente: sin estilo. */
  voiceStyle?: string;
  personality: string;
  createdAt: string;
  promptsVersion: number;
}

/** Largo máximo del estilo de voz, en caracteres. */
export const MAX_VOICE_STYLE_LENGTH = 300;

export interface CreateAgentOptions {
  voice?: string;
  voiceStyle?: string;
  personality?: string;
  /** Versión de los prompts con que se generaron las caras. Por defecto 1. */
  promptsVersion?: number;
}

export class InvalidAgentNameError extends Error {
  constructor(name: string) {
    super(
      `Nombre de agente inválido: ${JSON.stringify(name)}. Usa de 1 a 32 caracteres entre a-z, 0-9 y guion.`,
    );
    this.name = 'InvalidAgentNameError';
  }
}

export class InvalidPhotoError extends Error {
  constructor() {
    super('La foto no es válida: debe ser una imagen PNG, JPG o WebP.');
    this.name = 'InvalidPhotoError';
  }
}

export class InvalidFaceImageError extends Error {
  constructor(id: string) {
    super(
      `La cara ${id} no es un PNG (la firma del archivo no coincide). ` +
        'Las caras se guardan siempre como PNG real: convierte la imagen antes de guardarla.',
    );
    this.name = 'InvalidFaceImageError';
  }
}

export class InvalidVoiceError extends Error {
  constructor(detail: string) {
    super(`Voz inválida: ${detail}.`);
    this.name = 'InvalidVoiceError';
  }
}

export class AgentExistsError extends Error {
  constructor(name: string) {
    super(`Ya existe un agente llamado "${name}".`);
    this.name = 'AgentExistsError';
  }
}

export class CorruptAgentError extends Error {
  constructor(name: string, detail: string) {
    super(`El archivo agent.json del agente "${name}" está dañado: ${detail}.`);
    this.name = 'CorruptAgentError';
  }
}

export class AgentNotFoundError extends Error {
  constructor(name: string) {
    super(`No existe el agente "${name}".`);
    this.name = 'AgentNotFoundError';
  }
}

const NAME_RE = /^[a-z0-9-]{1,32}$/;

/** Solo se aceptan `a-z`, `0-9` y `-` (1 a 32), lo que impide salirse de la carpeta. */
export function validateAgentName(name: string): void {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new InvalidAgentNameError(String(name));
}

function agentDir(root: string, name: string): string {
  validateAgentName(name);
  return join(root, 'agents', name);
}

function photoExtension(buf: Buffer): 'png' | 'jpg' | 'webp' | undefined {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return undefined;
}

/** Crea `<root>/agents/<name>/` con `agent.json` y la foto original tal cual. */
export function createAgent(
  root: string,
  name: string,
  photo: Buffer,
  opts: CreateAgentOptions = {},
): AgentConfig {
  const dir = agentDir(root, name);
  const ext = photoExtension(photo);
  if (!ext) throw new InvalidPhotoError();
  if (existsSync(join(dir, 'agent.json'))) throw new AgentExistsError(name);
  const voiceStyle = opts.voiceStyle === undefined ? '' : checkVoiceStyle(opts.voiceStyle);
  const config: AgentConfig = {
    name,
    voice: opts.voice ?? 'Kore',
    ...(voiceStyle === '' ? {} : { voiceStyle }),
    personality: opts.personality ?? '',
    createdAt: new Date().toISOString(),
    promptsVersion: opts.promptsVersion ?? 1,
  };
  mkdirSync(join(dir, 'faces'), { recursive: true });
  // agent.json va al final: su existencia indica que el agente quedó completo.
  writeFileAtomic(join(dir, `photo.${ext}`), photo);
  writeFileAtomic(join(dir, 'agent.json'), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function loadAgent(root: string, name: string): AgentConfig {
  const file = join(agentDir(root, name), 'agent.json');
  if (!existsSync(file)) throw new AgentNotFoundError(name);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CorruptAgentError(name, 'no es JSON válido');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CorruptAgentError(name, 'no es un objeto');
  }
  const c = raw as Record<string, unknown>;
  if (
    typeof c.name !== 'string' ||
    typeof c.voice !== 'string' ||
    typeof c.personality !== 'string' ||
    typeof c.createdAt !== 'string' ||
    typeof c.promptsVersion !== 'number' ||
    (c.voiceStyle !== undefined && typeof c.voiceStyle !== 'string')
  ) {
    throw new CorruptAgentError(name, 'faltan campos o tienen un tipo incorrecto');
  }
  if (c.name !== name) {
    throw new CorruptAgentError(name, `el nombre guardado es "${c.name}"`);
  }
  return c as unknown as AgentConfig;
}

/** Devuelve el estilo sin espacios en los extremos; lanza si pasa de `MAX_VOICE_STYLE_LENGTH`. */
function checkVoiceStyle(style: string): string {
  const trimmed = style.trim();
  if (trimmed.length > MAX_VOICE_STYLE_LENGTH) {
    throw new InvalidVoiceError(`el estilo de voz admite hasta ${MAX_VOICE_STYLE_LENGTH} caracteres`);
  }
  return trimmed;
}

/**
 * Cambia la voz y/o el estilo de voz de un agente reescribiendo `agent.json` de forma atómica.
 * `voiceStyle: ''` quita el estilo. Lo que no se indica no se toca. No repara un archivo dañado.
 */
export function updateAgentVoice(
  root: string,
  name: string,
  changes: { voice?: string; voiceStyle?: string },
): AgentConfig {
  const current = loadAgent(root, name);
  const { voiceStyle: _quitado, ...rest } = current;
  const voice = changes.voice === undefined ? current.voice : changes.voice.trim();
  if (voice === '') throw new InvalidVoiceError('el nombre de la voz no puede estar vacío');
  const style =
    changes.voiceStyle === undefined ? (current.voiceStyle ?? '') : checkVoiceStyle(changes.voiceStyle);
  const next: AgentConfig = { ...rest, voice, ...(style === '' ? {} : { voiceStyle: style }) };
  if (JSON.stringify(next) === JSON.stringify(current)) return current;
  writeFileAtomic(join(agentDir(root, name), 'agent.json'), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Guarda el PNG de una cara en `faces/<id>.png`. Contrato: los bytes deben ser un PNG real
 * (firma de 8 bytes); si no, lanza `InvalidFaceImageError` y no escribe nada.
 */
export function saveFace(root: string, name: string, id: FaceId, png: Buffer): void {
  const dir = agentDir(root, name);
  if (!(FACE_IDS as readonly string[]).includes(id)) {
    throw new Error(`Cara desconocida: ${JSON.stringify(id)}.`);
  }
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new InvalidFaceImageError(id);
  }
  mkdirSync(join(dir, 'faces'), { recursive: true });
  writeFileAtomic(join(dir, 'faces', `${id}.png`), png);
}

/** Caras que aún no tienen PNG, en el orden de `FACE_IDS`. */
export function missingFaces(root: string, name: string): FaceId[] {
  const dir = agentDir(root, name);
  return FACE_IDS.filter((id) => !existsSync(join(dir, 'faces', `${id}.png`)));
}

function isPng(buf: Buffer): boolean {
  return buf.length >= PNG_SIGNATURE.length && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/** Poses que tiene el agente (`poses/<id>.png`), en el orden de `POSE_IDS`. */
export function listPoses(root: string, name: string): PoseId[] {
  return posesIn(agentDir(root, name));
}

/** Clips del agente con su número de cuadros; un clip con huecos en la numeración no cuenta. */
export function listClips(root: string, name: string): Partial<Record<ClipId, number>> {
  return clipsIn(agentDir(root, name));
}

/**
 * Reemplaza el juego entero de poses del agente por `poses`. Todo o nada: si algún id es desconocido
 * o algún archivo no es un PNG real, lanza sin escribir nada.
 */
export function savePoses(root: string, name: string, poses: Partial<Record<PoseId, Buffer>>): void {
  const dir = agentDir(root, name);
  const files = new Map<string, Buffer>();
  for (const [id, png] of Object.entries(poses) as [string, Buffer][]) {
    if (!(POSE_IDS as readonly string[]).includes(id)) throw new Error(`Pose desconocida: ${JSON.stringify(id)}.`);
    if (!isPng(png)) throw new InvalidFaceImageError(`pose ${id}`);
    files.set(`${id}.png`, png);
  }
  replaceDir(dir, POSES_DIR, files);
}

/**
 * Reemplaza el juego entero de clips del agente: cada clip queda como `clips/<clip>/000.png`,
 * `001.png`… Todo o nada, como `savePoses`.
 */
export function saveClips(root: string, name: string, clips: Partial<Record<ClipId, readonly Buffer[]>>): void {
  const dir = agentDir(root, name);
  const files = new Map<string, Buffer>();
  for (const [clip, frames] of Object.entries(clips) as [string, readonly Buffer[]][]) {
    if (!(CLIP_IDS as readonly string[]).includes(clip)) throw new Error(`Clip desconocido: ${JSON.stringify(clip)}.`);
    if (frames.length === 0) throw new Error(`El clip ${clip} no tiene cuadros.`);
    frames.forEach((png, i) => {
      if (!isPng(png)) throw new InvalidFaceImageError(`clip ${clip}/${clipFrameFile(i)}`);
      files.set(join(clip, clipFrameFile(i)), png);
    });
  }
  replaceDir(dir, CLIPS_DIR, files);
}

/** Cuadros ASCII de un agente: los de base siempre y, si los tiene, `pose:<id>` y `clip:<clip>:<n>`. */
export type Atlas = Record<BaseFrameId, AsciiFrame> &
  Partial<Record<PoseFrameId | ClipFrameId | EaseFrameId, AsciiFrame>>;

/** Qué poses y clips (con cuántos cuadros) trae un atlas: lo que el animador puede usar. */
export function atlasMotion(atlas: Atlas): Motion {
  const keys = new Set(Object.keys(atlas));
  const poses = POSE_IDS.filter((id) => keys.has(poseFrameId(id)));
  const clips: Partial<Record<ClipId, number>> = {};
  for (const clip of CLIP_IDS) {
    let n = 0;
    while (keys.has(clipFrameId(clip, n))) n++;
    if (n > 0) clips[clip] = n;
  }
  return { poses, clips };
}

/** Sube si cambia cómo se convierten los cuadros, para no reutilizar una caché vieja. */
const CACHE_VERSION = 1;
/** Cuántas imágenes se decodifican a la vez (sharp usa hilos aparte). */
const DECODE_BATCH = 4;

const sha = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 20);

/** Fecha de modificación y tamaño del archivo: si no cambian, su cuadro guardado sigue valiendo. */
function fileSig(path: string): string {
  const { mtimeMs, size } = statSync(path);
  return `${mtimeMs}:${size}`;
}

/** Ancho y alto de un PNG leídos de su cabecera IHDR, sin decodificarlo. */
function pngSize(buf: Buffer): { width: number; height: number } | undefined {
  if (!isPng(buf) || buf.length < 24) return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

interface Job {
  id: string;
  /** Archivos de los que sale el cuadro (entran en la clave de la caché). */
  files: string[];
  /** Imagen a convertir; `undefined` si el archivo no sirve (dañado o de otro tamaño). */
  image: () => Promise<RawImage | undefined>;
}

/**
 * Lee las 8 caras y las convierte a cuadros ASCII. Falla si falta alguna. Además sintetiza los
 * cuadros intermedios de boca (`MOUTH_BLENDS`) mezclando píxel a píxel sus dos caras vecinas, y
 * convierte las poses y los cuadros de clips que el agente tenga (los que no se pueden leer o no
 * miden lo mismo que las caras se descartan; un clip con un cuadro malo se descarta entero). De
 * cada pose sintetiza además su cuadro de regreso `ease:<pose>` (mezcla a medias con neutral). En
 * modo `grabado` el estiramiento de contraste usa un solo rango calculado sobre las 8 caras, y ese
 * mismo rango vale para poses y clips, para que al alternar entre cuadros el tono no parpadee.
 *
 * Los cuadros convertidos se guardan en `.cache/` del agente (escritura atómica), con una clave por
 * cuadro hecha de la fecha y el tamaño de sus archivos, las columnas, el modo y el tono. Con
 * `cache: false` no se lee ni se escribe la caché.
 */
export async function loadAtlas(
  root: string,
  name: string,
  opts: { cols: number; mode: AsciiMode; cache?: boolean },
): Promise<Atlas> {
  const missing = missingFaces(root, name);
  if (missing.length > 0) {
    throw new Error(`Faltan caras del agente "${name}": ${missing.join(', ')}.`);
  }
  const { cols, mode } = opts;
  const useCache = opts.cache !== false;
  const dir = agentDir(root, name);
  const facePath = (id: FaceId): string => join(dir, 'faces', `${id}.png`);
  const faceImages = new Map<FaceId, Promise<RawImage>>();
  const face = (id: FaceId): Promise<RawImage> => {
    let img = faceImages.get(id);
    if (img === undefined) faceImages.set(id, (img = decodeImage(readFileSync(facePath(id)))));
    return img;
  };

  const cacheFile = join(dir, '.cache', `atlas-${mode}-${cols}.bin`);
  const cache: AtlasCache | undefined = useCache ? readAtlasCache(cacheFile) : undefined;
  const facesSig = FACE_IDS.map((id) => fileSig(facePath(id))).join('|');
  let tone: GrabadoTone | null = null;
  if (mode === 'grabado') {
    tone =
      cache !== undefined && cache.meta.facesSig === facesSig && cache.meta.tone !== null
        ? cache.meta.tone
        : grabadoTone(await Promise.all(FACE_IDS.map(face)), cols);
  }
  const toneHash = sha(JSON.stringify(tone));
  const convert = (img: RawImage): AsciiFrame =>
    imageToAscii(img, { cols, mode, ...(tone === null ? {} : { tone }) });

  const reference = pngSize(readFileSync(facePath('neutral')));
  /** Decodifica un archivo opcional; `undefined` si está dañado o no mide lo mismo que las caras. */
  const optional = async (path: string): Promise<RawImage | undefined> => {
    try {
      const img = await decodeImage(readFileSync(path));
      if (reference !== undefined && (img.width !== reference.width || img.height !== reference.height)) return undefined;
      return img;
    } catch {
      return undefined;
    }
  };

  const jobs: Job[] = [];
  for (const id of FACE_IDS) jobs.push({ id, files: [facePath(id)], image: () => face(id) });
  for (const [id, [a, b]] of Object.entries(MOUTH_BLENDS) as [BlendFrameId, readonly [FaceId, FaceId]][]) {
    jobs.push({ id, files: [facePath(a), facePath(b)], image: async () => blendImages(await face(a), await face(b), 0.5) });
  }
  for (const pose of posesIn(dir)) {
    const path = join(dir, POSES_DIR, `${pose}.png`);
    jobs.push({ id: poseFrameId(pose), files: [path], image: () => optional(path) });
    // Cuadro de regreso: la pose mezclada a medias con neutral, para soltarla sin saltar.
    jobs.push({
      id: easeFrameId(pose),
      files: [path, facePath('neutral')],
      image: async () => {
        const img = await optional(path);
        return img === undefined ? undefined : blendImages(img, await face('neutral'), 0.5);
      },
    });
  }
  const clips = clipsIn(dir);
  for (const clip of CLIP_IDS) {
    for (let i = 0; i < (clips[clip] ?? 0); i++) {
      const path = join(dir, CLIPS_DIR, clip, clipFrameFile(i));
      jobs.push({ id: clipFrameId(clip, i), files: [path], image: () => optional(path) });
    }
  }

  const frames = new Map<string, { key: string; frame: AsciiFrame }>();
  const pending: { job: Job; key: string }[] = [];
  let dirty = cache === undefined || cache.meta.facesSig !== facesSig;
  for (const job of jobs) {
    let key: string;
    try {
      key = sha([CACHE_VERSION, cols, mode, toneHash, ...job.files.map(fileSig)].join('|'));
    } catch {
      continue; // El archivo desapareció entre listar y leer: ese cuadro no se usa.
    }
    const hit = cache?.get(job.id, key);
    if (hit !== undefined) frames.set(job.id, { key, frame: hit });
    else pending.push({ job, key });
  }
  for (let i = 0; i < pending.length; i += DECODE_BATCH) {
    const batch = pending.slice(i, i + DECODE_BATCH);
    const images = await Promise.all(batch.map(({ job }) => job.image()));
    batch.forEach(({ job, key }, j) => {
      const img = images[j];
      if (img === undefined) return;
      frames.set(job.id, { key, frame: convert(img) });
      dirty = true;
    });
  }
  if (cache !== undefined && !dirty) {
    // Un cuadro que ya no existe (pose o clip quitado) también obliga a reescribir.
    dirty = cache.size !== frames.size;
  }

  const atlas: Record<string, AsciiFrame> = {};
  for (const job of jobs) {
    const entry = frames.get(job.id);
    if (entry !== undefined) atlas[job.id] = entry.frame;
  }
  // Un clip con algún cuadro malo se descarta entero: se reproduciría a saltos.
  for (const clip of CLIP_IDS) {
    const ids = Array.from({ length: clips[clip] ?? 0 }, (_, i) => clipFrameId(clip, i));
    if (!ids.every((id) => id in atlas)) for (const id of ids) delete atlas[id];
  }
  if (useCache && dirty) {
    try {
      writeAtlasCache(cacheFile, { facesSig, tone }, [...frames].map(([id, { key, frame }]) => ({ id, key, frame })));
    } catch {
      // Sin caché el panel funciona igual, solo abre más despacio.
    }
  }
  return atlas as Atlas;
}
