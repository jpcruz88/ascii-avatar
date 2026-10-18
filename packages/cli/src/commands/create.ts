import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  BudgetExceededError,
  CREATION_CAP_USD,
  FACE_IDS,
  assertWithinCap,
  createAgent,
  decodeImage,
  frameToAnsi,
  imageToAscii,
  loadAgent,
  missingFaces,
  saveFace,
  validateAgentName,
  type AsciiMode,
  type FaceId,
  type Ledger,
} from '@ascii-avatar/core';
import {
  ESTIMATED_FACE_COST_USD,
  ImageRefusedError,
  PROMPTS_VERSION,
  estimateCreationCostUsd,
  generateFace,
  type ImageClient,
} from '@ascii-avatar/gemini';
import { loadConfig, saveConfig } from '../config.js';

export interface CreateDeps {
  root: string;
  name: string;
  /** Obligatoria si el agente no existe; si ya existe se reutiliza la foto guardada. */
  photoPath?: string;
  imageClient: ImageClient;
  ledger: Ledger;
  /** Tope de gasto de creación por agente. Por defecto `CREATION_CAP_USD`. */
  cap?: number;
  ask: (question: string) => Promise<boolean>;
  out: (line: string) => void;
  mode: AsciiMode;
  cols: number;
}

export interface CreateResult {
  status: 'done' | 'declined' | 'capped' | 'failed';
  message: string;
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 256;
const MAX_SIDE = 8000;
const PREVIEW_FACE: FaceId = 'mouth_open';

type Mime = 'image/png' | 'image/jpeg' | 'image/webp';
interface Photo {
  buf: Buffer;
  mimeType: Mime;
}

/** Error esperado: su mensaje ya está en español y es seguro mostrarlo tal cual. */
class CreateFailure extends Error {}

function mimeFromBytes(buf: Buffer): Mime | undefined {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/** Lee y valida la foto antes de cualquier llamada o gasto. */
async function readPhoto(path: string): Promise<Photo> {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new CreateFailure(`La ruta de la foto no es un archivo: ${path}`);
    size = stat.size;
  } catch (error) {
    if (error instanceof CreateFailure) throw error;
    throw new CreateFailure(`No se encontró la foto o no se puede leer: ${path}`);
  }
  if (size > MAX_PHOTO_BYTES) throw new CreateFailure('La foto pesa más de 10 MB. Usa una más liviana.');
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    throw new CreateFailure(`No se pudo leer la foto: ${path}`);
  }
  const mimeType = mimeFromBytes(buf);
  if (!mimeType) throw new CreateFailure('La foto debe ser una imagen PNG, JPG o WebP.');
  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(buf).metadata();
    // Con orientación EXIF 5 a 8 la imagen se muestra girada 90 grados: se intercambian los lados.
    const rotated = (meta.orientation ?? 1) >= 5;
    width = rotated ? meta.height : meta.width;
    height = rotated ? meta.width : meta.height;
  } catch {
    throw new CreateFailure('No se pudo leer la foto: el archivo está dañado.');
  }
  if (width === undefined || height === undefined) throw new CreateFailure('No se pudo leer el tamaño de la foto.');
  if (Math.min(width, height) < MIN_SIDE || Math.max(width, height) > MAX_SIDE) {
    throw new CreateFailure(
      `La foto mide ${width}×${height} px; cada lado debe medir entre ${MIN_SIDE} y ${MAX_SIDE} px.`,
    );
  }
  return { buf, mimeType };
}

function storedPhotoPath(root: string, name: string): string {
  const dir = join(root, 'agents', name);
  for (const ext of ['png', 'jpg', 'webp']) {
    const file = join(dir, `photo.${ext}`);
    if (existsSync(file)) return file;
  }
  throw new CreateFailure(`El agente "${name}" no tiene su foto guardada. Pásala con la ruta de la foto.`);
}

/** Texto corto y sin llaves de API ni trazas, para mostrar un error inesperado. */
function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = (raw.split('\n')[0] ?? '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[llave oculta]')
    .replace(/([?&]key=)[^\s&]+/gi, '$1[oculta]')
    .trim();
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
}

const usd = (n: number): string => n.toFixed(2);

