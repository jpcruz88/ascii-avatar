import { describe, expect, it } from 'vitest';
import { Animator, CLIP_FPS, MOUTH_ANTICIPATION_MS } from '../src/index.js';
import type { ExpressionId, Motion, MouthStep } from '../src/index.js';

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
  { tMs: 0, level: 4 },
  { tMs: 400, level: 0 },
  { tMs: 800, level: 2 },
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

  it('sigue los pasos de boca desde los 500 ms, adelantados 60 ms al audio', () => {
    expect(MOUTH_ANTICIPATION_MS).toBe(60);
    const a = new Animator({ rng: zero });
    a.say(1000, speech(OPEN_THEN_CLOSED, 1200));
    expect(a.frame(1500)).toBe('mouth_open');
    expect(a.frame(1839)).toBe('mouth_open');
    expect(a.frame(1840)).toBe('neutral'); // paso de nivel 0 (400 ms - 60 ms)
    expect(a.frame(2239)).toBe('neutral');
    expect(a.frame(2240)).toBe('mouth_mid');
    expect(a.frame(2699)).toBe('mouth_mid');
  });

  it('cada nivel de apertura tiene su cuadro: 0 neutral, 1 mouth_q1, 2 mouth_mid, 3 mouth_q3, 4 mouth_open', () => {
    const steps: MouthStep[] = [0, 1, 2, 3, 4].map((level, i) => ({ tMs: 100 + i * 100, level: level as MouthStep['level'] }));
    const a = new Animator({ rng: zero });
    a.say(0, speech(steps, 1000));
    // Con el adelanto, el paso de tMs t se ve en 500 + t - 60.
    expect(a.frame(500)).toBe('neutral');
    expect(a.frame(545)).toBe('neutral');
    expect(a.frame(645)).toBe('mouth_q1');
    expect(a.frame(745)).toBe('mouth_mid');
    expect(a.frame(845)).toBe('mouth_q3');
    expect(a.frame(945)).toBe('mouth_open');
  });

  it('el adelanto no deja ver la boca antes de que termine el avance de la expresión', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 0 }, { tMs: 30, level: 1 }], 1000));
    expect(a.frame(499)).toBe('smile');
    expect(a.frame(500)).toBe('mouth_q1'); // el paso de 30 ms se adelanta y queda recortado en 0
  });

  it('el adelanto no alarga el habla: al terminar el audio vuelve la expresión', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 3 }], 1000));
    expect(a.frame(1499)).toBe('mouth_q3');
    expect(a.frame(1500)).toBe('smile');
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
    a.say(2900, speech([{ tMs: 0, level: 0 }], 3000));
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
    a.say(0, speech([{ tMs: 0, level: 4 }], 0));
    expect(a.frame(499)).toBe('smile');
    expect(a.frame(500)).toBe('smile');
    expect(a.frame(3499)).toBe('smile');
    expect(a.frame(3500)).toBe('neutral');
  });

  it('con duración negativa se comporta como 0', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 4 }], -200));
    expect(a.frame(500)).toBe('smile');
    expect(a.frame(3500)).toBe('neutral');
  });

  it('un say en pleno say reemplaza al anterior con un nuevo avance de 500 ms', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 4 }], 5000, 'smile'));
    expect(a.frame(1000)).toBe('mouth_open');
    a.say(1000, speech([{ tMs: 0, level: 2 }], 1000, 'sad'));
    expect(a.frame(1000)).toBe('sad');
    expect(a.frame(1499)).toBe('sad');
    expect(a.frame(1500)).toBe('mouth_mid');
    expect(a.frame(2500)).toBe('sad'); // espera del segundo
    expect(a.frame(5500)).toBe('neutral');
  });

  it('thinking durante el habla se ignora', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 4 }], 2000));
    a.thinking(1000);
    expect(a.frame(1000)).toBe('mouth_open');
    expect(a.frame(2499)).toBe('mouth_open');
    expect(a.frame(2500)).toBe('smile');
  });

  it('thinking durante la espera posterior pasa a pensando', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 4 }], 1000)); // habla hasta 1500, espera hasta 4500
    a.thinking(2000);
    expect(a.frame(2000)).toBe('neutral');
    expect(a.frame(3499)).toBe('neutral');
    expect(a.frame(3500)).toBe('blink'); // 2000 + 1500
  });

  it('idle durante el habla vuelve a reposo de inmediato', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech([{ tMs: 0, level: 4 }], 5000));
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

