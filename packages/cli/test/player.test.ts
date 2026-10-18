import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAfplayPlayer } from '../src/player.js';

function fakeChild(): { child: ChildProcess; kill: ReturnType<typeof vi.fn> } {
  const kill = vi.fn();
  const child = Object.assign(new EventEmitter(), { kill }) as unknown as ChildProcess;
  return { child, kill };
}

describe('createAfplayPlayer', () => {
  it('fuera de macOS lanza un error en español', () => {
    expect(() => createAfplayPlayer({ platform: 'linux' })).toThrow('audio solo en macOS por ahora');
  });

  it('lanza afplay con el WAV temporal, sin shell, y lo borra al terminar', async () => {
    const { child } = fakeChild();
    let file = '';
    const spawn = vi.fn((_cmd: string, args: string[]) => {
      file = args[0]!;
      expect(readFileSync(file).toString()).toBe('wav');
      return child;
    });
    const playback = createAfplayPlayer({ platform: 'darwin', spawn }).play(Buffer.from('wav'));
    expect(spawn).toHaveBeenCalledWith('afplay', [file]);
    expect(existsSync(file)).toBe(true);
    child.emit('exit', 0);
    await playback.done;
    expect(existsSync(file)).toBe(false);
  });

  it('stop mata solo ese proceso hijo y borra el archivo', async () => {
    const { child, kill } = fakeChild();
    let file = '';
    const spawn = (_cmd: string, args: string[]): ChildProcess => {
      file = args[0]!;
      return child;
    };
    const playback = createAfplayPlayer({ platform: 'darwin', spawn }).play(Buffer.from('wav'));
    playback.stop();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(existsSync(file)).toBe(false);
    child.emit('exit', null);
    await playback.done;
  });
});
