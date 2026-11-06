#!/usr/bin/env python3
"""The smoke test of the bundle: the cut-down Neovim answers like a full one.

    python tools/test-engine-bundle.py <the bundle> [--nvim nvim]

Unpacks the file of tools/pack-engine.py and runs `list`, `plan` and `next` of the engine on a small vault, once with the
Neovim of the bundle and once with a full one, and with no environment of the person's. The answers must be the same.
"""

import argparse
import gzip
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

MAGIC = b"tasks-engine-bundle-1\n"
TASK = """---
title: {title}
status: open
kind: task
prio: {prio}
effort: S
created: 2026-01-01
---

The body of {title}.
"""


def unpack(bundle, into):
    data = gzip.decompress(bundle.read_bytes())
    if not data.startswith(MAGIC):
        raise SystemExit("not a bundle")
    at = len(MAGIC)
    while at < len(data):
        (size,) = struct.unpack_from("<I", data, at)
        at += 4
        path = data[at : at + size].decode("utf-8")
        at += size
        (size,) = struct.unpack_from("<Q", data, at)
        at += 8
        target = into / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data[at : at + size])
        at += size


def make_vault(vault):
    tasks = vault / "alpha.nvim" / "ROADMAP" / "tasks"
    tasks.mkdir(parents=True)
    for i, title in enumerate(["One", "Two", "Three"], start=1):
        (tasks / f"t{i}.md").write_text(TASK.format(title=title, prio=i), encoding="utf-8")


def answers(nvim, engine, lib, vault):
    env = {
        "PATH": os.environ.get("PATH", ""),
        "SystemRoot": os.environ.get("SystemRoot", ""),
        "TEMP": os.environ.get("TEMP", ""),
        "TMP": os.environ.get("TMP", ""),
        "LIB_NVIM_DIR": str(lib),
    }
    got = {}
    for command in ["list", "plan", "next"]:
        run = subprocess.run(
            [str(nvim), "--headless", "-u", "NONE", "-i", "NONE", "-n", "-l", str(engine / "scripts" / "tasks.lua"), command, f"--vault={vault}"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=120,
            check=False,
        )
        got[command] = (run.returncode, run.stdout, run.stderr)
    return got


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--nvim", default="nvim")
    args = parser.parse_args()
    full = shutil.which(args.nvim)
    if not full:
        raise SystemExit(f"no full Neovim ({args.nvim}) to compare with")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        unpack(args.bundle, tmp / "b")
        make_vault(tmp / "vault")
        engine, lib = tmp / "b" / "tasks.nvim", tmp / "b" / "lib.nvim"
        cut = answers(tmp / "b" / "nvim" / "bin" / "nvim.exe", engine, lib, tmp / "vault")
        whole = answers(full, engine, lib, tmp / "vault")
    failed = False
    for command, (code, out, err) in cut.items():
        if code != 0:
            print(f"{command}: the cut-down Neovim ended with {code}: {err[:400]}")
            failed = True
        elif (code, out) != whole[command][:2]:
            print(f"{command}: not the answer of a full Neovim\n--- cut down\n{out[:600]}\n--- full\n{whole[command][1][:600]}")
            failed = True
        else:
            print(f"ok: {command} ({len(out)} bytes)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
