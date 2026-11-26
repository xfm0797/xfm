package markdown

import (
	"strings"
	"unicode/utf8"
)

// inline 行内解析。优先级与 JS 引擎一致：
// 转义 → 脚注引用 → 行内代码 → 自动链接 → 行内链接/图片 →
// 完整引用 → 简写引用 → 加粗 → 删除线 → 斜体 * → 斜体 _ → 裸链接。
func inline(text string, es *env, depth int) string {
	if depth > 8 {
		return EscapeHTML(text)
	}
	var out strings.Builder
	var plain strings.Builder
	flush := func() {
		if plain.Len() > 0 {
			out.WriteString(EscapeHTML(plain.String()))
			plain.Reset()
		}
	}
	i := 0
	for i < len(text) {
		if html, consumed, ok := tryInline(text, i, es, depth); ok {
			flush()
			out.WriteString(html)
			i += consumed
			continue
		}
		_, size := utf8.DecodeRuneInString(text[i:])
		if size == 0 {
			size = 1
		}
		plain.WriteString(text[i : i+size])
		i += size
	}
	flush()
	return out.String()
}

func tryInline(text string, i int, es *env, depth int) (string, int, bool) {
	c := text[i]

	// 1. 反斜杠转义
	if c == '\\' && i+1 < len(text) && isEscapable(text[i+1]) {
		return EscapeHTML(string(text[i+1])), 2, true
	}

	// 2. 脚注引用 [^id]
	if c == '[' && i+1 < len(text) && text[i+1] == '^' {
		j := strings.IndexByte(text[i+2:], ']')
		if j >= 0 {
			j += i + 2
			id := text[i+2 : j]
			if id != "" && !strings.ContainsAny(id, " \t\n\r") {
				return footnoteRef(id, es), j + 1 - i, true
			}
		}
	}

	// 3. 行内代码
	if c == '`' {
		if html, consumed, ok := tryCode(text, i); ok {
			return html, consumed, true
		}
	}

	// 4. 自动链接 <http://...>
	if c == '<' {
		if html, consumed, ok := tryAutolink(text, i); ok {
			return html, consumed, true
		}
	}

	// 5/6/7. 链接、图片、引用
	if c == '[' || (c == '!' && i+1 < len(text) && text[i+1] == '[') {
		if html, consumed, ok := tryLinks(text, i, es, depth); ok {
			return html, consumed, true
		}
	}

	// 8. 加粗
	if c == '*' && i+1 < len(text) && text[i+1] == '*' {
		if html, consumed, ok := tryDelimited(text, i, "**", "strong", es, depth); ok {
			return html, consumed, true
		}
	}

	// 9. 删除线
	if c == '~' && i+1 < len(text) && text[i+1] == '~' {
		if html, consumed, ok := tryDelimited(text, i, "~~", "del", es, depth); ok {
			return html, consumed, true
		}
	}

	// 10. 斜体 *
	if c == '*' {
		if html, consumed, ok := tryItalic(text, i, '*', es, depth); ok {
			return html, consumed, true
		}
	}

	// 11. 斜体 _
	if c == '_' {
		if html, consumed, ok := tryItalic(text, i, '_', es, depth); ok {
			return html, consumed, true
		}
	}

	// 12. 裸链接
	if c == 'h' {
		if html, consumed, ok := tryBareURL(text, i); ok {
			return html, consumed, true
		}
	}

	return "", 0, false
}

func isEscapable(b byte) bool {
	switch b {
	case '\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>', '~', '|':
		return true
	}
	return false
}

func tryCode(text string, i int) (string, int, bool) {
	n := 0
	for i+n < len(text) && text[i+n] == '`' {
		n++
	}
	if n == 0 {
		return "", 0, false
	}
	// 模拟 JS 正则 (`+)([\s\S]*?)\3 的回溯：先尝试最长闭合标记，找不到再缩短。
	for k := n; k >= 1; k-- {
		marker := strings.Repeat("`", k)
		rest := text[i+k:]
		idx := strings.Index(rest, marker)
		if idx < 0 {
			continue
		}
		content := rest[:idx]
		trimmed := strings.TrimSpace(content)
		if trimmed == "" {
			trimmed = content
		}
		return "<code>" + EscapeHTML(trimmed) + "</code>", k + idx + k, true
	}
	return "", 0, false
}

