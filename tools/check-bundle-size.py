#!/usr/bin/env python3
"""Fails when the main chunk of the built page is above its budget.

The page is served from the binary, so its size is parse time at every start, not load time. Without a number it only
grows: rarely used views and dialogs load on demand (`ui/src/views/Lazy.svelte`), and a static import of one of them
brings it back into the main chunk, which is what this catches.

usage: check-bundle-size.py [--dist ui/dist] [--budget-kb 650]
"""
import argparse
import pathlib
import re
import sys

BUDGET_KB = 650


def main_chunk(dist: pathlib.Path) -> pathlib.Path:
    """The script the page starts with: the one `index.html` names."""
    html = (dist / 'index.html').read_text(encoding='utf-8')
    found = re.search(r'<script[^>]+src="\./(assets/[^"]+\.js)"', html)
    if not found:
        raise ValueError(f'{dist}/index.html names no script')
    return dist / found.group(1)


def check(dist: pathlib.Path, budget_kb: int) -> tuple[bool, str]:
    chunk = main_chunk(dist)
    size = chunk.stat().st_size / 1000
    words = f'{chunk.name}: {size:.0f} kB, budget {budget_kb} kB'
    return size <= budget_kb, words


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
