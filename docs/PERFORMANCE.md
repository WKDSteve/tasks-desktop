# Performance

How fast the hub answers on a real vault, and how to measure it again.

## Measure

```powershell
.\tools\dev-hub.ps1 -Release -Measure            # build, then measure against $TASKS_VAULT
.\tools\dev-hub.ps1 -Release -NoBuild -Measure -Runs 50 -Out perf.md
```

or, with a program that is built already:

```
python tools/measure-hub.py --exe target/release/tasks-hub.exe --vault <vault> [--runs 20] [--details 10] [--out file]
```

`tools/measure-hub.py` starts the program as `serve` on a free port with a config folder of its own in the temp
folder, so the installed hub, its settings and port 17615 are left alone, and it works from a Claude session too. It
pairs the way the page does, times the read routes on one connection that stays open, prints the report below and
ends the hub it started (killed before that, the hub ends itself a minute later). It only reads the vault. The report holds counts, sizes and times: no path and no title.
The engine is the one the hub finds (`TASKS_ENGINE_DIR`, `LIB_NVIM_DIR`, as for every local build).

The report says what answered: the commit of a rolling build of the hub and the engine's version and commit (from
`/api/tasks/about`), and which of `TASKS_HUB_ENGINE`, `TASKS_HUB_UI_DIR`, `TASKS_NVIM`, `TASKS_ENGINE_DIR`,
`LIB_NVIM_DIR` the caller had set (names only; they are passed on). A program that carries its engine unpacks it into
the new config folder on every run; the report then says that the start times hold the unpacking. Should the vault
change between taking the ETag and the 304 series, the series runs once more with the new ETag.

Three things make a run comparable: a release build, the same vault, and a machine that does nothing else. The
series below was taken while another build ran on the machine; read the medians, not the maxima.

## The series

Measured on 2026-11-15 with `tasks-hub 0.0.0` (release build), Windows 11, 12 logical CPUs.

Hub commit: none (not a rolling build). Engine: 0.1.0-dev, commit b0413cc.
Set by the caller and passed on: `TASKS_ENGINE_DIR`, `LIB_NVIM_DIR`.

Vault: 836 open tasks in 56 areas. Each series: 20 requests on one connection that stays open, timed in the client from the first byte sent to the last byte read.

| Start | ms |
| --- | ---: |
| program started until `hub.json` is written (the hub answers) | 2063 |
| program started until the first snapshot is there | 5993 |
| program started until the search index is built (asked right after the first snapshot) | 6999 |

| What | n | median ms | p95 ms | max ms | size |
| --- | ---: | ---: | ---: | ---: | ---: |
| snapshot, first request | 1 | 3859 | 3859 | 3859 | 960.9 kB |
| snapshot, again | 20 | 1.1 | 13 | 15 | 960.9 kB |
| snapshot, unchanged (304) | 20 | 0.2 | 0.3 | 0.4 | 0 B |
| areas | 20 | 0.5 | 0.8 | 391 | 6.4 kB |
| next | 20 | 0.2 | 0.4 | 521 | 1.4 kB |
| task detail, first request (size: the largest) | 10 | 352 | 448 | 448 | 46.5 kB |
| task detail, again at once | 10 | 0.4 | 0.6 | 0.6 | 46.5 kB |
| search, one frequent word (3 words; size: the largest) | 60 | 2.6 | 3.2 | 3.5 | 6.5 kB |

Here `areas` and `next` are held per state of the vault: the first request of each series went to the engine (the
maximum, 391 and 521 ms), every later one came from the hub. The series before (2026-11-14, 786 open tasks, the same
machine) had a median of 210 ms for `areas` and 246 ms for `next`, every request going to the engine. This run was
taken while the machine was busier (the hub answered after 2.1 s instead of 1.0 s): read the medians, and compare the
start times only within one run.

## How to read it

- **The hub holds the snapshot and the search index.** They answer in one or two milliseconds; an unchanged
  snapshot (`If-None-Match`) is 0.2 ms and no body.
- **The first snapshot is the engine reading the vault**, about 2 s for 786 open tasks (0.9 MB of JSON). The page
  shows nothing before it.
- **`areas` and `next` are held like a task detail**: the first request for a state of the vault goes to the engine
  (200 to 500 ms), every later one with the same question takes under a millisecond, for 30 seconds and until anything
  in the vault changes (`next` depends on the day too, so it is not held longer). The page asks for `areas` once and
  when a new area appears, and for `next` in the Today view per state of the vault.
- **A task detail goes to the engine** (170 to 210 ms) and is then held for a short while: for 30 seconds, at most
  64 of them, and until anything in the vault changes. Opened again at once it takes 0.3 ms; opened again a minute
  later it is asked of the engine again.
- **The search index is built about half a second after the first snapshot**; until then the search says
  `building`. A query on the built index takes about 2 ms.
