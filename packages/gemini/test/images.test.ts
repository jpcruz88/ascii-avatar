import { describe, expect, it } from 'vitest';
import {
  createGeminiImageClient,
  estimateCreationCostUsd,
  ESTIMATED_FACE_COST_USD,
  FACE_PROMPTS,
  generateFace,
  generateImage,
  ImageRefusedError,
  imageCostUsd,
  POSE_PROMPTS,
  type ImageClient,
} from '../src/index.js';

describe('pricing', () => {
  it('imageCostUsd(1300, 1120) es aproximadamente 0.03555', () => {
    expect(imageCostUsd(1300, 1120)).toBeCloseTo(0.03555, 5);
  });

  it('imageCostUsd(0, 0) es 0', () => {
    expect(imageCostUsd(0, 0)).toBe(0);
  });

  it('ESTIMATED_FACE_COST_USD ronda 0.055 (calibrado con la corrida en vivo: 8 caras = $0.4203)', () => {
    expect(ESTIMATED_FACE_COST_USD).toBeCloseTo(0.055, 3);
    // Nunca por debajo de lo que costó de verdad cada cara en la corrida en vivo.
    expect(ESTIMATED_FACE_COST_USD).toBeGreaterThanOrEqual(0.4203 / 8);
  });

  it('estimateCreationCostUsd(8) está entre 0.42 y 0.46', () => {
    const cost = estimateCreationCostUsd(8);
    expect(cost).toBeGreaterThanOrEqual(0.42);
    expect(cost).toBeLessThanOrEqual(0.46);
  });
});

describe('generateFace', () => {
  const photo = Buffer.from('foto');
  const image = Buffer.from('imagen-falsa');

  function clientWith(result: {
    inputTokens: number | null;
    outputTokens: number | null;
  }): { client: ImageClient; calls: Array<{ prompt: string; image: Buffer; mimeType: string }> } {
    const calls: Array<{ prompt: string; image: Buffer; mimeType: string }> = [];
    const client: ImageClient = {
      async editImage(input) {
        calls.push(input);
        return { image, ...result };
      },
    };
    return { client, calls };
  }

  it('pasa el prompt y la foto al cliente y calcula el costo real', async () => {
    const { client, calls } = clientWith({ inputTokens: 1300, outputTokens: 1120 });

    const result = await generateFace(client, photo, 'image/jpeg', 'smile');

    expect(result.image).toBe(image);
    expect(result.costUsd).toBeCloseTo(0.03555, 5);
    expect(result.costEstimated).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe(FACE_PROMPTS['smile']);
    expect(calls[0]?.image).toBe(photo);
    expect(calls[0]?.mimeType).toBe('image/jpeg');
  });

  it.each([
    ['sin uso', { inputTokens: null, outputTokens: null }],
    ['solo entrada', { inputTokens: 1300, outputTokens: null }],
    ['solo salida', { inputTokens: null, outputTokens: 1120 }],
  ])('si la API no informa el uso (%s), conserva la imagen y estima el costo', async (_n, usage) => {
    const { client } = clientWith(usage);

    const result = await generateFace(client, photo, 'image/png', 'blink');

    expect(result.image).toBe(image);
    expect(result.costUsd).toBe(ESTIMATED_FACE_COST_USD);
    expect(result.costEstimated).toBe(true);
  });

  it('deja pasar sin envolver el error que lanza el cliente', async () => {
    const boom = new Error('red caída');
    const client: ImageClient = {
      async editImage() {
        throw boom;
      },
    };

    await expect(generateFace(client, photo, 'image/png', 'sad')).rejects.toBe(boom);
  });
});

