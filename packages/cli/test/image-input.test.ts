import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { toPng } from '../src/image-input.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const raw = { create: { width: 32, height: 48, channels: 3 as const, background: { r: 10, g: 120, b: 200 } } };

describe('toPng', () => {
  it('convierte JPEG a un PNG real con el mismo tamaño', async () => {
    const jpeg = await sharp(raw).jpeg().toBuffer();
    const out = await toPng(jpeg);
    expect(out.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 32, 48]);
  });

  it('convierte WebP a PNG', async () => {
    const out = await toPng(await sharp(raw).webp().toBuffer());
    expect(out.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('un PNG sigue siendo PNG', async () => {
    const out = await toPng(await sharp(raw).png().toBuffer());
    expect(out.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('bytes que no son una imagen: lanza', async () => {
    await expect(toPng(Buffer.from('no soy una imagen'))).rejects.toThrow();
  });
});
