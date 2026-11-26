package site

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"xfmdesk/assets"
)

// NormalizeBase 规范化站点子路径 base。
func NormalizeBase(base string) string {
	b := strings.TrimSpace(base)
	if b == "" || b == "." {
		return "/"
	}
	if !strings.HasPrefix(b, "/") {
		b = "/" + b
	}
	if !strings.HasSuffix(b, "/") {
		b += "/"
	}
	re := regexp.MustCompile(`/+`)
	return re.ReplaceAllString(b, "/")
}

// WithBase 裸 URL → 带 base 的 URL。
func WithBase(base, url string) string {
	b := NormalizeBase(base)
	if b == "/" {
		return url
	}
	prefix := b[:len(b)-1]
	if url == "/" {
		return b
	}
	if !strings.HasPrefix(url, "/") {
		return prefix + "/" + url
	}
	return prefix + url
}

var (
	attrDouble = regexp.MustCompile(`(\s(?:href|src|poster|action)=")/([^"]*)"`)
	attrSingle = regexp.MustCompile(`(\s(?:href|src|poster|action)=')/([^']*)'`)
)

// ApplyBase 给整页 HTML 的根绝对链接补 base 前缀。
func ApplyBase(html, base string) string {
	b := NormalizeBase(base)
	if b == "/" || html == "" {
		return html
	}
	prefix := b[:len(b)-1]
	html = applyBaseRe(html, attrDouble, prefix, `"`)
	html = applyBaseRe(html, attrSingle, prefix, `'`)
	return html
}

func applyBaseRe(html string, re *regexp.Regexp, prefix, quote string) string {
	var out strings.Builder
	last := 0
	for _, m := range re.FindAllStringSubmatchIndex(html, -1) {
		lead := html[m[2]:m[3]]
		rest := html[m[4]:m[5]]
		out.WriteString(html[last:m[2]])
		out.WriteString(lead)
		if strings.HasPrefix(rest, "/") {
			// 协议相对地址 //cdn：保持原样
			out.WriteString(html[m[3]:m[1]])
		} else {
			out.WriteString(prefix + "/" + rest + quote)
		}
		last = m[1]
	}
	out.WriteString(html[last:])
	return out.String()
}

// NormalizePath 规范化站内 URL。
func NormalizePath(p string) string {
	u := "/" + strings.ReplaceAll(strings.TrimLeft(p, "/"), "\\", "/")
	re := regexp.MustCompile(`/+`)
	u = re.ReplaceAllString(u, "/")
	return u
}

// DeriveRoute 根据内容文件相对路径推断 URL。
func DeriveRoute(rel string) string {
	ext := path.Ext(rel)
	if ext == ".html" || ext == ".htm" {
		return NormalizePath(rel)
	}
	route := rel[:len(rel)-len(ext)]
	re := regexp.MustCompile(`(^|/)index$`)
	route = re.ReplaceAllString(route, "$1")
	route = NormalizePath(route)
	if route != "/" && !strings.HasSuffix(route, "/") {
		route += "/"
	}
	return route
}

// URLToFilePath 把 URL 映射为落盘相对路径。
func URLToFilePath(url string) string {
	clean := url
	// 还原百分号编码
	if dec, err := percentDecode(url); err == nil {
		clean = dec
	}
	if clean == "/" {
		return "index.html"
	}
	if strings.HasSuffix(clean, ".html") || strings.HasSuffix(clean, ".htm") {
		return clean[1:]
	}
	return path.Join(clean[1:], "index.html")
}

func percentDecode(s string) (string, error) {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '%' && i+2 < len(s) {
			hi := fromHex(s[i+1])
			lo := fromHex(s[i+2])
			if hi >= 0 && lo >= 0 {
				b.WriteByte(byte(hi<<4 | lo))
				i += 2
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String(), nil
}

func fromHex(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10
	case c >= 'A' && c <= 'F':
		return int(c-'A') + 10
	}
	return -1
}

// ensureThemeDir 确保主题目录存在；缺失时回退到内嵌主题（写入 .xfm 缓存目录）。
func ensureThemeDir(root, themeName string) (string, error) {
	if filepath.IsAbs(themeName) {
		if dirExists(themeName) {
			return themeName, nil
		}
	}
	local := filepath.Join(root, themeName)
	if dirExists(local) {
		return local, nil
	}
	// 只给名字（如 "default"）时也尝试 themes/<name>
	local2 := filepath.Join(root, "themes", themeName)
	if dirExists(local2) {
		return local2, nil
	}
	// 回退内嵌主题
	name := path.Base(filepath.ToSlash(themeName))
	cache := filepath.Join(root, ".xfm", "themes", name)
	if !dirExists(cache) {
		if err := assets.WriteEmbeddedTheme(cache, name); err != nil {
			return "", err
		}
	}
	return cache, nil
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}
