import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FACE_IDS, loadAgent, missingFaces, type FaceId } from '@ascii-avatar/core';
import { loadConfig, saveConfig } from '../src/config.js';
import { runImportFaces } from '../src/commands/import-faces.js';

let root: string;
let facesDir: string;
let lines: string[];

const solid = (width: number, height: number, shade: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } } })
    .png()
    .toBuffer();

/** Escribe las caras de `facesDir`; `overrides` reemplaza el contenido de algunas. */
async function writeFaces(overrides: Partial<Record<FaceId, Buffer>> = {}, skip: FaceId[] = []): Promise<void> {
  mkdirSync(facesDir, { recursive: true });
  for (const [i, id] of FACE_IDS.entries()) {
    if (skip.includes(id)) continue;
    writeFileSync(join(facesDir, `${id}.png`), overrides[id] ?? (await solid(300, 400, 20 + i * 20)));
  }
}

const run = (extra: { name?: string; photoPath?: string } = {}) =>
  runImportFaces({ root, name: extra.name ?? 'ana', facesDir, ...(extra.photoPath ? { photoPath: extra.photoPath } : {}), out: (s) => lines.push(s) });

const agentDir = (name = 'ana'): string => join(root, 'agents', name);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
  facesDir = join(root, 'mis-caras');
  lines = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runImportFaces', () => {
  it('importa las 8 caras y crea el agente con neutral.png como foto base', async () => {
    await writeFaces();
    const result = await run();
    expect(result.status).toBe('done');
    expect(missingFaces(root, 'ana')).toEqual([]);
    expect(loadAgent(root, 'ana').name).toBe('ana');
    expect(readFileSync(join(agentDir(), 'photo.png')).equals(readFileSync(join(facesDir, 'neutral.png')))).toBe(true);
    // Sin Gemini: nada de ledger ni de secretos en la raíz.
    expect(existsSync(join(root, 'ledger.jsonl'))).toBe(false);
    expect(existsSync(join(root, 'secrets.json'))).toBe(false);
  });

  it('usa --foto como foto base si se da', async () => {
    await writeFaces();
    const photo = join(root, 'foto.jpg');
    const jpeg = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#789' } }).jpeg().toBuffer();
    writeFileSync(photo, jpeg);
    const result = await run({ photoPath: photo });
    expect(result.status).toBe('done');
    expect(readFileSync(join(agentDir(), 'photo.jpg')).equals(jpeg)).toBe(true);
    expect(existsSync(join(agentDir(), 'photo.png'))).toBe(false);
  });

  it('rechaza una --foto que no es imagen y no escribe nada', async () => {
    await writeFaces();
    const photo = join(root, 'foto.txt');
    writeFileSync(photo, 'hola');
    const result = await run({ photoPath: photo });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('PNG, JPG o WebP');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('falta una cara: failed con la lista exacta y sin escribir nada', async () => {
    await writeFaces({}, ['blink', 'sad']);
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('blink');
    expect(result.message).toContain('sad');
    expect(result.message).not.toContain('smile');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('una cara de otro tamaño: failed, nombra el archivo y no escribe nada', async () => {
    await writeFaces({ smile: await solid(300, 401, 99) });
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('smile.png');
    expect(result.message).toContain('300×400');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un .png que en realidad es JPEG: failed y nombra el archivo', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#222' } }).jpeg().toBuffer();
    await writeFaces({ surprised: jpeg });
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('surprised.png');
    expect(result.message).toContain('PNG');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('una cara de más de 10 MB: failed y nombra el archivo', async () => {
    const big = Buffer.concat([await solid(300, 400, 5), Buffer.alloc(10 * 1024 * 1024 + 1)]);
    await writeFaces({ sad: big });
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('sad.png');
    expect(result.message).toContain('10 MB');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un lado menor de 64 px: failed', async () => {
    const small = Buffer.from(await solid(32, 32, 50));
    await writeFaces(Object.fromEntries(FACE_IDS.map((id) => [id, small])) as Record<FaceId, Buffer>);
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('64');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un lado mayor de 8000 px: failed', async () => {
    const wide = await solid(8001, 64, 50);
    await writeFaces(Object.fromEntries(FACE_IDS.map((id) => [id, wide])) as Record<FaceId, Buffer>);
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('8000');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('una carpeta de caras inexistente: failed', async () => {
    const result = await run();
    expect(result.status).toBe('failed');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('agente existente: reemplaza las caras y deja agent.json y la foto intactos', async () => {
    await writeFaces();
    await run();
    const before = readFileSync(join(agentDir(), 'agent.json'), 'utf8');
    const photoBefore = readFileSync(join(agentDir(), 'photo.png'));
    mkdirSync(facesDir, { recursive: true });
    const fresh = await solid(300, 400, 250);
    await writeFaces(Object.fromEntries(FACE_IDS.map((id) => [id, fresh])) as Record<FaceId, Buffer>);
    const result = await run();
    expect(result.status).toBe('done');
    expect(readFileSync(join(agentDir(), 'agent.json'), 'utf8')).toBe(before);
    expect(readFileSync(join(agentDir(), 'photo.png')).equals(photoBefore)).toBe(true);
    expect(readFileSync(join(agentDir(), 'faces', 'blink.png')).equals(fresh)).toBe(true);
  });

  it('agente existente con caras inválidas: no cambia ninguna cara', async () => {
    await writeFaces();
    await run();
    const original = readFileSync(join(agentDir(), 'faces', 'neutral.png'));
    await writeFaces({ neutral: await solid(300, 400, 255), sad: await solid(100, 100, 1) });
    const result = await run();
    expect(result.status).toBe('failed');
    expect(readFileSync(join(agentDir(), 'faces', 'neutral.png')).equals(original)).toBe(true);
  });

  it('fija activeAgent si era null y no lo cambia si ya había uno', async () => {
    await writeFaces();
    await run();
    expect(loadConfig(root).activeAgent).toBe('ana');
    await run({ name: 'luis' });
    expect(loadConfig(root).activeAgent).toBe('ana');
  });

  it('respeta un activeAgent ya fijado', async () => {
    saveConfig(root, { ...loadConfig(root), activeAgent: 'otro' });
    await writeFaces();
    await run();
    expect(loadConfig(root).activeAgent).toBe('otro');
  });

  it('un nombre inválido: failed', async () => {
    await writeFaces();
    const result = await run({ name: '../x' });
    expect(result.status).toBe('failed');
    expect(existsSync(join(root, 'agents'))).toBe(false);
  });
});

describe('avatar create --caras (proceso real)', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const distBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
  // Sin llave, sin Gemini y con stdin cerrado: si pidiera la ruta de la foto o la llave, fallaría.
  const bin = (...args: string[]) =>
    spawnSync(process.execPath, [distBin, 'create', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', ASCII_AVATAR_HOME: root },
    });

  it('importa sin pedir foto ni llave y sale con 0; con caras incompletas sale con 1', async () => {
    const build = spawnSync('npx', ['tsc', '-b'], { cwd: repoRoot, encoding: 'utf8' });
    expect(build.status).toBe(0);
    await writeFaces({}, ['blink']);
    const bad = bin('ana', '--caras', facesDir);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('blink');
    expect(existsSync(agentDir())).toBe(false);
    await writeFaces();
    const ok = bin('ana', '--caras', facesDir);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('ana');
    expect(missingFaces(root, 'ana')).toEqual([]);
    expect(existsSync(join(root, 'secrets.json'))).toBe(false);
    expect(existsSync(join(root, 'ledger.jsonl'))).toBe(false);
    expect(loadConfig(root).activeAgent).toBe('ana');
  }, 120_000);

  it('--caras sin valor es un error de uso', () => {
    const r = bin('ana', '--caras');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--caras');
  });
});
