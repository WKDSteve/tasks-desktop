// What the context menu offers, per kind of target (the kit's `ContextRegistry`): the entries come from the providers of
// every target around the pointer, the innermost first. The page declares the targets (`use:contextTarget`); what an
// entry does goes through the same methods of `App` as the buttons and keys do (the engine judges, WEB-13).
import { metricOfTile } from './statsHistory';
import { ContextRegistry, type ContextTarget } from 'appkit-ui/contextmenu';
import type { MenuItem } from 'appkit-ui/menu';
import type { App } from './app.svelte';
import type { TaskEntry, ViewSelect } from './contract';
import { tasksOf, type CountKey } from './counts';
import type { ExportFormat } from './export';
import { copyText } from './exportDom';
import { translate, type Key } from './i18n';

/** A target that stands for a selection of tasks (an area, a plan, a group of a view): "open as a view" for it. */
export function selectionTarget(title: string, select: Partial<ViewSelect>): ContextTarget {
  return { kind: 'selection', id: title, data: { title, select } };
}

/**
 * A number of the Today page (ready, doing, blocked, estimated): it stands for the tasks it counts, which no selection
 * of a view can name (the engine's plan says which are ready). The menu copies them, as it does for an area.
 */
export function countTarget(key: CountKey, title: string): ContextTarget {
  return { kind: 'count', id: key, data: { key, title } };
}

/** A task (a row, a card): its entries and the view of its area. */
export function taskTarget(task: TaskEntry): ContextTarget {
  return { kind: 'task', id: task.id, data: task };
}

/** A tag shown as a chip (the detail of a task): "show all with this tag". */
export function tagTarget(tag: string): ContextTarget {
  return { kind: 'tag', id: tag };
}

/** The view that is shown, as the target of everything on it that is no target of its own. */
export function viewTarget(view: string): ContextTarget {
  return { kind: 'view', id: view };
}

/** The views that make a task: the entries "new task" is offered on. */
const WRITING_VIEWS = new Set(['today', 'list', 'board', 'inbox', 'plan', 'cross']);

/** The formats the context menu copies in, as the button Export names them. */
const COPY_FORMATS: readonly [ExportFormat, string][] = [
  ['markdown', 'Markdown'],
  ['csv', 'CSV'],
  ['json', 'JSON'],
];

