using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.Sqlite;

var port = Environment.GetEnvironmentVariable("PORT") ?? "3000";
var dbPath = Environment.GetEnvironmentVariable("DB_PATH") ?? ":memory:";
var schemaPath = Environment.GetEnvironmentVariable("SCHEMA_PATH") ?? "/app/spec/schema.sql";

var store = new Store(dbPath, File.ReadAllText(schemaPath));
var api = new Api(store);

var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = null; // we enforce the 2 MiB cap ourselves
    o.AddServerHeader = false;
    o.Listen(System.Net.IPAddress.Any, int.Parse(port), lo => lo.Use(HostFix.Wrap));
});
var app = builder.Build();
app.Run(api.Handle);
app.Run();

public record FieldError(string Field, string Message);

public class ApiException(int status, string title, List<FieldError>? errors = null, Dictionary<string, string>? headers = null) : Exception(title)
{
    public int Status { get; } = status;
    public string Title { get; } = title;
    public List<FieldError>? Errors { get; } = errors;
    public Dictionary<string, string>? Headers { get; } = headers;
}

public static class Text
{
    // Unicode White_Space property (excludes U+200B, U+FEFF).
    public static bool IsWhiteSpace(char c) =>
        (c >= 9 && c <= 13) || c == 32 || c == 0x85 || c == 0xA0 || c == 0x1680 ||
        (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000;

    public static string Trim(string s)
    {
        int a = 0, b = s.Length;
        while (a < b && IsWhiteSpace(s[a])) a++;
        while (b > a && IsWhiteSpace(s[b - 1])) b--;
        return s.Substring(a, b - a);
    }

    public static int CodePoints(string s)
    {
        int n = 0;
        for (int i = 0; i < s.Length; i++)
        {
            if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) i++;
            n++;
        }
        return n;
    }

    // I-JSON: true when every \uXXXX surrogate escape is part of a valid pair.
    public static bool EscapesAreScalarValues(string json)
    {
        for (int i = 0; i < json.Length; i++)
        {
            if (json[i] != '\\') continue;
            if (i + 1 >= json.Length) return true; // parser will reject
            if (json[i + 1] != 'u') { i++; continue; }
            if (!TryHex(json, i + 2, out int cu)) return true; // parser will reject
            i += 5;
            if (cu >= 0xDC00 && cu <= 0xDFFF) return false;
            if (cu >= 0xD800 && cu <= 0xDBFF)
            {
                if (i + 6 < json.Length + 0 && json[i + 1] == '\\' && json[i + 2] == 'u' && TryHex(json, i + 3, out int lo) && lo >= 0xDC00 && lo <= 0xDFFF)
                    i += 6;
                else return false;
            }
        }
        return true;
    }

    static bool TryHex(string s, int at, out int v)
    {
        v = 0;
        if (at + 4 > s.Length) return false;
        for (int k = 0; k < 4; k++)
        {
            int d = Uri.IsHexDigit(s[at + k]) ? Convert.ToInt32(s[at + k].ToString(), 16) : -1;
            if (d < 0) return false;
            v = v * 16 + d;
        }
        return true;
    }

    public static string? StrictPercentDecode(string s)
    {
        if (s.IndexOf('%') < 0) return s;
        var bytes = new List<byte>();
        for (int i = 0; i < s.Length; i++)
        {
            if (s[i] == '%')
            {
                if (i + 2 >= s.Length + 0 && i + 2 > s.Length - 1 + 0 && i + 2 >= s.Length) return null;
                if (!Uri.IsHexDigit(s[i + 1]) || !Uri.IsHexDigit(s[i + 2])) return null;
                bytes.Add(Convert.ToByte(s.Substring(i + 1, 2), 16));
                i += 2;
            }
            else bytes.AddRange(Encoding.UTF8.GetBytes(s[i].ToString()));
        }
        try { return new UTF8Encoding(false, true).GetString(bytes.ToArray()); }
        catch { return null; }
    }
}

public class Store
{
    readonly SqliteConnection _db;
    public readonly object Lock = new();

    public Store(string path, string schema)
    {
        _db = new SqliteConnection($"Data Source={path}");
        _db.Open();
        lock (Lock)
        {
            Exec("PRAGMA journal_mode=WAL;", null, true);
            Exec("PRAGMA busy_timeout=5000;", null, true);
            Exec(schema);
        }
    }

