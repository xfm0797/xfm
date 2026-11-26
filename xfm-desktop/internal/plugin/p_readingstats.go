package plugin

import (
	"encoding/json"
	"regexp"
	"sort"
)

func init() { Register("reading-stats", newReadingStats) }

type statsRow struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Words   int    `json:"words"`
	Minutes int    `json:"minutes"`
}

type statsPayload struct {
	TotalWords int        `json:"totalWords"`
	TotalPages int        `json:"totalPages"`
	Pages      []statsRow `json:"pages"`
}

var (
	reRsPre    = regexp.MustCompile(`(?s)<pre.*?</pre>`)
	reRsScript = regexp.MustCompile(`(?s)<script.*?</script>`)
	reRsStyle  = regexp.MustCompile(`(?s)<style.*?</style>`)
	reRsTag    = regexp.MustCompile(`<[^>]+>`)
)

// reading-stats：统计字数与阅读时长，生成 stats.json。
func newReadingStats(h Host) *Instance {
	return &Instance{
		Name: "reading-stats",
		ExtendContext: func(ctx map[string]any) map[string]any {
			words := 0
			for _, it := range AnyList(ctx["pages"]) {
				m := AsMap(it)
				if m == nil {
					continue
				}
				words += countWords(Str(m, "excerpt") + " " + Str(m, "title"))
			}
			mins := (words + 200) / 400
			if mins < 1 {
				mins = 1
			}
			ctx["stats"] = map[string]any{"words": words, "minutes": mins}
			return ctx
		},
		AfterBuild: func(h Host) []ExtraFile {
			var rows []statsRow
			total := 0
			for _, p := range h.Documents() {
				words := countWords(rsStripHTML(p.HTML))
				total += words
				mins := (words + 200) / 400
				if mins < 1 {
					mins = 1
				}
				rows = append(rows, statsRow{URL: p.URL, Title: p.Title, Words: words, Minutes: mins})
			}
			sort.SliceStable(rows, func(i, j int) bool { return rows[i].Words > rows[j].Words })
			if len(rows) > 200 {
				rows = rows[:200]
			}
			b, _ := json.MarshalIndent(statsPayload{
				TotalWords: total, TotalPages: len(rows), Pages: rows,
			}, "", "  ")
			return []ExtraFile{{Path: "stats.json", Contents: b}}
		},
	}
}

func rsStripHTML(html string) string {
	s := reRsPre.ReplaceAllString(html, " ")
	s = reRsScript.ReplaceAllString(s, " ")
	s = reRsStyle.ReplaceAllString(s, " ")
	s = reRsTag.ReplaceAllString(s, " ")
	return s
}

// countWords 中文按字计、英文按词计（对齐 Node 版的一次扫描）。
func countWords(text string) int {
	count := 0
	inLatin := false
	for _, c := range text {
		switch {
		case c >= 0x4e00 && c <= 0x9fff:
			count++
			inLatin = false
		case (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '\'' || c == '-':
			if !inLatin {
				count++
				inLatin = true
			}
		default:
			inLatin = false
		}
	}
	return count
}
