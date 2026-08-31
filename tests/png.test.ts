import { describe, expect, it } from 'vitest';
import { base64Bytes, readPngSize } from '../src/background/capture-engine';

/** Minimal PNG signature + IHDR header carrying the given dimensions. */
function pngHeader(width: number, height: number): string {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return Buffer.from(bytes).toString('base64');
}

describe('readPngSize', () => {
  it('reads dimensions out of the IHDR chunk', () => {
    expect(readPngSize(pngHeader(1440, 900))).toEqual({ width: 1440, height: 900 });
  });

  it('returns zeroes rather than throwing on a truncated payload', () => {
    expect(readPngSize('iVBORw0KGgo=')).toEqual({ width: 0, height: 0 });
  });
});

describe('base64Bytes', () => {
  it('accounts for padding', () => {
    expect(base64Bytes(Buffer.from('abc').toString('base64'))).toBe(3);
    expect(base64Bytes(Buffer.from('abcd').toString('base64'))).toBe(4);
    expect(base64Bytes(Buffer.from('abcde').toString('base64'))).toBe(5);
  });
});
