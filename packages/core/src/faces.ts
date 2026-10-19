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

/** Cuadros que todo agente tiene: las 8 caras y los cuadros intermedios de boca. */
export type BaseFrameId = FaceId | BlendFrameId;

export const FRAME_IDS: readonly BaseFrameId[] = [...FACE_IDS, ...(Object.keys(MOUTH_BLENDS) as BlendFrameId[])];

/**
 * Poses sueltas opcionales (`poses/<id>.png`, mismo lienzo que las caras): la cabeza inclinada,
 * asintiendo, girada o mirando a un lado. Si faltan, el avatar simplemente no las usa.
 */
export const POSE_IDS = [
  'tilt_left',
  'tilt_right',
  'nod_up',
  'nod_down',
  'turn_left',
  'turn_right',
  'look_left',
  'look_right',
] as const;

export type PoseId = (typeof POSE_IDS)[number];

/**
 * Clips de movimiento opcionales (`clips/<clip>/000.png`, `001.png`…): secuencias suaves que
 * empiezan y terminan en la cara neutral y se reproducen a unos 24 cuadros por segundo.
 */
export const CLIP_IDS = ['nod', 'tilt_left', 'tilt_right', 'turn_left', 'turn_right', 'think'] as const;

export type ClipId = (typeof CLIP_IDS)[number];

export type PoseFrameId = `pose:${PoseId}`;
export type ClipFrameId = `clip:${ClipId}:${number}`;
/**
 * Cuadro de regreso de una pose: la pose mezclada a partes iguales con `neutral`. Se sintetiza al
 * cargar (no es un archivo) y sirve para soltar una pose sin saltar de golpe a la cara de frente.
 */
export type EaseFrameId = `ease:${PoseId}`;

export const poseFrameId = (id: PoseId): PoseFrameId => `pose:${id}`;
export const clipFrameId = (clip: ClipId, index: number): ClipFrameId => `clip:${clip}:${index}`;
export const easeFrameId = (id: PoseId): EaseFrameId => `ease:${id}`;

/** Todo lo que el panel puede dibujar: los cuadros de base y, si el agente los tiene, poses y clips. */
export type FrameId = BaseFrameId | PoseFrameId | ClipFrameId | EaseFrameId;

/** Poses y clips (con su número de cuadros) que tiene un agente. */
export interface Motion {
  poses: PoseId[];
  clips: Partial<Record<ClipId, number>>;
}

/** Cuadro de cada nivel de apertura de la boca, de 0 (cerrada) a 4 (abierta). */
export const MOUTH_FRAMES = ['neutral', 'mouth_q1', 'mouth_mid', 'mouth_q3', 'mouth_open'] as const satisfies readonly FrameId[];

/** Expresiones que puede tener el avatar en reposo. */
export type ExpressionId = 'neutral' | 'smile' | 'serious' | 'surprised' | 'sad';
