import { describe, expect, it } from 'vitest';
import { task } from './fixtures';
import { vaultMenuItems, type VaultMenuApp } from './vaultMenu';

const shown: string[] = [];
const app = (machineActions: boolean, canChooseFolder = false): VaultMenuApp =>
  ({
    lang: 'en',
    phase: 'ready',
    snapshot: { vault: { id: 'main' } },
    tasks: [task('pub/a'), task('pub/b'), task('other/c')],
    vaultList: { active: 'main', vaults: [{ name: 'main', label: 'Work' }, { name: 'side', label: 'Home' }] },
    vaultBusy: false,
    machineActions,
    selectVault: async (name: string) => void shown.push(`select ${name}`),
    revealVault: async () => void shown.push('reveal'),
    openVaults: () => void shown.push('manage'),
    canChooseFolder,
    chooseFolder: () => void shown.push('choose folder'),
  }) as unknown as VaultMenuApp;
const labels = (a: VaultMenuApp) => vaultMenuItems(a).map((i) => ('label' in i ? i.label : i.kind));

describe('the vault part of the menu', () => {
  it('names the vault, its size and the others, and offers to show its folder and to manage them', () => {
    expect(labels(app(true))).toEqual([
      'Vault',
      'Vault: main',
      '2 areas, 3 tasks',
      'Work (main)',
      'side (Home)',
      'Show vault folder',
      'Manage vaults ...',
    ]);
    const reveal = vaultMenuItems(app(true)).find((i) => 'label' in i && i.label === 'Show vault folder');
    if (reveal?.kind === 'action') reveal.onselect();
    expect(shown).toContain('reveal');
  });

  it('does not offer to show the folder in the file explorer where the page cannot start anything (the web variant)', () => {
    const out = labels(app(false));
    expect(out).not.toContain('Show vault folder');
    expect(out).toContain('Manage vaults ...');
  });

  it('goes back to the choice of a folder where there is no hub that manages vaults (the web variant)', () => {
    // The web variant has no list of vaults: the entry is not a dead "Manage vaults", it opens another folder.
    const web = { ...app(false, true), vaultList: null } as unknown as VaultMenuApp;
    const out = labels(web);
    expect(out).not.toContain('Manage vaults ...');
    expect(out).toContain('Open another vault ...');
    const other = vaultMenuItems(web).find((i) => 'label' in i && i.label === 'Open another vault ...');
    expect(other?.kind === 'action' && other.disabled).toBe(false);
    if (other?.kind === 'action') other.onselect();
    expect(shown).toContain('choose folder');
    expect(shown).not.toContain('manage');
  });
});
