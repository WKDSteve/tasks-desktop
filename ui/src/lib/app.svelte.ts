// The state of the page and what keeps it true: pairing, the held list, the
// event stream and the detail of the selected task.

import {
  MOVE_MAX,
  type MoveCheck,
  type TagEdit,
  bulkMoveOps,
  bulkSetOps,
  followMoves,
  markAll,
  markRange,
  moveChecks,
  moveOrder,
  moveUndo,
  pruneMarks,
  toggleMark,
} from './bulk';
import {
  badPhaseOf,
  planOp,
  targetTaskOp,
  targetTitle,
  type PlanForm,
  type PlanKind,
  type PlanPreview,
} from './planwizard';
import { addOps, type AddTarget } from './picker';
import { connectOp, edgeOp, parseGraphOrder, phaseOp, type DepEdge, type EdgeAction, type EdgeKind, type GraphOrder } from './depGraph';
import { COLUMNS, columnsOf, isColumn, neighbourColumn, placeNear, stepInGroup, type Column, type Move } from './board';
import { ApiError, type AgentKind, type AgentTab, type AiDesktop, type BoardRequest, type BoardSaved, type CheckAll, type SheetRunState, type Hub, type HubArea, type HubAreas, type SearchResult, type VaultList } from './api';
import { cacheableClass, cacheableList, type CachedList, type ListStore } from './cache';
import type {
  DonePreview,
  Estimate,
  Finished,
  History,
  Links,
  MeetingDocument,
  MeetingEntry,
  Meetings,
  MovePlan,
  Next,
  PathDocument,
  Paths,
  PathEntry,
  PlanCompare,
  Result,
  Snapshot,
  TaskDocument,
  TaskEntry,
  View as SavedView,
  ViewSelect,
  Waits,
} from './contract';
import { expandAreas, isAreaGroup, NO_AREA, type AreaGroupInfo } from './areaGroups';
import type { AssetOwner, Op } from './api';
import { adoptOps, followUpOp, runAnswer, type Answer, type AnswerKind } from './agentAnswer';

/** The note an inverse of `node_set` carries (capability `node_note`), as a part of the operation; none: `{}`. */
function noteOf(inv: object): { note?: string } {
  const note = (inv as { note?: unknown }).note;
  return typeof note === 'string' ? { note } : {};
}

/** What the dialog "Answer of the agent" shows. */
export interface AnswerView {
  id: string;
  area: string;
  title: string;
  kind: AnswerKind;
  phase: 'waiting' | 'confirm' | 'shown' | 'failed' | 'adopted';
  job?: string;
  answer?: Answer;
  why?: string;
  /** The id of the follow-up task once it is made. */
  followUpMade?: string;
}
import { indexOfLinks, touchedAreas } from './cross';
import { planProjects, projectOfTask, projectsOf, type ClosePreview, type Project } from './projects';
import { parseCompareSort, serializeCompareSort, type CompareSort } from './planCompare';
import { cleanClaimName, agentNews, type AgentNews } from './claims';

/** How the plan view draws: the stages or the graph of a plan, or the plans compared. */
export type PlanDisplay = 'stages' | 'graph' | 'compare';
import { parsePrefs, type Prefs as FinishedPrefs } from './finished';
import { groupedByArea } from './areaBands';
import { kindOfFile, type AssetKind, type Taken } from './capture';
import { activeFilters, applyFilter, areaCounts, filterOfText, filterText, filterVaultOf, freshFilter, moveSelection, NONE as NO_VALUE, parseFilter, serializeFilter, type Filter } from './filter';
import { chipLabel } from './filter-chips';
import { inboxOf, triageKey } from './inbox';
import type { Finding } from './check';
import { CheckState } from './state/check.svelte';
import { changesOf, failedIdsOf, MATRIX_MAX, matrixIds, type Draft } from './estimate';
import { MatrixState } from './state/matrix.svelte';
import { bumped, parseFrecency, type Frecency } from 'appkit-ui/palette';
import { AboutState, type AboutDialog } from './state/about.svelte';
import type { About } from './about';
import { ConflictsState } from './state/conflicts.svelte';
import { VaultsState } from './state/vaults.svelte';
import { SetupState } from './state/setup.svelte';
import { ViewsState } from './state/views.svelte';
import { emptySelect, filterOfSelect, isViewField, type ViewForm } from './views';
import { viewMenuItems } from './viewMenu';
import type { MenuItem } from 'appkit-ui/menu';
import { cellDropOps, cellsOf, dropOps, groupsOf, NONE, type Cell, type Derived, type Drop, type Grouping } from './groups';
import { TodayState } from './state/today.svelte';
import { GraphState } from './state/graph.svelte';
import { ReposState } from './state/repos.svelte';
import type { DailyPrefs } from './daily';
import { parseConflictMode, type ConflictMode } from 'appkit-ui/conflicts';
import type { CountKey, CountView } from './counts';
import { parseStatsPrefs, type StatDim, type StatSort } from './stats';
import { defaultHistoryPrefs, isDefaultHistory, parseHistoryPrefs, type HistoryMetric, type HistoryPrefs } from './statsHistory';
import { defaultTilePrefs, isDefaultTiles, parseTilePrefs, type TilePrefs } from './statsTiles';
import { conflictsOf, conflictsOfRequest, retryOp, type Conflict } from './conflicts';
import { browserStreamShare, Preferences, StreamSession } from 'appkit-ui/session';
import type { SseMessage } from 'appkit-ui/sse';
import { labelOf, langSwitcher, LANGS, translate, type Key, type Lang } from './i18n';
import { csvSeparatorFor, EXPORT_FILES, exportFileName, rowsText, sheetOf, type ExportFormat, type ExportRow, type PrintSheet } from './export';
import {
  AS_THEY_ARE,
  boardRows,
  cellRows,
  groupRows,
  mayLeave,
  onlyMarked,
  relabel,
  stageRows,
  taskCount,
  withoutPlansOf,
  type GroupWords,
} from './viewExport';
import { chosenPlan, stagesOf } from './plan';
import { applyOrder, orderOf, parseSort, type SortWord } from './sort';
import { DEFAULTS_KEY, FACTORY_DEFAULTS, parseDefaults, serializeDefaults, startChoice, startView, type Defaults } from './defaults';
import { fromEngineList, type EngineList } from './engineLists';
import { DEFAULT_RANGES, rangesOf, type Ranges } from './fields';
import { sameField, type FieldValue } from './drafts';
import { draftChoices, runDraft, type DraftChoices, type DraftOutcome } from './suggestFields';
import { fillOfFinding, readIntent, type IntentOutcome } from './intent';
import { createDrafts, runSplit, type DraftResult, type Split, type SplitOutcome } from './split';
import {
  activeList as activeListOf,
  cleanName,
  makeList,
  parseListMemory,
  serializeListMemory,
  vaultKey,
  withList,
  withoutList,
  type ListMemory,
  type NamedList,
} from './lists';
import { LEARNING, learningIds, withoutLearning } from './learning';
import { localToday } from './remind';
import {
  MEETINGS_EVER,
  MEETING_PAGES,
  type MeetingWindow,
  emptyMeetingForm,
  formOfProposal,
  meetingNewOp,
  participantsHeading,
  participantsText,
  REVIEW_DAYS,
  toReview,
  wallTime,
  type MeetingForm,
  type MeetingPreview,
} from './meetings';
import {
  DEFAULT_SHORTCUTS,
  MINUTES_DRAFTS_KEY,
  MINUTES_SHORTCUTS_KEY,
  draftsOf,
  parseShortcuts,
  type MinutesDraft,
  type Shortcuts,
} from './minutes';
import type { RemindersMail } from './reminders';
import { DEFAULT_ROW_ACTIONS, parseRowActions, serializeRowActions, type RowActionPrefs } from './rowActions';
import type { RepoStatus } from './repoStatus';
import { tagTargets } from './tagging';
import { COLUMN_KEYS, defaultColumns, parseColumns, serializeColumns, type ListColumns } from './columns';
import { emptyFolds, foldOf, parseFolds, serializeFolds, type FoldMemory, type Folds, type FoldView } from './fold';
import { parseSizes, serializeSizes, withSize, type Size, type Sizes } from './sizes';
import { taskRoute, viewRoute } from './route';
import { cardRoute, parseCardFolds, withCardFolded, type CardRoute, type StatsCard } from './statsCards';

/** No task: the learning tasks that are hidden while none is. */
const NO_IDS: ReadonlySet<string> = new Set();

/** The longest line of the notes the engine takes (`append_note`), in characters. */
const NOTE_MAX = 1000;

export type Phase = 'starting' | 'needs_pairing' | 'offline' | 'unavailable' | 'ready';
export type Connection = 'live' | 'reconnecting' | 'offline';
export type View = 'today' | 'list' | 'board' | 'plan' | 'inbox' | 'abnahme' | 'cross' | 'calendar' | 'timeline' | 'reminders' | 'stats' | 'done' | 'views' | 'repos' | 'repostatus' | 'paths';
export type Theme = 'auto' | 'light' | 'dark';
/** The blocks of the Today view that a person may hide. */
export { ORDERED_TILES, TILES, type OrderedTile, type Tile } from './tiles-list';
import { TILES as TODAY_TILES, type OrderedTile, type Tile } from './tiles-list';

/** The views whose layout can be put back as it came (Defaults ...). */
export const LAYOUT_VIEWS = ['list', 'plan', 'stats', 'today'] as const;
export type LayoutView = (typeof LAYOUT_VIEWS)[number];

/** What a new task is filled with when the capture form opens from a plan or a project (fields of the engine's `new`). */
export type CaptureFill = {
  plan?: string;
  phase?: string;
  project?: string;
  /** From a finding another app handed over (`lib/intent.ts`): shown in the form like typed values, and as editable. */
  kind?: string;
  tags?: string;
  refs?: string;
  links?: string;
  summary?: string;
  context?: string;
};

/** What the last write did, in one line; `undo` is the way back, when there is one. */
export interface Toast {
  kind: 'ok' | 'error';
  text: string;
  undo?: Op[];
}

export type Detail =
  | { state: 'none' }
  | { state: 'loading'; id: string }
  | { state: 'ok'; id: string; doc: TaskDocument }
  | { state: 'failed'; id: string };

/** A vault of the web variant: a folder used before. `active`: the one the page reads. */
export interface FolderVault {
  id: string;
  name: string;
  active: boolean;
  access: 'granted' | 'prompt' | 'denied' | 'gone';
}

/** What the page needs from its surroundings. */
export interface Env {
  hub: Hub;
  cache: ListStore;
  /** Per-tab storage for the session token. */
  session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Per-browser storage for language and theme. */
  prefs: Pick<Storage, 'getItem' | 'setItem'>;
  preferredLanguages: readonly string[];
  now(): number;
  fetchFn: typeof fetch;
  /** Wait; replaced in tests. */
  sleep(ms: number): Promise<void>;
  /** Load the page again (after another vault was chosen); replaced in tests. */
  reload?(): void;
  /**
   * Go back to the way in, where another folder is chosen (the web variant: it reads one folder and has no hub with a
   * list of vaults). Left out where the hub manages the vaults.
   */
  chooseFolder?(): void;
  /**
   * The vaults of the web variant: the folders used before, of which one is read (web/vault-switch.ts). `select` asks
   * the browser for the folder inside the click when it dropped the access, and loads the page again with it. Left out
   * where the hub manages the vaults.
   */
  folderVaults?: {
    list(): Promise<FolderVault[]>;
    select(id: string): Promise<'switched' | 'same' | 'denied' | 'gone' | 'busy'>;
  };
  /**
   * The snapshots of the test sheets where there is no hub: the person gives the folder of the plugin checkouts.
   * Left out where the hub reads them.
   */
  snapshots?: { read(name: string): Promise<string>; choose(): Promise<boolean> };
  /** `web`: the page is the web variant (`main.web.ts`), with no hub and nothing of the machine. The hub's page leaves it out. */
  mode?: 'web';
  /**
   * The vault is shown, not written: the browser gave the folder through an input (Firefox, Safari), which has no way
   * back to the files. The page says so and every change is refused with that reason.
   */
  readOnly?: boolean;
  /**
   * Open the page again in a window of its own, at the fragment `route` (route.ts); false when the browser refused
   * (a blocked popup). Left out where the page cannot open windows: a task then cannot be detached.
   */
  openWindow?(route: string): boolean;
  /**
   * Ask the open tabs of the page for their session (appkit-ui/handoff): a tab the browser opened from a link has none
   * of its own. The token, or null when no tab answered. Left out where there is no hub (the web variant).
   */
  askSession?(onLate?: (token: string) => void): Promise<string | null>;
  /**
   * Whether the tab is shown (`document.visibilityState`): a hidden tab asks no hub that does not answer. Left out: shown.
   */
  visible?(): boolean;
  /** Whether the window has the focus now (`document.hasFocus`): no focus event is to come. Left out: it has not. */
  hasFocus?(): boolean;
  /** The ways out of the page for an export: a file the browser saves, the clipboard, the printer. Replaced in tests. */
  out: {
    save(name: string, text: string, type: string): boolean;
    copy(text: string): Promise<boolean>;
    print(sheet: PrintSheet): boolean;
    /** The sheet as a picture; only where the policy of the page allows it to be drawn (the web variant). */
    png?: (sheet: PrintSheet, name: string) => Promise<'saved' | 'too_long' | 'failed'>;
  };
}

/** Where the tab keeps its session (the open tabs hand it to a new one from here, main.ts). */
export const TOKEN_KEY = 'tasks-desktop.session';
/** A pairing code the hub turned away for too many attempts (429) is still good: it is traded again a few times. */
export const EXCHANGE_RETRIES = 3;
const EXCHANGE_RETRY_MS = 3000;
/**
 * How long the page waits between two questions to a hub that does not answer (`App.watchHub`), at first; each further
 * miss doubles it, up to `HUB_PROBE_MAX_MS`. The focus of the window asks at once.
 */
export const HUB_PROBE_MS = 3000;
export const HUB_PROBE_MAX_MS = 30_000;
/** How long a pairing code offered to a page that still believed in its old hub is kept (a code lives a minute). */
const LATE_CODE_MS = 60_000;
/** Where the hub of the page is (`App.hubState`). */
export type HubState = 'here' | 'gone' | 'replaced';
/** The saved view that was open last (its id). */
const OPEN_VIEW_KEY = 'tasks-desktop.view-open';
/** The key the palette remembers a choice of a saved view under (`view.<id>` of `paletteActions`, as an action). */
const VIEW_ACTION = 'action:view.';

/** The area of an id `<area>/<slug>`, or undefined when it has none. */
function areaOfId(id: string): string | undefined {
  const at = id.indexOf('/');
  return at > 0 ? id.slice(0, at) : undefined;
}

/** A promise that gives up after `ms` and says `null`. */
function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Where this browser keeps the meetings put away from the tile Follow-up, and how many it keeps. */
const REVIEW_DISMISSED_KEY = 'tasks-desktop.review-dismissed';
const REVIEW_KEEP = 200;

function safe<T>(work: () => T): T | null {
  try {
    return work();
  } catch {
    return null;
  }
}

/** The remembered hidden blocks; anything that is not a known block is dropped. */
/** How many reads that began after a batch of moves may still bring the list of before the move (see `#arriving`). */
const LATE_READS = 3;

/** The words of lib.nvim for a clipboard without an image (the engine has no code of its own for it). */
export function clipboardHoldsNoImage(message: string): boolean {
  return /no image in the clipboard|holds no png image/i.test(message);
}

/** A window that gets the focus reads the start at login again at most this often (it can change in hub-desktop). */
const AUTOSTART_EVERY_MS = 30_000;

