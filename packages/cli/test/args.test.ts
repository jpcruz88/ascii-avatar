import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';

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

  it('tras -- todo es posicional', () => {
    expect(parseArgs(['create', '--', '--raro']).positionals).toEqual(['--raro']);
  });
});
