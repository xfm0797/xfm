// Package site 实现 xfm 站点构建内核（纯 Go）。
package site

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"xfmdesk/internal/plugin"
)

// Defaults 与 xfm 的默认配置一致。
func Defaults() map[string]any {
	return map[string]any{
		"site": map[string]any{
			"title":       "My XFM Site",
			"description": "",
			"base":        "/",
			"lang":        "zh-CN",
			"author":      "",
			"assets":      "/assets/",
			"nav":         []any{},
		},
		"contentDir":      "content",
		"outDir":          "dist",
		"publicDir":       "public",
		"dataDir":         "data",
		"collections":     map[string]any{},
		"theme":           "themes/default",
		"plugins":         defaultPlugins(),
		"defaults":        map[string]any{"layout": "page.html"},
		"buildDrafts":     false,
		"buildScheduled":  false,
		"workerThreshold": 40,
		"indexes": map[string]any{
			"categories": map[string]any{"enabled": true, "url": "/categories/"},
			"archives":   map[string]any{"enabled": true, "url": "/archives/"},
		},
		"pagination": map[string]any{"enabled": true, "perPage": 9, "url": "/page/"},
		"search":     map[string]any{"path": "search.json", "maxChars": 1500},
		"seo":        map[string]any{"image": "", "twitter": "", "jsonLd": true},
		"minify":     map[string]any{"enabled": true, "aggressive": false},
		"workers":    0,
		"server":     map[string]any{"port": 4173, "host": "127.0.0.1", "open": false},
		"markdown":   map[string]any{"highlight": true},
	}
}

// defaultPlugins 返回默认启用的核心插件（rss/sitemap/search/seo/minify）。
func defaultPlugins() []any {
	core := plugin.Core()
	out := make([]any, len(core))
	for i, n := range core {
		out[i] = n
	}
	return out
}

var configFiles = []string{"xfm.config.json", "xfm.config.mjs", "xfm.config.js", "xfm.config.cjs", "config.js"}

// Config 是加载后的站点配置。
type Config struct {
	Root   string
	Source string
	Raw    map[string]any
}

// LoadConfig 读取站点配置并与默认值合并。
func LoadConfig(root string) (*Config, error) {
	var user map[string]any
	source := ""
	for _, f := range configFiles {
		abs := filepath.Join(root, f)
		data, err := os.ReadFile(abs)
		if err != nil {
			continue
		}
		source = abs
		if strings.HasSuffix(f, ".json") {
			_ = json.Unmarshal(data, &user)
		} else {
			user = parseJSLiteral(string(data))
		}
		break
	}
	if user == nil {
		if data, err := os.ReadFile(filepath.Join(root, "package.json")); err == nil {
			var pkg map[string]any
			if json.Unmarshal(data, &pkg) == nil {
				if x, ok := pkg["xfm"].(map[string]any); ok {
					user = x
					source = filepath.Join(root, "package.json")
				}
			}
		}
	}
	raw := deepMerge(Defaults(), user)
	cfg := &Config{Root: root, Source: source, Raw: raw}
	cfg.normalize()
	return cfg, nil
}

func (c *Config) normalize() {
	siteCfg := c.Section("site")
	base := toString(siteCfg["base"])
	siteCfg["base"] = NormalizeBase(base)
}

// Section 返回配置中的一个对象段。
func (c *Config) Section(key string) map[string]any {
	if m, ok := c.Raw[key].(map[string]any); ok {
		return m
	}
	m := map[string]any{}
	c.Raw[key] = m
	return m
}

// Str 读取字符串配置。
func (c *Config) Str(key string) string { return toString(c.Raw[key]) }

// Int 读取整数配置。
func (c *Config) Int(key string, def int) int {
	if n, ok := toInt(c.Raw[key]); ok {
		return n
	}
	return def
}

// Bool 读取布尔配置。
func (c *Config) Bool(key string, def bool) bool {
	if b, ok := c.Raw[key].(bool); ok {
		return b
	}
	return def
}

// ---------- 工具 ----------

func deepMerge(base, extra map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		if bm, ok := out[k].(map[string]any); ok {
			if em, ok2 := v.(map[string]any); ok2 {
				out[k] = deepMerge(bm, em)
				continue
			}
		}
		out[k] = v
	}
	return out
}

func toString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return ""
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func toInt(v any) (int, bool) {
	switch x := v.(type) {
	case int:
		return x, true
	case int64:
		return int(x), true
	case float64:
		return int(x), true
	}
	return 0, false
}

// ---------- 简易 JS 对象字面量解析（用于 xfm.config.mjs） ----------

func parseJSLiteral(src string) map[string]any {
	src = stripJSComments(src)
	// 去掉 export default / module.exports =
	src = strings.TrimSpace(src)
	for _, pre := range []string{"export default", "module.exports =", "module.exports="} {
		if strings.HasPrefix(src, pre) {
			src = strings.TrimSpace(src[len(pre):])
			break
		}
	}
	p := &jsParser{s: src}
	v := p.parseValue()
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

type jsParser struct {
	s   string
	pos int
}

func (p *jsParser) skip() {
	for p.pos < len(p.s) {
		c := p.s[p.pos]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			p.pos++
			continue
		}
		break
	}
}

