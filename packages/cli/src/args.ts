export interface ParsedArgs {
  cmd: string | undefined;
  positionals: string[];
  flags: Record<string, string | true>;
}

/** Modos de dibujo del panel (`--modo`). Se repite aquí para no importar `core` en la ruta del hook. */
export const MODOS = ['grabado', 'glyphs', 'halfblock'] as const;

export function isModo(value: unknown): value is (typeof MODOS)[number] {
  return typeof value === 'string' && (MODOS as readonly string[]).includes(value);
}

/** Estilos de `avatar create --estilo`. Se repite aquí (es `AGENT_STYLES` de core) por la misma razón. */
export const ESTILOS = ['grabado', 'foto'] as const;

export function isEstilo(value: unknown): value is (typeof ESTILOS)[number] {
  return typeof value === 'string' && (ESTILOS as readonly string[]).includes(value);
}

/** Banderas que llevan un valor; las demás son interruptores. */
export const VALUE_FLAGS: ReadonlySet<string> = new Set(['foto', 'caras', 'poses', 'clips', 'agente', 'cols', 'modo', 'settings', 'voz', 'estilo', 'liveportrait']);

/** Separa `argv` (sin `node` ni el script) en comando, posicionales y banderas. Lanza si falta un valor. */
export function parseArgs(argv: readonly string[], valueFlags: ReadonlySet<string> = VALUE_FLAGS): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--') || arg.length === 2) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (eq !== -1) {
      flags[name] = arg.slice(eq + 1);
    } else if (valueFlags.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`Falta el valor de --${name}.`);
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  const [cmd, ...rest] = positionals;
  return { cmd, positionals: rest, flags };
}

/** Banderas válidas de cada subcomando. */
const ALLOWED_FLAGS: Readonly<Record<string, readonly string[]>> = {
  create: ['foto', 'caras', 'poses', 'clips', 'estilo', 'sin-poses'],
  panel: ['agente', 'cols', 'modo'],
  voice: [],
  voz: ['voz', 'estilo'],
  'install-hook': ['uninstall', 'settings'],
  movimientos: ['liveportrait', 'clips'],
  help: [],
};

/** Banderas de `flags` que el subcomando `cmd` no conoce. */
export function unknownFlags(cmd: string, flags: Readonly<Record<string, unknown>>): string[] {
  const allowed = ALLOWED_FLAGS[cmd] ?? [];
  return Object.keys(flags).filter((f) => !allowed.includes(f));
}
