<script lang="ts">
  import Info from 'appkit-ui/Info.svelte';
  // "Defaults ...": where the page starts and what it shows without a choice of the person's own (`lib/defaults.ts`),
  // with the switches that stand until changed (counts in the choice of areas, short area names, saving fields with a
  // button). Everything is kept in this browser at once; nothing here writes to the vault.
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { LAYOUT_VIEWS, type App } from '../lib/app.svelte';
  import { START_VIEWS, parseDefaults } from '../lib/defaults';
  import { activeFilters, parseFilter } from '../lib/filter';
  import { floating } from '../lib/floating';
  import { translate, type Key } from '../lib/i18n';
  import { SORT_GROUPS } from '../lib/sort';
  import { ROW_ACTIONS, toggleRowAction } from '../lib/rowActions';
  import { categoryIconRows, categoryIconsOf, isOneGrapheme, ownIcon, withCategoryIcon } from '../lib/icons';

  let { app, open, onclose }: { app: App; open: boolean; onclose: () => void } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  /** How many choices the default filter holds (0: none). */
  const filterChoices = $derived(app.defaults.filter ? activeFilters(parseFilter(app.defaults.filter)).length : 0);
  /** How many choices the filter shown now holds. */
  const shownChoices = $derived(activeFilters(app.filter).length);
  let confirmReset = $state(false);

  /** The categories the setting "Icons of the categories" offers: those with an icon, then the vault's. */
  const iconRows = $derived(categoryIconRows(app.categoryIconPrefs, app.ranges.categories));
  /** What stands in a field of an icon that is not one character, by category: shown with a word, not taken. */
  let wrongIcons = $state<Record<string, string>>({});
  /** The icon each field shows: the one chosen, also while the step is off. */
  const chosenIcons = $derived(categoryIconsOf(app.categoryIconPrefs, true));

  /** One character or nothing is the icon of `category` at once; anything else waits in the field with a word. */
  function takeIcon(category: string, text: string): void {
    const icon = text.trim();
    const rest: Record<string, string> = Object.create(null);
    for (const [c, wrongText] of Object.entries(wrongIcons)) if (c !== category) rest[c] = wrongText;
    if (icon === '' || isOneGrapheme(icon)) {
      wrongIcons = rest;
      app.setCategoryIcons(withCategoryIcon(app.categoryIconPrefs, category, icon));
    } else {
      rest[category] = text;
      wrongIcons = rest;
    }
  }
</script>

