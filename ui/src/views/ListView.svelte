<script lang="ts">
  import { taskTarget } from '../lib/context';
  import type { App } from '../lib/app.svelte';
  import type { TaskEntry } from '../lib/contract';
  import { hintOf, labelOf, translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';
  import FinishedList from './FinishedList.svelte';
  import TextHits from './TextHits.svelte';
  import TaskRow from './TaskRow.svelte';
  import FilterBar from './FilterBar.svelte';
  import RowActions from './RowActions.svelte';
  import { areaColour, areaLayout, areaRuns, areaTotals } from '../lib/areaBands';
  import ExportMenu from './ExportMenu.svelte';
  import Info from 'appkit-ui/Info.svelte';
  import { marksLegend } from '../lib/legend';
  import { areaLabel } from '../lib/filter';
  import { columnStyle } from '../lib/columns';
  import ListColumnsHead from './ListColumnsHead.svelte';
  import SizeToggle from './SizeToggle.svelte';
  import { sizeable } from '../lib/sizeable';
  import { tick, untrack } from 'svelte';
  import { badTag, parseTags } from '../lib/fields';
  import { classChange, isApplyKey, marksKeyOf, type MoveCheck } from '../lib/bulk';
  import { REMIND_CHOICES } from '../lib/remind';
  import { parseSort, SORT_GROUPS, sortStamp } from '../lib/sort';

  let { app, searchBox = $bindable(null) }: { app: App; searchBox?: HTMLInputElement | null } =
    $props();

  const t = (key: Key, params: Record<string, string | number> = {}) =>
    translate(app.lang, key, params);

  // The engine names the values (`hello.enums`); a word this version has no text for is shown as it is.
  const statuses = $derived(app.ranges.statuses);

  // A name for the filter and the order shown now: kept in this browser, for the vault that is read.
  let saveListOpen = $state(false);
  let listName = $state('');
  function keepList(): void {
    if (listName.trim() === '') return;
    if (app.saveList(listName) === 'saved') {
      listName = '';
      saveListOpen = false;
    }
  }

  const shown = $derived(app.listed);

  // A mark that the filter hides is not changed behind the person's back: in the list the marks follow what it shows
  // (a mark made in a saved view of a task the filter hides goes here, and the person is told: `keepMarksShown`).
  $effect(() => {
    void shown;
    untrack(() => app.keepMarksShown());
  });


  // The bulk bar changes what is chosen in it, all at once, when the button is pressed (a select alone never writes).
  // `effort` and `remind` are '' (keep), '-' (take away) or a value; the tags are typed.
  const blank = { status: '', prio: '', actor: '', effort: '', remind: '', addTags: '', removeTags: '' };
  let draft = $state({ ...blank });
  $effect(() => {
    if (app.marks.length === 0) draft = { ...blank };
  });
  const chosen = $derived(
    Object.values(draft).some((value) => value.trim() !== ''),
  );
  async function applyDraft(): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (draft.status) patch.status = draft.status;
    if (draft.prio) patch.prio = Number(draft.prio);
    if (draft.actor) patch.actor = draft.actor;
    if (draft.effort) patch.effort = draft.effort === '-' ? null : draft.effort;
    if (draft.remind) patch.remind = draft.remind === '-' ? null : draft.remind;
    const add = parseTags(draft.addTags);
    const remove = parseTags(draft.removeTags);
    const bad = badTag(add);
    // A tag the engine would refuse is told here, and the text stays for the person to change.
    if (bad !== null) {
      app.tell('error', 'field.tags_invalid', { tag: bad });
      return;
    }
    if (Object.keys(patch).length === 0 && add.length === 0 && remove.length === 0) return;
    // What stays marked (a failure) keeps the choice for the second try; with no marks left it starts over.
    await app.bulkSet(patch, add.length > 0 || remove.length > 0 ? { add, remove } : undefined);
  }

  // Moving the marked tasks: an area is chosen, ONE dry run says per task what would happen, and only then the button
  // moves those that can go. The answer belongs to the area and the marks it was asked for: another choice hides it.
  let moveTo = $state('');
  let moveSelect = $state<HTMLSelectElement>();
  let moveResult = $state<{ to: string; marks: string; checks: MoveCheck[] } | null>(null);
  const marksKey = $derived(marksKeyOf(app.marks, app.tasks));
  const moveShown = $derived(
    moveResult !== null && moveResult.to === moveTo && moveResult.marks === marksKey ? moveResult.checks : null,
  );
  const movable = $derived(moveShown?.filter((c) => c.reasons.length === 0 && c.newId !== '').length ?? 0);
  $effect(() => {
    if (app.marks.length === 0) {
      moveTo = '';
      moveResult = null;
    }
  });
  // The data class of an area decides where its tasks may be kept: a move across classes is told, counted per pair.
  const moveClasses = $derived.by(() => {
    if (!moveShown) return [];
    const classOf = (name: string) => app.hubAreas.find((a) => a.name === name)?.data_class;
    const to = classOf(moveTo);
    const counts = new Map<string, number>();
    for (const c of moveShown) {
      if (c.reasons.length > 0) continue;
      const area = app.tasks.find((task) => task.id === c.id)?.area;
      if (area === undefined) continue;
      const change = classChange(classOf(area), to);
      if (change) counts.set(change.from, (counts.get(change.from) ?? 0) + 1);
    }
    return [...counts].map(([from, n]) => ({ from, to: to ?? '?', n }));
  });
  // The dry run takes seconds with many tasks: while it runs the button says it is busy and a click does nothing, so
  // it is asked once (not `disabled`: a disabled button drops the focus the person is working with).
  let checking = $state(false);
  async function checkMoves(): Promise<void> {
    const to = moveTo;
    const key = marksKey;
    if (to === '' || checking) return;
    checking = true;
    try {
      const checks = await app.previewBulkMove(to);
      // The person may have chosen another area or other tasks meanwhile: a late answer is not shown for them.
      if (checks !== null && moveTo === to && marksKey === key) moveResult = { to, marks: key, checks };
    } finally {
      checking = false;
    }
  }
  async function doMoves(): Promise<void> {
    if (!moveShown || movable === 0) return;
    if ((await app.bulkMove(moveTo, moveShown)) > 0) {
      moveTo = '';
      moveResult = null;
      // The button is off now (no area chosen): the focus goes to the choice of the area, not to the page.
      await tick();
      moveSelect?.focus();
    }
  }

  function applyOnEnter(event: KeyboardEvent): void {
    // An Enter that ends the composition of an input method is not the person asking to apply.
    if (!isApplyKey(event) || app.saving || !chosen) return;
    event.preventDefault();
    void applyDraft();
  }

  // The first rows are drawn at once and the rest in the frames after: a
  // list of six hundred rows is not one block of work between the click and
  // the first row (measured: about 150 ms).
  const FIRST = 60;
  const STEP = 200;
  let limit = $state(FIRST);
  const visible = $derived(shown.slice(0, limit));

  // The areas set apart (Options > "Separate areas in lists", lib/areaBands.ts): what the order of the list allows. The
  // heads count the whole list, not only the rows drawn so far.
  const layout = $derived(app.areaSplit ? areaLayout(shown) : 'none');
  const runs = $derived(layout === 'groups' ? areaRuns(visible) : []);
  const totals = $derived(layout === 'groups' ? areaTotals(shown) : new Map<string, number>());
  // Read once for all rows: `allAreaNames` walks every task, and a row that asked for it itself made the list
  // quadratic (two thousand rows, two thousand walks).
  const allNames = $derived(app.allAreaNames);
  const shortArea = (name: string): string => (app.shortAreas ? areaLabel(name, allNames) : name);
  // The areas folded away, for as long as the list is shown. What is folded away is neither selected nor marked: a
  // key or the bulk bar must not change a row nobody sees (as with a row the filter hides). Selecting a task of a
  // folded area (j, k, a link) shows the area again.
  let folded = $state<readonly string[]>([]);
  function toggleFold(area: string): void {
    if (folded.includes(area)) {
      folded = folded.filter((a) => a !== area);
      return;
    }
    const hidden = shown.filter((task) => task.area === area).map((task) => task.id);
    app.unmark(hidden);
    if (app.selectedId !== null && hidden.includes(app.selectedId)) app.select(null);
    folded = [...folded, area];
  }
  $effect(() => {
    const id = app.selectedId;
    untrack(() => {
      const area = shown.find((task) => task.id === id)?.area;
      if (area !== undefined && folded.includes(area)) folded = folded.filter((a) => a !== area);
    });
  });
  $effect(() => {
    if (limit >= shown.length) return;
    const frame = requestAnimationFrame(() => {
      limit = Math.min(shown.length, limit + STEP);
    });
    return () => cancelAnimationFrame(frame);
  });

  // The row that j and k moved to stays in view. The rows come in frames:
  // a selected row that is not drawn yet is scrolled to when it is (the
  // count of the rows that are drawn is read here for that). Only a change of
  // the selection scrolls: a filter that is emptied draws the whole list again,
  // and the selected row far down in it must not pull the page away from the
  // field the person is in.
  let scrollTo = $state<string | null>(null);
  $effect(() => {
    scrollTo = app.selectedId;
  });
  $effect(() => {
    if (scrollTo === null) return;
    void visible.length;
    const id = scrollTo;
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector('.rows [aria-current="true"]');
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
        scrollTo = null;
        return;
      }
      // Waited for only while the row can still come: in the list beyond what is drawn, or a task the list has not
      // read yet (a new one). A selection the list does not show (a hit in the text) would else jump later.
      if (!shown.some((t) => t.id === id) && app.tasks.some((t) => t.id === id)) scrollTo = null;
    });
    return () => cancelAnimationFrame(frame);
  });

