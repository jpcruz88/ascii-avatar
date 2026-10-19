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

/**
 * Cuadros intermedios de la boca que no son imágenes del paquete: cada uno se sintetiza al cargar
 * mezclando a partes iguales las dos caras vecinas (`mouth_q1` entre `neutral` y `mouth_mid`,
 * `mouth_q3` entre `mouth_mid` y `mouth_open`). El paquete de caras sigue siendo de 8 archivos.
 */
export const MOUTH_BLENDS = {
  mouth_q1: ['neutral', 'mouth_mid'],
  mouth_q3: ['mouth_mid', 'mouth_open'],
} as const satisfies Record<string, readonly [FaceId, FaceId]>;

export type BlendFrameId = keyof typeof MOUTH_BLENDS;

/** Todo lo que el panel puede dibujar: las 8 caras y los cuadros intermedios de boca. */
export type FrameId = FaceId | BlendFrameId;

export const FRAME_IDS: readonly FrameId[] = [...FACE_IDS, ...(Object.keys(MOUTH_BLENDS) as BlendFrameId[])];

/** Cuadro de cada nivel de apertura de la boca, de 0 (cerrada) a 4 (abierta). */
export const MOUTH_FRAMES = ['neutral', 'mouth_q1', 'mouth_mid', 'mouth_q3', 'mouth_open'] as const satisfies readonly FrameId[];

/** Expresiones que puede tener el avatar en reposo. */
export type ExpressionId = 'neutral' | 'smile' | 'serious' | 'surprised' | 'sad';
