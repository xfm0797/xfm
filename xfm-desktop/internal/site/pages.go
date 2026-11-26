package site

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (s *Site) resolveCollections() {
	conf := s.Cfg.Section("collections")
	s.Collections = map[string]any{}
	s.collectionDefs = map[string]map[string]any{}
	s.collectionPostsEnabled = map[string]bool{}

	pag := s.Cfg.Section("pagination")
	sitePerPage := 9
	if n, ok := toInt(pag["perPage"]); ok {
		sitePerPage = n
	}
	if pag["enabled"] == false {
		sitePerPage = 0
	}

	for name, raw := range conf {
		def, _ := raw.(map[string]any)
		if def == nil {
			def = map[string]any{}
		}
		dir := toString(def["dir"])
		if dir == "" {
			dir = name
		}
		url := toString(def["url"])
		if url == "" {
			url = "/" + name + "/"
		}
		layout := toString(def["layout"])
		if layout == "" {
			layout = "collection.html"
		}
		perPage := sitePerPage
		if n, ok := toInt(def["perPage"]); ok {
			perPage = n
		}
		title := toString(def["title"])
		if title == "" {
			title = name
		}
		postsEnabled, _ := def["posts"].(bool)
		s.collectionPostsEnabled[name] = postsEnabled
		s.collectionDefs[name] = map[string]any{"dir": dir, "url": NormalizePath(url), "layout": layout, "perPage": perPage, "title": title, "description": toString(def["description"])}

		var entries []*Page
		prefix := strings.Trim(dir, "/") + "/"
		for _, p := range s.ContentPages {
			if strings.HasPrefix(p.Rel, prefix) {
				p.Data["collection"] = name
				entries = append(entries, p)
			}
		}
		sortPagesByDate(entries)
		items := make([]any, 0, len(entries))
		for _, p := range entries {
			items = append(items, s.serializePage(p))
		}
		s.Collections[name] = map[string]any{
			"name": name, "title": title, "description": toString(def["description"]),
			"url": NormalizePath(url), "count": int64(len(entries)), "posts": items,
		}
	}
}

func (s *Site) taxonomyPages() []*Page {
	lang := toString(s.Cfg.Section("site")["lang"])
	zh := isZh(lang)
	labels := map[string]string{"tags": "标签", "categories": "分类", "series": "系列"}
	if !zh {
		labels = map[string]string{"tags": "Tag", "categories": "Category", "series": "Series"}
	}
	groups := []struct {
		kind string
		list []*term
	}{
		{"tags", s.Tags}, {"categories", s.Categories}, {"series", s.Series},
	}
	pag := s.Cfg.Section("pagination")
	paginate := pag["enabled"] != false && pag["taxonomy"] != false
	perPage := 9
	if n, ok := toInt(pag["perPage"]); ok && n > 0 {
		perPage = n
	}

	var out []*Page
	for _, g := range groups {
		for _, item := range g.list {
			posts := make([]map[string]any, 0, len(item.Items))
			for _, it := range item.Items {
				posts = append(posts, map[string]any{
					"url": it["url"], "title": it["title"], "description": it["description"],
					"desc": it["desc"], "date": it["date"], "excerpt": it["excerpt"],
				})
			}
			sort.SliceStable(posts, func(i, j int) bool {
				return toString(posts[i]["date"]) > toString(posts[j]["date"])
			})
			totalPages := 1
			if paginate {
				totalPages = (len(posts) + perPage - 1) / perPage
				if totalPages < 1 {
					totalPages = 1
				}
			}
			base := item.URL
			if !strings.HasSuffix(base, "/") {
				base += "/"
			}
			pageURL := func(n int) string {
				if n == 1 {
					return base
				}
				return NormalizePath(base + "page/" + itoa(n) + "/")
			}
			for i := 1; i <= totalPages; i++ {
				var chunk []map[string]any
				if paginate {
					start := (i - 1) * perPage
					end := start + perPage
					if end > len(posts) {
						end = len(posts)
					}
					chunk = posts[start:end]
				} else {
					chunk = posts
				}
				title := item.Name
				if i > 1 {
					title = item.Name + " · 第 " + itoa(i) + " 页"
				}
				var pagination any
				if paginate {
					pagination = map[string]any{
						"current": int64(i), "totalPages": int64(totalPages), "perPage": int64(perPage),
						"total": int64(len(posts)), "url": pageURL(i),
						"prev": prevURL(i, pageURL), "next": nextURL(i, totalPages, pageURL),
						"links": pagerLinks(i, totalPages, pageURL),
						"posts": toAnyMaps(chunk),
					}
				}
				out = append(out, &Page{
					Key: "taxonomy:" + g.kind + ":" + item.Name, URL: pageURL(i),
					Layout: "taxonomy.html", Title: title,
					Description: labels[g.kind] + " · 共 " + itoa(len(posts)) + " 篇",
					Data: map[string]any{
						"type": "taxonomy", "taxonomy": g.kind, "term": item.Name,
						"posts": toAnyMaps(chunk), "pagination": pagination,
					},
					Taxonomy: true, Ext: ".html",
				})
			}
		}
	}
	return out
}

