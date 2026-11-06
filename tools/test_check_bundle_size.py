import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('check', pathlib.Path(__file__).parent / 'check-bundle-size.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class BundleSize(unittest.TestCase):
    def page(self, kb: int) -> pathlib.Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        dist = pathlib.Path(tmp.name)
        (dist / 'assets').mkdir()
        (dist / 'assets' / 'index-abc.js').write_bytes(b'x' * (kb * 1000))
        (dist / 'assets' / 'other.js').write_bytes(b'x' * 5_000_000)
        (dist / 'index.html').write_text('<script type="module" crossorigin src="./assets/index-abc.js"></script>')
        return dist

    def test_a_chunk_within_the_budget_passes(self) -> None:
        self.assertTrue(check.check(self.page(100), 800)[0])

    def test_a_chunk_above_the_budget_fails(self) -> None:
        good, words = check.check(self.page(801), 800)
        self.assertFalse(good)
        self.assertIn('801 kB', words)

    def test_a_page_without_a_script_is_an_error(self) -> None:
        dist = self.page(1)
        (dist / 'index.html').write_text('<p>')
        with self.assertRaises(ValueError):
            check.main_chunk(dist)


if __name__ == '__main__':
    unittest.main()
