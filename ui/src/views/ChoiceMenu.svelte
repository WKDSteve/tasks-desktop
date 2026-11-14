<script lang="ts" module>
  /** One entry of a choice: what it does, or why it cannot be chosen now. */
  export interface Choice {
    id: string;
    label: string;
    /** Set: the entry cannot be chosen, and this says why (shown under its label and told when it is pressed). */
    reason?: string;
    onselect: () => void;
  }
</script>

<script lang="ts">
  // A button that opens a short choice under it (the buttons Video and Image of a task's detail). The popup stands
  // fixed in the window, so that a card that scrolls does not cut it; Escape, a press elsewhere and a scroll close it.
  // An entry that cannot be chosen stays in the order of the keyboard and says why: a greyed entry nobody can ask
  // about tells nothing.
  let {
    label,
    hint = undefined,
    choices,
    disabled = false,
    onblocked,
    name = undefined,
  }: {
    label: string;
    hint?: string | undefined;
    choices: readonly Choice[];
    disabled?: boolean;
    /** Called with an entry that cannot be chosen, when it is pressed. */
    onblocked: (choice: Choice) => void;
    /** A name for tests and styles (`data-choice`). */
    name?: string | undefined;
  } = $props();

  let open = $state(false);
  let details: HTMLDetailsElement | undefined = $state();
  let summary: HTMLElement | undefined = $state();
  let popup: HTMLDivElement | undefined = $state();
  let place = $state<{ left: number; top: number } | null>(null);
  const EDGE = 8;
  const GAP = 4;

  /** Under its button, kept inside the window; above it when there is no room below and there is above. */
  function placePopup(): void {
    if (!open || !summary || !popup) return;
    const button = summary.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = popup;
    const { clientWidth, clientHeight } = document.documentElement;
    const left = Math.max(EDGE, Math.min(button.left, clientWidth - EDGE - w));
    const below = button.bottom + GAP;
    const above = button.top - GAP - h;
    const wanted = below + h > clientHeight - EDGE && above >= EDGE ? above : below;
    place = { left, top: Math.max(EDGE, Math.min(wanted, clientHeight - EDGE - h)) };
  }
  function closeOnScroll(e: Event): void {
    if (open && popup && !(e.target instanceof Node && popup.contains(e.target))) open = false;
  }
  $effect(() => {
    if (!open) {
      place = null;
      return;
    }
    placePopup();
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', placePopup);
    return () => {
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', placePopup);
    };
  });
  // A button that is switched off while its choice is open (a write began) takes the choice with it.
  $effect(() => {
    if (disabled) open = false;
  });

  function run(choice: Choice): void {
    if (choice.reason !== undefined) {
      onblocked(choice);
      return;
    }
    open = false;
    summary?.focus();
    choice.onselect();
  }
  /** Escape closes the popup and gives the focus back to its button; the key is taken (the float stays open). */
  function closeOnEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    open = false;
    summary?.focus();
  }
  function closeOutside(e: Event): void {
    if (open && details && e.target instanceof Node && !details.contains(e.target)) open = false;
  }
</script>

<svelte:document onpointerdown={closeOutside} onfocusin={closeOutside} />

<details class="choice" data-choice={name} bind:open bind:this={details}>
  <!-- A summary cannot be `disabled`: switched off it is taken out of the order of the keyboard and does not open. -->
  <summary
    bind:this={summary}
    data-hint={hint}
    aria-disabled={disabled ? 'true' : undefined}
    tabindex={disabled ? -1 : undefined}
    onclick={(e) => {
      if (disabled) e.preventDefault();
    }}
    onkeydown={closeOnEscape}
  >
    {label} <span class="caret" aria-hidden="true">▾</span>
  </summary>
  <div
    class="popup"
    role="group"
    aria-label={label}
    bind:this={popup}
    class:placed={place !== null}
    style:left={place ? `${place.left}px` : undefined}
    style:top={place ? `${place.top}px` : undefined}
  >
    {#each choices as choice (choice.id)}
      <button
        type="button"
        data-choice-id={choice.id}
        aria-disabled={choice.reason !== undefined ? 'true' : undefined}
        onkeydown={closeOnEscape}
        onclick={() => run(choice)}
      >
        <span class="what">{choice.label}</span>
        {#if choice.reason !== undefined}<span class="why">{choice.reason}</span>{/if}
      </button>
    {/each}
  </div>
</details>

<style>
  .choice {
    display: inline-block;
  }
  summary {
    cursor: pointer;
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--surface-2);
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary[aria-disabled='true'] {
    opacity: 0.6;
    cursor: default;
  }
  .caret {
    color: var(--muted);
  }
  /* Measured once open (see `placePopup`); until then it is not seen, so it does not flash at the window's corner. */
  .popup {
    position: fixed;
    left: 0;
    top: 0;
    visibility: hidden;
    z-index: 20;
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 12rem;
    max-width: min(24rem, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 0.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .popup.placed {
    visibility: visible;
  }
  .popup button {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius);
    color: var(--text);
    padding: 0.3rem 0.5rem;
    cursor: pointer;
  }
  .popup button:hover,
  .popup button:focus-visible {
    background: var(--surface-2);
  }
  .popup button[aria-disabled='true'] {
    cursor: default;
  }
  .popup button[aria-disabled='true'] .what {
    color: var(--muted);
  }
  .why {
    color: var(--muted);
    font-size: 0.8rem;
    white-space: normal;
  }
</style>