func (s *Site) indexPages() []*Page {
	lang := toString(s.Cfg.Section("site")["lang"])
	zh := isZh(lang)
	idxConf := s.Cfg.Section("indexes")
	var out []*Page

	// 分类
	if def, _ := idxConf["categories"].(map[string]any); def == nil || def["enabled"] != false {
		layout := "categories.html"
		if def != nil {
			if l := toString(def["layout"]); l != "" {
				layout = l
			}
		}
		if s.hasTemplate(layout) {
			var termMaps []map[string]any
			for _, c := range s.Categories {
				if c.Count <= 0 {
					continue
				}
				var latest any
				if len(c.Items) > 0 {
					latest = map[string]any{"url": c.Items[0]["url"], "title": c.Items[0]["title"], "date": c.Items[0]["date"]}
				}
				termMaps = append(termMaps, map[string]any{"name": c.Name, "url": c.URL, "count": int64(c.Count), "latest": latest})
			}
			sort.SliceStable(termMaps, func(i, j int) bool {
				ci, _ := toInt(termMaps[i]["count"])
				cj, _ := toInt(termMaps[j]["count"])
				if ci != cj {
					return ci > cj
				}
				return strings.ToLower(toString(termMaps[i]["name"])) < strings.ToLower(toString(termMaps[j]["name"]))
			})
			terms := make([]any, len(termMaps))
			for i, m := range termMaps {
				terms[i] = m
			}
			url := "/categories/"
			title := "分类"
			desc := "按主题浏览全部文章"
			if !zh {
				title = "Categories"
				desc = "Browse all posts by topic"
			}
			if def != nil {
				if u := toString(def["url"]); u != "" {
					url = u
				}
			}
			out = append(out, &Page{
				Key: "index:categories", URL: NormalizePath(url), Layout: layout, Title: title,
				Description: desc,
				Data:        map[string]any{"type": "index", "index": "categories", "terms": terms, "total": int64(len(terms))},
				Taxonomy:    true, Ext: ".html",
			})
		}
	}

	// 归档
	if def, _ := idxConf["archives"].(map[string]any); def == nil || def["enabled"] != false {
		layout := "archives.html"
		if def != nil {
			if l := toString(def["layout"]); l != "" {
				layout = l
			}
		}
		if s.hasTemplate(layout) {
			postsAny, _ := s.SiteContext["posts"].([]any)
			type yb struct {
				year  string
				posts []any
			}
			var order []string
			byYear := map[string][]any{}
			for _, pa := range postsAny {
				pm, _ := pa.(map[string]any)
				date := toString(pm["date"])
				year := "—"
				if len(date) >= 4 {
					year = date[:4]
				}
				if _, ok := byYear[year]; !ok {
					order = append(order, year)
				}
				byYear[year] = append(byYear[year], map[string]any{"url": pm["url"], "title": pm["title"], "date": date, "tags": pm["tags"]})
			}
			var years []any
			for _, y := range order {
				years = append(years, map[string]any{"year": y, "posts": byYear[y]})
			}
			url := "/archives/"
			if def != nil {
				if u := toString(def["url"]); u != "" {
					url = u
				}
			}
			title := "归档"
			desc := "按时间线浏览全部文章"
			if !zh {
				title = "Archives"
				desc = "Browse all posts by date"
			}
			out = append(out, &Page{
				Key: "index:archives", URL: NormalizePath(url), Layout: layout, Title: title,
				Description: desc,
				Data:        map[string]any{"type": "index", "index": "archives", "years": years, "total": int64(len(postsAny))},
				Taxonomy:    true, Ext: ".html",
			})
		}
	}
	return out
}

