// The app with everything around it replaced, for the tests: a hub that answers from memory (`FakeHub`), storages
// that are maps, a clock that stands still. `make` builds an `App` on them; the tests of the state (app.test.ts) and
// the tests that mount a component in a DOM (`*.dom.test.ts`) share it, so both test the app as it is, not a copy.
import { ApiError, type Hub, type HubArea, type OpsRequest, type VaultList } from './api';
import { App, type Env } from './app.svelte';
import type { CachedList, ListStore } from './cache';
import type { DonePreview, Groupings, Result, Snapshot, TaskDocument, TaskEntry, View, Views } from './contract';
import { task } from './fixtures';
import type { PrintSheet } from './export';

export function snapshot(tasks: TaskEntry[], rev = 'rev:1'): Snapshot {
  return {
    kind: 'tasks.snapshot',
    vault: { id: 'v' },
    rev,
    digest: rev,
    tasks,
    counts: { listed: tasks.length, unlisted: 0, by_status: {} },
  } as unknown as Snapshot;
}

export class FakeHub {
  autostartOn: boolean | null = false;
  autostart = async (): Promise<boolean | null> => this.autostartOn;
  setAutostart = async (on: boolean): Promise<boolean | null> => {
    if (this.autostartRefused) throw new Error('no');
    this.autostartOn = on;
    return on;
  };
  autostartRefused = false;
  token: string | null = null;
  onUnauthorized: () => void = () => {};
  doc: Snapshot = snapshot([task('pub/a', { etag: 'e1' })]);
  areaList: HubArea[] = [{ name: 'pub', data_class: 'public' }];
  snapshotCalls: (string | null)[] = [];
  engineReady = true;
  capabilities: string[] | null = ['reorder', 'plan_new', 'eff_prio', 'estimate', 'plan_for', 'check'];
  hubDown = false;
  exchanged: string[] = [];
  exchangeFails = false;
  /** The next n trades are turned away for too many attempts (a 429), the ones after are not. */
  limitNext = 0;
  /** The next n trades are refused (a 401), the ones after are not. */
  failNext = 0;
  /** A trade that fails the way a dead network does, with no answer from the hub. */
  exchangeNetworkFail = false;
  /** A trade waits for this before it answers. */
  exchangeGate: Promise<void> | null = null;
  rescans = 0;
  areasCalls = 0;
  nextCalls = 0;
  /** The lists of the engine, as `lists` answers them (null: the hub has none). */
  engineListDoc: unknown = null;
  listsCalls = 0;
  /** The answers of `order` by word (a word without one is refused as the engine would). */
  orders = new Map<string, string[]>();
  orderCalls: string[] = [];

