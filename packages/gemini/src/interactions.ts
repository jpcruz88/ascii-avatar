/** Lo mínimo del SDK que usamos; permite inyectar un falso en las pruebas. */
export interface InteractionsApi {
  interactions: { create(params: unknown): Promise<unknown> };
}

/** Campos de una interacción que comparten el adaptador de imágenes y el de voz. */
export interface InteractionResultBase {
  output_text?: string;
  status?: string;
  errors?: Array<{ code?: string; message?: string }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
  };
}

/** Texto, estado o errores que explican por qué la interacción no trajo el medio pedido. */
export function refusalDetail(result: InteractionResultBase): string | undefined {
  const parts: string[] = [];
  if (result.output_text) parts.push(result.output_text);
  if (result.status && result.status !== 'completed') parts.push(`estado: ${result.status}`);
  for (const e of result.errors ?? []) {
    const text = [e.code, e.message].filter(Boolean).join(': ');
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' | ') : undefined;
}

function validCount(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Tokens de uso para calcular el costo. Sin uso no se pierde un resultado ya pagado:
 * los conteos que falten, o que no sean un número finito y no negativo (NaN, Infinity,
 * negativos), van en `null` y el llamador estima. Así un valor raro de la API nunca
 * produce un costo NaN.
 *
 * Los tokens de pensamiento se suman a la salida. Si `total_output_tokens` ya los
 * incluyera, se sobrestima el costo, lo cual es seguro para el tope de presupuesto.
 * La primera corrida real debe compararse con la consola de facturación. Un conteo de
 * pensamiento inválido deja la salida en `null` (no se arriesga a subestimarla).
 */
export function extractUsage(usage: InteractionResultBase['usage']): {
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const inputTokens = validCount(usage?.total_input_tokens);
  const output = validCount(usage?.total_output_tokens);
  const thoughtRaw = usage?.total_thought_tokens;
  const thought = thoughtRaw === undefined ? 0 : validCount(thoughtRaw);
  const outputTokens = output === null || thought === null ? null : output + thought;
  return { inputTokens, outputTokens };
}
