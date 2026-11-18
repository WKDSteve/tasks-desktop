// The hub's routes, as typed calls. Only the shapes the UI needs.

import type {
  Areas,
  Check,
  DonePreview,
  Estimate,
  Finished,
  Groupings,
  History,
  Links,
  NamedLists,
  Next,
  Order,
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

/** One operation of a write. The engine checks the rules; the form is the page's. */
export type Op =
  | { op: 'set'; id: string; patch: Record<string, unknown>; if_match?: string }
  | { op: 'new'; area: string; title: string; fields?: Record<string, unknown>; body?: string }
  | { op: 'reorder'; id: string; after?: string; before?: string; group?: string; if_match?: string }
  | { op: 'done'; id: string; confirm: string; remind?: string }
  | { op: 'reopen'; id: string; status?: string; if_match?: string }
  | { op: 'tick_step'; id: string; n: number; done?: boolean; if_match?: string }
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
  | { op: 'plan_close' | 'project_close'; id: string };

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

  next(): Promise<Next> {
    return this.json<Next>('/api/tasks/next?n=5');
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

  /** Show the file of a task in Neovim, in a window of its own (the hub starts it; the page names only the task). */
  openInEditor(id: string): Promise<void> {
    return this.vaultPost('/api/tasks/open', { id });
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

  /** Changes, through the one door of the engine. The answer says per operation what happened. */
  /** A file from this page becomes an asset of the task: the body is the file, the hub streams it to its disk. */
  async upload(id: string, file: File, kind?: 'video' | 'image' | 'screenshot'): Promise<Result & { large_for_git?: boolean }> {
    // `kind` names the folder of the asset below `assets/` of the task; the hub takes these three words only.
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

  /** The finished tasks of the Backlogs and what they add up to (the engine counts; `since` and `until` are days). */
  finished(
    query: { area?: string; plan?: string; since?: string; until?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ): Promise<Finished> {
    const parts = Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value)).replace(/%2F/gi, '/')}`);
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
