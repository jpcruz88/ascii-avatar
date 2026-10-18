import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FACE_IDS, createAgent, loadApiKey, saveApiKey, saveFace } from '../src/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('llave de API', () => {
  it('guarda con permisos 0600 y la lee del archivo', () => {
    saveApiKey(root, 'SECRET123');
    const file = join(root, 'secrets.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ geminiApiKey: 'SECRET123' });
    expect(loadApiKey(root, {})).toBe('SECRET123');
  });

  it('prefiere la variable de entorno no vacía', () => {
    saveApiKey(root, 'SECRET123');
    expect(loadApiKey(root, { GEMINI_API_KEY: 'ENV' })).toBe('ENV');
    expect(loadApiKey(root, { GEMINI_API_KEY: '' })).toBe('SECRET123');
  });

  it('crea la carpeta raíz con 0700 si no existe', () => {
    const nested = join(root, 'nuevo');
    saveApiKey(nested, 'K');
    expect(statSync(nested).mode & 0o777).toBe(0o700);
  });

  it('corrige permisos de un archivo preexistente', () => {
    const file = join(root, 'secrets.json');
    writeFileSync(file, '{}');
    chmodSync(file, 0o644);
    saveApiKey(root, 'K2');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadApiKey(root, {})).toBe('K2');
  });

  it('devuelve undefined sin llave o con archivo corrupto', () => {
    expect(loadApiKey(root, {})).toBeUndefined();
    writeFileSync(join(root, 'secrets.json'), 'no es json');
    expect(loadApiKey(root, {})).toBeUndefined();
    writeFileSync(join(root, 'secrets.json'), '{"geminiApiKey": 5}');
    expect(loadApiKey(root, {})).toBeUndefined();
  });

  it('la llave nunca aparece en la carpeta del agente', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();
    createAgent(root, 'luna', png);
    for (const id of FACE_IDS) saveFace(root, 'luna', id, png);
    saveApiKey(root, 'SECRET123');
    const files = allFiles(join(root, 'agents', 'luna'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(f).includes('SECRET123')).toBe(false);
    }
  });
});
