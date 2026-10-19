#!/usr/bin/env node
// Punto de entrada del comando `avatar`. Aquí solo se importan, de forma estática, builtins de Node,
// `args.js` y `paths.js`; cada subcomando carga el resto con `import()` dinámico. `avatar hook` corre en
// cada turno de Claude Code y no puede tocar `sharp` ni `@ascii-avatar/*` (una falla nativa lo rompería).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isModo, parseArgs, unknownFlags, type ParsedArgs } from './args.js';
import { defaultRoot } from './paths.js';

const HELP = `avatar: avatar ASCII animado para la terminal.

Uso:
  avatar create <nombre> [--foto <ruta>]   Crea un agente a partir de una foto (usa Gemini)
  avatar create <nombre> --caras <carpeta> [--foto <ruta>] [--poses <carpeta>] [--clips <carpeta>]
                                           Importa tus propias 8 caras PNG y, si quieres, poses y clips
                                           de movimiento (sin Gemini, sin llave, sin costo)
  avatar create <nombre> --poses <carpeta> | --clips <carpeta>
                                           Agrega o reemplaza las poses o los clips de un agente que ya
                                           existe, sin tocar sus caras
  avatar panel [--agente <nombre>] [--cols <n>] [--modo grabado|glyphs|halfblock]
                                           Abre el panel (tecla v: voz, q: salir)
  avatar voice on|off                      Activa o desactiva la voz
  avatar voz <nombre> [--voz <Nombre>] [--estilo "<texto>"]
                                           Muestra o cambia la voz y el estilo de voz de un agente
                                           (--estilo "" quita el estilo; reinicia el panel para aplicarlo)
  avatar install-hook [--uninstall] [--settings <ruta>]
                                           Conecta (o desconecta) el avatar con Claude Code
  avatar help                              Muestra esta ayuda
`;

const fail = (message: string): number => {
  console.error(message);
  return 1;
};

async function hook(): Promise<void> {
  // Claude Code suma lo que el hook escriba a su contexto: aquí no se escribe nada, pase lo que pase.
  const quiet = (): void => undefined;
  process.stdout.on('error', quiet);
  process.stderr.on('error', quiet);
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  setTimeout(() => process.exit(0), 400);
  try {
    const { runHook } = await import('./commands/hook.js');
    const root = defaultRoot();
    const input = await readStdin(1024 * 1024, 200);
    await runHook(input, root);
  } catch {
    // Nunca debe romper a Claude Code.
  }
  process.exit(0);
}

/** Lee stdin hasta `maxBytes` (descarta el resto), el fin de la entrada o `waitMs`, lo que ocurra primero. */
function readStdin(maxBytes: number, waitMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (): void => {
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(done, waitMs);
    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxBytes) done();
    });
    process.stdin.once('end', done);
    process.stdin.once('error', done);
  });
}

/** Carpetas a importar con `avatar create`: caras, poses y clips (todas opcionales por separado). */
interface ImportDirs {
  caras?: string;
  poses?: string;
  clips?: string;
}

/** `avatar create <nombre> --caras|--poses|--clips <carpeta>`: no toca Gemini ni pide llave. */
async function importFaces(name: string, dirs: ImportDirs, photo: string | true | undefined, root: string): Promise<number> {
  if (photo === true) return fail('Falta la ruta después de --foto.');
  try {
    const { validateAgentName } = await import('@ascii-avatar/core');
    const { runImportFaces } = await import('./commands/import-faces.js');
    const { cleanPath } = await import('./prompts.js');
    validateAgentName(name);
    const result = await runImportFaces({
      root,
      name,
      ...(dirs.caras === undefined ? {} : { facesDir: cleanPath(dirs.caras) }),
      ...(dirs.poses === undefined ? {} : { posesDir: cleanPath(dirs.poses) }),
      ...(dirs.clips === undefined ? {} : { clipsDir: cleanPath(dirs.clips) }),
      ...(photo === undefined ? {} : { photoPath: cleanPath(photo) }),
      out: (line) => void process.stdout.write(`${line}\n`),
    });
    (result.status === 'failed' ? console.error : console.log)(result.message);
    return result.status === 'failed' ? 1 : 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message.split('\n')[0] ?? 'Error.' : 'Error.');
  }
}

