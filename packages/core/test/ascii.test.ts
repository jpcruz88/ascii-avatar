import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  decodeImage,
  frameDiff,
  frameToAnsi,
  imageToAscii,
  type AsciiFrame,
  type RawImage,
} from '../src/index.js';

function solid(width: number, height: number, v: number): RawImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('imageToAscii', () => {
  it('mapea negro a espacio en modo glyphs', () => {
    const f = imageToAscii(solid(8, 8, 0), { cols: 8, mode: 'glyphs' });
    expect(f.cells.length).toBe(f.cols * f.rows);
    expect(f.cells.every((c) => c.ch === ' ')).toBe(true);
    expect(f.cells.every((c) => c.bg === null)).toBe(true);
  });

  it('mapea blanco a @ en modo glyphs', () => {
    const f = imageToAscii(solid(8, 8, 255), { cols: 8, mode: 'glyphs' });
    expect(f.cells.every((c) => c.ch === '@')).toBe(true);
    expect(f.cells[0]?.fg).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('calcula las filas como round(alto/ancho*cols/2) en ambos modos', () => {
    const img = solid(200, 100, 128);
    expect(imageToAscii(img, { cols: 40, mode: 'glyphs' }).rows).toBe(10);
    expect(imageToAscii(img, { cols: 40, mode: 'halfblock' }).rows).toBe(10);
  });

  it('promedia el color del bloque en modo glyphs', () => {
    // 2x1: un píxel rojo y uno azul, una sola celda -> promedio.
    const data = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const f = imageToAscii({ width: 2, height: 1, data }, { cols: 1, mode: 'glyphs' });
    expect(f.cells).toHaveLength(1);
    expect(f.cells[0]?.fg).toEqual({ r: 128, g: 0, b: 128 });
  });

  it('usa media celda de arriba y de abajo en modo halfblock', () => {
    const data = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const f = imageToAscii({ width: 1, height: 2, data }, { cols: 1, mode: 'halfblock' });
    expect(f.cols).toBe(1);
    expect(f.rows).toBe(1);
    expect(f.cells[0]).toEqual({
      ch: '▀',
      fg: { r: 255, g: 0, b: 0 },
      bg: { r: 0, g: 0, b: 255 },
    });
  });

  it('es determinista', () => {
    const data = new Uint8Array(37 * 23 * 4).map((_, i) => (i * 31) % 256);
    const img = { width: 37, height: 23, data };
    const a = imageToAscii(img, { cols: 11, mode: 'glyphs' });
    const b = imageToAscii(img, { cols: 11, mode: 'glyphs' });
    expect(a).toEqual(b);
  });

  it('convierte 70 columnas en menos de 100 ms', () => {
    const img = solid(1024, 1024, 100);
    const t0 = performance.now();
    imageToAscii(img, { cols: 70, mode: 'halfblock' });
    imageToAscii(img, { cols: 70, mode: 'glyphs' });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('frameToAnsi', () => {
  const frame: AsciiFrame = {
    cols: 2,
    rows: 1,
    cells: [
      { ch: '▀', fg: { r: 255, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 255 } },
      { ch: '@', fg: { r: 1, g: 2, b: 3 }, bg: null },
    ],
  };

  it('emite color de 24 bits y reinicia al final de la fila', () => {
    const out = frameToAnsi(frame);
    expect(out).toContain('\x1b[38;2;255;0;0m');
    expect(out).toContain('\x1b[48;2;0;0;255m');
    expect(out).toContain('\x1b[38;2;1;2;3m');
    expect(out.endsWith('\x1b[0m')).toBe(true);
  });

  it('no mueve el cursor ni limpia la pantalla', () => {
    const out = frameToAnsi(frame);
    expect(out).not.toContain('\x1b[H');
    expect(out).not.toContain('\x1b[2J');
  });

  it('une las filas con salto de línea y cierra cada una', () => {
    const two: AsciiFrame = { cols: 1, rows: 2, cells: [frame.cells[1]!, frame.cells[1]!] };
    const rows = frameToAnsi(two).split('\n');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.endsWith('\x1b[0m')).toBe(true);
  });
});

describe('frameDiff', () => {
  const black = imageToAscii(solid(4, 4, 0), { cols: 4, mode: 'glyphs' });
  const white = imageToAscii(solid(4, 4, 255), { cols: 4, mode: 'glyphs' });

  it('es 0 para cuadros iguales', () => {
    expect(frameDiff(white, white)).toBe(0);
  });

  it('es 1 entre negro y blanco', () => {
    expect(frameDiff(black, white)).toBe(1);
  });

  it('lanza si las dimensiones difieren', () => {
    const other = imageToAscii(solid(4, 4, 0), { cols: 2, mode: 'glyphs' });
    expect(() => frameDiff(black, other)).toThrow();
  });
});

describe('decodeImage', () => {
  it('decodifica un PNG a RGBA de 8 bits', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const img = await decodeImage(png);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.data.length).toBe(16);
    expect(Array.from(img.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });
});
