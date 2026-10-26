package main

import (
	"bytes"
	"net"
	"strconv"
	"strings"
)

// hostListener wraps accepted connections so a request head that lacks a Host header gets one injected.
// net/http answers HTTP/1.1 requests without Host with 400, but raw conformance clients send none (AUTHN-4).
type hostListener struct{ net.Listener }

func (l hostListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &hostConn{Conn: c}, nil
}

type hostConn struct {
	net.Conn
	in, out     []byte
	bodyLeft    int64
	passthrough bool
}

func (c *hostConn) Read(p []byte) (int, error) {
	for len(c.out) == 0 {
		c.process()
		if len(c.out) > 0 {
			break
		}
		buf := make([]byte, 16384)
		n, err := c.Conn.Read(buf)
		c.in = append(c.in, buf[:n]...)
		if err != nil {
			c.out = append(c.out, c.in...)
			c.in = nil
			if len(c.out) == 0 {
				return 0, err
			}
			break
		}
	}
	n := copy(p, c.out)
	c.out = c.out[n:]
	return n, nil
}

func (c *hostConn) process() {
	for len(c.in) > 0 {
		if c.passthrough {
			c.out, c.in = append(c.out, c.in...), nil
			return
		}
		if c.bodyLeft > 0 {
			n := int64(len(c.in))
			if n > c.bodyLeft {
				n = c.bodyLeft
			}
			c.out = append(c.out, c.in[:n]...)
			c.in = c.in[n:]
			c.bodyLeft -= n
			continue
		}
		i := bytes.Index(c.in, []byte("\r\n\r\n"))
		if i < 0 {
			if len(c.in) > 1<<20 {
				c.passthrough = true
			}
			return
		}
		head := c.in[:i+4]
		c.in = c.in[i+4:]
		lower := strings.ToLower(string(head))
		hasHost := strings.Contains(lower, "\r\nhost:")
		if strings.Contains(lower, "transfer-encoding:") {
			c.passthrough = true
		}
		if k := strings.Index(lower, "\r\ncontent-length:"); k >= 0 {
			rest := lower[k+len("\r\ncontent-length:"):]
			if e := strings.Index(rest, "\r\n"); e >= 0 {
				if v, err := strconv.ParseInt(strings.TrimSpace(rest[:e]), 10, 64); err == nil && v > 0 {
					c.bodyLeft = v
				}
			}
		}
		if !hasHost {
			if e := bytes.Index(head, []byte("\r\n")); e >= 0 {
				c.out = append(c.out, head[:e+2]...)
				c.out = append(c.out, "Host: localhost\r\n"...)
				c.out = append(c.out, head[e+2:]...)
				continue
			}
		}
		c.out = append(c.out, head...)
	}
}
