package site

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"xfmdesk/internal/frontmatter"
	"xfmdesk/internal/markdown"
	"xfmdesk/internal/tmpl"
)

// Site 是一次构建的上下文。
type Site struct {
	Cfg    *Config
	Root   string
	Mode   string
	Engine *tmpl.Engine

	ContentPages []*Page
	AllPages     []*Page

	ThemeDir       string
	SiteContext    map[string]any
	Tags           []*term // site context 用：multiLang 时 count 只算默认语言
	Categories     []*term
	Series         []*term
	AllTags        []*term // taxonomy 页用：全量，count=所有语言，items=所有语言
	AllCategories  []*term
	AllSeries      []*term
	Collections    map[string]any
	Languages      []string
	DefaultLang    string
	MultiLang      bool
	ScheduledCount int

	contentAssets []assetCopy
	Stats         Stats

	linkResolver           func(href string, page *Page) string
	collectionPostsEnabled map[string]bool
	collectionDefs         map[string]map[string]any
}

type term struct {
	Name  string
	URL   string
	Count int
	Items []map[string]any
	Posts []*Page
}

type assetCopy struct {
	Src  string
	Dest string
}

// Stats 汇总构建统计。
type Stats struct {
	Pages     int
	Assets    int
	Written   int
	Scheduled int
}

// BuildSite 构建站点并写盘。
func BuildSite(root, mode string) (*Site, error) {
	cfg, err := LoadConfig(root)
	if err != nil {
		return nil, err
	}
	s := &Site{Cfg: cfg, Root: root, Mode: mode}
	if s.Mode == "" {
		s.Mode = "production"
	}
	if err := s.init(); err != nil {
		return nil, err
	}
	if err := s.collect(); err != nil {
		return nil, err
	}
	if err := s.renderAll(); err != nil {
		return nil, err
	}
	if err := s.writeOutput(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Site) init() error {
	themeName := s.Cfg.Str("theme")
	dir, err := ensureThemeDir(s.Root, themeName)
	if err != nil {
		return err
	}
	s.ThemeDir = dir
	s.Engine = tmpl.NewEngine(dir)
	return nil
}

func (s *Site) walkContent() (files, assets []string, err error) {
	contentDir := filepath.Join(s.Root, s.Cfg.Str("contentDir"))
	err = filepath.Walk(contentDir, func(p string, info os.FileInfo, e error) error {
		if e != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}
		rel, _ := filepath.Rel(contentDir, p)
		ext := strings.ToLower(filepath.Ext(p))
		switch ext {
		case ".md", ".markdown", ".html", ".htm":
			files = append(files, p)
		default:
			assets = append(assets, p)
			s.contentAssets = append(s.contentAssets, assetCopy{Src: p, Dest: filepath.ToSlash(rel)})
		}
		return nil
	})
	return files, assets, err
}

