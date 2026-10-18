// Solo builtins de Node: `avatar hook` importa esto sin cargar `@ascii-avatar/core` ni `sharp`.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Carpeta de datos: `ASCII_AVATAR_HOME` o `~/.ascii-avatar`. */
export function defaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.ASCII_AVATAR_HOME;
  return home !== undefined && home !== '' ? home : join(homedir(), '.ascii-avatar');
}

export const socketPath = (root: string): string => join(root, 'avatar.sock');
