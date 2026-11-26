package site

import (
	"os"
	"path/filepath"

	"xfmdesk/internal/plugin"
)

// pluginHost 把 Site 适配成插件可访问的宿主接口。
type pluginHost struct {
	s *Site
}

func (h *pluginHost) Root() string     { return h.s.Root }
func (h *pluginHost) Mode() string     { return h.s.Mode }
func (h *pluginHost) ThemeDir() string { return h.s.ThemeDir }

func (h *pluginHost) Config() map[string]any     { return h.s.Cfg.Raw }
func (h *pluginHost) SiteConfig() map[string]any { return h.s.Cfg.Section("site") }
func (h *pluginHost) Section(name string) map[string]any {
	return h.s.Cfg.Section(name)
}
func (h *pluginHost) SiteContext() map[string]any { return h.s.SiteContext }
func (h *pluginHost) MergePluginConfig(name string, cfg map[string]any) {
	h.s.mergePluginConfig(name, cfg)
}
func (h *pluginHost) Helpers() plugin.Helpers { return h.s.pluginHelpers }
func (h *pluginHost) Fail(err error)          { h.s.pluginErr = err }

func (h *pluginHost) Pages() []*plugin.Doc {
	out := make([]*plugin.Doc, 0, len(h.s.AllPages))
	for _, p := range h.s.AllPages {
		out = append(out, h.s.docFor(p))
	}
	return out
}

func (h *pluginHost) Documents() []*plugin.Doc { return h.s.documents }

func (h *pluginHost) ExtraFiles() []plugin.ExtraFile {
	if h.s.Plugins == nil {
		return nil
	}
	return h.s.Plugins.ExtraFiles()
}

func (h *pluginHost) Assets() plugin.Assets {
	var a plugin.Assets
	a.Theme = walkPluginAssets(filepath.Join(h.s.ThemeDir, "assets"), "assets")
	a.Public = walkPluginAssets(filepath.Join(h.s.Root, h.s.Cfg.Str("publicDir")), "")
	for _, c := range h.s.contentAssets {
		a.Content = append(a.Content, plugin.Asset{Src: c.Src, Dest: filepath.ToSlash(c.Dest)})
	}
	return a
}

func walkPluginAssets(root, prefix string) []plugin.Asset {
	var out []plugin.Asset
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		rel, e := filepath.Rel(root, p)
		if e != nil {
			return nil
		}
		out = append(out, plugin.Asset{Src: p, Dest: filepath.ToSlash(filepath.Join(prefix, rel))})
		return nil
	})
	return out
}

// docFor 把 Page 转成插件可见的 Doc；Data 与 Page.Data 共享。
func (s *Site) docFor(p *Page) *plugin.Doc {
	desc := p.Description
	descShort := desc
	if descShort == "" {
		descShort = p.Excerpt
	}
	toc := make([]map[string]any, 0, len(p.TocData))
	for _, h := range p.TocData {
		toc = append(toc, map[string]any{"level": int64(h.Level), "text": h.Text, "id": h.ID})
	}
	return &plugin.Doc{
		URL:          p.URL,
		Title:        p.Title,
		Description:  p.Description,
		Desc:         descShort,
		Date:         FormatDay(p.Date),
		Updated:      FormatDay(p.Updated),
		Tags:         p.Tags,
		Category:     p.Category,
		Series:       p.Series,
		Lang:         p.Lang,
		Weight:       p.Weight,
		Layout:       p.Layout,
		Excerpt:      p.Excerpt,
		ReadTime:     p.ReadTime,
		TOC:          toc,
		Translations: p.Data["translations"],
		Data:         p.Data,
		HTML:         p.BodyHTML,
		InStream:     s.inDefaultStream(p),
	}
}

// collectExtras 在渲染完成后构建 documents，并让插件产出附加文件。
func (s *Site) collectExtras() {
	s.documents = make([]*plugin.Doc, 0, len(s.AllPages))
	for _, p := range s.AllPages {
		s.documents = append(s.documents, s.docFor(p))
	}
	if s.Plugins != nil {
		s.extraFiles = s.Plugins.AfterBuild()
	}
}

// mergePluginConfig 把清单里的 config 合并到站点配置同名段（清单值优先）。
func (s *Site) mergePluginConfig(name string, cfg map[string]any) {
	base, _ := s.Cfg.Raw[name].(map[string]any)
	if base == nil {
		base = map[string]any{}
	}
	s.Cfg.Raw[name] = deepMerge(base, cfg)
}
