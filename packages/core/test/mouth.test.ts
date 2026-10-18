import { describe, expect, it } from 'vitest';
import { mouthTimeline, syntheticMouthTimeline } from '../src/index.js';
import type { MouthLevel, MouthStep } from '../src/index.js';

const RATE = 24000;
const WINDOW = RATE * 0.05; // 1200 muestras = 50 ms

function sine(ms: number, amplitude: number, freq = 220): Float32Array {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}

/** Nivel continuo (RMS exacto = |valor|) durante `ms` milisegundos. */
function dc(ms: number, value: number): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * RATE)).fill(value);
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function levels(steps: MouthStep[]): MouthLevel[] {
  return steps.map((s) => s.level);
}

/** Duraciones de cada racha; la última se calcula contra `totalMs`. */
function runLengths(steps: MouthStep[], totalMs: number): number[] {
  return steps.map((s, i) => (i + 1 < steps.length ? steps[i + 1]!.tMs : totalMs) - s.tMs);
}

describe('mouthTimeline', () => {
  it('una entrada vacía da un solo paso closed en 0', () => {
    expect(mouthTimeline(new Float32Array(0), RATE)).toEqual([{ tMs: 0, level: 'closed' }]);
  });

  it('el silencio digital es todo closed', () => {
    expect(mouthTimeline(new Float32Array(RATE), RATE)).toEqual([{ tMs: 0, level: 'closed' }]);
  });

  it('el ruido por debajo del piso absoluto (0.005) es todo closed', () => {
    const steps = mouthTimeline(sine(1000, 0.001), RATE);
    expect(steps).toEqual([{ tMs: 0, level: 'closed' }]);
  });

  it('una senoidal fuerte contiene open', () => {
    const steps = mouthTimeline(sine(1000, 0.8), RATE);
    expect(levels(steps)).toContain('open');
  });

  it('los umbrales son relativos al pico: una senoidal constante y suave también abre', () => {
    const steps = mouthTimeline(sine(1000, 0.05), RATE);
    expect(steps).toEqual([{ tMs: 0, level: 'open' }]);
  });

  it('aplica los umbrales 15 % y 50 % del pico (límite inferior inclusivo)', () => {
    const samples = concat(dc(200, 1), dc(200, 0.14), dc(200, 0.3), dc(200, 0.5), dc(200, 0.15));
    expect(mouthTimeline(samples, RATE)).toEqual([
      { tMs: 0, level: 'open' },
      { tMs: 200, level: 'closed' },
      { tMs: 400, level: 'mid' },
      { tMs: 600, level: 'open' },
      { tMs: 800, level: 'mid' },
    ]);
  });

  it('una rampa de amplitud aparece en el orden closed, mid, open', () => {
    const n = RATE * 2;
    const ramp = new Float32Array(n);
    for (let i = 0; i < n; i++) ramp[i] = (i / n) * Math.sin((2 * Math.PI * 220 * i) / RATE);
    const steps = mouthTimeline(ramp, RATE);
    const firstSeen: MouthLevel[] = [];
    for (const l of levels(steps)) if (!firstSeen.includes(l)) firstSeen.push(l);
    expect(firstSeen).toEqual(['closed', 'mid', 'open']);
    expect(steps[0]).toEqual({ tMs: 0, level: 'closed' });
  });

  it('el primer paso siempre está en tMs 0 y los tMs crecen estrictamente', () => {
    const samples = concat(dc(300, 0), dc(300, 1), dc(300, 0.3), dc(300, 0));
    const steps = mouthTimeline(samples, RATE);
    expect(steps[0]!.tMs).toBe(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.tMs).toBeGreaterThan(steps[i - 1]!.tMs);
  });

  it('no repite el mismo nivel en pasos consecutivos', () => {
    const samples = concat(dc(300, 1), dc(300, 0.9), dc(300, 0.1), dc(300, 0.05));
    const steps = mouthTimeline(samples, RATE);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.level).not.toBe(steps[i - 1]!.level);
  });

  it('ninguna racha dura menos de 80 ms salvo la última', () => {
    // Una ventana (50 ms) fuerte y otra débil, alternadas: sin la regla serían rachas de 50 ms.
    const parts: Float32Array[] = [];
    for (let i = 0; i < 40; i++) parts.push(dc(50, i % 2 === 0 ? 1 : 0.01));
    // Y una cola con un parpadeo más largo para que haya cambios reales.
    parts.push(dc(400, 0.01), dc(150, 1));
    const samples = concat(...parts);
    const totalMs = (samples.length / RATE) * 1000;
    const steps = mouthTimeline(samples, RATE);
    const lengths = runLengths(steps, totalMs);
    for (const len of lengths.slice(0, -1)) expect(len).toBeGreaterThanOrEqual(80);
  });

  it('una ventana corta intermedia se fusiona con el nivel previo', () => {
    // open 200 ms, un hueco de 50 ms, open 200 ms: el hueco se absorbe.
    const samples = concat(dc(200, 1), dc(50, 0), dc(200, 1));
    expect(mouthTimeline(samples, RATE)).toEqual([{ tMs: 0, level: 'open' }]);
  });

  it('una racha de 100 ms sí se conserva', () => {
    const samples = concat(dc(200, 1), dc(100, 0), dc(200, 1));
    expect(mouthTimeline(samples, RATE)).toEqual([
      { tMs: 0, level: 'open' },
      { tMs: 200, level: 'closed' },
      { tMs: 300, level: 'open' },
    ]);
  });

  it('la última racha está exenta del mínimo', () => {
    const samples = concat(dc(300, 1), dc(50, 0));
    expect(mouthTimeline(samples, RATE)).toEqual([
      { tMs: 0, level: 'open' },
      { tMs: 300, level: 'closed' },
    ]);
  });

  it('la primera racha no se fusiona hacia atrás aunque sea corta', () => {
    const samples = concat(dc(50, 1), dc(300, 0));
    const steps = mouthTimeline(samples, RATE);
    expect(steps[0]).toEqual({ tMs: 0, level: 'open' });
  });

  it('es determinista', () => {
    const samples = concat(sine(500, 0.7), sine(300, 0.2), sine(400, 0.05));
    expect(mouthTimeline(samples, RATE)).toEqual(mouthTimeline(samples, RATE));
  });

  it('usa ventanas de 50 ms sea cual sea la frecuencia de muestreo', () => {
    const rate = 16000;
    const loud = new Float32Array(rate / 5).fill(1); // 200 ms
    const quiet = new Float32Array(rate / 5).fill(0.01); // 200 ms
    const samples = new Float32Array(loud.length + quiet.length);
    samples.set(loud, 0);
    samples.set(quiet, loud.length);
    expect(mouthTimeline(samples, rate)).toEqual([
      { tMs: 0, level: 'open' },
      { tMs: 200, level: 'closed' },
    ]);
    expect(WINDOW).toBe(1200);
  });
});

