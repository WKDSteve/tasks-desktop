// The hub's routes, as typed calls. Only the shapes the UI needs.

import type {
  Areas,
  Check,
  Ci,
  DonePreview,
  Estimate,
  Finished,
  Groupings,
  History,
  Competences,
  LearnEvidence,
  LearnHistory,
  LearnNext,
  LearnNotes,
  LevelsSpec,
  Links,
  MeetingDocument,
  MeetingParse,
  Meetings,
  NamedLists,
  Next,
  Order,
  PathDocument,
  Paths,
  PlanCompare,
  PlanFor,
  Result,
  Snapshot,
  TaskDocument,
  Views,
  Waits,
} from './contract';
import type { ViewForm } from './views';
import { parseRepos, parseSuggestions, type HubRepos, type RepoGroup } from './repos';
import { parseIntentAnswer, type IntentAnswer } from './intent';
import { parseRemindersMail, type RemindersMail } from './reminders';
import { parseRepoStatus, type RepoStatus } from './repoStatus';
import type { About } from './about';
import { ApiError, failure, HubClient, textOf, type Hello, type SnapshotResult as KitSnapshotResult } from 'appkit-ui/client';

// The transport (the bearer token, the refusal, the pairing code, hello, the snapshot with its tag, rescan) is the
// kit's; this file is the routes of the tasks.
export { ApiError, type Hello };

/** What `finished` is asked for: the days, an area or a plan, a page, and the CI states (capability `finished_ci`). */
export interface FinishedQuery {
  area?: string;
  plan?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  /** The CI states of the commits to keep; `none` for a task without one. */
  ci?: readonly (Ci | 'none')[];
}

/** One operation of a write. The engine checks the rules; the form is the page's. */
export type Op =
  | { op: 'set'; id: string; patch: Record<string, unknown>; if_match?: string }
  | { op: 'new'; area: string; title: string; fields?: Record<string, unknown>; body?: string }
  | { op: 'reorder'; id: string; after?: string; before?: string; group?: string; if_match?: string }
  | { op: 'done'; id: string; confirm: string; remind?: string }
  | { op: 'reopen'; id: string; status?: string; if_match?: string }
  /** A step of a task, or an item of a meeting's agenda (`section` `followups`: of its follow-ups). */
  | { op: 'tick_step'; id: string; n: number; done?: boolean; section?: 'agenda' | 'followups'; if_match?: string }
  /** Tick option `option` of a question (by its key), or take the answer back with `clear`. */
  | { op: 'answer'; id: string; question: string; option?: number; clear?: boolean; if_match?: string }
  | { op: 'append_note'; id: string; text: string; if_match?: string }
  | { op: 'add_steps'; id: string; steps: string[]; if_match?: string }
  | { op: 'set_body'; id: string; body: string; if_match?: string }
  /** One `## ` section of a task, open or finished: replaced, or added at the end (a review, a prepared decision). */
  | { op: 'set_section'; id: string; heading: string; text: string; if_match?: string }
  | { op: 'move_area'; id: string; to_area: string; if_match?: string }
  /** A saved view: `area` alone makes a new one, `id` replaces that one (on the version read). */
  | { op: 'view_save'; id?: string; area?: string; view: ViewForm; if_match?: string }
  /** Only on the version read: the engine refuses a delete without it. */
  | { op: 'view_delete'; id: string; if_match: string }
  /** The image on the clipboard of the hub's machine, or its newest screenshot, becomes an asset of the task. */
  | { op: 'attach'; id: string; from: 'clipboard' | 'latest'; name?: string }
  | {
      op: 'plan_new';
      area: string;
      title: string;
      areas?: string[];
      target?: string;
      phases?: string[];
      gate?: string;
      status?: string;
      summary?: string;
      slug?: string;
      /** Web addresses (http/https, capability `plan_links`). */
      links?: string[];
      /** The project the plan belongs to, and its stage there (capability `projects`). */
      project?: string;
      phase?: string;
    }
  /** A project file under `ROADMAP/projects/` (capability `project_new`). */
  | {
      op: 'project_new';
      area: string;
      title: string;
      areas?: string[];
      target?: string;
      phases?: string[];
      gate?: string;
      status?: string;
      summary?: string;
      slug?: string;
      links?: string[];
    }
  /** The frontmatter of an open plan or project file; `null` removes a key (capabilities `plan_set`, `project_set`). */
  | { op: 'plan_set' | 'project_set'; id: string; patch: Record<string, unknown>; if_match?: string }
  /** Finish a plan or a project by hand (capabilities `plan_close`, `project_close`); refused while something holds it open. */
  | { op: 'plan_close' | 'project_close'; id: string }
  /**
   * One learning point of a path (`point`: its key or `#<index>`): its state with the reason, or its note (capability
   * `node_note`), on the version read. The engine judges both.
   */
  | {
      op: 'node_set';
      id: string;
      point: string;
      state?: 'open' | 'learned' | 'seen' | 'dropped' | 'blocked';
      reason?: string;
      note?: string;
      /** The point's own XP `{xp=N}` (capability `xp`); `xp_clear` removes them. */
      xp?: number;
      xp_clear?: true;
      /** Closing a point on or under `{safety}` (capability `path_marks`): the person confirmed it. */
      ack?: true;
      if_match?: string;
    }
  /** The reward of a level of a path (`level`: its number or `done`) granted or not (capability `path_reward`). */
  | { op: 'path_reward'; id: string; level: string; given: boolean; if_match?: string }
  /** The levels of a path written as a whole, its `## Level` section (capability `path_levels`); the engine judges them. */
  | { op: 'path_levels'; id: string; levels: LevelsSpec; if_match?: string }
  /** A learning point of a path (or of a task's `## Lernpunkte`) made a task of its own, and taken back. */
  | { op: 'promote'; container: string; point: string; if_match?: string }
  | { op: 'unpromote'; container: string; point: string; id?: string; if_match?: string }
  /** A meeting file `<area>/MEETINGS/<slug>.md` (capability `meeting_ops`); `fields` are its frontmatter keys. */
  | { op: 'meeting_new'; area: string; title: string; fields?: Record<string, unknown>; body?: string; slug?: string; lang?: 'de' | 'en' }
  /** The frontmatter of a meeting (`null` removes a key); `status` between `planned` and `cancelled`, `done` back. */
  | { op: 'meeting_set'; id: string; patch: Record<string, unknown>; if_match?: string }
  /** Mark a meeting done, with or without a result (`## Ergebnis`). */
  | { op: 'meeting_close'; id: string; result?: string; if_match?: string }
  /** Tick (or untick) a participant of `## Teilnehmer`: present. */
  | { op: 'meeting_attend'; id: string; n?: number; name?: string; present?: boolean; if_match?: string }
  /**
   * One line of the minutes (`## Protokoll`, with its time); a task, a decision or a question also into its section. An
   * append, never a rewrite of the body: sent without `if_match`, so two devices writing at once lose nothing.
   */
  | {
      op: 'meeting_capture';
      id: string;
      entry: { kind: 'text' | 'task' | 'decision' | 'question' | 'board' | 'photo' | 'audio'; text?: string; asset?: string; at?: string };
      if_match?: string;
    }
  /** Tasks made of the follow-ups: line `n`, else every line that names no task yet; each id is written behind its line. */
  | { op: 'meeting_followups'; id: string; n?: number; area?: string };

