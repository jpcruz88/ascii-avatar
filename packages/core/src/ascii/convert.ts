import type { AsciiFrame, AsciiMode, Cell, RawImage, Rgb, ToneRange } from './types.js';

/** Rampa de oscuro a claro: negro es `' '`, blanco es `'@'`. */
export const GLYPH_RAMP = ' .:-=+*#%@';

/**
 * Rampa del modo `grabado`, de claro a oscuro: los píxeles oscuros llevan los
 * caracteres más densos (tinta sobre papel). Índice = floor((1 - v) * longitud).
 */
export const GRABADO_RAMP =
  " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

/** Tinta y papel del modo `grabado`: el panel pinta su propio papel en cualquier terminal. */
export const INK: Readonly<Rgb> = { r: 20, g: 20, b: 20 };
export const PAPER: Readonly<Rgb> = { r: 250, g: 250, b: 247 };

/** Ajuste lineal tras el estiramiento: v * ganancia + desplazamiento, recortado a 0..1. */
export const TONE_GAIN = 1.25;
export const TONE_OFFSET = -20 / 255;

/**
 * Viñeteado radial hacia blanco papel. El centro está en (50 %, 38 %) de la imagen y el radio
 * es 55 % de la diagonal normalizada sqrt((ancho² + alto²) / 2), como en SVG. No cambia nada
 * hasta 55 % del radio y deja blanco todo lo que pasa de 80 %; en medio mezcla en línea recta.
 */
export const VIGNETTE = {
  centerX: 0.5,
  centerY: 0.38,
  radius: 0.55,
  clearUntil: 0.55,
  whiteFrom: 0.8,
} as const;

/** Luminosidad relativa (Rec. 709) de un color, de 0 a 1. */
export function luminance(c: Rgb): number {
  // Pesos enteros (suman 10000) para que blanco dé exactamente 1.
  return (2126 * c.r + 7152 * c.g + 722 * c.b) / 2550000;
}

/**
 * Promedio por área de la región [x0,x1) x [y0,y1) (coordenadas reales en píxeles).
 * Los píxeles de borde cuentan en proporción a lo que cubre la región, así el
 * resultado no depende de que el ancho sea múltiplo de las columnas. El alfa se
 * compone sobre negro. Es determinista y recorre cada píxel una sola vez.
 */
function averageRegion(
  img: RawImage,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Rgb {
  const { width, height, data } = img;
  const px0 = Math.max(0, Math.floor(x0));
  const px1 = Math.min(width, Math.ceil(x1));
  const py0 = Math.max(0, Math.floor(y0));
  const py1 = Math.min(height, Math.ceil(y1));

  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let y = py0; y < py1; y++) {
    const wy = Math.min(y + 1, y1) - Math.max(y, y0);
    if (wy <= 0) continue;
    const row = y * width;
    for (let x = px0; x < px1; x++) {
      const w = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy;
      if (w <= 0) continue;
      const i = (row + x) * 4;
      const a = (data[i + 3] ?? 255) / 255;
      r += (data[i] ?? 0) * a * w;
      g += (data[i + 1] ?? 0) * a * w;
      b += (data[i + 2] ?? 0) * a * w;
      total += w;
    }
  }
  if (total === 0) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.round(r / total),
    g: Math.round(g / total),
    b: Math.round(b / total),
  };
}

/** Luminosidad (0..1) de un píxel con los pesos de `luminance`; el alfa se compone sobre blanco. */
function pixelLuma(data: Uint8Array, i: number): number {
  const a = (data[i + 3] ?? 255) / 255;
  const mix = (c: number | undefined): number => (c ?? 0) * a + 255 * (1 - a);
  return (2126 * mix(data[i]) + 7152 * mix(data[i + 1]) + 722 * mix(data[i + 2])) / 2550000;
}

/** Percentiles del estiramiento de contraste, como `normalise()` de sharp. */
export const TONE_PERCENTILES = { low: 1, high: 99 } as const;