</script>

<!-- Only the list: a task opens in the float over it (TaskDialog), as in the plan and the overview. -->
<section
  class="list"
  class:held={app.sizing === 'list' || app.tileSizes['list'] !== undefined}
  aria-label={t('nav.list')}
  use:sizeable={{
    size: app.tileSizes['list'] ?? null,
    active: app.sizing === 'list',
    onsize: (size) => app.setTileSize('list', size),
  }}
>
  <FilterBar {app} bind:searchBox moreOn={app.showFinished && app.can('finished') ? 1 : 0}>
    {#snippet extras()}
      <label class="pick sort" data-hint={`${t('hint.ui.list.sort')} ${t(`sort.hint.${app.sort}` as Key)}`}>
        <span>{t('sort.label')}</span>
        <select data-sort value={app.sort} onchange={(e) => app.setSort(parseSort(e.currentTarget.value))}>
          {#each SORT_GROUPS as g (g.group)}
            <optgroup label={t(`sort.group.${g.group}` as Key)}>
              {#each g.words as word (word)}<option value={word} title={t(`sort.hint.${word}` as Key)}>{t(`sort.${word}` as Key)}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </label>
      <label class="pick group-areas" data-hint={t('hint.ui.list.group_areas')}>
        <input type="checkbox" checked={app.groupAreas} onchange={(e) => app.setGroupAreas(e.currentTarget.checked)} />
        <span>{t('list.group_areas')}</span>
      </label>
      <SizeToggle
        lang={app.lang}
        what={t('size.list')}
        active={app.sizing === 'list'}
        sized={app.tileSizes['list'] !== undefined}
        ontoggle={() => app.toggleSizing('list')}
        onreset={() => app.setTileSize('list', null)}
      />
      <ExportMenu {app} />
      <label class="pick lists" data-hint={t('hint.ui.list.lists')}>
        <span>{t('lists.label')}</span>
        <select
          data-lists
          value={app.shownList ? `mine:${app.shownList.name}` : ''}
          onchange={(e) => {
            const value = e.currentTarget.value;
            if (value.startsWith('mine:')) app.applyList(value.slice(5));
            else if (value.startsWith('engine:')) {
              app.applyEngineList(value.slice(7));
              // The list of the engine is not kept as the chosen one: the choice goes back to what is shown.
              e.currentTarget.value = app.shownList ? `mine:${app.shownList.name}` : '';
            }
          }}
        >
          <option value="">{t('lists.none')}</option>
          {#if app.lists.length > 0}
            <optgroup label={t('lists.mine')}>
              {#each app.lists as list (list.name)}<option value={`mine:${list.name}`}>{list.name}</option>{/each}
            </optgroup>
          {/if}
          {#if app.engineLists.length > 0}
            <optgroup label={t('lists.engine')}>
              {#each app.engineLists as list (list.name)}
                <option value={`engine:${list.name}`} title={list.summary}>{list.name}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </label>
      {#if app.shownList}
        {@const shown = app.shownList}
        <button
          type="button"
          class="list-delete"
          aria-label={t('lists.delete', { name: shown.name })}
          title={t('lists.delete', { name: shown.name })}
          onclick={() => app.deleteList(shown.name)}>×</button
        >
      {/if}
      <details class="save-list" bind:open={saveListOpen}>
        <summary data-hint={t('hint.ui.list.save')}>{t('lists.save')}</summary>
        <!-- Not a form: a page of tasks has none (the tests of markup count them), and Enter does the same. -->
        <div class="save-row" role="group" aria-label={t('lists.save')}>
          <input
            type="text"
            aria-label={t('lists.name')}
            data-hint={t('hint.form.list.name')}
            placeholder={t('lists.name')}
            maxlength="40"
            bind:value={listName}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                keepList();
              }
            }}
          />
          <button type="button" disabled={listName.trim() === ''} onclick={keepList}>{t('lists.save_go')}</button>
        </div>
      </details>
    {/snippet}
    {#snippet moreExtras()}
      {#if app.can('finished')}
        <label class="pick" data-hint={t('hint.ui.list.show_finished')}>
          <input type="checkbox" bind:checked={app.showFinished} />
          <span>{t('list.show_finished')}</span>
        </label>
      {/if}
    {/snippet}
  </FilterBar>
  <!-- Only the count is a live region: the buttons and the key help beside it are not to be read out again on every change. -->
  <p class="count">
    <span role="status" data-hint={t('hint.ui.list.count')}>{t('list.count', { shown: shown.length, total: app.tasks.length })}</span>
    <span class="help"
      ><button type="button" class="linkish" data-hint={t('hint.ui.list.mark_all')} onclick={() => app.markShown()}>{t('bulk.all')}</button> ·
      {#if app.can('check')}<button type="button" class="linkish" data-hint={t('hint.ui.list.check')} onclick={() => void app.openChecks()}>{t('check.open')}</button> ·{/if}
      {#if app.can('estimate')}<button type="button" class="linkish" data-hint={t('hint.ui.list.estimate')} onclick={() => app.openMatrix()}>{t('matrix.open')}</button> ·{/if}
      {t('list.help')}</span
    >
    <!-- The marks of the rows, explained with one tab stop (the rows themselves would be hundreds). -->
    <Info hint={marksLegend(app.lang)} label={t('hint.about', { what: t('mark.legend.what') })} />
  </p>
  {#if app.marks.length > 0}
    <div class="bulk" role="group" aria-label={t('bulk.change')}>
      <strong aria-live="polite">{t('bulk.count', { n: app.marks.length })}</strong>
      <label data-hint={hintOf(app.lang, 'hint.field', 'status')}>
        <span class="sr-only">{t('field.status')}</span>
        <select bind:value={draft.status} disabled={app.locked}>
          <option value="">{t('field.status')}: {t('bulk.keep')}</option>
          {#each statuses as s (s)}<option value={s}>{labelOf(app.lang, 'status', s)}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'prio')}>
        <span class="sr-only">{t('field.prio')}</span>
        <select bind:value={draft.prio} disabled={app.locked}>
          <option value="">{t('field.prio')}: {t('bulk.keep')}</option>
          {#each app.ranges.prios as p (p)}<option value={String(p)}>P{p}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'actor')}>
        <span class="sr-only">{t('field.actor')}</span>
        <select bind:value={draft.actor} disabled={app.locked}>
          <option value="">{t('field.actor')}: {t('bulk.keep')}</option>
          {#each app.ranges.actors as a (a)}<option value={a}>{labelOf(app.lang, 'actor', a)}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'effort')}>
        <span class="sr-only">{t('field.effort')}</span>
        <select bind:value={draft.effort} disabled={app.locked}>
          <option value="">{t('field.effort')}: {t('bulk.keep')}</option>
          <option value="-">{t('field.effort')}: {t('bulk.unset')}</option>
          {#each app.ranges.efforts as size (size)}<option value={size}>{size}</option>{/each}
        </select>
      </label>
      <label data-hint={t('hint.form.remind')}>
        <span class="sr-only">{t('remind.field')}</span>
        <select bind:value={draft.remind} disabled={app.locked}>
          <option value="">{t('remind.field')}: {t('bulk.keep')}</option>
          <option value="-">{t('remind.field')}: {t('bulk.unset')}</option>
          {#each REMIND_CHOICES as choice (choice)}
            <option value={choice}
              >{choice === '+0d' ? t('remind.today') : t('remind.in', { n: choice.slice(1, -1) })}</option
            >
          {/each}
        </select>
      </label>
      <label data-hint={t('hint.form.bulk.tags_add')}>
        <span class="sr-only">{t('bulk.tags_add')}</span>
        <input type="text" placeholder={t('bulk.tags_add')} bind:value={draft.addTags} disabled={app.locked} onkeydown={applyOnEnter} />
      </label>
      <label data-hint={t('hint.form.bulk.tags_remove')}>
        <span class="sr-only">{t('bulk.tags_remove')}</span>
        <input type="text" placeholder={t('bulk.tags_remove')} bind:value={draft.removeTags} disabled={app.locked} onkeydown={applyOnEnter} />
      </label>
      <button
        type="button"
        class="apply"
        disabled={app.locked || !chosen}
        onclick={applyDraft}>{t('bulk.apply')}</button
      >
      <button type="button" onclick={() => app.clearMarks()}>{t('bulk.clear')}</button>
      {#if app.can('move_area')}
        <div class="bulk-move" role="group" aria-label={t('bulk.move_label')}>
          <label data-hint={t('hint.form.move_area')}>
            <span class="sr-only">{t('bulk.move_label')}</span>
            <select bind:this={moveSelect} bind:value={moveTo} disabled={app.locked}>
              <option value="">{t('bulk.move_label')}: {t('bulk.keep')}</option>
              {#each app.allAreaNames as area (area)}<option value={area}>{area}</option>{/each}
            </select>
          </label>
          <!-- One button for both steps: the same element keeps the focus when "Check the moves" becomes "Move n". -->
          <button
            type="button"
            class:apply={moveShown && movable > 0}
            disabled={app.locked || moveTo === ''}
            aria-disabled={checking}
            aria-busy={checking}
            onclick={() => void (moveShown && movable > 0 ? doMoves() : checkMoves())}
            >{moveShown && movable > 0 ? t('bulk.move_go', { n: movable }) : t('bulk.move_check')}</button
          >
        </div>
        <!-- Always there, so that a screen reader has the region before it gets its text. -->
        <div class="bulk-move-result" role="status" aria-label={t('bulk.move_result')}>
          {#if moveShown}
            <ul>
              {#each moveShown as c (c.id)}
                <li class:bad={c.reasons.length > 0}>
                  {#if c.reasons.length > 0}
                    {t('bulk.move_refused', { id: c.id, reason: markHidden(c.reasons.join(' ')) })}
                  {:else}
                    {t('bulk.move_ok', { id: c.id, new_id: c.newId, n: c.references })}
                  {/if}
                </li>
              {:else}
                <li>{t('bulk.nothing')}</li>
              {/each}
            </ul>
            {#each moveClasses as m (m.from)}<p>{t('bulk.move_class', m)}</p>{/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  <div class="table" style={columnStyle(app.listColumns)}>
  <ListColumnsHead
    lang={app.lang}
    columns={app.listColumns}
    onlive={(columns) => (app.listColumns = columns)}
    oncommit={(columns) => app.setListColumns(columns)}
  />
  <div class="rows" class:zebra={app.zebra} data-areas={layout}>
    {#snippet row(task: TaskEntry, band: boolean)}
      <TaskRow
        {task}
        lang={app.lang}
        today={app.today}
        selected={task.id === app.selectedId}
        marked={app.marks.includes(task.id)}
        onselect={(id) => app.peek(id)}
        marker={app}
        onmark={(id) => app.toggleMark(id)}
        markLabel={t('bulk.mark', { id: task.id })}
        flagged={app.findingsFor(task.id).length}
        flagTitle={t('check.flag', { n: app.findingsFor(task.id).length })}
        crossAreas={app.crossAreas(task.id)}
        crossTitle={t('cross.mark', { n: app.crossAreas(task.id).length, areas: app.crossAreas(task.id).join(', ') })}
        drafted={Object.keys(app.draftOf(task.id)).length}
        target={taskTarget(task)}
        stamp={sortStamp(task, app.sort)}
        claimant={app.claimName}
        area={band ? { label: shortArea(task.area), name: task.area, colour: areaColour(task.area) } : undefined}
      >
        {#snippet actions()}<RowActions {app} {task} selected={task.id === app.selectedId} />{/snippet}
      </TaskRow>
    {/snippet}
    {#if layout === 'groups'}
      {#each runs as run (run.area)}
        {@const closed = folded.includes(run.area)}
        <div class="area-group" role="group" aria-label={run.area} data-area={run.area}>
          <div class="area-head" role="heading" aria-level="2" style:--band={`var(--area-${areaColour(run.area)})`}>
            <button
              type="button"
              aria-expanded={!closed}
              data-hint={t('hint.ui.list.area_head')}
              onclick={() => toggleFold(run.area)}
              ><span class="chevron" aria-hidden="true">{closed ? '▸' : '▾'}</span><span class="area-name" title={run.area}>{shortArea(run.area)}</span></button
            >
            <span class="area-count">{t('areas.head.count', { n: totals.get(run.area) ?? run.tasks.length })}</span>
          </div>
          {#if !closed}
            {#each run.tasks as task (task.file)}
              {@render row(task, false)}
            {/each}
          {/if}
        </div>
      {/each}
    {:else}
      {#each visible as task (task.file)}
        {@render row(task, layout === 'bands')}
      {:else}
        <p class="empty">{t('list.none')}</p>
      {/each}
    {/if}
    <TextHits {app} />
    {#if app.showFinished && app.can('finished')}
      <FinishedList {app} />
    {/if}
  </div>
  </div>
</section>

<style>
  /* As high as the main area, and higher when its bars and a few rows do not fit in it (a short or narrow window, the
     more filters open): the main area scrolls then, the rows never shrink to nothing. */
  .list {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  /* With the grip shown or a size of the person's (lib/sizeable.ts): as high as the main area or that size, what does
     not fit scrolls inside it. */
  .list.held {
    height: 100%;
    min-height: 0;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .pick select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.4rem;
  }
  .list-delete {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.15rem 0.5rem;
    cursor: pointer;
  }
  .save-list {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .save-list summary {
    cursor: pointer;
  }
  .save-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.3rem;
  }
  .save-list input {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.5rem;
  }
  .save-list button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }
  .count {
    margin: 0;
    padding: 0.3rem 0.6rem;
    color: var(--muted);
    font-size: 0.8rem;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  .help {
    text-align: right;
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
  }
  .bulk {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.4rem 0.6rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  .bulk input {
    width: 9rem;
  }
  .bulk input,
  .bulk select,
  .bulk button {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.5rem;
  }
  .bulk-move {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-basis: 100%;
  }
  .bulk-move-result {
    flex-basis: 100%;
  }
  .bulk-move-result ul,
  .bulk-move-result p {
    margin: 0;
    padding-left: 1.1rem;
  }
  .bulk-move-result .bad {
    color: var(--bad);
  }
  /* The head of the columns and the rows: the widths of the columns hold for both. A few rows at least, the rest of the
     list's height when there is more. */
  .table {
    display: flex;
    flex-direction: column;
    flex: 1 0 12rem;
    min-height: 0;
  }
  .rows {
    overflow: auto;
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--border);
  }
  /* The areas of a list set apart (lib/areaBands.ts): a head per area that stays at the top while its rows scroll. */
  .area-group + .area-group {
    margin-top: 0.6rem;
    border-top: 1px solid var(--border);
  }
  .area-head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0;
    padding: 0.2rem 0.6rem 0.2rem 0.45rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    border-left: 3px solid var(--band);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .area-head button {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    min-width: 0;
    padding: 0.1rem 0.2rem;
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .area-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    color: var(--muted);
  }
  .area-count {
    color: var(--muted);
    font-weight: 400;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  /* The head stays over the rows: a row the keys scroll to stops below it, not under it. */
  .rows[data-areas='groups'] :global(.row) {
    scroll-margin-top: 2.2rem;
  }
  /* Every second row on a quieter ground (Options > "Zebra stripes in lists"); a marked row keeps its own. */
  .rows.zebra :global(.line:nth-child(even):not(.marked)) {
    background: color-mix(in srgb, var(--surface-2) 55%, transparent);
  }
  .empty {
    padding: 1rem;
    color: var(--muted);
  }
</style>