/** The vaults the hub can read, and the one it reads. A folder is shown by its last part only. */
export interface VaultList {
  active: string;
  vaults: { name: string; label: string; main: boolean }[];
}

export interface OpsRequest {
  client_op_id: string;
  dry_run?: boolean;
  ops: Op[];
}

/** One area as `GET /api/tasks/areas` tells it, with the class it is shown with. */
/** The check job of the hub: nothing yet, running, done with the engine's document, or failed in words. */
export type CheckJobState =
  | { state: 'idle' }
  | { state: 'running'; id: number }
  | { state: 'done'; id: number; result: Check }
  | { state: 'failed'; id: number; error: { code: string; message: string } };

/** ai-desktop on this machine, as the hub finds it (`GET /api/tasks/ai_desktop`). */
export interface AiDesktop {
  /** Installed on this machine (it may not be running). */
  installed: boolean;
  /** Its hub runs now. */
  running: boolean;
  /** Its loopback port while it runs: the dashboard of a job is `http://127.0.0.1:<port>/#job=<id>`. */
  port?: number | null;
}

/** One place in code a task names, as the hub reads it (`GET /api/tasks/docmap`): never a path of the machine. */
export interface DocmapPlace {
  /** `<file>:<lines>`, relative to the repo. */
  label: string;
  /** The folder name of the repo among the tiles of this device. */
  repo: string | null;
  /** The hub can open it: the repo is a tile and holds the file. */
  ok: boolean;
  why?: string;
}

/** The places of a task and whether docmap-desktop is on this machine. */
export interface DocmapPlaces {
  found: boolean;
  places: DocmapPlace[];
}

/** A task handed to an agent: the job ai-desktop made of it (`POST /api/tasks/agent`). */
export interface AgentJob {
  job_id: string;
  /** `prefilled`, `running` or `needs_confirmation` (a private area on a model that is not local). */
  status: string;
  private: boolean;
  note?: string;
  /** The loopback port of ai-desktop, for its dashboard at the job (`http://127.0.0.1:<port>/#job=<id>`). */
  port: number;
}

/** A browser tab opened at the click, before the answer: it goes to the dashboard of ai-desktop, or closes again. */
export interface AgentTab {
  go(url: string): void;
  close(): void;
}

export type { DraftChoices, DraftJob, DraftState } from './suggestFields';
import type { SplitJob, SplitState } from './split';
import type { DraftJob, DraftState } from './suggestFields';
import type { AnswerKind, AnswerState } from './agentAnswer';

/** What a job asks of the agent (`kind` of ai-desktop's `POST /jobs`). */
export type AgentKind = 'handoff' | 'review-done' | 'prepare-decision';

export interface HubArea {
  name: string;
  data_class: 'public' | 'internal' | 'private' | 'unclassified';
  open?: number;
}

export interface HubAreas {
  areas: HubArea[];
  unclassified: string[];
  private: string[];
}

/** A piece of a task's text around a match; `marks` are `[start, end)` in UTF-16 units of `text`. */
export interface SearchSnippet {
  text: string;
  marks: [number, number][];
  more_before: boolean;
  more_after: boolean;
}

export interface SearchHit {
  id: string;
  score: number;
  snippet: SearchSnippet;
}

export interface SearchResult {
  /** `building`: the hub has not read the texts yet; `failed`: it could not. */
  status: 'ready' | 'building' | 'failed';
  indexed: number;
  /** The texts did not all fit: some tasks are not searched. */
  partial?: boolean;
  total: number;
  hits: SearchHit[];
}

