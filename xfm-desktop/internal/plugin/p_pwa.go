package plugin

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

func init() { Register("pwa", newPWA) }

var rePrecacheExt = regexp.MustCompile(`(?i)\.(css|js|mjs|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$`)

type pwaIcon struct {
	Src     string `json:"src"`
	Sizes   string `json:"sizes"`
	Type    string `json:"type"`
	Purpose string `json:"purpose,omitempty"`
}

type pwaManifest struct {
	Name            string    `json:"name"`
	ShortName       string    `json:"short_name"`
	Description     string    `json:"description"`
	Lang            string    `json:"lang"`
	StartURL        string    `json:"start_url"`
	Scope           string    `json:"scope"`
	Display         string    `json:"display"`
	ThemeColor      string    `json:"theme_color"`
	BackgroundColor string    `json:"background_color"`
	Icons           []pwaIcon `json:"icons"`
}

// pwa：生成 manifest / service worker / 离线页，并向页面注入 link。
func newPWA(h Host) *Instance {
	cfg := h.Section("pwa")
	siteConf := h.SiteConfig()
	base := NormalizeBase(Str(siteConf, "base"))

	name := defaultStr(Str(cfg, "name"), defaultStr(Str(siteConf, "title"), "xfm site"))
	shortName := Str(cfg, "shortName")
	if shortName == "" {
		shortName = name
		if utf8.RuneCountInString(shortName) > 12 {
			shortName = string([]rune(shortName)[:12])
		}
	}
	description := defaultStr(Str(cfg, "description"), Str(siteConf, "description"))
	themeColor := defaultStr(Str(cfg, "themeColor"), "#3b82f6")
	bgColor := defaultStr(Str(cfg, "backgroundColor"), "#ffffff")
	manifestPath := strings.TrimLeft(defaultStr(Str(cfg, "manifestPath"), "manifest.webmanifest"), "/")
	swPath := strings.TrimLeft(defaultStr(Str(cfg, "swPath"), "sw.js"), "/")
	offline := BoolVal(cfg, "offline", true)
	inDev := BoolVal(cfg, "dev", false)

	var icons []pwaIcon
	if arr := AnyList(cfg["icons"]); len(arr) > 0 {
		for _, it := range arr {
			m := AsMap(it)
			if m == nil {
				continue
			}
			src := Str(m, "src")
			if !strings.HasPrefix(src, "/") {
				src = "/" + src
			}
			icons = append(icons, pwaIcon{
				Src: WithBase(base, src), Sizes: Str(m, "sizes"),
				Type: Str(m, "type"), Purpose: Str(m, "purpose"),
			})
		}
	} else {
		icons = []pwaIcon{{Src: WithBase(base, "/icon.svg"), Sizes: "any", Type: "image/svg+xml", Purpose: "any"}}
	}

	iconSVG := func() string {
		ch := "X"
		if r, _ := utf8.DecodeRuneInString(strings.TrimSpace(name)); r != utf8.RuneError {
			ch = string(unicode.ToUpper(r))
		}
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="` + EscHTML(name) + `">
  <rect width="512" height="512" rx="96" fill="` + EscHTML(themeColor) + `"/>
  <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif"
        font-size="272" font-weight="600" fill="#fff">` + EscHTML(ch) + `</text>
</svg>
`
	}

	manifestJSON := func() []byte {
		m := pwaManifest{
			Name: name, ShortName: shortName, Description: description,
			Lang:     defaultStr(Str(siteConf, "lang"), "zh-CN"),
			StartURL: WithBase(base, "/"), Scope: WithBase(base, "/"),
			Display:    defaultStr(Str(cfg, "display"), "standalone"),
			ThemeColor: themeColor, BackgroundColor: bgColor, Icons: icons,
		}
		b, _ := json.MarshalIndent(m, "", "  ")
		return []byte(string(b) + "\n")
	}

	serviceWorker := func(assets []string) string {
		version := shortHash(strings.Join(assets, "\n") + themeColor)
		offlineURL := WithBase(base, "/offline.html")
		ab, _ := json.MarshalIndent(assets, "", "  ")
		return `/* 由 xfm-plugin-pwa 生成 */
const CACHE = 'xfm-` + version + `';
const OFFLINE = ` + JSONLiteral(offlineURL) + `;
const ASSETS = ` + string(ab) + `;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  // 页面导航：网络优先，断网回退缓存，再回退离线页
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE)))
    );
    return;
  }

  // 静态资源：缓存优先，未命中再取网络并顺手存下
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
`
	}

	offlinePage := func() string {
		return `<!DOCTYPE html>
