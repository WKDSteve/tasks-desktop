// The words of the views that are chunks of their own: both languages fill the same placeholders, a key of the page is
// not taken for one of the view, and a view's `t` falls back to the page's words.
import { describe, expect, it } from 'vitest';
import { chunkTexts, placeholders, type ChunkTexts } from './chunkTexts';
import { badgeTexts } from './badgeTexts';
import { rewardTexts } from './rewardTexts';

const ALL: Record<string, ChunkTexts<string>> = { badges: badgeTexts, rewards: rewardTexts };

describe('chunkTexts', () => {
  it('fills placeholders and falls back to the words of the page', () => {
    const texts = chunkTexts({ 'x.hello': 'Hello {name}' }, { 'x.hello': 'Hallo {name}' });
    expect(texts.text('de', 'x.hello', { name: 'Ada' })).toBe('Hallo Ada');
    expect(texts.t('en', 'x.hello', { name: 'Ada' })).toBe('Hello Ada');
    expect(texts.has('x.hello')).toBe(true);
    expect(texts.has('toString')).toBe(false);
    expect(texts.t('en', 'paths.retry')).not.toBe('paths.retry');
  });

  for (const [name, texts] of Object.entries(ALL)) {
    it(`${name}: names the same placeholders in English and German, and no key of the page`, () => {
      const keys = texts.keys();
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(placeholders(texts.text('de', key)), key).toEqual(placeholders(texts.text('en', key)));
        expect(key.startsWith('nav.'), key).toBe(false);
      }
    });
  }
});
