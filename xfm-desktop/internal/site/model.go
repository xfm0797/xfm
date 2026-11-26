package site

import (
	"math"
	"path"
	"regexp"
	"strings"
	"time"

	"xfmdesk/internal/markdown"
)

// Page 是单个内容页的全部元数据。
type Page struct {
	Key         string
	File        string
	Rel         string
	URL         string
	Layout      string
	Title       string
	Description string
	Date        *time.Time
	Updated     *time.Time
	Tags        []string
	Category    string
	Series      string
	Lang        string
	Weight      int
	Draft       bool
	Toc         bool
	Data        map[string]any
	Body        string
	Excerpt     string
	ReadTime    int
	IsMD        bool
	Ext         string
	Raw         string

	BodyHTML string
	TocData  []markdown.Heading
	Taxonomy bool
	Listing  bool
	HTML     string
}

// nowFunc 便于测试替换。
var nowFunc = time.Now

var (
	reDateOnly = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	reDateTime = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?`)
)

// FormatDate 解析日期；非法返回 nil。
func FormatDate(v any) *time.Time {
	if v == nil {
		return nil
	}
	if t, ok := v.(time.Time); ok {
		return &t
	}
	s := strings.TrimSpace(toString(v))
	if s == "" {
		return nil
	}
	if m := reDateOnly.FindStringSubmatch(s); m != nil {
		t := time.Date(atoi(m[1]), time.Month(atoi(m[2])), atoi(m[3]), 0, 0, 0, 0, time.Local)
		return &t
	}
	if m := reDateTime.FindStringSubmatch(s); m != nil {
		t := time.Date(atoi(m[1]), time.Month(atoi(m[2])), atoi(m[3]), atoi(m[4]), atoi(m[5]), atoi(m[6]), 0, time.Local)
		return &t
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006/01/02", "2006-01-02T15:04:05"} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return &t
		}
	}
	return nil
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// FormatDay 输出日历日（本地时区）。
func FormatDay(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

// serializePage 页面对象 → 模板可见结构。
func (s *Site) serializePage(p *Page) map[string]any {
	desc := p.Description
	descShort := desc
	if descShort == "" {
		descShort = p.Excerpt
	}
	toc := make([]any, 0, len(p.TocData))
	for _, h := range p.TocData {
		toc = append(toc, map[string]any{"level": int64(h.Level), "text": h.Text, "id": h.ID})
	}
	return map[string]any{
		"url":          p.URL,
		"title":        p.Title,
		"description":  p.Description,
		"desc":         descShort,
		"date":         FormatDay(p.Date),
		"updated":      FormatDay(p.Updated),
		"tags":         toAnySlice(p.Tags),
		"category":     p.Category,
		"series":       p.Series,
		"lang":         p.Lang,
		"translations": p.Data["translations"],
		"weight":       int64(p.Weight),
		"layout":       p.Layout,
		"data":         p.Data,
		"excerpt":      p.Excerpt,
		"readTime":     int64(p.ReadTime),
		"toc":          toc,
	}
}

func toAnySlice(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// ---------- 摘要 / 阅读时长 ----------

var (
	reCodeFence     = regexp.MustCompile("(?s)```.*?```")
	reTildeFence    = regexp.MustCompile("(?s)~~~.*?~~~")
	reMDImage       = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	reMDRefDef      = regexp.MustCompile(`(?m)^ {0,3}\[[^\]]+\]:[ \t]*\S.*$`)
	reMDFootnoteRef = regexp.MustCompile(`\[\^[^\]]+\]`)
	reMDRefLink     = regexp.MustCompile(`!?\[([^\]]*)\]\[[^\]]*\]`)
	reMDLink        = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	reMDHeading     = regexp.MustCompile(`(?m)^\s{0,3}(?:#{1,6}|>)\s?`)
	reMDList        = regexp.MustCompile(`(?m)^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+`)
	reMDRule        = regexp.MustCompile(`(?m)^\s{0,3}(?:=+|-{2,}|\*{3,})\s*$`)
	reMDContainer   = regexp.MustCompile(`(?m)^\s*:{3,}\s*\w*`)
	reMDSymbols     = regexp.MustCompile("[`*_~#>|]")
	reSpaceCollapse = regexp.MustCompile(`\s+`)
	reHTMLTags      = regexp.MustCompile(`<[^>]*>`)
)

func markdownPlain(src string) string {
	s := src
	s = reCodeFence.ReplaceAllString(s, " ")
	s = reTildeFence.ReplaceAllString(s, " ")
	s = reMDImage.ReplaceAllString(s, " ")
	s = reMDRefDef.ReplaceAllString(s, " ")
	s = reMDFootnoteRef.ReplaceAllString(s, " ")
	s = reMDRefLink.ReplaceAllString(s, "$1")
	s = reMDLink.ReplaceAllString(s, "$1")
	s = reMDHeading.ReplaceAllString(s, "")
	s = reMDList.ReplaceAllString(s, "")
	s = reMDRule.ReplaceAllString(s, " ")
	s = reMDContainer.ReplaceAllString(s, " ")
	s = reMDSymbols.ReplaceAllString(s, " ")
	s = reSpaceCollapse.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func plainText(src string) string {
	s := reHTMLTags.ReplaceAllString(src, " ")
	s = reSpaceCollapse.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func runeLen(s string) int { return len([]rune(s)) }

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func summarize(source string, isMD bool, description string) (string, int) {
	var text string
	if isMD {
		text = markdownPlain(source)
	} else {
		text = plainText(source)
	}
	var excerpt string
	if description != "" {
		excerpt = description
	} else if runeLen(text) > 140 {
		excerpt = truncateRunes(text, 140) + "…"
	} else {
		excerpt = text
	}
	rt := int(math.Round(float64(runeLen(text)) / 350.0))
	if rt < 1 {
		rt = 1
	}
	return excerpt, rt
}

// ---------- 相对链接解析 ----------

var reAbsoluteLink = regexp.MustCompile(`^(?i:[a-z][a-z0-9+.-]*:|//|/|#)`)

// newLinkResolver 返回把 .md 相对链接解析为站点 URL 的函数。
func newLinkResolver(index map[string]string) func(href string, page *Page) string {
	return func(href string, page *Page) string {
		if href == "" {
			return href
		}
		if reAbsoluteLink.MatchString(href) {
			return href
		}
		anchor := ""
		clean := href
		if i := strings.IndexByte(href, '#'); i >= 0 {
			anchor = href[i:]
			clean = href[:i]
		}
		clean = strings.TrimPrefix(clean, "./")
		if i := strings.IndexByte(clean, '?'); i >= 0 {
			clean = clean[:i]
		}
		target := path.Clean(path.Join(path.Dir(page.Rel), clean))
		if u, ok := index[target]; ok {
			return u + anchor
		}
		for _, ext := range []string{".md", ".markdown", ".html"} {
			if u, ok := index[target+ext]; ok {
				return u + anchor
			}
		}
		if u, ok := index[path.Join(target, "index.md")]; ok {
			return u + anchor
		}
		return href
	}
}

// isZh 判断站点语言是否中文。
func isZh(lang string) bool {
	return strings.HasPrefix(strings.ToLower(lang), "zh")
}
