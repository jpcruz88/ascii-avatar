import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Animator, DEFAULT_DAILY_LIMIT_USD, Ledger } from '@ascii-avatar/core';
import { ttsCostUsd } from '@ascii-avatar/gemini';
import type { CliConfig } from '../src/config.js';
import { PanelController } from '../src/panel-controller.js';

/** Programador de pruebas: arranca el audio en el acto, sin esperar el avance de la expresión. */
const runNow = (_ms: number, fn: () => void): (() => void) => {
  fn();
  return () => undefined;
};

/** WAV PCM16 mono de 1 s a 24 kHz con una onda cuadrada. */
function makeWav(): Buffer {
  const n = 24000;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(i % 40 < 20 ? 12000 : -12000, i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(24000, 24);
  head.writeUInt32LE(48000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const WAV = makeWav();
const PROSE = 'Listo, ya terminé de revisar los cambios.';
const BLOCKED = 'Voz bloqueada: no se pudo registrar el gasto';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup(usage = { inputTokens: 100, outputTokens: 2000 }) {
  const config: CliConfig = {
    activeAgent: 'luna',
    voice: true,
    dailyLimitUsd: DEFAULT_DAILY_LIMIT_USD,
    mode: 'halfblock',
    cols: 70,
  };
  const ledger = new Ledger(join(root, 'ledger.jsonl'));
  const tts = { speak: vi.fn(async () => ({ wav: WAV, ...usage })) };
  const play = vi.fn(() => ({ done: new Promise<void>(() => {}), stop: vi.fn() }));
  const animator = new Animator({ rng: () => 0 });
  const say = vi.spyOn(animator, 'say');
  const controller = new PanelController({
    root,
    animator,
    ledger,
    tts,
    player: { play },
    config,
    agent: 'luna',
    now: () => 1000,
    schedule: runNow,
  });
  return { controller, ledger, tts, play, say, config };
}

describe('PanelController: el gasto no registrado bloquea la voz', () => {
  it('si ledger.record falla, el audio ya pagado suena pero no se vuelve a gastar', async () => {
    const s = setup();
    vi.spyOn(s.ledger, 'record').mockImplementation(() => {
      throw new Error('disco lleno');
    });
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(s.play).toHaveBeenCalledTimes(1);
    expect(s.controller.notice()).toBe(BLOCKED);

    await s.controller.handle({ type: 'say', text: 'Otra respuesta distinta, ya está.' });
    expect(s.tts.speak).toHaveBeenCalledTimes(1);
    expect(s.play).toHaveBeenCalledTimes(1);
    expect(s.say).toHaveBeenCalledTimes(2);
  });

  it('aviso persistente: sobrevive a thinking, a say y a un mensaje voice', async () => {
    const s = setup();
    vi.spyOn(s.ledger, 'record').mockImplementation(() => {
      throw new Error('solo lectura');
    });
    await s.controller.handle({ type: 'say', text: PROSE });
    await s.controller.handle({ type: 'thinking' });
    expect(s.controller.notice()).toBe(BLOCKED);
    await s.controller.handle({ type: 'say', text: 'Otra respuesta distinta, ya está.' });
    expect(s.controller.notice()).toBe(BLOCKED);
    await s.controller.handle({ type: 'voice', on: false });
    await s.controller.handle({ type: 'voice', on: true });
    expect(s.controller.notice()).toBe(BLOCKED);
    await s.controller.handle({ type: 'say', text: 'Y una tercera, para comprobar.' });
    expect(s.tts.speak).toHaveBeenCalledTimes(1);
  });

  it('un costo NaN cuenta como fallo: no se llama a record con NaN', async () => {
    const s = setup({ inputTokens: Number.NaN, outputTokens: 2000 });
    const record = vi.spyOn(s.ledger, 'record');
    await s.controller.handle({ type: 'say', text: PROSE });
    expect(record).not.toHaveBeenCalled();
    expect(s.play).toHaveBeenCalledTimes(1);
    expect(s.controller.notice()).toBe(BLOCKED);
    await s.controller.handle({ type: 'say', text: 'Otra respuesta distinta, ya está.' });
    expect(s.tts.speak).toHaveBeenCalledTimes(1);
  });

  it('si no se puede leer el gasto de hoy, no hay TTS y se avisa', async () => {
    const s = setup();
    vi.spyOn(s.ledger, 'spentToday').mockImplementation(() => {
      throw new Error('ilegible');
    });
    await expect(s.controller.handle({ type: 'say', text: PROSE })).resolves.toBeUndefined();
    expect(s.tts.speak).not.toHaveBeenCalled();
    expect(s.say).toHaveBeenCalledTimes(1);
    expect(s.controller.notice()).toBe('No se pudo leer el gasto de hoy');
  });
});

describe('PanelController.close', () => {
  it('con TTS en vuelo: registra el gasto pero no reproduce ni anima', async () => {
    const s = setup();
    let resolve!: (v: { wav: Buffer; inputTokens: number; outputTokens: number }) => void;
    s.tts.speak.mockImplementationOnce(
      () => new Promise((r) => (resolve = r)) as ReturnType<typeof s.tts.speak>,
    );
    const pending = s.controller.handle({ type: 'say', text: PROSE });
    await new Promise((r) => setTimeout(r, 10));
    s.controller.close();
    resolve({ wav: WAV, inputTokens: 100, outputTokens: 2000 });
    await pending;
    expect(s.ledger.spentToday()).toBeCloseTo(ttsCostUsd(100, 2000), 10);
    expect(s.play).not.toHaveBeenCalled();
    expect(s.say).not.toHaveBeenCalled();
  });

  it('después de close, handle no hace nada', async () => {
    const s = setup();
    s.controller.close();
    await s.controller.handle({ type: 'say', text: PROSE });
    await s.controller.handle({ type: 'voice', on: false });
    expect(s.tts.speak).not.toHaveBeenCalled();
    expect(s.say).not.toHaveBeenCalled();
    expect(s.config.voice).toBe(true);
  });

  it('detiene el audio que estaba sonando', async () => {
    const s = setup();
    const stop = vi.fn();
    s.play.mockReturnValueOnce({ done: new Promise<void>(() => {}), stop });
    await s.controller.handle({ type: 'say', text: PROSE });
    s.controller.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
