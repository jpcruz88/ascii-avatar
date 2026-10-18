import { chmodSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

export type Msg =
  | { type: 'thinking' }
  | { type: 'say'; text: string }
  | { type: 'voice'; on: boolean };

/** Tope de una línea (un mensaje) en bytes; las más largas se descartan. */
export const MAX_LINE_BYTES = 64 * 1024;

function parseMsg(line: string): Msg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (m.type === 'thinking') return { type: 'thinking' };
  if (m.type === 'say' && typeof m.text === 'string') return { type: 'say', text: m.text };
  if (m.type === 'voice' && typeof m.on === 'boolean') return { type: 'voice', on: m.on };
  return null;
}

/** ¿Hay alguien escuchando en el socket? Solo `ECONNREFUSED` (y `ENOENT`) significan que no. */
function isListening(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = connect(path);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(false);
      else reject(error);
    });
  });
}

/** Quita un socket huérfano. Nunca borra algo que no sea un socket ni uno con alguien escuchando. */
async function clearStaleSocket(path: string): Promise<void> {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isSocket()) throw new Error(`No se puede abrir el panel: ${path} existe y no es un socket.`);
  if (await isListening(path)) throw new Error('ya hay un panel abierto');
  rmSync(path, { force: true });
}

/** Lee JSON por líneas de una conexión: descarta las líneas largas y las de forma inválida. */
function readLines(socket: Socket, onMsg: (m: Msg) => void): void {
  let buffer = '';
  let discarding = false;
  const deliver = (line: string): void => {
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) return;
    const msg = parseMsg(line);
    if (msg === null) return;
    try {
      onMsg(msg);
    } catch {
      // Un fallo del receptor no debe tumbar el canal.
    }
  };
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (discarding) discarding = false;
      else deliver(line);
    }
    // Sin salto de línea y ya demasiado grande: descarta hasta el próximo salto.
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      buffer = '';
      discarding = true;
    }
  });
  socket.on('end', () => {
    if (!discarding && buffer !== '') deliver(buffer);
    buffer = '';
  });
  socket.on('error', () => socket.destroy());
}

/**
 * Abre el canal local en `path` (socket Unix, solo del usuario: 0600). Lanza si ya hay un panel
 * escuchando o si `path` existe y no es un socket; un socket huérfano se borra antes de escuchar.
 */
export async function startServer(
  path: string,
  onMsg: (m: Msg) => void,
): Promise<{ close(): Promise<void> }> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  await clearStaleSocket(path);
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    readLines(socket, onMsg);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          rmSync(path, { force: true });
          resolve();
        });
      }),
  };
}

/** Envía `m` al panel de `path`. Resuelve `false` si no hay nadie o tarda más de `timeoutMs`. */
export function sendIfListening(path: string, m: Msg, timeoutMs = 150): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const socket = connect(path);
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.end(`${JSON.stringify(m)}\n`, () => finish(true)));
  });
}
