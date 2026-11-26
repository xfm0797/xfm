// Package markdown 是 xfm 静态站点生成器的 Markdown 渲染器（纯 Go 重写）。
// 行为对齐 lib/engine/markdown.js：块级线性扫描 + 行内一次扫描，
// 支持标题锚点/TOC、围栏与缩进代码块、GFM 表格、引用、任务列表、嵌套列表、
// ::: 提示容器、引用式链接、脚注、原始 HTML 透传与内置语法高亮。
package markdown

import (
	"regexp"
	"strings"
)

// Heading 是采集到的标题（用于目录）。
type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	ID    string `json:"id"`
}

// Options 控制渲染行为。
type Options struct {
	// Headings 非 nil 时收集 h1~h3 标题。
	Headings *[]Heading
	// Link 用于把相对 .md 链接解析成站点 URL。
	Link func(href string) string
	// Highlight 为 false 时关闭代码高亮。
	Highlight bool
}

var escReplacer = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")

// EscapeHTML 转义 HTML 特殊字符。
func EscapeHTML(s string) string {
	if !strings.ContainsAny(s, "&<>\"") {
		return s
	}
	return escReplacer.Replace(s)
}

var reTagStrip = regexp.MustCompile(`<[^>]+>`)
var reNonWord = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// Slugify 生成 URL 友好锚点：保留中英文与数字，其余折叠为 -。
func Slugify(text string, used map[string]bool) string {
	base := strings.ToLower(text)
	base = reTagStrip.ReplaceAllString(base, "")
	base = reNonWord.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "section"
	}
	if used == nil {
		return base
	}
	slug := base
	i := 1
	for used[slug] {
		slug = base + "-" + itoa(i)
		i++
	}
	used[slug] = true
	return slug
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// ---------- 状态 ----------

type refDef struct {
	href  string
	title string
}

type footnoteDef struct {
	key    string
	lines  []string
	refs   []int
	number int
}

type state struct {
	refs      map[string]refDef
	footnotes map[string]*footnoteDef
	fnOrder   []*footnoteDef
	used      map[string]bool
	headings  *[]Heading
	anchors   bool
}

type env struct {
	link  func(string) string
	refs  map[string]refDef
	state *state
}

func createState(opts *Options) *state {
	st := &state{
		refs:      map[string]refDef{},
		footnotes: map[string]*footnoteDef{},
		used:      map[string]bool{},
		anchors:   true,
	}
	if opts != nil && opts.Headings != nil {
		st.headings = opts.Headings
	}
	return st
}

// ---------- 块级正则 ----------

