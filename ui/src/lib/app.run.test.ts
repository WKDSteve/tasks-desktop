// The poll of a followed run (the check of all vaults, a test sheet) asks once a second while the tab is shown, asks
// nothing while it is hidden, and looks once the moment the tab is shown again.
import { describe, expect, it } from 'vitest';
import { make } from './appDouble';

describe('following a run in a hidden tab', () => {
  it('asks nothing while hidden and looks at once when the tab is shown', async () => {
    let visible = false;
    const longSleeps: (() => void)[] = [];
    const m = make({
      token: 't',
      visible: () => visible,
      // The one-second beat passes at once; the long wait of a hidden tab is held until a test lets it go.
      sleep: (ms) => (ms <= 1000 ? Promise.resolve() : new Promise<void>((resolve) => longSleeps.push(resolve))),
    });
    let looks = 0;
    const hub = m.hub as unknown as Record<string, unknown>;
    hub['startCheckAll'] = async () => ({ state: 'running' });
    hub['checkAll'] = async () => {
      looks += 1;
      return { state: 'done' };
    };
    const run = m.app.runCheckAll();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(looks).toBe(0);
    expect(longSleeps.length).toBeGreaterThan(0);

    visible = true;
    m.app.tabShown();
    await run;
    expect(looks).toBe(1);
    m.app.stop();
  });

  it('asks every beat while the tab is shown', async () => {
    const m = make({ token: 't', visible: () => true, sleep: () => Promise.resolve() });
    let looks = 0;
    const hub = m.hub as unknown as Record<string, unknown>;
    hub['startCheckAll'] = async () => ({ state: 'running' });
    hub['checkAll'] = async () => {
      looks += 1;
      return { state: looks < 3 ? 'running' : 'done' };
    };
    await m.app.runCheckAll();
    expect(looks).toBe(3);
    m.app.stop();
  });
});
