import sharp from 'sharp';
import type { RawImage } from './types.js';

/** Decodifica cualquier formato que entienda sharp a RGBA de 8 bits. */
export async function decodeImage(buf: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}
