import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractHookMessage, runHook } from '../src/commands/hook.js';
import { startServer, type Msg } from '../src/ipc.js';
import { socketPath } from '../src/config.js';

let root: string;
let closers: Array<() => Promise<void>> = [];

// Las rutas de sockets Unix en macOS son de ~104 caracteres como máximo: directorio temporal corto.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});

afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
  rmSync(root, { recursive: true, force: true });
});

const STOP = JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'Listo' });
const PROMPT = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hola' });

async function listen(): Promise<Msg[]> {
  const got: Msg[] = [];
  const server = await startServer(socketPath(root), (m) => got.push(m));
  closers.push(() => server.close());
  return got;
}

async function until(cond: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout esperando el mensaje');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('extractHookMessage', () => {
  it('Stop con last_assistant_message → say', () => {
    expect(extractHookMessage(STOP)).toEqual({ type: 'say', text: 'Listo' });
  });

  it('UserPromptSubmit → thinking', () => {
    expect(extractHookMessage(PROMPT)).toEqual({ type: 'thinking' });
  });

  it('Stop con mensaje vacío, ausente o que no es texto → null', () => {
    expect(extractHookMessage('{"hook_event_name":"Stop","last_assistant_message":""}')).toBeNull();
    expect(extractHookMessage('{"hook_event_name":"Stop"}')).toBeNull();
    expect(extractHookMessage('{"hook_event_name":"Stop","last_assistant_message":5}')).toBeNull();
  });

  it('JSON inválido, que no es objeto o con otro evento → null', () => {
    expect(extractHookMessage('no es json')).toBeNull();
    expect(extractHookMessage('')).toBeNull();
    expect(extractHookMessage('[1,2]')).toBeNull();
    expect(extractHookMessage('null')).toBeNull();
    expect(extractHookMessage('{"hook_event_name":"PreToolUse"}')).toBeNull();
  });

  it('recorta un mensaje enorme para que quepa en una línea del canal', () => {
    const big = JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'ñ'.repeat(100_000) });
    const msg = extractHookMessage(big);
    expect(msg?.type).toBe('say');
    expect(Buffer.byteLength(JSON.stringify(msg))).toBeLessThan(64 * 1024);
  });
});

describe('runHook', () => {
  it('sin socket resuelve 0 en menos de 500 ms', async () => {
    const t0 = performance.now();
    await expect(runHook(STOP, root)).resolves.toBe(0);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('con entrada basura resuelve 0 sin enviar nada', async () => {
    const got = await listen();
    await expect(runHook('no es json', root)).resolves.toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([]);
  });

  it('con el panel escuchando, este recibe el mensaje', async () => {
    const got = await listen();
    await expect(runHook(STOP, root)).resolves.toBe(0);
    await until(() => got.length === 1);
    expect(got).toEqual([{ type: 'say', text: 'Listo' }]);
  });

  it('con un UserPromptSubmit, el panel recibe thinking', async () => {
    const got = await listen();
    await runHook(PROMPT, root);
    await until(() => got.length === 1);
    expect(got).toEqual([{ type: 'thinking' }]);
  });
});

// El comando real: se compila (tsc -b es incremental) y se lanza `node dist/bin.js hook`.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const distBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

beforeAll(() => {
  const build = spawnSync('npx', ['tsc', '-b'], { cwd: repoRoot, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`No compiló: ${build.stdout}${build.stderr}`);
}, 120_000);

function runBin(stdin: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [distBin, 'hook', '--from-ascii-avatar'], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ASCII_AVATAR_HOME: root, ...env },
    timeout: 10_000,
  });
}

describe('avatar hook (proceso real)', () => {
  it('no escribe nada en stdout ni stderr y sale con 0, con o sin panel', () => {
    for (const input of [STOP, PROMPT, 'no es json', '']) {
      const r = runBin(input);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
    }
  });

  it('entrega el mensaje al panel que escucha', async () => {
    const got = await listen();
    const r = runBin(STOP);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    await until(() => got.length === 1);
    expect(got).toEqual([{ type: 'say', text: 'Listo' }]);
  });

  it('con un directorio de datos inservible sigue callado y sale con 0', () => {
    const r = runBin(STOP, { ASCII_AVATAR_HOME: '/dev/null/no-existe' });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe('');
  });

  it('si stdin nunca se cierra, sale con 0 en ~1 s', async () => {
    const child = spawn(process.execPath, [distBin, 'hook', '--from-ascii-avatar'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ASCII_AVATAR_HOME: root },
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (out += d));
    child.stdin.write(STOP); // sin end(): stdin queda abierto
    const t0 = performance.now();
    const code = await new Promise<number | null>((resolve) => {
      const guard = setTimeout(() => {
        child.kill(); // por PID del hijo, no por patrón
        resolve(-1);
      }, 3000);
      child.once('exit', (c) => {
        clearTimeout(guard);
        resolve(c);
      });
    });
    expect(code).toBe(0);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(out).toBe('');
  });
});
