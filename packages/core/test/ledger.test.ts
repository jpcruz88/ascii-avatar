import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  CREATION_CAP_USD,
  DEFAULT_DAILY_LIMIT_USD,
  Ledger,
  assertWithinCap,
} from '../src/index.js';

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
  file = join(root, 'ledger.jsonl');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('constantes', () => {
  it('fija el tope de creación y el límite diario por defecto', () => {
    expect(CREATION_CAP_USD).toBe(1.6);
    expect(DEFAULT_DAILY_LIMIT_USD).toBe(0.3);
  });
});

describe('Ledger', () => {
  it('dos instancias sobre el mismo archivo ven los mismos totales', () => {
    const a = new Ledger(file);
    const b = new Ledger(file);
    a.record('voice', 'luna', 0.05);
    b.record('voice', 'luna', 0.07);
    a.record('create', 'luna', 0.4);
    expect(a.spentToday()).toBeCloseTo(0.12, 9);
    expect(b.spentToday()).toBeCloseTo(0.12, 9);
    expect(a.spentCreation('luna')).toBeCloseTo(0.4, 9);
    expect(b.spentCreation('luna')).toBeCloseTo(0.4, 9);
  });

  it('un archivo inexistente suma cero', () => {
    const ledger = new Ledger(join(root, 'no-existe.jsonl'));
    expect(ledger.spentToday()).toBe(0);
    expect(ledger.spentCreation('luna')).toBe(0);
  });

  it('crea la carpeta padre si falta', () => {
    const nested = join(root, 'a', 'b', 'ledger.jsonl');
    new Ledger(nested).record('voice', 'luna', 0.01);
    expect(existsSync(nested)).toBe(true);
    expect(new Ledger(nested).spentToday()).toBeCloseTo(0.01, 9);
  });

  it('escribe una línea JSON por registro con ts ISO, kind, agent y usd', () => {
    const at = new Date(2026, 9, 18, 12, 0);
    const ledger = new Ledger(file, () => at);
    ledger.record('voice', 'luna', 0.02);
    ledger.record('create', 'luna', 0.3);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ ts: at.toISOString(), kind: 'voice', agent: 'luna', usd: 0.02 });
    expect(JSON.parse(lines[1]!)).toEqual({ ts: at.toISOString(), kind: 'create', agent: 'luna', usd: 0.3 });
  });

  it('spentToday no cuenta registros de ayer (el reloj cruza la medianoche local)', () => {
    let current = new Date(2026, 9, 18, 23, 59);
    const ledger = new Ledger(file, () => current);
    ledger.record('voice', 'luna', 0.2);
    expect(ledger.spentToday()).toBeCloseTo(0.2, 9);

    current = new Date(2026, 9, 19, 0, 1);
    expect(ledger.spentToday()).toBe(0);
    ledger.record('voice', 'luna', 0.05);
    expect(ledger.spentToday()).toBeCloseTo(0.05, 9);
  });

  it('spentToday cuenta solo voz: el gasto de creación no bloquea la voz', () => {
    const ledger = new Ledger(file);
    ledger.record('create', 'luna', 0.3);
    expect(ledger.spentToday()).toBe(0);
    ledger.record('voice', 'luna', 0.04);
    expect(ledger.spentToday()).toBeCloseTo(0.04, 9);
  });

  it('spentToday suma la voz de todos los agentes', () => {
    const ledger = new Ledger(file);
    ledger.record('voice', 'luna', 0.04);
    ledger.record('voice', 'sol', 0.06);
    expect(ledger.spentToday()).toBeCloseTo(0.1, 9);
  });

  it('spentCreation suma solo registros create del agente pedido, de cualquier fecha', () => {
    let current = new Date(2026, 9, 10, 9, 0);
    const ledger = new Ledger(file, () => current);
    ledger.record('create', 'luna', 0.4);
    ledger.record('create', 'sol', 0.9);
    ledger.record('voice', 'luna', 0.05);
    current = new Date(2026, 9, 18, 9, 0);
    ledger.record('create', 'luna', 0.25);
    expect(ledger.spentCreation('luna')).toBeCloseTo(0.65, 9);
    expect(ledger.spentCreation('sol')).toBeCloseTo(0.9, 9);
    expect(ledger.spentCreation('nadie')).toBe(0);
  });

  it('ignora líneas corruptas, vacías y con usd inválido sin lanzar', () => {
    const ts = new Date().toISOString();
    const good = (usd: number) => JSON.stringify({ ts, kind: 'voice', agent: 'luna', usd });
    writeFileSync(
      file,
      [
        good(0.1),
        '{esto no es json',
        '',
        '   ',
        'null',
        '42',
        '[1,2]',
        JSON.stringify({ ts, kind: 'voice', agent: 'luna', usd: -0.5 }),
        JSON.stringify({ ts, kind: 'voice', agent: 'luna', usd: 'mucho' }),
        JSON.stringify({ ts, kind: 'voice', agent: 'luna', usd: null }),
        JSON.stringify({ ts, kind: 'voice', agent: 'luna' }),
        '{"ts":"' + ts + '","kind":"voice","agent":"luna","usd":1e999}',
        JSON.stringify({ ts: 'no-es-fecha', kind: 'voice', agent: 'luna', usd: 9 }),
        JSON.stringify({ ts, kind: 'otro', agent: 'luna', usd: 9 }),
        good(0.2),
        '{"ts":"cortada',
      ].join('\n'),
    );
    const ledger = new Ledger(file);
    expect(() => ledger.spentToday()).not.toThrow();
    expect(ledger.spentToday()).toBeCloseTo(0.3, 9);
    expect(ledger.spentCreation('luna')).toBe(0);
  });

  it('no reescribe el archivo: las líneas corruptas se conservan al registrar', () => {
    writeFileSync(file, 'basura\n');
    const ledger = new Ledger(file);
    ledger.record('voice', 'luna', 0.01);
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith('basura\n')).toBe(true);
    expect(ledger.spentToday()).toBeCloseTo(0.01, 9);
  });

  it('un registro tras una última línea sin salto de línea no queda pegado a ella', () => {
    writeFileSync(file, '{"ts":"cortada');
    const ledger = new Ledger(file);
    ledger.record('voice', 'luna', 0.01);
    expect(ledger.spentToday()).toBeCloseTo(0.01, 9);
  });

  it('record rechaza usd no finito o negativo y no escribe nada', () => {
    const ledger = new Ledger(file);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01]) {
      expect(() => ledger.record('voice', 'luna', bad)).toThrow(Error);
      expect(() => ledger.record('voice', 'luna', bad)).toThrow(/USD|usd|costo|monto/i);
    }
    expect(existsSync(file)).toBe(false);
  });

  it('record acepta cero', () => {
    const ledger = new Ledger(file);
    expect(() => ledger.record('voice', 'luna', 0)).not.toThrow();
    expect(ledger.spentToday()).toBe(0);
  });

  it('tolera registros agregados por otro proceso entre lecturas (sin caché)', () => {
    const ledger = new Ledger(file);
    expect(ledger.spentToday()).toBe(0);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), kind: 'voice', agent: 'luna', usd: 0.08 }) + '\n');
    expect(ledger.spentToday()).toBeCloseTo(0.08, 9);
  });

  it('suma estable ante ruido de punto flotante', () => {
    const ledger = new Ledger(file);
    for (let i = 0; i < 30; i++) ledger.record('voice', 'luna', 0.01);
    expect(ledger.spentToday()).toBeCloseTo(0.3, 9);
  });
});

