<script lang="ts">
  // A field of a form whose value is chosen from a searchable list (`PickList`): the plan, the phase or the project of a
  // task. The button shows what is chosen; pressing it opens the list under it, in the flow of the form (no popup that a
  // scrolling card could cut). Choosing, Escape or leaving the field closes it again.
  import { tick } from 'svelte';
  import PickList from './PickList.svelte';
  import type { PickAction, PickOption } from '../lib/picker';
  import { markHidden } from '../lib/text';

  let {
    label,
    hint = '',
    value,
    options,
    actions = [],
    placeholder,
    searchLabel,
    emptyLabel,
    disabled = false,
    name,
    onpick,
    onaction = () => undefined,
  }: {
    label: string;
    /** The hint of the label (`data-hint`), as on the other fields. */
    hint?: string;
    /** What is chosen now ('' or undefined: nothing). */
    value: string | undefined;
    options: readonly PickOption[];
    actions?: readonly PickAction[];
    /** Shown on the button while nothing is chosen. */
    placeholder: string;
    searchLabel: string;
    emptyLabel: string;
    disabled?: boolean;
    /** The field's name for tests (`data-field`), as the plain inputs have it. */
    name: string;
    onpick: (value: string) => void;
    onaction?: (id: string) => void;
  } = $props();

  const uid = $props.id();
  let open = $state(false);
  let button: HTMLButtonElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();

  // A value that is not among the entries (a plan that is closed, a name typed by hand in the file) is shown as written.
  const current = $derived(value ? (options.find((o) => o.value === value)?.label ?? value) : '');
  $effect(() => {
    if (disabled) open = false;
  });

  async function close(focus: boolean): Promise<void> {
    open = false;
    if (focus) {
      await tick();
      button?.focus();
    }
  }
  function pick(next: string): void {
    void close(true);
    onpick(next);
  }
  function act(id: string): void {
    void close(false);
    onaction(id);
  }
  function onfocusout(e: FocusEvent): void {
    if (open && !(e.relatedTarget instanceof Node && root?.contains(e.relatedTarget))) open = false;
  }
</script>

<div class="line pickfield" bind:this={root} {onfocusout}>
  <span id={`${uid}-label`} data-hint={hint || undefined}>{label}</span>
  <button
    bind:this={button}
    type="button"
    class="current"
    class:empty={current === ''}
    data-field={name}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-labelledby={`${uid}-label ${uid}-value`}
    data-hint={open ? undefined : hint || undefined}
    {disabled}
    onclick={() => (open = !open)}
  >
    <span id={`${uid}-value`}>{current === '' ? placeholder : markHidden(current)}</span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>
  {#if open}
    <div class="panel">
      <PickList
        {options}
        {actions}
        selected={value ? [value] : []}
        {searchLabel}
        {emptyLabel}
        {hint}
        {name}
        autofocus
        onpick={pick}
        onaction={act}
        onescape={() => void close(true)}
      />
    </div>
  {/if}
</div>

<style>
  .pickfield {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .current {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    text-align: start;
    width: 100%;
    min-height: 2rem;
    /* It stands among the inputs of the form and looks like one of them, not like a button of an action. */
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.5rem;
  }
  .current:disabled {
    opacity: 0.7;
  }
  /* Nothing chosen: the words say it in italics; a grey of its own would fall below the contrast on a disabled button. */
  .current.empty {
    font-style: italic;
  }
  .panel {
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
</style>
