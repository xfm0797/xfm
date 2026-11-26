package publish

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func makeDist(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>hi</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func testConfig(sec map[string]any) *Config {
	return &Config{Raw: map[string]any{"github": sec, "cloudflare": sec, "netlify": sec, "vercel": sec}}
}

func TestParseGitHubRepo(t *testing.T) {
	cases := map[string]string{
		"https://github.com/xfm0797/xfm.git":    "xfm0797/xfm",
		"git@github.com:xfm0797/xfm.git":        "xfm0797/xfm",
		"ssh://git@github.com/xfm0797/xfm":      "xfm0797/xfm",
		"https://user:token@github.com/a/b.git": "a/b",
		"https://github.com/xfm0797":            "",
		"https://gitlab.com/xfm0797/xfm":        "",
	}
	for in, want := range cases {
		if got := parseGitHubRepo(in); got != want {
			t.Errorf("parseGitHubRepo(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestGitHubPagesURL(t *testing.T) {
	if got := githubPagesURL("xfm0797/xfm"); got != "https://xfm0797.github.io/xfm/" {
		t.Errorf("project page = %q", got)
	}
	if got := githubPagesURL("xfm0797/xfm0797.github.io"); got != "https://xfm0797.github.io/" {
		t.Errorf("user page = %q", got)
	}
}

func TestWalkFilesAndZip(t *testing.T) {
	dist := makeDist(t)
	files, err := walkFiles(dist)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || files[0].Rel != "assets/app.js" {
		t.Fatalf("files = %+v", files)
	}
	zipPath := filepath.Join(t.TempDir(), "site.zip")
	size, err := zipDist(dist, zipPath)
	if err != nil {
		t.Fatal(err)
	}
	if size <= 0 {
		t.Fatal("zip size should be positive")
	}
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if !names["index.html"] || !names["assets/app.js"] {
		t.Fatalf("zip entries = %v", names)
	}
}

func TestCloudflareUpload(t *testing.T) {
	var manifest map[string]string
	var branch string
	var uploaded int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/accounts/acc/pages/projects/demo/deployments") {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer cf-token" {
			t.Errorf("auth = %s", r.Header.Get("Authorization"))
		}
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Errorf("parse form: %v", err)
		}
		branch = r.FormValue("branch")
		_ = json.Unmarshal([]byte(r.FormValue("manifest")), &manifest)
		uploaded = len(r.MultipartForm.File)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"success":true,"result":{"id":"dep1","url":"demo.pages.dev"}}`)
	}))
	defer srv.Close()
	old := cloudflareAPIBase
	cloudflareAPIBase = srv.URL
	defer func() { cloudflareAPIBase = old }()

	t.Setenv("CLOUDFLARE_API_TOKEN", "cf-token")
	cfg := testConfig(map[string]any{"project": "demo", "accountId": "acc"})
	res, err := publishCloudflare(context.Background(), cfg, Options{DistDir: makeDist(t)}, "cloudflare")
	if err != nil {
		t.Fatal(err)
	}
	if res.URL != "https://demo.pages.dev" {
		t.Errorf("url = %q", res.URL)
	}
	if branch != "main" {
		t.Errorf("branch = %q", branch)
	}
	if len(manifest) != 2 || uploaded != 2 {
		t.Errorf("manifest=%v uploaded=%d", manifest, uploaded)
	}
	if _, ok := manifest["/index.html"]; !ok {
		t.Errorf("manifest keys = %v", manifest)
	}
}

func TestNetlifyUpload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sites/site1/deploys" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/zip" {
			t.Errorf("content-type = %s", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Authorization") != "Bearer nf-token" {
			t.Errorf("auth = %s", r.Header.Get("Authorization"))
		}
		if _, err := io.ReadAll(r.Body); err != nil {
			t.Errorf("read body: %v", err)
		}
		io.WriteString(w, `{"id":"dep9","deploy_ssl_url":"https://dep9--demo.netlify.app"}`)
	}))
	defer srv.Close()
	old := netlifyAPIBase
	netlifyAPIBase = srv.URL
	defer func() { netlifyAPIBase = old }()

	t.Setenv("NETLIFY_AUTH_TOKEN", "nf-token")
	cfg := testConfig(map[string]any{"siteId": "site1"})
	res, err := publishNetlify(context.Background(), cfg, Options{DistDir: makeDist(t)}, "netlify")
	if err != nil {
		t.Fatal(err)
	}
	if res.URL != "https://dep9--demo.netlify.app" {
		t.Errorf("url = %q", res.URL)
	}
}

func TestVercelUpload(t *testing.T) {
	var payload struct {
		Name   string `json:"name"`
		Target string `json:"target"`
		Files  []struct {
			File string `json:"file"`
			Data string `json:"data"`
		} `json:"files"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v13/deployments" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer vc-token" {
			t.Errorf("auth = %s", r.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Errorf("json: %v", err)
		}
		io.WriteString(w, `{"url":"demo-abc.vercel.app","alias":["demo.vercel.app"]}`)
	}))
	defer srv.Close()
	old := vercelAPIBase
	vercelAPIBase = srv.URL
	defer func() { vercelAPIBase = old }()

	t.Setenv("VERCEL_TOKEN", "vc-token")
	cfg := testConfig(map[string]any{"project": "demo"})
	res, err := publishVercel(context.Background(), cfg, Options{DistDir: makeDist(t)}, "vercel")
	if err != nil {
		t.Fatal(err)
	}
	if res.URL != "https://demo-abc.vercel.app" {
		t.Errorf("url = %q", res.URL)
	}
	if payload.Name != "demo" || payload.Target != "production" || len(payload.Files) != 2 {
		t.Errorf("payload = %+v", payload)
	}
	raw, err := base64.StdEncoding.DecodeString(payload.Files[0].Data)
	if err != nil || string(raw) != "console.log(1)" {
		t.Errorf("file data = %q err=%v", raw, err)
	}
}

