import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FACE_IDS, createAgent, parseWebExport, saveClips, saveFace, savePose, savePoses, type FaceId } from '@ascii-avatar/core';
import { parseArgs, unknownFlags } from '../src/args.js';
import { runExportWeb } from '../src/commands/exportar-web.js';

// Agente sintético: una cara dibujada (círculo, ojos y boca), nunca la de una persona real.
const W = 120;
const H = 160;
const FAKE_KEY = 'AIzaFAKE-clave-de-prueba-0123456789';

function svgFace(opts: { mouth?: number; eyes?: 'open' | 'closed'; dx?: number; dy?: number } = {}): string {
  const { mouth = 0, eyes = 'open', dx = 0, dy = 0 } = opts;
  const cx = 60 + dx;
  const cy = 80 + dy;
  const eye = (x: number): string =>
    eyes === 'open'
      ? `<circle cx="${x}" cy="${cy - 12}" r="6" fill="black"/>`
      : `<line x1="${x - 7}" y1="${cy - 12}" x2="${x + 7}" y2="${cy - 12}" stroke="black" stroke-width="3"/>`;
  const mouthShape =
    mouth === 0
      ? `<line x1="${cx - 16}" y1="${cy + 22}" x2="${cx + 16}" y2="${cy + 22}" stroke="black" stroke-width="3"/>`
      : `<ellipse cx="${cx}" cy="${cy + 22}" rx="16" ry="${4 * mouth}" fill="black"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="white"/>
<circle cx="${cx}" cy="${cy}" r="48" fill="none" stroke="black" stroke-width="4"/>${eye(cx - 18)}${eye(cx + 18)}${mouthShape}</svg>`;
}

const png = (svg: string): Promise<Buffer> => sharp(Buffer.from(svg)).png().toBuffer();

const FACE_SVG: Record<FaceId, string> = {
  neutral: svgFace(),
  mouth_mid: svgFace({ mouth: 1 }),
  mouth_open: svgFace({ mouth: 3 }),
  blink: svgFace({ eyes: 'closed' }),
  smile: svgFace({ mouth: 2 }),
  serious: svgFace({ mouth: 0, dy: 1 }),
  surprised: svgFace({ mouth: 4 }),
  sad: svgFace({ mouth: 0, dy: -1 }),
};

async function makeAgent(root: string, name = 'muestra'): Promise<void> {
  createAgent(root, name, await png(FACE_SVG.neutral), { voice: 'Algenib', voiceStyle: 'tranquilo' });
  for (const id of FACE_IDS) saveFace(root, name, id, await png(FACE_SVG[id]));
  savePoses(root, name, { look_left: await png(svgFace({ dx: -8 })) });
  saveClips(root, name, { nod: [await png(svgFace()), await png(svgFace({ dy: 6 })), await png(svgFace())] });
  // Una llave en el entorno de datos: nunca debe acabar en el paquete exportado.
  writeFileSync(join(root, 'secrets.json'), JSON.stringify({ geminiApiKey: FAKE_KEY }), { mode: 0o600 });
}