describe('Animator.speaking', () => {
  it('es verdadero desde say hasta que termina el audio, y falso en la espera y en reposo', () => {
    const a = new Animator({ rng: zero });
    expect(a.speaking(0)).toBe(false);
    a.say(1000, speech(OPEN_THEN_CLOSED, 1200)); // habla de 1000 a 2700
    expect(a.speaking(1000)).toBe(true);
    expect(a.speaking(2699)).toBe(true);
    expect(a.speaking(2700)).toBe(false);
    expect(a.speaking(9000)).toBe(false);
  });

  it('idle corta el habla', () => {
    const a = new Animator({ rng: zero });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200));
    a.idle(100);
    expect(a.speaking(100)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Lenguaje corporal con poses y clips
// ---------------------------------------------------------------------------------------------

/** Rng que devuelve los valores dados en orden y luego repite el último. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

/** Rng determinista con semilla (LCG) para simulaciones largas. */
function lcg(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const NONE: Motion = { poses: [], clips: {} };
const FRAME = 1000 / CLIP_FPS;

/** Instante a mitad del cuadro `i` de un clip que empieza en `start`. */
const mid = (start: number, i: number): number => start + (i + 0.5) * FRAME;

describe('Animator sin poses ni clips', () => {
  it('se comporta igual que hoy: mismos cuadros y nunca pide el ritmo rápido en reposo', () => {
    const plain = new Animator({ rng: lcg() });
    const empty = new Animator({ rng: lcg(), motion: NONE });
    for (let t = 0; t < 60_000; t += 10) {
      if (t === 20_000) {
        plain.say(t, speech(OPEN_THEN_CLOSED, 1200));
        empty.say(t, speech(OPEN_THEN_CLOSED, 1200));
      }
      if (t === 40_000) {
        plain.thinking(t);
        empty.thinking(t);
      }
      expect(empty.frame(t)).toBe(plain.frame(t));
      if (t < 20_000 || t > 30_000) expect(empty.fastFrames(t)).toBe(false);
    }
  });
});

describe('Animator en reposo con gestos', () => {
  it('cada 4 a 9 s mira a un lado con una pose que sostiene de 0,8 a 1,5 s (rng 0)', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left'], clips: {} } });
    expect(a.frame(3999)).toBe('neutral');
    expect(a.frame(4000)).toBe('pose:look_left');
    expect(a.frame(4799)).toBe('pose:look_left');
    expect(a.frame(4800)).toBe('neutral');
    // El siguiente gesto se agenda desde el fin del anterior.
    expect(a.frame(8799)).toBe('neutral');
    expect(a.frame(8800)).toBe('pose:look_left');
  });

  it('con rng 1 el gesto llega a los 9 s y la pose dura 1,5 s', () => {
    const a = new Animator({ rng: one, motion: { poses: ['look_right'], clips: {} } });
    expect(a.frame(8999)).toBe('neutral');
    expect(a.frame(9000)).toBe('pose:look_right');
    expect(a.frame(10_499)).toBe('pose:look_right');
    expect(a.frame(10_500)).toBe('neutral');
  });

  it('un clip se reproduce a 24 cuadros por segundo y vuelve a neutral', () => {
    expect(CLIP_FPS).toBe(24);
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { tilt_left: 12 } } });
    expect(a.frame(mid(4000, 0))).toBe('clip:tilt_left:0');
    expect(a.frame(mid(4000, 5))).toBe('clip:tilt_left:5');
    expect(a.frame(mid(4000, 11))).toBe('clip:tilt_left:11');
    expect(a.frame(4000 + 12 * FRAME)).toBe('neutral');
  });

  it('nunca repite el mismo gesto dos veces seguidas', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left', 'look_right'], clips: {} } });
    // rng 0 elige siempre el primer candidato; el anterior queda fuera.
    expect(a.frame(4000)).toBe('pose:look_left');
    expect(a.frame(8800)).toBe('pose:look_right');
    expect(a.frame(13_600)).toBe('pose:look_left');
  });

  it('elige con pesos: miradas y ladeos a menudo, asentir rara vez, nunca dos iguales seguidos', () => {
    const motion: Motion = {
      poses: ['look_left', 'look_right', 'turn_left', 'turn_right', 'tilt_left', 'tilt_right', 'nod_up', 'nod_down'],
      clips: { nod: 16, tilt_left: 16, tilt_right: 16, turn_left: 16, turn_right: 16, think: 16 },
    };
    const a = new Animator({ rng: lcg(3), motion });
    const gestures: string[] = [];
    const resting = (x: string): boolean => x === 'neutral' || x === 'blink';
    let prev = 'neutral';
    for (let t = 0; t < 3_600_000; t += 20) {
      const f = a.frame(t);
      if (resting(prev) && !resting(f)) gestures.push(f.replace(/:\d+$/, ''));
      prev = f;
    }
    expect(gestures.length).toBeGreaterThan(400); // ~1 cada 6,5 s más su duración
    for (let i = 1; i < gestures.length; i++) expect(gestures[i]).not.toBe(gestures[i - 1]);
    const share = (re: RegExp): number => gestures.filter((g) => re.test(g)).length / gestures.length;
    expect(share(/look_|turn_/)).toBeGreaterThan(0.35);
    expect(share(/tilt_/)).toBeGreaterThan(0.25);
    expect(share(/clip:nod/)).toBeGreaterThan(0);
    expect(share(/clip:nod/)).toBeLessThan(0.2);
    // El clip de pensar no es un gesto de reposo.
    expect(share(/think/)).toBe(0);
  });

  it('sin el clip de un ladeo usa la pose del ladeo', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['tilt_right'], clips: {} } });
    expect(a.frame(4000)).toBe('pose:tilt_right');
    expect(a.frame(4800)).toBe('neutral');
  });

  it('no parpadea durante un clip: el parpadeo espera a que termine', () => {
    // Clip de 5 s (120 cuadros) de 4000 a 9000; el parpadeo de 6150 se corre a 9000.
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { tilt_left: 120 } } });
    expect(a.frame(3000)).toBe('blink');
    expect(a.frame(6200)).toMatch(/^clip:tilt_left:/);
    expect(a.frame(8999)).toBe('clip:tilt_left:119');
    expect(a.frame(9000)).toBe('blink');
    expect(a.frame(9149)).toBe('blink');
    expect(a.frame(9150)).toBe('neutral');
  });

  it('da lo mismo aunque frame llegue mucho después (se pone al día)', () => {
    const motion: Motion = { poses: ['look_left', 'look_right'], clips: { tilt_left: 120, nod: 10 } };
    const fine = new Animator({ rng: lcg(11), motion });
    const coarse = new Animator({ rng: lcg(11), motion });
    const seen: [number, string][] = [];
    for (let t = 0; t < 120_000; t += 5) {
      const f = fine.frame(t);
      if (t % 7915 === 0) seen.push([t, f]);
    }
    for (const [t, f] of seen) expect(coarse.frame(t)).toBe(f);
  });

  it('si al empezar un gesto hay un parpadeo en curso, el gesto espera a que termine', () => {
    // Parpadeo en 3950 (dura hasta 4100); el gesto tocaba en 4000.
    const a = new Animator({ rng: seq((3950 - 3000) / 3000, 0), motion: { poses: ['look_left'], clips: {} } });
    expect(a.frame(4050)).toBe('blink');
    expect(a.frame(4099)).toBe('blink');
    expect(a.frame(4100)).toBe('pose:look_left');
    expect(a.frame(4899)).toBe('pose:look_left');
    expect(a.frame(4900)).toBe('neutral');
  });
});

