// Empaqueta el elemento <ascii-avatar> en un solo archivo ESM: packages/web/dist/ascii-avatar.js.
// Corre después de `tsc -b` (usa core/dist/browser.js). `platform: 'browser'` hace fallar el empaquetado
// si algo del grafo importara un builtin de Node.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here('./src/index.ts')],
  outfile: here('./dist/ascii-avatar.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  banner: { js: '/* ascii-avatar · elemento <ascii-avatar> · MIT */' },
  logLevel: 'warning',
});