describe('generateImage', () => {
  it('pasa cualquier prompt e imagen al cliente y calcula el costo real', async () => {
    const calls: Array<{ prompt: string; image: Buffer; mimeType: string }> = [];
    const out = Buffer.from('salida');
    const client: ImageClient = {
      async editImage(input) {
        calls.push(input);
        return { image: out, inputTokens: 1300, outputTokens: 1120 };
      },
    };
    const base = Buffer.from('grabado');

    const result = await generateImage(client, { prompt: POSE_PROMPTS.nod_up, image: base, mimeType: 'image/png' });

    expect(result.image).toBe(out);
    expect(result.costUsd).toBeCloseTo(0.03555, 5);
    expect(result.costEstimated).toBe(false);
    expect(calls).toEqual([{ prompt: POSE_PROMPTS.nod_up, image: base, mimeType: 'image/png' }]);
  });

  it('si la API no informa el uso, estima el costo', async () => {
    const client: ImageClient = {
      async editImage() {
        return { image: Buffer.from('x'), inputTokens: null, outputTokens: 5 };
      },
    };
    const result = await generateImage(client, { prompt: 'p', image: Buffer.from('y'), mimeType: 'image/png' });
    expect(result.costUsd).toBe(ESTIMATED_FACE_COST_USD);
    expect(result.costEstimated).toBe(true);
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

    expect(out.image.equals(png)).toBe(true);
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

  const edit = { prompt: 'p', image: Buffer.from('f'), mimeType: 'image/png' };

  it('lanza ImageRefusedError si la respuesta no trae imagen', async () => {
    const { ai } = fakeAi({ usage: { total_input_tokens: 1, total_output_tokens: 1 } });
    const client = createGeminiImageClient(cfg, ai);
    const err = await client.editImage(edit).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageRefusedError);
    expect(err).toBeInstanceOf(Error);
  });

  it('lanza ImageRefusedError si la imagen viene con data vacía', async () => {
    const { ai } = fakeAi({ output_image: { data: '' } });
    const client = createGeminiImageClient(cfg, ai);
    await expect(client.editImage(edit)).rejects.toBeInstanceOf(ImageRefusedError);
  });

  it('ImageRefusedError lleva el texto y el estado que expone la interacción', async () => {
    const { ai } = fakeAi({ status: 'failed', output_text: 'No puedo editar esta foto.' });
    const client = createGeminiImageClient(cfg, ai);
    const err = (await client.editImage(edit).catch((e: unknown) => e)) as ImageRefusedError;
    expect(err.detail).toContain('No puedo editar esta foto.');
    expect(err.detail).toContain('failed');
  });

  it('ImageRefusedError no inventa detalle si la interacción no trae nada', async () => {
    const { ai } = fakeAi({});
    const client = createGeminiImageClient(cfg, ai);
    const err = (await client.editImage(edit).catch((e: unknown) => e)) as ImageRefusedError;
    expect(err.detail).toBeUndefined();
  });

  it('devuelve la imagen con tokens null si la API no informa el uso', async () => {
    const png = Buffer.from('pagada');
    const { ai } = fakeAi({ output_image: { data: png.toString('base64') } });
    const client = createGeminiImageClient(cfg, ai);
    const out = await client.editImage(edit);
    expect(out.image.equals(png)).toBe(true);
    expect(out.inputTokens).toBeNull();
    expect(out.outputTokens).toBeNull();
  });

  it('pone en null solo el campo de uso que falta', async () => {
    const { ai } = fakeAi({
      output_image: { data: Buffer.from('x').toString('base64') },
      usage: { total_input_tokens: 1300 },
    });
    const client = createGeminiImageClient(cfg, ai);
    const out = await client.editImage(edit);
    expect(out.inputTokens).toBe(1300);
    expect(out.outputTokens).toBeNull();
  });

  it('deja pasar sin envolver el error del SDK', async () => {
    const boom = new Error('429');
    const ai = {
      interactions: {
        async create(): Promise<unknown> {
          throw boom;
        },
      },
    };
    const client = createGeminiImageClient(cfg, ai);
    await expect(client.editImage(edit)).rejects.toBe(boom);
  });
});
