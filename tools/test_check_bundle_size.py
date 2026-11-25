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
        # The words of the languages: empty here, the cases of the language chunk give them a size.
        (dist / 'assets' / 'i18n-en-x1.js').write_bytes(b'')
        return dist

    def test_a_chunk_within_the_budget_passes(self) -> None:
        self.assertTrue(check.check(self.page(100), 800)[0])

    def test_a_chunk_above_the_budget_fails(self) -> None:
        good, words = check.check(self.page(801), 800)
        self.assertFalse(good)
        self.assertIn('801 kB', words)

    def with_chunks(self, main_kb: int, shared_kb: int) -> pathlib.Path:
        dist = self.page(main_kb)
        assets = dist / 'assets'
        (assets / 'index-abc.js').write_bytes(b'x' * (main_kb * 1000 - 40) + b'import"./shared-1.js";')
        # The shared chunk imports a second one itself, and the main chunk starts a lazy one that does not count.
        (assets / 'shared-1.js').write_bytes(b'x' * (shared_kb * 1000 - 40) + b'export{a}from"./deep-2.js";')
        (assets / 'deep-2.js').write_bytes(b'x' * 10_000)
        with (assets / 'index-abc.js').open('ab') as f:
            f.write(b'const l=()=>import("./lazy.js");')
        (assets / 'lazy.js').write_bytes(b'x' * 900_000)
        return dist

    def test_the_chunks_the_main_chunk_imports_count_with_it_down_the_chain(self) -> None:
        good, words = check.check(self.with_chunks(100, 200), 500)
        self.assertTrue(good)
        self.assertIn('with 3 chunks', words)
        self.assertIn('310 kB', words)
        good, words = check.check(self.with_chunks(100, 200), 300)
        self.assertFalse(good)
        self.assertIn('shared-1.js 200 kB', words)

    def test_a_chunk_that_moves_into_the_main_chunk_changes_nothing(self) -> None:
        apart = check.check(self.with_chunks(100, 12), 800)[1]
        # 100 kB main, 12 kB shared and the 10 kB it imports: the same start as one chunk of 122 kB.
        merged = check.check(self.page(122), 800)[1]
        self.assertIn('start 122 kB', apart)
        self.assertIn('start 122 kB', merged)

    def test_the_larger_language_counts_with_the_start_though_it_is_loaded_on_demand(self) -> None:
        dist = self.page(100)
        assets = dist / 'assets'
        (assets / 'i18n-en-x1.js').write_bytes(b'x' * 150_000)
        (assets / 'i18n-de-y2.js').write_bytes(b'x' * 170_000)
        with (assets / 'index-abc.js').open('ab') as f:
            f.write(b'const w=()=>import("./i18n-de-y2.js");')
        good, words = check.check(dist, 260)
        self.assertFalse(good)
        self.assertIn('language i18n-de-y2.js', words)
        self.assertIn('270 kB', words)
        self.assertTrue(check.check(dist, 271)[0])

    def test_a_page_without_a_language_chunk_is_an_error(self) -> None:
        dist = self.page(100)
        (dist / 'assets' / 'i18n-en-x1.js').unlink()
        # The shared module of the language code is no table of words.
        (dist / 'assets' / 'i18n-Dp4x.js').write_bytes(b'x' * 3000)
        (dist / 'assets' / 'i18n-ab-c3Xy.js').write_bytes(b'x' * 3000)
        with self.assertRaises(ValueError):
            check.check(dist, 800)

    def test_the_markdown_reader_in_the_start_fails_however_small_the_start(self) -> None:
        dist = self.with_chunks(100, 12)
        assets = dist / 'assets'
        # In a lazy chunk it is where it belongs.
        (assets / 'lazy.js').write_bytes(b'x' * 1000 + b'rules:["smartquotes","text_join"]')
        good, words = check.check(dist, 800)
        self.assertTrue(good, words)
        # In a chunk the main chunk imports statically, down the chain, it is parsed at every start.
        (assets / 'deep-2.js').write_bytes(b'x' * 1000 + b'rules:["smartquotes","text_join"]')
        good, words = check.check(dist, 800)
        self.assertFalse(good)
        self.assertIn('the Markdown reader (markdown-it) is in the start (deep-2.js)', words)

    def test_a_page_without_a_script_is_an_error(self) -> None:
        dist = self.page(1)
        (dist / 'index.html').write_text('<p>')
        with self.assertRaises(ValueError):
            check.main_chunk(dist)


if __name__ == '__main__':
    unittest.main()