func (s *Site) paginationPages() []*Page {
	pag := s.Cfg.Section("pagination")
	if pag["enabled"] == false {
		return nil
	}
	perPage := 9
	if n, ok := toInt(pag["perPage"]); ok && n > 0 {
		perPage = n
	}
	postsAny, _ := s.SiteContext["posts"].([]any)
	if len(postsAny) == 0 {
		return nil
	}
	var home *Page
	for _, p := range s.ContentPages {
		if p.URL == "/" {
			home = p
			break
		}
	}
	if home == nil || !s.layoutUsesPosts(home.Layout) {
		return nil
	}
	totalPages := (len(postsAny) + perPage - 1) / perPage
	if totalPages < 1 {
		totalPages = 1
	}
	prefix := "/page/"
	if u := toString(pag["url"]); u != "" {
		prefix = u
	}
	prefix = NormalizePath(prefix)
	pageURL := func(n int) string {
		if n == 1 {
			return "/"
		}
		return NormalizePath(prefix + itoa(n) + "/")
	}
	homeData := map[string]any{
		"current": int64(1), "totalPages": int64(totalPages), "perPage": int64(perPage),
		"total": int64(len(postsAny)), "url": "/",
		"prev": nil, "next": nextURL(1, totalPages, pageURL),
		"links": pagerLinks(1, totalPages, pageURL),
		"posts": sliceAny(postsAny, 0, perPage),
	}
	home.Data["pagination"] = homeData
	home.Listing = true

	if totalPages <= 1 {
		return nil
	}
	lang := toString(s.Cfg.Section("site")["lang"])
	zh := isZh(lang)
	var out []*Page
	for i := 2; i <= totalPages; i++ {
		chunk := sliceAny(postsAny, (i-1)*perPage, i*perPage)
		url := NormalizePath(prefix + itoa(i) + "/")
		title := home.Title
		if zh {
			title += " · 第 " + itoa(i) + " 页"
		} else {
			title += " · Page " + itoa(i)
		}
		out = append(out, &Page{
			Key: "pagination:" + itoa(i), URL: url, Layout: home.Layout, Title: title,
			Description: home.Description, Taxonomy: true, Ext: ".html",
			Data: map[string]any{
				"type": "pagination",
				"pagination": map[string]any{
					"current": int64(i), "totalPages": int64(totalPages), "perPage": int64(perPage),
					"total": int64(len(postsAny)), "url": url,
					"prev": prevURL(i, pageURL), "next": nextURL(i, totalPages, pageURL),
					"links": pagerLinks(i, totalPages, pageURL),
					"posts": chunk,
				},
			},
		})
	}
	return out
}

