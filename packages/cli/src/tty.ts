import { frameToAnsi, type AsciiFrame } from '@ascii-avatar/core';

const MIN_COLS = 20;
const MIN_ROWS = 10;
const FPS = 12;
/** Cada cuánto se relee el gasto del día (lee un archivo). */
const SPENT_REFRESH_MS = 1000;

const ENTER_SCREEN = '\x1b[?1049h\x1b[?25l\x1b[2J';
const LEAVE_SCREEN = '\x1b[0m\x1b[?25h\x1b[?1049l';
const CLEAR_LINE = '\x1b[K';
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
}): string {
  const { termCols, termRows } = s;
  const fit = fitFrame(s.frame, termCols, termRows);
  let out = s.clear === true ? '\x1b[2J' : '';
  if (fit.frame === null) {
    // Si el aviso no cabe en una fila, va una palabra por fila.
    const text = fit.notice ?? TOO_SMALL;
    const parts = text.length <= termCols ? [text] : text.split(' ');
    const rows = parts.slice(0, Math.max(1, termRows)).map((p, i) => at(i + 1) + p.slice(0, termCols));
    return `${out}\x1b[2J${rows.join('')}`;
  }
  const lines = frameToAnsi(fit.frame).split('\n');
  const margin = ' '.repeat(Math.floor((termCols - fit.frame.cols) / 2));
  for (let row = 1; row < termRows; row++) {
    const line = lines[row - 1];
    out += at(row) + (line === undefined ? '' : margin + line) + CLEAR_LINE;
  }
  return `${out}${at(termRows)}\x1b[2m${s.footer.slice(0, termCols)}\x1b[0m${CLEAR_LINE}`;
}

export interface TtyOptions {
  agent: string;
  getFrame(): AsciiFrame;
  voiceOn(): boolean;
  spentToday(): number;
  notice(): string | null;
  onToggleVoice(): void;
}

/**
 * Bucle de pantalla alterna a ~12 cuadros por segundo. Resuelve al salir (`q`, Ctrl-C, señal);
 * la terminal siempre se restaura (cursor, pantalla alterna y modo crudo), también ante excepciones.
 */
export function runTty(o: TtyOptions): Promise<void> {
  const { stdin, stdout } = process;
  return new Promise<void>((resolve) => {
    let clear = true;
    let restored = false;
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

    const draw = (): void => {
      const now = performance.now();
      if (now - spentAt >= SPENT_REFRESH_MS) {
        spent = readSpent();
        spentAt = now;
      }
      const footer = footerText({ agent: o.agent, voice: o.voiceOn(), spent, notice: o.notice() });
      const termCols = stdout.columns || 80;
      const termRows = stdout.rows || 24;
      stdout.write(composeScreen({ frame: o.getFrame(), termCols, termRows, footer, clear }));
      clear = false;
    };

    const restore = (): void => {
      if (restored) return;
      restored = true;
      clearInterval(timer);
      try {
        stdout.write(LEAVE_SCREEN);
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
    const onCrash = (error: Error): void => {
      restore();
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exit(1);
    };
    const signals = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((s) => [s, quit] as const);

    stdout.write(ENTER_SCREEN);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
    stdout.on('resize', onResize);
    for (const [signal, handler] of signals) process.on(signal, handler);
    process.on('uncaughtException', onCrash);
    process.on('exit', restore);
    const timer = setInterval(draw, Math.round(1000 / FPS));
    draw();
  });
}
