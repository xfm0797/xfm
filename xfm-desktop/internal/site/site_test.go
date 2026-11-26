package site

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xfmdesk/internal/scaffold"
)

func TestBuildScaffold(t *testing.T) {
	dir := t.TempDir()
	if err := scaffold.Create(scaffold.CreateOptions{Dir: dir, Title: "Parity Site", Template: "blog"}); err != nil {
		t.Fatalf("scaffold: %v", err)
	}
	s, err := BuildSite(dir, "production")
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if s.Stats.Pages == 0 {
		t.Fatal("no pages generated")
	}
	index := filepath.Join(dir, "dist", "index.html")
	data, err := os.ReadFile(index)
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	html := string(data)
	if !strings.Contains(html, "Parity Site") {
		t.Fatal("index missing site title")
	}
	if !strings.Contains(html, `class="card"`) {
		t.Fatal("index missing post cards")
	}
	// 文章页应生成
	if _, err := os.Stat(filepath.Join(dir, "dist", "posts", "hello-world", "index.html")); err != nil {
		t.Fatalf("post page missing: %v", err)
	}
	// 主题资源应复制
	if _, err := os.Stat(filepath.Join(dir, "dist", "assets", "style.css")); err != nil {
		t.Fatalf("theme assets missing: %v", err)
	}
}
