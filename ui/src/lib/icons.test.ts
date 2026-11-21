import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ICONS,
  DEFAULT_CATEGORY_ICON_PREFS,
  categoryIconRows,
  categoryIconsOf,
  containerOfPoint,
  drawable,
  isOneGrapheme,
  parseCategoryIcons,
  serializeCategoryIcons,
  shownIcon,
  withCategoryIcon,
} from './icons';
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
    expect(shownIcon({ kind: 'task', id: 'a/t', point: 'learning/none#x', category: ['ux', 'learning'] }, paths, CATEGORY_ICONS)).toMatchObject({
      icon: { kind: 'emoji', value: '📚' },
      from: 'category',
    });
    expect(shownIcon({ kind: 'task', id: 'a/t', category: ['ux'] }, paths, CATEGORY_ICONS)).toBeNull();
    expect(shownIcon({ kind: 'task', id: 'a/t' })).toBeNull();
  });

  it('draws no word and no asset outside assets/: the next step is taken instead', () => {
    expect(drawable({ kind: 'word', value: 'handshake' })).toBe(false);
    expect(drawable({ kind: 'asset', value: '../x.png' })).toBe(false);
    expect(drawable({ kind: 'asset', value: 'https://tracker.example/x.png' })).toBe(false);
    expect(drawable({ kind: 'emoji', value: '' })).toBe(false);
    expect(shownIcon({ kind: 'task', id: 'a/t', icon: { kind: 'word', value: 'call' }, category: ['bug'] }, new Map(), CATEGORY_ICONS)?.from).toBe('category');
  });

  it('takes the icons of the categories from the setting: changed, emptied, switched off', () => {
    const bug = { kind: 'task' as const, id: 'a/t', category: ['bug'] };
    const prefs = withCategoryIcon(DEFAULT_CATEGORY_ICON_PREFS, 'bug', '🪲');
    expect(shownIcon(bug, new Map(), categoryIconsOf(prefs))?.icon.value).toBe('🪲');
    expect(shownIcon(bug, new Map(), categoryIconsOf(withCategoryIcon(prefs, 'bug', '')))).toBeNull();
    expect(shownIcon(bug, new Map(), categoryIconsOf({ ...prefs, on: false }))).toBeNull();
    // a category without an icon as it came gets one
    expect(shownIcon({ kind: 'task', id: 'a/t', category: ['ux'] }, new Map(), categoryIconsOf(withCategoryIcon(prefs, 'ux', '🎨')))?.icon.value).toBe('🎨');
    // an own icon and the one of the path still come first
    expect(shownIcon({ ...bug, icon: { kind: 'emoji', value: '⭐' } }, new Map(), categoryIconsOf(prefs))?.from).toBe('own');
    // a word of Object is no category with an icon
    expect(shownIcon({ kind: 'task', id: 'a/t', category: ['constructor', 'toString'] }, new Map(), CATEGORY_ICONS)).toBeNull();
    // without the setting: none
    expect(shownIcon(bug)).toBeNull();
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

describe('the setting "Icons of the categories"', () => {
  it('comes as the six icons, on', () => {
    expect(parseCategoryIcons(null)).toEqual(DEFAULT_CATEGORY_ICON_PREFS);
    expect(categoryIconsOf(DEFAULT_CATEGORY_ICON_PREFS)).toEqual(CATEGORY_ICONS);
    expect(Object.keys(CATEGORY_ICONS)).toEqual(['learning', 'bug', 'security', 'performance', 'docs', 'tests']);
  });

  it('keeps only what differs, and reads back what it wrote', () => {
    let prefs = withCategoryIcon(DEFAULT_CATEGORY_ICON_PREFS, 'bug', '🪲');
    prefs = withCategoryIcon(prefs, 'docs', '');
    prefs = withCategoryIcon(prefs, 'ux', '🎨');
    prefs = withCategoryIcon(prefs, 'tests', '🧪');
    expect({ ...prefs.changed }).toEqual({ bug: '🪲', docs: '', ux: '🎨' });
    const back = parseCategoryIcons(serializeCategoryIcons({ ...prefs, on: false }));
    expect(back.on).toBe(false);
    expect({ ...back.changed }).toEqual({ bug: '🪲', docs: '', ux: '🎨' });
    // back to the icon it came with: no change any more
    expect({ ...withCategoryIcon(prefs, 'bug', '🐞').changed }).toEqual({ docs: '', ux: '🎨' });
  });

  it('reads anything broken as the setting as it comes, and drops what is no icon', () => {
    expect(parseCategoryIcons('{')).toEqual(DEFAULT_CATEGORY_ICON_PREFS);
    expect(parseCategoryIcons('7')).toEqual(DEFAULT_CATEGORY_ICON_PREFS);
    const read = parseCategoryIcons(JSON.stringify({ on: 'yes', changed: { bug: 'ab', 'a b': '🎨', ux: 3, __proto__x: '', docs: '📄', perf: '⚡' } }));
    expect(read.on).toBe(true);
    expect({ ...read.changed }).toEqual({ perf: '⚡' });
    const proto = parseCategoryIcons('{"changed":{"__proto__":"🎨"}}');
    expect(categoryIconsOf(proto)['__proto__']).toBe('🎨');
    expect(Object.getPrototypeOf(categoryIconsOf(proto))).toBeNull();
  });

  it('offers the categories with an icon, then those of the vault, then the others it names, each once', () => {
    const prefs = withCategoryIcon(DEFAULT_CATEGORY_ICON_PREFS, 'zz', '🎨');
    expect(categoryIconRows(prefs, ['bug', 'ruleset'])).toEqual(['learning', 'bug', 'security', 'performance', 'docs', 'tests', 'ruleset', 'zz']);
  });
});

describe('isOneGrapheme', () => {
  const cases: [string, boolean][] = [
    ['🐞', true],
    ['A', true],
    ['⚡', true],
    ['❤\u{FE0F}', true],
    ['👍\u{1F3FD}', true],
    ['👩\u{200D}💻', true],
    ['👨\u{200D}👩\u{200D}👧\u{200D}👦', true],
    ['🇩🇪', true],
    ['1\u{FE0F}\u{20E3}', true],
    ['🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', true],
    ['e\u{301}', true],
    ['', false],
    [' ', false],
    [' 🐞', false],
    ['ab', false],
    ['🐞🐞', false],
    ['🇩🇪🇫🇷', false],
    ['🇩🇪🇫', false],
  ];
  it.each(cases)('%s: %s', (text, one) => {
    expect(isOneGrapheme(text)).toBe(one);
  });
});
