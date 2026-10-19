// `avatar create` con el estilo `grabado` (el de por defecto): grabado base desde la foto, y las
// otras 7 caras y las 8 poses editando ese grabado. Todo con un cliente falso: nunca la API real.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FACE_IDS,
  Ledger,
  POSE_IDS,
  createAgent,
  decodeImage,
  formatMxn,
  frameToAnsi,
  imageToAscii,
  listPoses,
  loadAgent,
  missingFaces,
  type FaceId,
} from '@ascii-avatar/core';
import {
  ENGRAVING_BASE_PROMPT,
  ENGRAVING_FACE_PROMPTS,
  FACE_PROMPTS,
  ImageRefusedError,
  POSE_PROMPTS,
  PROMPTS_VERSION,
  imageCostUsd,
  type ImageClient,
  type ImageEditInput,
} from '@ascii-avatar/gemini';
import { runCreate, type CreateDeps } from '../src/commands/create.js';

/** Costo que informa el cliente falso por llamada (1300 tokens de entrada y 1120 de salida). */
const FACE_COST = imageCostUsd(1300, 1120);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EDITED_FACES = FACE_IDS.filter((id): id is Exclude<FaceId, 'neutral'> => id !== 'neutral');

let baseJpeg: Buffer;
let editJpeg: Buffer;
let wideJpeg: Buffer;
let root: string;
let photoPath: string;
let photoBuf: Buffer;
let events: string[];
let inputs: ImageEditInput[];

const jpeg = (width: number, height: number, gray: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: gray, g: gray, b: gray } } })
    .jpeg()
    .toBuffer();

beforeAll(async () => {
  baseJpeg = await jpeg(300, 400, 230);
  editJpeg = await jpeg(300, 400, 200);
  wideJpeg = await jpeg(320, 400, 20);
});

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aa-grabado-'));
  events = [];
  inputs = [];
  photoBuf = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 90, g: 60, b: 40 } } })
    .png()
    .toBuffer();
  photoPath = join(root, 'foto.png');
  writeFileSync(photoPath, photoBuf);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

interface FakeOptions {
  /** Números de llamada (desde 1, contando todas las corridas) que lanzan un error de red. */
  failOn?: number[];
  refuseOn?: number[];
  /** Imagen que devuelven las llamadas de poses (por defecto, una del mismo tamaño que la base). */
  poseImage?: () => Buffer;
}

