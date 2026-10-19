// Punto de entrada del paquete web: registra <ascii-avatar> (una sola vez) y exporta sus piezas.
import { AsciiAvatarElement } from './element.js';

export { AsciiAvatarElement } from './element.js';
export { AvatarEngine, audioStartDelayMs } from './engine.js';
export type { AudioOut, EngineDeps, EngineEvent, Prepared, TtsFetch, TtsRequest } from './engine.js';
export { fitFont, nextDrawAt } from './layout.js';

if (typeof customElements !== 'undefined' && customElements.get('ascii-avatar') === undefined) {
  customElements.define('ascii-avatar', AsciiAvatarElement);
}
