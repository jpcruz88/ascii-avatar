import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Animator, DEFAULT_DAILY_LIMIT_USD, Ledger } from '@ascii-avatar/core';
import { SpeechRefusedError, ttsCostUsd, type TtsClient } from '@ascii-avatar/gemini';
import { loadConfig, type CliConfig } from '../src/config.js';
import { PanelController } from '../src/panel-controller.js';
import type { AudioPlayer } from '../src/player.js';

/** WAV PCM16 mono con `n` muestras de una onda cuadrada. */
function makeWav(n: number, sampleRate = 24000): Buffer {
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(i % 40 < 20 ? 12000 : -12000, i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const WAV = makeWav(48000); // 2 s
const INPUT_TOKENS = 100;
const OUTPUT_TOKENS = 2000;
const COST = ttsCostUsd(INPUT_TOKENS, OUTPUT_TOKENS);

let root: string;
let nowMs: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
  nowMs = 1000;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

interface Setup {
  controller: PanelController;
  animator: Animator;
  ledger: Ledger;
  config: CliConfig;
  tts: { speak: ReturnType<typeof vi.fn> };
  play: ReturnType<typeof vi.fn>;
  stops: ReturnType<typeof vi.fn>[];
  say: ReturnType<typeof vi.spyOn>;
}

function setup(over: { voice?: boolean; tts?: TtsClient | null } = {}): Setup {
  const config: CliConfig = {
    activeAgent: 'luna',
    voice: over.voice ?? true,
    dailyLimitUsd: DEFAULT_DAILY_LIMIT_USD,
    mode: 'halfblock',
    cols: 70,
  };
  const ledger = new Ledger(join(root, 'ledger.jsonl'));
  const tts = {
    speak: vi.fn(async () => ({ wav: WAV, inputTokens: INPUT_TOKENS, outputTokens: OUTPUT_TOKENS })),
  };
  const stops: ReturnType<typeof vi.fn>[] = [];
  const play = vi.fn(() => {
    const stop = vi.fn();
    stops.push(stop);
    return { done: new Promise<void>(() => {}), stop };
  });
  const player: AudioPlayer = { play };
  const animator = new Animator({ rng: () => 0 });
  const say = vi.spyOn(animator, 'say');
  const controller = new PanelController({
    root,
    animator,
    ledger,
    tts: over.tts === undefined ? tts : over.tts,
    player,
    config,
    agent: 'luna',
    now: () => nowMs,
  });
  return { controller, animator, ledger, config, tts, play, stops, say };
}

const PROSE = 'Listo, ya terminé de revisar los cambios.';
const CODE_ONLY = '```ts\nconst a = 1;\nconst b = 2;\n```';

describe('PanelController', () => {
  it('thinking lo pasa al animador', async () => {
    const s = setup();
    const thinking = vi.spyOn(s.animator, 'thinking');
    await s.controller.handle({ type: 'thinking' });
    expect(thinking).toHaveBeenCalledWith(1000);
  });

  it('say con voz encendida llama 1 vez a TTS y 1 vez a play, y registra el gasto', async () => {
    const s = setup();
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(s.tts.speak).toHaveBeenCalledTimes(1);
    expect(s.tts.speak).toHaveBeenCalledWith(expect.objectContaining({ voice: 'Kore' }));
    expect(s.play).toHaveBeenCalledTimes(1);
    expect(s.play).toHaveBeenCalledWith(WAV);
    expect(s.ledger.spentToday()).toBeCloseTo(COST, 10);
    expect(s.controller.spentToday()).toBeCloseTo(COST, 10);
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.say.mock.calls[0]?.[1]).toMatchObject({ durationMs: 2000 });
    expect(s.controller.notice()).toBeNull();
  });

  it('usa la voz del agente cuando se indica', async () => {
    const s = setup();
    const c = new PanelController({
      root,
      animator: s.animator,
      ledger: s.ledger,
      tts: s.tts,
      player: { play: s.play },
      config: s.config,
      agent: 'luna',
      voice: 'Puck',
      now: () => nowMs,
    });
    await c.handle({ type: 'say', text: PROSE });
    expect(s.tts.speak).toHaveBeenCalledWith(expect.objectContaining({ voice: 'Puck' }));
  });

  it('con la voz apagada no llama a TTS ni a play y anima con la boca sintética', async () => {
    const s = setup({ voice: false });
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(s.tts.speak).not.toHaveBeenCalled();
    expect(s.play).not.toHaveBeenCalled();
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.ledger.spentToday()).toBe(0);
    expect(s.controller.notice()).toBeNull();
  });

  it('un texto solo de código no llama a TTS y deja la expresión neutral', async () => {
    const s = setup();
    await s.controller.handle({ type: 'say', text: CODE_ONLY });
    expect(s.tts.speak).not.toHaveBeenCalled();
    expect(s.play).not.toHaveBeenCalled();
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.say.mock.calls[0]?.[1]).toMatchObject({ expression: 'neutral' });
    expect(s.animator.frame(nowMs + 100)).toBe('neutral');
    expect(s.ledger.spentToday()).toBe(0);
  });

  it('con el gasto de hoy en el límite no llama a TTS y avisa', async () => {
    const s = setup();
    s.ledger.record('voice', 'luna', 0.3);
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(s.tts.speak).not.toHaveBeenCalled();
    expect(s.play).not.toHaveBeenCalled();
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.controller.notice()).toBe('Límite diario de voz alcanzado');
  });

  it('con la voz encendida pero sin cliente TTS, anima y avisa que falta la llave', async () => {
    const s = setup({ tts: null });
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.play).not.toHaveBeenCalled();
    expect(s.controller.notice()).toBe('Voz no disponible: falta la llave de Gemini');
  });

  it('un mensaje voice cambia config.voice y lo guarda', async () => {
    const s = setup({ voice: false });
    await s.controller.handle({ type: 'voice', on: true });
    expect(s.config.voice).toBe(true);
    expect(s.controller.voiceOn()).toBe(true);
    expect(loadConfig(root).voice).toBe(true);
    await s.controller.handle({ type: 'voice', on: false });
    expect(loadConfig(root).voice).toBe(false);
  });

  it('un say nuevo detiene primero el audio anterior', async () => {
    const s = setup();
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(s.stops[0]).not.toHaveBeenCalled();
    await s.controller.handle({ type: 'say', text: 'Otra cosa distinta, ya está.' });
    expect(s.stops[0]).toHaveBeenCalledTimes(1);
    expect(s.stops[1]).not.toHaveBeenCalled();
    expect(s.play).toHaveBeenCalledTimes(2);
  });

  it('si Gemini rechaza el texto, anima sin voz, avisa y no registra gasto', async () => {
    const s = setup();
    s.tts.speak.mockRejectedValueOnce(new SpeechRefusedError('SAFETY'));
    await expect(s.controller.handle({ type: 'say', text: PROSE })).resolves.toBeUndefined();
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.play).not.toHaveBeenCalled();
    expect(s.ledger.spentToday()).toBe(0);
    expect(s.controller.notice()).toMatch(/rechaz/i);
    expect(s.tts.speak).toHaveBeenCalledTimes(1); // sin reintento
  });

  it('ante un error de red anima sin voz, avisa y no reintenta', async () => {
    const s = setup();
    s.tts.speak.mockRejectedValueOnce(new Error('ECONNRESET secreto-que-no-debe-salir'));
    await expect(s.controller.handle({ type: 'say', text: PROSE })).resolves.toBeUndefined();
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.tts.speak).toHaveBeenCalledTimes(1);
    expect(s.controller.notice()).toMatch(/^Voz no disponible/);
    expect(s.controller.notice()).not.toContain('secreto');
  });

  it('si el reproductor falla, anima y avisa sin romper', async () => {
    const s = setup();
    s.play.mockImplementationOnce(() => {
      throw new Error('afplay no existe');
    });
    await expect(s.controller.handle({ type: 'say', text: PROSE })).resolves.toBeUndefined();
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.controller.notice()).toMatch(/audio/i);
  });

  it('procesa los mensajes de uno en uno y en orden de llegada', async () => {
    const s = setup();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    s.tts.speak.mockImplementationOnce(async () => {
      order.push('tts-inicio');
      await gate;
      order.push('tts-fin');
      return { wav: WAV, inputTokens: INPUT_TOKENS, outputTokens: OUTPUT_TOKENS };
    });
    vi.spyOn(s.animator, 'thinking').mockImplementation(() => void order.push('thinking'));
    const a = s.controller.handle({ type: 'say', text: PROSE });
    const b = s.controller.handle({ type: 'thinking' });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['tts-inicio']);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(['tts-inicio', 'tts-fin', 'thinking']);
  });

  it('el aviso caduca con el tiempo', async () => {
    const s = setup({ tts: null });
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(s.controller.notice()).not.toBeNull();
    nowMs += 60_000;
    expect(s.controller.notice()).toBeNull();
  });
});
