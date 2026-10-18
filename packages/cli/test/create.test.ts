import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FACE_IDS, Ledger, loadAgent, missingFaces } from '@ascii-avatar/core';
import {
  ESTIMATED_FACE_COST_USD,
  FACE_PROMPTS,
  ImageRefusedError,
  PROMPTS_VERSION,
  type ImageClient,
} from '@ascii-avatar/gemini';
import { runCreate, type CreateDeps } from '../src/commands/create.js';
import { loadConfig, saveConfig } from '../src/config.js';

/** Costo que informa el cliente falso por llamada (1300 tokens de entrada y 1120 de salida). */
const FACE_COST = ESTIMATED_FACE_COST_USD;

let root: string;
let photoPath: string;
let events: string[];
let calls: number;
let tinyPng: Buffer;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
  events = [];
  calls = 0;
  tinyPng = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 120, b: 90 } },
  })
    .png()
    .toBuffer();
  photoPath = join(root, 'foto.png');
  writeFileSync(photoPath, await solidPhoto(512, 512));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function solidPhoto(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 60, b: 40 } },
  })
    .png()
    .toBuffer();
}

interface FakeOptions {
  /** Números de llamada (desde 1) que lanzan un error genérico. */
  failOn?: number[];
  refuse?: boolean;
}

function fakeClient(opts: FakeOptions = {}): ImageClient {
  return {
    async editImage() {
      calls += 1;
      events.push('call');
      if (opts.refuse) throw new ImageRefusedError('bloqueado');
      if (opts.failOn?.includes(calls)) throw new Error('fallo de red simulado');
      return { png: tinyPng, inputTokens: 1300, outputTokens: 1120 };
    },
  };
}

function makeDeps(overrides: Partial<CreateDeps> & { answers?: boolean[] } = {}): CreateDeps {
  const { answers, ...rest } = overrides;
  const queue = [...(answers ?? [])];
  return {
    root,
    name: 'luna',
    photoPath,
    imageClient: fakeClient(),
    ledger: new Ledger(join(root, 'ledger.jsonl')),
    ask: async (q) => {
      events.push(`ask:${q}`);
      return queue.length > 0 ? (queue.shift() as boolean) : true;
    },
    out: (s) => {
      events.push(`out:${s}`);
    },
    mode: 'halfblock',
    cols: 20,
    ...rest,
  };
}

const output = (): string =>
  events
    .filter((e) => e.startsWith('out:'))
    .map((e) => e.slice(4))
    .join('\n');
const facesDir = (): string => join(root, 'agents', 'luna', 'faces');

