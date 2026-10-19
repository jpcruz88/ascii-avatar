import type { AudioOut, Prepared, TtsFetch } from './engine.js';

/** Tiempo máximo de espera de la voz antes de rendirse y gesticular sin sonido. */
const TTS_TIMEOUT_MS = 20_000;

type AudioContextCtor = new () => AudioContext;

/** Salida de audio con Web Audio; `null` si el navegador no tiene `AudioContext`. */
export function createWebAudioOut(): AudioOut | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (Ctor === undefined) return null;
  let ctx: AudioContext | null = null;
  const context = (): AudioContext => (ctx ??= new Ctor());
  return {
    unlock() {
      // Los navegadores solo dejan sonar audio tras un gesto del usuario: se crea o reanuda aquí.
      const c = context();
      if (c.state === 'suspended') void c.resume().catch(() => undefined);
    },
    close() {
      // Libera el dispositivo de audio; un `unlock` posterior crea otro contexto.
      const c = ctx;
      ctx = null;
      if (c !== null) void c.close().catch(() => undefined);
    },
    latencyMs() {
      if (ctx === null) return 0;
      const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency;
      return ((typeof out === 'number' && out > 0 ? out : 0) + (ctx.baseLatency || 0)) * 1000;
    },
    async prepare(wav: ArrayBuffer): Promise<Prepared> {
      const c = context();
      const buffer = await c.decodeAudioData(wav);
      let source: AudioBufferSourceNode | null = null;
      return {
        start(delayMs: number) {
          source = c.createBufferSource();
          source.buffer = buffer;
          source.connect(c.destination);
          source.start(c.currentTime + Math.max(0, delayMs) / 1000);
        },
        stop() {
          try {
            source?.stop();
          } catch {
            // Nunca empezó o ya terminó.
          }
          source?.disconnect();
          source = null;
        },
      };
    },
  };
}

/**
 * Pide la voz al proxy (`POST <url>` con `{text, voice, style}` → WAV). Si responde con error, el
 * mensaje del proxy (en `{error}`) se usa como aviso; nunca se envía ninguna llave desde aquí.
 */
export function createProxyTts(url: string): TtsFetch {
  return async (req, signal) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TTS_TIMEOUT_MS);
    // Si quien la pidió ya no la quiere (otro decir, callar), se corta la petición.
    const cancel = (): void => abort.abort();
    if (signal?.aborted) abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
          signal: abort.signal,
        });
      } catch {
        throw new Error('Voz no disponible: no se pudo contactar al servidor de voz');
      }
      if (!res.ok) {
        let message = `Voz no disponible (error ${res.status})`;
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === 'string' && body.error !== '') message = body.error.slice(0, 200);
        } catch {
          // Sin cuerpo JSON: queda el mensaje genérico.
        }
        throw new Error(message);
      }
      return await res.arrayBuffer();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  };
}