func tryAutolink(text string, i int) (string, int, bool) {
	rest := text[i+1:]
	var url string
	if strings.HasPrefix(rest, "http://") || strings.HasPrefix(rest, "https://") {
		end := strings.IndexByte(rest, '>')
		if end < 0 {
			return "", 0, false
		}
		url = rest[:end]
		if strings.ContainsAny(url, " \t\n\r") {
			return "", 0, false
		}
		return `<a href="` + EscapeHTML(url) + `" rel="noopener">` + EscapeHTML(url) + `</a>`, end + 2, true
	}
	return "", 0, false
}

func tryLinks(text string, i int, es *env, depth int) (string, int, bool) {
	img := false
	start := i
	if text[i] == '!' {
		img = true
		if i+1 >= len(text) || text[i+1] != '[' {
			return "", 0, false
		}
		i++
	}
	if text[i] != '[' {
		return "", 0, false
	}
	closeLabel := strings.IndexByte(text[i+1:], ']')
	if closeLabel < 0 {
		return "", 0, false
	}
	closeLabel += i + 1
	label := text[i+1 : closeLabel]
	after := closeLabel + 1

	// 行内链接/图片 [text](url "title")
	if after < len(text) && text[after] == '(' {
		end := strings.IndexByte(text[after+1:], ')')
		if end < 0 {
			return "", 0, false
		}
		end += after + 1
		inner := text[after+1 : end]
		url, title := splitURLTitle(inner)
		if url != "" && !strings.ContainsAny(url, " \t\n\r") {
			return linkTag(url, label, title, es, depth, img), end + 1 - start, true
		}
	}

	// 完整引用 [text][ref]
	if after < len(text) && text[after] == '[' {
		closeRef := strings.IndexByte(text[after+1:], ']')
		if closeRef >= 0 {
			closeRef += after + 1
			ref := text[after+1 : closeRef]
			key := refKey(ref)
			if key == "" {
				key = refKey(label)
			}
			consumed := closeRef + 1 - start
			if def, ok := es.refs[key]; ok && key != "" {
				return linkTag(def.href, label, def.title, es, depth, img), consumed, true
			}
			return EscapeHTML(text[start : closeRef+1]), consumed, true
		}
	}

	// 简写引用 [ref]（后面不是 ( 或 [）
	if !img && after < len(text) && text[after] != '(' && text[after] != '[' && label != "" {
		key := refKey(label)
		if def, ok := es.refs[key]; ok {
			return linkTag(def.href, label, def.title, es, depth, false), closeLabel + 1 - start, true
		}
		return EscapeHTML(text[start : closeLabel+1]), closeLabel + 1 - start, true
	}

	return "", 0, false
}

func splitURLTitle(inner string) (string, string) {
	inner = strings.TrimSpace(inner)
	if inner == "" {
		return "", ""
	}
	// url 为第一个非空白片段
	sp := strings.IndexAny(inner, " \t")
	if sp < 0 {
		return inner, ""
	}
	url := inner[:sp]
	rest := strings.TrimSpace(inner[sp+1:])
	if len(rest) >= 2 {
		if (rest[0] == '"' && rest[len(rest)-1] == '"') || (rest[0] == '\'' && rest[len(rest)-1] == '\'') {
			return url, rest[1 : len(rest)-1]
		}
	}
	return url, ""
}

func linkTag(href, label, title string, es *env, depth int, isImg bool) string {
	url := href
	if es.link != nil {
		url = es.link(href)
	}
	titleAttr := ""
	if title != "" {
		titleAttr = ` title="` + EscapeHTML(title) + `"`
	}
	if isImg {
		return `<img src="` + EscapeHTML(url) + `" alt="` + EscapeHTML(label) + `"` + titleAttr + ` loading="lazy" decoding="async">`
	}
	external := strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://")
	tgt := ""
	if external {
		tgt = ` target="_blank" rel="noopener"`
	}
	return `<a href="` + EscapeHTML(url) + `"` + titleAttr + tgt + `>` + inline(label, es, depth+1) + `</a>`
}