/** Cliente falso: devuelve JPEG como Gemini (el primero de cada agente es el grabado base). */
function fakeClient(opts: FakeOptions = {}): ImageClient {
  return {
    async editImage(input) {
      inputs.push(input);
      events.push('call');
      const n = inputs.length;
      if (opts.refuseOn?.includes(n)) throw new ImageRefusedError('bloqueado');
      if (opts.failOn?.includes(n)) throw new Error('fallo de red simulado');
      let image = editJpeg;
      if (input.prompt === ENGRAVING_BASE_PROMPT) image = baseJpeg;
      else if (Object.values(POSE_PROMPTS).includes(input.prompt) && opts.poseImage) image = opts.poseImage();
      return { image, inputTokens: 1300, outputTokens: 1120 };
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
const questions = (): string[] => events.filter((e) => e.startsWith('ask:')).map((e) => e.slice(4));
const agentDir = (): string => join(root, 'agents', 'luna');
const facesDir = (): string => join(agentDir(), 'faces');
const posesDir = (): string => join(agentDir(), 'poses');
const spent = (): number => new Ledger(join(root, 'ledger.jsonl')).spentCreation('luna');
const isPng = (buf: Buffer): boolean => buf.subarray(0, 8).equals(PNG_SIGNATURE);

describe('runCreate grabado: camino feliz', () => {
  it('base desde la foto; 7 caras y 8 poses editando el grabado base; todo PNG real', async () => {
    const result = await runCreate(makeDeps());

    expect(result.status).toBe('done');
    expect(inputs).toHaveLength(16);

    // 1) El grabado base sale de la foto.
    expect(inputs[0]?.prompt).toBe(ENGRAVING_BASE_PROMPT);
    expect(inputs[0]?.image.equals(photoBuf)).toBe(true);
    expect(inputs[0]?.mimeType).toBe('image/png');

    // 2) Las demás llamadas editan el grabado base (el PNG guardado como neutral), nunca la foto.
    const base = readFileSync(join(facesDir(), 'neutral.png'));
    expect(isPng(base)).toBe(true);
    for (const input of inputs.slice(1)) {
      expect(input.image.equals(base)).toBe(true);
      expect(input.image.equals(photoBuf)).toBe(false);
      expect(input.mimeType).toBe('image/png');
    }
    expect(inputs.slice(1, 8).map((i) => i.prompt)).toEqual(EDITED_FACES.map((id) => ENGRAVING_FACE_PROMPTS[id]));
    expect(inputs.slice(8).map((i) => i.prompt)).toEqual(POSE_IDS.map((id) => POSE_PROMPTS[id]));

    // 3) Todo lo guardado es PNG real: 8 caras y 8 poses.
    expect(missingFaces(root, 'luna')).toEqual([]);
    for (const id of FACE_IDS) expect(isPng(readFileSync(join(facesDir(), `${id}.png`)))).toBe(true);
    expect(listPoses(root, 'luna')).toEqual([...POSE_IDS]);
    for (const id of POSE_IDS) expect(isPng(readFileSync(join(posesDir(), `${id}.png`)))).toBe(true);
    expect(readdirSync(agentDir()).filter((f) => f.includes('.tmp') || f.includes('.old'))).toEqual([]);

    // 4) Gasto registrado por cada llamada y agente marcado como grabado.
    expect(spent()).toBeCloseTo(16 * FACE_COST, 10);
    expect(loadAgent(root, 'luna')).toMatchObject({ style: 'grabado', promptsVersion: PROMPTS_VERSION });
  });

  it('estimado de 16 imágenes en pesos y confirmación antes de la primera llamada', async () => {
    await runCreate(makeDeps());
    const firstCall = events.indexOf('call');
    const estimateAt = events.findIndex((e) => e.startsWith('out:Estimado'));
    expect(estimateAt).toBeGreaterThanOrEqual(0);
    expect(estimateAt).toBeLessThan(firstCall);
    expect(output()).toContain('1 grabado base + 7 caras + 8 poses (16 imágenes)');
    expect(output()).toContain('Estimado: $16.19 MXN (tope $29.44 MXN)');
    expect(output()).toContain('Ya gastado en este agente: $0.00 MXN');
    expect(events.findIndex((e) => e.startsWith('ask:'))).toBeLessThan(firstCall);
  });

  it('muestra el grabado base en modo grabado y pregunta si se parece tras una sola llamada', async () => {
    const result = await runCreate(makeDeps());
    expect(result.status).toBe('done');
    expect(questions()).toEqual(['¿Generar las imágenes? (s/N)', '¿Se parece? ¿Seguimos? (s/N)']);
    const secondAsk = events.indexOf('ask:¿Se parece? ¿Seguimos? (s/N)');
    expect(events.slice(0, secondAsk).filter((e) => e === 'call')).toHaveLength(1);

    // La vista previa usa el modo grabado aunque el panel esté configurado en otro.
    const base = readFileSync(join(facesDir(), 'neutral.png'));
    const preview = frameToAnsi(imageToAscii(await decodeImage(base), { cols: 20, mode: 'grabado' }));
    const previewAt = events.indexOf(`out:${preview}`);
    expect(previewAt).toBeGreaterThan(events.indexOf('call'));
    expect(previewAt).toBeLessThan(secondAsk);
  });

  it('todo monto va en pesos; al terminar resume y sugiere avatar movimientos', async () => {
    const result = await runCreate(makeDeps());
    const all = `${output()}\n${result.message}`;
    expect(all).not.toMatch(/USD/);
    expect(all).not.toMatch(/\$\d+(\.\d+)?(?! MXN)(?!\d|\.\d)/);
    expect(output()).toContain('Grabado base listo ($0.65 MXN)');
    expect(output()).toContain('Pose look_right lista ($0.65 MXN)');
    expect(result.message).toContain('8 caras y 8 poses');
    expect(result.message).toContain(`Gasto total en creación: ${formatMxn(16 * FACE_COST, 18.4)}.`);
    expect(result.message).toContain('avatar movimientos luna');
  });

  it('una pose que llega con otro tamaño se guarda en el lienzo del grabado base', async () => {
    const result = await runCreate(makeDeps({ imageClient: fakeClient({ poseImage: () => wideJpeg }) }));
    expect(result.status).toBe('done');
    const meta = await sharp(readFileSync(join(posesDir(), 'turn_left.png'))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 300, 400]);
  });
});

describe('runCreate grabado: confirmaciones y opciones', () => {
  it('si rechaza el estimado no gasta ni crea el agente', async () => {
    const result = await runCreate(makeDeps({ answers: [false] }));
    expect(result.status).toBe('declined');
    expect(inputs).toHaveLength(0);
    expect(existsSync(agentDir())).toBe(false);
  });

  it('si la vista previa no convence: solo se generó y cobró el grabado base', async () => {
    const result = await runCreate(makeDeps({ answers: [true, false] }));
    expect(result.status).toBe('declined');
    expect(inputs).toHaveLength(1);
    expect(readdirSync(facesDir())).toEqual(['neutral.png']);
    expect(existsSync(posesDir())).toBe(false);
    expect(spent()).toBeCloseTo(FACE_COST, 10);
    expect(result.message).toContain('Faltan 15 imágenes');
    expect(result.message).not.toMatch(/USD/);
  });

  it('sin poses: 8 llamadas, sin carpeta de poses y el estimado de 8 imágenes', async () => {
    const result = await runCreate(makeDeps({ poses: false }));
    expect(result.status).toBe('done');
    expect(inputs).toHaveLength(8);
    expect(existsSync(posesDir())).toBe(false);
    expect(output()).toContain('1 grabado base + 7 caras (8 imágenes)');
    expect(output()).toContain('Estimado: $8.10 MXN (tope $29.44 MXN)');
    expect(result.message).toContain('8 caras');
    expect(result.message).toContain('avatar movimientos luna');
  });

  it('tras crearlo sin poses, volver a correr sin --sin-poses genera solo las 8 poses, sin vista previa', async () => {
    expect((await runCreate(makeDeps({ poses: false }))).status).toBe('done');
    events.length = 0;
    const result = await runCreate(makeDeps({ photoPath: undefined }));
    expect(result.status).toBe('done');
    expect(inputs).toHaveLength(16);
    expect(inputs.slice(8).map((i) => i.prompt)).toEqual(POSE_IDS.map((id) => POSE_PROMPTS[id]));
    expect(questions()).toEqual(['¿Generar las imágenes? (s/N)']);
    expect(output()).toContain('8 poses (8 imágenes)');
  });

  it('estilo foto: el flujo realista de siempre, todo desde la foto y sin poses', async () => {
    const result = await runCreate(makeDeps({ style: 'foto' }));
    expect(result.status).toBe('done');
    expect(inputs).toHaveLength(8);
    for (const input of inputs) expect(input.image.equals(photoBuf)).toBe(true);
    const order: FaceId[] = ['mouth_open', ...FACE_IDS.filter((id) => id !== 'mouth_open')];
    expect(inputs.map((i) => i.prompt)).toEqual(order.map((id) => FACE_PROMPTS[id]));
    expect(existsSync(posesDir())).toBe(false);
    expect(questions()).toEqual(['¿Generar las caras? (s/N)', '¿Seguimos con las demás caras? (s/N)']);
    expect(loadAgent(root, 'luna').style).toBe('foto');
    expect(output()).toContain('Estimado: $8.10 MXN (tope $29.44 MXN)');
  });

  it('no deja cambiar el estilo de un agente ya creado: falla sin preguntar ni gastar', async () => {
    expect((await runCreate(makeDeps({ answers: [true, false] }))).status).toBe('declined');
    events.length = 0;
    const before = inputs.length;
    const result = await runCreate(makeDeps({ style: 'foto', photoPath: undefined }));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('grabado');
    expect(result.message).toContain('No se gastó nada');
    expect(inputs).toHaveLength(before);
    expect(questions()).toEqual([]);
  });

  it('un agente viejo (sin estilo guardado) se reanuda como foto', async () => {
    createAgent(root, 'luna', photoBuf);
    const result = await runCreate(makeDeps({ photoPath: undefined, answers: [true, false] }));
    expect(result.status).toBe('declined');
    expect(inputs[0]?.prompt).toBe(FACE_PROMPTS.mouth_open);
    expect(inputs[0]?.image.equals(photoBuf)).toBe(true);
  });

  it('si ya tiene todo, termina sin preguntar ni llamar', async () => {
    expect((await runCreate(makeDeps())).status).toBe('done');
    events.length = 0;
    const result = await runCreate(makeDeps({ photoPath: undefined }));
    expect(result.status).toBe('done');
    expect(result.message).toContain('8 caras y 8 poses');
    expect(inputs).toHaveLength(16);
    expect(questions()).toEqual([]);
  });
});

describe('runCreate grabado: errores, reanudación y tope', () => {
  it('ante un error en la llamada 10 conserva lo hecho y al repetir genera solo lo que falta', async () => {
    const client = fakeClient({ failOn: [10] });
    const first = await runCreate(makeDeps({ imageClient: client }));
    expect(first.status).toBe('failed');
    expect(first.message).toContain('solo se generan las imágenes que faltan');
    expect(inputs).toHaveLength(10);
    expect(missingFaces(root, 'luna')).toEqual([]);
    expect(listPoses(root, 'luna')).toEqual(['tilt_left']);
    expect(spent()).toBeCloseTo(9 * FACE_COST, 10);

    events.length = 0;
    const second = await runCreate(makeDeps({ imageClient: client, photoPath: undefined }));
    expect(second.status).toBe('done');
    expect(inputs).toHaveLength(17);
    expect(inputs.slice(10).map((i) => i.prompt)).toEqual(POSE_IDS.slice(1).map((id) => POSE_PROMPTS[id]));
    const base = readFileSync(join(facesDir(), 'neutral.png'));
    for (const input of inputs.slice(10)) expect(input.image.equals(base)).toBe(true);
    expect(questions()).toEqual(['¿Generar las imágenes? (s/N)']);
    expect(output()).toContain('7 poses (7 imágenes)');
    expect(output()).toContain('Estimado: $7.08 MXN');
    expect(listPoses(root, 'luna')).toEqual([...POSE_IDS]);
    expect(spent()).toBeCloseTo(16 * FACE_COST, 10);
  });

  it('si el tope se alcanza a medias: capped, en pesos, y lo hecho queda para reanudar', async () => {
    const result = await runCreate(makeDeps({ cap: 0.5 }));
    expect(result.status).toBe('capped');
    expect(inputs).toHaveLength(13);
    expect(spent()).toBeLessThanOrEqual(0.5);
    expect(result.message).toContain('tope');
    expect(result.message).toContain('$9.20 MXN');
    expect(result.message).not.toMatch(/USD/);
    expect(result.message).toContain('turn_right, look_left, look_right');
    expect(missingFaces(root, 'luna')).toEqual([]);
    expect(listPoses(root, 'luna')).toEqual(POSE_IDS.slice(0, 5));

    const resumed = await runCreate(makeDeps({ photoPath: undefined }));
    expect(resumed.status).toBe('done');
    expect(inputs).toHaveLength(16);
    expect(listPoses(root, 'luna')).toEqual([...POSE_IDS]);
  });

  it('un rechazo de Gemini explica cómo aportar las caras a mano', async () => {
    const result = await runCreate(makeDeps({ imageClient: fakeClient({ refuseOn: [3] }) }));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('rechaz');
    expect(result.message).toContain('avatar create luna --caras <carpeta>');
    expect(inputs).toHaveLength(3);
    expect(spent()).toBeCloseTo(2 * FACE_COST, 10);
  });
});

describe('avatar create: banderas (proceso real)', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const distBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
  const bin = (...args: string[]) =>
    spawnSync(process.execPath, [distBin, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', ASCII_AVATAR_HOME: root },
    });

  it('rechaza un estilo desconocido, banderas desconocidas y mezclar --estilo o --sin-poses con una importación', () => {
    const build = spawnSync('npx', ['tsc', '-b'], { cwd: repoRoot, encoding: 'utf8' });
    expect(build.status).toBe(0);

    const estilo = bin('create', 'luna', '--foto', photoPath, '--estilo', 'acuarela');
    expect(estilo.status).toBe(1);
    expect(estilo.stderr).toContain('--estilo debe ser grabado o foto');

    const unknown = bin('create', 'luna', '--foto', photoPath, '--sin-pose');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('--sin-pose');

    const conValor = bin('create', 'luna', '--foto', photoPath, '--sin-poses=si');
    expect(conValor.status).toBe(1);
    expect(conValor.stderr).toContain('--sin-poses no lleva valor');

    const mezcla = bin('create', 'luna', '--caras', root, '--estilo', 'foto');
    expect(mezcla.status).toBe(1);
    expect(mezcla.stderr).toContain('--estilo');
    expect(mezcla.stderr).toContain('--caras');

    expect(bin('help').stdout).toContain('--estilo grabado|foto');
    expect(bin('help').stdout).toContain('--sin-poses');
    // Nada de eso tocó la carpeta de datos.
    expect(existsSync(join(root, 'agents'))).toBe(false);
  }, 120_000);
});
