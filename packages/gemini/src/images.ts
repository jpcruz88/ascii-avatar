import { GoogleGenAI } from '@google/genai';
import type { FaceId } from '@ascii-avatar/core';
import type { GeminiConfig } from './config.js';
import {
  extractUsage,
  refusalDetail,
  type InteractionResultBase,
  type InteractionsApi,
} from './interactions.js';
import { ESTIMATED_FACE_COST_USD, imageCostUsd } from './pricing.js';
import { FACE_PROMPTS } from './prompts.js';

export interface ImageEditInput {
  prompt: string;
  image: Buffer;
  mimeType: string;
}

export interface ImageEditResult {
  png: Buffer;
  /** `null` si la API no informó el uso (o solo informó una de las dos cifras). */
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Gemini respondió sin imagen: casi siempre es un rechazo de contenido
 * (filtro de seguridad). Los errores de red o del SDK no se envuelven en esta
 * clase: llegan tal cual para distinguirlos con `instanceof`.
 */
export class ImageRefusedError extends Error {
  /** Texto, estado o errores que expuso la interacción, si hay alguno. */
  readonly detail: string | undefined;

  constructor(detail?: string) {
    super('Gemini no devolvió ninguna imagen (probable rechazo de contenido).');
    this.name = 'ImageRefusedError';
    this.detail = detail;
  }
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

interface InteractionResult extends InteractionResultBase {
  output_image?: { data?: string };
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
      if (data === undefined || data === '') throw new ImageRefusedError(refusalDetail(result));

      const { inputTokens, outputTokens } = extractUsage(result.usage);
      return {
        png: Buffer.from(data, 'base64'),
        inputTokens,
        outputTokens,
      };
    },
  };
}

/**
 * Genera una cara a partir de la foto. El costo sale de los tokens de uso; si la
 * API no los informó, se devuelve la estimación con `costEstimated: true`.
 */
export async function generateFace(
  client: ImageClient,
  photo: Buffer,
  mimeType: string,
  face: FaceId,
): Promise<{ png: Buffer; costUsd: number; costEstimated: boolean }> {
  const { png, inputTokens, outputTokens } = await client.editImage({
    prompt: FACE_PROMPTS[face],
    image: photo,
    mimeType,
  });
  if (inputTokens === null || outputTokens === null) {
    return { png, costUsd: ESTIMATED_FACE_COST_USD, costEstimated: true };
  }
  return { png, costUsd: imageCostUsd(inputTokens, outputTokens), costEstimated: false };
}