    void Exec(string sql, object? _ = null, bool ignoreErr = false)
    {
        try { using var c = _db.CreateCommand(); c.CommandText = sql; c.ExecuteNonQuery(); }
        catch when (ignoreErr) { }
    }

    static SqliteCommand Cmd(SqliteConnection db, string sql, object[] p)
    {
        var c = db.CreateCommand();
        c.CommandText = sql;
        for (int i = 0; i < p.Length; i++) c.Parameters.AddWithValue("@p" + i, p[i] ?? DBNull.Value);
        return c;
    }

    public List<object?[]> Query(string sql, params object[] p)
    {
        using var c = Cmd(_db, sql, p);
        using var r = c.ExecuteReader();
        var rows = new List<object?[]>();
        while (r.Read())
        {
            var row = new object?[r.FieldCount];
            for (int i = 0; i < row.Length; i++) row[i] = r.IsDBNull(i) ? null : r.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    public int Run(string sql, params object[] p)
    {
        using var c = Cmd(_db, sql, p);
        return c.ExecuteNonQuery();
    }

    public SqliteTransaction Begin() => _db.BeginTransaction();
}

public class Api(Store s)
{
    const int MaxBody = 2 * 1024 * 1024;
    static readonly JsonSerializerOptions JsonOpts = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    static readonly System.Text.RegularExpressions.Regex SlugRe = new("^[a-z0-9-]{3,40}$");

    static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

    static string Phrase(int st) => st switch
    {
        400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found",
        409 => "Conflict", 412 => "Precondition Failed", 413 => "Payload Too Large",
        415 => "Unsupported Media Type", 422 => "Unprocessable Content", 428 => "Precondition Required",
        _ => "Internal Server Error",
    };

    static ApiException Err(int st, List<FieldError>? errs = null, Dictionary<string, string>? h = null) => new(st, Phrase(st), errs, h);
    static ApiException Invalid(string field, string msg) => Err(422, [new FieldError(field, msg)]);

    static async Task Write(HttpContext ctx, int status, object? body, string contentType = "application/json", Dictionary<string, string>? headers = null)
    {
        ctx.Response.StatusCode = status;
        if (headers != null) foreach (var (k, v) in headers) ctx.Response.Headers[k] = v;
        if (body == null) return;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(body, JsonOpts);
        ctx.Response.ContentType = contentType;
        ctx.Response.ContentLength = bytes.Length;
        if (ctx.Request.Method != "HEAD") await ctx.Response.Body.WriteAsync(bytes);
    }

    static Task WriteProblem(HttpContext ctx, ApiException e)
    {
        var p = new Dictionary<string, object?>
        {
            ["type"] = "about:blank",
            ["title"] = e.Title,
            ["status"] = e.Status,
        };
        if (e.Errors != null) p["errors"] = e.Errors.Select(x => new Dictionary<string, object?> { ["field"] = x.Field, ["message"] = x.Message }).ToList();
        var h = e.Headers ?? new();
        if (e.Status == 413) h["Connection"] = "close";
        if (e.Status == 401) h["WWW-Authenticate"] = "Bearer";
        return Write(ctx, e.Status, p, "application/problem+json", h);
    }

    public async Task Handle(HttpContext ctx)
    {
        try { await Route(ctx); }
        catch (ApiException e) { await WriteProblem(ctx, e); }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            if (!ctx.Response.HasStarted) { ctx.Response.Clear(); await WriteProblem(ctx, Err(500)); }
        }
    }

    sealed record User(string Id, string Name);

    User? Authenticate(HttpContext ctx)
    {
        if (ctx.Request.Headers.Authorization.Count > 1) return null;
        var h = ctx.Request.Headers.Authorization.ToString();
        if (h.Length < 8 || !h.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var token = h.Substring(7).Trim();
        if (token.Length == 0) return null;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
        lock (s.Lock)
        {
            var r = s.Query("SELECT id, name FROM users WHERE token_hash = @p0", hash);
            return r.Count == 0 ? null : new User((string)r[0][0]!, (string)r[0][1]!);
        }
    }

    // ---- body handling -----------------------------------------------------------------
    static async Task<byte[]> ReadBody(HttpContext ctx)
    {
        var ms = new MemoryStream();
        var buf = new byte[16384];
        int n;
        long total = 0;
        while ((n = await ctx.Request.Body.ReadAsync(buf)) > 0)
        {
            total += n;
            ms.Write(buf, 0, n);
            if (total > MaxBody) break;
        }
        return ms.ToArray();
    }

    static bool IsJsonMedia(HttpContext ctx)
    {
        var ct = ctx.Request.ContentType;
        if (ct == null) return false;
        var m = ct.Split(';')[0].Trim();
        return m.Equals("application/json", StringComparison.OrdinalIgnoreCase);
    }

    // Applies 415 then 413. Returns the raw bytes (possibly empty).
    static async Task<byte[]> Body(HttpContext ctx)
    {
        var bytes = await ReadBody(ctx);
        if (bytes.Length > 0 && !IsJsonMedia(ctx)) throw Err(415);
        if (bytes.Length > MaxBody) throw Err(413);
        return bytes;
    }

    static JsonDocument ParseJson(byte[] bytes)
    {
        if (bytes.Length == 0) throw Err(400);
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); } catch { throw Err(400); }
        if (!Text.EscapesAreScalarValues(text)) throw Err(400);
        try { return JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 }); }
        catch { throw Err(400); }
    }

    // ---- routing -----------------------------------------------------------------------
    async Task Route(HttpContext ctx)
    {
        var raw = ctx.Features.Get<IHttpRequestFeature>()!.RawTarget ?? "/";
        var q = raw.IndexOf('?');
        var rawPath = q >= 0 ? raw[..q] : raw;
        var query = q >= 0 ? raw[(q + 1)..] : null;
        var method = ctx.Request.Method;

        if (rawPath == "/health" && method == "GET")
        {
            await Write(ctx, 200, new Dictionary<string, object?> { ["status"] = "ok" });
            return;
        }

        var user = Authenticate(ctx) ?? throw Err(401);

        string[]? segs = null;
        if (rawPath.StartsWith('/'))
        {
            var parts = rawPath[1..].Split('/');
            var dec = new string[parts.Length];
            bool ok = true;
            for (int i = 0; i < parts.Length; i++)
            {
                var d = Text.StrictPercentDecode(parts[i]);
                if (d == null || d.Length == 0 || d == "." || d == "..") { ok = false; break; }
                dec[i] = d;
            }
            if (ok) segs = dec;
        }
        if (segs == null) throw Err(404);

        switch (segs.Length)
        {
            case 1 when segs[0] == "me" && method == "GET":
                await Wrap(ctx, () => Task.FromResult(Me(user)));
                return;
            case 1 when segs[0] == "teams" && method == "GET":
                await Body(ctx);
                await Write(ctx, 200, new Dictionary<string, object?> { ["items"] = TeamsOf(user.Id) });
                return;
            case 1 when segs[0] == "teams" && method == "POST":
                await CreateTeam(ctx, user);
                return;
            case 2 when segs[0] == "teams" && method == "GET":
                {
                    var role = RoleOf(segs[1], user.Id) ?? throw Err(404);
                    await Body(ctx);
                    await Write(ctx, 200, TeamObj(segs[1], role));
                    return;
                }
            case 3 when segs[0] == "teams" && segs[2] == "members" && method == "GET":
                {
                    _ = RoleOf(segs[1], user.Id) ?? throw Err(404);
                    await Body(ctx);
                    List<object?[]> rows;
                    lock (s.Lock)
                        rows = s.Query("SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id=@p0 ORDER BY (m.role='owner') DESC, u.id", segs[1]);
                    await Write(ctx, 200, new Dictionary<string, object?> { ["items"] = rows.Select(r => Member(r)).ToList() });
                    return;
                }
            case 3 when segs[0] == "teams" && segs[2] == "notes" && method == "GET":
                await ListNotes(ctx, user, segs[1], query);
                return;
            case 3 when segs[0] == "teams" && segs[2] == "notes" && method == "POST":
                await CreateNote(ctx, user, segs[1]);
                return;
            case 4 when segs[0] == "teams" && segs[2] == "members" && (method == "PUT" || method == "DELETE"):
                await Membership(ctx, user, segs[1], segs[3], method);
                return;
            case 2 when segs[0] == "notes" && method == "GET":
                {
                    var n = VisibleNote(segs[1], user.Id, false);
                    await Body(ctx);
                    await SendNote(ctx, 200, n);
                    return;
                }
            case 2 when segs[0] == "notes" && method == "PATCH":
                await Patch(ctx, user, segs[1]);
                return;
            case 2 when segs[0] == "notes" && method == "DELETE":
                {
                    var n = VisibleNote(segs[1], user.Id, true);
                    await Body(ctx);
                    lock (s.Lock)
                        s.Run("UPDATE notes SET deleted_at=@p1 WHERE id=@p0 AND deleted_at IS NULL", segs[1], Now());
                    await Write(ctx, 204, null);
                    return;
                }
            case 3 when segs[0] == "notes" && segs[2] == "restore" && method == "POST":
                {
                    var n = VisibleNote(segs[1], user.Id, true);
                    await Body(ctx);
                    lock (s.Lock)
                    {
                        if (n.DeletedAt != null)
                            s.Run("UPDATE notes SET deleted_at=NULL, version=version+1, updated_at=@p1 WHERE id=@p0 AND deleted_at IS NOT NULL", segs[1], Now());
                        n = LoadNote(segs[1])!;
                    }
                    await SendNote(ctx, 200, n);
                    return;
                }
        }
        throw Err(404);
    }

    Task Wrap(HttpContext ctx, Func<Task<Dictionary<string, object?>>> f) => WrapImpl(ctx, f);
    async Task WrapImpl(HttpContext ctx, Func<Task<Dictionary<string, object?>>> f)
    {
        await Body(ctx);
        await Write(ctx, 200, await f());
    }

    // ---- teams -------------------------------------------------------------------------
    string? RoleOf(string teamId, string userId)
    {
        lock (s.Lock)
        {
            var r = s.Query("SELECT role FROM memberships WHERE team_id=@p0 AND user_id=@p1", teamId, userId);
            return r.Count == 0 ? null : (string)r[0][0]!;
        }
    }

    Dictionary<string, object?> TeamObj(string id, string role)
    {
        lock (s.Lock)
        {
            var r = s.Query("SELECT name FROM teams WHERE id=@p0", id);
            return new() { ["id"] = id, ["name"] = (string)r[0][0]!, ["role"] = role };
        }
    }

    List<object> TeamsOf(string userId)
    {
        lock (s.Lock)
            return s.Query("SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=@p0 ORDER BY t.id", userId)
                .Select(r => (object)new Dictionary<string, object?> { ["id"] = r[0], ["name"] = r[1], ["role"] = r[2] }).ToList();
    }

    static Dictionary<string, object?> Member(object?[] r) => new() { ["id"] = r[0], ["name"] = r[1], ["role"] = r[2] };

    Dictionary<string, object?> Me(User u) => new() { ["id"] = u.Id, ["name"] = u.Name, ["teams"] = TeamsOf(u.Id) };

    async Task CreateTeam(HttpContext ctx, User user)
    {
        var bytes = await Body(ctx);
        using var doc = ParseJson(bytes);
        var root = doc.RootElement;
        var errs = new List<FieldError>();
        string? id = null, name = null;
        if (root.ValueKind != JsonValueKind.Object) errs.Add(new("$", "body must be a JSON object"));
        else
        {
            foreach (var p in root.EnumerateObject())
            {
                if (p.Name == "id")
                {
                    if (p.Value.ValueKind != JsonValueKind.String) errs.Add(new("id", "must be a string"));
                    else id = p.Value.GetString();
                }
                else if (p.Name == "name")
                {
                    if (p.Value.ValueKind != JsonValueKind.String) errs.Add(new("name", "must be a string"));
                    else
                    {
                        name = Text.Trim(p.Value.GetString()!);
                        var len = Text.CodePoints(name);
                        if (len < 1 || len > 80) errs.Add(new("name", "must be 1-80 characters after trimming"));
                    }
                }
                else errs.Add(new(p.Name, "unknown field"));
            }
            if (id == null && !errs.Any(e => e.Field == "id")) errs.Add(new("id", "is required"));
            if (name == null && !errs.Any(e => e.Field == "name")) errs.Add(new("name", "is required"));
            if (id != null && !SlugRe.IsMatch(id)) errs.Add(new("id", "must match ^[a-z0-9-]{3,40}$"));
        }
        if (errs.Count > 0) throw Err(422, errs);
        lock (s.Lock)
        {
            using var tx = s.Begin();
            if (s.Query("SELECT 1 FROM teams WHERE id=@p0", id!).Count > 0) throw Err(409);
            s.Run("INSERT INTO teams (id, name, owner_id) VALUES (@p0,@p1,@p2)", id!, name!, user.Id);
            s.Run("INSERT INTO memberships (team_id, user_id, role) VALUES (@p0,@p1,'owner')", id!, user.Id);
            tx.Commit();
        }
        await Write(ctx, 201, new Dictionary<string, object?> { ["id"] = id, ["name"] = name, ["role"] = "owner" },
            headers: new() { ["Location"] = "/teams/" + id });
    }

    async Task Membership(HttpContext ctx, User user, string teamId, string targetId, string method)
    {
        var role = RoleOf(teamId, user.Id) ?? throw Err(404);
        if (role != "owner") throw Err(403);
        await Body(ctx);
        if (method == "PUT")
        {
            Dictionary<string, object?> pending;
            lock (s.Lock)
            {
                var u = s.Query("SELECT id, name FROM users WHERE id=@p0", targetId);
                if (u.Count == 0) throw Invalid("userId", "unknown user");
                s.Run("INSERT OR IGNORE INTO memberships (team_id, user_id, role) VALUES (@p0,@p1,'member')", teamId, targetId);
                var r = s.Query("SELECT role FROM memberships WHERE team_id=@p0 AND user_id=@p1", teamId, targetId);
                var res = new Dictionary<string, object?> { ["id"] = u[0][0], ["name"] = u[0][1], ["role"] = r[0][0] };
                // write outside lock not needed: build then send below
                pending = res;
            }
            await Write(ctx, 200, pending);
            return;
        }
        lock (s.Lock)
        {
            var r = s.Query("SELECT role FROM memberships WHERE team_id=@p0 AND user_id=@p1", teamId, targetId);
            if (r.Count > 0)
            {
                if ((string)r[0][0]! == "owner" && (long)s.Query("SELECT COUNT(*) FROM memberships WHERE team_id=@p0 AND role='owner'", teamId)[0][0]! <= 1)
                    throw Err(409);
                s.Run("DELETE FROM memberships WHERE team_id=@p0 AND user_id=@p1", teamId, targetId);
            }
        }
        await Write(ctx, 204, null);
    }

    // ---- notes -------------------------------------------------------------------------
    sealed record NoteRow(string Id, string TeamId, string AuthorId, string Title, string Body, long Version, string CreatedAt, string UpdatedAt, string? DeletedAt);

    NoteRow? LoadNote(string id)
    {
        var r = s.Query("SELECT id, team_id, author_id, title, body, version, created_at, updated_at, deleted_at FROM notes WHERE id=@p0", id);
        if (r.Count == 0) return null;
        var x = r[0];
        return new NoteRow((string)x[0]!, (string)x[1]!, (string)x[2]!, (string)x[3]!, (string)x[4]!, (long)x[5]!, (string)x[6]!, (string)x[7]!, (string?)x[8]);
    }

    NoteRow VisibleNote(string id, string userId, bool allowDeleted)
    {
        lock (s.Lock)
        {
            var n = LoadNote(id);
            if (n == null) throw Err(404);
            if (n.DeletedAt != null && !allowDeleted) throw Err(404);
            var m = s.Query("SELECT 1 FROM memberships WHERE team_id=@p0 AND user_id=@p1", n.TeamId, userId);
            if (m.Count == 0) throw Err(404);
            return n;
        }
    }

    static Dictionary<string, object?> NoteObj(NoteRow n)
    {
        var d = new Dictionary<string, object?>
        {
            ["id"] = n.Id, ["teamId"] = n.TeamId, ["title"] = n.Title, ["body"] = n.Body, ["authorId"] = n.AuthorId,
            ["version"] = n.Version, ["createdAt"] = n.CreatedAt, ["updatedAt"] = n.UpdatedAt,
        };
        if (n.DeletedAt != null) d["deletedAt"] = n.DeletedAt;
        return d;
    }

    static Task SendNote(HttpContext ctx, int status, NoteRow n, Dictionary<string, string>? extra = null)
    {
        var h = extra ?? new();
        h["ETag"] = $"\"{n.Version}\"";
        return Write(ctx, status, NoteObj(n), headers: h);
    }

    async Task ListNotes(HttpContext ctx, User user, string teamId, string? query)
    {
        _ = RoleOf(teamId, user.Id) ?? throw Err(404);
        await Body(ctx);
        bool archived = false;
        if (query != null)
        {
            foreach (var pair in query.Split('&'))
            {
                var eq = pair.IndexOf('=');
                var k = Text.StrictPercentDecode((eq >= 0 ? pair[..eq] : pair).Replace('+', ' '));
                if (k != "archived") continue;
                var v = Text.StrictPercentDecode(eq >= 0 ? pair[(eq + 1)..].Replace('+', ' ') : "");
                if (v == "true") archived = true;
                else if (v == "false") archived = false;
                else throw Invalid("archived", "must be 'true' or 'false'");
                break;
            }
        }
        List<object?[]> rows;
        lock (s.Lock)
            rows = s.Query($"SELECT id FROM notes WHERE team_id=@p0 AND deleted_at IS {(archived ? "NOT" : "")} NULL ORDER BY seq DESC", teamId);
        var items = new List<object>();
        lock (s.Lock)
            foreach (var r in rows) items.Add(NoteObj(LoadNote((string)r[0]!)!));
        await Write(ctx, 200, new Dictionary<string, object?> { ["items"] = items });
    }

    static readonly HashSet<string> ReadOnly = ["id", "teamId", "authorId", "version", "createdAt", "updatedAt", "deletedAt"];

    static (string? title, string? body) ValidateNote(JsonElement root, bool create)
    {
        var errs = new List<FieldError>();
        string? title = null, body = null;
        if (root.ValueKind != JsonValueKind.Object) throw Invalid("$", "body must be a JSON object");
        foreach (var p in root.EnumerateObject())
        {
            switch (p.Name)
            {
                case "title":
                    if (p.Value.ValueKind != JsonValueKind.String) errs.Add(new("title", "must be a string"));
                    else
                    {
                        title = Text.Trim(p.Value.GetString()!);
                        var l = Text.CodePoints(title);
                        if (l < 1 || l > 200) errs.Add(new("title", "must be 1-200 characters after trimming"));
                    }
                    break;
                case "body":
                    if (p.Value.ValueKind != JsonValueKind.String) errs.Add(new("body", "must be a string"));
                    else
                    {
                        body = p.Value.GetString()!;
                        if (Text.CodePoints(body) > 100000) errs.Add(new("body", "must be at most 100000 characters"));
                    }
                    break;
                default:
                    errs.Add(new(p.Name, ReadOnly.Contains(p.Name) ? "read-only field" : "unknown field"));
                    break;
            }
        }
        if (create && title == null && !errs.Any(e => e.Field == "title")) errs.Add(new("title", "is required"));
        if (!create && title == null && body == null && errs.Count == 0) errs.Add(new("$", "at least one of title, body is required"));
        if (errs.Count > 0) throw Err(422, errs);
        return (title, body);
    }

    async Task CreateNote(HttpContext ctx, User user, string teamId)
    {
        _ = RoleOf(teamId, user.Id) ?? throw Err(404);
        var bytes = await Body(ctx);
        using var doc = ParseJson(bytes);
        var (title, body) = ValidateNote(doc.RootElement, true);
        var id = Guid.NewGuid().ToString();
        var now = Now();
        NoteRow n;
        lock (s.Lock)
        {
            s.Run("INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at) VALUES (@p0,@p1,@p2,@p3,@p4,1,@p5,@p5)",
                id, teamId, user.Id, title!, body ?? "", now);
            n = LoadNote(id)!;
        }
        await SendNote(ctx, 201, n, new() { ["Location"] = "/notes/" + id });
    }

    async Task Patch(HttpContext ctx, User user, string id)
    {
        VisibleNote(id, user.Id, false);
        var bytes = await Body(ctx);
        using var doc = ParseJson(bytes);
        var (title, body) = ValidateNote(doc.RootElement, false);

        var im = ctx.Request.Headers["If-Match"].ToString();
        if (string.IsNullOrWhiteSpace(im)) throw Err(428);
        var tags = im.Split(',').Select(t => t.Trim()).Where(t => t.Length > 0).ToList();
        if (tags.Count == 0 || tags.Contains("*")) throw Err(428);

        NoteRow? updated = null;
        NoteRow? current;
        lock (s.Lock)
        {
            current = LoadNote(id);
            if (current == null || current.DeletedAt != null) throw Err(404);
            if (tags.Contains($"\"{current.Version}\""))
            {
                // single conditional UPDATE: check and increment are one statement
                var rows = s.Run("UPDATE notes SET title=COALESCE(@p1,title), body=COALESCE(@p2,body), version=version+1, updated_at=@p3 WHERE id=@p0 AND version=@p4 AND deleted_at IS NULL",
                    id, title!, body!, Now(), current.Version);
                if (rows == 1) updated = LoadNote(id);
                else current = LoadNote(id);
            }
        }
        if (updated != null) { await SendNote(ctx, 200, updated); return; }
        throw Err(412, null, new() { ["ETag"] = $"\"{current!.Version}\"" });
    }
}