export class App {
  phase = $state<Phase>('starting');
  /** The last pairing code was refused (spent or older than its minute): the page says so and what to do. */
  pairRefused = $state(false);
  /** The hub turned the code away for too many attempts and the tab has no session: it did not look at the code. */
  pairLimited = $state(false);
  /** A code that arrived while the page was still starting: the pending start trades it. */
  private pendingCode: string | null = null;
  /** The session an open tab answered with while `start` still waited for the hub (`takeLateSession`). */
  private lateSession: string | null = null;
  problem = $state<string | null>(null);
  view = $state<View>('today');
  /** What the person chose for the whole page (the kit's `Preferences`): the language, the theme, the single keys. */
  readonly prefs: Preferences<Lang>;
  /** The connection to the hub, and the event stream (the kit's `StreamSession`). */
  readonly stream = new StreamSession();
  get lang(): Lang {
    return this.prefs.lang;
  }
  get theme(): Theme {
    return this.prefs.theme;
  }
  /** Single-key shortcuts; a person with assistive software may turn them off. */
  get shortcuts(): boolean {
    return this.prefs.shortcuts;
  }
  get connection(): Connection {
    return this.stream.connection;
  }
  set connection(value: Connection) {
    this.stream.connection = value;
  }
  #filter = $state<Filter>(freshFilter());
  /** What is chosen to see. It is remembered (not the search words), so it outlives a reload. */
  get filter(): Filter {
    return this.#filter;
  }
  set filter(value: Filter) {
    const before = serializeFilter(this.#filter, this.#filterVault);
    this.#filter = value;
    // The filter belongs to the vault it was made in (its areas, tags and plans); while the hub has not named its
    // vault yet, the one the memory names is kept.
    if (typeof this.#hubVault === 'string') this.#filterVault = this.#hubVault;
    // The search words are not remembered: typing in the box writes nothing.
    const text = serializeFilter(value, this.#filterVault);
    if (text !== before) safe(() => this.env.prefs.setItem('tasks-desktop.filter', text));
  }
  /** The vault the remembered filter was made in (see `filterVaultOf`). */
  #filterVault: string | null | undefined = undefined;
  /** The vault the hub named last: `undefined` not asked yet (or not answered), `null` a hub that has no list of vaults. */
  #hubVault: string | null | undefined = undefined;
  /** How the start page is laid out and what was chosen there (its own state: `state/today.svelte.ts`). */
  readonly todayState: TodayState;
  /** The saved views of the vault and the groupings they are drawn with (its own state: `state/views.svelte.ts`). */
  readonly viewsState: ViewsState;
  /** The state of the views (`viewsKey`) they were last asked at. */
  #viewsRev: string | undefined = undefined;

  /**
   * What the saved views stand on: the snapshot's `views_rev` (a view written here or changed outside, a pull say, changes
   * it without a new `rev`), or its `rev` for an engine that does not name it.
   */
  private get viewsKey(): string | undefined {
    return this.snapshot ? (this.snapshot.views_rev ?? this.snapshot.rev) : undefined;
  }

  /**
   * Whether the views read are behind the state of the vault: neither asked at it nor read at it. `views_rev` is the `rev`
   * of `tasks.views`, so views read after a write are not read again when the event of that write comes later.
   */
  private viewsBehind(doc: Snapshot | null = this.snapshot): boolean {
    if (!doc) return false;
    const key = doc.views_rev ?? doc.rev;
    if (key === this.#viewsRev) return false;
    return doc.views_rev === undefined || doc.views_rev !== this.viewsState.doc?.rev;
  }
  /** Blocks of the Today view the person put away. */
  get hiddenTiles(): Tile[] {
    return this.todayState.hidden;
  }
  get tileOrder(): OrderedTile[] {
    return this.todayState.order;
  }
  /** What a move of a block says to a screen reader. */
  get tileNote(): string {
    return this.todayState.note;
  }
  /** The number of the overview whose tasks are shown (none: closed). */
  get countOpen() {
    return this.todayState.countOpen;
  }
  /** The view chosen for each number; what is not here has the default. */
  get countViews() {
    return this.todayState.countViews;
  }
  /** Area names without the prefix `wkdbook-` where that is unambiguous. */
  shortAreas = $state(true);
  /** The choice of the areas shows beside each area how many tasks it would keep (`areaCounts`). */
  areaCountsShown = $state(true);
  /**
   * A list that shows several areas sets them apart (lib/areaBands.ts): a head per area where the order keeps the areas
   * together, a band in the area's colour on each row where it mixes them. A trial; off shows the list as before.
   */
  areaSplit = $state(true);
  /** The list keeps the tasks of each area together (`listed`), in the order the engine gave inside each area. */
  groupAreas = $state(false);
  /** Every second row of a list on a quieter ground. */
  zebra = $state(false);
  /** The saved views and the lists of tasks of the overview leave out the learning tasks (`lib/learning.ts`). */
  learningHidden = $state(false);
  /** XP, levels and rewards in the learning paths (off: none of them, and no notice of a level reached). */
  gamification = $state(true);
  /** The actions at the end of a row of a list, and whether every row shows them all the time (`lib/rowActions.ts`). */
  rowActions = $state.raw<RowActionPrefs>(DEFAULT_ROW_ACTIONS);
  /** The choice of the areas also stands in the bar at the top, for every view (a trial). */
  barAreas = $state(false);
  /** The field the statistics cut the areas up by, and the order of the areas there (`lib/stats.ts`). */
  statsDim = $state<StatDim>('status');
  statsSort = $state<StatSort>('count');
  /** Which tiles "The vault in numbers" shows, as what differs from the tiles it comes with (lib/statsTiles.ts). */
  statsTiles = $state.raw<TilePrefs>(defaultTilePrefs());
  /** Whether the filter bar of the statistics is unfolded. */
  statsFilterOpen = $state(true);
  /** The cards of the statistics that are folded to their head (lib/statsCards.ts). */
  statsFolded = $state.raw<StatsCard[]>([]);
  /** The page is a window of one card of the statistics (`#view=stats&card=...`): it shows that card alone. */
  statsCard = $state<StatsCard | null>(null);
  /** The history in the statistics: the figure, the period and the days of a period of the person's own. */
  statsHistory = $state.raw<HistoryPrefs>(defaultHistoryPrefs());
  /** Where the history was opened from (a number of the overview) and how far that page was scrolled: the way back. */
  historyFrom = $state.raw<{ view: View; scroll: number } | null>(null);
  /** Counted up each time the history is opened from elsewhere: the section then comes into view. */
  historyShown = $state(0);
  /** How far the overview is scrolled again once it is drawn (the way back from the history), else null. */
  todayScroll = $state.raw<number | null>(null);
  /**
   * `auto`: a field of the detail is written as soon as it changes (the default). `manual`: the changes of the fields
   * of a task are held as a draft (`drafts`) until the person saves them, all in one write; the other ways to change
   * a task (board, palette, menus, steps, notes) still write at once.
   */
  saveMode = $state<'auto' | 'manual'>('auto');
  /** Where the page starts and what it shows without a choice (`lib/defaults.ts`, dialog "Defaults ..."). */
  defaults = $state<Defaults>(FACTORY_DEFAULTS);
  /** The unsaved changes of the detail's fields per task id (`manual`): key -> value, `null` takes the key away. */
  drafts = $state<Record<string, Record<string, FieldValue>>>({});
  /**
   * The version of the file (etag) each draft was made on: a save is against it, so a change made meanwhile by
   * another program, or by the board of this page, is a conflict and not overwritten.
   */
  private draftBase: Record<string, string | undefined> = {};
  /** The widths the columns of the list were dragged to (`null`: the default). */
  listColumns = $state<ListColumns>(defaultColumns());
  /** How far each stage of the plan and each column of the board is folded. */
  folds = $state<FoldMemory>(emptyFolds());
  /** How the plan is drawn: its stages as cards, or as a graph (the stages as rows, the dependencies as arrows). */
  planDisplay = $state<PlanDisplay>('stages');
  /** The name this browser reserves tasks under (lib/claims.ts): tells an own claim from one of somebody else. */
  claimName = $state('');
  /** How the comparison of plans is sorted (remembered). */
  compareSort = $state<CompareSort>({ key: 'effort', desc: true });
  /** The rows of the plan graph: the stages of the engine, or the phases of the plan. */
  graphRows = $state<'stage' | 'phase'>('stage');
  /** The order of one's own inside the rows of the plan graph, per plan: shown only, kept in the prefs (D6). */
  graphOrder = $state.raw<GraphOrder>({});
  /** The sizes the person dragged the blocks of the page to (the tiles of today, the list). */
  tileSizes = $state<Sizes>({});
  /** The block whose grip is shown, if any (one at a time). */
  sizing = $state<string | null>(null);
  /** The day of the reader, `YYYY-MM-DD`; renewed when the window is looked at again. */
  today = $state(localToday());
  /** Where the areas hang together, from the engine (null while it has not said, or when it cannot). */
  links = $state<Links | null>(null);
  /** The engine could not answer the last question for the links: the page reads the two kinds from the list. */
  linksFailed = $state(false);
  /** Whether the list shows the finished tasks under the open ones. */
  showFinished = $state(false);
  /** The period and the step the view of the finished tasks was left on. */
  finishedPrefs = $state<FinishedPrefs>(parsePrefs(null));
  /** What the engine says it can do; `null` until it has answered (then nothing is held back). */
  capabilities = $state.raw<string[] | null>(null);
  /** A write is under way: the controls wait. */
  saving = $state(false);
  /** A write is sent and not answered yet: the toast on the screen is not the toast of that write. */
  answering = $state(false);
  /** Settles when the write under way has ended, its re-read included. */
  private settling: Promise<void> | null = null;
  /**
   * How many writes have ended. A control that shows a value the person chose
   * is drawn again from the model after each one: a change that was not made
   * (a conflict, a refusal) must not leave the control showing it.
   */
  writes = $state(0);
  /** The ids marked for a bulk change, in the order they were marked. */
  marks = $state.raw<string[]>([]);
  toast = $state.raw<Toast | null>(null);
  /** The capture dialog is open. */
  capturing = $state(false);
  /** The title the capture dialog opens with: a line of a task that becomes a task of its own. */
  captureTitle = $state('');
  /** The area the capture dialog opens with, for such a line: that of its task. */
  captureArea = $state<string | undefined>(undefined);
  /** The plan, phase or project the capture dialog opens with (a new task made from a plan's or a project's page). */
  captureFill = $state.raw<CaptureFill>({});
  /** A card dropped among cards of another priority, waiting for the person's answer. */
  repriority = $state.raw<{ id: string; from: string; prio: number; ops: Op[] } | null>(null);
  /**
   * A task dropped on an area: what the engine says moving it there would do (a dry run), until the person confirms
   * or gives up. Nothing is written before that.
   */
  dropMove = $state.raw<{
    id: string;
    toArea: string;
    /** How many tasks go: more than one when the dropped task is one of several marked ones (they go together). */
    count: number;
    /** The version of the file the dry run was made for (one task): the move is written under it, not under a newer one. */
    etag?: string;
    /** The dry run of one task. */
    answer: Awaited<ReturnType<App['previewMove']>> | null;
    /** The dry run of the marked tasks (`count` > 1), per task. */
    checks: MoveCheck[] | null;
    /** Asked from a view: once written, the view says where the card went and follows it (`areaMoved`). */
    fromView?: boolean;
  } | null>(null);
  /** A task whose area the person wants to choose (no drag: the key or the button of the row), until it is chosen. */
  dropChoose = $state<string | null>(null);
  #dropAsks = 0;
  /** The estimate matrix (its own state: `state/matrix.svelte.ts`). */
  readonly matrixState = new MatrixState({
    lang: () => this.lang,
    tasks: () => this.tasks,
    estimate: (request, signal) => this.env.hub.estimate(request, signal),
  });
  get matrix() {
    return this.matrixState.matrix;
  }
  get matrixDraft(): Draft {
    return this.matrixState.draft;
  }
  set matrixDraft(value: Draft) {
    this.matrixState.draft = value;
  }
  get matrixFigures() {
    return this.matrixState.figures;
  }
  get matrixProblem() {
    return this.matrixState.problem;
  }
  /** The figures shown are for an older draft than the table: a question is due or under way. */
  get matrixPending(): boolean {
    return this.matrixState.pending;
  }
  /** The repo tiles of this device (their own state: `state/repos.svelte.ts`). */
  readonly reposState = new ReposState({
    repos: () => this.env.hub.repos(),
    repoAdd: (body) => this.env.hub.repoAdd(body),
    repoSuggest: () => this.env.hub.repoSuggest(),
    repoSave: (body) => this.env.hub.repoSave(body),
  });

  /**
   * The mail the hub writes for the reminders of `ids` to the address `to`, in the language of the page. With `shown`
   * (the mail the page showed) the hub sends it, and only if it is still that mail. A refusal is an `ApiError` with
   * the hub's code (the view of the reminders words it).
   */
  remindersMail(to: string, ids: string[], shown?: RemindersMail): Promise<RemindersMail> {
    const lang = this.lang === 'de' ? 'de' : 'en';
    return this.env.hub.remindersMail(shown ? { to, ids, lang, send: true, digest: shown.digest } : { to, ids, lang, send: false });
  }

  /** The state of the repo of a tile (its checkout, the CI of its newest push), as the hub asks `git` and `gh`. */
  repoStatus(id: string, fresh: boolean): Promise<RepoStatus> {
    return this.env.hub.repoStatus(id, fresh);
  }

  /** A text onto the clipboard (a command to paste into a terminal); false when the browser did not let it. */
  copyText(text: string): Promise<boolean> {
    return this.env.out.copy(text);
  }

  /** The image of a tile, read with the session. */
  repoImage(id: string): Promise<Blob | null> {
    return this.env.hub.repoImage(id);
  }

  /** Show the folder of a tile in the file manager, or start Neovim in it, on the machine of the hub. */
  async openRepo(id: string, what: 'folder' | 'nvim'): Promise<void> {
    try {
      await this.env.hub.repoOpen(id, what);
    } catch (error) {
      this.say('error', 'repos.open_failed', { message: error instanceof Error ? error.message : '' });
    }
  }

  /** The graph of one task in the plan view (its own state: `state/graph.svelte.ts`). */
  readonly graphState = new GraphState({
    ready: () => this.phase === 'ready',
    can: (capability) => this.can(capability),
    lang: () => this.lang,
    rev: () => this.snapshot?.rev,
    showPlan: () => this.setView('plan'),
    planFor: (id, direction) => this.env.hub.planFor(id, direction),
  });
  get graph() {
    return this.graphState.graph;
  }
  get graphDoc() {
    return this.graphState.doc;
  }
  get graphProblem() {
    return this.graphState.problem;
  }
  get graphWantsFocus(): boolean {
    return this.graphState.wantsFocus;
  }
  set graphWantsFocus(value: boolean) {
    this.graphState.wantsFocus = value;
  }
  /** The check of the vault as a job and its findings (its own state: `state/check.svelte.ts`). */
  readonly checkState = new CheckState({
    ready: () => this.phase === 'ready',
    can: (capability) => this.can(capability),
    lang: () => this.lang,
    rev: () => this.snapshot?.rev,
    tasks: () => this.tasks,
    checkStart: (request) => this.env.hub.checkStart(request),
    checkState: () => this.env.hub.checkState(),
  });
  get checking(): boolean {
    return this.checkState.checking;
  }
  get checkJob() {
    return this.checkState.job;
  }
  get checkProblem() {
    return this.checkState.problem;
  }
  /** A card that goes to the blocked column and has no blocker yet, waiting for the person's answer. */
  blocking = $state.raw<{ id: string } | null>(null);
  /** The changes the engine refused because the file moved on (its own state: `state/conflicts.svelte.ts`). */
  /** The vaults the hub can read (its own state: `state/vaults.svelte.ts`). */
  readonly vaultsState = new VaultsState({
    ready: () => this.phase === 'ready',
    vaults: () => this.env.hub.vaults(),
    selectVault: (name) => this.env.hub.selectVault(name),
    addVault: (name, path) => this.env.hub.addVault(name, path),
    removeVault: (name) => this.env.hub.removeVault(name),
    createVault: (path, area) => this.env.hub.createVault(path, area),
    revealVault: () => this.env.hub.revealVault(),
    pickFolder: () => this.env.hub.pickVaultFolder(),
    say: (kind, key, params) => this.say(kind, key, params),
  });
  get vaultList(): VaultList | null {
    return this.vaultsState.list;
  }
  get managingVaults(): boolean {
    return this.vaultsState.managing;
  }
  get vaultBusy(): boolean {
    return this.vaultsState.busy;
  }
  get vaultsFailed(): boolean {
    return this.vaultsState.failed;
  }
  /** The first start in the page (its own state: `state/setup.svelte.ts`). */
  readonly setupState = new SetupState({
    setup: () => this.env.hub.setup(),
    setupVault: (area) => this.env.hub.setupVault(area),
    setupExample: () => this.env.hub.setupExample(),
    setupNvim: () => this.env.hub.setupNvim(),
    installProgram: (autostart, shortcut) => this.env.hub.installProgram(autostart, shortcut),
    declineInstall: () => this.env.hub.declineInstall(),
    reload: () => (this.env.reload ?? (() => undefined))(),
  });
  /** The Info dialog (its own state: `state/about.svelte.ts`). */
  readonly aboutState = new AboutState({
    available: () => this.phase === 'ready' || (this.phase === 'unavailable' && this.env.hub.hasToken),
    about: () => this.env.hub.about(),
  });
  get about(): AboutDialog {
    return this.aboutState.dialog;
  }
  /** What this build is, for the dialog that updates the web variant (the Info dialog keeps its own). */
  readAbout(): Promise<About> {
    return this.env.hub.about();
  }
  /**
   * How the page runs, as the page that made the app says it (`Env.mode`): `web` for the web variant, `null` for the
   * page of the hub. Known before the first read, so nothing the web variant cannot do is ever shown there.
   */
  readonly mode: 'web' | null;
  /** The vault is shown only (`Env.readOnly`): a banner says so, a change is refused with the reason. */
  readonly readOnly: boolean;
  /**
   * The controls that change a task are not to be used now: a write is under way, or the page shows the vault read
   * only. What the views lock (`disabled`, `readonly`, `draggable`) reads this, not `saving`.
   */
  get locked(): boolean {
    return this.saving || this.readOnly;
  }
  /**
   * The page can start something on the machine or read from it: show the vault's folder in the file explorer, open a
   * task's file in the editor, attach a screenshot from the clipboard or the screenshot folder. The web variant cannot
   * (it has no hub), so it does not offer them.
   */
  get machineActions(): boolean {
    return this.mode !== 'web';
  }
  /** A screenshot can be attached to a task: the engine can, and the page has a machine to take it from. */
  get canAttach(): boolean {
    return this.machineActions && this.can('attach');
  }
  readonly conflictsState = new ConflictsState((mode) => safe(() => this.env.prefs.setItem('tasks-desktop.conflict-mode', mode)));
  get conflicts(): Conflict[] {
    return this.conflictsState.list;
  }
  /** The conflict center is open. */
  get conflictsOpen(): boolean {
    return this.conflictsState.open;
  }
  /** How the conflict center shows its list: every conflict (the default), or one at a time. */
  get conflictMode(): ConflictMode {
    return this.conflictsState.mode;
  }
  /** What the tile Today shows: the kind of period, the days of a named one, the evaluations chosen. */
  get dailyPrefs() {
    return this.todayState.daily;
  }
  /** The command palette is open. */
  palette = $state(false);
  /** What the palette's choices were, to put them first next time. */
  frecency = $state.raw<Frecency>({});
  /** The run of test sheets, as the hub last told it. */
  sheetRun = $state.raw<SheetRunState | null>(null);
  /** The check over all vaults, as the hub last told it. */
  checkAll = $state.raw<CheckAll | null>(null);
  /** The version of this program, for the hint of its mark. */
  appVersion = $state('');
  /** Whether the hub starts at login; null: nothing to switch here. */
  autostart = $state<boolean | null>(null);
  /** Whether a hub in the background stays without a page (`keep_running`); null: nothing to switch here. */
  keepRunning = $state<boolean | null>(null);
  /** ai-desktop as the hub finds it; null: nobody can say (the web variant), and the Options menu has no switch. */
  aiDesktop = $state<AiDesktop | null>(null);
  /** The switch "Show AI functions" (`tasks-desktop.ai`): on unless turned off; it only counts where ai-desktop is found. */
  aiWanted = $state(true);
  /** The task the dialog "Hand to an agent" is open for; null: closed. */
  agentFor = $state<string | null>(null);
  /** What a hand-over does by default: only fill in the job (`prefill`) or run it at once; kept (`tasks-desktop.agent-mode`). */
  agentMode = $state<'prefill' | 'run'>('prefill');
  /**
   * Open the dashboard of ai-desktop at the job after a hand-over (a tab of its own): off by default, kept
   * (`tasks-desktop.agent-dashboard`). Without it the hub cannot bring ai-desktop to the front (it runs in the
   * background), so Windows only flashes its button in the task bar.
   */
  agentDashboard = $state(false);
  /** A hand-over is under way: the dialog sends nothing twice. */
  agentSending = $state(false);
  /**
   * A review of a finished task or a prepared decision, on its way or back (one at a time): what the dialog
   * "Answer of the agent" shows. Nothing is written until the person adopts it.
   */
  answer = $state.raw<AnswerView | null>(null);
  /** Counts the runs: a closed or replaced one stops watching its job. */
  #answerRun = 0;
  /** The yes or no to a job that waits for one (a private area on a model that is not local). */
  #answerConfirm: ((yes: boolean) => void) | null = null;
  /** The plan wizard is open. */
  planning = $state(false);
  /** The task that is being finished, with what the engine says that does. */
  finishing = $state.raw<{ id: string; preview: DonePreview } | null>(null);
  private opCount = 0;
  selectedId = $state<string | null>(null);
  /** The plan the plan view is narrowed to ('': every task); kept when the view is left. */
  planChoice = $state('');
  /** The learning path open in the view of the learning paths ('': none chosen yet); kept when the view is left. */
  pathChoice = $state('');
  /**
   * The project the plan view shows as its page (`ProjectPage`) while no plan is chosen; empty for none. Choosing a plan
   * in the plan view's choice leaves it, the trail over a plan of a project comes back to it.
   */
  projectChoice = $state('');
  /** What the plan wizard makes (a plan or a project) and the project a new plan goes to. */
  planningKind = $state<PlanKind>('plan');
  planningProject = $state('');
  /** The area the plan wizard opens with (the area of the task it was opened for); undefined: the area written to. */
  planningArea = $state<string | undefined>(undefined);
  /**
   * What happens with the new plan when the wizard was opened from a choice (the plan of a task): it is handed the id
   * instead of the plan view opening the plan.
   */
  private planningThen: ((id: string) => void) | null = null;

  tasks = $state.raw<TaskEntry[]>([]);
  /**
   * The keys of the view on screen that has its own (the acceptance: `j`/`k` over its points, Space ticks): the view sets
   * it while it is shown and takes it away when it goes. Called by the page's key handler after the keys every view has
   * (dialogs, typing, the `g` chord); true when it took the key.
   */
  viewKeys: ((event: KeyboardEvent) => boolean) | null = null;
  snapshot = $state.raw<Snapshot | null>(null);
  /** The named lists of the engine (read only; the ones of the editor, built in, or from its configuration). */
  engineLists = $state.raw<EngineList[]>([]);
  #engineListsAsked = false;
  /** The ranges the property form offers: the engine's (`hello.enums`) once the hub has passed them on. */
  ranges = $state.raw<Ranges>(DEFAULT_RANGES);
  #enumsAsked = false;
  /** The named lists of every vault this browser knows (a filter and an order under a name). */
  listMemory = $state.raw<ListMemory>({});
  /** The order the list is shown in: a word of the engine's `--sort`, or its plan order. */
  sort = $state<SortWord>('default');
  /** The places the engine gave the ids for `sort`; a task it does not name yet comes after the named ones. */
  #order = $state.raw<Map<string, number> | null>(null);
  #orders = 0;
  next = $state.raw<Next | null>(null);
  /** What the parked tasks wait for, as the engine counts it (`waits`); `null` until read, or for an engine without it. */
  waits = $state.raw<Waits | null>(null);
  hubAreas = $state.raw<HubArea[]>([]);
  detail = $state.raw<Detail>({ state: 'none' });
  /** What the hub found in the text of the tasks for the words in the filter. */
  textSearch = $state.raw<{ query: string; result: SearchResult } | null>(null);
  /** When the list shown was saved, if it is from the cache and not yet confirmed. */
  cachedAt = $state<number | null>(null);

  private etag: string | null = null;
  /** The page was stopped (the kit's `StreamSession` knows). */
  private get stopped(): boolean {
    return this.stream.stopped;
  }
  /** The read in progress (and the reads it repeats), if any. */
  private loop: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly env: Env) {
    this.mode = env.mode ?? null;
    this.readOnly = env.readOnly === true;
    // Made here, not as a field: it reads the profile at once, and the fields are made before `env` is held.
    this.todayState = new TodayState({
      lang: () => this.lang,
      getItem: (key) => safe(() => env.prefs.getItem(key)),
      setItem: (key, value) => void safe(() => env.prefs.setItem(key, value)),
    });
    this.minutesShortcuts = parseShortcuts(safe(() => env.prefs.getItem(MINUTES_SHORTCUTS_KEY)));
    this.viewsState = new ViewsState({
      can: (capability) => this.can(capability),
      rev: () => this.snapshot?.rev,
      views: () => env.hub.views(),
      groupings: () => env.hub.groupings(),
      // A change while a write is on its way is refused with a word, as on the board (not dropped without one).
      write: (ops) => (this.refusedWhileSaving() ? Promise.resolve(null) : this.write(ops)),
      readOnly: () => this.readOnly,
      remembered: () => safe(() => env.prefs.getItem(OPEN_VIEW_KEY)) || null,
      // The id names its area: it is kept only for an area whose class may be kept in the browser (as the cache).
      remember: (id) => {
        const keep = id !== null && this.mayRememberArea(areaOfId(id));
        safe(() => env.prefs.setItem(OPEN_VIEW_KEY, keep ? id : ''));
      },
    });
    this.prefs = new Preferences<Lang>(
      env.prefs,
      { lang: 'tasks-desktop.lang', theme: 'tasks-desktop.theme', shortcuts: 'tasks-desktop.shortcuts' },
      LANGS,
      env.preferredLanguages,
      'en',
    );
    this.shortAreas = safe(() => env.prefs.getItem('tasks-desktop.short-areas')) !== 'off';
    this.areaCountsShown = safe(() => env.prefs.getItem('tasks-desktop.area-counts')) !== 'off';
    this.areaSplit = safe(() => env.prefs.getItem('tasks-desktop.area-split')) !== 'off';
    this.zebra = safe(() => env.prefs.getItem('tasks-desktop.zebra')) === 'on';
    this.learningHidden = safe(() => env.prefs.getItem('tasks-desktop.hide-learning')) === 'on';
    this.gamification = safe(() => env.prefs.getItem('tasks-desktop.gamification')) !== 'off';
    this.rowActions = parseRowActions(safe(() => env.prefs.getItem('tasks-desktop.row-actions')) ?? null);
    this.groupAreas = safe(() => env.prefs.getItem('tasks-desktop.group-areas')) === 'on';
    this.barAreas = safe(() => env.prefs.getItem('tasks-desktop.bar-areas')) === 'on';
    this.aiWanted = safe(() => env.prefs.getItem('tasks-desktop.ai')) !== 'off';
    this.agentMode = safe(() => env.prefs.getItem('tasks-desktop.agent-mode')) === 'run' ? 'run' : 'prefill';
    this.agentDashboard = safe(() => env.prefs.getItem('tasks-desktop.agent-dashboard')) === 'on';
    const stats = parseStatsPrefs(safe(() => env.prefs.getItem('tasks-desktop.stats')));
    this.statsDim = stats.dim;
    this.statsSort = stats.sort;
    this.statsTiles = parseTilePrefs(safe(() => env.prefs.getItem('tasks-desktop.stats-tiles')));
    this.statsFilterOpen = safe(() => env.prefs.getItem('tasks-desktop.stats-filter')) !== 'closed';
    this.statsFolded = parseCardFolds(safe(() => env.prefs.getItem('tasks-desktop.stats-folds')));
    this.statsHistory = parseHistoryPrefs(safe(() => env.prefs.getItem('tasks-desktop.stats-history')));
    this.saveMode = safe(() => env.prefs.getItem('tasks-desktop.save-mode')) === 'manual' ? 'manual' : 'auto';
    this.listColumns = parseColumns(safe(() => env.prefs.getItem('tasks-desktop.list-columns')));
    this.folds = parseFolds(safe(() => env.prefs.getItem('tasks-desktop.folds')));
    const display = safe(() => env.prefs.getItem('tasks-desktop.plan-display'));
    this.planDisplay = display === 'graph' || display === 'compare' ? display : 'stages';
    this.compareSort = parseCompareSort(safe(() => env.prefs.getItem('tasks-desktop.compare-sort')) ?? null);
    this.claimName = cleanClaimName(safe(() => env.prefs.getItem('tasks-desktop.claim-name')) ?? '');
    this.graphRows = safe(() => env.prefs.getItem('tasks-desktop.graph-rows')) === 'phase' ? 'phase' : 'stage';
    this.graphOrder = parseGraphOrder(safe(() => env.prefs.getItem('tasks-desktop.graph-order')));
    this.tileSizes = parseSizes(safe(() => env.prefs.getItem('tasks-desktop.sizes')));
    this.defaults = parseDefaults(safe(() => env.prefs.getItem(DEFAULTS_KEY)));
    // The filter and the order used last, or the defaults where there are none (or when the person starts with them).
    const start = startChoice(this.defaults, {
      filter: safe(() => env.prefs.getItem('tasks-desktop.filter')) ?? null,
      sort: safe(() => env.prefs.getItem('tasks-desktop.sort')) ?? null,
    });
    this.sort = start.sort;
    this.listMemory = parseListMemory(safe(() => env.prefs.getItem('tasks-desktop.lists')));
    const remembered = start.filter;
    this.#filter = parseFilter(remembered);
    this.#filterVault = filterVaultOf(remembered);
    this.frecency = parseFrecency(safe(() => env.prefs.getItem('tasks-desktop.frecency')));
    this.conflictsState.mode = parseConflictMode(safe(() => env.prefs.getItem('tasks-desktop.conflict-mode')));
    this.finishedPrefs = parsePrefs(safe(() => env.prefs.getItem('tasks-desktop.finished')));
    // The page opens on the view it was left on, or on the one the defaults name.
    this.view = startView(this.defaults, safe(() => env.prefs.getItem('tasks-desktop.view')) ?? null);
  }

  /** Change the defaults; kept in this browser at once. */
  setDefaults(patch: Partial<Defaults>): void {
    this.defaults = { ...this.defaults, ...patch };
    safe(() => this.env.prefs.setItem(DEFAULTS_KEY, serializeDefaults(this.defaults)));
  }

  /** The filter shown now becomes the default one, with the vault it was made in (the search words are not part). */
  takeFilterAsDefault(): void {
    this.setDefaults({ filter: serializeFilter(this.#filter, this.#filterVault) });
  }

  /**
   * The filter and the order go back to the defaults. A default filter made in another vault is not taken over (its
   * areas, tags and plans are not those of this one): the list shows everything then.
   */
  applyDefaults(): void {
    const text = this.defaults.filter || null;
    const vault = filterVaultOf(text);
    const foreign = text !== null && typeof vault === 'string' && typeof this.#hubVault === 'string' && vault !== this.#hubVault;
    // The default filter is of its own vault, not of the one the filter shown before was made in: when the hub has not
    // named its vault yet, `loadVaults` then judges it by the right one.
    if (!foreign && text !== null) this.#filterVault = vault;
    this.filter = foreign ? freshFilter() : parseFilter(text);
    this.scheduleTextSearch('', 0);
    this.setSort(this.defaults.sort);
  }

  /** Everything of the dialog back as it came: the defaults, the switches beside them, and filter and order. */
  resetToFactory(): void {
    this.setDefaults(FACTORY_DEFAULTS);
    this.setShortAreas(true);
    this.setAreaCounts(true);
    this.setAreaSplit(true);
    this.setZebra(false);
    this.setLearningHidden(false);
    this.setRowActions(DEFAULT_ROW_ACTIONS);
    this.setGroupAreas(false);
    this.setBarAreas(false);
    this.setSaveMode('auto');
    for (const view of LAYOUT_VIEWS) this.resetLayout(view);
    this.applyDefaults();
  }

  /**
   * Whether the layout of a view is not as it came: what `resetLayout` would change. The list: the widths of its
   * columns and the size of its block; the plan: stages or graph or comparison, the rows and the order of the graph, the
   * sort of the comparison, the folded stages; the statistics: the field and the order; Today: the order, the hidden
   * blocks and their sizes.
   */
  layoutChanged(view: LayoutView): boolean {
    switch (view) {
      case 'list':
      {
        // Column by column: the same widths in another order of the keys are no change.
        const first = defaultColumns();
        return COLUMN_KEYS.some((key) => this.listColumns[key] !== first[key]) || this.tileSizes.list !== undefined;
      }
      case 'plan': {
        const sort = parseCompareSort(null);
        return (
          this.planDisplay !== 'stages' ||
          this.graphRows !== 'stage' ||
          Object.keys(this.graphOrder).length > 0 ||
          this.compareSort.key !== sort.key ||
          this.compareSort.desc !== sort.desc ||
          Object.keys(this.folds.plan).length > 0
        );
      }
      case 'stats': {
        const stats = parseStatsPrefs(null);
        return (
          this.statsDim !== stats.dim ||
          this.statsSort !== stats.sort ||
          !isDefaultTiles(this.statsTiles) ||
          !this.statsFilterOpen ||
          this.statsFolded.length > 0 ||
          !isDefaultHistory(this.statsHistory)
        );
      }
      case 'today':
        return this.tileOrderChanged || this.hiddenTiles.length > 0 || TODAY_TILES.some((tile) => this.tileSizes[tile] !== undefined);
    }
  }

  /** Put the layout of one view back as it came (`layoutChanged` says what that is). Nothing of the vault changes. */
  resetLayout(view: LayoutView): void {
    switch (view) {
      case 'list':
        this.setListColumns(defaultColumns());
        this.setTileSize('list', null);
        return;
      case 'plan':
        this.setPlanDisplay('stages');
        this.setGraphRows('stage');
        this.graphOrder = {};
        safe(() => this.env.prefs.setItem('tasks-desktop.graph-order', '{}'));
        this.setCompareSort(parseCompareSort(null));
        this.setFolds('plan', {});
        return;
      case 'stats': {
        const stats = parseStatsPrefs(null);
        this.setStats(stats.dim, stats.sort);
        this.setStatsTiles(defaultTilePrefs());
        this.setStatsFilterOpen(true);
        this.statsFolded = [];
        safe(() => this.env.prefs.setItem('tasks-desktop.stats-folds', '[]'));
        this.setStatsHistory(defaultHistoryPrefs());
        return;
      }
      case 'today':
        this.resetTileOrder();
        this.showTiles();
        for (const tile of TODAY_TILES) if (this.tileSizes[tile] !== undefined) this.setTileSize(tile, null);
        return;
    }
  }

  // ── derived ───────────────────────────────────────────────────────────

  /** For every task the areas it touches (its own and those of the tasks it is linked with). */
  crossIndex = $derived.by(() => {
    const doc = this.linksNow;
    if (doc) return indexOfLinks(doc);
    // The engine will say: nothing is shown from the list meanwhile (it would be a second rule, and a flicker).
    if (this.linksPending) return new Map<string, Set<string>>();
    return touchedAreas(this.tasks);
  });

  /** The links of the state of the list that is shown, or null (an older state is never shown as the current one). */
  get linksNow(): Links | null {
    return this.links !== null && this.links.rev === this.snapshot?.rev ? this.links : null;
  }

  /** The engine has links and the answer for this state is still on its way. */
  get linksPending(): boolean {
    return this.capabilities !== null && this.can('links') && !this.linksFailed && this.linksNow === null;
  }

  /** The ids the engine counts as quick wins (its figure of the estimate), or undefined when the engine gave none. */
  quickWinSet = $derived.by((): ReadonlySet<string> | undefined => {
    const ids = this.snapshot?.estimate?.quick_wins;
    return ids === undefined ? undefined : new Set(ids);
  });

  /** The projects of the vault (capability `projects`; none from an older engine). */
  projects = $derived.by((): Project[] => projectsOf(this.snapshot));

  /** For every plan of a project, the project's id. */
  private planProjectIndex = $derived.by(() => planProjects(this.snapshot?.plans ?? []));

  /** The project a task belongs to: its own or that of its plan (`projects.ts`). */
  readonly projectOf = (task: TaskEntry): string | undefined => projectOfTask(task, this.planProjectIndex);

  /** The engine's area groups (`area_groups` of the snapshot): a name that stands for several areas in a filter. */
  areaGroups = $derived.by((): readonly AreaGroupInfo[] => this.snapshot?.area_groups ?? this.cachedGroups);

  /** The area groups of the cached list: a group chosen before keeps its meaning until the snapshot is there. */
  cachedGroups = $state.raw<readonly AreaGroupInfo[]>([]);

  /** Whether `name` is an area group in force (no area of that name). */
  isAreaGroup(name: string): boolean {
    return isAreaGroup(name, this.areaGroups, this.allAreaNames);
  }

  /** `filter` as the list matches it: a chosen area group stands for its member areas (an area of that name wins). */
  matchFilter(filter: Filter): Filter {
    const areas = expandAreas(filter.areas, this.areaGroups, this.allAreaNames);
    const named = filter.claims.length > 0 ? { claimant: this.claimName } : {};
    return areas === filter.areas && filter.claims.length === 0 ? filter : { ...filter, areas: [...areas], ...named };
  }

  /** The areas the filter means, groups resolved: what a part of the page that reads the chosen areas compares with. */
  get matchAreas(): readonly string[] {
    return this.matchFilter(this.filter).areas;
  }

  /**
   * The area a new task or plan most likely goes to: the one area the filter means (an area group with one member
   * counts). A group is never a place to write to, so a name that is no area of the vault is not offered.
   */
  get writeArea(): string | undefined {
    const areas = this.matchAreas;
    return areas.length === 1 && this.allAreaNames.includes(areas[0] ?? '') ? areas[0] : undefined;
  }

  /**
   * The one name the finished tasks are asked for: one area, or one area group (the engine resolves it and pages its
   * members). Undefined for several names (the page filters a page of all) or for only empty groups (`NO_AREA`).
   */
  get finishedArea(): string | undefined {
    const chosen = this.filter.areas;
    if (chosen.length === 1 && this.isAreaGroup(chosen[0] ?? '')) return chosen[0];
    const areas = this.matchAreas;
    return areas.length === 1 && areas[0] !== NO_AREA ? areas[0] : undefined;
  }

  get shown(): TaskEntry[] {
    const filtered = applyFilter(this.tasks, this.matchFilter(this.filter), this.today, this.crossIndex, this.quickWinSet, this.projectOf);
    return this.sort === 'default' ? filtered : applyOrder(filtered, this.#order);
  }

  /**
   * What the list shows, in the order of its rows: `shown`, with the tasks of each area together when the list groups
   * by area (the order of the engine stays inside each area). The keys of the list and its export go along these rows.
   */
  get listed(): readonly TaskEntry[] {
    return this.groupAreas ? groupedByArea(this.shown) : this.shown;
  }

  /** The open tasks a saved view shows: its selection found the way the list finds its filter. */
  tasksOfView(view: SavedView): TaskEntry[] {
    const tasks = applyFilter(this.tasks, this.matchFilter(filterOfSelect(view.select)), this.today, this.crossIndex, this.quickWinSet, this.projectOf);
    // A view that asks for the learning tasks by name (its selection names the tag `learning`) keeps them.
    return withoutLearning(tasks, this.learningHidden && !(view.select.tags ?? []).includes(LEARNING));
  }

  /**
   * The values of the derived fields of a grouping that the task entry does not hold: `cross` (whether the task connects
   * areas) is the engine's `tasks.links` - `several` for a task it names among those that touch two or more areas;
   * `project` is the project of the task's plan, or its own (the entry holds only its own: `projectOf`, the rule of the
   * engine's `projects.project_of`).
   */
  readonly derivedValues: Derived = (task, field) => {
    if (field === 'project') {
      const project = this.projectOf(task);
      return project === undefined || project === '' ? [] : [project];
    }
    if (field !== 'cross') return undefined;
    const touched = this.groupCrossIndex.get(task.id);
    return [touched && touched.size >= 2 ? 'several' : 'one'];
  };

  /**
   * The areas of the tasks for the groups of a view: while the links of a new state are on their way (after every write),
   * those of the last state stand in, so that a task does not jump to `one` and back; the connections themselves show
   * no older state as the current one (`crossIndex`).
   */
  private groupCrossIndex = $derived.by(() => (this.linksPending && this.links !== null ? indexOfLinks(this.links) : this.crossIndex));

  /** Show the tab of the views with the view `id` open. */
  openView(id: string): void {
    this.viewsState.choose(id);
    this.setView('views');
  }

  /** Show the tab of the views with `form` as a view being tried (not saved: nothing is written). */
  tryView(form: ViewForm): void {
    if (!this.can('views')) return;
    this.viewsState.try(form);
    this.viewsState.wantsFocus = true;
    this.setView('views');
  }

  /**
   * The entries "open as a view" for `select` (named `title`) of the context menu (`lib/context.ts`). Without views
   * (an older engine) or before the fields of the engine are read there are none, and the browser's menu stays.
   */
  viewMenuEntries(title: string, select: Partial<ViewSelect>): MenuItem[] {
    if (this.phase !== 'ready' || !this.can('views') || !this.can('groupings')) return [];
    const fields = (this.viewsState.groupingsShown?.fields.map((f) => f.field) ?? []).filter(isViewField);
    const t = (key: Key) => translate(this.lang, key);
    return viewMenuItems(
      title,
      { ...emptySelect(), ...select },
      fields,
      {
        open: t('views.menu.open'),
        columns: t('views.display.columns'),
        list: t('views.display.list'),
        matrix: t('views.display.matrix'),
        groupBy: t('views.form.group_by'),
        field: (field) => t(`views.field.${field}` as Key),
      },
      (form) => this.tryView(form),
    );
  }

  /** The named lists of the vault the hub reads. */
  get lists(): NamedList[] {
    return this.listMemory[vaultKey(this.vaultList?.active)] ?? [];
  }

  /** The named list that is exactly the filter and the order shown now, if any. */
  get shownList(): NamedList | undefined {
    return activeListOf(this.lists, this.filter, this.sort);
  }

  #keepLists(next: ListMemory): void {
    this.listMemory = next;
    safe(() => this.env.prefs.setItem('tasks-desktop.lists', serializeListMemory(next)));
  }

  /** Keep the filter and the order shown now under `name` (a list of that name is replaced). Says what came of it. */
  saveList(name: string): 'saved' | 'bad_name' | 'full' | 'wait' {
    // The lists belong to the vault the hub reads: until it has named it (or said it has none) they would be
    // kept under no name and not be found again.
    if (this.#hubVault === undefined) {
      this.say('error', this.vaultsFailed ? 'lists.wait_failed' : 'lists.wait');
      return 'wait';
    }
    const clean = cleanName(name);
    if (clean === null) {
      this.say('error', 'lists.bad_name');
      return 'bad_name';
    }
    const key = vaultKey(this.vaultList?.active);
    const lists = withList(this.lists, makeList(clean, this.filter, this.sort));
    if (lists === null) {
      this.say('error', 'lists.full');
      return 'full';
    }
    this.#keepLists({ ...this.listMemory, [key]: lists });
    this.say('ok', 'lists.saved', { name: clean });
    return 'saved';
  }

  /** Show what the list `name` names: its filter (the search words stay) and its order. */
  applyList(name: string): void {
    const list = this.lists.find((l) => l.name === name);
    if (!list) return;
    this.filter = { ...parseFilter(list.filter), query: this.filter.query };
    this.setSort(list.sort);
  }

  /**
   * Show what a list of the engine names: its filter (the search words stay) and its order. What the page cannot say
   * of it is told, so nobody takes the list for more than it shows.
   */
  applyEngineList(name: string): void {
    const list = this.engineLists.find((l) => l.name === name);
    if (!list) return;
    const applied = fromEngineList(list, this.tasks, { quickWins: this.quickWinSet !== undefined });
    this.filter = { ...applied.filter, query: this.filter.query };
    this.setSort(applied.sort);
    if (applied.unsupported.length > 0) {
      this.say('error', 'lists.engine_partial', { name, words: applied.unsupported.join(', ') });
    }
  }

  /** Ask for the ranges of the fields, once. A hub or an engine that cannot say keeps the defaults of `fields.ts`. */
  async loadEnums(): Promise<void> {
    if (this.#enumsAsked) return;
    this.#enumsAsked = true;
    try {
      void this.readAutostart();
      // Whether the Help menu offers the installation (a hub that runs from a download); the web variant has no hub.
      if (this.env.mode !== 'web') void this.setupState.load();
      void this.readKeepRunning();
      void this.readAiDesktop();
      this.ranges = rangesOf((await this.env.hub.enums()).enums);
    } catch (error) {
      // A session that is gone asks again after the next pairing; any other failure keeps the defaults.
      if (error instanceof ApiError && error.status === 401) this.#enumsAsked = false;
    }
  }

  /** Ask the engine for its lists. A hub or an engine without them shows none; that is no failure to tell. */
  async loadEngineLists(): Promise<void> {
    // Once for this page: the lists of the editor change when somebody saves one there, not with every write.
    if (this.#engineListsAsked) return;
    if (!this.can('lists')) {
      this.engineLists = [];
      return;
    }
    this.#engineListsAsked = true;
    try {
      this.engineLists = (await this.env.hub.lists()).lists;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.#engineListsAsked = false;
        return;
      }
      this.engineLists = [];
    }
  }

  deleteList(name: string): void {
    const key = vaultKey(this.vaultList?.active);
    const lists = withoutList(this.lists, name);
    if (lists.length === this.lists.length) return;
    const next = { ...this.listMemory };
    if (lists.length === 0) delete next[key];
    else next[key] = lists;
    this.#keepLists(next);
    this.say('ok', 'lists.deleted', { name });
  }

  /** Show the list in another order of the engine. The order is asked for at once; until it is there the plan's order stands. */
  setSort(word: SortWord): void {
    if (word === this.sort) return;
    this.sort = word;
    this.#order = null;
    safe(() => this.env.prefs.setItem('tasks-desktop.sort', word));
    void this.readOrder();
  }

  /** Ask the engine for the ids in the order of `sort`. A failure puts the list back in the plan's order and says so. */
  private async readOrder(): Promise<void> {
    const word = this.sort;
    if (word === 'default') {
      this.#order = null;
      return;
    }
    const seq = ++this.#orders;
    try {
      const { ids } = await this.env.hub.order(word);
      if (seq === this.#orders && word === this.sort) this.#order = orderOf(ids);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      if (seq !== this.#orders) return;
      this.sort = 'default';
      this.#order = null;
      safe(() => this.env.prefs.setItem('tasks-desktop.sort', 'default'));
      this.tell('error', 'sort.failed');
    }
  }

  get areaNames(): string[] {
    return [...new Set(this.tasks.map((t) => t.area))];
  }

  /** Every area of the vault, also one that has no open task (a task may be put there). */
  get allAreaNames(): string[] {
    return [...new Set([...this.hubAreas.map((a) => a.name), ...this.areaNames])];
  }

  get selected(): TaskEntry | null {
    return this.tasks.find((t) => t.id === this.selectedId) ?? null;
  }

  // ── preferences ───────────────────────────────────────────────────────

  /** Switches the language once its words are loaded (at once when they are there); a failed load keeps the language. */
  private readonly switchLang = langSwitcher((lang) => this.prefs.setLang(lang));

  setLang(lang: Lang): Promise<void> {
    return this.switchLang(lang).catch(() => this.say('error', 'lang.failed'));
  }

  setShortcuts(on: boolean): void {
    this.prefs.setShortcuts(on);
  }

  // ── writing ───────────────────────────────────────────────────────────

  private opId(): string {
    this.opCount += 1;
    return `ui-${this.env.now().toString(36)}-${this.opCount}`;
  }

  private say(kind: Toast['kind'], key: string, params: Record<string, string | number> = {}, undo?: Op[]): void {
    const text = translate(this.lang, key as Key, params);
    this.toast = { kind, text, ...(undo ? { undo } : {}) };
  }

  dismissToast(): void {
    this.toast = null;
  }

  openCapture(title = '', area?: string, fill: CaptureFill = {}): void {
    if (this.phase !== 'ready') return;
    // Nothing could be created: said at once, not after the form was filled in.
    if (this.refusedReadOnly()) return;
    this.captureTitle = title;
    this.captureArea = area;
    this.captureFill = fill;
    this.capturing = true;
  }

  closeCapture(): void {
    this.capturing = false;
  }

  /** Remember the period and the step of the view of the finished tasks. */
  setFinishedPrefs(prefs: FinishedPrefs): void {
    this.finishedPrefs = prefs;
    safe(() => this.env.prefs.setItem('tasks-desktop.finished', JSON.stringify(prefs)));
  }

  /** The finished tasks of the Backlogs and their figures, for the view of them. */
  /** The open plans side by side (`tasks.plan_compare`): every figure is the engine's. */
  planCompare(signal?: AbortSignal): Promise<PlanCompare> {
    return this.env.hub.planCompare(signal);
  }

  /** The open learning paths with their progress (`tasks.paths`): every figure is the engine's. */
  paths(signal?: AbortSignal): Promise<Paths> {
    return this.env.hub.paths(signal);
  }

  /**
   * The icons of the open learning paths by id: the second step of an item's icon (its own, its path's, its
   * category's; lib/icons.ts). Read once when an item asks (`wantPathIcons`), and each time the paths view reads the
   * list (`rememberPaths`).
   */
  pathIcons = $state<ReadonlyMap<string, PathEntry['icon']>>(new Map());
  #pathIconsAsked = false;

  /** Read the icons of the paths, once: an item of a learning point is shown. */
  wantPathIcons(): void {
    if (this.#pathIconsAsked || !this.can('paths')) return;
    this.#pathIconsAsked = true;
    void this.paths()
      .then((doc) => this.rememberPaths(doc.items))
      .catch(() => {
        this.#pathIconsAsked = false;
      });
  }

  /** The list of the paths as it was read: their icons for the inheritance. */
  rememberPaths(items: readonly Pick<PathEntry, 'id' | 'icon'>[]): void {
    this.pathIcons = new Map(items.map((p) => [p.id, p.icon]));
  }

  /** One learning path with its tree (`tasks.path`): the states, the progress and the derived state are the engine's. */
  path(id: string, signal?: AbortSignal): Promise<PathDocument> {
    return this.env.hub.path(id, signal);
  }

  finished(
    query: { area?: string; plan?: string; since?: string; until?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ): Promise<Finished> {
    return this.env.hub.finished(query, signal);
  }

  /** Whether the engine can do `capability`; true while it has not said (the cached list is shown first). */
  can(capability: string): boolean {
    return this.capabilities === null || this.capabilities.includes(capability);
  }

  /** May the id of this task be kept in the browser? The class of its area decides, as for the cache. */
  private mayRemember(id: string): boolean {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return false;
    return this.mayRememberArea(task.area);
  }

  /** May a name of this area (an id under it) be kept in the browser? Its class decides, as for the cache. */
  private mayRememberArea(area: string | undefined): boolean {
    return area !== undefined && cacheableClass(this.hubAreas.find((a) => a.name === area)?.data_class);
  }

  openConflicts(): void {
    this.conflictsState.show();
  }

  closeConflicts(): void {
    this.conflictsState.hide();
  }

  /** The way the conflict center shows its list, kept in this browser. */
  setConflictMode(mode: ConflictMode): void {
    this.conflictsState.setMode(mode);
  }

  /** Let a refused change go. */
  discardConflict(key: string): void {
    this.conflictsState.discard(key);
  }

  discardAllConflicts(): void {
    this.conflictsState.discardAll();
  }

  /**
   * Try a refused change again, on the version the task has now (the person has seen both and chose). It leaves the
   * list first; a second refusal puts it back as a new entry.
   */
  async retryConflict(key: string): Promise<void> {
    const conflict = this.conflictsState.find(key);
    // Not now (a write is under way, or the page is not connected): the entry stays, nothing is lost.
    if (!conflict || this.saving || this.phase !== 'ready') return;
    const op = retryOp(conflict, this.tasks.find((t) => t.id === conflict.id));
    if (op === null) return;
    this.conflictsState.discard(key);
    await this.write([op]);
  }

  openPalette(): void {
    if (this.phase !== 'ready') return;
    this.palette = true;
    // The palette names the saved views: read them again when the vault changed since (they are read on a new state
    // only while their tab is shown).
    if (this.can('views') && this.viewsBehind()) void this.readViews();
  }

  closePalette(): void {
    this.palette = false;
  }

  /**
   * Remember that `key` (an action, or the task `taskId`) was chosen. A task is remembered only when its area
   * may be put in the browser: the id of a private or unclassified task would lie in the profile otherwise
   * (rules WEB-17 and SRV-21).
   */
  chose(key: string, taskId?: string): void {
    if (taskId !== undefined && !this.mayRemember(taskId)) return;
    // An action of a saved view names the view's id, and so its area: kept only for an area that may be kept.
    if (key.startsWith(VIEW_ACTION) && !this.mayRememberArea(areaOfId(key.slice(VIEW_ACTION.length)))) return;
    this.frecency = bumped(this.frecency, key, Date.now());
    safe(() => this.env.prefs.setItem('tasks-desktop.frecency', JSON.stringify(this.frecency)));
  }

  openPlanWizard(
    kind: PlanKind = 'plan',
    project = '',
    opts: { area?: string; then?: (id: string) => void } = {},
  ): void {
    if (this.refusedReadOnly()) return;
    if (this.phase !== 'ready' || !this.can(kind === 'project' ? 'project_new' : 'plan_new')) return;
    this.planningKind = kind;
    this.planningProject = kind === 'plan' ? project : '';
    this.planningArea = opts.area;
    this.planningThen = opts.then ?? null;
    this.planning = true;
  }

  /**
   * What finishing a plan or a project by hand would do: a dry run of `plan_close` / `project_close`. `holding` names
   * what keeps it open (the engine refuses then); nothing is written.
   */
  async previewClose(kind: 'plan' | 'project', id: string): Promise<ClosePreview> {
    if (this.readOnly || !this.can(kind === 'plan' ? 'plan_close' : 'project_close')) return { kind: 'unknown' };
    try {
      const result = await this.env.hub.ops({
        client_op_id: this.opId(),
        dry_run: true,
        ops: [{ op: kind === 'plan' ? 'plan_close' : 'project_close', id }],
      });
      const entry = result.results[0];
      if (entry?.ok) return { kind: 'ok' };
      const holding = (entry?.error?.details as { holding?: unknown } | undefined)?.holding;
      if (Array.isArray(holding)) return { kind: 'holding', ids: holding.filter((x): x is string => typeof x === 'string') };
      return { kind: 'refused', message: entry?.error?.message ?? '' };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) return { kind: 'refused', message: error.message };
      return { kind: 'unknown' };
    }
  }

  /**
   * Finish a plan or a project by hand. There is no way back to offer (the engine moves the file and has no inverse for
   * it); a project that the last plan takes with it is said.
   */
  async closePlanFile(kind: 'plan' | 'project', id: string): Promise<boolean> {
    if (!this.can(kind === 'plan' ? 'plan_close' : 'project_close')) return false;
    const result = await this.write([{ op: kind === 'plan' ? 'plan_close' : 'project_close', id }], {
      undoable: false,
      onAnswer: (answer) => {
        const entry = answer.results[0];
        const project = kind === 'plan' ? entry?.projects_closed?.[0] : undefined;
        if (!entry?.ok || project === undefined) return false;
        this.say('ok', 'project.closed_with', { project });
        return true;
      },
    });
    return result?.results.every((r) => r.ok) ?? false;
  }

  /** Show the page of project `id` in the plan view (`''`: the plan view as it was, no project). */
  openProject(id: string): void {
    this.projectChoice = id;
    this.planChoice = '';
    this.setView('plan');
  }

  /** Show plan `id` in the plan view; the project page gives way to it. */
  openPlan(id: string): void {
    this.planChoice = id;
    this.setView('plan');
  }

  /**
   * Change the frontmatter of an open plan (`plan_set`) or project (`project_set`) on the version the snapshot shows
   * (`if_match`: a file changed meanwhile is a conflict, never overwritten): `null` removes a key. The engine
   * judges the change (a project it does not know, a stage the project does not name) and refuses it with the reason;
   * what went through can be taken back (its `inverse`, on the version the change left).
   */
  async setPlanFile(kind: 'plan' | 'project', id: string, patch: Record<string, unknown>): Promise<boolean> {
    if (!this.can(kind === 'plan' ? 'plan_set' : 'project_set')) return false;
    // On the version shown: the snapshot names it (an older engine does not, and the write goes unguarded as before).
    const files: readonly { id: string; etag?: string }[] =
      (kind === 'plan' ? this.snapshot?.plans : this.snapshot?.projects) ?? [];
    const etag = files.find((f) => f.id === id)?.etag;
    const result = await this.write([
      { op: kind === 'plan' ? 'plan_set' : 'project_set', id, patch, ...(etag ? { if_match: etag } : {}) },
    ]);
    return result?.results.every((r) => r.ok) ?? false;
  }

  closePlanWizard(): void {
    this.planningThen = null;
    this.planning = false;
  }

  // ── meetings (concept 7.1, 7.2) ──────────────────────────────────────────────────────────────────────────────────

  /** The form of a new meeting while it is open: what it starts from (the fields, or the proposal of a quick line). */
  meetingDraft = $state<MeetingForm | null>(null);
  /** The words of the quick line the engine could not read (`problems`), shown in the form; and whether it took today. */
  meetingNotes = $state<{ problems: string[]; assumedDay: boolean }>({ problems: [], assumedDay: false });
  /** The meeting whose page is open. */
  meetingOpen = $state<string | null>(null);

  /** The engine can read and make meetings: the form, the page and the section of the task are offered. */
  get canMeetings(): boolean {
    return this.can('meetings') && this.can('meeting');
  }
  get canMakeMeetings(): boolean {
    return this.canMeetings && this.can('meeting_ops') && !this.readOnly;
  }

  /** Now, in milliseconds, by the clock of the page (a test stands it still). */
  nowMs(): number {
    return this.env.now();
  }

  /** The wall time of now, `YYYY-MM-DDTHH:MM`, of this machine. */
  private wallNow(): string {
    return wallTime(this.env.now());
  }

  /** The area a meeting for `tasks` goes to: the first task's, else the one area chosen, else the first one. */
  private meetingArea(tasks: readonly string[], area?: string): string {
    return area ?? (tasks[0] ? areaOfId(tasks[0]) : undefined) ?? this.writeArea ?? [...this.allAreaNames][0] ?? '';
  }

  /** Open the form of a new meeting, for the tasks named (the task of a detail is filled in). */
  openMeetingForm(opts: { tasks?: string[]; area?: string; date?: string; time?: string; duration?: string } = {}): void {
    if (this.refusedReadOnly()) return;
    if (this.phase !== 'ready' || !this.canMakeMeetings) return;
    const tasks = opts.tasks ?? [];
    this.meetingNotes = { problems: [], assumedDay: false };
    const form = emptyMeetingForm(this.meetingArea(tasks, opts.area), this.wallNow(), tasks);
    // The calendar opens it on the day (and the time, the length) the person pointed at.
    if (opts.date !== undefined) form.date = opts.date;
    if (opts.time !== undefined) form.time = opts.time;
    if (opts.duration !== undefined) form.duration = opts.duration;
    this.meetingDraft = form;
  }

  /**
   * The quick capture (concept 5.4): the engine reads the line into a proposal, and the form opens with it. Nothing is
   * written until the person makes the meeting there.
   */
  async quickMeeting(line: string): Promise<void> {
    if (this.refusedReadOnly()) return;
    if (this.phase !== 'ready' || !this.canMakeMeetings || !this.can('meeting_parse')) return;
    try {
      const proposal = await this.env.hub.meetingParse(line);
      const tasks = (proposal.fields.tasks ?? []).filter((id) => typeof id === 'string');
      const base = emptyMeetingForm(this.meetingArea(tasks), this.wallNow());
      this.meetingNotes = { problems: [...proposal.problems], assumedDay: proposal.assumed.includes('date') };
      this.meetingDraft = formOfProposal(base, proposal);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) this.say('error', 'meeting.quick.refused', { message: error.message });
      else this.say('error', 'write.failed', { code: error instanceof ApiError ? error.code : 'offline' });
    }
  }

  closeMeetingForm(): void {
    this.meetingDraft = null;
  }

  /**
   * What the meeting of the form would be called, or why the engine would refuse it: a dry run of `meeting_new`
   * (nothing is written). The rules of a meeting stay the engine's.
   */
  async previewMeeting(form: MeetingForm, signal?: AbortSignal): Promise<MeetingPreview> {
    if (form.title.trim() === '' || form.area === '' || this.readOnly) return { kind: 'unknown' };
    try {
      const result = await this.env.hub.ops({ client_op_id: this.opId(), dry_run: true, ops: [meetingNewOp(form, this.lang)] }, signal);
      const entry = result.results[0];
      if (entry?.ok && typeof entry.id === 'string') return { kind: 'ok', id: entry.id };
      return { kind: 'refused', message: entry?.error?.message ?? '' };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) return { kind: 'refused', message: error.message };
      return { kind: 'unknown' };
    }
  }

  /** The service of a meeting address in the engine's words (`online_service` of `meeting_parse`), or null. */
  async meetingService(online: string, signal?: AbortSignal): Promise<string | null> {
    if (!this.can('meeting_parse') || online.trim() === '' || /\s/.test(online.trim())) return null;
    try {
      const proposal = await this.env.hub.meetingParse(online.trim(), signal);
      return proposal.fields.online !== undefined ? (proposal.online_service ?? null) : null;
    } catch {
      return null;
    }
  }

  /**
   * Make the meeting of the form, then write its participants into `## Teilnehmer` and attach what the form gathered
   * (the first image as its cover, when asked); its page opens. The id is the one the engine gave (another than the dry run's when the name was taken meanwhile).
   */
  async createMeeting(
    form: MeetingForm,
    files: readonly File[] = [],
    screenshot = false,
    coverFirst = false,
  ): Promise<string | undefined> {
    const result = await this.write([meetingNewOp(form, this.lang)], { undoable: false });
    const first = result?.results[0];
    const id = first?.ok && first.outcome === 'created' && typeof first.id === 'string' ? first.id : undefined;
    if (!id) return undefined;
    this.meetingDraft = null;
    const people = participantsText(form.participants);
    if (people !== '') {
      await this.write([{ op: 'set_section', id, heading: `## ${participantsHeading(this.lang)}`, text: people }], { undoable: false });
    }
    // the first image first, when it is to be the cover: its path is the one the engine gave it
    const image = coverFirst ? files.find((f) => kindOfFile(f) === 'image') : undefined;
    if (image) {
      const asset = await this.attachFileAsset(id, image, 'image');
      if (asset) await this.write([{ op: 'meeting_set', id, patch: { cover: asset } }], { undoable: false });
    }
    const rest = files.filter((f) => f !== image);
    if (rest.length > 0 || screenshot) await this.attachAll(id, rest, screenshot);
    this.openMeeting(id);
    return id;
  }

  /** Show the page of meeting `id`. */
  openMeeting(id: string): void {
    if (!this.canMeetings) return;
    this.meetingOpen = id;
  }

  closeMeeting(): void {
    this.meetingOpen = null;
  }

  /**
   * The meetings of task `id`, whenever they are (the engine's order: the earliest first). The task names at most 20
   * (`meetings`), so one page holds them all; a window of the engine's default (30 days back, 90 ahead) or of a year
   * would leave out a meeting the task counts. A series is listed as its occurrences: `since` reads from a later day.
   */
  meetingsOfTask(id: string, signal?: AbortSignal, since: string = MEETINGS_EVER.since): Promise<Meetings> {
    return this.env.hub.meetings({ task: id, since, until: MEETINGS_EVER.until, limit: 100 }, signal);
  }

  /**
   * The meetings whose days touch the window `since`..`until` (days), the engine's order, all pages (100 each, at most
   * `MEETING_PAGES`: a window of the calendar holds far fewer). `total` is the engine's count of the window: more than
   * `items` when the pages ran out, and the page says that it shows only a part.
   */
  async meetingsIn(since: string, until: string, signal?: AbortSignal): Promise<MeetingWindow> {
    const items: MeetingEntry[] = [];
    let total = 0;
    let offset: number | undefined = 0;
    for (let page = 0; page < MEETING_PAGES && offset !== undefined; page += 1) {
      const answer: Meetings = await this.env.hub.meetings({ since, until, limit: 100, offset }, signal);
      items.push(...answer.items);
      total = answer.total;
      offset = answer.next_offset;
    }
    return { items, total: offset === undefined ? items.length : Math.max(total, items.length + 1) };
  }

  /**
   * Put a meeting on another time (`meeting_set` on the version the calendar showed: another change in between is
   * refused by the engine and said). `patch` is the one of `movePatch`. True when it was written. The toast offers the
   * way back: the engine's inverse puts the old date, time, end and duration back.
   */
  async moveMeeting(m: Pick<MeetingEntry, 'id' | 'etag'>, patch: Record<string, unknown>): Promise<boolean> {
    if (!this.can('meeting_ops')) return false;
    const result = await this.write([{ op: 'meeting_set', id: m.id, patch, ...(m.etag ? { if_match: m.etag } : {}) }]);
    return result?.results.every((r) => r.ok) === true;
  }

  /** Save a board of the drawing surface; the engine's entry, or null when it reached no engine (said). */
  async saveBoard(body: BoardRequest): Promise<BoardSaved | null> {
    if (this.refusedReadOnly()) return null;
    try {
      return (await this.env.hub.board(body)).results[0] ?? null;
    } catch (error) {
      this.say('error', 'write.failed', { code: error instanceof ApiError ? error.code : 'offline' });
      return null;
    }
  }

  /** The small picture of a meeting, read with the session. */
  meetingThumb(id: string): Promise<Blob | null> {
    return this.env.hub.meetingThumb(id);
  }

  /** An image below `assets/` of a container, read with the session; null when there is none to draw. */
  asset(kind: AssetOwner, id: string, file: string): Promise<Blob | null> {
    return this.env.hub.asset(kind, id, file);
  }

  /** The meetings to follow up (the tile Follow-up): over and still planned, or done without a result. */
  review = $state.raw<MeetingEntry[]>([]);

  /** Read the meetings of the last `REVIEW_DAYS` days and keep those to follow up; nothing without the meetings. */
  async loadReview(signal?: AbortSignal): Promise<void> {
    if (!this.canMeetings) {
      this.review = [];
      return;
    }
    const until = this.today;
    const back = new Date(`${until}T12:00:00Z`);
    back.setUTCDate(back.getUTCDate() - REVIEW_DAYS);
    try {
      const window = await this.meetingsIn(back.toISOString().slice(0, 10), until, signal);
      if (signal?.aborted) return;
      this.review = toReview(window.items, this.nowMs(), new Set(this.reviewDismissed()));
    } catch {
      // A read that failed keeps what was shown: the tile is a hint, not a list to trust alone.
    }
  }

  /** The meetings the person put away from the tile ("no result is fine"), kept in this browser. */
  private reviewDismissed(): string[] {
    try {
      const parsed: unknown = JSON.parse(safe(() => this.env.prefs.getItem(REVIEW_DISMISSED_KEY)) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(-REVIEW_KEEP) : [];
    } catch {
      return [];
    }
  }

  /** Put a meeting away from the tile Follow-up; nothing is written to the vault. */
  dismissReview(id: string): void {
    const kept = [...this.reviewDismissed().filter((x) => x !== id), id].slice(-REVIEW_KEEP);
    safe(() => this.env.prefs.setItem(REVIEW_DISMISSED_KEY, JSON.stringify(kept)));
    this.review = this.review.filter((m) => m.id !== id);
  }

  /** One meeting with its body and its sections. */
  readMeeting(id: string, signal?: AbortSignal): Promise<MeetingDocument> {
    return this.env.hub.meeting(id, signal);
  }

  /**
   * Ask the engine what the plan would be called (a dry run: nothing is written, nothing is scanned). The engine's
   * refusal is the answer when the form is not one, so the rules stay in one place.
   */
  async previewPlan(form: PlanForm, signal?: AbortSignal): Promise<PlanPreview> {
    if (form.title.trim() === '' || form.area === '' || this.readOnly) return { kind: 'unknown' };
    // A target task made with the plan: the same dry run asks the id it would get (a bare `new`, see `targetTaskOp`).
    const target = form.targetNew ? this.planTargetTitle(form) : '';
    if (form.targetNew && target === '') return { kind: 'unknown' };
    const ops = form.targetNew ? [planOp(form), targetTaskOp(form, target)] : [planOp(form)];
    try {
      const result = await this.env.hub.ops({ client_op_id: this.opId(), dry_run: true, ops }, signal);
      const entry = result.results[0];
      const made = result.results[1];
      // The plan first: a refused phase of the plan is what the person has to fix, and its chip shows it.
      if (entry && !entry.ok) return refusedPlan(entry.error);
      if (form.targetNew && !(made?.ok && typeof made.id === 'string')) {
        return { kind: 'refused', message: made?.error?.message ?? '' };
      }
      if (entry?.ok && typeof entry.id === 'string') {
        return {
          kind: 'ok',
          id: entry.id,
          renamed: entry.renamed === true,
          ...(form.targetNew && typeof made?.id === 'string' ? { target: made.id } : {}),
        };
      }
      return refusedPlan(entry?.error);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        return { kind: 'refused', message: error.message };
      }
      return { kind: 'unknown' };
    }
  }

  /** The title of the target task the wizard makes: the one typed, else "Done: <plan title>". */
  planTargetTitle(form: PlanForm): string {
    const title = form.title.trim();
    return targetTitle(form, title === '' ? '' : translate(this.lang, 'plan.new.target_default', { title }));
  }

  /**
   * Make the plan, show it in the plan view and choose it there (or hand its id to the choice the wizard was opened
   * from, `openPlanWizard({ then })`). A target task to make goes in the same request,
   * after the plan (so it can be in it): the plan names it by the id the dry run `preview` gave it; when the engine
   * gave it another one meanwhile, the plan is pointed at that one.
   */
  async createPlan(form: PlanForm, preview?: PlanPreview | null): Promise<string | undefined> {
    const planned = preview?.kind === 'ok' ? preview : undefined;
    const making = form.targetNew && planned?.target !== undefined;
    const ops =
      making && planned
        ? [planOp(form, planned.target), targetTaskOp(form, this.planTargetTitle(form), planned.id)]
        : [planOp(form)];
    const result = await this.write(ops, { undoable: false });
    const first = result?.results[0];
    const id = first?.ok && first.outcome === 'created' ? first.id : undefined;
    if (!id) return undefined;
    if (making && planned) await this.settleTarget(form.kind, id, planned, result?.results[1]);
    const then = this.planningThen;
    this.planningThen = null;
    this.planning = false;
    if (then) then(id);
    else if (form.kind === 'project') this.openProject(id);
    else this.openPlan(id);
    return id;
  }

  /**
   * After a plan and its target task were made in one request, put right what moved between the dry run and the write
   * (another session made a file meanwhile): the engine renames a plan whose name is taken, so the task, made for the
   * id the dry run named, is moved to the plan that was made; a task the engine gave another id is named as the target;
   * a task the engine refused leaves the plan without a target instead of one that names no task.
   */
  private async settleTarget(
    kind: PlanKind,
    id: string,
    planned: { id: string; target?: string },
    made: Result['results'][number] | undefined,
  ): Promise<void> {
    if (!made?.ok || typeof made.id !== 'string') {
      await this.setPlanFile(kind, id, { target: null });
      return;
    }
    if (id !== planned.id) {
      const etag = typeof made.etag_after === 'string' ? made.etag_after : undefined;
      await this.write(
        [{ op: 'set', id: made.id, patch: kind === 'project' ? { project: id } : { plan: id }, ...(etag ? { if_match: etag } : {}) }],
        { undoable: false },
      );
    }
    if (made.id !== planned.target) await this.setPlanFile(kind, id, { target: made.id });
  }

  /**
   * Send operations and say what came of them. A part that failed is told per
   * operation; whatever the answer, the list is read again, so the page
   * never stands on a state it guessed.
   */
  /**
   * The last `write` reached no hub (none answered, the hub had no engine, or the page was not ready): nothing of it was
   * written, so it may be sent again as it is (the minutes keep such an entry as a draft). False after any answer, also a
   * refusal, and after an outcome that is not known.
   */
  lastWriteUnsent = false;

  /** The shortcuts of the minutes (concept 7.7), kept in this browser. */
  minutesShortcuts = $state<Shortcuts>(DEFAULT_SHORTCUTS);

  setMinutesShortcuts(shortcuts: Shortcuts): void {
    this.minutesShortcuts = shortcuts;
    safe(() => this.env.prefs.setItem(MINUTES_SHORTCUTS_KEY, JSON.stringify(shortcuts)));
  }

  /** The entries of the minutes of `id` that did not reach the hub yet, kept in this browser until they are written. */
  minutesDrafts(id: string): MinutesDraft[] {
    return draftsOf(safe(() => this.env.prefs.getItem(MINUTES_DRAFTS_KEY)))[id] ?? [];
  }

  setMinutesDrafts(id: string, drafts: readonly MinutesDraft[]): void {
    const all = draftsOf(safe(() => this.env.prefs.getItem(MINUTES_DRAFTS_KEY)));
    if (drafts.length === 0) delete all[id];
    else all[id] = [...drafts];
    safe(() => this.env.prefs.setItem(MINUTES_DRAFTS_KEY, JSON.stringify(all)));
  }

  async write(
    ops: Op[],
    opts: {
      undoable?: boolean;
      tags?: TagEdit;
      /**
       * Told the answer as soon as it is there, before the list is read again (which takes as long as the engine
       * does, and a busy machine makes it long). It returns true when it has said what came of the write itself.
       */
      onAnswer?: (result: Result) => boolean;
      /** The words of a success that fit better than `write.saved` (the way back stays on the toast). */
      saidAs?: (result: Result) => Key | undefined;
    } = {},
  ): Promise<Result | null> {
    // Every way to change a task ends here (keys, palette, menus, drops): refused with the reason, nothing is sent.
    if (this.readOnly) {
      if (this.phase === 'ready') this.say('error', 'write.read_only');
      return null;
    }
    this.lastWriteUnsent = false;
    if (this.saving) return null;
    if (this.phase !== 'ready') {
      this.lastWriteUnsent = true;
      return null;
    }
    this.saving = true;
    this.answering = true;
    let settle!: () => void;
    this.settling = new Promise<void>((resolve) => (settle = resolve));
    try {
      const result = await this.env.hub.ops({ client_op_id: this.opId(), ops });
      this.answering = false;
      this.conflictsState.add(conflictsOf(ops, result, Date.now(), opts.tags));
      const failed = result.results.find((r) => !r.ok);
      if (opts.onAnswer?.(result)) {
        // said already
      } else if (failed) {
        const code = failed.error?.code ?? 'failed';
        // What went through before the failure can still be taken back.
        const undo = opts.undoable === false ? undefined : this.inverseOf(result);
        if (code === 'conflict') this.say('error', 'write.conflict', {}, undo);
        else if (code === 'not_found') this.say('error', 'write.not_found', {}, undo);
        else if (code === 'exists') this.say('error', 'write.exists', {}, undo);
        else if (code === 'invalid_argument' || code === 'forbidden') {
          this.say('error', 'write.invalid', { message: failed.error?.message ?? code }, undo);
        } else this.say('error', 'write.failed', { code }, undo);
      } else {
        const undo = opts.undoable === false ? undefined : this.inverseOf(result);
        // A reorder numbers the neighbours where the spot needs it: more than one file is told.
        const files = result.results.reduce((n, r) => n + (r.writes ?? 0), 0);
        if (files > 1) this.say('ok', 'write.saved_many', { n: files }, undo);
        else this.say('ok', opts.saidAs?.(result) ?? 'write.saved', {}, undo);
      }
      await this.readAfter(ops);
      return result;
    } catch (error) {
      this.answering = false;
      if (error instanceof ApiError && error.code === 'outcome_unknown') {
        this.say('error', 'write.unknown');
      } else if (error instanceof ApiError && error.status === 409) {
        this.conflictsState.add(conflictsOfRequest(ops, Date.now(), opts.tags));
        this.say('error', 'write.conflict');
      } else if (error instanceof ApiError && error.code === 'read_only') {
        this.say('error', 'write.read_only');
      } else if (error instanceof ApiError && error.code === 'attach_no_folders') {
        // The hub reads no folder for the newest screenshot unless its settings name some.
        this.say('error', 'attach.no_folders');
      } else if (error instanceof ApiError && error.status === 400) {
        this.say('error', 'write.invalid', { message: error.message });
      } else {
        this.say('error', 'write.failed', {
          code: error instanceof ApiError ? error.code : 'offline',
        });
      }
      // No answer of the hub, or a hub without an engine: nothing of it was written (an unknown outcome is not this).
      this.lastWriteUnsent =
        !(error instanceof ApiError) || error.code === 'offline' || error.code === 'engine_unavailable' || error.status === 503;
      await this.readAfter(ops);
      return null;
    } finally {
      this.saving = false;
      this.answering = false;
      this.settling = null;
      this.writes += 1;
      // The marks were not judged while the write was on its way (see `keepMarksShown`): now they are, by the list the
      // write read after it.
      if (this.marks.length > 0) {
        this.marks = pruneMarks(this.marks, this.tasks, this.#arriving?.ids);
        this.keepMarksShown();
      }
      settle();
    }
  }

  /** Read the saved views, noting the state of the views they were read at. */
  private readViews(): Promise<void> {
    const key = this.viewsKey;
    this.#viewsRev = key;
    return this.viewsState.load().then(() => {
      // A read that failed (a busy engine) is not a read: the next read of the list asks again.
      if (this.viewsState.failed && this.#viewsRev === key) this.#viewsRev = undefined;
    });
  }

  /**
   * The list after a write, and the views when the write was one of them (the snapshot does not hold the views). They are
   * read in any case: the snapshot read here may not show the write's `views_rev` yet (the hub reads the vault again on
   * the event of the write, which can come later); `viewsBehind` then does not read them a second time.
   */
  private async readAfter(ops: readonly Op[]): Promise<void> {
    await this.refresh();
    if (ops.some((op) => op.op === 'view_save' || op.op === 'view_delete')) await this.readViews();
  }

  /** The operations that take back what `result` did (only when every entry has one). */
  private inverseOf(result: Result): Op[] | undefined {
    const inverses: Op[] = [];
    for (const entry of result.results) {
      // An entry that failed changed nothing: it has no way back and needs none.
      if (!entry.ok || entry.outcome === 'unchanged') continue;
      // A move that numbered neighbours: one set for each file written gives it its old `order` back (the inverse
      // alone would only restore the place).
      if (entry.restore && entry.restore.length > 0) {
        for (const step of entry.restore) {
          if (step.op !== 'set') return undefined;
          inverses.push({
            op: 'set',
            id: step.id,
            patch: (step.patch ?? {}) as Record<string, unknown>,
            ...(step.if_match ? { if_match: step.if_match } : {}),
          });
        }
        continue;
      }
      // Finishing is taken back by bringing the task back. What finishing set in motion beside the file (ticked steps,
      // closed plans) stays as it is, so with such effects no way back is offered rather than a half one.
      if (entry.op === 'done' && entry.id) {
        if (
          (entry.steps_ticked ?? 0) > 0 ||
          (entry.plans_closed?.length ?? 0) > 0 ||
          (entry.projects_closed?.length ?? 0) > 0
        ) {
          return undefined;
        }
        inverses.push({ op: 'reopen', id: entry.id });
        continue;
      }
      const inv = entry.inverse;
      if (!inv) return undefined;
      if (inv.op === 'reorder') {
        inverses.push({
          op: 'reorder',
          id: inv.id,
          ...(inv.after ? { after: inv.after } : {}),
          ...(inv.before ? { before: inv.before } : {}),
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      // A meeting: its old frontmatter values back (`meeting_close` opens it again this way), a participant's old tick.
      if (inv.op === 'meeting_set') {
        inverses.push({
          op: 'meeting_set',
          id: inv.id,
          patch: (inv.patch ?? {}) as Record<string, unknown>,
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      if (inv.op === 'meeting_attend') {
        if (typeof inv.n !== 'number' && typeof inv.name !== 'string') return undefined;
        inverses.push({
          op: 'meeting_attend',
          id: inv.id,
          ...(typeof inv.n === 'number' ? { n: inv.n } : { name: inv.name as string }),
          present: inv.present === true,
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      if (inv.op === 'tick_step') {
        if (typeof inv.n !== 'number') return undefined;
        inverses.push({
          op: 'tick_step',
          id: inv.id,
          n: inv.n,
          ...(typeof inv.done === 'boolean' ? { done: inv.done } : {}),
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      if (inv.op === 'answer') {
        if (typeof inv.question !== 'string') return undefined;
        inverses.push({
          op: 'answer',
          id: inv.id,
          question: inv.question,
          ...(typeof inv.option === 'number' ? { option: inv.option } : {}),
          ...(inv.clear === true ? { clear: true } : {}),
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      if (inv.op === 'move_area') {
        if (typeof inv.to_area !== 'string') return undefined;
        inverses.push({ op: 'move_area', id: inv.id, to_area: inv.to_area, ...(inv.if_match ? { if_match: inv.if_match } : {}) });
        continue;
      }
      if (inv.op === 'set_section') {
        if (typeof inv.heading !== 'string' || typeof inv.text !== 'string') return undefined;
        inverses.push({
          op: 'set_section',
          id: inv.id,
          heading: inv.heading,
          text: inv.text,
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      if (inv.op === 'set_body') {
        if (typeof inv.body !== 'string') return undefined;
        inverses.push({ op: 'set_body', id: inv.id, body: inv.body, ...(inv.if_match ? { if_match: inv.if_match } : {}) });
        continue;
      }
      // A view: made is taken back by deleting it, changed or deleted by saving the view as it was (the engine's).
      if (inv.op === 'view_delete') {
        // The engine deletes a view only on the version read: without it there is no way back to offer.
        if (!inv.if_match) return undefined;
        inverses.push({ op: 'view_delete', id: inv.id, if_match: inv.if_match });
        continue;
      }
      if (inv.op === 'view_save') {
        if (typeof inv.view !== 'object' || inv.view === null) return undefined;
        inverses.push({
          op: 'view_save',
          id: inv.id,
          view: inv.view as ViewForm,
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      // A learning point: the state and reason it had (or its note), on the version the change left.
      if (inv.op === 'node_set') {
        if (typeof inv.point !== 'string') return undefined;
        inverses.push({
          op: 'node_set',
          id: inv.id,
          point: inv.point,
          ...(inv.state !== undefined ? { state: inv.state } : {}),
          ...(typeof inv.reason === 'string' ? { reason: inv.reason } : {}),
          // The note is no field of `Inverse` before the engine writes notes (capability `node_note`).
          ...noteOf(inv),
          // XP written on a point: the XP it had, or none (capability `xp`)
          ...(typeof inv.xp === 'number' ? { xp: inv.xp } : {}),
          ...(inv.xp_clear === true ? { xp_clear: true as const } : {}),
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      // A reward of a level granted (or not): the mark it had (capability `path_reward`).
      if (inv.op === 'path_reward') {
        if (typeof inv.level !== 'string' || typeof inv.given !== 'boolean') return undefined;
        inverses.push({ op: 'path_reward', id: inv.id, level: inv.level, given: inv.given, ...(inv.if_match ? { if_match: inv.if_match } : {}) });
        continue;
      }
      // A point made a task: taken back while the task holds no work of its own (the engine judges that).
      if (inv.op === 'unpromote') {
        if (typeof inv.container !== 'string' || typeof inv.point !== 'string') return undefined;
        inverses.push({ op: 'unpromote', container: inv.container, point: inv.point, id: inv.id, ...(inv.if_match ? { if_match: inv.if_match } : {}) });
        continue;
      }
      // A plan or project file changed: its old values back, on the version the change left.
      if (inv.op === 'plan_set' || inv.op === 'project_set') {
        inverses.push({
          op: inv.op,
          id: inv.id,
          patch: (inv.patch ?? {}) as Record<string, unknown>,
          ...(inv.if_match ? { if_match: inv.if_match } : {}),
        });
        continue;
      }
      if (inv.op !== 'set') return undefined;
      inverses.push({
        op: 'set',
        id: inv.id,
        patch: (inv.patch ?? {}) as Record<string, unknown>,
        ...(inv.if_match ? { if_match: inv.if_match } : {}),
      });
    }
    return inverses.length > 0 ? inverses.reverse() : undefined;
  }

  async undo(): Promise<void> {
    const ops = this.toast?.undo;
    // While a write waits for its answer the toast is an older one: what it would undo may be touched by that write.
    if (!ops || this.answering) return;
    this.toast = null;
    // The list is read again inside the write and drops a selection that has no task any more: look before.
    const selectedBefore = this.selectedId;
    const peekingBefore = this.peeking;
    const soloBefore = this.solo;
    // A click while the write under way still re-reads the list is queued, not lost.
    if (this.settling) await this.settling;
    const result = await this.write(ops, {
      undoable: false,
      onAnswer: (answer) => {
        if (!answer.ok) return false;
        this.say('ok', 'write.undone');
        return true;
      },
    });
    // A move taken back: the task has its old id again, the selection follows it.
    // Several moves taken back at once: the one of the selected task is found by its place in the batch.
    const back = result?.results.find((r) => {
      const op = ops[r.n - 1];
      return r.ok && r.outcome === 'moved' && typeof r.new_id === 'string' && op?.op === 'move_area' && op.id === selectedBefore;
    });
    if (back?.new_id) {
      this.select(back.new_id);
      // And the float it was open in opens again on it (or the window of it alone shows it again).
      this.peeking = peekingBefore;
      this.solo = soloBefore;
    }
    // Not sent at all (the page is not ready any more): say so, the toast is gone.
    if (!result && !this.toast) this.say('error', 'write.failed', { code: 'offline' });
  }

  /** Take a reminder away (an open task or a finished one); `etag` is the version of the file that was shown. */
  async clearReminder(id: string, etag?: string): Promise<void> {
    await this.write([
      { op: 'set', id, patch: { remind: null }, ...(etag ? { if_match: etag } : {}) },
    ]);
  }

  /** Set one key of a task; `null` takes the key away. */
  async setField(id: string, key: string, value: FieldValue): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    await this.write([
      { op: 'set', id, patch: { [key]: value }, ...(task.etag ? { if_match: task.etag } : {}) },
    ]);
  }

  /**
   * Tick or untick step `n` of the plan section of a task. `etag` is the version of the file the steps were read from:
   * if the file moved on, the engine refuses and the numbers are not applied to another text.
   */
  async tickStep(id: string, n: number, done: boolean, etag?: string): Promise<void> {
    await this.write([{ op: 'tick_step', id, n, done, ...(etag ? { if_match: etag } : {}) }]);
  }

  /**
   * Answer a question of the task: tick option `option` (1-based), or take the answer back with `null`. `etag` is the
   * version of the file the questions were read from; the engine refuses when it moved on.
   */
  async answerQuestion(id: string, key: string, option: number | null, etag?: string): Promise<void> {
    await this.write([
      {
        op: 'answer',
        id,
        question: key,
        ...(option === null ? { clear: true } : { option }),
        ...(etag ? { if_match: etag } : {}),
      },
    ]);
  }

  /** Add one dated line to the notes of a task; says whether it was written (the box is emptied only then). */
  async addNote(id: string, text: string, etag?: string): Promise<boolean> {
    const result = await this.write(
      [{ op: 'append_note', id, text, ...(etag ? { if_match: etag } : {}) }],
      { undoable: false },
    );
    return result?.ok === true;
  }

  /** Open steps at the end of the task's plan (the engine writes them, one line each). Says whether it wrote them. */
  async addSteps(id: string, steps: string[], etag?: string): Promise<boolean> {
    const result = await this.write([{ op: 'add_steps', id, steps, ...(etag ? { if_match: etag } : {}) }]);
    return result?.ok === true;
  }

  /**
   * Drop a task that will not be done: it is parked and the reason goes into its notes (the engine has no verb of its
   * own for it, and `done` would count it as finished). Two requests, one after the other: a batch does not stop at the
   * operation that failed, so a status that was refused (the file changed) would still get its note. The line is judged
   * before anything is written: the engine takes at most 1000 characters, and a status written without its note would be
   * half of it. Says whether both were written (the box is emptied only then). A routine (`repeat`) ends with it: no
   * further round comes, so it is only discarded with `endRoutine` (the person was asked); without, nothing is written.
   */
  async discard(id: string, reason: string, etag?: string, opts: { endRoutine?: boolean } = {}): Promise<boolean> {
    const text = reason.trim();
    if (text === '') return false;
    if (this.tasks.find((t) => t.id === id)?.repeat && opts.endRoutine !== true) return false;
    const line = translate(this.lang, 'discard.note', { reason: text });
    if ([...line].length > NOTE_MAX) {
      this.say('error', 'discard.too_long', { n: NOTE_MAX });
      return false;
    }
    const parked = await this.write([
      { op: 'set', id, patch: { status: 'parked' }, ...(etag ? { if_match: etag } : {}) },
    ]);
    if (parked?.ok !== true) return false;
    // The note goes in under the version the status left; a failure of it is told by `write` and the task stays parked.
    return this.addNote(id, line);
  }

  /**
   * Ask the engine what moving `id` to `toArea` would break (a dry run: nothing is written). The report is the
   * engine's: a taken slug is a conflict in it, what names the old id is in `references`.
   */
  async previewMove(
    id: string,
    toArea: string,
    signal?: AbortSignal,
  ): Promise<{ kind: 'ok'; move: MovePlan } | { kind: 'refused'; message: string } | { kind: 'unknown' }> {
    if (this.readOnly) return { kind: 'refused', message: translate(this.lang, 'write.read_only') };
    try {
      const result = await this.env.hub.ops(
        { client_op_id: this.opId(), dry_run: true, ops: [{ op: 'move_area', id, to_area: toArea }] },
        signal,
      );
      const entry = result.results[0];
      if (entry?.move) return { kind: 'ok', move: entry.move };
      return { kind: 'refused', message: entry?.error?.message ?? '' };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        return { kind: 'refused', message: error.message };
      }
      return { kind: 'unknown' };
    }
  }

  /**
   * A task was dropped on an area: ask the engine what the move would do and show it. The same area is no move.
   * A later drop replaces an earlier one, and the answer of the earlier is not shown for it.
   */
  async askDropMove(id: string, toArea: string, among: readonly string[] = this.marks, fromView = false): Promise<void> {
    const task = this.tasks.find((x) => x.id === id);
    if (!task || task.area === toArea || !this.can('move_area') || this.saving) return;
    this.dropChoose = null;
    const seq = ++this.#dropAsks;
    // A marked task dropped with other marked ones takes them along: they are moved together, as in the list.
    const count = among.length > 1 && among.includes(id) ? among.length : 1;
    const etag = task.etag;
    const from = fromView ? { fromView } : {};
    this.dropMove = { id, toArea, count, ...(etag ? { etag } : {}), answer: null, checks: null, ...from };
    const still = (): boolean => seq === this.#dropAsks && this.dropMove?.id === id && this.dropMove.toArea === toArea;
    if (count > 1) {
      const checks = await this.previewBulkMove(toArea, among);
      if (!still()) return;
      // The engine could not be asked (the reason was told): nothing is left to confirm.
      this.dropMove = checks === null ? null : { id, toArea, count, answer: null, checks, ...from };
      return;
    }
    const answer = await this.previewMove(id, toArea);
    if (still()) this.dropMove = { id, toArea, count, ...(etag ? { etag } : {}), answer, checks: null, ...from };
  }

  cancelDropMove(): void {
    this.#dropAsks++;
    this.dropMove = null;
  }

  /** Let the person choose the area of `id` (the key `m` or the button of a row): the way without a drag. */
  chooseDropMove(id: string): void {
    if (this.refusedReadOnly() || !this.can('move_area') || this.saving || !this.tasks.some((x) => x.id === id)) return;
    this.dropChoose = id;
  }

  cancelDropChoose(): void {
    this.dropChoose = null;
  }

  /** The person confirmed the move the engine described. The version is the one that was shown. */
  async confirmDropMove(): Promise<void> {
    const asking = this.dropMove;
    if (asking && asking.count > 1) {
      const checks = asking.checks ?? [];
      if (!checks.some((c) => c.reasons.length === 0 && c.newId !== '')) return;
      this.#dropAsks++;
      this.dropMove = null;
      const moved = await this.bulkMove(asking.toArea, checks);
      // The card that was dragged in a view: where it went (when its own move was one that could be made).
      const own = checks.find((c) => c.id === asking.id && c.reasons.length === 0 && c.newId !== '');
      if (asking.fromView && moved > 0 && own) this.areaMoved = { id: own.newId, area: asking.toArea };
      return;
    }
    if (!asking || asking.answer?.kind !== 'ok' || asking.answer.move.conflicts.length > 0) return;
    // The version the person was shown, not the one the list has by now: a file that changed meanwhile is refused.
    this.#dropAsks++;
    this.dropMove = null;
    const newId = asking.answer.move.new_id;
    const done = await this.moveArea(asking.id, asking.toArea, asking.etag);
    // Only a move asked from a view is told to it: one from the overview or the dialog's choice is not that view's.
    if (done && asking.fromView) this.areaMoved = { id: newId, area: asking.toArea };
  }

  /** The task the last move confirmed in the dialog went to (its new id and area): a view announces it and follows it. */
  areaMoved = $state.raw<{ id: string; area: string } | null>(null);

  /**
   * Move `id` to `toArea`: the id changes, what named the old id names the new one, all or nothing (the engine).
   * `etag` is the version of the file that was shown. The selection follows the task. Taking it back is the inverse
   * the engine gave. Says whether it was written.
   */
  async moveArea(id: string, toArea: string, etag?: string): Promise<boolean> {
    const selectedBefore = this.selectedId;
    const peekingBefore = this.peeking;
    const soloBefore = this.solo;
    const result = await this.write([
      { op: 'move_area', id, to_area: toArea, ...(etag ? { if_match: etag } : {}) },
    ]);
    const entry = result?.results[0];
    if (!entry?.ok || entry.outcome !== 'moved' || typeof entry.new_id !== 'string') return false;
    this.moveDraft(id, entry.new_id);
    if (selectedBefore === id) {
      this.select(entry.new_id);
      // The float the task was moved from shows it again under its new id (the read of the list closed it), and so
      // does a window of that task alone.
      this.peeking = peekingBefore;
      this.solo = soloBefore;
    }
    return true;
  }

  /**
   * Replace the text of a task by `text`. `etag` is the version of the file the text was read from: if the file moved
   * on, the engine refuses and the draft stays with the person. Says whether it was written (the editor closes only then).
   */
  async setBody(id: string, text: string, etag?: string): Promise<boolean> {
    const result = await this.write([{ op: 'set_body', id, body: text, ...(etag ? { if_match: etag } : {}) }]);
    return result?.ok === true;
  }

  /** Mark or unmark `id`; says whether it is marked now (a mark past one batch is refused and told). */
  toggleMark(id: string): boolean {
    const next = toggleMark(this.marks, id);
    if (next.length === this.marks.length && !this.marks.includes(id)) {
      this.say('error', 'bulk.limit');
      return false;
    }
    this.marks = next;
    this.#markAnchor = id;
    return next.includes(id);
  }

  /** The task marked last by a click or a key: where a Shift click starts its range. */
  #markAnchor: string | null = null;

  /**
   * The views whose tasks can be marked: the list, the board, the plan, the inbox and the saved views. One marking
   * for all of them: what is marked in one is marked in the next, as far as that view shows it.
   */
  get marking(): boolean {
    return this.view === 'list' || this.view === 'board' || this.view === 'plan' || this.view === 'inbox' || this.view === 'views';
  }

  /**
   * The tasks the view that is shown draws now, as the page reads them (App.svelte watches the main area: every
   * element of a task names it in `data-mark-id`): rows of a folded area, a folded column or stage, another plan, a
   * closed cell are not among them. `null` where nobody reads the page (the tests of the state): then all count.
   */
  drawn = $state.raw<ReadonlySet<string> | null>(null);

  /** Whether the view that is shown draws `id` now (see `drawn`). */
  draws(id: string): boolean {
    return this.drawn === null || this.drawn.has(id);
  }

  /**
   * The marked tasks the view that is shown draws: what Export, the context menu and the strip of the marks work on.
   * A mark of a task the view does not draw stays (one marking for all views), but nothing here changes or takes it.
   */
  get marksHere(): string[] {
    if (!this.marking) return [];
    return this.drawn === null ? this.marks : this.marks.filter((id) => this.drawn?.has(id));
  }

  /**
   * A click on a task with Shift marks instead of opening: from the task marked last (else the selected one) to this
   * one, along `order` (what the view shows, in its order); with neither, this task alone. (Ctrl+click opens the task
   * in a new tab, as a link does: lib/taskApart.ts.) True when the click was a mark: the caller then opens nothing.
   */
  markClick(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, id: string, order: readonly string[]): boolean {
    if (!event.shiftKey || event.ctrlKey || event.metaKey) return false;
    if (!this.marking || !this.draws(id)) return true;
    {
      const anchor = this.#markAnchor !== null && this.marks.includes(this.#markAnchor) ? this.#markAnchor : null;
      const from = [anchor, this.selectedId].find((x): x is string => x !== null && order.includes(x)) ?? id;
      const { marks, full } = markRange(this.marks, order, from, id);
      if (full) this.say('error', 'bulk.limit');
      this.marks = marks;
      this.#markAnchor = id;
    }
    return true;
  }

  /** Mark every task the list shows, along its rows (up to one batch; what does not fit is told). */
  markShown(): void {
    const ids = this.listed.map((t) => t.id);
    const next = markAll(this.marks, ids);
    if (ids.some((id) => !next.includes(id))) this.say('error', 'bulk.limit');
    this.marks = next;
  }

  /** Whether the view that is shown draws tasks an export can take (the list, the board, the plan, an open saved view). */
  get exportable(): boolean {
    return this.view === 'list' || this.view === 'board' || this.view === 'plan' || (this.view === 'views' && this.viewsState.open !== null);
  }

  /**
   * The name of a plan or a saved view in the name of the file: its slug, when its area may leave the app; a plan or
   * a view kept in a private area may select tasks of public ones, and its id must not go with them.
   */
  private exportName(kind: 'plan' | 'view', id: string): string {
    const slug = id.slice(id.indexOf('/') + 1);
    return slug !== '' && this.mayRememberArea(areaOfId(id)) ? `${kind}-${slug}` : kind;
  }

  /**
   * What the view that is shown draws, as rows for an export: the board's columns, the plan's stages, the groups or
   * cells of a saved view (nothing where it draws only a note), the list's rows for the list. `view` names it for the
   * file; a view that draws no tasks has none.
   */
  viewRows(): { view: string; rows: ExportRow[]; data: GroupWords; words: GroupWords } {
    const t = (key: Key, params: Record<string, string | number> = {}) => translate(this.lang, key, params);
    const plain = { data: AS_THEY_ARE, words: AS_THEY_ARE };
    switch (this.view) {
      case 'list':
        return { view: 'list', rows: this.listed.map((task) => ({ task })), ...plain };
      case 'board': {
        // A file keeps the status word of the engine; the page for the printer says it as the board does.
        const status = (v: string) => labelOf(this.lang, 'status', v);
        return { view: 'board', rows: boardRows(this.shown), data: AS_THEY_ARE, words: { group: status, row: status } };
      }
      case 'plan': {
        const plan = chosenPlan(this.snapshot?.plans ?? [], this.planChoice);
        const name = (stage: number | null) => (stage === null ? t('plan.no_stage') : t('plan.stage', { n: stage }));
        return { view: plan === '' ? 'plan' : this.exportName('plan', plan), rows: stageRows(stagesOf(this.shown, plan === '' ? null : plan), name), ...plain };
      }
      case 'views': {
        const open = this.viewsState.open;
        if (open === null) break;
        const view = this.exportName('view', open.id);
        const fields = this.viewsState.groupingsShown?.fields ?? [];
        const columns = fields.find((f) => f.field === open.group_by);
        const rows = open.group_by2 === undefined ? undefined : fields.find((f) => f.field === open.group_by2);
        // As the view: a field it does not know, or a matrix without its second field, is a note and no tasks.
        if (!columns || (open.display === 'matrix' && !rows)) return { view, rows: [], ...plain };
        // The group of no value is named; a group by plan or by project does not name one kept in an area that may not
        // leave (its id names the area).
        const named = (field: string) => (value: string) => {
          if (value === NONE) return t('views.none');
          if ((field === 'plan' || field === 'project') && !this.mayRememberArea(areaOfId(value))) {
            return t(field === 'plan' ? 'export.private_plan' : 'export.private_project');
          }
          return value;
        };
        // For the printer, the page's words as the view shows them (the status, the who, P1).
        const shown = (field: string) => (value: string) => {
          const name = named(field)(value);
          if (name !== value) return name;
          if (field === 'status' || field === 'actor' || field === 'state' || field === 'cross') return labelOf(this.lang, field, value);
          if (field === 'project') return this.projects.find((p) => p.id === value)?.title ?? value;
          return field === 'prio' ? `P${value}` : value;
        };
        const second = rows?.field ?? columns.field;
        const tasks = this.tasksOfView(open);
        return {
          view,
          rows:
            open.display === 'matrix' && rows
              ? cellRows(cellsOf(tasks, rows, columns, this.derivedValues), (v) => v)
              : groupRows(groupsOf(tasks, columns, this.derivedValues), (v) => v),
          data: { group: named(columns.field), row: named(second) },
          words: { group: shown(columns.field), row: shown(second) },
        };
      }
    }
    return { view: 'list', rows: [], ...plain };
  }

  /**
   * The rows an export takes: the view's (in the list only the marked ones when some are marked: the other views do
   * not show the marks), none of a private or unclassified area (`kept`: how many tasks stay in the app for that), and
   * no id of a plan kept in such an area. `rows` name their groups for a file, `printRows` in the page's words.
   */
  exportRows(): { view: string; rows: ExportRow[]; printRows: ExportRow[]; kept: number } {
    const { view, rows, data, words } = this.viewRows();
    // The marks of the tasks the view draws: a mark of another view's task neither narrows nor empties this export.
    const marked = onlyMarked(rows, new Set(this.marksHere));
    const { rows: out, kept } = mayLeave(marked, (task) => this.mayRememberArea(task.area));
    const leaving = withoutPlansOf(out, (plan) => this.mayRememberArea(areaOfId(plan)));
    return { view, rows: relabel(leaving, data), printRows: relabel(leaving, words), kept };
  }

  /** The text of an export in `format`, with the name of its view and how many tasks it holds and keeps back. */
  exportTasks(format: ExportFormat): { view: string; text: string; count: number; kept: number } {
    const { view, rows, kept } = this.exportRows();
    // The spreadsheet that opens the file is the one of the system: its locale decides the column separator.
    const separator = csvSeparatorFor(this.env.preferredLanguages[0]);
    return { view, text: rowsText(rows, format, separator, view), count: taskCount(rows), kept };
  }

  /**
   * Export what the view shows: as a file the browser saves (named by the view and the day) or onto the clipboard. An
   * export of nothing is not made and says so; the tasks of areas that may not leave the app are named by their number.
   */
  async exportView(format: ExportFormat, how: 'save' | 'copy'): Promise<void> {
    const { view, text, count, kept } = this.exportTasks(format);
    if (count === 0) {
      this.sayNothingExported(kept);
      return;
    }
    const file = EXPORT_FILES[format];
    const ok = how === 'save' ? this.env.out.save(exportFileName(view, this.localDay(), format), text, file.type) : await this.env.out.copy(text);
    const done = how === 'save' ? 'saved' : 'copied';
    if (!ok) this.say('error', how === 'save' ? 'export.failed' : 'export.copy_failed', { n: count });
    else if (kept > 0) this.say('ok', `export.${done}_kept`, { n: count, m: kept });
    else this.say('ok', `export.${done}`, { n: count });
  }

  /** The open tasks a selection names (an area, a plan, a group of a view: a tile of the context menu). */
  tasksOfSelect(select: Partial<ViewSelect>): TaskEntry[] {
    return applyFilter(
      this.tasks,
      this.matchFilter(filterOfSelect({ ...emptySelect(), ...select })),
      this.today,
      this.crossIndex,
      this.quickWinSet,
      this.projectOf,
    );
  }

  /**
   * Copy `tasks` onto the clipboard in `format`: a task of the context menu, the marked ones it was opened on, or the
   * tasks of a tile. The rules of the button Export hold: none of a private or unclassified area, no id of a plan kept in
   * one, an export of nothing is not made and says so.
   */
  async copyTasks(tasks: readonly TaskEntry[], format: ExportFormat): Promise<void> {
    const { rows: out, kept } = mayLeave(
      tasks.map((task) => ({ task })),
      (task) => this.mayRememberArea(task.area),
    );
    const rows = withoutPlansOf(out, (plan) => this.mayRememberArea(areaOfId(plan)));
    const count = taskCount(rows);
    if (count === 0) {
      this.sayNothingExported(kept);
      return;
    }
    const text = rowsText(rows, format, csvSeparatorFor(this.env.preferredLanguages[0]), 'tasks');
    if (!(await this.env.out.copy(text))) this.say('error', 'export.copy_failed', { n: count });
    else if (kept > 0) this.say('ok', 'export.copied_kept', { n: count, m: kept });
    else this.say('ok', 'export.copied', { n: count });
  }

  /** Why an export (or a print) made nothing: the view shows no task, or every task shown is held back. */
  private sayNothingExported(kept: number): void {
    // Before the classes are read (or when the hub could not tell them) every task is held back: that is not their class.
    const key = kept === 0 ? 'export.empty' : this.hubAreas.length === 0 ? 'export.classes_unknown' : 'export.only_kept';
    this.say('error', key, { m: kept });
  }

  /**
   * Print what the view shows, or save it as a PDF from the print dialog: the same rows as an export (the view's order
   * and groups, nothing of a private or unclassified area), as a page of its own with the view, the day, the count and
   * the filters on top. The list's filters are named only where they make the view (not in a saved view, which has its
   * own selection), and a chip that names an area which may not leave is not.
   */
  printView(): void {
    const sheet = this.viewSheet();
    if (sheet && !this.env.out.print(sheet.sheet)) this.say('error', 'print.failed');
  }

  /** Whether this page can make a picture of a view. */
  get canPng(): boolean {
    return this.env.out.png !== undefined;
  }

  /** The sheet of `printView` as one long picture. */
  async pngView(): Promise<void> {
    const made = this.viewSheet();
    if (!made || !this.env.out.png) return;
    const result = await this.env.out.png(made.sheet, exportFileName(this.view, this.localDay(), 'markdown').replace(/\.[a-z]+$/, '.png'));
    if (result === 'saved') this.say('ok', 'export.png_saved', { n: made.count });
    else this.say('error', result === 'too_long' ? 'export.png_too_long' : 'export.png_failed', { n: made.count });
  }

  /** What the view shows for the way out of the page, as a sheet; null when that is nothing (it says so). */
  private viewSheet(): { sheet: PrintSheet; count: number } | null {
    const { printRows: rows, kept } = this.exportRows();
    const count = taskCount(rows);
    if (count === 0) {
      this.sayNothingExported(kept);
      return null;
    }
    const t = (key: Key, params: Record<string, string | number> = {}) => translate(this.lang, key, params);
    const open = this.viewsState.open;
    const name =
      this.view === 'views'
        ? open !== null && this.mayRememberArea(areaOfId(open.id)) ? open.title : t('nav.views')
        : t(`nav.${this.view}` as Key);
    // A chip that names an area, or a plan kept in an area, which may not leave is not printed.
    const filters =
      this.view === 'views'
        ? []
        : activeFilters(this.filter)
            .filter((item) => (item.kind === 'area' ? this.mayRememberArea(item.value) : item.kind === 'plan' ? this.mayRememberArea(areaOfId(item.value)) : true))
            .map((item) => chipLabel(this.lang, this.filter, item, { short: this.shortAreas, all: this.allAreaNames }));
    // The words of the search may name what is held back (an id, a word of a title): they are printed only when no task
    // of an area that may not leave has them; else the page says that a search narrows the list, not what it is.
    const words = this.view === 'views' ? '' : this.filter.query.trim();
    const query = words === '' ? '' : this.namesHeldBack(words) ? t('print.search_held') : `"${words}"`;
    const facts = [
      `${name} · ${this.localDay()} · ${t('print.count', { n: count })}`,
      ...(filters.length > 0 || query !== '' ? [t('print.filters', { what: [...(query ? [query] : []), ...filters].join(', ') })] : []),
      ...(kept > 0 ? [t('print.kept', { m: kept })] : []),
    ];
    const headers = [t('print.col.id'), t('print.col.title'), t('list.filter.status'), t('filter.field.prio'), t('filter.field.effort'), t('list.filter.actor')];
    const cells = (task: TaskEntry) => [
      task.id,
      task.title,
      labelOf(this.lang, 'status', task.status),
      task.prio === undefined ? '' : String(task.prio),
      task.effort ?? '',
      task.actor === undefined ? '' : labelOf(this.lang, 'actor', task.actor),
    ];
    return { sheet: sheetOf(rows, t('app.title'), facts, headers, cells), count };
  }

  /** Whether `words` are found in the id or the title of a task of an area that may not leave (or name such an area). */
  private namesHeldBack(words: string): boolean {
    const w = words.toLowerCase();
    return this.tasks.some((task) => !this.mayRememberArea(task.area) && (task.id.toLowerCase().includes(w) || task.title.toLowerCase().includes(w)));
  }

  /** The day of the clock in the person's time zone, as `YYYY-MM-DD`. */
  private localDay(): string {
    const d = new Date(this.env.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Take the marks off `ids`: their rows are no longer seen (an area of the list folded away). */
  unmark(ids: readonly string[]): void {
    if (this.marks.length === 0 || ids.length === 0) return;
    const gone = new Set(ids);
    const kept = this.marks.filter((id) => !gone.has(id));
    if (kept.length !== this.marks.length) this.marks = kept;
  }

  /** Only the tasks the list shows stay marked: a mark that cannot be seen must not be changed. */
  keepMarksShown(): void {
    // Not while a write is on its way: a list read in the middle of it may lack tasks the write has moved already, and
    // their marks would go before the answer can tell where the tasks went. The read after the write sets this right.
    if (this.marks.length === 0 || this.saving) return;
    const shown = new Set(this.shown.map((t) => t.id));
    const arriving = this.#arriving?.ids;
    const kept = this.marks.filter((id) => shown.has(id) || arriving?.has(id));
    if (kept.length === this.marks.length) return;
    // Marks made in a saved view (whose selection is its own) can be of tasks the filter of the list hides: they go
    // here, and the person is told, so a mark is never lost without a word.
    const hidden = this.marks.filter((id) => !kept.includes(id) && this.tasks.some((t) => t.id === id)).length;
    this.marks = kept;
    if (hidden > 0) this.say('ok', 'marks.hidden', { n: hidden });
  }

  /**
   * The new ids a batch of moves gave its marks, and how many reads of the list had begun when it was answered. A
   * read that began before the answer may bring the list of before (an event of the hub had started it), which does
   * not know the new ids yet: they are not taken off the marks for it. A read that began after the answer clears this
   * once its list knows the new ids; a list that still lacks them (the hub answered from the state before the move) is
   * not believed at once, but only for `LATE_READS` reads, so a mark of a task that is really gone does not stay.
   */
  #arriving: { ids: ReadonlySet<string>; before: number; late: number } | null = null;
  /** The reads of the list begun so far (see `#arriving`). */
  #reads = 0;

  clearMarks(): void {
    this.marks = [];
    this.#markAnchor = null;
  }

  /** Say something to the person without writing (a refusal before anything is sent). */
  tell(kind: Toast['kind'], key: Key, params: Record<string, string | number> = {}): void {
    this.say(kind, key, params);
  }

  /**
   * The keys of `patch` on every marked task, as ONE request: the engine takes the batch as a whole (one write of the
   * index), each task with the version that was shown. A task that changed meanwhile fails alone and is told; the rest
   * is kept. The marks stay on the tasks that failed, so a second try is one click; a mark made while the request was
   * under way is not touched.
   */
  async bulkSet(patch: Record<string, unknown>, tags?: TagEdit): Promise<void> {
    const ops = bulkSetOps(this.tasks, this.marks, patch, tags);
    if (ops.length === 0) {
      this.say('ok', 'bulk.nothing');
      return;
    }
    await this.write(ops, { ...(tags ? { tags } : {}), onAnswer: this.batchAnswer(ops) });
  }

  /** The choice of tags that is open (`TagDialog.svelte`): for which tasks, and whether tags are added or taken away. */
  tagging = $state.raw<{ ids: readonly string[]; mode: 'add' | 'remove' } | null>(null);

  /**
   * Open the choice of tags for the task `id`, or for all the marked tasks when it is one of them (as the context menu
   * of a marked row works on the selection); `alone`: for that task whatever is marked (the "+" of its detail).
   */
  openTagging(id: string, mode: 'add' | 'remove', alone = false): void {
    if (this.refusedReadOnly() || !this.can('ops') || this.phase !== 'ready') return;
    const ids = tagTargets(id, this.marks, this.tasks, alone);
    if (ids.length > 0) this.tagging = { ids, mode };
  }

  closeTagging(): void {
    this.tagging = null;
  }

  /**
   * Add tags to the tasks `ids` and take others away: one batch of `set`, each task with the version that was shown
   * (`if_match`) and its own list of tags worked out from what it has; a task that has what was asked for already is
   * left out. One message with the way back. What the engine refuses (a tag it does not take, a task that changed
   * meanwhile) fails alone and is handed back with the engine's words. Null: nothing was sent or no answer came.
   */
  async editTags(
    ids: readonly string[],
    edit: TagEdit,
  ): Promise<{ changed: number; failed: { id: string; message: string }[] } | null> {
    const ops = bulkSetOps(this.tasks, ids, {}, edit);
    if (ops.length === 0) {
      this.say('ok', 'bulk.nothing');
      return { changed: 0, failed: [] };
    }
    let failed: { id: string; message: string }[] = [];
    const onAnswer = (result: Result): boolean => {
      failed = [];
      for (const r of result.results) {
        if (r.ok) continue;
        const id = ops[r.n - 1]?.id ?? (r.error?.details as { id?: unknown } | undefined)?.id;
        failed.push({ id: typeof id === 'string' ? id : '?', message: r.error?.message ?? r.error?.code ?? 'failed' });
      }
      const undo = this.inverseOf(result);
      if (failed.length === 0) this.say('ok', 'bulk.saved', { n: ops.length }, undo);
      else this.say('error', 'tags.partial', { done: ops.length - failed.length, failed: failed.length }, undo);
      return true;
    };
    const result = await this.write(ops, { tags: edit, onAnswer });
    if (!result) return null;
    return { changed: ops.length - failed.length, failed };
  }

  /** Every open task that carries `tag`, in the list, without other filters (a click on a tag). */
  showTag(tag: string): void {
    this.closeTagging();
    this.peeking = false;
    this.filter = { ...freshFilter(), fields: { tag: [tag] } };
    // The text search belongs to the words that are gone.
    this.scheduleTextSearch('', 0);
    this.setView('list');
  }

  /**
   * Put the chosen tasks into a plan (and phase) or a project: one batch of `set`, each task with the version that was
   * shown (`if_match`), one message with the way back. What the engine refuses (an area the plan does not cover, a task
   * that changed meanwhile) fails alone and is handed back with the engine's words, task by task; the rest stays
   * written. Null: nothing was sent (read only, a write under way) or the answer did not come.
   */
  async addTasksTo(
    ids: readonly string[],
    target: AddTarget,
  ): Promise<{ added: number; failed: { id: string; message: string }[] } | null> {
    const ops = addOps(this.tasks, ids, target);
    if (ops.length === 0) {
      this.say('ok', 'bulk.nothing');
      return { added: 0, failed: [] };
    }
    let failed: { id: string; message: string }[] = [];
    const onAnswer = (result: Result): boolean => {
      failed = [];
      for (const r of result.results) {
        if (r.ok) continue;
        const id = ops[r.n - 1]?.id ?? (r.error?.details as { id?: unknown } | undefined)?.id;
        failed.push({ id: typeof id === 'string' ? id : '?', message: r.error?.message ?? r.error?.code ?? 'failed' });
      }
      const undo = this.inverseOf(result);
      if (failed.length === 0) this.say('ok', 'pick.added', { n: ops.length }, undo);
      else this.say('error', 'pick.partial', { done: ops.length - failed.length, failed: failed.length }, undo);
      return true;
    };
    const result = await this.write(ops, { onAnswer });
    if (!result) return null;
    return { added: ops.length - failed.length, failed };
  }

  /**
   * What a batch of `set` on marked tasks says when its answer is there: how many went through, how many failed (each
   * failed one stays marked, the others are taken off), with the way back of those that went through.
   */
  private batchAnswer(ops: readonly { id: string }[]): (result: Result) => boolean {
    const sent = new Set(ops.map((o) => o.id));
    // Said as soon as the answer is there: the re-read of the list that follows takes as long as the engine does.
    return (result: Result): boolean => {
      // A failed entry names its operation (`n`), not always the task: the position in the batch says which one.
      const failedIds = new Set<string>();
      for (const r of result.results) {
        if (r.ok) continue;
        const id = ops[r.n - 1]?.id ?? (r.error?.details as { id?: unknown } | undefined)?.id;
        if (typeof id === 'string') failedIds.add(id);
      }
      if (result.results.some((r) => !r.ok) && failedIds.size === 0) {
        // Which tasks failed is not known: the toast of the write says why, and nothing is taken off the marks.
        return false;
      }
      this.marks = this.marks.filter((id) => !sent.has(id) || failedIds.has(id));
      const undo = this.inverseOf(result);
      if (failedIds.size === 0) {
        this.say('ok', 'bulk.saved', { n: ops.length }, undo);
      } else {
        this.say('error', 'bulk.partial', { done: ops.length - failedIds.size, failed: failedIds.size }, undo);
      }
      return true;
    };
  }

  /**
   * A task of a saved view dropped from the group `from` onto the group `to` of `grouping` (`copy`: the Ctrl key, a
   * list of tags keeps the group it leaves). A marked task takes the other marked ones of the view with it, as one batch.
   * The operation is the one the engine names for the field (`dropOps`); what it cannot be is said, not sent. Says
   * whether it was sent.
   */
  async dropInView(
    id: string,
    grouping: Grouping,
    from: string,
    to: string,
    copy = false,
    inView: readonly TaskEntry[] = this.tasks,
  ): Promise<boolean> {
    // The area is no field of the file: the task moves (a new id, what names it is rewritten). As in the panel of the
    // overview the engine is asked first (a dry run, shown in a dialog), and only the confirmation moves the file, on the
    // version shown. Not moved yet, so nothing to announce here.
    if (grouping.mode === 'move_area') {
      if (this.refusedWhileSaving()) return false;
      if (to === NONE) {
        this.say('error', 'views.refused.required');
        return false;
      }
      // Only the marked tasks the view shows go with it, as for every other drop of a view.
      await this.askDropMove(id, to, this.marks.filter((m) => inView.some((t) => t.id === m)), true);
      return false;
    }
    const tags: TagEdit | undefined = grouping.mode === 'tags' ? { add: to === NONE ? [] : [to], remove: copy ? [] : [from] } : undefined;
    return this.dropTogether(id, inView, (one) => dropOps(one, grouping, from, to, copy), {
      blocks: grouping.field === 'status' && to === 'blocked',
      ...(tags ? { tags } : {}),
    });
  }

  /**
   * A task of a matrix dropped from the cell `from` onto the cell `to`: the row's field and the column's field in one
   * `set` (`cellDropOps`), with the marked ones of the view, as `dropInView` does for one field.
   */
  async dropInMatrix(id: string, rows: Grouping, columns: Grouping, from: Cell, to: Cell, inView: readonly TaskEntry[] = this.tasks): Promise<boolean> {
    const tagsOf = (g: Grouping, a: string, b: string): TagEdit | undefined =>
      g.mode === 'tags' && a !== b ? { add: b === NONE ? [] : [b], remove: [a] } : undefined;
    const tags = tagsOf(rows, from.row, to.row) ?? tagsOf(columns, from.column, to.column);
    const blocks = (rows.field === 'status' && to.row === 'blocked' && from.row !== to.row) || (columns.field === 'status' && to.column === 'blocked' && from.column !== to.column);
    return this.dropTogether(id, inView, (one) => cellDropOps(one, rows, columns, from, to), { blocks, ...(tags ? { tags } : {}) });
  }

  /**
   * What a drop in a view comes to for `id` and, when it is marked, the other marked tasks of the view: one batch of the
   * operations `dropFor` names, what it refuses said in words, blocked without a blocker asked for (one task) or refused
   * (several). Says whether the engine took every operation.
   */
  private async dropTogether(
    id: string,
    inView: readonly TaskEntry[],
    dropFor: (task: TaskEntry) => Drop,
    opts: { blocks: boolean; tags?: TagEdit },
  ): Promise<boolean> {
    if (this.refusedReadOnly() || this.refusedWhileSaving()) return false;
    const task = inView.find((t) => t.id === id);
    if (!task) return false;
    // Only the marked tasks the view shows go with it: a mark the person cannot see here is not moved from here.
    const together = this.marks.includes(id) ? inView.filter((t) => this.marks.includes(t.id)) : [task];
    // Blocked with nothing that blocks it is a warning of the engine: one task is asked for its blocker (as on the
    // board); several are not blocked behind the person's back.
    if (opts.blocks) {
      const bare = together.filter((t) => t.blocked_by.length === 0);
      if (bare.length > 0 && together.length === 1) {
        if (this.phase === 'ready') this.blocking = { id };
        return false;
      }
      if (bare.length > 0) {
        this.say('error', 'views.blocked_batch', { n: bare.length });
        return false;
      }
    }
    const ops: Op[] = [];
    for (const one of together) {
      const drop = dropFor(one);
      if (drop.kind === 'ops') ops.push(...drop.ops);
      // A task of the batch that already is where it goes is no refusal of the others.
      else if (drop.kind === 'refused' && drop.reason === 'same' && one.id !== id) continue;
      else {
        this.say('error', `views.refused.${drop.kind === 'refused' ? drop.reason : 'read_only'}` as Key);
        return false;
      }
    }
    if (ops.length === 0) return false;
    const batch = together.length > 1 ? { onAnswer: this.batchAnswer(ops as { id: string }[]) } : {};
    const result = await this.write(ops, { ...(opts.tags ? { tags: opts.tags } : {}), ...batch });
    // Moved only when the engine took every operation: a refusal is told by the toast, not announced as a move.
    return result !== null && result.results.every((r) => r.ok);
  }

  /**
   * Ask the engine, in ONE dry run, what moving every marked task to `toArea` would do: per task the new id, the
   * reasons it cannot be made (a taken slug, an unknown area) and how many places follow. Nothing is written. Null when
   * nothing is to be moved or the engine could not be asked.
   */
  async previewBulkMove(toArea: string, ids: readonly string[] = this.marks): Promise<MoveCheck[] | null> {
    if (this.readOnly) {
      this.say('error', 'write.read_only');
      return null;
    }
    const ops = bulkMoveOps(this.tasks, ids, toArea);
    if (ops.length === 0) return [];
    // Too many moves for one engine call: refused before anything is sent (see `MOVE_MAX`).
    if (ops.length > MOVE_MAX) {
      this.say('error', 'bulk.move_limit', { n: MOVE_MAX });
      return null;
    }
    try {
      const result = await this.env.hub.ops({ client_op_id: this.opId(), dry_run: true, ops });
      return moveChecks(ops, result.results);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        this.say('error', 'write.invalid', { message: error.message });
      } else {
        this.say('error', 'move.unknown');
      }
      return null;
    }
  }

  /**
   * Move the marked tasks the dry run let through (`checks` without a reason) to `toArea`, as ONE request with one
   * `move_area` each, each with the version that was shown. Not all-or-nothing: a task that changed meanwhile fails
   * alone and is told. A moved task keeps its mark under its new id, and the selection follows it; a failed one stays
   * marked. Taking it back is the inverses the engine gave. Says how many were moved.
   */
  async bulkMove(toArea: string, checks: readonly MoveCheck[]): Promise<number> {
    const go = new Set(checks.filter((c) => c.reasons.length === 0 && c.newId !== '').map((c) => c.id));
    // A marked task that names another marked one goes first: the other's move rewrites its file.
    const ops = moveOrder(
      bulkMoveOps(this.tasks, this.marks, toArea).filter((o) => go.has(o.id)),
      checks,
    );
    if (ops.length === 0) {
      this.say('ok', 'bulk.nothing');
      return 0;
    }
    if (ops.length > MOVE_MAX) {
      this.say('error', 'bulk.move_limit', { n: MOVE_MAX });
      return 0;
    }
    const selectedBefore = this.selectedId;
    const moved = new Map<string, string>();
    const onAnswer = (result: Result): boolean => {
      let failed = 0;
      for (const r of result.results) {
        const id = ops[r.n - 1]?.id;
        if (r.ok && r.outcome === 'moved' && typeof r.new_id === 'string' && id) moved.set(id, r.new_id);
        else if (!r.ok) failed += 1;
      }
      this.marks = followMoves(this.marks, moved);
      // A read under way now may still bring the list of before: the new ids are kept from it.
      this.#arriving = { ids: new Set(moved.values()), before: this.#reads, late: 0 };
      // Not `inverseOf`: a later move of the batch may have rewritten a file whose inverse carries the version before.
      const undo = moveUndo(result.results);
      if (failed === 0) this.say('ok', 'bulk.moved', { n: moved.size }, undo);
      else {
        // The text of the engine says why, and a "rollback incomplete" names the files that could not be put back.
        const first = result.results.find((r) => !r.ok);
        const why = first?.error?.message ?? first?.error?.code ?? '';
        this.say('error', 'bulk.move_partial', { done: moved.size, failed, why }, undo);
      }
      return true;
    };
    await this.write(ops, { onAnswer });
    const next = selectedBefore === null ? undefined : moved.get(selectedBefore);
    if (next) this.select(next);
    return moved.size;
  }

  // ── the board ─────────────────────────────────────────────────────────

  /** The cards of the board: what the list shows, in a column for each status, in the engine's order. */
  get board() {
    return columnsOf(this.shown);
  }

  /** Send a move of a card, or say why it cannot be made (the order has no meaning across a priority border). */
  async moveCard(move: Move): Promise<void> {
    if (move.kind === 'prio') {
      if (this.phase === 'ready' && !this.saving) {
        this.repriority = { id: move.id, from: move.from, prio: move.prio, ops: move.ops };
      }
      return;
    }
    if (move.kind === 'refused') {
      if (move.reason === 'group') this.say('error', 'board.refused_group');
      else if (move.reason === 'edge') this.say('error', 'board.refused_edge');
      return;
    }
    await this.write([move.op]);
  }

  cancelRepriority(): void {
    this.repriority = null;
  }

  /** Set the priority and place the card, as one batch (the way back is the inverse of both). */
  // ── the check of the vault, as a job ───────────────────────────────────

  /** The findings that hold: of tasks as they were when the check was made, and of what is no listed task. */
  get checkFindings(): Finding[] {
    return this.checkState.findings;
  }

  /** The findings of tasks that changed since the check: possibly resolved, shown as such. */
  get checkStale(): Finding[] {
    return this.checkState.stale;
  }

  /** How many tasks with findings changed or went away since the check. */
  get checkChanged(): number {
    return this.checkState.changed;
  }

  /** The findings that hold about the task `id`. */
  findingsFor(id: string): Finding[] {
    return this.checkState.findingsFor(id);
  }

  /** Whether the check that is done was made for a state the page never held (the vault changed while it ran). */
  get checkOutdated(): boolean {
    return this.checkState.outdated;
  }

  /** Open the check dialog on what the hub knows of the job. */
  openChecks(): Promise<void> {
    return this.checkState.open();
  }

  closeChecks(): void {
    this.checkState.close();
  }

  /** Start the check; it runs in the hub and the page goes on. */
  runCheck(refs: boolean): Promise<void> {
    return this.checkState.run(refs);
  }

  // ── the graph of a task ────────────────────────────────────────────────

  /** Show what `id` needs (or what waits for it) in the plan view. */
  openGraph(id: string, direction: 'needs' | 'unlocks' = 'needs'): void {
    // The graph is shown in the plan view: the float the button was pressed in closes, or it would stand over it.
    this.closePeek();
    this.graphState.open(id, direction);
  }

  closeGraph(): void {
    this.graphState.close();
  }

  /** Ask again for the graph that is open, after the vault changed (the old one stays until the new one is there). */
  reloadGraph(): void {
    this.graphState.reload();
  }

  // ── the estimate matrix ───────────────────────────────────────────────

  /** Open the matrix on the marked tasks, else on those the list shows. */
  openMatrix(): void {
    // One that is open keeps its draft: a second call (the palette) does not throw the choices away.
    // The matrix is there to write estimates: read only, it is not opened.
    if (this.phase !== 'ready' || !this.can('estimate') || this.matrix || this.refusedReadOnly()) return;
    // Along the rows of the list: grouped by area, the first tasks of the matrix are the first rows, not a pick of all areas.
    const ids = matrixIds(this.marks, this.listed);
    if (ids.length === 0) {
      this.say('ok', 'matrix.none');
      return;
    }
    const wanted = this.marks.length > 0 ? this.marks.length : this.shown.length;
    if (wanted > MATRIX_MAX) this.say('ok', 'matrix.cut', { n: MATRIX_MAX, total: wanted });
    this.matrixState.start(ids);
  }

  closeMatrix(): void {
    this.matrixState.close();
  }

  /** The tasks of the matrix that are still there, in the order they were asked for. */
  get matrixRows(): TaskEntry[] {
    return this.matrixState.rows;
  }

  /** How many tasks the draft would change (a cell equal to its file changes nothing). */
  get matrixChanges(): number {
    return this.matrixState.changes;
  }

  /** Choose a cell (or put it back with `undefined`); the figures are asked for again a moment later. */
  setCell(id: string, field: 'effort' | 'value', value: string | number | undefined): void {
    this.matrixState.setCell(id, field, value);
  }

  /**
   * Write the cells that differ from the files, in one batch, each task with the version that was shown. A task that
   * changed meanwhile fails alone and stays in the matrix with its cells; the others are written and leave the draft.
   */
  async applyMatrix(): Promise<void> {
    const ops = changesOf(this.matrixRows, this.matrixDraft);
    if (ops.length === 0) {
      this.say('ok', 'bulk.nothing');
      return;
    }
    const onAnswer = (result: Result): boolean => {
      const failed = failedIdsOf(ops, result.results);
      if (failed === null) return false;
      const sent = new Set(ops.map((o) => ('id' in o ? o.id : '')));
      const rest: Draft = {};
      for (const [id, cell] of Object.entries(this.matrixDraft)) {
        if (!sent.has(id)) {
          rest[id] = cell;
        } else if (failed.has(id)) {
          // The row shows the task as it is now (the list is read next): its cells are written with that version,
          // not with the old one, which would conflict again for ever.
          const { etag: _old, ...kept } = cell;
          rest[id] = kept;
        }
      }
      const undo = this.inverseOf(result);
      if (failed.size === 0) {
        this.say('ok', 'bulk.saved', { n: ops.length }, undo);
        this.closeMatrix();
      } else {
        this.matrixDraft = rest;
        this.say('error', 'bulk.partial', { done: ops.length - failed.size, failed: failed.size }, undo);
        void this.matrixState.ask();
      }
      return true;
    };
    await this.write(ops, { onAnswer });
  }

  async confirmRepriority(): Promise<void> {
    const asking = this.repriority;
    if (!asking) return;
    this.repriority = null;
    await this.write(asking.ops);
  }

  /**
   * A key or a drop of the board or the inbox that would write while a write is under way: it is refused aloud (an
   * error toast, in the alert region) instead of being dropped without a word. It is deliberately not buffered: a key
   * kept for later would act on a list the person has not seen yet (the write under way may move the card, or sort
   * the task out of the inbox). Nothing is drawn for the refused move: the board only ever shows the engine's state.
   */
  /**
   * The page shows the vault read only: a way into a change (a dialog, a form) is refused with the reason before it
   * opens, not after it was filled in. Says whether it refused.
   */
  private refusedReadOnly(): boolean {
    if (!this.readOnly || this.phase !== 'ready') return false;
    this.say('error', 'write.read_only');
    return true;
  }

  /**
   * Whether a key that writes must be refused now: the page is read only, or a write is on its way (both say so in a
   * toast). For a view that writes with its own keys (the acceptance), as the inbox keys do.
   */
  refusesKeyWrite(): boolean {
    return this.refusedReadOnly() || this.refusedWhileSaving();
  }

  private refusedWhileSaving(): boolean {
    if (!this.saving || this.phase !== 'ready') return false;
    this.say('error', 'write.busy');
    return true;
  }

  /**
   * `id` dropped on a day of the calendar: its `due` date is set to `date`, or taken away for `null` (dropped on the
   * list of the tasks without a date). The engine judges the date (`start` after `due` is refused, in its words).
   */
  async dropOnDay(id: string, date: string | null): Promise<void> {
    if (this.refusedReadOnly() || this.refusedWhileSaving()) return;
    const task = this.tasks.find((t) => t.id === id);
    if (!task || (task.due ?? null) === date) return;
    await this.setField(id, 'due', date);
  }

  /**
   * The dates of `id` as the timeline moved them (a bar dragged, an end pulled, a field of its table): `start`, `due`
   * or both in one write, so that one undo takes the move back; `null` takes a date away. The engine judges them.
   */
  async setDates(id: string, dates: { start?: string | null; due?: string | null }): Promise<void> {
    if (this.refusedReadOnly() || this.refusedWhileSaving()) return;
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    const patch: Record<string, string | null> = {};
    if (dates.start !== undefined && (task.start ?? null) !== dates.start) patch['start'] = dates.start;
    if (dates.due !== undefined && (task.due ?? null) !== dates.due) patch['due'] = dates.due;
    if (Object.keys(patch).length === 0) return;
    await this.write([{ op: 'set', id, patch, ...(task.etag ? { if_match: task.etag } : {}) }]);
  }

  /** `id` dropped on `target`: before or after it. */
  async dropNear(id: string, target: { id: string; place: 'before' | 'after' }): Promise<void> {
    if (this.refusedWhileSaving()) return;
    await this.moveCard(placeNear(this.tasks, id, target, this.can('eff_prio')));
  }

  /** `id` one place up or down inside its group (`K` and `J`). */
  async stepCard(id: string, dir: 1 | -1): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    // A card the filter hides is not moved behind the person's back.
    if (!task || !isColumn(task.status) || !this.shown.some((t) => t.id === id)) return;
    if (this.refusedWhileSaving()) return;
    await this.moveCard(stepInGroup(this.board[task.status], id, dir));
  }

  /** `id` into the column of `status` (a drop on a column, `H` and `L`). */
  async dropOnColumn(id: string, status: string): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || task.status === status || !isColumn(status)) return;
    if (this.refusedReadOnly() || this.refusedWhileSaving()) return;
    // Blocked with nothing that blocks it is a warning of the engine: ask for the blocker first.
    if (status === 'blocked' && task.blocked_by.length === 0) {
      if (this.phase === 'ready' && !this.saving) this.blocking = { id };
      return;
    }
    await this.setField(id, 'status', status);
  }

  cancelBlock(): void {
    this.blocking = null;
  }

  /** The names in `ids` that are no open task of the vault (or the card itself). */
  unknownBlockers(ids: string[]): string[] {
    const self = this.blocking?.id;
    const known = new Set(this.tasks.map((t) => t.id));
    return ids.filter((id) => id === self || !known.has(id));
  }

  /** Block the card, by `ids` or by nothing the person can name. */
  async confirmBlock(blockers: string[]): Promise<void> {
    // The same id twice is one blocker.
    const ids = [...new Set(blockers)];
    const asking = this.blocking;
    if (!asking) return;
    this.blocking = null;
    const task = this.tasks.find((t) => t.id === asking.id);
    if (!task) return;
    await this.write([
      {
        op: 'set',
        id: asking.id,
        patch: { status: 'blocked', ...(ids.length > 0 ? { blocked_by: ids } : {}) },
        ...(task.etag ? { if_match: task.etag } : {}),
      },
    ]);
  }

  /**
   * One arrow of the plan graph: taken away (`remove`), or turned hard or soft (`toggle`). One `set` at the task that
   * waits, on the version shown; the engine says whether it may, and the toast takes it back.
   */
  async editEdge(edge: DepEdge, action: EdgeAction): Promise<void> {
    if (this.refusedReadOnly() || this.refusedWhileSaving()) return;
    const task = this.tasks.find((t) => t.id === edge.to);
    const op = task ? edgeOp(task, edge, action) : null;
    if (op) await this.write([op]);
  }

  /**
   * Make `to` wait for `from` (a drop of one task of the plan graph on another, or the keys): `from` into the
   * `blocked_by` of `to`, or into its `after`. One `set` on the version shown; a cycle is refused by the engine.
   */
  async connectEdge(from: string, to: string, kind: EdgeKind): Promise<void> {
    if (this.refusedReadOnly() || this.refusedWhileSaving()) return;
    const task = this.tasks.find((t) => t.id === to);
    const op = task ? connectOp(task, from, kind) : null;
    if (op) await this.write([op]);
  }

  /** Put a task into a phase of its plan ('' takes the phase away): a drop into a row of the graph by phase. */
  async setPhase(id: string, phase: string): Promise<void> {
    if (this.refusedReadOnly() || this.refusedWhileSaving()) return;
    const task = this.tasks.find((t) => t.id === id);
    const op = task ? phaseOp(task, phase) : null;
    if (op) await this.write([op]);
  }

  /** A card dropped on the zone for finished work: the same two steps as the button. */
  async dropOnDone(id: string): Promise<void> {
    if (!this.shown.some((t) => t.id === id)) return;
    if (this.refusedWhileSaving()) return;
    await this.startFinish(id);
  }

  /** `id` one column to the left or right. */
  async shiftColumn(id: string, dir: 1 | -1): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || !this.shown.some((t) => t.id === id)) return;
    if (this.refusedWhileSaving()) return;
    const to = neighbourColumn(task.status, dir);
    if (to) await this.dropOnColumn(id, to);
    // Past the last column lies the strip the mouse drops on to finish: the keyboard gets the same way (with the preview).
    else if (dir === 1) await this.startFinish(id);
  }

  /** The selection to the next card of its column (`j`, `k`). */
  moveSelectionInColumn(delta: number): void {
    const task = this.tasks.find((t) => t.id === this.selectedId);
    if (!task || !isColumn(task.status)) {
      const first = COLUMNS.filter((c) => this.columnShown(c)).flatMap((c) => this.board[c])[0];
      if (first) this.select(first.id);
      return;
    }
    const column = this.board[task.status];
    const at = column.findIndex((t) => t.id === task.id);
    const next = column[at + delta];
    if (next) this.select(next.id);
  }

  /** Whether the cards of a column of the board are drawn: a folded column shows its head only. */
  columnShown(column: Column): boolean {
    return foldOf(this.folds.board, column) === 'open';
  }

  /** The selection to the same height in the column left or right (`h`, `l`); empty and folded columns are passed. */
  moveSelectionAcross(dir: 1 | -1): void {
    const task = this.tasks.find((t) => t.id === this.selectedId);
    if (!task || !isColumn(task.status)) return;
    const at = task.status;
    const board = this.board;
    const row = board[at].findIndex((t) => t.id === task.id);
    let col = neighbourColumn(at, dir);
    while (col !== null && (board[col].length === 0 || !this.columnShown(col))) col = neighbourColumn(col, dir);
    if (col === null) return;
    const target = board[col][Math.min(row, board[col].length - 1)];
    if (target) this.select(target.id);
  }

  /**
   * The task made, or null: the id of the first one when several areas are named (one task with the same text in
   * each, in one write, as `:Tasks new` does with `Area: a, b`).
   */
  async createTask(
    areas: string | readonly string[],
    title: string,
    fields: Record<string, unknown> = {},
    body = '',
  ): Promise<string | null> {
    const text = body.trim();
    const names = typeof areas === 'string' ? [areas] : [...new Set(areas)];
    if (names.length === 0) return null;
    const result = await this.write(
      names.map((area) => ({
        op: 'new' as const,
        area,
        title,
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
        // A text replaces the sections of the template; none keeps them.
        ...(text !== '' ? { body: text } : {}),
      })),
      { undoable: false },
    );
    const created = result?.results.find((r) => r.ok && r.outcome === 'created')?.id;
    this.capturing = false;
    // The new task in its float over the list; `c` there captures the next one (App.svelte), so that one task after the
    // other is written with c, its title and Enter.
    if (created) {
      this.reveal(created);
    }
    return created ?? null;
  }

  /** The link of the screenshot attached last, to put into the text of its task (shown in its detail). */
  attached = $state<{ id: string; link: string } | null>(null);

  /**
   * Attach the image on the clipboard of the hub's machine to `id`, else its newest screenshot: the engine's `attach`,
   * as `:Tasks attach` does in the editor. Only a clipboard without an image asks for the screenshot (the engine says
   * `invalid_argument` for any failure, a tool that is missing or a clipboard that is locked too: those are told, and
   * no other image is taken in their place). There is nothing to take back (the engine gives no inverse). True when
   * one was attached.
   */
  async attachScreenshot(id: string): Promise<boolean> {
    for (const from of ['clipboard', 'latest'] as const) {
      let none = false;
      const result = await this.write([{ op: 'attach', id, from }], {
        undoable: false,
        onAnswer: (answer) => {
          const entry = answer.results[0];
          if (entry?.ok) {
            this.say('ok', from === 'clipboard' ? 'attach.done' : 'attach.done_latest', { asset: entry.asset ?? '' });
            return true;
          }
          if (entry?.error?.code === 'invalid_argument' && (from === 'latest' || clipboardHoldsNoImage(entry.error.message))) {
            none = true;
            return true;
          }
          return false;
        },
      });
      const entry = result?.results[0];
      if (entry?.ok) {
        this.attached = entry.link ? { id: entry.id ?? id, link: entry.link } : null;
        return true;
      }
      if (!none) return false;
    }
    this.say('error', 'attach.none');
    return false;
  }

  /**
   * Attach what a form gathered to `id` once the task, plan or project is made: each file (to the folder of its kind),
   * then the image of the clipboard (else the newest screenshot). One after another, each told as it goes; one that
   * fails does not stop the others.
   */
  async attachAll(id: string, files: readonly File[], screenshot: boolean): Promise<void> {
    for (const file of files) await this.attachFile(id, file, kindOfFile(file));
    if (screenshot) await this.attachScreenshot(id);
  }

  /** The task a file is on its way to, while one is. */
  uploading = $state<string | null>(null);

  /**
   * What the camera or the screen took and is not attached yet (`AttachBar`): kept by the page, not by the bar, so that
   * closing the detail or opening another task does not lose a recording. Gone with the tab.
   */
  keptCaptures = $state<Taken[]>([]);

  /**
   * Attach a file from this computer to `id`: it goes through the hub, and the engine makes it an asset of the task (a
   * plain task becomes a folder task). One file at a time. There is nothing to take back (the engine gives no inverse).
   * `kind` names the folder of the task it goes to (`assets/videos/`, `assets/images/`, `assets/screenshots/`); without
   * it the file lies in `assets/` itself. True when it was attached.
   */
  async attachFile(id: string, file: File, kind?: AssetKind): Promise<boolean> {
    return (await this.attachFileAsset(id, file, kind)) !== null;
  }

  /** `attachFile`, answering the path of the asset below the folder (`assets/images/x.png`), or null when it failed. */
  async attachFileAsset(id: string, file: File, kind?: AssetKind): Promise<string | null> {
    if (this.refusedReadOnly() || this.uploading !== null) return null;
    this.uploading = id;
    try {
      const result = await this.env.hub.upload(id, file, kind);
      const entry = result.results[0];
      if (!entry?.ok) {
        this.say('error', 'write.failed', { code: entry?.error?.code ?? 'failed' });
        return null;
      }
      this.attached = entry.link ? { id: entry.id ?? id, link: entry.link } : null;
      this.say(
        'ok',
        result.large_for_git ? 'attach.file_done_large' : 'attach.file_done',
        { asset: entry.asset ?? '' },
      );
      return typeof entry.asset === 'string' ? entry.asset : '';
    } catch (error) {
      if (error instanceof ApiError && error.code === 'disk_full') this.say('error', 'attach.disk_full');
      else this.say('error', 'write.failed', { code: error instanceof ApiError ? error.code : 'offline' });
      return null;
    } finally {
      this.uploading = null;
    }
  }

  async startFinish(id: string): Promise<void> {
    if (this.refusedReadOnly() || this.saving || this.phase !== 'ready') return;
    try {
      const preview = await this.env.hub.donePreview(id);
      if (preview.already) {
        this.say('ok', 'done.already');
        return;
      }
      this.finishing = { id, preview };
    } catch (error) {
      this.say('error', 'write.failed', { code: error instanceof ApiError ? error.code : 'offline' });
    }
  }

  cancelFinish(): void {
    this.finishing = null;
  }

  /** `remind` (`+7d`, a date) sets a reminder on the finished task. */
  async confirmFinish(remind?: string): Promise<void> {
    const finishing = this.finishing;
    if (!finishing?.preview.confirm) return;
    this.finishing = null;
    await this.write(
      [
        {
          op: 'done',
          id: finishing.id,
          confirm: finishing.preview.confirm,
          ...(remind ? { remind } : {}),
        },
      ],
      // The way back is to bring the task back (see `inverseOf`).
    );
  }

  /** One task with its body, for the acceptance view (the detail pane keeps its own). */
  readTask(id: string): Promise<TaskDocument> {
    return this.env.hub.task(id);
  }

  /** The text of a snapshot a test-sheet block names; the hub reads it from the plugin checkouts. */
  readSheetSnapshot(name: string): Promise<string> {
    return this.env.snapshots ? this.env.snapshots.read(name) : this.env.hub.sheetSnapshot(name);
  }

  /** Whether this page asks the person for the folder of the plugin checkouts. */
  get canChooseCheckouts(): boolean {
    return this.env.snapshots !== undefined;
  }

  /** Ask for that folder; whether there is one now. */
  chooseCheckouts(): Promise<boolean> {
    return this.env.snapshots?.choose() ?? Promise.resolve(false);
  }

  /** Show the file of a task in Neovim. The hub starts the window; the answer says when it could not. */
  async openInEditor(id: string): Promise<void> {
    try {
      await this.env.hub.openInEditor(id);
      this.say('ok', 'editor.opened');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '';
      this.say('error', 'editor.failed', { message });
    }
  }

  /** Bring a finished task back (the reminder of a finished task offers it). */
  async reopen(id: string): Promise<void> {
    await this.write([{ op: 'reopen', id }], { undoable: false });
  }

  /** Remember the widths of the columns of the list (on every change: a drag ends with the last one). */
  setListColumns(columns: ListColumns): void {
    this.listColumns = columns;
    safe(() => this.env.prefs.setItem('tasks-desktop.list-columns', serializeColumns(columns)));
  }

  /** Draw the plan as stages or as a graph, or compare the plans, and remember the choice. */
  setPlanDisplay(display: PlanDisplay): void {
    this.planDisplay = display;
    safe(() => this.env.prefs.setItem('tasks-desktop.plan-display', display));
  }

  /** The name this browser reserves tasks under (`''`: none, every valid claim is somebody else's), kept. */
  setClaimName(text: string): void {
    this.claimName = cleanClaimName(text);
    safe(() => this.env.prefs.setItem('tasks-desktop.claim-name', this.claimName));
  }

  /** Sort the comparison of plans, and remember it. */
  setCompareSort(sort: CompareSort): void {
    this.compareSort = sort;
    safe(() => this.env.prefs.setItem('tasks-desktop.compare-sort', serializeCompareSort(sort)));
  }

  /** Lay the rows of the plan graph by stage or by phase, and remember the choice. */
  setGraphRows(rows: 'stage' | 'phase'): void {
    this.graphRows = rows;
    safe(() => this.env.prefs.setItem('tasks-desktop.graph-rows', rows));
  }

  /**
   * Keep the order of one row of the plan graph (`ids`), or forget it (`null`); `row` null forgets every row of the
   * plan. Nothing of the vault changes.
   */
  setGraphOrder(plan: string, row: string | null, ids: string[] | null): void {
    const rows = { ...(this.graphOrder[plan] ?? {}) };
    if (row === null) for (const key of Object.keys(rows)) delete rows[key];
    else if (ids === null) delete rows[row];
    else rows[row] = ids;
    const next = { ...this.graphOrder };
    if (Object.keys(rows).length > 0) next[plan] = rows;
    else delete next[plan];
    this.graphOrder = next;
    safe(() => this.env.prefs.setItem('tasks-desktop.graph-order', JSON.stringify(next)));
  }

  /** Set the folds of the blocks of one view, and remember them. */
  setFolds(view: FoldView, folds: Folds): void {
    this.folds = { ...this.folds, [view]: folds };
    safe(() => this.env.prefs.setItem('tasks-desktop.folds', serializeFolds(this.folds)));
  }

  /** Give a block a size of its own, or the size of the layout back with `null`, and remember it. */
  setTileSize(key: string, size: Size | null): void {
    this.tileSizes = withSize(this.tileSizes, key, size);
    safe(() => this.env.prefs.setItem('tasks-desktop.sizes', serializeSizes(this.tileSizes)));
  }

  /** Show the grip of one block, or take it away again (a second press on the same block). */
  toggleSizing(key: string): void {
    this.sizing = this.sizing === key ? null : key;
  }

  /** Hold the fields of the detail until they are saved (`manual`), or write each at once (`auto`). Drafts stay. */
  setSaveMode(mode: 'auto' | 'manual'): void {
    this.saveMode = mode;
    safe(() => this.env.prefs.setItem('tasks-desktop.save-mode', mode));
  }

  /**
   * The unsaved changes of a task (empty when there are none). Only in `manual`: after a switch to `auto` the drafts
   * are kept but not shown, and come back with `manual`.
   */
  draftOf(id: string): Readonly<Record<string, FieldValue>> {
    return this.saveMode === 'manual' ? (this.drafts[id] ?? {}) : {};
  }

  /** Whether any task has unsaved changes (the page asks before it is closed). */
  get hasDrafts(): boolean {
    // A draft of a task that is not in the list any more (finished, removed outside) cannot be saved: not asked about.
    return this.saveMode === 'manual' && this.tasks.some((t) => t.id in this.drafts);
  }

  /**
   * A field of the detail changed: written at once (`auto`), or held in the task's draft (`manual`). A value that is
   * what the file has takes the key out of the draft again.
   */
  async editField(id: string, key: string, value: FieldValue): Promise<void> {
    if (this.saveMode === 'auto') return this.setField(id, key, value);
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    const next = { ...this.draftOf(id) };
    if (Object.keys(next).length === 0) this.draftBase[id] = task.etag;
    if (sameField(value, (task as unknown as Record<string, unknown>)[key])) delete next[key];
    else next[key] = value;
    this.setDraft(id, next);
  }

  /**
   * Several fields of the detail changed together (a new plan takes the phase of the old one away): one write at once
   * (`auto`), or each held in the draft (`manual`), as `editField` does for one.
   */
  async editFields(id: string, patch: Record<string, FieldValue>): Promise<void> {
    const keys = Object.keys(patch);
    if (keys.length === 1) return this.editField(id, keys[0]!, patch[keys[0]!]!);
    if (this.saveMode === 'manual') {
      for (const key of keys) await this.editField(id, key, patch[key]!);
      return;
    }
    const task = this.tasks.find((t) => t.id === id);
    if (!task || keys.length === 0) return;
    await this.write([{ op: 'set', id, patch, ...(task.etag ? { if_match: task.etag } : {}) }]);
  }

  private setDraft(id: string, draft: Record<string, FieldValue>): void {
    const all = { ...this.drafts };
    if (Object.keys(draft).length === 0) {
      delete all[id];
      delete this.draftBase[id];
    } else all[id] = draft;
    this.drafts = all;
  }

  /** The task moved to another id (`move_area`, made by this page): its draft goes with it, on the moved file. */
  private moveDraft(from: string, to: string): void {
    const draft = this.drafts[from];
    if (!draft || from === to) return;
    const all = { ...this.drafts, [to]: draft };
    delete all[from];
    this.drafts = all;
    delete this.draftBase[from];
    this.draftBase[to] = this.tasks.find((t) => t.id === to)?.etag;
  }

  /** Throw the unsaved changes of a task away: the fields show the file again. */
  discardDraft(id: string): void {
    this.setDraft(id, {});
  }

  /**
   * Write the unsaved changes of a task in one request, against the version of the file that was shown (`if_match`).
   * The draft is dropped only when the engine wrote it; a refusal (the file changed meanwhile) keeps it, and the page
   * reads the task again, so a second save is against the new version. Says whether it was written.
   */
  async saveDraft(id: string): Promise<boolean> {
    // A copy: the draft may change while the write is under way.
    const patch = { ...this.draftOf(id) };
    const task = this.tasks.find((t) => t.id === id);
    if (!task || Object.keys(patch).length === 0) return false;
    const base = id in this.draftBase ? this.draftBase[id] : task.etag;
    // The entries of the conflict center now: a refusal of this save adds one (or replaces the one of the same change).
    const conflictsBefore = new Set(this.conflicts);
    const result = await this.write([{ op: 'set', id, patch, ...(base ? { if_match: base } : {}) }]);
    if (result?.ok !== true) {
      // The file moved on since the draft was made: the change now lives in the conflict center (to try again or
      // throw away there), and the fields show the file, as after any refused change. Another refusal (a value the
      // engine does not take) keeps the draft to be put right.
      if (this.conflicts.some((c) => c.id === id && !conflictsBefore.has(c))) this.discardDraft(id);
      return false;
    }
    // What was saved is not a draft any more; a field changed again while the write was under way stays one.
    this.setDraft(id, Object.fromEntries(Object.entries(this.draftOf(id)).filter(([k, v]) => !(k in patch) || !sameField(v, patch[k] ?? null))));
    return true;
  }

  setAreaSplit(on: boolean): void {
    this.areaSplit = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.area-split', on ? 'on' : 'off'));
  }

  setGroupAreas(on: boolean): void {
    this.groupAreas = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.group-areas', on ? 'on' : 'off'));
  }

  setZebra(on: boolean): void {
    this.zebra = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.zebra', on ? 'on' : 'off'));
  }

  setRowActions(prefs: RowActionPrefs): void {
    this.rowActions = prefs;
    safe(() => this.env.prefs.setItem('tasks-desktop.row-actions', serializeRowActions(prefs)));
  }

  /**
   * The ids of the learning tasks while they are hidden, else none: what a list of the engine that names tasks by id
   * (the next tasks of the overview) is narrowed with.
   */
  get hiddenLearning(): ReadonlySet<string> {
    return this.learningHidden ? learningIds(this.tasks) : NO_IDS;
  }

  setLearningHidden(on: boolean): void {
    this.learningHidden = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.hide-learning', on ? 'on' : 'off'));
  }

  /** The switch "Show XP, levels and rewards" of the learning paths, kept in this browser. */
  setGamification(on: boolean): void {
    this.gamification = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.gamification', on ? 'on' : 'off'));
  }

  /**
   * Whether a level reached in path `id` is news: the highest level said so far is kept in this browser. The first look
   * at a path only notes its level (a path opened at level 2 is no news); a higher one later is said once.
   */
  levelNews(id: string, level: number): boolean {
    const raw = safe(() => this.env.prefs.getItem('tasks-desktop.levels-seen')) ?? null;
    let seen: Record<string, number> = {};
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) seen = parsed as Record<string, number>;
    } catch {
      seen = {};
    }
    const before = typeof seen[id] === 'number' ? seen[id] : undefined;
    if (before !== undefined && level <= before) return false;
    seen[id] = level;
    safe(() => this.env.prefs.setItem('tasks-desktop.levels-seen', JSON.stringify(seen)));
    return before !== undefined;
  }

  setBarAreas(on: boolean): void {
    this.barAreas = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.bar-areas', on ? 'on' : 'off'));
  }

  /**
   * Whether the page offers its AI functions (the button of a task, menu entries, commands of the palette): only where
   * ai-desktop is found and the person did not turn them off. AI does not push itself forward.
   */
  get aiFeatures(): boolean {
    return this.aiWanted && this.aiFound;
  }

  /** ai-desktop is on this machine: installed, or running (a build started from its checkout has no installer). */
  get aiFound(): boolean {
    return this.aiDesktop !== null && (this.aiDesktop.installed || this.aiDesktop.running);
  }

  /** The switch "Show AI functions" of the Options menu, kept in this browser. */
  setAiWanted(on: boolean): void {
    this.aiWanted = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.ai', on ? 'on' : 'off'));
  }

  /**
   * What a job may ask of the agent for a task of `status`: always the hand-over; a review only of a finished task, the
   * preparation of a decision only of a task that waits for one (the hub checks it again).
   */
  agentKinds(status: string | undefined): AgentKind[] {
    return [
      'handoff',
      ...(status === 'done' ? (['review-done'] as const) : []),
      ...(status === 'decision' ? (['prepare-decision'] as const) : []),
    ];
  }

  /** Why "Hand to an agent" cannot be used now, or null: one task at a time (several marked tasks go later, if at all). */
  get agentBlocked(): Key | null {
    return this.marks.length > 1 ? 'agent.one_only' : null;
  }

  /**
   * Where the job of an agent can be looked at: the dashboard of the running ai-desktop at that job, or null (ai-desktop
   * is not running, the AI functions are off, or its port is not known).
   */
  agentJobUrl(job: string): string | null {
    const found = this.aiDesktop;
    if (!this.aiFeatures || !found?.running || !found.port) return null;
    return `http://127.0.0.1:${found.port}/#job=${encodeURIComponent(job)}`;
  }

  /**
   * The feedback of the agents as one line: the first change in words ("Finished by agent ...: ..."), and how many more
   * came with the same list. Nothing to say: nothing is shown.
   */
  private sayAgentNews(news: readonly AgentNews[]): void {
    const [first] = news;
    if (!first) return;
    const text = translate(this.lang, `agent.news.${first.kind}` as Key, { job: first.job, title: first.title });
    if (news.length === 1) this.toast = { kind: 'ok', text };
    else this.toast = { kind: 'ok', text: translate(this.lang, 'agent.news.more', { first: text, n: news.length - 1 }) };
  }

  /** Is the area public or internal (ai-desktop may send it to a model in the cloud), not private or unclassified? */
  agentAreaShared(area: string): boolean {
    return cacheableClass(this.hubAreas.find((a) => a.name === area)?.data_class);
  }

  /** Open the dialog "Hand to an agent" for `id`: only where the AI functions are offered, one task at a time. */
  openAgent(id: string): void {
    if (!this.aiFeatures) return;
    const blocked = this.agentBlocked;
    if (blocked) {
      this.say('error', blocked);
      return;
    }
    this.agentFor = id;
  }

  closeAgent(): void {
    if (!this.agentSending) this.agentFor = null;
  }

  /**
   * Check a finished task against its acceptance (`review-done`) or prepare a task that waits for a decision
   * (`prepare-decision`): the job runs at once in ai-desktop, the dialog shows where it stands and then the answer the
   * engine took apart. Only where the AI functions are offered.
   */
  async startAnswer(id: string, kind: AnswerKind, title: string): Promise<void> {
    if (!this.aiFeatures) return;
    this.#answerConfirm?.(false);
    const run = ++this.#answerRun;
    const area = id.split('/')[0] ?? '';
    this.answer = { id, area, title, kind, phase: 'waiting' };
    const mine = () => run === this.#answerRun;
    const set = (patch: Partial<AnswerView>) => {
      if (mine() && this.answer) this.answer = { ...this.answer, ...patch };
    };
    try {
      const outcome = await runAnswer(this.env.hub, id, kind, {
        started: (job) => set({ job }),
        wanted: mine,
        confirm: () =>
          new Promise<boolean>((resolve) => {
            if (!mine()) return resolve(false);
            this.#answerConfirm = (yes) => {
              this.#answerConfirm = null;
              set({ phase: 'waiting' });
              resolve(yes);
            };
            set({ phase: 'confirm' });
          }),
        sleep: (ms) => this.env.sleep(ms),
        now: () => this.env.now(),
      });
      if (outcome.kind === 'answer') set({ phase: 'shown', answer: outcome.answer });
      else if (outcome.kind === 'failed') set({ phase: 'failed', why: outcome.why, ...(outcome.job ? { job: outcome.job } : {}) });
      else if (mine()) this.answer = null;
    } catch (error) {
      set({ phase: 'failed', why: error instanceof ApiError ? error.message : String(error) });
    }
  }

  /** The yes or no to sending the task of a private area to a model that is not local. */
  confirmAnswer(yes: boolean): void {
    this.#answerConfirm?.(yes);
  }

  /** Write the answer into the task (one `set_section` per section); it stays shown, its follow-up still to make. */
  async adoptAnswer(): Promise<void> {
    const view = this.answer;
    if (!view?.answer || view.phase !== 'shown') return;
    const result = await this.write(adoptOps(view.id, view.answer));
    if (result && result.results.every((r) => r.ok) && this.answer === view) {
      this.answer = { ...view, phase: 'adopted' };
    }
  }

  /** Make the follow-up task the review proposes, in the area of the reviewed task: only on this click. */
  async createFollowUp(): Promise<void> {
    const view = this.answer;
    const followUp = view?.answer?.followUp;
    if (!view || !followUp || view.followUpMade) return;
    const result = await this.write([followUpOp(view.area, followUp)], { undoable: false });
    const made = result?.results.find((r) => r.ok && r.outcome === 'created')?.id;
    if (made && this.answer?.id === view.id) this.answer = { ...this.answer, followUpMade: made };
  }

  /** Close the dialog: a job still watched is left to ai-desktop (it stays in its dashboard). */
  closeAnswer(): void {
    this.#answerRun += 1;
    this.#answerConfirm?.(false);
    this.answer = null;
  }

  /**
   * Hand the task of the dialog to ai-desktop: the hub reads the file and sends it. Says the job (or why it did not go)
   * and keeps the mode as the next default.
   */
  async handToAgent(mode: 'prefill' | 'run', kind: AgentKind, dashboard = false, tab: AgentTab | null = null): Promise<void> {
    const id = this.agentFor;
    if (id === null || this.agentSending || !this.aiFeatures) {
      tab?.close();
      return;
    }
    this.agentMode = mode;
    safe(() => this.env.prefs.setItem('tasks-desktop.agent-mode', mode));
    this.agentDashboard = dashboard;
    safe(() => this.env.prefs.setItem('tasks-desktop.agent-dashboard', dashboard ? 'on' : 'off'));
    this.agentSending = true;
    try {
      const job = await this.env.hub.handToAgent(id, mode, kind);
      this.agentFor = null;
      // The tab opened at the click goes to the dashboard of ai-desktop at this job (the port only, never a secret).
      if (tab) {
        if (Number.isInteger(job.port) && job.port > 0 && job.port < 65536) {
          tab.go(`http://127.0.0.1:${job.port}/#job=${encodeURIComponent(job.job_id)}`);
        } else {
          tab.close();
        }
      }
      const key = job.status === 'needs_confirmation' ? 'agent.sent_confirm' : mode === 'run' && job.status === 'running' ? 'agent.sent_run' : 'agent.sent';
      this.say('ok', key, { job: job.job_id });
    } catch (error) {
      tab?.close();
      const why = error instanceof ApiError ? error.message : String(error);
      this.say('error', 'agent.failed', { why });
    } finally {
      this.agentSending = false;
    }
  }

  /**
   * The values a draft of "Suggest fields" may use: the areas of the vault, the kinds and categories of the form, the
   * tags of the tasks and the ids of the plans.
   */
  draftChoices(): DraftChoices {
    const tags = new Set<string>();
    for (const task of this.tasks) for (const tag of task.tags ?? []) tags.add(tag);
    return draftChoices({
      areas: [...this.allAreaNames],
      kinds: [...this.ranges.kinds],
      tags: [...tags],
      categories: [...this.ranges.categories],
      plans: (this.snapshot?.plans ?? []).map((p) => p.id),
    });
  }

  /**
   * "Suggest fields": ask ai-desktop for the fields of a new task from `text` (only where the AI functions are offered).
   * `confirm` is asked before the text goes to a model that does not run on this machine; `wanted` false (the form was
   * closed) stops the asking. Nothing is created.
   */
  async suggestFields(text: string, confirm: () => Promise<boolean>, wanted: () => boolean = () => true): Promise<DraftOutcome> {
    if (!this.aiFeatures) return { kind: 'failed', why: 'the AI functions are off' };
    try {
      return await runDraft(this.env.hub, text, this.draftChoices(), { confirm, wanted });
    } catch (error) {
      return { kind: 'failed', why: error instanceof ApiError ? error.message : String(error) };
    }
  }

  /** The dialog "Paste an intent" is open. */
  intentOpen = $state(false);

  /** Open "Paste an intent": only where something could come of it (the list is there). */
  openIntent(): void {
    if (this.phase !== 'ready') return;
    this.intentOpen = true;
  }

  closeIntent(): void {
    this.intentOpen = false;
  }

  /**
   * Take an intent another app handed over (`wkd-intent/1`), as the text that was pasted or read from a file. The
   * text is untrusted: its size and that it is one JSON object are looked at here, everything else is the engine's
   * check, asked without a yes. Nothing is written: a finding opens the new-task form filled in (a task is made by
   * *Create*), `tasks.show` shows the task, and a finding a task holds already is told with that task.
   */
  async takeIntent(text: string): Promise<IntentOutcome> {
    const read = readIntent(text);
    if ('problem' in read) return { kind: 'refused', problem: read.problem };
    let answer: Awaited<ReturnType<typeof this.env.hub.intent>>;
    try {
      answer = await this.env.hub.intent(text);
    } catch (error) {
      return { kind: 'refused', why: error instanceof ApiError ? error.message : String(error) };
    }
    if (answer.outcome === 'shown' && answer.id !== undefined) {
      this.openIntentTask(answer.id);
      return { kind: 'shown', id: answer.id };
    }
    if (answer.outcome === 'not_found') return { kind: 'not_found', id: answer.id ?? '' };
    if (answer.outcome === 'exists' && answer.id !== undefined) return { kind: 'exists', id: answer.id };
    if (answer.outcome !== 'would_create') return { kind: 'refused', why: answer.outcome };
    // Nothing could be created in a vault that is read only: said here, not after the form was filled in.
    if (this.readOnly) return { kind: 'refused', why: translate(this.lang, 'write.read_only') };
    const fill = fillOfFinding(read.doc, this.lang);
    this.closeIntent();
    const { title, area, ...rest } = fill;
    this.openCapture(title, area !== undefined && this.allAreaNames.includes(area) ? area : undefined, rest);
    return { kind: 'form' };
  }

  /** The task an intent names (or the one that holds its finding already): shown over the view. */
  openIntentTask(id: string): void {
    this.closeIntent();
    this.peek(id);
  }

  /** The plan the dialog "Split into tasks" is open for; null: closed. */
  splitFor = $state<string | null>(null);

  /** Open "Split into tasks" for the plan `id`: only where the AI functions are offered and the vault can be written. */
  openSplit(id: string): void {
    if (!this.aiFeatures || this.readOnly) return;
    this.splitFor = id;
  }

  closeSplit(): void {
    this.splitFor = null;
  }

  /**
   * Ask ai-desktop for the drafts of the plan `id`; `confirm` before a private area goes to a model that is not local,
   * `wanted` false (the dialog was closed) stops the asking.
   */
  async askSplit(id: string, confirm: () => Promise<boolean>, wanted: () => boolean = () => true): Promise<SplitOutcome> {
    if (!this.aiFeatures) return { kind: 'failed', why: 'the AI functions are off' };
    try {
      return await runSplit(this.env.hub, id, { confirm, wanted });
    } catch (error) {
      return { kind: 'failed', why: error instanceof ApiError ? error.message : String(error) };
    }
  }

  /**
   * Create the ticked drafts of a split in the plan `plan` through the engine (`new`, then `set blocked_by`), one at a
   * time, so that a draft the engine refuses refuses only itself. With `addPhases` the new phases go into the plan's
   * `phase_order` first; without it (or when that is refused) the drafts of those phases are refused.
   */
  async createSplit(
    plan: string,
    split: Split,
    ticked: readonly number[],
    job: string,
    newPhases: readonly string[],
    addPhases: boolean,
  ): Promise<DraftResult[]> {
    let phasesOk = newPhases.length === 0;
    if (newPhases.length > 0 && addPhases) {
      const order = (this.snapshot?.plans ?? []).find((p) => p.id === plan)?.phase_order ?? [];
      phasesOk = await this.setPlanFile('plan', plan, { phase_order: [...order, ...newPhases.filter((p) => !order.includes(p))] });
    }
    const quiet = { undoable: false, onAnswer: () => true };
    const results = await createDrafts(
      {
        create: async (area, title, fields, body) => {
          const result = await this.write([{ op: 'new', area, title, fields, body }], quiet);
          const entry = result?.results[0];
          if (entry?.ok && entry.id) return { id: entry.id };
          return { error: entry?.error?.message ?? entry?.error?.code ?? 'not written' };
        },
        setBlockedBy: async (id, ids) => {
          const result = await this.write([{ op: 'set', id, patch: { blocked_by: ids } }], quiet);
          const entry = result?.results[0];
          return entry?.ok ? null : (entry?.error?.message ?? entry?.error?.code ?? 'not written');
        },
      },
      split,
      ticked,
      { plan, job, lang: this.lang, newPhases, phasesOk },
    );
    const made = results.filter((r) => 'id' in r).length;
    this.say(made === results.length ? 'ok' : 'error', 'split.summary', { made, n: results.length });
    return results;
  }

  /** A read that fails (a hub that is restarting) keeps what was known: the switch does not come and go with it. */
  private async readAiDesktop(): Promise<void> {
    const found = await this.env.hub.aiDesktop();
    if (found !== null) this.aiDesktop = found;
  }

  setShortAreas(on: boolean): void {
    this.shortAreas = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.short-areas', on ? 'on' : 'off'));
  }

  setAreaCounts(on: boolean): void {
    this.areaCountsShown = on;
    safe(() => this.env.prefs.setItem('tasks-desktop.area-counts', on ? 'on' : 'off'));
  }

  /** For each area how many tasks the filter would keep with that area as its only one (the choice of the areas). */
  get areaCounts(): Map<string, number> {
    // with the name of this browser for the claim filter (the areas are set per area below, so no group is expanded)
    const counts = areaCounts(this.tasks, { ...this.filter, claimant: this.claimName }, this.areaNames, this.today, this.crossIndex, this.quickWinSet, this.projectOf);
    // a group counts what it would keep as the only choice: its members' tasks
    for (const group of this.areaGroups) {
      if (counts.has(group.name)) continue;
      const only = this.matchFilter({ ...this.filter, areas: [group.name] });
      counts.set(group.name, applyFilter(this.tasks, only, this.today, this.crossIndex, this.quickWinSet, this.projectOf).length);
    }
    return counts;
  }

  /** The field and the order of the statistics, remembered. */
  setStats(dim: StatDim, sort: StatSort): void {
    this.statsDim = dim;
    this.statsSort = sort;
    safe(() => this.env.prefs.setItem('tasks-desktop.stats', JSON.stringify({ dim, sort })));
  }

  /** The tiles the statistics show, remembered. */
  setStatsTiles(prefs: TilePrefs): void {
    this.statsTiles = prefs;
    safe(() => this.env.prefs.setItem('tasks-desktop.stats-tiles', JSON.stringify(prefs)));
  }

  /** The filter bar of the statistics folded or unfolded, remembered. */
  setStatsFilterOpen(open: boolean): void {
    this.statsFilterOpen = open;
    safe(() => this.env.prefs.setItem('tasks-desktop.stats-filter', open ? 'open' : 'closed'));
  }

  /** A card of the statistics folded or unfolded, remembered. */
  setStatsCardOpen(card: StatsCard, open: boolean): void {
    this.statsFolded = withCardFolded(this.statsFolded, card, !open);
    safe(() => this.env.prefs.setItem('tasks-desktop.stats-folds', JSON.stringify(this.statsFolded)));
  }

  /**
   * The address named a card of the statistics alone (a window it was opened in): the page shows that card, with the
   * field and the order it was opened with. They are not remembered: the window of the card shows what it was told.
   */
  openCardRoute(route: CardRoute): void {
    this.view = 'stats';
    this.statsCard = route.card;
    if (route.dim !== undefined) this.statsDim = route.dim;
    if (route.sort !== undefined) this.statsSort = route.sort;
  }

  /** A window of one card shows the whole statistics; the address becomes the view's again. */
  showAllStats(): void {
    this.statsCard = null;
  }

  /** Open a card of the statistics alone in a new window, with the filter, the field and the order of now. */
  openCardApart(card: StatsCard): void {
    const route = cardRoute(card, this.statsDim, this.statsSort, filterText(this.filter));
    if (!(this.env.openWindow?.(route) ?? false)) this.say('error', 'peek.detach_failed');
  }

  /** May the name of this area leave the app (an export of the statistics)? Its class decides, as for an export of its tasks. */
  areaMayLeave(area: string): boolean {
    return this.mayRememberArea(area);
  }

  /** Save the text of an export of a card as a file, or copy it; told either way. */
  async putCardText(name: string, text: string, type: string, how: 'save' | 'copy'): Promise<void> {
    const ok = how === 'save' ? this.env.out.save(name, text, type) : await this.env.out.copy(text);
    if (ok) this.say('ok', how === 'save' ? 'stats.card.saved' : 'stats.card.copied');
    else this.say('error', how === 'save' ? 'stats.card.save_failed' : 'stats.card.copy_failed');
  }

  /** The separator of a CSV for the spreadsheet of this browser's locale. */
  get csvSeparator(): ',' | ';' {
    return csvSeparatorFor(this.env.preferredLanguages[0]);
  }

  /** The page for the printer of a card could not be made. */
  sayPrintFailed(): void {
    this.say('error', 'print.failed');
  }

  /** The figure and the period of the history, remembered. */
  setStatsHistory(prefs: HistoryPrefs): void {
    this.statsHistory = prefs;
    safe(() => this.env.prefs.setItem('tasks-desktop.stats-history', JSON.stringify(prefs)));
  }

  /** The figures of the overview over time (the engine keeps the series; the page only draws it). */
  history(
    query: { area?: string; since?: string; until?: string; resolution?: 'day' | 'week' },
    signal?: AbortSignal,
  ): Promise<History> {
    return this.env.hub.history(query, signal);
  }

  /**
   * The statistics with the history of one figure, from a number of another view: the filter stays as it is (the
   * history is of the areas it names), and the way back knows the view and how far it was scrolled.
   */
  openHistory(metric: HistoryMetric, scroll = 0): void {
    if (!this.can('history')) return;
    this.setStatsHistory({ ...this.statsHistory, metric });
    // From a number of the statistics itself the history is a card further down: no way back to name, the one there
    // was (from Today) stays.
    if (this.view !== 'stats') this.historyFrom = { view: this.view, scroll };
    this.historyShown += 1;
    this.setView('stats');
  }

  /** Back to where the history was opened from, scrolled as it was. */
  backFromHistory(): void {
    const from = this.historyFrom;
    if (!from) return;
    if (from.view === 'today') this.todayScroll = from.scroll;
    this.setView(from.view);
  }

  /**
   * Have the engine write down the figures of today (the first row starts the series of a vault that has none).
   * True when it did; a refusal is said like any other write that failed.
   */
  async recordHistory(): Promise<boolean> {
    // `write` drops a request while another one is on its way: say so, the button would seem to do nothing
    if (this.saving) {
      this.say('error', 'write.busy');
      return false;
    }
    let done = false;
    await this.write([{ op: 'history_record' } as unknown as Op], {
      undoable: false,
      onAnswer: (result) => {
        done = result.results.every((r) => r.ok);
        if (done) this.say('ok', 'stats.history.recorded');
        return done;
      },
    });
    return done;
  }

  /** The state of the vault whose figures were last handed to the engine to write down (`keepHistory`). */
  private historyKeptRev: string | null = null;

  /**
   * Keep a history that exists going: have the engine write down the figures of today, once per state of the vault
   * (it writes a row only for an area whose figures changed, and at most one per day). Quiet: no toast, not a
   * write of the person, and a failure only means the line ends a day earlier. The number of rows written.
   */
  async keepHistory(): Promise<number> {
    const rev = this.snapshot?.rev ?? null;
    if (this.readOnly || this.phase !== 'ready' || rev === null || rev === this.historyKeptRev || !this.can('history')) return 0;
    this.historyKeptRev = rev;
    try {
      const result = await this.env.hub.ops({ client_op_id: this.opId(), ops: [{ op: 'history_record' } as unknown as Op] });
      const rows = (result.results[0] as { rows?: number } | undefined)?.rows;
      return typeof rows === 'number' ? rows : 0;
    } catch {
      return 0;
    }
  }

  /** The engine's estimate of some open tasks (the statistics ask it for the tasks the filter keeps). */
  estimateOf(ids: string[], signal: AbortSignal): Promise<Estimate> {
    return this.env.hub.estimate({ ids }, signal);
  }

  /** Run the test sheets of `id` and follow the run: a sheet takes minutes. The watcher brings the new block of the task. */
  async runSheets(id: string): Promise<void> {
    try {
      this.sheetRun = await this.env.hub.startSheetRun(id);
      while (this.sheetRun.state === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        this.sheetRun = await this.env.hub.sheetRun();
      }
      if (this.sheetRun.id === id) this.focused();
    } catch {
      this.say('error', 'abnahme.run_failed');
    }
  }

  /** Start the check over all vaults and follow it while it runs: a look each second. */
  async runCheckAll(): Promise<void> {
    try {
      this.checkAll = await this.env.hub.startCheckAll();
      while (this.checkAll.state === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        this.checkAll = await this.env.hub.checkAll();
      }
    } catch {
      this.say('error', 'vaults.check_failed');
    }
  }

  /** When the start at login was read last (`env.now()`); a window that gets the focus again soon after does not read it. */
  #autostartReadAt = Number.NEGATIVE_INFINITY;

  private async readAutostart(): Promise<void> {
    this.#autostartReadAt = this.env.now();
    try {
      this.autostart = await this.env.hub.autostart();
    } catch {
      this.autostart = null;
    }
  }

  /** The switch of the Options menu: says what came of it, and shows what the system says afterwards. */
  async toggleAutostart(): Promise<void> {
    if (this.autostart === null) return;
    const wanted = !this.autostart;
    try {
      const now = await this.env.hub.setAutostart(wanted);
      this.autostart = now;
      if (now === wanted) this.say('ok', wanted ? 'autostart.on' : 'autostart.off');
      else this.say('error', 'autostart.failed');
    } catch {
      this.say('error', 'autostart.failed');
    }
  }

  private async readKeepRunning(): Promise<void> {
    try {
      this.keepRunning = await this.env.hub.keepRunning();
    } catch {
      this.keepRunning = null;
    }
  }

  /** The switch "Keep running in the background" of the Options menu: says what came of it, shows what the settings say. */
  async toggleKeepRunning(): Promise<void> {
    if (this.keepRunning === null) return;
    const wanted = !this.keepRunning;
    try {
      const now = await this.env.hub.setKeepRunning(wanted);
      this.keepRunning = now;
      if (now === wanted) this.say('ok', wanted ? 'keep_running.on' : 'keep_running.off');
      else this.say('error', 'keep_running.failed');
    } catch {
      this.say('error', 'keep_running.failed');
    }
  }

  /** The one area the finished tasks open with, from a number of the statistics: taken once by the view. */
  finishedStartArea: string | undefined = undefined;
  takeFinishedStartArea(): string | undefined {
    const area = this.finishedStartArea;
    this.finishedStartArea = undefined;
    return area;
  }

  /** The open tasks `filter` keeps, found the way the list finds its filter. */
  tasksKeptBy(filter: Filter): TaskEntry[] {
    return applyFilter(this.tasks, this.matchFilter(filter), this.today, this.crossIndex, this.quickWinSet, this.projectOf);
  }

  /** A click on the legend of the statistics: the filter changes, the view stays. */
  narrowStats(filter: Filter): void {
    this.filter = filter;
  }

  /** What a number of the statistics counts, in the list: `filter` is the one that is on, narrowed by the click. */
  openStatsInList(filter: Filter): void {
    this.filter = filter;
    this.setView('list');
  }

  /** The tasks of one area in the list, without other filters (a click on a repo tile). */
  openAreaInList(area: string): void {
    this.filter = { ...freshFilter(), areas: [area] };
    this.setView('list');
  }

  /** The list of the parked tasks that wait for `key` (`null`: the ones parked without a reason), without other filters. */
  openParkedInList(key: string | null): void {
    this.filter = { ...freshFilter(), fields: { waits_for: [key ?? NO_VALUE] } };
    this.setView('list');
  }

  /** Take every chosen area, status and actor and the search words away. */
  resetFilter(): void {
    this.filter = freshFilter();
    // The text search belongs to the words that are gone.
    this.scheduleTextSearch('', 0);
  }

  /**
   * Show a task in the list with its detail: a filter that hides it is taken
   * away first, or the detail would stand without its row.
   */
  reveal(id: string): void {
    if (this.tasks.some((t) => t.id === id) && !this.shown.some((t) => t.id === id)) {
      this.resetFilter();
    }
    this.select(id);
    this.setView('list');
    // The list has no detail beside it: the task opens in the float over it, its row chosen behind it.
    this.peeking = true;
  }

  /** A task is looked at in a float over the view the person is in (the list, the overview, the plan). */
  peeking = $state(false);

  /**
   * The float of a task is open. It is modal: what is outside it cannot be reached, so the toast with its Undo is
   * drawn inside it while it is (TaskDialog), and at its usual place otherwise (App).
   */
  get taskFloatOpen(): boolean {
    return this.phase === 'ready' && this.peeking && this.selectedId !== null;
  }

  /**
   * The page is a window of one task (detached from the float of another window, route.ts): it shows that task's
   * detail alone, until a view is chosen.
   */
  solo = $state(false);
  /** A finished task that is looked at (read only: the engine reads open tasks only). */
  finishedPeek = $state<Finished['items'][number] | null>(null);
  /** The task the address named, waiting for the list to know it. */
  #route: string | null = null;

  /**
   * The page is a window of one task, or waits for the list to become one: the address is that window's (`#task=<id>`),
   * not the history's (history.ts).
   */
  get oneTask(): boolean {
    return this.solo || this.#route !== null;
  }

  /** The address named a task (`#task=<id>`): it is shown alone as soon as the list has it. */
  openRoute(id: string): void {
    this.#route = id;
    if (this.tasks.some((t) => t.id === id)) this.takeRoute();
  }

  /** The task the address named open in its view (`#view=list&open=<id>`, history.ts), waiting for the list. */
  #openRoute: string | null = null;

  /**
   * The address named a place (a reload, a copied address, a link opened in a new tab): the page opens on its view,
   * with its task open as soon as the list has it.
   */
  openPlace(view: View, open: string | null, filter?: string, kept: { plan?: string; sort?: string } = {}): void {
    this.view = view;
    // The filter the address names (a link, a new tab, a reload); an address without one keeps the remembered filter.
    if (filter !== undefined) this.filter = filterOfText(filter);
    // The plan and the order the address names, as for the filter; an order this page does not know is left out. The
    // order is read from the engine once the list is there (`start`).
    if (kept.plan !== undefined) this.planChoice = kept.plan;
    if (kept.sort !== undefined) {
      const word = parseSort(kept.sort);
      if (word !== 'default' || kept.sort === 'default') {
        this.sort = word;
        safe(() => this.env.prefs.setItem('tasks-desktop.sort', word));
      }
    }
    this.#openRoute = open;
    if (open !== null && this.tasks.some((t) => t.id === open)) this.takeRoute();
  }

  /** After a read of the list: the task the address named is shown, or told to be gone. */
  private takeRoute(): void {
    const open = this.#openRoute;
    if (open !== null) {
      this.#openRoute = null;
      if (this.tasks.some((t) => t.id === open)) this.select(open);
      else this.say('error', 'peek.missing', { id: open });
    }
    const id = this.#route;
    if (id === null) return;
    this.#route = null;
    if (!this.tasks.some((t) => t.id === id)) {
      this.say('error', 'peek.missing', { id });
      return;
    }
    this.peeking = false;
    this.select(id);
    this.solo = true;
  }

  /** Open the view in a new tab (a window of the same page), the way a link opens; a refused window is told. */
  openViewApart(view: View): void {
    if (!(this.env.openWindow?.(viewRoute(view)) ?? false)) this.say('error', 'peek.detach_failed');
  }

  /** A task can be detached into a window of its own (the page can open one). */
  get canDetach(): boolean {
    return this.env.openWindow !== undefined;
  }

  /** Open the task in a window of its own; the float here closes. A browser that refuses the window is told. */
  detach(id: string): void {
    const opened = this.env.openWindow?.(taskRoute(id)) ?? false;
    if (opened) this.closePeek();
    else this.say('error', 'peek.detach_failed');
  }

  /**
   * Open the task alone in a new tab, the way a link opens (a middle click or Ctrl+click on it, the context menu,
   * lib/taskApart.ts); this page stays as it is. A browser that refuses the window is told.
   */
  openTaskApart(id: string): void {
    if (!(this.env.openWindow?.(taskRoute(id)) ?? false)) this.say('error', 'peek.detach_failed');
  }

  /** Look at a task without leaving the view: it is selected (its detail is read) and the popup opens over the view. */
  peek(id: string): void {
    this.select(id);
    this.peeking = true;
  }

  closePeek(): void {
    this.peeking = false;
  }

  /** The choice of the tile Today (the period and the evaluations), kept in this browser. */
  setDailyPrefs(prefs: DailyPrefs): void {
    this.todayState.setDaily(prefs);
  }

  hideTile(tile: Tile): void {
    this.todayState.hide(tile);
  }

  /** The view a number shows its tasks in. */
  countView(key: CountKey): CountView {
    return this.todayState.countView(key);
  }

  /** Open the tasks behind a number, or close them when they are open. */
  toggleCount(key: CountKey): void {
    this.todayState.toggleCount(key);
  }

  closeCount(): void {
    this.todayState.closeCount();
  }

  setCountView(key: CountKey, view: CountView): void {
    this.todayState.setCountView(key, view);
  }

  /**
   * The key `v` on a number: a number that is closed opens in the view it has (the first press shows what the number
   * holds, it does not skip a view); one that is open goes on to its next view.
   */
  cycleCountView(key: CountKey): void {
    this.todayState.cycleCountView(key);
  }

  /** The tasks of a number in the list, with the status filter that fits (only "doing" and "blocked" have one). */
  openCountInList(key: CountKey): void {
    if (key !== 'doing' && key !== 'blocked') return;
    this.filter = { ...freshFilter(), statuses: [key] };
    this.setView('list');
  }

  /**
   * The tasks made in `days`, from the tile Today, in the list: the filter stays and keeps only the days the tasks were
   * made on (inside a span of the made date it already has), so the list shows the tasks the number counted.
   */
  listCreatedIn(days: { since: string; until: string }): void {
    const had = this.filter.dates.created;
    const from = had?.from && had.from > days.since ? had.from : days.since;
    const to = had?.to && had.to < days.until ? had.to : days.until;
    this.filter = { ...this.filter, dates: { ...this.filter.dates, created: { from, to } } };
    this.setView('list');
  }

  /** The tasks finished in `days`, from the tile Today, in the view Done: its period is these days, its area the filter's. */
  showFinishedIn(days: { since: string; until: string }): void {
    this.setFinishedPrefs({ ...this.finishedPrefs, preset: 'custom', from: days.since, to: days.until });
    this.finishedStartArea = this.finishedArea;
    this.setView('done');
  }

  /** Put the block `tile` before (or after) `target`; `visible` are the blocks on the page, for the number said aloud. */
  moveTile(tile: OrderedTile, target: OrderedTile, after: boolean, visible: readonly OrderedTile[]): void {
    this.todayState.move(tile, target, after, visible);
  }

  /** The blocks are not in the standard order (what "reset the order" would change). */
  get tileOrderChanged(): boolean {
    return this.todayState.orderChanged;
  }

  resetTileOrder(): void {
    this.todayState.resetOrder();
  }

  showTiles(): void {
    this.todayState.showAll();
  }

  setTheme(theme: Theme): void {
    this.prefs.setTheme(theme);
  }

  // ── start ─────────────────────────────────────────────────────────────

  /** Bring the page up. `code` is a pairing code taken from the address. */
  async start(code: string | null): Promise<void> {
    this.stream.resume();
    this.phase = 'starting';
    if (code) this.pendingCode = code;
    let stored = safe(() => this.env.session.getItem(TOKEN_KEY));
    // A tab without a session and without a code (opened from a link) takes the session of an open tab of the page.
    if (!stored && !code && this.env.askSession) {
      stored = await this.env.askSession((late) => this.takeLateSession(late));
      if (stored) {
        const taken = stored;
        safe(() => this.env.session.setItem(TOKEN_KEY, taken));
      }
    }
    // The session of the tab was handed to the client: when it is gone from it later, the hub refused it.
    let given = false;

    // The first picture comes from the cache, before the hub has answered
    // (and when it does not). Only a tab that was paired shows one. A cache
    // that does not answer in a moment is a miss.
    if (stored) {
      const cached = await within(this.env.cache.load(), 1500);
      if (cached && this.tasks.length === 0) {
        // The views are drawn from here on and ask the hub at once (the view the page was left on): they carry the
        // session of this tab. Without it their first question is refused and the page believes the session is lost.
        this.env.hub.setToken(stored);
        this.env.hub.onUnauthorized = () => this.lostSession();
        given = true;
        this.tasks = cached.tasks;
        this.cachedGroups = cached.areaGroups ?? [];
        this.cachedAt = cached.savedAt;
        this.phase = 'ready';
        // The list is of the vault the hub read when it was saved. A hub that reads another one now (chosen in another
        // tab, or its settings changed) would answer the views of this page for that vault beside a list of the old
        // one. The first picture does not wait for the hub (that is the use of the cache); the hub is asked at once
        // (no engine, a moment) and a list of another vault is taken away as soon as it says so.
        void this.dropCacheOfAnotherVault(cached);
      }
    }

    for (;;) {
      try {
        const hello = await this.env.hub.hello();
        this.#hubInstance = hello.instance;
        this.hubState = 'here';
        this.appVersion = hello.build ? `${hello.version} (${hello.build})` : hello.version;
        if (!hello.engine.ready) {
          this.problem = hello.engine.problem ?? 'unknown';
          // A tab that was paired keeps its session here too: the Info dialog and its report (the hub answers
          // them without an engine) are for exactly this page. A session that is gone is told by the first 401.
          if (stored && given && !this.env.hub.hasToken) stored = null;
          else if (stored && !this.env.hub.hasToken) {
            this.env.hub.setToken(stored);
            this.env.hub.onUnauthorized = () => this.lostSession();
            given = true;
          }
          // A page opened with a pairing code (the first double click) while the hub is not set up: the steps of the
          // first start are routes of the session, so the code is traded now, once, and not only when the engine is
          // ready. A code that is refused stays for the trade after the loop, which says what went wrong.
          if (this.env.mode !== 'web' && !this.env.hub.hasToken && this.pendingCode) {
            const code = this.pendingCode;
            try {
              const fresh = await this.env.hub.exchange(code);
              safe(() => this.env.session.setItem(TOKEN_KEY, fresh));
              this.env.hub.setToken(fresh);
              this.env.hub.onUnauthorized = () => this.lostSession();
              stored = fresh;
              given = true;
              if (this.pendingCode === code) this.pendingCode = null;
            } catch {
              // Left to the trade after the loop.
            }
          }
          this.phase = 'unavailable';
          // The steps of the first start the hub offers for what it misses (not in the web variant: no hub). Read again
          // when what is missing changed.
          if (this.env.mode !== 'web' && this.setupState.info?.problem !== this.problem) await this.setupState.load();
          await this.env.sleep(5000);
          if (this.stopped) return;
          continue;
        }
        // An engine that is not there says nothing about what it can do.
        this.capabilities = hello.engine.capabilities;
        // A board left open by an older engine would offer what it refuses.
        if (this.view === 'board' && !this.can('reorder')) this.view = 'today';
        if (this.view === 'done' && !this.can('finished')) this.view = 'today';
        if (this.view === 'views' && !this.can('views')) this.view = 'today';
        break;
      } catch {
        this.connection = 'offline';
        // A list from the cache stays on the screen: that is its use.
        if (this.tasks.length === 0) this.phase = 'offline';
        await this.env.sleep(3000);
        if (this.stopped) return;
      }
    }

    // A session the hub refused while this waited is not the one to go on with.
    if (stored && given && !this.env.hub.hasToken) stored = null;
    let token = stored;
    // The code of the address, or a newer one that was pasted while this waited for the hub or for the answer
    // to the one before. A code that works ends it; one that is refused makes room for the next.
    let offered = this.pendingCode;
    this.pendingCode = null;
    let refused = false;
    let limited = false;
    let tries = 0;
    while (offered) {
      try {
        const fresh = await this.env.hub.exchange(offered);
        safe(() => this.env.session.setItem(TOKEN_KEY, fresh));
        token = fresh;
        this.pendingCode = null;
        break;
      } catch (error) {
        // A code that is spent or too old: the session of this tab, if it has one, is still good. Only a
        // refusal of the hub (a 4xx) says "used up or too old"; a hub that did not answer says nothing of it, and
        // one that turned it away for too many attempts (a 429) did not look at it: it is tried again.
        limited = error instanceof ApiError && error.status === 429;
        refused = !limited && error instanceof ApiError && error.status >= 400 && error.status < 500;
        if (limited && tries < EXCHANGE_RETRIES) {
          tries += 1;
          await this.env.sleep(EXCHANGE_RETRY_MS);
          if (this.stopped) return;
          // A link pasted during the wait goes on in place of this one.
          if (!this.pendingCode) continue;
        }
      }
      offered = this.pendingCode;
      this.pendingCode = null;
      tries = 0;
    }
    // An open tab answered while this waited for the hub. A code that worked goes first.
    const late = this.lateSession;
    this.lateSession = null;
    if (!token && late) {
      safe(() => this.env.session.setItem(TOKEN_KEY, late));
      token = late;
    }
    // Said only when the code left the tab without a session.
    this.pairRefused = !token && refused;
    this.pairLimited = !token && limited;
    if (!token) {
      this.phase = 'needs_pairing';
      this.tasks = [];
      this.cachedAt = null;
      return;
    }
    this.env.hub.setToken(token);
    this.sessionHeld = true;
    this.env.hub.onUnauthorized = () => this.lostSession();

    await this.refresh();
    if (!this.env.hub.hasToken || this.stopped) return;
    void this.followStream();
  }

  /**
   * A pairing code that arrives after the page was loaded (a link pasted into the tab that is open: the
   * browser then changes only the fragment and does not reload). Without a session it is traded at once; a
   * page that is still starting picks it up when it gets there; a paired page keeps its session.
   */
  offerCode(code: string): void {
    if (this.sessionHeld) {
      // The page may not know yet that its hub was replaced (the link was pasted before the next look at the hub):
      // kept for the moment it finds out, as long as a pairing code lives.
      this.#lateCode = { code, at: this.env.now() };
      return;
    }
    // A page that outlived its hub pairs with the new one where it stands: a start anew would throw away what is typed.
    if (this.hubState === 'replaced') {
      void this.pairAgain({ code });
      return;
    }
    this.pendingCode = code;
    if (this.phase === 'needs_pairing') void this.start(code);
  }

  /**
   * An open tab answered after the wait. A tab that offers to pair takes the session now; one still on its way there
   * (waiting for the hub) takes it when it gets there, since the question is not asked again. A tab that has paired
   * since keeps its own.
   */
  private takeLateSession(token: string): void {
    if (this.stopped || this.sessionHeld) return;
    if (this.phase !== 'needs_pairing') {
      this.lateSession = token;
      return;
    }
    safe(() => this.env.session.setItem(TOKEN_KEY, token));
    void this.start(null);
  }

  stop(): void {
    this.stream.stop();
    this.checkState.invalidate();
    this.matrixState.invalidate();
    this.graphState.invalidate();
    this.stream.cut();
  }

  /** The session of this tab was confirmed (a token held for the cached list only is not that). */
  private sessionHeld = false;

  /**
   * Where the hub of this page is. `gone`: it does not answer (a hub in the background ends itself ten minutes after
   * its last page, and a tab the browser put to sleep is no page). `replaced`: a hub answers, but not the one the page
   * was paired with; its session ended with the old hub. In both the page keeps what it shows and what was typed into
   * it, and says how to go on (App.svelte); nothing is written until a hub takes it again.
   */
  hubState = $state<HubState>('here');
  /** The instance of the hub the page was started with (`hello`); null before the first answer and in the web variant. */
  #hubInstance: string | null = null;
  #watchingHub = false;
  #judgingLoss = false;

  /** The instance of the hub that answers now, or null when none does. `hello` needs no session. */
  private async hubNow(): Promise<string | null> {
    try {
      return (await this.env.hub.hello()).instance;
    } catch {
      return null;
    }
  }

  /**
   * A request or the stream failed without an answer: ask the hub who it is until one answers. The same hub: the page
   * reads again and its stream connects at once. Another one: `newHub`. One watcher at a time; none in the web variant
   * (no hub) or before the page knew its hub.
   */
  private async watchHub(): Promise<void> {
    if (this.#watchingHub || this.stopped || this.env.mode === 'web' || this.#hubInstance === null) return;
    if (this.hubState === 'replaced') return;
    this.#watchingHub = true;
    let wait = HUB_PROBE_MS;
    try {
      for (;;) {
        // A hidden tab asks nothing: its focus (`focused`) wakes the watcher again.
        if (this.env.visible && !this.env.visible()) {
          await this.watchSleep(HUB_PROBE_MAX_MS);
          if (this.stopped) return;
          continue;
        }
        const instance = await this.hubNow();
        // (Read anew: another answer may have found a new hub while this one was awaited.)
        if (this.stopped || (this.hubState as HubState) === 'replaced') return;
        if (instance === null) {
          this.hubState = 'gone';
          await this.watchSleep(wait);
          wait = Math.min(wait * 2, HUB_PROBE_MAX_MS);
          if (this.stopped) return;
          continue;
        }
        if (instance !== this.#hubInstance) {
          this.newHub();
          return;
        }
        const was = this.hubState;
        this.hubState = 'here';
        if (was === 'gone') {
          // Not at the end of the stream's backoff (up to half a minute): now.
          this.#wakeStream?.();
          void this.refresh();
        }
        return;
      }
    } finally {
      this.#watchingHub = false;
    }
  }

  /** Ends the wait of `watchHub` before its next question (`focused`). */
  #wakeWatch: (() => void) | null = null;

  /** The wait of `watchHub` between two questions, ended early by the focus of the window. */
  private watchSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        if (this.#wakeWatch === wake) this.#wakeWatch = null;
        resolve();
      };
      this.#wakeWatch = wake;
      void this.env.sleep(ms).then(wake);
    });
  }

  /**
   * Before the stream tries again: is the hub still the one of this page? A new one would refuse the stream (401), and
   * that refusal would empty the page (`dropSession`); asked first, the page keeps what it shows.
   */
  private async beforeStreamRetry(): Promise<void> {
    if (this.stopped || this.env.mode === 'web' || this.#hubInstance === null || this.hubState === 'replaced') return;
    const instance = await this.hubNow();
    if (this.stopped) return;
    if (instance === null) void this.watchHub();
    else if (instance !== this.#hubInstance) this.newHub();
    else if (this.hubState === 'gone') this.hubState = 'here';
  }

  /**
   * Another hub answers than the one the page was paired with (the old one ended, a new one was started). The session
   * is gone with the old hub, so nothing more is asked with it; the list, the open task and what was typed stay on the
   * page until the new hub takes it (`pairAgain`).
   */
  private newHub(): void {
    if (this.hubState === 'replaced') return;
    this.hubState = 'replaced';
    this.#sessionGen += 1;
    this.sessionHeld = false;
    this.pairRefused = false;
    this.pairLimited = false;
    safe(() => this.env.session.removeItem(TOKEN_KEY));
    this.env.hub.setToken(null);
    this.stream.cut();
    this.connection = 'offline';
    // A link that was pasted a moment before the page knew: used now.
    const late = this.#lateCode;
    this.#lateCode = null;
    if (late !== null && this.env.now() - late.at <= LATE_CODE_MS) void this.pairAgain({ code: late.code });
    // The window has the focus already: no focus event comes to ask the other tabs for a session of the new hub.
    else if (this.env.hasFocus?.()) void this.askForNewSession();
  }
  /** A pairing code offered while the page still believed in its old hub, and when. */
  #lateCode: { code: string; at: number } | null = null;
  /** Counts the sessions of the page: a judgement of a lost session that was asked for an earlier one is dropped. */
  #sessionGen = 0;

  /**
   * The page takes the new hub: with a pairing code (a link pasted into this tab) or with the session of the tab the
   * new start opened. Nothing of the page is thrown away; the list is read again and the stream follows. A code or a
   * session the hub refuses leaves the page as it was, and says so.
   */
  private async pairAgain(by: { code: string } | { token: string }): Promise<void> {
    if (this.hubState !== 'replaced' || this.#pairingAgain) return;
    this.#pairingAgain = true;
    try {
      let hello: Awaited<ReturnType<typeof this.env.hub.hello>>;
      try {
        hello = await this.env.hub.hello();
      } catch {
        return;
      }
      const token = 'code' in by ? await this.env.hub.exchange(by.code) : by.token;
      // A session handed over by another tab is tried before the page believes in it: one the hub refuses must not
      // become the page's own (its refusal would empty the page). A refusal here throws, and the page stays as it was.
      this.env.hub.onUnauthorized = () => undefined;
      this.env.hub.setToken(token);
      try {
        if (!('code' in by)) await this.env.hub.snapshot(null);
      } catch (error) {
        this.env.hub.setToken(null);
        throw error;
      }
      safe(() => this.env.session.setItem(TOKEN_KEY, token));
      this.env.hub.onUnauthorized = () => this.lostSession();
      this.#hubInstance = hello.instance;
      this.#sessionGen += 1;
      this.sessionHeld = true;
      this.hubState = 'here';
      // The new hub is often a new build: what it can do and what it is called are its own.
      this.appVersion = hello.build ? `${hello.version} (${hello.build})` : hello.version;
      if (!hello.engine.ready) {
        // Its engine is not up: the start of the page knows how to wait for it.
        void this.start(null);
        return;
      }
      this.capabilities = hello.engine.capabilities;
      await this.refresh();
      if (!this.env.hub.hasToken || this.stopped) return;
      void this.followStream();
    } catch {
      this.say('error', 'hub.replaced.refused');
    } finally {
      this.#pairingAgain = false;
    }
  }
  #pairingAgain = false;

  /**
   * The tab got the focus while it waits for a new hub (or found it while it had the focus): an open tab of the page
   * may hold a session of it by now. A late answer is listened for by one question at a time: the listener of a
   * question stays until an answer comes, so each focus would leave one more.
   */
  private async askForNewSession(): Promise<void> {
    if (this.hubState !== 'replaced' || !this.env.askSession) return;
    let token: string | null;
    if (this.#lateListening) {
      token = await this.env.askSession();
    } else {
      this.#lateListening = true;
      try {
        token = await this.env.askSession((late) => {
          this.#lateListening = false;
          void this.pairAgain({ token: late });
        });
      } catch {
        // The question could not be asked: it listens for nothing, and the next focus asks with a listener again.
        this.#lateListening = false;
        return;
      }
      // Answered in time: the question listens no more.
      if (token) this.#lateListening = false;
    }
    if (token) await this.pairAgain({ token });
  }
  #lateListening = false;

  /**
   * The hub refused the session (a 401). When another hub answers than the one of this page, that is `newHub` and the
   * page stays as it is; any other refusal (the session was ended, the hub forgot it) empties the page as before.
   * The hub is asked only while the stream is down: a live stream is of the page's own hub.
   */
  private lostSession(): void {
    if (this.hubState === 'replaced') return;
    const ask = !this.stopped && this.#hubInstance !== null && this.env.mode !== 'web' && !this.stream.open && this.sessionHeld;
    if (!ask) {
      this.dropSession();
      return;
    }
    if (this.#judgingLoss) return;
    this.#judgingLoss = true;
    const asked = this.#sessionGen;
    void this.hubNow().then((instance) => {
      this.#judgingLoss = false;
      // Judged for the session that was refused: the page found a new hub meanwhile, or paired again since.
      if (this.#sessionGen !== asked || (this.hubState as HubState) === 'replaced') return;
      if (!this.stopped && instance !== null && instance !== this.#hubInstance) this.newHub();
      else this.dropSession();
    });
  }

  private dropSession(): void {
    this.sessionHeld = false;
    // The loss is not about a code that was refused at the start.
    this.pairRefused = false;
    this.pairLimited = false;
    // What was asked of the hub is not valid without the session: the dialogs and the graph close, the job is forgotten.
    this.closeGraph();
    this.closeMatrix();
    this.closeChecks();
    this.checkState.forget();
    this.attached = null;
    // The views and groupings were read with the session: they are read again once the tab is paired again.
    this.viewsState.forget();
    this.#viewsRev = undefined;
    safe(() => this.env.session.removeItem(TOKEN_KEY));
    this.env.hub.setToken(null);
    this.stream.cut();
    this.phase = 'needs_pairing';
    this.connection = 'offline';
    this.tasks = [];
    this.snapshot = null;
    this.#order = null;
    this.next = null;
    this.nextFor = null;
    this.waits = null;
    this.waitsFor = null;
    this.hubAreas = [];
    this.links = null;
    this.detail = { state: 'none' };
    this.cachedAt = null;
    this.etag = null;
  }

  // ── reading ───────────────────────────────────────────────────────────

  /**
   * Read the list again. One at a time: a change that arrives while a read
   * is running makes exactly one more read after it. A caller that arrives
   * then waits for that read too, so what it awaits is a list that is
   * current (a write has just made a task that the read under way may not
   * have seen).
   */
  refresh(): Promise<void> {
    if (this.loop) {
      this.dirty = true;
      return this.loop;
    }
    this.loop = (async () => {
      try {
        do {
          this.dirty = false;
          await this.readOnce();
        } while (this.dirty && !this.stopped);
      } finally {
        this.loop = null;
      }
    })();
    return this.loop;
  }

  private async readOnce(): Promise<void> {
    const hub = this.env.hub;
    const seq = ++this.#reads;
    try {
      // The vault the hub reads tells whether the remembered filter is of it: asked beside the list (it needs no
      // engine) and awaited before the list is put on the page, so that the filter of another vault is never drawn
      // on the tasks of this one.
      const named = this.#hubVault === undefined ? this.loadVaults() : null;
      // A conditional request only when the whole document is held: the
      // cache holds a part of it, and a "not modified" must not leave that
      // part standing in for the list.
      const result = await hub.snapshot(this.snapshot ? this.etag : null);
      if (named) await within(named, 1500);
      if (result.kind === 'fresh') {
        // What the agents did since the list before (only against a whole list the page held, not the first one).
        const before = this.snapshot ? this.tasks : null;
        this.snapshot = result.doc;
        this.tasks = result.doc.tasks;
        if (before && this.aiFeatures) this.sayAgentNews(agentNews(before, result.doc.tasks));
        this.etag = result.etag;
        if (this.sort !== 'default') void this.readOrder();
        this.checkState.listChanged();
      }
      this.cachedAt = null;
      this.phase = 'ready';
      if (this.connection === 'offline') this.connection = 'reconnecting';
      this.keepSelection();
      this.takeRoute();
      if (this.#arriving && seq > this.#arriving.before) {
        const have = new Set(this.tasks.map((t) => t.id));
        this.#arriving.late += 1;
        if ([...this.#arriving.ids].every((id) => have.has(id)) || this.#arriving.late >= LATE_READS) this.#arriving = null;
      }
      // The same: a write under way has not said where its tasks went, so a mark is not judged by a list read meanwhile.
      if (!this.saving) this.marks = pruneMarks(this.marks, this.tasks, this.#arriving?.ids);
      // What is needed beside the list is read after it is shown: each of
      // these is one more Neovim process of the hub.
      void this.readBeside();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      if (error instanceof ApiError && error.code === 'engine_unavailable') {
        this.phase = 'unavailable';
        return;
      }
      if (this.tasks.length === 0) this.phase = 'offline';
      this.connection = 'offline';
      void this.watchHub();
    }
  }

  /** The classes of the areas, the cache, and the next task. */
  private async readBeside(): Promise<void> {
    void this.loadEngineLists();
    void this.loadEnums();
    const doc = this.snapshot;
    if (!doc) return;
    // The vaults first: the answer does not depend on the classes, and a failure of those must not skip it.
    await this.loadVaults();
    try {
      // The classes come from `areas.json`, read when the hub started: they
      // are read once, and again when an area appears that was not there, or when the
      // hub says it read them again (the web variant does, when the file in the folder changed).
      const known = new Set(this.hubAreas.map((a) => a.name));
      const moved = this.classesMoved;
      if (this.hubAreas.length === 0 || moved || doc.tasks.some((t) => !known.has(t.area))) {
        if (moved) {
          // A read under way was asked before the classes changed: this asks again instead of joining it.
          this.classesMoved = false;
          this.areasRead = null;
        }
        const reading: Promise<HubAreas> = (this.areasRead ??= this.env.hub.areas().finally(() => {
          if (this.areasRead === reading) this.areasRead = null;
        }));
        this.areasNewest = reading;
        let read: HubAreas;
        try {
          read = await reading;
        } catch (error) {
          // The classes changed and the new ones could not be read: the old ones no longer stand, nothing is released
          // until they are read (an empty list is read again with the next list).
          // What is kept in the browser rests on the old classes too: it goes, and a list is kept again once they are read.
          if (moved && this.areasNewest === reading) {
            this.hubAreas = [];
            void this.env.cache.clear();
          }
          throw error;
        }
        // Only the newest question sets the classes: an older one that is answered late carries the classes of before.
        if (this.areasNewest === reading) this.hubAreas = read.areas;
      }
      const list = cacheableList(doc, this.etag, this.hubAreas, this.env.now());
      // The list is kept with the vault the hub reads, so that a start can tell a list of another vault.
      if (list) void this.env.cache.save({ ...list, hubVault: this.vaultList?.active ?? null });
      else void this.env.cache.clear();
    } catch {
      // No classes, no cache: nothing is written.
    }
    void this.loadLinks();
    // The views are files of their own: read at the start, after a write of one, when the tab is entered and, while it is
    // shown, when they changed (the snapshot's `views_rev`, from outside say). A change of a task does not change a view:
    // reading them after every write elsewhere would be one more engine call in front of the next write.
    if (this.#viewsRev === undefined || (this.view === 'views' && this.viewsBehind(doc))) void this.readViews();
    // Not on the board: its bar needs the fields only for the form of a new view, asked when the board is opened (a
    // question after every write there would stand in front of the next one).
    if (this.view === 'views') void this.viewsState.loadGroupings();
    if (this.view === 'today') await Promise.all([this.loadNext(), this.loadWaits()]);
  }

  /** The rev the links are being asked for. */
  private linksAsked: string | null = null;

  /** The links between areas, once per state of the vault. An engine without them leaves the page to read them from the list. */
  private async loadLinks(): Promise<void> {
    const rev = this.snapshot?.rev;
    if (!this.can('links') || this.capabilities === null || rev === undefined || this.links?.rev === rev) return;
    // One question per state: a read that arrives while the answer is on its way does not ask again.
    if (this.linksAsked === rev) return;
    this.linksAsked = rev;
    try {
      const doc = await this.env.hub.links();
      // An answer for a state that has gone by meanwhile is not kept; the next read asks again.
      if (this.snapshot?.rev === doc.rev) {
        this.links = doc;
        this.linksFailed = false;
      }
    } catch {
      // The links read from the list stand in, and no older state of the engine's answer is shown.
      this.links = null;
      this.linksFailed = true;
    } finally {
      if (this.linksAsked === rev) this.linksAsked = null;
    }
  }

  /** The areas a task touches when that is more than its own (from the links), else none. */
  crossAreas(id: string): string[] {
    const touched = this.crossIndex.get(id);
    return touched && touched.size >= 2 ? [...touched].sort() : [];
  }

  /** Read the list of vaults; a hub without one (404) simply has no menu entries. */
  /** Take the cached list away when the hub names another vault than the one it was saved of. */
  private async dropCacheOfAnotherVault(cached: CachedList): Promise<void> {
    let now: { name: string | null };
    try {
      now = await this.hubVaultName();
    } catch {
      return; // A hub that does not answer says nothing against the list.
    }
    if (cached.hubVault === undefined || now.name === cached.hubVault) return;
    void this.env.cache.clear();
    // Only while the cached list is what is shown: a list the hub sent meanwhile stays.
    if (this.cachedAt !== cached.savedAt) return;
    this.tasks = [];
    this.cachedAt = null;
    this.select(null);
    this.marks = [];
    this.phase = 'starting';
  }

  /** The name of the vault the hub reads now (`null`: a hub with one vault and no list); fails when the hub does not answer. */
  private async hubVaultName(): Promise<{ name: string | null }> {
    try {
      return { name: (await this.env.hub.vaults()).active };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { name: null };
      throw error;
    }
  }

  async loadVaults(): Promise<void> {
    const read = await this.vaultsState.read();
    // A hub with one vault and no list names none: the remembered filter stays as it is.
    if (read === 'none') this.#hubVault = null;
    if (read !== 'ok' || this.vaultList === null) return;
    // A filter made in another vault (chosen in another tab, or in the settings of the hub) is not taken over: its
    // areas, tags and plans are not those of this one. A filter that does not say its vault is now of this one.
    const active = this.vaultList.active;
    this.#hubVault = active;
    if (this.#filterVault !== undefined && this.#filterVault !== active) this.forgetFilterOfAnotherVault(active);
    else if (this.#filterVault === undefined) this.filter = { ...this.#filter };
  }

  /**
   * The filter in memory was made in another vault: it goes. What is saved is left alone: it may be the one that
   * another tab made for that vault a moment ago, and this page has nothing better to put there.
   */
  private forgetFilterOfAnotherVault(active: string): void {
    this.#filter = freshFilter();
    this.#filterVault = active;
    // The text search belongs to the words that are gone.
    this.scheduleTextSearch('', 0);
  }

  /** Whether the Info dialog can be opened: a running page, or one whose engine is not there (needs a session). */
  get canAbout(): boolean {
    return this.aboutState.available;
  }

  /** Open the Info dialog (APP-09); `focus` says what the person came for, so that the keyboard lands there. */
  openAbout(focus: 'info' | 'report' = 'info'): void {
    this.aboutState.open(focus);
  }

  closeAbout(): void {
    this.aboutState.close();
  }

  openVaults(): void {
    this.vaultsState.open();
  }

  /** Another folder can be chosen instead of the vaults of a hub (`Env.chooseFolder`, the web variant). */
  get canChooseFolder(): boolean {
    return this.env.chooseFolder !== undefined;
  }

  /** Leave this folder for the way in, where another one is chosen. */
  chooseFolder(): void {
    this.env.chooseFolder?.();
  }

  /** The vaults of the web variant (`Env.folderVaults`), or `null` where there are none or before they were read. */
  folderVaultList = $state.raw<FolderVault[] | null>(null);
  /** A switch to another folder is under way: the page is about to load again. */
  folderSwitching = $state(false);

  /** Read the folders used before. A list that cannot be read shows none: switching is a convenience. */
  async loadFolderVaults(): Promise<void> {
    if (!this.env.folderVaults) return;
    try {
      this.folderVaultList = await this.env.folderVaults.list();
    } catch {
      this.folderVaultList = null;
    }
  }

  /**
   * Read another folder of the web variant. Called from the click: the browser may have to be asked for the folder,
   * which it allows only inside one. Refused while a change is written (leaving the page would cut it off).
   */
  async selectFolderVault(id: string): Promise<void> {
    const vaults = this.env.folderVaults;
    if (!vaults || this.folderSwitching) return;
    if (this.folderVaultList?.find((v) => v.id === id)?.active) return;
    if (this.refusedWhileSaving()) return;
    this.folderSwitching = true;
    let result: Awaited<ReturnType<typeof vaults.select>>;
    try {
      result = await vaults.select(id);
    } catch {
      result = 'denied';
    }
    if (result === 'switched') return;
    this.folderSwitching = false;
    if (result === 'denied') this.say('error', 'web.vault.denied');
    if (result === 'gone') this.say('error', 'web.vault.gone');
    if (result === 'busy') this.say('error', 'write.busy');
    await this.loadFolderVaults();
  }

  closeVaults(): void {
    this.vaultsState.close();
  }

  /** Read another vault. What the page holds of the old one (the list, the cache) goes; the page loads again. */
  async selectVault(name: string): Promise<void> {
    if (this.vaultList?.active === name) return;
    const done = await this.vaultsState.select(name, async () => {
      // The list that is cached belongs to the vault that was left.
      await this.env.cache.clear();
      // The areas, tags and plans of a filter are those of the vault that was left; the empty one is the new vault's.
      this.#hubVault = name;
      this.filter = freshFilter();
    });
    if (done) (this.env.reload ?? (() => undefined))();
  }

  addVault(name: string, path: string): Promise<boolean> {
    return this.vaultsState.add(name, path);
  }

  removeVault(name: string): Promise<void> {
    return this.vaultsState.remove(name);
  }

  createVault(name: string, path: string, area: string): Promise<boolean> {
    return this.vaultsState.create(name, path, area);
  }

  revealVault(): Promise<void> {
    return this.vaultsState.reveal();
  }

  /** The folder chosen in the dialog of the system (shown by the hub), or `null`. */
  pickVaultFolder(): Promise<string | null> {
    return this.vaultsState.pick();
  }

  private nextFor: string | null = null;
  /** The digest of the list the parked tasks were counted for. */
  private waitsFor: string | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchAbort: AbortController | null = null;
  private detailAbort: AbortController | null = null;
  /** The read of the detail under way: the task, and whether it was asked for again meanwhile. */
  private detailRead: { id: string; again: boolean } | null = null;
  private areasRead: Promise<HubAreas> | null = null;
  /** The last question for the areas that was asked: its answer is the one that counts. */
  private areasNewest: Promise<HubAreas> | null = null;
  /** The hub said it read the data classes again: the next read beside the list asks for the areas anew. */
  private classesMoved = false;

  /** The next task, read when the list it belongs to is not the one held. */
  /**
   * What the parked tasks wait for (`waits`, capability `waits`), read when the list it belongs to is not the one held.
   * An engine without it has none, and the overview shows no block of them.
   */
  async loadWaits(): Promise<void> {
    if (!this.can('waits')) return;
    const key = this.snapshot?.digest ?? null;
    if (this.waits !== null && key !== null && this.waitsFor === key) return;
    try {
      this.waits = await this.env.hub.waits();
      this.waitsFor = key;
    } catch {
      // The old one stays.
    }
  }

  /** The parked tasks of the list that wait for `key`: what Bring all back would set to open. */
  parkedFor(key: string): TaskEntry[] {
    return this.tasks.filter((t) => t.status === 'parked' && t.waits_for === key);
  }

  /**
   * Bring back every parked task that waits for `key`: the engine has no operation of its own for it, so it is one
   * `set` with `status: open` per task, each on the version shown (the engine drops the reason with the status). The
   * toast says how many went through and takes them back together.
   */
  async releaseWaits(key: string): Promise<void> {
    const ops = this.parkedFor(key).map((t) => ({
      op: 'set' as const,
      id: t.id,
      patch: { status: 'open' },
      ...(t.etag ? { if_match: t.etag } : {}),
    }));
    if (ops.length === 0) {
      this.say('ok', 'bulk.nothing');
      return;
    }
    await this.write(ops, { onAnswer: this.batchAnswer(ops) });
  }

  async loadNext(): Promise<void> {
    const key = this.snapshot?.digest ?? null;
    if (this.next !== null && key !== null && this.nextFor === key) return;
    try {
      this.next = await this.env.hub.next();
      this.nextFor = key;
    } catch {
      // The old one stays.
    }
  }

  setView(view: View): void {
    // The board writes with `reorder`: an engine without it does not get one.
    if (view === 'board' && !this.can('reorder')) return;
    // The views are the vault's: an engine that keeps none has no tab of them.
    if (view === 'views' && !this.can('views')) return;
    // A window of one task (or of one card of the statistics) becomes a page of views when one is chosen.
    this.solo = false;
    this.statsCard = null;
    // the way back from the history belongs to the visit it was opened for: leaving the statistics another way ends it
    if (view !== 'stats') this.historyFrom = null;
    this.view = view;
    if (view === 'inbox') this.ensureInboxSelection(true);
    // The board is the built-in view of the tab: its bar makes views, which need the fields of the engine.
    if (view === 'board' && this.phase === 'ready' && this.can('views')) void this.viewsState.loadGroupings();
    if (view === 'views' && this.phase === 'ready') {
      void this.viewsState.loadGroupings();
      // What changed while the tab was not shown is read now (once per state of the vault).
      if (this.viewsBehind()) void this.readViews();
    }
    safe(() => this.env.prefs.setItem('tasks-desktop.view', view));
    if (view === 'today' && this.phase === 'ready') {
      void this.loadNext();
      void this.loadWaits();
    }
  }

  /** The selection stays on the task id; a task that is gone clears it. */
  private keepSelection(): void {
    if (this.selectedId === null) return;
    const task = this.tasks.find((t) => t.id === this.selectedId);
    if (!task) {
      this.selectedId = null;
      this.detail = { state: 'none' };
      // Its float closes with it: the next task chosen with j and k is not opened in one by surprise.
      this.peeking = false;
      // A window of one task whose task is gone (finished there, moved away) shows its view again, for good.
      this.solo = false;
      return;
    }
    // The file changed under the open detail: read it again.
    if (this.detail.state === 'ok' && this.detail.doc.task.etag !== task.etag) {
      void this.loadDetail(task.id);
    }
  }

  // ── the text of the tasks ─────────────────────────────────────────────

  /** The words of the filter changed: the list filters at once, the text is searched a moment later. */
  setQuery(text: string): void {
    this.filter = { ...this.filter, query: text };
    this.scheduleTextSearch(text, 0);
  }

  private scheduleTextSearch(text: string, attempt: number): void {
    clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    const query = text.trim();
    // Two letters are not a search of the text (the title and id filter is).
    if (query.length < 2 || this.phase !== 'ready') {
      this.textSearch = null;
      return;
    }
    const wait = attempt === 0 ? 250 : 1500;
    this.searchTimer = setTimeout(() => void this.runTextSearch(query, attempt), wait);
  }

  private async runTextSearch(query: string, attempt: number): Promise<void> {
    const abort = new AbortController();
    this.searchAbort = abort;
    try {
      const result = await this.env.hub.search(query, abort.signal);
      if (abort.signal.aborted || this.filter.query.trim() !== query) return;
      this.textSearch = { query, result };
      // The hub reads the texts a moment after it starts: ask again.
      if (result.status === 'building' && attempt < 8) this.scheduleTextSearch(query, attempt + 1);
    } catch {
      if (!abort.signal.aborted && this.filter.query.trim() === query) this.textSearch = null;
    }
  }

  // ── selection and detail ──────────────────────────────────────────────

  select(id: string | null): void {
    this.selectedId = id;
    if (id === null) {
      // A window of one task that lets go of its task is a page of views again: the next task chosen there opens in a
      // float over its view, not alone in place of it.
      this.solo = false;
      this.detailAbort?.abort();
      this.detailRead = null;
      this.detail = { state: 'none' };
      return;
    }
    void this.loadDetail(id);
  }

  moveSelection(delta: number): void {
    const id = moveSelection(this.listed, this.selectedId, delta);
    if (id !== null && id !== this.selectedId) this.select(id);
  }

  /** The tasks the inbox view shows: those that lack a priority, an effort or a written actor. */
  get inbox(): TaskEntry[] {
    return inboxOf(this.shown);
  }

  moveSelectionInbox(delta: number): void {
    const id = moveSelection(this.inbox, this.selectedId, delta);
    if (id !== null && id !== this.selectedId) this.select(id);
  }

  /**
   * A key of the inbox: write the field it names on the selected task. Nothing is sent while another write is under
   * way, or for a key that names nothing. When the task is sorted by it and leaves the inbox, the selection stays
   * at the same place, on the task that took its row.
   */
  async triage(key: string, shift: boolean): Promise<void> {
    const choice = triageKey(key, shift);
    const id = this.selectedId;
    if (!choice || id === null || this.phase !== 'ready') return;
    if (this.refusedWhileSaving()) return;
    const before = this.inbox;
    const at = before.findIndex((t) => t.id === id);
    if (at === -1) return;
    await this.setField(id, choice.field, choice.value);
    const after = this.inbox;
    // Only when the person is still on that task: a click or a j made during the write is theirs.
    if (this.selectedId === id && !after.some((t) => t.id === id)) {
      this.select(after[Math.min(at, after.length - 1)]?.id ?? null);
    }
  }

  /**
   * Put the selection on a row of the inbox when it is on a task that left it (sorted elsewhere, in Neovim), and, when
   * the view is entered (`entering`), also when it is on none. A selection of none that the person made (Escape) is
   * left alone by a later change of the rows. Not while a write is under way: `triage` knows where the selection goes.
   */
  ensureInboxSelection(entering = false): void {
    if (this.saving) return;
    const rows = this.inbox;
    if (rows.length === 0) return;
    const gone = this.selectedId !== null && !rows.some((t) => t.id === this.selectedId);
    if (gone || (entering && this.selectedId === null)) this.select(rows[0]?.id ?? null);
  }

  private async loadDetail(id: string): Promise<void> {
    // Keep what is shown while the same task is read again.
    if (!(this.detail.state === 'ok' && this.detail.id === id)) {
      this.detail = { state: 'loading', id };
    }
    // The same task is being read (a write and its event each ask again): its request is not dropped. Its answer is
    // read once more only when it is older than the list read meanwhile (another etag). A dropped request costs its
    // connection, and a write asked for the detail twice (CI: ERR_NO_BUFFER_SPACE on the Windows runner).
    const reading = this.detailRead;
    if (reading?.id === id) {
      reading.again = true;
      return;
    }
    // Each task is a Neovim process of the hub. A task that was passed on the
    // way (j j j j) is not read: its request is dropped, and so is its read.
    this.detailAbort?.abort();
    const abort = new AbortController();
    this.detailAbort = abort;
    const read = { id, again: false };
    this.detailRead = read;
    let extra = false;
    try {
      do {
        read.again = false;
        try {
          const doc = await this.env.hub.task(id, abort.signal);
          if (this.selectedId === id) this.detail = { state: 'ok', id, doc };
          const listed = this.tasks.find((t) => t.id === id)?.etag;
          if (read.again && listed === doc.task.etag) read.again = false;
          // The list changed while the first read was on its way (nobody asks again for a detail that is still
          // loading): one read more, not a loop (the list may also be the older of the two).
          else if (!read.again && !extra && listed !== undefined && listed !== doc.task.etag) {
            read.again = true;
            extra = true;
          }
        } catch {
          if (!abort.signal.aborted && this.selectedId === id) {
            this.detail = { state: 'failed', id };
          }
        }
      } while (read.again && !abort.signal.aborted && this.selectedId === id);
    } finally {
      if (this.detailRead === read) this.detailRead = null;
      if (this.detailAbort === abort) this.detailAbort = null;
    }
  }

  // ── events ────────────────────────────────────────────────────────────

  /** Ask for a scan: the window got the focus back. */
  async focused(): Promise<void> {
    // A page that stood open over midnight: a reminder may be due since.
    this.today = localToday();
    // A window the hub refused a stream (too many windows) tries again now, not at the end of its backoff: the window
    // that was closed to make room is often what gave this one the focus.
    if (this.streamsFull) this.#wakeStream?.();
    // A page that lost its hub asks at once, not at the end of its wait.
    this.#wakeWatch?.();
    // A page that outlived its hub: the tab the new start opened may hand over its session now.
    if (this.hubState === 'replaced') void this.askForNewSession();
    // Not before the hub has confirmed the session: a page on the cached list holds the token already.
    if (this.phase !== 'ready' || !this.sessionHeld) return;
    // hub-desktop can switch the start at login too (the tile, in another window): the Options menu shows what is true now.
    // At most every AUTOSTART_EVERY_MS: each read runs the login entries of the machine through the hub.
    if (this.autostart !== null && this.env.now() - this.#autostartReadAt >= AUTOSTART_EVERY_MS) {
      void this.readAutostart();
    }
    // The settings file may have been edited by hand meanwhile.
    if (this.keepRunning !== null) void this.readKeepRunning();
    // ai-desktop may have been installed or started meanwhile: one file read in the hub, no request to another app.
    if (this.env.mode !== 'web') void this.readAiDesktop();
    try {
      await this.env.hub.rescan();
    } catch {
      // A hub that is gone shows itself through the stream.
    }
    await this.refresh();
  }

  /**
   * The hub refused this window a live connection because the session holds as many as it allows (`429`, its
   * `too_many_streams`: four per session). The windows a task was detached into share the session of the tab, so the
   * fifth window of a tab lands here. It is told in the bar; the window is read again when it gets the focus, and the
   * stream is tried again (backing off up to half a minute, at once when the window gets the focus) until another window
   * lets go of one.
   */
  streamsFull = $state(false);
  /** Ends the wait of the stream before its next try (`focused`). */
  #wakeStream: (() => void) | null = null;

  /** The wait of the stream between two tries: the backoff, or less when the window is woken. */
  private streamSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        if (this.#wakeStream === wake) this.#wakeStream = null;
        resolve();
      };
      this.#wakeStream = wake;
      void this.env.sleep(ms).then(wake);
    });
  }

  private followStream(): Promise<void> {
    const fetchFn: typeof fetch = (input, init) =>
      this.env.fetchFn(input, init).then(
        (response) => {
          this.streamsFull = response.status === 429;
          return response;
        },
        (error: unknown) => {
          this.streamsFull = false;
          throw error;
        },
      );
    return this.stream.follow({
      fetchFn,
      url: () => this.env.hub.url('/api/tasks/events'),
      bearer: () => this.env.hub.bearer,
      hasToken: () => this.env.hub.hasToken,
      sleep: async (ms) => {
        // The stream broke: said at once when no hub answers, and asked again right before the next try.
        void this.watchHub();
        await this.streamSleep(ms);
        await this.beforeStreamRetry();
      },
      // What happened while the stream was down.
      onOpen: () => void this.refresh(),
      onMessage: (m) => this.onMessage(m),
      onLost: () => this.lostSession(),
      // The windows a task was detached into share the session of the tab, and with it this one stream.
      share: () => browserStreamShare(this.env.hub.bearer),
    });
  }

  private onMessage(message: SseMessage): void {
    if (message.event === 'tasks' || message.event === 'resync') {
      void this.refresh();
      return;
    }
    if (message.event === 'classes') {
      // What the cache and the exports rest on may be out of date: the classes are asked again with the list.
      this.classesMoved = true;
      void this.refresh();
      return;
    }
    if (message.event === 'hello') {
      // Where the stream stands: a different revision than ours is a change
      // that came between our read and the stream.
      try {
        const doc = JSON.parse(message.data) as { rev?: string | null };
        if (doc.rev && this.snapshot?.rev && doc.rev !== this.snapshot.rev) void this.refresh();
      } catch {
        void this.refresh();
      }
    }
  }
}

/** A refusal of the plan wizard's dry run: the engine's words, and the phase it names when a phase was the reason. */
function refusedPlan(error: { message?: string; details?: unknown } | undefined): PlanPreview {
  const phase = badPhaseOf(error?.details);
  return { kind: 'refused', message: error?.message ?? '', ...(phase ? { phase } : {}) };
}