var (
	reFence     = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})\\s*([^\\s`]*)?\\s*(.*)$")
	reHeading   = regexp.MustCompile(`^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$`)
	reSetext    = regexp.MustCompile(`^ {0,3}(=+|-+)[ \t]*$`)
	reQuote     = regexp.MustCompile(`^ {0,3}>\s?(.*)$`)
	reItem      = regexp.MustCompile(`^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$`)
	reContainer = regexp.MustCompile(`^ {0,3}:{3,}\s*(\w*)\s*(.*)$`)
	reIndent    = regexp.MustCompile("^(?: {4}|\\t)")
	reRefDef    = regexp.MustCompile(`^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+["'(]([^"')]*)["')])?[ \t]*$`)
	reFnDef     = regexp.MustCompile(`^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$`)
	reRawHTML   = regexp.MustCompile(`^ {0,3}<[a-zA-Z!/]`)
	reCellSep   = regexp.MustCompile(`^:?-+:?$`)
	reFenceCl   = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})\\s*$")
)

func isHR(line string) bool {
	i := 0
	for i < len(line) && i < 3 && line[i] == ' ' {
		i++
	}
	if i >= len(line) {
		return false
	}
	c := line[i]
	if c != '-' && c != '*' && c != '_' {
		return false
	}
	count := 1
	j := i + 1
	for j < len(line) {
		// 跳过空白
		for j < len(line) && (line[j] == ' ' || line[j] == '\t') {
			j++
		}
		if j >= len(line) {
			break
		}
		if line[j] != c {
			return false
		}
		count++
		j++
	}
	return count >= 3
}

func startsBlock(line string) bool {
	if reHeading.MatchString(line) || reFence.MatchString(line) || isHR(line) ||
		reQuote.MatchString(line) || reContainer.MatchString(line) || reIndent.MatchString(line) ||
		reRawHTML.MatchString(line) {
		return true
	}
	if m := reItem.FindStringSubmatch(line); m != nil && len(m[1]) <= 3 {
		return true
	}
	return false
}

func lazyBreak(line string) bool {
	return reHeading.MatchString(line) || reFence.MatchString(line) || isHR(line) ||
		reQuote.MatchString(line) || reContainer.MatchString(line) || reRawHTML.MatchString(line)
}

// ---------- 公共 API ----------

// Render 渲染 Markdown 为 HTML。
func Render(src string, opts *Options) string {
	if src == "" {
		return ""
	}
	st := createState(opts)
	return renderInternal(src, opts, st, true)
}

// StripDuplicateH1 当正文首行 H1 与页面标题重复时移除它。
func StripDuplicateH1(html, title string) string {
	if html == "" || title == "" {
		return html
	}
	m := reH1.FindStringSubmatchIndex(html)
	if m == nil {
		return html
	}
	inner := html[m[2]:m[3]]
	text := strings.TrimSpace(htmlText(inner))
	if text == strings.TrimSpace(title) {
		return html[m[1]:]
	}
	return html
}

var reH1 = regexp.MustCompile(`(?s)^<h1[^>]*>(.*?)</h1>\s*`)

func htmlText(s string) string {
	s = reTagStrip.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "&amp;", "&")
	return s
}

func renderInternal(src string, opts *Options, st *state, top bool) string {
	if src == "" {
		return ""
	}
	src = strings.ReplaceAll(src, "\r\n", "\n")
	src = strings.ReplaceAll(src, "\r", "\n")
	lines := strings.Split(src, "\n")
	skip := collectDefinitions(lines, st)
	es := &env{refs: st.refs, state: st}
	if opts != nil {
		es.link = opts.Link
	}
	var out []string
	var buf []string

	flush := func() {
		if len(buf) == 0 {
			return
		}
		if len(buf) == 1 {
			out = append(out, "<p>"+inline(buf[0], es, 0)+"</p>")
		} else {
			var acc strings.Builder
			for k, b := range buf {
				if k > 0 {
					acc.WriteString("<br>")
				}
				acc.WriteString(inline(b, es, 0))
			}
			out = append(out, "<p>"+acc.String()+"</p>")
		}
		buf = nil
	}

	pushHeading := func(level int, text string) {
		plain := headingText(text)
		id := ""
		if st.anchors {
			id = Slugify(plain, st.used)
			if plain == "" {
				id = Slugify(text, st.used)
			}
		}
		if level <= 3 && st.anchors && st.headings != nil {
			*st.headings = append(*st.headings, Heading{Level: level, Text: plain, ID: id})
		}
		if id != "" {
			out = append(out, "<h"+itoa(level)+" id=\""+id+"\">"+inline(text, es, 0)+"</h"+itoa(level)+">")
		} else {
			out = append(out, "<h"+itoa(level)+">"+inline(text, es, 0)+"</h"+itoa(level)+">")
		}
	}

	i := 0
	for i < len(lines) {
		line := lines[i]
		if skip[i] {
			if len(buf) > 0 {
				buf = append(buf, line)
				i++
				continue
			}
			i++
			continue
		}
		if strings.TrimSpace(line) == "" {
			flush()
			i++
			continue
		}

		// 围栏代码
		if fm := reFence.FindStringSubmatch(line); fm != nil {
			flush()
			marker := fm[1]
			lang := strings.ToLower(fm[2])
			meta := fm[3]
			var body []string
			i++
			for i < len(lines) {
				l := lines[i]
				if isFenceClose(l, marker) {
					i++
					break
				}
				body = append(body, l)
				i++
			}
			code := strings.Join(body, "\n")
			var hl string
			if opts != nil && !opts.Highlight {
				hl = EscapeHTML(code)
			} else {
				hl = Highlight(code, lang)
			}
			title := ""
			if meta != "" && !strings.HasPrefix(meta, "{") && !strings.HasPrefix(meta, "[") {
				title = `<div class="code-title">` + EscapeHTML(meta) + `</div>`
			}
			langClass := lang
			if langClass == "" {
				langClass = "text"
			}
			out = append(out, `<div class="code-block">`+title+`<pre class="language-`+langClass+`"><code>`+hl+`</code></pre></div>`)
			continue
		}

		// ATX 标题
		if h := reHeading.FindStringSubmatch(line); h != nil {
			flush()
			pushHeading(len(h[1]), h[2])
			i++
			continue
		}

		// Setext 标题
		if len(buf) > 0 && reSetext.MatchString(line) {
			text := strings.TrimSpace(strings.Join(buf, " "))
			buf = nil
			level := 2
			if strings.TrimSpace(line)[0] == '=' {
				level = 1
			}
			pushHeading(level, text)
			i++
			continue
		}

		// 分隔线
		if isHR(line) {
			flush()
			out = append(out, "<hr>")
			i++
			continue
		}

		// ::: 容器
		if cm := reContainer.FindStringSubmatch(line); cm != nil {
			flush()
			typ := cm[1]
			if typ == "" {
				typ = "info"
			}
			title := cm[2]
			var body []string
			i++
			for i < len(lines) && !reCloseContainer.MatchString(lines[i]) {
				body = append(body, lines[i])
				i++
			}
			i++ // 跳过结束 :::
			titleHTML := ""
			if title != "" {
				titleHTML = `<div class="callout-title">` + inline(title, es, 0) + `</div>`
			}
			out = append(out, `<div class="callout callout-`+typ+`">`+titleHTML+renderInternal(strings.Join(body, "\n"), opts, st, false)+`</div>`)
			continue
		}

		// 引用
		if reQuote.MatchString(line) {
			flush()
			var body []string
			for i < len(lines) && (reQuote.MatchString(lines[i]) || (len(body) > 0 && strings.TrimSpace(lines[i]) != "" && !reFence.MatchString(lines[i]))) {
				if m := reQuote.FindStringSubmatch(lines[i]); m != nil {
					body = append(body, m[1])
				} else {
					body = append(body, lines[i])
				}
				i++
			}
			out = append(out, "<blockquote>"+renderInternal(strings.Join(body, "\n"), opts, st, false)+"</blockquote>")
			continue
		}

		// 表格
		if strings.Contains(line, "|") && i+1 < len(lines) && isTableSep(lines[i+1]) && strings.Contains(lines[i+1], "-") {
			flush()
			head := splitRow(line)
			aligns := make([]string, 0)
			for _, c := range splitRow(lines[i+1]) {
				switch {
				case strings.HasPrefix(c, ":") && strings.HasSuffix(c, ":"):
					aligns = append(aligns, "center")
				case strings.HasSuffix(c, ":"):
					aligns = append(aligns, "right")
				case strings.HasPrefix(c, ":"):
					aligns = append(aligns, "left")
				default:
					aligns = append(aligns, "")
				}
			}
			i += 2
			var rows [][]string
			for i < len(lines) && strings.Contains(lines[i], "|") && strings.TrimSpace(lines[i]) != "" {
				rows = append(rows, splitRow(lines[i]))
				i++
			}
			var b strings.Builder
			b.WriteString(`<div class="table-wrap"><table><thead><tr>`)
			for k, c := range head {
				b.WriteString("<th" + alignAttr(aligns, k) + ">" + inline(c, es, 0) + "</th>")
			}
			b.WriteString("</tr></thead><tbody>")
			for _, r := range rows {
				b.WriteString("<tr>")
				for k := 0; k < len(head); k++ {
					cell := ""
					if k < len(r) {
						cell = r[k]
					}
					b.WriteString("<td" + alignAttr(aligns, k) + ">" + inline(cell, es, 0) + "</td>")
				}
				b.WriteString("</tr>")
			}
			b.WriteString("</tbody></table></div>")
			out = append(out, b.String())
			continue
		}

		// 列表
		if it := reItem.FindStringSubmatch(line); it != nil && len(it[1]) <= 3 {
			flush()
			ordered := it[2][0] >= '0' && it[2][0] <= '9'
			startNum := 1
			if ordered {
				startNum = atoiSafe(it[2])
			}
			html, next := parseList(lines, i, len(it[1]), ordered, es, opts, startNum)
			out = append(out, html)
			i = next
			continue
		}

		// 缩进代码块
		if len(buf) == 0 && reIndent.MatchString(line) {
			var body []string
			i++
			body = append(body, reIndent.ReplaceAllString(line, ""))
			for i < len(lines) {
				l := lines[i]
				if reIndent.MatchString(l) {
					body = append(body, reIndent.ReplaceAllString(l, ""))
					i++
					continue
				}
				if strings.TrimSpace(l) == "" {
					body = append(body, "")
					i++
					continue
				}
				break
			}
			for len(body) > 0 && strings.TrimSpace(body[len(body)-1]) == "" {
				body = body[:len(body)-1]
			}
			out = append(out, `<div class="code-block"><pre class="language-text"><code>`+EscapeHTML(strings.Join(body, "\n"))+`</code></pre></div>`)
			continue
		}

		// 原始 HTML 块
		if reRawHTML.MatchString(line) {
			flush()
			body := []string{line}
			i++
			opens := len(reOpenTag.FindAllString(line, -1))
			closes := len(reCloseTag.FindAllString(line, -1))
			if opens > closes && !strings.HasSuffix(line, "/>") {
				for i < len(lines) {
					l := lines[i]
					i++
					body = append(body, l)
					if strings.Contains(l, "</") {
						break
					}
				}
			}
			out = append(out, strings.Join(body, "\n"))
			continue
		}

		// 段落
		buf = append(buf, stripLeadSpaces(line))
		i++
	}
	flush()

	if top && len(st.fnOrder) > 0 {
		out = append(out, renderFootnoteSection(st, opts))
	}
	return strings.Join(out, "\n")
}

var (
	reCloseContainer = regexp.MustCompile(`^\s*:::\s*$`)
	reOpenTag        = regexp.MustCompile(`<([a-zA-Z][\w-]*)[^/>]*>`)
	reCloseTag       = regexp.MustCompile(`</([a-zA-Z][\w-]*)>`)
)

// stripLeadSpaces 去掉行首 1~3 个空格（仅当其后紧跟非空白字符）。
func stripLeadSpaces(line string) string {
	n := 0
	for n < len(line) && n < 3 && line[n] == ' ' {
		n++
	}
	if n > 0 && n < len(line) && line[n] != ' ' && line[n] != '\t' {
		return line[n:]
	}
	return line
}

func alignAttr(aligns []string, k int) string {
	if k < len(aligns) && aligns[k] != "" {
		return ` style="text-align:` + aligns[k] + `"`
	}
	return ""
}

func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	if n == 0 {
		return 1
	}
	return n
}

func isFenceClose(line, marker string) bool {
	m := reFenceCl.FindStringSubmatch(line)
	if m == nil {
		return false
	}
	return m[1][0] == marker[0] && len(m[1]) >= len(marker)
}

func isTableSep(line string) bool {
	cells := splitRow(line)
	if len(cells) == 0 {
		return false
	}
	hasDash := false
	for _, c := range cells {
		if !reCellSep.MatchString(c) {
			return false
		}
		if strings.Contains(c, "-") {
			hasDash = true
		}
	}
	return hasDash
}

func splitRow(line string) []string {
	s := strings.TrimSpace(line)
	if strings.HasPrefix(s, "|") {
		s = s[1:]
	}
	if strings.HasSuffix(s, "|") {
		s = s[:len(s)-1]
	}
	var cells []string
	var cur strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '\\' && i+1 < len(s) && s[i+1] == '|' {
			cur.WriteByte('|')
			i++
			continue
		}
		if c == '|' {
			cells = append(cells, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	cells = append(cells, strings.TrimSpace(cur.String()))
	return cells
}

// ---------- 定义收集 ----------

func collectDefinitions(lines []string, st *state) []bool {
	skip := make([]bool, len(lines))
	fence := ""
	prev := ""
	prevDef := false
	atParagraphStart := func() bool {
		return strings.TrimSpace(prev) == "" || prevDef || startsBlock(prev)
	}

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if fence != "" {
			if isFenceClose(line, fence) {
				fence = ""
			}
			prev = line
			prevDef = false
			continue
		}
		if f := reFence.FindStringSubmatch(line); f != nil {
			fence = f[1]
			prev = line
			prevDef = false
			continue
		}
		if strings.TrimSpace(line) == "" {
			prev = ""
			prevDef = false
			continue
		}

		if fn := reFnDef.FindStringSubmatch(line); fn != nil && atParagraphStart() {
			body := []string{fn[2]}
			skip[i] = true
			for i+1 < len(lines) {
				next := lines[i+1]
				if strings.TrimSpace(next) == "" {
					if i+2 < len(lines) && reIndent.MatchString(lines[i+2]) {
						body = append(body, "")
						i++
						skip[i] = true
						continue
					}
					break
				}
				if reIndent.MatchString(next) {
					body = append(body, reIndent.ReplaceAllString(next, ""))
					i++
					skip[i] = true
					continue
				}
				if reLeadOnePlus.MatchString(next) && !startsBlock(next) && !reFnDef.MatchString(next) && !reRefDef.MatchString(next) {
					body = append(body, strings.TrimSpace(next))
					i++
					skip[i] = true
					continue
				}
				break
			}
			key := refKey(fn[1])
			if _, ok := st.footnotes[key]; !ok {
				st.footnotes[key] = &footnoteDef{key: key, lines: body}
			}
			prev = lines[i]
			prevDef = true
			continue
		}

		if rd := reRefDef.FindStringSubmatch(line); rd != nil && rd[1][0] != '^' && atParagraphStart() {
			key := refKey(rd[1])
			if key != "" {
				if _, ok := st.refs[key]; !ok {
					st.refs[key] = refDef{href: rd[2], title: rd[3]}
				}
			}
			skip[i] = true
			prevDef = true
			continue
		}

		prev = line
		prevDef = false
	}
	return skip
}

var reLeadOnePlus = regexp.MustCompile(`^ +\S`)

func refKey(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(s)), " "))
}

func headingText(t string) string {
	t = reImgLink.ReplaceAllString(t, "$1")
	t = reLink.ReplaceAllString(t, "$1")
	t = reRefLink.ReplaceAllString(t, "$1")
	t = reFnRefOnly.ReplaceAllString(t, "")
	t = strings.NewReplacer("`", "", "*", "", "_", "", "~", "").Replace(t)
	return strings.TrimSpace(t)
}

