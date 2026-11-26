package plugin

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"
)

func init() { Register("search", newSearch) }

type searchItem struct {
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Category    string   `json:"category"`
	Date        string   `json:"date"`
	Text        string   `json:"text"`
}

type searchPayload struct {
	Version   int          `json:"version"`
	Generated string       `json:"generated"`
	Count     int          `json:"count"`
	Items     []searchItem `json:"items"`
}

var reEntity = regexp.MustCompile(`&(amp|lt|gt|quot|#39|nbsp);`)

var entityMap = map[string]string{
	"amp": "&", "lt": "<", "gt": ">", "quot": `"`, "#39": "'", "nbsp": " ",
}

// search：生成 search.json 站内搜索索引，并向上下文注入搜索入口。
func newSearch(h Host) *Instance {
	return &Instance{
		Name: "search",
		ExtendContext: func(ctx map[string]any) map[string]any {
			siteCfg := h.SiteConfig()
			conf := h.Section("search")
			file := strings.TrimLeft(Str(conf, "path"), "/")
			if file == "" {
				file = "search.json"
			}
			ctx["search"] = map[string]any{
				"url":  WithBase(Str(siteCfg, "base"), "/"+file),
				"file": file,
				"hint": Str(conf, "hint"),
			}
			return ctx
		},
		AfterBuild: func(h Host) []ExtraFile {
			siteCfg := h.SiteConfig()
			conf := h.Section("search")
			maxChars := IntVal(conf, "maxChars", 1500)
			if maxChars == 0 {
				maxChars = 1500
			}
			file := strings.TrimLeft(Str(conf, "path"), "/")
			if file == "" {
				file = "search.json"
			}
			plain := h.Helpers().PlainText
			items := make([]searchItem, 0)
			for _, p := range h.Documents() {
				typ := Str(p.Data, "type")
				if typ == "taxonomy" || typ == "index" || typ == "pagination" {
					continue
				}
				if v, ok := p.Data["search"].(bool); ok && !v {
					continue
				}
				if p.URL == "/" {
					continue
				}
				text := plain(p.HTML)
				text = reEntity.ReplaceAllStringFunc(text, func(m string) string {
					if v, ok := entityMap[m[1:len(m)-1]]; ok {
						return v
					}
					return " "
				})
				text = truncateRunes(text, maxChars)
				tags := p.Tags
				if tags == nil {
					tags = []string{}
				}
				items = append(items, searchItem{
					URL:         WithBase(Str(siteCfg, "base"), p.URL),
					Title:       p.Title,
					Description: p.Description,
					Tags:        tags,
					Category:    p.Category,
					Date:        p.Date,
					Text:        text,
				})
			}
			payload := searchPayload{
				Version:   1,
				Generated: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
				Count:     len(items),
				Items:     items,
			}
			b, _ := json.Marshal(payload)
			return []ExtraFile{{Path: file, Contents: b}}
		},
	}
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
