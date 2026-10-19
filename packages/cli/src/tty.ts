import { INK, PAPER, frameToAnsi, type AsciiFrame } from '@ascii-avatar/core';

const MIN_COLS = 20;
const MIN_ROWS = 10;
const FPS = 12;
/** Cada cuánto se relee el gasto del día (lee un archivo). */
const SPENT_REFRESH_MS = 1000;

const ENTER_SCREEN = '\x1b[?1049h\x1b[?25l\x1b[2J';
const LEAVE_SCREEN = '\x1b[0m\x1b[?25h\x1b[?1049l';
const CLEAR_LINE = '\x1b[K';
/** Tinta sobre papel: se emite al inicio de cada fila para que el panel se vea igual en cualquier terminal. */
const PAPER_SGR = `\x1b[38;2;${INK.r};${INK.g};${INK.b}m\x1b[48;2;${PAPER.r};${PAPER.g};${PAPER.b}m`;
const PAPER_BG = `\x1b[48;2;${PAPER.r};${PAPER.g};${PAPER.b}m`;
const RESET = '\x1b[0m';
const at = (row: number, col = 1): string => `\x1b[${row};${col}H`;

export const TOO_SMALL = 'Terminal muy pequeña';

/** Recorta el cuadro al centro para que quepa en la terminal (menos una fila para el pie). */
export function fitFrame(
  frame: AsciiFrame,
  termCols: number,
  termRows: number,
): { frame: AsciiFrame | null; notice: string | null } {
  if (termCols < MIN_COLS || termRows < MIN_ROWS) return { frame: null, notice: TOO_SMALL };
  const cols = Math.min(frame.cols, termCols);
  const rows = Math.min(frame.rows, termRows - 1);
  if (cols === frame.cols && rows === frame.rows) return { frame, notice: null };
  const x0 = Math.floor((frame.cols - cols) / 2);
  const y0 = Math.floor((frame.rows - rows) / 2);
  const cells = [];
  for (let y = 0; y < rows; y++) {
    const start = (y0 + y) * frame.cols + x0;
    cells.push(...frame.cells.slice(start, start + cols));
  }
  return { frame: { cols, rows, cells }, notice: null };
}

export function footerText(s: {
  agent: string;
  voice: boolean;
  spent: number | null;
  notice: string | null;
}): string {
  const base = `${s.agent} · voz: ${s.voice ? 'on' : 'off'} · gasto hoy: ${s.spent === null ? '?' : `$${s.spent.toFixed(3)}`}`;
  return s.notice === null ? base : `${base} · ${s.notice}`;
}

/**
 * Pantalla completa como una cadena: cada fila va con su posición absoluta (sin saltos de línea ni
 * borrado total, para no parpadear) y termina borrando el resto de la fila. `clear` solo se pide
 * tras un cambio de tamaño.
 */
export function composeScreen(s: {
  frame: AsciiFrame;
  termCols: number;
  termRows: number;
  footer: string;
  clear?: boolean;
  /** Modo grabado: pinta papel (fondo) y tinta (frente) también fuera del cuadro y en el pie. */
  paper?: boolean;
}): string {
  const { termCols, termRows } = s;
  const paper = s.paper === true;
  // `\x1b[K` y `\x1b[2J` rellenan con el fondo activo: en modo papel va puesto antes de cada uno.
  const base = paper ? PAPER_SGR : '';
  const fit = fitFrame(s.frame, termCols, termRows);
  let out = s.clear === true ? `${paper ? PAPER_BG : ''}\x1b[2J` : '';
  if (fit.frame === null) {
    // Si el aviso no cabe en una fila, va una palabra por fila.
    const text = fit.notice ?? TOO_SMALL;
    const parts = text.length <= termCols ? [text] : text.split(' ');
    const rows = parts.slice(0, Math.max(1, termRows)).map((p, i) => at(i + 1) + p.slice(0, termCols));
    return `${base}${out}\x1b[2J${rows.join('')}${paper ? RESET : ''}`;
  }
  const lines = frameToAnsi(fit.frame).split('\n');
  const margin = ' '.repeat(Math.floor((termCols - fit.frame.cols) / 2));
  for (let row = 1; row < termRows; row++) {
    const line = lines[row - 1];
    out += at(row) + base + (line === undefined ? '' : margin + line) + (paper ? PAPER_BG : '') + CLEAR_LINE;
  }
  const text = s.footer.slice(0, termCols);
  const footer = paper ? `${base}${text}${CLEAR_LINE}${RESET}` : `\x1b[2m${text}\x1b[0m${CLEAR_LINE}`;
  return `${out}${at(termRows)}${footer}`;
}

