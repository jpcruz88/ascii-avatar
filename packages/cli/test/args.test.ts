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
  });

  it('señala las desconocidas, p. ej. un error de tecleo en --uninstall', () => {
    expect(unknownFlags('install-hook', { unistall: true })).toEqual(['unistall']);
    expect(unknownFlags('voice', { foto: 'x' })).toEqual(['foto']);
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
