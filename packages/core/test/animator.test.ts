import { describe, expect, it } from 'vitest';
import { Animator } from '../src/index.js';
import type { ExpressionId, MouthStep } from '../src/index.js';

const zero = () => 0;
const one = () => 1;

function speech(
  steps: MouthStep[],
  durationMs: number,
  expression: ExpressionId = 'smile',
): { steps: MouthStep[]; durationMs: number; expression: ExpressionId } {
  return { steps, durationMs, expression };
}

const OPEN_THEN_CLOSED: MouthStep[] = [
  { tMs: 0, level: 'open' },
  { tMs: 400, level: 'closed' },
  { tMs: 800, level: 'mid' },
];

describe('Animator en reposo', () => {
  it('muestra neutral y parpadea a los 3000 ms con rng 0', () => {
    const a = new Animator({ rng: zero });
    expect(a.frame(0)).toBe('neutral');
    expect(a.frame(2999)).toBe('neutral');
    expect(a.frame(3000)).toBe('blink');
    expect(a.frame(3149)).toBe('blink');
    expect(a.frame(3150)).toBe('neutral');
    expect(a.frame(3200)).toBe('neutral');
  });

  it('con rng 1 el intervalo es de 6000 ms', () => {
    const a = new Animator({ rng: one });
    expect(a.frame(5999)).toBe('neutral');
    expect(a.frame(6000)).toBe('blink');
    expect(a.frame(6150)).toBe('neutral');
  });

  it('agenda el siguiente parpadeo con el rng desde el inicio del anterior', () => {
    const a = new Animator({ rng: zero });
    expect(a.frame(3000)).toBe('blink');
    expect(a.frame(5999)).toBe('neutral');
    expect(a.frame(6000)).toBe('blink');
  });

  it('con un salto grande de tiempo alcanza la agenda en vez de devolver un parpadeo viejo', () => {
    const a = new Animator({ rng: zero });
    expect(a.frame(0)).toBe('neutral');
    expect(a.frame(10_000)).toBe('neutral'); // parpadeos en 3000, 6000, 9000; el próximo es 12000
    expect(a.frame(12_000)).toBe('blink');
  });

  it('un salto que cae dentro de un parpadeo futuro lo muestra', () => {
    const a = new Animator({ rng: zero });
    expect(a.frame(9100)).toBe('blink');
  });

  it('un now menor al último se trata como igual al último', () => {
    const a = new Animator({ rng: zero });
    expect(a.frame(3000)).toBe('blink');
    expect(a.frame(0)).toBe('blink');
    expect(a.frame(3200)).toBe('neutral');
    expect(a.frame(100)).toBe('neutral');
  });

  it('idle reinicia la agenda desde ese momento', () => {
    const a = new Animator({ rng: zero });
    a.idle(2000);
    expect(a.frame(4999)).toBe('neutral');
    expect(a.frame(5000)).toBe('blink');
  });
});

describe('Animator pensando', () => {
  it('parpadea antes de 3000 ms (cada 1500 a 2500 ms)', () => {
    const a = new Animator({ rng: zero });
    a.thinking(0);
    expect(a.frame(1499)).toBe('neutral');
    expect(a.frame(1500)).toBe('blink');
    expect(a.frame(1650)).toBe('neutral');
    expect(a.frame(3000)).toBe('blink');
  });

  it('con rng 1 el intervalo es de 2500 ms', () => {
    const a = new Animator({ rng: one });
    a.thinking(1000);
    expect(a.frame(3499)).toBe('neutral');
    expect(a.frame(3500)).toBe('blink');
  });

  it('idle vuelve al ritmo de reposo', () => {
    const a = new Animator({ rng: zero });
    a.thinking(0);
    a.idle(100);
    expect(a.frame(1600)).toBe('neutral');
    expect(a.frame(3100)).toBe('blink');
  });
});

