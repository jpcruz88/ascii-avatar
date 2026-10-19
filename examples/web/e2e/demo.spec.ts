import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __cuadros?: string[];
  }
}

test.describe('demo web de <ascii-avatar>', () => {
  test('carga la muestra, dibuja la cara y decir("Hola") sin voz mueve la boca y termina', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/examples/web/');
    const status = page.getByRole('status');
    await expect(status).toHaveText('Listo: muestra.');

    // El <pre> vive en el shadow DOM abierto: los localizadores de Playwright lo atraviesan.
    const avatar = page.getByRole('img', { name: 'Avatar de muestra' });
    const face = avatar.locator('pre');
    await expect(face).toContainText('B');

    // La cara cabe en el ancho del contenedor (la letra sale del ancho y las columnas).
    const box = await page.locator('ascii-avatar').boundingBox();
    const faceBox = await face.boundingBox();
    expect(faceBox!.width).toBeLessThanOrEqual(box!.width + 1);
    expect(faceBox!.width).toBeGreaterThan(box!.width * 0.9);

    // Registra cada cuadro que se dibuja.
    await page.evaluate(() => {
      const pre = document.querySelector('ascii-avatar')!.shadowRoot!.querySelector('pre')!;
      window.__cuadros = [];
      new MutationObserver(() => window.__cuadros!.push(pre.textContent ?? '')).observe(pre, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    const neutral = await face.textContent();

    await page.getByLabel('Texto').fill('Hola');
    await page.getByRole('button', { name: 'Decir' }).click();
    await expect(status).toHaveText('Hablando (sin voz)…');
    await expect(status).toHaveText('Terminó.', { timeout: 10_000 });

    const cuadros = await page.evaluate(() => window.__cuadros ?? []);
    const distintos = new Set(cuadros.filter((c) => c !== neutral));
    // La boca pasa por varias aperturas: varios cuadros distintos de la cara en reposo.
    expect(distintos.size).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });
});