describe('runCreate: camino feliz', () => {
  it('genera las 8 caras, registra el gasto y muestra el estimado antes de la primera llamada', async () => {
    const deps = makeDeps();
    const result = await runCreate(deps);

    expect(result.status).toBe('done');
    expect(missingFaces(root, 'luna')).toEqual([]);
    expect(readdirSync(facesDir()).sort()).toEqual(FACE_IDS.map((id) => `${id}.png`).sort());
    expect(calls).toBe(8);
    expect(deps.ledger.spentCreation('luna')).toBeCloseTo(8 * FACE_COST, 10);
    expect(loadAgent(root, 'luna').promptsVersion).toBe(PROMPTS_VERSION);

    const estimateAt = events.findIndex((e) => e.startsWith('out:') && e.includes('Estimado'));
    const firstCallAt = events.indexOf('call');
    expect(estimateAt).toBeGreaterThanOrEqual(0);
    expect(estimateAt).toBeLessThan(firstCallAt);
    expect(output()).toContain('(tope $1.60)');
    expect(output()).toContain(`Estimado: $${(8 * FACE_COST).toFixed(2)} USD`);
    // La confirmación también llega antes de gastar.
    const askAt = events.findIndex((e) => e.startsWith('ask:'));
    expect(askAt).toBeLessThan(firstCallAt);
  });

  it('genera primero mouth_open y luego el resto en el orden de FACE_IDS', async () => {
    const order: string[] = [];
    const deps = makeDeps();
    const base = deps.imageClient;
    deps.imageClient = {
      async editImage(input) {
        order.push(input.prompt);
        return base.editImage(input);
      },
    };
    await runCreate(deps);
    const expected = ['mouth_open', ...FACE_IDS.filter((id) => id !== 'mouth_open')];
    expect(order).toEqual(expected.map((id) => FACE_PROMPTS[id]));
    // La vista previa (mouth_open) se pide antes de la segunda pregunta.
    const questions = events.filter((e) => e.startsWith('ask:'));
    expect(questions).toHaveLength(2);
    expect(questions[0]).toContain('¿Generar las caras? (s/N)');
    expect(questions[1]).toContain('¿Seguimos con las demás caras? (s/N)');
    const secondAskAt = events.indexOf(questions[1] as string);
    expect(events.slice(0, secondAskAt).filter((e) => e === 'call')).toHaveLength(1);
    expect(existsSync(join(facesDir(), 'mouth_open.png'))).toBe(true);
  });

  it('marca como estimado el costo cuando la API no informó tokens', async () => {
    const client: ImageClient = {
      async editImage() {
        return { png: tinyPng, inputTokens: null, outputTokens: null };
      },
    };
    const result = await runCreate(makeDeps({ imageClient: client }));
    expect(result.status).toBe('done');
    expect(output()).toContain('(estimado)');
  });

  it('con la configuración vacía deja el agente como activo; si ya había uno, no lo toca', async () => {
    await runCreate(makeDeps());
    expect(loadConfig(root).activeAgent).toBe('luna');

    const root2 = mkdtempSync(join(tmpdir(), 'aa-'));
    try {
      saveConfig(root2, { ...loadConfig(root2), activeAgent: 'otro' });
      const deps = makeDeps({ root: root2, ledger: new Ledger(join(root2, 'ledger.jsonl')) });
      expect((await runCreate(deps)).status).toBe('done');
      expect(loadConfig(root2).activeAgent).toBe('otro');
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });
});

describe('runCreate: confirmaciones', () => {
  it('si el usuario rechaza el estimado no llama al cliente ni deja el agente creado', async () => {
    const deps = makeDeps({ answers: [false] });
    const result = await runCreate(deps);
    expect(result.status).toBe('declined');
    expect(calls).toBe(0);
    expect(deps.ledger.spentCreation('luna')).toBe(0);
    expect(existsSync(join(root, 'agents', 'luna'))).toBe(false);
    expect(loadConfig(root).activeAgent).toBeNull();
  });

  it('si rechaza tras la vista previa: declined, 1 llamada y 1 cara guardada (cobrada)', async () => {
    const deps = makeDeps({ answers: [true, false] });
    const result = await runCreate(deps);
    expect(result.status).toBe('declined');
    expect(calls).toBe(1);
    expect(readdirSync(facesDir())).toEqual(['mouth_open.png']);
    expect(deps.ledger.spentCreation('luna')).toBeCloseTo(FACE_COST, 10);
    expect(loadConfig(root).activeAgent).toBeNull();
  });
});

describe('runCreate: tope', () => {
  it('se detiene con status capped cuando la siguiente cara superaría el tope', async () => {
    const deps = makeDeps({ cap: 0.05 });
    const result = await runCreate(deps);
    expect(result.status).toBe('capped');
    expect(result.message).toContain('tope');
    expect(missingFaces(root, 'luna').length).toBeGreaterThan(0);
    expect(calls).toBe(1);
    expect(deps.ledger.spentCreation('luna')).toBeLessThanOrEqual(0.05);
    expect(output()).toContain('(tope $0.05)');
  });

  it('cuenta lo ya gastado en corridas anteriores del mismo agente', async () => {
    const ledger = new Ledger(join(root, 'ledger.jsonl'));
    ledger.record('create', 'luna', 1.59);
    const result = await runCreate(makeDeps({ ledger }));
    expect(result.status).toBe('capped');
    expect(result.message).toContain('tope');
    expect(calls).toBe(0);
    expect(output()).toContain('1.59');
  });
});

describe('runCreate: errores y reanudación', () => {
  it('ante un error en la llamada 5 guarda las 4 hechas y al repetir genera solo las 4 faltantes', async () => {
    const client = fakeClient({ failOn: [5] });
    const first = await runCreate(makeDeps({ imageClient: client }));
    expect(first.status).toBe('failed');
    expect(first.message).not.toContain('at ');
    expect(readdirSync(facesDir())).toHaveLength(4);
    expect(missingFaces(root, 'luna')).toHaveLength(4);
    expect(calls).toBe(5);

    // Sin photoPath: reutiliza la foto guardada en la carpeta del agente.
    const second = await runCreate(makeDeps({ imageClient: client, photoPath: undefined }));
    expect(second.status).toBe('done');
    expect(calls).toBe(5 + 4);
    expect(missingFaces(root, 'luna')).toEqual([]);
    expect(output()).toContain('foto guardada');

    const ledger = new Ledger(join(root, 'ledger.jsonl'));
    expect(ledger.spentCreation('luna')).toBeCloseTo(8 * FACE_COST, 10);
  });

  it('un error nunca reintenta solo', async () => {
    const client = fakeClient({ failOn: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const result = await runCreate(makeDeps({ imageClient: client }));
    expect(result.status).toBe('failed');
    expect(calls).toBe(1);
  });

  it('el mensaje de error no filtra una llave de API', async () => {
    const client: ImageClient = {
      async editImage() {
        throw new Error('403 en https://x?key=AIza' + 'SyA1234567890abcdefghijklmnopqrstuv');
      },
    };
    const result = await runCreate(makeDeps({ imageClient: client }));
    expect(result.status).toBe('failed');
    expect(result.message).not.toContain('AIza' + 'SyA1234567890');
  });

  it('un rechazo de Gemini explica cómo poner las 8 caras a mano', async () => {
    const result = await runCreate(makeDeps({ imageClient: fakeClient({ refuse: true }) }));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('rechaz');
    expect(result.message).toContain('avatar create luna --caras <carpeta>');
    for (const id of FACE_IDS) expect(result.message).toContain(id);
    expect(calls).toBe(1);
  });

  it('si no falta ninguna cara, termina sin preguntar ni llamar al cliente', async () => {
    expect((await runCreate(makeDeps())).status).toBe('done');
    const callsBefore = calls;
    events.length = 0;
    const result = await runCreate(makeDeps({ photoPath: undefined }));
    expect(result.status).toBe('done');
    expect(result.message).toContain('8');
    expect(calls).toBe(callsBefore);
    expect(events.some((e) => e.startsWith('ask:'))).toBe(false);
  });

  it('si mouth_open ya existe, no repite la vista previa ni su pregunta', async () => {
    expect((await runCreate(makeDeps({ answers: [true, false] }))).status).toBe('declined');
    events.length = 0;
    const before = calls;
    const result = await runCreate(makeDeps({ photoPath: undefined }));
    expect(result.status).toBe('done');
    expect(calls - before).toBe(7);
    const questions = events.filter((e) => e.startsWith('ask:'));
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('¿Generar las caras? (s/N)');
  });

  it('un agente nuevo sin photoPath falla sin gastar', async () => {
    const result = await runCreate(makeDeps({ photoPath: undefined }));
    expect(result.status).toBe('failed');
    expect(calls).toBe(0);
  });
});

describe('runCreate: validación de la foto', () => {
  async function expectRejected(path: string): Promise<string> {
    const deps = makeDeps({ photoPath: path });
    const result = await runCreate(deps);
    expect(result.status).toBe('failed');
    expect(calls).toBe(0);
    expect(deps.ledger.spentCreation('luna')).toBe(0);
    expect(events.some((e) => e.startsWith('ask:'))).toBe(false);
    expect(existsSync(join(root, 'agents', 'luna'))).toBe(false);
    return result.message;
  }

  it('rechaza un archivo de texto', async () => {
    const file = join(root, 'nota.png');
    writeFileSync(file, 'esto no es una imagen');
    await expectRejected(file);
  });

  it('rechaza un PNG de 100x100 por pequeño', async () => {
    const file = join(root, 'chica.png');
    writeFileSync(file, await solidPhoto(100, 100));
    const message = await expectRejected(file);
    expect(message).toContain('100×100');
  });

  it('rechaza una foto demasiado grande en píxeles', async () => {
    const file = join(root, 'enorme.png');
    writeFileSync(file, await solidPhoto(8100, 300));
    await expectRejected(file);
  });

  it('rechaza un formato que no es png, jpeg ni webp (GIF), aunque tenga extensión .png', async () => {
    const file = join(root, 'animada.png');
    writeFileSync(file, await sharp({ create: { width: 512, height: 512, channels: 3, background: '#fff' } }).gif().toBuffer());
    await expectRejected(file);
  });

  it('rechaza más de 10 MB antes de decodificar', async () => {
    const file = join(root, 'pesada.png');
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    (await solidPhoto(512, 512)).copy(big);
    writeFileSync(file, big);
    const message = await expectRejected(file);
    expect(message).toContain('10 MB');
  });

  it('una ruta inexistente da un mensaje claro en español, sin traza', async () => {
    const message = await expectRejected(join(root, 'no-existe.png'));
    expect(message).toContain('No se encontró');
    expect(message).not.toContain('ENOENT');
    expect(message).not.toContain('\n    at ');
  });

  it('una carpeta en lugar de archivo también se rechaza con mensaje claro', async () => {
    const message = await expectRejected(root);
    expect(message).not.toContain('EISDIR');
  });

  it('el tipo MIME sale de la cabecera, no de la extensión (JPEG guardado como .png)', async () => {
    const jpeg = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer();
    const file = join(root, 'engañosa.png');
    writeFileSync(file, jpeg);
    const mimes: string[] = [];
    const client: ImageClient = {
      async editImage(input) {
        mimes.push(input.mimeType);
        return { png: tinyPng, inputTokens: 1300, outputTokens: 1120 };
      },
    };
    const result = await runCreate(makeDeps({ photoPath: file, imageClient: client }));
    expect(result.status).toBe('done');
    expect(new Set(mimes)).toEqual(new Set(['image/jpeg']));
    expect(existsSync(join(root, 'agents', 'luna', 'photo.jpg'))).toBe(true);
  });

  it('respeta la orientación EXIF: un JPEG 300x200 con orientación 6 se lee como 200x300', async () => {
    const file = join(root, 'girada.jpg');
    writeFileSync(
      file,
      await sharp({ create: { width: 300, height: 200, channels: 3, background: '#888' } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );
    const message = await expectRejected(file);
    expect(message).toContain('200×300');
  });

  it('un JPEG 400x300 con orientación 6 es válido (300x400)', async () => {
    const file = join(root, 'girada-ok.jpg');
    writeFileSync(
      file,
      await sharp({ create: { width: 400, height: 300, channels: 3, background: '#888' } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );
    const result = await runCreate(makeDeps({ photoPath: file, answers: [true, false] }));
    expect(result.status).toBe('declined');
    expect(calls).toBe(1);
  });

  it('un nombre de agente inválido falla sin gastar', async () => {
    const result = await runCreate(makeDeps({ name: '../escape' }));
    expect(result.status).toBe('failed');
    expect(calls).toBe(0);
  });

  it('la foto guardada del agente también se valida al reanudar', async () => {
    expect((await runCreate(makeDeps({ answers: [true, false] }))).status).toBe('declined');
    writeFileSync(join(root, 'agents', 'luna', 'photo.png'), 'dañada');
    const before = calls;
    const result = await runCreate(makeDeps({ photoPath: undefined }));
    expect(result.status).toBe('failed');
    expect(calls).toBe(before);
    expect(readFileSync(join(root, 'agents', 'luna', 'agent.json'), 'utf8')).toContain('luna');
  });
});
