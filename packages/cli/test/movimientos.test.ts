import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FACE_IDS, listClips, saveClips } from '@ascii-avatar/core';
import { loadConfig, saveConfig } from '../src/config.js';
import { runImportFaces } from '../src/commands/import-faces.js';
import {
  DEFAULT_SCRIPT,
  checkPrerequisites,
  parseClipList,
  progressPrinter,
  resolveLivePortraitDir,
  runMovimientos,
  type ChildHandle,
  type ClipProgress,
  type Spawner,
} from '../src/commands/movimientos.js';

const W = 120;
const H = 160;

let root: string;
let lpDir: string;
let tmpBase: string;
let lines: string[];

const solid = (shade: number, width = W, height = H): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } } })
    .png()
    .toBuffer();

/** Crea el agente `ana` con sus 8 caras de W×H. */
async function makeAgent(name = 'ana'): Promise<void> {
  const faces = join(root, 'caras-src');
  mkdirSync(faces, { recursive: true });
  for (const [i, id] of FACE_IDS.entries()) writeFileSync(join(faces, `${id}.png`), await solid(20 + i * 20));
  const r = await runImportFaces({ root, name, facesDir: faces, out: () => undefined });
  expect(r.status).toBe('done');
}

/** Una instalación de LivePortrait de mentira: `venv/bin/python` y `pretrained_weights/`. */
function makeLivePortrait(dir: string, layout: 'flat' | 'nested' = 'flat'): void {
  mkdirSync(join(dir, 'venv', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'venv', 'bin', 'python'), '');
  mkdirSync(join(dir, ...(layout === 'nested' ? ['LivePortrait'] : []), 'pretrained_weights'), { recursive: true });
}

interface FakeCall {
  command: string;
  args: readonly string[];
  options: { env: NodeJS.ProcessEnv; stdio: unknown; shell?: unknown };
  killed: (NodeJS.Signals | undefined)[];
}

const argValue = (args: readonly string[], flag: string): string => {
  const i = args.indexOf(flag);
  expect(i, `falta ${flag}`).toBeGreaterThanOrEqual(0);
  return args[i + 1]!;
};

/**
 * Spawner falso: por cada clip pedido escribe `frames` PNG en `--out/<clip>/`, emite una línea
 * JSON de avance por cuadro y al final un resumen. `fail` lo hace salir con error a mitad.
 */
function fakeSpawner(
  calls: FakeCall[],
  opts: { frames?: number; fail?: boolean; hang?: boolean; noise?: boolean } = {},
): Spawner {
  return (command, args, options) => {
    const call: FakeCall = { command, args, options, killed: [] };
    calls.push(call);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      kill(signal?: NodeJS.Signals): boolean {
        call.killed.push(signal);
        setImmediate(() => {
          stdout.end();
          stderr.end();
          child.emit('close', null, signal ?? 'SIGTERM');
        });
        return true;
      },
    });
    void (async () => {
      const out = argValue(args, '--out');
      const clips = argValue(args, '--clips').split(',');
      const n = opts.frames ?? 17;
      if (opts.noise) stdout.write('Load cropper model...\n');
      for (const clip of clips) {
        mkdirSync(join(out, clip), { recursive: true });
        for (let i = 0; i < n; i++) {
          writeFileSync(join(out, clip, `${String(i).padStart(3, '0')}.png`), await solid(10 + i));
          stdout.write(`${JSON.stringify({ clip, frame: i + 1, total: n })}\n`);
          if (opts.hang) return; // se queda colgado hasta que lo maten
          if (opts.fail && i === 2) {
            stderr.write('Traceback...\nRuntimeError: MPS se quedó sin memoria\n');
            stdout.end();
            stderr.end();
            child.emit('close', 1, null);
            return;
          }
        }
      }
      stdout.write(`${JSON.stringify({ done: true, clips: Object.fromEntries(clips.map((c) => [c, { frames: n }])) })}\n`);
      stdout.end();
      stderr.end();
      setImmediate(() => child.emit('close', 0, null));
    })();
    return child as unknown as ChildHandle;
  };
}

