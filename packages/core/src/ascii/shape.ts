import { GLYPH_COLS, GLYPH_MASKS, GLYPH_ROWS } from './glyphs.js';

/** Subceldas por celda: el patrón de tinta de una celda tiene este largo. */
export const SUBCELLS = GLYPH_COLS * GLYPH_ROWS;

/**
 * Peso del término de densidad al elegir entre caracteres con tinta. Es alto a propósito: la densidad
 * fija el tono (las zonas oscuras llevan caracteres densos) y, entre los caracteres de densidad
 * parecida, decide la forma de los trazos.
 */
export const DENSITY_WEIGHT = 150;

/**
 * La densidad buscada es la tinta media de la celda (ya en la escala de las máscaras) por este factor:
 * menos de 1 aclara el conjunto, para que el sombreado no tape las líneas.
 */
export const DENSITY_SCALE = 0.6;

/** Pasadas del difuminado [1 2 1] / 4 que se aplica a la celda y a las máscaras antes de compararlas. */
const BLUR_PASSES = 2;

/**
 * Difumina en el sitio un patrón de `GLYPH_COLS` x `GLYPH_ROWS` con el núcleo separable [1 2 1] / 4
 * (el borde se repite). Así una línea corrida una subcelda sigue pareciéndose a su carácter.
 */
function blur(v: Float32Array, tmp: Float32Array): void {
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    for (let y = 0; y < GLYPH_ROWS; y++) {
      const row = y * GLYPH_COLS;
      for (let x = 0; x < GLYPH_COLS; x++) {
        const l = v[row + Math.max(0, x - 1)]!;
        const r = v[row + Math.min(GLYPH_COLS - 1, x + 1)]!;
        tmp[row + x] = (l + 2 * v[row + x]! + r) / 4;
      }
    }
    for (let y = 0; y < GLYPH_ROWS; y++) {
      const up = Math.max(0, y - 1) * GLYPH_COLS;
      const down = Math.min(GLYPH_ROWS - 1, y + 1) * GLYPH_COLS;
      const row = y * GLYPH_COLS;
      for (let x = 0; x < GLYPH_COLS; x++) {
        v[row + x] = (tmp[up + x]! + 2 * tmp[row + x]! + tmp[down + x]!) / 4;
      }
    }
  }
}

interface Prepared {
  chars: string[];
  /** Máscaras difuminadas, una tras otra (`SUBCELLS` valores cada una). */
  masks: Float32Array;
  /** Norma al cuadrado de cada máscara difuminada. */
  norms: Float32Array;
  /** Tinta media de cada máscara sin difuminar, de 0 a 1. */
  means: Float32Array;
}

let prepared: Prepared | null = null;

function prepare(): Prepared {
  if (prepared !== null) return prepared;
  const n = GLYPH_MASKS.length;
  const masks = new Float32Array(n * SUBCELLS);
  const norms = new Float32Array(n);
  const means = new Float32Array(n);
  const tmp = new Float32Array(SUBCELLS);
  GLYPH_MASKS.forEach(([, mask], g) => {
    const digits = mask.replace(/ /g, '');
    const m = masks.subarray(g * SUBCELLS, (g + 1) * SUBCELLS);
    let sum = 0;
    for (let i = 0; i < SUBCELLS; i++) {
      m[i] = Number(digits[i]) / 9;
      sum += m[i]!;
    }
    means[g] = sum / SUBCELLS;
    blur(m, tmp);
    let nn = 0;
    for (let i = 0; i < SUBCELLS; i++) nn += m[i]! * m[i]!;
    norms[g] = nn;
  });
  prepared = { chars: GLYPH_MASKS.map(([c]) => c), masks, norms, means };
  return prepared;
}

/**
 * Elige el carácter que mejor dibuja el patrón de tinta de la celda: `ink` son `SUBCELLS` valores
 * 0..1 fila por fila, ya en la escala de las máscaras (se modifica: se difumina en el sitio). Las dos
 * cosas se comparan difuminadas, así una línea corrida una subcelda sigue pareciéndose a su carácter.
 *
 * 1. ¿Papel o tinta? Si el espacio se parece más a la celda que cualquier carácter por suma de
 *    diferencias al cuadrado (|c - m|²), la celda es papel: así lo muy tenue queda en blanco.
 * 2. Entre los caracteres con tinta gana el de menor forma + `DENSITY_WEIGHT` x (densidad)². La forma
 *    es la parte de la celda que la máscara no explica ni escalándola (1 - cos², de 0 a 1): no
 *    depende del grosor del trazo, solo de dónde está la tinta. La densidad es la diferencia entre la
 *    tinta media de la celda (por `DENSITY_SCALE`) y la del carácter: las zonas oscuras llevan
 *    caracteres densos.
 *
 * A igual coste gana el primero de `GLYPH_MASKS`: es determinista.
 */
export function matchGlyph(ink: Float32Array, tmp: Float32Array): string {
  const { chars, masks, norms, means } = prepare();
  let mean = 0;
  for (let i = 0; i < SUBCELLS; i++) mean += ink[i]!;
  mean /= SUBCELLS;
  blur(ink, tmp);
  let cc = 0;
  for (let i = 0; i < SUBCELLS; i++) cc += ink[i]! * ink[i]!;
  let space = -1;
  let best = -1;
  let bestCost = Infinity;
  let bestSsd = Infinity;
  for (let g = 0; g < chars.length; g++) {
    const nn = norms[g]!;
    if (nn === 0) {
      space = g;
      continue;
    }
    let dot = 0;
    const off = g * SUBCELLS;
    for (let i = 0; i < SUBCELLS; i++) dot += ink[i]! * masks[off + i]!;
    // |c - m|² sin el término |c|², que es igual para todos.
    bestSsd = Math.min(bestSsd, nn - 2 * dot);
    const shape = cc > 0 ? 1 - (dot * dot) / (cc * nn) : 1;
    const d = mean * DENSITY_SCALE - means[g]!;
    const cost = shape + DENSITY_WEIGHT * d * d;
    if (cost < bestCost) {
      bestCost = cost;
      best = g;
    }
  }
  // El espacio tiene |m|² = 0: gana si ningún carácter baja de 0.
  if (space >= 0 && (best < 0 || bestSsd >= 0)) return chars[space]!;
  return chars[best]!;
}
