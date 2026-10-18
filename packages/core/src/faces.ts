/**
 * Caras del avatar. `mouth_closed` no existe como cara aparte:
 * la cara `neutral` ya lleva la boca cerrada.
 */
export const FACE_IDS = [
  'neutral',
  'mouth_mid',
  'mouth_open',
  'blink',
  'smile',
  'serious',
  'surprised',
  'sad',
] as const;

export type FaceId = (typeof FACE_IDS)[number];

/** Expresiones que puede tener el avatar en reposo. */
export type ExpressionId = 'neutral' | 'smile' | 'serious' | 'surprised' | 'sad';
