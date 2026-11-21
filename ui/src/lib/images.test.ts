import { describe, expect, it } from 'vitest';
import { isAssetImage } from './images';

describe('isAssetImage', () => {
  it('takes a plain picture below assets/', () => {
    for (const path of ['assets/a.png', 'assets/b/c.JPG', 'assets/d.jpeg', 'assets/e.gif', 'assets/f.webp', 'assets/g.svg']) {
      expect(isAssetImage(path), path).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const path of [
      undefined,
      '',
      'assets/slides.pdf',
      'assets/clip.mp4',
      'assets/a.svgz',
      'images/a.png',
      '/assets/a.png',
      'assets/../x.png',
      'assets/./a.png',
      'assets//a.png',
      'assets/a b.png',
      'assets\\a.png',
      'https://x.example/assets/a.png',
    ]) {
      expect(isAssetImage(path), String(path)).toBe(false);
    }
  });
});
