import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  decodeImage,
  frameDiff,
  frameToAnsi,
  imageToAscii,
  GRABADO_RAMP,
  INK,
  PAPER,
  grabadoTone,
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

describe('modo grabado', () => {
  const sinViñeta = { cols: 8, mode: 'grabado' as const, vignette: false };

  /** Degradado horizontal de negro a blanco. */
  function gradient(width: number, height: number): RawImage {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = Math.round((x / (width - 1)) * 255);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { width, height, data };
  }

  it('la rampa tiene 70 caracteres, de claro a oscuro, y termina en $', () => {
    expect(GRABADO_RAMP).toHaveLength(70);
    expect(GRABADO_RAMP.startsWith(' .\'`^')).toBe(true);
    expect(GRABADO_RAMP.endsWith('B@$')).toBe(true);
  });

  it('negro puro da $ en tinta sobre papel en todas las celdas', () => {
    const f = imageToAscii(solid(8, 8, 0), sinViñeta);
    expect(f.cells.length).toBe(f.cols * f.rows);
    expect(f.cells.every((c) => c.ch === '$')).toBe(true);
    expect(f.cells.every((c) => c.fg.r === INK.r && c.fg.g === INK.g && c.fg.b === INK.b)).toBe(true);
    expect(f.cells.every((c) => c.bg !== null && c.bg.r === PAPER.r && c.bg.g === PAPER.g && c.bg.b === PAPER.b)).toBe(true);
    expect(INK).toEqual({ r: 20, g: 20, b: 20 });
    expect(PAPER).toEqual({ r: 250, g: 250, b: 247 });
  });

  it('blanco puro da espacio', () => {
    const f = imageToAscii(solid(8, 8, 255), sinViñeta);
    expect(f.cells.every((c) => c.ch === ' ')).toBe(true);
  });

  it('un degradado de negro a blanco va de denso a ralo, sin retroceder', () => {
    const f = imageToAscii(gradient(160, 16), { cols: 40, mode: 'grabado', vignette: false });
    const row = f.cells.slice(0, f.cols).map((c) => GRABADO_RAMP.indexOf(c.ch));
    expect(row.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < row.length; i++) expect(row[i]!).toBeLessThanOrEqual(row[i - 1]!);
    expect(row[0]).toBe(GRABADO_RAMP.length - 1);
    expect(row.at(-1)).toBe(0);
  });

  it('una imagen de un solo tono no rompe el estiramiento', () => {
    const f = imageToAscii(solid(8, 8, 128), sinViñeta);
    expect(f.cells.every((c) => GRABADO_RAMP.includes(c.ch))).toBe(true);
    expect(new Set(f.cells.map((c) => c.ch)).size).toBe(1);
  });

  it('el viñeteado deja las esquinas en blanco papel y el centro no', () => {
    const f = imageToAscii(solid(100, 100, 128), { cols: 20, mode: 'grabado' });
    const at = (col: number, row: number) => f.cells[row * f.cols + col]!;
    for (const [c, r] of [[0, 0], [19, 0], [0, f.rows - 1], [19, f.rows - 1]] as const) {
      expect(at(c, r).ch).toBe(' ');
    }
    expect(at(10, Math.floor(f.rows * 0.38)).ch).not.toBe(' ');
  });

  it('es determinista', () => {
    const img = gradient(64, 64);
    expect(imageToAscii(img, { cols: 16, mode: 'grabado' })).toEqual(
      imageToAscii(img, { cols: 16, mode: 'grabado' }),
    );
  });

  it('grabadoTone calcula percentiles 1 %/99 %, no mínimo y máximo', () => {
    // 100x100 de gris 100 con 0,5 % de píxeles negros y 0,5 % de blancos: los extremos no cuentan.
    const img = solid(100, 100, 100);
    for (let i = 0; i < 50; i++) {
      img.data.fill(0, i * 4, i * 4 + 3);
      img.data.fill(255, (9999 - i) * 4, (9999 - i) * 4 + 3);
    }
    const { first } = grabadoTone([img], 10, false);
    expect(first.min).toBeCloseTo(100 / 255, 5);
    expect(first.max).toBeCloseTo(100 / 255, 5);
  });

  it('un rango de tono compartido pesa igual en dos imágenes distintas', () => {
    const a = solid(8, 8, 100);
    const b = solid(8, 8, 100);
    const t = {
      first: { min: 0, max: 1 },
      second: { min: 0, max: 1 },
    };
    const fa = imageToAscii(a, { ...sinViñeta, tone: t });
    const fb = imageToAscii(b, { ...sinViñeta, tone: t });
    expect(fa.cells[0]?.ch).toBe(fb.cells[0]?.ch);
    const estirado = imageToAscii(a, {
      ...sinViñeta,
      tone: { first: { min: 100 / 255, max: 1 }, second: { min: 0, max: 1 } },
    });
    expect(estirado.cells[0]?.ch).not.toBe(fa.cells[0]?.ch);
  });

  it('regresión: el estiramiento es por percentiles, no por mínimo/máximo (no queda lavado)', () => {
    // Grises de 90 a 220 en horizontal y 2 % de píxeles negros puros repartidos. Con mínimo/máximo
    // el negro fijaría el mínimo en 0 y la zona más oscura quedaría a media rampa.
    const w = 200;
    const h = 100;
    const img = solid(w, h, 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.round(90 + (x / (w - 1)) * 130);
        const i = (y * w + x) * 4;
        const negro = (y * w + x) % 50 === 0;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = negro ? 0 : v;
      }
    }
    const f = imageToAscii(img, { cols: 20, mode: 'grabado', vignette: false });
    const dense = GRABADO_RAMP.length - 10;
    const row = Math.floor(f.rows / 2);
    const idx = (col: number): number => GRABADO_RAMP.indexOf(f.cells[row * f.cols + col]!.ch);
    expect(idx(0)).toBeGreaterThanOrEqual(dense);
    expect(idx(1)).toBeGreaterThanOrEqual(dense - 12);
    expect(idx(f.cols - 1)).toBeLessThan(10);
  });

  it('el estiramiento de percentiles ignora un grupo de píxeles extremos de menos de 1 %', () => {
    const w = 200;
    const h = 100;
    const img = solid(w, h, 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.round(90 + (x / (w - 1)) * 130);
        const i = (y * w + x) * 4;
        const parche = x >= 195 && y >= 90; // una celda entera de 40 columnas (0,25 % de la imagen), negro puro
        img.data[i] = img.data[i + 1] = img.data[i + 2] = parche ? 0 : v;
      }
    }
    const f = imageToAscii(img, { cols: 40, mode: 'grabado', vignette: false });
    const row = Math.floor(f.rows / 2);
    expect(GRABADO_RAMP.indexOf(f.cells[row * f.cols]!.ch)).toBeGreaterThanOrEqual(GRABADO_RAMP.length - 10);
  });

  it('frameToAnsi emite tinta y papel una vez por tramo, no por celda', () => {
    const f = imageToAscii(gradient(64, 8), { cols: 16, mode: 'grabado', vignette: false });
    const ansi = frameToAnsi(f);
    const first = ansi.split('\n')[0]!;
    expect(first.split('\x1b[38;2;20;20;20m')).toHaveLength(2);
    expect(first.split('\x1b[48;2;250;250;247m')).toHaveLength(2);
    expect(first.startsWith('\x1b[38;2;20;20;20m\x1b[48;2;250;250;247m')).toBe(true);
  });
});
