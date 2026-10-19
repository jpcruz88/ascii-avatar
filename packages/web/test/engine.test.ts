import { describe, expect, it } from 'vitest';
import {
  Animator,
  SPEECH_LEAD_IN_MS,
  mouthTimeline,
  parseWav,
  pickExpression,
  spokenSummary,
  syntheticMouthTimeline,
  type Motion,
} from '@ascii-avatar/core/browser';
import { AvatarEngine, audioStartDelayMs, type AudioOut, type EngineEvent, type Prepared } from '../src/engine.js';

/** Reloj y temporizadores falsos: el tiempo solo avanza con `advance`. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    schedule: (ms: number, fn: () => void) => {
      const id = ++seq;
      timers.set(id, { at: t + Math.max(0, ms), fn });
      return () => void timers.delete(id);
    },
    advance(ms: number): void {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
      }
      t = end;
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Rng determinista (mismo para el motor y el animador de referencia). */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const FRAME_IDS = ['neutral', 'mouth_q1', 'mouth_mid', 'mouth_q3', 'mouth_open', 'blink', 'smile', 'serious', 'surprised', 'sad'];
function frames(extra: string[] = []): Map<string, string> {
  return new Map([...FRAME_IDS, ...extra].map((id) => [id, `[${id}]`]));
}

/** WAV PCM de 16 bits, mono: una sílaba con sonido entre silencios. */
function wav(sampleRate = 24000, ms = 900): ArrayBuffer {
  const n = Math.round((sampleRate * ms) / 1000);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const tMs = (i / sampleRate) * 1000;
    const amp = tMs > 150 && tMs < 650 ? 14000 : 0;
    v.setInt16(44 + i * 2, Math.round(amp * Math.sin((2 * Math.PI * 220 * i) / sampleRate)), true);
  }
  return buf;
}

class FakeAudio implements AudioOut {
  readonly started: { delayMs: number; bytes: number }[] = [];
  stopped = 0;
  latency = 30;
  failPrepare = false;
  unlock(): void {}
  latencyMs(): number {
    return this.latency;
  }
  async prepare(data: ArrayBuffer): Promise<Prepared> {
    if (this.failPrepare) throw new Error('no se puede decodificar');
    const bytes = data.byteLength;
    return {
      start: (delayMs: number) => void this.started.push({ delayMs, bytes }),
      stop: () => void this.stopped++,
    };
  }
}

function setup(opts: { motion?: Motion; tts?: AvatarEngineTts; audio?: AudioOut | null; extra?: string[] } = {}) {
  const clock = fakeClock();
  const events: { type: EngineEvent; detail?: unknown }[] = [];
  const engine = new AvatarEngine({
    frames: frames(opts.extra),
    motion: opts.motion ?? { poses: [], clips: {} },
    now: clock.now,
    schedule: clock.schedule,
    rng: seeded(),
    voice: 'Kore',
    voiceStyle: 'tranquilo',
    agent: 'muestra',
    tts: opts.tts ?? null,
    audio: opts.audio ?? null,
    onEvent: (type, detail) => void events.push({ type, detail }),
  });
  return { clock, engine, events };
}
type AvatarEngineTts = ConstructorParameters<typeof AvatarEngine>[0]['tts'];

describe('audioStartDelayMs', () => {
  it('el audio arranca al terminar el avance de la expresión, menos la latencia de salida', () => {
    expect(audioStartDelayMs(0)).toBe(SPEECH_LEAD_IN_MS);
    expect(audioStartDelayMs(40)).toBe(SPEECH_LEAD_IN_MS - 40);
    expect(audioStartDelayMs(10_000)).toBe(0);
    expect(audioStartDelayMs(Number.NaN)).toBe(SPEECH_LEAD_IN_MS);
  });
});

