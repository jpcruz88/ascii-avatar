// `avatar movimientos <nombre> [--liveportrait <carpeta>] [--clips <lista>]`: genera en tu equipo,
// gratis, los clips de movimiento de cabeza de un agente con LivePortrait (instalado aparte) y los
// importa con la misma validación que `avatar create --clips`. No usa Gemini ni gasta nada.
import { spawn as nodeSpawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CLIP_IDS, listClips, validateAgentName, type ClipId } from '@ascii-avatar/core';
import { loadConfig, saveConfig } from '../config.js';
import { mimeFromBytes, readImageFile, readSize } from '../image-input.js';
import { runImportFaces } from './import-faces.js';

/** Script de Python que genera los cuadros (en `tools/liveportrait/` del repositorio). */
export const DEFAULT_SCRIPT = fileURLToPath(new URL('../../../../tools/liveportrait/generate_clips.py', import.meta.url));

const README_HINT = 'Instrucciones en el README, sección «Movimientos fluidos (opcional, gratis)».';
const HF_DOWNLOAD =
  'venv/bin/huggingface-cli download KlingTeam/LivePortrait --local-dir pretrained_weights ' +
  '--exclude "*.git*" "README.md" "docs/*" "liveportrait_animals/*"';

/** Un clip necesita entre 2 y 120 cuadros (los mismos límites que la importación). */
const CLIP_MIN_FRAMES = 2;
const CLIP_MAX_FRAMES = 120;

/**
 * Avance de la generación: cuadro `frame` de `total` del clip `clip`, en la fase `calc` (LivePortrait
 * calcula el cuadro) o `write` (se guarda el PNG final).
 */
export interface ClipProgress {
  clip: ClipId;
  frame: number;
  total: number;
  phase: 'calc' | 'write';
}

/** Lo mínimo que se usa de un proceso hijo (lo cumple `ChildProcess`; las pruebas pasan uno falso). */
export interface ChildHandle {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export type Spawner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildHandle;

const defaultSpawner: Spawner = (command, args, options) => nodeSpawn(command, args, options);

export interface MovimientosOptions {
  root: string;
  name: string;
  /** Valor de `--liveportrait`, si se dio. */
  liveportrait?: string | undefined;
  /** Entorno del que se lee `ASCII_AVATAR_LIVEPORTRAIT` y que hereda el proceso de Python. */
  env?: NodeJS.ProcessEnv;
  /** Clips a generar; por defecto, los seis. */
  clips?: readonly ClipId[];
  spawn?: Spawner;
  /** Al abortarse (Ctrl-C) se mata el proceso de Python y no se importa nada. */
  signal?: AbortSignal;
  /** Carpeta donde se crea la carpeta temporal de trabajo (por defecto, la del sistema). */
  tmpBase?: string;
  script?: string;
  out: (line: string) => void;
  progress?: (p: ClipProgress) => void;
  /** Recuerda la carpeta de LivePortrait tras un éxito (por defecto, en `config.json`). */
  rememberDir?: (dir: string) => void;
}

export interface MovimientosResult {
  status: 'done' | 'failed' | 'cancelled';
  message: string;
}

const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p);

/** Separa `--clips nod,think` en ids válidos, sin repetidos. Lanza si hay uno desconocido o ninguno. */
export function parseClipList(raw: string): ClipId[] {
  const names = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (names.length === 0) throw new Error(`--clips está vacío. Los clips son ${CLIP_IDS.join(', ')}.`);
  const bad = names.find((n) => !(CLIP_IDS as readonly string[]).includes(n));
  if (bad !== undefined) throw new Error(`Clip desconocido en --clips: ${bad}. Los clips son ${CLIP_IDS.join(', ')}.`);
  return [...new Set(names)] as ClipId[];
}

/** Carpeta de LivePortrait: la bandera, si no `ASCII_AVATAR_LIVEPORTRAIT` y si no la configuración. */
export function resolveLivePortraitDir(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  configDir: string | undefined,
): string | undefined {
  const fromEnv = env.ASCII_AVATAR_LIVEPORTRAIT;
  const raw = flag ?? (fromEnv !== undefined && fromEnv !== '' ? fromEnv : configDir);
  return raw === undefined || raw.trim() === '' ? undefined : resolve(expandHome(raw.trim()));
}

export type Prerequisites =
  | { ok: true; python: string; repo: string; source: string; script: string }
  | { ok: false; message: string };

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Comprueba que todo esté en su sitio antes de lanzar nada. `dir` es la instalación de LivePortrait:
 * debe tener `venv/bin/python` y `pretrained_weights/`, ya sea directo o en `dir/LivePortrait/`.
 */
