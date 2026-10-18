// Lectura y validación de imágenes que aporta el usuario (la foto base y las caras manuales).
// Todo se comprueba antes de cualquier llamada de pago o escritura en disco.
import { readFileSync, statSync } from 'node:fs';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SIDE = 8000;
const PHOTO_MIN_SIDE = 256;

export type Mime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface Photo {
  buf: Buffer;
  mimeType: Mime;
}

/** Error esperado: su mensaje ya está en español y es seguro mostrarlo tal cual. */
export class ImageInputError extends Error {}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function mimeFromBytes(buf: Buffer): Mime | undefined {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/** Lee el archivo comprobando que existe, que es un archivo y que pesa 10 MB o menos. `label` nombra la imagen en los mensajes. */
export function readImageFile(path: string, label: string): Buffer {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new ImageInputError(`La ruta de ${label} no es un archivo: ${path}`);
    size = stat.size;
  } catch (error) {
    if (error instanceof ImageInputError) throw error;
    throw new ImageInputError(`No se encontró ${label} o no se puede leer: ${path}`);
  }
  if (size > MAX_IMAGE_BYTES) throw new ImageInputError(`${capitalize(label)} pesa más de 10 MB. Usa una más liviana.`);
  try {
    return readFileSync(path);
  } catch {
    throw new ImageInputError(`No se pudo leer ${label}: ${path}`);
  }
}

/** Ancho y alto tal como se muestra la imagen (con orientación EXIF 5 a 8 se intercambian los lados). */
export async function readSize(buf: Buffer, label: string): Promise<{ width: number; height: number }> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(buf).metadata();
    const rotated = (meta.orientation ?? 1) >= 5;
    width = rotated ? meta.height : meta.width;
    height = rotated ? meta.width : meta.height;
  } catch {
    throw new ImageInputError(`No se pudo leer ${label}: el archivo está dañado.`);
  }
  if (width === undefined || height === undefined) throw new ImageInputError(`No se pudo leer el tamaño de ${label}.`);
  return { width, height };
}

/** Falla si algún lado queda fuera de `minSide`..`MAX_SIDE`. */
export function assertSideRange(width: number, height: number, minSide: number, label: string): void {
  if (Math.min(width, height) < minSide || Math.max(width, height) > MAX_SIDE) {
    throw new ImageInputError(
      `${capitalize(label)} mide ${width}×${height} px; cada lado debe medir entre ${minSide} y ${MAX_SIDE} px.`,
    );
  }
}

/** Lee y valida la foto base: PNG, JPG o WebP de 10 MB o menos, con cada lado entre 256 y 8000 px. */
export async function readPhoto(path: string): Promise<Photo> {
  const buf = readImageFile(path, 'la foto');
  const mimeType = mimeFromBytes(buf);
  if (!mimeType) throw new ImageInputError('La foto debe ser una imagen PNG, JPG o WebP.');
  const { width, height } = await readSize(buf, 'la foto');
  assertSideRange(width, height, PHOTO_MIN_SIDE, 'la foto');
  return { buf, mimeType };
}
