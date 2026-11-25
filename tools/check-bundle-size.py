#!/usr/bin/env python3
"""Fails when what the page loads at its start is above its budget.

The page is served from the binary, so its size is parse time at every start, not load time. Without a number it only
grows: rarely used views and dialogs load on demand (`ui/src/views/Lazy.svelte`), and a static import of one of them
brings it back into the start, which is what this catches.

What counts is the main chunk and every chunk it imports statically, however many (`from"./x.js"`): those are all
parsed before the page shows. The budget used to be on the main chunk alone, and that depended on the bundler: a chunk
that the main chunk and a lazy view share (`plan`, 12 kB) is a file of its own or part of the main chunk as the
heuristic of the bundler sees fit, and one harmless import moved 12 kB over the budget with nothing to show in the diff
(2026-11-18, tasks-desktop@33664fa). Counting the whole start makes that move no change.

The budget on 2026-11-19: the start is 1050 kB (main 640, i18n 361, the rest 49 in nine small shared chunks); the budget
leaves 10 kB. When the room is used up, the candidates in the order of their size: the language tables of `i18n` (the
other language on demand, 361 kB shared), then the views that are still static in `App.svelte`: `Detail` (67 kB source),
`ViewsView` (35), `ListView` (29), `Today` (26), `Capture` (25), `BoardView` (21).

Raised on 2026-11-19 to 1085 kB with the making of meetings (tasks-desktop/meetings-anlegen): the start is 1074 kB
(main 658, i18n 373). The form, the page and the section of a task load on demand; what grew is the words of the
meetings in both languages (12 kB of i18n) and the meetings of `App` (the form opened at once from the menu, the
palette and a task). The language on demand is the next step (tasks-desktop/i18n-zweite-sprache-bei-bedarf-laden).

Raised on 2026-11-20 to 1095 kB with the meetings calendar (tasks-desktop/meetings-kalender): the start is 1088 kB. The
hour grid is a chunk of its own (`TimeGrid`, loaded when the week or the day is first shown); what grew the start is the
words of the calendar and the timeline in both languages (about 5 kB of i18n) and three small methods of `App`. The
language on demand is still the next step.

Raised on 2026-11-20 to 1110 kB with the images of the texts (tasks-desktop/inline-bilder-svg-und-icons): the start is
1104 kB. The images stand in the rows and in the detail, which the start draws: the store of the blob addresses, the
icon, the cover and the larger view (8 kB in a shared chunk) and their words in both languages; loading the larger view
on demand would save less than the 9 kB over the budget.

Raised on 2026-11-20 to 1116 kB with the minutes of meetings (tasks-desktop/meetings-mitschrift): the start is 1111 kB.
The minutes are a component of the meeting page, which is loaded on demand; what grew the start is their words and
hints in both languages (about 4 kB of i18n) and the shortcuts and drafts of `App`. The language on demand
(tasks-desktop/i18n-zweite-sprache-bei-bedarf-laden, about 190 kB) is overdue: the next raise should be that instead.

Raised on 2026-11-20 to 1118 kB with the whiteboard (tasks-desktop/meetings-board-ink): the start is 1117 kB (975 bytes
over). The drawing surface and its model (16 kB) are a chunk of their own, loaded when a board is opened; what grew the
start is the board button of the attach bar (with its lazy load), the save of a board in `App` and `Hub`, and three
words in both languages. Nothing of it could move out without leaving the button out of the detail. The language on
demand is still the step that frees room for good.

Lowered on 2026-11-21 to 970 kB with the language on demand (tasks-desktop/i18n-zweite-sprache-bei-bedarf-laden): the
words of each language are a chunk of their own (`i18n-en` 161 kB, `i18n-de` 175 kB), and the page loads only the one it
shows, before it draws (`ui/src/main.ts`); the other comes when the person switches. The language is loaded by a dynamic
import, but it is parsed before the page shows, so it counts: the start is the main chunk and its static imports (782
kB) and the larger of the language chunks (175 kB), 957 kB, 160 kB less than the 1117 kB before. A page without a
language chunk is an error rather than a smaller start: the tables went back into the start, or got another name, and
the number would lie. The wait for the language is no top-level `await` in `main.ts`: with one, the bundler cut every
module a lazy chunk shares with the start out of the main chunk (51 chunks at the start instead of 18, 9 kB more). The
room of 13 kB is for the words and the logic of the next features; when it is used up, the candidates are the views
that are still static in `App.svelte` (see above), not a higher budget.

Room made on 2026-11-21 (tasks-desktop/start-budget-fast-voll-969-6-von-970-kb-eine-statische): the start had reached
969.6 kB. The board and the saved views (`BoardView`, `ViewsView` with the groups and the matrix of the kit) load on
demand: they are opened often, but Today and the list are what the page starts with. The start is 931 kB (main 528).
So that they do not flicker for it, their loader remembers its module (`ui/src/views/loader.ts`: a view opened again is
drawn in the frame of its heading) and the page fetches them when it is idle after its start, so the first open draws
at once too (`ui/e2e/lazy-views.spec.ts`). Lowered after it to 945 kB (decision of 2026-11-21,
`tasks-desktop/start-budget-nach-dem-nachladen-von-board-und-ansichten`): about 14 kB of room as before, so growth shows
early; the next candidates to load on demand are named above.
On 2026-11-22 the four learning views (badges, rewards, competence catalogue, evidence; each a chunk of its own) took
the start to 947 kB with what stays in it of them (the list of their chunks, their names in the menu, the branches of
`App`). `InboxView` loads on demand since, fetched when idle like the board: the start is 941 kB (main 529).
The candidates left in `App.svelte`: `Detail`, `ListView`, `Today`, `Capture` (all drawn at the start or from every
view).

On 2026-11-23 the start stood at 944.9 kB, 53 bytes below the budget, and the summary of a hand-over (what the page keeps
of it: the call that starts the watch, its words in German, the dialog's title) took it to 945.4 kB. Its watch and its
checks load on demand (`ui/src/lib/handoffSummary.ts`); the rest could not move out. Raised by 1 kB to 946, not more,
so growth still shows early; the candidates to load on demand are those named above.

On 2026-11-24 the contacts (Office concept, wave 3; tasks-desktop/kontakte-im-reiter-office-liste-seite-und-formular)
took the start to 949.2 kB. The list, the page, the form, their words and their work (`contactsApp.ts`) and the refused
changes of a contact (`contactConflicts.ts`) are chunks of their own; what stays in the start is what the menu bar and
the state need: the entry and the action in the tab Office, the view in the list of routes and the palette, the state
of the form and of the open page, the two reads of the hub, the way back of a contact write and five words in each
language. Raised by 4 kB to 950 (the cheap trims were made: the work of the views out of `App`, one path builder for the
reads of the hub, one branch for the three inverses).

On 2026-11-24 the web-platform rules took the start to 955 kB: `translate` and `spellcheck` on 160 elements and fields (the
templates carry them), the info buttons in the heads of six dialogs with their twelve words, the question before a dialog
with typed text is left (`leaveGuard`, `LeaveAsk`), the errors at the fields of three forms, and `numbers.ts`. All of it is
what the first screen draws or what a dialog needs when it opens, and the dialogs are in the start. Raised by 8 kB to 958.

On 2026-11-25 the tab Lists (checklists; tasks-desktop/reiter-checklist-mehrere-listen-mit-filter-und-export) and the
recording with the microphone took the start to 962 kB: the tab in the menu bar, its route, two reads of the hub, the
words of the tab and of the recording, and the recording in `AttachBar`. The view, its entry and their words are chunks
of their own. `AttachBar` (the buttons of the detail that attach a file: camera, screen, microphone, board) loads on
demand since (`ui/src/views/attachLoader.ts`), fetched when the page is idle like the board: the start is 949 kB.

usage: check-bundle-size.py [--dist ui/dist] [--budget-kb 958]
"""
import argparse
import pathlib
import re
import sys

