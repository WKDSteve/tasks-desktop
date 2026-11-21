// Every vitest file starts with both languages loaded: the page loads them on demand (i18n.ts), a test of a view or of
// the state switches the language and reads the words in the same tick. `i18n.lazy.test.ts` tests the loading itself
// on a fresh copy of the module.

import { provideLang } from './lib/i18n';
import de from './lib/i18n-de';
import en from './lib/i18n-en';

provideLang('en', en);
provideLang('de', de);
