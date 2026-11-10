#!/usr/bin/env python3
"""Pack what the engine needs into one file for the program: Neovim, cut down, and tasks.nvim and lib.nvim.

    python tools/pack-engine.py --out dist/engine-bundle.bin [--cache target/engine-bundle]

Neovim comes from tools/nvim.lock, checked by its SHA256; of it only the program and `share/nvim/runtime/lua` are kept, in the
layout of the release, so that Neovim finds its runtime by where it stands. tasks.nvim and lib.nvim come from the commits
of engine.lock. `cargo build` with TASKS_HUB_ENGINE_BUNDLE=<the file> embeds it (crates/tasks-hub/src/bundle.rs).

The format is the one bundle.rs reads: gzip around a magic line and, per file, the length of its path (4 bytes), the path,
the length of its content (8 bytes, little endian), the content.
"""

import argparse
import gzip
import hashlib
import io
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAGIC = b"tasks-engine-bundle-1\n"
# What Neovim may take unpacked, its program and its runtime: more is a mistake in the cutting.
NVIM_BUDGET = 10 * 1024 * 1024
# Of `bin/` the program and the one library it cannot start without; the clipboard and hex tools are for editing.
NVIM_BIN = {"nvim.exe", "lua51.dll"}
# Annotations for the language server, never loaded.
NVIM_NOT_NEEDED = "share/nvim/runtime/lua/vim/_meta/"
TIMEOUT_S = 120
# The waits before each new try of a download that failed in passing (a 504 of GitHub broke the rolling run 42469307447).
RETRY_WAITS_S = (5, 15, 45)


def passing(error):
    """A failure that may be gone on the next try: the server was busy or the line broke, not a wrong address."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code == 429 or error.code >= 500
    return isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError))


def fetch(url, open_url=urllib.request.urlopen, sleep=time.sleep, waits=RETRY_WAITS_S):
    """The body at `url`; a failure in passing is tried again after each wait, any other ends at once."""
    request = urllib.request.Request(url, headers={"User-Agent": "tasks-desktop-pack-engine"})
    for attempt in range(len(waits) + 1):
        try:
            with open_url(request, timeout=TIMEOUT_S) as response:
                return response.read()
        except Exception as error:  # noqa: BLE001 - sorted by `passing`, everything else is raised again
            if attempt == len(waits) or not passing(error):
                raise
            print(f"pack-engine: {url}: {error}; trying again in {waits[attempt]} s", file=sys.stderr)
            sleep(waits[attempt])
    raise AssertionError("unreachable")


def read_pins(path):
    pins = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^(\w+)\s*=\s*(\S+)\s*$", line)
        if match:
            pins[match.group(1)] = match.group(2)
    return pins


def sha256_of(data):
    return hashlib.sha256(data).hexdigest()


def nvim_zip(pins, cache):
    """The zip of the release, from the cache or the network; never one with another sum."""
    cached = cache / f"nvim-{pins['version']}-{pins['sha256'][:16]}.zip"
    if cached.is_file():
        data = cached.read_bytes()
    else:
        data = fetch(pins["url"])
    got = sha256_of(data)
    if got != pins["sha256"]:
        raise SystemExit(f"pack-engine: {pins['url']} has the sum {got}, tools/nvim.lock says {pins['sha256']}")
    cache.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(data)
    return data


def nvim_files(data):
    """`nvim/...` of the files that stay, and the text of the licence."""
    files = {}
    licence = ""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if name.endswith("/"):
                continue
            # The top folder of the zip is nvim-win64/.
            rest = name.split("/", 1)[1] if "/" in name else name
            in_bin = rest.startswith("bin/") and rest[len("bin/") :] in NVIM_BIN
            in_lua = rest.startswith("share/nvim/runtime/lua/") and not rest.startswith(NVIM_NOT_NEEDED)
            keep = in_bin or in_lua
            if rest.upper().startswith("LICENSE") or rest.upper().startswith("SHARE/NVIM/RUNTIME/LICENSE"):
                licence = archive.read(name).decode("utf-8", "replace")
            if keep:
                files[f"nvim/{rest}"] = archive.read(name)
    if "nvim/bin/nvim.exe" not in files:
        raise SystemExit("pack-engine: no bin/nvim.exe in the zip of Neovim")
    return files, licence


def checkout_files(repo, commit, prefix, parts):
    """The files of `parts` of `repo` at `commit`, by `git archive` so that nothing untracked comes along."""
    with tempfile.TemporaryDirectory() as tmp:
        git = lambda *args, **kw: subprocess.run(["git", "-C", tmp, *args], check=True, capture_output=True, **kw)
        git("init", "--quiet")
        git("fetch", "--quiet", "--depth=1", repo, commit)
        tar = git("archive", "--format=zip", "FETCH_HEAD", *parts).stdout
    files = {}
    with zipfile.ZipFile(io.BytesIO(tar)) as archive:
        for name in archive.namelist():
            if not name.endswith("/"):
                files[f"{prefix}/{name}"] = archive.read(name)
    return files


def pack(files):
    body = io.BytesIO()
    body.write(MAGIC)
    for path in sorted(files):
        data = files[path]
        encoded = path.encode("utf-8")
        body.write(struct.pack("<I", len(encoded)))
        body.write(encoded)
        body.write(struct.pack("<Q", len(data)))
        body.write(data)
    # mtime=0: the same input gives the same file.
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", compresslevel=9, mtime=0) as gz:
        gz.write(body.getvalue())
    return out.getvalue()


def collect(cache):
    nvim_pins = read_pins(ROOT / "tools" / "nvim.lock")
    engine_pins = read_pins(ROOT / "engine.lock")
    files, _ = nvim_files(nvim_zip(nvim_pins, cache))
    # The zip of the release holds no licence of Neovim itself: this is LICENSE.txt of its tag.
    licence = (ROOT / "tools" / "neovim-LICENSE.txt").read_text(encoding="utf-8")
    size = sum(len(v) for v in files.values())
    lua = sum(len(v) for k, v in files.items() if "/runtime/lua/" in k)
    if size > NVIM_BUDGET:
        raise SystemExit(f"pack-engine: Neovim is {size} bytes, its Lua {lua}: over the budget of {NVIM_BUDGET}")
    files.update(checkout_files(engine_pins["repo"], engine_pins["commit"], "tasks.nvim", ["lua", "scripts", "LICENSE"]))
    files.update(checkout_files(engine_pins["lib_repo"], engine_pins["lib_commit"], "lib.nvim", ["lua", "LICENSE"]))
    notice = (
        f"This program carries Neovim {nvim_pins['version']} ({nvim_pins['url']}, sha256 {nvim_pins['sha256']}), cut down to\n"
        f"its program and its Lua runtime, and tasks.nvim {engine_pins['commit']} and lib.nvim {engine_pins['lib_commit']}.\n"
        "Neovim is under the Apache License 2.0, parts of it under the Vim license:\n\n"
        f"{licence}\n"
    )
    files["NOTICE"] = notice.encode("utf-8")
    return files, size, lua


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--cache", type=Path, default=ROOT / "target" / "engine-bundle")
    args = parser.parse_args()
    files, size, lua = collect(args.cache)
    packed = pack(files)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(packed)
    print(f"{args.out}: {len(packed)} bytes, {len(files)} files; Neovim {size} bytes unpacked, its Lua {lua}")


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(main())
