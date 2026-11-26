package plugin

import (
	"regexp"
	"strings"
)

func init() { Register("llms", newLLMS) }

var (
	reLlmsScript = regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script>`)
	reLlmsStyle  = regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style>`)
	reLlmsPre    = regexp.MustCompile(`(?is)<pre\b[^>]*>.*?</pre>`)
	reLlmsBr     = regexp.MustCompile(`(?i)<br\s*/?>`)
	reLlmsClose  = regexp.MustCompile(`(?i)</(p|div|li|h[1-6]|tr|blockquote)>`)
	reLlmsTag    = regexp.MustCompile(`<[^>]+>`)
	reLlmsEnt    = regexp.MustCompile(`(?i)&([a-z]+|#\d+);`)
	reLlmsSpaces = regexp.MustCompile(`[ \t]+`)
	reLlmsBlanks = regexp.MustCompile(`\n{3,}`)
)

var llmsEntities = map[string]string{
	"amp": "&", "lt": "<", "gt": ">", "quot": `"`, "apos": "'", "nbsp": " ", "#39": "'",
}

// llms：生成 llms.txt / llms-full.txt。
func newLLMS(h Host) *Instance {
	cfg := h.Section("llms")
	siteConf := h.SiteConfig()

	return &Instance{
		Name: "llms",
		AfterBuild: func(h Host) []ExtraFile {
			var all []*Doc
			for _, p := range h.Documents() {
				if v, ok := p.Data["llms"].(bool); ok && !v {
					continue
				}
				if p.URL == "/" || p.Date == "" || Str(p.Data, "type") == "page" {
					continue
				}
				all = append(all, p)
			}
			max := IntVal(cfg, "maxItems", 0)
			posts := all
			if max > 0 && max < len(posts) {
				posts = posts[:max]
			}
			if len(posts) == 0 {
				return nil
			}

			var order []string
			byCat := map[string][]*Doc{}
			for _, p := range posts {
				key := p.Category
				if _, ok := byCat[key]; !ok {
					order = append(order, key)
				}
				byCat[key] = append(byCat[key], p)
			}

			line := func(p *Doc) string {
				url := AbsoluteURL(siteConf, p.URL)
				desc := collapseSpace(p.Description)
				s := "- [" + defaultStr(p.Title, p.URL) + "](" + url + ")"
				if desc != "" {
					s += ": " + desc
				}
				return s
			}

			head := []string{"# " + defaultStr(Str(siteConf, "title"), "Site"), ""}
			if d := Str(siteConf, "description"); d != "" {
				head = append(head, "> "+d, "")
			}
			head = append(head, "- 文章数："+itoa(len(posts)), "- 语言："+defaultStr(Str(siteConf, "lang"), "zh-CN"), "")

			var body []string
			for _, cat := range order {
				if cat != "" {
					body = append(body, "## "+cat)
				} else {
					body = append(body, "## 文章")
				}
				body = append(body, "")
				for _, p := range byCat[cat] {
					body = append(body, line(p))
				}
				body = append(body, "")
			}

			files := []ExtraFile{{
				Path:     defaultStr(Str(cfg, "path"), "llms.txt"),
				Contents: []byte(strings.TrimRight(strings.Join(append(append([]string{}, head...), body...), "\n"), " \t\n\r") + "\n"),
			}}

			fullEnabled := true
			if v, ok := cfg["full"].(bool); ok {
				fullEnabled = v
			}
			if fullEnabled {
				full := append([]string{}, head...)
				for _, p := range posts {
					full = append(full, "## "+defaultStr(p.Title, p.URL), "", AbsoluteURL(siteConf, p.URL), "")
					text := llmsStripHTML(p.HTML)
					if text != "" {
						full = append(full, text, "")
					}
				}
				files = append(files, ExtraFile{
					Path:     defaultStr(Str(cfg, "fullPath"), "llms-full.txt"),
					Contents: []byte(strings.TrimRight(strings.Join(full, "\n"), " \t\n\r") + "\n"),
				})
			}
			return files
		},
	}
}

func llmsStripHTML(html string) string {
	s := reLlmsScript.ReplaceAllString(html, " ")
	s = reLlmsStyle.ReplaceAllString(s, " ")
	s = reLlmsPre.ReplaceAllString(s, " ")
	s = reLlmsBr.ReplaceAllString(s, "\n")
	s = reLlmsClose.ReplaceAllString(s, "\n")
	s = reLlmsTag.ReplaceAllString(s, "")
	s = reLlmsEnt.ReplaceAllStringFunc(s, func(m string) string {
		if v, ok := llmsEntities[strings.ToLower(m[1:len(m)-1])]; ok {
			return v
		}
		return m
	})
	s = reLlmsSpaces.ReplaceAllString(s, " ")
	s = reLlmsBlanks.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
