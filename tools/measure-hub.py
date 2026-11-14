#!/usr/bin/env python3
"""Measure how fast the hub answers on a vault: start, snapshot, search, task detail.

    python tools/measure-hub.py --exe target/release/tasks-hub.exe --vault <vault> [--runs 20] [--details 10]

Starts the given program as `serve` on a free port with a config folder of its own in the temp
folder (nothing of the installed hub is read or changed: no AppData, no registry, not port 17615),
pairs the way the page does, times the read routes and prints a Markdown report. It only reads the
vault. The hub it started is ended again (its own process, never one found by name), and the config
folder is removed; should this program be killed before that, the hub ends itself a minute after the
connection is gone.

The report holds no path and no title of the vault: counts, sizes and times only.
"""

from __future__ import annotations

import argparse
import collections
import datetime
import http.client
import json
import math
import os
import pathlib
import platform
import re
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.parse

ROUTE = '/api/tasks/'
START_LIMIT = 120.0


def percentile(values: list[float], share: float) -> float:
    """The value at `share` (0..1) of the sorted values, nearest rank. One value is every percentile."""
    if not values:
        raise ValueError('no values')
    ordered = sorted(values)
    rank = max(1, math.ceil(share * len(ordered)))
    return ordered[min(rank, len(ordered)) - 1]


def summarize(name: str, times_ms: list[float], size: int | None) -> dict:
    return {
        'what': name,
        'n': len(times_ms),
        'median': statistics.median(times_ms),
        'p95': percentile(times_ms, 0.95),
        'max': max(times_ms),
        'bytes': size,
    }


def ms(value: float) -> str:
    """Milliseconds for the table: one decimal below ten, none above."""
    return f'{value:.1f}' if value < 10 else f'{value:.0f}'


def size_text(size: int | None) -> str:
    if size is None:
        return ''
    if size < 1000:
        return f'{size} B'
    return f'{size / 1000:.1f} kB' if size < 1_000_000 else f'{size / 1_000_000:.2f} MB'


def table(rows: list[dict]) -> str:
    lines = ['| What | n | median ms | p95 ms | max ms | size |', '| --- | ---: | ---: | ---: | ---: | ---: |']
    for row in rows:
        lines.append(
            f"| {row['what']} | {row['n']} | {ms(row['median'])} | {ms(row['p95'])} | {ms(row['max'])} "
            f"| {size_text(row['bytes'])} |"
        )
    return '\n'.join(lines)


def frequent_words(titles: list[str], count: int) -> list[str]:
    """The words (four letters or more) most titles share: queries that hit many tasks. Ties by the alphabet."""
    seen: collections.Counter[str] = collections.Counter()
    for title in titles:
        seen.update(set(re.findall(r'[a-zäöüß]{4,}', title.lower())))
    ranked = sorted(seen.items(), key=lambda item: (-item[1], item[0]))
    return [word for word, _ in ranked[:count]]


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


class Hub:
    """One connection to the hub that is kept open, as the page keeps its own."""

    def __init__(self, port: int) -> None:
        self.port = port
        self.conn = http.client.HTTPConnection('127.0.0.1', port, timeout=120)
        self.token = ''

    def request(self, method: str, path: str, headers: dict | None = None, body: str | None = None):
        """(status, headers, bytes, milliseconds) of one request, read to the end."""
        all_headers = dict(headers or {})
        if self.token:
            all_headers['Authorization'] = f'Bearer {self.token}'
        for attempt in (1, 2):
            began = time.perf_counter()
            try:
                self.conn.request(method, path, body=body, headers=all_headers)
                answer = self.conn.getresponse()
                data = answer.read()
            except (ConnectionError, http.client.RemoteDisconnected):
                # The hub closed a connection that idled (it drops one after ten seconds): connect again, once.
                # A read is asked again; a pairing request starts on a fresh connection anyway (see `pair`).
                self.conn.close()
                if attempt == 2 or method != 'GET':
                    raise
                continue
            took = (time.perf_counter() - began) * 1000
            return answer.status, answer.headers, data, took
        raise AssertionError('unreachable')

    def pair(self, control: str) -> None:
        json_type = {'Content-Type': 'application/json'}
        status, _, data, _ = self.request(
            'POST', '/api/control/pair', {**json_type, 'Authorization': f'Bearer {control}'}, '{}'
        )
        if status != 200:
            raise SystemExit(f'measure-hub: no pairing code (HTTP {status})')
        code = json.loads(data)['code']
        origin = f'http://127.0.0.1:{self.port}'
        self.conn.close()  # each of the two on a connection of its own (it is opened again by the next request)
        status, _, data, _ = self.request(
            'POST', '/auth/exchange', {**json_type, 'Origin': origin}, json.dumps({'code': code})
        )
        if status != 200:
            raise SystemExit(f'measure-hub: no session (HTTP {status})')
        self.token = json.loads(data)['token']

    def series(self, name: str, path: str, runs: int, headers: dict | None = None, expect: int = 200) -> dict:
        times, size = [], None
        for _ in range(runs):
            status, _, data, took = self.request('GET', path, headers)
            if status != expect:
                raise SystemExit(f'measure-hub: {path} answered HTTP {status}, not {expect}')
            times.append(took)
            size = len(data)
        return summarize(name, times, size)