var (
	reImgLink   = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	reLink      = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	reRefLink   = regexp.MustCompile(`\[([^\]]*)\]\[[^\]]*\]`)
	reFnRefOnly = regexp.MustCompile(`\[\^[^\]]*\]`)
)

func renderFootnoteSection(st *state, opts *Options) string {
	var b strings.Builder
	b.WriteString("<section class=\"footnotes\">\n<ol>")
	for _, def := range st.fnOrder {
		body := renderInternal(strings.TrimSpace(strings.Join(def.lines, "\n")), opts, st, false)
		var backs []string
		for _, n := range def.refs {
			if n > 1 {
				backs = append(backs, `<a href="#fnref-`+EscapeHTML(def.key)+`-`+itoa(n)+`" class="footnote-back" aria-label="返回正文">↩</a>`)
			} else {
				backs = append(backs, `<a href="#fnref-`+EscapeHTML(def.key)+`" class="footnote-back" aria-label="返回正文">↩</a>`)
			}
		}
		b.WriteString("\n<li id=\"fn-" + EscapeHTML(def.key) + "\">" + body + " " + strings.Join(backs, " ") + "</li>")
	}
	b.WriteString("\n</ol>\n</section>")
	return b.String()
}

// ---------- 列表 ----------

type listPart struct {
	typ  string // p / list / block
	text string
	html string
}

