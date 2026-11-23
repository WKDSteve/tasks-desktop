<script lang="ts">
  // The task float of a learning point, over the list of the path (PathsView): the task, "done when" and the proof
  // asked for, which the plan holds as the block under the point (lib/exercise.ts), and a field for the result. The
  // texts are the plan's and untrusted: they are drawn only through the Markdown reader of the kit, never as HTML. Which
  // point may be learned without a result is the engine's rule (`learned` is refused there); the float asks first, so
  // that nothing is sent that would be refused, and shows the engine's reason in words when it refuses all the same.
  import { onMount, untrack } from 'svelte';
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { parseMarkdown } from 'appkit-ui/markdown';
  import Blocks from 'appkit-ui/Blocks.svelte';
  import type { App } from '../lib/app.svelte';
  import { parseExercise, type ExerciseAction, type ExerciseKey } from '../lib/exercise';
  import { exerciseWord, type ExerciseWord } from './pathExerciseWords';

  let {
    app,
    label,
    note,
    pointState,
    stateWord,
    marking,
    writable,
    busy,
    act,
    onclose,
  }: {
    app: App;
    /** The title of the point as shown. */
    label: string;
    /** The note of the point as the engine read it. */
    note: string | undefined;
    pointState: 'open' | 'learned' | 'seen' | 'dropped' | 'blocked' | undefined;
    stateWord: string;
    /** Whether the point has a mark of its own (a parent or a promoted point is not ticked here). */
    marking: boolean;
    /** Whether the engine takes notes (capability `node_note`): the result is part of the note. */
    writable: boolean;
    busy: boolean;
    /** Sends the action; the engine's refusal comes back as text, success as null. */
    act: (action: ExerciseAction) => Promise<string | null>;
    onclose: () => void;
  } = $props();

  const w = (key: ExerciseWord, params: Record<string, string | number> = {}) => exerciseWord(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  const parts = $derived(parseExercise(note));
  const hasTask = $derived(!!parts.aufgabe);
  const asksProof = $derived(!!parts.nachweis);
  // What is typed into the result: the result already in the plan to begin with (the float keeps what is typed while
  // the path is read again behind it).
  let draft = $state(untrack(() => parseExercise(note).ergebnis ?? ''));
  let missing = $state(false);
  let refusal = $state<string | null>(null);
  let sending = $state(false);

  const shown: ExerciseKey[] = ['aufgabe', 'fertig', 'nachweis'];

  onMount(() => {
    dialog?.showModal();
    // The focus goes to the field of the result where there is one, else to the button that closes.
    (dialog?.querySelector<HTMLElement>('textarea') ?? dialog?.querySelector<HTMLElement>('button'))?.focus();
  });

  async function run(action: ExerciseAction): Promise<void> {
    if (busy || sending) return;
    refusal = null;
    const text = draft.trim();
    if (action.state === 'learned' && asksProof && text === '') {
      missing = true;
      dialog?.querySelector<HTMLElement>('textarea')?.focus();
      return;
    }
    missing = false;
    sending = true;
    const why = await act({ ...action, ...(hasTask && text !== (parts.ergebnis ?? '') ? { result: text } : {}) });
    sending = false;
    if (why !== null) {
      refusal = why;
      return;
    }
    if (action.state !== undefined) dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="exercise"
  data-exercise
  use:closeOnBackdrop
  aria-labelledby="exercise-title"
  {onclose}
>
  <h3 id="exercise-title">{w('ex.title', { label })}</h3>
  <p class="state">{w('ex.state', { state: stateWord })}</p>
  {#if !hasTask}
    <p class="none" role="note">{w('ex.none')}</p>
  {:else}
    <dl class="parts">
      {#each shown as key (key)}
        {#if parts[key]}
          <div data-part={key}>
            <dt>{w(`ex.${key}` as ExerciseWord)}</dt>
            <dd class="prose"><Blocks blocks={parseMarkdown(parts[key]!)} headingBase={4} /></dd>
          </div>
        {/if}
      {/each}
    </dl>
    <form
      data-hint={w('ex.hint')}
      onsubmit={(e) => {
        e.preventDefault();
        void run({});
      }}
    >
      <label for="exercise-result">{w('ex.ergebnis')}</label>
      <textarea
        id="exercise-result"
        rows="5"
        bind:value={draft}
        readonly={!writable}
        aria-required={asksProof ? 'true' : undefined}
        aria-invalid={missing ? 'true' : undefined}
        aria-describedby={missing ? 'exercise-missing' : 'exercise-hint'}
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void run(marking && pointState !== 'learned' ? { state: 'learned' } : {});
          }
        }}
      ></textarea>
      <span id="exercise-hint" class="hint">{writable ? w('ex.ergebnis_hint') : w('ex.read_only')}</span>
      {#if missing}<span id="exercise-missing" class="missing" role="alert">{w('ex.required')}</span>{/if}
    </form>
  {/if}
  {#if refusal !== null}<p class="missing" role="alert" data-exercise-refusal>{refusal}</p>{/if}
  <div class="actions">
    {#if hasTask && writable}
      <button type="button" aria-disabled={busy || sending ? 'true' : undefined} onclick={() => void run({})}>{w('ex.save')}</button>
    {/if}
    {#if marking && pointState === 'learned'}
      <button type="button" aria-disabled={busy || sending ? 'true' : undefined} onclick={() => void run({ state: 'open' })}>{w('ex.untick')}</button>
    {:else if marking && (pointState === 'open' || pointState === 'seen' || pointState === 'blocked')}
      <button type="button" class="primary" data-exercise-learned aria-disabled={busy || sending ? 'true' : undefined} onclick={() => void run({ state: 'learned' })}
        >{hasTask && writable ? w('ex.learned') : w('ex.tick')}</button
      >
    {/if}
    <button type="button" data-exercise-close onclick={() => dialog?.close()}>{w('ex.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(40rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    overflow: auto;
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--backdrop) 45%, transparent);
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 1.05rem;
    overflow-wrap: anywhere;
  }
  .state,
  .hint,
  .none {
    color: var(--muted);
  }
  .state {
    margin: 0 0 0.5rem;
  }
  dl {
    margin: 0 0 0.75rem;
  }
  dt {
    font-weight: 600;
  }
  dd {
    margin: 0 0 0.5rem;
    overflow-wrap: anywhere;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  label {
    font-weight: 600;
  }
  textarea {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.4rem;
    resize: vertical;
  }
  .missing {
    color: var(--bad);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  @media (pointer: coarse) {
    button {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }
  }
</style>
