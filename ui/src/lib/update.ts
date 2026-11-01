// Updating the page of the web variant (a file opened from disk). The page makes no request (its CSP forbids one) and
// cannot start a program, so it cannot fetch a newer build itself: the folder it was opened from is a clone of the
// repository tasks-web, and `git pull` there brings the newer file. The start script of tasks-web does that before it
// opens the page (`start-tasks.cmd`, or `start-tasks.cmd /update` for the pull alone); the page gives the lines.

/**
 * The folder of the file a `file:` address names, as Windows writes it (`E:\repos\tasks-web`, `\\host\share\x` for a
 * network path); null for another address or one that cannot be read.
 */
export function folderOf(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:') return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const cut = path.lastIndexOf('/');
  if (cut <= 0) return null;
  path = path.slice(0, cut);
  if (url.host !== '') return `\\\\${url.host}${path.replaceAll('/', '\\')}`;
  // `/E:/repos/x` is a drive; anything else is a path of a system without drives, kept as it is.
  if (/^\/[A-Za-z]:/.test(path)) return path.slice(1).replaceAll('/', '\\');
  return path;
}

/** The two ways to update: the start script of the folder (pull and check, start nothing), or git itself. */
export function updateLines(folder: string): { script: string; git: string } {
  const sep = folder.includes('\\') || /^[A-Za-z]:/.test(folder) ? '\\' : '/';
  return {
    script: `"${folder}${sep}start-tasks.cmd" /update`,
    git: `git -C "${folder}" pull --ff-only`,
  };
}
