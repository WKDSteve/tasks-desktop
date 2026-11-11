import type { NavHistory, NavWindow } from 'appkit-ui/nav';
import type { App } from './app.svelte';
import { installAppHistory, placeAddress } from './history';

/**
 * Make every change of the view or of the open task an entry of the history of the tab, with the place in the
 * address (history.ts); a change of the filter is written into the entry of the place.
 */
export function trackHistory(
  app: App,
  win: NavWindow & { history: NavHistory; location: { pathname: string; search: string; hash: string } },
): () => void {
  const history = installAppHistory(
    app,
    win,
    placeAddress(win.location, () => app.oneTask),
  );
  const stopEffect = $effect.root(() => {
    $effect(() => {
      // Only the place and what it keeps are watched; reading the list for it (a vanished task) happens untracked.
      void app.view;
      void app.selectedId;
      void app.peeking;
      void app.solo;
      void app.filter;
      void app.planChoice;
      void app.sort;
      void app.statsDim;
      void app.statsSort;
      history.sync();
    });
  });
  return () => {
    stopEffect();
    history.stop();
  };
}
