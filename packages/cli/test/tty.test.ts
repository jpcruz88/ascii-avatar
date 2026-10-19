import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FPS_IDLE, FPS_SPEAKING, frameIntervalMs, runTty, type TtyOptions } from '../src/tty.js';
import type { AsciiFrame } from '@ascii-avatar/core';

const frame: AsciiFrame = {
  cols: 2,
  rows: 1,
  cells: [
    { ch: 'a', fg: { r: 1, g: 2, b: 3 }, bg: null },
    { ch: 'b', fg: { r: 1, g: 2, b: 3 }, bg: null },
  ],
};

const eio = (): NodeJS.ErrnoException =>
  Object.assign(new Error('write EIO'), { code: 'EIO', errno: -5, syscall: 'write' });

/** Salida falsa: registra lo escrito y puede fallar como una terminal cuya ventana ya se cerró. */
class FakeStdout extends EventEmitter {
  columns = 60;
  rows = 20;
  writes: string[] = [];
  throwOnWrite = false;
  /** Número de escritura (desde 1) a partir de la cual falla, o 0 para nunca. */
  failFrom = 0;
  write(chunk: string): boolean {
    this.writes.push(chunk);
    if (this.throwOnWrite || (this.failFrom > 0 && this.writes.length >= this.failFrom)) throw eio();
    return true;
  }
}

