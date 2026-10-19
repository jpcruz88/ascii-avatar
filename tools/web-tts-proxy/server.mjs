#!/usr/bin/env node
// Proxy de voz para <ascii-avatar>: recibe `POST /tts {text, voice, style}` desde una página y
// devuelve el WAV de Gemini. La llave de Gemini se queda en esta máquina (GEMINI_API_KEY o
// ~/.ascii-avatar/secrets.json) y nunca viaja a la página. Solo usa los paquetes del repositorio.
//
//   node tools/web-tts-proxy/server.mjs --origin http://localhost:8080 [--port 8787] [--host 127.0.0.1]
//
// Requiere `npm run build` antes (importa core y gemini compilados).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DAILY_LIMIT_USD,
  DEFAULT_MXN_PER_USD,
  Ledger,
  MAX_VOICE_STYLE_LENGTH,
  formatMxn,
  loadApiKey,
} from '@ascii-avatar/core';
import { SpeechRefusedError, createGeminiTtsClient, loadGeminiConfig, synthesizeSpeech } from '@ascii-avatar/gemini';

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = '127.0.0.1';
/** Cuerpo máximo de una petición (el resumen hablado ocupa unos 220 caracteres). */
export const DEFAULT_MAX_BODY_BYTES = 4096;
export const DEFAULT_MAX_TEXT_CHARS = 500;
/** Peticiones por minuto y por dirección IP. */
export const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 20 };
/** Nombre con que se anotan las síntesis en el registro de gasto. */
const LEDGER_AGENT = 'web';
const VOICE_RE = /^[A-Za-z][A-Za-z-]{0,31}$/;

export const MSG_NO_KEY =
  'Falta la llave de Gemini: define GEMINI_API_KEY o guárdala en ~/.ascii-avatar/secrets.json ({"geminiApiKey": "..."}, permisos 0600).';
const MSG_LIMIT = 'Límite diario de voz alcanzado';
const MSG_BLOCKED = 'Voz bloqueada: no se pudo registrar el gasto; reinicia el proxy.';

/** Carpeta de datos: `ASCII_AVATAR_HOME` o `~/.ascii-avatar` (la misma que usa el comando avatar). */
export function defaultRoot(env = process.env) {
  return env.ASCII_AVATAR_HOME ? env.ASCII_AVATAR_HOME : join(homedir(), '.ascii-avatar');
}

const finite = (v, min) => typeof v === 'number' && Number.isFinite(v) && v >= min;

