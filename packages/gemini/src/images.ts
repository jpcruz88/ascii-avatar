import { GoogleGenAI } from '@google/genai';
import type { FaceId } from '@ascii-avatar/core';
import type { GeminiConfig } from './config.js';
import { imageCostUsd } from './pricing.js';
import { FACE_PROMPTS } from './prompts.js';

export interface ImageEditInput {
  prompt: string;
  image: Buffer;
  mimeType: string;
}

export interface ImageEditResult {
  png: Buffer;
  inputTokens: number;
  outputTokens: number;
}

/** Costura para poder probar sin red: el CLI usa `createGeminiImageClient`. */
export interface ImageClient {
  editImage(input: ImageEditInput): Promise<ImageEditResult>;
}

/**
 * Tamaño de salida. La doc de Nano Banana 2.1 lista 1K como el menor
 * (1120 tokens); "512" solo está documentado para Gemini 3.1 Flash Image.
 */
export const IMAGE_SIZE = '1K';

/** Lo mínimo del SDK que usamos; permite inyectar un falso en las pruebas. */
export interface InteractionsApi {
  interactions: { create(params: unknown): Promise<unknown> };
}

interface InteractionResult {
  output_image?: { data?: string };
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
  };
}

export function createGeminiImageClient(
  cfg: GeminiConfig,
  ai: InteractionsApi = new GoogleGenAI({ apiKey: cfg.apiKey }),
): ImageClient {
  return {
    async editImage({ prompt, image, mimeType }) {
      const result = (await ai.interactions.create({
        model: cfg.imageModel,
        input: [
          { type: 'image', data: image.toString('base64'), mime_type: mimeType },
          { type: 'text', text: prompt },
        ],
        response_format: { type: 'image', image_size: IMAGE_SIZE },
      })) as InteractionResult;

      const data = result.output_image?.data;
      if (data === undefined || data === '') {
        throw new Error('Gemini respondió sin imagen (¿filtro de seguridad o modelo equivocado?).');
      }
      const usage = result.usage;
      if (usage?.total_input_tokens === undefined || usage.total_output_tokens === undefined) {
        throw new Error('Gemini no informó los tokens de uso; no se puede calcular el costo.');
      }
      return {
        png: Buffer.from(data, 'base64'),
        inputTokens: usage.total_input_tokens,
        // Los tokens de pensamiento se cobran como salida.
        outputTokens: usage.total_output_tokens + (usage.total_thought_tokens ?? 0),
      };
    },
  };
}

/** Genera una cara a partir de la foto y calcula su costo real con los tokens de uso. */
export async function generateFace(
  client: ImageClient,
  photo: Buffer,
  mimeType: string,
  face: FaceId,
): Promise<{ png: Buffer; costUsd: number }> {
  const { png, inputTokens, outputTokens } = await client.editImage({
    prompt: FACE_PROMPTS[face],
    image: photo,
    mimeType,
  });
  return { png, costUsd: imageCostUsd(inputTokens, outputTokens) };
}
