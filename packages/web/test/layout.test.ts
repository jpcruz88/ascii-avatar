import { describe, expect, it } from 'vitest';
import { FPS_FAST, FPS_IDLE, fitFont, nextDrawAt } from '../src/layout.js';

describe('fitFont: la letra se calcula con el ancho del contenedor', () => {
  it('las columnas llenan el ancho y cada celda es 1:2 (alta el doble que ancha)', () => {
    const f = fitFont(600, 100, 0.6)!;
    // 600 px / 100 columnas = 6 px por carácter; con 0,6 em por carácter, 10 px de letra.
    expect(f.fontSize).toBeCloseTo(10, 5);
    expect(f.lineHeight).toBeCloseTo(12, 5);
    expect(f.lineHeight / (f.fontSize * 0.6)).toBeCloseTo(2, 5);
  });

  it('usa el ancho real del carácter de la fuente si se midió', () => {
    const f = fitFont(300, 50, 0.5)!;
    expect(f.fontSize).toBeCloseTo(12, 5);
    expect(f.lineHeight).toBeCloseTo(12, 5);
  });

  it('sin ancho (oculto o sin maquetar) no propone nada', () => {
    expect(fitFont(0, 100)).toBeNull();
    expect(fitFont(Number.NaN, 100)).toBeNull();
    expect(fitFont(500, 0)).toBeNull();
  });

  it('un ancho del carácter absurdo cae al valor típico de una monoespaciada (0,6 em)', () => {
    expect(fitFont(600, 100, 0)!.fontSize).toBeCloseTo(10, 5);
    expect(fitFont(600, 100, Number.NaN)!.fontSize).toBeCloseTo(10, 5);
  });
});

describe('nextDrawAt: el ritmo de dibujo como en el panel', () => {
  it('24 fps al hablar o en un clip, 12 en reposo', () => {
    expect(FPS_FAST).toBe(24);
    expect(FPS_IDLE).toBe(12);
    expect(nextDrawAt(0, 0, true)).toBe(Math.round(1000 / 24));
    expect(nextDrawAt(0, 0, false)).toBe(Math.round(1000 / 12));
  });

  it('agenda cada cuadro a su hora: el tiempo de dibujar no se acumula', () => {
    let at = 0;
    at = nextDrawAt(at, 5, true);
    at = nextDrawAt(at, at + 3, true);
    expect(at).toBe(2 * Math.round(1000 / 24));
  });

  it('si se atrasa más de un cuadro, sigue desde ahora en vez de recuperar', () => {
    expect(nextDrawAt(0, 500, true)).toBe(500);
  });
});
