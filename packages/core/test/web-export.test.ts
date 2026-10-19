import { describe, expect, it } from 'vitest';
import {
  WEB_EXPORT_FORMAT,
  WEB_EXPORT_VERSION,
  InvalidWebExportError,
  parseWebExport,
  webExportFramesText,
  type WebManifest,
} from '../src/browser.js';

const frame = (ch: string): string[] => ['ab' + ch, 'cd' + ch];

function manifest(over: Partial<WebManifest> = {}): WebManifest {
  return {
    format: WEB_EXPORT_FORMAT,
    version: WEB_EXPORT_VERSION,
    agent: 'muestra',
    voice: 'Kore',
    cols: 3,
    rows: 2,
    ink: '#141414',
    paper: '#fafaf7',
    clipFps: 24,
    frameFile: 'frames.txt',
    frames: ['neutral', 'mouth_q1', 'clip:nod:0', 'clip:nod:1'],
    poses: [],
    clips: { nod: 2 },
    ...over,
  };
}

describe('formato de exportación web', () => {
  it('cuadros a texto: una fila por línea, un cuadro tras otro, con salto final', () => {
    expect(webExportFramesText([frame('1'), frame('2')])).toBe('ab1\ncd1\nab2\ncd2\n');
  });

  it('ida y vuelta: parseWebExport devuelve cada cuadro por su id', () => {
    const m = manifest();
    const text = webExportFramesText([frame('1'), frame('2'), frame('3'), frame('4')]);
    const got = parseWebExport(m, text);
    expect(got.manifest).toEqual(m);
    expect(got.frames.get('neutral')).toBe('ab1\ncd1');
    expect(got.frames.get('clip:nod:1')).toBe('ab4\ncd4');
    expect(got.frames.size).toBe(4);
  });

  it('acepta saltos de línea CRLF (un servidor o git en Windows)', () => {
    const text = webExportFramesText([frame('1'), frame('2'), frame('3'), frame('4')]).replace(/\n/g, '\r\n');
    expect(parseWebExport(manifest(), text).frames.get('mouth_q1')).toBe('ab2\ncd2');
  });

  it('rechaza otro formato, otra versión o campos inválidos', () => {
    const text = webExportFramesText([frame('1'), frame('2'), frame('3'), frame('4')]);
    expect(() => parseWebExport({ ...manifest(), format: 'otro' }, text)).toThrow(InvalidWebExportError);
    expect(() => parseWebExport({ ...manifest(), version: 99 }, text)).toThrow(/versión/);
    expect(() => parseWebExport({ ...manifest(), cols: 0 }, text)).toThrow(InvalidWebExportError);
    expect(() => parseWebExport({ ...manifest(), frames: 'neutral' }, text)).toThrow(InvalidWebExportError);
    expect(() => parseWebExport(null, text)).toThrow(InvalidWebExportError);
    expect(() => parseWebExport('{}', text)).toThrow(InvalidWebExportError);
  });

  it('exige el cuadro neutral', () => {
    const m = manifest({ frames: ['mouth_q1', 'clip:nod:0', 'clip:nod:1', 'smile'] });
    const text = webExportFramesText([frame('1'), frame('2'), frame('3'), frame('4')]);
    expect(() => parseWebExport(m, text)).toThrow(/neutral/);
  });

  it('rechaza un texto con menos filas de las que declara el manifiesto', () => {
    expect(() => parseWebExport(manifest(), 'ab1\ncd1\n')).toThrow(/filas/);
  });

  it('rechaza una fila con un ancho distinto de cols', () => {
    const text = webExportFramesText([frame('1'), ['abcd', 'cd2'], frame('3'), frame('4')]);
    expect(() => parseWebExport(manifest(), text)).toThrow(/columnas/);
  });
});
