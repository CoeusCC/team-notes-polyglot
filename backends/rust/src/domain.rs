//! Pure domain: parse untrusted JSON once into typed values, so invalid notes cannot be represented.
use serde_json::Value;

pub const MAX_TITLE: usize = 200;
pub const MAX_BODY: usize = 100_000;
pub const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;

const READ_ONLY: [&str; 7] = ["id", "teamId", "authorId", "version", "createdAt", "updatedAt", "deletedAt"];

#[derive(Debug, Clone, PartialEq)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

fn err(field: &str, message: &str) -> FieldError {
    FieldError { field: field.to_string(), message: message.to_string() }
}

/// A trimmed title of 1..=200 code points.
#[derive(Debug, Clone, PartialEq)]
pub struct Title(String);

impl Title {
    pub fn parse(v: &Value) -> Result<Title, FieldError> {
        let s = v.as_str().ok_or_else(|| err("title", "must be a string"))?;
        let t = s.trim();
        let n = t.chars().count();
        if n == 0 || n > MAX_TITLE {
            return Err(err("title", "must be 1-200 characters after trimming"));
        }
        Ok(Title(t.to_string()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A body of at most 100,000 code points.
#[derive(Debug, Clone, PartialEq)]
pub struct Body(String);

impl Body {
    pub fn parse(v: &Value) -> Result<Body, FieldError> {
        let s = v.as_str().ok_or_else(|| err("body", "must be a string"))?;
        if s.chars().count() > MAX_BODY {
            return Err(err("body", "must be at most 100000 characters"));
        }
        Ok(Body(s.to_string()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug)]
pub struct NewNote {
    pub title: Title,
    pub body: Body,
}

#[derive(Debug)]
pub struct NotePatch {
    pub title: Option<Title>,
    pub body: Option<Body>,
}

struct Fields {
    title: Option<Title>,
    body: Option<Body>,
    count: usize,
    has_title_key: bool,
}

/// Validate the shared fields, collecting every problem.
fn parse_fields(v: &Value, errors: &mut Vec<FieldError>) -> Option<Fields> {
    let Some(obj) = v.as_object() else {
        errors.push(err("$", "request body must be a JSON object"));
        return None;
    };
    let mut f = Fields { title: None, body: None, count: obj.len(), has_title_key: obj.contains_key("title") };
    for (k, val) in obj {
        match k.as_str() {
            "title" => match Title::parse(val) {
                Ok(t) => f.title = Some(t),
                Err(e) => errors.push(e),
            },
            "body" => match Body::parse(val) {
                Ok(b) => f.body = Some(b),
                Err(e) => errors.push(e),
            },
            k if READ_ONLY.contains(&k) => errors.push(err(k, "is read-only")),
            k => errors.push(err(k, "unknown field")),
        }
    }
    Some(f)
}

pub fn parse_create(v: &Value) -> Result<NewNote, Vec<FieldError>> {
    let mut errors = Vec::new();
    if let Some(f) = parse_fields(v, &mut errors) {
        if !f.has_title_key {
            errors.push(err("title", "is required"));
        }
        if errors.is_empty() {
            if let Some(title) = f.title {
                return Ok(NewNote { title, body: f.body.unwrap_or(Body(String::new())) });
            }
        }
    }
    Err(errors)
}

pub fn parse_patch(v: &Value) -> Result<NotePatch, Vec<FieldError>> {
    let mut errors = Vec::new();
    if let Some(f) = parse_fields(v, &mut errors) {
        if f.count == 0 {
            errors.push(err("$", "at least one of title, body is required"));
        }
        if errors.is_empty() {
            return Ok(NotePatch { title: f.title, body: f.body });
        }
    }
    Err(errors)
}

#[derive(Debug, PartialEq)]
pub enum Precondition {
    /// Missing header, empty, or a list containing `*`: 428.
    Required,
    /// Versions named by the strong, canonically formatted entity tags in the list.
    /// Anything else (weak, unquoted, `"01"`) can never match, so it contributes nothing.
    Versions(Vec<i64>),
}

impl Precondition {
    /// Strong comparison (RFC 9110 8.8.3.2): some entry must be byte-equal to the current ETag.
    pub fn matches(&self, current: i64) -> bool {
        matches!(self, Precondition::Versions(v) if v.contains(&current))
    }
}

pub fn parse_if_match(h: Option<&str>) -> Precondition {
    let Some(h) = h else { return Precondition::Required };
    let entries: Vec<&str> = h.split(',').map(str::trim).filter(|e| !e.is_empty()).collect();
    if entries.is_empty() || entries.contains(&"*") {
        return Precondition::Required;
    }
    let versions = entries
        .iter()
        .filter_map(|e| {
            let n: i64 = e.strip_prefix('"')?.strip_suffix('"')?.parse().ok()?;
            (etag(n) == *e).then_some(n)
        })
        .collect();
    Precondition::Versions(versions)
}

pub fn etag(version: i64) -> String {
    format!("\"{version}\"")
}

pub fn is_json_content_type(h: Option<&str>) -> bool {
    h.is_some_and(|v| v.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("application/json"))
}

pub fn bearer_token(h: Option<&str>) -> Option<&str> {
    let (scheme, rest) = h?.trim().split_once(' ')?;
    let tok = rest.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !tok.is_empty()).then_some(tok)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fields<T: std::fmt::Debug>(r: Result<T, Vec<FieldError>>) -> Vec<String> {
        r.unwrap_err().into_iter().map(|e| e.field).collect()
    }

    #[test]
    fn title_is_trimmed_and_counted_in_code_points() {
        assert_eq!(parse_create(&json!({"title": "  hi  "})).unwrap().title.as_str(), "hi");
        assert!(parse_create(&json!({"title": "😀".repeat(200)})).is_ok());
        assert_eq!(fields(parse_create(&json!({"title": "😀".repeat(201)}))), ["title"]);
        assert_eq!(fields(parse_create(&json!({"title": "   "}))), ["title"]);
    }

    #[test]
    fn create_reports_every_failing_field() {
        let mut f = fields(parse_create(&json!({"title": 4, "body": 5, "foo": 1, "version": 2})));
        f.sort();
        assert_eq!(f, ["body", "foo", "title", "version"]);
        assert_eq!(fields(parse_create(&json!({"body": "x"}))), ["title"]);
        assert_eq!(fields(parse_create(&json!([1]))), ["$"]);
        assert_eq!(fields(parse_create(&Value::Null)), ["$"]);
    }

    #[test]
    fn body_defaults_empty_and_is_capped() {
        assert_eq!(parse_create(&json!({"title": "t"})).unwrap().body.as_str(), "");
        assert!(parse_create(&json!({"title": "t", "body": "b".repeat(100_000)})).is_ok());
        assert_eq!(fields(parse_create(&json!({"title": "t", "body": "b".repeat(100_001)}))), ["body"]);
    }

    #[test]
    fn patch_rules() {
        assert_eq!(fields(parse_patch(&json!({}))), ["$"]);
        assert_eq!(fields(parse_patch(&json!({"authorId": "carol"}))), ["authorId"]);
        let p = parse_patch(&json!({"body": "x"})).unwrap();
        assert!(p.title.is_none() && p.body.is_some());
    }

    #[test]
    fn if_match_parsing() {
        let v = |x: &[i64]| Precondition::Versions(x.to_vec());
        assert_eq!(parse_if_match(None), Precondition::Required);
        assert_eq!(parse_if_match(Some("")), Precondition::Required);
        assert_eq!(parse_if_match(Some("*")), Precondition::Required);
        assert_eq!(parse_if_match(Some("\"1\", *")), Precondition::Required);
        assert_eq!(parse_if_match(Some("\"3\"")), v(&[3]));
        assert_eq!(parse_if_match(Some("\"9\", \"1\"")), v(&[9, 1]));
        assert_eq!(parse_if_match(Some("3")), v(&[]));
        assert_eq!(parse_if_match(Some("\"01\"")), v(&[]));
        assert_eq!(parse_if_match(Some("W/\"3\"")), v(&[]));
        assert_eq!(parse_if_match(Some("W/\"1\", \"2\"")), v(&[2]));
        assert!(parse_if_match(Some("\"9\", \"1\"")).matches(1));
        assert!(!parse_if_match(Some("\"8\", \"9\"")).matches(1));
    }

    #[test]
    fn trim_uses_unicode_white_space_only() {
        let t = |s: &str| parse_create(&json!({"title": s})).map(|n| n.title.as_str().to_string());
        assert_eq!(t("\u{a0}hi\u{3000}").unwrap(), "hi");
        assert!(t("\u{a0}\u{2003}").is_err());
        assert!(t("\u{200b}").is_ok());
        assert!(t("\u{feff}").is_ok());
        assert!(t(&format!("{}", "e\u{301}".repeat(100))).is_ok());
        assert!(t(&format!("{}", "e\u{301}".repeat(101))).is_err());
    }

    #[test]
    fn non_object_bodies_name_root() {
        for v in [json!([]), json!("x"), json!(1), Value::Null] {
            assert_eq!(fields(parse_create(&v)), ["$"]);
        }
        assert_eq!(fields(parse_create(&json!({"title":"t","__proto__":{}}))), ["__proto__"]);
    }

    #[test]
    fn headers() {
        assert!(is_json_content_type(Some("application/json; charset=utf-8")));
        assert!(!is_json_content_type(Some("text/plain")));
        assert!(!is_json_content_type(None));
        assert_eq!(bearer_token(Some("Bearer abc")), Some("abc"));
        assert_eq!(bearer_token(Some("Basic abc")), None);
        assert_eq!(bearer_token(None), None);
        assert_eq!(etag(2), "\"2\"");
    }
}
