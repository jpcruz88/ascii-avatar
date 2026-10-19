import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string, file = 'index'): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/${file}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Las pruebas resuelven los paquetes del workspace directo a sus fuentes .ts.
    // La subruta `core/browser` va antes que `core`, que si no la absorbería.
    alias: [
      { find: /^@ascii-avatar\/core\/browser$/, replacement: src('core', 'browser') },
      { find: /^@ascii-avatar\/core$/, replacement: src('core') },
      { find: /^@ascii-avatar\/gemini$/, replacement: src('gemini') },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
  },
});