func tryDelimited(text string, i int, marker, tag string, es *env, depth int) (string, int, bool) {
	contentStart := i + len(marker)
	rest := text[contentStart:]
	idx := strings.Index(rest, marker)
	if idx <= 0 {
		return "", 0, false
	}
	content := rest[:idx]
	if strings.ContainsAny(content, "\n") {
		return "", 0, false
	}
	if marker == "**" && strings.Contains(content, "*") {
		return "", 0, false
	}
	if marker == "~~" && strings.Contains(content, "~") {
		return "", 0, false
	}
	consumed := len(marker) + idx + len(marker)
	return "<" + tag + ">" + inline(content, es, depth+1) + "</" + tag + ">", consumed, true
}

func tryItalic(text string, i int, ch byte, es *env, depth int) (string, int, bool) {
	// 前界：不能是 '*'/'_'（同类标记）或单词字符
	if r, ok := runeBefore(text, i); ok {
		if r == rune(ch) || isASCIIWord(r) {
			return "", 0, false
		}
	}
	j := strings.IndexByte(text[i+1:], ch)
	if j < 0 {
		return "", 0, false
	}
	j += i + 1
	if j == i+1 {
		return "", 0, false // 空内容
	}
	content := text[i+1 : j]
	if strings.ContainsAny(content, "\n") {
		return "", 0, false
	}
	// 后界
	if r, ok := runeAfter(text, j+1); ok {
		if r == rune(ch) || isASCIIWord(r) {
			return "", 0, false
		}
	}
	// 若 marker 是 ** 形式，会由加粗优先处理；这里单字符
	return "<em>" + inline(content, es, depth+1) + "</em>", j + 1 - i, true
}

func tryBareURL(text string, i int) (string, int, bool) {
	rest := text[i:]
	var end int
	if strings.HasPrefix(rest, "http://") {
		end = 7
	} else if strings.HasPrefix(rest, "https://") {
		end = 8
	} else {
		return "", 0, false
	}
	// 收集合法字符
	k := end
	for k < len(rest) {
		r, size := utf8.DecodeRuneInString(rest[k:])
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			break
		}
		if r == '<' || r == '>' || r == '(' || r == ')' || r == '"' {
			break
		}
		if isCJK(r) {
			break
		}
		k += size
	}
	url := rest[:k]
	// 去掉尾部标点
	for len(url) > end {
		r, size := utf8.DecodeLastRuneInString(url)
		if r == '.' || r == ',' || r == ';' || r == ':' || r == '!' || r == '?' || isCJK(r) {
			url = url[:len(url)-size]
			continue
		}
		break
	}
	if len(url) <= end {
		return "", 0, false
	}
	return `<a href="` + EscapeHTML(url) + `" target="_blank" rel="noopener">` + EscapeHTML(url) + `</a>`, len(url), true
}

func isCJK(r rune) bool {
	return (r >= 0x4e00 && r <= 0x9fff) || (r >= 0x3400 && r <= 0x4dbf)
}

func isASCIIWord(r rune) bool {
	return r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}

func runeBefore(s string, i int) (rune, bool) {
	if i <= 0 {
		return 0, false
	}
	r, _ := utf8.DecodeLastRuneInString(s[:i])
	return r, true
}

func runeAfter(s string, i int) (rune, bool) {
	if i >= len(s) {
		return 0, false
	}
	r, _ := utf8.DecodeRuneInString(s[i:])
	return r, true
}

func footnoteRef(id string, es *env) string {
	raw := "[^" + id + "]"
	if es.state == nil {
		return EscapeHTML(raw)
	}
	def, ok := es.state.footnotes[refKey(id)]
	if !ok {
		return EscapeHTML(raw)
	}
	n := len(def.refs) + 1
	def.refs = append(def.refs, n)
	if def.number == 0 {
		es.state.fnOrder = append(es.state.fnOrder, def)
		def.number = len(es.state.fnOrder)
	}
	anchor := "fnref-" + def.key
	if n > 1 {
		anchor += "-" + itoa(n)
	}
	return `<sup class="footnote-ref"><a href="#fn-` + EscapeHTML(def.key) + `" id="` + EscapeHTML(anchor) + `">` + itoa(def.number) + `</a></sup>`
}
