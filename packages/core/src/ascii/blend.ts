import type { RawImage } from './types.js';

/**
 * Mezcla dos imágenes RGBA píxel a píxel: `a * (1 - t) + b * t`, redondeado. El resultado tiene el
 * tamaño de `a`; si `b` mide otra cosa, se muestrea por vecino más cercano a ese tamaño. Sirve para
 * sintetizar cuadros intermedios entre dos caras con el mismo encuadre. Determinista.
 */
export function blendImages(a: RawImage, b: RawImage, t: number): RawImage {
  const { width, height } = a;
  const data = new Uint8Array(width * height * 4);
  const same = b.width === width && b.height === height;
  for (let y = 0; y < height; y++) {
    const by = same ? y : Math.min(b.height - 1, Math.floor(((y + 0.5) * b.height) / height));
    for (let x = 0; x < width; x++) {
      const bx = same ? x : Math.min(b.width - 1, Math.floor(((x + 0.5) * b.width) / width));
      const i = (y * width + x) * 4;
      const j = (by * b.width + bx) * 4;
      for (let c = 0; c < 4; c++) {
        data[i + c] = Math.round((a.data[i + c] ?? 0) * (1 - t) + (b.data[j + c] ?? 0) * t);
      }
    }
  }
  return { width, height, data };
}
