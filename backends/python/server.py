"""HTTP adapter: ThreadingHTTPServer around api.handle."""
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import api
from store import Store


def make_handler(store):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "TeamNotesPy"
        disable_nagle_algorithm = True

        def _read_chunked(self, limit):
            out, over = bytearray(), False
            while True:
                size = int(self.rfile.readline(1024).split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    while self.rfile.readline(1024).strip():
                        pass
                    if over:
                        raise api.TooLarge()
                    return bytes(out)
                if len(out) + size > limit:
                    over = True  # keep reading (and dropping) so the 413 is not lost to a reset
                chunk = self.rfile.read(size)
                if not over:
                    out += chunk
                self.rfile.readline(8)

        def _read_body(self, limit):
            self._consumed = True
            if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
                return self._read_chunked(limit)
            length = int(self.headers.get("Content-Length") or 0)
            if length > limit:
                self._consumed = False  # leave the bytes for _discard
                raise api.TooLarge()
            return self.rfile.read(length)

        def _has_body(self):
            return bool(int(self.headers.get("Content-Length") or 0)) or \
                "chunked" in self.headers.get("Transfer-Encoding", "").lower()

        def _discard(self):
            """Swallow an oversized body so the client can read our 413 instead of a reset."""
            try:
                left = int(self.headers.get("Content-Length") or 0)
                if "chunked" not in self.headers.get("Transfer-Encoding", "").lower():
                    while 0 < left <= 64 * 1024 * 1024:
                        left -= len(self.rfile.read(min(left, 65536)) or b"") or left
            except Exception:
                pass

        def _bad_length(self):
            cl = self.headers.get("Content-Length")
            return cl is not None and not (cl.strip().isascii() and cl.strip().isdigit())

        def _serve(self):
            self._consumed = False
            if self._bad_length():
                resp = api.problem(400, close=True)
                self.close_connection = True
                self._send(resp, True)
                return
            try:
                req = api.Request(self.command, self.path, dict(self.headers), self._has_body(), self._read_body)
                resp = api.handle(store, req)
            except Exception as e:  # last resort: never leak a stack trace
                print("error:", repr(e), file=sys.stderr)
                resp = api.problem(500, close=True)
            close = resp.close
            if close and not self._consumed:
                self._discard()
            if not self._consumed and self._has_body():
                try:  # drain a small unread body so the keep-alive connection stays usable
                    if int(self.headers.get("Content-Length") or 0) <= 2 * 1024 * 1024 and \
                            "chunked" not in self.headers.get("Transfer-Encoding", "").lower():
                        self._read_body(2 * 1024 * 1024)
                    else:
                        close = True
                except Exception:
                    close = True
            self._send(resp, close)

        def _send(self, resp, close):
            self.send_response(resp.status)
            for k, v in resp.headers.items():
                self.send_header(k, v)
            if resp.status != 204:
                self.send_header("Content-Length", str(len(resp.body)))
            if close:
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()  # buffered in _headers_buffer; flushed with the body below
            if self.command != "HEAD":
                self._headers_buffer.append(resp.body)
            self.flush_headers()

        do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = do_HEAD = do_OPTIONS = _serve

        def log_message(self, *args):
            pass

    return Handler


def main():
    store = Store(os.environ.get("DB_PATH", ":memory:"))
    port = int(os.environ.get("PORT", "3004"))
    server = ThreadingHTTPServer(("0.0.0.0", port), make_handler(store))
    server.daemon_threads = True
    print(f"team-notes (python) listening on :{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
