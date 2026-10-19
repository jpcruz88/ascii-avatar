#!/usr/bin/env node
// Servidor estático mínimo para probar la demo en local: sirve la carpeta del repositorio (solo
// lectura, sin archivos ocultos) en 127.0.0.1. La demo queda en http://localhost:8080/examples/web/
//
//   node examples/web/serve.mjs [--port 8080]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const portArg = process.argv.indexOf('--port');
const port = Number(portArg === -1 ? 8080 : process.argv[portArg + 1]);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  // Nada fuera del repositorio ni archivos ocultos (.git, .env…).
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || file.slice(root.length).split(sep).some((part) => part.startsWith('.'))) {
    res.writeHead(404).end();
    return;
  }
  let target = file;
  try {
    if (statSync(target).isDirectory()) {
      if (!path.endsWith('/')) {
        res.writeHead(301, { Location: `${path}/` }).end();
        return;
      }
      target = join(target, 'index.html');
    }
    const size = statSync(target).size;
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Demo en http://localhost:${port}/examples/web/ (Ctrl-C para salir)`);
});