def wait_for(what: str, ready, limit: float = START_LIMIT, child: subprocess.Popen | None = None):
    """Poll `ready()` until it returns something; the seconds it took and that value."""
    began = time.perf_counter()
    while True:
        value = ready()
        if value:
            return time.perf_counter() - began, value
        if child is not None and child.poll() is not None:
            raise SystemExit(f'measure-hub: the hub ended (exit code {child.returncode}) before {what}')
        if time.perf_counter() - began > limit:
            raise SystemExit(f'measure-hub: {what} took longer than {limit:.0f} s')
        time.sleep(0.02)


def log_tail(log_path: pathlib.Path, lines: int = 15) -> str:
    """The last lines the hub wrote: the reason it gives when it does not start or has no engine."""
    try:
        text = log_path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return ''
    return '\n'.join(text.splitlines()[-lines:])


def remove_folder(folder: pathlib.Path) -> bool:
    """Remove the config folder. On Windows a process the hub started may hold a file in it for a moment longer."""
    for _ in range(50):
        shutil.rmtree(folder, ignore_errors=True)
        if not folder.exists():
            return True
        time.sleep(0.1)
    return False


def build_profile(exe: pathlib.Path) -> str:
    """`release` or `debug` when the program sits in cargo's folder of that name; else it is not known."""
    name = exe.parent.name
    return name if name in ('release', 'debug') else 'unknown'


