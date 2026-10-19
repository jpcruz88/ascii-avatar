import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpeechTimeoutError } from '@ascii-avatar/gemini';
import { createTtsProxy, dailyLimitUsd, defaultWebLimitUsd } from '../server.mjs';

const ORIGIN = 'http://localhost:8080';
const KEY = 'AIzaFAKE-llave-del-proxy-0123456789';
const WAV = Buffer.from('RIFF....WAVEfmt prueba');

let root: string;
let server: Server | null;
let logs: string[];
let calls: { text: string; voice: string; style?: string }[];
let proxy: ReturnType<typeof createTtsProxy>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-proxy-'));
  server = null;
  logs = [];
  calls = [];
});
afterEach(async () => {
  if (server !== null) {
    server.closeAllConnections();
    await new Promise((r) => server!.close(r));
  }
  rmSync(root, { recursive: true, force: true });
});

type Options = Parameters<typeof createTtsProxy>[0];

/** Levanta el proxy con un cliente de voz falso (nunca llama a Gemini). */
async function start(over: Partial<Options> = {}): Promise<string> {
  proxy = createTtsProxy({
    root,
    allowedOrigin: ORIGIN,
    getKey: () => KEY,
    createClient: (key: string) => {
      expect(key).toBe(KEY);
      return {
        async speak({ signal: _signal, ...input }: { text: string; voice: string; style?: string; signal?: AbortSignal }) {
          calls.push(input);
          return { wav: WAV, inputTokens: 10, outputTokens: 500 };
        },
      };
    },
    log: (line: string) => void logs.push(line),
    ...over,
  });
  server = createServer(proxy.handler);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(base: string, body: unknown, headers: Record<string, string> = { Origin: ORIGIN }): Promise<Response> {
  return fetch(`${base}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const ledgerLines = (): string[] => {
  const file = join(root, 'ledger.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
};

describe('proxy de voz: CORS', () => {
  it('desde el origen permitido devuelve el WAV, con CORS solo para ese origen', async () => {
    const base = await start();
    const res = await post(base, { text: 'Hola.', voice: 'Kore', style: 'tranquilo' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('vary')).toMatch(/Origin/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(WAV);
    expect(calls).toEqual([{ text: 'Hola.', voice: 'Kore', style: 'tranquilo' }]);
  });

  it('otro origen, o ninguno, recibe 403 sin cabeceras CORS y no gasta', async () => {
    const base = await start();
    for (const headers of [{ Origin: 'https://otro.example' }, {} as Record<string, string>]) {
      const res = await post(base, { text: 'Hola.', voice: 'Kore' }, headers);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(calls).toEqual([]);
    expect(ledgerLines()).toEqual([]);
  });

  it('responde la verificación previa (OPTIONS) del origen permitido', async () => {
    const base = await start();
    const res = await fetch(`${base}/tts`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    const bad = await fetch(`${base}/tts`, { method: 'OPTIONS', headers: { Origin: 'https://otro.example' } });
    expect(bad.status).toBe(403);
  });

  it('otra ruta da 404', async () => {
    const base = await start();
    const res = await fetch(`${base}/otra`, { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(404);
  });
});

describe('proxy de voz: llave', () => {
  it('sin llave responde 503 con un mensaje que dice dónde ponerla', async () => {
    const base = await start({ getKey: () => undefined });
    const res = await post(base, { text: 'Hola.', voice: 'Kore' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('GEMINI_API_KEY');
    expect(body.error).toContain('secrets.json');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(calls).toEqual([]);
  });

  it('nunca escribe la llave en el registro, ni siquiera si el error de Gemini la trae', async () => {
    const base = await start({
      createClient: () => ({
        async speak() {
          throw new Error(`fallo con la llave ${KEY} en la URL`);
        },
      }),
    });
    const res = await post(base, { text: 'Hola.', voice: 'Kore' });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(KEY);
    await post(base, { text: 'Hola otra vez.', voice: 'Kore' });
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line).not.toContain(KEY);
  });

  it('el registro tampoco guarda el texto que se dice', async () => {
    const base = await start();
    await post(base, { text: 'Un secreto de la conversación.', voice: 'Kore' });
    expect(logs.join('\n')).not.toContain('secreto');
  });
});

describe('proxy de voz: límites', () => {
  it('un cuerpo más grande que el máximo da 413 y no llama a Gemini', async () => {
    const base = await start({ maxBodyBytes: 200 });
    const res = await post(base, { text: 'x'.repeat(300), voice: 'Kore' });
    expect(res.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('un texto más largo que el máximo da 413', async () => {
    const base = await start({ maxTextChars: 20 });
    const res = await post(base, { text: 'Este texto pasa de veinte caracteres.', voice: 'Kore' });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/20/);
    expect(calls).toEqual([]);
  });

  it('JSON inválido, texto vacío, voz rara o estilo demasiado largo dan 400', async () => {
    const base = await start();
    expect((await post(base, '{no es json')).status).toBe(400);
    expect((await post(base, { text: '   ', voice: 'Kore' })).status).toBe(400);
    expect((await post(base, { text: 'Hola', voice: 'Kore; rm -rf' })).status).toBe(400);
    expect((await post(base, { text: 'Hola', voice: 'Kore', style: 'x'.repeat(301) })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('limita las peticiones por minuto (429)', async () => {
    const base = await start({ rateLimit: { windowMs: 60_000, max: 2 } });
    expect((await post(base, { text: 'Uno.', voice: 'Kore' })).status).toBe(200);
    expect((await post(base, { text: 'Dos.', voice: 'Kore' })).status).toBe(200);
    const third = await post(base, { text: 'Tres.', voice: 'Kore' });
    expect(third.status).toBe(429);
    expect(calls).toHaveLength(2);
  });
});

describe('proxy de voz: gasto diario', () => {
  it('registra cada síntesis en el mismo registro de gasto que el panel', async () => {
    const base = await start();
    await post(base, { text: 'Hola.', voice: 'Kore' });
    const lines = ledgerLines().map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'voice', agent: 'web@web' });
    expect(lines[0].usd).toBeGreaterThan(0);
  });

  it('al llegar al límite diario responde 429 y no llama a Gemini', async () => {
    writeFileSync(join(root, 'ledger.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), kind: 'voice', agent: 'ana', usd: 0.5 })}\n`);
    const base = await start({ dailyLimitUsd: 0.3 });
    const res = await post(base, { text: 'Hola.', voice: 'Kore' });
    expect(res.status).toBe(429);
    const { error } = (await res.json()) as { error: string };
    // Sin montos: a quien llama desde la página no le importa cuánto gasta el dueño.
    expect(error).toBe('Límite diario de voz alcanzado.');
    expect(calls).toEqual([]);
  });

  it('sin límite explícito usa el de config.json (limiteDiarioMxn manda sobre dailyLimitUsd)', () => {
    expect(dailyLimitUsd(root)).toBeCloseTo(0.3, 9);
    writeFileSync(join(root, 'config.json'), JSON.stringify({ dailyLimitUsd: 1, limiteDiarioMxn: 9.2, mxnPorUsd: 18.4 }));
    expect(dailyLimitUsd(root)).toBeCloseTo(0.5, 9);
    writeFileSync(join(root, 'config.json'), JSON.stringify({ dailyLimitUsd: 0.1 }));
    expect(dailyLimitUsd(root)).toBeCloseTo(0.1, 9);
  });

  it('si no se puede registrar el gasto, bloquea la voz hasta reiniciar', async () => {
    // El registro vive bajo algo que es un archivo, no una carpeta: leer da 0, pero escribir falla.
    writeFileSync(join(root, 'archivo'), 'no soy carpeta');
    const base = await start({ ledgerFile: join(root, 'archivo', 'ledger.jsonl') });
    const res = await post(base, { text: 'Hola.', voice: 'Kore' });
    expect(res.status).toBe(500);
    const again = await post(base, { text: 'Hola.', voice: 'Kore' });
    expect(again.status).toBe(503);
    expect(((await again.json()) as { error: string }).error).toMatch(/bloqueada/);
    expect(calls).toHaveLength(1);
  });
});

