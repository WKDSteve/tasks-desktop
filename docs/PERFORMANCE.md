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

Three things make a run comparable: a release build, the same vault, and a machine that does nothing else. The
series below was taken while another build ran on the machine; read the medians, not the maxima.

## The series

Measured on 2026-11-14 with `tasks-hub 0.0.0` (release build), Windows 11, 12 logical CPUs.

Vault: 786 open tasks in 56 areas. Each series: 20 requests on one connection that stays open, timed in the client from the first byte sent to the last byte read.

| Start | ms |
| --- | ---: |
| program started until `hub.json` is written (the hub answers) | 1034 |
| program started until the first snapshot is there | 2924 |
| program started until the search index is built (asked right after the first snapshot) | 3500 |

| What | n | median ms | p95 ms | max ms | size |
| --- | ---: | ---: | ---: | ---: | ---: |
| snapshot, first request | 1 | 1867 | 1867 | 1867 | 912.6 kB |
| snapshot, again | 20 | 0.9 | 16 | 18 | 912.6 kB |
| snapshot, unchanged (304) | 20 | 0.2 | 0.3 | 0.3 | 0 B |
| areas | 20 | 210 | 235 | 244 | 6.4 kB |
| next | 20 | 246 | 280 | 308 | 1.3 kB |
| task detail, first request (size: the largest) | 10 | 166 | 190 | 190 | 9.7 kB |
| task detail, again at once | 10 | 0.3 | 0.3 | 0.3 | 9.7 kB |
| search, one frequent word (3 words; size: the largest) | 60 | 1.5 | 2.0 | 2.2 | 6.5 kB |

Two more runs with the same build and vault, minutes apart. One like this one: the hub answered after 1.1 s, the
first snapshot was there after 3.2 s, the index 0.6 s later; medians of `areas` 218 ms, `next` 286 ms, a first
task detail 184 ms. And one where the first snapshot took 14.7 s instead of 2 s (the machine was busy and the
engine read the vault from a cold file cache); every later number of that run was as above. A first snapshot is
the number that moves most.

## How to read it

- **The hub holds the snapshot and the search index.** They answer in one or two milliseconds; an unchanged
  snapshot (`If-None-Match`) is 0.2 ms and no body.
- **The first snapshot is the engine reading the vault**, about 2 s for 786 open tasks (0.9 MB of JSON). The page
  shows nothing before it.
- **`areas` and `next` go to the engine on every request**, 210 to 300 ms each. The page asks for `areas` once and
  when a new area appears, and for `next` in the Today view per state of the vault: not while typing.
- **A task detail goes to the engine** (170 to 210 ms) and is then held for a short while: for 30 seconds, at most
  64 of them, and until anything in the vault changes. Opened again at once it takes 0.3 ms; opened again a minute
  later it is asked of the engine again.
- **The search index is built about half a second after the first snapshot**; until then the search says
  `building`. A query on the built index takes about 2 ms.
