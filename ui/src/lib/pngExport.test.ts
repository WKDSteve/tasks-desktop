import { describe, expect, it } from 'vitest';
import { fitsCanvas, isPicture } from './pngExport';

describe('the picture of a view', () => {
  it('has to fit a canvas at its scale', () => {
    expect(fitsCanvas(32_500)).toBe(true);
    expect(fitsCanvas(35_000)).toBe(false);
  });
  it('is checked: what a failed canvas gives is not saved as a picture', () => {
    const header = (w: number, h: number) => {
      const bytes = new Uint8Array(24);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const view = new DataView(bytes.buffer);
      view.setUint32(16, w);
      view.setUint32(20, h);
      return bytes;
    };
    expect(isPicture(header(2200, 900))).toBe(true);
    expect(isPicture(header(0, 0))).toBe(false);
    expect(isPicture(new Uint8Array(24))).toBe(false);
    expect(isPicture(new Uint8Array(4))).toBe(false);
  });
});
