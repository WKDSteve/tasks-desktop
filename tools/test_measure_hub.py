import datetime
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('measure', pathlib.Path(__file__).parent / 'measure-hub.py')
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)


class Numbers(unittest.TestCase):
    def test_a_percentile_is_a_measured_value_by_nearest_rank(self) -> None:
        values = [5.0, 1.0, 4.0, 2.0, 3.0]
        self.assertEqual(measure.percentile(values, 0.5), 3.0)
        self.assertEqual(measure.percentile(values, 0.95), 5.0)
        self.assertEqual(measure.percentile(values, 0.2), 1.0)
        self.assertEqual(measure.percentile([7.0], 0.95), 7.0)
        with self.assertRaises(ValueError):
            measure.percentile([], 0.5)

    def test_twenty_values_put_the_slowest_one_above_p95(self) -> None:
        values = [float(n) for n in range(1, 21)]
        self.assertEqual(measure.percentile(values, 0.95), 19.0)
        row = measure.summarize('x', values, 10)
        self.assertEqual((row['n'], row['median'], row['p95'], row['max']), (20, 10.5, 19.0, 20.0))

    def test_times_and_sizes_are_written_short(self) -> None:
        self.assertEqual(measure.ms(0.44), '0.4')
        self.assertEqual(measure.ms(9.96), '10.0')
        self.assertEqual(measure.ms(18.4), '18')
        self.assertEqual(measure.size_text(None), '')
        self.assertEqual(measure.size_text(826), '826 B')
        self.assertEqual(measure.size_text(9800), '9.8 kB')
        self.assertEqual(measure.size_text(2_340_000), '2.34 MB')


class Words(unittest.TestCase):
    def test_the_words_most_titles_share_come_first_and_ties_go_by_the_alphabet(self) -> None:
        titles = ['Hub startet nicht', 'Der Hub und die Suche', 'Suche: Treffer fehlen', 'suche suche suche']
        # "suche" is in three titles (once per title), the four-letter words in one each; "hub" is too short.
        self.assertEqual(measure.frequent_words(titles, 2), ['suche', 'fehlen'])
        self.assertEqual(measure.frequent_words([], 3), [])


class Report(unittest.TestCase):
    def test_the_report_holds_counts_and_times_and_no_path(self) -> None:
        result = {
            'version': 'tasks-hub 1.2.3',
            'engine': None,
            'tasks': 14,
            'areas': 2,
            'runs': 5,
            'start_ms': 904.2,
            'first_snapshot_ms': 937.0,
            'index_ready_ms': 2801.0,
            'rows': [measure.summarize('snapshot, again', [0.4, 0.5, 0.45], 9800)],
        }
        text = measure.report(result, 'release', datetime.date(2026, 11, 14))
        self.assertIn('Measured on 2026-11-14 with `tasks-hub 1.2.3` (release build)', text)
        self.assertIn('Vault: 14 open tasks in 2 areas. Each series: 5 requests', text)
        self.assertIn('| snapshot, again | 3 | 0.5 | 0.5 | 0.5 | 9.8 kB |', text)
        self.assertIn('| program started until the first snapshot is there | 937 |', text)
        self.assertNotIn(':\\', text)
        self.assertNotIn(':/', text)
        self.assertTrue(text.endswith('\n'))


class Provenance(unittest.TestCase):
    def result(self, **more) -> dict:
        base = {
            'version': 'tasks-hub 0.0.0',
            'tasks': 1,
            'areas': 1,
            'runs': 1,
            'start_ms': 1.0,
            'first_snapshot_ms': 1.0,
            'index_ready_ms': 1.0,
            'rows': [],
        }
        return {**base, **more}

    def test_the_report_names_the_commits_of_hub_and_engine(self) -> None:
        text = measure.report(
            self.result(build='1a2b3c4', engine='0.9.0', engine_git='0123456789abcdef0123456789abcdef01234567'),
            'release',
            datetime.date(2026, 11, 15),
        )
        self.assertIn('Hub commit: 1a2b3c4. Engine: 0.9.0, commit 0123456789ab.', text)
        text = measure.report(self.result(engine_git='v0.9-3-gabc'), 'debug', datetime.date(2026, 11, 15))
        self.assertIn('Hub commit: none (not a rolling build). Engine: unknown, commit v0.9-3-gabc.', text)

    def test_the_variables_of_the_caller_are_named_and_their_values_are_not(self) -> None:
        env = {'TASKS_NVIM': 'C:/secret/nvim.exe', 'TASKS_HUB_UI_DIR': '', 'TASKS_HUB_ENGINE': 'process', 'PATH': 'x'}
        self.assertEqual(measure.caller_vars(env), ['TASKS_HUB_ENGINE', 'TASKS_NVIM'])
        text = measure.report(self.result(caller_vars=measure.caller_vars(env)), 'release', datetime.date(2026, 11, 15))
        self.assertIn('Set by the caller and passed on: `TASKS_HUB_ENGINE`, `TASKS_NVIM`.', text)
        self.assertNotIn('secret', text)
        self.assertNotIn('process', text)
        text = measure.report(self.result(caller_vars=[]), 'release', datetime.date(2026, 11, 15))
        self.assertIn('None of `TASKS_HUB_ENGINE`, ', text)

    def test_an_embedded_engine_is_said_with_the_start_times(self) -> None:
        said = 'the start times below hold that unpacking'
        self.assertIn(said, measure.report(self.result(embedded_engine=True), 'release', datetime.date(2026, 11, 15)))
        self.assertNotIn(said, measure.report(self.result(), 'release', datetime.date(2026, 11, 15)))