describe('assertWithinCap', () => {
  it('lanza BudgetExceededError cuando spent + next supera el tope', () => {
    expect(() => assertWithinCap(1.55, 0.06, 1.6)).toThrow(BudgetExceededError);
  });

  it('no lanza cuando cabe', () => {
    expect(() => assertWithinCap(1.5, 0.06, 1.6)).not.toThrow();
  });

  it('permite llegar exactamente al tope aunque haya ruido de punto flotante', () => {
    expect(() => assertWithinCap(1.54, 0.06, 1.6)).not.toThrow();
    // 0.1 + 0.2 y 16 × 0.1 se pasan del tope solo por ruido de punto flotante
    expect(0.1 + 0.2).toBeGreaterThan(0.3);
    expect(() => assertWithinCap(0.1, 0.2, 0.3)).not.toThrow();
    let sixteenTenths = 0;
    for (let i = 0; i < 16; i++) sixteenTenths += 0.1;
    expect(sixteenTenths).toBeGreaterThan(1.6);
    expect(() => assertWithinCap(sixteenTenths, 0, 1.6)).not.toThrow();
  });

  it('lanza si se pasa del tope por un margen real', () => {
    expect(() => assertWithinCap(1.6, 0.001, 1.6)).toThrow(BudgetExceededError);
  });

  it('lanza si algún argumento no es finito', () => {
    expect(() => assertWithinCap(Number.NaN, 0.06, 1.6)).toThrow(Error);
    expect(() => assertWithinCap(0, Number.NaN, 1.6)).toThrow(Error);
    expect(() => assertWithinCap(0, 0.06, Number.NaN)).toThrow(Error);
    expect(() => assertWithinCap(0, Number.POSITIVE_INFINITY, 1.6)).toThrow(Error);
    expect(() => assertWithinCap(0, 0.06, Number.POSITIVE_INFINITY)).toThrow(Error);
  });

  it('el mensaje está en español e incluye los montos en pesos, sin dólares', () => {
    try {
      assertWithinCap(1.55, 0.06, 1.6);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as Error).name).toBe('BudgetExceededError');
      expect((err as Error).message).toContain('$28.52 MXN');
      expect((err as Error).message).toContain('$1.10 MXN');
      expect((err as Error).message).toContain('$29.44 MXN');
      expect((err as Error).message).not.toMatch(/USD/);
    }
  });

  it('el mensaje usa el tipo de cambio que se le pasa', () => {
    try {
      assertWithinCap(1, 1, 1.5, 20);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('$20.00 MXN');
      expect((err as Error).message).toContain('$30.00 MXN');
    }
  });
});
