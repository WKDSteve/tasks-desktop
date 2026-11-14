// The third-party notices of the web pages. MIT and BSD ask for the notice in all copies, and tasks.html and
// engine-check.html are handed on one by one, so each page carries it as a comment; the same text as a file goes next to
// them in tasks-web. The versions come from the lockfile, so they cannot go stale:
//
//   node web/notices.mjs           (from ui/) write web/THIRD-PARTY-NOTICES.md
//   node web/notices.mjs --check   fail when that file is not what the lockfile gives (a test does the same)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const NOTICES_FILE = join(here, 'THIRD-PARTY-NOTICES.md');

const BOTH = 'tasks.html, engine-check.html';
const PAGE = 'tasks.html';

/**
 * What the pages bundle. `pkg` is the name in the lockfile, which gives the version; a part that is no package of its
 * own says its version in `version`.
 */
export const COMPONENTS = [
  { name: 'Lua (compiled to WebAssembly by wasmoon)', version: '5.4', license: 'MIT', in: BOTH, copyright: 'Copyright (C) 1994-2024 Lua.org, PUC-Rio.' },
  { name: 'wasmoon', pkg: 'wasmoon', license: 'MIT', in: BOTH, copyright: 'Copyright (c) 2023 Gabriel Francisco.' },
  { name: 'Emscripten runtime (JavaScript glue inside wasmoon)', version: 'as built by wasmoon', license: 'MIT', in: BOTH, copyright: 'Copyright (c) 2010-2014 Emscripten authors, see the AUTHORS file of Emscripten.' },
  { name: 'inspect.lua (as vim.inspect of Neovim 0.12.2)', version: '3.1.0', license: 'MIT', in: BOTH, copyright: 'Copyright (c) 2013 Enrique Garcia Cota.' },
  { name: 'Svelte (client runtime)', pkg: 'svelte', license: 'MIT', in: PAGE, copyright: 'Copyright (c) 2016-2025 Svelte Contributors.' },
  { name: 'clsx (dependency of the Svelte runtime)', pkg: 'clsx', license: 'MIT', in: PAGE, copyright: 'Copyright (c) Luke Edwards (lukeed.com).' },
  { name: 'markdown-it', pkg: 'markdown-it', license: 'MIT', in: PAGE, copyright: 'Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.' },
  { name: 'linkify-it', pkg: 'linkify-it', license: 'MIT', in: PAGE, copyright: 'Copyright (c) 2015 Vitaly Puzrin.' },
  { name: 'mdurl', pkg: 'mdurl', license: 'MIT', in: PAGE, copyright: 'Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin; parts Copyright Joyent, Inc. and other Node contributors.' },
  { name: 'uc.micro', pkg: 'uc.micro', license: 'MIT', in: PAGE, copyright: 'Copyright Mathias Bynens.' },
  { name: 'punycode.js', pkg: 'punycode.js', license: 'MIT', in: PAGE, copyright: 'Copyright Mathias Bynens.' },
  { name: 'modern-screenshot', pkg: 'modern-screenshot', license: 'MIT', in: PAGE, copyright: 'Copyright (c) 2021-present wxm.' },
  // jsdom (a tool of the tests) has an `entities` of its own: the one in the page is markdown-it's.
  { name: 'entities', pkg: 'entities', via: 'markdown-it', license: 'BSD-2-Clause', in: PAGE, copyright: 'Copyright (c) Felix Boehm.' },
];

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const BSD2 = `Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list
of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or other
materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR
BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
ANY WAY OUT OF THE USE OF THIS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The version a package has in `pnpm-lock.yaml`. A package that is not there, or there twice, stops the build: which of
 * two versions a page bundles cannot be guessed. `via` names the bundled package that brings it in: then the version is
 * the one that package depends on, whatever other versions a tool of the build has beside it (jsdom, for the tests,
 * has its own `entities`).
 */
export function versionIn(lock, pkg, via) {
  const packages = lock.slice(lock.indexOf('\npackages:'), lock.indexOf('\nsnapshots:'));
  const found = [...packages.matchAll(new RegExp(`^  '?${literal(pkg)}@(\\d[^:'(]*)'?:`, 'gm'))].map((m) => m[1]);
  if (found.length === 1) return found[0];
  if (via === undefined || found.length === 0) {
    throw new Error(`notices: ${pkg} is ${found.length} times in the lockfile, expected once`);
  }
  // The entry of `via` among the snapshots: its lines are indented deeper than its own, up to the next entry.
  const lines = lock.slice(lock.indexOf('\nsnapshots:')).split(/\r?\n/);
  const head = new RegExp(`^  '?${literal(via)}@${literal(versionIn(lock, via))}[^:]*'?:`);
  const start = lines.findIndex((line) => head.test(line));
  const wanted = new RegExp(`^      '?${literal(pkg)}'?: (\\d[^\\s(]*)`);
  let version;
  for (let i = start + 1; start >= 0 && i < lines.length && !/^  \S/.test(lines[i]); i += 1) {
    const hit = wanted.exec(lines[i]);
    if (hit) version = hit[1];
  }
  if (version === undefined || !found.includes(version)) {
    throw new Error(`notices: ${pkg} is ${found.length} times in the lockfile, and ${via} names none of them`);
  }
  return version;
}

