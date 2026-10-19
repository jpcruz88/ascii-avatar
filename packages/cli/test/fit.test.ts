import { describe, expect, it } from 'vitest';
import { INK, PAPER, type AsciiFrame } from '@ascii-avatar/core';
import { composeScreen, fitFrame, footerText } from '../src/tty.js';

/** Cuadro de prueba: cada celda lleva la columna (módulo 10) como carácter, para verificar recortes. */
function makeFrame(cols: number, rows: number): AsciiFrame {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ ch: String(c % 10), fg: { r: 255, g: 0, b: 0 }, bg: null });
    }
  }
  return { cols, rows, cells };
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

describe('fitFrame', () => {
  it('un cuadro de 80 columnas en una terminal de 60 queda de ancho 60 y sin aviso', () => {
    const fit = fitFrame(makeFrame(80, 30), 60, 40);
    expect(fit.notice).toBeNull();
    expect(fit.frame?.cols).toBe(60);
    expect(fit.frame?.rows).toBe(30);
    expect(fit.frame?.cells).toHaveLength(60 * 30);
  });

  it('recorta al centro: quita 10 columnas a cada lado', () => {
    const fit = fitFrame(makeFrame(80, 4), 60, 40);
    // La columna 10 del original es la primera del recorte; el original tiene '0' ahí.
    expect(fit.frame?.cells[0]?.ch).toBe('0');
    expect(fit.frame?.cells[1]?.ch).toBe('1');
    const asColumns = fit.frame!.cells.slice(0, 60).map((c) => c.ch).join('');
    expect(asColumns.startsWith('0123456789')).toBe(true);
  });

  it('recorta también al centro en vertical, dejando una fila para el pie', () => {
    const frame = makeFrame(40, 41);
    // Marca cada fila con su índice en el color rojo para reconocerla.
    frame.cells.forEach((cell, i) => (cell.fg = { r: Math.floor(i / 40), g: 0, b: 0 }));
    const fit = fitFrame(frame, 60, 21);
    expect(fit.frame?.rows).toBe(20);
    expect(fit.frame?.cols).toBe(40);
    // 41 filas -> 20: se quitan 21; arriba 10 y abajo 11, la primera visible es la fila 10.
    expect(fit.frame?.cells[0]?.fg.r).toBe(10);
    expect(fit.frame?.cells.at(-1)?.fg.r).toBe(29);
  });

  it('no toca un cuadro que ya cabe', () => {
    const frame = makeFrame(60, 20);
    expect(fitFrame(frame, 80, 30).frame).toEqual(frame);
  });

  it('en una terminal de 15x8 no hay cuadro y avisa', () => {
    expect(fitFrame(makeFrame(80, 30), 15, 8)).toEqual({
      frame: null,
      notice: 'Terminal muy pequeña',
    });
  });

  it('el límite es 20 columnas por 10 filas', () => {
    expect(fitFrame(makeFrame(80, 30), 20, 10).frame).not.toBeNull();
    expect(fitFrame(makeFrame(80, 30), 19, 10).frame).toBeNull();
    expect(fitFrame(makeFrame(80, 30), 20, 9).frame).toBeNull();
  });
});

describe('footerText', () => {
  it('muestra agente, voz y gasto del día en pesos con dos decimales', () => {
    expect(footerText({ agent: 'luna', voice: false, spent: 0, mxnPorUsd: 18.4, notice: null })).toBe(
      'luna · voz: off · gasto hoy: $0.00 MXN',
    );
    expect(footerText({ agent: 'luna', voice: true, spent: 0.0401, mxnPorUsd: 18.4, notice: null })).toBe(
      'luna · voz: on · gasto hoy: $0.74 MXN',
    );
  });

  it('convierte con el tipo de cambio recibido', () => {
    expect(footerText({ agent: 'luna', voice: true, spent: 0.1, mxnPorUsd: 20, notice: null })).toBe(
      'luna · voz: on · gasto hoy: $2.00 MXN',
    );
  });

  it('no escribe USD ni un monto en dólares', () => {
    const text = footerText({ agent: 'luna', voice: true, spent: 0.0401, mxnPorUsd: 18.4, notice: null });
    expect(text).not.toMatch(/USD/);
    expect(text).not.toContain('$0.040');
  });

  it('agrega el aviso al final si hay uno', () => {
    expect(
      footerText({
        agent: 'luna',
        voice: true,
        spent: 0.3,
        mxnPorUsd: 18.4,
        notice: 'Límite diario de voz alcanzado ($5.52 MXN)',
      }),
    ).toBe('luna · voz: on · gasto hoy: $5.52 MXN · Límite diario de voz alcanzado ($5.52 MXN)');
  });
});

