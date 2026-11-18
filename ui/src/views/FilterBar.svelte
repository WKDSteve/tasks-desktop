<script lang="ts">
  // The filter bar: the search words, the quick filters (areas, status, who), the fold "More filters" with one choice
  // per further field, and the chips of what is on. It changes `app.filter`, the one filter of the page: the list and
  // the statistics show the same bar, and a change in one holds in the other. What only one view needs comes from that
  // view: `extras` after the quick filters (the list: order, export, saved lists), `moreExtras` inside the fold.
  import { tick, type Snippet } from 'svelte';
  import ClearSelect from 'appkit-ui/ClearSelect.svelte';
  import MultiSelect from 'appkit-ui/MultiSelect.svelte';
  import { TIP_ID } from 'appkit-ui/tooltip';
  import type { App } from '../lib/app.svelte';
  import { CLAIM_CLASSES, isClaimClass } from '../lib/claims';
  import {
    DATE_KEYS,
    FIELD_KEYS,
    NONE,
    RANGE_KEYS,
    REMINDER_CHOICES,
    UPDATED_WINDOWS,
    activeFilters,
    boundOptions,
    extraCount,
    fieldOptions,
    isMultiKey,
    narrows,
    wantsAll,
    withMatch,
    without,
    withSelected,
    type ActiveFilter,
    type Bound,
    type DateKey,
    type FieldKey,
    type RangeKey,
    type ReminderChoice,
    type UpdatedWindow,
  } from '../lib/filter';
  import { boundLabel, chipJoins, chipLabel as chipText, valueLabel as valueText } from '../lib/filter-chips';
  import { hintOf, labelOf, translate, type Key } from '../lib/i18n';
  import AreaFilter from './AreaFilter.svelte';

  let {
    app,
    searchBox = $bindable(null),
    extras,
    moreExtras,
    moreOn = 0,
  }: {
    app: App;
    searchBox?: HTMLInputElement | null;
    /** What the view adds after the quick filters, in the same row. */
    extras?: Snippet;
    /** What the view adds inside "More filters" (between the ranges and the days). */
    moreExtras?: Snippet;
    /** How many of the view's own choices in the fold are on: counted in its summary with the filters. */
    moreOn?: number;
  } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  // The engine names the values (`hello.enums`); a word this version has no text for is shown as it is.
  const statuses = $derived(app.ranges.statuses);
  // `none` is the page's word for a task without a who: an engine that named a who `none` would be the same chip.
  const actors = $derived([...app.ranges.actors.filter((a) => a !== 'none'), 'none']);

  // The filters beyond area, status and actor: one choice per field, the values the tasks have, with how many.
  let moreOpen = $state(false);
  const fieldLabel = (key: FieldKey): string => t(`filter.field.${key}` as Key);
  const valueLabel = (key: FieldKey, value: string): string => valueText(app.lang, key, value);

  // "At least / at most" for the fields with an order: the values the tasks have, in their order.
  const rangeChoices = $derived(
    RANGE_KEYS.map((key) => ({ key, options: boundOptions(app.tasks, key) })).filter(
      (r) => r.options.length > 0 || app.filter.ranges[r.key] !== undefined,
    ),
  );
  /** The values to choose from; a bound that is on although no task has it any more stays, so it can be seen and changed. */
  const boundsWith = (options: readonly Bound[], on: Bound | undefined): Bound[] =>
    on && !options.some((o) => o.label === on.label) ? [...options, on].sort((a, b) => a.n - b.n) : [...options];
  /** One end of a range chosen (or taken away with the empty choice); the other end stays. */
  function setBound(key: RangeKey, end: 'min' | 'max', options: readonly Bound[], label: string): void {
    const found = options.find((o) => o.label === label);
    const range = { ...(app.filter.ranges[key] ?? {}) };
    if (found) range[end] = found;
    else delete range[end];
    app.filter = { ...app.filter, ranges: { ...app.filter.ranges, [key]: range } };
  }
  /** One end of a span of days typed (or cleared). */
  function setDay(key: DateKey, end: 'from' | 'to', value: string): void {
    const span = { ...(app.filter.dates[key] ?? {}) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) span[end] = value;
    else delete span[end];
    app.filter = { ...app.filter, dates: { ...app.filter.dates, [key]: span } };
  }
  // What the tasks have: it follows the tasks and the language only, not every change of a filter.
  const baseChoices = $derived(
    FIELD_KEYS.map((key) => ({
      key,
      options: fieldOptions(app.tasks, key, app.projectOf).map((o) => ({
        value: o.value,
        label: valueLabel(key, o.value),
        suffix: String(o.count),
      })),
    })),
  );
  const fieldChoices = $derived(
    baseChoices
      // A field that no task has a value for offers nothing to choose, unless it is on.
      .filter((f) => f.options.some((o) => o.value !== NONE) || (app.filter.fields[f.key]?.length ?? 0) > 0)
      // A value that is on although no task has it any more stays in the choice (with 0), so it can be switched off.
      .map((f) => ({
        ...f,
        options: withSelected(f.options, app.filter.fields[f.key] ?? [], (v) => ({
          value: v,
          label: valueLabel(f.key, v),
          suffix: '0',
        })),
      })),
  );
  const chipLabel = (item: ActiveFilter): string =>
    chipText(app.lang, app.filter, item, { short: app.shortAreas, all: app.allAreaNames });
  // Each chip names how it goes with the one before it: or within a field, and between fields.
  const chips = $derived.by(() => {
    const joins = chipJoins(app.filter);
    return activeFilters(app.filter).map((item, i) => ({ item, join: joins[i] ?? null, label: chipLabel(item) }));
  });
  let chipList: HTMLUListElement | undefined = $state();
  let moreSummary: HTMLElement | undefined = $state();
  /** Switch one filter off and keep the focus where it was: on the chip that took its place, else on the fold. */
  async function removeChip(item: ActiveFilter, index: number): Promise<void> {
    app.filter = without(app.filter, item);
    await tick();
    const buttons = chipList?.querySelectorAll<HTMLButtonElement>('li button');
    (buttons && buttons.length > 0 ? buttons[Math.min(index, buttons.length - 1)] : moreSummary)?.focus();
  }
  async function clearFilters(): Promise<void> {
    app.resetFilter();
    await tick();
    moreSummary?.focus();
  }
  /**
   * Empty the search words only; the focus goes back to the field (the button that had it is gone). A press of the
   * mouse on the button leaves the focus in the field, so that focusing it again shows no hint.
   */
  function clearQuery(): void {
    app.setQuery('');
    searchBox?.focus();
  }
  const extraOn = $derived(extraCount(app.filter) + moreOn);
