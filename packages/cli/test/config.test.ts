import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  defaultRoot,
  effectiveDailyLimitUsd,
  loadConfig,
  saveConfig,
  socketPath,
} from '../src/config.js';

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
      mxnPorUsd: 18.4,
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
    const c = {
      activeAgent: 'luna',
      voice: true,
      dailyLimitUsd: 0.5,
      mxnPorUsd: 20,
      limiteDiarioMxn: 7.5,
      mode: 'glyphs' as const,
      cols: 60,
    };
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
      JSON.stringify({
        activeAgent: 'luna',
        voice: 'si',
        dailyLimitUsd: -1,
        mxnPorUsd: 'caro',
        limiteDiarioMxn: -3,
        mode: 'raro',
        cols: 5,
      }),
    );
    expect(loadConfig(root)).toEqual({
      activeAgent: 'luna',
      voice: false,
      dailyLimitUsd: 0.3,
      mxnPorUsd: 18.4,
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

describe('config: tipo de cambio (mxnPorUsd)', () => {
  const write = (c: unknown): void => writeFileSync(configPath(root), JSON.stringify(c));

  it('respeta un tipo de cambio válido', () => {
    write({ mxnPorUsd: 17.25 });
    expect(loadConfig(root).mxnPorUsd).toBe(17.25);
  });

  it('un tipo de cambio inválido cae al valor por defecto sin lanzar', () => {
    for (const bad of [0, -1, '18', null, true, [], {}]) {
      write({ mxnPorUsd: bad });
      expect(loadConfig(root).mxnPorUsd).toBe(18.4);
    }
    writeFileSync(configPath(root), '{"mxnPorUsd": 1e999}'); // se lee como Infinity
    expect(loadConfig(root).mxnPorUsd).toBe(18.4);
  });
});

describe('config: límite diario en pesos (limiteDiarioMxn)', () => {
  const write = (c: unknown): void => writeFileSync(configPath(root), JSON.stringify(c));

  it('es opcional: sin él no aparece en la configuración', () => {
    expect(loadConfig(root).limiteDiarioMxn).toBeUndefined();
    write({ dailyLimitUsd: 0.5 });
    expect(loadConfig(root).limiteDiarioMxn).toBeUndefined();
  });

  it('acepta un número finito y no negativo (0 desactiva la voz de hecho)', () => {
    write({ limiteDiarioMxn: 10 });
    expect(loadConfig(root).limiteDiarioMxn).toBe(10);
    write({ limiteDiarioMxn: 0 });
    expect(loadConfig(root).limiteDiarioMxn).toBe(0);
  });

  it('ignora un valor inválido', () => {
    for (const bad of [-1, '10', null, false]) {
      write({ limiteDiarioMxn: bad });
      expect(loadConfig(root).limiteDiarioMxn).toBeUndefined();
    }
  });

  it('effectiveDailyLimitUsd usa dailyLimitUsd si no hay límite en pesos', () => {
    write({ dailyLimitUsd: 0.5 });
    expect(effectiveDailyLimitUsd(loadConfig(root))).toBe(0.5);
    expect(effectiveDailyLimitUsd(loadConfig(join(root, 'no-existe')))).toBe(0.3);
  });

  it('effectiveDailyLimitUsd da prioridad a limiteDiarioMxn, convertido con mxnPorUsd', () => {
    write({ dailyLimitUsd: 0.5, mxnPorUsd: 20, limiteDiarioMxn: 10 });
    expect(effectiveDailyLimitUsd(loadConfig(root))).toBeCloseTo(0.5, 10);
    write({ dailyLimitUsd: 0.9, mxnPorUsd: 20, limiteDiarioMxn: 4 });
    expect(effectiveDailyLimitUsd(loadConfig(root))).toBeCloseTo(0.2, 10);
    write({ dailyLimitUsd: 0.9, limiteDiarioMxn: 18.4 }); // con el tipo de cambio por defecto
    expect(effectiveDailyLimitUsd(loadConfig(root))).toBeCloseTo(1, 10);
  });

  it('un limiteDiarioMxn inválido deja el dailyLimitUsd en vigor', () => {
    write({ dailyLimitUsd: 0.9, limiteDiarioMxn: -5 });
    expect(effectiveDailyLimitUsd(loadConfig(root))).toBe(0.9);
  });
});

describe('config: carpeta de LivePortrait (liveportraitDir)', () => {
  const write = (c: unknown): void => writeFileSync(configPath(root), JSON.stringify(c));

  it('conserva una ruta y descarta la vacía o de otro tipo', () => {
    write({ liveportraitDir: '/opt/lp' });
    expect(loadConfig(root).liveportraitDir).toBe('/opt/lp');
    for (const bad of ['', 3, null, true]) {
      write({ liveportraitDir: bad });
      expect(loadConfig(root)).not.toHaveProperty('liveportraitDir');
    }
  });
});