func (s *Site) collect() error {
	siteCfg := s.Cfg.Section("site")
	defaultLang := toString(siteCfg["lang"])
	if defaultLang == "" {
		defaultLang = "zh-CN"
	}
	if langs, ok := siteCfg["languages"].([]any); ok && len(langs) > 0 {
		s.Languages = nil
		for _, l := range langs {
			s.Languages = append(s.Languages, toString(l))
		}
	} else {
		s.Languages = []string{defaultLang}
	}
	s.DefaultLang = s.Languages[0]
	s.MultiLang = len(s.Languages) > 1

	contentDir := filepath.Join(s.Root, s.Cfg.Str("contentDir"))
	files, _, err := s.walkContent()
	if err != nil {
		return err
	}

	siteData := s.loadData()
	defaults := s.Cfg.Section("defaults")
	var pages []*Page
	for _, abs := range files {
		rel, _ := filepath.Rel(contentDir, abs)
		rel = filepath.ToSlash(rel)
		rawBytes, err := os.ReadFile(abs)
		if err != nil {
			continue
		}
		raw := string(rawBytes)
		fm := frontmatter.Parse(raw)
		data := fm.Data

		pubDate := FormatDate(data["date"])
		if pubDate == nil {
			pubDate = FormatDate(data["published"])
		}
		isDraft, _ := data["draft"].(bool)
		isScheduled := pubDate != nil && pubDate.After(nowFunc())
		if s.Mode == "production" {
			if isDraft && !s.Cfg.Bool("buildDrafts", false) {
				continue
			}
			if isScheduled && !s.Cfg.Bool("buildScheduled", false) {
				s.ScheduledCount++
				continue
			}
		}

		ext := strings.ToLower(filepath.Ext(rel))
		isMD := ext == ".md" || ext == ".markdown"

		url := ""
		if v := toString(data["url"]); v != "" {
			url = NormalizePath(v)
		} else if v := toString(data["permalink"]); v != "" {
			url = NormalizePath(v)
		} else if v := toString(data["slug"]); v != "" {
			url = NormalizePath(v)
		} else {
			url = DeriveRoute(rel)
		}
		url = NormalizePath(url)
		if url != "/" && !strings.HasSuffix(url, "/") && filepath.Ext(url) == "" {
			url += "/"
		}

		tags := parseTags(data["tags"])
		desc := toString(data["description"])
		if desc == "" {
			desc = toString(data["summary"])
		}
		excerpt, readTime := summarize(fm.Content, isMD, desc)

		layout := toString(data["layout"])
		if layout == "" {
			if toString(data["title"]) != "" {
				layout = toString(defaults["layout"])
			} else {
				layout = "page.html"
			}
		}
		title := toString(data["title"])
		if title == "" {
			title = regExt.ReplaceAllString(rel, "")
		}
		lang := toString(data["lang"])
		if lang == "" {
			lang = defaultLang
		}
		weight := 0
		if n, ok := toInt(data["weight"]); ok {
			weight = n
		} else if n, ok := toInt(data["order"]); ok {
			weight = n
		}
		toc, tocSet := data["toc"].(bool)
		if !tocSet {
			toc = true
		}

		pages = append(pages, &Page{
			Key:         rel,
			File:        abs,
			Rel:         rel,
			URL:         url,
			Layout:      layout,
			Title:       title,
			Description: desc,
			Date:        pubDate,
			Updated:     FormatDate(data["updated"]),
			Tags:        tags,
			Category:    toString(data["category"]),
			Series:      toString(data["series"]),
			Lang:        lang,
			Weight:      weight,
			Draft:       isDraft,
			Toc:         toc,
			Data:        data,
			Body:        fm.Content,
			Excerpt:     excerpt,
			ReadTime:    readTime,
			IsMD:        isMD,
			Ext:         ext,
			Raw:         raw,
		})
	}

	sort.SliceStable(pages, func(i, j int) bool {
		a, b := pages[i], pages[j]
		if a.URL == "/" && b.URL != "/" {
			return true
		}
		if b.URL == "/" && a.URL != "/" {
			return false
		}
		if a.Weight != b.Weight {
			return a.Weight < b.Weight
		}
		var da, db int64
		if a.Date != nil {
			da = a.Date.Unix()
		}
		if b.Date != nil {
			db = b.Date.Unix()
		}
		if da != db {
			return db < da
		}
		return a.URL < b.URL
	})
	s.ContentPages = pages

	// 相对链接索引
	index := map[string]string{}
	for _, p := range pages {
		index[p.Rel] = p.URL
	}
	resolver := newLinkResolver(index)
	s.linkResolver = resolver

	// 翻译分组：相同 translationKey 的页面互为翻译
	s.groupTranslations(pages)

	s.resolveCollections()
	s.linkNeighbors()
	s.aggregate()
	s.buildSiteContext(siteData)

	// 生成页
	all := append([]*Page{}, pages...)
	all = append(all, s.taxonomyPages()...)
	all = append(all, s.indexPages()...)
	all = append(all, s.paginationPages()...)
	all = append(all, s.collectionPages()...)
	all = append(all, s.langIndexPages()...)
	s.AllPages = all
	return nil
}

var regExt = regexp.MustCompile(`\.\w+$`)