export type SnapshotResult = KitSnapshotResult<Snapshot>;

/** A board to save: its container, its name, the version it was drawn on, its file and its preview as text. */
export interface BoardRequest {
  id: string;
  name: string;
  if_match?: string;
  ink: string;
  svg: string;
}

/** What `board_save` answered (an entry of `tasks.result`); a conflict names a free name in `details.suggestion`. */
export interface BoardSaved {
  ok: boolean;
  asset?: string;
  preview?: string;
  etag?: string;
  created?: boolean;
  error?: { code: string; message?: string; details?: { suggestion?: string } };
}

/** The run of the test sheets of a task. Exit codes of `testing sheets run`: 0 green, 1 red, 2 refused, 3 not reached. */
export interface SheetRunState {
  state: 'idle' | 'running' | 'done' | 'failed';
  id?: string;
  code?: number | null;
  lines?: string[];
  message?: string;
}

/** The check over all vaults: one line for each vault. */
export interface CheckAll {
  state: 'idle' | 'running' | 'done';
  vaults: {
    name: string;
    state: 'waiting' | 'running' | 'done' | 'failed';
    ok?: boolean;
    errors?: number;
    warnings?: number;
    tasks?: number;
    total?: number;
    message?: string;
    findings?: { severity?: string; id?: string; file?: string; message?: string }[];
  }[];
}

/** What the page of the first start offers about the installation of the program. */
export type InstallOffer = 'install' | 'replace' | 'installed' | 'declined';
const INSTALL_OFFERS: InstallOffer[] = ['install', 'replace', 'installed', 'declined'];

/** The example of `setup` as the page shows it: plain names of areas and a count, or `null`. */
export function exampleOf(value: unknown): { areas: string[]; files: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const doc = value as Record<string, unknown>;
  const areas = Array.isArray(doc['areas']) ? doc['areas'].filter((a): a is string => typeof a === 'string' && a !== '' && a.length <= 128).slice(0, 20) : [];
  const files = doc['files'];
  if (areas.length === 0 || typeof files !== 'number' || !Number.isInteger(files) || files < 1) return null;
  return { areas, files };
}

/** What the page of the first start shows (`GET /api/tasks/setup`). */
export interface SetupInfo {
  /** The short code of what stops the engine; `null`: nothing. */
  problem: string | null;
  /** `null`: the hub cannot say. */
  install: InstallOffer | null;
  /** The hub can show a dialog for the program of Neovim. */
  pickProgram: boolean;
  /** The file name of that program on the machine of the hub (`nvim.exe`). */
  program: string;
  /**
   * What "Open the example vault" would copy (the example the engine brings): its areas and the number of its files.
   * `null` or missing: this hub has none to offer.
   */
  example?: { areas: string[]; files: number } | null;
}

/** A step of the first start: whether the person chose something, and what is missing now (`null`: nothing). */
export interface SetupStep {
  chosen: boolean;
  problem: string | null;
}

/** The kinds of container whose images the hub hands on (`GET /api/tasks/asset`). */
/**
 * What a read of an asset gave: the picture with the tag of its bytes (null when the hub names none), `'same'` when it
 * is unchanged since the tag the page held, null when there is none to draw.
 */
export type AssetAnswer = { blob: Blob; tag: string | null } | 'same' | null;

export type AssetOwner = 'task' | 'plan' | 'project' | 'path' | 'meeting';

export class Hub extends HubClient<Snapshot> {
  constructor(fetchFn: typeof fetch, base: string = '') {
    super(fetchFn, '/api/tasks', base);
  }

  /** What this build is and which engine answers (APP-09): only the words the page shows are taken from the hub. */
  async about(): Promise<About> {
    const doc = await this.json<Record<string, unknown>>('/api/tasks/about');
    const text = textOf;
    const engine = doc['engine'];
    const pinned = doc['pinned'];
    const part = (v: unknown, key: string): string | null =>
      typeof v === 'object' && v !== null ? text((v as Record<string, unknown>)[key]) : null;
    return {
      app: text(doc['app']) ?? 'tasks-desktop',
      version: text(doc['version']) ?? '',
      build: text(doc['build']),
      os: text(doc['os']) ?? '',
      arch: text(doc['arch']) ?? '',
      mode: text(doc['mode']),
      engine:
        typeof engine === 'object' && engine !== null
          ? { version: part(engine, 'version'), git: part(engine, 'git'), nvim: part(engine, 'nvim') }
          : null,
      engineProblem: text(doc['engine_problem']),
      pinned: { engine: part(pinned, 'engine'), lib: part(pinned, 'lib') },
    };
  }

  /** One task with its body. A `signal` that aborts drops the request: the hub then never starts the read. */
  task(id: string, signal?: AbortSignal): Promise<TaskDocument> {
    const path = `/api/tasks/task?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}`;
    return this.json<TaskDocument>(path, signal ? { signal } : undefined);
  }

  /** The ids of the open tasks in the order of `sort` (the engine's), in one answer. */
  async order(sort: string, signal?: AbortSignal): Promise<{ ids: string[] }> {
    const doc = await this.json<Order>(`/api/tasks/order?sort=${encodeURIComponent(sort)}`, signal ? { signal } : undefined);
    return { ids: doc.ids };
  }

  /** The named lists of the engine (read only). */
  lists(): Promise<NamedLists> {
    return this.json<NamedLists>('/api/tasks/lists');
  }