BUDGET_KB = 958

# `from"./x.js"` and `import"./x.js"` of a built chunk: a static import. A dynamic `import("./x.js")` has a bracket.
STATIC_IMPORT = re.compile(r'(?:from|import)\s*"\./([^"]+\.js)"')
# The words of one language (`ui/src/lib/i18n-de.ts`): loaded on demand, but one of them before the page shows. The
# languages are named: the hash of the shared `i18n-<hash>.js` may itself start with two letters and a dash.
LANGUAGE_CHUNK = re.compile(r'^i18n-(?:de|en)-[A-Za-z0-9_-]+\.js$')


def main_chunk(dist: pathlib.Path) -> pathlib.Path:
    """The script the page starts with: the one `index.html` names."""
    html = (dist / 'index.html').read_text(encoding='utf-8')
    found = re.search(r'<script[^>]+src="\./(assets/[^"]+\.js)"', html)
    if not found:
        raise ValueError(f'{dist}/index.html names no script')
    return dist / found.group(1)


def startup_chunks(dist: pathlib.Path) -> dict[str, int]:
    """The main chunk and every chunk it imports statically, down the chain, with their sizes in bytes."""
    found: dict[str, int] = {}
    pending = [main_chunk(dist)]
    while pending:
        chunk = pending.pop()
        if chunk.name in found:
            continue
        found[chunk.name] = chunk.stat().st_size
        pending.extend(chunk.parent / name for name in STATIC_IMPORT.findall(chunk.read_text(encoding='utf-8')))
    return found


def language_chunk(dist: pathlib.Path) -> pathlib.Path:
    """The largest of the language chunks: the page parses one of them before it shows, the larger is the worst case."""
    found = [path for path in (dist / 'assets').iterdir() if LANGUAGE_CHUNK.match(path.name)]
    if not found:
        raise ValueError(f'{dist}/assets has no language chunk (i18n-<lang>-*.js): the start would be counted without its words')
    return max(found, key=lambda path: path.stat().st_size)


def check(dist: pathlib.Path, budget_kb: int) -> tuple[bool, str]:
    chunks = startup_chunks(dist)
    language = language_chunk(dist)
    chunks.setdefault(language.name, language.stat().st_size)
    main = main_chunk(dist)
    total = sum(chunks.values()) / 1000
    words = f'{main.name}: {chunks[main.name] / 1000:.0f} kB, with {len(chunks) - 1} chunks of the start (language {language.name}): start {total:.0f} kB, budget {budget_kb} kB'
    if total > budget_kb:
        biggest = sorted(chunks.items(), key=lambda item: -item[1])[:6]
        words += '; the start is made of ' + ', '.join(f'{name} {size / 1000:.0f} kB' for name, size in biggest)
    return total <= budget_kb, words


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', default='ui/dist', type=pathlib.Path)
    parser.add_argument('--budget-kb', default=BUDGET_KB, type=int)
    args = parser.parse_args()
    good, words = check(args.dist, args.budget_kb)
    print(('ok: ' if good else 'too large: ') + words)
    return 0 if good else 1


if __name__ == '__main__':
    sys.exit(main())
