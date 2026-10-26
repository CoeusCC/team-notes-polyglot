//! HTTP adapter: routing by hand so that every response, including framework-level failures,
//! is a spec-shaped problem+json and the error precedence is ours (ADR-0003).
use crate::domain::{self, FieldError, Precondition};
use crate::store::{self, Note, UpdateOutcome, User};
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;
use http_body_util::BodyExt;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Connection>>;

/// Stop buffering at the limit but keep draining (bounded) so the client can read our 413.
const DRAIN_CAP: usize = 64 * 1024 * 1024;

struct RawBody {
    bytes: Vec<u8>,
    overflow: bool,
}

async fn read_body(mut body: Body) -> RawBody {
    let (mut bytes, mut seen, mut overflow) = (Vec::new(), 0usize, false);
    while let Some(Ok(frame)) = body.frame().await {
        if let Ok(data) = frame.into_data() {
            seen += data.len();
            if seen > domain::MAX_REQUEST_BYTES {
                overflow = true;
                bytes.clear();
            } else if !overflow {
                bytes.extend_from_slice(&data);
            }
            if seen > DRAIN_CAP {
                break;
            }
        }
    }
    RawBody { bytes, overflow }
}

// ---- responses ----------------------------------------------------------------------------

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response {
    let mut r = Response::new(Body::from(body));
    *r.status_mut() = status;
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(content_type).unwrap());
    r
}

fn json_response<T: Serialize>(status: StatusCode, v: &T) -> Response {
    respond(status, "application/json", serde_json::to_vec(v).unwrap())
}

fn with_etag(mut r: Response, version: i64) -> Response {
    r.headers_mut().insert(header::ETAG, HeaderValue::from_str(&domain::etag(version)).unwrap());
    r
}

fn problem(status: StatusCode, title: &str, detail: Option<&str>, errors: Option<&[FieldError]>) -> Response {
    let slug = title.to_lowercase().replace(' ', "-");
    let mut v = json!({
        "type": format!("https://teamnotes.example/problems/{slug}"),
        "title": title,
        "status": status.as_u16(),
    });
    if let Some(d) = detail {
        v["detail"] = json!(d);
    }
    if let Some(es) = errors {
        v["errors"] = es.iter().map(|e| json!({"field": e.field, "message": e.message})).collect();
    }
    respond(status, "application/problem+json", serde_json::to_vec(&v).unwrap())
}

/// One body for every kind of "not found / not visible", so they are byte-identical.
fn not_found() -> Response {
    problem(StatusCode::NOT_FOUND, "Not Found", None, None)
}
fn unauthorized() -> Response {
    let mut r = problem(StatusCode::UNAUTHORIZED, "Unauthorized", Some("A valid bearer token is required"), None);
    r.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
    r
}
fn internal(e: rusqlite::Error) -> Response {
    eprintln!("db error: {e}");
    problem(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error", None, None)
}
fn invalid(errors: &[FieldError]) -> Response {
    problem(StatusCode::UNPROCESSABLE_ENTITY, "Unprocessable Entity", Some("Validation failed"), Some(errors))
}

// ---- request handling ---------------------------------------------------------------------

fn header_str<'a>(h: &'a HeaderMap, name: header::HeaderName) -> Option<&'a str> {
    h.get(name).and_then(|v| v.to_str().ok())
}

