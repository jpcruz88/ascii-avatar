import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIP_IDS,
  FACE_IDS,
  FRAME_IDS,
  InvalidFaceImageError,
  POSE_IDS,
  atlasMotion,
  clipFrameId,
  createAgent,
  listClips,
  listPoses,
  loadAtlas,
  poseFrameId,
  saveClips,
  saveFace,
  savePoses,
  type FaceId,
} from '../src/index.js';

let root: string;
const dir = (): string => join(root, 'agents', 'luna');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function solid(v: number, width = 8, height = 8): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: v, g: v, b: v } } })
    .png()
    .toBuffer();
}

/** PNG sin compresión: su tamaño solo depende de las medidas, no del contenido. */
function stored(v: number): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: v, g: v, b: v } } })
    .png({ compressionLevel: 0, adaptiveFiltering: false })
    .toBuffer();
}

/** 100x100 con un cuadrado central gris 100 sobre un fondo `bg`. */
function conCuadro(bg: number): Promise<Buffer> {
  const data = Buffer.alloc(100 * 100 * 3, bg);
  for (let y = 20; y < 60; y++) {
    for (let x = 30; x < 70; x++) data.fill(100, (y * 100 + x) * 3, (y * 100 + x) * 3 + 3);
  }
  return sharp(data, { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
}

async function agentWithFaces(face: (id: FaceId) => Promise<Buffer> = () => solid(200)): Promise<void> {
  createAgent(root, 'luna', await solid(10));
  for (const id of FACE_IDS) saveFace(root, 'luna', id, await face(id));
}

describe('ids de poses y clips', () => {
  it('hay 8 poses y 6 clips, con ids de cuadro propios', () => {
    expect(POSE_IDS).toEqual(['tilt_left', 'tilt_right', 'nod_up', 'nod_down', 'turn_left', 'turn_right', 'look_left', 'look_right']);
    expect(CLIP_IDS).toEqual(['nod', 'tilt_left', 'tilt_right', 'turn_left', 'turn_right', 'think']);
    expect(poseFrameId('tilt_left')).toBe('pose:tilt_left');
    expect(clipFrameId('nod', 3)).toBe('clip:nod:3');
    // Los cuadros de base siguen siendo las 8 caras y las 2 bocas intermedias.
    expect(FRAME_IDS).toHaveLength(10);
  });
});

describe('savePoses y listPoses', () => {
  it('guarda las poses dadas y lista las que hay, en el orden de POSE_IDS', async () => {
    await agentWithFaces();
    savePoses(root, 'luna', { look_right: await solid(1), tilt_left: await solid(2) });
    expect(listPoses(root, 'luna')).toEqual(['tilt_left', 'look_right']);
    expect(existsSync(join(dir(), 'poses', 'tilt_left.png'))).toBe(true);
  });

  it('reemplaza el juego entero de poses y no deja temporales', async () => {
    await agentWithFaces();
    savePoses(root, 'luna', { look_right: await solid(1), tilt_left: await solid(2) });
    savePoses(root, 'luna', { nod_up: await solid(3) });
    expect(listPoses(root, 'luna')).toEqual(['nod_up']);
    expect(readdirSync(dir()).filter((f) => f.includes('.tmp') || f.includes('.old'))).toEqual([]);
  });

  it('un PNG falso o un id desconocido no escriben nada', async () => {
    await agentWithFaces();
    savePoses(root, 'luna', { nod_up: await solid(3) });
    const ok = await solid(1);
    expect(() => savePoses(root, 'luna', { tilt_left: ok, nod_down: Buffer.from('hola') })).toThrow(
      InvalidFaceImageError,
    );
    expect(() => savePoses(root, 'luna', { saludo: Buffer.alloc(0) } as never)).toThrow(/desconocida/i);
    expect(listPoses(root, 'luna')).toEqual(['nod_up']);
  });

  it('sin carpeta de poses, no hay poses', async () => {
    await agentWithFaces();
    expect(listPoses(root, 'luna')).toEqual([]);
  });
});

describe('saveClips y listClips', () => {
  it('guarda cada clip como 000.png, 001.png… y lista cuántos cuadros tiene', async () => {
    await agentWithFaces();
    saveClips(root, 'luna', { nod: [await solid(1), await solid(2), await solid(3)], think: [await solid(4), await solid(5)] });
    expect(listClips(root, 'luna')).toEqual({ nod: 3, think: 2 });
    expect(readdirSync(join(dir(), 'clips', 'nod')).sort()).toEqual(['000.png', '001.png', '002.png']);
  });

  it('un clip con un hueco en la numeración no se usa', async () => {
    await agentWithFaces();
    saveClips(root, 'luna', { nod: [await solid(1), await solid(2), await solid(3)], think: [await solid(4), await solid(5)] });
    rmSync(join(dir(), 'clips', 'nod', '001.png'));
    expect(listClips(root, 'luna')).toEqual({ think: 2 });
  });

  it('reemplaza el juego entero de clips; un PNG falso no escribe nada', async () => {
    await agentWithFaces();
    saveClips(root, 'luna', { nod: [await solid(1), await solid(2)] });
    const ok = await solid(1);
    expect(() => saveClips(root, 'luna', { think: [ok, Buffer.from('no')] })).toThrow(InvalidFaceImageError);
    expect(listClips(root, 'luna')).toEqual({ nod: 2 });
    saveClips(root, 'luna', { turn_left: [await solid(1), await solid(2)] });
    expect(listClips(root, 'luna')).toEqual({ turn_left: 2 });
  });
});

describe('loadAtlas con poses y clips', () => {
  it('sin poses ni clips da exactamente los cuadros de siempre', async () => {
    await agentWithFaces();
    const atlas = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(Object.keys(atlas).sort()).toEqual([...FRAME_IDS].sort());
    expect(atlasMotion(atlas)).toEqual({ poses: [], clips: {} });
  });

  it('convierte las poses y los cuadros de los clips con el mismo ancho y modo', async () => {
    await agentWithFaces();
    savePoses(root, 'luna', { look_left: await solid(0), tilt_right: await solid(240) });
    saveClips(root, 'luna', { nod: [await solid(0), await solid(120), await solid(240)] });
    const atlas = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(atlas['pose:look_left']!.cols).toBe(4);
    expect(atlas['pose:look_left']!.cells[0]!.ch).toBe(' ');
    expect(atlas['pose:tilt_right']!.cells[0]!.ch).toBe('%');
    expect([0, 1, 2].map((i) => atlas[clipFrameId('nod', i)]!.cells[0]!.ch)).toEqual([' ', '=', '%']);
    expect(atlasMotion(atlas)).toEqual({ poses: ['tilt_right', 'look_left'], clips: { nod: 3 } });
  });

  it('cada pose trae su cuadro de regreso ease:<pose>, mezcla a medias con neutral', async () => {
    await agentWithFaces((id) => solid(id === 'neutral' ? 240 : 200));
    savePoses(root, 'luna', { look_left: await solid(0) });
    const atlas = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs', cache: false });
    const ease = atlas['ease:look_left']!;
    expect(ease.cols).toBe(4);
    expect(ease.cells[0]!.fg).toEqual({ r: 120, g: 120, b: 120 });
    expect(atlas['ease:look_right']).toBeUndefined();
  });

  it('una pose de otro tamaño que las caras, o dañada, se descarta sin fallar', async () => {
    await agentWithFaces();
    mkdirSync(join(dir(), 'poses'), { recursive: true });
    writeFileSync(join(dir(), 'poses', 'look_left.png'), await solid(0, 16, 16));
    const broken = Buffer.concat([(await solid(0)).subarray(0, 8), Buffer.from('basura')]);
    writeFileSync(join(dir(), 'poses', 'look_right.png'), broken);
    writeFileSync(join(dir(), 'poses', 'nod_up.png'), await solid(0));
    const atlas = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(atlasMotion(atlas).poses).toEqual(['nod_up']);
  });

  it('en modo grabado las poses usan el tono de las 8 caras', async () => {
    await agentWithFaces((id) => conCuadro(id === 'neutral' ? 0 : 255));
    savePoses(root, 'luna', { look_left: await conCuadro(255) });
    const atlas = await loadAtlas(root, 'luna', { cols: 10, mode: 'grabado' });
    expect(atlas['pose:look_left']!.cells).toEqual(atlas.smile.cells);
  });
});

describe('caché de cuadros convertidos', () => {
  it('se escribe en .cache/ sin temporales y la segunda carga da lo mismo', async () => {
    await agentWithFaces();
    savePoses(root, 'luna', { look_left: await solid(0) });
    saveClips(root, 'luna', { nod: [await solid(0), await solid(120)] });
    const first = await loadAtlas(root, 'luna', { cols: 4, mode: 'grabado' });
    const files = readdirSync(join(dir(), '.cache'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const second = await loadAtlas(root, 'luna', { cols: 4, mode: 'grabado' });
    expect(second).toEqual(first);
  });

  it('usa el cuadro guardado mientras el archivo conserve fecha y tamaño', async () => {
    await agentWithFaces();
    const file = join(dir(), 'poses', 'look_left.png');
    savePoses(root, 'luna', { look_left: await stored(0) });
    // Fecha en segundos enteros, para poder restaurarla exacta (utimes no guarda fracciones de ms).
    const mtime = new Date(1_700_000_000_000);
    utimesSync(file, mtime, mtime);
    const first = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    // Mismo tamaño y misma fecha, otro contenido: la caché no lo nota (prueba de que se usó).
    const { size } = statSync(file);
    const other = await stored(240);
    expect(other.length).toBe(size);
    writeFileSync(file, other);
    utimesSync(file, mtime, mtime);
    const cached = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(cached['pose:look_left']).toEqual(first['pose:look_left']);
    // Con otra fecha, se vuelve a convertir.
    utimesSync(file, new Date(mtime.getTime() + 5000), new Date(mtime.getTime() + 5000));
    const fresh = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(fresh['pose:look_left']!.cells[0]!.ch).toBe('%');
  });

  it('otro ancho u otro modo no reutilizan cuadros de otra configuración', async () => {
    await agentWithFaces();
    const a = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    const b = await loadAtlas(root, 'luna', { cols: 6, mode: 'glyphs' });
    const c = await loadAtlas(root, 'luna', { cols: 4, mode: 'halfblock' });
    expect(a.neutral.cols).toBe(4);
    expect(b.neutral.cols).toBe(6);
    expect(c.neutral.cells[0]!.ch).toBe('▀');
  });

  it('una caché dañada se ignora y se rehace', async () => {
    await agentWithFaces();
    const first = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    for (const f of readdirSync(join(dir(), '.cache'))) writeFileSync(join(dir(), '.cache', f), 'basura');
    const again = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(again).toEqual(first);
    const rewritten = readdirSync(join(dir(), '.cache')).map((f) => readFileSync(join(dir(), '.cache', f), 'latin1'));
    expect(rewritten.every((t) => t !== 'basura')).toBe(true);
  });

  it('si las caras cambian, el tono cambia y nada viejo se reutiliza', async () => {
    await agentWithFaces((id) => conCuadro(id === 'neutral' ? 0 : 255));
    savePoses(root, 'luna', { look_left: await conCuadro(255) });
    await loadAtlas(root, 'luna', { cols: 10, mode: 'grabado' });
    for (const id of FACE_IDS) saveFace(root, 'luna', id, await conCuadro(255));
    const after = await loadAtlas(root, 'luna', { cols: 10, mode: 'grabado' });
    expect(after['pose:look_left']!.cells).toEqual(after.smile.cells);
  });
});
