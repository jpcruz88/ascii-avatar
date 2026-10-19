import { describe, expect, it } from 'vitest';
import { isModo, parseArgs, unknownFlags } from '../src/args.js';

describe('parseArgs', () => {
  it('separa comando, posicionales y banderas con valor', () => {
    expect(parseArgs(['create', 'ana', '--foto', '/tmp/a.png'])).toEqual({
      cmd: 'create',
      positionals: ['ana'],
      flags: { foto: '/tmp/a.png' },
    });
  });

  it('acepta --bandera=valor y banderas sin valor', () => {
    expect(parseArgs(['install-hook', '--uninstall', '--settings=/x/s.json'])).toEqual({
      cmd: 'install-hook',
      positionals: [],
      flags: { uninstall: true, settings: '/x/s.json' },
    });
  });

  it('una bandera booleana no se come el argumento siguiente', () => {
    expect(parseArgs(['install-hook', '--uninstall', '--settings', 's.json']).flags).toEqual({
      uninstall: true,
      settings: 's.json',
    });
  });

  it('sin argumentos, el comando es undefined', () => {
    expect(parseArgs([])).toEqual({ cmd: undefined, positionals: [], flags: {} });
  });

  it('una bandera con valor sin valor es un error', () => {
    expect(() => parseArgs(['panel', '--cols'])).toThrow(/--cols/);
    expect(() => parseArgs(['panel', '--cols', '--modo', 'glyphs'])).toThrow(/--cols/);
  });

  it('--caras lleva un valor', () => {
    expect(parseArgs(['create', 'ana', '--caras', './x'])).toEqual({
      cmd: 'create',
      positionals: ['ana'],
      flags: { caras: './x' },
    });
    expect(() => parseArgs(['create', 'ana', '--caras'])).toThrow('--caras');
  });

  it('--poses y --clips llevan un valor y son de create', () => {
    expect(parseArgs(['create', 'ana', '--poses', './p', '--clips', './c']).flags).toEqual({ poses: './p', clips: './c' });
    expect(() => parseArgs(['create', 'ana', '--poses'])).toThrow('--poses');
    expect(() => parseArgs(['create', 'ana', '--clips'])).toThrow('--clips');
    expect(unknownFlags('create', { caras: './x', poses: './p', clips: './c' })).toEqual([]);
    expect(unknownFlags('panel', { poses: './p' })).toEqual(['poses']);
  });

  it('voz: --voz y --estilo llevan un valor', () => {
    expect(parseArgs(['voz', 'preciado', '--voz', 'Algenib', '--estilo', 'grave y pausada'])).toEqual({
      cmd: 'voz',
      positionals: ['preciado'],
      flags: { voz: 'Algenib', estilo: 'grave y pausada' },
    });
    expect(parseArgs(['voz', 'preciado', '--estilo=un hombre, voz grave']).flags).toEqual({
      estilo: 'un hombre, voz grave',
    });
    expect(parseArgs(['voz', 'preciado', '--estilo', '']).flags).toEqual({ estilo: '' });
    expect(() => parseArgs(['voz', 'preciado', '--voz'])).toThrow('--voz');
    expect(() => parseArgs(['voz', 'preciado', '--estilo', '--voz', 'Kore'])).toThrow('--estilo');
  });

  it('tras -- todo es posicional', () => {
    expect(parseArgs(['create', '--', '--raro']).positionals).toEqual(['--raro']);
  });
});

describe('unknownFlags', () => {
  it('acepta solo las banderas de cada subcomando', () => {
    expect(unknownFlags('create', { foto: 'a.png' })).toEqual([]);
    expect(unknownFlags('create', { caras: './x', foto: 'a.png' })).toEqual([]);
    expect(unknownFlags('panel', { agente: 'ana', cols: '80', modo: 'glyphs' })).toEqual([]);
    expect(unknownFlags('install-hook', { uninstall: true, settings: 's.json' })).toEqual([]);
    expect(unknownFlags('voice', {})).toEqual([]);
    expect(unknownFlags('voz', {})).toEqual([]);
    expect(unknownFlags('voz', { voz: 'Algenib', estilo: 'grave' })).toEqual([]);
  });

  it('señala las desconocidas, p. ej. un error de tecleo en --uninstall', () => {
    expect(unknownFlags('install-hook', { unistall: true })).toEqual(['unistall']);
    expect(unknownFlags('voice', { foto: 'x' })).toEqual(['foto']);
    expect(unknownFlags('voz', { voz: 'Kore', tono: 'x' })).toEqual(['tono']);
    expect(unknownFlags('voice', { voz: 'Kore' })).toEqual(['voz']);
    expect(unknownFlags('create', { agente: 'x', foto: 'y' })).toEqual(['agente']);
  });
});

describe('--modo', () => {
  it('parseArgs acepta --modo grabado y --modo=grabado', () => {
    expect(parseArgs(['panel', '--modo', 'grabado']).flags).toEqual({ modo: 'grabado' });
    expect(parseArgs(['panel', '--modo=grabado']).flags).toEqual({ modo: 'grabado' });
    expect(unknownFlags('panel', { modo: 'grabado' })).toEqual([]);
  });

  it('isModo reconoce los tres modos y nada más', () => {
    expect(isModo('grabado')).toBe(true);
    expect(isModo('glyphs')).toBe(true);
    expect(isModo('halfblock')).toBe(true);
    expect(isModo('color')).toBe(false);
    expect(isModo(true)).toBe(false);
    expect(isModo(undefined)).toBe(false);
  });
});
