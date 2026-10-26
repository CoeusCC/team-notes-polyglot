"""Routing and the error-precedence pipeline. Transport-agnostic: see server.py for the socket side."""
import json
import re
from urllib.parse import parse_qs, urlsplit

import domain

PROBLEM = "application/problem+json"
TYPES = {
    400: ("bad-request", "Bad Request"), 401: ("unauthorized", "Unauthorized"),
    403: ("forbidden", "Forbidden"), 404: ("not-found", "Not Found"), 409: ("conflict", "Conflict"), 412: ("precondition-failed", "Precondition Failed"),
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
        self.method, self.path, self.query = method, parts.path, parse_qs(parts.query, keep_blank_values=True)
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


def media_error(req):
    """ERR-3: any non-empty body that is not application/json gets 415, on every operation."""
    ctype = req.headers.get("content-type", "").split(";")[0].strip().lower()
    return problem(415) if req.has_body and ctype != "application/json" else None


def parse_json_body(req):
    """Applies 415 -> 413 -> 400. Returns (data, error_response)."""
    if media_error(req):
        return None, media_error(req)
    try:
        raw = req._read(domain.MAX_BODY_BYTES)
    except TooLarge:
        return None, problem(413, close=True)
    def reject(_):
        raise ValueError("non-finite number")
    try:
        data = json.loads(raw.decode("utf-8"), parse_constant=reject)
        if _has_lone_surrogate(data):  # I-JSON (NOTES-TECH-FMT-3): same 400 as malformed JSON
            return None, problem(400)
        return data, None
    except (ValueError, RecursionError):
        return None, problem(400)


def _has_lone_surrogate(root):
    stack = [root]
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            if any("\ud800" <= c <= "\udfff" for c in v):
                return True
        elif isinstance(v, dict):
            stack.extend(v.keys())
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
    return False


def note_response(status, note, extra=None):
    return Response(status, note, {"ETag": domain.etag(note["version"]), **(extra or {})})


def get_me(store, user, req):
    return Response(200, {**user, "teams": store.teams_of(user["id"])})


def list_teams(store, user, req):
    return Response(200, {"items": store.teams_of(user["id"])})


def create_team(store, user, req):
    data, err = parse_json_body(req)
    if err:
        return err
    clean, errors = domain.validate_team(data)
    if errors:
        return problem(422, errors)
    team = store.create_team(clean["id"], clean["name"], user["id"])
    if team is None:
        return problem(409)
    return Response(201, team, {"Location": f"/teams/{team['id']}"})


def get_team(store, user, req, team_id):
    team = store.get_team(team_id, user["id"])
    return Response(200, team) if team else NOT_FOUND


def list_members(store, user, req, team_id):
    if not store.is_member(team_id, user["id"]):
        return NOT_FOUND
    return Response(200, {"items": store.members(team_id)})


def _owner_gate(store, user, team_id):
    """404 for non-members, 403 for plain members; None for the owner."""
    role = store.role_of(team_id, user["id"])
    if role is None:
        return NOT_FOUND
    return None if role == "owner" else problem(403)


def add_member(store, user, req, team_id, user_id):
    denied = _owner_gate(store, user, team_id) or media_error(req)
    if denied:
        return denied
    target = store.user(user_id)
    if not target:
        return problem(422, [("userId", "unknown user")])
    store.add_member(team_id, user_id)
    return Response(200, {**target, "role": store.role_of(team_id, user_id)})


def remove_member(store, user, req, team_id, user_id):
    denied = _owner_gate(store, user, team_id) or media_error(req)
    if denied:
        return denied
    return Response(204) if store.remove_member(team_id, user_id) else problem(409)


def list_notes(store, user, req, team_id):
    if not store.is_member(team_id, user["id"]):
        return NOT_FOUND
    flag = req.query.get("archived", ["false"])[-1]
    if flag not in ("true", "false"):
        return problem(422, [("archived", "must be true or false")])
    archived = flag == "true"
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
    if media_error(req):
        return media_error(req)
    store.soft_delete(note_id)
    return Response(204)


def restore_note(store, user, req, note_id):
    if not store.get_note(note_id, user["id"], include_deleted=True):
        return NOT_FOUND
    if media_error(req):
        return media_error(req)
    return note_response(200, store.restore(note_id))


ROUTES = [
    ("GET", r"/me", get_me), ("GET", r"/teams", list_teams),
    ("POST", r"/teams", create_team), ("GET", r"/teams/([^/]+)", get_team),
    ("GET", r"/teams/([^/]+)/members", list_members),
    ("PUT", r"/teams/([^/]+)/members/([^/]+)", add_member),
    ("DELETE", r"/teams/([^/]+)/members/([^/]+)", remove_member),
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
