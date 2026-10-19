import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidWavError, parseWav } from '../src/index.js';

interface WavOptions {
  sampleRate?: number;
  channels?: number;
  bits?: number;
  audioFormat?: number;
  /** Muestras ya intercaladas (una por canal y por cuadro). */
  pcm?: Int16Array;
  /** Bytes de datos crudos; reemplaza a `pcm`. */
  rawData?: Buffer;
  /** Chunks extra que se insertan entre `fmt ` y `data`. */
  extraChunks?: Buffer[];
  /** Valor a escribir en el campo de tamaño del chunk `data`. */
  dataSizeField?: number;
}

function chunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  // RIFF: un chunk de tamaño impar lleva un byte de relleno que no cuenta en el tamaño.
  return Buffer.concat([head, body, body.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** Arma un WAV PCM completo en memoria. */
function makeWav(opts: WavOptions = {}): Buffer {
  const sampleRate = opts.sampleRate ?? 24000;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(opts.audioFormat ?? 1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE((sampleRate * channels * bits) / 8, 8);
  fmt.writeUInt16LE((channels * bits) / 8, 12);
  fmt.writeUInt16LE(bits, 14);

  const data =
    opts.rawData ??
    Buffer.from((opts.pcm ?? new Int16Array(0)).buffer, (opts.pcm ?? new Int16Array(0)).byteOffset, (opts.pcm ?? new Int16Array(0)).byteLength);
  const dataChunk = chunk('data', data);
  if (opts.dataSizeField !== undefined) dataChunk.writeUInt32LE(opts.dataSizeField, 4);

  const body = Buffer.concat([
    Buffer.from('WAVE', 'ascii'),
    chunk('fmt ', fmt),
    ...(opts.extraChunks ?? []),
    dataChunk,
  ]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function sine(count: number, amplitude: number, freq = 440, sampleRate = 24000): Int16Array {
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * freq * i) / sampleRate));
  }
  return out;
}

describe('parseWav', () => {
  it('parsea un WAV mono PCM16 con su frecuencia de muestreo', () => {
    const pcm = sine(2400, 0.5);
    const { sampleRate, samples } = parseWav(makeWav({ pcm }));
    expect(sampleRate).toBe(24000);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples.length).toBe(2400);
  });

  it('normaliza las muestras int16 a [-1, 1] dividiendo entre 32768', () => {
    const pcm = Int16Array.from([0, 16384, -16384, 32767, -32768]);
    const { samples } = parseWav(makeWav({ pcm }));
    expect(Array.from(samples)).toEqual([0, 0.5, -0.5, 32767 / 32768, -1]);
  });

  it('respeta una frecuencia de muestreo distinta', () => {
    const { sampleRate } = parseWav(makeWav({ sampleRate: 16000, pcm: sine(160, 0.3, 440, 16000) }));
    expect(sampleRate).toBe(16000);
  });

  it('acepta un WAV sin muestras', () => {
    const { samples } = parseWav(makeWav({ pcm: new Int16Array(0) }));
    expect(samples.length).toBe(0);
  });

  it('salta chunks desconocidos como LIST antes de data', () => {
    const list = chunk('LIST', Buffer.from('INFOISFT\u0005\u0000\u0000\u0000Test\u0000', 'latin1'));
    const pcm = sine(480, 0.5);
    const { samples } = parseWav(makeWav({ pcm, extraChunks: [list] }));
    expect(samples.length).toBe(480);
    expect(samples[10]).toBeCloseTo(pcm[10]! / 32768, 6);
  });

  it('maneja el byte de relleno de un chunk de tamaño impar', () => {
    const odd = chunk('junk', Buffer.from([1, 2, 3]));
    expect(odd.length).toBe(12); // 8 de cabecera + 3 de cuerpo + 1 de relleno
    const pcm = sine(100, 0.5);
    const { samples } = parseWav(makeWav({ pcm, extraChunks: [odd] }));
    expect(samples.length).toBe(100);
    expect(samples[5]).toBeCloseTo(pcm[5]! / 32768, 6);
  });

  it('en estéreo toma solo el primer canal', () => {
    const frames = 300;
    const stereo = new Int16Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      stereo[2 * i] = 8192; // canal izquierdo constante
      stereo[2 * i + 1] = -20000; // canal derecho, debe ignorarse
    }
    const { samples } = parseWav(makeWav({ channels: 2, pcm: stereo }));
    expect(samples.length).toBe(frames);
    expect(samples.every((s) => s === 0.25)).toBe(true);
  });

  it('usa los bytes presentes si el tamaño de data excede el búfer (0xFFFFFFFF)', () => {
    const pcm = sine(1000, 0.5);
    const { samples } = parseWav(makeWav({ pcm, dataSizeField: 0xffffffff }));
    expect(samples.length).toBe(1000);
  });

  it('usa los bytes presentes si el tamaño de data es mayor que lo que hay', () => {
    const pcm = sine(1000, 0.5);
    const { samples } = parseWav(makeWav({ pcm, dataSizeField: 999_999 }));
    expect(samples.length).toBe(1000);
  });

  it('usa los bytes presentes si el tamaño de data es 0 (WAV en streaming)', () => {
    const pcm = sine(1000, 0.5);
    const { samples } = parseWav(makeWav({ pcm, dataSizeField: 0 }));
    expect(samples.length).toBe(1000);
  });

  it('ignora un byte suelto al final de los datos', () => {
    const rawData = Buffer.concat([Buffer.from(sine(10, 0.5).buffer), Buffer.from([7])]);
    const { samples } = parseWav(makeWav({ rawData }));
    expect(samples.length).toBe(10);
  });

  it('lanza InvalidWavError con bytes aleatorios', () => {
    const noise = Buffer.from(randomBytes(512));
    noise[0] = 0x00; // garantiza que no empiece con "RIFF"
    expect(() => parseWav(noise)).toThrow(InvalidWavError);
  });

  it('lanza InvalidWavError con un búfer vacío', () => {
    expect(() => parseWav(Buffer.alloc(0))).toThrow(InvalidWavError);
  });

  it('lanza InvalidWavError si es RIFF pero no WAVE', () => {
    const buf = makeWav({ pcm: sine(10, 0.5) });
    buf.write('AVI ', 8, 'ascii');
    expect(() => parseWav(buf)).toThrow(InvalidWavError);
  });

  it('lanza InvalidWavError con la cabecera truncada', () => {
    const buf = makeWav({ pcm: sine(10, 0.5) });
    expect(() => parseWav(buf.subarray(0, 20))).toThrow(InvalidWavError);
    expect(() => parseWav(buf.subarray(0, 8))).toThrow(InvalidWavError);
  });

  it('lanza InvalidWavError si no hay chunk data', () => {
    const buf = makeWav({ pcm: sine(10, 0.5) });
    // Corta justo después del chunk fmt: 12 (RIFF/WAVE) + 8 + 16.
    expect(() => parseWav(buf.subarray(0, 36))).toThrow(InvalidWavError);
  });

  it('lanza InvalidWavError si no hay chunk fmt', () => {
    const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), chunk('data', Buffer.alloc(8))]);
    const head = Buffer.alloc(8);
    head.write('RIFF', 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    expect(() => parseWav(Buffer.concat([head, body]))).toThrow(InvalidWavError);
  });

  it('rechaza WAV de 8 bits', () => {
    const buf = makeWav({ bits: 8, rawData: Buffer.alloc(100, 128) });
    expect(() => parseWav(buf)).toThrow(InvalidWavError);
    expect(() => parseWav(buf)).toThrow(/8 bits/);
  });

  it('rechaza WAV de 24 y 32 bits', () => {
    expect(() => parseWav(makeWav({ bits: 24, rawData: Buffer.alloc(90) }))).toThrow(InvalidWavError);
    expect(() => parseWav(makeWav({ bits: 32, rawData: Buffer.alloc(120) }))).toThrow(InvalidWavError);
  });

  it('rechaza WAV de coma flotante (formato 3)', () => {
    const buf = makeWav({ audioFormat: 3, bits: 32, rawData: Buffer.alloc(120) });
    expect(() => parseWav(buf)).toThrow(InvalidWavError);
  });

  it('rechaza un WAV con cero canales o frecuencia cero', () => {
    expect(() => parseWav(makeWav({ channels: 0, pcm: sine(10, 0.5) }))).toThrow(InvalidWavError);
    expect(() => parseWav(makeWav({ sampleRate: 0, pcm: sine(10, 0.5) }))).toThrow(InvalidWavError);
  });

  it('el error tiene nombre y mensaje en español', () => {
    try {
      parseWav(Buffer.from('no soy un wav'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidWavError);
      expect((err as Error).name).toBe('InvalidWavError');
      expect((err as Error).message).toMatch(/WAV/);
    }
  });
});

