package plugin

import (
	"encoding/json"
	"regexp"
	"strings"
)

func init() { Register("seo", newSEO) }

var (
	reCanonical = regexp.MustCompile(`(?i)rel=["']canonical["']`)
	reOGTitle   = regexp.MustCompile(`(?i)property=["']og:title["']`)
	reHreflang  = regexp.MustCompile(`(?i)hreflang=`)
	reHeadClose = regexp.MustCompile(`(?i)</head>`)
	reHTTPURL   = regexp.MustCompile(`(?i)^https?://`)
)

// seo：补 canonical / Open Graph / Twitter Card / JSON-LD。
func newSEO(h Host) *Instance {
	cfg := h.Section("seo")
	siteConf := h.SiteConfig()
	siteName := Str(siteConf, "title")
	lang := defaultStr(Str(siteConf, "lang"), "zh-CN")
	jsonLd := BoolVal(cfg, "jsonLd", true)
	twitter := Str(cfg, "twitter")

	return &Instance{
		Name: "seo",
		TransformHTML: func(html string, page *Doc) string {
			if page == nil || html == "" {
				return html
			}
			if v, ok := page.Data["seo"].(bool); ok && !v {
				return html
			}
			if !reHeadClose.MatchString(html) {
				return html
			}

			pageLang := defaultStr(page.Lang, lang)
			translations := docTranslations(page.Translations)
			isMulti := len(AnyList(siteConf["languages"])) > 1

			isPost := page.Date != "" && page.URL != "/" && Str(page.Data, "type") != "page"
			canonical := ""
			if c := Str(page.Data, "canonical"); c != "" {
				canonical = c
			} else {
				canonical = AbsoluteURL(siteConf, page.URL)
			}

			title := defaultStr(page.Title, siteName)
			desc := Str(page.Data, "description")
			if desc == "" {
				desc = page.Description
			}
			if desc == "" {
				desc = truncateRunes(collapseSpace(page.Excerpt), 160)
			}
			if desc == "" {
				desc = Str(siteConf, "description")
			}

			image := ""
			rawImage := Str(page.Data, "image")
			if rawImage == "" {
				rawImage = Str(cfg, "image")
			}
			if rawImage != "" {
				if reHTTPURL.MatchString(rawImage) {
					image = rawImage
				} else {
					image = AbsoluteURL(siteConf, rawImage)
				}
			}

			var out []string
			if !reCanonical.MatchString(html) {
				out = append(out, `<link rel="canonical" href="`+EscHTML(canonical)+`">`)
			}
			if isMulti && len(translations) > 0 && !reHreflang.MatchString(html) {
				for _, t := range translations {
					out = append(out, `<link rel="alternate" hreflang="`+EscHTML(t.lang)+`" href="`+EscHTML(AbsoluteURL(siteConf, t.url))+`">`)
				}
				xDefault := translations[0]
				for _, t := range translations {
					if t.lang == Str(siteConf, "lang") {
						xDefault = t
						break
					}
				}
				out = append(out, `<link rel="alternate" hreflang="x-default" href="`+EscHTML(AbsoluteURL(siteConf, xDefault.url))+`">`)
			}
			if v, ok := page.Data["noindex"].(bool); ok && v {
				out = append(out, `<meta name="robots" content="noindex, follow">`)
			}

			if !reOGTitle.MatchString(html) {
				ogType := "website"
				if isPost {
					ogType = "article"
				}
				og := []string{
					`<meta property="og:type" content="` + ogType + `">`,
					`<meta property="og:title" content="` + EscHTML(title) + `">`,
				}
				if desc != "" {
					og = append(og, `<meta property="og:description" content="`+EscHTML(desc)+`">`)
				}
				og = append(og, `<meta property="og:url" content="`+EscHTML(canonical)+`">`)
				if siteName != "" {
					og = append(og, `<meta property="og:site_name" content="`+EscHTML(siteName)+`">`)
				}
				og = append(og, `<meta property="og:locale" content="`+EscHTML(ogLocale(pageLang))+`">`)
				if image != "" {
					og = append(og, `<meta property="og:image" content="`+EscHTML(image)+`">`)
				}
				if isPost {
					if v := IsoDateTime(page.Date); v != "" {
						og = append(og, `<meta property="article:published_time" content="`+EscHTML(v)+`">`)
					}
					mod := page.Updated
					if mod == "" {
						mod = page.Date
					}
					if v := IsoDateTime(mod); v != "" {
						og = append(og, `<meta property="article:modified_time" content="`+EscHTML(v)+`">`)
					}
					for _, t := range page.Tags {
						og = append(og, `<meta property="article:tag" content="`+EscHTML(t)+`">`)
					}
				}
				out = append(out, og...)
				if isMulti {
					for _, t := range translations {
						if t.lang != pageLang {
							out = append(out, `<meta property="og:locale:alternate" content="`+EscHTML(ogLocale(t.lang))+`">`)
						}
					}
				}
				card := "summary"
				if image != "" {
					card = "summary_large_image"
				}
				out = append(out, `<meta name="twitter:card" content="`+card+`">`)
				out = append(out, `<meta name="twitter:title" content="`+EscHTML(title)+`">`)
				if desc != "" {
					out = append(out, `<meta name="twitter:description" content="`+EscHTML(desc)+`">`)
				}
				if image != "" {
					out = append(out, `<meta name="twitter:image" content="`+EscHTML(image)+`">`)
				}
				if twitter != "" {
					out = append(out, `<meta name="twitter:site" content="`+EscHTML(twitter)+`">`)
				}
			}

			if jsonLd {
				ld := map[string]any{"@context": "https://schema.org"}
				if isPost {
					ld["@type"] = "Article"
					ld["headline"] = title
					if desc != "" {
						ld["description"] = desc
					}
					if image != "" {
						ld["image"] = []string{image}
					}
					if v := IsoDateTime(page.Date); v != "" {
						ld["datePublished"] = v
					}
					mod := page.Updated
					if mod == "" {
						mod = page.Date
					}
					if v := IsoDateTime(mod); v != "" {
						ld["dateModified"] = v
					}
					if a := Str(siteConf, "author"); a != "" {
						ld["author"] = map[string]any{"@type": "Person", "name": a}
					}
					if siteName != "" {
						ld["publisher"] = map[string]any{"@type": "Organization", "name": siteName}
					}
					ld["mainEntityOfPage"] = map[string]any{"@type": "WebPage", "@id": canonical}
					if len(page.Tags) > 0 {
						ld["keywords"] = strings.Join(page.Tags, ", ")
					}
				} else {
					ld["@type"] = "WebSite"
					ld["name"] = siteName
					ld["url"] = canonical
					if desc != "" {
						ld["description"] = desc
					}
					ld["inLanguage"] = lang
					if search := AsMap(h.SiteContext()["search"]); search != nil {
						if u := Str(search, "url"); u != "" {
							origin := strings.TrimRight(Str(siteConf, "url"), "/")
							ld["potentialAction"] = map[string]any{
								"@type":       "SearchAction",
								"target":      origin + u + "?q={search_term_string}",
								"query-input": "required name=search_term_string",
							}
						}
					}
				}
				b, _ := json.Marshal(ld)
				out = append(out, `<script type="application/ld+json">`+strings.ReplaceAll(string(b), "<", `\u003c`)+`</script>`)
			}

			block := strings.Join(out, "\n")
			if block == "" {
				return html
			}
			if loc := reHeadClose.FindStringIndex(html); loc != nil {
				return html[:loc[0]] + block + "\n" + html[loc[0]:]
			}
			return html
		},
	}
}

type altLang struct {
	lang string
	url  string
}

func docTranslations(v any) []altLang {
	var out []altLang
	for _, it := range AnyList(v) {
		m := AsMap(it)
		if m == nil {
			continue
		}
		out = append(out, altLang{lang: Str(m, "lang"), url: Str(m, "url")})
	}
	return out
}

// ogLocale：zh-CN → zh_CN（只替换第一个连字符，与 JS replace 一致）。
func ogLocale(lang string) string {
	return strings.Replace(defaultStr(lang, "zh-CN"), "-", "_", 1)
}