const BINS = 256;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const toBin = (v: number): number => Math.min(BINS - 1, Math.max(0, Math.round(v * (BINS - 1))));

/** Histograma de 256 niveles de un plano de tono 0..1. */
function histogram(plane: ArrayLike<number>): Uint32Array {
  const h = new Uint32Array(BINS);
  for (let i = 0; i < plane.length; i++) h[toBin(plane[i] ?? 0)]!++;
  return h;
}

/**
 * Rango [bajo, alto] (0..1) entre los percentiles 1 % y 99 % del histograma, igual que el
 * `normalise()` de sharp: el primer nivel cuya cuenta acumulada pasa de cada umbral.
 */
function percentileRange(hist: Uint32Array): ToneRange {
  let total = 0;
  for (const n of hist) total += n;
  if (total === 0) return { min: 0, max: 1 };
  const find = (pct: number): number => {
    const limit = (total * pct) / 100;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b] ?? 0;
      if (acc > limit) return b;
    }
    return BINS - 1;
  };
  return { min: find(TONE_PERCENTILES.low) / (BINS - 1), max: find(TONE_PERCENTILES.high) / (BINS - 1) };
}

/** Estira v con el rango; si el rango es casi nulo (un solo tono) lo deja igual, sin dividir entre cero. */
function stretch(v: number, r: ToneRange): number {
  const span = r.max - r.min;
  return span > 1e-6 ? clamp01((v - r.min) / span) : v;
}

/**
 * Rango de tono del modo `grabado`, en dos etapas como el prototipo aprobado:
 * - `first`: percentiles de la luminosidad de la imagen completa, antes del viñeteado.
 * - `second`: percentiles de las celdas ya viñeteadas, después del viñeteado.
 */
export interface GrabadoTone {
  first: ToneRange;
  second: ToneRange;
}

/** Plano de luminosidad (0..1) de la imagen, un valor por píxel. */
function lumaPlane(img: RawImage): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = pixelLuma(img.data, i * 4);
  return out;
}

/**
 * Etapa 1 y viñeteado: estira la luminosidad con `first`, mezcla hacia blanco con el viñeteado
 * (modo pantalla: 1 - (1 - v) * (1 - máscara)) y promedia por área en `cols` x `rows` celdas.
 */
function cellTones(img: RawImage, luma: Float32Array, first: ToneRange, vignette: boolean, cols: number, rows: number): Float32Array {
  const { width, height } = img;
  const diag = Math.sqrt((width * width + height * height) / 2);
  const radius = VIGNETTE.radius * diag;
  const cx = VIGNETTE.centerX * width;
  const cy = VIGNETTE.centerY * height;
  const fade = VIGNETTE.whiteFrom - VIGNETTE.clearUntil;
  const plane = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = stretch(luma[y * width + x] ?? 0, first);
      if (vignette) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        const t = clamp01((d - VIGNETTE.clearUntil) / fade);
        v = 1 - (1 - v) * (1 - t);
      }
      plane[y * width + x] = v;
    }
  }
  const cw = width / cols;
  const ch = height / rows;
  const cells = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells[row * cols + col] = averageTone(plane, width, height, col * cw, (col + 1) * cw, row * ch, (row + 1) * ch);
    }
  }
  return cells;
}

const rowsFor = (img: RawImage, cols: number): number =>
  Math.max(1, Math.round(((img.height / img.width) * cols) / 2));

/**
 * Calcula el rango de tono compartido de varias imágenes (las 8 caras de un agente), para que al
 * alternarlas no parpadeen: `first` sale de la luminosidad de todas juntas y `second` de las celdas
 * viñeteadas de todas juntas. Determinista.
 */