const run = (extra: Partial<Parameters<typeof runMovimientos>[0]> = {}) =>
  runMovimientos({
    root,
    name: 'ana',
    liveportrait: lpDir,
    env: {},
    tmpBase,
    out: (s) => lines.push(s),
    ...extra,
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-mov-'));
  lpDir = join(root, 'lp');
  tmpBase = join(root, 'tmp');
  mkdirSync(tmpBase);
  lines = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('parseClipList', () => {
  it('acepta nombres separados por comas, sin espacios ni repetidos', () => {
    expect(parseClipList('nod, think,nod')).toEqual(['nod', 'think']);
  });

  it('rechaza un clip desconocido o una lista vacía, nombrando los válidos', () => {
    expect(() => parseClipList('nod,saltar')).toThrow(/saltar.*nod, tilt_left, tilt_right, turn_left, turn_right, think/);
    expect(() => parseClipList(' , ')).toThrow(/--clips/);
  });
});

describe('resolveLivePortraitDir', () => {
  it('manda la bandera, luego ASCII_AVATAR_LIVEPORTRAIT y luego la configuración', () => {
    const env = { ASCII_AVATAR_LIVEPORTRAIT: '/env/lp' };
    expect(resolveLivePortraitDir('/flag/lp', env, '/cfg/lp')).toBe('/flag/lp');
    expect(resolveLivePortraitDir(undefined, env, '/cfg/lp')).toBe('/env/lp');
    expect(resolveLivePortraitDir(undefined, { ASCII_AVATAR_LIVEPORTRAIT: '' }, '/cfg/lp')).toBe('/cfg/lp');
    expect(resolveLivePortraitDir(undefined, {}, undefined)).toBeUndefined();
  });

  it('expande ~ al inicio de la ruta', () => {
    expect(resolveLivePortraitDir('~/lp', {}, undefined)).toMatch(/^\/.+\/lp$/);
    expect(resolveLivePortraitDir('~/lp', {}, undefined)).not.toContain('~');
  });
});

describe('checkPrerequisites', () => {
  it('sin carpeta de LivePortrait explica cómo indicarla', async () => {
    await makeAgent();
    const r = checkPrerequisites(root, 'ana', undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/--liveportrait/);
      expect(r.message).toMatch(/ASCII_AVATAR_LIVEPORTRAIT/);
      expect(r.message).toMatch(/Movimientos fluidos/);
    }
  });

  it('avisa si la carpeta no existe', async () => {
    await makeAgent();
    const r = checkPrerequisites(root, 'ana', join(root, 'no-hay'));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/No existe la carpeta de LivePortrait/) });
  });

  it('avisa si falta venv/bin/python', async () => {
    await makeAgent();
    mkdirSync(join(lpDir, 'pretrained_weights'), { recursive: true });
    const r = checkPrerequisites(root, 'ana', lpDir);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/venv\/bin\/python/) });
  });

  it('avisa si faltan los pesos (pretrained_weights)', async () => {
    await makeAgent();
    mkdirSync(join(lpDir, 'venv', 'bin'), { recursive: true });
    writeFileSync(join(lpDir, 'venv', 'bin', 'python'), '');
    const r = checkPrerequisites(root, 'ana', lpDir);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/pretrained_weights[\s\S]*huggingface-cli download/) });
  });

  it('avisa si el agente no existe o no tiene faces/neutral.png', async () => {
    makeLivePortrait(lpDir);
    expect(checkPrerequisites(root, 'ana', lpDir)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/agente "ana" no existe/),
    });
    await makeAgent();
    rmSync(join(root, 'agents', 'ana', 'faces', 'neutral.png'));
    expect(checkPrerequisites(root, 'ana', lpDir)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/faces\/neutral\.png/),
    });
  });

  it('con todo en su sitio devuelve python, repositorio y foto neutral (también con LivePortrait/ dentro)', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    expect(checkPrerequisites(root, 'ana', lpDir)).toEqual({
      ok: true,
      python: join(lpDir, 'venv', 'bin', 'python'),
      repo: lpDir,
      source: join(root, 'agents', 'ana', 'faces', 'neutral.png'),
    });
    const nested = join(root, 'spike');
    makeLivePortrait(nested, 'nested');
    expect(checkPrerequisites(root, 'ana', nested)).toMatchObject({ ok: true, repo: join(nested, 'LivePortrait') });
  });
});