export function checkPrerequisites(
  root: string,
  name: string,
  dir: string | undefined,
  script: string = DEFAULT_SCRIPT,
): Prerequisites {
  validateAgentName(name);
  const agent = join(root, 'agents', name);
  if (!existsSync(join(agent, 'agent.json'))) {
    return { ok: false, message: `El agente "${name}" no existe. Créalo primero con avatar create ${name}.` };
  }
  const source = join(agent, 'faces', 'neutral.png');
  if (!existsSync(source)) {
    return {
      ok: false,
      message: `El agente "${name}" no tiene faces/neutral.png, que es la cara que se mueve. Vuelve a crear o importar sus caras.`,
    };
  }
  if (!existsSync(script)) {
    return {
      ok: false,
      message:
        `No encontré el generador de clips (${script}). Este comando necesita el repositorio clonado de ascii-avatar ` +
        '(con su carpeta tools/liveportrait/); una instalación empaquetada no lo trae. Córrelo desde el repositorio ' +
        `clonado. ${README_HINT}`,
    };
  }
  if (dir === undefined) {
    return {
      ok: false,
      message:
        'No sé dónde está instalado LivePortrait. Indícalo con --liveportrait <carpeta> o con la variable ' +
        `ASCII_AVATAR_LIVEPORTRAIT (se recuerda tras el primer uso). ${README_HINT}`,
    };
  }
  if (!isDir(dir)) return { ok: false, message: `No existe la carpeta de LivePortrait: ${dir}. ${README_HINT}` };
  const python = join(dir, 'venv', 'bin', 'python');
  if (!existsSync(python)) {
    return {
      ok: false,
      message:
        `No encontré el Python de LivePortrait en ${python}. Crea el entorno dentro de esa carpeta con ` +
        `«uv venv --python 3.10 venv» e instala sus dependencias. ${README_HINT}`,
    };
  }
  const repo = [dir, join(dir, 'LivePortrait')].find((d) => isDir(join(d, 'pretrained_weights')));
  if (repo === undefined) {
    return {
      ok: false,
      message:
        `Faltan los pesos de LivePortrait: no hay ${join(dir, 'pretrained_weights')}. ` +
        `Descárgalos (unos 630 MB) desde la carpeta del repositorio con: ${HF_DOWNLOAD}`,
    };
  }
  return { ok: true, python, repo, source, script };
}

/** Variables con secretos que el proceso de Python nunca necesita (llaves de API, tokens…). */
const SECRET_VARS = new Set(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
const SECRET_RE = /(_API_KEY|_TOKEN|_SECRET|_SECRET_ACCESS_KEY|_PASSWORD)$/i;

/** Copia del entorno sin llaves ni tokens (se conservan, p. ej., `PATH` o `HF_HOME`). */
export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_VARS.has(k) && !SECRET_RE.test(k)));
}

/** Arma el comando: el Python del venv con el script y sus argumentos. Nunca pasa por una shell. */
export function buildCommand(o: {
  python: string;
  script: string;
  repo: string;
  source: string;
  out: string;
  clips: readonly ClipId[];
  env: NodeJS.ProcessEnv;
}): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  return {
    command: o.python,
    args: [o.script, '--liveportrait', o.repo, '--source', o.source, '--out', o.out, '--clips', o.clips.join(',')],
    env: { ...scrubEnv(o.env), PYTORCH_ENABLE_MPS_FALLBACK: '1', PYTHONUNBUFFERED: '1' },
  };
}

const firstLine = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';

interface ChildOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  summary: boolean;
  reported?: string;
  stderrTail: string[];
}