  /**
   * What to start next, five alternatives. `notCategory`: categories whose ready tasks the engine leaves out (capability
   * `next_not_category`; the hub takes them joined by dots); none: the engine's pick over all.
   */
  next(notCategory: readonly string[] = []): Promise<Next> {
    const without = notCategory.length > 0 ? `&not_category=${notCategory.map(encodeURIComponent).join('.')}` : '';
    return this.json<Next>(`/api/tasks/next?n=5${without}`);
  }

  areas(): Promise<HubAreas & Areas> {
    return this.json<HubAreas & Areas>('/api/tasks/areas');
  }

  /** The vaults the hub can read; the hub answers 404 when it has no list. */
  vaults(): Promise<VaultList> {
    return this.json<VaultList>('/api/vaults');
  }

  private vaultPost(path: string, body: Record<string, unknown>): Promise<void> {
    return this.post(path, body);
  }

  /** The ranges of the fields as the engine names them (its `hello.enums`, passed on by the hub). */
  enums(): Promise<{ enums: unknown }> {
    return this.json<{ enums: unknown }>('/api/tasks/enums');
  }

  /** The fields the open tasks can be grouped by, with their values and how each is written (the engine's). */
  /**
   * The mail with the chosen reminders, as the hub writes it for `to` (only tasks of public and internal areas are in
   * it; the rest is named with the reason). With `send` it is sent, and `digest` names the mail that was shown: the
   * hub refuses with `mail_changed` when it would send another one, and with `mail_not_set_up` without a mail account.
   */
  async remindersMail(body: { to: string; ids: string[]; lang: 'de' | 'en'; send: boolean; digest?: string }): Promise<RemindersMail> {
    return parseRemindersMail(await this.postJson<unknown>('/api/tasks/reminders/mail', body));
  }

  /** The repo tiles of this device (`hub.repos`): no path, ever. */
  async repos(): Promise<HubRepos> {
    return parseRepos(await this.json<unknown>('/api/tasks/repos'));
  }

  /** The folders below `REPOS_DIR` that are no tile yet, by name: what the form of a new tile offers. */
  async repoSuggest(): Promise<string[]> {
    return parseSuggestions(await this.json<unknown>('/api/tasks/repos/suggest'));
  }

  /**
   * The state of the repo of a tile: its checkout and the CI of its newest pushed commit, as the hub asked `git` and
   * `gh` (throttled there). `fresh` asks `git` again now.
   */
  async repoStatus(id: string, fresh: boolean): Promise<RepoStatus> {
    return parseRepoStatus(await this.json<unknown>(`/api/tasks/repos/status?id=${encodeURIComponent(id)}${fresh ? '&fresh=1' : ''}`));
  }

  /** A folder as a tile of a group; the answer is the new document. */
  async repoAdd(body: { path: string; name?: string; group: string }): Promise<HubRepos> {
    return parseRepos(await this.postJson<unknown>('/api/tasks/repos/add', body));
  }

  /** The groups and names on the state read; another state is an `ApiError` with the code `stale`. */
  async repoSave(body: { rev: string; groups: RepoGroup[]; names: Record<string, string> }): Promise<HubRepos> {
    return parseRepos(await this.postJson<unknown>('/api/tasks/repos/save', body));
  }

  /** Show the folder of a tile in the file manager, or start Neovim in it (`what`). */
  repoOpen(id: string, what: 'folder' | 'nvim'): Promise<void> {
    return this.post('/api/tasks/repos/open', { id, what });
  }

