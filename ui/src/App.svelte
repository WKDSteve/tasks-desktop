<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { shownMarkIds } from './lib/markDom';
  import type { App, View } from './lib/app.svelte';
  import { logo } from './lib/logo';
  import { matches } from 'appkit-ui/keymap';
  import { keymap, pressOf } from './lib/keymap';
  import { ago, hasKey, translate, type Key } from './lib/i18n';
  import Today from './views/Today.svelte';
  import ListView from './views/ListView.svelte';
  import TaskDialog from './views/TaskDialog.svelte';
  import { floating } from './lib/floating';
  import ConflictsButton from './views/ConflictsButton.svelte';
  import FinishedDialog from './views/FinishedDialog.svelte';
  import Detail from './views/Detail.svelte';
  import { triageKey } from './lib/inbox';
  import { copyText } from './lib/exportDom';
  import { exportWord } from './lib/exportWord';
  import Brand from 'appkit-ui/Brand.svelte';
  import DocsDialog from 'appkit-ui/DocsDialog.svelte';
  import { helpItems, type DocEntry } from 'appkit-ui/docs';
  import MenuBar, { type Menu, type MenuItem } from 'appkit-ui/MenuBar.svelte';
  import AreaFilter from './views/AreaFilter.svelte';
  import Capture from './views/Capture.svelte';
  import DoneDialog from './views/DoneDialog.svelte';
  import PrioDialog from './views/PrioDialog.svelte';
  import BlockDialog from './views/BlockDialog.svelte';
  import DropMoveDialog from './views/DropMoveDialog.svelte';
  import Palette from './views/Palette.svelte';
  import { DOC_LIST, LICENSE, loadDocs, REPO_URL } from './lib/docs';
  import { scrollByKey } from './lib/scrollKeys';
  import ContextMenu from 'appkit-ui/ContextMenu.svelte';
  import { contextTarget } from 'appkit-ui/contextmenu';
  import { routeHref } from 'appkit-ui/route';
  import { installTaskApart } from './lib/taskApart';
  import { createContextRegistry, taskTarget, viewTarget } from './lib/context';
  import { vaultMenuItems, vaultMenuOpened } from './lib/vaultMenu';
  import { isLearnView, learnMenu } from './lib/learnViews';
  import { isMenuView, viewMenu } from './lib/viewTabMenu';
  import SetupCard from './views/SetupCard.svelte';
  import HubNotice from './views/HubNotice.svelte';
  import Toast from './views/Toast.svelte';
  import Lazy from './views/Lazy.svelte';
  import { loader, preload } from './views/loader';

  let { app, code }: { app: App; code: string | null } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) =>
    translate(app.lang, key, params);

  let chord = $state(false);
  // The page opened from disk (the web variant): a shortcut can point to its file. Served pages have their own address.
  const fromDisk = location.protocol === 'file:';
  let shortcutOpen = $state(false);
  let installOpen = $state(false);
  let defaultsOpen = $state(false);
  // These dialogs are loaded when they are first opened (the main chunk has a budget) and kept from then on (`Lazy`).
  let updateOpen = $state(false);
  // A view of the menu is a link to its place: the browser's context menu (and Shift+click) opens it in a new tab, which
  // takes the session of an open tab. A middle click, Ctrl+click or Ctrl+Enter opens it in a new tab from here, with
  // the session of this one, where the page can open one.
  const apart = (view: View) => ({
    href: routeHref(location, { view }),
    ...(app.canDetach ? { onopennew: () => app.openViewApart(view) } : {}),
  });
  // The board, the views and the inbox: opened often, but rarely at the start (Today and List are). Their chunk comes
  // when the page is idle after its start, so that the first open draws them in the frame of their heading (`loader`).
  const loadViews = loader(() => import('./views/ViewsView.svelte'));
  const loadBoard = loader(() => import('./views/BoardView.svelte'));
  const loadInbox = loader(() => import('./views/InboxView.svelte'));
  let preloaded = false;
  $effect(() => {
    if (app.phase !== 'ready' || preloaded) return;
    preloaded = true;
    preload([loadViews, loadBoard, loadInbox]);
  });
  let chordTimer: ReturnType<typeof setTimeout> | undefined;
  let searchBox = $state<HTMLInputElement | null>(null);

  onMount(() => {
    void app.start(code);
    const onFocus = () => void app.focused();
    window.addEventListener('focus', onFocus);
    // A middle click or Ctrl+click on a task opens it in a new tab, as a link does.
    const stopApart = installTaskApart(app, window);
    return () => {
      stopApart();
      window.removeEventListener('focus', onFocus);
      clearTimeout(chordTimer);
      app.stop();
    };
  });

  $effect(() => {
    document.documentElement.lang = app.lang;
    if (app.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = app.theme;
  });

  function typing(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        // A ticked box is not typing: the keys of the page work on after a click on a mark.
        (target.tagName === 'INPUT' && !target.classList.contains('mark')) ||
        ['TEXTAREA', 'SELECT'].includes(target.tagName) ||
        // An open menu has its own keys; a letter there is not a shortcut of the
        // page. (The buttons of the bar are not it: after a choice the focus
        // sits there and j and k are still the list's.) A dialog is modal: what
        // is behind it is not reached by a key.
        target.closest('[role="menu"], dialog') !== null)
    );
  }

  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

  function setChord(on: boolean): void {
    chord = on;
    clearTimeout(chordTimer);
    // A `g` that nothing follows is forgotten.
    if (on) chordTimer = setTimeout(() => (chord = false), keymap.chord.timeoutMs);
  }

  /** The page is a window of one task (detached from a float): its detail stands alone, in place of the view. */
  const alone = $derived(app.solo && app.selected !== null);

  /**
   * The key `c` in the float of a task, on one of its buttons (not in a field): a new task, as from the page. The
   * capture opens over the float, and the task it makes is shown in the float after it, so that one task after the
   * other is captured with c, its title and Enter.
   */
  function captureFromFloat(event: KeyboardEvent): boolean {
    const target = event.target;
    if (event.key !== 'c' || event.repeat || !(target instanceof HTMLElement)) return false;
    if (!target.closest('dialog')?.classList.contains('peek')) return false;
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return false;
    if (target.closest('[role="menu"]') !== null) return false;
    event.preventDefault();
    app.openCapture();
    return true;
  }

  function onKey(event: KeyboardEvent): void {
    if (alone) scrollByKey(event, document.querySelector('.solo .detail-body'));
    // The palette is not a single-key shortcut: it opens with Ctrl or Cmd and K, also in a field and with the keys off.
    if (app.phase === 'ready' && matches(keymap.palette, pressOf(event))) {
      event.preventDefault();
      // Only opens: a second press while it is open leaves it as it is (Escape closes).
      app.openPalette();
      return;
    }
    if (!app.shortcuts || app.phase !== 'ready') return;
    // A key an element of the page already took (the Escape that closed a popup) is not also a key of the page.
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!event.shiftKey && captureFromFloat(event)) return;
    if (typing(event.target)) return;
    if (MODIFIERS.has(event.key)) return;
    if (chord) {
      setChord(false);
      // Only a key that is part of the chord is taken; Tab and the others
      // keep doing what they do.
      const target = keymap.chord.targets[event.key];
      if (target !== undefined) {
        app.setView(target as View);
        event.preventDefault();
        return;
      }
    }
    // The detail of a window of one task stands in place of the view, and the float of a task over it: the keys of
    // the view do not reach what is hidden behind them (a focus that fell out of the float onto the page would move the
    // list under it, or write a field of the inbox).
    const view = alone || app.taskFloatOpen ? null : app.view;
    // The board: Shift with j, k, h or l writes (reorder inside the group, set the status). The letter's case is not
    // trusted: CapsLock turns a plain j into 'J'.
    if (view === 'board' && event.shiftKey && /^[jkhl]$/i.test(event.key)) {
      event.preventDefault();
      const id = app.selectedId;
      if (id !== null && !event.repeat) {
        const key = event.key.toLowerCase();
        if (key === 'j' || key === 'k') void app.stepCard(id, key === 'j' ? 1 : -1);
        else void app.shiftColumn(id, key === 'l' ? 1 : -1);
      }
      return;
    }
    // The inbox: a single key writes a field of the selected task. Holding a key does not write it again.
    if (view === 'inbox') {
      // The letter's case is not trusted here either: with CapsLock on, j and u arrive as J and U (without Shift).
      const letter = event.key.length === 1 && !event.shiftKey ? event.key.toLowerCase() : event.key;
      if (letter === 'j' || letter === 'k') {
        event.preventDefault();
        app.moveSelectionInbox(letter === 'j' ? 1 : -1);
        return;
      }
      if (letter === 'u') {
        event.preventDefault();
        if (!event.repeat) void app.undo();
        return;
      }
    }
    // The acceptance: its own keys (j/k over the points, Space ticks the one under the cursor).
    if (view === 'abnahme' && app.viewKeys?.(event)) {
      event.preventDefault();
      return;
    }
    if (view === 'inbox' && event.key !== 'g' && event.key !== 'G') {
      if (triageKey(event.key, event.shiftKey)) {
        event.preventDefault();
        if (!event.repeat) void app.triage(event.key, event.shiftKey);
        return;
      }
    }
    switch (event.key) {
      case 'g':
        setChord(true);
        break;
      case 'c':
        event.preventDefault();
        app.openCapture();
        break;
      case 'j':
        if (view === 'list') app.moveSelection(1);
        else if (view === 'inbox') app.moveSelectionInbox(1);
        else if (view === 'board') app.moveSelectionInColumn(1);
        break;
      case 'k':
        if (view === 'list') app.moveSelection(-1);
        else if (view === 'inbox') app.moveSelectionInbox(-1);
        else if (view === 'board') app.moveSelectionInColumn(-1);
        break;
      // The board: h and l change the column (Shift with j, k, h, l writes, above).
      case 'h':
        if (view === 'board') app.moveSelectionAcross(-1);
        break;
      case 'l':
        if (view === 'board') app.moveSelectionAcross(1);
        break;
      case 'o':
        // These views have no detail beside them: the selected task opens in the float. (The inbox keeps its own, for
        // its keys: each press sorts the task and shows the next one.)
        if ((view === 'list' || view === 'board' || view === 'views') && app.selectedId !== null && !event.repeat) {
          event.preventDefault();
          app.peek(app.selectedId);
        }
        break;
      case 'x':
        // Holding the key does not flip the mark back and forth.
        // In every view that marks (the list, the board, the plan, the inbox, a saved view): the selected task.
        if (view !== null && app.marking && app.selectedId !== null && !event.repeat) {
          const id = app.selectedId;
          if (app.draws(id)) app.toggleMark(id);
        }
        break;
      case 'e':
        if (view === 'list' && !event.repeat) {
          event.preventDefault();
          app.openMatrix();
        }
        break;
      case '/':
        if (view === 'list') {
          event.preventDefault();
          searchBox?.focus();
        }
        break;
      case 'Escape':
        // The float of a task closes itself (the dialog takes its Escape); the selection and the marks behind it stay.
        if (app.taskFloatOpen) break;
        // In the list the marks go first; elsewhere there are none to see. A window of one task lets go of it and shows
        // its view.
        if (app.marking && app.marks.length > 0) app.clearMarks();
        else app.select(null);
        break;
    }
  }

  // The code of the hub names what is missing; a code this page does not
  // know gets the general words.
  const setupKey = $derived.by(() => {
    const code = app.problem ?? '';
    return hasKey(app.lang, `setup.${code}.title`) ? code : 'unknown';
  });

  const age = $derived(app.cachedAt === null ? '' : ago(app.lang, Date.now() - app.cachedAt));

  /** What the bar says of the connection: the list from the cache, a stream the hub refused (too many windows), or the stream. */
  const connState = $derived(
    app.cachedAt !== null ? 'cached' : app.streamsFull && app.connection !== 'live' ? 'full' : app.connection,
  );

  /** The word of an export entry: the view's own where it gives tables instead of tasks (`ViewTables.label`). */
  const tl = (key: Key): string => exportWord(app, key, t);

  /** The entries of the menu that export what the view shows: a file for each format, then the clipboard. */
  const exportItems = (ready: boolean) =>
    // Only where the view shows tasks: an export from Today or the inbox would take the list, which is not shown there.
    (
      [
        ['menu.save_csv', 'csv', 'save'],
        ['menu.save_json', 'json', 'save'],
        ['menu.save_md', 'markdown', 'save'],
        ['menu.copy_csv', 'csv', 'copy'],
        ['menu.copy_json', 'json', 'copy'],
        ['menu.copy_md', 'markdown', 'copy'],
      ] as const
    )
      .map(([label, format, how]) => ({
        kind: 'action' as const,
        label: tl(label),
        hint: tl(`hint.item.${label}` as Key),
        disabled: !ready || !app.exportable,
        onselect: () => void app.exportView(format, how),
      }))
      .concat({ kind: 'action' as const, label: tl('menu.print_view'), hint: tl('hint.item.menu.print_view'), disabled: !ready || !app.exportable, onselect: () => void app.printView() })
      .concat(app.canPng ? [{ kind: 'action' as const, label: tl('export.png'), hint: tl('hint.item.menu.png'), disabled: !ready || !app.exportable, onselect: () => void app.pngView() }] : []);

  /** The name of a view in the menu: the saved views are named so there, as "Views" would stand twice beside the tab. */
  const viewLabel = (id: string): string => (id === 'views' ? t('menu.saved_views') : t(`nav.${id}` as Key));
  /** A view of the tab View: a radio that goes there (as a link, with the new tab where the page can open one). */
  const viewItem = (id: string, disabled: boolean): MenuItem => ({
    kind: 'radio',
    label: viewLabel(id),
    hint: t(`hint.item.nav.${id}` as Key),
    ...(disabled ? { disabled } : {}),
    checked: app.view === id,
    onselect: () => app.setView(id as View),
    ...apart(id as View),
  });
  /** The submenu Export of the tab View: what the view shown draws, to a file, the clipboard or the printer. */
  const exportSubmenu = (ready: boolean): MenuItem => {
    const all = exportItems(ready);
    return {
      kind: 'submenu',
      label: t('menu.sub.export'),
      hint: t('hint.item.menu.sub.export'),
      items: [
        { kind: 'info', label: t('menu.export_of', { view: hasKey(app.lang, `nav.${app.view}`) ? t(`nav.${app.view}` as Key) : app.view }) },
        { kind: 'section', label: t('menu.sec.export_save') },
        ...all.slice(0, 3),
        { kind: 'section', label: t('menu.sec.export_copy') },
        ...all.slice(3, 6),
        { kind: 'section', label: t('menu.sec.export_print') },
        ...all.slice(6),
      ],
    };
  };

  /** The task the engine names as the next one to take: the one the tile of that name shows. */
  const nextTaskId = $derived(app.next?.task?.id ?? null);

  /** The list with the cursor in its search box. */
  async function findTask(): Promise<void> {
    app.setView('list');
    await tick();
    searchBox?.focus();
  }

  /** The id of the selected task on the clipboard, and a word about it. */
  async function copyId(): Promise<void> {
    const id = app.selectedId;
    if (id === null) return;
    const ok = await copyText(navigator.clipboard, id);
    app.tell(ok ? 'ok' : 'error', ok ? 'menu.id_copied' : 'menu.copy_id_failed');
  }

  // The views of the tab Learning plans that are offered now (learnViews.ts).
  const learnSections = $derived(learnMenu({ can: (c) => app.can(c), gamification: app.gamification }));
  // The menu bar of the page (the native shell shows the same entries).
  const menus = $derived.by((): Menu[] => {
    const ready = app.phase === 'ready';
    return [
      {
        id: 'tasks',
        label: t('menu.tasks'),
        hint: t('hint.ui.menu.tasks'),
        items: [
          { kind: 'section', label: t('menu.sec.create') },
          {
            kind: 'action',
            label: t('menu.capture'),
            hint: t('hint.item.menu.capture'),
            shortcut: app.shortcuts ? 'C' : undefined,
            disabled: !ready,
            onselect: () => app.openCapture(),
          },
          {
            kind: 'action',
            label: t('menu.intent'),
            hint: t('hint.item.menu.intent'),
            disabled: !ready,
            onselect: () => app.openIntent(),
          },
          { kind: 'section', label: t('menu.sec.find') },
          {
            kind: 'action',
            label: t('menu.find_task'),
            hint: t('hint.item.menu.find_task'),
            shortcut: app.shortcuts ? '/' : undefined,
            disabled: !ready,
            onselect: () => void findTask(),
          },
          {
            kind: 'action',
            label: t('menu.palette'),
            hint: t('hint.item.menu.palette'),
            shortcut: 'Ctrl+K',
            disabled: !ready,
            onselect: () => app.openPalette(),
          },
          {
            kind: 'action',
            label: t('menu.next_task'),
            hint: t('hint.item.menu.next_task'),
            disabled: !ready || nextTaskId === null,
            onselect: () => nextTaskId !== null && app.reveal(nextTaskId),
          },
          { kind: 'section', label: t('menu.sec.edit') },
          {
            kind: 'action',
            label: t('menu.copy_id'),
            hint: t('hint.item.menu.copy_id'),
            disabled: !ready || app.selectedId === null,
            onselect: () => void copyId(),
          },
          {
            kind: 'action',
            label: t('menu.reset_filter'),
            hint: t('hint.item.menu.reset_filter'),
            disabled: !ready,
            onselect: () => app.resetFilter(),
          },
        ],
      },
      {
        id: 'project',
        label: t('menu.project'),
        hint: t('hint.ui.menu.project'),
        onopen: () => vaultMenuOpened(app),
        items: [
          ...vaultMenuItems(app),
          {
            kind: 'action',
            label: t('menu.rescan'),
            hint: t('hint.item.menu.rescan'),
            disabled: !ready,
            onselect: () => void app.focused(),
          },
          { kind: 'section', label: t('menu.sec.plan') },
          {
            kind: 'action',
            label: t('plan.new.button'),
            hint: t('hint.item.plan.new.button'),
            disabled: app.phase !== 'ready' || !app.can('plan_new'),
            onselect: () => app.openPlanWizard(),
          },
          ...(app.canMeetings
            ? [
                {
                  kind: 'action' as const,
                  label: t('menu.meeting'),
                  hint: t('hint.item.menu.meeting'),
                  disabled: app.phase !== 'ready' || !app.canMakeMeetings,
                  onselect: () => app.openMeetingForm(),
                },
              ]
            : []),
          { kind: 'section', label: t('menu.sec.export') },
          { kind: 'info', label: t('menu.export_where') },
          ...exportItems(ready),
          { kind: 'section', label: t('menu.sec.page') },
          { kind: 'action', label: t('menu.reload'), hint: t('hint.item.menu.reload'), onselect: () => window.location.reload() },
        ],
      },
      {
        id: 'view',
        label: t('menu.view'),
        hint: t('hint.ui.menu.view'),
        // Like the learning plans: the name of the view shown, where it is one of this tab.
        current: isMenuView(app.view) ? viewLabel(app.view) : null,
        items: [
          ...viewMenu({ can: (c) => app.can(c), machine: app.machineActions }).map((entry): MenuItem => {
            if (entry.kind === 'section') return { kind: 'section', label: t(`menu.sec.view_${entry.group}` as Key) };
            if (entry.kind === 'view') return viewItem(entry.id, entry.disabled);
            return {
              kind: 'submenu',
              label: t(`menu.sub.${entry.group}` as Key),
              items: entry.views.map((v) => viewItem(v.id, v.disabled)),
            };
          }),
          // The learning paths and the other views of the learning plans are in a tab of their own (learnViews.ts).
          // The export belongs to the view that is shown: it takes what that view draws.
          exportSubmenu(ready),
        ],
      },
      // The tab of the learning plans, after View: only with the learning paths of the engine, and only the views the
      // page has and the engine serves (learnViews.ts); the export and the print of the view shown stay in View.
      ...(learnSections.length > 0
        ? [
            {
              id: 'learn',
              label: t('menu.learn'),
              hint: t('hint.ui.menu.learn'),
              current: isLearnView(app.view) ? t(`nav.${app.view}` as Key) : null,
              items: learnSections.flatMap(({ section, views }): MenuItem[] => [
                { kind: 'section', label: t(`menu.sec.learn_${section}` as Key) },
                ...views.map((id) => ({
                  kind: 'radio' as const,
                  label: t(`nav.${id}` as Key),
                  hint: t(`hint.item.nav.${id}` as Key),
                  checked: app.view === id,
                  onselect: () => app.setView(id as View),
                  ...apart(id as View),
                })),
              ]),
            },
          ]
        : []),
      {
        id: 'options',
        label: t('menu.options'),
        hint: t('hint.ui.menu.options'),
        items: [
          { kind: 'section', label: t('lang.label') },
          {
            kind: 'radio',
            label: 'Deutsch',
            hint: t('hint.item.lang.de'),
            checked: app.lang === 'de',
            onselect: () => void app.setLang('de'),
          },
          {
            kind: 'radio',
            label: 'English',
            hint: t('hint.item.lang.en'),
            checked: app.lang === 'en',
            onselect: () => void app.setLang('en'),
          },
          // How the page looks: the colours and the switches that only change what is drawn (not what happens).
          { kind: 'section', label: t('theme.label') },
          ...(['auto', 'light', 'dark'] as const).map((value) => ({
            kind: 'radio' as const,
            label: t(`theme.${value}` as Key),
            hint: t(`hint.item.theme.${value}` as Key),
            checked: app.theme === value,
            onselect: () => app.setTheme(value),
          })),
          {
            kind: 'check',
            label: t('menu.short_areas'),
            hint: t('hint.item.menu.short_areas'),
            checked: app.shortAreas,
            onselect: () => app.setShortAreas(!app.shortAreas),
          },
          {
            kind: 'check',
            label: t('menu.area_counts'),
            hint: t('hint.item.menu.area_counts'),
            checked: app.areaCountsShown,
            onselect: () => app.setAreaCounts(!app.areaCountsShown),
          },
          {
            kind: 'check',
            label: t('menu.area_split'),
            hint: t('hint.item.menu.area_split'),
            checked: app.areaSplit,
            onselect: () => app.setAreaSplit(!app.areaSplit),
          },
          {
            kind: 'check',
            label: t('menu.zebra'),
            hint: t('hint.item.menu.zebra'),
            checked: app.zebra,
            onselect: () => app.setZebra(!app.zebra),
          },
          {
            kind: 'check',
            label: t('menu.bar_areas'),
            hint: t('hint.item.menu.bar_areas'),
            checked: app.barAreas,
            onselect: () => app.setBarAreas(!app.barAreas),
          },
          // The tiles of the overview Today: only where it is shown (they act on nothing else).
          ...(app.view === 'today'
            ? [
                { kind: 'section' as const, label: t('menu.sec.tiles') },
                {
                  kind: 'action' as const,
                  label: t('menu.show_tiles', { n: app.hiddenTiles.length }),
                  hint: t('hint.item.menu.show_tiles'),
                  disabled: app.hiddenTiles.length === 0,
                  onselect: () => app.showTiles(),
                },
                {
                  kind: 'action' as const,
                  label: t('menu.reset_order'),
                  hint: t('hint.item.menu.reset_order'),
                  disabled: !app.tileOrderChanged,
                  onselect: () => app.resetTileOrder(),
                },
              ]
            : []),
          { kind: 'section', label: t('menu.sec.behaviour') },
          {
            kind: 'action',
            label: t('menu.defaults'),
            hint: t('hint.item.menu.defaults'),
            onselect: () => (defaultsOpen = true),
          },
          {
            kind: 'check',
            label: t('shortcuts.label'),
            hint: t('hint.item.shortcuts.label'),
            checked: app.shortcuts,
            onselect: () => app.setShortcuts(!app.shortcuts),
          },
          {
            kind: 'check',
            label: t('menu.save_manual'),
            hint: t('hint.item.menu.save_manual'),
            checked: app.saveMode === 'manual',
            onselect: () => app.setSaveMode(app.saveMode === 'manual' ? 'auto' : 'manual'),
          },
          ...(app.autostart === null
            ? []
            : [
                {
                  kind: 'check' as const,
                  label: t('menu.autostart'),
                  hint: t('hint.item.menu.autostart'),
                  checked: app.autostart,
                  onselect: () => void app.toggleAutostart(),
                },
              ]),
          ...(app.keepRunning === null
            ? []
            : [
                {
                  kind: 'check' as const,
                  label: t('menu.keep_running'),
                  hint: t('hint.item.menu.keep_running'),
                  checked: app.keepRunning,
                  onselect: () => void app.toggleKeepRunning(),
                },
              ]),
          // AI does not push itself forward: the switch is there only where a hub can say whether ai-desktop is found (not
          // in the web variant); where it is not found, a greyed-out entry says why there is nothing to switch.
          ...(app.aiDesktop === null
            ? []
            : app.aiFound
              ? [
                  {
                    kind: 'check' as const,
                    label: t('menu.ai_features'),
                    hint: t('hint.item.menu.ai_features'),
                    checked: app.aiFeatures,
                    onselect: () => app.setAiWanted(!app.aiWanted),
                  },
                ]
              : [
                  {
                    kind: 'action' as const,
                    label: t('menu.ai_features_missing'),
                    hint: t('hint.item.menu.ai_features_missing'),
                    disabled: true,
                    onselect: () => {},
                  },
                ]),
          { kind: 'section', label: t('menu.sec.export') },
          { kind: 'info', label: t('menu.export_where') },
          ...(fromDisk
            ? [
                { kind: 'section' as const, label: t('menu.sec.shortcut') },
                {
                  kind: 'action' as const,
                  label: t('menu.shortcut'),
                  hint: t('hint.item.menu.shortcut'),
                  onselect: () => (shortcutOpen = true),
                },
                {
                  kind: 'action' as const,
                  label: t('menu.update'),
                  hint: t('hint.item.menu.update'),
                  onselect: () => (updateOpen = true),
                },
              ]
            : []),
        ],
      },
      {
        id: 'help',
        label: t('menu.help'),
        hint: t('hint.ui.menu.help'),
        items: [
          {
            kind: 'action',
            label: t('menu.about'),
            hint: t('hint.item.menu.about'),
            disabled: !app.canAbout,
            onselect: () => app.openAbout('info'),
          },
          {
            kind: 'action',
            label: t('menu.report'),
            hint: t('hint.item.menu.report'),
            disabled: !app.canAbout,
            onselect: () => app.openAbout('report'),
          },
          ...(app.setupState.installStep
            ? [
                {
                  kind: 'action' as const,
                  label: t('menu.install'),
                  hint: t('hint.item.menu.install'),
                  onselect: () => (installOpen = true),
                },
              ]
            : []),
          ...helpItems({
            text: (key, params) => t(key, params),
            docs: DOC_LIST,
            opendoc: (id) => void openDocs(id),
            opensearch: () => void openDocs(null),
            repo: { url: REPO_URL },
            license: LICENSE,
          }),
        ],
      },
    ];
  });
  const contextRegistry = $derived(createContextRegistry(app));
  // The marked tasks of the view that is shown (the list, the board, the plan, the inbox, a saved view); read when the
  // menu opens.
  const markedTargets = () => {
    const here = new Set(app.marksHere);
    return app.tasks.filter((x) => here.has(x.id)).map(taskTarget);
  };
  // What the view draws now (`App.drawn`): read from the main area whenever a task comes or goes there, once a frame.
  let mainArea: HTMLElement | undefined = $state();
  $effect(() => {
    const root = mainArea;
    if (!root) return;
    let frame = 0;
    const read = (): void => {
      frame = 0;
      app.drawn = new Set(shownMarkIds(root.ownerDocument));
    };
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(read);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-mark-id'] });
    read();
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      app.drawn = null;
    };
  });
  // The context menu is built at once (the browser's menu is replaced or not before the event is over), so the fields
  // of the engine for "open as a view" are read when the page is ready, not at the first right click.
  $effect(() => {
    if (app.phase === 'ready' && app.can('groupings')) void app.viewsState.loadGroupings();
  });
  // The documentation window: opened at a document from the Help menu, or at its search box.
  let docsOpen = $state(false);
  let docsAt = $state<string | null>(null);
  let docTexts = $state.raw<readonly DocEntry[]>([]);
  async function openDocs(id: string | null): Promise<void> {
    try {
      docTexts = await loadDocs();
    } catch {
      app.toast = { kind: 'error', text: t('lazy.failed') };
      return;
    }
    docsAt = id;
    docsOpen = true;
  }
