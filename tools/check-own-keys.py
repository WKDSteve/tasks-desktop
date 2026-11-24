#!/usr/bin/env python3
"""Fail when the page reads or writes a plain object by a key that may be foreign (`__proto__`, `constructor`).

A key that comes from data (a field name of a vault file, an area, a category, a parameter name) must not be looked up
with the `in` operator (`'constructor' in {}` is true) and must not be assigned into a plain `{}` (`obj['__proto__'] = x`
sets the prototype of `obj` and the entry is gone). Two things are reported in the tracked .ts and .svelte files under
the given root (tests excluded):

  * `name in object` with a plain name on the left (`k in params`): use `Object.hasOwn(object, name)` or a `Map`;
  * a variable declared as a `Record<...>` holding `{}` and assigned by a computed key (`counts[bucket] = ...`):
    make it a `Map`, make it without a prototype (`Object.create(null)`), or use `setOwn` of `lib/own.ts`.

A place that is safe for a stated reason (the key can never be a foreign one: a task id has a slash) is listed in
`tools/own-keys.allow`, one `path:name  reason` per line (`path` below the repository, `name` the variable, or `in`
for the operator in that file). A line with no reason is refused, and so is a line that is no longer needed.

    python tools/check-own-keys.py --root ui/src

Exit 0: clean. Exit 1: the places are listed. Exit 2: git could not be asked, or no file was found.
"""

import argparse
import os
import re
import subprocess
import sys

ALLOW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "own-keys.allow")

# `for (const k in obj)` and `for (k in obj)` are loops, not the operator.
IN_OPERATOR = re.compile(
    r"(?<!\w)(?<!for \()(?<!for \(const )(?<!for \(let )([A-Za-z_]\w*)\s+in\s+([A-Za-z_][\w.]*)"
)
RECORD_DECL = re.compile(r"\b(?:const|let)\s+([A-Za-z_]\w*)\s*:\s*Record<[^=;]*>\s*=\s*\{\s*\}")
COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
STRING = re.compile(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`", re.S)


def tracked(root):
    out = subprocess.run(["git", "ls-files", "--", root], capture_output=True, text=True, check=False)
    if out.returncode != 0:
        print("git could not list the files", file=sys.stderr)
        sys.exit(2)
    return [
        p
        for p in out.stdout.split()
        if p.endswith((".ts", ".svelte")) and not re.search(r"\.test\.|\.d\.ts$|/e2e", p)
    ]


def allowed():
    entries = {}
    if not os.path.exists(ALLOW_FILE):
        return entries
    for number, line in enumerate(open(ALLOW_FILE, encoding="utf-8"), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        place, _, reason = line.partition(" ")
        if not reason.strip():
            print(f"{ALLOW_FILE}:{number}: {place} has no reason", file=sys.stderr)
            sys.exit(1)
        entries[place] = reason.strip()
    return entries


def blank(match):
    return re.sub(r"[^\n]", " ", match.group(0))


def code_of(text):
    """The text with comments and the inside of strings blanked, so that the lines stay."""
    text = COMMENT.sub(blank, text)
    return STRING.sub(lambda m: m.group(0)[0] + re.sub(r"[^\n]", " ", m.group(0)[1:-1]) + m.group(0)[-1], text)


def script_only(text):
    """A Svelte file: only the <script> blocks are code; the markup is text (`in the list`) and stays blank."""
    out = list(re.sub(r"[^\n]", " ", text))
    for m in re.finditer(r"<script\b[^>]*>(.*?)</script\s*>", text, re.S | re.I):
        out[m.start(1) : m.end(1)] = list(m.group(1))
    return "".join(out)


def check(path, text, allow, used):
    found = []
    if path.endswith(".svelte"):
        text = script_only(text)
    code = code_of(text)
    for m in IN_OPERATOR.finditer(code):
        key = f"{path}:in"
        line = code.count("\n", 0, m.start()) + 1
        if key in allow:
            used.add(key)
        else:
            found.append(f"{path}:{line}: `{m.group(1)} in {m.group(2)}`: use Object.hasOwn or a Map")
    for decl in RECORD_DECL.finditer(code):
        name = decl.group(1)
        assign = re.compile(
            r"(?<![\w.])" + re.escape(name) + r"\[\s*[A-Za-z_][^\]\n]*\]\s*(?:[-+*/|&?]{0,2}=)(?!=)"
        )
        m = assign.search(code, decl.end())
        if m is None:
            continue
        key = f"{path}:{name}"
        line = code.count("\n", 0, m.start()) + 1
        if key in allow:
            used.add(key)
        else:
            found.append(
                f"{path}:{line}: `{name}[...] =` into a plain record: use a Map, Object.create(null) or setOwn"
            )
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    root = parser.parse_args().root.replace("\\", "/")
    files = tracked(root)
    if not files:
        print(f"no .ts or .svelte file under {root}", file=sys.stderr)
        return 2
    allow = allowed()
    used = set()
    found = []
    for path in files:
        found += check(path, open(path, encoding="utf-8").read(), allow, used)
    for k in allow:
        if k not in used:
            found.append(f"{ALLOW_FILE}: {k} is listed but no longer needed")
    for line in found:
        print(line)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