  /**
   * The image of a tile, read with the session (an `<img src>` would not send it) as a blob the page shows from an
   * address it makes itself; `null` when the repo has none or it could not be read.
   */
  async repoImage(id: string): Promise<Blob | null> {
    if (!/^[a-z0-9]{8}$/.test(id)) return null;
    try {
      const response = await this.request(`/api/tasks/repos/image?id=${id}`);
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }

  groupings(): Promise<Groupings> {
    return this.json<Groupings>('/api/tasks/groupings');
  }

  /** The saved views of the vault, each with the version of its file. */
  views(): Promise<Views> {
    return this.json<Views>('/api/tasks/views');
  }

  /** Remember a folder as a vault; the page has asked the person first. */
  addVault(name: string, path: string): Promise<void> {
    return this.vaultPost('/api/vaults/add', { name, path, confirm: true });
  }

  /** Make a folder that is new (or empty) a vault with one area; the page has asked the person first. It does not register it. */
  createVault(path: string, area: string): Promise<void> {
    return this.vaultPost('/api/tasks/vault_create', { path, area, confirm: true });
  }

  /** Show the folder of the vault the hub reads in the file manager (the page names no folder). */
  revealVault(): Promise<void> {
    return this.vaultPost('/api/tasks/vault_reveal', {});
  }

  /** Run the test sheets of a task, unless a run is under way; where the job stands. */
  startSheetRun(id: string): Promise<SheetRunState> {
    return this.postJson<SheetRunState>('/api/tasks/sheet_run', { id });
  }

  sheetRun(): Promise<SheetRunState> {
    return this.json<SheetRunState>('/api/tasks/sheet_run');
  }

  /** Start the check over all vaults, unless it runs; where it stands. */
  startCheckAll(): Promise<CheckAll> {
    return this.postJson<CheckAll>('/api/tasks/check_all', {});
  }

  checkAll(): Promise<CheckAll> {
    return this.json<CheckAll>('/api/tasks/check_all');
  }

  /** Whether the hub starts at login; null where there is no such thing to switch (this system, the web variant). */
  async autostart(): Promise<boolean | null> {
    try {
      const doc = await this.json<{ on: boolean | null }>('/api/tasks/autostart');
      return typeof doc.on === 'boolean' ? doc.on : null;
    } catch {
      return null;
    }
  }

  /** Register the hub at login or take it away; what is true afterwards. */
  async setAutostart(on: boolean): Promise<boolean | null> {
    const doc = await this.postJson<{ on: boolean | null }>('/api/tasks/autostart', { on });
    return typeof doc.on === 'boolean' ? doc.on : null;
  }

  /**
   * Whether a hub in the background stays without a page (`keep_running` of its settings); null where there is no such
   * thing to switch (a hub without settings, the web variant).
   */
  async keepRunning(): Promise<boolean | null> {
    try {
      const doc = await this.json<{ on: boolean | null }>('/api/tasks/keep_running');
      return typeof doc.on === 'boolean' ? doc.on : null;
    } catch {
      return null;
    }
  }

  /**
   * Whether ai-desktop is on this machine and running, as the hub finds it; null where nobody can say (the web variant
   * has no such route, a hub that is gone). Only this decides whether the page offers its AI functions at all.
   */
  async aiDesktop(): Promise<AiDesktop | null> {
    try {
      const doc = await this.json<Partial<AiDesktop>>('/api/tasks/ai_desktop');
      const port = Number.isInteger(doc.port) && (doc.port ?? 0) > 0 && (doc.port ?? 0) < 65536 ? doc.port : null;
      return { installed: doc.installed === true, running: doc.running === true, port };
    } catch {
      return null;
    }
  }

  /**
   * Hand a task to an agent of ai-desktop: the hub reads the file and sends it with the secret of ai-desktop, which the
   * page never sees. The answer is the job; a refusal (ai-desktop not running, refused) is an `ApiError` with its text.
   */
  handToAgent(id: string, mode: 'prefill' | 'run', kind: AgentKind): Promise<AgentJob> {
    return this.postJson<AgentJob>('/api/tasks/agent', { id, mode, kind });
  }

  /**
   * "Suggest fields" of the new-task form: the hub sends the free text and the values of the vault (asked of the
   * engine by the hub) to ai-desktop as a job of the kind `draft-task`, as private (the area is not chosen yet). The
   * answer is the job.
   */
  sendDraft(text: string): Promise<DraftJob> {
    return this.postJson<DraftJob>('/api/tasks/draft', { text });
  }

  /** Put a draft away that waits for a yes nobody gives (a no on the page, a closed form). */
  async dropDraft(job: string): Promise<void> {
    await this.postJson<unknown>('/api/tasks/draft_drop', { job });
  }

  /**
   * Where a review or a prepared decision stands: its status and, once done, the answer taken apart by the engine
   * (`sections` to adopt, a review's `follow_up`, a decision's `questions_added`).
   */
  agentResult(job: string, id: string, kind: AnswerKind): Promise<AnswerState> {
    return this.postJson<AnswerState>('/api/tasks/agent_result', { job, id, kind });
  }

  /**
   * What the engine would do with an intent `wkd-intent/1` (the text as it was pasted): never carried out here. A
   * refusal of the hub or the engine is an `ApiError` with its words.
   */
  async intent(text: string): Promise<IntentAnswer> {
    const answer = parseIntentAnswer(await this.postJson<unknown>('/api/tasks/intent', { text }));
    if (answer === null) throw new ApiError(502, 'engine_failed', 'the engine did not answer the intent');
    return answer;
  }

  /** Where a draft stands: its status and, once done, `draft` or `draft_error`. */
  draftJob(job: string): Promise<DraftState> {
    return this.postJson<DraftState>('/api/tasks/draft_job', { job });
  }

  /** Run a draft that waits for a yes (the model of ai-desktop is not local), after the person said yes. */
  async confirmDraft(job: string): Promise<void> {
    await this.postJson<unknown>('/api/tasks/draft_confirm', { job });
  }

  /**
   * "Split into tasks" of a plan: the hub sends the plan file and the list of its tasks to ai-desktop as a job of the
   * kind `split-plan`. The answer is the job.
   */
  splitPlan(plan: string): Promise<SplitJob> {
    return this.postJson<SplitJob>('/api/tasks/split', { plan });
  }

  /** Where a split stands: its status and, once done, the block of drafts (`block`) or why there is none. */
  splitJob(job: string): Promise<SplitState> {
    return this.postJson<SplitState>('/api/tasks/split_job', { job });
  }

  /** Run a split that waits for a yes (a private area on a model that is not local), after the person said yes. */
  async confirmSplit(job: string): Promise<void> {
    await this.postJson<unknown>('/api/tasks/split_confirm', { job });
  }

  /** Put a split that waited for a yes away in ai-desktop: the person said no, or closed the dialog while it asked. */
  async dropSplit(job: string): Promise<void> {
    await this.postJson<unknown>('/api/tasks/split_drop', { job });
  }

  /** Give a hub in the background the order to stay, or take it back; what the settings say afterwards. */
  async setKeepRunning(on: boolean): Promise<boolean | null> {
    const doc = await this.postJson<{ on: boolean | null }>('/api/tasks/keep_running', { on });
    return typeof doc.on === 'boolean' ? doc.on : null;
  }

  /**
   * Ask the person for a folder with the dialog of the system on the machine of the hub (a page cannot show one with a
   * path). The folder they chose, or `null` when the dialog was closed; the page names nothing.
   */
  async pickVaultFolder(): Promise<string | null> {
    const doc = await this.postJson<{ path: string | null }>('/api/tasks/vault_pick', {});
    return typeof doc.path === 'string' && doc.path !== '' ? doc.path : null;
  }

  /** What the page of the first start shows: what stops the engine, what is offered about the installation. */
  async setup(): Promise<SetupInfo> {
    const doc = await this.json<Record<string, unknown>>('/api/tasks/setup');
    const install = doc['install'];
    return {
      problem: textOf(doc['problem']),
      install: INSTALL_OFFERS.includes(install as InstallOffer) ? (install as InstallOffer) : null,
      pickProgram: doc['pick_program'] === true,
      program: textOf(doc['program']) ?? 'nvim',
      example: exampleOf(doc['example']),
    };
  }

  /**
   * The hub shows the folder dialog, copies its example vault into the (empty) folder the person chose and keeps that
   * copy as the vault. The page names no folder.
   */
  async setupExample(): Promise<SetupStep> {
    const doc = await this.postJson<Record<string, unknown>>('/api/tasks/setup_example', {});
    return { chosen: doc['chosen'] === true, problem: textOf(doc['problem']) };
  }

  /**
   * The hub shows the folder dialog and keeps the folder the person chose as the vault (with `area`: makes it a new vault
   * with that area first). The page names no folder.
   */
  async setupVault(area: string | null): Promise<SetupStep> {
    const doc = await this.postJson<Record<string, unknown>>('/api/tasks/setup_vault', area === null ? {} : { area });
    return { chosen: doc['chosen'] === true, problem: textOf(doc['problem']) };
  }

  /** The hub shows the file dialog for the program of Neovim, probes the choice and keeps it. */
  async setupNvim(): Promise<SetupStep> {
    const doc = await this.postJson<Record<string, unknown>>('/api/tasks/setup_nvim', {});
    return { chosen: doc['chosen'] === true, problem: textOf(doc['problem']) };
  }

  /** Install the program (the hub stops and comes back from the installed copy, which opens the page anew). */
  installProgram(autostart: boolean, shortcut: boolean): Promise<void> {
    return this.post('/api/tasks/setup_install', { autostart, shortcut });
  }

  /** The person does not want the installation: it is not offered again. */
  declineInstall(): Promise<void> {
    return this.post('/api/tasks/setup_install', { decline: true });
  }

  removeVault(name: string): Promise<void> {
    return this.vaultPost('/api/vaults/remove', { name });
  }

  /**
   * Show the file of a task in Neovim, in a window of its own (the hub starts it; the page names only the task), or of
   * a field of knowledge with `kind` `competence` (its id; the engine names its file).
   */
  openInEditor(id: string, kind?: 'competence'): Promise<void> {
    return this.vaultPost('/api/tasks/open', { id, kind });
  }

  /**
   * The places in code a task names and whether docmap-desktop is found; null where nobody can say (a hub that is gone,
   * a hub without the route).
   */
  async docmapPlaces(id: string): Promise<DocmapPlaces | null> {
    try {
      const doc = await this.json<Partial<DocmapPlaces>>(`/api/tasks/docmap?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}`);
      const places = Array.isArray(doc.places) ? doc.places.filter((p) => typeof p?.label === 'string') : [];
      return { found: doc.found === true, places };
    } catch {
      return null;
    }
  }

  /** Open docmap-desktop at the `index`-th place of a task (the hub starts it; the page names the task and the number). */
  openInDocmap(id: string, index: number): Promise<void> {
    return this.vaultPost('/api/tasks/docmap_open', { id, index });
  }

  /** Read another vault; the hub swaps what it holds and the page reads everything again. */
  selectVault(name: string): Promise<void> {
    return this.vaultPost('/api/vaults/select', { name });
  }

  /** The tasks whose text holds every word of `query` (the hub searches the text it keeps). */
  search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const path = `/api/tasks/search?q=${encodeURIComponent(query)}&limit=20`;
    return this.json<SearchResult>(path, signal ? { signal } : undefined);
  }