export function createContextRegistry(app: App): ContextRegistry {
  const registry = new ContextRegistry();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  /** The entries that copy `tasks` (read when chosen: the list may have changed since the menu opened). */
  const copyEntries = (tasks: () => readonly TaskEntry[]): MenuItem[] => [
    { kind: 'section', label: t('menu.sec.export') },
    ...COPY_FORMATS.map(
      ([format, name]): MenuItem => ({
        kind: 'action',
        label: t('export.copy', { format: name }),
        hint: t('hint.ctx.copy_tasks'),
        onselect: () => void app.copyTasks(tasks(), format),
      }),
    ),
  ];

  registry.provide('selection', (target) => {
    const data = target.data as { title: string; select: Partial<ViewSelect> };
    return [...copyEntries(() => app.tasksOfSelect(data.select)), ...app.viewMenuEntries(data.title, data.select)];
  });

  // The tasks behind a number of Today, as the panel of the number lists them: under the filter that is on.
  registry.provide('count', (target) => {
    const { key, title } = target.data as { key: CountKey; title: string };
    // A number that has a history offers it first: the statistics with its figure, and the way back to where this is.
    const metric = app.can('history') ? metricOfTile(key) : null;
    const history: MenuItem[] = metric
      ? [
          {
            kind: 'action',
            label: t('today.tiles.history', { what: title }),
            hint: t('hint.tile.history', { what: title }),
            onselect: () => app.openHistory(metric, document.querySelector('main')?.scrollTop ?? 0),
          },
        ]
      : [];
    return [...history, ...copyEntries(() => tasksOf(key, app.shown))];
  });

  registry.provide('task', (target, env) => {
    const task = target.data as TaskEntry;
    const items: MenuItem[] = [
      { kind: 'action', label: t('ctx.show'), hint: t('hint.ctx.show'), onselect: () => app.reveal(task.id) },
      // Where the page can open a window: the task alone in a new tab, with this tab's session.
      ...(app.canDetach
        ? [
            {
              kind: 'action',
              label: t('ctx.open_new'),
              hint: t('hint.ctx.open_new'),
              onselect: () => app.openTaskApart(task.id),
            } satisfies MenuItem,
          ]
        : []),
      {
        kind: 'action',
        label: t('ctx.copy_id'),
        // A page that is not served securely (the hub over http in a LAN) has no clipboard: `copyText` says so.
        onselect: () => {
          void copyText(navigator.clipboard, task.id).then((copied) => {
            if (copied) app.tell('ok', 'ctx.copied', { id: task.id });
            else app.tell('error', 'about.copy_failed');
          });
        },
      },
    ];
    // Handing it to an agent: only where the AI functions are offered, and for one task.
    if (app.aiFeatures && env.selection.length <= 1) {
      items.push({ kind: 'action', label: t('ctx.agent'), hint: t('hint.ctx.agent'), onselect: () => app.openAgent(task.id) });
      // A task that waits for a decision: an agent prepares it (the person decides afterwards, in its questions).
      if (task.status === 'decision') {
        items.push({
          kind: 'action',
          label: t('answer.decision'),
          hint: t('hint.ui.detail.decision'),
          onselect: () => void app.startAnswer(task.id, 'prepare-decision', task.title),
        });
      }
    }
    // What the engine can write; one task or the whole selection (the same writes as the keys, each one asked of it).
    if (app.can('ops') && env.selection.length <= 1) {
      items.push({ kind: 'section', label: t('field.status') });
      for (const status of app.ranges.statuses) {
        items.push({
          kind: 'radio',
          label: t(`status.${status}` as Key),
          checked: task.status === status,
          disabled: app.saving,
          onselect: () => void app.setField(task.id, 'status', status),
        });
      }
      items.push({ kind: 'section', label: t('field.prio') });
      for (const prio of app.ranges.prios) {
        items.push({
          kind: 'radio',
          label: `P${prio}`,
          checked: task.prio === prio,
          disabled: app.saving,
          onselect: () => void app.setField(task.id, 'prio', prio),
        });
      }
    }
    // The tags: a searchable choice of the ones the open tasks carry (`TagDialog`), for this task or, when it is one
    // of the marked ones, for all of them.
    if (app.can('ops')) {
      items.push({ kind: 'section', label: t('field.tags') });
      items.push({ kind: 'action', label: t('tags.add'), hint: t('hint.ctx.tags.add'), disabled: app.locked, onselect: () => app.openTagging(task.id, 'add') });
      items.push({ kind: 'action', label: t('tags.remove'), hint: t('hint.ctx.tags.remove'), disabled: app.locked, onselect: () => app.openTagging(task.id, 'remove') });
    }
    // The task, or the marked ones of the list when it is one of them (`selection`), each as the list holds it now.
    const ids = env.selection.map((s) => s.id);
    const chosen = () => app.tasks.filter((entry) => ids.includes(entry.id));
    return [...items, ...copyEntries(chosen), ...app.viewMenuEntries(task.area, { areas: [task.area] })];
  });

  registry.provide('tag', (target) => {
    const tag = target.id ?? '';
    if (tag === '') return [];
    // Next to the list of the tag: the tasks with it as a view to try (columns, list, grouped by a field), as for an area.
    return [
      { kind: 'action', label: t('tags.show', { tag }), hint: t('hint.ui.tags.show'), onselect: () => app.showTag(tag) },
      ...app.viewMenuEntries(tag, { tags: [tag] }),
    ];
  });

  registry.provide('view', (target) => {
    if (!WRITING_VIEWS.has(target.id ?? '')) return [];
    return [
      { kind: 'action', label: t('menu.capture'), shortcut: 'C', onselect: () => app.openCapture() },
      { kind: 'action', label: t('menu.palette'), shortcut: 'Ctrl+K', onselect: () => app.openPalette() },
    ];
  });

  return registry;
}
