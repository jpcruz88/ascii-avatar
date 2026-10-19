import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTtsProxy, dailyLimitUsd } from '../server.mjs';

const ORIGIN = 'http://localhost:8080';
const KEY = 'AIzaFAKE-llave-del-proxy-0123456789';
const WAV = Buffer.from('RIFF....WAVEfmt prueba');

let root: string;
let server: Server | null;
let logs: string[];
let calls: { text: string; voice: string; style?: string }[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-proxy-'));
  server = null;
  logs = [];
  calls = [];
});
afterEach(async () => {
  if (server !== null) await new Promise((r) => server!.close(r));
  rmSync(root, { recursive: true, force: true });
});

type Options = Parameters<typeof createTtsProxy>[0];

/** Levanta el proxy con un cliente de voz falso (nunca llama a Gemini). */
async function start(over: Partial<Options> = {}): Promise<string> {
  const proxy = createTtsProxy({
    root,
    allowedOrigin: ORIGIN,
    getKey: () => KEY,
    createClient: (key: string) => {
      expect(key).toBe(KEY);
      return {
        async speak(input: { text: string; voice: string; style?: string }) {
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
    expect(lines[0]).toMatchObject({ kind: 'voice', agent: 'web' });
    expect(lines[0].usd).toBeGreaterThan(0);
  });

  it('al llegar al límite diario responde 429 y no llama a Gemini', async () => {
    writeFileSync(join(root, 'ledger.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), kind: 'voice', agent: 'ana', usd: 0.5 })}\n`);
    const base = await start({ dailyLimitUsd: 0.3 });
    const res = await post(base, { text: 'Hola.', voice: 'Kore' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain('Límite diario de voz alcanzado');
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