describe('AvatarEngine sin voz', () => {
  it('en reposo muestra neutral', () => {
    const { engine } = setup();
    expect(engine.frameText()).toBe('[neutral]');
    expect(engine.speaking()).toBe(false);
  });

  it('decir mueve la boca con la boca sintética, avisa hablando y termina con fin', async () => {
    const { clock, engine, events } = setup();
    let done = false;
    const p = engine.say('Hola, ¿cómo estás? Todo bien.').then(() => (done = true));
    await flush();
    expect(events[0]).toMatchObject({ type: 'hablando', detail: { voz: false } });
    const seen = new Set<string>();
    const { durationMs } = syntheticMouthTimeline(spokenSummary('Hola, ¿cómo estás? Todo bien.'));
    for (let t = 0; t < SPEECH_LEAD_IN_MS + durationMs - 10; t += 10) {
      clock.advance(10);
      seen.add(engine.frameText());
    }
    expect(seen.has('[mouth_open]') || seen.has('[mouth_q3]')).toBe(true);
    expect(engine.fast()).toBe(true);
    expect(done).toBe(false);
    clock.advance(20);
    await p;
    expect(done).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['hablando', 'fin']);
    expect(engine.speaking()).toBe(false);
  });

  it('los cuadros son los mismos que da el animador del panel con el mismo texto', async () => {
    const motion: Motion = { poses: [], clips: {} };
    const { clock, engine } = setup({ motion });
    const text = 'Listo. Corregí el error y las pruebas pasan.';
    void engine.say(text);
    await flush();
    const ref = new Animator({ rng: seeded(), motion });
    ref.idle(0);
    const { steps, durationMs } = syntheticMouthTimeline(spokenSummary(text));
    ref.say(0, { steps, durationMs, expression: pickExpression(text) });
    for (let t = 0; t <= SPEECH_LEAD_IN_MS + durationMs + 3500; t += 40) {
      expect(engine.frameText(), `t=${t}`).toBe(`[${ref.frame(t)}]`);
      clock.advance(40);
    }
  });

  it('un texto que solo es código no dice nada pero gesticula y termina', async () => {
    const { clock, engine, events } = setup();
    const p = engine.say('```\nconst x = 1;\n```');
    await flush();
    clock.advance(SPEECH_LEAD_IN_MS + 1300);
    await p;
    expect(events.map((e) => e.type)).toEqual(['hablando', 'fin']);
  });

  it('callar corta el habla: vuelve a reposo y avisa fin una sola vez', async () => {
    const { clock, engine, events } = setup();
    const p = engine.say('Una frase bastante larga para que tarde en terminar de decirse.');
    await flush();
    clock.advance(800);
    engine.stop();
    await p;
    expect(engine.speaking()).toBe(false);
    clock.advance(10_000);
    expect(events.map((e) => e.type)).toEqual(['hablando', 'fin']);
    expect(engine.frameText()).not.toMatch(/mouth/);
  });

  it('un decir nuevo reemplaza al anterior: el primero termina y el segundo sigue', async () => {
    const { clock, engine, events } = setup();
    let first = false;
    const p1 = engine.say('Primera frase larga que no va a terminar.').then(() => (first = true));
    await flush();
    clock.advance(600);
    const p2 = engine.say('Segunda.');
    await p1;
    expect(first).toBe(true);
    expect(engine.speaking()).toBe(true);
    clock.advance(SPEECH_LEAD_IN_MS + 2000);
    await p2;
    expect(events.map((e) => e.type)).toEqual(['hablando', 'fin', 'hablando', 'fin']);
  });

  it('pensar con clip think lo reproduce y sube a 24 fps', () => {
    const extra = Array.from({ length: 4 }, (_, i) => `clip:think:${i}`);
    const { clock, engine } = setup({ motion: { poses: [], clips: { think: 4 } }, extra });
    engine.think();
    clock.advance(50);
    expect(engine.frameText()).toMatch(/clip:think/);
    expect(engine.fast()).toBe(true);
  });

  it('un cuadro que falta en el paquete se dibuja como neutral', () => {
    const { clock, engine } = setup();
    // Sin cuadro de parpadeo en el paquete: se usa neutral en su lugar.
    const f = frames();
    f.delete('blink');
    const e2 = new AvatarEngine({ frames: f, motion: { poses: [], clips: {} }, now: clock.now, rng: () => 0, voice: 'Kore' });
    clock.advance(3100);
    expect(e2.frameText()).toBe('[neutral]');
    expect(engine.frameText()).toBeDefined();
  });
});

