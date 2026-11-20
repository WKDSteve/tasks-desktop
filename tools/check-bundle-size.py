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

usage: check-bundle-size.py [--dist ui/dist] [--budget-kb 1095]
"""
import argparse
import pathlib
import re
import sys

BUDGET_KB = 1095

# `from"./x.js"` and `import"./x.js"` of a built chunk: a static import. A dynamic `import("./x.js")` has a bracket.
STATIC_IMPORT = re.compile(r'(?:from|import)\s*"\./([^"]+\.js)"')


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


def check(dist: pathlib.Path, budget_kb: int) -> tuple[bool, str]:
    chunks = startup_chunks(dist)
    main = main_chunk(dist)
    total = sum(chunks.values()) / 1000
    words = f'{main.name}: {chunks[main.name] / 1000:.0f} kB, with {len(chunks) - 1} chunks it imports at the start {total:.0f} kB, budget {budget_kb} kB'
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
