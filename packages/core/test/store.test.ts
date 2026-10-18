import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentExistsError,
  AgentNotFoundError,
  FACE_IDS,
  InvalidAgentNameError,
  InvalidPhotoError,
  createAgent,
  loadAgent,
  loadAtlas,
  missingFaces,
  saveFace,
  validateAgentName,
  type FaceId,
} from '../src/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function png4x4(v: number): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: v, g: v, b: v } },
  })
    .png()
    .toBuffer();
}

describe('validateAgentName', () => {
  it('rechaza rutas y mayúsculas', () => {
    expect(() => validateAgentName('../x')).toThrow(InvalidAgentNameError);
    expect(() => validateAgentName('Ab')).toThrow(InvalidAgentNameError);
    expect(() => validateAgentName('')).toThrow(InvalidAgentNameError);
    expect(() => validateAgentName('a'.repeat(33))).toThrow(InvalidAgentNameError);
    expect(() => validateAgentName('a/b')).toThrow(InvalidAgentNameError);
  });

  it('acepta nombres válidos', () => {
    expect(() => validateAgentName('luna-2')).not.toThrow();
    expect(() => validateAgentName('a'.repeat(32))).not.toThrow();
  });
});

describe('createAgent / loadAgent', () => {
  it('crea agent.json y la foto, y loadAgent lo lee', async () => {
    const photo = await png4x4(10);
    const cfg = createAgent(root, 'luna-2', photo, { personality: 'cálida' });
    expect(cfg.name).toBe('luna-2');
    expect(cfg.voice).toBe('Kore');
    expect(cfg.personality).toBe('cálida');
    expect(cfg.promptsVersion).toBe(1);
    expect(Number.isNaN(Date.parse(cfg.createdAt))).toBe(false);
    expect(loadAgent(root, 'luna-2')).toEqual(cfg);
    expect(readFileSync(join(root, 'agents', 'luna-2', 'photo.png')).equals(photo)).toBe(true);
  });

  it('usa los valores por defecto y respeta opts', async () => {
    const photo = await png4x4(10);
    const a = createAgent(root, 'a', photo);
    expect(a.voice).toBe('Kore');
    expect(a.personality).toBe('');
    const b = createAgent(root, 'b', photo, { voice: 'Puck', promptsVersion: 3 });
    expect(b.voice).toBe('Puck');
    expect(b.promptsVersion).toBe(3);
  });

  it('deduce la extensión de los bytes mágicos', () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
    ]);
    createAgent(root, 'j', jpg);
    createAgent(root, 'w', webp);
    expect(existsSync(join(root, 'agents', 'j', 'photo.jpg'))).toBe(true);
    expect(existsSync(join(root, 'agents', 'w', 'photo.webp'))).toBe(true);
  });

  it('rechaza una foto que no es png, jpg ni webp', () => {
    expect(() => createAgent(root, 'x', Buffer.from('hola mundo'))).toThrow(InvalidPhotoError);
    expect(existsSync(join(root, 'agents', 'x'))).toBe(false);
  });

  it('no pisa un agente existente', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    expect(() => createAgent(root, 'luna', photo)).toThrow(AgentExistsError);
  });

  it('valida el nombre en todas las funciones', async () => {
    const photo = await png4x4(10);
    expect(() => createAgent(root, '../x', photo)).toThrow(InvalidAgentNameError);
    expect(() => loadAgent(root, '../x')).toThrow(InvalidAgentNameError);
    expect(() => missingFaces(root, '../x')).toThrow(InvalidAgentNameError);
    expect(() => saveFace(root, '../x', 'neutral', photo)).toThrow(InvalidAgentNameError);
    await expect(loadAtlas(root, '../x', { cols: 4, mode: 'glyphs' })).rejects.toThrow(
      InvalidAgentNameError,
    );
  });

  it('loadAgent falla con un agente inexistente', () => {
    expect(() => loadAgent(root, 'nadie')).toThrow(AgentNotFoundError);
  });
});

describe('caras', () => {
  it('missingFaces devuelve las 8 al inicio y 7 tras guardar neutral', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    expect(missingFaces(root, 'luna')).toEqual([...FACE_IDS]);
    saveFace(root, 'luna', 'neutral', photo);
    const rest = missingFaces(root, 'luna');
    expect(rest).toHaveLength(7);
    expect(rest).not.toContain('neutral');
    expect(rest).toEqual(FACE_IDS.filter((id) => id !== 'neutral'));
  });

  it('saveFace rechaza un id desconocido', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    expect(() => saveFace(root, 'luna', '../evil' as FaceId, photo)).toThrow();
    expect(() => saveFace(root, 'luna', 'mouth_closed' as FaceId, photo)).toThrow();
  });
});

describe('loadAtlas', () => {
  it('devuelve 8 cuadros del ancho pedido', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    for (const id of FACE_IDS) saveFace(root, 'luna', id, await png4x4(200));
    const atlas = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(Object.keys(atlas).sort()).toEqual([...FACE_IDS].sort());
    for (const id of FACE_IDS) expect(atlas[id].cols).toBe(4);
  });

  it('falla en español listando las caras que faltan', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    saveFace(root, 'luna', 'neutral', photo);
    await expect(loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' })).rejects.toThrow(
      /faltan.*mouth_mid.*sad/i,
    );
  });
});
