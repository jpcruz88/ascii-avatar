import { FACE_IDS } from '@ascii-avatar/core';
import { describe, expect, it } from 'vitest';
import { FACE_PROMPTS, PROMPTS_VERSION } from '../src/index.js';

describe('FACE_PROMPTS', () => {
  it('tiene versión numérica', () => {
    expect(PROMPTS_VERSION).toBe(1);
  });

  it('tiene un prompt por cada cara y ninguno de sobra', () => {
    expect(Object.keys(FACE_PROMPTS).sort()).toEqual([...FACE_IDS].sort());
  });

  for (const id of FACE_IDS) {
    describe(id, () => {
      const prompt = FACE_PROMPTS[id];

      it('empieza con la instrucción de edición', () => {
        expect(prompt.startsWith('Edit this portrait.')).toBe(true);
      });

      it('exige conservar cámara, pose, luz, encuadre y fondo', () => {
        expect(prompt).toContain('same camera, pose, lighting, framing');
        expect(prompt).toContain(
          'Keep the same camera, pose, lighting, framing and background.',
        );
      });

      it('exige conservar identidad, tono de piel, pelo y ropa', () => {
        expect(prompt).toMatch(/identity/i);
        expect(prompt).toMatch(/skin tone/i);
        expect(prompt).toMatch(/hair/i);
        expect(prompt).toMatch(/clothing/i);
      });
    });
  }

  it('mouth_open pide la boca como diciendo "ah"', () => {
    expect(FACE_PROMPTS.mouth_open).toMatch(/"ah"/);
  });

  it('blink pide los ojos cerrados', () => {
    expect(FACE_PROMPTS.blink).toMatch(/eyes (are )?closed/i);
  });
});