describe('runMovimientos', () => {
  it('lanza el Python del venv con el script, las rutas, los clips y PYTORCH_ENABLE_MPS_FALLBACK=1, sin shell', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    const calls: FakeCall[] = [];
    const r = await run({ clips: ['nod', 'think'], spawn: fakeSpawner(calls, { frames: 3 }), env: { PATH: '/usr/bin' } });
    expect(r.status).toBe('done');
    expect(calls).toHaveLength(1);
    const { command, args, options } = calls[0]!;
    expect(command).toBe(join(lpDir, 'venv', 'bin', 'python'));
    expect(args[0]).toBe(DEFAULT_SCRIPT);
    expect(DEFAULT_SCRIPT).toMatch(/tools\/liveportrait\/generate_clips\.py$/);
    expect(existsSync(DEFAULT_SCRIPT)).toBe(true);
    expect(argValue(args, '--liveportrait')).toBe(lpDir);
    expect(argValue(args, '--source')).toBe(join(root, 'agents', 'ana', 'faces', 'neutral.png'));
    expect(argValue(args, '--out').startsWith(tmpBase)).toBe(true);
    expect(argValue(args, '--clips')).toBe('nod,think');
    expect(options.env.PYTORCH_ENABLE_MPS_FALLBACK).toBe('1');
    expect(options.env.PATH).toBe('/usr/bin');
    expect(options.shell).toBeUndefined();
  });

  it('sin --clips genera los seis', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    const calls: FakeCall[] = [];
    const r = await run({ spawn: fakeSpawner(calls, { frames: 2 }) });
    expect(r.status).toBe('done');
    expect(argValue(calls[0]!.args, '--clips')).toBe('nod,tilt_left,tilt_right,turn_left,turn_right,think');
    expect(listClips(root, 'ana')).toEqual({ nod: 2, tilt_left: 2, tilt_right: 2, turn_left: 2, turn_right: 2, think: 2 });
  });

  it('importa los cuadros al terminar, informa el avance y borra la carpeta temporal', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    const calls: FakeCall[] = [];
    const progress: ClipProgress[] = [];
    const r = await run({ clips: ['nod'], spawn: fakeSpawner(calls, { noise: true }), progress: (p) => progress.push(p) });
    expect(r.status).toBe('done');
    expect(r.message).toMatch(/nod/);
    expect(lines[0]).toMatch(/^Generando nod con LivePortrait/);
    expect(listClips(root, 'ana')).toEqual({ nod: 17 });
    expect(progress).toHaveLength(17);
    expect(progress[0]).toEqual({ clip: 'nod', frame: 1, total: 17 });
    expect(progress[16]).toEqual({ clip: 'nod', frame: 17, total: 17 });
    expect(existsSync(argValue(calls[0]!.args, '--out'))).toBe(false);
    const frame5 = readFileSync(join(root, 'agents', 'ana', 'clips', 'nod', '005.png'));
    expect(frame5.equals(await solid(15))).toBe(true);
  });

  it('con --clips conserva los demás clips que el agente ya tenía', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    saveClips(root, 'ana', { think: [await solid(1), await solid(2), await solid(3)], nod: [await solid(4), await solid(5)] });
    const r = await run({ clips: ['nod'], spawn: fakeSpawner([], { frames: 4 }) });
    expect(r.status).toBe('done');
    expect(listClips(root, 'ana')).toEqual({ nod: 4, think: 3 });
    expect(readFileSync(join(root, 'agents', 'ana', 'clips', 'think', '002.png')).equals(await solid(3))).toBe(true);
  });

  it('guarda la carpeta de LivePortrait en la configuración tras un éxito', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    saveConfig(root, { ...loadConfig(root), voice: true });
    await run({ clips: ['nod'], spawn: fakeSpawner([], { frames: 2 }) });
    expect(loadConfig(root)).toMatchObject({ liveportraitDir: lpDir, voice: true });
  });

  it('usa la carpeta guardada en la configuración si no hay bandera ni variable', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    saveConfig(root, { ...loadConfig(root), liveportraitDir: lpDir });
    const calls: FakeCall[] = [];
    const r = await run({ liveportrait: undefined, clips: ['nod'], spawn: fakeSpawner(calls, { frames: 2 }) });
    expect(r.status).toBe('done');
    expect(calls[0]!.command).toBe(join(lpDir, 'venv', 'bin', 'python'));
  });

  it('si faltan requisitos no lanza nada', async () => {
    await makeAgent();
    const calls: FakeCall[] = [];
    const r = await run({ spawn: fakeSpawner(calls) });
    expect(r.status).toBe('failed');
    expect(calls).toHaveLength(0);
    expect(lines).toEqual([]); // no anuncia «Generando…» si no va a generar
  });

  it('si el proceso falla no importa nada, borra la carpeta temporal y muestra el error', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    saveClips(root, 'ana', { think: [await solid(1), await solid(2)] });
    const calls: FakeCall[] = [];
    const r = await run({ clips: ['nod'], spawn: fakeSpawner(calls, { fail: true }) });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/MPS se quedó sin memoria/);
    expect(listClips(root, 'ana')).toEqual({ think: 2 });
    expect(existsSync(argValue(calls[0]!.args, '--out'))).toBe(false);
  });

  it('si el proceso no se puede lanzar, falla con un mensaje claro', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    const spawn: Spawner = () => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })));
      return child as unknown as ChildHandle;
    };
    const r = await run({ clips: ['nod'], spawn });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/No se pudo lanzar[\s\S]*EACCES/);
    expect(listClips(root, 'ana')).toEqual({});
  });

  it('Ctrl-C (abort) mata solo a ese proceso por su handle, no importa y limpia', async () => {
    await makeAgent();
    makeLivePortrait(lpDir);
    const calls: FakeCall[] = [];
    const ac = new AbortController();
    const r = await run({
      clips: ['nod'],
      spawn: fakeSpawner(calls, { hang: true }),
      signal: ac.signal,
      progress: () => ac.abort(),
    });
    expect(r.status).toBe('cancelled');
    expect(calls[0]!.killed).toEqual(['SIGTERM']);
    expect(listClips(root, 'ana')).toEqual({});
    expect(existsSync(argValue(calls[0]!.args, '--out'))).toBe(false);
  });
});

