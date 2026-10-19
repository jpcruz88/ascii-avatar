/** Cuadros por segundo al hablar o durante un clip, y en reposo (igual que el panel). */
export const FPS_FAST = 24;
export const FPS_IDLE = 12;

/** Ancho típico de un carácter de fuente monoespaciada, en em (Menlo, Consolas, DejaVu Sans Mono…). */
export const DEFAULT_CHAR_WIDTH_EM = 0.6;

/**
 * Tamaño de letra para que `cols` columnas llenen `widthPx`, y alto de línea para que cada celda sea
 * 1:2 (alta el doble que ancha, como la celda de terminal con que se convirtieron los cuadros).
 * `charWidthEm` es el ancho medido de un carácter de la fuente; `null` si no hay ancho todavía.
 */
export function fitFont(
  widthPx: number,
  cols: number,
  charWidthEm: number = DEFAULT_CHAR_WIDTH_EM,
): { fontSize: number; lineHeight: number } | null {
  if (!Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(cols) || cols <= 0) return null;
  const em = Number.isFinite(charWidthEm) && charWidthEm > 0 ? charWidthEm : DEFAULT_CHAR_WIDTH_EM;
  const charPx = widthPx / cols;
  return { fontSize: charPx / em, lineHeight: charPx * 2 };
}

/**
 * Hora del próximo dibujo según el reloj, no «un intervalo después de dibujar»: así el tiempo de
 * dibujar no se suma a cada cuadro. Si se atrasa más de un cuadro, sigue desde ahora.
 */
export function nextDrawAt(prevAt: number, now: number, fast: boolean): number {
  return Math.max(prevAt + Math.round(1000 / (fast ? FPS_FAST : FPS_IDLE)), now);
}