</script>

<div class="filters">
  <span class="search">
    <input
      bind:this={searchBox}
      type="search"
      data-hint={t('hint.ui.list.search')}
      placeholder={t('list.search')}
      aria-label={t('list.search')}
      value={app.filter.query}
      oninput={(e) => app.setQuery(e.currentTarget.value)}
      onkeydown={(e) => {
        // Escape empties the words (Firefox would not); an empty field leaves Escape to the browser. An open hint
        // of the field takes this Escape alone (the kit closes it, on the document), and so does a composition.
        const hintOpen = (e.currentTarget.getAttribute('aria-describedby') ?? '').split(' ').includes(TIP_ID);
        if (e.key === 'Escape' && !e.isComposing && !hintOpen && app.filter.query !== '') {
          e.preventDefault();
          clearQuery();
        }
      }}
    />
    {#if app.filter.query !== ''}
      <button
        type="button"
        class="search-clear"
        aria-label={t('list.search_clear')}
        title={t('list.search_clear')}
        onmousedown={(e) => e.preventDefault()}
        onclick={clearQuery}>×</button
      >
    {/if}
  </span>
  <AreaFilter {app} hint={t('hint.ui.list.areas')} />
  <MultiSelect
    label={t('list.filter.status')}
    hint={t('hint.ui.list.status')}
    note={t('multi.note.any_one')}
    options={statuses.map((s) => ({ value: s, label: labelOf(app.lang, 'status', s) }))}
    selected={app.filter.statuses}
    onchange={(statuses) => (app.filter = { ...app.filter, statuses })}
    clearLabel={t('kit.select.clear', { label: t('list.filter.status') })}
    resetLabel={t('multi.reset')}
    searchLabel={t('multi.search')}
  />
  <MultiSelect
    label={t('list.filter.actor')}
    hint={t('hint.ui.list.actor')}
    note={t('multi.note.any_one')}
    options={actors.map((a) => ({
      value: a,
      label: labelOf(app.lang, 'actor', a),
      title: hintOf(app.lang, 'actor', `${a}.hint`),
    }))}
    selected={app.filter.actors}
    onchange={(actors) => (app.filter = { ...app.filter, actors })}
    clearLabel={t('kit.select.clear', { label: t('list.filter.actor') })}
    resetLabel={t('multi.reset')}
    searchLabel={t('multi.search')}
  />
  {@render extras?.()}
</div>
<details class="more" open={moreOpen} ontoggle={(e) => (moreOpen = e.currentTarget.open)}>
  <summary bind:this={moreSummary} data-hint={t('hint.ui.list.more')}>{t('filter.more')}{extraOn > 0 ? ` (${extraOn})` : ''}</summary>
  <div class="more-body">
    {#each fieldChoices as f (f.key)}
      <MultiSelect
        label={fieldLabel(f.key)}
        hint={hintOf(app.lang, 'hint.field', f.key) || t('hint.form.filter.field', { field: fieldLabel(f.key) })}
        options={f.options}
        selected={app.filter.fields[f.key] ?? []}
        onchange={(next) => (app.filter = { ...app.filter, fields: { ...app.filter.fields, [f.key]: next } })}
        note={isMultiKey(f.key) ? '' : t('multi.note.any_one')}
        match={isMultiKey(f.key)
          ? {
              value: wantsAll(app.filter, f.key) ? 'all' : 'any',
              anyLabel: t('filter.match.any'),
              allLabel: t('filter.match.all'),
              onchange: (value) => {
                if (isMultiKey(f.key)) app.filter = withMatch(app.filter, f.key, value);
              },
            }
          : undefined}
        clearLabel={t('kit.select.clear', { label: fieldLabel(f.key) })}
        resetLabel={t('multi.reset')}
        searchLabel={t('multi.search')}
      />
    {/each}
    <label class="pick" data-hint={t('hint.overdue')}>
      <input
        type="checkbox"
        checked={app.filter.overdue}
        onchange={(e) => (app.filter = { ...app.filter, overdue: e.currentTarget.checked })}
      />
      <span>{t('filter.overdue')}</span>
    </label>
    {#if app.can('claims') || app.filter.claims.length > 0}
      <MultiSelect
        label={t('filter.claim')}
        hint={t('hint.filter.claim')}
        options={CLAIM_CLASSES.map((c) => ({ value: c, label: t(`filter.claim.${c}` as Key) }))}
        selected={app.filter.claims}
        onchange={(claims) => (app.filter = { ...app.filter, claims: claims.filter(isClaimClass) })}
        clearLabel={t('kit.select.clear', { label: t('filter.claim') })}
        resetLabel={t('multi.reset')}
        searchLabel={t('multi.search')}
      />
    {/if}
    {#if app.quickWinSet !== undefined || app.filter.quickWin}
      <label class="pick" data-hint={t('hint.quick_win')}>
        <input
          type="checkbox"
          checked={app.filter.quickWin}
          onchange={(e) => (app.filter = { ...app.filter, quickWin: e.currentTarget.checked })}
        />
        <span>{t('filter.quick_win')}</span>
      </label>
    {/if}
    <label class="pick" data-hint={t('hint.cross')}>
      <input
        type="checkbox"
        checked={app.filter.cross}
        onchange={(e) => (app.filter = { ...app.filter, cross: e.currentTarget.checked })}
      />
      <span>{t('filter.cross')}</span>
    </label>
    <label class="pick">
      <span>{t('filter.updated')}</span>
      <ClearSelect
        value={app.filter.updated}
        clearLabel={t('kit.select.clear', { label: t('filter.updated') })}
        onclear={() => (app.filter = { ...app.filter, updated: '' })}
        onchange={(e) => (app.filter = { ...app.filter, updated: e.currentTarget.value as UpdatedWindow })}
      >
        <option value="">{t('filter.whatever')}</option>
        {#each UPDATED_WINDOWS as w (w)}<option value={w}>{t(`filter.updated.${w}` as Key)}</option>{/each}
      </ClearSelect>
    </label>
    <label class="pick">
      <span>{t('filter.reminder')}</span>
      <ClearSelect
        value={app.filter.reminder}
        clearLabel={t('kit.select.clear', { label: t('filter.reminder') })}
        onclear={() => (app.filter = { ...app.filter, reminder: '' })}
        onchange={(e) => (app.filter = { ...app.filter, reminder: e.currentTarget.value as ReminderChoice })}
      >
        <option value="">{t('filter.whatever')}</option>
        {#each REMINDER_CHOICES as r (r)}<option value={r}>{t(`filter.reminder.${r}` as Key)}</option>{/each}
      </ClearSelect>
    </label>
    {#each rangeChoices as r (r.key)}
      {#each ['min', 'max'] as const as end (end)}
        <label class="pick" data-hint={r.key === 'prio' ? t('filter.range.prio_hint') : r.key === 'effort' ? t('filter.range.effort_hint') : undefined}>
          <span>{t(`filter.range.${end}` as Key, { field: t(`filter.field.${r.key}` as Key) })}</span>
          <ClearSelect
            data-range={`${r.key}-${end}`}
            value={app.filter.ranges[r.key]?.[end]?.label ?? ''}
            clearLabel={t('kit.select.clear', {
              label: t(`filter.range.${end}` as Key, { field: t(`filter.field.${r.key}` as Key) }),
            })}
            onclear={() => setBound(r.key, end, r.options, '')}
            onchange={(e) => setBound(r.key, end, r.options, e.currentTarget.value)}
          >
            <option value="">{t('filter.whatever')}</option>
            {#each boundsWith(r.options, app.filter.ranges[r.key]?.[end]) as o (o.label)}
              <option value={o.label}>{boundLabel(r.key, o.label)}</option>
            {/each}
          </ClearSelect>
        </label>
      {/each}
    {/each}
    {@render moreExtras?.()}
    {#each DATE_KEYS as key (key)}
      {#each ['from', 'to'] as const as end (end)}
        <label class="pick" data-hint={t(`hint.form.filter.date.${end}` as Key, { field: t(`filter.date.${key}` as Key) })}>
          <span>{t(`filter.date.${end}` as Key, { field: t(`filter.date.${key}` as Key) })}</span>
          <input
            type="date"
            data-date={`${key}-${end}`}
            value={app.filter.dates[key]?.[end] ?? ''}
            onchange={(e) => setDay(key, end, e.currentTarget.value)}
          />
        </label>
      {/each}
    {/each}
  </div>
</details>
<!-- Words alone are no chip, but they narrow the list as much: reset is offered for them too (in a list that does
     not then call itself the filters that are on). -->
{#if narrows(app.filter)}
  <ul class="active" aria-label={chips.length > 0 ? t('filter.active') : undefined} bind:this={chipList}>
    {#each chips as c, index (c.item.kind + ':' + c.item.value)}
      <li>
        {#if c.join}<span class="join">{t(`filter.join.${c.join}`)}</span>{/if}
        <span>{c.label}</span>
        <button
          type="button"
          aria-label={t('filter.remove', { what: c.label })}
          onclick={() => void removeChip(c.item, index)}>×</button
        >
      </li>
    {/each}
    <li><button type="button" class="linkish" onclick={() => void clearFilters()}>{t('filter.clear')}</button></li>
  </ul>
{/if}

<style>
  .filters {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .search {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 10rem;
  }
  .filters input[type='search'] {
    flex: 1;
    min-width: 0;
    padding-right: 1.8rem;
  }
  /* Our own button clears, with a name; the browser's unnamed one would stand beside it. */
  .filters input[type='search']::-webkit-search-cancel-button {
    appearance: none;
  }
  .search-clear {
    position: absolute;
    right: 0.2rem;
    top: 50%;
    transform: translateY(-50%);
    min-width: 1.5rem;
    min-height: 1.5rem;
    padding: 0 0.3rem;
    border: none;
    background: transparent;
    color: var(--muted);
    line-height: 1.4;
  }
  .search-clear:hover,
  .search-clear:focus-visible {
    color: var(--text);
  }
  .more {
    padding: 0.25rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }
  .more summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .more-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
    padding: 0.5rem 0 0.25rem;
  }
  /* A choice with its name before it. What a view adds through a snippet is drawn by that view, with the same rule
     there (ListView): a rule of this component does not reach it. */
  .pick {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .pick :global(.clear-select select) {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.4rem;
  }
  .active {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    list-style: none;
    margin: 0;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }
  .active li {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.05rem 0.2rem 0.05rem 0.6rem;
    font-size: 0.8rem;
  }
  /* The word that joins a chip to the one before it: part of the chip's text, quieter than its value. */
  .active .join {
    color: var(--muted);
    font-size: 0.85em;
    padding-right: 0.25rem;
    border-right: 1px solid var(--border);
  }
  .active li:last-child {
    background: none;
    border: none;
    padding: 0;
  }
  .active li button:not(.linkish) {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0 0.3rem;
    font-size: 1rem;
    line-height: 1;
  }
  .filters input {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.5rem;
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
  }
</style>
