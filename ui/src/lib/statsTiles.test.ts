import { describe, expect, it } from 'vitest';
import { make } from './appDouble';
import { cutOf, STAT_DIMS } from './stats';
import {
  ALL_TILES,
  DEFAULT_TILES,
  defaultTilePrefs,
  dimOf,
  isDefaultTiles,
  parseTilePrefs,
  shownTiles,
  tileShown,
  withShown,
  withTile,
  type TileId,
} from './statsTiles';
import { bucketClass, bucketLabel, bucketName, dimHint, SERIES } from './statsWords';
import { NONE } from './filter';
import { OTHER, TOP } from './stats';
import { task } from './fixtures';

describe('the tiles of the statistics', () => {
  it('are the numbers and one per field; at first every number and the first fields are shown', () => {
    expect(ALL_TILES.length).toBe(8 + STAT_DIMS.length);
    expect(new Set(ALL_TILES).size).toBe(ALL_TILES.length);
    const shown = shownTiles(defaultTilePrefs());
    expect(shown).toEqual(DEFAULT_TILES);
    expect(shown).toContain('n:open');
    expect(shown).toContain('d:actor');
    expect(shown).not.toContain('d:tag');
    expect(dimOf('d:tag')).toBe('tag');
    expect(dimOf('n:open')).toBeNull();
  });

  it('a tile is hidden with its x and comes back: back as it came, the choice leaves no trace', () => {
    const hidden = withTile(defaultTilePrefs(), 'n:ready', false);
    expect(tileShown(hidden, 'n:ready')).toBe(false);
    expect(shownTiles(hidden)).not.toContain('n:ready');
    expect(isDefaultTiles(hidden)).toBe(false);
    expect(isDefaultTiles(withTile(hidden, 'n:ready', true))).toBe(true);
    // A tile that is not shown at first is added, and taking it away again is "as it came" too.
    const added = withTile(defaultTilePrefs(), 'd:tag', true);
    expect(shownTiles(added)).toContain('d:tag');
    expect(isDefaultTiles(withTile(added, 'd:tag', false))).toBe(true);
    // Hiding twice is hiding once.
    expect(withTile(hidden, 'n:ready', false)).toEqual(hidden);
  });

  it('are drawn in their order whatever the order they were chosen in', () => {
    const prefs = withTile(withTile(defaultTilePrefs(), 'd:project', true), 'd:tag', true);
    const shown = shownTiles(prefs);
    expect(shown.indexOf('d:tag')).toBeLessThan(shown.indexOf('d:project'));
    expect(shown.indexOf('n:effort')).toBeLessThan(shown.indexOf('d:status'));
  });

  it('a number the engine did not give has no tile, and what was chosen for it is kept for when it comes', () => {
    const available = ALL_TILES.filter((id) => id !== 'n:quickWins');
    const prefs = withTile(defaultTilePrefs(), 'n:quickWins', false);
    expect(shownTiles(defaultTilePrefs(), available)).not.toContain('n:quickWins');
    // The choice ticks everything there is now: the hidden tile that is not there stays hidden.
    const all = withShown(prefs, available, available);
    expect(tileShown(all, 'n:quickWins')).toBe(false);
    expect(shownTiles(all, available)).toEqual(available);
  });

  it('the choice sets what is ticked, and an empty choice is the tiles as they came', () => {
    const picked: TileId[] = ['n:open', 'd:tag'];
    const prefs = withShown(defaultTilePrefs(), ALL_TILES, picked);
    expect(shownTiles(prefs)).toEqual(picked);
    expect(isDefaultTiles(withShown(prefs, ALL_TILES, []))).toBe(true);
    expect(isDefaultTiles(withShown(prefs, ALL_TILES, DEFAULT_TILES))).toBe(true);
  });

  it('the stored choice is read back: only tiles that exist, and only what differs from how they come', () => {
    const prefs = withTile(withTile(defaultTilePrefs(), 'n:ready', false), 'd:tag', true);
    expect(parseTilePrefs(JSON.stringify(prefs))).toEqual(prefs);
    expect(parseTilePrefs('{"on":["d:colour","d:tag","d:tag","n:open"],"off":["d:tag","n:ready",7]}')).toEqual({ on: ['d:tag'], off: ['n:ready'] });
    for (const bad of [null, '', 'not json', '[1]', '{"on":"d:tag"}', 'null']) expect(isDefaultTiles(parseTilePrefs(bad)), String(bad)).toBe(true);
  });
});