let root: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-web-'));
  cwd = mkdtempSync(join(tmpdir(), 'aa-web-out-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('runExportWeb', () => {
  it('escribe manifest.json y frames.txt en ./<nombre>-web y nada más', async () => {
    await makeAgent(root);
    const r = await runExportWeb({ root, name: 'muestra', cols: 40, cwd });
    expect(r.status).toBe('ok');
    const out = join(cwd, 'muestra-web');
    expect(r.outDir).toBe(out);
    expect(readdirSync(out).sort()).toEqual(['frames.txt', 'manifest.json']);
    expect(r.message).toContain(out);
  });

  it('el manifiesto trae agente, voz, tamaño, colores, cuadros, poses y clips', async () => {
    await makeAgent(root);
    await runExportWeb({ root, name: 'muestra', cols: 40, cwd });
    const out = join(cwd, 'muestra-web');
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      format: 'ascii-avatar-web',
      version: 1,
      agent: 'muestra',
      voice: 'Algenib',
      voiceStyle: 'tranquilo',
      cols: 40,
      ink: '#141414',
      paper: '#fafaf7',
      clipFps: 24,
      frameFile: 'frames.txt',
      poses: ['look_left'],
      clips: { nod: 3 },
    });
    expect(manifest.rows).toBe(Math.round(((H / W) * 40) / 2));
    expect(manifest.frames).toEqual([
      ...FACE_IDS,
      'mouth_q1',
      'mouth_q3',
      'pose:look_left',
      'ease:look_left',
      'clip:nod:0',
      'clip:nod:1',
      'clip:nod:2',
    ]);
    // El archivo de cuadros se lee de vuelta con el mismo formato que usa el navegador.
    const { frames } = parseWebExport(manifest, readFileSync(join(out, 'frames.txt'), 'utf8'));
    expect(frames.size).toBe(manifest.frames.length);
    expect(frames.get('neutral')).not.toBe(frames.get('mouth_open'));
    expect(frames.get('neutral')!.trim()).not.toBe('');
  });

  it('es determinista: dos exportaciones dan los mismos bytes', async () => {
    await makeAgent(root);
    const a = join(cwd, 'a');
    const b = join(cwd, 'b');
    await runExportWeb({ root, name: 'muestra', cols: 40, cwd, out: a });
    await runExportWeb({ root, name: 'muestra', cols: 40, cwd, out: b });
    for (const f of ['manifest.json', 'frames.txt']) {
      expect(readFileSync(join(b, f))).toEqual(readFileSync(join(a, f)));
    }
  });

  it('nunca lleva la llave ni la foto original', async () => {
    await makeAgent(root);
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = FAKE_KEY;
    try {
      await runExportWeb({ root, name: 'muestra', cols: 40, cwd });
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
    const out = join(cwd, 'muestra-web');
    for (const f of readdirSync(out)) {
      const bytes = readFileSync(join(out, f));
      expect(bytes.toString('latin1')).not.toContain(FAKE_KEY);
      // Ningún PNG dentro (firma \x89PNG): solo texto.
      expect(bytes.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    }
  });

  it('--out elige la carpeta y se puede volver a exportar encima', async () => {
    await makeAgent(root);
    const out = join(cwd, 'sitio', 'avatar');
    expect((await runExportWeb({ root, name: 'muestra', cols: 40, cwd, out })).status).toBe('ok');
    expect((await runExportWeb({ root, name: 'muestra', cols: 30, cwd, out })).status).toBe('ok');
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).cols).toBe(30);
  });

  it('no escribe en una carpeta con otras cosas que no son un paquete web', async () => {
    await makeAgent(root);
    const out = join(cwd, 'ajena');
    mkdirSync(out);
    writeFileSync(join(out, 'importante.txt'), 'no tocar');
    const r = await runExportWeb({ root, name: 'muestra', cols: 40, cwd, out });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/no está vacía/);
    expect(readdirSync(out)).toEqual(['importante.txt']);
  });

  it('un agente que no existe o sin caras falla con un mensaje claro', async () => {
    const r = await runExportWeb({ root, name: 'nadie', cols: 40, cwd });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/nadie/);
    createAgent(root, 'incompleto', await png(FACE_SVG.neutral));
    const r2 = await runExportWeb({ root, name: 'incompleto', cols: 40, cwd });
    expect(r2.status).toBe('failed');
    expect(r2.message).toMatch(/faltan caras/i);
    expect(existsSync(join(cwd, 'incompleto-web'))).toBe(false);
  });

  it('un agente del flujo grabado (style en agent.json, poses de a una) exporta poses y clips', async () => {
    createAgent(root, 'grabado', await png(FACE_SVG.neutral), { style: 'grabado', promptsVersion: 2 });
    for (const id of FACE_IDS) saveFace(root, 'grabado', id, await png(FACE_SVG[id]));
    savePose(root, 'grabado', 'tilt_left', await png(svgFace({ dx: -6, dy: 3 })));
    savePose(root, 'grabado', 'look_right', await png(svgFace({ dx: 8 })));
    saveClips(root, 'grabado', { think: [await png(svgFace()), await png(svgFace({ dx: 4 })), await png(svgFace())] });
    const r = await runExportWeb({ root, name: 'grabado', cols: 40, cwd });
    expect(r.status).toBe('ok');
    const manifest = JSON.parse(readFileSync(join(cwd, 'grabado-web', 'manifest.json'), 'utf8'));
    expect(manifest.poses).toEqual(['tilt_left', 'look_right']);
    expect(manifest.clips).toEqual({ think: 3 });
    expect(manifest.frames).toEqual(
      expect.arrayContaining(['pose:tilt_left', 'ease:tilt_left', 'pose:look_right', 'ease:look_right', 'clip:think:2']),
    );
    expect(manifest).not.toHaveProperty('style');
    const { frames } = parseWebExport(manifest, readFileSync(join(cwd, 'grabado-web', 'frames.txt'), 'utf8'));
    expect(frames.get('pose:tilt_left')).not.toBe(frames.get('neutral'));
  });

  it('rechaza un nombre inválido o cols fuera de rango', async () => {
    expect((await runExportWeb({ root, name: '../x', cols: 40, cwd })).status).toBe('failed');
    expect((await runExportWeb({ root, name: 'muestra', cols: 5, cwd })).message).toMatch(/--cols/);
  });
});

describe('argumentos de exportar-web', () => {
  it('--out y --cols llevan valor y son las únicas banderas válidas', () => {
    const args = parseArgs(['exportar-web', 'muestra', '--out', 'web/', '--cols', '90']);
    expect(args).toEqual({ cmd: 'exportar-web', positionals: ['muestra'], flags: { out: 'web/', cols: '90' } });
    expect(unknownFlags('exportar-web', args.flags)).toEqual([]);
    expect(unknownFlags('exportar-web', { foto: 'x' })).toEqual(['foto']);
  });
});

describe('avatar exportar-web (proceso real)', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const distBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
  beforeAll(() => {
    const build = spawnSync('npx', ['tsc', '-b'], { cwd: repoRoot, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`No compiló: ${build.stdout}${build.stderr}`);
  }, 120_000);

  it('exporta con ASCII_AVATAR_HOME y lo anuncia en la ayuda', async () => {
    await makeAgent(root);
    const r = spawnSync(process.execPath, [distBin, 'exportar-web', 'muestra', '--cols', '30'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ASCII_AVATAR_HOME: root },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(existsSync(join(cwd, 'muestra-web', 'manifest.json'))).toBe(true);
    const help = spawnSync(process.execPath, [distBin, 'help'], { encoding: 'utf8' });
    expect(help.stdout).toContain('avatar exportar-web <nombre>');
    const bad = spawnSync(process.execPath, [distBin, 'exportar-web', 'muestra', '--foto', 'x'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ASCII_AVATAR_HOME: root },
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('Opción desconocida: --foto');
  });
});
