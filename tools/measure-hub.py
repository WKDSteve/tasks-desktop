#!/usr/bin/env python3
"""Measure how fast the hub answers on a vault: start, snapshot, search, task detail.

    python tools/measure-hub.py --exe target/release/tasks-hub.exe --vault <vault> [--runs 20] [--details 10]

Starts the given program as `serve` on a free port with a config folder of its own in the temp
folder (nothing of the installed hub is read or changed: no AppData, no registry, not port 17615),
pairs the way the page does, times the read routes and prints a Markdown report. It only reads the
vault. The hub it started is ended again (its own process, never one found by name), and the config
folder is removed.

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


def measure(exe: pathlib.Path, vault: pathlib.Path, runs: int, details: int) -> dict:
    config = pathlib.Path(tempfile.mkdtemp(prefix='tasks-desktop-measure-'))
    env = dict(os.environ)
    for name in ('TASKS_DESKTOP_PORT', 'TASKS_DESKTOP_DETACHED', 'TASKS_DESKTOP_TAILNET'):
        env.pop(name, None)
    env.update(
        TASKS_DESKTOP_CONFIG_DIR=str(config),
        TASKS_VAULT=str(vault),
        TASKS_DESKTOP_NO_LOGIN_SYNC='1',
        TASKS_DESKTOP_NO_SETUP='1',
    )
    port = free_port()
    log = open(config / 'serve.log', 'wb')
    began = time.perf_counter()
    child = subprocess.Popen(
        [str(exe), 'serve', '--port', str(port)], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log
    )
    try:
        wait_for('the hub wrote hub.json', lambda: (config / 'hub.json').exists(), child=child)
        up = time.perf_counter() - began
        hub = Hub(port)
        hub.pair((config / 'control.secret').read_text(encoding='utf-8').strip())

        def hello():
            status, _, data, _ = hub.request('GET', ROUTE + 'hello')
            return json.loads(data) if status == 200 else None

        doc = hello()
        if not doc or not doc['engine']['ready']:
            problem = (doc or {}).get('engine', {}).get('problem')
            raise SystemExit(f'measure-hub: the engine is not ready ({problem}); see the note of `serve`')

        rows = []
        first = hub.series('snapshot, first request', ROUTE + 'snapshot', 1)
        first_ready = time.perf_counter() - began
        status, headers, data, _ = hub.request('GET', ROUTE + 'snapshot')
        snapshot = json.loads(data)
        etag = headers['ETag']
        rows.append(first)
        rows.append(hub.series('snapshot, again', ROUTE + 'snapshot', runs))
        rows.append(
            hub.series('snapshot, unchanged (304)', ROUTE + 'snapshot', runs, {'If-None-Match': etag}, expect=304)
        )
        rows.append(hub.series('areas', ROUTE + 'areas', runs))
        rows.append(hub.series('next', ROUTE + 'next', runs))

        tasks = snapshot['tasks']
        ids = sorted(task['id'] for task in tasks)[:: max(1, len(tasks) // max(1, details))][:details]
        firsts, agains, size = [], [], None
        for task_id in ids:
            # The id is plain (letters, digits, . _ - /); the hub refuses an escape in it.
            path = ROUTE + 'task?id=' + task_id
            status, _, data, took = hub.request('GET', path)
            if status != 200:
                raise SystemExit(f'measure-hub: a task detail answered HTTP {status}')
            firsts.append(took)
            size = len(data)
            agains.append(hub.request('GET', path)[3])
        if firsts:
            rows.append(summarize('task detail, first request', firsts, size))
            rows.append(summarize('task detail, again', agains, size))

        words = frequent_words([str(task.get('title', '')) for task in tasks], 3) or ['task']

        def index_ready():
            status, _, data, _ = hub.request('GET', ROUTE + 'search?q=' + urllib.parse.quote(words[0], safe=''))
            if status != 200:
                raise SystemExit(f'measure-hub: the search answered HTTP {status}')
            return json.loads(data).get('status') == 'ready'

        wait_for('the search index was built', index_ready, child=child)
        index_ready_at = time.perf_counter() - began
        search_times, search_size = [], None
        for word in words:
            row = hub.series('search', ROUTE + 'search?q=' + urllib.parse.quote(word, safe=''), runs)
            search_times.append(row)
            search_size = row['bytes']
        if search_times:
            merged = {
                'what': f'search, one frequent word ({len(words)} words)',
                'n': sum(row['n'] for row in search_times),
                'median': statistics.median(row['median'] for row in search_times),
                'p95': max(row['p95'] for row in search_times),
                'max': max(row['max'] for row in search_times),
                'bytes': search_size,
            }
            rows.append(merged)

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
    finally:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        log.close()
        shutil.rmtree(config, ignore_errors=True)


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
        f"| program started until the search index is built | {ms(result['index_ready_ms'])} |",
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
    result = measure(args.exe.resolve(), args.vault.resolve(), args.runs, args.details)
    profile = 'release' if 'release' in args.exe.resolve().parts else 'debug'
    text = json.dumps(result, indent=2) if args.json else report(result, profile, datetime.date.today())
    sys.stdout.write(text if text.endswith('\n') else text + '\n')
    if args.out:
        args.out.write_text(text, encoding='utf-8', newline='\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
