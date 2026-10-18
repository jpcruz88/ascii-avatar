import { describe, expect, it } from 'vitest';
import { createGeminiImageClient, generateFace, loadGeminiConfig } from '../src/index.js';

// Prueba en vivo: llama a la API real y cuesta ~$0.04. Solo corre a propósito.
const live = process.env['RUN_LIVE'] === '1' && Boolean(process.env['GEMINI_API_KEY']);

// Un PNG 1x1 no sirve de retrato; la prueba usa la foto indicada en LIVE_PHOTO.
describe.skipIf(!live)('Gemini en vivo', () => {
  it('genera una cara y devuelve un PNG', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = process.env['LIVE_PHOTO'];
    if (!path) throw new Error('Define LIVE_PHOTO con la ruta de un retrato (jpg/png).');
    const photo = await readFile(path);
    const mimeType = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

    const client = createGeminiImageClient(loadGeminiConfig());
    const { png, costUsd } = await generateFace(client, photo, mimeType, 'smile');

    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(costUsd).toBeGreaterThan(0);
  }, 120_000);
});
