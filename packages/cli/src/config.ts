import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DAILY_LIMIT_USD, type AsciiMode } from '@ascii-avatar/core';

export interface CliConfig {
  activeAgent: string | null;
  voice: boolean;
  dailyLimitUsd: number;
  mode: AsciiMode;
  cols: number;
}

/** Valores por defecto. `mode` es provisional hasta que el usuario elija en el experimento de la Task 4. */
export const DEFAULT_CONFIG: Readonly<CliConfig> = {
  activeAgent: null,
  voice: false,
  dailyLimitUsd: DEFAULT_DAILY_LIMIT_USD,
  mode: 'halfblock',
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
    mode: c.mode === 'glyphs' || c.mode === 'halfblock' ? c.mode : d.mode,
    cols:
      typeof c.cols === 'number' && Number.isInteger(c.cols) && c.cols >= 20 && c.cols <= 500
        ? c.cols
        : d.cols,
  };
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
