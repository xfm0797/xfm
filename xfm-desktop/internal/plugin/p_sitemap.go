package plugin

import (
	"fmt"
	"strings"
)

func init() { Register("sitemap", newSitemap) }

// sitemap：生成 sitemap.xml 与 robots.txt。
func newSitemap(h Host) *Instance {
	return &Instance{
		Name: "sitemap",
		AfterBuild: func(h Host) []ExtraFile {
			cfg := h.SiteConfig()
			var urls []string
			for _, p := range h.Documents() {
				if v, ok := p.Data["sitemap"].(bool); ok && !v {
					continue
				}
				loc := AbsoluteURL(cfg, p.URL)
				var b strings.Builder
				b.WriteString("  <url>\n")
				b.WriteString("    <loc>" + escXML(loc) + "</loc>\n")
				lastmod := p.Updated
				if lastmod == "" {
					lastmod = p.Date
				}
				if lastmod != "" {
					b.WriteString("    <lastmod>" + escXML(lastmod) + "</lastmod>\n")
				}
				if p.Weight != 0 {
					pr := 1 - float64(p.Weight)/100
					if pr > 1 {
						pr = 1
					}
					if pr < 0.1 {
						pr = 0.1
					}
					b.WriteString(fmt.Sprintf("    <priority>%.1f</priority>\n", pr))
				}
				b.WriteString("  </url>")
				urls = append(urls, b.String())
			}

			sitemapLoc := AbsoluteURL(cfg, "/sitemap.xml")
			robots := "User-agent: *\nAllow: /\n"
			if Str(cfg, "url") != "" {
				robots += "Sitemap: " + sitemapLoc + "\n"
			}
			return []ExtraFile{
				{
					Path: "sitemap.xml",
					Contents: []byte("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
						"<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" +
						strings.Join(urls, "\n") + "\n</urlset>\n"),
				},
				{Path: "robots.txt", Contents: []byte(robots)},
			}
		},
	}
}