describe('Animator hablando', () => {
  it('muestra la expresión durante los primeros 500 ms', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200));
    expect(a.frame(0)).toBe('smile');
    expect(a.frame(499)).toBe('smile');
  });

  it('usa la expresión indicada como cara', () => {
    for (const expression of ['neutral', 'smile', 'serious', 'surprised', 'sad'] as const) {
      const a = new Animator({ rng: zero });
      a.say(0, speech(OPEN_THEN_CLOSED, 1200, expression));
      expect(a.frame(0)).toBe(expression);
    }
  });

  it('sigue los pasos de boca desde los 500 ms', () => {
    const a = new Animator({ rng: zero });
    a.say(1000, speech(OPEN_THEN_CLOSED, 1200));
    expect(a.frame(1500)).toBe('mouth_open');
    expect(a.frame(1899)).toBe('mouth_open');
    expect(a.frame(1900)).toBe('neutral'); // paso closed
    expect(a.frame(2299)).toBe('neutral');
    expect(a.frame(2300)).toBe('mouth_mid');
    expect(a.frame(2699)).toBe('mouth_mid');
  });

  it('mantiene la expresión 3000 ms al terminar y luego vuelve a reposo', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200));
    expect(a.frame(1699)).toBe('mouth_mid');
    expect(a.frame(1700)).toBe('smile');
    expect(a.frame(4699)).toBe('smile');
    expect(a.frame(4700)).toBe('neutral');
  });

  it('no parpadea al hablar ni en la espera, aunque la agenda lo pidiera', () => {
    const a = new Animator({ rng: zero });
    a.say(2900, speech([{ tMs: 0, level: 'closed' }], 3000));
    // El reposo habría parpadeado a los 3000 ms.
    expect(a.frame(3000)).toBe('smile');
    expect(a.frame(3500)).toBe('neutral'); // boca cerrada, no parpadeo
    expect(a.frame(6400)).toBe('smile');
  });

  it('tras la espera reagenda los parpadeos desde ese momento', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200)); // fin de la espera: 4700
    expect(a.frame(7699)).toBe('neutral');
    expect(a.frame(7700)).toBe('blink');
  });

  it('alcanza la agenda desde el fin de la espera aunque frame llegue mucho después', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200)); // reposo desde 4700: parpadeos en 7700, 10700
    expect(a.frame(10_000)).toBe('neutral');
    expect(a.frame(10_700)).toBe('blink');
  });

  it('con steps vacíos la boca queda neutral durante la duración', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([], 1000));
    expect(a.frame(0)).toBe('smile');
    expect(a.frame(500)).toBe('neutral');
    expect(a.frame(1499)).toBe('neutral');
    expect(a.frame(1500)).toBe('smile');
  });

  it('con duración 0 pasa del avance de 500 ms directo a la espera', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 'open' }], 0));
    expect(a.frame(499)).toBe('smile');
    expect(a.frame(500)).toBe('smile');
    expect(a.frame(3499)).toBe('smile');
    expect(a.frame(3500)).toBe('neutral');
  });

  it('con duración negativa se comporta como 0', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 'open' }], -200));
    expect(a.frame(500)).toBe('smile');
    expect(a.frame(3500)).toBe('neutral');
  });

  it('un say en pleno say reemplaza al anterior con un nuevo avance de 500 ms', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 'open' }], 5000, 'smile'));
    expect(a.frame(1000)).toBe('mouth_open');
    a.say(1000, speech([{ tMs: 0, level: 'mid' }], 1000, 'sad'));
    expect(a.frame(1000)).toBe('sad');
    expect(a.frame(1499)).toBe('sad');
    expect(a.frame(1500)).toBe('mouth_mid');
    expect(a.frame(2500)).toBe('sad'); // espera del segundo
    expect(a.frame(5500)).toBe('neutral');
  });

  it('thinking durante el habla se ignora', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 'open' }], 2000));
    a.thinking(1000);
    expect(a.frame(1000)).toBe('mouth_open');
    expect(a.frame(2499)).toBe('mouth_open');
    expect(a.frame(2500)).toBe('smile');
  });

  it('thinking durante la espera posterior pasa a pensando', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 'open' }], 1000)); // habla hasta 1500, espera hasta 4500
    a.thinking(2000);
    expect(a.frame(2000)).toBe('neutral');
    expect(a.frame(3499)).toBe('neutral');
    expect(a.frame(3500)).toBe('blink'); // 2000 + 1500
  });

  it('idle durante el habla vuelve a reposo de inmediato', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 'open' }], 5000));
    a.idle(1000);
    expect(a.frame(1000)).toBe('neutral');
    expect(a.frame(3999)).toBe('neutral');
    expect(a.frame(4000)).toBe('blink');
  });

  it('un now menor al último no retrocede el habla', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200));
    expect(a.frame(700)).toBe('mouth_open');
    expect(a.frame(100)).toBe('mouth_open'); // habría sido la expresión
  });
});
