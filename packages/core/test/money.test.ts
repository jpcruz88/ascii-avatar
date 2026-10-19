import { describe, expect, it } from 'vitest';
import { DEFAULT_MXN_PER_USD, formatMxn } from '../src/index.js';

describe('formatMxn', () => {
  it('el tipo de cambio por defecto es 18.4 pesos por dólar', () => {
    expect(DEFAULT_MXN_PER_USD).toBe(18.4);
  });

  it('convierte dólares a pesos con dos decimales', () => {
    expect(formatMxn(0.055, 18.4)).toBe('$1.01 MXN');
    expect(formatMxn(0.3, 18.4)).toBe('$5.52 MXN');
    expect(formatMxn(1.6, 18.4)).toBe('$29.44 MXN');
    expect(formatMxn(8 * 0.055, 18.4)).toBe('$8.10 MXN');
  });

  it('cero y montos muy pequeños se muestran con dos decimales', () => {
    expect(formatMxn(0, 18.4)).toBe('$0.00 MXN');
    expect(formatMxn(0.0001, 18.4)).toBe('$0.00 MXN');
    expect(formatMxn(0.0357, 18.4)).toBe('$0.66 MXN');
  });

  it('usa el tipo de cambio que se le pasa', () => {
    expect(formatMxn(1, 20)).toBe('$20.00 MXN');
    expect(formatMxn(1, 17.5)).toBe('$17.50 MXN');
  });

  it('desde 100 pesos no muestra decimales', () => {
    expect(formatMxn(10, 18.4)).toBe('$184 MXN');
    expect(formatMxn(100 / 18.4, 18.4)).toBe('$100 MXN');
    // 99.996 pesos redondea a 100.00: pasa al formato sin decimales
    expect(formatMxn(99.996 / 18.4, 18.4)).toBe('$100 MXN');
    expect(formatMxn(99.99 / 18.4, 18.4)).toBe('$99.99 MXN');
  });

  it('un monto o tipo de cambio no finito se muestra como signo de pregunta, sin lanzar', () => {
    expect(formatMxn(Number.NaN, 18.4)).toBe('$? MXN');
    expect(formatMxn(Number.POSITIVE_INFINITY, 18.4)).toBe('$? MXN');
    expect(formatMxn(1, Number.NaN)).toBe('$? MXN');
  });

  it('nunca escribe USD', () => {
    expect(formatMxn(0.055, 18.4)).not.toMatch(/USD/);
  });
});
