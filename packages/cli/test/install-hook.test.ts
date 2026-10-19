import { spawnSync } from 'node:child_process';
import { chmodSync, symlinkSync, lstatSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOOK_MARKER, defaultHookCommand, installHook, stableNodePath, uninstallHook } from '../src/commands/install-hook.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aa-'));
  file = join(dir, 'settings.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ORIGINAL = {
  theme: 'dark',
  permissions: { allow: ['Bash(ls:*)'] },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
    Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo otro-stop', timeout: 3 }] }],
  },
};

const write = (v: unknown): void => writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
const read = (): any => JSON.parse(readFileSync(file, 'utf8'));
const baks = (): string[] => readdirSync(dir).filter((f) => f.includes('.bak-'));
const ours = (cmd: string) => ({ matcher: '*', hooks: [{ type: 'command', command: cmd, timeout: 5 }] });

describe('installHook', () => {
  it('añade Stop y UserPromptSubmit y conserva todo lo demás', () => {
    write(ORIGINAL);
    expect(installHook(file, 'avatar').changed).toBe(true);
    const cmd = `avatar hook ${HOOK_MARKER}`;
    expect(read()).toEqual({
      theme: 'dark',
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: {
        PreToolUse: ORIGINAL.hooks.PreToolUse,
        Stop: [...ORIGINAL.hooks.Stop, ours(cmd)],
        UserPromptSubmit: [ours(cmd)],
      },
    });
  });

  it('es idempotente: la segunda llamada no cambia nada', () => {
    write(ORIGINAL);
    installHook(file, 'avatar');
    const before = readFileSync(file, 'utf8');
    expect(installHook(file, 'avatar')).toEqual({ changed: false });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(baks()).toHaveLength(1);
  });

  it('deja exactamente una copia .bak-* con el contenido original', () => {
    write(ORIGINAL);
    const original = readFileSync(file, 'utf8');
    const r = installHook(file, 'avatar');
    expect(baks()).toHaveLength(1);
    expect(readFileSync(join(dir, baks()[0]!), 'utf8')).toBe(original);
    expect(r.backupPath).toBe(join(dir, baks()[0]!));
  });

  it('crea el archivo y su carpeta si faltan, sin copia de respaldo', () => {
    const nested = join(dir, 'nuevo', '.claude', 'settings.json');
    expect(installHook(nested, 'avatar').changed).toBe(true);
    const cmd = `avatar hook ${HOOK_MARKER}`;
    expect(JSON.parse(readFileSync(nested, 'utf8'))).toEqual({
      hooks: { Stop: [ours(cmd)], UserPromptSubmit: [ours(cmd)] },
    });
    expect(readdirSync(join(dir, 'nuevo', '.claude'))).toEqual(['settings.json']);
  });

  it('reemplaza una entrada propia con otro comando, sin duplicar', () => {
    write({
      hooks: {
        Stop: [ours(`/viejo/avatar hook ${HOOK_MARKER}`), ...ORIGINAL.hooks.Stop],
        UserPromptSubmit: [ours(`/viejo/avatar hook ${HOOK_MARKER}`)],
      },
    });
    expect(installHook(file, 'avatar').changed).toBe(true);
    const cmd = `avatar hook ${HOOK_MARKER}`;
    expect(read().hooks.Stop).toEqual([...ORIGINAL.hooks.Stop, ours(cmd)]);
    expect(read().hooks.UserPromptSubmit).toEqual([ours(cmd)]);
    expect(installHook(file, 'avatar').changed).toBe(false);
  });

  it('JSON inválido: lanza en español y no escribe nada', () => {
    writeFileSync(file, '{ esto no es json');
    expect(() => installHook(file, 'avatar')).toThrow(/JSON|válido/i);
    expect(readFileSync(file, 'utf8')).toBe('{ esto no es json');
    expect(baks()).toHaveLength(0);
    expect(() => uninstallHook(file)).toThrow(/JSON|válido/i);
    expect(readFileSync(file, 'utf8')).toBe('{ esto no es json');
  });

  it('estructura inesperada (hooks.Stop no es lista): lanza y no escribe', () => {
    write({ hooks: { Stop: 'raro' } });
    const before = readFileSync(file, 'utf8');
    expect(() => installHook(file, 'avatar')).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('conserva los permisos del archivo existente', () => {
    write(ORIGINAL);
    chmodSync(file, 0o640);
    installHook(file, 'avatar');
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  it('si settings.json es un enlace simbólico, escribe en el archivo real y conserva el enlace', () => {
    const real = join(dir, 'real.json');
    writeFileSync(real, `${JSON.stringify(ORIGINAL, null, 2)}\n`);
    symlinkSync(real, file);
    installHook(file, 'avatar');
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf8')).hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('conserva exactamente el modo original (0664) pese al umask', () => {
    write(ORIGINAL);
    chmodSync(file, 0o664);
    const old = process.umask(0o077);
    try {
      installHook(file, 'avatar');
    } finally {
      process.umask(old);
    }
    expect(statSync(file).mode & 0o777).toBe(0o664);
  });

  it('sin `bin`, el comando usa rutas absolutas entre comillas y el marcador', () => {
    installHook(file);
    const command: string = read().hooks.Stop[0].hooks[0].command;
    expect(command).toBe(defaultHookCommand());
    // En Homebrew el Cellar se sustituye por el enlace estable; en otras máquinas queda execPath.
    const node = stableNodePath();
    expect(command).toContain(`"${node}"`);
    const distBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
    expect(command).toBe(`"${node}" "${distBin}" hook --from-ascii-avatar 2>/dev/null || true`);
    expect(command).toContain(HOOK_MARKER);
    // Detectado como propio: una segunda instalación no duplica.
    expect(installHook(file).changed).toBe(false);
  });
});

describe('uninstallHook', () => {
  it('deja el archivo igual al original', () => {
    write(ORIGINAL);
    const original = readFileSync(file, 'utf8');
    installHook(file, 'avatar');
    expect(uninstallHook(file).changed).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('quita solo las entradas con el marcador (también si comparten grupo)', () => {
    write({
      hooks: {
        Stop: [
          {
            matcher: '*',
            hooks: [
              { type: 'command', command: 'echo mio' },
              { type: 'command', command: `avatar hook ${HOOK_MARKER}`, timeout: 5 },
            ],
          },
        ],
      },
    });
    expect(uninstallHook(file).changed).toBe(true);
    expect(read()).toEqual({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo mio' }] }] } });
  });

  it('sin entradas propias o sin archivo: changed:false y no crea nada', () => {
    write(ORIGINAL);
    expect(uninstallHook(file)).toEqual({ changed: false });
    expect(baks()).toHaveLength(0);
    const missing = join(dir, 'no', 'existe.json');
    expect(uninstallHook(missing)).toEqual({ changed: false });
    expect(existsSync(missing)).toBe(false);
  });
});

describe('avatar install-hook (proceso real)', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const distBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

  it('instala y desinstala en la ruta de --settings, nunca en ~/.claude', () => {
    const build = spawnSync('npx', ['tsc', '-b'], { cwd: repoRoot, encoding: 'utf8' });
    expect(build.status).toBe(0);
    write(ORIGINAL);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [distBin, 'install-hook', '--settings', file, ...args], { encoding: 'utf8' });
    const a = run();
    expect(a.status).toBe(0);
    expect(a.stdout).toMatch(/Hook instalado/);
    expect(read().hooks.Stop[1].hooks[0].command).toContain(HOOK_MARKER);
    expect(run().stdout).toMatch(/ya estaba/i);
    const b = run('--uninstall');
    expect(b.status).toBe(0);
    expect(read()).toEqual(ORIGINAL);
  }, 120_000);

  it('una bandera desconocida (--unistall) no instala nada: ayuda y exit 1', () => {
    write(ORIGINAL);
    const before = readFileSync(file, 'utf8');
    const r = spawnSync(process.execPath, [distBin, 'install-hook', '--settings', file, '--unistall'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--unistall/);
    expect(r.stderr).toMatch(/Uso:/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(baks()).toHaveLength(0);
  });

  it('JSON inválido: sale con 1 y avisa en stderr', () => {
    writeFileSync(file, 'no json');
    const r = spawnSync(process.execPath, [distBin, 'install-hook', '--settings', file], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/JSON|válido/i);
    expect(readFileSync(file, 'utf8')).toBe('no json');
  });
});

describe('stableNodePath', () => {
  const cellar = '/opt/homebrew/Cellar/node/26.12.0/bin/node';
  const stable = '/opt/homebrew/bin/node';
  const fixedResolver = (map: Record<string, string>) => (p: string): string => {
    const real = map[p];
    if (real === undefined) throw new Error(`ENOENT: ${p}`);
    return real;
  };

  it('en Homebrew cambia la ruta versionada del Cellar por el enlace estable si apunta al mismo binario', () => {
    const resolve = fixedResolver({ [cellar]: cellar, [stable]: cellar });
    expect(stableNodePath(cellar, [stable, '/usr/local/bin/node'], resolve)).toBe(stable);
  });

  it('prueba los candidatos en orden y salta los que no existen', () => {
    const intel = '/usr/local/bin/node';
    const resolve = fixedResolver({ [cellar]: cellar, [intel]: cellar });
    expect(stableNodePath(cellar, [stable, intel], resolve)).toBe(intel);
  });

  it('si el enlace estable apunta a otro binario, conserva execPath', () => {
    const resolve = fixedResolver({ [cellar]: cellar, [stable]: '/opt/homebrew/Cellar/node/25.0.0/bin/node' });
    expect(stableNodePath(cellar, [stable], resolve)).toBe(cellar);
  });

  it('si ningún enlace estable existe, conserva execPath', () => {
    const resolve = fixedResolver({ [cellar]: cellar });
    expect(stableNodePath(cellar, [stable, '/usr/local/bin/node'], resolve)).toBe(cellar);
  });

  it('una ruta fuera de /Cellar/ se devuelve tal cual, sin consultar nada', () => {
    const resolve = (): string => {
      throw new Error('no debe llamarse');
    };
    expect(stableNodePath('/Users/alguien/.nvm/versions/node/v26/bin/node', [stable], resolve)).toBe(
      '/Users/alguien/.nvm/versions/node/v26/bin/node',
    );
  });

  it('defaultHookCommand usa la ruta estable que se le inyecta', () => {
    const resolve = fixedResolver({ [cellar]: cellar, [stable]: cellar });
    expect(defaultHookCommand(cellar, [stable], resolve)).toContain(`"${stable}" `);
    expect(defaultHookCommand(cellar, [stable], resolve)).not.toContain('Cellar');
  });
});
