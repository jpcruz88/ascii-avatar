#!/usr/bin/env node
// Proxy de voz para <ascii-avatar>: recibe `POST /tts {text, voice, style, agent}` desde una página y
// devuelve el WAV de Gemini. La llave de Gemini se queda en esta máquina (GEMINI_API_KEY o
// ~/.ascii-avatar/secrets.json) y nunca viaja a la página. Solo usa los paquetes del repositorio.
//
//   node tools/web-tts-proxy/server.mjs --origin http://localhost:8080 [--port 8787] [--host 127.0.0.1]
//        [--limite-diario-mxn 2] [--trust-proxy]
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
import {
  FALLBACK_SPEECH_COST_USD,
  SpeechRefusedError,
  SpeechTimeoutError,
  TTS_RATES,
  createGeminiTtsClient,
  loadGeminiConfig,
  synthesizeSpeech,
  ttsCostUsd,
} from '@ascii-avatar/gemini';

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = '127.0.0.1';
/** Cuerpo máximo de una petición (el resumen hablado ocupa unos 220 caracteres). */
export const DEFAULT_MAX_BODY_BYTES = 4096;
export const DEFAULT_MAX_TEXT_CHARS = 500;
/** Peticiones por minuto y por dirección IP. */
export const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 20 };
/** Síntesis pendientes como mucho (la que está en curso y las que esperan); más, 429. */
export const DEFAULT_MAX_PENDING = 3;
/** Sufijo con que se anotan en el registro las síntesis de la web: `<agente>@web`. */
const WEB_SUFFIX = '@web';
const VOICE_RE = /^[A-Za-z][A-Za-z-]{0,31}$/;
const AGENT_RE = /^[a-z0-9-]{1,32}$/;

export const MSG_NO_KEY =
  'Falta la llave de Gemini: define GEMINI_API_KEY o guárdala en ~/.ascii-avatar/secrets.json ({"geminiApiKey": "..."}, permisos 0600).';
const MSG_LIMIT = 'Límite diario de voz alcanzado.';
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
 * límite por defecto. Es el total del día: panel y página juntos.
 */
export function dailyLimitUsd(root) {
  const c = readConfig(root);
  if (finite(c.limiteDiarioMxn, 0)) return c.limiteDiarioMxn / mxnPorUsd(root);
  return finite(c.dailyLimitUsd, 0) ? c.dailyLimitUsd : DEFAULT_DAILY_LIMIT_USD;
}

/**
 * Tope diario propio de la web si no se indica `--limite-diario-mxn`: la mitad del límite diario,
 * para que las visitas nunca dejen al panel sin voz.
 */
export function defaultWebLimitUsd(root) {
  return dailyLimitUsd(root) / 2;
}

/** Caracteres por segundo de habla que se suponen al estimar: lento a propósito (más audio, más caro). */
const ESTIMATE_CHARS_PER_SECOND = 10;

/**
 * Costo estimado, conservador, de una síntesis que se abandonó después de enviarla a Gemini (el
 * cliente se fue o venció el tiempo): Google puede cobrarla igual. Supone habla lenta para el
 * audio y ~4 caracteres por token para el texto, con las tarifas de voz, y nunca menos de
 * `FALLBACK_SPEECH_COST_USD`.
 */
export function estimateAbandonedSpeechCostUsd(text) {
  const seconds = text.length / ESTIMATE_CHARS_PER_SECOND;
  const cost = ttsCostUsd(Math.ceil(text.length / 4), seconds * TTS_RATES.audioTokensPerSecond);
  return Number.isFinite(cost) ? Math.max(FALLBACK_SPEECH_COST_USD, cost) : FALLBACK_SPEECH_COST_USD;
}

