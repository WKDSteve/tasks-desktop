<script lang="ts" generics="Extra extends Record<string, unknown> = Record<never, never>">
  // A view or dialog that most sessions never open, loaded when it is first wanted (`when`), and kept from then on: a
  // dialog that goes away with its element would not give the focus back.
  import { untrack, type Component } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate } from '../lib/i18n';

  let {
    app,
    load,
    when = true,
    extra,
    onfailed,
  }: {
    app: App;
    /** A `loader` (`./loader.ts`) that has its module already is drawn at once, in the frame that wanted it. */
    load: (() => Promise<{ default: Component<{ app: App } & Extra> }>) & {
      loaded?: () => { default: Component<{ app: App } & Extra> } | undefined;
    };
    when?: boolean;
    /** What the loaded component takes besides `app` (a dialog whose state the page holds: `open`, `onclose`). */
    extra?: Extra;
    /** The chunk did not come: whoever holds the state that wanted it takes it back, so that asking again loads again. */
    onfailed?: () => void;
  } = $props();

  // A module that has come is drawn without the turn the promise would take, but only once it is wanted: a dialog is
  // not drawn before it is opened.
  const ready = () => (when ? (load.loaded?.()?.default ?? null) : null);
  let Loaded = $state.raw<Component<{ app: App } & Extra> | null>(untrack(ready));
  // The hub may have been stopped or replaced since the page came (the name of a chunk is that of its build): only
  // loading the page anew helps, and the page says so instead of staying empty.
  let failed = $state(false);
  $effect(() => {
    if (!when || Loaded) return;
    // Wanted (again): a notice of an earlier attempt goes, this one writes its own.
    failed = false;
    const at = untrack(ready);
    if (at) {
      Loaded = at;
      return;
    }
    load().then(
      (module) => {
        Loaded = module.default;
      },
      () => {
        failed = true;
        onfailed?.();
      },
    );
  });
</script>

{#if Loaded}
  <Loaded {app} {...(extra ?? ({} as Extra))} />
{:else if failed}
  <p class="failed" role="alert">
    {translate(app.lang, 'lazy.failed')}
    <button type="button" onclick={() => location.reload()}>{translate(app.lang, 'lazy.reload')}</button>
    <!-- Closed only where somebody takes the state back: a view that did not load would stay empty without a word. -->
    {#if onfailed}<button type="button" class="dismiss" onclick={() => (failed = false)}>{translate(app.lang, 'kit.dismiss')}</button>{/if}
  </p>
{/if}

<style>
  .failed {
    margin: 1rem;
    color: var(--text);
  }
  .failed button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }
</style>
