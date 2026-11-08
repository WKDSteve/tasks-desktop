import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("build_mobile", Path(__file__).with_name("build-mobile.py"))
build_mobile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_mobile)

GOOD = "repo = https://github.com/WKDSteve/tasks-mobile\ncommit = " + "a" * 40 + "\n"


class ReadPins(unittest.TestCase):
    def pins(self, text):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "mobile.lock"
            path.write_text(text, encoding="utf-8")
            return build_mobile.read_pins(path)

    def test_reads_repo_and_commit(self):
        self.assertEqual(self.pins("# c\n" + GOOD), ("https://github.com/WKDSteve/tasks-mobile", "a" * 40))

    def test_refuses_what_is_not_a_full_commit_or_a_github_address(self):
        for bad in [
            GOOD.replace("a" * 40, "abc1234"),
            GOOD.replace("a" * 40, "A" * 40),
            GOOD.replace("https://github.com", "http://github.com"),
            GOOD.replace("https://github.com/WKDSteve/tasks-mobile", "https://evil.example/x/y"),
            GOOD.replace("tasks-mobile", "tasks-mobile; rm -rf /"),
            "repo https://github.com/a/b\n",
            "",
        ]:
            with self.assertRaises(ValueError, msg=bad):
                self.pins(bad)


class RemoveTree(unittest.TestCase):
    def test_removes_read_only_files_as_git_leaves_them(self):
        import os
        import stat

        with tempfile.TemporaryDirectory() as d:
            tree = Path(d) / "clone" / ".git" / "objects"
            tree.mkdir(parents=True)
            pack = tree / "pack.idx"
            pack.write_text("x", encoding="utf-8")
            os.chmod(pack, stat.S_IREAD)
            build_mobile.remove_tree(Path(d) / "clone")
            self.assertFalse((Path(d) / "clone").exists())


class CopyPage(unittest.TestCase):
    def test_copies_the_page_and_nothing_else_into_an_emptied_folder(self):
        with tempfile.TemporaryDirectory() as d:
            dist, out = Path(d) / "dist", Path(d) / "out"
            (dist / "assets").mkdir(parents=True)
            (dist / "icons").mkdir()
            (dist / "other").mkdir()
            for name in ["index.html", "manifest.webmanifest", "sw.js", "secret.txt", "assets/a.js", "icons/i.svg", "other/x.js"]:
                (dist / name).write_text("x", encoding="utf-8")
            out.mkdir()
            (out / "stale.js").write_text("old", encoding="utf-8")
            copied = build_mobile.copy_page(dist, out)
            self.assertEqual(sorted(copied), ["assets/a.js", "icons/i.svg", "index.html", "manifest.webmanifest", "sw.js"])
            self.assertFalse((out / "stale.js").exists())
            self.assertFalse((out / "secret.txt").exists())

    def test_refuses_a_build_without_index(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError):
                build_mobile.copy_page(Path(d), Path(d) / "out")


if __name__ == "__main__":
    unittest.main()
