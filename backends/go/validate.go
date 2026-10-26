package main

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

// trimWS trims Unicode White_Space (unicode.IsSpace covers exactly that set,
// including U+0085, NBSP, U+2003, U+3000; not U+200B or U+FEFF).
func trimWS(s string) string { return strings.TrimFunc(s, unicode.IsSpace) }

func cpLen(s string) int { return utf8.RuneCountInString(s) }

// loneSurrogate scans raw JSON for \uD800-\uDFFF escapes that are not a valid pair.
func loneSurrogate(b []byte) bool {
	inStr := false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if !inStr {
			if c == '"' {
				inStr = true
			}
			continue
		}
		switch c {
		case '"':
			inStr = false
		case '\\':
			if i+1 >= len(b) {
				return false
			}
			if b[i+1] != 'u' {
				i++
				continue
			}
			v, ok := hex4(b, i+2)
			if !ok {
				return false // malformed; the decoder rejects it
			}
			i += 5
			if v >= 0xD800 && v <= 0xDBFF {
				if i+6 < len(b) && b[i+1] == '\\' && b[i+2] == 'u' {
					if w, ok := hex4(b, i+3); ok && w >= 0xDC00 && w <= 0xDFFF {
						i += 6
						continue
					}
				}
				return true
			}
			if v >= 0xDC00 && v <= 0xDFFF {
				return true
			}
		}
	}
	return false
}

func hex4(b []byte, i int) (int, bool) {
	if i+4 > len(b) {
		return 0, false
	}
	v := 0
	for _, c := range b[i : i+4] {
		v <<= 4
		switch {
		case c >= '0' && c <= '9':
			v |= int(c - '0')
		case c >= 'a' && c <= 'f':
			v |= int(c-'a') + 10
		case c >= 'A' && c <= 'F':
			v |= int(c-'A') + 10
		default:
			return 0, false
		}
	}
	return v, true
}

// parseJSON returns the decoded value; ok=false means malformed (400).
func parseJSON(b []byte) (any, bool) {
	if !utf8.Valid(b) || loneSurrogate(b) {
		return nil, false
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, false
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, false
	}
	return v, true
}

type fieldErr struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

var readOnly = map[string]bool{"id": true, "teamId": true, "authorId": true, "version": true, "createdAt": true, "updatedAt": true, "deletedAt": true}

func checkTitle(v any) (string, *fieldErr) {
	s, ok := v.(string)
	if !ok {
		return "", &fieldErr{"title", "must be a string"}
	}
	s = trimWS(s)
	if n := cpLen(s); n < 1 || n > 200 {
		return "", &fieldErr{"title", "must be 1-200 characters after trimming"}
	}
	return s, nil
}

func checkBody(v any) (string, *fieldErr) {
	s, ok := v.(string)
	if !ok {
		return "", &fieldErr{"body", "must be a string"}
	}
	if cpLen(s) > 100000 {
		return "", &fieldErr{"body", "must be at most 100000 characters"}
	}
	return s, nil
}

type noteInput struct {
	title, body       string
	hasTitle, hasBody bool
}

// validateNote validates a create (create=true) or patch body.
func validateNote(v any, create bool) (noteInput, []fieldErr) {
	var in noteInput
	m, ok := v.(map[string]any)
	if !ok {
		return in, []fieldErr{{"$", "body must be a JSON object"}}
	}
	var errs []fieldErr
	for k, val := range m {
		switch k {
		case "title":
			s, e := checkTitle(val)
			if e != nil {
				errs = append(errs, *e)
			} else {
				in.title, in.hasTitle = s, true
			}
		case "body":
			s, e := checkBody(val)
			if e != nil {
				errs = append(errs, *e)
			} else {
				in.body, in.hasBody = s, true
			}
		default:
			if readOnly[k] {
				errs = append(errs, fieldErr{k, "is read-only"})
			} else {
				errs = append(errs, fieldErr{k, "unknown field"})
			}
		}
	}
	if create {
		if _, has := m["title"]; !has {
			errs = append(errs, fieldErr{"title", "is required"})
		}
	} else if len(m) == 0 {
		errs = append(errs, fieldErr{"$", "at least one field is required"})
	}
	return in, errs
}
