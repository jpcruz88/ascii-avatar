/** Color de 8 bits por canal. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Una celda de terminal: un carácter, su color de frente y, si aplica, de fondo. */
export interface Cell {
  ch: string;
  fg: Rgb;
  bg: Rgb | null;
}

/** Cuadro ASCII; `cells` va fila por fila y tiene `cols * rows` elementos. */
export interface AsciiFrame {
  cols: number;
  rows: number;
  cells: Cell[];
}

/** Imagen RGBA de 8 bits por canal, fila por fila. */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * - `glyphs`: un carácter de la rampa por celda, elegido por luminosidad.
 * - `halfblock`: `▀` con el píxel de arriba como frente y el de abajo como fondo.
 */
export type AsciiMode = 'glyphs' | 'halfblock';
