package notes;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.*;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

public class Main {
    static final ObjectMapper JSON = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    static final int MAX_BODY = 2 * 1024 * 1024;
    static final Pattern SLUG = Pattern.compile("^[a-z0-9-]{3,40}$");
    static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    static Connection db;

    public static void main(String[] args) throws Exception {
        String dbPath = Optional.ofNullable(System.getenv("DB_PATH")).orElse(":memory:");
        String schema = Optional.ofNullable(System.getenv("SCHEMA_PATH")).orElse("spec/schema.sql");
        int port = Integer.parseInt(Optional.ofNullable(System.getenv("PORT")).orElse("3000"));
        initDb(dbPath, schema);
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 256);
        server.createContext("/", Main::handle);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.out.println("listening on " + port);
    }

    static void initDb(String dbPath, String schemaFile) throws Exception {
        db = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
        String sql = Files.readString(Path.of(schemaFile)).replaceAll("(?m)--.*$", "");
        try (Statement st = db.createStatement()) {
            st.execute("PRAGMA busy_timeout = 5000");
            for (String s : sql.split(";")) if (!s.isBlank()) st.execute(s);
        }
    }

    // ---- problem handling --------------------------------------------------------------------
    static class Problem extends RuntimeException {
        final int status; final List<String[]> errors; final Map<String, String> headers = new LinkedHashMap<>();
        Problem(int status, List<String[]> errors) { super(null, null, false, false); this.status = status; this.errors = errors; }
    }
    static Problem problem(int status) { return new Problem(status, null); }
    static Problem invalid(String field, String message) { return new Problem(422, java.util.Collections.singletonList(new String[]{field, message})); }

    static String titleFor(int s) {
        return switch (s) {
            case 400 -> "Bad Request"; case 401 -> "Unauthorized"; case 403 -> "Forbidden"; case 404 -> "Not Found";
            case 409 -> "Conflict"; case 412 -> "Precondition Failed"; case 413 -> "Payload Too Large";
            case 415 -> "Unsupported Media Type"; case 422 -> "Unprocessable Content"; case 428 -> "Precondition Required";
            default -> "Internal Server Error";
        };
    }

    static void send(HttpExchange ex, int status, Map<String, String> headers, String contentType, byte[] body) throws IOException {
        for (var h : headers.entrySet()) ex.getResponseHeaders().set(h.getKey(), h.getValue());
        if (body == null || body.length == 0) {
            ex.sendResponseHeaders(status, -1);
        } else {
            ex.getResponseHeaders().set("Content-Type", contentType);
            ex.sendResponseHeaders(status, body.length);
            ex.getResponseBody().write(body);
        }
        ex.close();
    }

    static void sendJson(HttpExchange ex, int status, Map<String, String> headers, Object o) throws IOException {
        send(ex, status, headers, "application/json", JSON.writeValueAsBytes(o));
    }

    static void sendProblem(HttpExchange ex, Problem p) throws IOException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "about:blank");
        m.put("title", titleFor(p.status));
        m.put("status", p.status);
        if (p.errors != null) {
            List<Map<String, String>> errs = new ArrayList<>();
            for (String[] e : p.errors) errs.add(new LinkedHashMap<>(Map.of("field", e[0], "message", e[1])));
            m.put("errors", errs);
        }
        Map<String, String> h = new LinkedHashMap<>(p.headers);
        if (p.status == 413) h.put("Connection", "close");
        send(ex, p.status, h, "application/problem+json", JSON.writeValueAsBytes(m));
    }

    // ---- request context -----------------------------------------------------------------------
    static class Ctx {
        final HttpExchange ex; final String userId;
        byte[] body; boolean bodyRead; boolean tooLarge;
        Ctx(HttpExchange ex, String userId) { this.ex = ex; this.userId = userId; }
    }

    static void handle(HttpExchange ex) throws IOException {
        try {
            route(ex);
        } catch (Problem p) {
            sendProblem(ex, p);
        } catch (Throwable t) {
            t.printStackTrace();
            try { sendProblem(ex, problem(500)); } catch (Throwable ignored) { ex.close(); }
        }
    }

    static String authenticate(HttpExchange ex) {
        String h = ex.getRequestHeaders().getFirst("Authorization");
        if (h == null) return null;
        int sp = h.indexOf(' ');
        if (sp < 0 || !h.substring(0, sp).equalsIgnoreCase("Bearer")) return null;
        String tok = h.substring(sp + 1).trim();
        if (tok.isEmpty()) return null;
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(tok.getBytes(StandardCharsets.UTF_8));
            String hex = HexFormat.of().formatHex(d);
            synchronized (Main.class) {
                try (PreparedStatement ps = db.prepareStatement("SELECT id FROM users WHERE token_hash = ?")) {
                    ps.setString(1, hex);
                    try (ResultSet rs = ps.executeQuery()) { return rs.next() ? rs.getString(1) : null; }
                }
            }
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    static void route(HttpExchange ex) throws Exception {
        String method = ex.getRequestMethod();
        String rawPath = ex.getRequestURI().getRawPath();
        if (rawPath == null) rawPath = "";
        if (rawPath.equals("/health") && method.equals("GET")) {
            sendJson(ex, 200, Map.of(), Map.of("status", "ok"));
            return;
        }
        String user = authenticate(ex);
        if (user == null) throw problem(401);
        Ctx c = new Ctx(ex, user);

        String[] seg = rawPath.split("/", -1); // seg[0] is "" for a leading slash
        if (seg.length < 2 || !seg[0].isEmpty()) throw problem(404);
        List<String> p = new ArrayList<>();
        for (int i = 1; i < seg.length; i++) {
            if (seg[i].isEmpty()) throw problem(404);
            try { p.add(URLDecoder.decode(seg[i].replace("+", "%2B"), StandardCharsets.UTF_8)); }
            catch (IllegalArgumentException e) { throw problem(404); }
        }
        int n = p.size();
        switch (p.get(0)) {
            case "me" -> { if (n == 1 && method.equals("GET")) { me(c); return; } }
            case "teams" -> {
                if (n == 1 && method.equals("GET")) { listTeams(c); return; }
                if (n == 1 && method.equals("POST")) { createTeam(c); return; }
                if (n == 2 && method.equals("GET")) { getTeam(c, p.get(1)); return; }
                if (n == 3 && p.get(2).equals("members") && method.equals("GET")) { listMembers(c, p.get(1)); return; }
                if (n == 4 && p.get(2).equals("members") && method.equals("PUT")) { addMember(c, p.get(1), p.get(3)); return; }
                if (n == 4 && p.get(2).equals("members") && method.equals("DELETE")) { removeMember(c, p.get(1), p.get(3)); return; }
                if (n == 3 && p.get(2).equals("notes") && method.equals("GET")) { listNotes(c, p.get(1)); return; }
                if (n == 3 && p.get(2).equals("notes") && method.equals("POST")) { createNote(c, p.get(1)); return; }
            }
            case "notes" -> {
                if (n == 2 && method.equals("GET")) { getNote(c, p.get(1)); return; }
                if (n == 2 && method.equals("PATCH")) { patchNote(c, p.get(1)); return; }
                if (n == 2 && method.equals("DELETE")) { deleteNote(c, p.get(1)); return; }
                if (n == 3 && p.get(2).equals("restore") && method.equals("POST")) { restoreNote(c, p.get(1)); return; }
            }
            default -> { }
        }
        throw problem(404);
    }

    // ---- body handling -------------------------------------------------------------------------
    /** Reads the body (once), then enforces 415 and 413. Returns the raw bytes (possibly empty). */
    static byte[] rawBody(Ctx c) throws IOException {
        if (!c.bodyRead) {
            c.bodyRead = true;
            String cl = c.ex.getRequestHeaders().getFirst("Content-Length");
            if (cl != null) {
                try { if (Long.parseLong(cl.trim()) > MAX_BODY) c.tooLarge = true; } catch (NumberFormatException ignored) { }
            }
            if (!c.tooLarge) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                InputStream in = c.ex.getRequestBody();
                byte[] buf = new byte[8192];
                int r;
                while ((r = in.read(buf)) >= 0) {
                    out.write(buf, 0, r);
                    if (out.size() > MAX_BODY) { c.tooLarge = true; break; }
                }
                c.body = out.toByteArray();
            } else c.body = new byte[]{1};
        }
        return c.body;
    }

    /** Uniform media rule: non-empty non-JSON body -> 415, then oversize -> 413. */
    static byte[] checkedBody(Ctx c) throws IOException {
        byte[] b = rawBody(c);
        if (b.length > 0) {
            String ct = c.ex.getRequestHeaders().getFirst("Content-Type");
            String mt = ct == null ? "" : ct.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
            if (!mt.equals("application/json")) throw problem(415);
        }
        if (c.tooLarge) throw problem(413);
        return b;
    }

    /** For operations that require a JSON body: parse into a tree (400 on empty/malformed/I-JSON violations). */
    static JsonNode requiredJson(Ctx c) throws IOException {
        byte[] b = checkedBody(c);
        if (b.length == 0) throw problem(400);
        String s;
        try {
            s = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b)).toString();
        } catch (CharacterCodingException e) { throw problem(400); }
        JsonNode node;
        try { node = JSON.readTree(s); } catch (Exception e) { throw problem(400); }
        if (node == null || node.isMissingNode()) throw problem(400);
        if (hasLoneSurrogate(node)) throw problem(400);
        return node;
    }

    static boolean hasLoneSurrogate(JsonNode n) {
        if (n.isTextual()) return lone(n.textValue());
        if (n.isObject()) {
            for (var it = n.fields(); it.hasNext(); ) {
                var e = it.next();
                if (lone(e.getKey()) || hasLoneSurrogate(e.getValue())) return true;
            }
        } else if (n.isArray()) for (JsonNode ch : n) if (hasLoneSurrogate(ch)) return true;
        return false;
    }

    static boolean lone(String s) {
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (Character.isHighSurrogate(ch)) {
                if (i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1))) i++; else return true;
            } else if (Character.isLowSurrogate(ch)) return true;
        }
        return false;
    }

    // ---- validation helpers --------------------------------------------------------------------
    /** Unicode White_Space property (NOT Character.isWhitespace). */
    static boolean isWhiteSpace(int cp) {
        return (cp >= 0x09 && cp <= 0x0D) || cp == 0x20 || cp == 0x85 || cp == 0xA0 || cp == 0x1680
                || (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000;
    }

    static String trimWs(String s) {
        int start = 0, end = s.length();
        while (start < end) { int cp = s.codePointAt(start); if (!isWhiteSpace(cp)) break; start += Character.charCount(cp); }
        while (end > start) { int cp = s.codePointBefore(end); if (!isWhiteSpace(cp)) break; end -= Character.charCount(cp); }
        return s.substring(start, end);
    }

    static int cps(String s) { return s.codePointCount(0, s.length()); }

    static final Set<String> NOTE_FIELDS = Set.of("title", "body");

    /** Validates a note body; returns map with title/body present as given (title trimmed). */
    static Map<String, String> validateNote(JsonNode node, boolean create) {
        if (!node.isObject()) throw invalid("$", "body must be a JSON object");
        List<String[]> errs = new ArrayList<>();
        Map<String, String> out = new HashMap<>();
        for (var it = node.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if (!NOTE_FIELDS.contains(k)) errs.add(new String[]{k, "unknown or read-only field"});
        }
        if (node.has("title")) {
            JsonNode t = node.get("title");
            if (!t.isTextual()) errs.add(new String[]{"title", "must be a string"});
            else {
                String tr = trimWs(t.textValue()); int l = cps(tr);
                if (l < 1 || l > 200) errs.add(new String[]{"title", "must be 1-200 characters after trimming"});
                else out.put("title", tr);
            }
        } else if (create) errs.add(new String[]{"title", "is required"});
        if (node.has("body")) {
            JsonNode b = node.get("body");
            if (!b.isTextual()) errs.add(new String[]{"body", "must be a string"});
            else if (cps(b.textValue()) > 100000) errs.add(new String[]{"body", "must be at most 100000 characters"});
            else out.put("body", b.textValue());
        }
        if (errs.isEmpty() && !create && node.size() == 0) errs.add(new String[]{"$", "at least one field is required"});
        if (!errs.isEmpty()) throw new Problem(422, errs);
        return out;
    }

    // ---- data access (all under one lock; SQLite access is serialized) ---------------------------
    static String now() { return TS.format(Instant.now()); }

    static String roleOf(String teamId, String userId) throws SQLException {
        try (PreparedStatement ps = db.prepareStatement("SELECT role FROM memberships WHERE team_id=? AND user_id=?")) {
            ps.setString(1, teamId); ps.setString(2, userId);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? rs.getString(1) : null; }
        }
    }

    static Map<String, Object> noteFrom(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getString("id")); m.put("teamId", rs.getString("team_id")); m.put("authorId", rs.getString("author_id"));
        m.put("title", rs.getString("title")); m.put("body", rs.getString("body")); m.put("version", rs.getInt("version"));
        m.put("createdAt", rs.getString("created_at")); m.put("updatedAt", rs.getString("updated_at"));
        String d = rs.getString("deleted_at");
        if (d != null) m.put("deletedAt", d);
        return m;
    }

    static Map<String, Object> findNote(String id) throws SQLException {
        try (PreparedStatement ps = db.prepareStatement("SELECT * FROM notes WHERE id=?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? noteFrom(rs) : null; }
        }
    }

    static Map<String, String> etag(Map<String, Object> note) { return Map.of("ETag", "\"" + note.get("version") + "\""); }

    /** The note if the caller is a member of its team, else null. */
    static Map<String, Object> visibleNote(Ctx c, String id) throws SQLException {
        Map<String, Object> n = findNote(id);
        if (n == null || roleOf((String) n.get("teamId"), c.userId) == null) return null;
        return n;
    }

    static List<Map<String, Object>> teamsOf(String userId) throws SQLException {
        List<Map<String, Object>> out = new ArrayList<>();
        try (PreparedStatement ps = db.prepareStatement(
                "SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=? ORDER BY t.id")) {
            ps.setString(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(team(rs.getString(1), rs.getString(2), rs.getString(3)));
            }
        }
        return out;
    }

    static Map<String, Object> team(String id, String name, String role) {
        Map<String, Object> m = new LinkedHashMap<>(); m.put("id", id); m.put("name", name); m.put("role", role); return m;
    }

    // ---- handlers --------------------------------------------------------------------------------
    static void me(Ctx c) throws Exception {
        Map<String, Object> out = new LinkedHashMap<>();
        synchronized (Main.class) {
            checkNoBody(c);
            try (PreparedStatement ps = db.prepareStatement("SELECT name FROM users WHERE id=?")) {
                ps.setString(1, c.userId);
                try (ResultSet rs = ps.executeQuery()) { rs.next(); out.put("id", c.userId); out.put("name", rs.getString(1)); }
            }
            out.put("teams", teamsOf(c.userId));
        }
        sendJson(c.ex, 200, Map.of(), out);
    }

    static void checkNoBody(Ctx c) throws IOException { checkedBody(c); }

    static void listTeams(Ctx c) throws Exception {
        checkNoBody(c);
        List<Map<String, Object>> t;
        synchronized (Main.class) { t = teamsOf(c.userId); }
        sendJson(c.ex, 200, Map.of(), Map.of("items", t));
    }

    static void createTeam(Ctx c) throws Exception {
        JsonNode node = requiredJson(c);
        if (!node.isObject()) throw invalid("$", "body must be a JSON object");
        List<String[]> errs = new ArrayList<>();
        for (var it = node.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if (!k.equals("id") && !k.equals("name")) errs.add(new String[]{k, "unknown field"});
        }
        String id = null, name = null;
        JsonNode i = node.get("id");
        if (i == null || !i.isTextual()) errs.add(new String[]{"id", "must be a string"});
        else if (!SLUG.matcher(i.textValue()).matches()) errs.add(new String[]{"id", "must match ^[a-z0-9-]{3,40}$"});
        else id = i.textValue();
        JsonNode nm = node.get("name");
        if (nm == null || !nm.isTextual()) errs.add(new String[]{"name", "must be a string"});
        else {
            String tr = trimWs(nm.textValue()); int l = cps(tr);
            if (l < 1 || l > 80) errs.add(new String[]{"name", "must be 1-80 characters after trimming"});
            else name = tr;
        }
        if (!errs.isEmpty()) throw new Problem(422, errs);
        synchronized (Main.class) {
            try (PreparedStatement ps = db.prepareStatement("SELECT 1 FROM teams WHERE id=?")) {
                ps.setString(1, id);
                try (ResultSet rs = ps.executeQuery()) { if (rs.next()) throw problem(409); }
            }
            db.setAutoCommit(false);
            try {
                try (PreparedStatement ps = db.prepareStatement("INSERT INTO teams(id,name,owner_id) VALUES(?,?,?)")) {
                    ps.setString(1, id); ps.setString(2, name); ps.setString(3, c.userId); ps.executeUpdate();
                }
                try (PreparedStatement ps = db.prepareStatement("INSERT INTO memberships(team_id,user_id,role) VALUES(?,?,'owner')")) {
                    ps.setString(1, id); ps.setString(2, c.userId); ps.executeUpdate();
                }
                db.commit();
            } catch (Exception e) { db.rollback(); throw e; }
            finally { db.setAutoCommit(true); }
        }
        sendJson(c.ex, 201, Map.of("Location", "/teams/" + id), team(id, name, "owner"));
    }

    static void getTeam(Ctx c, String teamId) throws Exception {
        Map<String, Object> t = null;
        synchronized (Main.class) {
            String role = roleOf(teamId, c.userId);
            if (role == null) throw problem(404);
            checkNoBody(c);
            try (PreparedStatement ps = db.prepareStatement("SELECT name FROM teams WHERE id=?")) {
                ps.setString(1, teamId);
                try (ResultSet rs = ps.executeQuery()) { rs.next(); t = team(teamId, rs.getString(1), role); }
            }
        }
        sendJson(c.ex, 200, Map.of(), t);
    }

    static void listMembers(Ctx c, String teamId) throws Exception {
        List<Map<String, Object>> items = new ArrayList<>();
        synchronized (Main.class) {
            if (roleOf(teamId, c.userId) == null) throw problem(404);
            checkNoBody(c);
            try (PreparedStatement ps = db.prepareStatement(
                    "SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY (m.role='owner') DESC, u.id")) {
                ps.setString(1, teamId);
                try (ResultSet rs = ps.executeQuery()) { while (rs.next()) items.add(team(rs.getString(1), rs.getString(2), rs.getString(3))); }
            }
        }
        sendJson(c.ex, 200, Map.of(), Map.of("items", items));
    }

    static void addMember(Ctx c, String teamId, String userId) throws Exception {
        Map<String, Object> out;
        synchronized (Main.class) {
            String role = roleOf(teamId, c.userId);
            if (role == null) throw problem(404);
            if (!role.equals("owner")) throw problem(403);
            checkNoBody(c);
            String name = null;
            try (PreparedStatement ps = db.prepareStatement("SELECT name FROM users WHERE id=?")) {
                ps.setString(1, userId);
                try (ResultSet rs = ps.executeQuery()) { if (rs.next()) name = rs.getString(1); }
            }
            if (name == null) throw invalid("userId", "unknown user");
            try (PreparedStatement ps = db.prepareStatement("INSERT OR IGNORE INTO memberships(team_id,user_id,role) VALUES(?,?,'member')")) {
                ps.setString(1, teamId); ps.setString(2, userId); ps.executeUpdate();
            }
            out = team(userId, name, roleOf(teamId, userId));
        }
        sendJson(c.ex, 200, Map.of(), out);
    }

    static void removeMember(Ctx c, String teamId, String userId) throws Exception {
        synchronized (Main.class) {
            String role = roleOf(teamId, c.userId);
            if (role == null) throw problem(404);
            if (!role.equals("owner")) throw problem(403);
            checkNoBody(c);
            String target = roleOf(teamId, userId);
            if (target != null) {
                if (target.equals("owner")) {
                    try (PreparedStatement ps = db.prepareStatement("SELECT COUNT(*) FROM memberships WHERE team_id=? AND role='owner'")) {
                        ps.setString(1, teamId);
                        try (ResultSet rs = ps.executeQuery()) { rs.next(); if (rs.getInt(1) <= 1) throw problem(409); }
                    }
                }
                try (PreparedStatement ps = db.prepareStatement("DELETE FROM memberships WHERE team_id=? AND user_id=?")) {
                    ps.setString(1, teamId); ps.setString(2, userId); ps.executeUpdate();
                }
            }
        }
        send(c.ex, 204, Map.of(), null, null);
    }

    static String queryParam(String rawQuery, String key) {
        if (rawQuery == null) return null;
        for (String kv : rawQuery.split("&")) {
            int eq = kv.indexOf('=');
            String k = eq < 0 ? kv : kv.substring(0, eq);
            String v = eq < 0 ? "" : kv.substring(eq + 1);
            try {
                if (URLDecoder.decode(k, StandardCharsets.UTF_8).equals(key)) return URLDecoder.decode(v, StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) { /* ignore */ }
        }
        return null;
    }

    static void listNotes(Ctx c, String teamId) throws Exception {
        List<Map<String, Object>> items = new ArrayList<>();
        synchronized (Main.class) {
            if (roleOf(teamId, c.userId) == null) throw problem(404);
            checkNoBody(c);
            String arch = queryParam(c.ex.getRequestURI().getRawQuery(), "archived");
            boolean archived = false;
            if (arch != null) {
                if (arch.equals("true")) archived = true;
                else if (!arch.equals("false")) throw invalid("archived", "must be 'true' or 'false'");
            }
            String sql = "SELECT * FROM notes WHERE team_id=? AND deleted_at IS " + (archived ? "NOT NULL" : "NULL") + " ORDER BY seq DESC";
            try (PreparedStatement ps = db.prepareStatement(sql)) {
                ps.setString(1, teamId);
                try (ResultSet rs = ps.executeQuery()) { while (rs.next()) items.add(noteFrom(rs)); }
            }
        }
        sendJson(c.ex, 200, Map.of(), Map.of("items", items));
    }

    static void createNote(Ctx c, String teamId) throws Exception {
        synchronized (Main.class) { if (roleOf(teamId, c.userId) == null) throw problem(404); }
        Map<String, String> v = validateNote(requiredJson(c), true);
        String id = UUID.randomUUID().toString(), ts = now();
        Map<String, Object> note;
        synchronized (Main.class) {
            if (roleOf(teamId, c.userId) == null) throw problem(404);
            try (PreparedStatement ps = db.prepareStatement(
                    "INSERT INTO notes(id,team_id,author_id,title,body,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)")) {
                ps.setString(1, id); ps.setString(2, teamId); ps.setString(3, c.userId); ps.setString(4, v.get("title"));
                ps.setString(5, v.getOrDefault("body", "")); ps.setString(6, ts); ps.setString(7, ts); ps.executeUpdate();
            }
            note = findNote(id);
        }
        Map<String, String> h = new LinkedHashMap<>(etag(note)); h.put("Location", "/notes/" + id);
        sendJson(c.ex, 201, h, note);
    }

    static void getNote(Ctx c, String id) throws Exception {
        Map<String, Object> n;
        synchronized (Main.class) {
            n = visibleNote(c, id);
            if (n == null || n.containsKey("deletedAt")) throw problem(404);
        }
        checkNoBody(c);
        sendJson(c.ex, 200, etag(n), n);
    }

    static void patchNote(Ctx c, String id) throws Exception {
        synchronized (Main.class) {
            Map<String, Object> n = visibleNote(c, id);
            if (n == null || n.containsKey("deletedAt")) throw problem(404);
        }
        Map<String, String> v = validateNote(requiredJson(c), false);
        List<String> ifMatch = c.ex.getRequestHeaders().get("If-Match");
        if (ifMatch == null || ifMatch.isEmpty()) throw problem(428);
        List<String> tags = new ArrayList<>();
        for (String h : ifMatch) for (String t : h.split(",", -1)) tags.add(t.trim());
        if (tags.contains("*")) throw problem(428);
        Map<String, Object> out;
        synchronized (Main.class) {
            Map<String, Object> n = visibleNote(c, id);
            if (n == null || n.containsKey("deletedAt")) throw problem(404);
            int cur = (Integer) n.get("version");
            if (!tags.contains("\"" + cur + "\"")) { Problem p = problem(412); p.headers.putAll(etag(n)); throw p; }
            int rows;
            try (PreparedStatement ps = db.prepareStatement(
                    "UPDATE notes SET title=COALESCE(?,title), body=COALESCE(?,body), version=version+1, updated_at=? " +
                            "WHERE id=? AND version=? AND deleted_at IS NULL")) {
                ps.setString(1, v.get("title")); ps.setString(2, v.get("body")); ps.setString(3, now());
                ps.setString(4, id); ps.setInt(5, cur); rows = ps.executeUpdate();
            }
            Map<String, Object> after = findNote(id);
            if (rows == 0) { Problem p = problem(412); if (after != null) p.headers.putAll(etag(after)); throw p; }
            out = after;
        }
        sendJson(c.ex, 200, etag(out), out);
    }

    static void deleteNote(Ctx c, String id) throws Exception {
        synchronized (Main.class) {
            if (visibleNote(c, id) == null) throw problem(404);
            checkNoBody(c);
            try (PreparedStatement ps = db.prepareStatement("UPDATE notes SET deleted_at=? WHERE id=? AND deleted_at IS NULL")) {
                ps.setString(1, now()); ps.setString(2, id); ps.executeUpdate();
            }
        }
        send(c.ex, 204, Map.of(), null, null);
    }

    static void restoreNote(Ctx c, String id) throws Exception {
        Map<String, Object> n;
        synchronized (Main.class) {
            if (visibleNote(c, id) == null) throw problem(404);
            checkNoBody(c);
            try (PreparedStatement ps = db.prepareStatement(
                    "UPDATE notes SET deleted_at=NULL, version=version+1, updated_at=? WHERE id=? AND deleted_at IS NOT NULL")) {
                ps.setString(1, now()); ps.setString(2, id); ps.executeUpdate();
            }
            n = findNote(id);
        }
        sendJson(c.ex, 200, etag(n), n);
    }
}
