#!/usr/bin/env python3
"""Build the phone page (tasks-mobile) of mobile.lock into ui/dist-mobile/, which build.rs embeds under /m/.

    python tools/build-mobile.py [--source DIR] [--out DIR]

Without --source it clones the repository of mobile.lock into target/mobile-src (a fresh clone each time, no
credentials: the repository is public) and checks out exactly the pinned commit; with --source it builds a checkout
that is there already (development) and says which commit that is. Then `pnpm install --frozen-lockfile` (the
quarantine of tasks-mobile's pnpm-workspace.yaml applies) and `pnpm build`, and the result is copied to the output
folder, which is emptied first. Every command is run with an argument list, never through a shell.

Exit 0: built. Exit 1: a step failed (said on stderr). Exit 2: mobile.lock cannot be read.
"""

import argparse
import re
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMIT = re.compile(r"^[0-9a-f]{40}$")
REPO = re.compile(r"^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
# The files of the page; anything else in the build is not taken.
TOP_FILES = ("index.html", "manifest.webmanifest", "sw.js")
SUB_DIRS = ("assets", "icons")
TIMEOUT_S = 600


def read_pins(path):
    """`repo` and `commit` of mobile.lock, checked; raises ValueError on anything else."""
    pins = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep:
            raise ValueError(f"not a key = value line: {line!r}")
        pins[key.strip()] = value.strip()
    repo, commit = pins.get("repo", ""), pins.get("commit", "")
    if not REPO.match(repo):
        raise ValueError(f"repo is not a GitHub https address: {repo!r}")
    if not COMMIT.match(commit):
        raise ValueError(f"commit is not a full commit id: {commit!r}")
    return repo, commit


def remove_tree(path):
    """Remove a folder, also files that are read-only: git marks its pack files so on Windows, and a second run must
    still clear the first clone."""

    def writable_then_again(func, target, _error):
        os.chmod(target, stat.S_IWRITE | stat.S_IREAD)
        func(target)

    shutil.rmtree(path, onexc=writable_then_again)


def run(args, cwd):
    print("+", " ".join(args), flush=True)
    # pnpm is a .cmd on Windows: found through shutil.which, still run without a shell.
    exe = shutil.which(args[0]) or args[0]
    subprocess.run([exe, *args[1:]], cwd=cwd, check=True, timeout=TIMEOUT_S)


def copy_page(dist, out):
    """Copy the files of the page from `dist` to `out` (emptied first); returns the copied relative paths."""
    dist, out = Path(dist), Path(out)
    if not (dist / "index.html").is_file():
        raise FileNotFoundError(f"no index.html in {dist}")
    if out.exists():
        remove_tree(out)
    out.mkdir(parents=True)
    copied = []
    for name in TOP_FILES:
        if (dist / name).is_file():
            shutil.copy2(dist / name, out / name)
            copied.append(name)
    for sub in SUB_DIRS:
        if not (dist / sub).is_dir():
            continue
        (out / sub).mkdir()
        for entry in sorted((dist / sub).iterdir()):
            if entry.is_file():
                shutil.copy2(entry, out / sub / entry.name)
                copied.append(f"{sub}/{entry.name}")
    return copied


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", help="a checkout of tasks-mobile to build instead of cloning the pin")
    parser.add_argument("--out", default=str(ROOT / "ui" / "dist-mobile"))
    args = parser.parse_args(argv)
    try:
        repo, commit = read_pins(ROOT / "mobile.lock")
    except (OSError, ValueError) as error:
        print(f"build-mobile: mobile.lock: {error}", file=sys.stderr)
        return 2
    try:
        if args.source:
            src = Path(args.source).resolve()
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=src, check=True, capture_output=True, text=True
            ).stdout.strip()
            if head != commit:
                print(f"build-mobile: {src} is at {head}, mobile.lock pins {commit}", file=sys.stderr)
        else:
            src = ROOT / "target" / "mobile-src"
            if src.exists():
                remove_tree(src)
            src.parent.mkdir(parents=True, exist_ok=True)
            run(["git", "clone", "--quiet", repo, str(src)], ROOT)
            run(["git", "-c", "advice.detachedHead=false", "checkout", "--quiet", commit], src)
        run(["pnpm", "install", "--frozen-lockfile"], src)
        run(["pnpm", "build"], src)
        copied = copy_page(src / "dist", args.out)
    except (OSError, subprocess.SubprocessError) as error:
        print(f"build-mobile: {error}", file=sys.stderr)
        return 1
    print(f"build-mobile: {len(copied)} files of {commit[:7]} in {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