/** The components with their versions. */
export function resolved(lock) {
  return COMPONENTS.map((c) => ({ ...c, version: c.pkg ? versionIn(lock, c.pkg, c.via) : c.version }));
}

/** The notices as plain text, without markup and without `--`: this is what goes into a comment of a page. */
export function noticesText(lock) {
  const all = resolved(lock);
  return [
    'Third-party notices. This page bundles:',
    ...all.map((c) => `  ${c.name} ${c.version}, ${c.license}, in ${c.in}. ${c.copyright}`),
    '',
    'First-party code in the pages, all MIT, Copyright (c) 2026 Stefan Bartl: tasks-desktop, appkit, tasks.nvim, lib.nvim.',
    '',
    'MIT License (all components above except entities)',
    '',
    MIT,
    '',
    'BSD 2-Clause License (entities)',
    '',
    BSD2,
  ].join('\n');
}

/** The notices as the file next to the pages. */
export function noticesMarkdown(lock) {
  const all = resolved(lock);
  return `${[
    '# Third-party notices',
    '',
    'The pages in this repository are built by [tasks-desktop](https://github.com/WKDSteve/tasks-desktop) and bundle the code',
    'below; each page also carries this text as a comment. The versions come from the lockfile of the build (`ui/web/notices.mjs`).',
    '',
    '| Component | Version | License | In |',
    '| --- | --- | --- | --- |',
    ...all.map((c) => `| ${c.name} | ${c.version} | ${c.license} | ${c.in} |`),
    '',
    'First-party code in the pages, all MIT, Copyright (c) 2026 Stefan Bartl: tasks-desktop (UI, worker, `vim` shim), appkit',
    '(`appkit-ui`), and the Lua engine tasks.nvim with lib.nvim. The case-mapping table of the `vim` shim is generated from',
    'Neovim `vim.fn.tolower` (data, not code). `probe.html` contains no third-party code.',
    '',
    '## Copyright notices',
    '',
    ...all.map((c) => `- ${c.name}: ${c.copyright}`),
    '',
    '## MIT License (all components above except entities)',
    '',
    MIT,
    '',
    '## BSD 2-Clause License (entities)',
    '',
    BSD2,
  ].join('\n')}\n`;
}

export const readLock = () => readFileSync(join(here, '..', 'pnpm-lock.yaml'), 'utf8').replaceAll('\r\n', '\n');

function main() {
  const text = noticesMarkdown(readLock());
  if (process.argv.includes('--check')) {
    if (readFileSync(NOTICES_FILE, 'utf8').replaceAll('\r\n', '\n') !== text) {
      console.error('notices: web/THIRD-PARTY-NOTICES.md is not what the lockfile gives: run node web/notices.mjs');
      process.exit(1);
    }
    return;
  }
  writeFileSync(NOTICES_FILE, text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