/** Lee `<root>/config.json` (el del comando avatar); ausente o dañado, un objeto vacío. */
function readConfig(root) {
  try {
    const raw = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** Tipo de cambio con que se muestran los pesos (`mxnPorUsd` de config.json o el de por defecto). */
export function mxnPorUsd(root) {
  const { mxnPorUsd: rate } = readConfig(root);
  return finite(rate, 0) && rate > 0 ? rate : DEFAULT_MXN_PER_USD;
}

/**
 * Límite diario de voz en USD según `<root>/config.json`, con la misma regla que el panel:
 * `limiteDiarioMxn` (convertido con `mxnPorUsd`) manda sobre `dailyLimitUsd`; sin nada válido, el
 * límite por defecto. El panel y el proxy comparten el registro de gasto, así que comparten el límite.
 */
export function dailyLimitUsd(root) {
  const c = readConfig(root);
  if (finite(c.limiteDiarioMxn, 0)) return c.limiteDiarioMxn / mxnPorUsd(root);
  return finite(c.dailyLimitUsd, 0) ? c.dailyLimitUsd : DEFAULT_DAILY_LIMIT_USD;
}

/**
 * Crea el manejador HTTP del proxy. Todo lo que habla con el exterior se puede inyectar (la llave,
 * el cliente de voz, el registro): las pruebas nunca llaman a Gemini ni tocan la carpeta real.
 *
 * - CORS solo para `allowedOrigin`; cualquier otro origen (o ninguno) recibe 403.
 * - Límites: tamaño del cuerpo, largo del texto y peticiones por minuto por IP.
 * - Antes de cada síntesis comprueba el gasto de voz de hoy contra el límite diario y después lo
 *   registra; si no puede registrarlo, bloquea la voz hasta reiniciar (como el panel).
 * - Una síntesis a la vez (en cola), para que dos peticiones no pasen juntas el límite.
 * - El registro (`log`) nunca lleva la llave ni el texto; los errores de Gemini no se reenvían.
 */
export function createTtsProxy(opts) {
  const {
    root,
    allowedOrigin,
    getKey = () => loadApiKey(root),
    createClient = (key) => createGeminiTtsClient(loadGeminiConfig(process.env, key)),
    ledgerFile = join(root, 'ledger.jsonl'),
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    maxTextChars = DEFAULT_MAX_TEXT_CHARS,
    rateLimit = DEFAULT_RATE_LIMIT,
    log = (line) => console.log(line),
  } = opts;
  if (typeof allowedOrigin !== 'string' || !/^https?:\/\/[^/\s]+$/.test(allowedOrigin)) {
    throw new Error('Indica el origen permitido de la página, por ejemplo --origin http://localhost:8080 (sin barra final).');
  }
  const limitUsd = () => (opts.dailyLimitUsd === undefined ? dailyLimitUsd(root) : opts.dailyLimitUsd);
  const ledger = new Ledger(ledgerFile);
  const hits = new Map();
  let queue = Promise.resolve();
  let blocked = false;
  let client = null;
  let clientKey = null;

  const cors = (res) => {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  };
  const json = (res, status, error) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error }));
  };
  const note = (req, status, extra = '') => log(`${new Date().toISOString()} ${req.method} ${req.url} ${status}${extra}`);
  /** Responde un error en JSON y lo anota (sin la llave ni el texto). */
  const reply = (req, res, status, error, extra = '') => {
    json(res, status, error);
    note(req, status, extra);
  };
  const mxn = (usd) => formatMxn(usd, mxnPorUsd(root));

  /** Si la IP ya agotó sus peticiones de esta ventana. */
  const limited = (ip) => {
    const now = Date.now();
    const entry = hits.get(ip);
    if (entry === undefined || now - entry.start >= rateLimit.windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return false;
    }
    entry.count++;
    return entry.count > rateLimit.max;
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBodyBytes) {
          reject(Object.assign(new Error('grande'), { tooLarge: true }));
          req.pause();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  /** Valida el cuerpo; devuelve `{text, voice, style}` o `{status, error}`. */
  const parse = (raw) => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { status: 400, error: 'El cuerpo debe ser JSON: {"text": "...", "voice": "Kore", "style": "..."}.' };
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return { status: 400, error: 'El cuerpo debe ser un objeto JSON.' };
    const { text, voice = 'Kore', style } = body;
    if (typeof text !== 'string' || text.trim() === '') return { status: 400, error: 'Falta el texto ("text").' };
    if (text.length > maxTextChars) return { status: 413, error: `El texto pasa de ${maxTextChars} caracteres.` };
    if (typeof voice !== 'string' || !VOICE_RE.test(voice)) return { status: 400, error: 'Nombre de voz inválido ("voice").' };
    if (style !== undefined && (typeof style !== 'string' || style.length > MAX_VOICE_STYLE_LENGTH)) {
      return { status: 400, error: `El estilo ("style") admite hasta ${MAX_VOICE_STYLE_LENGTH} caracteres.` };
    }
    return { text, voice, ...(typeof style === 'string' && style.trim() !== '' ? { style } : {}) };
  };

  /** Una síntesis: llave, límite diario, Gemini y registro de gasto. */
  const synthesize = async (req, res, input) => {
    if (blocked) return reply(req, res, 503, MSG_BLOCKED, ' bloqueada');
    const key = getKey();
    if (key === undefined || key === '') return reply(req, res, 503, MSG_NO_KEY, ' sin llave');
    let spent;
    try {
      spent = ledger.spentToday();
    } catch {
      return reply(req, res, 500, 'No se pudo leer el gasto de hoy.', ' registro ilegible');
    }
    const limit = limitUsd();
    if (spent >= limit) return reply(req, res, 429, `${MSG_LIMIT} (${mxn(limit)}).`, ' límite diario');
    if (client === null || clientKey !== key) {
      client = createClient(key);
      clientKey = key;
    }
    let result;
    try {
      result = await synthesizeSpeech(client, input.text, input.voice, input.style);
    } catch (error) {
      // El mensaje de Gemini no se reenvía ni se anota: podría traer datos de la petición o la llave.
      return error instanceof SpeechRefusedError
        ? reply(req, res, 502, 'Gemini rechazó el texto; sin voz esta vez.', ' rechazado')
        : reply(req, res, 502, 'Voz no disponible: falló la síntesis.', ' falló la síntesis');
    }
    try {
      if (!Number.isFinite(result.costUsd) || result.costUsd < 0) throw new Error('costo inválido');
      ledger.record('voice', LEDGER_AGENT, result.costUsd);
    } catch {
      blocked = true;
      return reply(req, res, 500, MSG_BLOCKED, ' no se pudo registrar el gasto');
    }
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': result.wav.length, 'Cache-Control': 'no-store' });
    res.end(result.wav);
    note(req, 200, ` ${input.text.length} caracteres, ${mxn(result.costUsd)}`);
  };

  const handler = (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/tts') {
      return reply(req, res, 404, 'No existe. Usa POST /tts.');
    }
    if (req.headers.origin !== allowedOrigin) {
      // Sin cabeceras CORS: el navegador no deja leer la respuesta a otra página.
      return reply(req, res, 403, 'Origen no permitido.', ' origen no permitido');
    }
    cors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (req.method !== 'POST') {
      return reply(req, res, 405, 'Usa POST /tts.');
    }
    if (limited(req.socket.remoteAddress ?? '?')) {
      return reply(req, res, 429, 'Demasiadas peticiones; espera un minuto.', ' demasiadas peticiones');
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      res.setHeader('Connection', 'close');
      return reply(req, res, 413, `El cuerpo pasa de ${maxBodyBytes} bytes.`);
    }
    readBody(req).then(
      (raw) => {
        const input = parse(raw);
        if ('status' in input) return reply(req, res, input.status, input.error);
        const run = queue.then(() => synthesize(req, res, input));
        queue = run.catch(() => undefined);
        return run;
      },
      (error) => {
        res.setHeader('Connection', 'close');
        if (error?.tooLarge) reply(req, res, 413, `El cuerpo pasa de ${maxBodyBytes} bytes.`);
        else reply(req, res, 400, 'No se pudo leer la petición.');
      },
    ).catch(() => {
      if (!res.headersSent) json(res, 500, 'Error interno.');
      note(req, 500);
    });
  };

  return { handler };
}

/** Lee `--nombre valor` de la línea de comandos. */
function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

async function main(argv) {
  const origin = flag(argv, 'origin') ?? process.env.TTS_PROXY_ORIGIN;
  const port = Number(flag(argv, 'port') ?? process.env.TTS_PROXY_PORT ?? DEFAULT_PORT);
  const host = flag(argv, 'host') ?? process.env.TTS_PROXY_HOST ?? DEFAULT_HOST;
  const root = defaultRoot();
  let proxy;
  try {
    proxy = createTtsProxy({ root, allowedOrigin: origin });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (!loadApiKey(root)) console.warn(MSG_NO_KEY);
  const server = createServer(proxy.handler);
  await new Promise((resolve) => server.listen(port, host, resolve));
  console.log(
    `Proxy de voz en http://${host}:${port}/tts para ${origin} · límite diario ${formatMxn(dailyLimitUsd(root), mxnPorUsd(root))} · Ctrl-C para salir`,
  );
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await main(process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
