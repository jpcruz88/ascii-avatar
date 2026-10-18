import type { AsciiFrame, AsciiMode, Cell, RawImage, Rgb } from './types.js';

/** Rampa de oscuro a claro: negro es `' '`, blanco es `'@'`. */
export const GLYPH_RAMP = ' .:-=+*#%@';

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

/**
 * Convierte una imagen en un cuadro de `cols` columnas. La celda de terminal es
 * 1:2 (alta el doble que ancha), por eso `rows = round(alto / ancho * cols / 2)`
 * en los dos modos (como mínimo 1).
 */
export function imageToAscii(
  img: RawImage,
  opts: { cols: number; mode: AsciiMode },
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
