package plugin

import (
	"regexp"
	"strings"
)

func init() { Register("minify", newMinify) }

var (
	reProtectBlock = regexp.MustCompile(`(?is)<pre\b[^>]*>.*?</pre>|<code\b[^>]*>.*?</code>|<textarea\b[^>]*>.*?</textarea>|<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>`)
	reHTMLComment  = regexp.MustCompile(`(?s)<!--.*?-->`)
	reLineTail     = regexp.MustCompile(`(?m)[ \t]+$`)
	reBlankLine    = regexp.MustCompile(`(?m)^[ \t]+$`)
	reLineIndent   = regexp.MustCompile(`\n[ \t]+<`)
	reBlankRuns    = regexp.MustCompile(`\n{2,}`)
	reAggressive   = regexp.MustCompile(`>\s*\n\s*<`)
	reStash        = regexp.MustCompile(`<xfm-stash-(\d+)/>`)
	reCRLF         = regexp.MustCompile(`\r\n?`)
)

// minify：构建期压缩 HTML。
func newMinify(h Host) *Instance {
	cfg := h.Section("minify")
	aggressive := BoolVal(cfg, "aggressive", false)
	enabled := BoolVal(cfg, "enabled", true)

	return &Instance{
		Name: "minify",
		TransformHTML: func(html string, page *Doc) string {
			if html == "" || !enabled || h.Mode() == "development" {
				return html
			}
			var stash []string
			out := reProtectBlock.ReplaceAllStringFunc(html, func(m string) string {
				stash = append(stash, m)
				return "<xfm-stash-" + itoa(len(stash)-1) + "/>"
			})
			out = reCRLF.ReplaceAllString(out, "\n")
			out = reHTMLComment.ReplaceAllStringFunc(out, func(m string) string {
				if strings.HasPrefix(m, "<!--[if") {
					return m
				}
				return ""
			})
			out = reLineTail.ReplaceAllString(out, "")
			out = reBlankLine.ReplaceAllString(out, "")
			out = reLineIndent.ReplaceAllString(out, "\n<")
			out = reBlankRuns.ReplaceAllString(out, "\n")
			out = strings.TrimSpace(out)
			if aggressive {
				out = reAggressive.ReplaceAllString(out, "><")
			}
			out = reStash.ReplaceAllStringFunc(out, func(m string) string {
				sub := reStash.FindStringSubmatch(m)
				if len(sub) == 2 {
					idx := 0
					for _, c := range sub[1] {
						idx = idx*10 + int(c-'0')
					}
					if idx >= 0 && idx < len(stash) {
						return stash[idx]
					}
				}
				return m
			})
			return out
		},
	}
}