<dialog
  bind:this={dialog}
  use:floating={{ kind: 'defaults', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop
  aria-labelledby="defaults-title"
  onclose={() => {
    confirmReset = false;
    wrongIcons = {};
    onclose();
  }}
  data-testid="defaults-dialog"
>
  {#if open}
    <div class="dialog-head">
      <h2 id="defaults-title">{t('defaults.title')}</h2>
      <Info hint={t('hint.dialog.defaults')} label={t('hint.about', { what: t('defaults.title') })} />
    </div>
    <p class="muted">{t('defaults.intro')}</p>

    <fieldset>
      <legend>{t('defaults.sec.start')}</legend>
      <label for="defaults-view" data-hint={t('hint.form.defaults.start_view')}>{t('defaults.start_view')}</label>
      <select
        id="defaults-view"
        data-hint={t('hint.form.defaults.start_view')}
        value={app.defaults.startView}
        onchange={(e) => app.setDefaults({ startView: parseDefaults(JSON.stringify({ startView: e.currentTarget.value })).startView })}
      >
        <option value="last">{t('defaults.start_view.last')}</option>
        {#each START_VIEWS as view (view)}
          <option value={view}>{t(`nav.${view}` as Key)}</option>
        {/each}
      </select>
      <label class="check" data-hint={t('hint.form.defaults.start_with')}>
        <input
          type="checkbox"
          checked={app.defaults.startWith === 'defaults'}
          onchange={(e) => app.setDefaults({ startWith: e.currentTarget.checked ? 'defaults' : 'last' })}
          data-testid="defaults-start-with"
        />
        {t('defaults.start_with')}
      </label>
    </fieldset>

    <fieldset>
      <legend>{t('defaults.sec.list')}</legend>
      <label for="defaults-sort" data-hint={t('hint.form.defaults.sort')}>{t('defaults.sort')}</label>
      <select
        id="defaults-sort"
        data-hint={t('hint.form.defaults.sort')}
        value={app.defaults.sort}
        onchange={(e) => app.setDefaults({ sort: parseDefaults(JSON.stringify({ sort: e.currentTarget.value })).sort })}
      >
        {#each SORT_GROUPS as g (g.group)}
          <optgroup label={t(`sort.group.${g.group}` as Key)}>
            {#each g.words as word (word)}
              <option value={word} title={t(`sort.hint.${word}` as Key)}>{t(`sort.${word}` as Key)}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <p class="line" data-testid="defaults-filter">
        {filterChoices === 0 ? t('defaults.filter.none') : t('defaults.filter.some', { n: filterChoices })}
      </p>
      <div class="row">
        <button type="button" onclick={() => app.takeFilterAsDefault()} disabled={shownChoices === 0} data-testid="defaults-take-filter">
          {t('defaults.filter.take', { n: shownChoices })}
        </button>
        <button type="button" onclick={() => app.setDefaults({ filter: '' })} disabled={filterChoices === 0}>{t('defaults.filter.clear')}</button>
      </div>
    </fieldset>

    <fieldset>
      <legend>{t('defaults.sec.show')}</legend>
      <label class="check" data-hint={t('hint.item.menu.area_counts')}>
        <input type="checkbox" checked={app.areaCountsShown} onchange={(e) => app.setAreaCounts(e.currentTarget.checked)} />
        {t('menu.area_counts')}
      </label>
      <label class="check" data-hint={t('hint.item.menu.short_areas')}>
        <input type="checkbox" checked={app.shortAreas} onchange={(e) => app.setShortAreas(e.currentTarget.checked)} />
        {t('menu.short_areas')}
      </label>
      <label class="check" data-hint={t('hint.item.menu.area_split')}>
        <input type="checkbox" checked={app.areaSplit} onchange={(e) => app.setAreaSplit(e.currentTarget.checked)} />
        {t('menu.area_split')}
      </label>
      <label class="check" data-hint={t('hint.item.menu.zebra')}>
        <input type="checkbox" checked={app.zebra} onchange={(e) => app.setZebra(e.currentTarget.checked)} />
        {t('menu.zebra')}
      </label>
      <label class="check" data-hint={t('hint.item.menu.hide_learning')}>
        <input type="checkbox" data-pref="hide-learning" checked={app.learningHidden} onchange={(e) => app.setLearningHidden(e.currentTarget.checked)} />
        {t('menu.hide_learning')}
      </label>
      <label class="check" data-hint={t('hint.item.menu.gamification')}>
        <input type="checkbox" data-pref="gamification" checked={app.gamification} onchange={(e) => app.setGamification(e.currentTarget.checked)} />
        {t('menu.gamification')}
      </label>
      <label class="check" data-hint={t('hint.item.menu.bar_areas')}>
        <input type="checkbox" checked={app.barAreas} onchange={(e) => app.setBarAreas(e.currentTarget.checked)} />
        {t('menu.bar_areas')}
      </label>
      <label class="check" data-hint={t('hint.item.menu.save_manual')}>
        <input
          type="checkbox"
          checked={app.saveMode === 'manual'}
          onchange={(e) => app.setSaveMode(e.currentTarget.checked ? 'manual' : 'auto')}
        />
        {t('menu.save_manual')}
      </label>
      <label for="defaults-claim-name" data-hint={t('hint.defaults.claim_name')}>{t('defaults.claim_name')}</label>
      <input spellcheck="false"
        id="defaults-claim-name"
        data-hint={t('hint.defaults.claim_name')}
        type="text"
        value={app.claimName}
        placeholder={t('defaults.claim_name.none')}
        onchange={(e) => app.setClaimName(e.currentTarget.value)}
      />
    </fieldset>

    <!-- The last step of the icons (lib/icons.ts): on or off, and one character per category or none. A text that is
         not one character is said at the field and not taken; the icon before stays. -->
    <fieldset data-testid="defaults-category-icons">
      <legend>{t('defaults.sec.category_icons')}</legend>
      <label class="check" data-hint={t('hint.defaults.category_icons.on')}>
        <input
          type="checkbox"
          data-pref="category-icons"
          checked={app.categoryIconPrefs.on}
          onchange={(e) => app.setCategoryIcons({ ...app.categoryIconPrefs, on: e.currentTarget.checked })}
        />
        {t('defaults.category_icons.on')}
      </label>
      <p class="muted" id="defaults-category-icons-intro">{t('defaults.category_icons.intro')}</p>
      <div class="icons">
        {#each iconRows as category, i (category)}
          {@const wrongText = ownIcon(wrongIcons, category)}
          {@const wrong = wrongText !== undefined}
          <label for={`defaults-category-icon-${i}`} data-hint={t('hint.defaults.category_icon')}>{category}</label>
          <input
            id={`defaults-category-icon-${i}`}
            class="icon"
            type="text"
            data-category-icon={category}
            data-hint={t('hint.defaults.category_icon')}
            autocomplete="off"
            spellcheck="false"
            disabled={!app.categoryIconPrefs.on}
            value={wrongText ?? ownIcon(chosenIcons, category) ?? ''}
            aria-invalid={wrong ? 'true' : undefined}
            aria-describedby={wrong ? `defaults-category-icon-${i}-wrong` : 'defaults-category-icons-intro'}
            onfocus={(e) => e.currentTarget.select()}
            oninput={(e) => takeIcon(category, e.currentTarget.value)}
          />
          {#if wrong}
            <span class="wrong" id={`defaults-category-icon-${i}-wrong`} role="alert">{t('defaults.category_icons.invalid')}</span>
          {:else}
            <span></span>
          {/if}
        {/each}
      </div>
      <div class="row">
        <button
          type="button"
          onclick={() => {
            wrongIcons = {};
            app.setCategoryIcons({ on: app.categoryIconPrefs.on, changed: {} });
          }}
          disabled={Object.keys(app.categoryIconPrefs.changed).length === 0 && Object.keys(wrongIcons).length === 0}
          data-testid="defaults-category-icons-reset">{t('defaults.category_icons.reset')}</button
        >
      </div>
    </fieldset>

    <!-- The actions at the end of a row of a list: each for itself, none forced (lib/rowActions.ts). -->
    <fieldset data-testid="defaults-row-actions">
      <legend>{t('menu.sec.row_actions')}</legend>
      {#each ROW_ACTIONS as action (action)}
        <label class="check" data-hint={t('hint.item.menu.rowact')}>
          <input
            type="checkbox"
            data-row-action-pref={action}
            checked={app.rowActions.shown.includes(action)}
            onchange={() => app.setRowActions(toggleRowAction(app.rowActions, action))}
          />
          {t(`menu.rowact.${action}`)}
        </label>
      {/each}
      <label class="check" data-hint={t('hint.item.menu.rowact.always')}>
        <input
          type="checkbox"
          data-row-action-pref="always"
          checked={app.rowActions.always}
          onchange={(e) => app.setRowActions({ ...app.rowActions, always: e.currentTarget.checked })}
        />
        {t('menu.rowact.always')}
      </label>
    </fieldset>

    <fieldset data-testid="defaults-layout">
      <legend>{t('defaults.sec.layout')}</legend>
      <p class="muted">{t('defaults.layout.intro')}</p>
      {#each LAYOUT_VIEWS as view (view)}
        {@const changed = app.layoutChanged(view)}
        <div class="row layout">
          <span class="name">{t(`nav.${view}` as Key)}</span>
          {#if changed}
            <button
              type="button"
              aria-label={t('defaults.layout.reset_view', { view: t(`nav.${view}` as Key) })}
              onclick={() => app.resetLayout(view)}
              data-testid={`defaults-layout-${view}`}>{t('defaults.layout.reset')}</button
            >
          {:else}
            <span class="muted" data-testid={`defaults-layout-${view}`}>{t('defaults.layout.as_came')}</span>
          {/if}
        </div>
      {/each}
    </fieldset>

    <div class="row">
      <button type="button" onclick={() => app.applyDefaults()} data-testid="defaults-apply">{t('defaults.apply')}</button>
      {#if confirmReset}
        <span class="confirm" role="alert">
          {t('defaults.reset.confirm')}
          <button type="button" class="primary" onclick={() => { app.resetToFactory(); confirmReset = false; wrongIcons = {}; }} data-testid="defaults-reset-yes">{t('defaults.reset.yes')}</button>
          <button type="button" onclick={() => (confirmReset = false)}>{t('dialog.cancel')}</button>
        </span>
      {:else}
        <button type="button" onclick={() => (confirmReset = true)} data-testid="defaults-reset">{t('defaults.reset')}</button>
      {/if}
    </div>

    <div class="actions">
      <button type="button" class="primary" onclick={() => dialog?.close()}>{t('defaults.close')}</button>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(34rem, calc(100vw - 2rem));
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .muted {
    color: var(--muted);
    margin: 0 0 0.75rem;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.75rem 0.75rem;
    display: grid;
    gap: 0.4rem;
  }
  legend {
    font-weight: 600;
    padding: 0 0.25rem;
  }
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .line {
    margin: 0.25rem 0 0;
  }
  .row,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .icons {
    display: grid;
    grid-template-columns: minmax(6rem, max-content) 4rem 1fr;
    gap: 0.35rem 0.5rem;
    align-items: center;
  }
  .icons input.icon {
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    font-size: 1.1rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem;
  }
  .icons input.icon[aria-invalid='true'] {
    border-color: var(--bad);
  }
  .icons input.icon:disabled {
    opacity: 0.6;
  }
  .wrong {
    color: var(--bad);
    font-size: 0.9rem;
  }
  .layout .name {
    min-width: 8rem;
  }
  .actions {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
  .confirm {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  button,
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.8rem;
  }
  button {
    cursor: pointer;
  }
  .primary {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
