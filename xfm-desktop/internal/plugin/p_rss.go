package plugin

import (
	"strings"
	"time"
)

func init() { Register("rss", newRSS) }

// rss：生成 feed.xml（RSS 2.0），取最近 N 篇带日期的文章。
func newRSS(h Host) *Instance {
	limit := 20
	// 兼容两种写法：site.rss.limit（Node 版）与顶层 rss.limit（清单 config 合并到这里）
	if siteCfg := h.SiteConfig(); siteCfg != nil {
		if rss := AsMap(siteCfg["rss"]); rss != nil {
			limit = IntVal(rss, "limit", limit)
		}
	}
	if rss := h.Section("rss"); rss != nil {
		limit = IntVal(rss, "limit", limit)
	}

	return &Instance{
		Name: "rss",
		AfterBuild: func(h Host) []ExtraFile {
			cfg := h.SiteConfig()
			if cfg == nil {
				cfg = map[string]any{}
			}
			root := strings.TrimSuffix(AbsoluteURL(cfg, "/"), "/")
			if root == "" {
				root = "/"
			}

			var posts []*Doc
			for _, p := range h.Documents() {
				if p.Date == "" || !p.InStream || Str(p.Data, "type") == "page" {
					continue
				}
				if v, ok := p.Data["rss"].(bool); ok && !v {
					continue
				}
				if p.URL == "/" {
					continue
				}
				posts = append(posts, p)
				if len(posts) >= limit {
					break
				}
			}

			items := make([]string, 0, len(posts))
			for _, p := range posts {
				link := AbsoluteURL(cfg, p.URL)
				var b strings.Builder
				b.WriteString("    <item>\n")
				b.WriteString("      <title>" + escXML(p.Title) + "</title>\n")
				b.WriteString("      <link>" + escXML(link) + "</link>\n")
				b.WriteString("      <guid isPermaLink=\"true\">" + escXML(link) + "</guid>\n")
				if p.Date != "" {
					b.WriteString("      <pubDate>" + rssDate(p.Date) + "</pubDate>\n")
				}
				desc := p.Description
				if desc == "" {
					desc = p.Excerpt
				}
				b.WriteString("      <description>" + escXML(desc) + "</description>\n")
				if len(p.Tags) > 0 {
					for _, t := range p.Tags {
						b.WriteString("      <category>" + escXML(t) + "</category>\n")
					}
				}
				b.WriteString("      <content:encoded><![CDATA[" + p.HTML + "]]></content:encoded>\n")
				b.WriteString("    </item>")
				items = append(items, b.String())
			}

			now := time.Now().UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT")
			xml := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
				"<rss version=\"2.0\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\" xmlns:atom=\"http://www.w3.org/2005/Atom\">\n" +
				"  <channel>\n" +
				"    <title>" + escXML(Str(cfg, "title")) + "</title>\n" +
				"    <link>" + escXML(root) + "</link>\n" +
				"    <description>" + escXML(Str(cfg, "description")) + "</description>\n" +
				"    <language>" + escXML(defaultStr(Str(cfg, "lang"), "zh-CN")) + "</language>\n" +
				"    <lastBuildDate>" + now + "</lastBuildDate>\n" +
				"    <atom:link href=\"" + escXML(AbsoluteURL(cfg, "/feed.xml")) + "\" rel=\"self\" type=\"application/rss+xml\"/>\n" +
				strings.Join(items, "\n") + "\n" +
				"  </channel>\n" +
				"</rss>\n"

			return []ExtraFile{{Path: "feed.xml", Contents: []byte(xml)}}
		},
	}
}

func rssDate(day string) string {
	if t, err := time.Parse("2006-01-02", day); err == nil {
		return t.UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT")
	}
	return day
}

func defaultStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