func parseList(lines []string, start, indent int, ordered bool, es *env, opts *Options, startNum int) (string, int) {
	tag := "ul"
	attrs := ` class="md-list"`
	if ordered {
		tag = "ol"
		if startNum != 1 {
			attrs = ` start="` + itoa(startNum) + `"`
		} else {
			attrs = ""
		}
	}

	type item struct {
		parts []listPart
		task  int // -1 无任务, 0 未完成, 1 完成
	}
	var items []item
	loose := false
	i := start

	blockHTML := func(text string) string {
		return renderInternal(text, opts, es.state, false)
	}

	for i < len(lines) {
		m := reItem.FindStringSubmatch(lines[i])
		if m == nil {
			break
		}
		ind := len(m[1])
		itemOrdered := m[2][0] >= '0' && m[2][0] <= '9'
		if ind != indent || itemOrdered != ordered {
			break
		}
		contentIndent := ind + len(m[2]) + 1
		gap := len(m[3])
		content := m[4]
		if gap >= 5 {
			content = strings.Repeat(" ", gap-1) + m[4]
		}
		parts := []listPart{}
		task := -1
		if tk := reTask.MatchString(content); tk {
			sm := reTask.FindStringSubmatch(content)
			if sm[1] != " " {
				task = 1
			} else {
				task = 0
			}
			content = content[len(sm[0]):]
		}

		flush := func() {
			if strings.TrimSpace(content) != "" {
				parts = append(parts, listPart{typ: "p", text: content})
			}
			content = ""
		}
		i++

		// 项首缩进代码块
		if strings.TrimSpace(content) != "" && reIndent.MatchString(content) {
			codeIndent := contentIndent + 4
			codeLines := []string{reIndent.ReplaceAllString(content, "")}
			for i < len(lines) {
				l := lines[i]
				if strings.TrimSpace(l) == "" {
					j := i
					for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
						j++
					}
					if j < len(lines) && leadingSpaces(lines[j]) >= codeIndent {
						codeLines = append(codeLines, "")
						i = j
						continue
					}
					break
				}
				if leadingSpaces(l) < codeIndent {
					break
				}
				codeLines = append(codeLines, l[codeIndent:])
				i++
			}
			for len(codeLines) > 0 && strings.TrimSpace(codeLines[len(codeLines)-1]) == "" {
				codeLines = codeLines[:len(codeLines)-1]
			}
			parts = append(parts, listPart{typ: "block", html: `<div class="code-block"><pre class="language-text"><code>` + EscapeHTML(strings.Join(codeLines, "\n")) + `</code></pre></div>`})
			content = ""
		}

		for i < len(lines) {
			l := lines[i]
			if strings.TrimSpace(l) == "" {
				j := i
				for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
					j++
				}
				if j >= len(lines) {
					i = j
					break
				}
				nx := lines[j]
				nInd := leadingSpaces(nx)
				nm := reItem.FindStringSubmatch(nx)
				if nm != nil && nInd <= indent {
					if nInd == indent && (nm[2][0] >= '0' && nm[2][0] <= '9') == ordered {
						loose = true
						i = j
					}
					break
				}
				if nInd < contentIndent {
					break
				}
				loose = true
				flush()
				gotLines, next := collectItemRest(lines, j, contentIndent)
				parts = append(parts, listPart{typ: "block", html: blockHTML(strings.Join(gotLines, "\n"))})
				i = next
				continue
			}

			if li := reItem.FindStringSubmatch(l); li != nil {
				lInd := len(li[1])
				if lInd <= indent {
					break
				}
				flush()
				sub, next := parseList(lines, i, lInd, li[2][0] >= '0' && li[2][0] <= '9', es, opts, atoiSafe(li[2]))
				parts = append(parts, listPart{typ: "list", html: sub})
				i = next
				continue
			}
			lInd := leadingSpaces(l)

			if lInd > ind && content != "" && reSetext.MatchString(l) {
				text := content
				content = ""
				prefix := "## "
				if strings.TrimSpace(l)[0] == '=' {
					prefix = "# "
				}
				parts = append(parts, listPart{typ: "block", html: blockHTML(prefix + text)})
				i++
				continue
			}

			if lInd > ind && (reQuote.MatchString(l) || reFence.MatchString(l) || reContainer.MatchString(l) || isHR(l)) {
				flush()
				gotLines, next := collectItemBlock(lines, i, contentIndent)
				parts = append(parts, listPart{typ: "block", html: blockHTML(strings.Join(gotLines, "\n"))})
				i = next
				continue
			}

			if lInd > ind {
				content += " " + strings.TrimSpace(l)
				i++
				continue
			}
			if lazyBreak(l) {
				break
			}
			content += " " + strings.TrimSpace(l)
			i++
		}

		flush()
		items = append(items, item{parts: parts, task: task})
	}

	var b strings.Builder
	b.WriteString("<" + tag + attrs + ">")
	for _, it := range items {
		wrapP := loose
		for _, p := range it.parts {
			if p.typ == "block" {
				wrapP = true
			}
		}
		var bodyParts []string
		for _, p := range it.parts {
			if p.typ == "p" {
				if wrapP {
					bodyParts = append(bodyParts, "<p>"+inline(p.text, es, 0)+"</p>")
				} else {
					bodyParts = append(bodyParts, inline(p.text, es, 0))
				}
			} else {
				bodyParts = append(bodyParts, p.html)
			}
		}
		sep := ""
		if wrapP {
			sep = "\n"
		}
		body := strings.Join(bodyParts, sep)
		if it.task >= 0 {
			cls := "task-box"
			check := ""
			if it.task == 1 {
				cls += " done"
				check = "✓"
			}
			box := `<span class="` + cls + `">` + check + `</span>`
			b.WriteString(`<li class="task">` + box + body + `</li>`)
		} else {
			b.WriteString("<li>" + body + "</li>")
		}
	}
	b.WriteString("</" + tag + ">")
	return b.String(), i
}

