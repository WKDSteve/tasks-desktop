// The app with everything around it replaced, for the tests: a hub that answers from memory (`FakeHub`), storages
// that are maps, a clock that stands still. `make` builds an `App` on them; the tests of the state (app.test.ts) and
// the tests that mount a component in a DOM (`*.dom.test.ts`) share it, so both test the app as it is, not a copy.

import type { IntentAnswer } from './intent';
import { ApiError, type AssetAnswer, type BoardRequest, type BoardSaved, type ChecklistQuery, type ContactsExportQuery, type DocmapPlaces, type FinishedQuery, type Hub, type HubArea, type OpsRequest, type SetupInfo, type SetupStep, type VaultList } from './api';
import { App, type Env } from './app.svelte';
import type { CachedList, ListStore } from './cache';
import type {
  ChecklistDocument,
  ChecklistEntry,
  Checklists,
  ContactDocument,
  ContactsExport,
  ContactEntry,
  Contacts, DonePreview, Groupings, MeetingDocument, MeetingEntry, MeetingParse, Meetings, Next, Result, Snapshot, TaskDocument, TaskEntry, View, Views } from './contract';
import { task } from './fixtures';
import type { PrintSheet } from './export';
import type { RemindersMail } from './reminders';
import { localToday } from './remind';
import type { RepoStatus } from './repoStatus';

