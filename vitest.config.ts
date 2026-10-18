import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Las pruebas resuelven los paquetes del workspace directo a sus fuentes .ts.
    alias: {
      '@ascii-avatar/core': src('core'),
      '@ascii-avatar/gemini': src('gemini'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
