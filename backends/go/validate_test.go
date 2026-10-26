package main

import "testing"

func TestTrim(t *testing.T) {
	if trimWS(" hi　") != "hi" {
		t.Fatal("nbsp/ideographic")
	}
	if trimWS("\u200b") != "\u200b" || trimWS("\uFEFF") != "\uFEFF" {
		t.Fatal("zwsp/bom must not trim")
	}
}

func TestCodePoints(t *testing.T) {
	if cpLen("é") != 2 || cpLen("👨‍👩‍👧") != 5 {
		t.Fatal("cp count")
	}
}

func TestSurrogates(t *testing.T) {
	bad := []string{`{"a":"\ud800"}`, `{"a":"x\udfff"}`, `{"a":"\ud800x"}`, `{"a":"\udc00\ud800"}`}
	for _, s := range bad {
		if _, ok := parseJSON([]byte(s)); ok {
			t.Fatal("accepted", s)
		}
	}
	good := []string{`{"a":"😀"}`, `{"a":"\\ud800"}`, `{"a":"\u0000"}`}
	for _, s := range good {
		if _, ok := parseJSON([]byte(s)); !ok {
			t.Fatal("rejected", s)
		}
	}
	if _, ok := parseJSON([]byte("{\"a\":\"\xff\xfe\"}")); ok {
		t.Fatal("invalid utf8 accepted")
	}
	if _, ok := parseJSON([]byte(`{} x`)); ok {
		t.Fatal("trailing")
	}
}

func TestValidate(t *testing.T) {
	v, _ := parseJSON([]byte(`{"title":"  hi ","authorId":"x"}`))
	if _, e := validateNote(v, true); len(e) != 1 || e[0].Field != "authorId" {
		t.Fatal(e)
	}
	v, _ = parseJSON([]byte(`[]`))
	if _, e := validateNote(v, false); e[0].Field != "$" {
		t.Fatal(e)
	}
}
