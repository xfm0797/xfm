package scaffold

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"xfmdesk/assets"
	"xfmdesk/internal/plugin"
)

// CreateOptions 新建站点参数。
type CreateOptions struct {
	Dir      string
	Title    string
	Template string // blog / docs
	Force    bool
}

// Create 生成一个可直接构建的站点。
func Create(opt CreateOptions) error {
	if opt.Template == "" {
		opt.Template = "blog"
	}
	dir := opt.Dir
	if dir == "" {
		return fmt.Errorf("未指定站点目录")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	if hasConfig(abs) && !opt.Force {
		return fmt.Errorf("目录已是一个站点：%s（如需覆盖请使用 Force）", abs)
	}
	title := opt.Title
	if title == "" {
		title = filepath.Base(abs)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return err
	}

	layout := "post.html"
	theme := "default"
	nav := []map[string]string{
		{"title": "首页", "url": "/"},
		{"title": "分类", "url": "/categories/"},
		{"title": "归档", "url": "/archives/"},
		{"title": "关于", "url": "/about/"},
	}
	if opt.Template == "docs" {
		layout = "page.html"
		theme = "docs"
		nav = []map[string]string{
			{"title": "首页", "url": "/"},
			{"title": "关于", "url": "/about/"},
		}
	}

	cfg := map[string]any{
		"site": map[string]any{
			"title":       title,
			"description": "由 xfm 桌面版生成的站点",
			"lang":        "zh-CN",
			"base":        "/",
			"nav":         nav,
		},
		"theme":      "themes/" + theme,
		"plugins":    plugin.Core(),
		"pagination": map[string]any{"perPage": 9},
		"defaults":   map[string]any{"layout": layout},
		"server":     map[string]any{"port": 4173},
	}
	cfgBytes, _ := json.MarshalIndent(cfg, "", "  ")
	if err := writeFile(abs, "xfm.config.json", string(cfgBytes)+"\n"); err != nil {
		return err
	}

	files := map[string]string{
		"content/index.md": "---\ntitle: 首页\nlayout: index.html\n---\n",
		"content/about.md": fmt.Sprintf("---\ntitle: 关于\nlayout: page.html\ndescription: 关于这个站点。\n---\n\n# 关于\n\n这是用 Go 版 xfm 桌面端搭建的站点。\n\n## 开始写作\n\n```bash\n新建文章 → 编辑 → 构建\n```\n"),
	}
	if opt.Template == "docs" {
		files["content/docs/getting-started.md"] = "---\ntitle: 快速开始\ngroup: 使用指南\nweight: 1\nlayout: page.html\n---\n\n# 快速开始\n\n在桌面端左侧目录树中新建文档，右侧编辑并实时预览。\n"
		files["content/docs/configuration.md"] = "---\ntitle: 配置\ngroup: 使用指南\nweight: 2\nlayout: page.html\n---\n\n# 配置\n\n编辑 `xfm.config.json` 即可，所有字段都有合理默认值。\n"
	} else {
		today := time.Now().Format("2006-01-02")
		files["content/posts/hello-world.md"] = fmt.Sprintf(`---
title: 你好，世界
date: %s
tags: [随笔]
category: 随笔
description: 第一篇文章。
---

# 你好，世界

这是第一篇文章。直接写 Markdown 即可，支持：

- **强调**、[链接](https://example.com)、`+"`行内代码`"+`
- 表格、任务列表、提示容器

::: tip 提示
点击工具栏的「构建」即可生成静态站点。
:::
`, today)
	}
	for rel, content := range files {
		if err := writeFile(abs, rel, content); err != nil {
			return err
		}
	}

	// 主题：从外部资源解析器找到后复制到站点 themes/
	themeDir := filepath.Join(abs, "themes", theme)
	resolver := assets.NewThemeResolver(abs)
	src := resolver.Resolve(theme)
	if src != "" {
		if err := assets.CopyTheme(src, filepath.Join(abs, "themes"), theme); err != nil {
			return fmt.Errorf("复制主题失败：%w", err)
		}
	} else {
		// 找不到内置主题时，给站点写一份最小可用的 themes/<name>/ 骨架，
		// 里面放 README 提示用户去 install-themes 或手工复制。
		if err := writeThemeStub(themeDir, theme); err != nil {
			return fmt.Errorf("创建主题骨架失败：%w", err)
		}
	}
	_ = writeFile(abs, ".gitignore", "dist/\n.xfm/\nnode_modules/\n")
	_ = writeFile(abs, "public/.gitkeep", "")
	return nil
}

// writeThemeStub 在没有外部主题时写一份最小主题骨架到目标目录，
// 包含必要的 base.html/layouts/index.html 让站点能构建，外加一个 README 提示。
func writeThemeStub(dir, theme string) error {
	if err := os.MkdirAll(filepath.Join(dir, "layouts"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "partials"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		return err
	}

	// 最小 assets（让测试能过 + 站点能加载）
	if err := writeFile(dir, "assets/style.css", "body{font-family:system-ui,sans-serif;margin:0;padding:2rem;}\n"); err != nil {
		return err
	}

	baseHTML := `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>{% block title %}{{ site.title }}{% endblock %}</title>
  {% block head %}{% endblock %}
</head>
<body>
  {% block main %}{% endblock %}
</body>
</html>
`
	indexHTML := `{% extend "base.html" %}
{% block title %}{{ site.title }}{% endblock %}
{% block main %}
  <h1 class="home-title">{{ site.title }}</h1>
  <section class="post-grid">
  {% for p in posts %}
    <a class="card" href="{{ p.url }}">
      <h2>{{ p.title }}</h2>
      <p>{{ p.desc }}</p>
    </a>
  {% endfor %}
  </section>
{% endblock %}
`
	pageHTML := `{% extend "base.html" %}
{% block title %}{{ page.title }} - {{ site.title }}{% endblock %}
{% block main %}
  <article>
    <h1>{{ page.title }}</h1>
    <div>{{ content }}</div>
  </article>
{% endblock %}
`
	stubFiles := map[string]string{
		"layouts/base.html":       baseHTML,
		"layouts/index.html":      indexHTML,
		"layouts/page.html":       pageHTML,
		"layouts/post.html":       pageHTML,
		"layouts/taxonomy.html":   pageHTML,
		"layouts/categories.html": pageHTML,
		"layouts/archives.html":   pageHTML,
		"layouts/collection.html": pageHTML,
	}
	for rel, content := range stubFiles {
		if err := writeFile(dir, rel, content); err != nil {
			return err
		}
	}
	// README 提示用户安装真实主题
	readme := "# 主题占位：" + theme + "\n\n" +
		"这是 xfm 自动生成的最小主题骨架（没有外部主题可用时的回退）。\n\n" +
		"## 安装官方主题\n\n" +
		"  xfm install-themes\n" +
		"  # 或指定源目录：\n" +
		"  xfm install-themes /path/to/xfm/themes\n\n" +
		"安装后重新 scaffold，或直接把 themes/default 整体复制到本目录覆盖。\n"
	return writeFile(dir, "README.md", readme)
}

func hasConfig(dir string) bool {
	for _, f := range []string{"xfm.config.json", "xfm.config.mjs", "xfm.config.js", "xfm.config.cjs"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err == nil {
			return true
		}
	}
	if data, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil {
		var pkg map[string]any
		if json.Unmarshal(data, &pkg) == nil && pkg["xfm"] != nil {
			return true
		}
	}
	return false
}

func writeFile(root, rel, content string) error {
	abs := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0o644)
}
