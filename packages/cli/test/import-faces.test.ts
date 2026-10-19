import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FACE_IDS, listClips, listPoses, loadAgent, missingFaces, type FaceId } from '@ascii-avatar/core';
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

describe('runImportFaces con --poses y --clips', () => {
  let posesDir: string;
  let clipsDir: string;

  beforeEach(() => {
    posesDir = join(root, 'mis-poses');
    clipsDir = join(root, 'mis-clips');
  });

  async function writePoses(ids: string[] = ['look_left', 'tilt_right'], over: Record<string, Buffer> = {}): Promise<void> {
    mkdirSync(posesDir, { recursive: true });
    for (const [i, id] of ids.entries()) writeFileSync(join(posesDir, `${id}.png`), over[id] ?? (await solid(300, 400, 30 + i)));
  }

  async function writeClip(clip: string, files: string[] = ['000.png', '001.png', '002.png'], over: Record<string, Buffer> = {}): Promise<void> {
    mkdirSync(join(clipsDir, clip), { recursive: true });
    for (const [i, f] of files.entries()) writeFileSync(join(clipsDir, clip, f), over[f] ?? (await solid(300, 400, 60 + i)));
  }

  const runWith = (extra: { faces?: boolean; poses?: boolean; clips?: boolean } = {}) =>
    runImportFaces({
      root,
      name: 'ana',
      ...(extra.faces === false ? {} : { facesDir }),
      ...(extra.poses ? { posesDir } : {}),
      ...(extra.clips ? { clipsDir } : {}),
      out: (s) => lines.push(s),
    });

  it('importa caras, poses y clips juntos, sin Gemini', async () => {
    await writeFaces();
    await writePoses();
    await writeClip('nod');
    await writeClip('think', ['000.png', '001.png']);
    const result = await runWith({ poses: true, clips: true });
    expect(result.status).toBe('done');
    expect(listPoses(root, 'ana')).toEqual(['tilt_right', 'look_left']);
    expect(listClips(root, 'ana')).toEqual({ nod: 3, think: 2 });
    expect(result.message).toMatch(/2 poses/);
    expect(result.message).toMatch(/2 clips/);
    expect(existsSync(join(root, 'ledger.jsonl'))).toBe(false);
  });

  it('agrega poses a un agente existente sin tocar sus caras ni agent.json', async () => {
    await writeFaces();
    await run();
    const agentJson = readFileSync(join(agentDir(), 'agent.json'), 'utf8');
    const neutral = readFileSync(join(agentDir(), 'faces', 'neutral.png'));
    rmSync(facesDir, { recursive: true });
    await writePoses(['nod_up']);
    const result = await runWith({ faces: false, poses: true });
    expect(result.status).toBe('done');
    expect(listPoses(root, 'ana')).toEqual(['nod_up']);
    expect(readFileSync(join(agentDir(), 'agent.json'), 'utf8')).toBe(agentJson);
    expect(readFileSync(join(agentDir(), 'faces', 'neutral.png')).equals(neutral)).toBe(true);
  });

  it('agrega clips a un agente existente y reemplaza los que tenía', async () => {
    await writeFaces();
    await writeClip('nod');
    await runWith({ clips: true });
    rmSync(clipsDir, { recursive: true });
    await writeClip('turn_left');
    const result = await runWith({ faces: false, clips: true });
    expect(result.status).toBe('done');
    expect(listClips(root, 'ana')).toEqual({ turn_left: 3 });
  });

  it('poses sin caras para un agente que no existe: failed, pide --caras y no escribe nada', async () => {
    await writePoses();
    const result = await runWith({ faces: false, poses: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('--caras');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('una pose de otro tamaño que las caras: failed, nombra el archivo y no escribe nada', async () => {
    await writeFaces();
    await writePoses(['look_left', 'nod_down'], { nod_down: await solid(301, 400, 9) });
    const result = await runWith({ poses: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('nod_down.png');
    expect(result.message).toContain('300×400');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('el tamaño de referencia de un agente existente son sus caras', async () => {
    await writeFaces();
    await run();
    rmSync(facesDir, { recursive: true });
    await writePoses(['look_left'], { look_left: await solid(200, 200, 9) });
    const result = await runWith({ faces: false, poses: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('look_left.png');
    expect(listPoses(root, 'ana')).toEqual([]);
  });

  it('una pose que no es PNG o con un nombre desconocido: failed y nombra el archivo', async () => {
    await writeFaces();
    const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#222' } }).jpeg().toBuffer();
    await writePoses(['look_left'], { look_left: jpeg });
    let result = await runWith({ poses: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('look_left.png');
    expect(result.message).toContain('PNG');
    rmSync(posesDir, { recursive: true });
    await writePoses(['look-left']);
    result = await runWith({ poses: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('look-left.png');
    expect(result.message).toContain('look_left');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('una carpeta de poses sin poses: failed', async () => {
    await writeFaces();
    mkdirSync(posesDir, { recursive: true });
    const result = await runWith({ poses: true });
    expect(result.status).toBe('failed');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('ignora los archivos ocultos y los que no son .png', async () => {
    await writeFaces();
    await writePoses(['look_left']);
    writeFileSync(join(posesDir, '.cost.json'), '{}');
    writeFileSync(join(posesDir, 'notas.txt'), 'hola');
    await writeClip('nod');
    writeFileSync(join(clipsDir, 'nod', '.DS_Store'), 'x');
    writeFileSync(join(clipsDir, '.DS_Store'), 'x');
    const result = await runWith({ poses: true, clips: true });
    expect(result.status).toBe('done');
    expect(listPoses(root, 'ana')).toEqual(['look_left']);
    expect(listClips(root, 'ana')).toEqual({ nod: 3 });
  });

  it('un clip con un hueco en la numeración: failed, dice qué cuadro falta y no escribe nada', async () => {
    await writeFaces();
    await writeClip('nod', ['000.png', '001.png', '003.png']);
    const result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('nod');
    expect(result.message).toContain('002.png');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un clip que no empieza en 000 o con nombres raros: failed', async () => {
    await writeFaces();
    await writeClip('nod', ['001.png', '002.png']);
    expect((await runWith({ clips: true })).message).toContain('000.png');
    rmSync(clipsDir, { recursive: true });
    await writeClip('nod', ['000.png', 'cuadro1.png']);
    expect((await runWith({ clips: true })).message).toContain('cuadro1.png');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un clip desconocido, de un solo cuadro o con un cuadro de otro tamaño: failed', async () => {
    await writeFaces();
    await writeClip('saludo');
    let result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('saludo');
    expect(result.message).toContain('nod');
    rmSync(clipsDir, { recursive: true });
    await writeClip('nod', ['000.png']);
    result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('nod');
    rmSync(clipsDir, { recursive: true });
    await writeClip('nod', ['000.png', '001.png'], { '001.png': await solid(300, 300, 1) });
    result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('001.png');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('una carpeta de clips sin subcarpetas de clips (p. ej. un clip suelto): failed y lo explica', async () => {
    await writeFaces();
    mkdirSync(clipsDir, { recursive: true });
    writeFileSync(join(clipsDir, '000.png'), await solid(300, 400, 1));
    const result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('nod');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un enlace roto en la carpeta de clips da un mensaje claro en español', async () => {
    await writeFaces();
    mkdirSync(clipsDir, { recursive: true });
    symlinkSync(join(root, 'no-existe'), join(clipsDir, 'nod'));
    const result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('nod');
    expect(result.message).toMatch(/enlace/i);
    expect(result.message).not.toContain('ENOENT');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un clip de más de 120 cuadros: failed y dice el máximo', async () => {
    await writeFaces();
    const png = await solid(300, 400, 61);
    mkdirSync(join(clipsDir, 'nod'), { recursive: true });
    for (let i = 0; i < 121; i++) writeFileSync(join(clipsDir, 'nod', `${String(i).padStart(3, '0')}.png`), png);
    const result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('120');
    expect(existsSync(agentDir())).toBe(false);
  });

  it('un error inesperado al escribir dice qué tipo de asset falló', async () => {
    await writeFaces();
    await run();
    await writeClip('nod');
    chmodSync(agentDir(), 0o555);
    try {
      const result = await runWith({ faces: false, clips: true });
      expect(result.status).toBe('failed');
      expect(result.message).toMatch(/^No se pudieron importar los clips:/);
    } finally {
      chmodSync(agentDir(), 0o755);
    }
  });

  it('reimportar caras de otro tamaño avisa que las poses y clips actuales se ignorarán', async () => {
    await writeFaces();
    await writePoses(['look_left']);
    await writeClip('nod');
    await runWith({ poses: true, clips: true });
    rmSync(facesDir, { recursive: true });
    const small = await solid(200, 200, 40);
    await writeFaces(Object.fromEntries(FACE_IDS.map((id) => [id, small])) as Record<FaceId, Buffer>);
    lines = [];
    const result = await runWith();
    expect(result.status).toBe('done');
    const warning = lines.join('\n');
    expect(warning).toMatch(/poses/);
    expect(warning).toMatch(/clips/);
    expect(warning).toContain('200×200');
    expect(warning).toMatch(/ignorar/i);
  });

  it('con caras válidas pero clips inválidos no escribe nada, ni siquiera las caras', async () => {
    await writeFaces();
    await run();
    const neutral = readFileSync(join(agentDir(), 'faces', 'neutral.png'));
    await writeFaces({ neutral: await solid(300, 400, 254) });
    await writeClip('nod', ['000.png', '002.png']);
    const result = await runWith({ clips: true });
    expect(result.status).toBe('failed');
    expect(readFileSync(join(agentDir(), 'faces', 'neutral.png')).equals(neutral)).toBe(true);
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
    // Poses solas en un agente que ya existe: tampoco pide foto ni llave.
    const posesDir = join(root, 'mis-poses');
    mkdirSync(posesDir, { recursive: true });
    writeFileSync(join(posesDir, 'look_left.png'), await solid(300, 400, 77));
    const poses = bin('ana', '--poses', posesDir);
    expect(poses.status).toBe(0);
    expect(listPoses(root, 'ana')).toEqual(['look_left']);
    expect(bin('ana', '--clips').status).toBe(1);
  }, 120_000);

  it('--caras sin valor es un error de uso', () => {
    const r = bin('ana', '--caras');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--caras');
  });
});