func parseTags(v any) []string {
	switch x := v.(type) {
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			out = append(out, toString(e))
		}
		return out
	case string:
		if x == "" {
			return nil
		}
		parts := strings.Split(x, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			out = append(out, strings.TrimSpace(p))
		}
		return out
	}
	return nil
}

func (s *Site) loadData() map[string]any {
	out := map[string]any{}
	dir := filepath.Join(s.Root, s.Cfg.Str("dataDir"))
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var v any
		if json.Unmarshal(data, &v) == nil {
			out[strings.TrimSuffix(e.Name(), ext)] = v
		}
	}
	return out
}

func (s *Site) aggregate() {
	tagMap := map[string]*term{}
	catMap := map[string]*term{}
	serMap := map[string]*term{}
	order := map[string][]string{"tags": {}, "categories": {}, "series": {}}
	get := func(m map[string]*term, prefix, name string) *term {
		t, ok := m[name]
		if !ok {
			t = &term{Name: name, URL: "/" + prefix + "/" + encodeURIComponent(name) + "/"}
			m[name] = t
			order[prefix] = append(order[prefix], name)
		}
		return t
	}
	for _, p := range s.ContentPages {
		if p.URL == "/" {
			continue
		}
		for _, tag := range p.Tags {
			if tag == "" {
				continue
			}
			t := get(tagMap, "tags", tag)
			t.Posts = append(t.Posts, p)
		}
		if p.Category != "" {
			t := get(catMap, "categories", p.Category)
			t.Posts = append(t.Posts, p)
		}
		if p.Series != "" {
			t := get(serMap, "series", p.Series)
			t.Posts = append(t.Posts, p)
		}
	}
	// 全量词条：count=所有语言, items=所有语言 — 供 taxonomy 页面使用
	buildAll := func(m map[string]*term, names []string) []*term {
		var list []*term
		for _, name := range names {
			t := m[name]
			t.Count = len(t.Posts)
			for _, p := range t.Posts {
				t.Items = append(t.Items, s.serializePage(p))
			}
			list = append(list, t)
		}
		return list
	}
	s.AllTags = buildAll(tagMap, order["tags"])
	s.AllCategories = buildAll(catMap, order["categories"])
	s.AllSeries = buildAll(serMap, order["series"])

	// site context 用：multiLang 时 count 只算默认语言，count=0 过滤
	filterCount := func(t *term) int {
		if !s.MultiLang {
			return len(t.Posts)
		}
		n := 0
		for _, p := range t.Posts {
			if p.Lang == s.DefaultLang {
				n++
			}
		}
		return n
	}
	s.Tags = nil
	for _, t := range s.AllTags {
		c := filterCount(t)
		if c > 0 {
			s.Tags = append(s.Tags, &term{Name: t.Name, URL: t.URL, Count: c, Items: t.Items, Posts: t.Posts})
		}
	}
	sort.SliceStable(s.Tags, func(i, j int) bool {
		if s.Tags[i].Count != s.Tags[j].Count {
			return s.Tags[i].Count > s.Tags[j].Count
		}
		return strings.ToLower(s.Tags[i].Name) < strings.ToLower(s.Tags[j].Name)
	})

	s.Categories = nil
	for _, t := range s.AllCategories {
		c := filterCount(t)
		if c > 0 {
			s.Categories = append(s.Categories, &term{Name: t.Name, URL: t.URL, Count: c, Items: t.Items, Posts: t.Posts})
		}
	}

	s.Series = nil
	for _, t := range s.AllSeries {
		c := filterCount(t)
		if c > 0 {
			s.Series = append(s.Series, &term{Name: t.Name, URL: t.URL, Count: c, Items: t.Items, Posts: t.Posts})
		}
	}
}

