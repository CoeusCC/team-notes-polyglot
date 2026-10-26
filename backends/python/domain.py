"""Pure domain rules: validation, ETag parsing, timestamps. No I/O besides the clock."""
import re
from datetime import datetime, timezone

TITLE_MAX = 200
BODY_MAX = 100_000
MAX_BODY_BYTES = 2 * 1024 * 1024
READ_ONLY = ("id", "teamId", "authorId", "version", "createdAt", "updatedAt", "deletedAt")
SETTABLE = ("title", "body")


# Unicode White_Space property (not U+200B, U+FEFF, nor U+001C-001F which str.strip() would remove)
WHITE_SPACE = "\t\n\x0b\x0c\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007" \
              "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"


def trim(s):
    return s.strip(WHITE_SPACE)


def now_iso():
    t = datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def _encodable(s):
    try:
        s.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def _check_title(v, errors):
    if not isinstance(v, str):
        errors.append(("title", "must be a string"))
        return None
    t = trim(v)
    if not 1 <= len(t) <= TITLE_MAX or not _encodable(t):
        errors.append(("title", f"must be 1-{TITLE_MAX} characters after trimming"))
        return None
    return t


def _check_body(v, errors):
    if not isinstance(v, str):
        errors.append(("body", "must be a string"))
        return None
    if len(v) > BODY_MAX or not _encodable(v):
        errors.append(("body", f"must be at most {BODY_MAX} characters"))
        return None
    return v


def _check_fields(data, errors):
    """Checks every present field; returns the clean dict of settable fields."""
    out = {}
    for k in data:
        if k in READ_ONLY:
            errors.append((k, "is read-only"))
        elif k not in SETTABLE:
            errors.append((k, "unknown field"))
    if "title" in data:
        t = _check_title(data["title"], errors)
        if t is not None:
            out["title"] = t
    if "body" in data:
        b = _check_body(data["body"], errors)
        if b is not None:
            out["body"] = b
    return out


def validate_create(data):
    """Returns (clean, errors). clean has title and body."""
    if not isinstance(data, dict):
        return None, [("$", "must be a JSON object")]
    errors = []
    out = _check_fields(data, errors)
    if "title" not in data:
        errors.append(("title", "is required"))
    out.setdefault("body", "")
    return (None, errors) if errors else (out, [])


SLUG_RE = re.compile(r"[a-z0-9-]{3,40}")
TEAM_NAME_MAX = 80


def validate_team(data):
    """Returns (clean, errors) for POST /teams: slug id, trimmed name, no unknown fields."""
    if not isinstance(data, dict):
        return None, [("$", "must be a JSON object")]
    errors, out = [], {}
    for k in data:
        if k not in ("id", "name"):
            errors.append((k, "unknown field"))
    v = data.get("id")
    if "id" not in data:
        errors.append(("id", "is required"))
    elif not isinstance(v, str) or not SLUG_RE.fullmatch(v):
        errors.append(("id", "must match ^[a-z0-9-]{3,40}$"))
    else:
        out["id"] = v
    v = data.get("name")
    if "name" not in data:
        errors.append(("name", "is required"))
    elif not isinstance(v, str):
        errors.append(("name", "must be a string"))
    else:
        t = trim(v)
        if not 1 <= len(t) <= TEAM_NAME_MAX or not _encodable(t):
            errors.append(("name", f"must be 1-{TEAM_NAME_MAX} characters after trimming"))
        else:
            out["name"] = t
    return (None, errors) if errors else (out, [])


def validate_patch(data):
    if not isinstance(data, dict):
        return None, [("$", "must be a JSON object")]
    errors = []
    out = _check_fields(data, errors)
    if not data:
        errors.append(("$", "at least one of title, body is required"))
    return (None, errors) if errors else (out, [])


def check_precondition(header, current_version):
    """Returns None if satisfied, else the status to answer: 428 or 412."""
    if header is None or header.strip() == "":
        return 428
    tags = [p.strip() for p in header.split(",")]
    if "*" in tags:
        return 428
    return None if etag(current_version) in tags else 412


def etag(version):
    return f'"{version}"'
