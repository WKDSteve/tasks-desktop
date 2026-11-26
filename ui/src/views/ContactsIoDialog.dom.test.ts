// @vitest-environment jsdom
// The dialog of the import and export of contacts in a DOM: a picked file is first a trial run (nothing written), its
// report names duplicates by the id of the holder and never an address or a number, the import goes out only after the
// person confirms; a file too large is refused before the engine is asked; the export asks for the options of its format
// and hands the text to the browser as a file. The engine's reading is the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { MAX_IMPORT_BYTES } from '../lib/contactsIo';
import type { Result } from '../lib/contract';
import ContactsIoDialog from './ContactsIoDialog.svelte';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

type Made = ReturnType<typeof make>;

const MAIL = 'neu.secret@example.org';
const CARD = `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Neu Person\r\nEMAIL:${MAIL}\r\nTEL:+43 660 1234567\r\nEND:VCARD\r\n`;
const ALL_CAPS = ['contacts', 'contact', 'contacts_import', 'contacts_export'];

function report(dry: boolean): Result {
  return {
    kind: 'tasks.result',
    ok: true,
    dry_run: dry,
    results: [
      {
        n: 1,
        op: 'contacts_import',
        ok: true,
        outcome: dry ? 'would_create' : 'created',
        changed_ids: dry ? [] : ['pub/neu-person'],
        report: {
          created: [{ index: 1, id: 'pub/neu-person', name: 'Neu Person' }],
          duplicates: [{ index: 2, name: 'Rick Zwei', of: 'pub/rick' }],
          refused: [{ index: 3, reason: 'no name' }],
          problems: [{ index: 1, name: 'Neu Person', text: 'an email address is invalid and was not imported' }],
          messages: ['delimiter: ;'],
        },
      },
    ],
  } as unknown as Result;
}

let mounted: ReturnType<typeof mount>[] = [];

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

async function boot(caps: string[] = ALL_CAPS): Promise<Made> {
  const m = make({ token: 't', now: new Date('2026-11-26T10:00:00').getTime() });
  m.hub.capabilities = caps;
  m.hub.doc = snapshot([]);
  await m.app.start(null);
  return m;
}

async function show(m: Made, kind: 'import' | 'export'): Promise<HTMLElement> {
  m.app.openContactsIo(kind);
  const root = document.createElement('div');
  document.body.append(root);
  mounted.push(mount(ContactsIoDialog, { target: root, props: { app: m.app } }));
  await settle();
  return root;
}

function pick(root: HTMLElement, name: string, text: string, size?: number): void {
  const input = root.querySelector<HTMLInputElement>('[data-io-file]')!;
  const bytes = new TextEncoder().encode(text);
  const file = { name, size: size ?? bytes.length, arrayBuffer: async () => bytes.buffer as ArrayBuffer };
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  for (const x of mounted) void unmount(x);
  mounted = [];
  document.body.innerHTML = '';
});