describe('parseWav sin Buffer de Node (navegador)', () => {
  const pcm = sine(480, 12000);
  const wav = makeWav({ pcm });
  const expected = parseWav(wav);

  it('acepta un Uint8Array y da lo mismo que con un Buffer', () => {
    const bytes = new Uint8Array(wav.length);
    bytes.set(wav);
    expect(Object.getPrototypeOf(bytes)).toBe(Uint8Array.prototype);
    const got = parseWav(bytes);
    expect(got.sampleRate).toBe(expected.sampleRate);
    expect(Array.from(got.samples)).toEqual(Array.from(expected.samples));
  });

  it('acepta un ArrayBuffer', () => {
    const copy = new ArrayBuffer(wav.length);
    new Uint8Array(copy).set(wav);
    const got = parseWav(copy);
    expect(got.sampleRate).toBe(24000);
    expect(Array.from(got.samples)).toEqual(Array.from(expected.samples));
  });

  it('respeta el desplazamiento de una vista dentro de un búfer más grande', () => {
    const big = new Uint8Array(wav.length + 7);
    big.set(wav, 3);
    const got = parseWav(big.subarray(3, 3 + wav.length));
    expect(Array.from(got.samples)).toEqual(Array.from(expected.samples));
  });

  it('un Uint8Array que no es WAV lanza InvalidWavError', () => {
    expect(() => parseWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(InvalidWavError);
  });
});
