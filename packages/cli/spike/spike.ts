// EXPERIMENTO DESECHABLE (Task 4). Se borra tras la puerta de decisión del usuario.
//
// Uso:
//   npx tsx packages/cli/spike/spike.ts --photo <ruta> --out <dir> [--cap 0.50]
//       [--faces-dir <dir>] [--cols 70] [--no-play]
//
// Con --faces-dir lee <FaceId>.png de ese directorio (sin API ni costo). Sin él,
// genera las 8 caras con Gemini (GEMINI_API_KEY) y las guarda en --out, reusando
// las que ya existan.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  FACE_IDS,
  cornerDrift,
  decodeImage,
  frameDiff,
  frameToAnsi,
  imageToAscii,
  type AsciiFrame,
  type AsciiMode,
  type FaceId,
} from '@ascii-avatar/core';
import {
  ESTIMATED_FACE_COST_USD,
  ImageRefusedError,
  createGeminiImageClient,
  estimateCreationCostUsd,
  generateFace,
  loadGeminiConfig,
} from '@ascii-avatar/gemini';
import { toPng } from '../src/image-input.js';

const MODES: readonly AsciiMode[] = ['glyphs', 'halfblock'];
const SEQUENCE: readonly FaceId[] = [
  'neutral',
  'mouth_mid',
  'mouth_open',
  'mouth_mid',
  'neutral',
  'blink',
  'smile',
];
const FPS = 6;
const LOOPS_PER_MODE = 3;
const DRIFT_THRESHOLD = 0.02;

