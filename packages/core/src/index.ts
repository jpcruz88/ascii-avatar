export * from './faces.js';
export type { AsciiFrame, AsciiMode, Cell, RawImage, Rgb } from './ascii/types.js';
export { decodeImage } from './ascii/decode.js';
export { imageToAscii } from './ascii/convert.js';
export { frameDiff, frameToAnsi } from './ascii/ansi.js';
export { cornerDrift } from './ascii/drift.js';
export {
  AgentExistsError,
  AgentNotFoundError,
  CorruptAgentError,
  InvalidAgentNameError,
  InvalidPhotoError,
  createAgent,
  loadAgent,
  loadAtlas,
  missingFaces,
  saveFace,
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