export interface TtyOptions {
  agent: string;
  /** Modo grabado: pinta papel y tinta en toda la pantalla. */
  paper?: boolean;
  /** Para pruebas; por defecto `process.stdin` y `process.stdout`. */
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  getFrame(): AsciiFrame;
  voiceOn(): boolean;
  spentToday(): number;
  notice(): string | null;
  onToggleVoice(): void;
}

/** La terminal ya no existe (ventana cerrada, tubería rota): no hay a quién escribirle ni nada que reportar. */
function isGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EIO' || code === 'EPIPE';
}

/**
 * Bucle de pantalla alterna a ~12 cuadros por segundo. Resuelve al salir (`q`, Ctrl-C, señal);
 * la terminal siempre se restaura (cursor, pantalla alterna y modo crudo), también ante excepciones.
 * Si la terminal desaparece (EIO/EPIPE al escribir, p. ej. al cerrar la ventana) el panel termina
 * en silencio: escribir a una terminal muerta nunca debe tumbar el proceso con un error.
 */
export function runTty(o: TtyOptions): Promise<void> {
  const stdin = o.stdin ?? process.stdin;
  const stdout = o.stdout ?? process.stdout;
  const paper = o.paper === true;
  return new Promise<void>((resolve) => {
    let clear = true;
    let restored = false;
    let timer: NodeJS.Timeout | undefined;
    // Si el registro de gasto no se puede leer, el pie muestra "?" en vez de tumbar el panel.
    const readSpent = (): number | null => {
      try {
        return o.spentToday();
      } catch {
        return null;
      }
    };
    let spent = readSpent();
    let spentAt = performance.now();

    /** Escribe a la terminal; si ya no existe, termina el panel. Devuelve si se escribió. */
    const write = (text: string): boolean => {
      try {
        stdout.write(text);
        return true;
      } catch (error) {
        if (!isGone(error)) throw error;
        quit();
        return false;
      }
    };

    const draw = (): void => {
      if (restored) return;
      const now = performance.now();
      if (now - spentAt >= SPENT_REFRESH_MS) {
        spent = readSpent();
        spentAt = now;
      }
      const footer = footerText({ agent: o.agent, voice: o.voiceOn(), spent, notice: o.notice() });
      const termCols = stdout.columns || 80;
      const termRows = stdout.rows || 24;
      const screen = composeScreen({ frame: o.getFrame(), termCols, termRows, footer, clear, paper });
      if (write(screen)) clear = false;
    };

    const restore = (): void => {
      if (restored) return;
      restored = true;
      if (timer !== undefined) clearInterval(timer);
      try {
        stdout.write(LEAVE_SCREEN);
      } catch {
        // Terminal muerta (EIO/EPIPE) u otro fallo: no queda nada que restaurar ahí.
      }
      try {
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
      } catch {
        // Ya no hay nada más que restaurar.
      }
      stdin.off('data', onKey);
      stdout.off('resize', onResize);
      for (const [signal, handler] of signals) process.off(signal, handler);
      process.off('uncaughtException', onCrash);
      process.off('exit', restore);
      // Los 'error' de stdout/stdin se quedan escuchando: la escritura de restauración puede fallar
      // de forma asíncrona (EIO) cuando ya salimos, y sin oyente tumbaría el proceso.
    };
    const quit = (): void => {
      restore();
      resolve();
    };
    const onKey = (key: Buffer): void => {
      const text = key.toString('utf8');
      if (text === 'q' || text === 'Q' || text === '\x03') quit();
      else if (text === 'v' || text === 'V') o.onToggleVoice();
    };
    const onResize = (): void => {
      clear = true;
      draw();
    };
    const fail = (error: Error): void => {
      restore();
      process.stderr.write(`${error.stack ?? error.message}\n`);
      resolve();
      process.exit(1);
    };
    const onCrash = (error: Error): void => {
      if (isGone(error)) quit();
      else fail(error);
    };
    /** Error asíncrono de la terminal: si ya no existe, salida limpia; si es otro, se reporta. */
    const onStreamError = (error: Error): void => {
      if (restored) return;
      if (isGone(error)) quit();
      else fail(error);
    };
    const signals = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((s) => [s, quit] as const);

    stdout.on('error', onStreamError);
    stdin.on('error', onStreamError);
    if (!write(ENTER_SCREEN)) return;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
    stdout.on('resize', onResize);
    for (const [signal, handler] of signals) process.on(signal, handler);
    process.on('uncaughtException', onCrash);
    process.on('exit', restore);
    timer = setInterval(draw, Math.round(1000 / FPS));
    draw();
  });
}
