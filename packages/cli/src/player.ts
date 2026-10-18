import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Playback {
  /** Se resuelve cuando termina el audio (o se detiene); nunca rechaza. */
  done: Promise<void>;
  stop(): void;
}

/** Costura del reproductor: hoy `afplay` (macOS); otros sistemas pueden agregarse detrás de esta interfaz. */
export interface AudioPlayer {
  play(wav: Buffer): Playback;
}

export interface AfplayOptions {
  platform?: NodeJS.Platform;
  /** Para pruebas; por defecto `child_process.spawn`. */
  spawn?: (command: string, args: string[]) => ChildProcess;
}

/**
 * Reproduce con `afplay`: escribe el WAV en un archivo temporal único y lanza el proceso sin shell.
 * `stop()` mata únicamente ese proceso hijo (nunca por nombre) y el archivo se borra al terminar.
 */
export function createAfplayPlayer({
  platform = process.platform,
  spawn = (command, args) => nodeSpawn(command, args, { stdio: 'ignore' }),
}: AfplayOptions = {}): AudioPlayer {
  if (platform !== 'darwin') throw new Error('audio solo en macOS por ahora');
  return {
    play(wav) {
      const file = join(tmpdir(), `ascii-avatar-${randomUUID()}.wav`);
      writeFileSync(file, wav, { mode: 0o600 });
      let child: ChildProcess;
      try {
        child = spawn('afplay', [file]);
      } catch (error) {
        rmSync(file, { force: true });
        throw error;
      }
      const done = new Promise<void>((resolve) => {
        const finish = (): void => {
          rmSync(file, { force: true });
          resolve();
        };
        child.once('exit', finish);
        child.once('error', finish);
      });
      return {
        done,
        stop() {
          child.kill();
          rmSync(file, { force: true });
        },
      };
    },
  };
}
