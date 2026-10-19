import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// La entrada de navegador (`@ascii-avatar/core/browser`) se compila y se recorre su grafo de imports:
// nada de builtins de Node ni de sharp, para que el elemento web la pueda empaquetar.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const coreDir = fileURLToPath(new URL('..', import.meta.url));
const entry = resolve(coreDir, 'dist', 'browser.js');

beforeAll(() => {
  const build = spawnSync('npx', ['tsc', '-b', 'packages/core'], { cwd: repoRoot, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`No compiló: ${build.stdout}${build.stderr}`);
}, 120_000);

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Recorre los imports relativos desde `start`; devuelve los archivos y los especificadores no relativos. */
function walk(start: string): { files: string[]; bare: string[] } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    expect(existsSync(file), `falta ${file}`).toBe(true);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (spec.startsWith('.')) stack.push(resolve(dirname(file), spec));
      else bare.add(spec);
    }
  }
  return { files: [...seen], bare: [...bare] };
}

/** El código sin comentarios, para buscar usos y no menciones. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('@ascii-avatar/core/browser', () => {
  it('el paquete declara la subruta ./browser', () => {
    const pkg = JSON.parse(readFileSync(resolve(coreDir, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
    expect(pkg.exports['./browser']).toEqual({ types: './dist/browser.d.ts', default: './dist/browser.js' });
  });

  it('su grafo compilado no importa builtins de Node, sharp ni otros paquetes', () => {
    const { files, bare } = walk(entry);
    // Ningún especificador no relativo: ni `node:*`, ni `fs`, ni `sharp`, ni dependencias.
    expect(bare).toEqual([]);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const src = code(readFileSync(file, 'utf8'));
      expect(src, file).not.toMatch(/\bsharp\b/);
      expect(src, file).not.toMatch(/\brequire\(/);
      // Ni Buffer ni process: no existen en el navegador.
      expect(src, file).not.toMatch(/\b(Buffer|process)\b/);
    }
  });

  it('exporta el animador, la boca, el WAV, el resumen y la expresión', async () => {
    const mod = (await import('../src/browser.js')) as Record<string, unknown>;
    for (const name of [
      'Animator',
      'CLIP_FPS',
      'SPEECH_LEAD_IN_MS',
      'MOUTH_ANTICIPATION_MS',
      'mouthTimeline',
      'syntheticMouthTimeline',
      'parseWav',
      'InvalidWavError',
      'spokenSummary',
      'pickExpression',
      'FACE_IDS',
      'FRAME_IDS',
      'POSE_IDS',
      'CLIP_IDS',
      'MOUTH_FRAMES',
      'clipFrameId',
      'poseFrameId',
      'easeFrameId',
    ]) {
      expect(mod[name], name).toBeDefined();
    }
  });
});
