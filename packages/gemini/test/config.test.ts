import { describe, expect, it } from 'vitest';
import { loadGeminiConfig, MissingApiKeyError } from '../src/index.js';

describe('loadGeminiConfig', () => {
  it('lanza MissingApiKeyError sin GEMINI_API_KEY', () => {
    expect(() => loadGeminiConfig({})).toThrow(MissingApiKeyError);
  });

  it('trata una llave vacía como ausente', () => {
    expect(() => loadGeminiConfig({ GEMINI_API_KEY: '' })).toThrow(MissingApiKeyError);
  });

  it('devuelve la llave y el modelo de imagen por defecto', () => {
    const cfg = loadGeminiConfig({ GEMINI_API_KEY: 'k' });
    expect(cfg.apiKey).toBe('k');
    expect(cfg.imageModel).toBe('gemini-nano-banana-2.1');
  });

  it('permite cambiar el modelo de imagen con ASCII_AVATAR_IMAGE_MODEL', () => {
    const cfg = loadGeminiConfig({ GEMINI_API_KEY: 'k', ASCII_AVATAR_IMAGE_MODEL: 'x' });
    expect(cfg.imageModel).toBe('x');
  });

  it('permite cambiar el modelo de voz con ASCII_AVATAR_TTS_MODEL', () => {
    const cfg = loadGeminiConfig({ GEMINI_API_KEY: 'k', ASCII_AVATAR_TTS_MODEL: 'tts-x' });
    expect(cfg.ttsModel).toBe('tts-x');
  });

  it('la llave explícita tiene prioridad sobre GEMINI_API_KEY', () => {
    const cfg = loadGeminiConfig({ GEMINI_API_KEY: 'del-entorno' }, 'del-archivo');
    expect(cfg.apiKey).toBe('del-archivo');
  });

  it('usa la llave explícita aunque el entorno no tenga ninguna', () => {
    const cfg = loadGeminiConfig({}, 'del-archivo');
    expect(cfg.apiKey).toBe('del-archivo');
  });

  it('cae al entorno si la llave explícita está vacía', () => {
    const cfg = loadGeminiConfig({ GEMINI_API_KEY: 'del-entorno' }, '');
    expect(cfg.apiKey).toBe('del-entorno');
  });
});