describe('the tiles in the app', () => {
  it('are remembered on the device and read back at the next start', () => {
    const m = make();
    expect(isDefaultTiles(m.app.statsTiles)).toBe(true);
    m.app.setStatsTiles(withTile(m.app.statsTiles, 'n:blocked', false));
    expect(JSON.parse(m.prefs.get('tasks-desktop.stats-tiles') ?? '{}')).toEqual({ on: [], off: ['n:blocked'] });
    const next = make({ prefs: m.prefs });
    expect(shownTiles(next.app.statsTiles)).not.toContain('n:blocked');
    next.app.stop();
    m.app.stop();
  });

  it('are part of the layout of the statistics: a changed choice shows there and its reset brings the tiles back', () => {
    const m = make();
    expect(m.app.layoutChanged('stats')).toBe(false);
    m.app.setStatsTiles(withTile(m.app.statsTiles, 'd:tag', true));
    expect(m.app.layoutChanged('stats')).toBe(true);
    m.app.resetLayout('stats');
    expect(m.app.layoutChanged('stats')).toBe(false);
    expect(isDefaultTiles(parseTilePrefs(m.prefs.get('tasks-desktop.stats-tiles') ?? null))).toBe(true);
    m.app.stop();
  });
});

describe('the words and the colours of a stack', () => {
  it('name a stack in the words of the page', () => {
    expect(bucketLabel('en', 'actor', 'cdx')).toBe('AI');
    expect(bucketLabel('en', 'actor', NONE)).toBe('Unassigned');
    expect(bucketLabel('de', 'status', 'doing')).not.toBe('doing');
    expect(bucketLabel('en', 'status', 'odd')).toBe('odd');
    expect(bucketLabel('en', 'prio', '2')).toBe('P2');
    expect(bucketLabel('en', 'effort', 'days')).toBe('in days');
    expect(bucketLabel('en', 'tag', OTHER)).toBe('further');
    expect(bucketLabel('en', 'tag', NONE)).toBe('(none)');
    expect(bucketLabel('en', 'tag', 'ui')).toBe('ui');
  });

  it('colour a known value by its name and a value the tasks name by its place, each named value its own colour', () => {
    expect(bucketClass(cutOf([], 'status'), 'doing')).toBe('v-doing');
    expect(bucketClass(cutOf([], 'status'), 'two words')).toBe('other');
    expect(bucketClass(cutOf([], 'status'), NONE)).toBe('none');
    const many = Array.from({ length: TOP + 3 }, (_, i) => task(`a/t${i}`, { tags: [`tag${String(i).padStart(2, '0')}`] }));
    const cut = cutOf(many, 'tag');
    const classes = (cut.named ?? []).map((value) => bucketClass(cut, value));
    expect(classes.length).toBe(TOP);
    expect(new Set(classes).size).toBe(TOP);
    expect(TOP).toBeLessThanOrEqual(SERIES);
    expect(bucketClass(cut, OTHER)).toBe('other');
    expect(bucketName(NONE)).toBe('none');
    expect(bucketName(OTHER)).toBe('other');
    expect(bucketName('ui')).toBe('ui');
  });

  it('say for a list field that a task counts in each value, and for a field with many how many are named', () => {
    expect(dimHint('en', 'status')).toBe('Cuts the open tasks of every area up by Status: one stack per value.');
    expect(dimHint('en', 'tag')).toContain('counts in each of them');
    expect(dimHint('en', 'tag')).toContain(`The ${TOP} most frequent`);
    expect(dimHint('en', 'plan')).not.toContain('counts in each of them');
    expect(dimHint('de', 'plan')).toContain(`Die ${TOP} häufigsten`);
  });
});
