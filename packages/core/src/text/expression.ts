import type { ExpressionId } from '../faces.js';
import { removeCode } from './summary.js';

/**
 * Reglas por palabras, en orden de prioridad: gana la primera que coincide (el fallo antes que
 * el éxito, así «Error, pero ya quedó listo» es triste). Se compara sin mayúsculas ni acentos;
 * cada palabra debe empezar en un límite de palabra (`terror` no es `error`) pero puede llevar
 * sufijo (`errores` sí lo es).
 */
const RULES: readonly { expression: ExpressionId; keywords: readonly string[] }[] = [
  {
    expression: 'sad',
    keywords: ['error', 'falló', 'fallo', 'failed', 'no se pudo', 'fracas'],
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
      'éxito',
    ],
  },
  {
    expression: 'serious',
    keywords: ['cuidado', 'warning', 'advertencia', 'ojo', 'irreversible', 'peligro', 'destruct'],
  },
  {
    expression: 'surprised',
    keywords: ['¡', 'wow', 'increíble', 'sorprend', 'whoa'],
  },
];

/** Minúsculas y sin marcas diacríticas. */
function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordPattern(keyword: string): string {
  const folded = fold(keyword);
  const body = escapeRegExp(folded).replaceAll(' ', '\\s+');
  return /^[\p{L}\p{N}]/u.test(folded) ? `(?<![\\p{L}\\p{N}])${body}` : body;
}

const COMPILED = RULES.map(({ expression, keywords }) => ({
  expression,
  pattern: new RegExp(keywords.map(keywordPattern).join('|'), 'u'),
}));

/** Expresión de reposo del avatar según lo que dice la respuesta (sin contar el código). */
export function pickExpression(text: string): ExpressionId {
  const prose = fold(removeCode(text));
  for (const { expression, pattern } of COMPILED) if (pattern.test(prose)) return expression;
  return 'neutral';
}