/** Lanza el proceso, lee su avance JSON y espera a que termine (o a que lo maten por `signal`). */
function runChild(
  spawn: Spawner,
  cmd: { command: string; args: string[]; env: NodeJS.ProcessEnv },
  signal: AbortSignal | undefined,
  progress: ((p: ClipProgress) => void) | undefined,
): Promise<ChildOutcome> {
  return new Promise((resolvePromise) => {
    const outcome: ChildOutcome = { code: null, signal: null, summary: false, stderrTail: [] };
    let child: ChildHandle;
    try {
      child = spawn(cmd.command, cmd.args, { env: cmd.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolvePromise({ ...outcome, error: error instanceof Error ? error : new Error(String(error)) });
      return;
    }
    let settled = false;
    let escalate: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      child.kill('SIGTERM');
      // Si no sale por las buenas, se fuerza; siempre por su handle, nunca por nombre.
      escalate = setTimeout(() => child.kill('SIGKILL'), 5000);
      escalate.unref();
    };
    // Si Node sale por cualquier motivo mientras corre Python, no lo deja huérfano.
    const onExit = (): void => void child.kill('SIGTERM');
    process.once('exit', onExit);
    const finish = (o: Partial<ChildOutcome>): void => {
      if (settled) return;
      settled = true;
      if (escalate !== undefined) clearTimeout(escalate);
      signal?.removeEventListener('abort', onAbort);
      process.off('exit', onExit);
      resolvePromise({ ...outcome, ...o });
    };
    if (child.stdout !== null) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          return; // ruido que no es JSON
        }
        if (typeof msg !== 'object' || msg === null) return;
        const m = msg as Record<string, unknown>;
        if (m.done === true) outcome.summary = true;
        else if (typeof m.error === 'string') outcome.reported = m.error;
        else if (
          typeof m.clip === 'string' &&
          (CLIP_IDS as readonly string[]).includes(m.clip) &&
          typeof m.frame === 'number' &&
          typeof m.total === 'number'
        ) {
          progress?.({ clip: m.clip as ClipId, frame: m.frame, total: m.total, phase: m.phase === 'calc' ? 'calc' : 'write' });
        }
      });
    }
    if (child.stderr !== null) {
      createInterface({ input: child.stderr }).on('line', (line) => {
        if (line.trim() === '') return;
        outcome.stderrTail.push(line);
        if (outcome.stderrTail.length > 20) outcome.stderrTail.shift();
      });
    }
    child.once('error', (error) => finish({ error }));
    child.once('close', (code, sig) => finish({ code, signal: sig }));
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Por qué no se puede conservar un clip guardado (`undefined` si está bien): cada cuadro debe ser un
 * PNG real del mismo tamaño que las caras, y el clip tener entre 2 y 120 cuadros, como al importar.
 */
async function clipProblem(dir: string, frames: number, canvas: { width: number; height: number }): Promise<string | undefined> {
  if (frames < CLIP_MIN_FRAMES || frames > CLIP_MAX_FRAMES) {
    return `tiene ${frames} cuadros (deben ser entre ${CLIP_MIN_FRAMES} y ${CLIP_MAX_FRAMES})`;
  }
  for (let i = 0; i < frames; i++) {
    const file = `${String(i).padStart(3, '0')}.png`;
    try {
      const buf = readImageFile(join(dir, file), file);
      if (mimeFromBytes(buf) !== 'image/png') return `el cuadro ${file} no es un PNG`;
      const size = await readSize(buf, file);
      if (size.width !== canvas.width || size.height !== canvas.height) {
        return `el cuadro ${file} no coincide con el tamaño de sus caras`;
      }
    } catch {
      return `el cuadro ${file} está dañado o no se puede leer`;
    }
  }
  return undefined;
}

/**
 * Copia a `tmp` los clips que el agente ya tenía y no se regeneran, para que la importación (que
 * reemplaza el juego entero de clips) los conserve. Descarta, con un aviso, los que no pasarían la
 * validación de la importación, para no perder la generación por un clip viejo dañado.
 */
async function keepOtherClips(root: string, name: string, generated: readonly ClipId[], tmp: string, out: (l: string) => void): Promise<void> {
  const agent = join(root, 'agents', name);
  const others = (Object.entries(listClips(root, name)) as [ClipId, number][]).filter(([c]) => !generated.includes(c));
  if (others.length === 0) return;
  const label = 'la cara neutral';
  const canvas = await readSize(readImageFile(join(agent, 'faces', 'neutral.png'), label), label);
  for (const [clip, frames] of others) {
    const src = join(agent, 'clips', clip);
    const problem = await clipProblem(src, frames, canvas);
    if (problem !== undefined) {
      out(`Aviso: se descarta el clip ${clip} que tenía el agente: ${problem}.`);
      continue;
    }
    cpSync(src, join(tmp, clip), { recursive: true });
  }
}

const rememberInConfig = (root: string) => (dir: string): void => {
  const config = loadConfig(root);
  if (config.liveportraitDir !== dir) saveConfig(root, { ...config, liveportraitDir: dir });
};

