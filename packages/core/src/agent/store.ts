import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeImage } from '../ascii/decode.js';
import { imageToAscii, mergeToneRanges, toneRange } from '../ascii/convert.js';
import type { AsciiFrame, AsciiMode, RawImage } from '../ascii/types.js';
import { FACE_IDS, type FaceId } from '../faces.js';
import { writeFileAtomic } from './atomic.js';

/** Datos del agente que se guardan en `agent.json`. */
export interface AgentConfig {
  name: string;
  voice: string;
  personality: string;
  createdAt: string;
  promptsVersion: number;
}

export interface CreateAgentOptions {
  voice?: string;
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
  const config: AgentConfig = {
    name,
    voice: opts.voice ?? 'Kore',
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
    typeof c.promptsVersion !== 'number'
  ) {
    throw new CorruptAgentError(name, 'faltan campos o tienen un tipo incorrecto');
  }
  if (c.name !== name) {
    throw new CorruptAgentError(name, `el nombre guardado es "${c.name}"`);
  }
  return c as unknown as AgentConfig;
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

/**
 * Lee las 8 caras y las convierte a cuadros ASCII. Falla si falta alguna. En modo `grabado` el
 * estiramiento de contraste usa un solo rango calculado sobre las 8 caras, para que al alternar
 * entre ellas el tono no parpadee.
 */
export async function loadAtlas(
  root: string,
  name: string,
  opts: { cols: number; mode: AsciiMode },
): Promise<Record<FaceId, AsciiFrame>> {
  const missing = missingFaces(root, name);
  if (missing.length > 0) {
    throw new Error(`Faltan caras del agente "${name}": ${missing.join(', ')}.`);
  }
  const dir = agentDir(root, name);
  const images = {} as Record<FaceId, RawImage>;
  for (const id of FACE_IDS) {
    images[id] = await decodeImage(readFileSync(join(dir, 'faces', `${id}.png`)));
  }
  const tone =
    opts.mode === 'grabado'
      ? mergeToneRanges(FACE_IDS.map((id) => toneRange(images[id])))
      : undefined;
  const atlas = {} as Record<FaceId, AsciiFrame>;
  for (const id of FACE_IDS) {
    atlas[id] = imageToAscii(images[id], { ...opts, ...(tone === undefined ? {} : { tone }) });
  }
  return atlas;
}