</script>

<!-- Unsaved fields (the option to save them with a button): the browser asks before the page is closed or reloaded. -->
<svelte:window
  onkeydown={onKey}
  onbeforeunload={(e) => {
    if (!app.hasDrafts) return;
    e.preventDefault();
    e.returnValue = '';
  }}
/>

<div class="shell">
  <header class="bar">
    <!-- The mark alone: beside the menu Tasks the word stood twice. The name and the version are in the hint. -->
    <Brand label={t('app.title')} hint={t('hint.ui.brand', { name: t('app.title'), version: app.appVersion })} onclick={() => app.setView('today')}>
      <span class="brand-mark"><img src={logo} alt="" width="24" height="24" /></span>
    </Brand>
    <MenuBar {menus} label={t('menu.label')} labels={{ submenuCurrent: t('menu.current') }} />
    <span class="spacer"></span>
    {#if app.conflicts.length > 0}
      <ConflictsButton {app} />
    {/if}
    {#if app.phase === 'ready' && app.barAreas}
      <!-- A trial: the areas of the filter, for whatever view is shown (the same filter the list has). -->
      <AreaFilter {app} hint={t('hint.ui.bar.areas')} />
    {/if}
    {#if app.phase === 'ready'}
      <span class="conn conn-{app.connection}" class:conn-full={connState === 'full'} role="status" data-hint={t(`hint.ui.conn.${connState}` as Key)}>
        {t(`conn.${connState}` as Key)}
      </span>
    {/if}
  </header>

  <main tabindex="-1" bind:this={mainArea} use:contextTarget={viewTarget(app.view)}>
    <!-- The data is somebody else's text: one task that breaks a view must
         not take the whole page with it. -->
    <svelte:boundary>
      {#if app.phase === 'starting'}
        <p class="note">{t('state.loading')}</p>
      {:else if app.phase === 'needs_pairing'}
        <section class="card centered">
          <h1>{t('state.needs_pairing.title')}</h1>
          {#if app.pairLimited}
            <p role="alert">{t('state.needs_pairing.limited')}</p>
          {:else if app.pairRefused}
            <p role="alert">{t('state.needs_pairing.refused')}</p>
          {/if}
          <p>{t('state.needs_pairing.body')}</p>
          <pre><code>tasks-desktop open</code></pre>
        </section>
      {:else if app.phase === 'offline'}
        <section class="card centered">
          <h1>{t('state.offline.title')}</h1>
          <p>{t('state.offline.body')}</p>
          <pre><code>tasks-desktop serve</code></pre>
        </section>
      {:else if app.phase === 'unavailable'}
        <section class="card centered">
          <h1>{t(`setup.${setupKey}.title` as Key)}</h1>
          <p>{t(`setup.${setupKey}.body` as Key)}</p>
          <p class="muted">{t('state.unavailable.body')} <code>{app.problem ?? '?'}</code></p>
          <SetupCard {app} />
        </section>
      {:else}
        {#if app.readOnly}
          <p class="banner" role="status">{t('web.readonly.banner')}</p>
        {/if}
        <HubNotice {app} />
        {#if app.cachedAt !== null}
          <p class="banner">{t('state.stale', { age })}</p>
        {/if}
        {#if (app.snapshot?.incomplete.length ?? 0) > 0}
          <p class="banner" role="alert">{t('data.incomplete')}</p>
        {/if}
        <h1 class="sr-only">
          {alone
            ? t('peek.label')
            : app.view === 'today'
            ? t('nav.today')
            : app.view === 'plan'
              ? t('nav.plan')
              : app.view === 'board'
                ? t('nav.board')
                : app.view === 'inbox'
                  ? t('nav.inbox')
                  : app.view === 'abnahme'
                    ? t('nav.abnahme')
                  : app.view === 'cross'
                    ? t('nav.cross')
                  : app.view === 'calendar'
                    ? t('nav.calendar')
                  : app.view === 'timeline'
                    ? t('nav.timeline')
                  : app.view === 'reminders'
                    ? t('nav.reminders')
                  : app.view === 'stats'
                    ? t('nav.stats')
                    : app.view === 'done'
                      ? t('nav.done')
                      : app.view === 'views'
                        ? t('nav.views')
                        : app.view === 'repos'
                          ? t('nav.repos')
                          : app.view === 'repostatus'
                            ? t('nav.repostatus')
                            : isLearnView(app.view)
                              ? t(`nav.${app.view}` as Key)
                              : t('nav.list')}
        </h1>
        {#if alone}
          <!-- A window of one task (detached from a float): its detail, alone, as wide as the window allows. -->
          <div class="solo"><Detail {app} /></div>
        {:else if app.view === 'today'}
          <Today {app} />
        {:else if app.view === 'plan'}
          <Lazy {app} load={() => import('./views/PlanView.svelte')} />
        {:else if app.view === 'board'}
          <!-- The board is the built-in view of the views; an engine that keeps no views shows it alone. -->
          {#if app.can('views')}<Lazy {app} load={loadViews} extra={{ board: true }} />{:else}<Lazy {app} load={loadBoard} />{/if}
        {:else if app.view === 'inbox'}
          <Lazy {app} load={loadInbox} />
        {:else if app.view === 'abnahme'}
          <Lazy {app} load={() => import('./views/AbnahmeView.svelte')} />
        {:else if app.view === 'cross'}
          <Lazy {app} load={() => import('./views/CrossView.svelte')} />
        {:else if app.view === 'calendar'}
          <Lazy {app} load={() => import('./views/CalendarView.svelte')} />
        {:else if app.view === 'timeline'}
          <Lazy {app} load={() => import('./views/TimelineView.svelte')} />
        {:else if app.view === 'reminders'}
          <Lazy {app} load={() => import('./views/RemindersView.svelte')} />
        {:else if app.view === 'stats'}
          <Lazy {app} load={() => import('./views/StatsView.svelte')} />
        {:else if app.view === 'done'}
          <Lazy {app} load={() => import('./views/FinishedView.svelte')} />
        {:else if app.view === 'views'}
          <Lazy {app} load={loadViews} />
        {:else if app.view === 'repos'}
          <Lazy {app} load={() => import('./views/ReposView.svelte')} />
        {:else if app.view === 'repostatus'}
          <Lazy {app} load={() => import('./views/RepoStatusView.svelte')} />
        {:else if app.view === 'paths'}
          <Lazy {app} load={() => import('./views/PathsView.svelte')} />
        {:else if app.view === 'pathmap'}
          <Lazy {app} load={() => import('./views/PathMapView.svelte')} />
        {:else if app.view === 'competences'}
          <Lazy {app} load={() => import('./views/CompetencesView.svelte')} />
        {:else if app.view === 'badges'}
          <Lazy {app} load={() => import('./views/BadgesView.svelte')} />
        {:else if app.view === 'rewards'}
          <Lazy {app} load={() => import('./views/RewardsView.svelte')} />
        {:else if app.view === 'evidence'}
          <Lazy {app} load={() => import('./views/EvidenceView.svelte')} />
        {:else if app.view === 'learn'}
          <Lazy {app} load={() => import('./views/LearnView.svelte')} />
        {:else if app.view === 'learnnext'}
          <Lazy {app} load={() => import('./views/LearnNextView.svelte')} />
        {:else if app.view === 'learnstats'}
          <Lazy {app} load={() => import('./views/LearnStatsView.svelte')} />
        {:else if app.view === 'learntime'}
          <Lazy {app} load={() => import('./views/LearnTimeView.svelte')} />
        {:else if app.view === 'learnnotes'}
          <Lazy {app} load={() => import('./views/LearnNotesView.svelte')} />
        {:else}
          <ListView {app} bind:searchBox />
        {/if}
      {/if}

      {#snippet failed(_error, reset)}
        <section class="card centered" role="alert">
          <h1>{t('error.title')}</h1>
          <p>{t('error.body')}</p>
          <button
            type="button"
            onclick={() => {
              reset();
              window.location.reload();
            }}>{t('error.reload')}</button
          >
        </section>
      {/snippet}
    </svelte:boundary>
    <!-- The context menu belongs to the content it was opened on: inside the main landmark. -->
    <!-- The marked rows of the list are the selection: a right click on one of them works on all of them. -->
    {#if app.phase === 'ready'}<ContextMenu registry={contextRegistry} label={t('ctx.label')} selection={markedTargets} />{/if}
  </main>
  {#if app.phase === 'ready'}
    <Capture {app} />
    <Lazy {app} when={app.planning} load={() => import('./views/PlanWizard.svelte')} onfailed={() => app.closePlanWizard()} />
    <Lazy {app} when={app.meetingDraft !== null} load={() => import('./views/MeetingForm.svelte')} onfailed={() => app.closeMeetingForm()} />
    <Lazy {app} when={app.meetingOpen !== null} load={() => import('./views/MeetingPage.svelte')} onfailed={() => app.closeMeeting()} />
    <DoneDialog {app} />
    <PrioDialog {app} />
    <Lazy {app} when={app.matrix !== null} load={() => import('./views/Matrix.svelte')} onfailed={() => app.closeMatrix()} />
    <TaskDialog {app} />
    <FinishedDialog {app} />
    <Lazy {app} when={app.checking} load={() => import('./views/CheckDialog.svelte')} onfailed={() => app.closeChecks()} />
    <BlockDialog {app} />
    <DropMoveDialog {app} />
    <Palette {app} />
    <DocsDialog
      float={floating}
      floatParams={{ kind: 'docs', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
      open={docsOpen}
      docs={docTexts}
      docId={docsAt}
      onclose={() => (docsOpen = false)}
      labels={{
        title: t('kit.docs.title'),
        label: t('kit.docs.label'),
        placeholder: t('kit.docs.placeholder'),
        none: t('kit.docs.none'),
        list: t('kit.docs.list'),
        close: t('kit.dismiss'),
      }}
    />
    <Lazy {app} when={app.conflictsOpen} load={() => import('./views/ConflictCenter.svelte')} onfailed={() => app.closeConflicts()} />
    <Lazy {app} when={app.managingVaults} load={() => import('./views/VaultsDialog.svelte')} onfailed={() => app.closeVaults()} />
    <Lazy {app} when={app.agentFor !== null} load={() => import('./views/AgentDialog.svelte')} onfailed={() => app.closeAgent()} />
    <Lazy {app} when={app.splitFor !== null} load={() => import('./views/SplitDialog.svelte')} onfailed={() => app.closeSplit()} />
    <Lazy {app} when={app.answer !== null} load={() => import('./views/AnswerDialog.svelte')} onfailed={() => app.closeAnswer()} />
    <Lazy {app} when={app.tagging !== null} load={() => import('./views/TagDialog.svelte')} onfailed={() => app.closeTagging()} />
  {/if}
  <!-- Outside the ready block: the Info dialog and its report are there when the engine is not (app.canAbout). -->
  <Lazy {app} when={app.about.state !== 'closed'} load={() => import('./views/AboutDialog.svelte')} onfailed={() => app.closeAbout()} />
  <!-- A chunk that did not come takes the dialog's state back: the entry of the menu then loads it again. -->
  <Lazy
    {app}
    when={fromDisk && shortcutOpen}
    load={() => import('./views/ShortcutDialog.svelte')}
    extra={{ open: shortcutOpen, onclose: () => (shortcutOpen = false) }}
    onfailed={() => (shortcutOpen = false)}
  />
  <Lazy
    {app}
    when={installOpen}
    load={() => import('./views/InstallDialog.svelte')}
    extra={{ open: installOpen, onclose: () => (installOpen = false) }}
    onfailed={() => (installOpen = false)}
  />
  <Lazy
    {app}
    when={app.intentOpen}
    load={() => import('./views/IntentDialog.svelte')}
    extra={{ open: app.intentOpen, onclose: () => app.closeIntent() }}
    onfailed={() => app.closeIntent()}
  />
  <Lazy
    {app}
    when={defaultsOpen}
    load={() => import('./views/DefaultsDialog.svelte')}
    extra={{ open: defaultsOpen, onclose: () => (defaultsOpen = false) }}
    onfailed={() => (defaultsOpen = false)}
  />
  <Lazy
    {app}
    when={fromDisk && updateOpen}
    load={() => import('./views/UpdateDialog.svelte')}
    extra={{ open: updateOpen, onclose: () => (updateOpen = false) }}
    onfailed={() => (updateOpen = false)}
  />
  <!-- While the float of a task is open the toast is drawn inside it: the float is modal, and the Undo out here could not
       be reached. -->
  {#if !app.taskFloatOpen}<Toast {app} />{/if}
</div>

<style>
  .brand-mark {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .conn {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .conn-live {
    color: var(--ok);
  }
  .conn-offline {
    color: var(--bad);
  }
  .conn-full {
    color: var(--warn);
  }
  /* Positioned, so what is absolute in a view without a box of its own (the hidden labels, .sr-only) scrolls and is
     clipped with it: else it hangs on the page, and a long view (the finished tasks) makes the window scroll too. */
  main {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
  }
  .note,
  .muted {
    color: var(--muted);
  }
  .solo {
    max-width: 60rem;
    margin: 0 auto;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
  }
  .centered {
    max-width: 38rem;
    margin: 3rem auto;
  }
  .banner {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.75rem;
    margin: 0 0 1rem;
    color: var(--warn);
  }
  pre {
    background: var(--surface-2);
    border-radius: var(--radius);
    padding: 0.6rem 0.8rem;
    overflow: auto;
  }

  /* The page for the printer of a view (exportDom.printSheet) stands in the document only while the print dialog is
     open; while it does, nothing else is printed. Black on white whatever the theme: it is paper or a PDF. */
  :global(#view-print) {
    display: none;
  }
  @media print {
    :global(html.print-view body > *:not(#view-print)) {
      display: none !important;
    }
    /* With "background graphics" in the dialog a dark theme would print its page colour around the sheet. */
    :global(html.print-view),
    :global(html.print-view body) {
      background: white !important;
    }
    :global(html.print-view #view-print) {
      display: block;
      color: black;
      background: white;
      font-size: 10pt;
    }
    :global(#view-print h1) {
      font-size: 14pt;
      margin: 0 0 0.3em;
    }
    :global(#view-print h2) {
      font-size: 11pt;
      margin: 1em 0 0.3em;
      break-after: avoid;
    }
    :global(#view-print p) {
      margin: 0;
    }
    :global(#view-print table) {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0.5em;
    }
    :global(#view-print th),
    :global(#view-print td) {
      border: 1px solid gray;
      padding: 0.15em 0.4em;
      text-align: left;
      vertical-align: top;
      /* A long id or a title without spaces breaks in the cell instead of widening the table past the page. */
      overflow-wrap: anywhere;
    }
    :global(#view-print tr) {
      break-inside: avoid;
    }
  }
</style>
