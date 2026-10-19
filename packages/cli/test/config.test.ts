import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configPath, defaultRoot, loadConfig, saveConfig, socketPath } from '../src/config.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('config', () => {
  it('sin archivo devuelve los valores por defecto', () => {
    expect(loadConfig(root)).toEqual({
      activeAgent: null,
      voice: false,
      dailyLimitUsd: 0.3,
      mode: 'grabado',
      cols: 70,
    });
  });

  it('el modo por defecto es grabado y se respeta un modo guardado', () => {
    expect(loadConfig(root).mode).toBe('grabado');
    writeFileSync(configPath(root), JSON.stringify({ mode: 'halfblock' }));
    expect(loadConfig(root).mode).toBe('halfblock');
    writeFileSync(configPath(root), JSON.stringify({ mode: 'grabado' }));
    expect(loadConfig(root).mode).toBe('grabado');
  });

  it('guarda y vuelve a leer, sin dejar temporales', () => {
    const c = { activeAgent: 'luna', voice: true, dailyLimitUsd: 0.5, mode: 'glyphs' as const, cols: 60 };
    saveConfig(root, c);
    expect(loadConfig(root)).toEqual(c);
    expect(readdirSync(root)).toEqual(['config.json']);
    expect(statSync(configPath(root)).mode & 0o777).toBe(0o600);
  });

  it('un archivo corrupto cae a los defaults sin lanzar', () => {
    writeFileSync(configPath(root), '{no es json');
    expect(loadConfig(root).voice).toBe(false);
    writeFileSync(configPath(root), '[1,2,3]');
    expect(loadConfig(root).cols).toBe(70);
  });

  it('descarta campo por campo los valores inválidos', () => {
    writeFileSync(
      configPath(root),
      JSON.stringify({ activeAgent: 'luna', voice: 'si', dailyLimitUsd: -1, mode: 'raro', cols: 5 }),
    );
    expect(loadConfig(root)).toEqual({
      activeAgent: 'luna',
      voice: false,
      dailyLimitUsd: 0.3,
      mode: 'grabado',
      cols: 70,
    });
  });

  it('la ruta del socket y la raíz por defecto', () => {
    expect(socketPath('/x')).toBe('/x/avatar.sock');
    expect(defaultRoot({ ASCII_AVATAR_HOME: '/y' })).toBe('/y');
    expect(defaultRoot({})).toMatch(/\.ascii-avatar$/);
  });
});