func (s *Site) buildSiteContext(siteData map[string]any) {
	ctx := map[string]any{}
	for k, v := range s.Cfg.Section("site") {
		ctx[k] = v
	}
	ctx["base"] = NormalizeBase(toString(ctx["base"]))
	assetsDir := toString(ctx["assets"])
	if assetsDir == "" {
		assetsDir = "/assets/"
	}
	ctx["assets"] = assetsDir
	ctx["data"] = siteData
	ctx["languages"] = toAnySlice(s.Languages)
	ctx["defaultLang"] = s.DefaultLang
	pages := make([]any, 0, len(s.ContentPages))
	for _, p := range s.ContentPages {
		pages = append(pages, s.serializePage(p))
	}
	ctx["pages"] = pages
	posts := make([]any, 0)
	for _, p := range s.ContentPages {
		if s.inDefaultStream(p) {
			posts = append(posts, s.serializePage(p))
		}
	}
	ctx["posts"] = posts
	// postsByLang: 每种语言各自的文章流
	postsByLang := map[string][]any{}
	for _, lang := range s.Languages {
		var pl []any
		for _, p := range s.ContentPages {
			if !s.inStream(p) {
				continue
			}
			if p.Lang != lang {
				continue
			}
			pl = append(pl, s.serializePage(p))
		}
		postsByLang[lang] = pl
	}
	ctx["postsByLang"] = postsByLang
	ctx["tags"] = s.stripTerms(s.Tags)
	ctx["categories"] = s.stripTerms(s.Categories)
	ctx["series"] = s.stripTerms(s.Series)
	ctx["collections"] = s.Collections
	ctx["navGroups"] = []any{}
	s.SiteContext = ctx
}

func (s *Site) stripTerms(list []*term) []any {
	out := make([]any, 0, len(list))
	for _, t := range list {
		if t.Count <= 0 {
			continue
		}
		out = append(out, map[string]any{
			"name": t.Name, "url": t.URL, "count": int64(t.Count), "items": t.Items,
		})
	}
	return out
}

func (s *Site) inStream(p *Page) bool {
	if toString(p.Data["type"]) == "page" {
		return false
	}
	if p.URL == "/" || p.Date == nil {
		return false
	}
	if c := toString(p.Data["collection"]); c != "" {
		if enabled, ok := s.collectionPostsEnabled[c]; !ok || !enabled {
			return false
		}
	}
	return true
}

func (s *Site) inDefaultStream(p *Page) bool {
	if !s.inStream(p) {
		return false
	}
	if s.MultiLang && p.Lang != s.DefaultLang {
		return false
	}
	return true
}

func (s *Site) linkNeighbors() {
	// 多语言站按语言各串各的，翻译版本不会跳到另一种语言的文章上
	groups := map[string][]*Page{}
	for _, p := range s.ContentPages {
		if !s.inStream(p) {
			continue
		}
		k := ""
		if s.MultiLang {
			k = p.Lang
		}
		groups[k] = append(groups[k], p)
	}
	for _, stream := range groups {
		for i, cur := range stream {
			if i+1 < len(stream) {
				prev := stream[i+1]
				cur.Data["prev"] = map[string]any{"url": prev.URL, "title": prev.Title}
			} else {
				delete(cur.Data, "prev")
			}
			if i-1 >= 0 {
				next := stream[i-1]
				cur.Data["next"] = map[string]any{"url": next.URL, "title": next.Title}
			} else {
				delete(cur.Data, "next")
			}
		}
	}
}

func (s *Site) groupTranslations(pages []*Page) {
	if !s.MultiLang {
		return
	}
	transMap := map[string][]*Page{}
	for _, p := range pages {
		key := toString(p.Data["translationKey"])
		if key == "" {
			continue
		}
		transMap[key] = append(transMap[key], p)
	}
	for _, p := range pages {
		key := toString(p.Data["translationKey"])
		if key == "" {
			p.Data["translations"] = []any{}
			continue
		}
		group := transMap[key]
		if len(group) <= 1 {
			p.Data["translations"] = []any{}
			continue
		}
		var ts []any
		for _, q := range group {
			ts = append(ts, map[string]any{"lang": q.Lang, "url": q.URL, "title": q.Title})
		}
		p.Data["translations"] = ts
	}

	// 多语言站给首页补一份翻译表（当首页没 translationKey 时）
	var home *Page
	for _, p := range pages {
		if p.URL == "/" {
			home = p
			break
		}
	}
	if home != nil && toString(home.Data["translationKey"]) == "" {
		rooms := s.langHomes()
		if len(rooms) > 1 {
			home.Data["translations"] = rooms
		}
	}
}

