import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgent, loadAgent } from '@ascii-avatar/core';
import { runVoz } from '../src/commands/voz.js';

let root: string;

// Basta la firma PNG: `createAgent` solo mira los bytes mágicos de la foto.
const PHOTO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ESTILO = 'un hombre mexicano de unos sesenta años, voz grave, cálida y pausada, acento mexicano';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aa-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runVoz', () => {
  it('sin banderas muestra la voz y el estilo actuales y no escribe nada', () => {
    createAgent(root, 'preciado', PHOTO, { voice: 'Algenib', voiceStyle: ESTILO });
    const file = join(root, 'agents', 'preciado', 'agent.json');
    const before = readFileSync(file, 'utf8');
    const r = runVoz({ root, name: 'preciado' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('preciado');
    expect(r.message).toContain('Algenib');
    expect(r.message).toContain(ESTILO);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('sin estilo guardado lo dice', () => {
    createAgent(root, 'preciado', PHOTO);
    const r = runVoz({ root, name: 'preciado' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Kore');
    expect(r.message).toMatch(/sin estilo|ninguno/i);
  });

  it('--voz cambia la voz, conserva el estilo y avisa que hay que reiniciar el panel', () => {
    createAgent(root, 'preciado', PHOTO, { voiceStyle: 'grave' });
    const r = runVoz({ root, name: 'preciado', voz: 'Algenib' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Algenib');
    expect(r.message).toMatch(/reinicia|reabre|vuelve a abrir/i);
    expect(loadAgent(root, 'preciado')).toMatchObject({ voice: 'Algenib', voiceStyle: 'grave' });
  });

  it('--estilo guarda el estilo y --estilo "" lo quita', () => {
    createAgent(root, 'preciado', PHOTO);
    expect(runVoz({ root, name: 'preciado', estilo: ESTILO }).ok).toBe(true);
    expect(loadAgent(root, 'preciado').voiceStyle).toBe(ESTILO);
    const r = runVoz({ root, name: 'preciado', estilo: '' });
    expect(r.ok).toBe(true);
    expect(loadAgent(root, 'preciado').voiceStyle).toBeUndefined();
  });

  it('acepta voz y estilo juntos', () => {
    createAgent(root, 'preciado', PHOTO);
    runVoz({ root, name: 'preciado', voz: 'Algenib', estilo: ESTILO });
    expect(loadAgent(root, 'preciado')).toMatchObject({ voice: 'Algenib', voiceStyle: ESTILO });
  });

  it('falla con mensaje claro si el agente no existe, el nombre es inválido o el estilo es largo', () => {
    createAgent(root, 'preciado', PHOTO);
    const noExiste = runVoz({ root, name: 'nadie', voz: 'Kore' });
    expect(noExiste.ok).toBe(false);
    expect(noExiste.message).toContain('nadie');
    expect(runVoz({ root, name: '../x' }).ok).toBe(false);
    const largo = runVoz({ root, name: 'preciado', estilo: 'x'.repeat(301) });
    expect(largo.ok).toBe(false);
    expect(largo.message).toContain('300');
    expect(loadAgent(root, 'preciado').voiceStyle).toBeUndefined();
  });
});

describe('avatar voz (proceso real)', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const distBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
  const bin = (...args: string[]) =>
    spawnSync(process.execPath, [distBin, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', ASCII_AVATAR_HOME: root },
    });

  it('muestra, cambia y quita la voz; las banderas desconocidas dan la ayuda y salen con 1', () => {
    const build = spawnSync('npx', ['tsc', '-b'], { cwd: repoRoot, encoding: 'utf8' });
    expect(build.status).toBe(0);
    createAgent(root, 'preciado', PHOTO);

    const set = bin('voz', 'preciado', '--voz', 'Algenib', '--estilo', ESTILO);
    expect(set.status).toBe(0);
    expect(loadAgent(root, 'preciado')).toMatchObject({ voice: 'Algenib', voiceStyle: ESTILO });

    const show = bin('voz', 'preciado');
    expect(show.status).toBe(0);
    expect(show.stdout).toContain('Algenib');
    expect(show.stdout).toContain(ESTILO);

    expect(bin('voz', 'preciado', '--estilo', '').status).toBe(0);
    expect(loadAgent(root, 'preciado').voiceStyle).toBeUndefined();

    const unknown = bin('voz', 'preciado', '--tono', 'x');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('--tono');
    expect(unknown.stderr).toContain('avatar voz');

    const sinNombre = bin('voz');
    expect(sinNombre.status).toBe(1);
    expect(sinNombre.stderr).toContain('avatar voz');

    const sinValor = bin('voz', 'preciado', '--voz');
    expect(sinValor.status).toBe(1);
    expect(sinValor.stderr).toContain('--voz');

    const noExiste = bin('voz', 'nadie');
    expect(noExiste.status).toBe(1);
    expect(noExiste.stderr).toContain('nadie');

    expect(bin('help').stdout).toContain('avatar voz');
  }, 120_000);
});