describe('AvatarEngine con voz (proxy)', () => {
  it('pide la voz del resumen con la voz y el estilo del agente; la boca sale del audio', async () => {
    const audio = new FakeAudio();
    const asked: unknown[] = [];
    const data = wav();
    const { clock, engine, events } = setup({
      audio,
      tts: async (req) => {
        asked.push(req);
        return data.slice(0);
      },
    });
    const text = 'Hecho. Todo funciona bien.';
    const p = engine.say(text);
    await flush();
    expect(asked).toEqual([{ text: spokenSummary(text), voice: 'Kore', style: 'tranquilo', agent: 'muestra' }]);
    expect(events[0]).toMatchObject({ type: 'hablando', detail: { voz: true } });
    // El audio se agenda para que suene al terminar el avance, descontando la latencia de salida.
    expect(audio.started).toEqual([{ delayMs: SPEECH_LEAD_IN_MS - audio.latency, bytes: data.byteLength }]);
    const { sampleRate, samples } = parseWav(data);
    const steps = mouthTimeline(samples, sampleRate);
    const firstOpen = steps.find((s) => s.level > 0)!;
    clock.advance(SPEECH_LEAD_IN_MS + firstOpen.tMs + 5);
    expect(engine.frameText()).toMatch(/mouth/);
    clock.advance(1000);
    await p;
    expect(events.map((e) => e.type)).toEqual(['hablando', 'fin']);
  });

  it('si la voz falla, avisa y gesticula con la boca sintética', async () => {
    const audio = new FakeAudio();
    const { clock, engine, events } = setup({
      audio,
      tts: async () => {
        throw new Error('Límite diario de voz alcanzado');
      },
    });
    const p = engine.say('Hola.');
    await flush();
    expect(events.map((e) => e.type)).toEqual(['aviso', 'hablando']);
    expect(events[0]!.detail).toEqual({ mensaje: 'Límite diario de voz alcanzado' });
    expect(audio.started).toEqual([]);
    clock.advance(SPEECH_LEAD_IN_MS + 1300);
    await p;
  });

  it('un WAV que no se puede leer o decodificar también cae a la boca sintética', async () => {
    const audio = new FakeAudio();
    audio.failPrepare = true;
    const { engine, events } = setup({ audio, tts: async () => wav() });
    void engine.say('Hola.');
    await flush();
    expect(events.map((e) => e.type)).toEqual(['aviso', 'hablando']);
    expect((events[1]!.detail as { voz: boolean }).voz).toBe(false);
  });

  it('callar detiene el audio', async () => {
    const audio = new FakeAudio();
    const { engine } = setup({ audio, tts: async () => wav() });
    const p = engine.say('Hola.');
    await flush();
    engine.stop();
    await p;
    expect(audio.stopped).toBe(1);
  });

  it('un decir nuevo o callar cancelan la petición de voz en curso (no se paga lo que nadie oirá)', async () => {
    const audio = new FakeAudio();
    const signals: AbortSignal[] = [];
    const { engine } = setup({
      audio,
      tts: (_req, signal) => {
        signals.push(signal!);
        return new Promise<ArrayBuffer>((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new DOMException('cancelada', 'AbortError'))),
        );
      },
    });
    const p1 = engine.say('Primera.');
    await flush();
    expect(signals[0]!.aborted).toBe(false);
    const p2 = engine.say('Segunda.');
    await flush();
    expect(signals[0]!.aborted).toBe(true);
    await p1;
    engine.stop();
    expect(signals[1]!.aborted).toBe(true);
    await p2;
    expect(audio.started).toEqual([]);
  });

  it('say siempre resuelve aunque algo falle por dentro', async () => {
    const throwing: AudioOut = {
      unlock: () => {
        throw new Error('sin audio');
      },
      latencyMs: () => 0,
      prepare: async () => ({ start: () => undefined, stop: () => undefined }),
    };
    const { engine } = setup({ audio: throwing, tts: async () => wav() });
    await expect(engine.say('Hola.')).resolves.toBeUndefined();
  });

  it('si llega otro decir mientras se espera la voz, la respuesta vieja no suena', async () => {
    const audio = new FakeAudio();
    let release: (b: ArrayBuffer) => void = () => undefined;
    let calls = 0;
    const { engine } = setup({
      audio,
      tts: () => {
        calls++;
        return calls === 1 ? new Promise<ArrayBuffer>((r) => (release = r)) : Promise.resolve(wav());
      },
    });
    const p1 = engine.say('Primera.');
    await flush();
    void engine.say('Segunda.');
    await flush();
    release(wav());
    await p1;
    await flush();
    expect(audio.started).toHaveLength(1);
  });
});
