import { luminance } from './convert.js';
import type { AsciiFrame, Cell, Rgb } from './types.js';

const RESET = '\x1b[0m';

const fgCode = (c: Rgb): string => `\x1b[38;2;${c.r};${c.g};${c.b}m`;
const bgCode = (c: Rgb): string => `\x1b[48;2;${c.r};${c.g};${c.b}m`;

/**
 * Serializa el cuadro con color de 24 bits. Cada fila termina con `\x1b[0m` y las
 * filas se unen con `\n`; no emite movimientos de cursor (eso lo decide quien pinta).
 */
export function frameToAnsi(frame: AsciiFrame): string {
  const lines: string[] = [];
  for (let row = 0; row < frame.rows; row++) {
    let line = '';
    let fg: string | null = null;
    let bg: string | null = null;
    for (let col = 0; col < frame.cols; col++) {
      const cell = frame.cells[row * frame.cols + col];
      if (!cell) continue;
      const nextFg = fgCode(cell.fg);
      const nextBg = cell.bg ? bgCode(cell.bg) : null;
      if (nextBg === null && bg !== null) {
        // Quitar el fondo anterior sin perder el resto de la configuración.
        line += RESET;
        fg = null;
        bg = null;
      }
      if (nextFg !== fg) line += nextFg;
      if (nextBg !== null && nextBg !== bg) line += nextBg;
      fg = nextFg;
      bg = nextBg;
      line += cell.ch;
    }
    lines.push(line + RESET);
  }
  return lines.join('\n');
}

/** Luminosidad visible de una celda: con fondo, el promedio de sus dos mitades. */
function cellLuminance(cell: Cell): number {
  return cell.bg ? (luminance(cell.fg) + luminance(cell.bg)) / 2 : luminance(cell.fg);
}

/**
 * Diferencia media de luminosidad por celda entre dos cuadros, de 0 (iguales) a
 * 1 (negro contra blanco). Lanza si las dimensiones no coinciden.
 */
export function frameDiff(a: AsciiFrame, b: AsciiFrame): number {
  if (a.cols !== b.cols || a.rows !== b.rows) {
    throw new Error(
      `Dimensiones distintas: ${a.cols}x${a.rows} contra ${b.cols}x${b.rows}`,
    );
  }
  const n = a.cells.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.abs(cellLuminance(a.cells[i]!) - cellLuminance(b.cells[i]!));
  }
  return Math.min(1, sum / n);
}
