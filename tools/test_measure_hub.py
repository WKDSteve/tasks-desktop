import datetime
import importlib.util
import pathlib
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


class Arguments(unittest.TestCase):
    def test_a_program_or_a_vault_that_is_not_there_is_a_usage_error(self) -> None:
        here = pathlib.Path(__file__)
        self.assertEqual(measure.main(['--exe', str(here.parent / 'nope.exe'), '--vault', str(here.parent)]), 2)
        self.assertEqual(measure.main(['--exe', str(here), '--vault', str(here)]), 2)
        self.assertEqual(measure.main(['--exe', str(here), '--vault', str(here.parent), '--runs', '0']), 2)


if __name__ == '__main__':
    unittest.main()