describe('the import of contacts', () => {
  it('is offered only where the engine has it, and not on a read-only hub', async () => {
    const without = await boot(['contacts', 'contact']);
    expect(without.app.canImportContacts).toBe(false);
    expect(without.app.canExportContacts).toBe(false);
    without.app.openContactsIo('import');
    expect(without.app.contactsIo).toBeNull();
    const m = await boot();
    expect(m.app.canImportContacts).toBe(true);
    expect(m.app.canExportContacts).toBe(true);
  });

  it('shows a trial run first, names duplicates by the holder, never an address, and imports only on confirm', async () => {
    const m = await boot();
    m.hub.ops_queue = [report(true), report(false)];
    const root = await show(m, 'import');
    expect(root.querySelector('[data-contacts-import]')).not.toBeNull();
    pick(root, 'people.vcf', CARD);
    await settle();

    // the trial run: a dry run of the text, nothing else sent
    expect(m.hub.sent).toHaveLength(1);
    const dry = m.hub.sent[0]!;
    expect(dry.dry_run).toBe(true);
    expect(dry.ops[0]).toMatchObject({ op: 'contacts_import', as: 'vcf', text: CARD, area: expect.any(String) });
    const summary = root.querySelector('[data-io-summary]')!.textContent!;
    expect(summary).toMatch(/1/);
    expect(root.querySelector('[data-io-duplicates]')!.textContent).toContain('pub/rick');
    expect(root.querySelector('[data-io-refused-list]')!.textContent).toContain('no name');
    expect(root.querySelector('[data-io-messages]')!.textContent).toContain('delimiter');
    const said = root.textContent!;
    expect(said).not.toContain(MAIL);
    expect(said).not.toContain('660 1234567');

    // confirmed: the same text for real
    const run = root.querySelector<HTMLButtonElement>('[data-io-run]')!;
    expect(run.disabled).toBe(false);
    run.click();
    await settle();
    expect(m.hub.sent).toHaveLength(2);
    expect(m.hub.sent[1]!.dry_run).toBeFalsy();
    expect(m.hub.sent[1]!.ops[0]).toMatchObject({ op: 'contacts_import', text: CARD });
    expect(root.querySelector('[data-io-run]')).toBeNull();
    expect(root.querySelector('[data-io-summary]')!.textContent).not.toBe(summary);
    expect(m.app.toast?.text ?? '').not.toContain(MAIL);
  });

  it('offers no import when the trial run would make nothing', async () => {
    const m = await boot();
    const none = report(true);
    const entry = none.results[0] as unknown as { report: { created: unknown[] } };
    entry.report.created = [];
    m.hub.ops_queue = [none];
    const root = await show(m, 'import');
    pick(root, 'people.vcf', CARD);
    await settle();
    expect(root.querySelector<HTMLButtonElement>('[data-io-run]')!.disabled).toBe(true);
    expect(m.hub.sent).toHaveLength(1);
  });

  it('refuses a file too large or of another kind before the engine is asked', async () => {
    const m = await boot();
    const root = await show(m, 'import');
    pick(root, 'big.csv', 'name\nA\n', MAX_IMPORT_BYTES + 1);
    await settle();
    expect(root.querySelector('[data-io-status]')!.textContent).toMatch(/240/);
    pick(root, 'notes.txt', 'x');
    await settle();
    expect(root.querySelector('[data-io-status]')!.textContent).toMatch(/\.vcf/);
    expect(m.hub.sent).toHaveLength(0);
  });

  it('asks again with the delimiter of a CSV the person chose', async () => {
    const m = await boot();
    m.hub.ops_queue = [report(true), report(true)];
    const root = await show(m, 'import');
    pick(root, 'people.csv', 'name;org\nA;B\n');
    await settle();
    const select = root.querySelector<HTMLSelectElement>('[data-io-delimiter]')!;
    select.value = 'semicolon';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.hub.sent).toHaveLength(2);
    expect(m.hub.sent[0]!.ops[0]).not.toHaveProperty('delimiter');
    expect(m.hub.sent[1]!.ops[0]).toMatchObject({ delimiter: ';' });
    expect(m.hub.sent[1]!.dry_run).toBe(true);
  });
});

describe('the export of contacts', () => {
  it('asks for the options of the format and hands the text to the browser as a file', async () => {
    const m = await boot();
    m.hub.exportAnswer = { text: 'name;org\r\n', count: 3 };
    const root = await show(m, 'export');
    root.querySelector<HTMLInputElement>('[data-io-format="csv"]')!.click();
    await settle();
    expect(root.querySelector('[data-io-raw]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-io-save]')!.click();
    await settle();
    expect(m.hub.exportQueries).toEqual([{ format: 'csv', delimiter: 'semicolon', bom: 1 }]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-io-exported]')!.textContent).toMatch(/3/);
  });

  it('saves nothing when no contact fits', async () => {
    const m = await boot();
    m.hub.exportAnswer = { text: '', count: 0 };
    const root = await show(m, 'export');
    root.querySelector<HTMLButtonElement>('[data-io-save]')!.click();
    await settle();
    expect(m.hub.exportQueries).toEqual([{ format: 'vcf', version: '4' }]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(root.querySelector('[data-io-exported]')).not.toBeNull();
  });
});
