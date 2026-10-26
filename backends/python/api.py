"""Routing and the error-precedence pipeline. Transport-agnostic: see server.py for the socket side."""
import json
import re
from urllib.parse import parse_qs, urlsplit

import domain

PROBLEM = "application/problem+json"
TYPES = {
    400: ("bad-request", "Bad Request"), 401: ("unauthorized", "Unauthorized"),
    404: ("not-found", "Not Found"), 412: ("precondition-failed", "Precondition Failed"),
    413: ("payload-too-large", "Payload Too Large"), 415: ("unsupported-media-type", "Unsupported Media Type"),
    422: ("validation-failed", "Unprocessable Entity"), 428: ("precondition-required", "Precondition Required"),
    500: ("internal-error", "Internal Server Error"),
}


class TooLarge(Exception):
    pass


class Response:
    def __init__(self, status, payload=None, headers=None, problem=False, close=False):
        self.status, self.headers, self.close = status, dict(headers or {}), close
        self.body = b""
        if payload is not None:
            self.body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.headers["Content-Type"] = PROBLEM if problem else "application/json"


class Request:
    """body_reader(limit) -> bytes, raising TooLarge when the body exceeds limit."""
    def __init__(self, method, target, headers, has_body, body_reader):
        parts = urlsplit(target)
        self.method, self.path, self.query = method, parts.path, parse_qs(parts.query)
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.has_body, self._read = has_body, body_reader

    def token(self):
        m = re.fullmatch(r"(?i)bearer +(\S+)", self.headers.get("authorization", "").strip())
        return m.group(1) if m else None


def problem(status, errors=None, headers=None, close=False):
    kind, title = TYPES[status]
    p = {"type": f"https://teamnotes.example/problems/{kind}", "title": title, "status": status}
    if errors:
        p["errors"] = [{"field": f, "message": m} for f, m in errors]
    return Response(status, p, headers, problem=True, close=close)


NOT_FOUND = problem(404)  # one shared body: hidden, missing, malformed and unknown routes are identical


def parse_json_body(req):
    """Applies 415 -> 413 -> 400. Returns (data, error_response)."""
    ctype = req.headers.get("content-type", "").split(";")[0].strip().lower()
    if req.has_body and ctype != "application/json":
        return None, problem(415)
    try:
        raw = req._read(domain.MAX_BODY_BYTES)
    except TooLarge:
        return None, problem(413, close=True)
    def reject(_):
        raise ValueError("non-finite number")
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=reject), None
    except (ValueError, RecursionError):
        return None, problem(400)


def note_response(status, note, extra=None):
    return Response(status, note, {"ETag": domain.etag(note["version"]), **(extra or {})})


def get_me(store, user, req):
    return Response(200, {**user, "teams": store.teams_of(user["id"])})


def list_teams(store, user, req):
    return Response(200, {"items": store.teams_of(user["id"])})


def list_notes(store, user, req, team_id):
    if not store.is_member(team_id, user["id"]):
        return NOT_FOUND
    archived = req.query.get("archived", ["false"])[-1] == "true"
    return Response(200, {"items": store.list_notes(team_id, archived)})


def create_note(store, user, req, team_id):
    if not store.is_member(team_id, user["id"]):
        return NOT_FOUND
    data, err = parse_json_body(req)
    if err:
        return err
    clean, errors = domain.validate_create(data)
    if errors:
        return problem(422, errors)
    note = store.create_note(team_id, user["id"], clean["title"], clean["body"])
    return note_response(201, note, {"Location": f"/notes/{note['id']}"})


def get_note(store, user, req, note_id):
    note = store.get_note(note_id, user["id"])
    return note_response(200, note) if note else NOT_FOUND


def patch_note(store, user, req, note_id):
    note = store.get_note(note_id, user["id"])
    if not note:
        return NOT_FOUND
    data, err = parse_json_body(req)
    if err:
        return err
    clean, errors = domain.validate_patch(data)
    if errors:
        return problem(422, errors)
    failure = domain.check_precondition(req.headers.get("if-match"), note["version"])
    if failure == 428:
        return problem(428)
    updated = store.update_note(note_id, note["version"], clean) if failure is None else None
    if updated:
        return note_response(200, updated)
    current = store.get_note(note_id, user["id"]) or note
    return problem(412, headers={"ETag": domain.etag(current["version"])})


def delete_note(store, user, req, note_id):
    if not store.get_note(note_id, user["id"], include_deleted=True):
        return NOT_FOUND
    store.soft_delete(note_id)
    return Response(204)


def restore_note(store, user, req, note_id):
    if not store.get_note(note_id, user["id"], include_deleted=True):
        return NOT_FOUND
    return note_response(200, store.restore(note_id))


ROUTES = [
    ("GET", r"/me", get_me), ("GET", r"/teams", list_teams),
    ("GET", r"/teams/([^/]+)/notes", list_notes), ("POST", r"/teams/([^/]+)/notes", create_note),
    ("GET", r"/notes/([^/]+)", get_note), ("PATCH", r"/notes/([^/]+)", patch_note),
    ("DELETE", r"/notes/([^/]+)", delete_note), ("POST", r"/notes/([^/]+)/restore", restore_note),
]


def handle(store, req):
    if req.method == "GET" and req.path == "/health":
        return Response(200, {"status": "ok"})
    token = req.token()
    user = store.user_for_token(token) if token else None
    if not user:
        return problem(401, headers={"WWW-Authenticate": "Bearer"})
    for method, pattern, fn in ROUTES:
        m = re.fullmatch(pattern, req.path)
        if m and method == req.method:
            return fn(store, user, req, *m.groups())
    return NOT_FOUND
