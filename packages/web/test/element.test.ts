// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_EXPORT_FORMAT, WEB_EXPORT_VERSION, webExportFramesText } from '@ascii-avatar/core/browser';
import { AsciiAvatarElement } from '../src/element.js';
import '../src/index.js';

const IDS = ['neutral', 'mouth_mid', 'mouth_open', 'blink', 'smile', 'serious', 'surprised', 'sad', 'mouth_q1', 'mouth_q3'];
const COLS = 4;
const ROWS = 2;
const frameOf = (id: string, i: number): string[] => [`${id.slice(0, 2)}${String(i).padStart(2, '0')}`, `${String(i).padStart(2, '0')}..`];

const MANIFEST = {
  format: WEB_EXPORT_FORMAT,
  version: WEB_EXPORT_VERSION,
  agent: 'muestra',
  voice: 'Kore',
  cols: COLS,
  rows: ROWS,
  ink: '#141414',
  paper: '#fafaf7',
  clipFps: 24,
  frameFile: 'frames.txt',
  frames: IDS,
  poses: [],
  clips: {},
};
const FRAMES_TEXT = webExportFramesText(IDS.map(frameOf));
const textOf = (id: string): string => frameOf(id, IDS.indexOf(id)).join('\n');

let requested: string[];

beforeEach(() => {
  requested = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('/muestra-web/manifest.json')) return new Response(JSON.stringify(MANIFEST), { status: 200 });
    if (url.endsWith('/muestra-web/frames.txt')) return new Response(FRAMES_TEXT, { status: 200 });
    return new Response('no', { status: 404 });
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(attrs: Record<string, string> = { src: 'muestra-web' }, width = 400): AsciiAvatarElement {
  const el = document.createElement('ascii-avatar') as AsciiAvatarElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  document.body.appendChild(el);
  return el;
}

/** Deja correr promesas y temporizadores falsos hasta que pase `event` (o falla). */
async function until(el: HTMLElement, event: string, maxMs = 5000): Promise<Event> {
  let got: Event | null = null;
  el.addEventListener(event, (e) => (got = e), { once: true });
  for (let t = 0; t < maxMs && got === null; t += 10) {
    await vi.advanceTimersByTimeAsync(10);
  }
  if (got === null) throw new Error(`no llegó el evento ${event}`);
  return got;
}

const pre = (el: HTMLElement): HTMLPreElement => el.shadowRoot!.querySelector('pre')!;

describe('<ascii-avatar>', () => {
  it('se registra como elemento personalizado', () => {
    expect(customElements.get('ascii-avatar')).toBe(AsciiAvatarElement);
  });

  it('carga el paquete de src, dibuja neutral en su shadow DOM y avisa listo', async () => {
    const el = mount();
    await until(el, 'listo');
    expect(requested.some((u) => u.endsWith('/muestra-web/manifest.json'))).toBe(true);
    expect(requested.some((u) => u.endsWith('/muestra-web/frames.txt'))).toBe(true);
    expect(pre(el).textContent).toBe(textOf('neutral'));
    expect(el.shadowRoot!.querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('muestra');
  });

  it('el tamaño de letra sale del ancho del contenedor y las columnas', async () => {
    const el = mount({ src: 'muestra-web/' }, 240);
    await until(el, 'listo');
    // 240 px / 4 columnas = 60 px por carácter; con 0,6 em por carácter, 100 px de letra y líneas de 120 px.
    expect(pre(el).style.fontSize).toBe('100px');
    expect(pre(el).style.lineHeight).toBe('120px');
  });

  it('pinta tinta sobre papel con los colores del paquete', async () => {
    const el = mount();
    await until(el, 'listo');
    // En el estilo del shadow DOM, como valor por defecto: la página lo puede cambiar con --ascii-avatar-tinta/-papel.
    const css = [...el.shadowRoot!.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toContain('--_aa-tinta: #141414');
    expect(css).toContain('--_aa-papel: #fafaf7');
    expect(css).toContain('var(--ascii-avatar-tinta, var(--_aa-tinta');
  });

  it('decir sin voz mueve la boca (cambia el cuadro), avisa hablando y termina con fin', async () => {
    const el = mount();
    await until(el, 'listo');
    const seen = new Set<string>();
    const hablando = until(el, 'hablando');
    let finished = false;
    void el.decir('Hola').then(() => (finished = true));
    const ev = (await hablando) as CustomEvent;
    expect(ev.detail).toMatchObject({ voz: false });
    for (let t = 0; t < 1800 && !finished; t += 20) {
      await vi.advanceTimersByTimeAsync(20);
      seen.add(pre(el).textContent ?? '');
    }
    expect(finished).toBe(true);
    expect([...seen].some((s) => s !== textOf('neutral'))).toBe(true);
    expect(seen.has(textOf('mouth_mid')) || seen.has(textOf('mouth_q1'))).toBe(true);
  });

  it('say, think y stop son alias de decir, pensar y callar', async () => {
    const el = mount();
    await until(el, 'listo');
    const fin = until(el, 'fin');
    void el.say('Hola');
    await vi.advanceTimersByTimeAsync(100);
    el.stop();
    await fin;
    expect(typeof el.think).toBe('function');
    expect(typeof el.pensar).toBe('function');
    el.think();
  });

  it('decir antes de que cargue espera al paquete', async () => {
    const el = mount();
    const p = el.decir('Hola');
    await until(el, 'hablando');
    await vi.advanceTimersByTimeAsync(2000);
    await p;
  });

  it('un paquete que no existe muestra el aviso en vez de la cara', async () => {
    const el = mount({ src: 'no-existe' });
    const ev = (await until(el, 'aviso')) as CustomEvent;
    expect(ev.detail.mensaje).toMatch(/no se pudo cargar/i);
    expect(pre(el).textContent).toMatch(/no se pudo cargar/i);
  });

  it('si la primera carga falla y luego src apunta a un paquete bueno, decir funciona', async () => {
    const el = mount({ src: 'no-existe' });
    await until(el, 'aviso');
    el.setAttribute('src', 'muestra-web/');
    await until(el, 'listo');
    const hablando = until(el, 'hablando');
    const p = el.decir('Hola');
    await hablando;
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBeUndefined();
  });

  it('cambiar src a otro paquete recarga y decir sigue funcionando', async () => {
    const el = mount();
    await until(el, 'listo');
    el.setAttribute('src', 'muestra-web/?v=2');
    el.setAttribute('src', 'muestra-web');
    await until(el, 'listo');
    const p = el.decir('Hola');
    await until(el, 'hablando');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBeUndefined();
  });

  it('quitar src deja el avatar vacío y decir falla en vez de quedarse esperando', async () => {
    const el = mount();
    await until(el, 'listo');
    el.removeAttribute('src');
    await vi.advanceTimersByTimeAsync(10);
    expect(pre(el).textContent).toBe('');
    await expect(el.decir('Hola')).rejects.toThrow(/no se pudo cargar|sin paquete/i);
    el.setAttribute('src', 'muestra-web/');
    await until(el, 'listo');
    const p = el.decir('Hola');
    await until(el, 'hablando');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBeUndefined();
  });

  it('sin tts-url no crea un AudioContext; al quitarlo de la página cierra el que creó', async () => {
    const created: { closed: boolean }[] = [];
    class FakeCtx {
      state = 'running';
      closed = false;
      baseLatency = 0;
      constructor() {
        created.push(this);
      }
      resume = async () => undefined;
      close = async () => void (this.closed = true);
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    const sinVoz = mount();
    await until(sinVoz, 'listo');
    const fin = until(sinVoz, 'fin');
    void sinVoz.decir('Hola');
    await vi.advanceTimersByTimeAsync(2000);
    await fin;
    expect(created).toHaveLength(0);
    sinVoz.remove();

    const conVoz = mount({ src: 'muestra-web/', 'tts-url': 'http://127.0.0.1:8787/tts' });
    await until(conVoz, 'listo');
    void conVoz.decir('Hola').catch(() => undefined);
    expect(created).toHaveLength(1);
    conVoz.remove();
    await vi.advanceTimersByTimeAsync(10);
    expect(created[0]!.closed).toBe(true);
  });

  it('oculto no dibuja; al volver, se pone al día', async () => {
    const el = mount();
    await until(el, 'listo');
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
    void el.decir('Hola, esto es una prueba larga');
    const before = pre(el).textContent;
    const frames = new Set<string>();
    for (let t = 0; t < 1500; t += 20) {
      await vi.advanceTimersByTimeAsync(20);
      frames.add(pre(el).textContent ?? '');
    }
    expect([...frames]).toEqual([before]);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    for (let t = 0; t < 600; t += 20) {
      await vi.advanceTimersByTimeAsync(20);
      frames.add(pre(el).textContent ?? '');
    }
    expect(frames.size).toBeGreaterThan(1);
  });

  it('al quitarlo de la página deja de animar y calla', async () => {
    const el = mount();
    await until(el, 'listo');
    const fin = until(el, 'fin');
    void el.decir('Hola, una frase larga para cortar');
    await vi.advanceTimersByTimeAsync(700);
    el.remove();
    await fin;
    const text = pre(el).textContent;
    await vi.advanceTimersByTimeAsync(1000);
    expect(pre(el).textContent).toBe(text);
  });
});
