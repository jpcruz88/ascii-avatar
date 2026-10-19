#!/usr/bin/env node
// Genera el agente de muestra de la demo (examples/web/muestra-web/): una cara dibujada a mano con
// figuras simples (círculo, ojos, cejas y boca), nunca la de una persona real. Crea el agente en
// una carpeta de datos temporal (ASCII_AVATAR_HOME) y lo exporta con el comando real
// `avatar exportar-web`. Requiere `npm run build` antes.
//
//   node examples/web/make-sample.mjs [--cols 72]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FACE_IDS, createAgent, saveClips, saveFace, savePoses } from '@ascii-avatar/core';

const W = 480;
const H = 600;
const NAME = 'muestra';
const repo = fileURLToPath(new URL('../..', import.meta.url));
const out = fileURLToPath(new URL('./muestra-web/', import.meta.url));
const colsArg = process.argv.indexOf('--cols');
const cols = colsArg === -1 ? '72' : process.argv[colsArg + 1];

/**
 * Una cara en SVG. `mouth`: 'line' | 'mid' | 'open' | 'smile' | 'frown' | 'o'; `eyes`: 'open' |
 * 'closed'; `look`: desplazamiento de las pupilas; `brows`: 'flat' | 'up' | 'angry' | 'sad';
 * `dx`/`dy`/`tilt`: posición e inclinación de la cabeza.
 */
function face({ mouth = 'line', eyes = 'open', look = 0, brows = 'flat', dx = 0, dy = 0, tilt = 0 } = {}) {
  const cx = W / 2;
  const cy = H / 2 + 20;
  const ink = 'stroke="#000" stroke-width="10" fill="none" stroke-linecap="round"';
  const eye = (x) =>
    eyes === 'closed'
      ? `<path d="M${x - 30} ${cy - 50} Q${x} ${cy - 36} ${x + 30} ${cy - 50}" ${ink}/>`
      : `<ellipse cx="${x}" cy="${cy - 50}" rx="32" ry="24" ${ink}/><circle cx="${x + look}" cy="${cy - 48}" r="12" fill="#000"/>`;
  const browY = { flat: 0, up: -22, angry: 6, sad: 0 }[brows];
  const browTilt = { flat: 0, up: 0, angry: 14, sad: -14 }[brows];
  const brow = (x, side) =>
    `<path d="M${x - 36} ${cy - 104 + browY + side * browTilt} L${x + 36} ${cy - 104 + browY - side * browTilt}" ${ink}/>`;
  const my = cy + 90;
  const mouths = {
    line: `<path d="M${cx - 60} ${my} L${cx + 60} ${my}" ${ink}/>`,
    mid: `<ellipse cx="${cx}" cy="${my}" rx="56" ry="16" ${ink}/>`,
    open: `<ellipse cx="${cx}" cy="${my + 6}" rx="58" ry="38" ${ink}/><path d="M${cx - 30} ${my + 26} Q${cx} ${my + 10} ${cx + 30} ${my + 26}" ${ink}/>`,
    smile: `<path d="M${cx - 70} ${my - 14} Q${cx} ${my + 50} ${cx + 70} ${my - 14}" ${ink}/>`,
    frown: `<path d="M${cx - 60} ${my + 20} Q${cx} ${my - 26} ${cx + 60} ${my + 20}" ${ink}/>`,
    o: `<ellipse cx="${cx}" cy="${my + 4}" rx="28" ry="34" ${ink}/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="100%" height="100%" fill="#fff"/>
<g transform="translate(${dx} ${dy}) rotate(${tilt} ${cx} ${cy})">
<ellipse cx="${cx}" cy="${cy}" rx="170" ry="210" stroke="#000" stroke-width="14" fill="none"/>
<path d="M${cx - 150} ${cy - 120} Q${cx} ${cy - 290} ${cx + 150} ${cy - 120}" ${ink}/>
${brow(cx - 70, -1)}${brow(cx + 70, 1)}${eye(cx - 70)}${eye(cx + 70)}
<path d="M${cx} ${cy - 20} L${cx - 14} ${cy + 36} L${cx + 8} ${cy + 36}" ${ink}/>
${mouths[mouth]}
</g></svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

const FACES = {
  neutral: {},
  mouth_mid: { mouth: 'mid' },
  mouth_open: { mouth: 'open' },
  blink: { eyes: 'closed' },
  smile: { mouth: 'smile', brows: 'up' },
  serious: { brows: 'angry' },
  surprised: { mouth: 'o', brows: 'up' },
  sad: { mouth: 'frown', brows: 'sad' },
};

const root = mkdtempSync(join(tmpdir(), 'ascii-avatar-muestra-'));
try {
  createAgent(root, NAME, await png(face()), { voice: 'Kore', voiceStyle: 'amable y tranquila', promptsVersion: 0 });
  for (const id of FACE_IDS) saveFace(root, NAME, id, await png(face(FACES[id])));
  savePoses(root, NAME, {
    look_left: await png(face({ look: -14 })),
    look_right: await png(face({ look: 14 })),
  });
  // Clip corto de asentir (8 cuadros, de neutral a neutral) y uno de ladear.
  const nod = [0, 6, 14, 20, 20, 14, 6, 0];
  const tilt = [0, -2, -5, -7, -7, -5, -2, 0];
  saveClips(root, NAME, {
    nod: await Promise.all(nod.map((dy) => png(face({ dy })))),
    tilt_left: await Promise.all(tilt.map((t) => png(face({ tilt: t })))),
  });
  const r = spawnSync(process.execPath, [join(repo, 'packages/cli/dist/bin.js'), 'exportar-web', NAME, '--out', out, '--cols', cols], {
    env: { ...process.env, ASCII_AVATAR_HOME: root, GEMINI_API_KEY: '' },
    encoding: 'utf8',
  });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
