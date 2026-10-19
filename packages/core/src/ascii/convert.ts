import { GLYPH_COLS, GLYPH_ROWS } from './glyphs.js';
import { SUBCELLS, matchGlyph } from './shape.js';
import type { AsciiFrame, AsciiMode, Cell, RawImage, Rgb, ToneRange } from './types.js';

/** Rampa de oscuro a claro: negro es `' '`, blanco es `'@'`. */
export const GLYPH_RAMP = ' .:-=+*#%@';

/** Tinta y papel del modo `grabado`: el panel pinta su propio papel en cualquier terminal. */
export const INK: Readonly<Rgb> = { r: 20, g: 20, b: 20 };
export const PAPER: Readonly<Rgb> = { r: 250, g: 250, b: 247 };

/**
 * Ajuste lineal del tono de cada subcelda tras el segundo estiramiento: v * ganancia + desplazamiento,
 * recortado a 0..1. Hace de umbral de papel (desde v = 0,86 todo es blanco, así el grano y los grises
 * muy suaves del fondo no dejan tinta) y oscurece lo oscuro.
 */
export const TONE_GAIN = 1.25;
export const TONE_OFFSET = -20 / 255;

/**
 * Escala de la tinta del modo `grabado` frente a las máscaras de `GLYPH_MASKS`: una subcelda negra
 * cuenta como 0,5 de cobertura. Los trazos de los caracteres son finos (cubren poco de cada subcelda),
 * así que con 1 hasta una línea fina pediría caracteres densos; con menos, las zonas grises quedan
 * en papel.
 */
export const INK_SCALE = 0.5;

/**
 * Viñeteado radial hacia blanco papel (opcional en el modo `grabado`; por defecto apagado, porque
 * las caras ya vienen sobre fondo blanco). El centro está en (50 %, 38 %) de la imagen y el radio
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

/** Percentiles del estiramiento de contraste, como `normalise()` de sharp. */
export const TONE_PERCENTILES = { low: 1, high: 99 } as const;

const BINS = 256;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Histograma de 256 niveles de un plano de tono 0..1 (nivel = round(v * 255), recortado). */
function histogram(plane: ArrayLike<number>): Uint32Array {
  const h = new Uint32Array(BINS);
  for (let i = 0; i < plane.length; i++) {
    const b = Math.round((plane[i] ?? 0) * (BINS - 1));
    h[b < 0 ? 0 : b > BINS - 1 ? BINS - 1 : b]!++;
  }
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

/**
 * Estiramiento de contraste con un rango, como recta: v pasa a recortar a 0..1 (a * v + b), con
 * a = 1 / (max - min) y b = -min / (max - min). Si el rango es casi nulo (un solo tono) deja v igual,
 * sin dividir entre cero.
 *
 * Los bucles por píxel y por subcelda escriben estas cuentas en línea en vez de llamar a funciones
 * pequeñas: con el `keepNames` de esbuild (tsx, Vitest) esas llamadas no se pueden poner en línea y
 * el modo `grabado` iba 3 veces más lento.
 */
function stretchLine(r: ToneRange): { a: number; b: number } {
  const span = r.max - r.min;
  return span > 1e-6 ? { a: 1 / span, b: -r.min / span } : { a: 1, b: 0 };
}

/**
 * Rango de tono del modo `grabado`, en dos etapas:
 * - `first`: percentiles de la luminosidad de los píxeles; estira el contraste de la imagen.
 * - `second`: percentiles del tono de las subceldas (ver `GLYPH_COLS` y `GLYPH_ROWS`) ya estiradas
 *   con `first`; estira lo que queda de contraste al muestrear la imagen a la escala de las celdas.
 */
export interface GrabadoTone {
  first: ToneRange;
  second: ToneRange;
}

/** Plano de luminosidad (0..1) de la imagen, un valor por píxel. */
function lumaPlane(img: RawImage): Float32Array {
  const { data } = img;
  const out = new Float32Array(img.width * img.height);
  // Luminosidad con los pesos de `luminance`; el alfa se compone sobre blanco.
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    const a = (data[j + 3] ?? 255) / 255;
    const paper = 255 * (1 - a);
    out[i] =
      (2126 * ((data[j] ?? 0) * a + paper) + 7152 * ((data[j + 1] ?? 0) * a + paper) + 722 * ((data[j + 2] ?? 0) * a + paper)) /
      2550000;
  }
  return out;
}

