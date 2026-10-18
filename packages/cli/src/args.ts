export interface ParsedArgs {
  cmd: string | undefined;
  positionals: string[];
  flags: Record<string, string | true>;
}

/** Banderas que llevan un valor; las demás son interruptores. */
export const VALUE_FLAGS: ReadonlySet<string> = new Set(['foto', 'agente', 'cols', 'modo', 'settings']);

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
  create: ['foto'],
  panel: ['agente', 'cols', 'modo'],
  voice: [],
  'install-hook': ['uninstall', 'settings'],
  help: [],
};

/** Banderas de `flags` que el subcomando `cmd` no conoce. */
export function unknownFlags(cmd: string, flags: Readonly<Record<string, unknown>>): string[] {
  const allowed = ALLOWED_FLAGS[cmd] ?? [];
  return Object.keys(flags).filter((f) => !allowed.includes(f));
}
