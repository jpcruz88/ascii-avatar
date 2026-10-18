import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendIfListening, startServer, type Msg } from '../src/ipc.js';

let dir: string;
let path: string;
let closers: Array<() => Promise<void>> = [];

// Las rutas de sockets Unix en macOS son de ~104 caracteres como máximo: directorio temporal corto.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aa-'));
  path = join(dir, 's.sock');
});

afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
  rmSync(dir, { recursive: true, force: true });
});

/** Arranca un servidor y devuelve una función que espera hasta tener `n` mensajes. */
async function serve(): Promise<{ got: Msg[]; waitFor(n: number): Promise<Msg[]> }> {
  const got: Msg[] = [];
  const waiters: Array<() => void> = [];
  const server = await startServer(path, (m) => {
    got.push(m);
    for (const w of waiters.splice(0)) w();
  });
  closers.push(() => server.close());
  return {
    got,
    async waitFor(n) {
      const deadline = Date.now() + 2000;
      while (got.length < n) {
        if (Date.now() > deadline) throw new Error(`Solo llegaron ${got.length} de ${n} mensajes`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
      return got;
    },
  };
}

/** Escribe bytes crudos en el socket y lo cierra. */
function writeRaw(data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(path, () => socket.end(data));
    socket.on('error', reject);
    socket.on('close', () => resolve());
  });
}

describe('canal local', () => {
  it('el servidor recibe un mensaje enviado por el cliente', async () => {
    const s = await serve();
    expect(await sendIfListening(path, { type: 'say', text: 'Hola' })).toBe(true);
    expect(await s.waitFor(1)).toEqual([{ type: 'say', text: 'Hola' }]);
  });

  it('una línea basura no rompe la entrega del siguiente mensaje', async () => {
    const s = await serve();
    await writeRaw('esto no es json\n{"type":"thinking"}\n');
    expect(await s.waitFor(1)).toEqual([{ type: 'thinking' }]);
  });

  it('ignora mensajes con forma inválida', async () => {
    const s = await serve();
    await writeRaw(
      [
        '{"type":"say"}',
        '{"type":"say","text":5}',
        '{"type":"voice","on":"si"}',
        '{"type":"otro"}',
        '[1,2]',
        'null',
        '{"type":"voice","on":true}',
      ].join('\n') + '\n',
    );
    expect(await s.waitFor(1)).toEqual([{ type: 'voice', on: true }]);
    expect(s.got).toHaveLength(1);
  });

  it('descarta una línea de más de 64 KiB y entrega la siguiente', async () => {
    const s = await serve();
    const huge = JSON.stringify({ type: 'say', text: 'x'.repeat(70 * 1024) });
    await writeRaw(`${huge}\n{"type":"thinking"}\n`);
    expect(await s.waitFor(1)).toEqual([{ type: 'thinking' }]);
    expect(s.got).toHaveLength(1);
  });

  it('entrega la última línea aunque no termine en salto de línea', async () => {
    const s = await serve();
    await writeRaw('{"type":"thinking"}');
    expect(await s.waitFor(1)).toEqual([{ type: 'thinking' }]);
  });

  it('sendIfListening resuelve false en menos de 200 ms si no hay socket', async () => {
    const t0 = performance.now();
    expect(await sendIfListening(join(dir, 'no-existe.sock'), { type: 'thinking' })).toBe(false);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('con un archivo de socket huérfano, startServer arranca bien', async () => {
    // Un proceso hijo abre el socket y muere sin limpiarlo (SIGKILL a sí mismo).
    const code = `require('node:net').createServer().listen(${JSON.stringify(path)}, () => process.kill(process.pid, 'SIGKILL'))`;
    spawnSync(process.execPath, ['-e', code]);
    expect(existsSync(path)).toBe(true);
    const s = await serve();
    expect(await sendIfListening(path, { type: 'thinking' })).toBe(true);
    expect(await s.waitFor(1)).toEqual([{ type: 'thinking' }]);
  });

  it('no borra un archivo que no es un socket', async () => {
    writeFileSync(path, 'datos importantes');
    await expect(startServer(path, () => {})).rejects.toThrow(/no es un socket/);
    expect(existsSync(path)).toBe(true);
  });

  it('falla con "ya hay un panel abierto" si alguien escucha', async () => {
    await serve();
    await expect(startServer(path, () => {})).rejects.toThrow('ya hay un panel abierto');
    // El primer servidor sigue funcionando.
    expect(await sendIfListening(path, { type: 'thinking' })).toBe(true);
  });

  it('deja el socket con permisos 0600', async () => {
    await serve();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('close() quita el archivo del socket', async () => {
    const server = await startServer(path, () => {});
    await server.close();
    expect(existsSync(path)).toBe(false);
  });
});
