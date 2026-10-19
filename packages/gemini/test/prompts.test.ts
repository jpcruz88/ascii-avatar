import { FACE_IDS, POSE_IDS } from '@ascii-avatar/core';
import { describe, expect, it } from 'vitest';
import {
  ENGRAVING_BASE_PROMPT,
  ENGRAVING_FACE_PROMPTS,
  ENGRAVING_STYLE_SUFFIX,
  FACE_PROMPTS,
  POSE_PROMPTS,
  PROMPTS_VERSION,
} from '../src/index.js';

describe('FACE_PROMPTS', () => {
  it('tiene versión numérica', () => {
    expect(PROMPTS_VERSION).toBe(2);
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

describe('ENGRAVING_BASE_PROMPT (grabado base desde la foto)', () => {
  it('pide un grabado clásico en blanco y negro, de tinta y trama, sobre fondo blanco', () => {
    expect(ENGRAVING_BASE_PROMPT).toContain(
      'Redraw this portrait as a classic black-and-white engraving, like an 18th-century etching plate ' +
        'from the Diderot Encyclopédie: fine ink lines and cross-hatching on a pure white background.',
    );
  });

  it('conserva la identidad y lo que la persona lleve, sin nombrar un sombrero o gafas concretos', () => {
    expect(ENGRAVING_BASE_PROMPT).toContain('Same person and exact same face identity');
    expect(ENGRAVING_BASE_PROMPT).toContain('keep their hair, glasses, facial hair, hat and clothing if present');
    expect(ENGRAVING_BASE_PROMPT).not.toMatch(/\bhis\b|\bher\b|fedora|bowler/i);
  });

  it('encuadre de cabeza y hombros, de frente, neutral, con la boca cerrada y sin fondo', () => {
    expect(ENGRAVING_BASE_PROMPT).toContain(
      'Head and shoulders only, centered, facing the camera, neutral relaxed expression with the mouth closed.',
    );
    expect(ENGRAVING_BASE_PROMPT).toContain(
      'Remove the background and everything behind the person: plain white paper background.',
    );
    expect(ENGRAVING_BASE_PROMPT).toContain('Strong clear contrast, no color, no gray wash, no text, no border.');
  });
});

describe('ENGRAVING_FACE_PROMPTS (caras editando el grabado base)', () => {
  it('el sufijo de estilo es el que funcionó a mano', () => {
    expect(ENGRAVING_STYLE_SUFFIX).toBe(
      ' Keep it exactly the same black-and-white engraving illustration style: fine black ink lines and ' +
        'cross-hatching on pure white paper, same line weight, same framing, same size and position of the head, ' +
        'no color, no gray wash, no text.',
    );
  });

  it('hay un prompt por cada cara salvo neutral (neutral es el grabado base)', () => {
    expect(Object.keys(ENGRAVING_FACE_PROMPTS).sort()).toEqual(FACE_IDS.filter((id) => id !== 'neutral').sort());
  });

  for (const id of FACE_IDS.filter((f) => f !== 'neutral')) {
    it(`${id}: es FACE_PROMPTS[${id}] más el sufijo de estilo`, () => {
      expect(ENGRAVING_FACE_PROMPTS[id]).toBe(`${FACE_PROMPTS[id]}${ENGRAVING_STYLE_SUFFIX}`);
    });
  }
});

describe('POSE_PROMPTS (poses editando el grabado base)', () => {
  it('hay un prompt por cada pose y ninguno de sobra', () => {
    expect(Object.keys(POSE_PROMPTS).sort()).toEqual([...POSE_IDS].sort());
  });

  for (const id of POSE_IDS) {
    it(`${id}: conserva persona, estilo, lienzo y encuadre, neutral y sin color`, () => {
      expect(POSE_PROMPTS[id]).toContain(
        'keep exactly the same person and identity, the same engraving style, same canvas size and framing ' +
          'with the head the same size and roughly the same place, neutral relaxed expression with the mouth closed, ' +
          'no color, no gray wash, no text, no border',
      );
    });
  }

  it('cada pose describe su movimiento', () => {
    expect(POSE_PROMPTS.tilt_left).toMatch(/tilt.*left shoulder.*12/i);
    expect(POSE_PROMPTS.tilt_right).toMatch(/tilt.*right shoulder.*12/i);
    expect(POSE_PROMPTS.nod_up).toMatch(/chin slightly raised/i);
    expect(POSE_PROMPTS.nod_down).toMatch(/chin slightly lowered/i);
    expect(POSE_PROMPTS.turn_left).toMatch(/turned about 25 degrees to their left.*three-quarter.*eyes following/i);
    expect(POSE_PROMPTS.turn_right).toMatch(/turned about 25 degrees to their right.*three-quarter.*eyes following/i);
    expect(POSE_PROMPTS.look_left).toMatch(/head straight.*only the eyes.*their left/i);
    expect(POSE_PROMPTS.look_right).toMatch(/head straight.*only the eyes.*their right/i);
  });
});