<html lang="` + EscHTML(defaultStr(Str(siteConf, "lang"), "zh-CN")) + `">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>离线 · ` + EscHTML(name) + `</title>
</head>
<body style="font:16px/1.7 system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:0 1.25rem;text-align:center">
<h1 style="font-size:1.5rem">当前处于离线状态</h1>
<p style="color:#666">页面没有缓存，网络恢复后刷新即可。</p>
<p><a href="` + EscHTML(WithBase(base, "/")) + `" style="color:#2563eb">← 返回首页</a></p>
</body>
</html>
`
	}

	return &Instance{
		Name: "pwa",
		TransformHTML: func(html string, page *Doc) string {
			if !inDev && h.Mode() != "production" {
				return html
			}
			if page != nil {
				if v, ok := page.Data["pwa"].(bool); ok && !v {
					return html
				}
			}
			if !reHeadClose.MatchString(html) || strings.Contains(html, `rel="manifest"`) {
				return html
			}
			head := `<link rel="manifest" href="` + EscHTML(WithBase(base, "/"+manifestPath)) + `">` + "\n" +
				`<meta name="theme-color" content="` + EscHTML(themeColor) + `">` + "\n" +
				`<link rel="apple-touch-icon" href="` + EscHTML(icons[0].Src) + `">`
			out := html
			if loc := reHeadClose.FindStringIndex(out); loc != nil {
				out = out[:loc[0]] + head + "\n" + out[loc[0]:]
			}
			at := lastIndexFold(out, "</body>")
			if h.Mode() == "production" && at != -1 && !strings.Contains(out, "data-xfm-pwa") {
				reg := `<script data-xfm-pwa>if('serviceWorker' in navigator&&location.protocol==='https:')` +
					`{addEventListener('load',function(){navigator.serviceWorker.register(` +
					JSONLiteral(WithBase(base, "/"+swPath)) + `).catch(function(){})})}</script>` + "\n"
				out = out[:at] + reg + out[at:]
			}
			return out
		},
		AfterBuild: func(h Host) []ExtraFile {
			// 预缓存清单：首页 + cacheExtra + 主题资源 + public 静态资源
			set := map[string]bool{WithBase(base, "/"): true}
			for _, extra := range StrList(cfg["cacheExtra"]) {
				set[WithBase(base, extra)] = true
			}
			assets := h.Assets()
			for _, a := range assets.Theme {
				set[WithBase(base, "/"+strings.ReplaceAll(a.Dest, "\\", "/"))] = true
			}
			for _, f := range assets.Public {
				if rePrecacheExt.MatchString(f.Dest) {
					set[WithBase(base, "/"+strings.ReplaceAll(f.Dest, "\\", "/"))] = true
				}
			}
			var list []string
			for k := range set {
				list = append(list, k)
			}
			sort.Strings(list)

			files := []ExtraFile{
				{Path: manifestPath, Contents: manifestJSON()},
				{Path: swPath, Contents: []byte(serviceWorker(list))},
			}
			if offline {
				files = append(files, ExtraFile{Path: "offline.html", Contents: []byte(offlinePage())})
			}
			if len(AnyList(cfg["icons"])) == 0 {
				files = append(files, ExtraFile{Path: "icon.svg", Contents: []byte(iconSVG())})
			}
			return files
		},
	}
}

// shortHash：djb2 的 36 进制表示。
func shortHash(s string) string {
	var h uint32 = 5381
	for i := 0; i < len(s); i++ {
		h = (h << 5) + h + uint32(s[i])
	}
	return strconvBase36(h)
}

func strconvBase36(n uint32) string {
	if n == 0 {
		return "0"
	}
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	var b []byte
	for n > 0 {
		b = append([]byte{digits[n%36]}, b...)
		n /= 36
	}
	return string(b)
}
