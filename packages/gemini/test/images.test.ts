import { describe, expect, it } from 'vitest';
import {
  createGeminiImageClient,
  estimateCreationCostUsd,
  FACE_PROMPTS,
  generateFace,
  imageCostUsd,
  type ImageClient,
} from '../src/index.js';

describe('pricing', () => {
  it('imageCostUsd(1300, 1120) es aproximadamente 0.03555', () => {
    expect(imageCostUsd(1300, 1120)).toBeCloseTo(0.03555, 5);
  });

  it('imageCostUsd(0, 0) es 0', () => {
    expect(imageCostUsd(0, 0)).toBe(0);
  });

  it('estimateCreationCostUsd(8) está entre 0.25 y 0.40', () => {
    const cost = estimateCreationCostUsd(8);
    expect(cost).toBeGreaterThanOrEqual(0.25);
    expect(cost).toBeLessThanOrEqual(0.4);
  });
});

describe('generateFace', () => {
  it('pasa el prompt y la foto al cliente y calcula el costo real', async () => {
    const png = Buffer.from('png-falso');
    const photo = Buffer.from('foto');
    const calls: Array<{ prompt: string; image: Buffer; mimeType: string }> = [];
    const client: ImageClient = {
      async editImage(input) {
        calls.push(input);
        return { png, inputTokens: 1300, outputTokens: 1120 };
      },
    };

    const result = await generateFace(client, photo, 'image/jpeg', 'smile');

    expect(result.png).toBe(png);
    expect(result.costUsd).toBeCloseTo(0.03555, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe(FACE_PROMPTS['smile']);
    expect(calls[0]?.image).toBe(photo);
    expect(calls[0]?.mimeType).toBe('image/jpeg');
  });
});

describe('createGeminiImageClient', () => {
  const cfg = { apiKey: 'k', imageModel: 'modelo-x', ttsModel: 't' };

  function fakeAi(interaction: unknown) {
    const requests: unknown[] = [];
    const ai = {
      interactions: {
        async create(params: unknown) {
          requests.push(params);
          return interaction;
        },
      },
    };
    return { ai, requests };
  }

  it('envía foto y prompt con la API Interactions y devuelve PNG y tokens', async () => {
    const png = Buffer.from('imagen-generada');
    const { ai, requests } = fakeAi({
      output_image: { data: png.toString('base64') },
      usage: { total_input_tokens: 1300, total_output_tokens: 1120 },
    });
    const client = createGeminiImageClient(cfg, ai);
    const photo = Buffer.from('foto');

    const out = await client.editImage({ prompt: 'haz algo', image: photo, mimeType: 'image/png' });

    expect(out.png.equals(png)).toBe(true);
    expect(out.inputTokens).toBe(1300);
    expect(out.outputTokens).toBe(1120);
    expect(requests).toEqual([
      {
        model: 'modelo-x',
        input: [
          { type: 'image', data: photo.toString('base64'), mime_type: 'image/png' },
          { type: 'text', text: 'haz algo' },
        ],
        response_format: { type: 'image', image_size: '1K' },
      },
    ]);
  });

  it('suma los tokens de pensamiento a los de salida', async () => {
    const { ai } = fakeAi({
      output_image: { data: Buffer.from('x').toString('base64') },
      usage: { total_input_tokens: 10, total_output_tokens: 1120, total_thought_tokens: 200 },
    });
    const client = createGeminiImageClient(cfg, ai);
    const out = await client.editImage({ prompt: 'p', image: Buffer.from('f'), mimeType: 'image/png' });
    expect(out.outputTokens).toBe(1320);
  });

  it('falla si la respuesta no trae imagen', async () => {
    const { ai } = fakeAi({ usage: { total_input_tokens: 1, total_output_tokens: 1 } });
    const client = createGeminiImageClient(cfg, ai);
    await expect(
      client.editImage({ prompt: 'p', image: Buffer.from('f'), mimeType: 'image/png' }),
    ).rejects.toThrow(/sin imagen/);
  });

  it('falla si la respuesta no trae el uso de tokens', async () => {
    const { ai } = fakeAi({ output_image: { data: Buffer.from('x').toString('base64') } });
    const client = createGeminiImageClient(cfg, ai);
    await expect(
      client.editImage({ prompt: 'p', image: Buffer.from('f'), mimeType: 'image/png' }),
    ).rejects.toThrow(/tokens/);
  });
});
