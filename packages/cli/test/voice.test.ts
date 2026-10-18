import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runVoice } from '../src/commands/voice.js';
import { loadConfig, socketPath } from '../src/config.js';
import { startServer, type Msg } from '../src/ipc.js';

let root: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});

afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
  rmSync(root, { recursive: true, force: true });
});

describe('runVoice', () => {
  it('on guarda voice=true en la configuración', async () => {
    const r = await runVoice('on', root);
    expect(r.ok).toBe(true);
    expect(loadConfig(root).voice).toBe(true);
  });

  it('off guarda voice=false, sin distinguir mayúsculas', async () => {
    await runVoice('on', root);
    const r = await runVoice('OFF', root);
    expect(r.ok).toBe(true);
    expect(loadConfig(root).voice).toBe(false);
  });

  it('sin panel abierto lo dice y no falla', async () => {
    const r = await runVoice('on', root);
    expect(r.message).toMatch(/no hay un panel abierto/i);
  });

  it('con el panel escuchando, le avisa', async () => {
    const got: Msg[] = [];
    const server = await startServer(socketPath(root), (m) => got.push(m));
    closers.push(() => server.close());
    const r = await runVoice('on', root);
    for (let i = 0; i < 100 && got.length === 0; i++) await new Promise((x) => setTimeout(x, 10));
    expect(got).toEqual([{ type: 'voice', on: true }]);
    expect(r.message).toMatch(/panel abierto/i);
    expect(r.message).not.toMatch(/no hay/i);
  });

  it('un valor no válido da ok:false con el uso y no toca la configuración', async () => {
    await expect(runVoice('maybe', root)).resolves.toEqual({ ok: false, message: 'Uso: avatar voice on|off' });
    await expect(runVoice('', root)).resolves.toMatchObject({ ok: false });
    expect(loadConfig(root).voice).toBe(false);
  });
});
