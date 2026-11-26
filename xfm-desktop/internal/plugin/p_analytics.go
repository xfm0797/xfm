package plugin

import (
	"strings"
)

func init() { Register("analytics", newAnalytics) }

// analytics：向每个页面 </body> 前插入访问统计脚本。
func newAnalytics(h Host) *Instance {
	cfg := h.Section("analytics")
	inDev := BoolVal(cfg, "dev", false)
	exclude := StrList(cfg["exclude"])

	var providers []string
	if arr := AnyList(cfg["provider"]); arr != nil {
		for _, it := range arr {
			providers = append(providers, toString(it))
		}
	} else if p := Str(cfg, "provider"); p != "" {
		providers = []string{p}
	} else {
		providers = []string{"umami"}
	}

	sub := func(name string) map[string]any {
		if m := AsMap(cfg[name]); m != nil {
			return m
		}
		return cfg
	}

	var parts []string
	for _, name := range providers {
		switch strings.ToLower(name) {
		case "umami":
			o := sub(name)
			src := defaultStr(Str(o, "src"), "https://umami.example.com/script.js")
			parts = append(parts, `<script defer src="`+EscHTML(src)+`" data-website-id="`+EscHTML(Str(o, "id"))+`"></script>`)
		case "plausible":
			o := sub(name)
			src := defaultStr(Str(o, "src"), "https://plausible.io/js/script.js")
			parts = append(parts, `<script defer data-domain="`+EscHTML(Str(o, "domain"))+`" src="`+EscHTML(src)+`"></script>`)
		case "google":
			o := sub(name)
			id := EscHTML(Str(o, "id"))
			parts = append(parts, `<script async src="https://www.googletagmanager.com/gtag/js?id=`+id+`"></script>`+
				`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','`+id+`');</script>`)
		case "baidu":
			o := sub(name)
			id := strings.Map(func(r rune) rune {
				if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
					return r
				}
				return -1
			}, Str(o, "id"))
			parts = append(parts, `<script>var _hmt=_hmt||[];(function(){var hm=document.createElement("script");hm.src="https://hm.baidu.com/hm.js?`+id+`";var s=document.getElementsByTagName("script")[0];s.parentNode.insertBefore(hm,s)})();</script>`)
		case "custom":
			o := sub(name)
			if s := Str(o, "script"); s != "" {
				parts = append(parts, s)
			}
		}
	}
	snippet := strings.Join(parts, "\n")

	return &Instance{
		Name: "analytics",
		TransformHTML: func(html string, page *Doc) string {
			if snippet == "" {
				return html
			}
			if !inDev && h.Mode() != "production" {
				return html
			}
			if page == nil {
				return html
			}
			if v, ok := page.Data["analytics"].(bool); ok && !v {
				return html
			}
			for _, p := range exclude {
				if strings.HasPrefix(page.URL, p) {
					return html
				}
			}
			at := lastIndexFold(html, "</body>")
			if at == -1 {
				return html
			}
			if strings.Contains(html, "data-xfm-analytics") {
				return html
			}
			return html[:at] + "<div data-xfm-analytics hidden></div>\n" + snippet + "\n" + html[at:]
		},
	}
}