/**
 * Crea el manejador HTTP del proxy. Todo lo que habla con el exterior se puede inyectar (la llave,
 * el cliente de voz, el registro): las pruebas nunca llaman a Gemini ni tocan la carpeta real.
 *
 * - CORS solo para `allowedOrigin`. Ojo: eso solo impide que otras páginas lo usen desde un
 *   navegador; fuera de un navegador cualquiera puede enviar esa cabecera. Lo que de verdad frena
 *   el gasto son los topes diarios.
 * - Dos topes diarios: el total del día (compartido con el panel) y uno propio de la web, más bajo,
 *   contado sobre los registros `<agente>@web`.
 * - Límites: tamaño del cuerpo, largo del texto, peticiones por minuto por IP (con `trustProxy`, la
 *   del primer salto de `X-Forwarded-For`) y como mucho `maxPending` síntesis pendientes.
 * - Una síntesis a la vez (en cola). Si quien la pidió se fue, no se llama a Gemini, o se cancela.
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
    maxPending = DEFAULT_MAX_PENDING,
    trustProxy = false,
    log = (line) => console.log(line),
  } = opts;
  if (typeof allowedOrigin !== 'string' || !/^https?:\/\/[^/\s]+$/.test(allowedOrigin)) {
    throw new Error('Indica el origen permitido de la página, por ejemplo --origin http://localhost:8080 (sin barra final).');
  }
  const totalLimitUsd = () => (opts.dailyLimitUsd === undefined ? dailyLimitUsd(root) : opts.dailyLimitUsd);
  const webLimitUsd = () => (opts.webDailyLimitUsd === undefined ? defaultWebLimitUsd(root) : opts.webDailyLimitUsd);
  const ledger = new Ledger(ledgerFile);
  const hits = new Map();
  let queue = Promise.resolve();
  let pending = 0;
  let blocked = false;
  let client = null;
  let clientKey = null;

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

  /** Dirección del cliente: la del socket o, detrás de un proxy inverso de confianza, el primer salto. */
  const clientIp = (req) => {
    if (trustProxy) {
      const first = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? '?';
  };

  /** Si la IP ya agotó sus peticiones de esta ventana. Olvida las ventanas vencidas. */
  const limited = (ip) => {
    const now = Date.now();
    for (const [key, entry] of hits) if (now - entry.start >= rateLimit.windowMs) hits.delete(key);
    const entry = hits.get(ip);
    if (entry === undefined) {
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

  /** Valida el cuerpo; devuelve `{text, voice, style, agent}` o `{status, error}`. */
  const parse = (raw) => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { status: 400, error: 'El cuerpo debe ser JSON: {"text": "...", "voice": "Kore", "style": "..."}.' };
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return { status: 400, error: 'El cuerpo debe ser un objeto JSON.' };
    const { text, voice = 'Kore', style, agent = 'web' } = body;
    if (typeof text !== 'string' || text.trim() === '') return { status: 400, error: 'Falta el texto ("text").' };
    if (text.length > maxTextChars) return { status: 413, error: `El texto pasa de ${maxTextChars} caracteres.` };
    if (typeof voice !== 'string' || !VOICE_RE.test(voice)) return { status: 400, error: 'Nombre de voz inválido ("voice").' };
    if (style !== undefined && (typeof style !== 'string' || style.length > MAX_VOICE_STYLE_LENGTH)) {
      return { status: 400, error: `El estilo ("style") admite hasta ${MAX_VOICE_STYLE_LENGTH} caracteres.` };
    }
    if (typeof agent !== 'string' || !AGENT_RE.test(agent)) return { status: 400, error: 'Nombre de agente inválido ("agent").' };
    return { text, voice, agent, ...(typeof style === 'string' && style.trim() !== '' ? { style } : {}) };
  };

  /**
   * Anota el estimado de una síntesis abandonada después de enviarla (cuenta para los topes, así
   * desconectarse una y otra vez no permite gastar sin límite). Si no se puede anotar, bloquea.
   */
  const recordEstimate = (input) => {
    const usd = estimateAbandonedSpeechCostUsd(input.text);
    try {
      ledger.record('voice', `${input.agent}${WEB_SUFFIX}`, usd);
    } catch {
      blocked = true;
    }
    return mxn(usd);
  };

  /** Una síntesis: llave, topes diarios, Gemini y registro de gasto. */
  const synthesize = async (req, res, input, abort) => {
    if (abort.signal.aborted) return note(req, 499, ' el cliente se fue antes de sintetizar');
    if (blocked) return reply(req, res, 503, MSG_BLOCKED, ' bloqueada');
    const key = getKey();
    if (key === undefined || key === '') return reply(req, res, 503, MSG_NO_KEY, ' sin llave');
    let spentTotal;
    let spentWeb;
    try {
      spentTotal = ledger.spentToday();
      spentWeb = ledger.spentToday((agent) => agent.endsWith(WEB_SUFFIX));
    } catch {
      return reply(req, res, 500, 'No se pudo leer el gasto de hoy.', ' registro ilegible');
    }
    // Sin montos en la respuesta: solo se anotan aquí.
    if (spentTotal >= totalLimitUsd()) return reply(req, res, 429, MSG_LIMIT, ` límite diario total (${mxn(totalLimitUsd())})`);
    if (spentWeb >= webLimitUsd()) return reply(req, res, 429, MSG_LIMIT, ` tope diario de la web (${mxn(webLimitUsd())})`);
    if (client === null || clientKey !== key) {
      client = createClient(key);
      clientKey = key;
    }
    let result;
    try {
      result = await synthesizeSpeech(client, input.text, input.voice, input.style, abort.signal);
    } catch (error) {
      // El mensaje de Gemini no se reenvía ni se anota: podría traer datos de la petición o la llave.
      // La petición ya salió hacia Gemini: si se corta o vence el tiempo, se anota un estimado.
      if (abort.signal.aborted) return note(req, 499, ` el cliente se fue; síntesis cancelada, ${recordEstimate(input)} estimados`);
      if (error instanceof SpeechTimeoutError) {
        const estimate = recordEstimate(input);
        return reply(req, res, 504, 'Gemini no respondió a tiempo; sin voz esta vez.', ` tiempo agotado, ${estimate} estimados`);
      }
      return error instanceof SpeechRefusedError
        ? reply(req, res, 502, 'Gemini rechazó el texto; sin voz esta vez.', ' rechazado')
        : reply(req, res, 502, 'Voz no disponible: falló la síntesis.', ' falló la síntesis');
    }
    // Llegó audio: Gemini ya lo cobró, se anota aunque el cliente se haya ido.
    try {
      if (!Number.isFinite(result.costUsd) || result.costUsd < 0) throw new Error('costo inválido');
      ledger.record('voice', `${input.agent}${WEB_SUFFIX}`, result.costUsd);
    } catch {
      blocked = true;
      return reply(req, res, 500, MSG_BLOCKED, ' no se pudo registrar el gasto');
    }
    if (abort.signal.aborted) return note(req, 499, ` el cliente se fue; ${mxn(result.costUsd)} anotados`);
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': result.wav.length, 'Cache-Control': 'no-store' });
    res.end(result.wav);
    note(req, 200, ` ${input.text.length} caracteres, ${mxn(result.costUsd)}`);
  };

  const handler = (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/tts') return reply(req, res, 404, 'No existe. Usa POST /tts.');
    if (req.headers.origin !== allowedOrigin) {
      // Sin cabeceras CORS: el navegador no deja leer la respuesta a otra página.
      return reply(req, res, 403, 'Origen no permitido.', ' origen no permitido');
    }
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (req.method !== 'POST') return reply(req, res, 405, 'Usa POST /tts.');
    if (limited(clientIp(req))) return reply(req, res, 429, 'Demasiadas peticiones; espera un minuto.', ' demasiadas peticiones');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      res.setHeader('Connection', 'close');
      return reply(req, res, 413, `El cuerpo pasa de ${maxBodyBytes} bytes.`);
    }
    readBody(req)
      .then(
        (raw) => {
          const input = parse(raw);
          if ('status' in input) return reply(req, res, input.status, input.error);
          if (pending >= maxPending) return reply(req, res, 429, 'El servidor de voz está ocupado; prueba en un momento.', ' cola llena');
          // Si el cliente cierra la conexión antes de recibir la respuesta, ya nadie espera la voz:
          // no se llama a Gemini o se cancela la síntesis en curso.
          // Si se va mientras espera en la cola, su lugar se libera en el acto (al llegarle el turno
          // se salta sin llamar a Gemini).
          const abort = new AbortController();
          let started = false;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            pending--;
          };
          res.on('close', () => {
            if (res.writableEnded) return;
            abort.abort();
            if (!started) release();
          });
          pending++;
          const run = queue
            .then(() => {
              started = true;
              return synthesize(req, res, input, abort);
            })
            .finally(release);
          queue = run.catch(() => undefined);
          return run;
        },
        (error) => {
          res.setHeader('Connection', 'close');
          if (error?.tooLarge) reply(req, res, 413, `El cuerpo pasa de ${maxBodyBytes} bytes.`);
          else reply(req, res, 400, 'No se pudo leer la petición.');
        },
      )
      .catch(() => {
        if (!res.headersSent) json(res, 500, 'Error interno.');
        note(req, 500);
      });
  };

  return { handler, trackedClients: () => hits.size };
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
  const trustProxy = argv.includes('--trust-proxy') || process.env.TTS_PROXY_TRUST_PROXY === '1';
  const root = defaultRoot();
  const limiteRaw = flag(argv, 'limite-diario-mxn') ?? process.env.TTS_PROXY_LIMITE_DIARIO_MXN;
  let webDailyLimitUsd;
  if (limiteRaw !== undefined) {
    const mxnLimit = Number(limiteRaw);
    if (!Number.isFinite(mxnLimit) || mxnLimit < 0) {
      console.error('--limite-diario-mxn debe ser un número de pesos, 0 o mayor.');
      return 1;
    }
    webDailyLimitUsd = mxnLimit / mxnPorUsd(root);
  }
  let proxy;
  try {
    proxy = createTtsProxy({ root, allowedOrigin: origin, trustProxy, ...(webDailyLimitUsd === undefined ? {} : { webDailyLimitUsd }) });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (!loadApiKey(root)) console.warn(MSG_NO_KEY);
  const server = createServer(proxy.handler);
  await new Promise((resolve) => server.listen(port, host, resolve));
  const rate = mxnPorUsd(root);
  console.log(
    `Proxy de voz en http://${host}:${port}/tts para ${origin} · tope diario de la web ` +
      `${formatMxn(webDailyLimitUsd ?? defaultWebLimitUsd(root), rate)} (límite total del día ${formatMxn(dailyLimitUsd(root), rate)})` +
      `${trustProxy ? ' · confía en X-Forwarded-For' : ''} · Ctrl-C para salir`,
  );
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await main(process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
