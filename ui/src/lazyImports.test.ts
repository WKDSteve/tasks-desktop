// The views and dialogs most sessions never open load on demand: a static import of one of them puts it back into the
// main chunk, which has a budget (tools/check-bundle-size.py). The budget catches it after a build; this names it.
import { describe, expect, it } from 'vitest';
import app from './App.svelte?raw';

const ON_DEMAND = [
  'AboutDialog',
  'DefaultsDialog',
  'InstallDialog',
  'ShortcutDialog',
  'UpdateDialog',
  'VaultsDialog',
  'PlanView',
  'PlanWizard',
  'Matrix',
  'AbnahmeView',
  'CrossView',
  'CalendarView',
  'StatsView',
  'FinishedView',
  'ReposView',
];

describe('the main chunk', () => {
  it.each(ON_DEMAND)('does not import %s statically', (name) => {
    expect(app).not.toMatch(new RegExp(`import\\s+${name}\\s+from\\s+'\\./views/${name}\\.svelte'`));
    expect(app).toContain(`import('./views/${name}.svelte')`);
  });
});
