/** Se lanza cuando el búfer no es un WAV PCM de 16 bits que se pueda leer. */
export class InvalidWavError extends Error {
  constructor(reason: string) {
    super(`WAV inválido: ${reason}`);
    this.name = 'InvalidWavError';
  }
}

interface WavFormat {
  channels: number;
  sampleRate: number;
}

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FMT_MIN_BYTES = 16;
const PCM_FORMAT = 1;
const BITS_PER_SAMPLE = 16;
const STREAMED_SIZE = 0xffffffff;

/**
 * Lee un WAV PCM de 16 bits y devuelve las muestras del primer canal como `Float32Array` en [-1, 1].
 * Acepta un `Uint8Array` (un `Buffer` de Node también lo es) o un `ArrayBuffer`, así sirve igual en
 * Node y en el navegador.
 *
 * Recorre la lista de chunks RIFF: no supone una cabecera de 44 bytes, salta chunks desconocidos
 * (por ejemplo `LIST`) y respeta el byte de relleno de los chunks de tamaño impar. Si el tamaño
 * declarado de `data` excede lo que hay en el búfer (WAV en streaming: 0 o 0xFFFFFFFF), usa los
 * bytes presentes.
 */
export function parseWav(input: Uint8Array | ArrayBuffer): { sampleRate: number; samples: Float32Array } {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < RIFF_HEADER_BYTES) {
    throw new InvalidWavError(`el archivo tiene ${buf.length} bytes y no alcanza para la cabecera RIFF/WAVE.`);
  }
  if (ascii(buf, 0) !== 'RIFF' || ascii(buf, 8) !== 'WAVE') {
    throw new InvalidWavError('no empieza con la cabecera RIFF/WAVE.');
  }

  let format: WavFormat | undefined;
  let dataStart = -1;
  let dataBytes = 0;

  let offset = RIFF_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= buf.length) {
    const id = ascii(buf, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + CHUNK_HEADER_BYTES;
    const available = buf.length - body;

    if (id === 'fmt ') {
      format = readFormat(view, body, size, available);
    } else if (id === 'data' && dataStart < 0) {
      const streamed = size === 0 || size === STREAMED_SIZE || size > available;
      dataStart = body;
      dataBytes = streamed ? available : size;
      if (streamed) break; // los datos llegan hasta el final del búfer
    }

    // Los chunks de tamaño impar llevan un byte de relleno que no cuenta en `size`.
    offset = body + size + (size % 2);
  }

  if (format === undefined) throw new InvalidWavError('falta el chunk "fmt " o está truncado.');
  if (dataStart < 0) throw new InvalidWavError('falta el chunk "data".');

  const frameBytes = (BITS_PER_SAMPLE / 8) * format.channels;
  const frames = Math.floor(dataBytes / frameBytes);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    samples[i] = view.getInt16(dataStart + i * frameBytes, true) / 32768;
  }
  return { sampleRate: format.sampleRate, samples };
}

/** Los 4 bytes desde `at` como texto ASCII (ids de chunk RIFF). */
function ascii(buf: Uint8Array, at: number): string {
  return String.fromCharCode(buf[at] ?? 0, buf[at + 1] ?? 0, buf[at + 2] ?? 0, buf[at + 3] ?? 0);
}

function readFormat(view: DataView, body: number, size: number, available: number): WavFormat {
  if (size < FMT_MIN_BYTES || available < FMT_MIN_BYTES) {
    throw new InvalidWavError('el chunk "fmt " está truncado.');
  }
  const audioFormat = view.getUint16(body, true);
  const channels = view.getUint16(body + 2, true);
  const sampleRate = view.getUint32(body + 4, true);
  const bits = view.getUint16(body + 14, true);

  if (audioFormat !== PCM_FORMAT) {
    throw new InvalidWavError(`el formato de audio ${audioFormat} no es PCM entero (solo se admite PCM, formato 1).`);
  }
  if (bits !== BITS_PER_SAMPLE) {
    throw new InvalidWavError(`tiene ${bits} bits por muestra y solo se admiten ${BITS_PER_SAMPLE} bits.`);
  }
  if (channels < 1) throw new InvalidWavError('declara 0 canales.');
  if (sampleRate < 1) throw new InvalidWavError('declara una frecuencia de muestreo de 0 Hz.');
  return { channels, sampleRate };
}