/**
 * Tabla de áreas acumuladas del tono del modo `grabado`: estira la luminosidad con `first` y aplica el
 * viñeteado si se pide (modo pantalla hacia blanco: 1 - (1 - v) * (1 - máscara)). Con una fila y una
 * columna de ceros delante, `S[y * (ancho + 1) + x]` es la suma del tono en [0,x) x [0,y); así se
 * promedia cualquier rectángulo, también con bordes fraccionarios, en tiempo constante.
 */
function toneTable(img: RawImage, luma: Float32Array, first: ToneRange, vignette: boolean): Float64Array {
  const { width, height } = img;
  const diag = Math.sqrt((width * width + height * height) / 2);
  const radius = VIGNETTE.radius * diag;
  const cx = VIGNETTE.centerX * width;
  const cy = VIGNETTE.centerY * height;
  const fade = VIGNETTE.whiteFrom - VIGNETTE.clearUntil;
  const w1 = width + 1;
  const sat = new Float64Array(w1 * (height + 1));
  const { a, b } = stretchLine(first);
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      let v = a * (luma[y * width + x] ?? 1) + b;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (vignette) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        const t = clamp01((d - VIGNETTE.clearUntil) / fade);
        v = 1 - (1 - v) * (1 - t);
      }
      row += v;
      sat[(y + 1) * w1 + x + 1] = sat[y * w1 + x + 1]! + row;
    }
  }
  return sat;
}

const rowsFor = (img: RawImage, cols: number): number =>
  Math.max(1, Math.round(((img.height / img.width) * cols) / 2));

/**
 * Tono (0..1) de cada subcelda de `cols` x `rows` celdas (promedio por área). El resultado va celda
 * por celda, fila por fila, y dentro de cada celda sus `SUBCELLS` subceldas también fila por fila.
 * Las subceldas vecinas comparten esquinas: la suma acumulada se calcula una vez por esquina.
 */
function subcellTones(sat: Float64Array, img: RawImage, cols: number, rows: number): Float32Array {
  const { width, height } = img;
  const gw = cols * GLYPH_COLS;
  const gh = rows * GLYPH_ROWS;
  const sw = width / gw;
  const sh = height / gh;
  const corners = new Float64Array((gw + 1) * (gh + 1));
  const w1 = width + 1;
  for (let y = 0; y <= gh; y++) {
    // Suma de la tabla en [0,x) x [0,y) para x, y reales: dentro de cada píxel la suma acumulada es
    // bilineal, así que interpolar la tabla da el valor exacto (los píxeles de borde cuentan en
    // proporción a lo que cubre la región, igual que en `averageRegion`).
    const yc = Math.min(height, y * sh);
    const y0 = Math.min(height - 1, Math.floor(yc));
    const fy = yc - y0;
    for (let x = 0; x <= gw; x++) {
      const xc = Math.min(width, x * sw);
      const x0 = Math.min(width - 1, Math.floor(xc));
      const fx = xc - x0;
      const p = sat[y0 * w1 + x0]!;
      const q = sat[y0 * w1 + x0 + 1]!;
      const r = sat[(y0 + 1) * w1 + x0]!;
      const t = sat[(y0 + 1) * w1 + x0 + 1]!;
      corners[y * (gw + 1) + x] = p + (q - p) * fx + (r - p) * fy + (p - q - r + t) * fx * fy;
    }
  }
  const area = sw * sh;
  const out = new Float32Array(gw * gh);
  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      for (let gy = row * GLYPH_ROWS; gy < (row + 1) * GLYPH_ROWS; gy++) {
        const top = gy * (gw + 1);
        const bottom = top + gw + 1;
        for (let gx = col * GLYPH_COLS; gx < (col + 1) * GLYPH_COLS; gx++) {
          const sum = corners[bottom + gx + 1]! - corners[bottom + gx]! - corners[top + gx + 1]! + corners[top + gx]!;
          const v = sum / area;
          out[i++] = v < 0 ? 0 : v > 1 ? 1 : v;
        }
      }
    }
  }
  return out;
}