export async function runMovimientos(o: MovimientosOptions): Promise<MovimientosResult> {
  const { root, name, out } = o;
  const env = o.env ?? process.env;
  const clips = o.clips ?? CLIP_IDS;
  try {
    const dir = resolveLivePortraitDir(o.liveportrait, env, loadConfig(root).liveportraitDir);
    const pre = checkPrerequisites(root, name, dir, o.script ?? DEFAULT_SCRIPT);
    if (!pre.ok) return { status: 'failed', message: pre.message };
    if (o.signal?.aborted) return { status: 'cancelled', message: 'Cancelado: no se cambió ningún clip.' };

    out(`Generando ${clips.join(', ')} con LivePortrait (Ctrl-C cancela)…`);
    const tmp = mkdtempSync(join(o.tmpBase ?? tmpdir(), 'ascii-avatar-movimientos-'));
    try {
      const cancelled: MovimientosResult = { status: 'cancelled', message: 'Cancelado: se detuvo LivePortrait y no se cambió ningún clip.' };
      const cmd = buildCommand({ ...pre, out: tmp, clips, env });
      const result = await runChild(o.spawn ?? defaultSpawner, cmd, o.signal, o.progress);
      if (o.signal?.aborted) return cancelled;
      if (result.error !== undefined) {
        return {
          status: 'failed',
          message: `No se pudo lanzar el Python de LivePortrait (${pre.python}): ${firstLine(result.error)}`,
        };
      }
      if (result.code !== 0 || !result.summary) {
        const why = result.reported ?? result.stderrTail.at(-1) ?? 'sin detalles';
        const how = result.code === null ? `por la señal ${result.signal ?? 'desconocida'}` : `con código ${result.code}`;
        return {
          status: 'failed',
          message: `LivePortrait terminó ${how}: ${why}. No se cambió ningún clip.`,
        };
      }
      await keepOtherClips(root, name, clips, tmp, out);
      // Último punto en que Ctrl-C cancela; la importación en sí es atómica y rápida.
      if (o.signal?.aborted) return cancelled;
      const imported = await runImportFaces({ root, name, clipsDir: tmp, out });
      if (imported.status === 'failed') {
        return { status: 'failed', message: `Los cuadros se generaron pero no se pudieron importar: ${imported.message}` };
      }
      // Se recuerda la carpeta para la próxima vez (la que tiene `venv/`). Si no se puede, los clips
      // ya están importados: se avisa y el comando termina bien.
      if (dir !== undefined) {
        try {
          (o.rememberDir ?? rememberInConfig(root))(dir);
        } catch (error) {
          out(`Aviso: no se pudo guardar la carpeta de LivePortrait en la configuración (${firstLine(error)}); la próxima vez indícala con --liveportrait.`);
        }
      }
      const counts = listClips(root, name);
      const made = clips.map((c) => `${c} (${counts[c] ?? 0} cuadros)`).join(', ');
      return {
        status: 'done',
        message: `Listo: el agente "${name}" tiene clips nuevos: ${made}. Se generaron en tu equipo con LivePortrait, sin costo.`,
      };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } catch (error) {
    return { status: 'failed', message: firstLine(error) };
  }
}

/**
 * Muestra el avance: en una terminal, una barra que se redibuja (primero «calculando», luego
 * «guardando»); fuera de ella, una línea por clip terminado.
 */
export function progressPrinter(stream: { isTTY?: boolean; write(s: string): unknown }): (p: ClipProgress) => void {
  return ({ clip, frame, total, phase }) => {
    const finished = phase === 'write' && frame >= total;
    if (stream.isTTY === true) {
      const width = 24;
      const full = Math.round((frame / Math.max(total, 1)) * width);
      const label = phase === 'calc' ? 'calculando' : 'guardando';
      stream.write(`\r\x1b[2K  ${clip.padEnd(10)} ${'█'.repeat(full)}${'░'.repeat(width - full)} ${label} ${frame}/${total}`);
      if (finished) stream.write('\n');
    } else if (finished) {
      stream.write(`  ${clip}: ${total} cuadros\n`);
    }
  };
}

/** Punto de entrada desde `bin.ts`: valida, conecta Ctrl-C con el proceso de Python e imprime. */
export async function runMovimientosCli(o: { root: string; name: string; liveportrait?: string; clips?: string }): Promise<number> {
  let clips: ClipId[] | undefined;
  try {
    validateAgentName(o.name);
    clips = o.clips === undefined ? undefined : parseClipList(o.clips);
  } catch (error) {
    console.error(firstLine(error));
    return 1;
  }
  // Ctrl-C, y también SIGTERM o SIGHUP (p. ej. al cerrar la terminal), detienen a Python por su
  // handle y limpian antes de salir; sin estos manejadores, Node moriría dejándolo huérfano.
  const ac = new AbortController();
  const onSignal = (): void => {
    if (!ac.signal.aborted) process.stderr.write('\nCancelando: deteniendo LivePortrait…\n');
    ac.abort();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const s of signals) process.on(s, onSignal);
  try {
    const r = await runMovimientos({
      root: o.root,
      name: o.name,
      liveportrait: o.liveportrait,
      ...(clips === undefined ? {} : { clips }),
      signal: ac.signal,
      out: (line) => void process.stdout.write(`${line}\n`),
      progress: progressPrinter(process.stdout),
    });
    (r.status === 'done' ? console.log : console.error)(r.message);
    return r.status === 'done' ? 0 : r.status === 'cancelled' ? 130 : 1;
  } finally {
    for (const s of signals) process.off(s, onSignal);
  }
}