describe('progressPrinter', () => {
  const collect = (isTTY: boolean) => {
    const chunks: string[] = [];
    return { chunks, stream: { isTTY, write: (s: string) => void chunks.push(s) } };
  };

  it('en una terminal redibuja la misma línea y salta al terminar cada clip', () => {
    const { chunks, stream } = collect(true);
    const p = progressPrinter(stream);
    p({ clip: 'nod', frame: 1, total: 2 });
    p({ clip: 'nod', frame: 2, total: 2 });
    expect(chunks[0]).toMatch(/^\r\x1b\[2K {2}nod .* 1\/2$/);
    expect(chunks.join('')).toMatch(/2\/2\n$/);
  });

  it('fuera de una terminal escribe una línea por clip terminado', () => {
    const { chunks, stream } = collect(false);
    const p = progressPrinter(stream);
    for (let i = 1; i <= 3; i++) p({ clip: 'think', frame: i, total: 3 });
    expect(chunks).toEqual(['  think: 3 cuadros\n']);
  });
});

describe('tools/liveportrait/generate_clips.py --plan', () => {
  const hasPython = spawnSync('python3', ['--version']).status === 0;

  it.skipIf(!hasPython)('define los seis clips con sus cuadros y empiezan y terminan en neutro', () => {
    const r = spawnSync('python3', ['-I', DEFAULT_SCRIPT, '--plan'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout) as Record<string, [number, number, number][]>;
    expect(Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length]))).toEqual({
      nod: 17,
      tilt_left: 14,
      tilt_right: 14,
      turn_left: 16,
      turn_right: 16,
      think: 18,
    });
    for (const frames of Object.values(plan)) {
      expect(frames[0]).toEqual([0, 0, 0]);
      expect(frames.at(-1)).toEqual([0, 0, 0]);
    }
    const peak = (clip: string, axis: number): number => Math.max(...plan[clip]!.map((a) => Math.abs(a[axis]!)));
    expect(peak('nod', 0)).toBeCloseTo(6);
    expect(plan.nod![13]![0]).toBeCloseTo(2.4);
    expect(peak('tilt_left', 2)).toBeCloseTo(6);
    expect(peak('turn_right', 1)).toBeCloseTo(9);
    expect(peak('think', 0)).toBeCloseTo(4);
    expect(peak('think', 1)).toBeCloseTo(5);
    // giro: tres cuadros sostenidos en el máximo
    expect(plan.turn_left!.filter((a) => Math.abs(Math.abs(a[1]) - 9) < 1e-9)).toHaveLength(4);
  });
});
