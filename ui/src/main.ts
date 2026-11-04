import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { Hub } from './lib/api';
import { App as AppState, TOKEN_KEY, type Env } from './lib/app.svelte';
import { indexedDbStore } from './lib/cache';
import { copyText, printSheet, saveText } from './lib/exportDom';
import { translate } from './lib/i18n';
import { trackHistory } from './lib/trackHistory.svelte';
import { followTaskRoute } from './lib/followRoute.svelte';
import { placeAddress } from './lib/history';
import { takeInjected } from './lib/inject';
import { routedTask } from './lib/route';
import { askForSession, shareSession, type ChannelLike } from 'appkit-ui/handoff';
import { placeOf } from 'appkit-ui/nav';
import { takePairingCode } from 'appkit-ui/pair';
import { installTooltips } from 'appkit-ui/tooltip';

// The native window has no address bar: its shell hands the code over as `window.__TASKS_PAIR`
// (an initialization script). The page takes it once and removes it.
const injected = takeInjected(window, '__TASKS_PAIR');

// The code leaves the address bar before anything else happens; the place of the page in the fragment stays (a reload,
// a link opened in a new tab: history.ts).
const code = takePairingCode(window.location, window.history, injected, { keepRoute: true });
// A window a task was detached into names the task in the fragment (route.ts).
const routed = routedTask(window.location.hash);
// A view (and the task open in it) named by the address: a link opened in a new tab, a reload.
const place = placeOf(placeAddress(window.location, () => false));

// The tabs of the page hand their session to a new one (appkit-ui/handoff). A browser without the channel pairs as before.
let channel: ChannelLike | null = null;
try {
  channel = new BroadcastChannel(`${TOKEN_KEY}.handoff`);
} catch {
  channel = null;
}

const fetchFn: typeof fetch = (input, init) => window.fetch(input, init);
const env: Env = {
  hub: new Hub(fetchFn),
  cache: indexedDbStore(window.indexedDB),
  session: window.sessionStorage,
  prefs: window.localStorage,
  preferredLanguages: navigator.languages,
  now: () => Date.now(),
  fetchFn,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  reload: () => window.location.reload(),
  // The same page in a new window. Not `noopener`: the browser then gives the new window a copy of this tab's
  // session storage, and with it the session (it is paired without a new code).
  openWindow: (route) => window.open(`${window.location.pathname}${window.location.search}${route}`, '_blank') !== null,
  ...(channel
    ? {
        askSession: (onLate) =>
          askForSession({
            channel: channel as ChannelLike,
            random: () => crypto.getRandomValues(new Uint8Array(16)),
            setTimeout: (run, ms) => window.setTimeout(run, ms),
            clearTimeout: (handle) => window.clearTimeout(handle as number),
            onLate,
          }),
      }
    : {}),
  out: {
    save: (name, text, type) => saveText(document, name, text, type),
    copy: (text) => copyText(navigator.clipboard, text),
    print: (sheet) => printSheet(document, window, sheet),
  },
};

const state = new AppState(env);
if (place !== null) state.openPlace(place.view, place.selectedId);
if (routed !== null) state.openRoute(routed);
if (channel) {
  shareSession({
    channel,
    token: () => {
      try {
        return window.sessionStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    },
    live: () => state.stream.open,
  });
}
// The popup is the kit's; the name of its region is this page's word, in the page's language.
installTooltips(document, window, { regionLabel: () => translate(state.lang, 'hint.region') });
mount(App, { target: document.getElementById('app') as HTMLElement, props: { app: state, code } });

// Back and Forward of the browser walk through the views and the open tasks.
trackHistory(state, window);
// A window of one task lets go of its fragment when it lets go of the task.
followTaskRoute(state, window);

// A link from `tasks-hub open` pasted into a tab that is already open changes only the fragment: no reload.
window.addEventListener('hashchange', () => {
  // A place typed into the address is not the pairing's: it stays (the history goes to it).
  const later = takePairingCode(window.location, window.history, undefined, { keepRoute: true });
  if (later) state.offerCode(later);
});
