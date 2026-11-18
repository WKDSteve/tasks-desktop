// The actions a row of a list offers at its end (move to another area, status, priority, finish, copy the id, open in
// the editor): which of them the person switched on, kept in the browser, and which of those a task can take. The bar
// shows only in the row under the pointer, with the focus or selected, unless it is switched to "always".

/** Every action a row can offer, in the order of the bar. */
export const ROW_ACTIONS = ['move', 'status', 'prio', 'finish', 'copy', 'editor'] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];

/** What the person chose: the actions of the bar, and whether every row shows them all the time. */
export interface RowActionPrefs {
  shown: readonly RowAction[];
  always: boolean;
}

/** As the page comes: the one action the rows had before, on the row the pointer is on. */
export const DEFAULT_ROW_ACTIONS: RowActionPrefs = { shown: ['move'], always: false };

const isAction = (value: unknown): value is RowAction => (ROW_ACTIONS as readonly unknown[]).includes(value);

/** The actions of `list` that exist, each once, in the order of the bar. */
function ordered(list: readonly unknown[]): RowAction[] {
  return ROW_ACTIONS.filter((action) => list.includes(action));
}

/** The choice as it was kept (`serializeRowActions`); anything else is the default. An emptied bar stays empty. */
export function parseRowActions(text: string | null): RowActionPrefs {
  if (text === null) return DEFAULT_ROW_ACTIONS;
  try {
    const raw = JSON.parse(text) as { shown?: unknown; always?: unknown } | null;
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.shown)) return DEFAULT_ROW_ACTIONS;
    return { shown: ordered(raw.shown.filter(isAction)), always: raw.always === true };
  } catch {
    return DEFAULT_ROW_ACTIONS;
  }
}

export function serializeRowActions(prefs: RowActionPrefs): string {
  return JSON.stringify({ shown: ordered(prefs.shown), always: prefs.always });
}

/** The choice with `action` switched on or off. */
export function toggleRowAction(prefs: RowActionPrefs, action: RowAction): RowActionPrefs {
  const shown = prefs.shown.includes(action) ? prefs.shown.filter((a) => a !== action) : ordered([...prefs.shown, action]);
  return { ...prefs, shown };
}

/** What the page can do at all (the engine's capabilities, the machine the hub runs on). */
export interface RowActionCaps {
  /** The engine moves a task to another area. */
  move: boolean;
  /** The engine writes fields. */
  write: boolean;
  /** The hub can start programs on its machine (the editor). */
  machine: boolean;
}

/** The actions of the bar for one task: the chosen ones the page can do and the task can take. */
export function offeredRowActions(prefs: RowActionPrefs, caps: RowActionCaps, task: { status?: string | undefined }): RowAction[] {
  const open = task.status !== 'done';
  return ordered(prefs.shown).filter((action) => {
    switch (action) {
      case 'move':
        return caps.move && open;
      case 'status':
      case 'prio':
        return caps.write && open;
      case 'finish':
        return caps.write && open;
      case 'editor':
        return caps.machine;
      case 'copy':
        return true;
    }
  });
}

/** Whether the bar of a row is drawn visibly without the pointer on it: switched to always, or the row is the selected one. */
export function barShown(prefs: RowActionPrefs, selected: boolean): boolean {
  return prefs.always || selected;
}
