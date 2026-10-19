import { describe, expect, it } from 'vitest';
import { MOUTH_MIN_HOLD_MS, mouthTimeline, syntheticMouthTimeline } from '../src/index.js';
import type { MouthLevel, MouthStep } from '../src/index.js';

const RATE = 24000;

function sine(ms: number, amplitude: number, freq = 220): Float32Array {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}

/** Nivel continuo (RMS exacto = |valor|) durante `ms` milisegundos. */
function dc(ms: number, value: number, rate = RATE): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * rate)).fill(value);
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

/** Senoidal cuya amplitud sube en línea recta de 0 a `peak` y vuelve a 0 (`ms` cada tramo). */
function triangle(ms: number, peak: number): Float32Array {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) {
    const env = i < n ? i / n : (2 * n - i) / n;
    out[i] = peak * env * Math.sin((2 * Math.PI * 220 * i) / RATE);
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

function expectWellFormed(steps: MouthStep[]): void {
  expect(steps[0]!.tMs).toBe(0);
  for (const s of steps) expect([0, 1, 2, 3, 4]).toContain(s.level);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i]!.tMs).toBeGreaterThan(steps[i - 1]!.tMs);
    expect(steps[i]!.level).not.toBe(steps[i - 1]!.level);
  }
}

/** Ningún paso salta más de un nivel respecto al anterior. */
function expectNoSkips(steps: MouthStep[]): void {
  for (let i = 1; i < steps.length; i++) {
    expect(Math.abs(steps[i]!.level - steps[i - 1]!.level)).toBe(1);
  }
}

