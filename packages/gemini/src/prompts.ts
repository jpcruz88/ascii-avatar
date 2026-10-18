import type { FaceId } from '@ascii-avatar/core';

/** Versión de los prompts: sube este número al cambiarlos. Se anota en `agent.json` solo como referencia (no invalida las caras ya generadas). */
export const PROMPTS_VERSION = 1;

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
