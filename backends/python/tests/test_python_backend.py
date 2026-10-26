import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import domain  # noqa: E402
import server  # noqa: E402
from store import Store  # noqa: E402


class DomainTests(unittest.TestCase):
    def test_title_trimmed_and_counted_in_code_points(self):
        ok, errs = domain.validate_create({"title": "  hi  "})
        self.assertEqual((ok, errs), ({"title": "hi", "body": ""}, []))
        self.assertEqual(domain.validate_create({"title": "😀" * 200})[1], [])
        self.assertEqual(domain.validate_create({"title": "😀" * 201})[1][0][0], "title")

    def test_rejections_name_the_field(self):
        for data, field in [({"title": ""}, "title"), ({"title": 4}, "title"), ({"title": "t", "foo": 1}, "foo"),
                            ({"title": "t", "version": 3}, "version"), ({"title": "t", "body": "b" * 100001}, "body")]:
            self.assertIn(field, [f for f, _ in domain.validate_create(data)[1]])
        self.assertTrue(domain.validate_patch({})[1])
        self.assertTrue(domain.validate_patch(None)[1])

    def test_preconditions(self):
        self.assertEqual(domain.check_precondition(None, 1), 428)
        self.assertEqual(domain.check_precondition("*", 1), 428)
        self.assertEqual(domain.check_precondition('"1"', 2), 412)
        self.assertIsNone(domain.check_precondition('"2"', 2))

    def test_if_match_strong_comparison(self):
        cp = domain.check_precondition
        self.assertEqual(cp('W/"1"', 1), 412)
        self.assertIsNone(cp('"9", "1"', 1))
        self.assertEqual(cp('"8", "9"', 1), 412)
        self.assertEqual(cp('"1", *', 1), 428)
        self.assertEqual(cp('"01"', 1), 412)
        self.assertEqual(cp("1", 1), 412)
        self.assertEqual(cp("", 1), 428)

    def test_trim_uses_unicode_white_space(self):
        self.assertEqual(domain.validate_create({"title": "\u00a0hi\u3000"})[0]["title"], "hi")
        self.assertEqual(domain.validate_create({"title": "\u2003\u0085hi\u2028"})[0]["title"], "hi")
        self.assertEqual(domain.validate_create({"title": "\u00a0\u00a0"})[1][0][0], "title")
        for keep in ("\u200b", "\ufeff", "\x1c", "\x1f"):  # not White_Space
            self.assertEqual(domain.validate_create({"title": keep})[0]["title"], keep)
        self.assertEqual(domain.validate_create({"title": "e\u0301" * 100})[1], [])
        self.assertEqual(domain.validate_create({"title": "e\u0301" * 101})[1][0][0], "title")

    def test_timestamp_format(self):
        self.assertRegex(domain.now_iso(), r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(Store()))
        cls.base = f"http://127.0.0.1:{cls.srv.server_port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def call(self, method, path, body=None, token="tok_alice", headers=None):
        h = dict(headers or {})
        if token:
            h["Authorization"] = f"Bearer {token}"
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def test_note_lifecycle_with_etags_and_trash(self):
        s, h, b = self.call("POST", "/teams/team-red/notes", {"title": "a", "body": "keep"})
        note = json.loads(b)
        self.assertEqual((s, h["ETag"], h["Location"]), (201, '"1"', f"/notes/{note['id']}"))
        self.assertEqual(self.call("PATCH", f"/notes/{note['id']}", {"title": "b"})[0], 428)
        s, h, b = self.call("PATCH", f"/notes/{note['id']}", {"title": "b"}, token="tok_bob", headers={"If-Match": '"1"'})
        self.assertEqual((s, h["ETag"], json.loads(b)["body"]), (200, '"2"', "keep"))
        self.assertEqual(self.call("PATCH", f"/notes/{note['id']}", {"title": "c"}, headers={"If-Match": '"1"'})[0], 412)
        self.assertEqual(self.call("DELETE", f"/notes/{note['id']}")[0], 204)
        self.assertEqual(self.call("DELETE", f"/notes/{note['id']}")[0], 204)
        self.assertEqual(self.call("GET", f"/notes/{note['id']}")[0], 404)
        trash = json.loads(self.call("GET", "/teams/team-red/notes?archived=true")[2])["items"]
        self.assertIn(note["id"], [n["id"] for n in trash])
        s, h, b = self.call("POST", f"/notes/{note['id']}/restore")
        self.assertEqual((s, json.loads(b)["version"], "deletedAt" in json.loads(b)), (200, 3, False))

    def test_precedence_and_identical_404(self):
        _, _, b = self.call("POST", "/teams/team-red/notes", {"title": "x"})
        nid = json.loads(b)["id"]
        bodies = {self.call("GET", p, token="tok_carol")[2] for p in (f"/notes/{nid}", "/notes/not-a-uuid", "/notes/" + "0" * 8)}
        self.assertEqual(len(bodies), 1)
        self.assertEqual(self.call("PATCH", f"/notes/{nid}", b"{nope", token="tok_carol", headers={"Content-Type": "text/plain"})[0], 404)
        self.assertEqual(self.call("PATCH", f"/notes/{nid}", b"{nope", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.call("PATCH", f"/notes/{nid}", b"{nope")[0], 400)
        self.assertEqual(self.call("PATCH", f"/notes/{nid}", {"title": ""})[0], 422)
        self.assertEqual(self.call("GET", "/me", token=None)[0], 401)

    def test_413_closes_connection(self):
        s, h, _ = self.call("POST", "/teams/team-red/notes", b'{"title":"t","body":"' + b"z" * 2_200_000 + b'"}')
        self.assertEqual((s, h["Connection"]), (413, "close"))


if __name__ == "__main__":
    unittest.main()
