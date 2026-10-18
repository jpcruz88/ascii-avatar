import { describe, expect, it } from 'vitest';
import { pickExpression } from '../src/index.js';
import type { ExpressionId } from '../src/index.js';

describe('pickExpression', () => {
  it.each<[string, ExpressionId]>([
    ['Listo, las pruebas pasaron', 'smile'],
    ['Falló el build', 'sad'],
    ['Cuidado, esto es irreversible', 'serious'],
    ['¡Increíble!', 'surprised'],
    ['Revisé el archivo', 'neutral'],
    ['Error, pero ya quedó listo', 'sad'],
  ])('%j -> %s', (text, expected) => {
    expect(pickExpression(text)).toBe(expected);
  });

  it.each<[string, ExpressionId]>([
    ['Tests passed', 'smile'],
    ['All done', 'smile'],
    ['✓ 12 pruebas', 'smile'],
    ['Tarea completada: terminado', 'smile'],
    ['Todo con éxito', 'smile'],
    ['The build failed', 'sad'],
    ['No se pudo abrir el puerto', 'sad'],
    ['El intento fracasó', 'sad'],
    ['Warning: this is destructive', 'serious'],
    ['Ojo con esto', 'serious'],
    ['Una advertencia importante', 'serious'],
    ['Wow, it works', 'surprised'],
    ['Esto es sorprendente', 'surprised'],
    ['Whoa', 'surprised'],
  ])('reconoce palabras en español e inglés: %j -> %s', (text, expected) => {
    expect(pickExpression(text)).toBe(expected);
  });

  it('prioriza fallo, luego éxito, luego aviso y luego sorpresa', () => {
    expect(pickExpression('Cuidado: falló, pero listo')).toBe('sad');
    expect(pickExpression('Cuidado, ya está listo')).toBe('smile');
    expect(pickExpression('¡Cuidado!')).toBe('serious');
  });

  it('no distingue mayúsculas ni acentos', () => {
    expect(pickExpression('LISTO')).toBe('smile');
    expect(pickExpression('FALLO el build')).toBe('sad');
    expect(pickExpression('falló')).toBe('sad');
    expect(pickExpression('increible')).toBe('surprised');
    expect(pickExpression('INCREÍBLE')).toBe('surprised');
  });

  it('respeta límites de palabra al inicio pero acepta sufijos', () => {
    expect(pickExpression('Hay errores')).toBe('sad');
    expect(pickExpression('Fallos en el login')).toBe('sad');
    expect(pickExpression('Es puro terror')).toBe('neutral');
    expect(pickExpression('El derecho de autor')).toBe('neutral');
    expect(pickExpression('Ya está hecho')).toBe('smile');
    expect(pickExpression('Lo dejé a la derecha')).toBe('neutral');
    expect(pickExpression('Me duele el codo de tanto sobrar')).toBe('neutral');
    expect(pickExpression('Se enrojeció')).toBe('neutral');
  });

  it('ignora bloques de código e inline code', () => {
    expect(pickExpression('```ts\nthrow new Error("x"); // error\n```\nListo')).toBe('smile');
    expect(pickExpression('Revisé `error` en el archivo')).toBe('neutral');
    expect(pickExpression('~~~\nfailed\n~~~\nRevisé el archivo')).toBe('neutral');
    expect(pickExpression('Revisé esto\n```\nerror sin cerrar')).toBe('neutral');
  });

  it('devuelve neutral con texto vacío o sin palabras clave', () => {
    expect(pickExpression('')).toBe('neutral');
    expect(pickExpression('   \n  ')).toBe('neutral');
    expect(pickExpression('Hola, ¿qué tal?')).toBe('neutral');
  });

  it('no lanza con surrogates sueltos ni con texto muy largo', () => {
    expect(() => pickExpression('\uD800 error \uDC00')).not.toThrow();
    const start = performance.now();
    expect(pickExpression('palabra '.repeat(25_000))).toBe('neutral');
    expect(performance.now() - start).toBeLessThan(500);
  });
});