  /** The meetings whose days touch a window, or the meetings of one task (`tasks.meetings`, one page). */
  meetings(
    query: { since?: string; until?: string; area?: string; task?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ): Promise<Meetings> {
    const parts = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2F/gi, '/')}`);
    return this.json<Meetings>(`/api/tasks/meetings${parts.length > 0 ? `?${parts.join('&')}` : ''}`, signal ? { signal } : undefined);
  }

  /**
   * The small picture of a meeting (`meeting/thumb`: 96 px PNG or the SVG of a board), read with the session (an
   * `<img src>` would not send it); `null` for a meeting without a picture (`404 no_image`) or one that cannot be read.
   */
  async meetingThumb(id: string): Promise<Blob | null> {
    try {
      const response = await this.request(`/api/tasks/meeting/thumb?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}`);
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }

  /**
   * An image below `assets/` of a container (`asset`: a task, plan, project, path or meeting), read with the session
   * (an `<img src>` would not send it); `null` when it has no such image, it is too large, or it cannot be read.
   */
  async asset(kind: AssetOwner, id: string, file: string, held?: string): Promise<AssetAnswer> {
    const plain = (text: string) => encodeURIComponent(text).replace(/%2F/gi, '/');
    try {
      const path = `/api/tasks/asset?kind=${kind}&id=${plain(id)}&file=${plain(file)}`;
      // `held`: the tag of the picture the page has; the same bytes answer 304 and the page keeps it.
      const response = await this.request(path, held ? { headers: { 'If-None-Match': held } } : undefined);
      if (response.status === 304) return 'same';
      return response.ok ? { blob: await response.blob(), tag: response.headers.get('ETag') } : null;
    } catch {
      return null;
    }
  }

  /** One meeting with its body and the sections the engine reads (`tasks.meeting`). */
  meeting(id: string, signal?: AbortSignal): Promise<MeetingDocument> {
    const path = `/api/tasks/meeting?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}`;
    return this.json<MeetingDocument>(path, signal ? { signal } : undefined);
  }

  /** A line of the quick capture read by the engine into a proposal of a meeting; nothing is written. */
  meetingParse(text: string, signal?: AbortSignal): Promise<MeetingParse> {
    return this.postJson<MeetingParse>('/api/tasks/meeting_parse', { text }, signal);
  }

  /** A whiteboard of the drawing surface saved through the engine's `board_save` (`<name>.ink.json` and its SVG). */
  board(body: BoardRequest): Promise<{ results: BoardSaved[] }> {
    return this.postJson<{ results: BoardSaved[] }>('/api/tasks/board', body);
  }

  /** Changes, through the one door of the engine. The answer says per operation what happened. */
  /** A file from this page becomes an asset of the task: the body is the file, the hub streams it to its disk. */
  async upload(id: string, file: File, kind?: 'video' | 'image' | 'screenshot' | 'audio'): Promise<Result & { large_for_git?: boolean }> {
    // `kind` names the folder of the asset below `assets/` of the task; the hub takes these four words only.
    const path = `/api/tasks/upload?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}${kind ? `&kind=${kind}` : ''}`;
    const response = await this.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Upload-Name': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as Result & { large_for_git?: boolean };
  }

  async ops(request: OpsRequest, signal?: AbortSignal): Promise<Result> {
    const response = await this.request('/api/tasks/ops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as Result;
  }

  /**
   * The figures of an estimate for some tasks, also as they would be with other efforts and values (`assume`): a
   * question, nothing is written. The engine reckons; the page shows.
   */
  async estimate(
    request: { ids?: string[]; assume?: { id: string; effort?: string; value?: number }[] },
    signal?: AbortSignal,
  ): Promise<Estimate> {
    const response = await this.request('/api/tasks/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as Estimate;
  }

  /** The state of the check job (the check of the vault runs in the hub, not in the page). */
  async checkState(): Promise<CheckJobState> {
    return (await this.json<{ job: CheckJobState }>('/api/tasks/check')).job;
  }

  /** Start the check as a job; a job that runs already is answered instead of a second one. */
  async checkStart(request: { stale?: 'refs'; area?: string } = {}): Promise<CheckJobState> {
    const response = await this.request('/api/tasks/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw await failure(response);
    return ((await response.json()) as { job: CheckJobState }).job;
  }

  /** The tasks a task needs before it can start, or that wait for it (the engine walks the graph). */
  planFor(id: string, direction: 'needs' | 'unlocks', signal?: AbortSignal): Promise<PlanFor> {
    const path = `/api/tasks/plan_for?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}&direction=${direction}`;
    return this.json<PlanFor>(path, signal ? { signal } : undefined);
  }

  /**
   * The finished tasks of the Backlogs and what they add up to (the engine counts; `since` and `until` are days). `ci`
   * keeps those whose CI state is one of the words (`none`: no `ci` written; capability `finished_ci`).
   */
  finished(query: FinishedQuery, signal?: AbortSignal): Promise<Finished> {
    const parts = Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) =>
        // a list goes as its words joined by dots (`ci=pending.red`): a query value of the hub is plain text, no comma
        Array.isArray(value)
          ? `${key}=${value.map((v) => encodeURIComponent(String(v))).join('.')}`
          : `${key}=${encodeURIComponent(String(value)).replace(/%2F/gi, '/')}`,
      );
    const path = `/api/tasks/finished${parts.length > 0 ? `?${parts.join('&')}` : ''}`;
    return this.json<Finished>(path, signal ? { signal } : undefined);
  }

  /** The figures of the overview over time, one point per day or week (the engine keeps the series). */
  history(
    query: { area?: string; since?: string; until?: string; resolution?: 'day' | 'week' },
    signal?: AbortSignal,
  ): Promise<History> {
    const parts = Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
    const path = `/api/tasks/history${parts.length > 0 ? `?${parts.join('&')}` : ''}`;
    return this.json<History>(path, signal ? { signal } : undefined);
  }

  /** What the parked tasks wait for: per `waits_for` key the number of tasks and their areas (the engine counts). */
  waits(area?: string): Promise<Waits> {
    const query = area === undefined ? '' : `?area=${encodeURIComponent(area)}`;
    return this.json<Waits>(`/api/tasks/waits${query}`);
  }

  /** The open plans side by side (capability `plan_compare`): every figure is the engine's. */
  planCompare(signal?: AbortSignal): Promise<PlanCompare> {
    return this.json<PlanCompare>('/api/tasks/plan_compare', signal ? { signal } : undefined);
  }

  /**
   * The open learning paths with their progress, no tree (capability `paths`); with `includeDone` the finished ones
   * too, and the finished projects a requirement names (capability `requires`).
   */
  paths(signal?: AbortSignal, includeDone = false): Promise<Paths> {
    return this.json<Paths>(includeDone ? '/api/tasks/paths?include_done=1' : '/api/tasks/paths', signal ? { signal } : undefined);
  }

  /** For every running learning path the next points to learn (capability `learn_next`; the engine chooses). */
  learnNext(query: LearnNextQuery = {}, signal?: AbortSignal): Promise<LearnNext> {
    return this.json<LearnNext>(`/api/tasks/learn_next${learnQuery(query)}`, signal ? { signal } : undefined);
  }

  /** The notes, links and images of the learning points of all paths (capability `learn_notes`; the engine searches). */
  learnNotes(query: LearnNotesQuery = {}, signal?: AbortSignal): Promise<LearnNotes> {
    return this.json<LearnNotes>(`/api/tasks/learn_notes${learnQuery(query)}`, signal ? { signal } : undefined);
  }

  /** The evidence of all learning paths (capability `learn_evidence`). */
  learnEvidence(query: LearnEvidenceQuery = {}, signal?: AbortSignal): Promise<LearnEvidence> {
    return this.json<LearnEvidence>(`/api/tasks/learn_evidence${learnQuery(query)}`, signal ? { signal } : undefined);
  }

  /** The series of the learning figures over a window (capability `learn_history`). */
  learnHistory(query: LearnHistoryQuery = {}, signal?: AbortSignal): Promise<LearnHistory> {
    return this.json<LearnHistory>(`/api/tasks/learn_history${learnQuery(query)}`, signal ? { signal } : undefined);
  }

  /** The fields of knowledge with their stages and the scale (capability `competences`). */
  competences(query: { area?: string; areas?: string } = {}, signal?: AbortSignal): Promise<Competences> {
    return this.json<Competences>(`/api/tasks/competences${learnQuery(query)}`, signal ? { signal } : undefined);
  }

  /**
   * The open learning paths with every line of `## Level` of each (capability `paths_levels`); with `includeDone` the
   * finished ones too (capability `requires`): their badges are earned, their rewards may be open.
   */
  pathsWithLevels(signal?: AbortSignal, includeDone = false): Promise<Paths> {
    return this.json<Paths>(includeDone ? '/api/tasks/paths?include_done=1&levels=1' : '/api/tasks/paths?levels=1', signal ? { signal } : undefined);
  }

  /** One learning path with its tree, a flat list in document order (capability `path`). */
  path(id: string, signal?: AbortSignal): Promise<PathDocument> {
    const path = `/api/tasks/path?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}`;
    return this.json<PathDocument>(path, signal ? { signal } : undefined);
  }

  /** Where the areas hang together: the links between the open tasks of different areas. */
  links(): Promise<Links> {
    return this.json<Links>('/api/tasks/links');
  }

  /** The text of a snapshot a test-sheet block names (`<repo>/TESTS/__snapshots__/<path>.snap`); the hub reads it. */
  async sheetSnapshot(name: string, signal?: AbortSignal): Promise<string> {
    const doc = await this.json<{ text: string }>(`/api/tasks/sheet_snap?name=${encodeURIComponent(name).replace(/%2F/gi, '/')}`, signal ? { signal } : undefined);
    return doc.text;
  }

  /** What finishing a task would do, and the token `done` needs. */
  donePreview(id: string): Promise<DonePreview> {
    const path = `/api/tasks/done_preview?id=${encodeURIComponent(id).replace(/%2F/gi, '/')}`;
    return this.json<DonePreview>(path);
  }
}

