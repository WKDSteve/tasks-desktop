// The bar of actions at the end of a row, rendered on the server side of Svelte: which controls a row offers and
// whether the bar is drawn without the pointer. That only the row under the pointer or with the focus shows it is the
// browser's (CSS; e2e).
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { make } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import { ROW_ACTIONS, type RowActionPrefs } from '../lib/rowActions';
import RowActions from './RowActions.svelte';

function html(
  prefs: RowActionPrefs,
  o: { selected?: boolean; status?: string; locked?: boolean; caps?: readonly string[]; machine?: boolean } = {},
): string {
  const caps = o.caps ?? ['move_area', 'ops'];
  const { app: real } = make({ token: 't' });
  const app = {
    lang: 'en',
    rowActions: prefs,
    ranges: real.ranges,
    locked: o.locked ?? false,
    machineActions: o.machine ?? true,
    can: (c: string) => caps.includes(c),
  };
  real.stop();
  return render(RowActions, {
    props: { app, task: task('pub/a', { status: (o.status ?? 'open') as never, prio: 2 }), selected: o.selected ?? false } as never,
  }).body.replace(/<!--.*?-->/g, '');
}
const actions = (out: string): string[] => [...out.matchAll(/data-row-action="([a-z]+)"/g)].map((m) => m[1] ?? '');

describe('the actions at the end of a row', () => {
  it('as the page comes: the one button that moves the task, named for a screen reader, hidden until its row is meant', () => {
    const out = html({ shown: ['move'], always: false });
    expect(actions(out)).toEqual(['move']);
    expect(out).toContain('aria-label="Move pub/a to another area"');
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Actions for pub/a"');
    expect(out).not.toMatch(/class="row-actions[^"]* shown/);
  });

  it('is drawn on the selected row, and on every row when that is switched on', () => {
    expect(html({ shown: ['move'], always: false }, { selected: true })).toMatch(/class="row-actions[^"]* shown/);
    expect(html({ shown: ['move'], always: true })).toMatch(/class="row-actions[^"]* shown/);
  });

  it('offers every chosen action in the order of the bar, each field with its hint', () => {
    const out = html({ shown: ROW_ACTIONS, always: false });
    expect(actions(out)).toEqual([...ROW_ACTIONS]);
    expect(out).toContain('data-hint="The status of this task. A choice is written at once."');
    expect(out).toContain('Status of pub/a');
    expect(out).toContain('Priority of pub/a');
    expect(out).toContain('aria-label="Finish pub/a"');
    expect(out).toContain('aria-label="Copy the id pub/a"');
    expect(out).toContain('aria-label="Open pub/a in Neovim"');
  });

  it('draws nothing where nothing is chosen or nothing can be done, and holds back what writes while the page is locked', () => {
    expect(html({ shown: [], always: true })).toBe('');
    expect(html({ shown: ['move', 'editor'], always: false }, { caps: [], machine: false })).toBe('');
    const locked = html({ shown: ['move', 'copy'], always: false }, { locked: true });
    expect(locked).toMatch(/data-row-action="move"[^>]*disabled/);
    expect(locked).not.toMatch(/data-row-action="copy"[^>]*disabled/);
  });
});
