import importlib.util
import io
import unittest
import urllib.error
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("pack_engine", Path(__file__).with_name("pack-engine.py"))
pack_engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pack_engine)


def http_error(code):
    return urllib.error.HTTPError("https://x/nvim.zip", code, "msg", {}, io.BytesIO(b""))


class Answer:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


class Server:
    """Answers in turn: an exception is raised, bytes are the body."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = 0

    def __call__(self, request, timeout):
        self.calls += 1
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return Answer(answer)


class Fetch(unittest.TestCase):
    def run_fetch(self, server):
        slept = []
        body = pack_engine.fetch("https://x/nvim.zip", open_url=server, sleep=slept.append, waits=(1, 2, 3))
        return body, slept

    def test_a_gateway_timeout_is_tried_again_and_the_body_comes(self):
        server = Server(http_error(504), urllib.error.URLError("reset"), b"zip")
        body, slept = self.run_fetch(server)
        self.assertEqual(body, b"zip")
        self.assertEqual(slept, [1, 2])
        self.assertEqual(server.calls, 3)

    def test_too_many_requests_is_passing_too(self):
        body, slept = self.run_fetch(Server(http_error(429), b"zip"))
        self.assertEqual((body, slept), (b"zip", [1]))

    def test_a_wrong_address_ends_at_once(self):
        server = Server(http_error(404), b"never")
        with self.assertRaises(urllib.error.HTTPError):
            self.run_fetch(server)
        self.assertEqual(server.calls, 1)

    def test_it_gives_up_after_the_last_wait(self):
        server = Server(*[http_error(503)] * 4)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.run_fetch(server)
        self.assertEqual(caught.exception.code, 503)
        self.assertEqual(server.calls, 4)


if __name__ == "__main__":
    unittest.main()