/**
 * Calcula el rango de tono compartido de varias imágenes (las 8 caras de un agente), para que al
 * alternarlas no parpadeen: `first` sale de la luminosidad de todas juntas y `second` del tono de
 * las subceldas de todas juntas. `vignette` debe coincidir con el de `imageToAscii` (por defecto, no).
 * Determinista.
 */
export function grabadoTone(images: readonly RawImage[], cols: number, vignette = false): GrabadoTone {
  return grabadoToneWithSubcells(images, cols, vignette).tone;
}

/** Como `grabadoTone`, y además devuelve el tono de las subceldas de cada imagen para no repetirlo. */
function grabadoToneWithSubcells(
  images: readonly RawImage[],
  cols: number,
  vignette: boolean,
): { tone: GrabadoTone; subcells: Float32Array[] } {
  const lumas = images.map(lumaPlane);
  const h1 = new Uint32Array(BINS);
  for (const l of lumas) histogram(l).forEach((n, b) => (h1[b]! += n));
  const first = percentileRange(h1);
  const h2 = new Uint32Array(BINS);
  const subcells = images.map((img, i) => {
    const tones = subcellTones(toneTable(img, lumas[i]!, first, vignette), img, cols, rowsFor(img, cols));
    histogram(tones).forEach((n, b) => (h2[b]! += n));
    return tones;
  });
  return { tone: { first, second: percentileRange(h2) }, subcells };
}

/**
 * Modo `grabado`: elige cada carácter por la forma de la tinta de su celda. Muestrea la celda en
 * `GLYPH_COLS` x `GLYPH_ROWS` subceldas (promedio por área del tono), estira cada subcelda con
 * `second`, la ajusta con `TONE_GAIN` y `TONE_OFFSET`, la pasa a tinta (1 - tono) en la escala
 * `INK_SCALE` y busca con `matchGlyph` el carácter que mejor se parece.
 */
function grabadoChars(tones: Float32Array, second: ToneRange): string[] {
  const cells = tones.length / SUBCELLS;
  const ink = new Float32Array(SUBCELLS);
  const tmp = new Float32Array(SUBCELLS);
  const out: string[] = [];
  // Estirar con `second` y luego v * TONE_GAIN + TONE_OFFSET, en línea (ver `stretchLine`).
  const { a, b } = stretchLine(second);
  for (let cell = 0; cell < cells; cell++) {
    let total = 0;
    for (let i = 0; i < SUBCELLS; i++) {
      let v = a * (tones[cell * SUBCELLS + i] ?? 1) + b;
      v = (v < 0 ? 0 : v > 1 ? 1 : v) * TONE_GAIN + TONE_OFFSET;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      ink[i] = (1 - v) * INK_SCALE;
      total += ink[i]!;
    }
    out.push(total === 0 ? ' ' : matchGlyph(ink, tmp));
  }
  return out;
}

/**
 * Convierte una imagen en un cuadro de `cols` columnas. La celda de terminal es
 * 1:2 (alta el doble que ancha), por eso `rows = round(alto / ancho * cols / 2)`
 * en todos los modos (como mínimo 1).
 */
export function imageToAscii(
  img: RawImage,
  opts: {
    cols: number;
    mode: AsciiMode;
    /** Solo `grabado`: rango de tono compartido (p. ej. el de las 8 caras, ver `grabadoTone`). Por defecto, el de esta imagen. */
    tone?: GrabadoTone;
    /** Solo `grabado`: aplica el viñeteado. Por defecto no (las caras ya vienen sobre fondo blanco). */
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

  const rows = rowsFor(img, cols);
  if (mode === 'grabado') {
    const vignette = opts.vignette ?? false;
    let tones: Float32Array;
    let second: ToneRange;
    if (opts.tone === undefined) {
      const own = grabadoToneWithSubcells([img], cols, vignette);
      tones = own.subcells[0]!;
      second = own.tone.second;
    } else {
      tones = subcellTones(toneTable(img, lumaPlane(img), opts.tone.first, vignette), img, cols, rows);
      second = opts.tone.second;
    }
    const chars = grabadoChars(tones, second);
    return { cols, rows, cells: chars.map((ch) => ({ ch, fg: { ...INK }, bg: { ...PAPER } })) };
  }

  const cw = img.width / cols;
  const ch = img.height / rows;
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    const y0 = row * ch;
    for (let col = 0; col < cols; col++) {
      const x0 = col * cw;
      if (mode === 'halfblock') {
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
