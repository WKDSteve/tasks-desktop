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
ends the hub it started. It only reads the vault. The report holds counts, sizes and times: no path and no title.
The engine is the one the hub finds (`TASKS_ENGINE_DIR`, `LIB_NVIM_DIR`, as for every local build).

Three things make a run comparable: a release build, the same vault, and a machine that does nothing else. The
series below was taken while another build ran on the machine; read the medians, not the maxima.

## The series

Measured on 2026-11-14 with `tasks-hub 0.0.0` (release build), Windows 11, 12 logical CPUs.

Vault: 785 open tasks in 56 areas. Each series: 20 requests on one connection that stays open, timed in the client from the first byte sent to the last byte read.

| Start | ms |
| --- | ---: |
| program started until `hub.json` is written (the hub answers) | 973 |
| program started until the first snapshot is there | 3101 |
| program started until the search index is built | 19969 |

| What | n | median ms | p95 ms | max ms | size |
| --- | ---: | ---: | ---: | ---: | ---: |
| snapshot, first request | 1 | 2105 | 2105 | 2105 | 911.6 kB |
| snapshot, again | 20 | 0.9 | 16 | 16 | 911.6 kB |
| snapshot, unchanged (304) | 20 | 0.2 | 0.3 | 0.5 | 0 B |
| areas | 20 | 289 | 348 | 841 | 6.4 kB |
| next | 20 | 327 | 661 | 764 | 1.3 kB |
| task detail, first request | 10 | 236 | 325 | 325 | 4.9 kB |
| task detail, again | 10 | 0.3 | 0.5 | 0.5 | 4.9 kB |
| search, one frequent word (3 words) | 60 | 2.4 | 3.3 | 6.6 | 6.4 kB |

Two more runs right after it, same build and vault: the hub answered after 1.2 to 1.4 s, the first snapshot was
there after 3.3 to 6.0 s, the search index after 19.6 to 20.9 s; the medians of `areas` were 253 and 288 ms, of
`next` 312 and 348 ms, of a first task detail 200 and 329 ms; everything the hub holds itself stayed below 3 ms.

## How to read it

- **The hub holds the snapshot, the task details it was asked for and the search index.** Those answer in
  about a millisecond; an unchanged snapshot (`If-None-Match`) is 0.2 ms and no body.
- **The first snapshot is the engine reading the vault**, about 2 s for 785 open tasks (0.9 MB of JSON). The page
  shows nothing before it.
- **`areas` and `next` go to the engine on every request**, 250 to 350 ms each. The page asks for them when it
  opens and when the vault changes, not while typing.
- **A task detail goes to the engine once** (200 to 330 ms), then it is held until the task changes.
- **The search index takes about 20 s to build** after the start; until then the search says `building`. A query on
  the built index takes 2 to 3 ms.