async function create(args: ParsedArgs, root: string): Promise<number> {
  const [name] = args.positionals;
  if (name === undefined) {
    return fail('Uso: avatar create <nombre> [--foto <ruta>] [--caras <carpeta>] [--poses <carpeta>] [--clips <carpeta>]');
  }
  const { caras, poses, clips } = args.flags;
  for (const [flag, value] of [['caras', caras], ['poses', poses], ['clips', clips]] as const) {
    if (value === true) return fail(`Falta la carpeta después de --${flag}.`);
  }
  if (caras !== undefined || poses !== undefined || clips !== undefined) {
    const dirs: ImportDirs = {
      ...(typeof caras === 'string' ? { caras } : {}),
      ...(typeof poses === 'string' ? { poses } : {}),
      ...(typeof clips === 'string' ? { clips } : {}),
    };
    return importFaces(name, dirs, args.flags.foto, root);
  }
  const { existsSync } = await import('node:fs');
  const { Ledger, loadApiKey, saveApiKey, validateAgentName } = await import('@ascii-avatar/core');
  const { createGeminiImageClient, loadGeminiConfig } = await import('@ascii-avatar/gemini');
  const { runCreate } = await import('./commands/create.js');
  const { ensureRoot, ledgerPath, loadConfig } = await import('./config.js');
  const { askLine, askSecret, askYesNo, cleanPath, PromptAborted } = await import('./prompts.js');
  try {
    validateAgentName(name);
    let photoPath = typeof args.flags.foto === 'string' ? cleanPath(args.flags.foto) : undefined;
    if (photoPath === undefined && !existsSync(join(root, 'agents', name, 'agent.json'))) {
      photoPath = cleanPath(await askLine('Ruta de la foto (PNG, JPG o WebP):'));
    }
    let key = loadApiKey(root);
    if (key === undefined) {
      key = await askSecret('Llave de la API de Gemini (no se muestra al escribir):');
      if (key === '') return fail('Hace falta la llave de Gemini. Consíguela en https://aistudio.google.com/apikey');
      saveApiKey(root, key);
    }
    ensureRoot(root);
    const config = loadConfig(root);
    const result = await runCreate({
      root,
      name,
      ...(photoPath === undefined ? {} : { photoPath }),
      imageClient: createGeminiImageClient(loadGeminiConfig(process.env, key)),
      ledger: new Ledger(ledgerPath(root)),
      ask: askYesNo,
      out: (line) => void process.stdout.write(`${line}\n`),
      mode: config.mode,
      cols: config.cols,
    });
    (result.status === 'failed' ? console.error : console.log)(result.message);
    return result.status === 'failed' ? 1 : 0;
  } catch (error) {
    if (error instanceof PromptAborted) return fail(error.message);
    // Solo el mensaje: nunca la llave ni trazas.
    return fail(error instanceof Error ? error.message.split('\n')[0] ?? 'Error.' : 'Error.');
  }
}

