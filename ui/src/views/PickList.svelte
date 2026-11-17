<script lang="ts">
  // A searchable list to choose from: one value (the plan of a task) or several (the tasks to add to a plan). A field
  // to type in narrows the list (`filterOptions`); the arrow keys move through it, Enter chooses, Space ticks an entry
  // of a list of several, Escape gives up. The entries that do something instead of choosing a value ("No plan",
  // "Create a plan ...") stand first. A press works as well as a key (touch). What the entries are comes from the
  // caller, from the engine's snapshot (`lib/picker.ts`).
  import { tick } from 'svelte';
  import { filterOptions, type PickAction, type PickOption } from '../lib/picker';
  import { markHidden } from '../lib/text';

  let {
    options,
    actions = [],
    selected = [],
    multiple = false,
    searchLabel,
    emptyLabel,
    hint = '',
    name = '',
    autofocus = false,
    onpick,
    onaction = () => undefined,
    onescape = () => undefined,
  }: {
    options: readonly PickOption[];
    actions?: readonly PickAction[];
    selected?: readonly string[];
    multiple?: boolean;
    /** The label of the field to type in. */
    searchLabel: string;
    /** Said when the typed words leave no entry. */
    emptyLabel: string;
    /** The hint of the field to type in (`data-hint`). */
    hint?: string;
    /** A name for tests and styles (`data-pick`). */
    name?: string;
    autofocus?: boolean;
    /** A value was chosen (one) or ticked/unticked (several). */
    onpick: (value: string) => void;
    onaction?: (id: string) => void;
    onescape?: () => void;
  } = $props();

  const uid = $props.id();
  let needle = $state('');
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  const shown = $derived(filterOptions(options, needle));
  // The actions stay while nothing is typed; a typed word looks for values.
  const shownActions = $derived(needle.trim() === '' ? actions : []);
  const count = $derived(shownActions.length + shown.length);
  const activeIndex = $derived(count === 0 ? -1 : Math.min(active, count - 1));
  const idOf = (i: number): string => `${uid}-o${i}`;

  $effect(() => {
    if (autofocus) input?.focus();
  });

  function choose(i: number): void {
    if (i < 0) return;
    if (i < shownActions.length) {
      onaction(shownActions[i]!.id);
      return;
    }
    const option = shown[i - shownActions.length];
    if (option) onpick(option.value);
  }

  async function move(to: number): Promise<void> {
    if (count === 0) return;
    active = Math.max(0, Math.min(count - 1, to));
    await tick();
    list?.querySelector(`#${CSS.escape(idOf(active))}`)?.scrollIntoView({ block: 'nearest' });
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      void move(activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      void move(activeIndex - 1);
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      void move(0);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      void move(count - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === ' ' && multiple && needle === '') {
      // Space ticks while nothing is typed; after a word it is part of the search.
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (needle !== '') needle = '';
      else onescape();
    }
  }
</script>

<div class="picklist" data-pick={name || undefined}>
  <input
    bind:this={input}
    type="search"
    role="combobox"
    aria-label={searchLabel}
    placeholder={searchLabel}
    aria-expanded="true"
    aria-controls={`${uid}-list`}
    aria-autocomplete="list"
    aria-activedescendant={activeIndex >= 0 ? idOf(activeIndex) : undefined}
    data-hint={hint || undefined}
    bind:value={needle}
    oninput={() => (active = 0)}
    {onkeydown}
  />
  <ul
    bind:this={list}
    id={`${uid}-list`}
    role="listbox"
    aria-label={searchLabel}
    aria-multiselectable={multiple ? 'true' : undefined}
  >
    {#each shownActions as action, i (action.id)}
      <!-- A press chooses; the keys stay in the field above (the option is not a stop of the Tab key). -->
      <li
        id={idOf(i)}
        role="option"
        class="action"
        class:active={i === activeIndex}
        aria-selected="false"
        data-action={action.id}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => choose(i)}
        onkeydown={() => undefined}
      >
        {action.label}
      </li>
    {/each}
    {#each shown as option, j (option.value)}
      {@const i = shownActions.length + j}
      {@const on = selected.includes(option.value)}
      <li
        id={idOf(i)}
        role="option"
        class:active={i === activeIndex}
        aria-selected={on ? 'true' : 'false'}
        data-value={option.value}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => {
          active = i;
          choose(i);
        }}
        onkeydown={() => undefined}
      >
        {#if multiple}<span class="tick" aria-hidden="true">{on ? '☑' : '☐'}</span>{:else if on}<span
            class="tick"
            aria-hidden="true">✓</span
          >{/if}
        <span class="text">
          <span class="label">{markHidden(option.label)}</span>
          {#if option.note}<span class="note">{markHidden(option.note)}</span>{/if}
          {#if option.detail}<small class="detail">{markHidden(option.detail)}</small>{/if}
        </span>
      </li>
    {/each}
  </ul>
  {#if count === 0}
    <p class="empty" role="status">{emptyLabel}</p>
  {/if}
</div>

<style>
  .picklist {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }
  input {
    width: 100%;
    box-sizing: border-box;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  li {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    /* A finger needs room: an entry is at least as high as a button. */
    min-height: 2rem;
    box-sizing: border-box;
  }
  li.active {
    background: var(--accent-soft);
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  li[aria-selected='true'] .label {
    font-weight: 600;
  }
  li.action {
    font-style: italic;
    border-bottom: 1px solid var(--border);
  }
  .text {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.5rem;
    min-width: 0;
  }
  .label {
    overflow-wrap: anywhere;
  }
  .detail {
    flex-basis: 100%;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .note {
    color: var(--warn);
    font-size: 0.85em;
  }
  .empty {
    margin: 0;
    color: var(--muted);
  }
</style>