/// 415 → 413 → 400, then the parsed JSON value (validation is the caller's 422 step).
fn json_body(headers: &HeaderMap, raw: &RawBody) -> Result<Value, Response> {
    let sent = !raw.bytes.is_empty() || raw.overflow;
    if sent && !domain::is_json_content_type(header_str(headers, header::CONTENT_TYPE)) {
        return Err(problem(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Unsupported Media Type", Some("Content-Type must be application/json"), None));
    }
    if raw.overflow {
        let mut r = problem(StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large", Some("Request body exceeds 2 MiB"), None);
        r.headers_mut().insert(header::CONNECTION, HeaderValue::from_static("close"));
        return Err(r);
    }
    serde_json::from_slice(&raw.bytes)
        .map_err(|_| problem(StatusCode::BAD_REQUEST, "Bad Request", Some("Request body is not valid JSON"), None))
}

fn note_response(status: StatusCode, n: &Note) -> Response {
    with_etag(json_response(status, n), n.version)
}

pub async fn handle(State(db): State<Db>, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    let raw = read_body(body).await;
    let path = parts.uri.path().to_string();
    let segs: Vec<&str> = path.trim_start_matches('/').split('/').collect();

    if parts.method == Method::GET && segs == ["health"] {
        return json_response(StatusCode::OK, &json!({"status": "ok"}));
    }
    let conn = db.lock().unwrap_or_else(|p| p.into_inner());
    let user = match domain::bearer_token(header_str(&parts.headers, header::AUTHORIZATION)) {
        None => return unauthorized(),
        Some(t) => match store::user_by_token(&conn, t) {
            Ok(Some(u)) => u,
            Ok(None) => return unauthorized(),
            Err(e) => return internal(e),
        },
    };
    let result = route(&conn, &user, &parts.method, &segs, &parts.headers, &raw, parts.uri.query());
    result.unwrap_or_else(internal)
}

/// `archived` accepts exactly `true` or `false`; anything else is a 422 on `archived`.
fn archived_flag(query: Option<&str>) -> Result<bool, Response> {
    let Some(q) = query else { return Ok(false) };
    match q.split('&').find_map(|p| p.strip_prefix("archived=").or((p == "archived").then_some(""))) {
        None | Some("false") => Ok(false),
        Some("true") => Ok(true),
        Some(_) => Err(invalid(&[FieldError { field: "archived".into(), message: "must be true or false".into() }])),
    }
}

/// Non-empty body that is not JSON: 415 (for operations that otherwise ignore the body).
fn ignored_body_check(headers: &HeaderMap, raw: &RawBody) -> Option<Response> {
    let sent = !raw.bytes.is_empty() || raw.overflow;
    (sent && !domain::is_json_content_type(header_str(headers, header::CONTENT_TYPE)))
        .then(|| problem(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Unsupported Media Type", Some("Content-Type must be application/json"), None))
}

fn route(
    c: &Connection,
    user: &User,
    method: &Method,
    segs: &[&str],
    headers: &HeaderMap,
    raw: &RawBody,
    query: Option<&str>,
) -> rusqlite::Result<Response> {
    Ok(match (method, segs) {
        (&Method::GET, ["me"]) => {
            json_response(StatusCode::OK, &json!({"id": user.id, "name": user.name, "teams": store::teams_of(c, &user.id)?}))
        }
        (&Method::GET, ["teams"]) => json_response(StatusCode::OK, &json!({"items": store::teams_of(c, &user.id)?})),
        (&Method::POST, ["teams"]) => {
            let value = match json_body(headers, raw) {
                Ok(v) => v,
                Err(r) => return Ok(r),
            };
            match domain::parse_team(&value) {
                Err(errs) => invalid(&errs),
                Ok(t) => {
                    if !store::create_team(c, &t.id, &t.name, &user.id)? {
                        return Ok(problem(StatusCode::CONFLICT, "Conflict", Some("A team with this id already exists"), None));
                    }
                    let mut r = json_response(StatusCode::CREATED, &json!({"id": t.id, "name": t.name, "role": "owner"}));
                    r.headers_mut().insert(header::LOCATION, HeaderValue::from_str(&format!("/teams/{}", t.id)).unwrap());
                    r
                }
            }
        }
        (&Method::GET, ["teams", team]) => match store::team_for(c, team, &user.id)? {
            Some(t) => json_response(StatusCode::OK, &t),
            None => not_found(),
        },
        (&Method::GET, ["teams", team, "members"]) => {
            if !store::is_member(c, team, &user.id)? {
                return Ok(not_found());
            }
            json_response(StatusCode::OK, &json!({"items": store::members(c, team)?}))
        }
        (&Method::PUT | &Method::DELETE, ["teams", team, "members", target]) => {
            match store::team_for(c, team, &user.id)? {
                None => return Ok(not_found()),
                Some(t) if t.role != "owner" => {
                    return Ok(problem(StatusCode::FORBIDDEN, "Forbidden", Some("Only the team owner manages membership"), None))
                }
                Some(_) => {}
            }
            if let Some(r) = ignored_body_check(headers, raw) {
                return Ok(r);
            }
            if method == Method::PUT {
                match store::user_by_id(c, target)? {
                    None => invalid(&[FieldError { field: "userId".into(), message: "unknown user".into() }]),
                    Some(u) => json_response(StatusCode::OK, &store::add_member(c, team, &u)?),
                }
            } else if store::remove_member(c, team, target)? {
                respond(StatusCode::NO_CONTENT, "application/json", Vec::new())
            } else {
                problem(StatusCode::CONFLICT, "Conflict", Some("The last owner cannot be removed"), None)
            }
        }
        (&Method::GET, ["teams", team, "notes"]) => {
            if !store::is_member(c, team, &user.id)? {
                return Ok(not_found());
            }
            match archived_flag(query) {
                Ok(a) => json_response(StatusCode::OK, &json!({"items": store::list_notes(c, team, a)?})),
                Err(r) => r,
            }
        }
        (&Method::POST, ["teams", team, "notes"]) => {
            if !store::is_member(c, team, &user.id)? {
                return Ok(not_found());
            }
            let value = match json_body(headers, raw) {
                Ok(v) => v,
                Err(r) => return Ok(r),
            };
            match domain::parse_create(&value) {
                Err(errs) => invalid(&errs),
                Ok(new) => {
                    let n = store::insert_note(c, team, &user.id, &new)?;
                    let mut r = note_response(StatusCode::CREATED, &n);
                    r.headers_mut().insert(header::LOCATION, HeaderValue::from_str(&format!("/notes/{}", n.id)).unwrap());
                    r
                }
            }
        }
        (&Method::GET, ["notes", id]) => match store::note_for_member(c, id, &user.id)? {
            Some(n) if n.deleted_at.is_none() => note_response(StatusCode::OK, &n),
            _ => not_found(),
        },
        (&Method::PATCH, ["notes", id]) => match store::note_for_member(c, id, &user.id)? {
            Some(n) if n.deleted_at.is_none() => patch_note(c, &n, headers, raw)?,
            _ => not_found(),
        },
        (&Method::DELETE, ["notes", id]) => match store::note_for_member(c, id, &user.id)? {
            Some(n) => {
                if let Some(r) = ignored_body_check(headers, raw) {
                    return Ok(r);
                }
                store::soft_delete(c, &n.id)?;
                respond(StatusCode::NO_CONTENT, "application/json", Vec::new())
            }
            None => not_found(),
        },
        (&Method::POST, ["notes", id, "restore"]) => match store::note_for_member(c, id, &user.id)? {
            Some(_) if ignored_body_check(headers, raw).is_some() => ignored_body_check(headers, raw).unwrap(),
            Some(n) => match store::restore(c, &n.id)? {
                Some(n) => note_response(StatusCode::OK, &n),
                None => not_found(),
            },
            None => not_found(),
        },
        _ => not_found(),
    })
}

fn patch_note(c: &Connection, note: &Note, headers: &HeaderMap, raw: &RawBody) -> rusqlite::Result<Response> {
    let value = match json_body(headers, raw) {
        Ok(v) => v,
        Err(r) => return Ok(r),
    };
    let patch = match domain::parse_patch(&value) {
        Ok(p) => p,
        Err(errs) => return Ok(invalid(&errs)),
    };
    let pre = domain::parse_if_match(header_str(headers, header::IF_MATCH));
    if pre == Precondition::Required {
        return Ok(problem(StatusCode::PRECONDITION_REQUIRED, "Precondition Required", Some("A specific If-Match ETag is required"), None));
    }
    // The check and the increment stay one conditional UPDATE; `expected` is the version
    // the list names that equals the current one (or -1, which matches nothing).
    let expected = if pre.matches(note.version) { note.version } else { -1 };
    Ok(match store::update_note(c, &note.id, expected, &patch)? {
        UpdateOutcome::Updated(n) => note_response(StatusCode::OK, &n),
        UpdateOutcome::Stale(n) => with_etag(
            problem(StatusCode::PRECONDITION_FAILED, "Precondition Failed", Some("If-Match does not match the current version"), None),
            n.version,
        ),
        UpdateOutcome::Gone => not_found(),
    })
}