/** The query of `learnNext`: an area, one path, a machine, the points per path (1..20). */
export interface LearnNextQuery {
  area?: string;
  path?: string;
  machine?: 'private' | 'workstation' | 'wsl';
  n?: number;
}

/** The query of `learnNotes`: the search text (`q`), a kind, an area, one path, the finished paths too, a limit. */
export interface LearnNotesQuery {
  q?: string;
  kind?: 'note' | 'link' | 'image';
  area?: string;
  /** Several areas or area groups joined by `/` (no area name holds one). */
  areas?: string;
  path?: string;
  include_done?: boolean;
  limit?: number;
}

/** The query of `learnEvidence`: a competence (its id), an area, one path, the finished paths too. */
export interface LearnEvidenceQuery {
  competence?: string;
  area?: string;
  /** Several areas or area groups joined by `/` (no area name holds one). */
  areas?: string;
  path?: string;
  include_done?: boolean;
}

/** The query of `learnHistory`: a window of days, its step, an area, one path. */
export interface LearnHistoryQuery {
  since?: string;
  until?: string;
  step?: 'day' | 'week' | 'month';
  area?: string;
  /** Several areas or area groups joined by `/` (no area name holds one). */
  areas?: string;
  path?: string;
}

/**
 * The query string of a read of the tab "Lernpläne": every value escaped (the search text may hold anything), a flag as
 * `1`, an absent, false or empty value left out; '' without any.
 */
export function learnQuery(query: object): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query) as [string, unknown][]) {
    if (value === undefined || value === false || value === '') continue;
    const text = value === true ? '1' : String(value);
    const escaped = encodeURIComponent(text);
    // An id keeps its slash (a plain value of the hub); the search text stays escaped as a whole.
    parts.push(`${key}=${key === 'q' ? escaped : escaped.replace(/%2F/gi, '/')}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