/** The reads of the tab "Lernpläne" over all paths, by the name of their route. */
export type LearnReadName = 'learn_next' | 'learn_notes' | 'learn_evidence' | 'learn_history' | 'competences';

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
  /** The first start: what `setup` answers, what the steps leave, and what was asked. */
  setupInfo: SetupInfo = { problem: 'no_vault', install: 'install', pickProgram: true, program: 'nvim.exe' };
  setupNext: SetupStep = { chosen: true, problem: 'nvim_not_found' };
  setupRefusal: ApiError | null = null;
  setupCalls: string[] = [];
  setup = async (): Promise<SetupInfo> => {
    this.setupCalls.push('setup');
    return this.setupInfo;
  };
  setupVault = async (area: string | null): Promise<SetupStep> => {
    this.setupCalls.push(area === null ? 'vault' : `vault ${area}`);
    if (this.setupRefusal) throw this.setupRefusal;
    return this.setupNext;
  };
  setupExample = async (): Promise<SetupStep> => {
    this.setupCalls.push('example');
    if (this.setupRefusal) throw this.setupRefusal;
    return this.setupNext;
  };
  setupNvim = async (): Promise<SetupStep> => {
    this.setupCalls.push('nvim');
    if (this.setupRefusal) throw this.setupRefusal;
    return this.setupNext;
  };
  installProgram = async (autostart: boolean, shortcut: boolean): Promise<void> => {
    this.setupCalls.push(`install autostart=${autostart} shortcut=${shortcut}`);
    if (this.setupRefusal) throw this.setupRefusal;
  };
  declineInstall = async (): Promise<void> => {
    this.setupCalls.push('decline');
  };
  autostartOn: boolean | null = false;
  autostart = async (): Promise<boolean | null> => this.autostartOn;
  setAutostart = async (on: boolean): Promise<boolean | null> => {
    if (this.autostartRefused) throw new Error('no');
    this.autostartOn = on;
    return on;
  };
  autostartRefused = false;
  keepRunningOn: boolean | null = false;
  keepRunning = async (): Promise<boolean | null> => this.keepRunningOn;
  setKeepRunning = async (on: boolean): Promise<boolean | null> => {
    if (this.keepRunningRefused) throw new Error('no');
    this.keepRunningOn = on;
    return on;
  };
  keepRunningRefused = false;
  /** ai-desktop as the hub finds it; null: the hub cannot say (the web variant). */
  aiDesktopFound: { installed: boolean; running: boolean } | null = { installed: false, running: false };
  aiDesktop = async (): Promise<{ installed: boolean; running: boolean } | null> => this.aiDesktopFound;
  /** The tasks handed to an agent, and what the hub answers (a refusal is thrown). */
  agentCalls: { id: string; mode: string; kind: string }[] = [];
  agentAnswer: { job_id: string; status: string; private: boolean; note?: string; port: number } = {
    job_id: 'j1',
    status: 'prefilled',
    private: false,
    port: 47123,
  };
  agentRefusal: ApiError | null = null;
  handToAgent = async (id: string, mode: string, kind: string) => {
    this.agentCalls.push({ id, mode, kind });
    if (this.agentRefusal) throw this.agentRefusal;
    return this.agentAnswer;
  };
  /** A review or a prepared decision: what `agent_result` answers, one each (the last one again), and what was asked. */
  resultQueue: unknown[] = [];
  resultCalls: { job: string; id: string; kind: string }[] = [];
  agentResult = async (job: string, id: string, kind: string) => {
    this.resultCalls.push({ job, id, kind });
    const next = this.resultQueue.length > 1 ? this.resultQueue.shift() : this.resultQueue[0];
    if (next instanceof ApiError) throw next;
    return next ?? { status: 'running' };
  };
  confirmed: string[] = [];
  confirmDraft = async (job: string) => {
    this.confirmed.push(job);
  };
  /** "Paste an intent": the texts that were asked, and what the engine answers (an `ApiError`: its refusal). */
  intents: string[] = [];
  intentAnswer: IntentAnswer | ApiError = { action: 'tasks.new', outcome: 'would_create', area: 'pub', title: 'A finding' };
  intent = async (text: string): Promise<IntentAnswer> => {
    this.intents.push(text);
    if (this.intentAnswer instanceof ApiError) throw this.intentAnswer;
    return this.intentAnswer;
  };
  dropped: string[] = [];
  dropDraft = async (job: string) => {
    this.dropped.push(job);
  };
  /** "Suggest fields": the texts that were sent, and the status the job answers with (`running`: it never ends). */
  drafts: string[] = [];
  draftStatus = 'needs_confirmation';
  sendDraft = async (text: string) => {
    this.drafts.push(text);
    return { job_id: '0123456789abcdef', status: this.draftStatus, private: true };
  };
  draftJob = async (_job: string) => ({ status: 'running' });
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
  /** The instance `hello` names: another one is a hub that was started anew. */
  instance = 'i';
  helloCalls = 0;
  async hello() {
    this.helloCalls += 1;
    if (this.hubDown) throw new Error('down');
    return { instance: this.instance, version: '0', engine: { ready: this.engineReady, problem: 'x', capabilities: this.capabilities } };
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
  logoutCalls = 0;
  /** `logout` fails with this error when set (the hub is down). */
  logoutError: Error | null = null;
  async logout() {
    this.logoutCalls += 1;
    if (this.logoutError) throw this.logoutError;
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
  /** What `history` answers, and what it was asked. */
  historyDoc: unknown = {
    kind: 'tasks.history',
    since: '2026-01-01',
    until: '2026-01-03',
    resolution: 'day',
    first: '2026-01-02',
    last: '2026-01-03',
    points: [
      { day: '2026-01-01', recorded: false, done: 0, created: 1 },
      {
        day: '2026-01-02',
        recorded: true,
        done: 1,
        created: 0,
        open: 4,
        by_status: { open: 3, doing: 1, blocked: 0, decision: 0, parked: 0 },
        by_state: { ready: 2, decision: 0, waiting: 1, stuck: 0, freed: 0, parked: 1 },
        with_effort: 2,
        with_value: 3,
        effort_days: 2.5,
        value: 9,
      },
      {
        day: '2026-01-03',
        recorded: false,
        done: 0,
        created: 2,
        open: 4,
        by_status: { open: 3, doing: 1, blocked: 0, decision: 0, parked: 0 },
        by_state: { ready: 2, decision: 0, waiting: 1, stuck: 0, freed: 0, parked: 1 },
        with_effort: 2,
        with_value: 3,
        effort_days: 2.5,
        value: 9,
      },
    ],
    incomplete: [],
  };
  historyCalls: { area?: string; since?: string; until?: string; resolution?: string }[] = [];
  async history(query: { area?: string; since?: string; until?: string; resolution?: string }) {
    this.historyCalls.push(query);
    return this.historyDoc as never;
  }
  async waits() {
    this.waitsCalls += 1;
    return this.waitsDoc as never;
  }
  /**
   * The finished tasks (`tasks.finished`): a document, or one made from the question. Until a test sets one the call
   * fails, as it did while the double had no `finished` (the views that ask treat that as "cannot say").
   */
  finishedDoc: unknown | ((query: FinishedQuery) => unknown) = null;
  finishedQueries: FinishedQuery[] = [];
  async finished(query: FinishedQuery) {
    this.finishedQueries.push(query);
    if (this.finishedDoc === null) throw new TypeError('finished is not faked here');
    const doc = typeof this.finishedDoc === 'function' ? this.finishedDoc(query) : this.finishedDoc;
    return doc as never;
  }
  /** The learning paths (`tasks.paths`) and each path by id (`tasks.path`); a path not in here is `not_found`. */
  pathsDoc: unknown = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [], incomplete: [] };
  pathDocs = new Map<string, unknown>();
  pathCalls: string[] = [];
  /**
   * Each answer of `path` waits for the next of these gates first (none: it answers at once). The answer is the
   * document as it was when asked, as a hub answers: a gate held open lets a later question overtake an earlier one.
   */
  pathGates: Promise<void>[] = [];
  /** Each answer of `paths` waits for the next of these gates first, with the document as it was when asked. */
  pathsGates: Promise<void>[] = [];
  async paths(_signal?: AbortSignal, includeDone = false) {
    this.pathCalls.push(includeDone ? 'paths include_done' : 'paths');
    const doc = this.pathsDoc;
    const gate = this.pathsGates.shift();
    if (gate) await gate;
    return doc as never;
  }
  /** `paths` with `levels: true` (capability `paths_levels`): `pathsLevelsDoc`, else `pathsDoc`. */
  pathsLevelsDoc: unknown = null;
  async pathsWithLevels(_signal?: AbortSignal, includeDone = false) {
    this.pathCalls.push(includeDone ? 'paths include_done levels' : 'paths levels');
    return (this.pathsLevelsDoc ?? this.pathsDoc) as never;
  }
  /**
   * The reads of the tab "Lernpläne" over all paths: per read a document or one made from the question; until a test
   * sets one the call fails like an engine without the capability (`not_supported`). Each question is kept in order.
   */
  learnDocs: Partial<Record<LearnReadName, unknown>> = {};
  learnQueries: [LearnReadName, unknown][] = [];
  /**
   * Each answer of a read of the tab waits for the next of these gates first (none: it answers at once), with the
   * document as it was when asked.
   */
  learnGates: Promise<void>[] = [];
  private async learnRead(name: LearnReadName, query: unknown) {
    this.learnQueries.push([name, query]);
    const doc = this.learnDocs[name];
    const gate = this.learnGates.shift();
    if (gate) await gate;
    if (doc === undefined) throw new ApiError(400, 'not_supported', `${name} is not faked here`);
    return (typeof doc === 'function' ? (doc as (q: unknown) => unknown)(query) : doc) as never;
  }
  learnNext(query: unknown = {}) {
    return this.learnRead('learn_next', query);
  }
  learnNotes(query: unknown = {}) {
    return this.learnRead('learn_notes', query);
  }
  learnEvidence(query: unknown = {}) {
    return this.learnRead('learn_evidence', query);
  }
  learnHistory(query: unknown = {}) {
    return this.learnRead('learn_history', query);
  }
  competences(query: unknown = {}) {
    return this.learnRead('competences', query);
  }
  async path(id: string) {
    this.pathCalls.push(`path ${id}`);
    const doc = this.pathDocs.get(id);
    const gate = this.pathGates.shift();
    if (gate) await gate;
    if (doc === undefined) throw new ApiError(404, 'not_found', `no path ${id}`);
    return doc as never;
  }
  /** The categories each question of `next` left out, in order; and what it answers (none: no task). */
  nextAsked: string[][] = [];
  nextAnswer: ((notCategory: readonly string[]) => Partial<Next>) | null = null;
  async next(notCategory: readonly string[] = []) {
    this.nextCalls += 1;
    this.nextAsked.push([...notCategory]);
    return { alternatives: [], cdx: [], incomplete: [], ...this.nextAnswer?.(notCategory) } as Next;
  }
  taskSignals: AbortSignal[] = [];
  /** The body every task's document has. */
  taskBody = 'body';
  async task(id: string, signal?: AbortSignal): Promise<TaskDocument> {
    if (signal) this.taskSignals.push(signal);
    return { task: this.doc.tasks.find((t) => t.id === id), body: this.taskBody, steps: [] } as never;
  }
  /** The meetings the hub knows (`meetings`, `meeting`), what was asked of them, and the proposals of the quick line. */
  meetingItems: MeetingEntry[] = [];
  meetingBodies = new Map<string, Partial<MeetingDocument>>();
  meetingQueries: Record<string, unknown>[] = [];
  meetingReads: string[] = [];
  meetingParses: string[] = [];
  /** The proposal `meetingParse` answers (a refusal: the error it throws). */
  parseAnswer: Partial<MeetingParse> | ApiError | null = null;
  /** Holds the answer of `meetings` back until it is settled (a reading on its way). */
  holdMeetings: Promise<void> | null = null;
  /** Holds the answer of `meeting` (one meeting) back; and an error `meetings` throws instead of answering. */
  holdMeeting: Promise<void> | null = null;
  meetingsError: ApiError | null = null;
  /** Pages of this many meetings, as the engine pages them (`offset`, `next_offset`); null: one page holds all. */
  meetingPageSize: number | null = null;
  async meetings(query: { task?: string; area?: string; since?: string; until?: string; limit?: number; offset?: number }): Promise<Meetings> {
    this.meetingQueries.push({ ...query });
    if (this.holdMeetings) await this.holdMeetings;
    if (this.meetingsError) throw this.meetingsError;
    // as the engine: the meetings whose days touch the window (default: 30 days back, 90 ahead of 2026-11-19 here)
    const since = query.since ?? '2026-10-20';
    const until = query.until ?? '2027-02-17';
    const items = this.meetingItems.filter(
      (m) =>
        (query.task === undefined || m.tasks.includes(query.task)) &&
        (m.starts_at ?? '').slice(0, 10) <= until &&
        (m.ends_at ?? m.starts_at ?? '').slice(0, 10) >= since,
    );
    if (this.meetingPageSize !== null) {
      const offset = query.offset ?? 0;
      const size = this.meetingPageSize;
      const next = offset + size < items.length ? offset + size : undefined;
      const page = items.slice(offset, offset + size);
      return { kind: 'tasks.meetings', items: page, total: items.length, offset, limit: size, ...(next === undefined ? {} : { next_offset: next }), undated: 0, incomplete: [] } as unknown as Meetings;
    }
    return { kind: 'tasks.meetings', items, total: items.length, offset: 0, limit: 100, undated: 0, incomplete: [] } as unknown as Meetings;
  }
  /**
   * The images asked (`kind id file`, with ` if <tag>` when the page held one), and what `asset` answers for a file
   * (missing: null). The tag of an answer is the blob's size and type, and of `assetTags` where one is set; a read with
   * that tag answers 'same'.
   */
  assetReads: string[] = [];
  assetAnswers = new Map<string, Blob>();
  assetTags = new Map<string, string>();
  async asset(kind: string, id: string, file: string, held?: string): Promise<AssetAnswer> {
    this.assetReads.push(`${kind} ${id} ${file}${held ? ` if ${held}` : ''}`);
    const blob = this.assetAnswers.get(file);
    if (!blob) return null;
    const tag = this.assetTags.get(file) ?? `"${blob.size}-${blob.type}"`;
    return held === tag ? 'same' : { blob, tag };
  }
  /** The boards saved, and what `board` answers next (none: saved as asked; an error: thrown). */
  boards: BoardRequest[] = [];
  boardAnswers: (BoardSaved | Error)[] = [];
  async board(body: BoardRequest): Promise<{ results: BoardSaved[] }> {
    this.boards.push(body);
    const next = this.boardAnswers.shift();
    if (next instanceof Error) throw next;
    const saved: BoardSaved = {
      ok: true,
      asset: `assets/boards/${body.name}.ink.json`,
      preview: `assets/boards/${body.name}.svg`,
      etag: `sha256:${String(this.boards.length).padStart(16, '0')}`,
      created: body.if_match === undefined,
    };
    return { results: [next ?? saved] };
  }
  /** The ids whose picture was asked, and what `meetingThumb` answers (null: no picture). */
  thumbReads: string[] = [];
  thumbAnswer: Blob | null = null;
  async meetingThumb(id: string): Promise<Blob | null> {
    this.thumbReads.push(id);
    return this.thumbAnswer;
  }
  async meeting(id: string): Promise<MeetingDocument> {
    this.meetingReads.push(id);
    if (this.holdMeeting) await this.holdMeeting;
    const meeting = this.meetingItems.find((m) => m.id === id);
    if (!meeting) throw new ApiError(404, 'not_found', 'no such meeting');
    return {
      kind: 'tasks.meeting',
      meeting,
      body: '',
      body_truncated: false,
      agenda: [],
      participants: [],
      documents: [],
      followups: [],
      ...this.meetingBodies.get(id),
    } as unknown as MeetingDocument;
  }
  async meetingParse(text: string): Promise<MeetingParse> {
    this.meetingParses.push(text);
    if (this.parseAnswer instanceof ApiError) throw this.parseAnswer;
    return {
      kind: 'tasks.meetingparse',
      title: text,
      fields: { date: '2026-01-01' },
      all_day: true,
      assumed: ['date'],
      problems: [],
      ...this.parseAnswer,
    } as MeetingParse;
  }
  /**
   * The checklists the hub knows (`checklists`) and the entries of each (`checklist`, by list id), with every question
   * asked of `checklist`. The filter is the engine's: the double answers every entry of the list and the test reads the
   * question it was asked.
   */
  checklistLists: { id: string; title: string; created: string; total: number; open: number; etag: string }[] = [];
  checklistEntries = new Map<string, ChecklistEntry[]>();
  checklistQueries: ChecklistQuery[] = [];
  /** How many entries one answer of `checklist` holds (`next_offset` beyond); none: all of them. */
  checklistPageSize: number | null = null;
  /** Holds the answers of `checklist` back until it is settled (a read on its way). */
  holdChecklist: Promise<void> | null = null;
  /** The files sent through `upload` (a picture pasted, a file chosen), and the answer: the asset in the folder of its kind. */
  uploads: { id: string; name: string; kind?: string }[] = [];
  async upload(id: string, file: File, kind?: string): Promise<Result> {
    this.uploads.push({ id, name: file.name, ...(kind ? { kind } : {}) });
    const asset = `assets/${kind ? `${kind === 'image' ? 'images' : kind}/` : ''}${file.name}`;
    return {
      kind: 'tasks.result',
      ok: true,
      dry_run: false,
      results: [{ n: 1, op: 'attach', id, ok: true, outcome: 'changed', changed_ids: [id], asset, link: `![${file.name}](${asset})` }],
    } as unknown as Result;
  }
  async checklists(): Promise<Checklists> {
    return { kind: 'tasks.checklists', items: this.checklistLists } as unknown as Checklists;
  }
  async checklist(query: ChecklistQuery): Promise<ChecklistDocument> {
    this.checklistQueries.push({ ...query });
    if (this.holdChecklist) await this.holdChecklist;
    const list = this.checklistLists.find((l) => l.id === query.id);
    if (!list) throw new ApiError(404, 'not_found', 'no such list');
    const all = this.checklistEntries.get(query.id) ?? [];
    const offset = query.offset ?? 0;
    const size = this.checklistPageSize ?? 100;
    const items = all.slice(offset, offset + size);
    const next = offset + size < all.length ? offset + size : undefined;
    const counts = new Map<string, number>();
    for (const e of all) for (const tag of e.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return {
      kind: 'tasks.checklist',
      list: { id: list.id, title: list.title, created: list.created, etag: list.etag },
      state: query.state ?? 'all',
      total: all.length,
      matching: all.length,
      offset,
      limit: size,
      ...(next === undefined ? {} : { next_offset: next }),
      tags: [...counts].map(([tag, count]) => ({ tag, count })).toSorted((a, b) => (a.tag < b.tag ? -1 : 1)),
      items,
      incomplete: [],
    } as unknown as ChecklistDocument;
  }
  /** The contacts the hub knows (`contacts`, `contact`), what was asked of them, and the pages they come in. */
  contactItems: ContactEntry[] = [];
  contactReads: string[] = [];
  contactQueries: Record<string, unknown>[] = [];
  contactsError: ApiError | null = null;
  /** Holds the answer of `contacts` back until it is settled (a reading on its way). */
  holdContacts: Promise<void> | null = null;
  contactPageSize: number | null = null;
  async contacts(query: { area?: string; limit?: number; offset?: number } = {}): Promise<Contacts> {
    this.contactQueries.push({ ...query });
    if (this.holdContacts) await this.holdContacts;
    if (this.contactsError) throw this.contactsError;
    const items = this.contactItems.filter((c) => query.area === undefined || c.area === query.area);
    const size = this.contactPageSize ?? 100;
    const offset = query.offset ?? 0;
    const page = items.slice(offset, offset + size);
    const next = offset + size < items.length ? offset + size : undefined;
    return { kind: 'tasks.contacts', items: page, total: items.length, offset, limit: size, ...(next === undefined ? {} : { next_offset: next }), incomplete: [] } as unknown as Contacts;
  }
  async contact(id: string): Promise<ContactDocument> {
    this.contactReads.push(id);
    const contact = this.contactItems.find((c) => c.id === id);
    if (!contact) throw new ApiError(404, 'not_found', 'no such contact');
    return { kind: 'tasks.contact', contact, body: '', body_truncated: false, notes: '', ...this.contactBodies.get(id) } as unknown as ContactDocument;
  }
  contactBodies = new Map<string, Partial<ContactDocument>>();
  /** What `contacts_export` was asked and what it answers (the text of the file and how many contacts it holds). */
  exportQueries: ContactsExportQuery[] = [];
  exportAnswer: { text: string; count: number } = { text: 'BEGIN:VCARD\r\nEND:VCARD\r\n', count: 1 };
  async contactsExport(query: ContactsExportQuery): Promise<ContactsExport> {
    this.exportQueries.push({ ...query });
    return { kind: 'tasks.contacts_export', format: query.format, incomplete: [], ...this.exportAnswer } as unknown as ContactsExport;
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
  async openInEditor(id: string, kind?: 'competence'): Promise<void> {
    this.vaultCalls.push(kind ? `open ${kind} ${id}` : `open ${id}`);
    if (this.vaultError) throw this.vaultError;
  }
  /** What the hub says of the places of a task (none: it cannot say), and the places that were opened (`<id> <index>`). */
  docmapDoc: DocmapPlaces | null = null;
  docmapOpened: string[] = [];
  docmapAsked = 0;
  async docmapPlaces(): Promise<DocmapPlaces> {
    this.docmapAsked += 1;
    if (!this.docmapDoc) throw new Error('no hub');
    return this.docmapDoc;
  }
  async openInDocmap(id: string, index: number): Promise<void> {
    this.docmapOpened.push(`${id} ${index}`);
    if (this.vaultError) throw this.vaultError;
  }
  async selectVault(name: string): Promise<void> {
    this.vaultCalls.push(`select ${name}`);
    if (this.vaultError) throw this.vaultError;
  }
  /** The state of the repos: what was asked (`<id>` or `<id> fresh`), and what the hub answers for an id (none: it fails). */
  statusAsked: string[] = [];
  statuses: Record<string, RepoStatus> = {};
  async repoStatus(id: string, fresh: boolean): Promise<RepoStatus> {
    this.statusAsked.push(fresh ? `${id} fresh` : id);
    const status = this.statuses[id];
    if (!status) throw new ApiError(502, 'failed', 'no answer');
    return status;
  }
  /** The reminders by e-mail: what was asked, and what the hub answers (an error to throw, or the mail). */
  mailAsked: { to: string; ids: string[]; lang: string; send: boolean; digest?: string }[] = [];
  mailAnswer: RemindersMail | ApiError | null = null;
  /** Held until resolved: the answer of the hub that is on its way (a test lets the page go on meanwhile). */
  mailHold: Promise<void> | null = null;
  async remindersMail(body: { to: string; ids: string[]; lang: string; send: boolean; digest?: string }): Promise<RemindersMail> {
    this.mailAsked.push(body);
    const answer = this.mailAnswer;
    if (this.mailHold) await this.mailHold;
    if (answer instanceof ApiError) throw answer;
    if (answer) return answer;
    return {
      account: true,
      sent: body.send,
      to: body.to,
      subject: `Reminders: ${body.ids.length} tasks`,
      text: body.ids.join('\n'),
      included: body.ids,
      leftOut: [],
      digest: `digest of ${body.to} ${body.ids.join(' ')}`,
    };
  }
  sent: OpsRequest[] = [];
  /** What the next write answers (an error to throw, or a result). */
  next_ops: Result | ApiError | null = null;
  /** What the writes after `next_ops` answer, one each. */
  ops_queue: (Result | ApiError)[] = [];
  previews = new Map<string, Partial<DonePreview>>();
  /** Holds the answer of every write back until it is settled (a write that is on its way). */
  holdOps: Promise<void> | null = null;
  async ops(request: OpsRequest): Promise<Result> {
    this.sent.push(request);
    if (this.holdOps) await this.holdOps;
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
          op.op === 'meeting_new'
            ? `${op.area}/made-meeting`
            : op.op === 'contact_new'
              ? (op.id ?? `${op.area}/made-contact`)
            : op.op === 'checklist_new'
              ? (op.id ?? '_list-made')
            : op.op === 'entry_add'
              ? (op.id ?? `${op.list}/made-entry`)
            : op.op === 'entry_promote'
              ? `${op.area}/made-task`
            : op.op === 'new'
            ? 'pub/created'
            : op.op === 'plan_new' || op.op === 'project_new'
              ? `${op.area}/made-${op.op === 'plan_new' ? 'plan' : 'project'}`
              : op.op === 'view_save'
                ? (op.id ?? `${op.area}/made-view`)
                : 'id' in op
                  ? op.id
                  : undefined,
        ok: true,
        outcome:
          op.op === 'new' || op.op === 'plan_new' || op.op === 'project_new' || op.op === 'meeting_new' || op.op === 'contact_new' || (op.op === 'view_save' && op.id === undefined)
            ? request.dry_run
              ? 'would_create'
              : 'created'
            : op.op === 'view_delete' || op.op === 'contact_delete'
              ? 'deleted'
              : 'changed',
        changed_ids: [],
        ...(op.op === 'set'
          ? { inverse: { op: 'set', id: op.id, patch: { status: 'open' }, if_match: 'e2' } }
          : {}),
        // A contact, as the engine answers: made is taken back by deleting it, changed by the old values, deleted by making it again.
        ...(op.op === 'contact_new' ? { inverse: { op: 'contact_delete', id: op.id ?? `${op.area}/made-contact`, if_match: 'c-made' } } : {}),
        ...(op.op === 'contact_set' ? { inverse: { op: 'contact_set', id: op.id, patch: { role: 'Before' }, if_match: 'c-after' } } : {}),
        ...(op.op === 'contact_delete'
          ? { inverse: { op: 'contact_new', id: op.id, name: 'Gone Person', fields: { emails: ['gone@example.org'] }, body: '\n## Notes\nkept\n' } }
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
    askSession?: (onLate?: (token: string) => void) => Promise<string | null>;
    visible?: () => boolean;
    hasFocus?: () => boolean;
    chooseFolder?: () => void;
    folderVaults?: Env['folderVaults'];
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
    ...(overrides.visible ? { visible: overrides.visible } : {}),
    ...(overrides.hasFocus ? { hasFocus: overrides.hasFocus } : {}),
    ...(overrides.chooseFolder ? { chooseFolder: overrides.chooseFolder } : {}),
    ...(overrides.folderVaults ? { folderVaults: overrides.folderVaults } : {}),
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
  const app = new App(env);
  // A clock that stands still stands on its day too: `today` is read from the machine's clock at the start, and a test
  // that says when it is must not depend on the day it runs (it went red after midnight).
  if (overrides.now !== undefined) app.today = localToday(new Date(overrides.now));
  return { app, hub, saved, session, prefs, files, copied, printed, cleared: () => cleared, reloads: () => reloads };
}