describe('syntheticMouthTimeline', () => {
  const TEXT_60 = 'Hola, soy tu asistente y estoy lista para ayudarte hoy mismo';

  it('el texto de prueba tiene 60 caracteres', () => {
    expect(TEXT_60.length).toBe(60);
  });

  it('es determinista: mismo texto, misma salida', () => {
    expect(syntheticMouthTimeline(TEXT_60)).toEqual(syntheticMouthTimeline(TEXT_60));
  });

  it('textos distintos suelen dar movimientos distintos', () => {
    const a = syntheticMouthTimeline(TEXT_60);
    const b = syntheticMouthTimeline('Buenos días, ¿cómo estás? Espero que todo vaya muy bien contigo.');
    expect(a.steps).not.toEqual(b.steps);
  });

  it('un texto de 60 caracteres contiene mid y open', () => {
    const { steps } = syntheticMouthTimeline(TEXT_60);
    expect(levels(steps)).toContain('mid');
    expect(levels(steps)).toContain('open');
  });

  it('empieza en closed en tMs 0 y termina en closed', () => {
    const { steps } = syntheticMouthTimeline(TEXT_60);
    expect(steps[0]).toEqual({ tMs: 0, level: 'closed' });
    expect(steps.at(-1)!.level).toBe('closed');
  });

  it('la duración es max(1200, 55 por carácter)', () => {
    expect(syntheticMouthTimeline(TEXT_60).durationMs).toBe(3300);
    expect(syntheticMouthTimeline('Hola').durationMs).toBe(1200);
    expect(syntheticMouthTimeline('a'.repeat(100)).durationMs).toBe(5500);
  });

  it('el texto vacío da 1200 ms y solo closed', () => {
    const { steps, durationMs } = syntheticMouthTimeline('');
    expect(durationMs).toBe(1200);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.level === 'closed')).toBe(true);
  });

  it('un texto sin letras (solo espacios) tampoco mueve la boca', () => {
    const { steps } = syntheticMouthTimeline('   ');
    expect(steps.every((s) => s.level === 'closed')).toBe(true);
  });

  it('ningún nivel dura menos de 80 ms y todos caen dentro de la duración', () => {
    for (const text of [TEXT_60, 'Hola', 'aeiou aeiou aeiou', 'a e i o u a e i o u', 'x'.repeat(30), 'Murciélago, ¿ví...?']) {
      const { steps, durationMs } = syntheticMouthTimeline(text);
      const lengths = runLengths(steps, durationMs);
      for (const len of lengths) expect(len).toBeGreaterThanOrEqual(80);
      for (const s of steps) {
        expect(s.tMs).toBeGreaterThanOrEqual(0);
        expect(s.tMs).toBeLessThan(durationMs);
      }
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]!.tMs).toBeGreaterThan(steps[i - 1]!.tMs);
        expect(steps[i]!.level).not.toBe(steps[i - 1]!.level);
      }
    }
  });

  it('un texto largo mueve la boca durante toda la duración', () => {
    const text = 'La rápida zorra marrón salta sobre el perro perezoso mientras el sol se pone. '.repeat(4);
    const { steps, durationMs } = syntheticMouthTimeline(text);
    expect(steps.at(-1)!.level).toBe('closed');
    const lastOpen = [...steps].reverse().find((s) => s.level !== 'closed')!;
    expect(lastOpen.tMs).toBeGreaterThan(durationMs * 0.8);
  });

  it('un texto sin vocales igual mueve la boca', () => {
    const { steps } = syntheticMouthTimeline('rrr sss ttt');
    expect(steps.some((s) => s.level !== 'closed')).toBe(true);
  });
});