describe('mouthTimeline', () => {
  it('una entrada vacía da un solo paso cerrado en 0', () => {
    expect(mouthTimeline(new Float32Array(0), RATE)).toEqual([{ tMs: 0, level: 0 }]);
  });

  it('el silencio digital es todo nivel 0', () => {
    expect(mouthTimeline(new Float32Array(RATE), RATE)).toEqual([{ tMs: 0, level: 0 }]);
  });

  it('el ruido por debajo del piso absoluto (0.005) es todo nivel 0', () => {
    expect(mouthTimeline(sine(1000, 0.001), RATE)).toEqual([{ tMs: 0, level: 0 }]);
  });

  it('la normalización es relativa al clip: una senoidal constante y suave abre del todo', () => {
    const steps = mouthTimeline(sine(1000, 0.05), RATE);
    expectWellFormed(steps);
    expect(steps.at(-1)!.level).toBe(4);
  });

  it('al abrir de golpe recorre los niveles intermedios (ataque de unos 25 ms, un nivel por ventana)', () => {
    const steps = mouthTimeline(concat(dc(200, 0), dc(400, 0.5)), RATE);
    expectWellFormed(steps);
    expectNoSkips(steps);
    expect(levels(steps)).toEqual([0, 1, 2, 3, 4]);
    // Empieza a abrir en cuanto llega el sonido y llega a 4 en menos de 100 ms.
    expect(steps[1]!.tMs).toBe(200);
    expect(steps[4]!.tMs).toBeLessThanOrEqual(300);
  });

  it('al callar cierra más despacio que al abrir (liberación de unos 90 ms)', () => {
    const steps = mouthTimeline(concat(dc(100, 0), dc(400, 0.5), dc(600, 0)), RATE);
    expectWellFormed(steps);
    expectNoSkips(steps);
    expect(levels(steps)).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0]);
    const opening = steps[4]!.tMs - steps[1]!.tMs;
    const closing = steps[8]!.tMs - 500;
    expect(closing).toBeGreaterThan(opening);
    // Y termina de cerrar antes de 300 ms de silencio.
    expect(closing).toBeLessThan(300);
  });

  it('una rampa suave de subida y bajada sube los niveles de a uno y luego los baja de a uno', () => {
    const steps = mouthTimeline(triangle(600, 0.6), RATE);
    expectWellFormed(steps);
    expectNoSkips(steps);
    const seq = levels(steps);
    const top = seq.indexOf(4);
    expect(top).toBeGreaterThan(0);
    expect(seq.slice(0, top + 1)).toEqual([0, 1, 2, 3, 4]);
    for (let i = top + 1; i < seq.length; i++) expect(seq[i]).toBe(seq[i - 1]! - 1);
    expect(seq.at(-1)).toBeLessThanOrEqual(1);
  });

  it('un clic aislado de 20 ms no abre la boca más allá del nivel 1', () => {
    const steps = mouthTimeline(concat(dc(300, 0), dc(20, 0.8), dc(500, 0)), RATE);
    expectWellFormed(steps);
    expect(Math.max(...levels(steps))).toBe(1);
    expect(steps.at(-1)!.level).toBe(0);
  });

  it('un clic en medio de una voz normal tampoco pasa del nivel 1', () => {
    const voice = sine(600, 0.3);
    const steps = mouthTimeline(concat(voice, dc(500, 0), dc(20, 0.3), dc(500, 0)), RATE);
    const afterVoice = steps.filter((s) => s.tMs >= 900);
    expect(afterVoice.length).toBeGreaterThan(0);
    expect(Math.max(...levels(afterVoice))).toBeLessThanOrEqual(1);
  });

  it('no parpadea con cambios mínimos de volumen (histéresis)', () => {
    // Volumen que oscila ±4 % alrededor de un valor medio: la boca se queda quieta tras abrir.
    const parts: Float32Array[] = [dc(300, 0.5)];
    for (let i = 0; i < 40; i++) parts.push(dc(20, i % 2 === 0 ? 0.34 : 0.31));
    const steps = mouthTimeline(concat(...parts), RATE);
    const late = steps.filter((s) => s.tMs > 600);
    expect(late.length).toBeLessThanOrEqual(1);
  });

  it(`al cambiar de dirección cada nivel se mantiene al menos ${MOUTH_MIN_HOLD_MS} ms`, () => {
    // Ventanas fuertes y débiles alternadas cada 20 ms: sin el mínimo, la boca temblaría.
    const parts: Float32Array[] = [];
    for (let i = 0; i < 60; i++) parts.push(dc(20, i % 2 === 0 ? 1 : 0.01));
    for (let i = 0; i < 20; i++) parts.push(dc(40, i % 2 === 0 ? 1 : 0));
    parts.push(dc(300, 0));
    const samples = concat(...parts);
    const totalMs = (samples.length / RATE) * 1000;
    const steps = mouthTimeline(samples, RATE);
    expectWellFormed(steps);
    const lengths = runLengths(steps, totalMs);
    for (let i = 1; i < steps.length - 1; i++) {
      const before = steps[i - 1]!.level;
      const after = steps[i + 1]!.level;
      const isTurn = Math.sign(steps[i]!.level - before) !== Math.sign(after - steps[i]!.level);
      if (isTurn) expect(lengths[i]).toBeGreaterThanOrEqual(MOUTH_MIN_HOLD_MS);
    }
  });

  it('es determinista', () => {
    const samples = concat(sine(500, 0.7), sine(300, 0.2), sine(400, 0.05), triangle(300, 0.4));
    expect(mouthTimeline(samples, RATE)).toEqual(mouthTimeline(samples, RATE));
  });

  it('usa ventanas de 20 ms sea cual sea la frecuencia de muestreo', () => {
    const a = mouthTimeline(concat(dc(200, 0, 16000), dc(300, 0.5, 16000), dc(400, 0, 16000)), 16000);
    const b = mouthTimeline(concat(dc(200, 0), dc(300, 0.5), dc(400, 0)), RATE);
    expect(a).toEqual(b);
    expect(a[1]).toEqual({ tMs: 200, level: 1 });
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

  it('empieza en 0 en tMs 0 y termina en 0', () => {
    const { steps } = syntheticMouthTimeline(TEXT_60);
    expect(steps[0]).toEqual({ tMs: 0, level: 0 });
    expect(steps.at(-1)!.level).toBe(0);
  });

  it('la duración es max(1200, 55 por carácter)', () => {
    expect(syntheticMouthTimeline(TEXT_60).durationMs).toBe(3300);
    expect(syntheticMouthTimeline('Hola').durationMs).toBe(1200);
    expect(syntheticMouthTimeline('a'.repeat(100)).durationMs).toBe(5500);
  });

  it('abre y cierra en arcos: pasa por los niveles intermedios y nunca salta de 0 a 4', () => {
    for (const text of [TEXT_60, 'Hola', 'aeiou aeiou aeiou', 'a e i o u a e i o u', 'Murciélago, ¿ví...?', 'Sí. No. Tal vez.']) {
      const { steps } = syntheticMouthTimeline(text);
      expectWellFormed(steps);
      expectNoSkips(steps);
    }
  });

  it('un texto de 60 caracteres usa los cinco niveles y picos variados', () => {
    const { steps } = syntheticMouthTimeline(TEXT_60);
    expect(new Set(levels(steps))).toEqual(new Set([0, 1, 2, 3, 4]));
    const peaks = steps.filter(
      (s, i) => i > 0 && i < steps.length - 1 && s.level > steps[i - 1]!.level && s.level > steps[i + 1]!.level,
    );
    expect(new Set(peaks.map((p) => p.level)).size).toBeGreaterThanOrEqual(2);
  });

  it('la puntuación cierra la boca más tiempo que un simple espacio', () => {
    /** La racha interior más larga con la boca cerrada. */
    const longestClosure = (text: string): number => {
      const { steps, durationMs } = syntheticMouthTimeline(text);
      const lengths = runLengths(steps, durationMs);
      let best = 0;
      for (let i = 1; i < steps.length - 1; i++) if (steps[i]!.level === 0) best = Math.max(best, lengths[i]!);
      return best;
    };
    const withComma = longestClosure('Mañana temprano, revisamos todo otra vez');
    const without = longestClosure('Mañana temprano revisamos todo otra vez.');
    expect(withComma).toBeGreaterThanOrEqual(120);
    expect(withComma).toBeGreaterThan(without);
  });

  it('cada palabra cierra la boca un momento antes de la siguiente', () => {
    const { steps } = syntheticMouthTimeline('casa mesa luna sola');
    const interiorZeros = steps.slice(1, -1).filter((s) => s.level === 0);
    expect(interiorZeros.length).toBeGreaterThanOrEqual(3);
  });

  it('el texto vacío da 1200 ms y solo nivel 0', () => {
    const { steps, durationMs } = syntheticMouthTimeline('');
    expect(durationMs).toBe(1200);
    expect(steps).toEqual([{ tMs: 0, level: 0 }]);
  });

  it('un texto sin letras (solo espacios o signos) tampoco mueve la boca', () => {
    expect(syntheticMouthTimeline('   ').steps).toEqual([{ tMs: 0, level: 0 }]);
    expect(syntheticMouthTimeline('... ¿?').steps).toEqual([{ tMs: 0, level: 0 }]);
  });

  it('todos los pasos caen dentro de la duración', () => {
    for (const text of [TEXT_60, 'Hola', 'x'.repeat(30), 'Murciélago, ¿ví...?']) {
      const { steps, durationMs } = syntheticMouthTimeline(text);
      for (const s of steps) {
        expect(s.tMs).toBeGreaterThanOrEqual(0);
        expect(s.tMs).toBeLessThan(durationMs);
      }
    }
  });

  it('un texto largo mueve la boca durante toda la duración', () => {
    const text = 'La rápida zorra marrón salta sobre el perro perezoso mientras el sol se pone. '.repeat(4);
    const { steps, durationMs } = syntheticMouthTimeline(text);
    expect(steps.at(-1)!.level).toBe(0);
    const lastOpen = [...steps].reverse().find((s) => s.level !== 0)!;
    expect(lastOpen.tMs).toBeGreaterThan(durationMs * 0.8);
  });

  it('un texto sin vocales igual mueve la boca', () => {
    const { steps } = syntheticMouthTimeline('rrr sss ttt');
    expect(steps.some((s) => s.level > 0)).toBe(true);
  });
});