class FakeStdin extends EventEmitter {
  isTTY = false;
  setRawMode(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
}

function options(stdout: FakeStdout, stdin = new FakeStdin()): TtyOptions {
  return {
    agent: 'luna',
    getFrame: () => frame,
    voiceOn: () => false,
    spentToday: () => 0,
    notice: () => null,
    onToggleVoice: () => undefined,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runTty con la terminal cerrada', () => {
  it('si escribir lanza EIO, el panel termina sin lanzar', async () => {
    const stdout = new FakeStdout();
    stdout.throwOnWrite = true;
    await expect(runTty(options(stdout))).resolves.toBeUndefined();
  });

  it('si el EIO llega a media sesión, termina en silencio y restaura sin lanzar', async () => {
    const stdout = new FakeStdout();
    stdout.failFrom = 3;
    // El cuadro cambia en cada consulta para que el panel siga escribiendo hasta que falle.
    const frames = [frame, { ...frame, cells: [...frame.cells].reverse() }];
    let n = 0;
    await expect(runTty({ ...options(stdout), getFrame: () => frames[n++ % 2]! })).resolves.toBeUndefined();
    // Se intentó restaurar la pantalla aunque la escritura falle.
    expect(stdout.writes.some((w) => w.includes('\x1b[?1049l'))).toBe(true);
  });

  it('un evento error EIO en stdout cierra el panel y no queda sin manejar', async () => {
    const stdout = new FakeStdout();
    const done = runTty(options(stdout));
    stdout.emit('error', eio());
    await expect(done).resolves.toBeUndefined();
    // El error asíncrono de la escritura de restauración llega tarde: tampoco debe tumbar el proceso.
    expect(() => stdout.emit('error', eio())).not.toThrow();
  });

  it('EPIPE también se traga', async () => {
    const stdout = new FakeStdout();
    const done = runTty(options(stdout));
    stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await expect(done).resolves.toBeUndefined();
  });

  it('tras salir con q, un EIO tardío en stdout no lanza', async () => {
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const done = runTty(options(stdout, stdin));
    stdin.emit('data', Buffer.from('q'));
    await done;
    expect(() => stdout.emit('error', eio())).not.toThrow();
  });

  it('un error distinto de EIO/EPIPE no se esconde: el panel termina y el error se reporta', async () => {
    const stdout = new FakeStdout();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const done = runTty(options(stdout));
    stdout.emit('error', Object.assign(new Error('boom'), { code: 'EACCES' }));
    await done;
    expect(stderr).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('runTty en modo papel', () => {
  it('con paper pinta tinta sobre papel y restaura al salir', async () => {
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const done = runTty({ ...options(stdout, stdin), paper: true });
    stdin.emit('data', Buffer.from('q'));
    await done;
    const all = stdout.writes.join('');
    expect(all).toContain('\x1b[48;2;250;250;247m');
    expect(all.endsWith('\x1b[0m\x1b[?25h\x1b[?1049l')).toBe(true);
  });
});

describe('ritmo de dibujo', () => {
  const other: AsciiFrame = { ...frame, cells: frame.cells.map((c) => ({ ...c, ch: 'z' })) };
  /** Cuántas escrituras de pantalla (no las de entrar o salir) hubo. */
  const screens = (stdout: FakeStdout): number => stdout.writes.filter((w) => w.includes('luna')).length;

  it('~24 fps al hablar y ~12 fps en reposo', () => {
    expect(FPS_SPEAKING).toBe(24);
    expect(FPS_IDLE).toBe(12);
    expect(frameIntervalMs(true)).toBe(42);
    expect(frameIntervalMs(false)).toBe(83);
  });

  it('al hablar consulta el cuadro unas 24 veces por segundo', async () => {
    vi.useFakeTimers();
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    let calls = 0;
    const done = runTty({ ...options(stdout, stdin), speaking: () => true, getFrame: () => (++calls % 2 === 0 ? frame : other) });
    calls = 0;
    vi.advanceTimersByTime(1000);
    expect(calls).toBeGreaterThanOrEqual(23);
    expect(calls).toBeLessThanOrEqual(25);
    // Cada cuadro distinto se dibuja.
    expect(screens(stdout)).toBeGreaterThanOrEqual(23);
    stdin.emit('data', Buffer.from('q'));
    await done;
  });

  it('corrige la deriva: con un dibujo lento de 30 ms sigue a ~24 cuadros por segundo', async () => {
    vi.useFakeTimers();
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const t0 = performance.now();
    const at: number[] = [];
    const slow = (): AsciiFrame => {
      at.push(performance.now() - t0);
      vi.advanceTimersByTime(30); // el dibujo tarda 30 ms del reloj
      return at.length % 2 === 0 ? frame : other;
    };
    const done = runTty({ ...options(stdout, stdin), speaking: () => true, getFrame: slow });
    vi.advanceTimersByTime(1000);
    const inFirstSecond = at.filter((t) => t < 1000).length;
    expect(inFirstSecond).toBeGreaterThanOrEqual(23);
    expect(inFirstSecond).toBeLessThanOrEqual(25);
    // Cada cuadro empieza a su hora (múltiplos de ~42 ms), no 42 ms después de terminar el anterior.
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeLessThanOrEqual(43);
    stdin.emit('data', Buffer.from('q'));
    await done;
  });

  it('si un dibujo tarda más que un cuadro, no se apilan cuadros para recuperar el atraso', async () => {
    vi.useFakeTimers();
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const t0 = performance.now();
    const at: number[] = [];
    const done = runTty({
      ...options(stdout, stdin),
      speaking: () => true,
      getFrame: () => {
        at.push(performance.now() - t0);
        // Solo el segundo dibujo es lentísimo (300 ms).
        if (at.length === 2) vi.advanceTimersByTime(300);
        return frame;
      },
    });
    vi.advanceTimersByTime(600);
    // Tras el dibujo lento el siguiente sale enseguida y luego retoma el ritmo normal.
    const after = at.slice(2, 5);
    for (let i = 1; i < after.length; i++) expect(after[i]! - after[i - 1]!).toBeGreaterThanOrEqual(41);
    stdin.emit('data', Buffer.from('q'));
    await done;
  });

  it('en reposo baja a unas 12 veces por segundo', async () => {
    vi.useFakeTimers();
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    let calls = 0;
    const done = runTty({ ...options(stdout, stdin), speaking: () => false, getFrame: () => (++calls, frame) });
    calls = 0;
    vi.advanceTimersByTime(1000);
    expect(calls).toBeGreaterThanOrEqual(11);
    expect(calls).toBeLessThanOrEqual(13);
    stdin.emit('data', Buffer.from('q'));
    await done;
  });

  it('cambia de ritmo en cuanto empieza o termina el habla', async () => {
    vi.useFakeTimers();
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    let speaking = false;
    let calls = 0;
    const done = runTty({ ...options(stdout, stdin), speaking: () => speaking, getFrame: () => (++calls, frame) });
    vi.advanceTimersByTime(1000);
    speaking = true;
    vi.advanceTimersByTime(100); // el intervalo en curso termina con el ritmo anterior
    calls = 0;
    vi.advanceTimersByTime(1000);
    expect(calls).toBeGreaterThanOrEqual(23);
    speaking = false;
    vi.advanceTimersByTime(100);
    calls = 0;
    vi.advanceTimersByTime(1000);
    expect(calls).toBeLessThanOrEqual(13);
    stdin.emit('data', Buffer.from('q'));
    await done;
  });

  it('solo escribe cuando cambia el cuadro o el pie', async () => {
    vi.useFakeTimers();
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    let notice: string | null = null;
    let current = frame;
    const done = runTty({ ...options(stdout, stdin), speaking: () => true, getFrame: () => current, notice: () => notice });
    expect(screens(stdout)).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(screens(stdout)).toBe(1); // nada cambió: ni una escritura
    current = other;
    vi.advanceTimersByTime(50);
    expect(screens(stdout)).toBe(2);
    notice = 'Aviso';
    vi.advanceTimersByTime(50);
    expect(screens(stdout)).toBe(3);
    expect(stdout.writes.at(-1)).toContain('Aviso');
    stdout.emit('resize');
    expect(screens(stdout)).toBe(4); // tras cambiar el tamaño se redibuja siempre
    stdin.emit('data', Buffer.from('q'));
    await done;
  });
});