func (s *Site) collectionPages() []*Page {
	var out []*Page
	for name, def := range s.collectionDefs {
		layout := toString(def["layout"])
		perPage, _ := toInt(def["perPage"])
		url := toString(def["url"])
		if !strings.HasSuffix(url, "/") {
			url += "/"
		}
		var entries []*Page
		for _, p := range s.ContentPages {
			if toString(p.Data["collection"]) == name {
				entries = append(entries, p)
			}
		}
		sortPagesByDate(entries)
		items := make([]any, 0, len(entries))
		for _, p := range entries {
			items = append(items, map[string]any{
				"url": p.URL, "title": p.Title, "desc": p.Excerpt,
				"date": FormatDay(p.Date), "description": p.Description, "excerpt": p.Excerpt,
			})
		}
		totalPages := 1
		if perPage > 0 {
			totalPages = (len(items) + perPage - 1) / perPage
			if totalPages < 1 {
				totalPages = 1
			}
		}
		pageURL := func(n int) string {
			if n == 1 {
				return NormalizePath(url)
			}
			return NormalizePath(url + "page/" + itoa(n) + "/")
		}
		for i := 1; i <= totalPages; i++ {
			var chunk []any
			if perPage > 0 {
				chunk = sliceAny(items, (i-1)*perPage, i*perPage)
			} else {
				chunk = items
			}
			var pagination any
			if perPage > 0 && totalPages > 1 {
				pagination = map[string]any{
					"current": int64(i), "totalPages": int64(totalPages), "perPage": int64(perPage),
					"total": int64(len(items)), "url": pageURL(i),
					"prev": prevURL(i, pageURL), "next": nextURL(i, totalPages, pageURL),
					"links": pagerLinks(i, totalPages, pageURL),
					"posts": chunk,
				}
			}
			title := toString(def["title"])
			out = append(out, &Page{
				Key: "collection:" + name + ":" + itoa(i), URL: pageURL(i), Layout: layout, Title: title,
				Description: toString(def["description"]), Taxonomy: true, Ext: ".html",
				Data: map[string]any{
					"type": "collection", "collection": name, "posts": chunk, "pagination": pagination,
				},
			})
		}
	}
	return out
}

// ---------- 辅助 ----------

func (s *Site) hasTemplate(name string) bool {
	for _, sub := range []string{"layouts", "partials", ""} {
		p := filepath.Join(s.ThemeDir, sub, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return true
		}
	}
	return false
}

func (s *Site) layoutUsesPosts(layout string) bool {
	p := filepath.Join(s.ThemeDir, "layouts", layout)
	data, err := os.ReadFile(p)
	if err != nil {
		return true
	}
	return strings.Contains(string(data), "posts")
}

func sortPagesByDate(pages []*Page) {
	sort.SliceStable(pages, func(i, j int) bool {
		var di, dj int64
		if pages[i].Date != nil {
			di = pages[i].Date.Unix()
		}
		if pages[j].Date != nil {
			dj = pages[j].Date.Unix()
		}
		return di > dj
	})
}

func pagerLinks(current, totalPages int, urlFor func(int) string) []any {
	var out []any
	last := 0
	for n := 1; n <= totalPages; n++ {
		near := n == 1 || n == totalPages || abs(n-current) <= 1
		if !near {
			continue
		}
		if last != 0 && n-last > 1 {
			out = append(out, map[string]any{"gap": true})
		}
		out = append(out, map[string]any{"n": int64(n), "url": urlFor(n), "current": n == current})
		last = n
	}
	return out
}

func prevURL(i int, pageURL func(int) string) any {
	if i == 1 {
		return nil
	}
	return pageURL(i - 1)
}

func nextURL(i, total int, pageURL func(int) string) any {
	if i < total {
		return pageURL(i + 1)
	}
	return nil
}

func sliceAny(list []any, start, end int) []any {
	if start < 0 {
		start = 0
	}
	if end > len(list) {
		end = len(list)
	}
	if start > end {
		start = end
	}
	return list[start:end]
}

func toAnyMaps(list []map[string]any) []any {
	out := make([]any, len(list))
	for i, m := range list {
		out[i] = m
	}
	return out
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
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