  setToken(t: string | null) {
    this.token = t;
  }
  get hasToken() {
    return this.token !== null;
  }
  get bearer() {
    return this.token ?? '';
  }
  url(p: string) {
    return p;
  }
  async hello() {
    if (this.hubDown) throw new Error('down');
    return { instance: 'i', version: '0', engine: { ready: this.engineReady, problem: 'x', capabilities: this.capabilities } };
  }
  /** Each answer of `about` waits for the next of these gates first (none: it answers at once). */
  aboutGates: Promise<void>[] = [];
  aboutCalls = 0;
  async about() {
    this.aboutCalls += 1;
    const gate = this.aboutGates.shift();
    if (gate) await gate;
    if (this.hubDown) throw new Error('down');
    return {
      app: 'tasks-desktop',
      version: '0',
      build: null,
      os: 'test',
      arch: 'x',
      mode: null,
      engine: this.engineReady ? { version: '0', git: 'abc1234', nvim: '0' } : null,
      engineProblem: null,
      pinned: { engine: 'abc1234abc1234abc1234abc1234abc1234abc12', lib: null },
    };
  }
  async exchange(code: string) {
    this.exchanged.push(code);
    if (this.exchangeGate) await this.exchangeGate;
    if (this.exchangeNetworkFail) throw new TypeError('network');
    if (this.limitNext > 0) {
      this.limitNext -= 1;
      throw new ApiError(429, 'too_many_attempts', 'x');
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new ApiError(401, 'bad_code', 'x');
    }
    if (this.exchangeFails) throw new ApiError(401, 'bad_code', 'x');
    return 'token-1';
  }
  /** What the check job answers, one answer for each start and each ask of the state, in the order given. */
  checkAnswers: unknown[] = [];
  checkStarts: { stale?: string }[] = [];
  checkStates = 0;
  checkError: ApiError | null = null;
  async checkState() {
    this.checkStates += 1;
    if (this.checkError) throw this.checkError;
    return (this.checkAnswers.shift() ?? { state: 'idle' }) as never;
  }
  async checkStart(request: { stale?: string }) {
    this.checkStarts.push(request);
    if (this.checkError) throw this.checkError;
    return (this.checkAnswers.shift() ?? { state: 'running', id: 1 }) as never;
  }
  graphs: { id: string; direction: string }[] = [];
  graphError: ApiError | null = null;
  /** Questions of the graph that wait for these promises, in the order asked. */
  graphHold: Promise<void>[] = [];
  async planFor(id: string, direction: 'needs' | 'unlocks') {
    this.graphs.push({ id, direction });
    const held = this.graphHold.shift();
    if (held) await held;
    if (this.graphError) throw this.graphError;
    return {
      kind: 'tasks.planfor',
      id,
      direction,
      total: 2,
      truncated: false,
      nodes: [
        { id, title: 'The task', status: 'open', distance: 0 },
        { id: direction === 'needs' ? 'pub/first' : 'pub/after', title: 'The other', status: 'open', distance: 1 },
      ],
      edges: [{ from: 'pub/first', to: id, kind: 'blocked_by' }],
      cycles: [],
      incomplete: [],
    } as never;
  }
  estimates: { ids?: string[]; assume?: { id: string; effort?: string; value?: number }[] }[] = [];
  /** What the next question of the matrix answers: a refusal to throw, or nothing (the default figures). */
  estimateError: ApiError | null = null;
  /** Questions that wait for these promises, one for each question, in the order asked. */
  estimateHold: Promise<void>[] = [];
  async estimate(request: { ids?: string[]; assume?: { id: string; effort?: string; value?: number }[] }) {
    this.estimates.push(request);
    const held = this.estimateHold.shift();
    if (held) await held;
    if (this.estimateError) throw this.estimateError;
    return {
      kind: 'tasks.estimate',
      tasks: request.ids?.length ?? 0,
      days: 4 + (request.assume?.length ?? 0),
      range: { low: 3, high: 6 },
      value: 7,
      n_with_effort: 1,
      n_with_value: 2,
      n_without_effort: 0,
      n_without_value: 0,
      quick_wins: [],
      unestimated: [],
      assumed: request.assume?.length ?? 0,
      incomplete: [],
    } as never;
  }
  /** While set, a read of the list does not answer (a slow engine, a busy machine). */
  holdSnapshot: Promise<void> | null = null;
  async snapshot(etag: string | null) {
    this.snapshotCalls.push(etag);
    if (this.holdSnapshot) await this.holdSnapshot;
    if (!this.token) throw new ApiError(401, 'unauthorized', 'x');
    if (etag !== null && etag === this.doc.digest) return { kind: 'not_modified' as const };
    return { kind: 'fresh' as const, doc: this.doc, etag: this.doc.digest ?? null };
  }
  /** While set, the links do not answer; `linksFail` makes them refuse (a busy engine). */
  linksHold: Promise<void> | null = null;
  linksFail = false;
  linksCalls = 0;
  async links() {
    this.linksCalls += 1;
    if (this.linksHold) await this.linksHold;
    if (this.linksFail) throw new ApiError(503, 'engine_busy', 'x');
    return {
      kind: 'tasks.links',
      rev: this.doc.rev,
      edge_count: 1,
      truncated: false,
      pairs: [],
      tasks: [{ id: 'pub/a', areas: ['lib', 'pub'] }],
    } as never;
  }
  async areas() {
    this.areasCalls += 1;
    return { areas: this.areaList, unclassified: [], private: [] };
  }
  /** The saved views the hub answers; `viewsHold` holds the answers back, one for each ask, in the order asked. */
  viewList: View[] = [];
  /** The rev the views answer (the `views_rev` of the snapshot, when a test names it). */
  viewsRev: string | null = null;
  viewsCalls = 0;
  viewsHold: Promise<void>[] = [];
  /** How many of the next reads of the views the engine refuses (busy). */
  viewsFail = 0;
  async views(): Promise<Views> {
    this.viewsCalls += 1;
    if (this.viewsFail > 0) {
      this.viewsFail -= 1;
      throw new ApiError(503, 'engine_busy', 'x');
    }
    const list = this.viewList;
    const held = this.viewsHold.shift();
    if (held) await held;
    return { kind: 'tasks.views', rev: this.viewsRev ?? `views:${list.length}`, views: list, problems: [] } as unknown as Views;
  }
  /** The groupings answer the rev of the list unless this names another (an answer of a state gone by). */
  groupingsRev: string | null = null;
  groupingsCalls = 0;
  groupingsHold: Promise<void>[] = [];
  async groupings(): Promise<Groupings> {
    this.groupingsCalls += 1;
    const rev = this.groupingsRev ?? this.doc.rev;
    const held = this.groupingsHold.shift();
    if (held) await held;
    return {
      kind: 'tasks.groupings',
      rev,
      fields: [
        { field: 'status', values: ['doing', 'open'], truncated: false, writable: true, value_type: 'string', mode: 'set' },
        { field: 'tags', values: ['ui'], truncated: false, writable: true, value_type: 'string', mode: 'tags', multi: true },
      ],
    } as unknown as Groupings;
  }
  enumsDoc: unknown = null;
  enumsCalls = 0;
  async enums() {
    this.enumsCalls += 1;
    if (this.enumsDoc === null) throw new ApiError(502, 'engine_failed', 'no ranges');
    return { enums: this.enumsDoc };
  }
  async lists() {
    this.listsCalls += 1;
    if (this.engineListDoc === null) throw new ApiError(404, 'not_found', 'no lists');
    return this.engineListDoc as never;
  }
  async order(sort: string) {
    this.orderCalls.push(sort);
    const ids = this.orders.get(sort);
    if (ids === undefined) throw new ApiError(400, 'invalid_argument', 'no such order');
    return { rev: this.doc.rev, ids };
  }
  waitsCalls = 0;
  waitsDoc: unknown = {
    kind: 'tasks.waits',
    parked: 3,
    without_reason: 1,
    invalid: 0,
    keys: [{ key: 'mac', count: 2, areas: ['other', 'pub'] }],
    incomplete: [],
  };
  async waits() {
    this.waitsCalls += 1;
    return this.waitsDoc as never;
  }
  async next() {
    this.nextCalls += 1;
    return { alternatives: [], cdx: [], incomplete: [] };
  }
  taskSignals: AbortSignal[] = [];
  async task(id: string, signal?: AbortSignal): Promise<TaskDocument> {
    if (signal) this.taskSignals.push(signal);
    return { task: this.doc.tasks.find((t) => t.id === id), body: 'body', steps: [] } as never;
  }
  searches: string[] = [];
  searchStatus: 'ready' | 'building' = 'ready';
  async search(query: string) {
    this.searches.push(query);
    return {
      status: this.searchStatus,
      indexed: 1,
      total: 1,
      hits: [{ id: 'pub/a', score: 1, snippet: { text: 'x needle y', marks: [[2, 8]] as [number, number][], more_before: false, more_after: false } }],
    };
  }
  async rescan() {
    this.rescans += 1;
  }
  vaultDoc: VaultList | null = {
    active: 'main',
    vaults: [
      { name: 'main', label: 'tasks-vault', main: true },
      { name: 'native', label: 'wkdbook-native', main: false },
    ],
  };
  vaultCalls: string[] = [];
  vaultError: ApiError | null = null;
  vaultsCalls = 0;
  /** The next asks for the list of vaults fail with this status (an error of the hub, not "there is none"). */
  vaultsFailWith: number | null = null;
  /** While set, the hub does not name its vault yet. */
  holdVaults: Promise<void> | null = null;
  async vaults(): Promise<VaultList> {
    this.vaultsCalls += 1;
    if (this.holdVaults) await this.holdVaults;
    if (this.vaultsFailWith !== null) throw new ApiError(this.vaultsFailWith, 'broken', 'the hub errs');
    if (!this.vaultDoc) throw new ApiError(404, 'vaults_unavailable', 'no list');
    return this.vaultDoc;
  }
  async addVault(name: string, path: string): Promise<void> {
    this.vaultCalls.push(`add ${name} ${path}`);
    if (this.vaultError) throw this.vaultError;
    if (this.vaultDoc) {
      this.vaultDoc = { ...this.vaultDoc, vaults: [...this.vaultDoc.vaults, { name, label: 'x', main: false }] };
    }
  }
  async removeVault(name: string): Promise<void> {
    this.vaultCalls.push(`remove ${name}`);
    if (this.vaultError) throw this.vaultError;
    if (this.vaultDoc) {
      this.vaultDoc = { ...this.vaultDoc, vaults: this.vaultDoc.vaults.filter((v) => v.name !== name) };
    }
  }
  async openInEditor(id: string): Promise<void> {
    this.vaultCalls.push(`open ${id}`);
    if (this.vaultError) throw this.vaultError;
  }
  async selectVault(name: string): Promise<void> {
    this.vaultCalls.push(`select ${name}`);
    if (this.vaultError) throw this.vaultError;
  }
  sent: OpsRequest[] = [];
  /** What the next write answers (an error to throw, or a result). */
  next_ops: Result | ApiError | null = null;
  /** What the writes after `next_ops` answer, one each. */
  ops_queue: (Result | ApiError)[] = [];
  previews = new Map<string, Partial<DonePreview>>();
  async ops(request: OpsRequest): Promise<Result> {
    this.sent.push(request);
    const answer = this.next_ops ?? this.ops_queue.shift() ?? null;
    this.next_ops = null;
    if (answer instanceof ApiError) throw answer;
    if (answer) return answer;
    return {
      kind: 'tasks.result',
      ok: true,
      dry_run: false,
      results: request.ops.map((op, i) => ({
        n: i + 1,
        op: op.op,
        id:
          op.op === 'new'
            ? 'pub/created'
            : op.op === 'plan_new' || op.op === 'project_new'
              ? `${op.area}/made-${op.op === 'plan_new' ? 'plan' : 'project'}`
              : op.op === 'view_save'
                ? (op.id ?? `${op.area}/made-view`)
                : op.id,
        ok: true,
        outcome:
          op.op === 'new' || op.op === 'plan_new' || op.op === 'project_new' || (op.op === 'view_save' && op.id === undefined)
            ? request.dry_run
              ? 'would_create'
              : 'created'
            : op.op === 'view_delete'
              ? 'deleted'
              : 'changed',
        changed_ids: [],
        ...(op.op === 'set'
          ? { inverse: { op: 'set', id: op.id, patch: { status: 'open' }, if_match: 'e2' } }
          : {}),
        // A view made is taken back by deleting it; a view changed or deleted by saving the old one (as the engine does).
        ...(op.op === 'view_save' && op.id === undefined
          ? { inverse: { op: 'view_delete', id: `${op.area}/made-view`, if_match: 'v-made' } }
          : {}),
        ...(op.op === 'view_save' && op.id !== undefined
          ? { inverse: { op: 'view_save', id: op.id, view: { title: 'Before', display: 'list', group_by: 'status' }, if_match: 'v-after' } }
          : {}),
        ...(op.op === 'view_delete'
          ? { inverse: { op: 'view_save', id: op.id, view: { title: 'Gone', display: 'columns', group_by: 'tags' } } }
          : {}),
      })),
    } as unknown as Result;
  }
  async donePreview(id: string): Promise<DonePreview> {
    return { kind: 'tasks.donepreview', id, to: 'DONE/x.md', confirm: 'tok', ...this.previews.get(id) } as DonePreview;
  }
}