export async function runCreate(deps: CreateDeps): Promise<CreateResult> {
  const { root, name, imageClient, ledger, ask, out } = deps;
  const cap = deps.cap ?? CREATION_CAP_USD;
  const agentDir = join(root, 'agents', name);
  const manualHint = (): string =>
    `Gemini rechazó editar la foto (probable filtro de contenido). Puedes poner tus propias 8 imágenes PNG en ` +
    `${join(agentDir, 'faces')}/<id>.png con estos nombres: ${FACE_IDS.join(', ')}. Luego vuelve a correr el comando.`;

  try {
    validateAgentName(name);
    const exists = existsSync(join(agentDir, 'agent.json'));
    let missing: FaceId[] = [...FACE_IDS];
    let photo: Photo | undefined;

    if (exists) {
      loadAgent(root, name);
      missing = missingFaces(root, name);
      if (missing.length === 0) {
        return { status: 'done', message: `El agente "${name}" ya tiene las ${FACE_IDS.length} caras. No hay nada que generar.` };
      }
      out('Se reutiliza la foto guardada del agente.');
      photo = await readPhoto(storedPhotoPath(root, name));
    } else {
      if (deps.photoPath === undefined) {
        throw new CreateFailure(`El agente "${name}" no existe: indica la ruta de la foto para crearlo.`);
      }
      photo = await readPhoto(deps.photoPath);
    }

    out(`Estimado: $${usd(estimateCreationCostUsd(missing.length))} USD (tope $${usd(cap)})`);
    out(`Ya gastado en este agente: $${usd(ledger.spentCreation(name))} USD`);
    if (!(await ask('¿Generar las caras? (s/N)'))) {
      return { status: 'declined', message: 'Cancelado: no se gastó nada.' };
    }

    if (!exists) createAgent(root, name, photo.buf, { promptsVersion: PROMPTS_VERSION });
    const photoBuf = photo.buf;
    const mimeType = photo.mimeType;

    /** Una llamada de pago: tope antes, y guardar y registrar el costo justo después. */
    const generate = async (id: FaceId): Promise<Buffer> => {
      assertWithinCap(ledger.spentCreation(name), ESTIMATED_FACE_COST_USD, cap);
      const { png, costUsd, costEstimated } = await generateFace(imageClient, photoBuf, mimeType, id);
      try {
        saveFace(root, name, id, png);
      } finally {
        ledger.record('create', name, costUsd); // lo cobrado se registra aunque falle el guardado
      }
      out(`Cara ${id} lista ($${costUsd.toFixed(4)} USD${costEstimated ? ' (estimado)' : ''})`);
      return png;
    };

    if (missing.includes(PREVIEW_FACE)) {
      const png = await generate(PREVIEW_FACE);
      try {
        out(frameToAnsi(imageToAscii(await decodeImage(png), { cols: deps.cols, mode: deps.mode })));
      } catch {
        out('(no se pudo mostrar la vista previa)');
      }
      missing = missing.filter((id) => id !== PREVIEW_FACE);
      if (missing.length > 0 && !(await ask('¿Seguimos con las demás caras? (s/N)'))) {
        return {
          status: 'declined',
          message: `Te quedaste con la vista previa (ya cobrada). Faltan ${missing.length} caras; vuelve a correr el comando para continuar.`,
        };
      }
    }

    for (const id of missing) await generate(id);

    const left = missingFaces(root, name);
    if (left.length > 0) throw new CreateFailure(`Faltan caras tras la generación: ${left.join(', ')}.`);
    const config = loadConfig(root);
    if (config.activeAgent === null) saveConfig(root, { ...config, activeAgent: name });
    return {
      status: 'done',
      message: `Listo: el agente "${name}" tiene sus ${FACE_IDS.length} caras. Gasto total en creación: $${usd(ledger.spentCreation(name))} USD.`,
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      const left = missingFaces(root, name);
      return {
        status: 'capped',
        message:
          `Se alcanzó el tope de creación ($${usd(cap)} USD). Las caras ya generadas quedan guardadas; ` +
          `faltan: ${left.join(', ')}.`,
      };
    }
    if (error instanceof ImageRefusedError) return { status: 'failed', message: manualHint() };
    if (error instanceof CreateFailure) return { status: 'failed', message: error.message };
    return {
      status: 'failed',
      message: `No se pudo completar la creación: ${safeMessage(error)}. Lo ya generado quedó guardado; al volver a correr solo se generan las caras que faltan.`,
    };
  }
}
