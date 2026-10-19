import type { FaceId, PoseId } from '@ascii-avatar/core';

/** Versión de los prompts: sube este número al cambiarlos. Se anota en `agent.json` solo como referencia (no invalida las caras ya generadas). */
export const PROMPTS_VERSION = 2;

const HEAD = 'Edit this portrait.';
const KEEP_SCENE = 'Keep the same camera, pose, lighting, framing and background.';
const KEEP_PERSON =
  'Keep the identity, facial structure, skin tone, hair and clothing exactly unchanged.';

function prompt(change: string): string {
  return `${HEAD} ${change} ${KEEP_SCENE} ${KEEP_PERSON} Change nothing except the facial expression.`;
}

/** Un prompt de edición por cara; cada uno describe solo el cambio en el rostro. */
export const FACE_PROMPTS: Record<FaceId, string> = {
  neutral: prompt('Give the person a relaxed, neutral expression with the mouth closed.'),
  mouth_mid: prompt(
    'Part the lips slightly, as if the person were in the middle of saying a word.',
  ),
  mouth_open: prompt(
    'Open the mouth as if saying "ah", without showing the teeth more than necessary.',
  ),
  blink: prompt('Show the person with eyes closed, as in a blink, and the rest of the face neutral.'),
  smile: prompt('Give the person a natural, gentle smile.'),
  serious: prompt('Give the person a serious, stern expression with the brows slightly lowered.'),
  surprised: prompt(
    'Give the person a surprised expression: brows raised and the mouth slightly open.',
  ),
  sad: prompt('Give the person a sad expression.'),
};

/**
 * Estilo `grabado`: redibuja la foto como un grabado clásico. El resultado se guarda como la cara
 * `neutral` y es la imagen de la que salen, editándola, las otras siete caras y las ocho poses.
 */
export const ENGRAVING_BASE_PROMPT =
  'Redraw this portrait as a classic black-and-white engraving, like an 18th-century etching plate from the ' +
  'Diderot Encyclopédie: fine ink lines and cross-hatching on a pure white background. ' +
  'Same person and exact same face identity; keep their hair, glasses, facial hair, hat and clothing if present. ' +
  'Head and shoulders only, centered, facing the camera, neutral relaxed expression with the mouth closed. ' +
  'Remove the background and everything behind the person: plain white paper background. ' +
  'Strong clear contrast, no color, no gray wash, no text, no border.';

/** Se suma al prompt de cada cara al editar el grabado base, para que no pierda el estilo. */
export const ENGRAVING_STYLE_SUFFIX =
  ' Keep it exactly the same black-and-white engraving illustration style: fine black ink lines and ' +
  'cross-hatching on pure white paper, same line weight, same framing, same size and position of the head, ' +
  'no color, no gray wash, no text.';

/** Caras del estilo `grabado` que salen de editar el grabado base (`neutral` es el grabado base). */
export type EngravingFaceId = Exclude<FaceId, 'neutral'>;

/** Un prompt por cara del estilo `grabado`: el de `FACE_PROMPTS` más `ENGRAVING_STYLE_SUFFIX`. */
export const ENGRAVING_FACE_PROMPTS: Record<EngravingFaceId, string> = {
  mouth_mid: `${FACE_PROMPTS.mouth_mid}${ENGRAVING_STYLE_SUFFIX}`,
  mouth_open: `${FACE_PROMPTS.mouth_open}${ENGRAVING_STYLE_SUFFIX}`,
  blink: `${FACE_PROMPTS.blink}${ENGRAVING_STYLE_SUFFIX}`,
  smile: `${FACE_PROMPTS.smile}${ENGRAVING_STYLE_SUFFIX}`,
  serious: `${FACE_PROMPTS.serious}${ENGRAVING_STYLE_SUFFIX}`,
  surprised: `${FACE_PROMPTS.surprised}${ENGRAVING_STYLE_SUFFIX}`,
  sad: `${FACE_PROMPTS.sad}${ENGRAVING_STYLE_SUFFIX}`,
};

const KEEP_POSE =
  'keep exactly the same person and identity, the same engraving style, same canvas size and framing with ' +
  'the head the same size and roughly the same place, neutral relaxed expression with the mouth closed, ' +
  'no color, no gray wash, no text, no border.';

function posePrompt(change: string): string {
  return `Edit this engraving portrait. ${change} Change only that and ${KEEP_POSE}`;
}

/** Un prompt por pose del estilo `grabado`; cada pose sale de editar el grabado base. */
export const POSE_PROMPTS: Record<PoseId, string> = {
  tilt_left: posePrompt('Show the head tilted gently toward their left shoulder, about 12 degrees.'),
  tilt_right: posePrompt('Show the head tilted gently toward their right shoulder, about 12 degrees.'),
  nod_up: posePrompt('Show the head with the chin slightly raised.'),
  nod_down: posePrompt('Show the head with the chin slightly lowered.'),
  turn_left: posePrompt(
    'Show the head turned about 25 degrees to their left, in a three-quarter view, with the eyes following the turn.',
  ),
  turn_right: posePrompt(
    'Show the head turned about 25 degrees to their right, in a three-quarter view, with the eyes following the turn.',
  ),
  look_left: posePrompt('Keep the head straight and facing forward; move only the eyes to look toward their left.'),
  look_right: posePrompt('Keep the head straight and facing forward; move only the eyes to look toward their right.'),
};
