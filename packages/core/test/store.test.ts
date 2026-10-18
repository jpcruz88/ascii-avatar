import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
import {
  AgentExistsError,
  AgentNotFoundError,
  CorruptAgentError,
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
  vi.mocked(fs.renameSync).mockClear();
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

describe('escritura atómica', () => {
  it('saveFace no deja archivos .tmp en faces/', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    saveFace(root, 'luna', 'neutral', photo);
    const left = readdirSync(join(root, 'agents', 'luna', 'faces'));
    expect(left).toEqual(['neutral.png']);
  });

  it('un neutral.png.tmp suelto no cuenta como cara', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    writeFileSync(join(root, 'agents', 'luna', 'faces', 'neutral.png.tmp'), 'parcial');
    expect(missingFaces(root, 'luna')).toEqual([...FACE_IDS]);
    expect(missingFaces(root, 'luna')).toContain('neutral');
  });

  it('una escritura parcial (solo .tmp) deja la cara como faltante', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    writeFileSync(join(root, 'agents', 'luna', 'faces', 'smile.png.tmp'), 'parcial');
    saveFace(root, 'luna', 'neutral', photo);
    expect(missingFaces(root, 'luna')).toEqual(FACE_IDS.filter((id) => id !== 'neutral'));
    await expect(loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' })).rejects.toThrow(/smile/);
  });

  it('createAgent escribe agent.json al final y sin dejar .tmp', async () => {
    const photo = await png4x4(10);
    const dir = join(root, 'agents', 'luna');
    const photoAtRename: boolean[] = [];
    const real = vi.mocked(fs.renameSync).getMockImplementation()!;
    vi.mocked(fs.renameSync).mockImplementation(((from: string, to: string) => {
      if (String(to).endsWith('agent.json')) {
        photoAtRename.push(existsSync(join(dir, 'photo.png')));
        expect(existsSync(to)).toBe(false);
      }
      return real(from, to);
    }) as typeof fs.renameSync);
    createAgent(root, 'luna', photo);
    vi.mocked(fs.renameSync).mockReset();
    expect(photoAtRename).toEqual([true]);
    expect(readdirSync(dir).sort()).toEqual(['agent.json', 'faces', 'photo.png']);
  });

  it('un fallo al renombrar agent.json no deja agente a medias', async () => {
    const photo = await png4x4(10);
    const real = vi.mocked(fs.renameSync).getMockImplementation()!;
    vi.mocked(fs.renameSync).mockImplementation(((from: string, to: string) => {
      if (String(to).endsWith('agent.json')) throw new Error('disco lleno');
      return real(from, to);
    }) as typeof fs.renameSync);
    expect(() => createAgent(root, 'luna', photo)).toThrow('disco lleno');
    vi.mocked(fs.renameSync).mockReset();
    const dir = join(root, 'agents', 'luna');
    expect(existsSync(join(dir, 'agent.json'))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // Se puede reintentar: no queda un AgentExistsError permanente.
    expect(() => createAgent(root, 'luna', photo)).not.toThrow();
  });
});

describe('loadAgent con agent.json dañado', () => {
  function writeRaw(name: string, content: string): void {
    const dir = join(root, 'agents', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.json'), content);
  }
  const good = {
    name: 'luna',
    voice: 'Kore',
    personality: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    promptsVersion: 1,
  };

  it('JSON truncado lanza CorruptAgentError', () => {
    writeRaw('luna', '{"name": "lu');
    expect(() => loadAgent(root, 'luna')).toThrow(CorruptAgentError);
  });

  it.each([
    ['sin name', { ...good, name: undefined }],
    ['voice mal tipado', { ...good, voice: 3 }],
    ['personality mal tipada', { ...good, personality: null }],
    ['createdAt mal tipado', { ...good, createdAt: 5 }],
    ['promptsVersion mal tipada', { ...good, promptsVersion: '1' }],
    ['name distinto de la carpeta', { ...good, name: 'otro' }],
  ])('forma incorrecta (%s) lanza CorruptAgentError', (_t, value) => {
    writeRaw('luna', JSON.stringify(value));
    expect(() => loadAgent(root, 'luna')).toThrow(CorruptAgentError);
  });

  it('no es un objeto: lanza CorruptAgentError', () => {
    writeRaw('luna', 'null');
    expect(() => loadAgent(root, 'luna')).toThrow(CorruptAgentError);
    writeRaw('luna', '[]');
    expect(() => loadAgent(root, 'luna')).toThrow(CorruptAgentError);
  });

  it('el mensaje está en español', () => {
    writeRaw('luna', 'xx');
    expect(() => loadAgent(root, 'luna')).toThrow(/dañado|corrupto/i);
  });

  it('un agent.json válido sigue cargando', () => {
    writeRaw('luna', JSON.stringify(good));
    expect(loadAgent(root, 'luna')).toEqual(good);
  });
});
