package plugin

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
)

func init() { Register("redirect", newRedirect) }

var (
	reHasExt = regexp.MustCompile(`(?i)\.[a-z0-9]+$`)
	reIsURL  = regexp.MustCompile(`(?i)^[a-z][\w+.-]*:`)
)

func normFrom(u string) string {
	s := strings.TrimSpace(u)
	if s == "" {
		return ""
	}
	if !strings.HasPrefix(s, "/") {
		s = "/" + s
	}
	if i := strings.IndexAny(s, "#?"); i >= 0 {
		s = s[:i]
	}
	if !reHasExt.MatchString(s) && !strings.HasSuffix(s, "/") {
		s += "/"
	}
	return reMultiSlash.ReplaceAllString(s, "/")
}

func normTo(u string) string {
	s := strings.TrimSpace(u)
	if s == "" {
		return ""
	}
	if reIsURL.MatchString(s) || strings.HasPrefix(s, "//") {
		return s
	}
	if strings.HasPrefix(s, "/") {
		return s
	}
	return "/" + s
}

func redirectToFilePath(u string) string {
	clean := u
	if dec, err := url.PathUnescape(u); err == nil {
		clean = dec
	}
	if clean == "/" {
		return "index.html"
	}
	if strings.HasSuffix(strings.ToLower(clean), ".html") {
		return strings.TrimPrefix(clean, "/")
	}
	return strings.TrimPrefix(strings.TrimSuffix(clean, "/"), "/") + "/index.html"
}

// redirect：为旧地址生成跳转页。
func newRedirect(h Host) *Instance {
	base := Str(h.SiteConfig(), "base")
	href := func(u string) string {
		if reIsURL.MatchString(u) || strings.HasPrefix(u, "//") {
			return u
		}
		return WithBase(base, u)
	}

	pageHTML := func(to, lang string) string {
		target := href(to)
		return "<!DOCTYPE html>\n" +
			"<html lang=\"" + escXML(lang) + "\">\n" +
			"<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n" +
			"<title>跳转中…</title>\n" +
			"<link rel=\"canonical\" href=\"" + escXML(target) + "\">\n" +
			"<meta name=\"robots\" content=\"noindex,follow\">\n" +
			"<meta http-equiv=\"refresh\" content=\"0; url=" + escXML(target) + "\">\n" +
			"<script>location.replace(" + JSONLiteral(target) + " + location.search + location.hash);</script>\n" +
			"</head>\n" +
			"<body style=\"font:16px/1.6 system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:0 1.25rem\">\n" +
			"<p>此地址已迁移到 <a href=\"" + escXML(target) + "\">" + escXML(target) + "</a>。</p>\n" +
			"<p style=\"color:#888;font-size:.875rem\">如果浏览器没有自动跳转，请点击上面的链接。</p>\n" +
			"</body>\n</html>\n"
	}

	return &Instance{
		Name: "redirect",
		AfterBuild: func(h Host) []ExtraFile {
			m := map[string]string{}
			for from, to := range h.Section("redirects") {
				f, t := normFrom(from), normTo(toString(to))
				if f != "" && t != "" {
					m[f] = t
				}
			}
			for _, p := range h.Pages() {
				if v, ok := p.Data["redirect"].(bool); ok && !v {
					continue
				}
				var list []any
				if l, ok := p.Data["redirect_from"].([]any); ok {
					list = l
				} else if l, ok := p.Data["aliases"].([]any); ok {
					list = l
				} else if v, ok := p.Data["redirect_from"]; ok && v != nil {
					list = []any{v}
				} else if v, ok := p.Data["aliases"]; ok && v != nil {
					list = []any{v}
				}
				for _, it := range list {
					f := normFrom(toString(it))
					if f != "" && f != p.URL {
						m[f] = p.URL
					}
				}
			}
			if len(m) == 0 {
				return nil
			}
			taken := map[string]bool{}
			for _, p := range h.Pages() {
				taken[p.URL] = true
			}
			lang := defaultStr(Str(h.SiteConfig(), "lang"), "zh-CN")
			keys := make([]string, 0, len(m))
			for k := range m {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			var out []ExtraFile
			for _, from := range keys {
				to := m[from]
				if taken[from] || from == normTo(to) {
					continue
				}
				out = append(out, ExtraFile{Path: redirectToFilePath(from), Contents: []byte(pageHTML(to, lang))})
			}
			return out
		},
	}
}
