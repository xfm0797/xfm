package plugin

import (
	"regexp"
	"strings"
)

func init() { Register("comments", newComments) }

type attrPair struct {
	k string
	v any
}

func renderAttrs(pairs []attrPair) string {
	var b strings.Builder
	for _, p := range pairs {
		switch v := p.v.(type) {
		case nil:
			continue
		case bool:
			if !v {
				continue
			}
			b.WriteString(" " + p.k)
		case string:
			if v == "" {
				continue
			}
			b.WriteString(" " + p.k + `="` + EscHTML(v) + `"`)
		default:
			b.WriteString(" " + p.k + `="` + EscHTML(toString(v)) + `"`)
		}
	}
	return b.String()
}

const commentsThemeSync = `<script>
(function () {
  var root = document.documentElement;
  function sync() {
    var f = document.querySelector('iframe.giscus-frame');
    if (!f) return;
    var theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    f.contentWindow.postMessage({ giscus: { setConfig: { theme: theme } } }, '%s');
  }
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
})();
</script>`

var reGiscusTheme = regexp.MustCompile(`^(?:light|dark|dark_dimmed|dark_high_contrast|preferred_color_scheme|transparent_dark|custom)$`)

type commentCtx struct {
	key, url, title string
}

type commentSnippet struct {
	css, container, scripts string
}

type commentProvider struct {
	needs []string
	build func(map[string]any, commentCtx) commentSnippet
}

