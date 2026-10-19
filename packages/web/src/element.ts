import {
  CLIP_IDS,
  POSE_IDS,
  checkWebManifest,
  parseWebExport,
  type ClipId,
  type Motion,
  type PoseId,
  type WebManifest,
} from '@ascii-avatar/core/browser';
import { createProxyTts, createWebAudioOut } from './audio.js';
import { AvatarEngine, type EngineEvent } from './engine.js';
import { DEFAULT_CHAR_WIDTH_EM, fitFont, nextDrawAt } from './layout.js';

const STYLE = `
:host { display: block; position: relative; overflow: hidden; contain: content;
  background: var(--ascii-avatar-papel, var(--_aa-papel, #fafaf7));
  color: var(--ascii-avatar-tinta, var(--_aa-tinta, #141414)); }
:host([hidden]) { display: none; }
pre { margin: 0; padding: 0; white-space: pre; letter-spacing: 0; font-kerning: none;
  font-variant-ligatures: none; user-select: none; -webkit-user-select: none;
  font-family: var(--ascii-avatar-fuente, ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace);
  font-size: 10px; line-height: 12px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

/** Clase base: en un entorno sin DOM (p. ej. al importar en el servidor) el módulo carga igual. */
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/** Lo que el elemento necesita del paquete ya cargado. */
interface Loaded {
  manifest: WebManifest;
  engine: AvatarEngine;
}

/** Poses y clips del manifiesto que el animador conoce. */
function motionOf(m: WebManifest): Motion {
  const poses = m.poses.filter((p): p is PoseId => (POSE_IDS as readonly string[]).includes(p));
  const clips: Motion['clips'] = {};
  for (const [clip, n] of Object.entries(m.clips)) {
    if ((CLIP_IDS as readonly string[]).includes(clip)) clips[clip as ClipId] = n;
  }
  return { poses, clips };
}

/**
 * `<ascii-avatar src="carpeta-exportada/">`: dibuja un agente exportado con `avatar exportar-web`
 * en tinta sobre papel, con el mismo motor que el panel (gestos, parpadeo, clips y boca).
 *
 * - `el.decir(texto)` / `el.say(texto)`: dice el resumen hablado del texto; resuelve al terminar.
 * - `el.pensar()` / `el.think()`: cara de pensar. `el.callar()` / `el.stop()`: corta lo que dice.
 * - Atributo `tts-url`: dirección del proxy de voz (`POST {text, voice, style}` → WAV). Sin él, la
 *   boca se mueve sin sonido (boca sintética).
 * - Eventos: `listo` (cargó y dibujó), `hablando` (`detail: {texto, voz}`), `fin` y `aviso`
 *   (`detail: {mensaje}`).
 *
 * La letra se ajusta al ancho del contenedor; oculto (pestaña en segundo plano) no dibuja.
 */
export class AsciiAvatarElement extends Base {
  static readonly observedAttributes = ['src', 'tts-url'];

  private readonly root: ShadowRoot;
  private readonly pre: HTMLPreElement;
  private readonly figure: HTMLDivElement;
  private readonly live: HTMLParagraphElement;
  private readonly colors: HTMLStyleElement;
  private loaded: Loaded | null = null;
  private ready: Promise<boolean>;
  private settle: (ok: boolean) => void = () => undefined;
  /** `ready` ya se resolvió: la próxima carga necesita una promesa nueva. */
  private settled = false;
  private generation = 0;
  private raf = 0;
  private nextAt = 0;
  private lastText: string | null = null;
  private charWidthEm = DEFAULT_CHAR_WIDTH_EM;
  private resizeObserver: ResizeObserver | null = null;
  private readonly audio = createWebAudioOut();

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.colors = document.createElement('style');
    this.figure = document.createElement('div');
    this.figure.setAttribute('role', 'img');
    this.figure.setAttribute('aria-label', 'Avatar');
    this.pre = document.createElement('pre');
    this.pre.setAttribute('aria-hidden', 'true');
    this.pre.setAttribute('part', 'cara');
    this.figure.append(this.pre);
    this.live = document.createElement('p');
    this.live.className = 'sr';
    this.live.setAttribute('aria-live', 'polite');
    this.root.append(style, this.colors, this.figure, this.live);
    this.ready = this.newReady();
  }

  connectedCallback(): void {
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(this);
    } else {
      window.addEventListener('resize', this.onResize);
    }
    if (this.loaded === null) void this.load();
    else this.start();
  }

  disconnectedCallback(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.pause();
    this.loaded?.engine.stop();
    this.audio?.close?.();
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (oldValue === value || !this.isConnected) return;
    if (name === 'src') void this.load();
    if (name === 'tts-url') this.loaded?.engine.setTts(this.tts());
  }

  /** Dice el resumen hablado de `texto`. Resuelve cuando termina (o cuando otra orden lo corta). */
  async decir(texto: string): Promise<void> {
    // Sin esperar: el contexto de audio se desbloquea mejor dentro del gesto del usuario. Sin
    // `tts-url` no hay nada que sonar y no se crea ningún contexto de audio.
    if (this.tts() !== null) this.audio?.unlock();
    if (!(await this.ready) || this.loaded === null) throw new Error('El avatar no se pudo cargar.');
    return this.loaded.engine.say(String(texto ?? ''));
  }

  say(text: string): Promise<void> {
    return this.decir(text);
  }

  /** Cara de pensar, por ejemplo mientras esperas una respuesta. */
  pensar(): void {
    this.loaded?.engine.think();
  }

  think(): void {
    this.pensar();
  }

  /** Corta lo que esté diciendo (voz y boca) y vuelve a reposo. */
  callar(): void {
    this.loaded?.engine.stop();
  }

  stop(): void {
    this.callar();
  }

  private newReady(): Promise<boolean> {
    this.settled = false;
    return new Promise<boolean>((resolve) => (this.settle = resolve));
  }

  /** Resuelve `ready` una sola vez por carga. */
  private settleReady(ok: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.settle(ok);
  }

  private tts() {
    const url = this.getAttribute('tts-url');
    return url !== null && url.trim() !== '' && this.audio !== null ? createProxyTts(new URL(url, document.baseURI).href) : null;
  }

  private async load(): Promise<void> {
    const gen = ++this.generation;
    this.pause();
    this.loaded?.engine.stop();
    this.loaded = null;
    // Cada carga tiene su promesa: quien llamó a decir antes espera a esta carga, no a una vieja.
    if (this.settled) this.ready = this.newReady();
    const src = this.getAttribute('src');
    if (src === null || src.trim() === '') {
      // Sin paquete: nada que dibujar, y quien espere a decir recibe un error en vez de esperar siempre.
      this.pre.textContent = '';
      this.lastText = null;
      this.figure.setAttribute('aria-label', 'Avatar');
      this.settleReady(false);
      return;
    }
    const base = new URL(src.endsWith('/') ? src : `${src}/`, document.baseURI);
    try {
      const manifestRes = await fetch(new URL('manifest.json', base));
      if (!manifestRes.ok) throw new Error(`manifest.json respondió ${manifestRes.status}`);
      const manifest = checkWebManifest(await manifestRes.json());
      const framesRes = await fetch(new URL(manifest.frameFile, base));
      if (!framesRes.ok) throw new Error(`${manifest.frameFile} respondió ${framesRes.status}`);
      const { frames } = parseWebExport(manifest, await framesRes.text());
      if (gen !== this.generation) return;
      const t0 = performance.now();
      const engine = new AvatarEngine({
        frames,
        motion: motionOf(manifest),
        now: () => performance.now() - t0,
        voice: manifest.voice,
        agent: manifest.agent,
        ...(manifest.voiceStyle === undefined ? {} : { voiceStyle: manifest.voiceStyle }),
        tts: this.tts(),
        audio: this.audio,
        onEvent: (type, detail) => this.emit(type, detail),
      });
      this.loaded = { manifest, engine };
      this.colors.textContent = `:host { --_aa-tinta: ${manifest.ink}; --_aa-papel: ${manifest.paper}; }`;
      this.figure.setAttribute('aria-label', `Avatar de ${manifest.agent}`);
      this.charWidthEm = this.measureCharWidth();
      this.layout();
      this.lastText = null;
      this.draw();
      this.start();
      this.settleReady(true);
      this.emit('listo', { agente: manifest.agent, cols: manifest.cols, rows: manifest.rows });
    } catch (error) {
      if (gen !== this.generation) return;
      const reason = error instanceof Error ? error.message : String(error);
      const mensaje = `No se pudo cargar el avatar de ${base.href}: ${reason}`;
      this.pre.textContent = mensaje;
      this.pre.style.whiteSpace = 'normal';
      this.settleReady(false);
      this.emit('aviso', { mensaje });
    }
  }

  private emit(type: EngineEvent | 'listo', detail?: unknown): void {
    if (type === 'hablando') this.live.textContent = (detail as { texto?: string } | undefined)?.texto ?? '';
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Ancho de un carácter de la fuente, en em; si no se puede medir, el típico. */
  private measureCharWidth(): number {
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(50);
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px;line-height:1;white-space:pre';
    this.pre.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    const em = width / 50 / 100;
    return Number.isFinite(em) && em > 0.3 && em < 1.2 ? em : DEFAULT_CHAR_WIDTH_EM;
  }

  private layout(): void {
    const cols = this.loaded?.manifest.cols;
    if (cols === undefined) return;
    const fit = fitFont(this.clientWidth, cols, this.charWidthEm);
    if (fit === null) return;
    this.pre.style.fontSize = `${Number(fit.fontSize.toFixed(3))}px`;
    this.pre.style.lineHeight = `${Number(fit.lineHeight.toFixed(3))}px`;
  }

  /** Redibuja solo si cambió el texto del cuadro. */
  private draw(): void {
    const loaded = this.loaded;
    if (loaded === null) return;
    const text = loaded.engine.frameText();
    if (text === this.lastText) return;
    this.lastText = text;
    this.pre.style.whiteSpace = '';
    this.pre.textContent = text;
  }

  private start(): void {
    if (this.raf !== 0 || this.loaded === null || !this.isConnected || document.hidden) return;
    this.nextAt = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private pause(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly tick = (): void => {
    this.raf = 0;
    const loaded = this.loaded;
    if (loaded === null || !this.isConnected || document.hidden) return;
    const now = performance.now();
    if (now >= this.nextAt) {
      this.draw();
      this.nextAt = nextDrawAt(this.nextAt, now, loaded.engine.fast());
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.pause();
    else this.start();
  };

  private readonly onResize = (): void => this.layout();
}
