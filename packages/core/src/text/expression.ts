import type { ExpressionId } from '../faces.js';
import { proseLines } from './summary.js';

/**
 * Reglas por palabras, en orden de prioridad: gana la primera que coincide (el fallo antes que
 * el éxito, así «Error, pero ya quedó listo» es triste). Se compara sin mayúsculas ni acentos
 * y solo sobre la prosa (sin código, rutas, URLs ni secretos).
 *
 * Una palabra empieza y termina en límite de palabra (`terror` no es `error`, `ojos` no es
 * `ojo`, `done.txt` no es `done`); por eso se listan las formas plurales. Las que terminan en
 * `*` son raíces y aceptan cualquier sufijo (`sorprend*` -> sorprendente, sorprendió).
 */
const RULES: readonly { expression: ExpressionId; keywords: readonly string[] }[] = [
  {
    expression: 'sad',
    keywords: [
      'error',
      'errors',
      'errores',
      'falló',
      'fallo',
      'fallos',
      'failed',
      'no se pudo',
      'fracas*',
    ],
  },
  {
    expression: 'smile',
    keywords: [
      'listo',
      'hecho',
      'pasaron',
      'passed',
      'done',
      '✓',
      'completado',
      'terminado',
      'success',
      'successfully',
      'éxito',
    ],
  },
  {
    expression: 'serious',
    keywords: [
      'cuidado',
      'warning',
      'warnings',
      'advertencia',
      'advertencias',
      'ojo',
      'irreversible',
      'peligro',
      'destruct*',
    ],
  },
  {
    expression: 'surprised',
    keywords: ['¡', 'wow', 'increíble', 'increíbles', 'sorprend*', 'whoa'],
  },
];

/** Palabras que anulan una palabra clave si van justo antes (hasta 2 palabras atrás). */
const NEGATORS: ReadonlySet<string> = new Set(
  ['0', 'no', 'sin', 'not', 'never', 'nunca', 'ningún', 'ninguna', 'zero', 'cero'].map(fold),
);
/** Signos que cierran una cláusula: un negador de otra cláusula no cuenta. */
const CLAUSE_BREAKS: ReadonlySet<string> = new Set([',', ';', ':', '.', '!', '?', '…', '\n', '(', ')']);
const NEGATION_WORDS = 2;
/** Cuánto texto hacia atrás se mira (basta para 2 palabras). */
const NEGATION_WINDOW = 40;

/** Minúsculas y sin marcas diacríticas. */
function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Letras, dígitos y `_`: lo que mantiene unida una palabra. */
const WORD_CHAR = '\\p{L}\\p{N}_';

function keywordPattern(keyword: string): string {
  const isStem = keyword.endsWith('*');
  const folded = fold(isStem ? keyword.slice(0, -1) : keyword);
  const body = escapeRegExp(folded).replaceAll(' ', '\\s+');
  // `✓` y `¡` no son letras: no necesitan límite de palabra.
  if (!/^[\p{L}\p{N}]/u.test(folded)) return body;
  const before = `(?<![${WORD_CHAR}])(?<![\\p{L}\\p{N}]\\.)`;
  const after = isStem ? '' : `(?![${WORD_CHAR}]|\\.[\\p{L}\\p{N}])`;
  return `${before}${body}${after}`;
}

const COMPILED = RULES.map(({ expression, keywords }) => ({
  expression,
  pattern: new RegExp(keywords.map(keywordPattern).join('|'), 'gu'),
}));

/** ¿Hay un negador entre las 2 palabras anteriores, dentro de la misma cláusula? */
function isNegated(text: string, index: number): boolean {
  const from = Math.max(0, index - NEGATION_WINDOW);
  let window = text.slice(from, index);
  let clauseStart = -1;
  for (let i = window.length - 1; i >= 0; i--) {
    if (CLAUSE_BREAKS.has(window[i]!)) {
      clauseStart = i;
      break;
    }
  }
  if (clauseStart >= 0) window = window.slice(clauseStart + 1);
  else if (from > 0 && !/\s/.test(text[from - 1]!)) {
    // La ventana empieza a media palabra: esa palabra incompleta no cuenta.
    const space = window.search(/\s/);
    window = space < 0 ? '' : window.slice(space);
  }
  const words = window.split(/\s+/).filter((word) => word !== '').slice(-NEGATION_WORDS);
  return words.some((word) => NEGATORS.has(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')));
}

/** Expresión de reposo del avatar según lo que dice la respuesta (sin contar el código). */
export function pickExpression(text: string): ExpressionId {
  const prose = fold(proseLines(text, true).join('\n'));
  for (const { expression, pattern } of COMPILED) {
    for (const match of prose.matchAll(pattern)) {
      if (!isNegated(prose, match.index)) return expression;
    }
  }
  return 'neutral';
}