describe('composeScreen', () => {
  const footer = 'luna · voz: off · gasto hoy: $0.00 MXN';

  it('coloca el cuadro desde la fila 1 y el pie en la última fila', () => {
    const out = composeScreen({ frame: makeFrame(30, 5), termCols: 60, termRows: 12, footer });
    expect(out).toContain('\x1b[1;');
    expect(out).toContain('\x1b[5;');
    expect(out).toContain('\x1b[12;1H');
    expect(stripAnsi(out)).toContain(footer);
  });

  it('centra horizontalmente un cuadro más angosto que la terminal', () => {
    const out = composeScreen({ frame: makeFrame(30, 1), termCols: 60, termRows: 12, footer });
    // 15 espacios de margen a la izquierda.
    expect(out).toContain(`\x1b[1;1H${' '.repeat(15)}`);
  });

  it('limpia el resto de cada fila y las filas sobrantes, para no dejar restos', () => {
    const out = composeScreen({ frame: makeFrame(30, 2), termCols: 60, termRows: 12, footer });
    // 11 filas de imagen/relleno + pie = 12 secuencias de borrar hasta fin de línea.
    expect(out.split('\x1b[K')).toHaveLength(13);
  });

  it('no emite borrado de pantalla completo salvo que se pida', () => {
    const base = { frame: makeFrame(30, 2), termCols: 60, termRows: 12, footer };
    expect(composeScreen(base)).not.toContain('\x1b[2J');
    expect(composeScreen({ ...base, clear: true }).startsWith('\x1b[2J')).toBe(true);
  });

  it('recorta el pie al ancho de la terminal', () => {
    const out = composeScreen({
      frame: makeFrame(30, 2),
      termCols: 25,
      termRows: 12,
      footer: 'x'.repeat(100),
    });
    expect(stripAnsi(out).endsWith('x'.repeat(25))).toBe(true);
    expect(stripAnsi(out)).not.toContain('x'.repeat(26));
  });

  it('en una terminal muy pequeña muestra el aviso en lugar del cuadro', () => {
    const out = composeScreen({ frame: makeFrame(80, 30), termCols: 30, termRows: 8, footer });
    expect(stripAnsi(out)).toContain('Terminal muy pequeña');
    expect(out).not.toContain('\x1b[38;2;');
  });

  it('si el aviso no cabe en el ancho, lo reparte una palabra por fila', () => {
    const out = composeScreen({ frame: makeFrame(80, 30), termCols: 15, termRows: 8, footer });
    expect(out).toContain('\x1b[1;1HTerminal');
    expect(out).toContain('\x1b[3;1Hpequeña');
  });
});

describe('footerText sin lectura del gasto', () => {
  it('muestra "?" si no se pudo leer el gasto', () => {
    expect(footerText({ agent: 'luna', voice: true, spent: null, mxnPorUsd: 18.4, notice: null })).toBe(
      'luna · voz: on · gasto hoy: ?',
    );
  });
});

describe('composeScreen en modo papel (grabado)', () => {
  const footer = 'luna · voz: off · gasto hoy: $0.00 MXN';
  const ink = `\x1b[38;2;${INK.r};${INK.g};${INK.b}m`;
  const paper = `\x1b[48;2;${PAPER.r};${PAPER.g};${PAPER.b}m`;
  const base = { frame: makeFrame(30, 2), termCols: 60, termRows: 12, footer, paper: true };

  it('pinta papel en cada fila: margen, filas sobrantes y borrado hasta fin de línea', () => {
    const out = composeScreen(base);
    // Cada fila (11 de imagen y relleno + pie) empieza por tinta y papel, también las vacías.
    for (let row = 1; row <= 12; row++) {
      expect(out).toContain(`\x1b[${row};1H${ink}${paper}`);
    }
    // El margen izquierdo de la fila 1 va sobre papel, antes de las celdas.
    expect(out).toContain(`\x1b[1;1H${ink}${paper}${' '.repeat(15)}`);
    // El borrado hasta fin de línea siempre se hace con el papel activo.
    for (const piece of out.split('\x1b[K').slice(0, -1)) {
      expect(piece.lastIndexOf(paper)).toBeGreaterThan(piece.lastIndexOf('\x1b[0m'));
    }
  });

  it('el pie es tinta sobre papel, legible y sin atenuar', () => {
    const out = composeScreen(base);
    expect(out).toContain(`\x1b[12;1H${ink}${paper}${footer}`);
    expect(out).not.toContain('\x1b[2m');
  });

  it('el borrado de pantalla completo se hace con el papel puesto', () => {
    expect(composeScreen({ ...base, clear: true }).startsWith(`${paper}\x1b[2J`)).toBe(true);
  });

  it('el aviso de terminal pequeña también va en tinta sobre papel', () => {
    const out = composeScreen({ ...base, termCols: 30, termRows: 8 });
    expect(out.startsWith(`${ink}${paper}`)).toBe(true);
    expect(stripAnsi(out)).toContain('Terminal muy pequeña');
  });

  it('sin la opción papel no se pinta fondo (glyphs y halfblock siguen igual)', () => {
    expect(composeScreen({ ...base, paper: false })).not.toContain('\x1b[48;2;');
  });
});
