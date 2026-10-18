import { describe, expect, it } from 'vitest';
import { spokenSummary } from '../src/index.js';

describe('spokenSummary', () => {
  it('quita bloques de código y deja la prosa', () => {
    const text = [
      'Cambié la función para que valide la entrada.',
      '',
      '```ts',
      'export function f(x: number) {',
      '  return x + 1;',
      '}',
      '```',
      '',
      'Ahora las pruebas pasan.',
    ].join('\n');
    const out = spokenSummary(text);
    expect(out).toBe('Cambié la función para que valide la entrada. Ahora las pruebas pasan.');
    expect(out).not.toContain('`');
    expect(out).not.toContain('return');
  });

  it('quita bloques con ~~~ y con vallas más largas', () => {
    expect(spokenSummary('Antes.\n~~~\ncodigo()\n~~~\nDespués.')).toBe('Antes. Después.');
    expect(spokenSummary('Antes.\n````md\n```\ndentro\n```\n````\nDespués.')).toBe('Antes. Después.');
  });

  it('descarta todo lo que sigue a una valla sin cerrar', () => {
    expect(spokenSummary('Primero esto.\n```ts\nconst a = 1;\nSegunda frase.')).toBe('Primero esto.');
  });

  it('quita código en línea', () => {
    expect(spokenSummary('Usa `npm test` para probar.')).toBe('Usa para probar.');
    expect(spokenSummary('Mira ``a ` b`` aquí.')).toBe('Mira aquí.');
  });

  it('quita rutas y URLs', () => {
    const out = spokenSummary('Edité /Users/x/src/a.ts y https://x.com/y');
    expect(out).not.toContain('/Users');
    expect(out).not.toContain('a.ts');
    expect(out).not.toContain('http');
    expect(out).not.toContain('x.com');
    expect(out).toBe('Edité y');
  });

  it.each([
    ['Abrí ~/proyectos/app ahora.', 'Abrí ahora.'],
    ['Corre ./scripts/run.sh ya.', 'Corre ya.'],
    ['Mira ../lib/util.ts luego.', 'Mira luego.'],
    ['Está en C:\\Users\\jp\\app.exe hoy.', 'Está en hoy.'],
    ['Cambié src/a/b.ts y src/c.ts.', 'Cambié y.'],
    ['Ver www.ejemplo.com para más.', 'Ver para más.'],
    ['Ver (https://ejemplo.com/a?b=1).', 'Ver.'],
    ['Edité "src/app/main.ts" bien.', 'Edité bien.'],
  ])('quita rutas y URLs de %j', (input, expected) => {
    expect(spokenSummary(input)).toBe(expected);
  });

  it('no confunde palabras con barra con rutas', () => {
    expect(spokenSummary('Usa entrada/salida y/o TCP/IP.')).toBe('Usa entrada/salida y/o TCP/IP.');
  });

  it('quita filas y separadores de tablas', () => {
    const text = ['Resultados:', '| a | b |', '|---|---|', '| 1 | 2 |', 'Fin del resumen.'].join('\n');
    const out = spokenSummary(text);
    expect(out).toBe('Resultados: Fin del resumen.');
    expect(out).not.toContain('|');
  });

  it('quita marcas de énfasis y encabezados', () => {
    const out = spokenSummary('**Hecho** — ## Título');
    expect(out).not.toContain('*');
    expect(out).not.toContain('#');
    expect(out).toContain('Hecho');
    expect(out).toContain('Título');
    expect(spokenSummary('# Resumen\n\n_Todo_ __bien__ y ~~mal~~ ok.')).toBe('Resumen Todo bien y mal ok.');
  });

  it('quita marcas de listas y citas', () => {
    expect(spokenSummary('- Uno.\n* Dos.\n1. Tres.\n> Cuatro.\n- [x] Cinco.')).toBe(
      'Uno. Dos. Tres. Cuatro. Cinco.',
    );
  });

  it('conserva el texto de los enlaces y quita imágenes y HTML', () => {
    expect(spokenSummary('Lee la [guía de uso](https://x.com/guia) hoy.')).toBe('Lee la guía de uso hoy.');
    expect(spokenSummary('Mira ![captura](img/a.png) esto.')).toBe('Mira esto.');
    expect(spokenSummary('Hola <b>mundo</b><br/> adiós.')).toBe('Hola mundo adiós.');
  });

  it('quita emoji y pictogramas', () => {
    expect(spokenSummary('Listo ✅ todo 🎉 bien 👍🏽 y 👨‍👩‍👧 ✓ ok.')).toBe('Listo todo bien y ok.');
  });

  it('devuelve cadena vacía si no queda texto hablable', () => {
    expect(spokenSummary('```ts\nconst a = 1;\n```')).toBe('');
    expect(spokenSummary('')).toBe('');
    expect(spokenSummary('  \n\t \n ')).toBe('');
    expect(spokenSummary('/Users/x/a.ts')).toBe('');
    expect(spokenSummary('https://x.com ~/a/b ./c.ts')).toBe('');
    expect(spokenSummary('| a | b |\n|---|---|')).toBe('');
    expect(spokenSummary('🎉✅')).toBe('');
    expect(spokenSummary('---\n***\n')).toBe('');
    expect(spokenSummary('`solo código`')).toBe('');
  });

  it('conserva acentos, ñ y signos de apertura', () => {
    expect(spokenSummary('Corrección: añadí el acento en canción.')).toBe(
      'Corrección: añadí el acento en canción.',
    );
    expect(spokenSummary('¿Quieres que siga? ¡Claro que sí!')).toBe('¿Quieres que siga? ¡Claro que sí!');
  });

  it('toma frases completas hasta el máximo', () => {
    const text = 'Primera frase aquí. Segunda frase aquí. Tercera frase aquí.';
    expect(spokenSummary(text, { maxChars: 30 })).toBe('Primera frase aquí.');
    expect(spokenSummary(text, { maxChars: 39 })).toBe('Primera frase aquí. Segunda frase aquí.');
    expect(spokenSummary(text, { maxChars: 1000 })).toBe(text);
  });

  it('separa frases por ! ? … y saltos de línea', () => {
    expect(spokenSummary('¿Listo? ¡Sí! Bien… Ok\nOtra línea', { maxChars: 1000 })).toBe(
      '¿Listo? ¡Sí! Bien… Ok Otra línea',
    );
    expect(spokenSummary('Uno\nDos\nTres', { maxChars: 8 })).toBe('Uno Dos');
  });

  it('no corta números decimales ni versiones como frases', () => {
    expect(spokenSummary('La versión 3.14 salió. Otra frase.', { maxChars: 25 })).toBe('La versión 3.14 salió.');
  });

  it('un texto de 1000 caracteres cabe en 220 y termina en puntuación', () => {
    const sentence = 'Esta es una frase de prueba con varias palabras. ';
    const text = sentence.repeat(Math.ceil(1000 / sentence.length));
    expect(text.length).toBeGreaterThanOrEqual(1000);
    const out = spokenSummary(text);
    expect(out.length).toBeLessThanOrEqual(220);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/[.?!]$/);
  });

  it('recorta en el límite de palabra y termina en … si la primera frase excede el máximo', () => {
    const text = 'palabra '.repeat(100).trim() + '.';
    const out = spokenSummary(text);
    expect(out.length).toBeLessThanOrEqual(220);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toMatch(/^(palabra )+palabra…$/);
    expect(spokenSummary('Una frase bastante larga sin fin', { maxChars: 12 })).toBe('Una frase…');
    expect(spokenSummary('x'.repeat(500), { maxChars: 50 })).toBe('x'.repeat(49) + '…');
  });

  it('usa el valor por defecto si maxChars no es válido', () => {
    const text = 'a'.repeat(300);
    for (const maxChars of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      expect(spokenSummary(text, { maxChars }).length).toBeLessThanOrEqual(220);
    }
    expect(spokenSummary(text, {}).length).toBe(220);
  });

  it('no lanza con surrogates sueltos y no los devuelve', () => {
    expect(() => spokenSummary('\uD800')).not.toThrow();
    expect(() => spokenSummary('\uDC00 hola \uD83D')).not.toThrow();
    const out = spokenSummary('Hola \uD83D mundo \uDE00 fin.');
    expect(out).toBe('Hola mundo fin.');
    expect(spokenSummary('a'.repeat(10) + '𝒳'.repeat(20), { maxChars: 12 })).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/);
  });

  it('es rápido con textos enormes y patrones patológicos', () => {
    const inputs = [
      'Una frase normal con `código` y /ruta/a/b.ts y https://x.com. '.repeat(3500),
      'a'.repeat(200_000),
      '`'.repeat(200_000),
      '![a](' .repeat(40_000),
      '[a](' .repeat(50_000),
      '<a '.repeat(60_000),
      '.'.repeat(200_000) + 'x',
      '_'.repeat(100_000) + 'x' + '_'.repeat(100_000),
      '| a '.repeat(50_000),
      'x/'.repeat(100_000),
      ' '.repeat(200_000) + 'fin',
      '```\n'.repeat(40_000),
    ];
    for (const input of inputs) {
      const start = performance.now();
      const out = spokenSummary(input);
      const elapsed = performance.now() - start;
      expect(out.length).toBeLessThanOrEqual(220);
      expect(elapsed).toBeLessThan(500);
    }
  });
});
