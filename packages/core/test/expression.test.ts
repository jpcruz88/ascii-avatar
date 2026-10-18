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

  it('un negador cercano anula la palabra clave', () => {
    expect(pickExpression('12 passed, 0 failed')).toBe('smile');
    expect(pickExpression('sin errores, todo listo')).toBe('smile');
    expect(pickExpression('Sin errores')).toBe('neutral');
    expect(pickExpression('no errors found')).toBe('neutral');
    expect(pickExpression('no pasaron las pruebas')).toBe('neutral');
    expect(pickExpression('Nunca falló')).toBe('neutral');
    expect(pickExpression('Zero errors')).toBe('neutral');
    expect(pickExpression('Cero fallos')).toBe('neutral');
    expect(pickExpression('Ningún error')).toBe('neutral');
    expect(pickExpression('It did not fail, but not done')).toBe('neutral');
  });

  it('el negador debe estar en la misma cláusula y a lo sumo 2 palabras atrás', () => {
    expect(pickExpression('Hay 0 problemas. Error al compilar')).toBe('sad');
    expect(pickExpression('No sé qué pasó, falló el build')).toBe('sad');
    expect(pickExpression('sin duda alguna hubo un error')).toBe('sad');
    expect(pickExpression('10 failed')).toBe('sad');
  });

  it('las palabras clave terminan en límite de palabra salvo las raíces', () => {
    expect(pickExpression('abre los ojos')).toBe('neutral');
    expect(pickExpression('Ojo con esto')).toBe('serious');
    expect(pickExpression('the doneness of the steak')).toBe('neutral');
    expect(pickExpression('Todo done.')).toBe('smile');
    expect(pickExpression('Fue destructivo')).toBe('serious');
    expect(pickExpression('Fracasó el intento')).toBe('sad');
    expect(pickExpression('Muy sorprendentes')).toBe('surprised');
  });

  it('ignora rutas, nombres de archivo y URLs', () => {
    expect(pickExpression('Edité src/errors/handler.ts')).toBe('neutral');
    expect(pickExpression('Edité done.txt')).toBe('neutral');
    expect(pickExpression('Abrí error.log y failed_tests.md')).toBe('neutral');
    expect(pickExpression('Mira https://x.com/error/listo')).toBe('neutral');
    expect(pickExpression('Mira src/a.ts:42 y snake_case_error')).toBe('neutral');
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
    const dense = performance.now();
    expect(pickExpression('sin error '.repeat(30_000))).toBe('neutral');
    expect(pickExpression('error '.repeat(40_000))).toBe('sad');
    expect(performance.now() - dense).toBeLessThan(500);
  });
});