var reTask = regexp.MustCompile(`^\[([ xX])\]\s+`)

func leadingSpaces(s string) int {
	n := 0
	for n < len(s) && s[n] == ' ' {
		n++
	}
	return n
}

func collectItemBlock(lines []string, i, contentIndent int) ([]string, int) {
	dedent := func(l string) string {
		n := leadingSpaces(l)
		if n > contentIndent {
			n = contentIndent
		}
		return l[n:]
	}
	var out []string
	j := i

	if fm := reFence.FindStringSubmatch(lines[i]); fm != nil {
		marker := fm[1]
		for ; j < len(lines); j++ {
			out = append(out, dedent(lines[j]))
			if j > i && isFenceClose(lines[j], marker) {
				j++
				break
			}
		}
		return out, j
	}
	if reContainer.MatchString(lines[i]) {
		for ; j < len(lines); j++ {
			out = append(out, dedent(lines[j]))
			if j > i && reCloseContainer.MatchString(lines[j]) {
				j++
				break
			}
		}
		return out, j
	}
	if reQuote.MatchString(lines[i]) {
		for j < len(lines) {
			if reQuote.MatchString(lines[j]) {
				out = append(out, dedent(lines[j]))
				j++
				continue
			}
			if strings.TrimSpace(lines[j]) == "" && j+1 < len(lines) && reQuote.MatchString(lines[j+1]) {
				out = append(out, "")
				j++
				continue
			}
			break
		}
		return out, j
	}
	out = append(out, dedent(lines[i]))
	return out, i + 1
}

func collectItemRest(lines []string, start, contentIndent int) ([]string, int) {
	var out []string
	j := start
	for j < len(lines) {
		l := lines[j]
		if strings.TrimSpace(l) == "" {
			out = append(out, "")
			j++
			continue
		}
		if leadingSpaces(l) < contentIndent {
			break
		}
		out = append(out, l[contentIndent:])
		j++
	}
	for len(out) > 0 && strings.TrimSpace(out[len(out)-1]) == "" {
		out = out[:len(out)-1]
	}
	return out, j
}