// langHomes 返回每种语言的首页入口列表 [{lang, url}]。
func (s *Site) langHomes() []any {
	var rooms []any
	for _, lang := range s.Languages {
		url := NormalizePath("/" + lang + "/")
		if lang == s.DefaultLang {
			url = "/"
		}
		rooms = append(rooms, map[string]any{"lang": lang, "url": url})
	}
	return rooms
}

func (s *Site) renderAll() error {
	resolver := s.linkResolver
	for _, p := range s.AllPages {
		bodyHTML := ""
		if p.IsMD {
			var hs []markdown.Heading
			opts := &markdown.Options{
				Headings:  &hs,
				Highlight: !(s.Cfg.Section("markdown")["highlight"] == false),
			}
			if resolver != nil {
				opts.Link = func(href string) string { return resolver(href, p) }
			}
			bodyHTML = markdown.Render(p.Body, opts)
			for _, h := range hs {
				if h.Level >= 2 && h.Level <= 3 {
					p.TocData = append(p.TocData, h)
				}
			}
		} else {
			bodyHTML = p.Body
		}
		p.BodyHTML = bodyHTML
		view := s.serializePage(p)
		ctx := s.buildContext(view, bodyHTML, p.TocData)
		html, err := s.Engine.Render(p.Layout, ctx)
		if err != nil {
			return fmt.Errorf("渲染 %s（布局 %s）失败：%w", p.Rel, p.Layout, err)
		}
		html = ApplyBase(html, toString(s.Cfg.Section("site")["base"]))
		p.HTML = html
	}
	s.Stats.Pages = len(s.AllPages)
	return nil
}

func (s *Site) buildContext(view map[string]any, bodyHTML string, toc []markdown.Heading) map[string]any {
	headings := make([]any, 0, len(toc))
	for _, h := range toc {
		headings = append(headings, map[string]any{"level": int64(h.Level), "text": h.Text, "id": h.ID})
	}
	var pagination any
	if pv, ok := view["data"].(map[string]any); ok {
		if pag, ok := pv["pagination"]; ok {
			pagination = pag
		}
	}
	posts := s.SiteContext["posts"]
	postsTotal := int64(len(posts.([]any)))
	if pm, ok := pagination.(map[string]any); ok {
		if pp, ok := pm["posts"].([]any); ok {
			posts = pp
		}
		if tot, ok := toInt(pm["total"]); ok {
			postsTotal = int64(tot)
		}
	}
	title := toString(view["title"])
	return map[string]any{
		"page":       view,
		"title":      title,
		"content":    markdown.StripDuplicateH1(bodyHTML, title),
		"data":       view["data"],
		"headings":   headings,
		"excerpt":    view["excerpt"],
		"readTime":   view["readTime"],
		"posts":      posts,
		"postsTotal": postsTotal,
		"pagination": pagination,
		"nav":        s.resolveNav(toString(view["lang"])),
		"site":       s.SiteContext,
	}
}

func (s *Site) resolveNav(lang string) []any {
	navRaw, _ := s.Cfg.Section("site")["nav"].([]any)
	out := make([]any, 0, len(navRaw))
	for _, item := range navRaw {
		m, ok := item.(map[string]any)
		if !ok {
			out = append(out, item)
			continue
		}
		if trans, ok := m["translations"].(map[string]any); ok && lang != "" {
			if t, ok := trans[lang].(map[string]any); ok {
				nm := map[string]any{}
				for k, v := range m {
					nm[k] = v
				}
				if tv, ok := t["title"]; ok {
					nm["title"] = tv
				}
				if uv, ok := t["url"]; ok {
					nm["url"] = uv
				}
				out = append(out, nm)
				continue
			}
		}
		out = append(out, m)
	}
	return out
}
