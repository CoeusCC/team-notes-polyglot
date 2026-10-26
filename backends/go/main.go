package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	_ "embed"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

const maxBody = 2 << 20

type app struct{ db *sql.DB }

type user struct{ id, name string }

type noteRow struct {
	ID        string  `json:"id"`
	TeamID    string  `json:"teamId"`
	AuthorID  string  `json:"authorId"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Version   int64   `json:"version"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
	DeletedAt *string `json:"deletedAt,omitempty"`
}

func now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func writeJSON(w http.ResponseWriter, status int, v any, hdr map[string]string) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	w.Header().Set("Content-Type", "application/json")
	for k, v := range hdr {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	w.Write(bytes.TrimRight(buf.Bytes(), "\n"))
}

var titles = map[int]string{
	400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict",
	412: "Precondition Failed", 413: "Payload Too Large", 415: "Unsupported Media Type",
	422: "Unprocessable Entity", 428: "Precondition Required", 500: "Internal Server Error",
}

func problem(w http.ResponseWriter, status int, detail string, errs []fieldErr, hdr map[string]string) {
	m := map[string]any{"type": "about:blank", "title": titles[status], "status": status}
	if detail != "" {
		m["detail"] = detail
	}
	if errs != nil {
		m["errors"] = errs
	}
	if status == 413 {
		w.Header().Set("Connection", "close")
	}
	b, _ := json.Marshal(m)
	w.Header().Set("Content-Type", "application/problem+json")
	for k, v := range hdr {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	w.Write(b)
}

// notFound is byte-identical for every hidden/missing/unknown case.
func notFound(w http.ResponseWriter) { problem(w, 404, "", nil, nil) }

func (a *app) auth(r *http.Request) (user, bool) {
	h := r.Header.Get("Authorization")
	if len(h) < 8 || !strings.EqualFold(h[:7], "bearer ") {
		return user{}, false
	}
	tok := strings.TrimSpace(h[7:])
	if tok == "" {
		return user{}, false
	}
	sum := sha256.Sum256([]byte(tok))
	var u user
	err := a.db.QueryRow(`SELECT id, name FROM users WHERE token_hash = ?`, hex.EncodeToString(sum[:])).Scan(&u.id, &u.name)
	return u, err == nil
}

func (a *app) role(team, uid string) string {
	var role string
	if err := a.db.QueryRow(`SELECT role FROM memberships WHERE team_id=? AND user_id=?`, team, uid).Scan(&role); err != nil {
		return ""
	}
	return role
}

// readBody reads up to 2 MiB+1. Returns (body, status). status != 0 means respond with it.
func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	b, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		problem(w, 400, "unreadable body", nil, nil)
		return nil, false
	}
	if len(b) == 0 {
		return b, true
	}
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		problem(w, 415, "Content-Type must be application/json", nil, nil)
		return nil, false
	}
	if len(b) > maxBody {
		problem(w, 413, "body exceeds 2 MiB", nil, nil)
		return nil, false
	}
	return b, true
}

// jsonBody reads and parses a required JSON body (415, 413, 400).
func jsonBody(w http.ResponseWriter, r *http.Request) (any, bool) {
	b, ok := readBody(w, r)
	if !ok {
		return nil, false
	}
	if len(b) == 0 {
		problem(w, 400, "request body is required", nil, nil)
		return nil, false
	}
	v, ok := parseJSON(b)
	if !ok {
		problem(w, 400, "malformed JSON", nil, nil)
		return nil, false
	}
	return v, true
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if e := recover(); e != nil {
			log.Println("panic:", e)
			problem(w, 500, "", nil, nil)
		}
	}()
	path := r.URL.EscapedPath()
	if path == "/health" && r.Method == "GET" {
		writeJSON(w, 200, map[string]string{"status": "ok"}, nil)
		return
	}
	u, ok := a.auth(r)
	if !ok {
		problem(w, 401, "missing or invalid bearer token", nil, map[string]string{"WWW-Authenticate": "Bearer"})
		return
	}
	if !strings.HasPrefix(path, "/") {
		notFound(w)
		return
	}
	parts := strings.Split(path[1:], "/")
	seg := make([]string, len(parts))
	for i, p := range parts {
		d, err := url.PathUnescape(p)
		if err != nil || p == "" {
			notFound(w)
			return
		}
		seg[i] = d
	}
	m := r.Method
	switch {
	case len(seg) == 1 && seg[0] == "me" && m == "GET":
		a.me(w, u)
	case len(seg) == 1 && seg[0] == "teams" && m == "GET":
		a.myTeams(w, u)
	case len(seg) == 1 && seg[0] == "teams" && m == "POST":
		a.createTeam(w, r, u)
	case len(seg) == 2 && seg[0] == "teams" && m == "GET":
		a.getTeam(w, r, u, seg[1])
	case len(seg) == 3 && seg[0] == "teams" && seg[2] == "members" && m == "GET":
		a.listMembers(w, r, u, seg[1])
	case len(seg) == 4 && seg[0] == "teams" && seg[2] == "members" && m == "PUT":
		a.putMember(w, r, u, seg[1], seg[3])
	case len(seg) == 4 && seg[0] == "teams" && seg[2] == "members" && m == "DELETE":
		a.delMember(w, r, u, seg[1], seg[3])
	case len(seg) == 3 && seg[0] == "teams" && seg[2] == "notes" && m == "GET":
		a.listNotes(w, r, u, seg[1])
	case len(seg) == 3 && seg[0] == "teams" && seg[2] == "notes" && m == "POST":
		a.createNote(w, r, u, seg[1])
	case len(seg) == 2 && seg[0] == "notes" && m == "GET":
		a.getNote(w, r, u, seg[1])
	case len(seg) == 2 && seg[0] == "notes" && m == "PATCH":
		a.patchNote(w, r, u, seg[1])
	case len(seg) == 2 && seg[0] == "notes" && m == "DELETE":
		a.deleteNote(w, r, u, seg[1])
	case len(seg) == 3 && seg[0] == "notes" && seg[2] == "restore" && m == "POST":
		a.restoreNote(w, r, u, seg[1])
	default:
		notFound(w)
	}
}

