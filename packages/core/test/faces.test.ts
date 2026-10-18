import { describe, expect, it } from 'vitest';
import { FACE_IDS } from '../src/faces.js';

describe('FACE_IDS', () => {
  it('tiene 8 caras', () => {
    expect(FACE_IDS).toHaveLength(8);
  });

  it('incluye las caras base', () => {
    expect(FACE_IDS).toContain('neutral');
    expect(FACE_IDS).toContain('mouth_open');
    expect(FACE_IDS).toContain('blink');
  });

  it('no tiene duplicados', () => {
    expect(new Set(FACE_IDS).size).toBe(FACE_IDS.length);
  });
});
