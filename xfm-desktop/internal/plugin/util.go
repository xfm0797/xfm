package plugin

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

// ---------- 配置读取 ----------

// AsMap 把配置里的对象段转成 map。
func AsMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

// Str 读取字符串配置。
func Str(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	return toString(m[key])
}

// BoolVal 读取布尔配置。
func BoolVal(m map[string]any, key string, def bool) bool {
	if m == nil {
		return def
	}
	if b, ok := m[key].(bool); ok {
		return b
	}
	return def
}

// Num 读取数值配置。
func Num(m map[string]any, key string, def float64) float64 {
	if m == nil {
		return def
	}
	switch x := m[key].(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	}
	return def
}

// IntVal 读取整数配置。
func IntVal(m map[string]any, key string, def int) int {
	return int(Num(m, key, float64(def)))
}

// AnyList 读取数组配置。
func AnyList(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return nil
}

// StrList 把任意数组转成字符串数组。
func StrList(v any) []string {
	switch x := v.(type) {
	case []any:
		out := make([]string, 0, len(x))
		for _, it := range x {
			out = append(out, toString(it))
		}
		return out
	case []string:
		return append([]string(nil), x...)
	case string:
		if x == "" {
			return nil
		}
		return []string{x}
	}
	return nil
}

func toString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

// ---------- URL / 文本工具 ----------

var reMultiSlash = regexp.MustCompile(`/+`)

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
	return reMultiSlash.ReplaceAllString(b, "/")
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

// AbsoluteURL 由 site.url + base + 裸 URL 拼绝对地址。
func AbsoluteURL(siteCfg map[string]any, url string) string {
	origin := strings.TrimRight(Str(siteCfg, "url"), "/")
	return origin + WithBase(Str(siteCfg, "base"), url)
}

var (
	reAttrDouble = regexp.MustCompile(`(\s(?:href|src|poster|action)=")/([^"]*)"`)
	reAttrSingle = regexp.MustCompile(`(\s(?:href|src|poster|action)=')/([^']*)'`)
)

// ApplyBase 给整页 HTML 的根绝对链接补 base 前缀。
func ApplyBase(html, base string) string {
	b := NormalizeBase(base)
	if b == "/" || html == "" {
		return html
	}
	prefix := b[:len(b)-1]
	html = applyBaseRe(html, reAttrDouble, prefix, `"`)
	html = applyBaseRe(html, reAttrSingle, prefix, `'`)
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

var escReplacer = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")

// EscHTML 与 Node 版 escapeHtml 对齐（& < > "）。
func EscHTML(s string) string { return escReplacer.Replace(s) }

// JSONLiteral 生成可安全嵌入 <script> 的 JSON 字面量。
func JSONLiteral(v any) string {
	b, _ := json.Marshal(v)
	return strings.ReplaceAll(string(b), "<", `\u003c`)
}

// IsIsoDay 判断是否 YYYY-MM-DD。
func IsIsoDay(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	for i, c := range s {
		if i == 4 || i == 7 {
			continue
		}
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// IsoDateTime 把日历日补成 ISO 8601（与 Node 版 iso()/isoDate() 一致）。
func IsoDateTime(day string) string {
	if day == "" {
		return ""
	}
	if IsIsoDay(day) {
		return day + "T00:00:00+00:00"
	}
	return day
}

func sortStrings(ss []string) { sort.Strings(ss) }
