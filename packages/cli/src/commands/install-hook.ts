import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Texto que identifica las entradas de hook que puso esta herramienta. */
export const HOOK_MARKER = '--from-ascii-avatar';

/** Eventos de Claude Code en los que se instala el hook. */
const EVENTS = ['Stop', 'UserPromptSubmit'] as const;

export interface HookChange {
  changed: boolean;
  /** Copia de respaldo de `settings.json` antes de cambiarlo (solo si ya existía). */
  backupPath?: string;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const quote = (s: string): string => `"${s.replace(/[\\"$`]/g, '\\$&')}"`;

/**
 * Comando con rutas absolutas (Node y `dist/bin.js`) para que el hook funcione aunque `avatar`
 * no esté en el PATH del entorno donde Claude Code lo ejecuta.
 */
export function defaultHookCommand(): string {
  let bin = fileURLToPath(new URL('../bin.js', import.meta.url));
  // Al correr desde las fuentes (pruebas), apunta al binario compilado.
  bin = bin.replace(/([\\/])src([\\/])bin\.js$/, '$1dist$2bin.js');
  return `${quote(process.execPath)} ${quote(bin)} hook ${HOOK_MARKER}`;
}

function isOurs(hook: unknown): boolean {
  return isObject(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER);
}

interface Loaded {
  settings: Json;
  text: string | undefined;
}

function load(path: string): Loaded {
  if (!existsSync(path)) return { settings: {}, text: undefined };
  const text = readFileSync(path, 'utf8');
  if (text.trim() === '') return { settings: {}, text };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} no es un JSON válido. Corrígelo a mano; no se tocó nada.`);
  }
  if (!isObject(parsed)) throw new Error(`${path} no es un objeto JSON válido. No se tocó nada.`);
  return { settings: parsed, text };
}

function hooksOf(settings: Json, create: boolean, path: string): Json | undefined {
  const hooks = settings.hooks;
  if (hooks === undefined) {
    if (!create) return undefined;
    return (settings.hooks = {}) as Json;
  }
  if (!isObject(hooks)) throw new Error(`"hooks" en ${path} no es un objeto. No se tocó nada.`);
  return hooks;
}

function eventGroups(hooks: Json, event: string, path: string): unknown[] | undefined {
  const groups = hooks[event];
  if (groups === undefined) return undefined;
  if (!Array.isArray(groups)) throw new Error(`"hooks.${event}" en ${path} no es una lista. No se tocó nada.`);
  return groups;
}

/** Quita de `groups` los hooks propios (y los grupos que queden vacíos). Un grupo ajeno raro se deja tal cual. */
function stripOurs(groups: unknown[]): { kept: unknown[]; removed: number } {
  let removed = 0;
  const kept: unknown[] = [];
  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const rest = group.hooks.filter((h) => !isOurs(h));
    removed += group.hooks.length - rest.length;
    if (rest.length === group.hooks.length) kept.push(group);
    else if (rest.length > 0) kept.push({ ...group, hooks: rest });
  }
  return { kept, removed };
}

function indentOf(text: string | undefined): string | number {
  return text?.match(/^\{[ \t]*\r?\n([ \t]+)"/)?.[1] ?? 2;
}

function backupName(path: string): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  for (let n = 0; ; n++) {
    const candidate = `${path}.bak-${stamp}${n === 0 ? '' : `-${n}`}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/** Escritura atómica: temporal en la misma carpeta y renombrado. Conserva los permisos del original. */
function writeAtomic(target: string, content: string, mode: number): void {
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function save(path: string, settings: Json, original: string | undefined): HookChange {
  // Si es un enlace simbólico, se escribe en el archivo real para no romper el enlace.
  const target = original !== undefined && lstatSync(path).isSymbolicLink() ? realpathSync(path) : path;
  let backupPath: string | undefined;
  if (original !== undefined) {
    backupPath = backupName(target);
    copyFileSync(target, backupPath, constants.COPYFILE_EXCL);
  } else {
    mkdirSync(dirname(target), { recursive: true });
  }
  const mode = original === undefined ? 0o600 : statSync(target).mode & 0o777;
  const end = original === undefined || original.endsWith('\n') ? '\n' : '';
  writeAtomic(target, `${JSON.stringify(settings, null, indentOf(original))}${end}`, mode);
  return backupPath === undefined ? { changed: true } : { changed: true, backupPath };
}

/**
 * Añade el hook a `Stop` y `UserPromptSubmit`. Idempotente: si ya está tal cual no escribe; si hay
 * una entrada propia con otro comando, la reemplaza. Conserva todo lo demás. Lanza (sin escribir) si el
 * archivo no es un JSON válido o tiene una estructura inesperada.
 */
export function installHook(settingsPath: string, bin?: string): HookChange {
  const command = bin === undefined ? defaultHookCommand() : `${bin} hook ${HOOK_MARKER}`;
  const entry = { matcher: '*', hooks: [{ type: 'command', command, timeout: 5 }] };
  const { settings, text } = load(settingsPath);
  const hooks = hooksOf(settings, true, settingsPath) as Json;
  let changed = false;
  for (const event of EVENTS) {
    const groups = eventGroups(hooks, event, settingsPath) ?? [];
    const { kept, removed } = stripOurs(groups);
    const upToDate =
      removed === 1 &&
      groups.length === kept.length + 1 &&
      groups.some((g) => JSON.stringify(g) === JSON.stringify(entry));
    if (upToDate) continue;
    hooks[event] = [...kept, entry];
    changed = true;
  }
  return changed ? save(settingsPath, settings, text) : { changed: false };
}

/** Quita solo las entradas con `HOOK_MARKER`. Si no hay ninguna (o no hay archivo), no escribe. */
export function uninstallHook(settingsPath: string): HookChange {
  const { settings, text } = load(settingsPath);
  const hooks = hooksOf(settings, false, settingsPath);
  if (hooks === undefined) return { changed: false };
  let changed = false;
  for (const event of Object.keys(hooks)) {
    const groups = eventGroups(hooks, event, settingsPath);
    if (groups === undefined) continue;
    const { kept, removed } = stripOurs(groups);
    if (removed === 0) continue;
    changed = true;
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!changed) return { changed: false };
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return save(settingsPath, settings, text);
}