var commentProviders = map[string]commentProvider{
	"giscus": {
		needs: []string{"repo", "repoId"},
		build: func(c map[string]any, _ commentCtx) commentSnippet {
			theme := Str(c, "theme")
			if !reGiscusTheme.MatchString(theme) {
				theme = "preferred_color_scheme"
			}
			strict := "0"
			if BoolVal(c, "strict", false) {
				strict = "1"
			}
			reactions := "1"
			if v, ok := c["reactionsEnabled"].(bool); ok && !v {
				reactions = "0"
			}
			a := renderAttrs([]attrPair{
				{"data-repo", Str(c, "repo")},
				{"data-repo-id", Str(c, "repoId")},
				{"data-category", defaultStr(Str(c, "category"), "General")},
				{"data-category-id", Str(c, "categoryId")},
				{"data-mapping", defaultStr(Str(c, "mapping"), "pathname")},
				{"data-strict", strict},
				{"data-reactions-enabled", reactions},
				{"data-emit-metadata", "0"},
				{"data-input-position", defaultStr(Str(c, "inputPosition"), "bottom")},
				{"data-theme", theme},
				{"data-lang", defaultStr(Str(c, "lang"), "zh-CN")},
				{"crossorigin", "anonymous"},
				{"async", true},
			})
			return commentSnippet{
				container: `<div class="giscus" data-xfm-comments></div>`,
				scripts:   `<script src="https://giscus.app/client.js"` + a + `></script>` + strings.Replace(commentsThemeSync, "%s", "https://giscus.app", 1),
			}
		},
	},
	"beaudar": {
		needs: []string{"repo", "repoId"},
		build: func(c map[string]any, _ commentCtx) commentSnippet {
			a := renderAttrs([]attrPair{
				{"data-repo", Str(c, "repo")},
				{"data-repo-id", Str(c, "repoId")},
				{"data-category", defaultStr(Str(c, "category"), "General")},
				{"data-category-id", Str(c, "categoryId")},
				{"data-mapping", defaultStr(Str(c, "mapping"), "pathname")},
				{"data-theme", defaultStr(Str(c, "theme"), "preferred_color_scheme")},
				{"data-lang", defaultStr(Str(c, "lang"), "zh-CN")},
				{"crossorigin", "anonymous"},
				{"async", true},
			})
			return commentSnippet{
				container: `<div class="giscus" data-xfm-comments></div>`,
				scripts:   `<script src="https://beaudar.lipk.org/client.js"` + a + `></script>` + strings.Replace(commentsThemeSync, "%s", "https://beaudar.lipk.org", 1),
			}
		},
	},
	"utterances": {
		needs: []string{"repo"},
		build: func(c map[string]any, _ commentCtx) commentSnippet {
			term := Str(c, "issueTerm")
			if term == "" {
				term = defaultStr(Str(c, "mapping"), "pathname")
			}
			a := renderAttrs([]attrPair{
				{"repo", Str(c, "repo")},
				{"issue-term", term},
				{"label", defaultStr(Str(c, "label"), "comment")},
				{"theme", defaultStr(Str(c, "theme"), "preferred-color-scheme")},
				{"crossorigin", "anonymous"},
				{"async", true},
			})
			return commentSnippet{
				container: `<div class="utterances" data-xfm-comments></div>`,
				scripts:   `<script src="https://utteranc.es/client.js"` + a + `></script>`,
			}
		},
	},
	"disqus": {
		needs: []string{"shortname"},
		build: func(c map[string]any, ctx commentCtx) commentSnippet {
			config := `{ this.page.url = ` + JSONLiteral(ctx.url) + `; this.page.identifier = ` + JSONLiteral(ctx.key) + `; }`
			return commentSnippet{
				container: `<div id="disqus_thread" data-xfm-comments></div>`,
				scripts: `<script>
(function () {
  var d = document;
  window.disqus_config = function () ` + config + `;
  var s = d.createElement('script');
  s.src = 'https://' + ` + JSONLiteral(Str(c, "shortname")) + ` + '.disqus.com/embed.js';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);
})();
</script>`,
			}
		},
	},
	"waline": {
		needs: []string{"serverURL"},
		build: func(c map[string]any, ctx commentCtx) commentSnippet {
			opt := map[string]any{
				"el": "#waline", "serverURL": Str(c, "serverURL"), "path": ctx.key,
				"lang": defaultStr(Str(c, "lang"), "zh-CN"),
			}
			if v, ok := c["dark"].(bool); ok && !v {
				opt["dark"] = false
			} else {
				opt["dark"] = `html[data-theme="dark"]`
			}
			for _, k := range []string{"emoji", "requiredMeta", "login", "commentSorting"} {
				if v, ok := c[k]; ok && v != nil && v != "" {
					opt[k] = v
				}
			}
			return commentSnippet{
				css:       `<link rel="stylesheet" href="https://unpkg.com/@waline/client@v3/dist/waline.css">`,
				container: `<div id="waline" data-xfm-comments></div>`,
				scripts: `<script type="module">import { init } from 'https://unpkg.com/@waline/client@v3/dist/waline.js';init(` +
					JSONLiteral(opt) + `);</script>`,
			}
		},
	},
	"twikoo": {
		needs: []string{"envId"},
		build: func(c map[string]any, ctx commentCtx) commentSnippet {
			opt := map[string]any{"envId": Str(c, "envId"), "el": "#tcomment", "path": ctx.key}
			if v := Str(c, "lang"); v != "" {
				opt["lang"] = v
			}
			if v := Str(c, "region"); v != "" {
				opt["region"] = v
			}
			return commentSnippet{
				container: `<div id="tcomment" data-xfm-comments></div>`,
				scripts: `<script src="https://cdn.jsdelivr.net/npm/twikoo@2/dist/twikoo.min.js"></script>` +
					`<script>twikoo.init(` + JSONLiteral(opt) + `);</script>`,
			}
		},
	},
	"valine": {
		needs: []string{"appId", "appKey"},
		build: func(c map[string]any, ctx commentCtx) commentSnippet {
			opt := map[string]any{
				"el": "#vcomments", "appId": Str(c, "appId"), "appKey": Str(c, "appKey"),
				"path": ctx.key, "placeholder": defaultStr(Str(c, "placeholder"), "欢迎留言"),
			}
			for _, k := range []string{"serverURLs", "lang", "meta"} {
				if v, ok := c[k]; ok && v != nil && v != "" {
					opt[k] = v
				}
			}
			return commentSnippet{
				container: `<div id="vcomments" data-xfm-comments></div>`,
				scripts: `<script src="https://unpkg.com/valine@1/dist/Valine.min.js"></script>` +
					`<script>new Valine(` + JSONLiteral(opt) + `);</script>`,
			}
		},
	},
	"gitalk": {
		needs: []string{"clientID", "clientSecret", "repo", "owner", "admin"},
		build: func(c map[string]any, ctx commentCtx) commentSnippet {
			var admin any = Str(c, "admin")
			if arr := AnyList(c["admin"]); arr != nil {
				admin = arr
			}
			opt := map[string]any{
				"clientID": Str(c, "clientID"), "clientSecret": Str(c, "clientSecret"),
				"repo": Str(c, "repo"), "owner": Str(c, "owner"), "admin": admin,
				"id": ctx.key, "distractionFreeMode": BoolVal(c, "distractionFreeMode", true),
			}
			if p := Str(c, "proxy"); p != "" {
				opt["proxy"] = p
			}
			return commentSnippet{
				css:       `<link rel="stylesheet" href="https://unpkg.com/gitalk/dist/gitalk.css">`,
				container: `<div id="gitalk-container" data-xfm-comments></div>`,
				scripts: `<script src="https://unpkg.com/gitalk/dist/gitalk.min.js"></script>` +
					`<script>new Gitalk(` + JSONLiteral(opt) + `).render('gitalk-container');</script>`,
			}
		},
	},
	"artalk": {
		needs: []string{"server"},
		build: func(c map[string]any, ctx commentCtx) commentSnippet {
			pageTitle := ctx.title
			if v, ok := c["pageTitle"].(bool); ok && !v {
				pageTitle = ""
			}
			opt := map[string]any{"el": "#Comments", "server": Str(c, "server"), "pageKey": ctx.key, "pageTitle": pageTitle}
			if s := Str(c, "site"); s != "" {
				opt["site"] = s
			}
			if v, ok := c["dark"].(bool); !ok || v {
				opt["darkMode"] = "auto"
			}
			return commentSnippet{
				css:       `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/artalk@2/dist/Artalk.css">`,
				container: `<div id="Comments" data-xfm-comments></div>`,
				scripts: `<script src="https://cdn.jsdelivr.net/npm/artalk@2/dist/Artalk.js"></script>` +
					`<script>Artalk.init(` + JSONLiteral(opt) + `);</script>`,
			}
		},
	},
	"cusdis": {
		needs: []string{"appId"},
		build: func(c map[string]any, ctx commentCtx) commentSnippet {
			host := strings.TrimRight(defaultStr(Str(c, "host"), "https://cusdis.com"), "/")
			theme := "auto"
			if v, ok := c["dark"].(bool); ok && !v {
				theme = "light"
			}
			a := renderAttrs([]attrPair{
				{"data-xfm-comments", true},
				{"data-host", host},
				{"data-app-id", Str(c, "appId")},
				{"data-page-id", ctx.key},
				{"data-page-url", ctx.url},
				{"data-page-title", ctx.title},
				{"data-theme", theme},
			})
			return commentSnippet{
				container: `<div id="cusdis_thread"` + a + `></div>`,
				scripts:   `<script async defer src="` + EscHTML(host) + `/js/cusdis.es.js"></script>`,
			}
		},
	},
}

