import { describe, expect, it } from 'vitest';
import {
  createGeminiTtsClient,
  DEFAULT_TTS_MODEL,
  DEFAULT_VOICE,
  loadGeminiConfig,
  SpeechRefusedError,
  synthesizeSpeech,
  TTS_SAMPLE_RATE,
  ttsCostUsd,
  type InteractionsApi,
  type TtsClient,
} from '../src/index.js';

/** WAV PCM16 mono de silencio con la duración pedida (cabecera canónica de 44 bytes). */
function silentWav(seconds: number, sampleRate = 24000): Buffer {
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

describe('ttsCostUsd', () => {
  it('ttsCostUsd(100, 250) es aproximadamente 0.0051', () => {
    expect(ttsCostUsd(100, 250)).toBeCloseTo(0.0051, 6);
  });

  it('ttsCostUsd(0, 0) es 0', () => {
    expect(ttsCostUsd(0, 0)).toBe(0);
  });
});

describe('modelo y voz por defecto', () => {
  it('el modelo por defecto es el de la doc vigente de la API de Interacciones', () => {
    expect(DEFAULT_TTS_MODEL).toBe('gemini-3.8-flash-tts');
  });

  it('la voz por defecto es Kore y el audio es de 24 kHz', () => {
    expect(DEFAULT_VOICE).toBe('Kore');
    expect(TTS_SAMPLE_RATE).toBe(24000);
  });
});

describe('createGeminiTtsClient', () => {
  const cfg = loadGeminiConfig({ GEMINI_API_KEY: 'llave-falsa' });
  const wav = silentWav(1);

  function apiReturning(result: unknown): { ai: InteractionsApi; requests: unknown[] } {
    const requests: unknown[] = [];
    const ai: InteractionsApi = {
      interactions: {
        async create(params) {
          requests.push(params);
          return result;
        },
      },
    };
    return { ai, requests };
  }

  it('pide audio/wav a 24 kHz con la voz indicada y decodifica el audio base64', async () => {
    const { ai, requests } = apiReturning({
      output_audio: { data: wav.toString('base64') },
      usage: { total_input_tokens: 12, total_output_tokens: 25 },
    });

    const out = await createGeminiTtsClient(cfg, ai).speak({ text: 'Hola', voice: 'Kore' });

    expect(requests).toEqual([
      {
        model: cfg.ttsModel,
        input: [{ type: 'user_input', content: [{ type: 'text', text: 'Hola' }] }],
        response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
        generation_config: { speech_config: [{ voice: 'Kore' }] },
      },
    ]);
    expect(out.wav.equals(wav)).toBe(true);
    expect(out.inputTokens).toBe(12);
    expect(out.outputTokens).toBe(25);
  });

  it('con estilo añade la anotación speech_metadata al texto', async () => {
    const { ai, requests } = apiReturning({ output_audio: { data: wav.toString('base64') } });
    const style = 'un hombre mexicano de unos sesenta años, voz grave, cálida y pausada';

    await createGeminiTtsClient(cfg, ai).speak({ text: 'Hola', voice: 'Algenib', style });

    expect(requests).toEqual([
      {
        model: cfg.ttsModel,
        input: [
          {
            type: 'user_input',
            content: [
              { type: 'text', text: 'Hola', annotations: [{ type: 'speech_metadata', style }] },
            ],
          },
        ],
        response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
        generation_config: { speech_config: [{ voice: 'Algenib' }] },
      },
    ]);
  });

  it.each([undefined, '', '   '])('con estilo %j no envía anotaciones', async (style) => {
    const { ai, requests } = apiReturning({ output_audio: { data: wav.toString('base64') } });

    await createGeminiTtsClient(cfg, ai).speak({
      text: 'Hola',
      voice: 'Kore',
      ...(style === undefined ? {} : { style }),
    });

    expect(requests).toEqual([
      {
        model: cfg.ttsModel,
        input: [{ type: 'user_input', content: [{ type: 'text', text: 'Hola' }] }],
        response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
        generation_config: { speech_config: [{ voice: 'Kore' }] },
      },
    ]);
  });

  it('suma los tokens de pensamiento a la salida', async () => {
    const { ai } = apiReturning({
      output_audio: { data: wav.toString('base64') },
      usage: { total_input_tokens: 5, total_output_tokens: 20, total_thought_tokens: 3 },
    });

    const out = await createGeminiTtsClient(cfg, ai).speak({ text: 'Hola', voice: 'Kore' });

    expect(out.outputTokens).toBe(23);
  });

  it('devuelve tokens null cuando la API no informa el uso', async () => {
    const { ai } = apiReturning({ output_audio: { data: wav.toString('base64') } });

    const out = await createGeminiTtsClient(cfg, ai).speak({ text: 'Hola', voice: 'Kore' });

    expect(out.wav.equals(wav)).toBe(true);
    expect(out.inputTokens).toBeNull();
    expect(out.outputTokens).toBeNull();
  });

  it('deja en null el conteo que falte cuando el uso viene a medias', async () => {
    const { ai } = apiReturning({
      output_audio: { data: wav.toString('base64') },
      usage: { total_input_tokens: 7 },
    });

    const out = await createGeminiTtsClient(cfg, ai).speak({ text: 'Hola', voice: 'Kore' });

    expect(out.inputTokens).toBe(7);
    expect(out.outputTokens).toBeNull();
  });

  it('lanza SpeechRefusedError con el detalle cuando no hay audio', async () => {
    const { ai } = apiReturning({
      output_text: 'contenido bloqueado',
      status: 'failed',
      errors: [{ code: 'SAFETY', message: 'bloqueado' }],
    });

    const error = await createGeminiTtsClient(cfg, ai)
      .speak({ text: 'Hola', voice: 'Kore' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpeechRefusedError);
    expect((error as SpeechRefusedError).message).toMatch(/audio/i);
    expect((error as SpeechRefusedError).detail).toBe(
      'contenido bloqueado | estado: failed | SAFETY: bloqueado',
    );
  });

  it('trata un audio con datos vacíos como rechazo, sin detalle', async () => {
    const { ai } = apiReturning({ output_audio: { data: '' } });

    const error = await createGeminiTtsClient(cfg, ai)
      .speak({ text: 'Hola', voice: 'Kore' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpeechRefusedError);
    expect((error as SpeechRefusedError).detail).toBeUndefined();
  });

  it('trata datos base64 no vacíos que decodifican a cero bytes como rechazo', async () => {
    const { ai } = apiReturning({ output_audio: { data: '==' } });

    await expect(
      createGeminiTtsClient(cfg, ai).speak({ text: 'Hola', voice: 'Kore' }),
    ).rejects.toBeInstanceOf(SpeechRefusedError);
  });

  it('deja pasar los errores de red sin envolverlos', async () => {
    const boom = new Error('sin red');
    const ai: InteractionsApi = {
      interactions: {
        async create() {
          throw boom;
        },
      },
    };

    await expect(
      createGeminiTtsClient(cfg, ai).speak({ text: 'Hola', voice: 'Kore' }),
    ).rejects.toBe(boom);
  });
});

describe('synthesizeSpeech', () => {
  function clientWith(result: {
    wav: Buffer;
    inputTokens: number | null;
    outputTokens: number | null;
  }): { client: TtsClient; calls: Array<{ text: string; voice: string; style?: string }> } {
    const calls: Array<{ text: string; voice: string; style?: string }> = [];
    const client: TtsClient = {
      async speak(input) {
        calls.push(input);
        return result;
      },
    };
    return { client, calls };
  }

  it('devuelve el wav y el costo real; el cliente recibe la voz Kore', async () => {
    const wav = silentWav(1);
    const { client, calls } = clientWith({ wav, inputTokens: 100, outputTokens: 250 });

    const result = await synthesizeSpeech(client, 'Hola mundo', 'Kore');

    expect(result.wav).toBe(wav);
    expect(result.costUsd).toBeCloseTo(0.0051, 6);
    expect(result.costEstimated).toBe(false);
    expect(calls).toEqual([{ text: 'Hola mundo', voice: 'Kore' }]);
  });

  it('pasa el estilo al cliente solo cuando se indica', async () => {
    const { client, calls } = clientWith({ wav: silentWav(1), inputTokens: 1, outputTokens: 1 });

    await synthesizeSpeech(client, 'Hola', 'Algenib', 'grave y pausada');
    await synthesizeSpeech(client, 'Hola', 'Algenib');

    expect(calls).toEqual([
      { text: 'Hola', voice: 'Algenib', style: 'grave y pausada' },
      { text: 'Hola', voice: 'Algenib' },
    ]);
  });

  it('estima el costo por la duración del WAV cuando faltan los tokens', async () => {
    // 2 s · 25 tokens/s · $20/M + ceil(12/4) = 3 tokens de texto · $1/M
    const { client } = clientWith({ wav: silentWav(2), inputTokens: null, outputTokens: null });

    const result = await synthesizeSpeech(client, 'Hola mundo!!', 'Kore');

    expect(result.costUsd).toBeCloseTo(0.001003, 8);
    expect(result.costEstimated).toBe(true);
  });

  it('estima también cuando solo informó uno de los dos conteos', async () => {
    const { client } = clientWith({ wav: silentWav(2), inputTokens: 100, outputTokens: null });

    const result = await synthesizeSpeech(client, 'Hola mundo!!', 'Kore');

    expect(result.costUsd).toBeCloseTo(0.001003, 8);
    expect(result.costEstimated).toBe(true);
  });

  it('usa 0.01 USD si el WAV no se puede leer y faltan los tokens', async () => {
    const { client } = clientWith({
      wav: Buffer.from('no es un wav'),
      inputTokens: null,
      outputTokens: null,
    });

    const result = await synthesizeSpeech(client, 'Hola', 'Kore');

    expect(result.costUsd).toBe(0.01);
    expect(result.costEstimated).toBe(true);
  });

  it('usa 0.01 USD si el WAV es válido pero no tiene muestras', async () => {
    const { client } = clientWith({ wav: silentWav(0), inputTokens: null, outputTokens: null });

    const result = await synthesizeSpeech(client, 'Hola', 'Kore');

    expect(result.costUsd).toBe(0.01);
    expect(result.costEstimated).toBe(true);
  });

  it.each(['', '   ', '\n\t '])(
    'rechaza el texto vacío %j sin llamar al cliente',
    async (text) => {
      const { client, calls } = clientWith({
        wav: silentWav(1),
        inputTokens: 1,
        outputTokens: 1,
      });

      await expect(synthesizeSpeech(client, text, 'Kore')).rejects.toThrow(/texto/i);
      expect(calls).toHaveLength(0);
    },
  );
});
