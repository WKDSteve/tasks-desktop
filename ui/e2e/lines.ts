// The lines of a log that another process appends to while a test reads it (editor.log, docmap.log of the stand-ins
// for Neovim, the file manager and docmap-desktop). A line counts once its newline is written: a line that is half
// written when the file is read is left for the next look, instead of being taken with fields missing.
import { existsSync, readFileSync } from 'node:fs';

export function completeLines(text: string): string[] {
  const end = text.lastIndexOf('\n');
  if (end < 0) return [];
  return text
    .slice(0, end)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l !== '');
}

/** The finished lines of the log at `path`; none while it does not exist. */
export function logLines(path: string): string[] {
  return existsSync(path) ? completeLines(readFileSync(path, 'utf8')) : [];
}
