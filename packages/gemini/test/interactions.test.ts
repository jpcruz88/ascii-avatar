import { describe, expect, it } from 'vitest';
import { extractUsage, refusalDetail } from '../src/interactions.js';

describe('extractUsage', () => {
  it('devuelve entrada y salida; suma los tokens de pensamiento a la salida', () => {
    expect(extractUsage({ total_input_tokens: 5, total_output_tokens: 20 })).toEqual({
      inputTokens: 5,
      outputTokens: 20,
    });
    expect(
      extractUsage({ total_input_tokens: 5, total_output_tokens: 20, total_thought_tokens: 3 }),
    ).toEqual({ inputTokens: 5, outputTokens: 23 });
  });

  it('devuelve null en ambos si no hay uso', () => {
    expect(extractUsage(undefined)).toEqual({ inputTokens: null, outputTokens: null });
    expect(extractUsage({})).toEqual({ inputTokens: null, outputTokens: null });
  });

  it('deja en null el conteo que falte', () => {
    expect(extractUsage({ total_input_tokens: 7 })).toEqual({ inputTokens: 7, outputTokens: null });
    expect(extractUsage({ total_output_tokens: 7 })).toEqual({ inputTokens: null, outputTokens: 7 });
  });

  it('descarta como null todo conteo que no sea un número finito y no negativo', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, -1]) {
      expect(extractUsage({ total_input_tokens: bad, total_output_tokens: 4 })).toEqual({
        inputTokens: null,
        outputTokens: 4,
      });
      expect(extractUsage({ total_input_tokens: 4, total_output_tokens: bad })).toEqual({
        inputTokens: 4,
        outputTokens: null,
      });
      // Un pensamiento inválido no puede subestimar la salida: se pierde la cifra.
      expect(
        extractUsage({ total_input_tokens: 4, total_output_tokens: 4, total_thought_tokens: bad }),
      ).toEqual({ inputTokens: 4, outputTokens: null });
    }
  });
});

describe('refusalDetail', () => {
  it('une texto, estado distinto de completed y errores', () => {
    expect(
      refusalDetail({
        output_text: 'bloqueado',
        status: 'failed',
        errors: [{ code: 'SAFETY', message: 'no' }],
      }),
    ).toBe('bloqueado | estado: failed | SAFETY: no');
  });

  it('devuelve undefined sin información', () => {
    expect(refusalDetail({ status: 'completed' })).toBeUndefined();
  });
});