type teamOut struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

func (a *app) teamsOf(uid string) []teamOut {
	rows, err := a.db.Query(`SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=? ORDER BY t.id`, uid)
	out := []teamOut{}
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var t teamOut
		rows.Scan(&t.ID, &t.Name, &t.Role)
		out = append(out, t)
	}
	return out
}

func (a *app) me(w http.ResponseWriter, u user) {
	writeJSON(w, 200, map[string]any{"id": u.id, "name": u.name, "teams": a.teamsOf(u.id)}, nil)
}

func (a *app) myTeams(w http.ResponseWriter, u user) {
	writeJSON(w, 200, map[string]any{"items": a.teamsOf(u.id)}, nil)
}

func (a *app) createTeam(w http.ResponseWriter, r *http.Request, u user) {
	v, ok := jsonBody(w, r)
	if !ok {
		return
	}
	var errs []fieldErr
	var id, name string
	m, isObj := v.(map[string]any)
	if !isObj {
		errs = append(errs, fieldErr{"$", "body must be a JSON object"})
	} else {
		for k := range m {
			if k != "id" && k != "name" {
				errs = append(errs, fieldErr{k, "unknown field"})
			}
		}
		if s, ok := m["id"].(string); !ok || !validSlug(s) {
			errs = append(errs, fieldErr{"id", "must match ^[a-z0-9-]{3,40}$"})
		} else {
			id = s
		}
		if s, ok := m["name"].(string); !ok {
			errs = append(errs, fieldErr{"name", "must be a string of 1-80 characters"})
		} else if s = trimWS(s); cpLen(s) < 1 || cpLen(s) > 80 {
			errs = append(errs, fieldErr{"name", "must be 1-80 characters after trimming"})
		} else {
			name = s
		}
	}
	if len(errs) > 0 {
		problem(w, 422, "validation failed", errs, nil)
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		problem(w, 500, "", nil, nil)
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO teams (id, name, owner_id) VALUES (?,?,?)`, id, name, u.id); err != nil {
		problem(w, 409, "team id already taken", nil, nil)
		return
	}
	tx.Exec(`INSERT INTO memberships (team_id, user_id, role) VALUES (?,?, 'owner')`, id, u.id)
	if tx.Commit() != nil {
		problem(w, 500, "", nil, nil)
		return
	}
	writeJSON(w, 201, teamOut{id, name, "owner"}, map[string]string{"Location": "/teams/" + id})
}

func validSlug(s string) bool {
	if len(s) < 3 || len(s) > 40 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

// teamAccess returns the caller's role or writes 404.
func (a *app) teamAccess(w http.ResponseWriter, u user, team string) (string, bool) {
	role := a.role(team, u.id)
	if role == "" {
		notFound(w)
		return "", false
	}
	return role, true
}

// noBody enforces the uniform body rules (415, 413) for operations that ignore bodies.
func noBody(w http.ResponseWriter, r *http.Request) bool {
	_, ok := readBody(w, r)
	return ok
}

func (a *app) getTeam(w http.ResponseWriter, r *http.Request, u user, id string) {
	role, ok := a.teamAccess(w, u, id)
	if !ok || !noBody(w, r) {
		return
	}
	var name string
	a.db.QueryRow(`SELECT name FROM teams WHERE id=?`, id).Scan(&name)
	writeJSON(w, 200, teamOut{id, name, role}, nil)
}

func (a *app) listMembers(w http.ResponseWriter, r *http.Request, u user, id string) {
	if _, ok := a.teamAccess(w, u, id); !ok || !noBody(w, r) {
		return
	}
	rows, err := a.db.Query(`SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY (m.role='owner') DESC, u.id`, id)
	if err != nil {
		problem(w, 500, "", nil, nil)
		return
	}
	defer rows.Close()
	items := []teamOut{}
	for rows.Next() {
		var t teamOut
		rows.Scan(&t.ID, &t.Name, &t.Role)
		items = append(items, t)
	}
	writeJSON(w, 200, map[string]any{"items": items}, nil)
}

func (a *app) putMember(w http.ResponseWriter, r *http.Request, u user, team, uid string) {
	role, ok := a.teamAccess(w, u, team)
	if !ok {
		return
	}
	if role != "owner" {
		problem(w, 403, "only the team owner may manage members", nil, nil)
		return
	}
	if !noBody(w, r) {
		return
	}
	var name string
	if err := a.db.QueryRow(`SELECT name FROM users WHERE id=?`, uid).Scan(&name); err != nil {
		problem(w, 422, "validation failed", []fieldErr{{"userId", "unknown user"}}, nil)
		return
	}
	a.db.Exec(`INSERT OR IGNORE INTO memberships (team_id, user_id, role) VALUES (?,?, 'member')`, team, uid)
	writeJSON(w, 200, teamOut{uid, name, a.role(team, uid)}, nil)
}

func (a *app) delMember(w http.ResponseWriter, r *http.Request, u user, team, uid string) {
	role, ok := a.teamAccess(w, u, team)
	if !ok {
		return
	}
	if role != "owner" {
		problem(w, 403, "only the team owner may manage members", nil, nil)
		return
	}
	if !noBody(w, r) {
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		problem(w, 500, "", nil, nil)
		return
	}
	defer tx.Rollback()
	var trole string
	if err := tx.QueryRow(`SELECT role FROM memberships WHERE team_id=? AND user_id=?`, team, uid).Scan(&trole); err == nil && trole == "owner" {
		var n int
		tx.QueryRow(`SELECT COUNT(*) FROM memberships WHERE team_id=? AND role='owner'`, team).Scan(&n)
		if n <= 1 {
			problem(w, 409, "cannot remove the last owner", nil, nil)
			return
		}
	}
	tx.Exec(`DELETE FROM memberships WHERE team_id=? AND user_id=?`, team, uid)
	tx.Commit()
	w.WriteHeader(204)
}

const noteCols = `id, team_id, author_id, title, body, version, created_at, updated_at, deleted_at`

type scanner interface{ Scan(...any) error }

func scanNote(s scanner) (noteRow, error) {
	var n noteRow
	var del sql.NullString
	err := s.Scan(&n.ID, &n.TeamID, &n.AuthorID, &n.Title, &n.Body, &n.Version, &n.CreatedAt, &n.UpdatedAt, &del)
	if del.Valid {
		d := del.String
		n.DeletedAt = &d
	}
	return n, err
}

func etag(v int64) string { return `"` + strconv.FormatInt(v, 10) + `"` }

func noteHdr(n noteRow) map[string]string { return map[string]string{"ETag": etag(n.Version)} }

func (a *app) listNotes(w http.ResponseWriter, r *http.Request, u user, team string) {
	if _, ok := a.teamAccess(w, u, team); !ok {
		return
	}
	archived := false
	if q, has := r.URL.Query()["archived"]; has {
		switch q[0] {
		case "true":
			archived = true
		case "false":
		default:
			problem(w, 422, "validation failed", []fieldErr{{"archived", "must be true or false"}}, nil)
			return
		}
	}
	if !noBody(w, r) {
		return
	}
	cond := "deleted_at IS NULL"
	if archived {
		cond = "deleted_at IS NOT NULL"
	}
	rows, err := a.db.Query(`SELECT `+noteCols+` FROM notes WHERE team_id=? AND `+cond+` ORDER BY seq DESC`, team)
	if err != nil {
		problem(w, 500, "", nil, nil)
		return
	}
	defer rows.Close()
	items := []noteRow{}
	for rows.Next() {
		n, _ := scanNote(rows)
		items = append(items, n)
	}
	writeJSON(w, 200, map[string]any{"items": items}, nil)
}

func (a *app) createNote(w http.ResponseWriter, r *http.Request, u user, team string) {
	if _, ok := a.teamAccess(w, u, team); !ok {
		return
	}
	v, ok := jsonBody(w, r)
	if !ok {
		return
	}
	in, errs := validateNote(v, true)
	if len(errs) > 0 {
		problem(w, 422, "validation failed", errs, nil)
		return
	}
	id := newUUID()
	ts := now()
	if _, err := a.db.Exec(`INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)`,
		id, team, u.id, in.title, in.body, ts, ts); err != nil {
		problem(w, 500, "", nil, nil)
		return
	}
	n := noteRow{ID: id, TeamID: team, AuthorID: u.id, Title: in.title, Body: in.body, Version: 1, CreatedAt: ts, UpdatedAt: ts}
	h := noteHdr(n)
	h["Location"] = "/notes/" + id
	writeJSON(w, 201, n, h)
}

// visibleNote loads a note the caller can see (member of its team); else writes 404.
func (a *app) visibleNote(w http.ResponseWriter, u user, id string, includeDeleted bool) (noteRow, bool) {
	n, err := scanNote(a.db.QueryRow(`SELECT `+noteCols+` FROM notes WHERE id=?`, id))
	if err != nil || a.role(n.TeamID, u.id) == "" || (n.DeletedAt != nil && !includeDeleted) {
		notFound(w)
		return n, false
	}
	return n, true
}

func (a *app) getNote(w http.ResponseWriter, r *http.Request, u user, id string) {
	n, ok := a.visibleNote(w, u, id, false)
	if !ok || !noBody(w, r) {
		return
	}
	writeJSON(w, 200, n, noteHdr(n))
}

func (a *app) patchNote(w http.ResponseWriter, r *http.Request, u user, id string) {
	n, ok := a.visibleNote(w, u, id, false)
	if !ok {
		return
	}
	v, ok := jsonBody(w, r)
	if !ok {
		return
	}
	in, errs := validateNote(v, false)
	if len(errs) > 0 {
		problem(w, 422, "validation failed", errs, nil)
		return
	}
	hdrs := r.Header.Values("If-Match")
	if len(hdrs) == 0 {
		problem(w, 428, "If-Match is required", nil, nil)
		return
	}
	match := false
	for _, h := range hdrs {
		for _, e := range strings.Split(h, ",") {
			e = strings.Trim(e, " \t")
			if e == "*" {
				problem(w, 428, "wildcard If-Match is not allowed", nil, nil)
				return
			}
			if e == etag(n.Version) {
				match = true
			}
		}
	}
	if !match {
		problem(w, 412, "If-Match does not match the current version", nil, noteHdr(n))
		return
	}
	title, body := n.Title, n.Body
	if in.hasTitle {
		title = in.title
	}
	if in.hasBody {
		body = in.body
	}
	ts := now()
	res, err := a.db.Exec(`UPDATE notes SET title=?, body=?, version=version+1, updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL`,
		title, body, ts, id, n.Version)
	if err != nil {
		problem(w, 500, "", nil, nil)
		return
	}
	if c, _ := res.RowsAffected(); c == 0 {
		cur, ok := a.visibleNote(w, u, id, false)
		if !ok {
			return
		}
		problem(w, 412, "If-Match does not match the current version", nil, noteHdr(cur))
		return
	}
	n.Title, n.Body, n.Version, n.UpdatedAt = title, body, n.Version+1, ts
	writeJSON(w, 200, n, noteHdr(n))
}

func (a *app) deleteNote(w http.ResponseWriter, r *http.Request, u user, id string) {
	if _, ok := a.visibleNote(w, u, id, true); !ok || !noBody(w, r) {
		return
	}
	a.db.Exec(`UPDATE notes SET deleted_at=? WHERE id=? AND deleted_at IS NULL`, now(), id)
	w.WriteHeader(204)
}

func (a *app) restoreNote(w http.ResponseWriter, r *http.Request, u user, id string) {
	if _, ok := a.visibleNote(w, u, id, true); !ok || !noBody(w, r) {
		return
	}
	a.db.Exec(`UPDATE notes SET deleted_at=NULL, version=version+1, updated_at=? WHERE id=? AND deleted_at IS NOT NULL`, now(), id)
	n, err := scanNote(a.db.QueryRow(`SELECT `+noteCols+` FROM notes WHERE id=?`, id))
	if err != nil {
		notFound(w)
		return
	}
	writeJSON(w, 200, n, noteHdr(n))
}

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	db.SetConnMaxIdleTime(0)
	db.Exec(`PRAGMA busy_timeout = 5000`)
	if _, err := db.Exec(schemaSQL); err != nil {
		return nil, err
	}
	return db, nil
}

func main() {
	path := os.Getenv("DB_PATH")
	if path == "" {
		path = ":memory:"
	}
	db, err := openDB(path)
	if err != nil {
		log.Fatal(err)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Println("listening on :" + port)
	srv := &http.Server{Addr: ":" + port, Handler: &app{db: db}}
	log.Fatal(srv.ListenAndServe())
}

func newUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
