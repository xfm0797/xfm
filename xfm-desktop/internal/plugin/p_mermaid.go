package plugin

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func init() { Register("mermaid", newMermaid) }

const mermaidDefaultCDN = "https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.min.js"

var (
	reMermaidBlock   = regexp.MustCompile(`(?s)<div class="code-block">(?:<div class="code-title">.*?</div>)?\s*<pre class="language-mermaid"><code>(.*?)</code></pre>\s*</div>`)
	reMermaidDiagram = regexp.MustCompile(`<pre class="language-mermaid"|<pre class="mermaid"`)
	reMermaidLoaded  = regexp.MustCompile(`(?i)<script[^>]+mermaid(?:\.min)?\.js`)
)

// mermaid：把 ```mermaid 代码块转成 <pre class="mermaid"> 并注入渲染脚本。
func newMermaid(h Host) *Instance {
	conf := h.Section("mermaid")
	mode := defaultStr(Str(conf, "mode"), "local")
	assetPath := strings.Trim(strings.TrimLeft(Str(conf, "path"), "/"), "/")
	if assetPath == "" {
		assetPath = "assets/mermaid"
	}
	base := Str(h.SiteConfig(), "base")
	cdn := defaultStr(Str(conf, "cdn"), mermaidDefaultCDN)

	// 本地资源查找：站点根 / public / 主题 assets。
	localFile := ""
	if mode == "local" {
		candidates := []string{
			filepath.Join(h.Root(), filepath.FromSlash(assetPath), "mermaid.min.js"),
			filepath.Join(h.Root(), "public", filepath.FromSlash(assetPath), "mermaid.min.js"),
		}
		if h.ThemeDir() != "" {
			candidates = append(candidates, filepath.Join(h.ThemeDir(), "assets", "mermaid", "mermaid.min.js"))
		}
		for _, c := range candidates {
			if st, err := os.Stat(c); err == nil && !st.IsDir() {
				localFile = c
				break
			}
		}
	}

	// local 模式找不到本地文件时退回 CDN，避免图表页引用一个 404 的脚本。
	scriptURL := ""
	switch mode {
	case "cdn":
		scriptURL = cdn
	case "local":
		if localFile != "" {
			scriptURL = "/" + assetPath + "/mermaid.min.js"
		} else {
			scriptURL = cdn
		}
	}

	init := map[string]any{
		"startOnLoad":   false,
		"theme":         defaultStr(Str(conf, "theme"), "default"),
		"securityLevel": defaultStr(Str(conf, "securityLevel"), "loose"),
	}
	if opt := AsMap(conf["option"]); opt != nil {
		for k, v := range opt {
			init[k] = v
		}
	}

	return &Instance{
		Name: "mermaid",
		TransformHTML: func(html string, page *Doc) string {
			if html == "" {
				return html
			}
			if page != nil {
				if v, ok := page.Data["mermaid"].(bool); ok && !v {
					return html
				}
			}
			if !reMermaidDiagram.MatchString(html) {
				return html
			}
			body := reMermaidBlock.ReplaceAllString(html, `<pre class="mermaid">$1</pre>`)
			if !strings.Contains(body, `class="mermaid"`) {
				return html
			}
			if reMermaidLoaded.MatchString(body) {
				return body
			}
			options := JSONLiteral(init)
			style := `<style>pre.mermaid{background:transparent;border:0;padding:0;margin:1.2em 0;` +
				`text-align:center;overflow-x:auto;font-family:inherit}</style>`
			script := ""
			if scriptURL != "" {
				script = `<script src="` + EscHTML(WithBase(base, scriptURL)) + `"></script>`
			}
			boot := `<script>(function(){if(!window.mermaid)return;window.mermaid.initialize(` + options + `);` +
				`window.mermaid.run({querySelector:'.mermaid'});})();</script>`
			if at := lastIndexFold(body, "</body>"); at != -1 {
				return body[:at] + style + script + boot + body[at:]
			}
			return body + style + script + boot
		},
		AfterBuild: func(h Host) []ExtraFile {
			if mode != "local" || localFile == "" {
				return nil
			}
			data, err := os.ReadFile(localFile)
			if err != nil {
				return nil
			}
			return []ExtraFile{{Path: assetPath + "/mermaid.min.js", Contents: data}}
		},
	}
}