const usd = (n: number): string => `$${n.toFixed(4)}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function mimeOf(path: string): string {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) fail(`Formato de foto no soportado: ${path} (usa png, jpg, jpeg o webp).`);
  return mime;
}

const { values: args } = parseArgs({
  options: {
    photo: { type: 'string' },
    out: { type: 'string' },
    cap: { type: 'string', default: '0.50' },
    'faces-dir': { type: 'string' },
    cols: { type: 'string', default: '70' },
    'no-play': { type: 'boolean', default: false },
  },
});

const cap = Number(args.cap);
if (!Number.isFinite(cap) || cap <= 0) fail(`--cap inválido: ${args.cap}`);
const cols = Number(args.cols);
if (!Number.isInteger(cols) || cols < 1) fail(`--cols inválido: ${args.cols}`);

// Cola de líneas: funciona igual con teclado y con stdin por tubería (que cierra pronto).
const rl = createInterface({ input: process.stdin });
const lines: string[] = [];
const waiting: Array<(line: string | null) => void> = [];
let inputClosed = false;
rl.on('line', (line) => {
  const next = waiting.shift();
  if (next) next(line);
  else lines.push(line);
});
rl.on('close', () => {
  inputClosed = true;
  for (const next of waiting.splice(0)) next(null);
});

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(question);
  const answer = await new Promise<string | null>((resolve) => {
    const queued = lines.shift();
    if (queued !== undefined) resolve(queued);
    else if (inputClosed) resolve(null);
    else waiting.push(resolve);
  });
  if (answer === null) process.stdout.write('\n');
  const a = (answer ?? '').trim().toLowerCase();
  return a === 's' || a === 'si' || a === 'sí';
}

async function loadFacesFromDir(dir: string): Promise<Map<FaceId, Buffer>> {
  const faces = new Map<FaceId, Buffer>();
  const missing: string[] = [];
  for (const id of FACE_IDS) {
    const path = join(dir, `${id}.png`);
    if (existsSync(path)) faces.set(id, await readFile(path));
    else missing.push(`${id}.png`);
  }
  if (missing.length > 0) fail(`Faltan caras en ${dir}: ${missing.join(', ')}`);
  console.log(`Caras leídas de ${dir} (sin API, sin costo).`);
  return faces;
}

async function generateFaces(photoPath: string, outDir: string): Promise<Map<FaceId, Buffer>> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (apiKey === undefined || apiKey === '') {
    fail('Falta GEMINI_API_KEY en el entorno. Defínela, o usa --faces-dir con caras ya hechas.');
  }
  const mimeType = mimeOf(photoPath);
  const photo = await readFile(photoPath);
  await mkdir(outDir, { recursive: true });

  const faces = new Map<FaceId, Buffer>();
  const missing: FaceId[] = [];
  for (const id of FACE_IDS) {
    const path = join(outDir, `${id}.png`);
    if (existsSync(path)) faces.set(id, await readFile(path));
    else missing.push(id);
  }
  console.log(`En caché (sin costo): ${FACE_IDS.length - missing.length} de ${FACE_IDS.length}.`);
  if (missing.length === 0) return faces;

  // mouth_open primero: es la que más prueba si la identidad se mantiene.
  missing.sort((a, b) => Number(b === 'mouth_open') - Number(a === 'mouth_open'));

  console.log(
    `Por generar: ${missing.length} (${missing.join(', ')}).\n` +
      `Costo estimado: ${usd(estimateCreationCostUsd(missing.length))}  |  tope: ${usd(cap)}`,
  );
  if (!(await confirm('¿Continuar? (s/N) '))) fail('Cancelado. No se gastó nada.');

  const client = createGeminiImageClient(loadGeminiConfig({ GEMINI_API_KEY: apiKey }));
  let total = 0;
  for (const [i, id] of missing.entries()) {
    if (total + ESTIMATED_FACE_COST_USD > cap) {
      fail(
        `Alto: generar "${id}" (~${usd(ESTIMATED_FACE_COST_USD)}) pasaría el tope de ${usd(cap)} ` +
          `(llevas ${usd(total)}). Las caras hechas quedan en ${outDir}; vuelve a correr con más --cap.`,
      );
    }
    try {
      const face = await generateFace(client, photo, mimeType, id);
      const png = await toPng(face.image); // Gemini devuelve JPEG; se guarda como PNG real
      await writeFile(join(outDir, `${id}.png`), png);
      faces.set(id, png);
      total += face.costUsd;
      console.log(
        `  ${id}: ${usd(face.costUsd)}${face.costEstimated ? ' (estimado)' : ''}  |  total ${usd(total)}`,
      );
    } catch (err) {
      if (err instanceof ImageRefusedError) {
        fail(
          `Gemini rechazó generar "${id}"${err.detail ? `: ${err.detail}` : '.'}\n` +
            `Camino manual: crea las 8 caras por otro medio, ponlas como <FaceId>.png en un ` +
            `directorio y corre con --faces-dir <dir>.`,
        );
      }
      fail(`Error al generar "${id}": ${err instanceof Error ? err.message : String(err)}`);
    }

    if (id === 'mouth_open') {
      const frame = imageToAscii(await decodeImage(faces.get(id)!), { cols, mode: 'glyphs' });
      console.log(`\nmouth_open (glyphs, ${cols} columnas):\n${frameToAnsi(frame)}\n`);
      if (i < missing.length - 1 && !(await confirm('¿Se parece a la persona? ¿Continuar con el resto? (s/N) '))) {
        fail(`Detenido tras mouth_open. Gastado: ${usd(total)}.`);
      }
    }
  }
  console.log(`Costo total de la generación: ${usd(total)}`);
  return faces;
}

function printDriftTable(frames: Record<AsciiMode, Map<FaceId, AsciiFrame>>): void {
  for (const mode of MODES) {
    const neutral = frames[mode].get('neutral')!;
    console.log(`\nModo ${mode}: neutral contra cada cara`);
    console.log('cara          frameDiff  cornerDrift');
    for (const id of FACE_IDS) {
      if (id === 'neutral') continue;
      const frame = frames[mode].get(id)!;
      if (frame.cols !== neutral.cols || frame.rows !== neutral.rows) {
        console.log(`${id.padEnd(13)} tamaño distinto (${frame.cols}x${frame.rows} contra ${neutral.cols}x${neutral.rows})`);
        continue;
      }
      const diff = frameDiff(neutral, frame);
      const drift = cornerDrift(neutral, frame);
      const flag = drift > DRIFT_THRESHOLD ? '  <- el fondo se mueve' : '';
      console.log(`${id.padEnd(13)} ${diff.toFixed(4).padStart(9)}  ${drift.toFixed(4).padStart(11)}${flag}`);
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function play(frames: Record<AsciiMode, Map<FaceId, AsciiFrame>>): Promise<void> {
  const HIDE = '\x1b[?25l';
  const SHOW = '\x1b[?25h';
  const HOME = '\x1b[H';
  const CLEAR = '\x1b[2J';
  let stopped = false;
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    process.stdout.write(`\x1b[0m${SHOW}\n`);
  };
  process.on('SIGINT', () => {
    stopped = true;
    restore();
    process.exit(0);
  });
  process.on('exit', restore);

  const ansi = {} as Record<AsciiMode, Map<FaceId, string>>;
  for (const mode of MODES) {
    ansi[mode] = new Map([...frames[mode]].map(([id, f]) => [id, frameToAnsi(f)]));
  }
  const rows = Math.max(...MODES.flatMap((m) => [...frames[m].values()].map((f) => f.rows)));
  if ((process.stdout.rows ?? Infinity) < rows + 2 || (process.stdout.columns ?? Infinity) < cols) {
    console.log(`Aviso: la terminal es más chica que ${cols}x${rows + 2}; agrándala o baja --cols.`);
  }
  console.log(`\nReproduciendo a ${FPS} cuadros por segundo. Ctrl-C para salir.`);
  await sleep(1200);

  process.stdout.write(HIDE);
  while (!stopped) {
    for (const mode of MODES) {
      process.stdout.write(CLEAR + HOME);
      for (let loop = 0; loop < LOOPS_PER_MODE && !stopped; loop++) {
        for (const id of SEQUENCE) {
          if (stopped) break;
          const title = `modo: ${mode}  |  vuelta ${loop + 1}/${LOOPS_PER_MODE}  |  ${id}`;
          process.stdout.write(`${HOME}${title}\x1b[K\n${ansi[mode].get(id)!}\x1b[0m\x1b[J`);
          await sleep(1000 / FPS);
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const facesDir = args['faces-dir'];
  let faces: Map<FaceId, Buffer>;
  if (facesDir !== undefined) {
    faces = await loadFacesFromDir(facesDir);
  } else {
    if (args.photo === undefined || args.out === undefined) {
      fail('Uso: spike.ts --photo <ruta> --out <dir> [--cap 0.50] [--faces-dir <dir>] [--cols 70] [--no-play]');
    }
    faces = await generateFaces(args.photo, args.out);
  }

  const frames = { glyphs: new Map<FaceId, AsciiFrame>(), halfblock: new Map<FaceId, AsciiFrame>() };
  for (const id of FACE_IDS) {
    const img = await decodeImage(faces.get(id)!);
    for (const mode of MODES) frames[mode].set(id, imageToAscii(img, { cols, mode }));
  }
  printDriftTable(frames);

  if (args['no-play']) return;
  rl.close();
  await play(frames);
}

try {
  await main();
} finally {
  rl.close();
}