describe('Animator.fastFrames', () => {
  it('pide 24 fps mientras se ve un clip y justo antes de que empiece, no durante una pose', () => {
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { tilt_left: 12 } } });
    expect(a.fastFrames(1000)).toBe(false);
    expect(a.fastFrames(3899)).toBe(false);
    expect(a.fastFrames(3900)).toBe(true); // empieza en 4000: ya sube el ritmo
    expect(a.fastFrames(4100)).toBe(true);
    expect(a.fastFrames(4000 + 12 * FRAME)).toBe(false);
    const p = new Animator({ rng: zero, motion: { poses: ['look_left'], clips: {} } });
    expect(p.fastFrames(4100)).toBe(false);
  });

  it('pide 24 fps al hablar', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left'], clips: { tilt_left: 12 } } });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200));
    expect(a.fastFrames(100)).toBe(true);
    expect(a.fastFrames(1800)).toBe(false); // espera posterior
  });
});

describe('Animator pensando con gestos', () => {
  it('reproduce el clip de pensar, sostiene una pose suave y repite despacio', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left'], clips: { think: 24 } } });
    a.thinking(0);
    expect(a.frame(mid(0, 0))).toBe('clip:think:0');
    expect(a.frame(mid(0, 23))).toBe('clip:think:23');
    expect(a.frame(1000)).toBe('pose:look_left');
    expect(a.frame(2499)).toBe('pose:look_left');
    // El parpadeo de 1500 esperó al fin del gesto.
    expect(a.frame(2500)).toBe('blink');
    expect(a.frame(2650)).toBe('neutral');
    // Pausa de 2 a 4 s (rng 0: 2 s) y otra vez.
    expect(a.frame(4499)).toBe('neutral');
    expect(a.frame(mid(4500, 0))).toBe('clip:think:0');
  });

  it('sin clip de pensar, solo la pose suave', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['turn_right'], clips: {} } });
    a.thinking(100);
    expect(a.frame(100)).toBe('pose:turn_right');
    expect(a.frame(1599)).toBe('pose:turn_right');
    expect(a.frame(1600)).toBe('blink');
  });

  it('idle vuelve a los gestos de reposo', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left'], clips: { think: 24 } } });
    a.thinking(0);
    a.idle(100);
    expect(a.frame(100)).toBe('neutral');
    expect(a.frame(4100)).toBe('pose:look_left');
  });
});