export function make(
  overrides: {
    token?: string;
    cached?: CachedList | null;
    prefs?: Map<string, string>;
    now?: number;
    mode?: 'web';
    readOnly?: boolean;
    openWindow?: (route: string) => boolean;
    askSession?: (onLate: (token: string) => void) => Promise<string | null>;
    chooseFolder?: () => void;
    fetchFn?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const prefs = overrides.prefs ?? new Map<string, string>();
  const hub = new FakeHub();
  const saved: CachedList[] = [];
  let cleared = 0;
  let reloads = 0;
  const files: { name: string; text: string; type: string }[] = [];
  const copied: string[] = [];
  const printed: PrintSheet[] = [];
  const cache: ListStore = {
    load: async () => overrides.cached ?? null,
    save: async (l) => void saved.push(l),
    clear: async () => void (cleared += 1),
  };
  const session = new Map<string, string>();
  if (overrides.token) session.set('tasks-desktop.session', overrides.token);
  const env: Env = {
    hub: hub as unknown as Hub,
    cache,
    session: {
      getItem: (k) => session.get(k) ?? null,
      setItem: (k, v) => void session.set(k, v),
      removeItem: (k) => void session.delete(k),
    },
    prefs: {
      getItem: (k) => prefs.get(k) ?? null,
      setItem: (k, v) => void prefs.set(k, v),
    },
    preferredLanguages: ['de'],
    now: () => overrides.now ?? 1000,
    // The stream is not under test here: it is refused, and the loop stops
    // because the test stops the app.
    fetchFn: overrides.fetchFn ?? ((async () => new Response('', { status: 503 })) as typeof fetch),
    sleep:
      overrides.sleep ??
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
      }),
    reload: () => void (reloads += 1),
    ...(overrides.mode ? { mode: overrides.mode } : {}),
    ...(overrides.readOnly ? { readOnly: true } : {}),
    ...(overrides.openWindow ? { openWindow: overrides.openWindow } : {}),
    ...(overrides.askSession ? { askSession: overrides.askSession } : {}),
    ...(overrides.chooseFolder ? { chooseFolder: overrides.chooseFolder } : {}),
    out: {
      save: (name, text, type) => {
        files.push({ name, text, type });
        return true;
      },
      copy: async (text) => {
        copied.push(text);
        return true;
      },
      print: (sheet) => {
        printed.push(sheet);
        return true;
      },
    },
  };
  return { app: new App(env), hub, saved, session, prefs, files, copied, printed, cleared: () => cleared, reloads: () => reloads };
}