/** Un cliente de voz que no responde hasta que se le suelte, y anota la señal que recibe. */
function hanging() {
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const createClient = () => ({
    speak({ signal, ...input }: { text: string; voice: string; style?: string; signal?: AbortSignal }) {
      calls.push(input);
      if (signal) signals.push(signal);
      return new Promise<{ wav: Buffer; inputTokens: number; outputTokens: number }>((resolve, reject) => {
        releases.push(() => resolve({ wav: WAV, inputTokens: 10, outputTokens: 500 }));
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelada'), { name: 'AbortError' })));
      });
    },
  });
  return { createClient, releases, signals };
}

const until = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('no se cumplió a tiempo');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('proxy de voz: lo que de verdad frena el gasto', () => {
  it('un Origin falsificado (curl) pasa el CORS, pero el tope diario de la web lo detiene', async () => {
    const base = await start({ webDailyLimitUsd: 0.0005 });
    // Desde fuera de un navegador cualquiera puede poner la cabecera Origin que quiera.
    const forged = { Origin: ORIGIN, 'User-Agent': 'curl/8.0' };
    expect((await post(base, { text: 'Uno.', voice: 'Kore' }, forged)).status).toBe(200);
    const second = await post(base, { text: 'Dos.', voice: 'Kore' }, forged);
    expect(second.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it('la web tiene su propio tope, más bajo: lo gastado por el panel no cuenta y el panel no se queda sin voz', async () => {
    const today = new Date().toISOString();
    writeFileSync(
      join(root, 'ledger.jsonl'),
      `${JSON.stringify({ ts: today, kind: 'voice', agent: 'ana', usd: 0.05 })}\n${JSON.stringify({ ts: today, kind: 'voice', agent: 'ana@web', usd: 0.02 })}\n`,
    );
    const base = await start({ dailyLimitUsd: 0.3, webDailyLimitUsd: 0.02 });
    const res = await post(base, { text: 'Hola.', voice: 'Kore', agent: 'ana' });
    expect(res.status).toBe(429);
    expect(calls).toEqual([]);
  });

  it('anota el gasto como <agente>@web y rechaza un nombre de agente raro', async () => {
    const base = await start();
    expect((await post(base, { text: 'Hola.', voice: 'Kore', agent: 'ana' })).status).toBe(200);
    expect(JSON.parse(ledgerLines()[0]!)).toMatchObject({ agent: 'ana@web' });
    expect((await post(base, { text: 'Hola.', voice: 'Kore', agent: '../ana' })).status).toBe(400);
  });

  it('sin tope de la web explícito, es la mitad del límite diario (el panel conserva la otra mitad)', () => {
    expect(defaultWebLimitUsd(root)).toBeCloseTo(0.15, 9);
    writeFileSync(join(root, 'config.json'), JSON.stringify({ limiteDiarioMxn: 9.2, mxnPorUsd: 18.4 }));
    expect(defaultWebLimitUsd(root)).toBeCloseTo(0.25, 9);
  });
});

describe('proxy de voz: detrás de un proxy inverso', () => {
  it('sin --trust-proxy ignora X-Forwarded-For: no sirve para saltarse el límite por IP', async () => {
    const base = await start({ rateLimit: { windowMs: 60_000, max: 1 } });
    expect((await post(base, { text: 'Uno.', voice: 'Kore' }, { Origin: ORIGIN, 'X-Forwarded-For': '1.1.1.1' })).status).toBe(200);
    expect((await post(base, { text: 'Dos.', voice: 'Kore' }, { Origin: ORIGIN, 'X-Forwarded-For': '2.2.2.2' })).status).toBe(429);
  });

  it('con --trust-proxy cuenta por el primer salto de X-Forwarded-For', async () => {
    const base = await start({ rateLimit: { windowMs: 60_000, max: 1 }, trustProxy: true });
    const from = (ip: string) => ({ Origin: ORIGIN, 'X-Forwarded-For': `${ip}, 10.0.0.1` });
    expect((await post(base, { text: 'Uno.', voice: 'Kore' }, from('1.1.1.1'))).status).toBe(200);
    expect((await post(base, { text: 'Dos.', voice: 'Kore' }, from('2.2.2.2'))).status).toBe(200);
    expect((await post(base, { text: 'Tres.', voice: 'Kore' }, from('1.1.1.1'))).status).toBe(429);
  });

  it('olvida las direcciones cuya ventana ya pasó', async () => {
    const base = await start({ rateLimit: { windowMs: 30, max: 5 }, trustProxy: true });
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await post(base, { text: 'Hola.', voice: 'Kore' }, { Origin: ORIGIN, 'X-Forwarded-For': ip });
    }
    expect(proxy.trackedClients()).toBe(3);
    await new Promise((r) => setTimeout(r, 50));
    await post(base, { text: 'Hola.', voice: 'Kore' }, { Origin: ORIGIN, 'X-Forwarded-For': '4.4.4.4' });
    expect(proxy.trackedClients()).toBe(1);
  });
});

describe('proxy de voz: no paga lo que nadie espera', () => {
  it('si el cliente se fue mientras esperaba en la cola, no llama a Gemini', async () => {
    const h = hanging();
    const base = await start({ createClient: h.createClient });
    const first = post(base, { text: 'Uno.', voice: 'Kore' });
    await until(() => calls.length === 1);
    const abort = new AbortController();
    const second = fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ text: 'Dos.', voice: 'Kore' }),
      signal: abort.signal,
    }).catch(() => 'abortada');
    await new Promise((r) => setTimeout(r, 30));
    abort.abort();
    expect(await second).toBe('abortada');
    await new Promise((r) => setTimeout(r, 30));
    h.releases[0]!();
    expect((await first).status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(1);
    expect(ledgerLines()).toHaveLength(1);
  });

  it('si el cliente se va mientras Gemini trabaja, cancela la síntesis y no anota gasto', async () => {
    const h = hanging();
    const base = await start({ createClient: h.createClient });
    const abort = new AbortController();
    const req = fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ text: 'Uno.', voice: 'Kore' }),
      signal: abort.signal,
    }).catch(() => 'abortada');
    await until(() => h.signals.length === 1);
    abort.abort();
    await req;
    await until(() => h.signals[0]!.aborted);
    expect(ledgerLines()).toEqual([]);
  });

  it('como mucho 3 peticiones pendientes; la cuarta recibe 429', async () => {
    const h = hanging();
    const base = await start({ createClient: h.createClient });
    const pending = [post(base, { text: 'Uno.', voice: 'Kore' }), post(base, { text: 'Dos.', voice: 'Kore' }), post(base, { text: 'Tres.', voice: 'Kore' })];
    await until(() => calls.length === 1);
    await new Promise((r) => setTimeout(r, 30));
    const fourth = await post(base, { text: 'Cuatro.', voice: 'Kore' });
    expect(fourth.status).toBe(429);
    for (let i = 0; i < 3; i++) {
      await until(() => h.releases.length > i);
      h.releases[i]!();
    }
    expect((await Promise.all(pending)).map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it('si Gemini no responde a tiempo, responde 504 y no anota gasto', async () => {
    const base = await start({
      createClient: () => ({
        async speak() {
          throw new SpeechTimeoutError(25_000);
        },
      }),
    });
    const res = await post(base, { text: 'Hola.', voice: 'Kore' });
    expect(res.status).toBe(504);
    expect(ledgerLines()).toEqual([]);
  });
});