describe('Animator hablando con gestos', () => {
  /** Pausa de 400 ms entre 300 y 700 (audio) y un cierre final. */
  const PHRASES: MouthStep[] = [
    { tMs: 0, level: 3 },
    { tMs: 300, level: 0 },
    { tMs: 700, level: 2 },
    { tMs: 1000, level: 0 },
  ];

  it('en una pausa de 350 ms o más entre frases asiente con el clip entero si cabe', () => {
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { nod: 8 } } });
    a.say(0, speech(PHRASES, 1200));
    const start = 500 + 300 - MOUTH_ANTICIPATION_MS; // 740: la boca cierra
    expect(a.frame(start - 1)).toBe('mouth_q3');
    expect(a.frame(mid(start, 0))).toBe('clip:nod:0');
    expect(a.frame(mid(start, 7))).toBe('clip:nod:7');
    expect(a.frame(start + 8 * FRAME)).toBe('neutral'); // boca cerrada hasta la frase siguiente
    expect(a.frame(500 + 700 - MOUTH_ANTICIPATION_MS)).toBe('mouth_mid');
  });

  it('si el clip no cabe, hace un tramo corto de ida y vuelta que termina en neutral', () => {
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { nod: 24 } } });
    a.say(0, speech(PHRASES, 1200));
    const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => a.frame(mid(740, i)));
    expect(frames).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0].map((i) => `clip:nod:${i}`));
    expect(a.frame(740 + 9 * FRAME)).toBe('neutral');
  });

  it('una pausa de menos de 350 ms no lleva gesto', () => {
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { nod: 8 } } });
    const steps: MouthStep[] = [
      { tMs: 0, level: 3 },
      { tMs: 300, level: 0 },
      { tMs: 649, level: 2 },
      { tMs: 1000, level: 0 },
    ];
    a.say(0, speech(steps, 1200));
    for (let t = 500; t < 1700; t += 10) expect(a.frame(t)).not.toMatch(/^clip:/);
  });

  it('ni el silencio inicial ni el final llevan gesto', () => {
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { nod: 8 } } });
    const steps: MouthStep[] = [
      { tMs: 0, level: 0 },
      { tMs: 600, level: 3 },
      { tMs: 900, level: 0 },
    ];
    a.say(0, speech(steps, 2000));
    for (let t = 500; t < 2500; t += 10) expect(a.frame(t)).not.toMatch(/^clip:/);
  });

  it('a lo sumo un gesto cada ~3 s', () => {
    const a = new Animator({ rng: zero, motion: { poses: [], clips: { nod: 8 } } });
    // Pausas en 300, 1300 y 3700 (audio); la segunda está a 1 s de la primera.
    const steps: MouthStep[] = [
      { tMs: 0, level: 3 },
      { tMs: 300, level: 0 },
      { tMs: 700, level: 3 },
      { tMs: 1300, level: 0 },
      { tMs: 1700, level: 3 },
      { tMs: 3700, level: 0 },
      { tMs: 4100, level: 3 },
      { tMs: 4500, level: 0 },
    ];
    a.say(0, speech(steps, 4600));
    const at = (audioMs: number): string => a.frame(mid(500 + audioMs - MOUTH_ANTICIPATION_MS, 0));
    expect(at(300)).toBe('clip:nod:0');
    expect(at(1300)).toBe('neutral');
    expect(at(3700)).toBe('clip:nod:0');
  });

  it('sin clip de asentir usa un ladeo', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left'], clips: { tilt_right: 8 } } });
    a.say(0, speech(PHRASES, 1200));
    expect(a.frame(mid(740, 0))).toBe('clip:tilt_right:0');
  });

  it('las poses sueltas no se usan al hablar', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left', 'nod_down', 'tilt_left'], clips: {} } });
    a.say(0, speech(PHRASES, 1200));
    for (let t = 0; t < 4700; t += 10) expect(a.frame(t)).not.toMatch(/^(pose|clip):/);
  });

  it('tras la espera posterior vuelve a los gestos de reposo, agendados desde ese momento', () => {
    const a = new Animator({ rng: zero, motion: { poses: ['look_left'], clips: {} } });
    a.say(0, speech(OPEN_THEN_CLOSED, 1200)); // fin de la espera: 4700
    expect(a.frame(4700)).toBe('neutral');
    expect(a.frame(8699)).toBe('neutral');
    expect(a.frame(8700)).toBe('pose:look_left');
  });
});
