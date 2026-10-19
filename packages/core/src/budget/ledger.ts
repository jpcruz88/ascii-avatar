import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_MXN_PER_USD, formatMxn } from './money.js';

/** Tope duro de gasto en creación (imágenes y demás) por agente, en USD. */
export const CREATION_CAP_USD = 1.6;

/** Límite diario de gasto en voz por defecto, en USD. */
export const DEFAULT_DAILY_LIMIT_USD = 0.3;

/** Margen para que el ruido de punto flotante no dispare el tope (1.54 + 0.06 vs 1.6). */
const EPSILON = 1e-9;

export type SpendKind = 'create' | 'voice';

interface SpendRecord {
  ts: Date;
  kind: SpendKind;
  agent: string;
  usd: number;
}

/** Se lanza cuando un gasto superaría el tope permitido. */
export class BudgetExceededError extends Error {
  constructor(
    readonly spent: number,
    readonly next: number,
    readonly cap: number,
    mxnPerUsd: number = DEFAULT_MXN_PER_USD,
  ) {
    // Los montos son USD; el mensaje los muestra en pesos.
    super(
      `Presupuesto excedido: ya se gastaron ${formatMxn(spent, mxnPerUsd)} y este gasto de ` +
        `${formatMxn(next, mxnPerUsd)} superaría el tope de ${formatMxn(cap, mxnPerUsd)}.`,
    );
    this.name = 'BudgetExceededError';
  }
}

/** Lanza `BudgetExceededError` si `spent + next` supera `cap`; también si algún valor no es finito. */
export function assertWithinCap(
  spent: number,
  next: number,
  cap: number,
  mxnPerUsd: number = DEFAULT_MXN_PER_USD,
): void {
  if (!Number.isFinite(spent) || !Number.isFinite(next) || !Number.isFinite(cap)) {
    throw new Error(
      `Montos de presupuesto inválidos: gastado=${spent}, siguiente=${next}, tope=${cap}. Deben ser números finitos.`,
    );
  }
  if (spent + next > cap + EPSILON) throw new BudgetExceededError(spent, next, cap, mxnPerUsd);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseLine(line: string): SpendRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { ts, kind, agent, usd } = raw as Record<string, unknown>;
  if (kind !== 'create' && kind !== 'voice') return undefined;
  if (typeof agent !== 'string') return undefined;
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return undefined;
  if (typeof ts !== 'string') return undefined;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return undefined;
  return { ts: date, kind, agent, usd };
}

/**
 * Registro de gasto en un archivo JSONL (una línea `{ts, kind, agent, usd}` por gasto).
 * Solo agrega al final y nunca reescribe; cada lectura va al archivo, sin caché, así que
 * varias instancias (o procesos) sobre el mismo archivo coinciden. "Hoy" es la fecha local.
 */
export class Ledger {
  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Agrega un gasto. Rechaza un `usd` no finito o negativo. */
  record(kind: SpendKind, agent: string, usd: number): void {
    if (!Number.isFinite(usd) || usd < 0) {
      throw new Error(`Monto en USD inválido: ${usd}. Debe ser un número finito y no negativo.`);
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const line = JSON.stringify({ ts: this.now().toISOString(), kind, agent, usd });
    // Si un corte dejó la última línea sin salto, empezar en línea nueva para no pegarse a ella.
    const prefix = this.endsMidLine() ? '\n' : '';
    appendFileSync(this.file, `${prefix}${line}\n`);
  }

  /**
   * USD de voz gastados hoy (fecha local). El gasto de creación no cuenta. Con `agent`, solo los
   * registros cuyo agente cumple el filtro (p. ej. los de la página web, `<nombre>@web`).
   */
  spentToday(agent?: (name: string) => boolean): number {
    const today = this.now();
    return this.sum((r) => r.kind === 'voice' && sameLocalDay(r.ts, today) && (agent === undefined || agent(r.agent)));
  }

  /** USD de creación gastados por `agent`, de todas las fechas. */
  spentCreation(agent: string): number {
    return this.sum((r) => r.kind === 'create' && r.agent === agent);
  }

  private sum(match: (r: SpendRecord) => boolean): number {
    let total = 0;
    for (const record of this.read()) if (match(record)) total += record.usd;
    return total;
  }

  private read(): SpendRecord[] {
    if (!existsSync(this.file)) return [];
    const records: SpendRecord[] = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const record = parseLine(line);
      if (record) records.push(record);
    }
    return records;
  }

  private endsMidLine(): boolean {
    if (!existsSync(this.file)) return false;
    const size = statSync(this.file).size;
    if (size === 0) return false;
    const fd = openSync(this.file, 'r');
    try {
      const last = Buffer.alloc(1);
      readSync(fd, last, 0, 1, size - 1);
      return last[0] !== 0x0a;
    } finally {
      closeSync(fd);
    }
  }
}
