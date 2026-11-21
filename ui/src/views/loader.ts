/**
 * A loader of a chunk that remembers what it loaded (`Lazy.svelte`). A view switched to a second time is drawn in the
 * same frame as its heading: `Lazy` takes the module at once instead of waiting a turn for the promise. And a view that
 * is opened often (the board) is fetched when the page has nothing else to do (`preload`), so the first open does not
 * show an empty page while its chunk comes either.
 */
export interface Loader<M> {
  (): Promise<M>;
  /** The module, once it has come; `undefined` before. */
  loaded(): M | undefined;
}

export function loader<M>(load: () => Promise<M>): Loader<M> {
  let pending: Promise<M> | null = null;
  let done: M | undefined;
  const ask = (() => {
    pending ??= load().then(
      (module) => {
        done = module;
        return module;
      },
      (error: unknown) => {
        // A chunk that did not come is asked for again on the next call (`Lazy` offers to reload the page).
        pending = null;
        throw error;
      },
    );
    return pending;
  }) as Loader<M>;
  ask.loaded = () => done;
  return ask;
}

/**
 * Fetches the chunks when the page is idle: after the start, never in its way. A failure is no error here: the view
 * asks again when it is opened and says so there.
 */
export function preload(loaders: readonly Loader<unknown>[], idle: (run: () => void) => void = whenIdle): void {
  idle(() => {
    for (const load of loaders) load().catch(() => undefined);
  });
}

function whenIdle(run: () => void): void {
  // Safari (read-only in the browser matrix) has no `requestIdleCallback`: a short timeout instead.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 200);
}
