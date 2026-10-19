import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DAILY_LIMIT_USD, DEFAULT_MXN_PER_USD, type AsciiMode } from '@ascii-avatar/core';

export interface CliConfig {
  activeAgent: string | null;
  voice: boolean;
  /** Límite diario de voz en USD (el que se compara con el registro de gasto). */
  dailyLimitUsd: number;
  /** Tipo de cambio para mostrar montos en pesos (MXN por USD). Solo afecta a lo que se muestra. */
  mxnPorUsd: number;
  /** Límite diario de voz en pesos. Si está presente y es válido, manda sobre `dailyLimitUsd`. */
  limiteDiarioMxn?: number;
  mode: AsciiMode;
  cols: number;
  /** Carpeta de la instalación local de LivePortrait (`avatar movimientos`). Opcional. */
  liveportraitDir?: string;
}

/** Valores por defecto. El modo `grabado` (blanco y negro, tinta sobre papel) es el aspecto por defecto. */
export const DEFAULT_CONFIG: Readonly<CliConfig> = {
  activeAgent: null,
  voice: false,
  dailyLimitUsd: DEFAULT_DAILY_LIMIT_USD,
  mxnPorUsd: DEFAULT_MXN_PER_USD,
  mode: 'grabado',
  cols: 70,
};

export { defaultRoot, socketPath } from './paths.js';

export const configPath = (root: string): string => join(root, 'config.json');
export const ledgerPath = (root: string): string => join(root, 'ledger.jsonl');

/** Crea la carpeta de datos solo para el usuario (0700), también si ya existía. */
export function ensureRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
}

/** Lee `<root>/config.json`. Un archivo ausente, corrupto o con campos inválidos nunca lanza: cae a los defaults. */
export function loadConfig(root: string): CliConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath(root), 'utf8'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
  const c = raw as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  return {
    activeAgent: typeof c.activeAgent === 'string' && c.activeAgent !== '' ? c.activeAgent : d.activeAgent,
    voice: typeof c.voice === 'boolean' ? c.voice : d.voice,
    dailyLimitUsd:
      typeof c.dailyLimitUsd === 'number' && Number.isFinite(c.dailyLimitUsd) && c.dailyLimitUsd >= 0
        ? c.dailyLimitUsd
        : d.dailyLimitUsd,
    mxnPorUsd:
      typeof c.mxnPorUsd === 'number' && Number.isFinite(c.mxnPorUsd) && c.mxnPorUsd > 0
        ? c.mxnPorUsd
        : d.mxnPorUsd,
    ...(typeof c.limiteDiarioMxn === 'number' && Number.isFinite(c.limiteDiarioMxn) && c.limiteDiarioMxn >= 0
      ? { limiteDiarioMxn: c.limiteDiarioMxn }
      : {}),
    mode: c.mode === 'grabado' || c.mode === 'glyphs' || c.mode === 'halfblock' ? c.mode : d.mode,
    cols:
      typeof c.cols === 'number' && Number.isInteger(c.cols) && c.cols >= 20 && c.cols <= 500
        ? c.cols
        : d.cols,
    ...(typeof c.liveportraitDir === 'string' && c.liveportraitDir !== '' ? { liveportraitDir: c.liveportraitDir } : {}),
  };
}

/**
 * Límite diario de voz en USD, que es lo que se compara con el registro de gasto. Si hay un
 * `limiteDiarioMxn` válido manda sobre `dailyLimitUsd` y se convierte con `mxnPorUsd`.
 */
export function effectiveDailyLimitUsd(config: CliConfig): number {
  return config.limiteDiarioMxn === undefined ? config.dailyLimitUsd : config.limiteDiarioMxn / config.mxnPorUsd;
}

/** Guarda la configuración de forma atómica: archivo temporal en la misma carpeta y renombrado. */
export function saveConfig(root: string, config: CliConfig): void {
  ensureRoot(root);
  const target = configPath(root);
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
