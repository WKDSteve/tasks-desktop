// The first start in the page: what the hub misses (the vault, Neovim), the steps that fix it in the dialog of the system
// that the hub shows, and the installation it offers. The page names no path; the hub checks every choice. A step that
// leaves the engine ready (or names the next step) loads the page again: the hub reads what was chosen from then on.

import { ApiError, type SetupInfo, type SetupStep } from '../api';
import type { Key } from '../i18n';

/** What the first start needs of the page around it. */
export interface SetupHost {
  setup(): Promise<SetupInfo>;
  setupVault(area: string | null): Promise<SetupStep>;
  setupNvim(): Promise<SetupStep>;
  installProgram(autostart: boolean, shortcut: boolean): Promise<void>;
  declineInstall(): Promise<void>;
  /** Load the page again: the hub reads what the step left. */
  reload(): void;
}

/** The problems a step of the page fixes, by step. */
export const VAULT_PROBLEMS = ['no_vault', 'vault_not_a_directory'];
export const NVIM_PROBLEMS = ['nvim_not_found', 'nvim_too_old', 'nvim_probe_failed'];

/** Why a step did not work: the words of the page, and the hub's own (short, no path) beside them. */
export interface SetupRefusal {
  key: Key;
  detail: string | null;
}

export class SetupState {
  info = $state.raw<SetupInfo | null>(null);
  /** A step is on its way (a dialog may be open on the machine of the hub): no second one beside it. */
  busy = $state(false);
  refusal = $state.raw<SetupRefusal | null>(null);
  /** The installation was started: the hub stops, and the installed one opens the page anew. */
  installing = $state(false);
  /** The person closed a dialog without a choice: said once, quietly. */
  closed = $state(false);

  constructor(private readonly host: SetupHost) {}

  /** Read what the page shows. A hub that cannot say (an older one) leaves the card out. */
  async load(): Promise<void> {
    try {
      this.info = await this.host.setup();
    } catch {
      this.info = null;
    }
  }

  get vaultStep(): boolean {
    return VAULT_PROBLEMS.includes(this.info?.problem ?? '');
  }

  get nvimStep(): boolean {
    return NVIM_PROBLEMS.includes(this.info?.problem ?? '');
  }

  get installStep(): boolean {
    return !this.installing && (this.info?.install === 'install' || this.info?.install === 'replace');
  }

  private async step(run: () => Promise<SetupStep>, failed: Key): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refusal = null;
    this.closed = false;
    try {
      const done = await run();
      if (!done.chosen) {
        this.closed = true;
        return;
      }
      this.host.reload();
    } catch (error) {
      this.refusal = { key: failed, detail: error instanceof ApiError ? error.message : null };
    } finally {
      this.busy = false;
    }
  }

  /** The folder dialog for the vault; with `area` the chosen folder becomes a new vault with that area. */
  chooseVault(area: string | null): Promise<void> {
    return this.step(() => this.host.setupVault(area), 'setup.page.vault_failed');
  }

  chooseNvim(): Promise<void> {
    return this.step(() => this.host.setupNvim(), 'setup.page.nvim_failed');
  }

  async install(autostart: boolean, shortcut: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refusal = null;
    try {
      await this.host.installProgram(autostart, shortcut);
      this.installing = true;
    } catch (error) {
      this.refusal = {
        key: 'setup.page.install_failed',
        detail: error instanceof ApiError ? error.message : null,
      };
    } finally {
      this.busy = false;
    }
  }

  async decline(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.host.declineInstall();
      if (this.info) this.info = { ...this.info, install: 'declined' };
    } catch (error) {
      this.refusal = {
        key: 'setup.page.install_failed',
        detail: error instanceof ApiError ? error.message : null,
      };
    } finally {
      this.busy = false;
    }
  }
}