async function panel(args: ParsedArgs, root: string): Promise<number> {
  const { validateAgentName } = await import('@ascii-avatar/core');
  const { agente, cols, modo } = args.flags;
  try {
    if (agente === true || cols === true || modo === true) return fail('Faltan valores en las opciones.');
    if (agente !== undefined) validateAgentName(agente);
    if (cols !== undefined && !(/^\d+$/.test(cols) && Number(cols) >= 20 && Number(cols) <= 500)) {
      return fail('--cols debe ser un número entero entre 20 y 500.');
    }
    if (modo !== undefined && !isModo(modo)) {
      return fail('--modo debe ser grabado, glyphs o halfblock.');
    }
    const { runPanel } = await import('./commands/panel.js');
    return await runPanel({
      root,
      ...(agente === undefined ? {} : { agent: agente }),
      ...(cols === undefined ? {} : { cols: Number(cols) }),
      ...(modo === undefined ? {} : { mode: modo }),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Error.');
  }
}

async function voz(args: ParsedArgs, root: string): Promise<number> {
  const [name] = args.positionals;
  if (name === undefined) {
    return fail(`Uso: avatar voz <nombre> [--voz <Nombre>] [--estilo "<texto>"]\n\n${HELP}`);
  }
  const { voz: vozFlag, estilo } = args.flags;
  if (vozFlag === true || estilo === true) return fail('Faltan valores en las opciones.');
  try {
    const { runVoz } = await import('./commands/voz.js');
    const r = runVoz({
      root,
      name,
      ...(vozFlag === undefined ? {} : { voz: vozFlag }),
      ...(estilo === undefined ? {} : { estilo }),
    });
    (r.ok ? console.log : console.error)(r.message);
    return r.ok ? 0 : 1;
  } catch (error) {
    return fail(error instanceof Error ? (error.message.split('\n')[0] ?? 'Error.') : 'Error.');
  }
}

async function installHookCmd(args: ParsedArgs): Promise<number> {
  const { installHook, uninstallHook } = await import('./commands/install-hook.js');
  const flag = args.flags.settings;
  if (flag === true) return fail('Falta la ruta después de --settings.');
  const path = flag ?? join(homedir(), '.claude', 'settings.json');
  try {
    const uninstall = args.flags.uninstall === true;
    const r = uninstall ? uninstallHook(path) : installHook(path);
    if (!r.changed) {
      console.log(uninstall ? `No había nada que quitar en ${path}.` : `El hook ya estaba instalado en ${path}.`);
      return 0;
    }
    console.log(uninstall ? `Hook quitado de ${path}.` : `Hook instalado en ${path} (eventos Stop y UserPromptSubmit).`);
    if (r.backupPath !== undefined) console.log(`Copia de respaldo: ${r.backupPath}`);
    console.log('Si tienes sesiones de Claude Code abiertas, reinícialas para que lean el cambio.');
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Error.');
  }
}

async function main(argv: string[]): Promise<number> {
  const root = defaultRoot();
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : 'Argumentos no válidos.'}\n\n${HELP}`);
  }
  if (args.cmd !== undefined) {
    const unknown = unknownFlags(args.cmd, args.flags);
    if (unknown.length > 0 && ['create', 'panel', 'voice', 'voz', 'install-hook', 'help'].includes(args.cmd)) {
      return fail(`Opción desconocida: ${unknown.map((f) => `--${f}`).join(', ')}\n\n${HELP}`);
    }
  }
  switch (args.cmd) {
    case undefined:
    case 'help':
      console.log(HELP);
      return 0;
    case 'create':
      return create(args, root);
    case 'panel':
      return panel(args, root);
    case 'voice': {
      try {
        const { runVoice } = await import('./commands/voice.js');
        const r = await runVoice(args.positionals[0] ?? '', root);
        (r.ok ? console.log : console.error)(r.message);
        return r.ok ? 0 : 1;
      } catch (error) {
        return fail(`No se pudo cambiar la voz: ${error instanceof Error ? (error.message.split('\n')[0] ?? 'Error.') : 'Error.'}`);
      }
    }
    case 'voz':
      return voz(args, root);
    case 'install-hook':
      return installHookCmd(args);
    default:
      return fail(`Comando desconocido: ${args.cmd}\n\n${HELP}`);
  }
}

// `hook` se despacha antes que nada, sin pasar por parseArgs: no puede fallar ni escribir.
if (process.argv[2] === 'hook') {
  await hook();
} else {
  process.exitCode = await main(process.argv.slice(2));
}