func (p *jsParser) parseValue() any {
	p.skip()
	if p.pos >= len(p.s) {
		return nil
	}
	c := p.s[p.pos]
	switch {
	case c == '{':
		return p.parseObject()
	case c == '[':
		return p.parseArray()
	case c == '"' || c == '\'' || c == '`':
		return p.parseString()
	case c == '-' || (c >= '0' && c <= '9'):
		return p.parseNumber()
	case isIdentStart(c):
		id := p.parseIdent()
		// 成员访问 process.env.X 等
		for p.pos < len(p.s) && p.s[p.pos] == '.' {
			p.pos++
			p.parseIdent()
			id = "" // 视为非字面量
		}
		switch id {
		case "true":
			return true
		case "false":
			return false
		case "null", "undefined":
			return nil
		}
		return id
	}
	p.pos++
	return nil
}

func (p *jsParser) parseObject() map[string]any {
	obj := map[string]any{}
	p.pos++ // {
	for {
		p.skip()
		if p.pos >= len(p.s) || p.s[p.pos] == '}' {
			p.pos++
			return obj
		}
		var key string
		c := p.s[p.pos]
		if c == '"' || c == '\'' || c == '`' {
			key = p.parseString()
		} else if isIdentStart(c) {
			key = p.parseIdent()
		} else {
			p.pos++
			continue
		}
		p.skip()
		if p.pos < len(p.s) && p.s[p.pos] == ':' {
			p.pos++
			obj[key] = p.parseOr()
		}
		p.skip()
		if p.pos < len(p.s) && p.s[p.pos] == ',' {
			p.pos++
		}
	}
}

func (p *jsParser) parseArray() []any {
	arr := []any{}
	p.pos++ // [
	for {
		p.skip()
		if p.pos >= len(p.s) || p.s[p.pos] == ']' {
			p.pos++
			return arr
		}
		arr = append(arr, p.parseOr())
		p.skip()
		if p.pos < len(p.s) && p.s[p.pos] == ',' {
			p.pos++
		}
	}
}

// parseOr 处理 `a || b` 回退（取第一个真值）。
func (p *jsParser) parseOr() any {
	left := p.parseValue()
	for {
		p.skip()
		if p.pos+1 < len(p.s) && p.s[p.pos] == '|' && p.s[p.pos+1] == '|' {
			p.pos += 2
			right := p.parseValue()
			if jsTruthy(left) {
				continue
			}
			left = right
			continue
		}
		return left
	}
}

func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	}
	return true
}

func (p *jsParser) parseString() string {
	q := p.s[p.pos]
	p.pos++
	var b strings.Builder
	for p.pos < len(p.s) {
		c := p.s[p.pos]
		if c == '\\' && p.pos+1 < len(p.s) {
			n := p.s[p.pos+1]
			switch n {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			default:
				b.WriteByte(n)
			}
			p.pos += 2
			continue
		}
		if c == q {
			p.pos++
			break
		}
		b.WriteByte(c)
		p.pos++
	}
	return b.String()
}

func (p *jsParser) parseNumber() any {
	start := p.pos
	for p.pos < len(p.s) && (p.s[p.pos] == '-' || p.s[p.pos] == '.' || (p.s[p.pos] >= '0' && p.s[p.pos] <= '9')) {
		p.pos++
	}
	raw := p.s[start:p.pos]
	if strings.Contains(raw, ".") {
		var f float64
		fmt.Sscanf(raw, "%f", &f)
		return f
	}
	var n int64
	fmt.Sscanf(raw, "%d", &n)
	return n
}

func (p *jsParser) parseIdent() string {
	start := p.pos
	for p.pos < len(p.s) && isIdentPart(p.s[p.pos]) {
		p.pos++
	}
	return p.s[start:p.pos]
}

func isIdentStart(c byte) bool {
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentPart(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9')
}

func stripJSComments(src string) string {
	var b strings.Builder
	var quote byte
	for i := 0; i < len(src); i++ {
		c := src[i]
		if quote != 0 {
			b.WriteByte(c)
			if c == '\\' && i+1 < len(src) {
				b.WriteByte(src[i+1])
				i++
			} else if c == quote {
				quote = 0
			}
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			quote = c
			b.WriteByte(c)
			continue
		}
		if c == '/' && i+1 < len(src) && src[i+1] == '/' {
			for i < len(src) && src[i] != '\n' {
				i++
			}
			b.WriteByte('\n')
			continue
		}
		if c == '/' && i+1 < len(src) && src[i+1] == '*' {
			i += 2
			for i+1 < len(src) && !(src[i] == '*' && src[i+1] == '/') {
				i++
			}
			i++
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}
