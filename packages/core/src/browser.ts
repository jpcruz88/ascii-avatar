// Entrada para el navegador (`@ascii-avatar/core/browser`): el mismo motor que usa el panel
// (animador, boca, WAV, resumen hablado y expresión) sin nada que dependa de Node ni de sharp.
// Todo lo que se exporte aquí debe ser código puro: una prueba recorre su grafo compilado.
export * from './faces.js';
export type { AsciiFrame, Cell, Rgb } from './ascii/types.js';
export { InvalidWavError, parseWav } from './audio/wav.js';
export { MOUTH_MIN_HOLD_MS, mouthTimeline, syntheticMouthTimeline } from './audio/mouth.js';
export type { MouthLevel, MouthStep } from './audio/mouth.js';
export { spokenSummary } from './text/summary.js';
export { pickExpression } from './text/expression.js';
export { Animator, CLIP_FPS, MOUTH_ANTICIPATION_MS, SPEECH_LEAD_IN_MS } from './anim/animator.js';
export type { AnimatorOptions, SayOptions } from './anim/animator.js';
export {
  InvalidWebExportError,
  WEB_EXPORT_FORMAT,
  WEB_EXPORT_VERSION,
  checkWebManifest,
  parseWebExport,
  webExportFramesText,
} from './web-export.js';
export type { WebManifest } from './web-export.js';