func TestGitHubDryRun(t *testing.T) {
	cfg := &Config{Raw: map[string]any{"github": map[string]any{"repo": "me/blog"}}}
	res, err := publishGitHub(context.Background(), cfg, Options{
		DistDir: makeDist(t),
		DryRun:  true,
		Root:    t.TempDir(),
	}, "github")
	if err != nil {
		t.Fatal(err)
	}
	if res.URL != "https://me.github.io/blog/" || res.Files != 2 {
		t.Errorf("res = %+v", res)
	}
}

func TestDryRunNeedsNoToken(t *testing.T) {
	for _, name := range []string{"cloudflare", "netlify", "vercel"} {
		cfg := &Config{Raw: map[string]any{name: map[string]any{
			"project": "demo", "accountId": "acc", "siteId": "site1",
		}}}
		res, err := adapters[name](context.Background(), cfg, Options{
			DistDir: makeDist(t),
			DryRun:  true,
		}, name)
		if err != nil {
			t.Errorf("%s dry-run: %v", name, err)
		}
		if res.Files != 2 {
			t.Errorf("%s files = %d", name, res.Files)
		}
	}
}

func TestLoadConfig(t *testing.T) {
	root := t.TempDir()
	conf := `{"publish":{"targets":["github","netlify"],"github":{"repo":"me/blog"}}}`
	if err := os.WriteFile(filepath.Join(root, "xfm.config.json"), []byte(conf), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Targets) != 2 || cfg.Targets[0] != "github" {
		t.Errorf("targets = %v", cfg.Targets)
	}
	if cfg.Str("github", "repo", "GITHUB_REPO") != "me/blog" {
		t.Errorf("repo = %q", cfg.Str("github", "repo"))
	}
}

func TestLoadConfigRejectsUnknown(t *testing.T) {
	root := t.TempDir()
	conf := `{"publish":{"targets":["ftp"]}}`
	if err := os.WriteFile(filepath.Join(root, "xfm.config.json"), []byte(conf), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(root); err == nil {
		t.Fatal("expected error for unknown target")
	}
}

func TestRunUnknownTarget(t *testing.T) {
	out := Run(context.Background(), &Config{}, Options{
		DistDir: makeDist(t),
		Targets: []string{"ftp"},
	})
	if len(out) != 1 || out[0].Err == nil {
		t.Fatalf("outcomes = %+v", out)
	}
}