export function grabadoTone(images: readonly RawImage[], cols: number, vignette = true): GrabadoTone {
  const lumas = images.map(lumaPlane);
  const h1 = new Uint32Array(BINS);
  for (const l of lumas) histogram(l).forEach((n, b) => (h1[b]! += n));
  const first = percentileRange(h1);
  const h2 = new Uint32Array(BINS);
  images.forEach((img, i) => {
    const cells = cellTones(img, lumas[i]!, first, vignette, cols, rowsFor(img, cols));
    histogram(cells).forEach((n, b) => (h2[b]! += n));
  });
  return { first, second: percentileRange(h2) };
}

/** Promedio por área del plano de tono en [x0,x1) x [y0,y1); misma ponderación que `averageRegion`. */
function averageTone(
  plane: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  const px0 = Math.max(0, Math.floor(x0));
  const px1 = Math.min(width, Math.ceil(x1));
  const py0 = Math.max(0, Math.floor(y0));
  const py1 = Math.min(height, Math.ceil(y1));
  let sum = 0;
  let total = 0;
  for (let y = py0; y < py1; y++) {
    const wy = Math.min(y + 1, y1) - Math.max(y, y0);
    if (wy <= 0) continue;
    for (let x = px0; x < px1; x++) {
      const w = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy;
      if (w <= 0) continue;
      sum += (plane[y * width + x] ?? 1) * w;
      total += w;
    }
  }
  return total === 0 ? 1 : sum / total;
}

/**
 * Convierte una imagen en un cuadro de `cols` columnas. La celda de terminal es
 * 1:2 (alta el doble que ancha), por eso `rows = round(alto / ancho * cols / 2)`
 * en los dos modos (como mínimo 1).
 */
export function imageToAscii(
  img: RawImage,
  opts: {
    cols: number;
    mode: AsciiMode;
    /** Solo `grabado`: rango de tono compartido (p. ej. el de las 8 caras, ver `grabadoTone`). Por defecto, el de esta imagen. */
    tone?: GrabadoTone;
    /** Solo `grabado`: aplica el viñeteado. Por defecto sí. */
    vignette?: boolean;
  },
): AsciiFrame {
  const { cols, mode } = opts;
  if (!Number.isInteger(cols) || cols < 1) {
    throw new Error(`cols debe ser un entero positivo, recibido ${cols}`);
  }
  if (img.width < 1 || img.height < 1) {
    throw new Error('La imagen está vacía');
  }

  const rows = Math.max(1, Math.round(((img.height / img.width) * cols) / 2));
  const cw = img.width / cols;
  const ch = img.height / rows;
  const cells: Cell[] = [];
  let tones: Float32Array | null = null;
  if (mode === 'grabado') {
    const vignette = opts.vignette ?? true;
    const tone = opts.tone ?? grabadoTone([img], cols, vignette);
    tones = cellTones(img, lumaPlane(img), tone.first, vignette, cols, rows);
    for (let i = 0; i < tones.length; i++) {
      tones[i] = clamp01(stretch(tones[i] ?? 1, tone.second) * TONE_GAIN + TONE_OFFSET);
    }
  }

  for (let row = 0; row < rows; row++) {
    const y0 = row * ch;
    for (let col = 0; col < cols; col++) {
      const x0 = col * cw;
      if (tones !== null) {
        const v = tones[row * cols + col] ?? 1;
        const idx = Math.min(GRABADO_RAMP.length - 1, Math.floor((1 - v) * GRABADO_RAMP.length));
        cells.push({ ch: GRABADO_RAMP.charAt(idx), fg: { ...INK }, bg: { ...PAPER } });
      } else if (mode === 'halfblock') {
        const mid = y0 + ch / 2;
        cells.push({
          ch: '▀',
          fg: averageRegion(img, x0, x0 + cw, y0, mid),
          bg: averageRegion(img, x0, x0 + cw, mid, y0 + ch),
        });
      } else {
        const fg = averageRegion(img, x0, x0 + cw, y0, y0 + ch);
        const idx = Math.round(luminance(fg) * (GLYPH_RAMP.length - 1));
        cells.push({ ch: GLYPH_RAMP.charAt(idx), fg, bg: null });
      }
    }
  }
  return { cols, rows, cells };
}
