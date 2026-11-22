<script lang="ts">
  // The learning paths (concept "Lernplan" 11.3): the open paths of the vault with their progress, and one path as a
  // tree of learning points. A click on the mark of a point ticks it as learned (or sets it open again); seen, does not
  // apply and blocked are chosen from the point's menu and ask for a reason first. A point has a note, a link that opens
  // in a new tab without a referrer, and can be promoted to a task of its own, which then owns its state. Every figure
  // and every rule is the engine's (`tasks.paths`, `tasks.path`, `node_set`, `promote`; WEB-13): the page shows the
  // list the engine wrote and sends what the person chose, nothing else (lib/paths.ts).
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import type { PathDocument, PathEntry, PathNode, PathProgress, Result } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import { hostOf } from 'appkit-ui/markdown';
  import ChoiceMenu, { type Choice } from './ChoiceMenu.svelte';
  import AssetImg from './AssetImg.svelte';
  import ImageViewer from './ImageViewer.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import Lazy from './Lazy.svelte';
  import { AssetImages } from '../lib/assetImages.svelte';
  import { shownIcon } from '../lib/icons';
  import { markHidden } from '../lib/text';
  import { pathSafetyText, type PathSafetyKey } from '../lib/pathSafetyTexts';
  import {
    clickedState,
    cleanNote,
    cleanReason,
    closesSafety,
    indicesOf,
    isMarkable,
    labelText,
    MENU_STATES,
    needsReason,
    noteOp,
    openableLink,
    parentIndices,
    pointIds,
    pointRef,
    parseXp,
    progressParts,
    promoteOp,
    REASON_MAX,
    rewardOp,
    stateOp,
    taskXpOp,
    visiblePoints,
    xpOp,
    xpPercent,
    type PointState,
  } from '../lib/paths';

  type EditKind = 'reason' | 'note' | 'xp' | 'task_xp';
  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  // The words of the safety question come with the chunk of the view (lib/pathSafetyTexts.ts).
  const ts = (key: PathSafetyKey, params: Record<string, string | number> = {}) => pathSafetyText(app.lang, key, params);

  const MARKS: Record<PathNode['derived'], string> = { open: ' ', learned: '✓', seen: '~', dropped: '–', blocked: '!', partial: '◐' };

  // The list of the paths: read when the view opens and after every write (a write may promote, finish or tick).
  let list = $state<PathEntry[] | null>(null);
  let listProblem = $state(false);
  // The open path: its document as the engine wrote it, read again after every write.
  let doc = $state<PathDocument | null>(null);
  let docProblem = $state(false);
  let reading = $state(false);
  // Said under the tree when the engine refused a change because the file moved on (it was read again then).
  let conflict = $state(false);
  // The folded points of the open path, by their name (`pointIds`: a point added above does not move the fold to
  // another point); a new path starts unfolded.
  let folded = $state<ReadonlySet<string>>(new Set());
  // The point whose reason or note is being written (by its name, so that a read after a change elsewhere keeps the
  // field and what is typed), with what is typed.
  let editing = $state<{ id: string; kind: EditKind; state?: PointState; missing: boolean } | null>(null);
  // The form of the levels of the open path (loaded when first opened; PathLevels.svelte).
  let editingLevels = $state(false);
  // What is typed into the open field (apart from `editing`, so that closing the field never leaves a binding on nothing).
  let draft = $state('');
  let root: HTMLElement | undefined = $state();

  const usable = $derived(app.can('paths') && app.can('path'));
  const writesNotes = $derived(app.can('node_note'));
  // XP, levels and rewards: an engine that counts them (capability `xp`), and the person did not turn them off.
  const game = $derived(app.gamification && app.can('xp'));
  const chosen = $derived(app.pathChoice);
  const ids = $derived(doc ? pointIds(doc.nodes) : new Map<number, string>());
  const foldedIndices = $derived(indicesOf(ids, folded));
  const shown = $derived(doc && doc.path.id === chosen ? visiblePoints(doc.nodes, foldedIndices) : []);
  // A change is sent only on the tree as it is now: not while a write is on its way, and not while the path is read
  // again (after a write the tree on screen still has the version and the states from before it; sent on that, the
  // next tick would be refused as a conflict, or set a state the point already has).
  const busy = $derived(app.saving || reading);
  const idOf = (node: PathNode): string => ids.get(node.index) ?? `#${node.index}`;
  const editingOf = (node: PathNode, kind: EditKind): boolean => editing?.kind === kind && editing.id === idOf(node);
  /** A leaf whose XP are its own to set here (a point whose task carries `xp:` takes the task's). */
  const ownsXp = (node: PathNode): boolean => node.children === 0 && node.xp_from !== 'task';
  // The images below `assets/` of the open path (its points, its cover, its badges): one store per path in its folder
  // form, given back when another path is opened or the view goes.
  const assetOwner = $derived(doc && doc.path.id === chosen && doc.path.folder ? doc.path.id : null);
  let images = $state<AssetImages | null>(null);
  $effect(() => {
    const id = assetOwner;
    if (id === null) {
      images = null;
      return;
    }
    const store = new AssetImages((kind, owner, file, held) => app.asset(kind, owner, file, held), 'path', id, { recheckOnFront: true });
    images = store;
    return () => store.dispose();
  });
  // The path read again: an image that was missing, or one put into its folder since, is read again.
  $effect(() => {
    const store = images;
    const etag = doc?.path.etag;
    const assets = doc?.path.assets;
    untrack(() => store?.refresh(etag, assets));
  });
  // An image of the path, larger (a click on it).
  let viewing = $state<{ url: string; alt: string } | null>(null);
  const view = (url: string, alt: string) => (viewing = { url, alt });
  // The badges of the levels that have one, in file order: the gallery, the reached ones apart from the others.
  const badges = $derived((doc?.levels ?? []).filter((level) => level.badge?.startsWith('assets/badges/')));
  /** The text of a label as shown: the link's text, with the characters that hide or reorder text made visible. */
  const shownLabel = (node: PathNode): string => markHidden(labelText(node));

  // Each question has a number: an answer that comes after another was asked is dropped.
  let askedList = 0;
  let askedPath = 0;
  async function readList(): Promise<void> {
    const mine = ++askedList;
    try {
      const answer = await app.paths();
      if (mine !== askedList) return;
      list = answer.items;
      app.rememberPaths(answer.items);
      listProblem = false;
      // Nothing chosen yet (or the chosen one is gone): the first path, so the view never stands empty beside a list.
      if (answer.items.length > 0 && !answer.items.some((p) => p.id === app.pathChoice)) app.pathChoice = answer.items[0]!.id;
    } catch {
      if (mine !== askedList) return;
      listProblem = true;
    }
  }
  async function readPath(id: string): Promise<void> {
    const mine = ++askedPath;
    reading = true;
    try {
      const answer = await app.path(id);
      if (mine !== askedPath) return;
      if (doc?.path.id !== answer.path.id) {
        folded = new Set();
        editing = null;
        editingLevels = false;
      }
      doc = answer;
      docProblem = false;
      keepEditing(answer);
      sayLevel(answer);
    } catch {
      if (mine !== askedPath) return;
      doc = null;
      docProblem = true;
    } finally {
      if (mine === askedPath) reading = false;
    }
  }

  // Read when the view opens, after every write (app.writes) and when the hub tells of a change (the snapshot's rev).
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!usable) return;
    untrack(() => void readList());
  });
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    const id = chosen;
    if (!usable || id === '') return;
    untrack(() => void readPath(id));
  });

  /**
   * The open field after the path was read again: it stays with what is typed while its point is there and can still
   * take it; a point that went (or was promoted, or no longer has a mark of its own) closes it, and that is said.
   */
  function keepEditing(read: PathDocument): void {
    if (!editing) return;
    const id = editing.id;
    const names = pointIds(read.nodes);
    const node = read.nodes.find((n) => names.get(n.index) === id);
    const fits =
      node !== undefined &&
      (editing.kind === 'reason'
        ? isMarkable(node)
        : editing.kind === 'xp'
          ? ownsXp(node)
          : editing.kind === 'task_xp'
            ? node.promoted !== undefined && promotedTask(node.promoted) !== undefined
            : node.promoted === undefined);
    if (fits) return;
    editing = null;
    app.tell('error', 'paths.conflict');
  }

  /**
   * The point another view asked to be shown (`app.pathPoint`, "Open in the path"): its parents are unfolded, it is
   * scrolled to and takes the focus; then it is forgotten. A point the path no longer has is forgotten all the same.
   */
  function showAskedPoint(read: PathDocument): void {
    const asked = app.pathPoint;
    if (asked === null || read.path.id !== app.pathChoice) return;
    app.pathPoint = null;
    const node = read.nodes.find((n) => pointRef(n) === asked);
    if (!node) return;
    const names = pointIds(read.nodes);
    const open = new Set(folded);
    for (let at = node.parent; at !== undefined; at = read.nodes.find((n) => n.index === at)?.parent) {
      const name = names.get(at);
      if (name !== undefined) open.delete(name);
    }
    folded = open;
    void tick().then(() => {
      root?.querySelector<HTMLElement>(`li[data-index="${node.index}"]`)?.scrollIntoView({ block: 'center' });
      void focusPoint(node);
    });
  }

  // A point asked for while its path is shown, or once it is read.
  $effect(() => {
    const read = doc;
    if (app.pathPoint === null || read === null) return;
    untrack(() => showAskedPoint(read));
  });

  /** Whether a change must wait (a write on its way, or the path being read again): then it is said, not sent. */
  function refused(): boolean {
    if (!busy) return false;
    app.tell('error', app.saving ? 'write.busy' : 'paths.busy_reading');
    return true;
  }

  /** The focus goes back to the point's menu (or its mark) when its field closes: never to the page. */
  async function focusPoint(node: PathNode): Promise<void> {
    await tick();
    const item = root?.querySelector<HTMLElement>(`li[data-index="${node.index}"]`);
    (item?.querySelector<HTMLElement>('[data-choice="point"] summary') ?? item?.querySelector<HTMLElement>('button.mark'))?.focus();
  }
  function closeField(node: PathNode): void {
    editing = null;
    void focusPoint(node);
  }

  function choose(id: string): void {
    if (id === app.pathChoice) return;
    conflict = false;
    editing = null;
    editingLevels = false;
    confirming = null;
    app.pathChoice = id;
  }

  /**
   * Send one operation; a refusal because the file moved on is said here. The path is read again either way: every
   * write counts `app.writes` up, which the effect above reads.
   */
  async function send(op: Parameters<App['write']>[0][number]): Promise<Result | null> {
    conflict = false;
    return app.write([op], {
      onAnswer: (answer) => {
        const failed = answer.results.find((r) => !r.ok);
        if (failed?.error?.code === 'conflict') {
          conflict = true;
          return true;
        }
        return false;
      },
    });
  }

  // The point under `{safety}` whose closing waits for the person's yes (by its name), with what will be sent.
  let confirming = $state<{ id: string; state: PointState; reason?: string } | null>(null);
  function setState(node: PathNode, state: PointState, reason?: string): void {
    if (!doc) return;
    if (closesSafety(node, state)) {
      confirming = { id: idOf(node), state, ...(reason !== undefined ? { reason } : {}) };
      void focusField(`safety-no-${node.index}`);
      return;
    }
    void send(stateOp(doc.path.id, doc.path.etag, node, state, reason));
  }
  function confirmSafety(node: PathNode): void {
    if (!doc || !confirming || confirming.id !== idOf(node) || refused()) return;
    const { state, reason } = confirming;
    confirming = null;
    void focusPoint(node);
    void send(stateOp(doc.path.id, doc.path.etag, node, state, reason, true));
  }
  function cancelSafety(node: PathNode): void {
    confirming = null;
    void focusPoint(node);
  }
  function clickMark(node: PathNode): void {
    // The mark is never `disabled` (a disabled button drops the focus to the page): a click while busy is refused here.
    if (!node.state || refused()) return;
    setState(node, clickedState(node.state));
  }
  function pick(node: PathNode, state: PointState): void {
    if (!needsReason(state)) {
      if (!refused()) setState(node, state);
      return;
    }
    draft = '';
    editing = { id: idOf(node), kind: 'reason', state, missing: false };
    void focusField(`reason-${node.index}`);
  }
  /** The field that just opened takes the focus (the menu gave it back to its own button before it ran the choice). */
  async function focusField(id: string): Promise<void> {
    await tick();
    document.getElementById(id)?.focus();
  }
  function saveReason(node: PathNode): void {
    if (!editing || editing.kind !== 'reason' || !editing.state) return;
    const reason = cleanReason(draft);
    if (reason === null) {
      editing = { ...editing, missing: true };
      return;
    }
    // Refused while busy: the field stays open with what is typed.
    if (refused()) return;
    const state = editing.state;
    closeField(node);
    setState(node, state, reason);
  }
  function editNote(node: PathNode): void {
    draft = node.note ?? '';
    editing = { id: idOf(node), kind: 'note', missing: false };
    void focusField(`note-${node.index}`);
  }
  function saveNote(node: PathNode): void {
    if (!doc || !editing || editing.kind !== 'note') return;
    const note = cleanNote(draft);
    if (note === (node.note ?? '')) {
      closeField(node);
      return;
    }
    if (refused()) return;
    closeField(node);
    void send(noteOp(doc.path.id, doc.path.etag, node, note));
  }
  function editXp(node: PathNode): void {
    const own = node.xp_from === 'point' ? node.xp : undefined;
    draft = String(own ?? node.xp_suggest ?? '');
    editing = { id: idOf(node), kind: 'xp', missing: false };
    void focusField(`xp-${node.index}`);
  }
  function saveXp(node: PathNode): void {
    if (!doc || !editing || editing.kind !== 'xp') return;
    const xp = parseXp(draft);
    if (xp === null) {
      editing = { ...editing, missing: true };
      return;
    }
    const own = node.xp_from === 'point' ? node.xp : undefined;
    // nothing changes: the field closes without a write
    if ((xp === 'clear' && own === undefined) || xp === own) {
      closeField(node);
      return;
    }
    if (refused()) return;
    closeField(node);
    void send(xpOp(doc.path.id, doc.path.etag, node, xp));
  }
  function editTaskXp(node: PathNode): void {
    draft = String(node.xp ?? '');
    editing = { id: idOf(node), kind: 'task_xp', missing: false };
    void focusField(`task-xp-${node.index}`);
  }
  /** The XP of the task a point was promoted to: `xp:` of the task (`set`), which the point then counts. */
  function saveTaskXp(node: PathNode): void {
    if (!editing || editing.kind !== 'task_xp' || node.promoted === undefined) return;
    const xp = parseXp(draft);
    if (xp === null) {
      editing = { ...editing, missing: true };
      return;
    }
    const task = promotedTask(node.promoted);
    if (!task) {
      closeField(node);
      app.tell('error', 'paths.conflict');
      return;
    }
    if ((xp === 'clear' && task.xp === undefined) || xp === task.xp) {
      closeField(node);
      return;
    }
    if (refused()) return;
    closeField(node);
    void send(taskXpOp(task.id, task.etag, xp));
  }
  /** The form of the levels closes (Save, Cancel): the focus goes back to the button that opened it, never to the page. */
  async function closeLevels(): Promise<void> {
    editingLevels = false;
    await tick();
    root?.querySelector<HTMLElement>('[data-levels-open]')?.focus();
  }
  /** The levels as the form holds them: true when the engine wrote them (the form closes then). */
  async function sendLevels(op: Parameters<App['write']>[0][number]): Promise<boolean> {
    const result = await send(op);
    return result !== null && result.results.every((r) => r.ok);
  }
  function grant(ref: string): void {
    if (!doc || refused()) return;
    void send(rewardOp(doc.path.id, doc.path.etag, ref, true));
  }
  /**
   * A level reached since the path was looked at last is said once, in one line, with its reward when it has one that
   * is not granted yet. The first look only notes the level; with the switch off the level is noted, not said.
   */
  function sayLevel(read: PathDocument): void {
    const state = read.path.level;
    if (!state) return;
    if (!app.levelNews(read.path.id, state.level) || !app.gamification || state.level <= 0) return;
    const title = markHidden(read.path.title);
    const reward = read.levels?.find((l) => l.ref === String(state.level) && l.reward && !l.given)?.reward;
    if (reward) app.tell('ok', 'paths.level.news_reward', { n: state.level, title, reward: markHidden(reward) });
    else app.tell('ok', 'paths.level.news', { n: state.level, title });
  }
  function levelText(state: NonNullable<PathEntry['level']>): string {
    const head =
      state.level > 0
        ? state.name
          ? t('paths.level_named', { n: state.level, name: markHidden(state.name) })
          : t('paths.level', { n: state.level })
        : t('paths.level.none');
    const next = state.next;
    if (!next) return head;
    if (next.missing_xp !== undefined) return `${head} · ${t('paths.level.next_xp', { n: next.missing_xp, level: next.number })}`;
    if (next.missing_percent !== undefined) return `${head} · ${t('paths.level.next_percent', { n: next.missing_percent, level: next.number })}`;
    return head;
  }
  async function promote(node: PathNode): Promise<void> {
    if (!doc || refused()) return;
    const result = await send(promoteOp(doc.path.id, doc.path.etag, node));
    const made = result?.results[0];
    // The task is in the list now (the write read it again): open it.
    if (made?.ok && typeof made.id === 'string') app.reveal(made.id);
  }

  function choicesOf(node: PathNode): Choice[] {
    const out: Choice[] = [];
    if (isMarkable(node)) {
      if (node.state !== 'open') out.push({ id: 'open', label: t('paths.menu.open'), onselect: () => pick(node, 'open') });
      for (const state of MENU_STATES) {
        if (state === node.state && !needsReason(state)) continue;
        out.push({ id: state, label: t(`paths.menu.${state}` as Key), onselect: () => pick(node, state) });
      }
    }
    if (node.promoted === undefined) {
      const reason = writesNotes ? undefined : t('paths.note.read_only');
      out.push({
        id: 'note',
        label: t(node.note ? 'paths.note.edit' : 'paths.note.add'),
        ...(reason ? { reason } : {}),
        onselect: () => editNote(node),
      });
      out.push({ id: 'promote', label: t('paths.promote_of', { label: shownLabel(node) }), onselect: () => void promote(node) });
    }
    if (game && ownsXp(node)) out.push({ id: 'xp', label: t('paths.menu.xp'), onselect: () => editXp(node) });
    if (game && node.promoted !== undefined && promotedTask(node.promoted))
      out.push({ id: 'task_xp', label: t('paths.menu.task_xp'), onselect: () => editTaskXp(node) });
    return out;
  }

  function stateWord(state: PathNode['derived']): string {
    return t(`paths.state.${state}` as Key);
  }
  function progressText(progress: PathProgress): string {
    const text = t('paths.progress', { learned: progress.learned, seen: progress.seen, dropped: progress.dropped, open: progress.open });
    return progress.blocked > 0 ? `${text} (${t('paths.blocked', { n: progress.blocked })})` : text;
  }
  /** The task a promoted point names, as the list of open tasks has it (absent: finished, or not in this vault). */
  function promotedTask(id: string) {
    return app.tasks.find((task) => task.id === id);
  }
  function toggleFold(node: PathNode): void {
    const id = idOf(node);
    const next = new Set(folded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    folded = next;
  }
</script>

<section class="paths" aria-label={t('nav.paths')} bind:this={root}>
  <header class="intro">
    <div class="head">
      <h2>{t('paths.title')}</h2>
      <Info hint={t('paths.intro')} label={t('hint.about', { what: t('nav.paths') })} />
    </div>
  </header>

  {#if !usable}
    <p class="none">{t('paths.no_engine')}</p>
  {:else if listProblem && list === null}
    <p class="none" role="alert">{t('paths.failed')} <button type="button" onclick={() => void readList()}>{t('paths.retry')}</button></p>
  {:else if list === null}
    <p class="none" role="status">{t('paths.loading')}</p>
  {:else if list.length === 0}
    <p class="none">{t('paths.none')}</p>
  {:else}
    <div class="split">
      <nav class="list" aria-label={t('paths.list')}>
        <ul>
          {#each list as entry (entry.id)}
            <li>
              <button
                type="button"
                class="pick"
                class:chosen={entry.id === chosen}
                aria-current={entry.id === chosen ? 'true' : undefined}
                data-path={entry.id}
                onclick={() => choose(entry.id)}
              >
                <span class="name"
                  ><ItemIcon {app} shown={shownIcon({ kind: 'path', id: entry.id, icon: entry.icon })} />{markHidden(entry.title)}</span
                >
                <span class="sub"
                  >{markHidden(entry.area)} · {progressText(entry.progress)}{#if game && entry.xp}{` · ${t('paths.xp', {
                      earned: entry.xp.earned,
                      possible: entry.xp.possible,
                    })}`}{/if}{#if game && entry.level && entry.level.level > 0}{` · ${t('paths.level', { n: entry.level.level })}`}{/if}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      </nav>

      <div class="path">
        {#if docProblem && !doc}
          <p class="none" role="alert">{t('paths.path_failed')} <button type="button" onclick={() => void readPath(chosen)}>{t('paths.retry')}</button></p>
        {:else if !doc || doc.path.id !== chosen}
          <p class="none" role="status">{chosen === '' ? t('paths.choose') : t('paths.reading')}</p>
        {:else}
          {@const progress = doc.progress}
          {@const title = markHidden(doc.path.title)}
          <h3>{title}</h3>
          {#if doc.path.cover && images}
            <div class="cover">
              <AssetImg {images} file={doc.path.cover} alt={t('image.cover_of', { title: doc.path.title })} missing={t('image.missing')} onopen={view} />
            </div>
          {/if}
          {#if doc.path.summary}<p class="summary">{markHidden(doc.path.summary)}</p>{/if}
          <div class="progress" role="img" aria-label={t('paths.progress_of', { title }) + ': ' + progressText(progress)} data-progress>
            {#each progressParts(progress) as part (part.kind)}
              <span class="part {part.kind}" style:flex-grow={part.n} data-part={part.kind}></span>
            {/each}
          </div>
          <p class="figures" aria-hidden="true">{progressText(progress)}</p>
          {#if game && doc.xp}
            {@const xp = doc.xp}
            <div class="xp" role="img" aria-label={t('paths.xp_of', { title, earned: xp.earned, possible: xp.possible })} data-xp>
              <span class="fill" style:width="{xpPercent(xp)}%"></span>
            </div>
            <p class="figures" aria-hidden="true">
              {t('paths.xp', { earned: xp.earned, possible: xp.possible })}{#if xp.missing > 0}{` · ${t('paths.xp.missing', { n: xp.missing })}`}{/if}
            </p>
          {/if}
          {#if game && doc.path.level}
            <p class="level" data-level={doc.path.level.level}
              >{#if doc.path.level.badge?.startsWith('assets/badges/') && images}<AssetImg
                  {images}
                  file={doc.path.level.badge}
                  alt={t('paths.badge_of', { n: doc.path.level.level })}
                  size={32}
                  cls="badge"
                />{/if}{levelText(doc.path.level)}</p
            >
            {#if badges.length > 0 && images}
              <ul class="badges" aria-label={t('paths.badges')} data-badges>
                {#each badges as level (level.ref)}
                  <li class:reached={level.reached} data-badge={level.ref}>
                    <AssetImg
                      {images}
                      file={level.badge ?? ''}
                      alt={t('paths.badge_of', { n: level.number ?? 0 })}
                      missing={t('image.missing')}
                      size={48}
                      onopen={view}
                    />
                  </li>
                {/each}
              </ul>
            {/if}
            {#each doc.path.level.open_rewards as reward (reward.ref)}
              {@const text = markHidden(reward.reward)}
              <p class="reward" data-reward={reward.ref}>
                <span>{t('paths.reward.open', { reward: text })}</span>
                <button type="button" aria-label={t('paths.reward.grant_of', { reward: text })} aria-disabled={busy ? 'true' : undefined} onclick={() => grant(reward.ref)}
                  >{t('paths.reward.grant')}</button
                >
              </p>
            {/each}
          {/if}
          {#if game && app.can('path_levels')}
            {#if editingLevels}
              <section class="levels-edit" aria-label={t('paths.levels.form')}>
                <h4>{t('paths.levels.title')}</h4>
                <Lazy
                  {app}
                  load={() => import('./PathLevels.svelte')}
                  extra={{ doc, busy, send: sendLevels, onclose: () => void closeLevels() }}
                  onfailed={() => (editingLevels = false)}
                />
              </section>
            {:else}
              <p class="levels-open">
                <button type="button" data-levels-open onclick={() => (editingLevels = true)}
                  >{t(doc.levels && doc.levels.length > 0 ? 'paths.levels.edit' : 'paths.levels.add_first')}</button
                >
              </p>
            {/if}
          {/if}
          {#if doc.tree_problems.length > 0}
            <p class="problems" role="note">{t('paths.problems', { n: doc.tree_problems.length })}</p>
          {/if}
          {#if conflict}
            <p class="conflict" role="alert">{t('paths.conflict')}</p>
          {/if}

          <div class="tools">
            <button type="button" onclick={() => (folded = new Set(parentIndices(doc!.nodes).map((i) => ids.get(i) ?? `#${i}`)))}
              >{t('paths.fold_all')}</button
            >
            <button type="button" onclick={() => (folded = new Set())} disabled={foldedIndices.size === 0}>{t('paths.unfold_all')}</button>
            {#if busy}<span class="busy" role="status">{app.saving ? t('paths.saving') : t('paths.reading')}</span>{/if}
          </div>

          <ul class="tree" aria-label={t('paths.tree', { title })}>
            {#each shown as node (node.index)}
              {@const label = shownLabel(node)}
              {@const link = openableLink(node.link)}
              {@const host = link ? hostOf(link) : null}
              {@const parent = node.children > 0}
              {@const isFolded = foldedIndices.has(node.index)}
              <li
                class="point"
                style:--depth={node.depth}
                data-point={node.key ?? `#${node.index}`}
                data-index={node.index}
                data-state={node.derived}
              >
                <div class="row">
                  {#if parent}
                    <button
                      type="button"
                      class="fold"
                      aria-expanded={!isFolded}
                      aria-label={t(isFolded ? 'paths.unfold' : 'paths.fold', { label })}
                      onclick={() => toggleFold(node)}><span aria-hidden="true">{isFolded ? '▸' : '▾'}</span></button
                    >
                  {:else}
                    <span class="fold-space" aria-hidden="true"></span>
                  {/if}

                  {#if isMarkable(node) && node.state}
                    <button
                      type="button"
                      class="mark {node.derived}"
                      aria-label={t('paths.mark', {
                        label,
                        state: stateWord(node.derived),
                        next: t(clickedState(node.state) === 'learned' ? 'paths.next.learned' : 'paths.next.open'),
                      })}
                      aria-disabled={busy ? 'true' : undefined}
                      onclick={() => clickMark(node)}><span aria-hidden="true">{MARKS[node.derived]}</span></button
                    >
                  {:else}
                    <!-- A parent has no mark of its own, a promoted point is the task's: the state is shown, not set. -->
                    <span class="mark shown {node.derived}" class:parent title={stateWord(node.derived)}>
                      <span aria-hidden="true">{MARKS[node.derived]}</span><span class="sr-only">{stateWord(node.derived)}</span>
                    </span>
                  {/if}

                  <span class="label">
                    {#if link}
                      <a href={link} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label={t('paths.link_of', { label })}>{label}</a
                      >{#if host}<span class="host">{` (${markHidden(host)})`}</span>{/if}
                    {:else}
                      {label}
                    {/if}
                    {#if parent}<span class="count">{progressText(node.progress)}</span>{/if}
                  </span>
                  {#if node.safety && !parent}
                    <span class="safety-point"><span aria-hidden="true">⚠</span> {ts('paths.safety.badge')}</span>
                  {/if}
                  {#if game && !parent && node.xp !== undefined}
                    <span class="xp-point" data-xp={node.xp}>{t(node.xp_from === 'task' ? 'paths.xp.from_task' : 'paths.xp.point', { n: node.xp })}</span>
                  {/if}

                  {#if node.promoted}
                    {@const task = promotedTask(node.promoted)}
                    <span class="promoted">
                      {#if task}
                        <button type="button" class="link" aria-label={t('paths.promoted.open', { id: node.promoted })} onclick={() => app.reveal(node.promoted!)}
                          >{t('paths.promoted', { id: node.promoted })}</button
                        >
                        <span class="status">{t(`status.${task.status}` as Key)}</span>
                      {:else}
                        <span>{t('paths.promoted', { id: node.promoted })}</span>
                        <span class="status">{node.closed ? `${t('paths.promoted.finished')} · ${stateWord(node.derived)}` : stateWord(node.derived)}</span>
                      {/if}
                    </span>
                  {/if}

                  {#if choicesOf(node).length > 0}
                    <ChoiceMenu
                      label={t('paths.more', { label })}
                      short={t('paths.menu')}
                      choices={choicesOf(node)}
                      disabled={busy}
                      name="point"
                      onblocked={(choice) => {
                        if (choice.reason) app.tell('error', 'paths.note.read_only');
                      }}
                    />
                  {/if}
                </div>

                {#if node.image && images}
                  <div class="point-image">
                    <AssetImg {images} file={node.image} alt={labelText(node)} missing={t('image.missing')} onopen={view} />
                  </div>
                {/if}
                {#if node.reason}
                  <p class="reason">{t(node.state === 'blocked' ? 'paths.key' : 'paths.reason', { reason: markHidden(node.reason) })}</p>
                {/if}
                {#if node.note && !editingOf(node, 'note')}
                  <p class="note" aria-label={t('paths.note_of', { label })}>{markHidden(node.note)}</p>
                {/if}

                {#if confirming && confirming.id === idOf(node)}
                  {@const closing = confirming.state === 'seen' ? 'seen' : 'learned'}
                  <div class="edit safety-ask" role="group" aria-labelledby="safety-ask-{node.index}">
                    <p id="safety-ask-{node.index}">
                      <span aria-hidden="true">⚠</span>
                      {ts('paths.safety.ask', { label, state: ts(`paths.safety.state.${closing}`) })}
                    </p>
                    <span class="buttons">
                      <button type="button" class="primary" aria-disabled={busy ? 'true' : undefined} onclick={() => confirmSafety(node)}
                        >{ts('paths.safety.yes')}</button
                      >
                      <button
                        type="button"
                        id="safety-no-{node.index}"
                        onclick={() => cancelSafety(node)}
                        onkeydown={(e) => {
                          if (e.key === 'Escape') cancelSafety(node);
                        }}>{ts('paths.safety.no')}</button
                      >
                    </span>
                  </div>
                {/if}
                {#if editing && editingOf(node, 'reason') && editing.state}
                  <form
                    class="edit"
                    data-hint={t('hint.form.paths.reason')}
                    onsubmit={(e) => {
                      e.preventDefault();
                      saveReason(node);
                    }}
                  >
                    <label for="reason-{node.index}">{t(`paths.reason.${editing.state}` as Key)}</label>
                    <input
                      id="reason-{node.index}"
                      type="text"
                      aria-required="true"
                      maxlength={REASON_MAX}
                      bind:value={draft}
                      aria-invalid={editing.missing ? 'true' : undefined}
                      aria-describedby={editing.missing ? `reason-missing-${node.index}` : undefined}
                      onkeydown={(e) => {
                        if (e.key === 'Escape') closeField(node);
                      }}
                    />
                    {#if editing.missing}<span id="reason-missing-{node.index}" class="missing" role="alert">{t('paths.reason.required')}</span>{/if}
                    <span class="buttons">
                      <button type="submit" class="primary">{t('paths.reason.save')}</button>
                      <button type="button" onclick={() => closeField(node)}>{t('paths.reason.cancel')}</button>
                    </span>
                  </form>
                {:else if editingOf(node, 'note')}
                  <form
                    class="edit"
                    data-hint={t('hint.form.paths.note')}
                    onsubmit={(e) => {
                      e.preventDefault();
                      saveNote(node);
                    }}
                  >
                    <label for="note-{node.index}">{t('paths.note_of', { label })}</label>
                    <textarea
                      id="note-{node.index}"
                      rows="3"
                      bind:value={draft}
                      onkeydown={(e) => {
                        if (e.key === 'Escape') closeField(node);
                      }}
                    ></textarea>
                    <span class="buttons">
                      <button type="submit" class="primary">{t('paths.note.save')}</button>
                      <button type="button" onclick={() => closeField(node)}>{t('paths.note.cancel')}</button>
                    </span>
                  </form>
                {:else if editing && editingOf(node, 'task_xp')}
                  <form
                    class="edit"
                    data-hint={t('hint.form.paths.task_xp')}
                    onsubmit={(e) => {
                      e.preventDefault();
                      saveTaskXp(node);
                    }}
                  >
                    <label for="task-xp-{node.index}">{t('paths.task_xp.label', { id: node.promoted ?? '' })}</label>
                    <input
                      id="task-xp-{node.index}"
                      type="text"
                      inputmode="numeric"
                      maxlength="6"
                      bind:value={draft}
                      aria-invalid={editing.missing ? 'true' : undefined}
                      aria-describedby={editing.missing ? `task-xp-invalid-${node.index}` : undefined}
                      onkeydown={(e) => {
                        if (e.key === 'Escape') closeField(node);
                      }}
                    />
                    {#if editing.missing}<span id="task-xp-invalid-{node.index}" class="missing" role="alert">{t('paths.xp.invalid')}</span>{/if}
                    <span class="buttons">
                      <button type="submit" class="primary">{t('paths.xp.save')}</button>
                      <button type="button" onclick={() => closeField(node)}>{t('paths.xp.cancel')}</button>
                    </span>
                  </form>
                {:else if editing && editingOf(node, 'xp')}
                  <form
                    class="edit"
                    data-hint={t('hint.form.paths.xp')}
                    onsubmit={(e) => {
                      e.preventDefault();
                      saveXp(node);
                    }}
                  >
                    <label for="xp-{node.index}">{t('paths.xp.label', { label })}</label>
                    <input
                      id="xp-{node.index}"
                      type="text"
                      inputmode="numeric"
                      maxlength="6"
                      bind:value={draft}
                      aria-invalid={editing.missing ? 'true' : undefined}
                      aria-describedby={editing.missing ? `xp-invalid-${node.index}` : undefined}
                      onkeydown={(e) => {
                        if (e.key === 'Escape') closeField(node);
                      }}
                    />
                    {#if editing.missing}<span id="xp-invalid-{node.index}" class="missing" role="alert">{t('paths.xp.invalid')}</span>{/if}
                    <span class="buttons">
                      <button type="submit" class="primary">{t('paths.xp.save')}</button>
                      <button type="button" onclick={() => closeField(node)}>{t('paths.xp.cancel')}</button>
                    </span>
                  </form>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
  <ImageViewer image={viewing} close={() => (viewing = null)} label={{ close: t('image.close'), view: t('image.view') }} />
</section>

<style>
  .paths {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .intro .head,
  .tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  h2,
  h3 {
    margin: 0;
  }
  .cover :global(img) {
    max-height: 10rem;
    border-radius: var(--radius);
  }
  .point-image {
    margin: 0.2rem 0 0.3rem calc(var(--depth, 0) * 1.2rem + 3rem);
  }
  .point-image :global(img) {
    max-height: 16rem;
  }
  .level {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .levels-open,
  .levels-edit h4 {
    margin: 0;
  }
  .levels-edit {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-top: 1px solid var(--border);
    padding-top: 0.4rem;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    list-style: none;
    padding: 0;
    margin: 0.3rem 0;
  }
  .badges li:not(.reached) {
    opacity: 0.4;
    filter: grayscale(1);
  }
  .none,
  .summary,
  .figures,
  .count,
  .sub,
  .status,
  .safety-point {
    color: var(--warn);
    font-weight: 600;
    font-size: 0.9em;
  }
  .busy,
  .host {
    color: var(--muted);
  }
  button:not(.link):not(.pick) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  button:disabled,
  button[aria-disabled='true'] {
    cursor: default;
    opacity: 0.6;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .split {
    display: grid;
    grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 720px) {
    .split {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li + li {
    margin-top: 0.3rem;
  }
  .pick {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    width: 100%;
    text-align: left;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.45rem 0.6rem;
    font: inherit;
    cursor: pointer;
  }
  .pick.chosen {
    border-color: var(--accent);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .pick .name {
    font-weight: 600;
  }
  .pick .sub {
    font-size: 0.85em;
  }
  .path {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .progress {
    display: flex;
    height: 0.7rem;
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .part {
    flex-basis: 0;
  }
  .part.learned {
    background: var(--ok);
  }
  .part.seen {
    background: var(--accent);
  }
  .part.dropped {
    background: var(--muted);
  }
  .part.open {
    background: var(--surface);
  }
  .figures,
  .problems,
  .conflict,
  .summary,
  .level,
  .reward {
    margin: 0;
  }
  .xp {
    height: 0.45rem;
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .xp .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .level {
    font-weight: 600;
  }
  .reward {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .xp-point {
    flex: none;
    color: var(--muted);
    font-size: 0.85em;
  }
  .conflict {
    color: var(--bad);
  }
  .problems {
    color: var(--warn);
  }
  .point {
    padding-left: calc(var(--depth) * 1.4rem);
    border-bottom: 1px solid var(--border);
    padding-block: 0.2rem;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    min-height: 2.2rem;
  }
  .fold,
  .fold-space,
  .mark {
    flex: none;
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-weight: 700;
  }
  button.fold {
    border-color: transparent;
    background: none;
  }
  .mark.shown {
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
  .mark.learned {
    color: var(--ok);
  }
  .mark.blocked {
    color: var(--bad);
  }
  .mark.seen,
  .mark.partial {
    color: var(--accent);
  }
  .mark.dropped {
    color: var(--muted);
  }
  .label {
    flex: 1 1 12rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .point[data-state='dropped'] .label {
    text-decoration: line-through;
  }
  .label a {
    color: var(--accent);
  }
  .count {
    margin-left: 0.4rem;
    font-size: 0.85em;
  }
  .promoted {
    display: inline-flex;
    gap: 0.4rem;
    align-items: baseline;
  }
  .reason,
  .note {
    margin: 0 0 0.2rem calc(4.4rem + 0.8rem);
  }
  .reason {
    color: var(--muted);
    font-size: 0.9em;
  }
  .note {
    white-space: pre-wrap;
    border-left: 3px solid var(--border);
    padding-left: 0.5rem;
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 0.2rem 0 0.4rem calc(4.4rem + 0.8rem);
    max-width: 40rem;
  }
  .edit input,
  .edit textarea {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.4rem;
  }
  .missing {
    color: var(--bad);
  }
  .buttons {
    display: flex;
    gap: 0.4rem;
  }
  @media (pointer: coarse) {
    .fold,
    .fold-space,
    .mark,
    button:not(.link):not(.pick) {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
