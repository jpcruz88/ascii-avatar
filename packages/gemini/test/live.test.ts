import { describe, expect, it } from 'vitest';
import { parseWav } from '@ascii-avatar/core';
import {
  createGeminiImageClient,
  createGeminiTtsClient,
  generateFace,
  loadGeminiConfig,
  synthesizeSpeech,
} from '../src/index.js';

// Pruebas en vivo: llaman a la API real (la cara cuesta ~$0.04, la voz menos de $0.01). Solo corren a propósito.
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

  it('sintetiza "Hola" y devuelve un WAV legible de entre 0.3 y 3 segundos', async () => {
    const client = createGeminiTtsClient(loadGeminiConfig());
    const { wav, costUsd } = await synthesizeSpeech(client, 'Hola', 'Kore');

    const { sampleRate, samples } = parseWav(wav);
    const seconds = samples.length / sampleRate;
    expect(seconds).toBeGreaterThanOrEqual(0.3);
    expect(seconds).toBeLessThanOrEqual(3);
    expect(costUsd).toBeGreaterThan(0);
  }, 60_000);
});
