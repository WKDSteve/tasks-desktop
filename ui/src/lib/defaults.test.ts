import { describe, expect, it } from 'vitest';
import { FACTORY_DEFAULTS, isFactory, parseDefaults, serializeDefaults, startChoice, startView } from './defaults';

describe('defaults', () => {
  it('reads what it wrote, and the factory for anything else', () => {
    const mine = { startView: 'board', startWith: 'defaults', sort: 'roi', filter: '{"areas":["a"]}' } as const;
    expect(parseDefaults(serializeDefaults(mine))).toEqual(mine);
    for (const bad of [null, '', 'x', '[]', '{"startView":"nope","startWith":"x","sort":"zzz","filter":"[1]"}']) {
      expect(parseDefaults(bad)).toEqual(FACTORY_DEFAULTS);
    }
    expect(parseDefaults('{"filter":"{broken"}').filter).toBe('');
    expect(parseDefaults(JSON.stringify({ filter: `{"q":"${'x'.repeat(20_000)}"}` })).filter).toBe('');
  });

  it('opens on the view it was left on, unless a start view is set', () => {
    expect(startView(FACTORY_DEFAULTS, 'plan')).toBe('plan');
    expect(startView(FACTORY_DEFAULTS, 'nonsense')).toBe('today');
    expect(startView(FACTORY_DEFAULTS, null)).toBe('today');
    expect(startView({ ...FACTORY_DEFAULTS, startView: 'board' }, 'plan')).toBe('board');
  });

  it('starts with what was used last, the defaults where nothing was', () => {
    const d = { ...FACTORY_DEFAULTS, sort: 'roi' as const, filter: '{"statuses":["open"]}' };
    expect(startChoice(d, { filter: '{"areas":["x"]}', sort: 'due' })).toEqual({ filter: '{"areas":["x"]}', sort: 'due' });
    expect(startChoice(d, { filter: null, sort: null })).toEqual({ filter: '{"statuses":["open"]}', sort: 'roi' });
    expect(startChoice(FACTORY_DEFAULTS, { filter: null, sort: null })).toEqual({ filter: null, sort: 'default' });
  });

  it('starts with the defaults every time when the person said so', () => {
    const d = { ...FACTORY_DEFAULTS, startWith: 'defaults' as const, sort: 'roi' as const, filter: '' };
    expect(startChoice(d, { filter: '{"areas":["x"]}', sort: 'due' })).toEqual({ filter: null, sort: 'roi' });
  });

  it('knows the factory', () => {
    expect(isFactory(parseDefaults(null))).toBe(true);
    expect(isFactory({ ...FACTORY_DEFAULTS, sort: 'due' })).toBe(false);
  });
});
