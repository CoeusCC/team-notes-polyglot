using System.IO.Pipelines;
using System.Text;
using Microsoft.AspNetCore.Connections;

// Kestrel answers HTTP/1.1 requests without Host with 400, but raw conformance clients send none (AUTHN-4).
// Injects "Host: localhost" into request heads that lack one.
public static class HostFix
{
    sealed class Duplex(PipeReader input, PipeWriter output) : IDuplexPipe
    {
        public PipeReader Input { get; } = input;
        public PipeWriter Output { get; } = output;
    }

    public static ConnectionDelegate Wrap(ConnectionDelegate next) => async ctx =>
    {
        var orig = ctx.Transport;
        var pipe = new Pipe();
        ctx.Transport = new Duplex(pipe.Reader, orig.Output);
        var pump = Pump(orig.Input, pipe.Writer);
        try { await next(ctx); }
        finally { ctx.Transport = orig; await pipe.Reader.CompleteAsync(); }
        try { await pump; } catch { }
    };

    static async Task Pump(PipeReader src, PipeWriter dst)
    {
        var inb = new List<byte>();
        long bodyLeft = 0;
        bool pass = false;
        try
        {
            while (true)
            {
                var r = await src.ReadAsync();
                var buf = r.Buffer;
                foreach (var seg in buf) inb.AddRange(seg.Span.ToArray());
                src.AdvanceTo(buf.End);
                var o = new List<byte>();
                while (inb.Count > 0)
                {
                    if (pass) { o.AddRange(inb); inb.Clear(); break; }
                    if (bodyLeft > 0)
                    {
                        int n = (int)Math.Min(bodyLeft, inb.Count);
                        o.AddRange(inb.GetRange(0, n)); inb.RemoveRange(0, n); bodyLeft -= n;
                        continue;
                    }
                    int idx = Find(inb);
                    if (idx < 0) { if (inb.Count > (1 << 20)) { pass = true; continue; } break; }
                    var head = inb.GetRange(0, idx + 4); inb.RemoveRange(0, idx + 4);
                    var text = Encoding.Latin1.GetString(head.ToArray());
                    var lower = text.ToLowerInvariant();
                    if (lower.Contains("transfer-encoding:")) pass = true;
                    int k = lower.IndexOf("\r\ncontent-length:", StringComparison.Ordinal);
                    if (k >= 0)
                    {
                        var rest = lower[(k + 17)..];
                        int e = rest.IndexOf("\r\n", StringComparison.Ordinal);
                        if (e >= 0 && long.TryParse(rest[..e].Trim(), out var v) && v > 0) bodyLeft = v;
                    }
                    if (!lower.Contains("\r\nhost:"))
                    {
                        int e = text.IndexOf("\r\n", StringComparison.Ordinal);
                        if (e >= 0) text = text[..(e + 2)] + "Host: localhost\r\n" + text[(e + 2)..];
                    }
                    o.AddRange(Encoding.Latin1.GetBytes(text));
                }
                if (o.Count > 0) await dst.WriteAsync(o.ToArray());
                if (r.IsCompleted || r.IsCanceled) break;
            }
        }
        finally { await dst.CompleteAsync(); }
    }

    static int Find(List<byte> b)
    {
        for (int i = 0; i + 3 < b.Count; i++)
            if (b[i] == 13 && b[i + 1] == 10 && b[i + 2] == 13 && b[i + 3] == 10) return i;
        return -1;
    }
}
