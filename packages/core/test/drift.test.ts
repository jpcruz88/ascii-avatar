import { describe, expect, it } from 'vitest';
import { cornerDrift, type AsciiFrame } from '../src/index.js';

/** Cuadro de cols×rows donde `lum(col, row)` da la luminosidad (0-255) de cada celda. */
function frame(
  cols: number,
  rows: number,
  lum: (col: number, row: number) => number,
): AsciiFrame {
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = lum(col, row);
      cells.push({ ch: '#', fg: { r: v, g: v, b: v }, bg: null });
    }
  }
  return { cols, rows, cells };
}

const COLS = 20;
const ROWS = 20;
// Esquinas superiores: 10 % del ancho (2 columnas) × 15 % del alto (3 filas).
const inUpperCorner = (col: number, row: number): boolean =>
  row < 3 && (col < 2 || col >= COLS - 2);
const inCenter = (col: number, row: number): boolean =>
  col >= 6 && col < 14 && row >= 6 && row < 14;

describe('cornerDrift', () => {
  it('es 0 para un cuadro contra sí mismo', () => {
    const f = frame(COLS, ROWS, (c, r) => (c * 7 + r * 13) % 256);
    expect(cornerDrift(f, f)).toBe(0);
  });

  it('es 0 si los cuadros solo difieren en el centro', () => {
    const a = frame(COLS, ROWS, () => 0);
    const b = frame(COLS, ROWS, (c, r) => (inCenter(c, r) ? 255 : 0));
    expect(cornerDrift(a, b)).toBe(0);
  });

  it('es mayor que 0.5 si los cuadros difieren solo en las esquinas superiores', () => {
    const a = frame(COLS, ROWS, () => 0);
    const b = frame(COLS, ROWS, (c, r) => (inUpperCorner(c, r) ? 255 : 0));
    expect(cornerDrift(a, b)).toBeGreaterThan(0.5);
  });

  it('ignora las esquinas inferiores', () => {
    const a = frame(COLS, ROWS, () => 0);
    const b = frame(COLS, ROWS, (c, r) => (r >= ROWS - 3 && c < 2 ? 255 : 0));
    expect(cornerDrift(a, b)).toBe(0);
  });

  it('usa al menos una celda por esquina en cuadros pequeños', () => {
    const a = frame(4, 4, () => 0);
    const b = frame(4, 4, (c, r) => (r === 0 && (c === 0 || c === 3) ? 255 : 0));
    expect(cornerDrift(a, b)).toBe(1);
  });

  it('lanza si las dimensiones no coinciden', () => {
    const a = frame(COLS, ROWS, () => 0);
    const b = frame(COLS + 1, ROWS, () => 0);
    expect(() => cornerDrift(a, b)).toThrow(/Dimensiones distintas/);
  });
});
