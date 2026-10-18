// `avatar create <nombre> --caras <carpeta>`: importa un paquete de caras hecho a mano.
// No usa Gemini: no pide llave, no gasta y no escribe en el ledger.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FACE_IDS, createAgent, loadAgent, saveFace, validateAgentName, type FaceId } from '@ascii-avatar/core';
import { loadConfig, saveConfig } from '../config.js';
import { ImageInputError, assertSideRange, mimeFromBytes, readImageFile, readPhoto, readSize } from '../image-input.js';

export interface ImportFacesDeps {
  root: string;
  name: string;
  /** Carpeta con los ocho `<id>.png`. */
  facesDir: string;
  /** Foto base opcional; si falta se usa `neutral.png`. Se ignora si el agente ya existe. */
  photoPath?: string;
  out: (line: string) => void;
}

export interface ImportFacesResult {
  status: 'done' | 'failed';
  message: string;
}

const FACE_MIN_SIDE = 64;

/** Lee y valida las ocho caras (PNG, tamaños iguales). No escribe nada. */
async function readFaces(facesDir: string): Promise<Record<FaceId, Buffer>> {
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
  return faces;
}

export async function runImportFaces(deps: ImportFacesDeps): Promise<ImportFacesResult> {
  const { root, name, facesDir, out } = deps;
  try {
    validateAgentName(name);
    const exists = existsSync(join(root, 'agents', name, 'agent.json'));
    // Todo se valida antes de escribir la primera cara: o se importan las ocho o ninguna.
    const faces = await readFaces(facesDir);
    if (exists) {
      loadAgent(root, name);
      if (deps.photoPath !== undefined) out(`El agente "${name}" ya existe: se conserva su foto y se ignora --foto.`);
    }
    const photo = exists ? undefined : deps.photoPath === undefined ? faces.neutral : (await readPhoto(deps.photoPath)).buf;

    if (photo !== undefined) createAgent(root, name, photo, { promptsVersion: 0 });
    for (const id of FACE_IDS) saveFace(root, name, id, faces[id]);

    const config = loadConfig(root);
    if (config.activeAgent === null) saveConfig(root, { ...config, activeAgent: name });
    return {
      status: 'done',
      message: `Listo: el agente "${name}" tiene sus ${FACE_IDS.length} caras importadas desde ${facesDir}. No se usó Gemini ni se gastó nada.`,
    };
  } catch (error) {
    if (error instanceof ImageInputError) return { status: 'failed', message: error.message };
    const first = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
    return { status: 'failed', message: `No se pudieron importar las caras: ${first}` };
  }
}
