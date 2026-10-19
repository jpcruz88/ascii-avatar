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
  FRAME_IDS,
  InvalidAgentNameError,
  InvalidFaceImageError,
  InvalidPhotoError,
  InvalidVoiceError,
  createAgent,
  loadAgent,
  loadAtlas,
  missingFaces,
  saveFace,
  updateAgentVoice,
  validateAgentName,
  type FaceId,
  type FrameId,
} from '../src/index.js';
import { blendImages } from '../src/ascii/blend.js';

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

  it('guarda el estilo de creación si se indica; sin indicarlo no escribe el campo', async () => {
    const photo = await png4x4(10);
    const g = createAgent(root, 'g', photo, { style: 'grabado' });
    expect(g.style).toBe('grabado');
    expect(loadAgent(root, 'g').style).toBe('grabado');
    expect(createAgent(root, 'f', photo, { style: 'foto' }).style).toBe('foto');
    const legacy = createAgent(root, 'l', photo);
    expect('style' in legacy).toBe(false);
    expect(loadAgent(root, 'l').style).toBeUndefined();
  });

  it('updateAgentVoice conserva el estilo de creación', async () => {
    createAgent(root, 'g', await png4x4(10), { style: 'grabado' });
    expect(updateAgentVoice(root, 'g', { voice: 'Puck' }).style).toBe('grabado');
    expect(loadAgent(root, 'g').style).toBe('grabado');
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

describe('saveFace: contrato PNG', () => {
  it('rechaza bytes de JPEG con InvalidFaceImageError y no escribe nada', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toBuffer();
    expect(() => saveFace(root, 'luna', 'neutral', jpeg)).toThrow(InvalidFaceImageError);
    expect(() => saveFace(root, 'luna', 'neutral', jpeg)).toThrow(/PNG/);
    expect(missingFaces(root, 'luna')).toEqual([...FACE_IDS]);
  });

  it('rechaza un buffer vacío o basura', async () => {
    createAgent(root, 'luna', await png4x4(10));
    expect(() => saveFace(root, 'luna', 'neutral', Buffer.alloc(0))).toThrow(InvalidFaceImageError);
    expect(() => saveFace(root, 'luna', 'neutral', Buffer.from('no soy png'))).toThrow(InvalidFaceImageError);
  });
});

describe('loadAtlas', () => {
  it('devuelve las 8 caras y los 2 cuadros intermedios de boca, del ancho pedido', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    for (const id of FACE_IDS) saveFace(root, 'luna', id, await png4x4(200));
    const atlas = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    expect(FRAME_IDS).toHaveLength(10);
    expect(Object.keys(atlas).sort()).toEqual([...FRAME_IDS].sort());
    expect(Object.keys(atlas)).toEqual(expect.arrayContaining(['mouth_q1', 'mouth_q3']));
    for (const id of FRAME_IDS) expect(atlas[id].cols).toBe(4);
  });

  it('los cuadros intermedios mezclan sus vecinas: distintos de ambas y entre sí', async () => {
    createAgent(root, 'luna', await png4x4(10));
    const gray: Partial<Record<FaceId, number>> = { neutral: 0, mouth_mid: 120, mouth_open: 240 };
    for (const id of FACE_IDS) saveFace(root, 'luna', id, await png4x4(gray[id] ?? 200));
    const atlas = await loadAtlas(root, 'luna', { cols: 4, mode: 'glyphs' });
    const ch = (id: FrameId): string => atlas[id].cells[0]!.ch;
    // Rampa ' .:-=+*#%@': 0 → ' ', 60 → ':', 120 → '=', 180 → '*', 240 → '%'.
    expect([ch('neutral'), ch('mouth_q1'), ch('mouth_mid'), ch('mouth_q3'), ch('mouth_open')]).toEqual([
      ' ',
      ':',
      '=',
      '*',
      '%',
    ]);
    expect(atlas.mouth_q1.cells[0]!.fg).toEqual({ r: 60, g: 60, b: 60 });
    expect(atlas.mouth_q3.cells[0]!.fg).toEqual({ r: 180, g: 180, b: 180 });
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
    ['voiceStyle numérico', { ...good, voiceStyle: 3 }],
    ['voiceStyle null', { ...good, voiceStyle: null }],
    ['style desconocido', { ...good, style: 'acuarela' }],
    ['style numérico', { ...good, style: 1 }],
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

  it('sin voiceStyle carga sin esa clave', () => {
    writeRaw('luna', JSON.stringify(good));
    expect(loadAgent(root, 'luna').voiceStyle).toBeUndefined();
  });

  it('con voiceStyle de texto lo conserva', () => {
    writeRaw('luna', JSON.stringify({ ...good, voiceStyle: 'pausada y cálida' }));
    expect(loadAgent(root, 'luna').voiceStyle).toBe('pausada y cálida');
  });
});

describe('voiceStyle en createAgent', () => {
  it('guarda el estilo cuando se indica y se puede volver a leer', async () => {
    const photo = await png4x4(10);
    const cfg = createAgent(root, 'luna', photo, { voice: 'Algenib', voiceStyle: 'grave y pausada' });
    expect(cfg.voiceStyle).toBe('grave y pausada');
    expect(loadAgent(root, 'luna')).toEqual(cfg);
  });

  it('sin estilo no escribe la clave voiceStyle', async () => {
    const photo = await png4x4(10);
    createAgent(root, 'luna', photo);
    const raw = JSON.parse(readFileSync(join(root, 'agents', 'luna', 'agent.json'), 'utf8'));
    expect('voiceStyle' in raw).toBe(false);
  });

  it('rechaza un estilo de más de 300 caracteres sin crear nada', async () => {
    const photo = await png4x4(10);
    expect(() => createAgent(root, 'luna', photo, { voiceStyle: 'x'.repeat(301) })).toThrow(
      InvalidVoiceError,
    );
    expect(existsSync(join(root, 'agents', 'luna'))).toBe(false);
    expect(() => createAgent(root, 'luna', photo, { voiceStyle: 'x'.repeat(300) })).not.toThrow();
  });
});

describe('updateAgentVoice', () => {
  const agentFile = (): string => join(root, 'agents', 'luna', 'agent.json');

  async function crear(): Promise<void> {
    createAgent(root, 'luna', await png4x4(10), { personality: 'cálida' });
  }

  it('cambia la voz y conserva el resto', async () => {
    await crear();
    const before = loadAgent(root, 'luna');
    const after = updateAgentVoice(root, 'luna', { voice: 'Algenib' });
    expect(after).toEqual({ ...before, voice: 'Algenib' });
    expect(loadAgent(root, 'luna')).toEqual(after);
  });

  it('cambia el estilo sin tocar la voz', async () => {
    await crear();
    const after = updateAgentVoice(root, 'luna', { voiceStyle: 'un hombre mexicano de sesenta años' });
    expect(after.voice).toBe('Kore');
    expect(loadAgent(root, 'luna').voiceStyle).toBe('un hombre mexicano de sesenta años');
  });

  it('voiceStyle vacío quita el estilo del archivo', async () => {
    await crear();
    updateAgentVoice(root, 'luna', { voiceStyle: 'grave' });
    const after = updateAgentVoice(root, 'luna', { voiceStyle: '' });
    expect(after.voiceStyle).toBeUndefined();
    const raw = JSON.parse(readFileSync(agentFile(), 'utf8'));
    expect('voiceStyle' in raw).toBe(false);
    expect(loadAgent(root, 'luna').voiceStyle).toBeUndefined();
  });

  it('sin cambios pedidos no altera nada', async () => {
    await crear();
    const before = readFileSync(agentFile(), 'utf8');
    updateAgentVoice(root, 'luna', {});
    expect(readFileSync(agentFile(), 'utf8')).toBe(before);
  });

  it('rechaza un estilo de más de 300 caracteres y una voz vacía, sin escribir', async () => {
    await crear();
    const before = readFileSync(agentFile(), 'utf8');
    expect(() => updateAgentVoice(root, 'luna', { voiceStyle: 'x'.repeat(301) })).toThrow(
      InvalidVoiceError,
    );
    expect(() => updateAgentVoice(root, 'luna', { voice: '   ' })).toThrow(InvalidVoiceError);
    expect(readFileSync(agentFile(), 'utf8')).toBe(before);
  });

  it('valida el nombre y exige que el agente exista', () => {
    expect(() => updateAgentVoice(root, '../x', { voice: 'Kore' })).toThrow(InvalidAgentNameError);
    expect(() => updateAgentVoice(root, 'nadie', { voice: 'Kore' })).toThrow(AgentNotFoundError);
  });

  it('no repara un agent.json dañado: lanza CorruptAgentError y lo deja igual', async () => {
    await crear();
    writeFileSync(agentFile(), '{"name": "lu');
    expect(() => updateAgentVoice(root, 'luna', { voice: 'Kore' })).toThrow(CorruptAgentError);
    expect(readFileSync(agentFile(), 'utf8')).toBe('{"name": "lu');
  });

  it('escribe de forma atómica: renombra un temporal sobre agent.json y no deja .tmp', async () => {
    await crear();
    vi.mocked(fs.renameSync).mockClear();
    updateAgentVoice(root, 'luna', { voice: 'Algenib' });
    const calls = vi.mocked(fs.renameSync).mock.calls.filter(([, to]) => String(to) === agentFile());
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toMatch(/agent\.json\..+\.tmp$/);
    expect(readdirSync(join(root, 'agents', 'luna')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('si falla el renombrado, el agent.json original queda intacto y sin .tmp', async () => {
    await crear();
    const before = readFileSync(agentFile(), 'utf8');
    const real = vi.mocked(fs.renameSync).getMockImplementation()!;
    vi.mocked(fs.renameSync).mockImplementation(((from: string, to: string) => {
      if (String(to).endsWith('agent.json')) throw new Error('disco lleno');
      return real(from, to);
    }) as typeof fs.renameSync);
    expect(() => updateAgentVoice(root, 'luna', { voice: 'Algenib' })).toThrow('disco lleno');
    vi.mocked(fs.renameSync).mockReset();
    expect(readFileSync(agentFile(), 'utf8')).toBe(before);
    expect(readdirSync(join(root, 'agents', 'luna')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('loadAtlas en modo grabado', () => {
  /** 100x100 con un cuadrado central gris 100 sobre un fondo `bg`. */
  function conCuadro(bg: number): Promise<Buffer> {
    const data = Buffer.alloc(100 * 100 * 3, bg);
    for (let y = 20; y < 60; y++) {
      for (let x = 30; x < 70; x++) data.fill(100, (y * 100 + x) * 3, (y * 100 + x) * 3 + 3);
    }
    return sharp(data, { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
  }

  it('usa un solo rango de tono para las 8 caras: el mismo gris da el mismo carácter', async () => {
    createAgent(root, 'luna', await png4x4(10));
    for (const id of FACE_IDS) saveFace(root, 'luna', id, await conCuadro(id === 'neutral' ? 0 : 255));
    const atlas = await loadAtlas(root, 'luna', { cols: 10, mode: 'grabado' });
    // Fila 1, columna 4: dentro del cuadrado y lejos del borde (el viñeteado casi no lo toca).
    const cell = (id: FaceId): string => atlas[id].cells[1 * 10 + 4]!.ch;
    expect(cell('neutral')).toBe(cell('smile'));
    expect(cell('neutral')).not.toBe(' ');
  });

  it('los cuadros intermedios usan el mismo modo y tono: la boca a medias da caracteres propios', async () => {
    /** 100x100 blanco con una boca oscura de `alto` filas, centrada en la fila 60. */
    function boca(alto: number): Promise<Buffer> {
      const data = Buffer.alloc(100 * 100 * 3, 255);
      for (let y = 20; y < 30; y++) data.fill(0, (y * 100 + 30) * 3, (y * 100 + 70) * 3); // cejas
      for (let y = 60 - alto / 2; y < 60 + alto / 2; y++) data.fill(0, (y * 100 + 30) * 3, (y * 100 + 70) * 3);
      return sharp(data, { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
    }
    createAgent(root, 'luna', await png4x4(10));
    const alto: Partial<Record<FaceId, number>> = { neutral: 4, mouth_mid: 16, mouth_open: 32 };
    for (const id of FACE_IDS) saveFace(root, 'luna', id, await boca(alto[id] ?? 4));
    const atlas = await loadAtlas(root, 'luna', { cols: 20, mode: 'grabado' });
    const text = (id: FrameId): string => atlas[id].cells.map((c) => c.ch).join('');
    const order: FrameId[] = ['neutral', 'mouth_q1', 'mouth_mid', 'mouth_q3', 'mouth_open'];
    const texts = order.map(text);
    expect(new Set(texts).size).toBe(5);
    expect(atlas.mouth_q1.cells[0]!.bg).toEqual(atlas.neutral.cells[0]!.bg);
  });
});

describe('blendImages', () => {
  const img = (w: number, h: number, v: number) => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(v) });

  it('mezcla píxel a píxel con el peso pedido, redondeando', () => {
    const out = blendImages(img(2, 2, 0), img(2, 2, 255), 0.5);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect([...out.data]).toEqual(new Array(16).fill(128));
    expect([...blendImages(img(1, 1, 100), img(1, 1, 200), 0.25).data]).toEqual([125, 125, 125, 125]);
  });

  it('si los tamaños difieren, muestrea la segunda al tamaño de la primera', () => {
    const out = blendImages(img(4, 4, 0), img(2, 2, 200), 0.5);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect([...out.data].every((v) => v === 100)).toBe(true);
  });
});
