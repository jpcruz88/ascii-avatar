import { describe, expect, it } from 'vitest';
import { GLYPH_COLS, GLYPH_MASKS, GLYPH_ROWS, imageToAscii, type RawImage } from '../src/index.js';

/** Imagen blanca de `w` x `h` con tinta negra donde `ink(x, y)` es verdadero. */
function draw(w: number, h: number, ink: (x: number, y: number) => boolean): RawImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = ink(x, y) ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Una sola celda: 12 x 24 px con 1 columna da 1 fila (la celda es 1:2). Cada subcelda es de 2 x 2 px. */
const W = 12;
const H = 24;
function cell(ink: (x: number, y: number) => boolean): string {
  const f = imageToAscii(draw(W, H, ink), { cols: 1, mode: 'grabado' });
  expect(f.cols).toBe(1);
  expect(f.rows).toBe(1);
  return f.cells[0]!.ch;
}

/** Tinta media de la máscara de un carácter, de 0 a 1. */
function density(ch: string): number {
  const g = GLYPH_MASKS.find(([c]) => c === ch);
  if (g === undefined) throw new Error(`"${ch}" no está en GLYPH_MASKS`);
  const digits = g[1].replace(/ /g, '');
  return [...digits].reduce((s, d) => s + Number(d), 0) / (digits.length * 9);
}

const densest = (n: number): string[] =>
  [...GLYPH_MASKS].sort((a, b) => density(b[0]) - density(a[0])).slice(0, n).map(([c]) => c);

describe('máscaras de caracteres del grabado', () => {
  it('cada máscara tiene GLYPH_ROWS filas de GLYPH_COLS dígitos 0..9', () => {
    expect(GLYPH_COLS).toBe(6);
    expect(GLYPH_ROWS).toBe(12);
    expect(GLYPH_MASKS.length).toBeGreaterThanOrEqual(40);
    expect(GLYPH_MASKS.length).toBeLessThanOrEqual(60);
    for (const [ch, mask] of GLYPH_MASKS) {
      expect(ch).toHaveLength(1);
      const rows = mask.split(' ');
      expect(rows, ch).toHaveLength(GLYPH_ROWS);
      for (const r of rows) expect(r, ch).toMatch(new RegExp(`^[0-9]{${GLYPH_COLS}}$`));
    }
  });

  it('no repite caracteres, todos son ASCII imprimible y el espacio está vacío', () => {
    const chars = GLYPH_MASKS.map(([c]) => c);
    expect(new Set(chars).size).toBe(chars.length);
    for (const c of chars) expect(c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127).toBe(true);
    expect(density(' ')).toBe(0);
    for (const c of ['|', '/', '\\', '-', '_', '.', '@', '#']) expect(chars).toContain(c);
  });
});

describe('modo grabado: elige el carácter por la forma de la tinta', () => {
  it('una línea vertical fina da |', () => {
    expect(cell((x) => x >= 5 && x < 7)).toBe('|');
  });

  it('una diagonal de abajo a la izquierda hacia arriba a la derecha da /', () => {
    // La recta va de (0, H) a (W, 0); 2 px de grosor en horizontal.
    expect(cell((x, y) => Math.abs(x + 0.5 - (W * (H - (y + 0.5))) / H) < 1.2)).toBe('/');
  });

  it('una diagonal de arriba a la izquierda hacia abajo a la derecha da \\', () => {
    expect(cell((x, y) => Math.abs(x + 0.5 - (W * (y + 0.5)) / H) < 1.2)).toBe('\\');
  });

  it('una línea horizontal abajo de la celda da _', () => {
    expect(cell((_, y) => y >= 21 && y < 23)).toBe('_');
  });

  it('una línea horizontal a media celda da -', () => {
    expect(cell((_, y) => y >= 12 && y < 14)).toBe('-');
  });

  it('una celda en blanco da espacio', () => {
    expect(cell(() => false)).toBe(' ');
  });

  it('una celda negra da uno de los caracteres más densos', () => {
    expect(densest(5)).toContain(cell(() => true));
  });

  it('es determinista', () => {
    const data = new Uint8Array(96 * 64 * 4).map((_, i) => ((i * 37) ^ (i >> 5)) % 256);
    const img = { width: 96, height: 64, data };
    const a = imageToAscii(img, { cols: 24, mode: 'grabado' });
    const b = imageToAscii(img, { cols: 24, mode: 'grabado' });
    expect(a).toEqual(b);
  });

  it('sin viñeteado por defecto: un gris parejo llega igual a las esquinas que al centro', () => {
    const img = draw(100, 100, (x, y) => (x + y) % 3 === 0);
    const f = imageToAscii(img, { cols: 20, mode: 'grabado' });
    const at = (c: number, r: number): string => f.cells[r * f.cols + c]!.ch;
    expect(at(0, 0)).not.toBe(' ');
    expect(at(19, f.rows - 1)).not.toBe(' ');
  });

  it('convierte 160 columnas de una imagen de 896 x 1193 en menos de 600 ms', () => {
    const img = draw(896, 1193, (x, y) => (x * 7 + y * 3) % 23 < 4);
    imageToAscii(img, { cols: 160, mode: 'grabado' }); // calienta el JIT
    const t0 = performance.now();
    imageToAscii(img, { cols: 160, mode: 'grabado' });
    expect(performance.now() - t0).toBeLessThan(600);
  });
});
