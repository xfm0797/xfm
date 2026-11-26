package gui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xfmdesk/internal/frontmatter"
)

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Hello World":    "hello-world",
		"Hello, 世界!":     "hello-世界",
		"  a__b--c  ":    "a-b-c",
		"Go 1.22 / Tips": "go-122-tips",
		"":               "",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildPostDocument(t *testing.T) {
	doc := buildPostDocument(`你好 "世界"`, "go, 博客，", true)
	fm := frontmatter.Parse(doc)
	if got := fm.Data["title"]; got != `你好 "世界"` {
		t.Errorf("title = %v", got)
	}
	if fm.Data["draft"] != true {
		t.Errorf("draft = %v", fm.Data["draft"])
	}
	tags, ok := fm.Data["tags"].([]any)
	if !ok || len(tags) != 2 || tags[0] != "go" || tags[1] != "博客" {
		t.Errorf("tags = %#v", fm.Data["tags"])
	}
	if !strings.Contains(doc, "# 你好") {
		t.Errorf("body heading missing:\n%s", doc)
	}
}

func TestUniquePostName(t *testing.T) {
	dir := t.TempDir()
	if got := uniquePostName(dir, "hello"); got != "hello.md" {
		t.Errorf("first = %q", got)
	}
	if err := os.WriteFile(filepath.Join(dir, "hello.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := uniquePostName(dir, "hello"); got != "hello-2.md" {
		t.Errorf("second = %q", got)
	}
}