def measure(exe: pathlib.Path, vault: pathlib.Path, runs: int, details: int) -> dict:
    config = pathlib.Path(tempfile.mkdtemp(prefix='tasks-desktop-measure-'))
    log_path = config / 'serve.log'
    child = None
    log = None
    try:
        env = dict(os.environ)
        for name in ('TASKS_DESKTOP_PORT', 'TASKS_DESKTOP_TAILNET'):
            env.pop(name, None)
        env.update(
            TASKS_DESKTOP_CONFIG_DIR=str(config),
            TASKS_VAULT=str(vault),
            TASKS_DESKTOP_NO_LOGIN_SYNC='1',
            TASKS_DESKTOP_NO_SETUP='1',
            # As a hub in the background, with a minute alone: if this program is killed (a time limit, the task
            # manager) and never reaches its `finally`, the hub does not stay behind. While it measures, its
            # connection with a session keeps the hub here.
            TASKS_DESKTOP_DETACHED='1',
            TASKS_DESKTOP_ALONE_SECS='60',
        )
        log = open(log_path, 'wb')
        began = time.perf_counter()
        child = subprocess.Popen(
            [str(exe), 'serve', '--port', str(free_port())],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
        )
        wait_for('the hub wrote hub.json', lambda: (config / 'hub.json').exists(), child=child)
        up = time.perf_counter() - began
        # The port the hub really took: it moves to a free one when the wanted one was taken meanwhile.
        port = json.loads((config / 'hub.json').read_text(encoding='utf-8'))['port']
        hub = Hub(port)
        hub.pair((config / 'control.secret').read_text(encoding='utf-8').strip())

        status, _, data, _ = hub.request('GET', ROUTE + 'hello')
        doc = json.loads(data) if status == 200 else {}
        if not doc.get('engine', {}).get('ready'):
            problem = doc.get('engine', {}).get('problem')
            raise SystemExit(f'measure-hub: the engine is not ready ({problem})')

        rows = []
        first = hub.series('snapshot, first request', ROUTE + 'snapshot', 1)
        first_ready = time.perf_counter() - began
        status, headers, data, _ = hub.request('GET', ROUTE + 'snapshot')
        snapshot = json.loads(data)
        etag = headers['ETag']
        tasks = snapshot['tasks']

        # The search index, asked right away: every series below takes time of its own, and asked after them the
        # index would seem to need as long as they took.
        words = frequent_words([str(task.get('title', '')) for task in tasks], 3) or ['task']

        def index_ready():
            status, _, data, _ = hub.request('GET', ROUTE + 'search?q=' + urllib.parse.quote(words[0], safe=''))
            if status != 200:
                raise SystemExit(f'measure-hub: the search answered HTTP {status}')
            return json.loads(data).get('status') == 'ready'

        wait_for('the search index was built', index_ready, child=child)
        index_ready_at = time.perf_counter() - began

        rows.append(first)
        rows.append(hub.series('snapshot, again', ROUTE + 'snapshot', runs))
        # The vault may change under the measurement (another program writes a task): the ETag is taken anew.
        etag = hub.request('GET', ROUTE + 'snapshot')[1]['ETag'] or etag
        rows.append(
            hub.series('snapshot, unchanged (304)', ROUTE + 'snapshot', runs, {'If-None-Match': etag}, expect=304)
        )
        rows.append(hub.series('areas', ROUTE + 'areas', runs))
        rows.append(hub.series('next', ROUTE + 'next', runs))

        # Ids the hub takes as they are (letters, digits, . _ - /): it refuses an escape in one.
        plain = sorted(task['id'] for task in tasks if re.fullmatch(r'[A-Za-z0-9._/-]+', task['id']))
        ids = plain[:: max(1, len(plain) // max(1, details))][:details] if details else []
        firsts, agains, largest = [], [], 0
        for task_id in ids:
            path = ROUTE + 'task?id=' + task_id
            status, _, data, took = hub.request('GET', path)
            if status != 200:
                raise SystemExit(f'measure-hub: a task detail answered HTTP {status}')
            firsts.append(took)
            largest = max(largest, len(data))
            agains.append(hub.request('GET', path)[3])
        if firsts:
            rows.append(summarize('task detail, first request (size: the largest)', firsts, largest))
            rows.append(summarize('task detail, again at once', agains, largest))

        search_times, largest = [], 0
        for word in words:
            for _ in range(runs):
                status, _, data, took = hub.request('GET', ROUTE + 'search?q=' + urllib.parse.quote(word, safe=''))
                if status != 200:
                    raise SystemExit(f'measure-hub: the search answered HTTP {status}')
                search_times.append(took)
                largest = max(largest, len(data))
        rows.append(summarize(f'search, one frequent word ({len(words)} words; size: the largest)', search_times, largest))

        version = subprocess.run([str(exe), '--version'], capture_output=True, text=True, env=env, check=False)
        return {
            'version': version.stdout.strip(),
            'engine': doc['engine'].get('version'),
            'tasks': len(tasks),
            'areas': len({task['id'].split('/')[0] for task in tasks}),
            'runs': runs,
            'start_ms': up * 1000,
            'first_snapshot_ms': first_ready * 1000,
            'index_ready_ms': index_ready_at * 1000,
            'rows': rows,
        }
    except BaseException:
        # What the hub said (why it has no engine, why it ended) is in its log, which goes with the folder.
        if log is not None:
            log.flush()
        said = log_tail(log_path)
        if said:
            print('measure-hub: the last lines of the hub:\n' + said, file=sys.stderr)
        raise
    finally:
        if child is not None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        if log is not None:
            log.close()
        if not remove_folder(config):
            print(f'measure-hub: could not remove {config} (a file in it is still held); delete it', file=sys.stderr)


def report(result: dict, profile: str, when: datetime.date) -> str:
    lines = [
        f"Measured on {when.isoformat()} with `{result['version']}` ({profile} build), "
        f"{platform.system()} {platform.release()}, {os.cpu_count()} logical CPUs.",
        '',
        f"Vault: {result['tasks']} open tasks in {result['areas']} areas. Each series: {result['runs']} requests "
        'on one connection that stays open, timed in the client from the first byte sent to the last byte read.',
        '',
        '| Start | ms |',
        '| --- | ---: |',
        f"| program started until `hub.json` is written (the hub answers) | {ms(result['start_ms'])} |",
        f"| program started until the first snapshot is there | {ms(result['first_snapshot_ms'])} |",
        f"| program started until the search index is built (asked right after the first snapshot) "
        f"| {ms(result['index_ready_ms'])} |",
        '',
        table(result['rows']),
    ]
    return '\n'.join(lines) + '\n'


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--exe', required=True, type=pathlib.Path, help='the tasks-hub program to measure')
    parser.add_argument('--vault', required=True, type=pathlib.Path, help='the vault it reads (only read)')
    parser.add_argument('--runs', type=int, default=20, help='requests per series (default 20)')
    parser.add_argument('--details', type=int, default=10, help='tasks whose detail is asked (default 10)')
    parser.add_argument('--out', type=pathlib.Path, help='also write the report to this file')
    parser.add_argument('--json', action='store_true', help='print the numbers as JSON instead of Markdown')
    args = parser.parse_args(argv)
    if not args.exe.is_file():
        print(f'measure-hub: not a file: {args.exe}', file=sys.stderr)
        return 2
    if not args.vault.is_dir():
        print(f'measure-hub: not a folder: {args.vault}', file=sys.stderr)
        return 2
    if args.runs < 1 or args.details < 0:
        print('measure-hub: --runs is 1 or more, --details 0 or more', file=sys.stderr)
        return 2
    out = args.out.resolve() if args.out else None
    if out and not out.parent.is_dir():
        print(f'measure-hub: the folder of --out is not there: {out.parent}', file=sys.stderr)
        return 2
    result = measure(args.exe.resolve(), args.vault.resolve(), args.runs, args.details)
    profile = build_profile(args.exe.resolve())
    text = json.dumps(result, indent=2) if args.json else report(result, profile, datetime.date.today())
    sys.stdout.write(text if text.endswith('\n') else text + '\n')
    if out:
        with open(out, 'w', encoding='utf-8', newline='\n') as file:
            file.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
