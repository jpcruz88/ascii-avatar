import { frameDiff } from './ansi.js';
import type { AsciiFrame, Cell } from './types.js';

/** Ancho y alto de cada esquina superior, como fracción del cuadro. */
const CORNER_WIDTH = 0.1;
const CORNER_HEIGHT = 0.15;

/** Extrae un rectángulo de celdas como un cuadro propio. */
function crop(frame: AsciiFrame, col0: number, cols: number, rows: number): AsciiFrame {
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = col0; col < col0 + cols; col++) {
      cells.push(frame.cells[row * frame.cols + col]!);
    }
  }
  return { cols, rows, cells };
}

/** Une dos recortes de la misma altura, uno al lado del otro. */
function sideBySide(left: AsciiFrame, right: AsciiFrame): AsciiFrame {
  const cells: Cell[] = [];
  for (let row = 0; row < left.rows; row++) {
    cells.push(...left.cells.slice(row * left.cols, (row + 1) * left.cols));
    cells.push(...right.cells.slice(row * right.cols, (row + 1) * right.cols));
  }
  return { cols: left.cols + right.cols, rows: left.rows, cells };
}

function upperCorners(frame: AsciiFrame): AsciiFrame {
  const w = Math.min(frame.cols, Math.max(1, Math.round(frame.cols * CORNER_WIDTH)));
  const h = Math.min(frame.rows, Math.max(1, Math.round(frame.rows * CORNER_HEIGHT)));
  return sideBySide(crop(frame, 0, w, h), crop(frame, frame.cols - w, w, h));
}

/**
 * Cuánto cambia el fondo entre dos caras: `frameDiff` solo sobre las dos esquinas
 * superiores (10 % del ancho por 15 % del alto cada una, mínimo 1×1 celda), donde
 * debería haber fondo quieto. De 0 (iguales) a 1. Lanza si las dimensiones no coinciden.
 */
export function cornerDrift(a: AsciiFrame, b: AsciiFrame): number {
  if (a.cols !== b.cols || a.rows !== b.rows) {
    throw new Error(
      `Dimensiones distintas: ${a.cols}x${a.rows} contra ${b.cols}x${b.rows}`,
    );
  }
  return frameDiff(upperCorners(a), upperCorners(b));
}
