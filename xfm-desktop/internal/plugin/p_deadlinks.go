package plugin

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

func init() { Register("deadlinks", newDeadlinks) }

var deadKnownOutputs = []string{
	"sitemap.xml", "robots.txt", "feed.xml", "feed.json", "search.json",
	"llms.txt", "llms-full.txt", "manifest.webmanifest", "sw.js", "offline.html",
	"icon.svg", "stats.json", "404.html",
}

var (
	reDeadLink   = regexp.MustCompile(`(?is)\s(?:href|src)\s*=\s*"([^"]*)"|\s(?:href|src)\s*=\s*'([^']*)'`)
	reSkipScheme = regexp.MustCompile(`(?i)^(?:[a-z][\w+.-]*:|//)`)
)

type deadLink struct {
	From string `json:"from"`
	Href string `json:"href"`
}

type deadReport struct {
	Total int        `json:"total"`
	Links []deadLink `json:"links"`
}

// deadlinks：构建结束后检查站内死链。
func newDeadlinks(h Host) *Instance {
	cfg := h.Section("deadlinks")
	base := NormalizeBase(Str(h.SiteConfig(), "base"))
	ignore := StrList(cfg["ignore"])
	ignored := func(u string) bool {
		for _, it := range ignore {
			if strings.HasPrefix(u, it) {
				return true
			}
		}
		return false
	}

	toBare := func(raw, pageURL string) string {
		u := strings.TrimSpace(raw)
		if u == "" || strings.HasPrefix(u, "#") {
			return ""
		}
		if reSkipScheme.MatchString(u) {
			return ""
		}
		if !strings.HasPrefix(u, "/") {
			bu, err1 := url.Parse("http://x.invalid" + pageURL)
			ru, err2 := url.Parse(u)
			if err1 != nil || err2 != nil {
				return ""
			}
			u = bu.ResolveReference(ru).Path
		}
		if dec, err := url.PathUnescape(u); err == nil {
			u = dec
		}
		if base != "/" && base != "" && strings.HasPrefix(u, base) {
			u = "/" + u[len(base):]
		}
		return u
	}

	return &Instance{
		Name: "deadlinks",
		AfterBuild: func(h Host) []ExtraFile {
			if h.Mode() != "production" && !BoolVal(cfg, "dev", false) {
				return nil
			}
			ok := map[string]bool{"/": true}
			dec := func(u string) string {
				if v, err := url.PathUnescape(u); err == nil {
					return v
				}
				return u
			}
			add := func(p string) {
				clean := dec("/" + strings.ReplaceAll(p, "\\", "/"))
				clean = strings.TrimLeft(clean, "/")
				clean = "/" + clean
				ok[clean] = true
				if strings.HasSuffix(clean, "/index.html") {
					dir := strings.TrimSuffix(clean, "index.html")
					ok[dir] = true
					ok[strings.TrimSuffix(dir, "/")] = true
				}
			}
			for _, p := range h.Pages() {
				add(p.URL)
				u := dec(p.URL)
				ok[u] = true
				ok[strings.TrimSuffix(u, "/")] = true
				if strings.HasSuffix(u, "/") {
					ok[u+"index.html"] = true
				}
			}
			assets := h.Assets()
			for _, a := range assets.Theme {
				add(a.Dest)
			}
			for _, a := range assets.Public {
				add(a.Dest)
			}
			for _, a := range assets.Content {
				add(a.Dest)
			}
			for _, f := range h.ExtraFiles() {
				add(f.Path)
			}
			for _, f := range deadKnownOutputs {
				add(f)
			}

			var dead []deadLink
			seen := map[string]bool{}
			for _, p := range h.Pages() {
				if p.HTML == "" {
					continue
				}
				for _, m := range reDeadLink.FindAllStringSubmatch(p.HTML, -1) {
					raw := m[1]
					if raw == "" {
						raw = m[2]
					}
					u := toBare(raw, p.URL)
					if u == "" || ignored(u) {
						continue
					}
					hit := ok[u] || ok[strings.TrimSuffix(u, "/")+"/"] || ok[strings.TrimSuffix(u, "/")+"/index.html"]
					if hit || seen[u] {
						continue
					}
					seen[u] = true
					dead = append(dead, deadLink{From: p.URL, Href: u})
				}
			}

			if len(dead) == 0 {
				return nil
			}
			if BoolVal(cfg, "strict", false) {
				h.Fail(fmt.Errorf("[deadlinks] 发现 %d 处站内死链（deadlinks.strict = true）", len(dead)))
				return nil
			}
			if v, ok := cfg["report"].(bool); ok && !v {
				return nil
			}
			b, _ := json.MarshalIndent(deadReport{Total: len(dead), Links: dead}, "", "  ")
			return []ExtraFile{{Path: "deadlinks.json", Contents: append(b, '\n')}}
		},
	}
}
