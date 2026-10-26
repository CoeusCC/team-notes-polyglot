package notes;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpContext;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpPrincipal;

import java.io.*;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.Executors;

/**
 * Minimal HTTP/1.1 listener that feeds com.sun.net.httpserver.HttpExchange-shaped objects to the handler.
 * Why: the JDK HttpServer rejects request targets such as "//" with its own 400 before any handler runs,
 * which violates NOTES-SEC-AUTHN-3 (must be 401/identical 404). This keeps the raw target intact.
 */
public class RawServer {
    interface Handler { void handle(HttpExchange ex) throws IOException; }

    final ServerSocket ss;
    final Handler handler;

    RawServer(int port, Handler h) throws IOException {
        ss = new ServerSocket(port, 256);
        handler = h;
    }

    void start() {
        var pool = Executors.newVirtualThreadPerTaskExecutor();
        Thread.ofPlatform().name("accept").start(() -> {
            while (true) {
                try { Socket s = ss.accept(); pool.execute(() -> serve(s)); }
                catch (IOException e) { return; }
            }
        });
    }

    static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 65536) throw new IOException("line too long");
        }
        if (c < 0 && sb.length() == 0) return null;
        return sb.toString();
    }

    void serve(Socket s) {
        try (s) {
            s.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(s.getInputStream(), 16384);
            OutputStream out = new BufferedOutputStream(s.getOutputStream(), 16384);
            while (true) {
                String line = readLine(in);
                while (line != null && line.isEmpty()) line = readLine(in);
                if (line == null) return;
                String[] parts = line.split(" ");
                if (parts.length != 3) { writeRaw(out, 400); return; }
                Headers h = new Headers();
                String l;
                while ((l = readLine(in)) != null && !l.isEmpty()) {
                    int i = l.indexOf(':');
                    if (i <= 0) continue;
                    h.add(l.substring(0, i).trim(), new String(l.substring(i + 1).trim().getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8));
                }
                InputStream body;
                String te = h.getFirst("Transfer-Encoding");
                String cl = h.getFirst("Content-Length");
                if (te != null && te.toLowerCase(Locale.ROOT).contains("chunked")) body = new ChunkedInputStream(in);
                else if (cl != null) {
                    long n;
                    try { n = Long.parseLong(cl.trim()); } catch (NumberFormatException e) { writeRaw(out, 400); return; }
                    body = new BoundedInputStream(in, n);
                } else body = InputStream.nullInputStream();
                boolean close = parts[2].equals("HTTP/1.0") || "close".equalsIgnoreCase(h.getFirst("Connection"));
                RawExchange ex = new RawExchange(parts[0], parts[1], h, body, out);
                try { handler.handle(ex); } catch (IOException e) { throw e; } catch (Throwable t) { t.printStackTrace(); return; }
                if (!ex.closed) ex.close();
                if (ex.closeConn || close) { drain(body, 32L << 20); return; }
                if (drain(body, 32L << 20) < 0) return;
            }
        } catch (IOException ignored) {
        }
    }

    static long drain(InputStream b, long max) {
        try {
            byte[] buf = new byte[8192]; long total = 0; int r;
            while ((r = b.read(buf)) >= 0) { total += r; if (total > max) return -1; }
            return total;
        } catch (IOException e) { return -1; }
    }

    static void writeRaw(OutputStream out, int status) throws IOException {
        out.write(("HTTP/1.1 " + status + " Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    static class BoundedInputStream extends InputStream {
        final InputStream in; long left;
        BoundedInputStream(InputStream in, long n) { this.in = in; left = n; }
        public int read() throws IOException { if (left <= 0) return -1; int c = in.read(); if (c >= 0) left--; return c; }
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int r = in.read(b, off, (int) Math.min(len, left));
            if (r > 0) left -= r;
            return r;
        }
    }

    static class ChunkedInputStream extends InputStream {
        final InputStream in; long left = 0; boolean done = false;
        ChunkedInputStream(InputStream in) { this.in = in; }
        public int read() throws IOException { byte[] b = new byte[1]; int r = read(b, 0, 1); return r < 0 ? -1 : (b[0] & 0xff); }
        public int read(byte[] b, int off, int len) throws IOException {
            if (done) return -1;
            if (left == 0) {
                String sz = readLine(in);
                if (sz == null) { done = true; return -1; }
                int semi = sz.indexOf(';'); if (semi >= 0) sz = sz.substring(0, semi);
                try { left = Long.parseLong(sz.trim(), 16); } catch (NumberFormatException e) { done = true; throw new IOException("bad chunk"); }
                if (left == 0) { String t; while ((t = readLine(in)) != null && !t.isEmpty()) { } done = true; return -1; }
            }
            int r = in.read(b, off, (int) Math.min(len, left));
            if (r > 0) { left -= r; if (left == 0) readLine(in); }
            return r;
        }
    }

    static class RawExchange extends HttpExchange {
        final String method, target; final Headers reqH, resH = new Headers(); final InputStream body; final OutputStream out;
        final String rawPath, rawQuery;
        boolean closed, sent, closeConn; int code;

        RawExchange(String method, String target, Headers reqH, InputStream body, OutputStream out) {
            this.method = method; this.target = target; this.reqH = reqH; this.body = body; this.out = out;
            int q = target.indexOf('?');
            this.rawPath = q < 0 ? target : target.substring(0, q);
            this.rawQuery = q < 0 ? null : target.substring(q + 1);
        }

        public Headers getRequestHeaders() { return reqH; }
        public Headers getResponseHeaders() { return resH; }
        public URI getRequestURI() { return URI.create("/"); }
        public String getRequestMethod() { return method; }
        public HttpContext getHttpContext() { return null; }
        public void close() {
            closed = true;
            try { out.flush(); } catch (IOException ignored) { }
        }
        public InputStream getRequestBody() { return body; }
        public OutputStream getResponseBody() { return "HEAD".equals(method) ? OutputStream.nullOutputStream() : out; }
        public void sendResponseHeaders(int rCode, long len) throws IOException {
            code = rCode; sent = true;
            StringBuilder sb = new StringBuilder("HTTP/1.1 ").append(rCode).append(' ').append(reason(rCode)).append("\r\n");
            if ("close".equalsIgnoreCase(resH.getFirst("Connection"))) closeConn = true;
            for (var e : resH.entrySet()) for (String v : e.getValue()) sb.append(e.getKey()).append(": ").append(v).append("\r\n");
            if (len >= 0) sb.append("Content-Length: ").append(len).append("\r\n");
            else if (rCode != 204 && rCode != 304) sb.append("Content-Length: 0\r\n");
            sb.append("\r\n");
            out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
        }
        public InetSocketAddress getRemoteAddress() { return null; }
        public int getResponseCode() { return code; }
        public InetSocketAddress getLocalAddress() { return null; }
        public String getProtocol() { return "HTTP/1.1"; }
        public Object getAttribute(String name) { return null; }
        public void setAttribute(String name, Object value) { }
        public void setStreams(InputStream i, OutputStream o) { }
        public HttpPrincipal getPrincipal() { return null; }
    }

    static String reason(int c) {
        return switch (c) {
            case 200 -> "OK"; case 201 -> "Created"; case 204 -> "No Content"; case 400 -> "Bad Request"; case 401 -> "Unauthorized";
            case 403 -> "Forbidden"; case 404 -> "Not Found"; case 409 -> "Conflict"; case 412 -> "Precondition Failed";
            case 413 -> "Content Too Large"; case 415 -> "Unsupported Media Type"; case 422 -> "Unprocessable Content";
            case 428 -> "Precondition Required"; default -> "Internal Server Error";
        };
    }
}