var commentAliases = map[string]string{"github": "giscus", "comments": "giscus"}

// comments：接十家评论系统。
func newComments(h Host) *Instance {
	c := h.Section("comments")
	raw := strings.ToLower(defaultStr(Str(c, "provider"), "giscus"))
	provider := raw
	if a, ok := commentAliases[raw]; ok {
		provider = a
	}
	def, hasDef := commentProviders[provider]
	inDev := BoolVal(c, "dev", false)
	title := "评论"
	if v, ok := c["title"]; ok {
		title = toString(v)
	}
	base := Str(h.SiteConfig(), "base")

	var missing []string
	if hasDef {
		for _, k := range def.needs {
			v, ok := c[k]
			if !ok || v == nil || v == "" {
				missing = append(missing, k)
				continue
			}
			if arr, ok := v.([]any); ok && len(arr) == 0 {
				missing = append(missing, k)
			}
		}
	}
	active := hasDef && len(missing) == 0

	return &Instance{
		Name: "comments",
		ExtendContext: func(ctx map[string]any) map[string]any {
			if !active {
				return ctx
			}
			ctx["comments"] = map[string]any{"provider": provider, "title": title}
			return ctx
		},
		TransformHTML: func(html string, page *Doc) string {
			if !active {
				return html
			}
			if !inDev && h.Mode() != "production" {
				return html
			}
			if page == nil {
				return html
			}
			typ := Str(page.Data, "type")
			if v, ok := page.Data["comments"].(bool); ok && !v {
				return html
			}
			if typ == "page" || typ == "index" || page.Date == "" || page.URL == "/" {
				return html
			}

			path := WithBase(base, page.URL)
			key := path
			switch Str(c, "identifier") {
			case "url":
				key = AbsoluteURL(h.SiteConfig(), page.URL)
			case "title":
				key = defaultStr(page.Title, path)
			}
			url := AbsoluteURL(h.SiteConfig(), page.URL)
			snip := def.build(c, commentCtx{key: key, url: url, title: page.Title})

			section := `<section class="comments" data-comments-provider="` + provider + `" style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border,#e6e6e6)">`
			if title != "" {
				section += `<h2 style="font-size:1.15rem;margin:0 0 1rem">` + EscHTML(title) + `</h2>`
			}
			section += snip.container + snip.scripts + `</section>`

			body := section
			if strings.Contains(html, "data-xfm-comments") {
				body = snip.scripts
			}
			out := insertBefore(html, body)
			if snip.css != "" {
				out = insertHead(out, snip.css)
			}
			return out
		},
	}
}
