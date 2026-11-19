// The address to join a meeting (`online` of a meeting entry) as the page opens it (concept 4.6): only `https://`, with a
// host, no user or password in it, on one line and not endless. Anything else (`http://`, `msteams:`, `zoommtg:`,
// `javascript:`, a path) gives no link: the page shows the text and the service, nothing to click. The page opens the
// link with `target="_blank" rel="noopener noreferrer"` (the system's browser, which hands Teams or Zoom on itself).

/** The longest address the page opens. */
export const MAX_JOIN_LINK = 2000;

/** The address to open for `online`, or `null` when it is none the page opens. */
export function joinLink(online: unknown): string | null {
  if (typeof online !== 'string') return null;
  const text = online.trim();
  if (text === '' || text.length > MAX_JOIN_LINK) return null;
  // No blank or control character anywhere: an address a person copies has none, and one may hide what follows.
  if (/[\s\p{Cc}]/u.test(text)) return null;
  if (!/^https:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
  return url.href;
}
