import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

/** El usuario cerró la entrada (Ctrl-D) o pulsó Ctrl-C. */
export class PromptAborted extends Error {
  constructor() {
    super('Cancelado.');
    this.name = 'PromptAborted';
  }
}

function requireTty(): void {
  if (!process.stdin.isTTY) throw new Error('Esta pregunta necesita una terminal interactiva.');
}

/** Pregunta una línea. Ctrl-C o Ctrl-D cancelan. */
export function askLine(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      requireTty();
    } catch (error) {
      reject(error);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => {
      if (!answered) reject(new PromptAborted());
    });
    rl.question(`${question} `, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

/** Sí solo con `s`, `si` o `sí` (sin distinguir mayúsculas). */
export async function askYesNo(question: string): Promise<boolean> {
  return ['s', 'si', 'sí'].includes((await askLine(question)).trim().toLowerCase());
}

/** Lee un secreto sin mostrarlo (ni siquiera asteriscos). Enter termina; Ctrl-C cancela. */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      requireTty();
    } catch (error) {
      reject(error);
      return;
    }
    const stdin = process.stdin;
    let secret = '';
    process.stdout.write(`${question} `);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const finish = (error?: Error): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(secret.trim());
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003' || ch === '\u0004') return finish(new PromptAborted());
        if (ch === '\u007f' || ch === '\b') secret = secret.slice(0, -1);
        else if (ch >= ' ') secret += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Limpia una ruta pegada en la terminal: comillas, espacios escapados y `~`. */
export function cleanPath(raw: string): string {
  let p = raw.trim();
  if (p.length >= 2 && (p[0] === "'" || p[0] === '"') && p.endsWith(p[0] as string)) p = p.slice(1, -1);
  p = p.replace(/\\(.)/g, '$1');
  return p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p;
}
