// Package frontmatter 解析 Markdown 文件头部的 YAML 子集。
// 行为与 xfm 的 lib/engine/frontmatter.js 对齐：
// 支持 key: value、缩进嵌套、- 列表、行内 [a, b] / {k: v}、引号、布尔/数字/日期原值。
package frontmatter

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

var (
	reInt  = regexp.MustCompile(`^-?\d+$`)
	reNum  = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
	reList = regexp.MustCompile(`^\s*-\s|^\s*-$`)
	reItem = regexp.MustCompile(`^\s*-(\s|$)`)
)

// ParseScalar 解析一个 YAML 标量值。
func ParseScalar(raw string) any {
	v := strings.TrimSpace(raw)
	if v == "" || v == "~" || v == "null" {
		return nil
	}
	if v == "true" {
		return true
	}
	if v == "false" {
		return false
	}
	if reNum.MatchString(v) {
		if reInt.MatchString(v) {
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				return n
			}
		}
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	if strings.HasPrefix(v, `"`) && strings.HasSuffix(v, `"`) && len(v) >= 2 {
		var s string
		if err := json.Unmarshal([]byte(v), &s); err == nil {
			return s
		}
		return strings.ReplaceAll(v[1:len(v)-1], `\n`, "\n")
	}
	if strings.HasPrefix(v, "'") && strings.HasSuffix(v, "'") && len(v) >= 2 {
		return strings.ReplaceAll(v[1:len(v)-1], "''", "'")
	}
	if strings.HasPrefix(v, "[") && strings.HasSuffix(v, "]") {
		parts := strings.Split(v[1:len(v)-1], ",")
		out := make([]any, 0, len(parts))
		for _, p := range parts {
			val := ParseScalar(p)
			if val != nil {
				out = append(out, val)
			}
		}
		return out
	}
	if strings.HasPrefix(v, "{") && strings.HasSuffix(v, "}") {
		o := map[string]any{}
		for _, pair := range strings.Split(v[1:len(v)-1], ",") {
			i := strings.Index(pair, ":")
			if i > -1 {
				o[strings.TrimSpace(pair[:i])] = ParseScalar(pair[i+1:])
			}
		}
		return o
	}
	return v
}

func indentOf(l string) int {
	return len(l) - len(strings.TrimLeft(l, " \t"))
}

func isBlankOrComment(l string) bool {
	t := strings.TrimSpace(l)
	return t == "" || strings.HasPrefix(t, "#")
}

// ParseYAML 解析 YAML 文本为通用对象。
func ParseYAML(src string) any {
	lines := strings.Split(src, "\n")
	i := 0
	var parseBlock func(minIndent int) any
	parseBlock = func(minIndent int) any {
		if i >= len(lines) {
			return nil
		}
		first := lines[i]
		if reList.MatchString(first) {
			arr := []any{}
			for i < len(lines) {
				l := lines[i]
				if isBlankOrComment(l) {
					i++
					continue
				}
				if indentOf(l) < minIndent || !reItem.MatchString(l) {
					break
				}
				rest := strings.TrimSpace(strings.TrimSpace(l)[1:])
				i++
				if rest == "" {
					arr = append(arr, parseBlock(indentOf(l)+1))
				} else if regexp.MustCompile(`^[^:]+:(\s|$)`).MatchString(rest) {
					obj := map[string]any{}
					objIndent := indentOf(l) + 2
					idx := strings.Index(rest, ":")
					k := rest[:idx]
					val := ""
					if idx+1 <= len(rest) {
						val = strings.TrimSpace(rest[idx+1:])
					}
					if val != "" {
						obj[strings.TrimSpace(k)] = ParseScalar(val)
					} else {
						obj[strings.TrimSpace(k)] = parseBlock(objIndent)
					}
					for i < len(lines) && strings.TrimSpace(lines[i]) != "" && indentOf(lines[i]) >= objIndent && !reItem.MatchString(lines[i]) {
						line2 := lines[i]
						ci := strings.Index(line2, ":")
						if ci == -1 {
							i++
							continue
						}
						k2 := strings.TrimSpace(line2[:ci])
						v2 := strings.TrimSpace(line2[ci+1:])
						i++
						if v2 != "" {
							obj[k2] = ParseScalar(v2)
						} else {
							obj[k2] = parseBlock(indentOf(line2) + 1)
						}
					}
					arr = append(arr, obj)
				} else {
					arr = append(arr, ParseScalar(rest))
				}
			}
			return arr
		}

		obj := map[string]any{}
		for i < len(lines) {
			l := lines[i]
			if isBlankOrComment(l) {
				i++
				continue
			}
			if indentOf(l) < minIndent {
				break
			}
			ci := strings.Index(l, ":")
			if ci == -1 {
				i++
				continue
			}
			key := strings.TrimSpace(l[:ci])
			val := strings.TrimSpace(l[ci+1:])
			i++
			if val == "" {
				if i < len(lines) && strings.TrimSpace(lines[i]) != "" && indentOf(lines[i]) > indentOf(l) {
					obj[key] = parseBlock(indentOf(lines[i]))
				} else {
					obj[key] = nil
				}
			} else if val == "|" || val == ">" {
				body := []string{}
				baseIndent := 0
				if i < len(lines) {
					baseIndent = indentOf(lines[i])
				}
				for i < len(lines) && (strings.TrimSpace(lines[i]) == "" || indentOf(lines[i]) >= baseIndent) {
					body = append(body, sliceFrom(lines[i], baseIndent))
					i++
				}
				if val == "|" {
					obj[key] = strings.TrimRight(strings.Join(body, "\n"), "\n")
				} else {
					obj[key] = strings.TrimSpace(strings.Join(body, " "))
				}
			} else {
				obj[key] = ParseScalar(val)
			}
		}
		return obj
	}
	res := parseBlock(0)
	if res == nil {
		return map[string]any{}
	}
	return res
}

func sliceFrom(s string, n int) string {
	// 按字节切分不安全（中文），按 rune 计算缩进更稳妥
	r := []rune(s)
	if n >= len(r) {
		return ""
	}
	return string(r[n:])
}

// Result 是拆分 front-matter 后的结果。
type Result struct {
	Data    map[string]any
	Content string
	Raw     string
}

// Parse 拆分并解析 front-matter。
func Parse(raw string) Result {
	src := strings.TrimPrefix(raw, "\ufeff")
	if !strings.HasPrefix(src, "---") {
		return Result{Data: map[string]any{}, Content: src, Raw: src}
	}
	end := strings.Index(src[3:], "\n---")
	if end == -1 {
		return Result{Data: map[string]any{}, Content: src, Raw: src}
	}
	end += 3
	head := ""
	if end >= 4 {
		head = src[4:end]
	}
	content := src[end+4:]
	content = strings.TrimPrefix(content, "\n")
	data := map[string]any{}
	if v, ok := ParseYAML(head).(map[string]any); ok && v != nil {
		data = v
	}
	return Result{Data: data, Content: content, Raw: src}
}
