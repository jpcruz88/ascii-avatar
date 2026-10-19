export * from './faces.js';
export type { AsciiFrame, AsciiMode, Cell, RawImage, Rgb, ToneRange } from './ascii/types.js';
export { decodeImage } from './ascii/decode.js';
export type { GrabadoTone } from './ascii/convert.js';
export {
  INK,
  PAPER,
  TONE_GAIN,
  TONE_OFFSET,
  INK_SCALE,
  VIGNETTE,
  imageToAscii,
  TONE_PERCENTILES,
  grabadoTone,
} from './ascii/convert.js';
export { GLYPH_COLS, GLYPH_MASKS, GLYPH_ROWS } from './ascii/glyphs.js';
export type { GlyphMask } from './ascii/glyphs.js';
export { frameDiff, frameToAnsi } from './ascii/ansi.js';
export { cornerDrift } from './ascii/drift.js';
export {
  AgentExistsError,
  AgentNotFoundError,
  CorruptAgentError,
  InvalidAgentNameError,
  InvalidFaceImageError,
  InvalidPhotoError,
  InvalidVoiceError,
  MAX_VOICE_STYLE_LENGTH,
  createAgent,
  loadAgent,
  loadAtlas,
  missingFaces,
  saveFace,
  updateAgentVoice,
  validateAgentName,
} from './agent/store.js';
export type { AgentConfig, CreateAgentOptions } from './agent/store.js';
export { loadApiKey, saveApiKey } from './agent/secrets.js';
export {
  BudgetExceededError,
  CREATION_CAP_USD,
  DEFAULT_DAILY_LIMIT_USD,
  Ledger,
  assertWithinCap,
} from './budget/ledger.js';
export type { SpendKind } from './budget/ledger.js';
export { InvalidWavError, parseWav } from './audio/wav.js';
export { mouthTimeline, syntheticMouthTimeline } from './audio/mouth.js';
export type { MouthLevel, MouthStep } from './audio/mouth.js';
export { spokenSummary } from './text/summary.js';
export { pickExpression } from './text/expression.js';
export { Animator } from './anim/animator.js';
export type { AnimatorOptions, SayOptions } from './anim/animator.js';
