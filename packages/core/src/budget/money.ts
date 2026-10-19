/**
 * Tipo de cambio por defecto, en pesos mexicanos por dólar. Solo sirve para mostrar montos:
 * Gemini cobra en dólares y el registro de gasto, los precios y los topes se guardan en USD.
 */
export const DEFAULT_MXN_PER_USD = 18.4;

/**
 * Da formato de pesos a un monto en dólares: `"$0.04 MXN"`, con dos decimales; desde 100 pesos,
 * sin decimales (`"$184 MXN"`). Un monto o tipo de cambio no finito se muestra como `"$? MXN"`
 * en vez de lanzar: es solo para mostrar.
 */
export function formatMxn(usd: number, mxnPerUsd: number): string {
  const mxn = usd * mxnPerUsd;
  if (!Number.isFinite(mxn)) return '$? MXN';
  const cents = mxn.toFixed(2);
  return Number(cents) >= 100 ? `$${mxn.toFixed(0)} MXN` : `$${cents} MXN`;
}
