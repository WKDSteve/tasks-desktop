import { describe, expect, it } from 'vitest';
import { containerOfPoint, drawable, shownIcon } from './icons';
import { hasAssetImage, lacksAlt } from './images';

describe('shownIcon: the item, its path, its category (concept 11.3)', () => {
  const paths = new Map([
    ['learning/lua', { kind: 'emoji' as const, value: '🌙' }],
    ['learning/art', { kind: 'asset' as const, value: 'assets/icon.svg' }],
  ]);

  it('takes the own icon first, with the item as the owner of an asset', () => {
    expect(shownIcon({ kind: 'task', id: 'a/t', icon: { kind: 'asset', value: 'assets/i.png' }, point: 'learning/lua#x' }, paths)).toEqual({
      icon: { kind: 'asset', value: 'assets/i.png' },
      owner: { kind: 'task', id: 'a/t' },
      from: 'own',
    });
  });

  it('else the icon of the path its point belongs to, an asset of the path read from the path', () => {
    expect(shownIcon({ kind: 'task', id: 'a/t', point: 'learning/lua#syntax', category: ['learning'] }, paths)?.icon.value).toBe('🌙');
    expect(shownIcon({ kind: 'task', id: 'a/t', point: 'learning/art#x' }, paths)).toEqual({
      icon: { kind: 'asset', value: 'assets/icon.svg' },
      owner: { kind: 'path', id: 'learning/art' },
      from: 'path',
    });
  });

  it('else the icon of its first category that has one, else none', () => {
    expect(shownIcon({ kind: 'task', id: 'a/t', point: 'learning/none#x', category: ['ux', 'learning'] }, paths)).toMatchObject({
      icon: { kind: 'emoji', value: '📚' },
      from: 'category',
    });
    expect(shownIcon({ kind: 'task', id: 'a/t', category: ['ux'] }, paths)).toBeNull();
    expect(shownIcon({ kind: 'task', id: 'a/t' })).toBeNull();
  });

  it('draws no word and no asset outside assets/: the next step is taken instead', () => {
    expect(drawable({ kind: 'word', value: 'handshake' })).toBe(false);
    expect(drawable({ kind: 'asset', value: '../x.png' })).toBe(false);
    expect(drawable({ kind: 'asset', value: 'https://tracker.example/x.png' })).toBe(false);
    expect(drawable({ kind: 'emoji', value: '' })).toBe(false);
    expect(shownIcon({ kind: 'task', id: 'a/t', icon: { kind: 'word', value: 'call' }, category: ['bug'] })?.from).toBe('category');
  });

  it('reads the container of a point', () => {
    expect(containerOfPoint('learning/lua#syntax')).toBe('learning/lua');
    expect(containerOfPoint('learning/lua')).toBe('learning/lua');
    expect(containerOfPoint(undefined)).toBeNull();
    expect(containerOfPoint('nope#x')).toBeNull();
    expect(containerOfPoint('a/b/c#x')).toBeNull();
  });
});

describe('lacksAlt', () => {
  it('finds an image without a description, and only that', () => {
    expect(lacksAlt('see ![](assets/x.png)')).toBe(true);
    expect(lacksAlt('see ![ ](assets/x.png)')).toBe(true);
    expect(lacksAlt('see ![Diagram](assets/x.png)')).toBe(false);
    expect(lacksAlt('a [link](https://example.org) and [](x)')).toBe(false);
  });
});

describe('hasAssetImage', () => {
  it('finds an image below assets/ and nothing else', () => {
    expect(hasAssetImage('see ![Board](assets/boards/b.svg)')).toBe(true);
    expect(hasAssetImage('see ![](./assets/x.png)')).toBe(true);
    expect(hasAssetImage('see ![x](https://tracker.example/assets/x.png)')).toBe(false);
    expect(hasAssetImage('a [link](assets/x.png) and plain text')).toBe(false);
  });
});