class FakeHub(measure.Hub):
    """Answers the snapshot from a list of (status, etag): the vault changes when the ETag does."""

    def __init__(self, changes: list[int]) -> None:
        self.etag = 0
        self.changes = changes  # after how many 304 answers the vault changes, one entry per change
        self.answered = 0
        self.asked_with = []

    def request(self, method, path, headers=None, body=None):
        if self.changes and self.answered == self.changes[0]:
            self.changes.pop(0)
            self.etag += 1
            self.answered = 0
        sent = (headers or {}).get('If-None-Match')
        if sent is None:
            return 200, {'ETag': f'"{self.etag}"'}, b'{}', 1.0
        self.asked_with.append(sent)
        if sent == f'"{self.etag}"':
            self.answered += 1
            return 304, {}, b'', 1.0
        return 200, {'ETag': f'"{self.etag}"'}, b'{}', 1.0


class Unchanged(unittest.TestCase):
    def test_a_vault_that_changes_once_during_the_series_gets_a_new_etag_and_a_second_series(self) -> None:
        hub = FakeHub([2])
        row = measure.unchanged_series(hub, '/api/tasks/snapshot', 5)
        self.assertEqual(row['n'], 5)
        self.assertEqual(hub.asked_with[-5:], ['"1"'] * 5)

    def test_a_vault_that_keeps_changing_ends_the_run(self) -> None:
        hub = FakeHub([1, 1])
        with self.assertRaises(SystemExit) as caught:
            measure.unchanged_series(hub, '/api/tasks/snapshot', 5)
        self.assertIn('answered HTTP 200, not 304', str(caught.exception))

    def test_a_still_vault_is_one_series(self) -> None:
        hub = FakeHub([])
        measure.unchanged_series(hub, '/api/tasks/snapshot', 3)
        self.assertEqual(hub.asked_with, ['"0"'] * 3)


class Folders(unittest.TestCase):
    def test_the_profile_is_the_name_of_cargos_folder_and_nothing_is_guessed(self) -> None:
        self.assertEqual(measure.build_profile(pathlib.Path('x/target/release/tasks-hub.exe')), 'release')
        self.assertEqual(measure.build_profile(pathlib.Path('x/target/debug/tasks-hub.exe')), 'debug')
        self.assertEqual(measure.build_profile(pathlib.Path('x/release/bin/tasks-hub.exe')), 'unknown')

    def test_the_config_folder_goes_with_what_is_in_it_and_the_log_is_read_before(self) -> None:
        folder = pathlib.Path(tempfile.mkdtemp(prefix='tasks-desktop-measure-test-'))
        (folder / 'serve.log').write_text('\n'.join(f'line {n}' for n in range(40)), encoding='utf-8')
        self.assertEqual(measure.log_tail(folder / 'serve.log', 2), 'line 38\nline 39')
        self.assertEqual(measure.log_tail(folder / 'nope.log'), '')
        self.assertTrue(measure.remove_folder(folder))
        self.assertFalse(folder.exists())
        self.assertTrue(measure.remove_folder(folder), 'a folder that is gone is removed')


class Arguments(unittest.TestCase):
    def test_a_program_or_a_vault_that_is_not_there_is_a_usage_error(self) -> None:
        here = pathlib.Path(__file__)
        self.assertEqual(measure.main(['--exe', str(here.parent / 'nope.exe'), '--vault', str(here.parent)]), 2)
        self.assertEqual(measure.main(['--exe', str(here), '--vault', str(here)]), 2)
        self.assertEqual(measure.main(['--exe', str(here), '--vault', str(here.parent), '--runs', '0']), 2)
        missing = str(here.parent / 'no-such-folder' / 'perf.md')
        self.assertEqual(measure.main(['--exe', str(here), '--vault', str(here.parent), '--out', missing]), 2)


if __name__ == '__main__':
    unittest.main()
