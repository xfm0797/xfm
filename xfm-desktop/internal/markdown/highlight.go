package markdown

import (
	"regexp"
	"strings"
)

type langConfig struct {
	kw     string
	line   []string
	block  []string
	quotes []string
	kind   string // "" 普通 / "plain" / "markup" / "css"
}

var langs = map[string]langConfig{
	"js":       {kw: "const let var function return if else for while do switch case break continue class extends new this typeof instanceof import export default from async await try catch finally throw yield of in delete void null undefined true false", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'", "`"}},
	"ts":       {kw: "const let var function return if else for while do switch case break continue class extends implements interface type enum namespace declare new this typeof instanceof import export default from async await try catch finally throw yield of in delete void null undefined true false as public private protected readonly abstract string number boolean any never unknown", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'", "`"}},
	"jsx":      {kw: "const let var function return if else for while class extends new this import export default from async await try catch finally throw typeof null undefined true false", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'", "`"}},
	"tsx":      {kw: "const let var function return if else for while class extends interface type new import export default from async await try catch finally null undefined true false", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'", "`"}},
	"java":     {kw: "public private protected class interface extends implements new return if else for while switch case break continue static final void int long double float boolean char String import package try catch finally throw throws this super null true false", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'"}},
	"c":        {kw: "int char float double void return if else for while switch case break continue struct union enum typedef const static sizeof extern include define unsigned long short", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'"}},
	"cpp":      {kw: "int char float double void return if else for while switch case break continue struct class union enum typedef const static sizeof namespace using template typename public private protected new delete this nullptr true false bool auto", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'"}},
	"csharp":   {kw: "public private protected class interface struct new return if else for while switch case break continue static readonly void int string bool var using namespace try catch finally throw this null true false async await", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'"}},
	"go":       {kw: "package import func return if else for range switch case default break continue type struct interface var const map chan go defer select nil true false fallthrough", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "`"}},
	"rust":     {kw: "fn let mut const static struct enum impl trait pub use mod return if else for while loop match break continue move ref self Self unsafe async await dyn where crate super true false None Some Ok Err", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\""}},
	"swift":    {kw: "func let var class struct enum protocol extension import return if else for while switch case break continue public private internal static self nil true false guard defer", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\""}},
	"kotlin":   {kw: "fun val var class object interface import return if else for while when break continue public private internal open override data sealed null true false", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\""}},
	"scala":    {kw: "def val var class object trait import return if else for while match case break object extends with new null true false", line: []string{"//"}, block: []string{"/*", "*/"}, quotes: []string{"\""}},
	"php":      {kw: "function class return if else for while switch case break continue public private protected static new echo namespace use try catch finally throw null true false", line: []string{"//", "#"}, block: []string{"/*", "*/"}, quotes: []string{"\"", "'"}},
	"json":     {kw: "true false null", quotes: []string{"\""}},
	"python":   {kw: "def class return if elif else for while in not and or import from as pass break continue try except finally with lambda yield global nonlocal None True False raise assert del is async await", line: []string{"#"}, quotes: []string{"\"", "'"}},
	"bash":     {kw: "if then else elif fi for in do done while until case esac function return export local readonly echo cd ls mkdir rm cp mv cat grep sed awk curl exit source set shift", line: []string{"#"}, quotes: []string{"\"", "'"}},
	"yaml":     {kw: "true false null yes no on off", line: []string{"#"}, quotes: []string{"\"", "'"}},
	"html":     {kind: "markup"},
	"css":      {kind: "css"},
	"markdown": {kind: "plain"},
}

var langAlias = map[string]string{
	"javascript": "js", "typescript": "ts", "node": "js", "mjs": "js", "cjs": "js",
	"shell": "bash", "sh": "bash", "zsh": "bash", "console": "bash", "terminal": "bash",
	"python3": "python", "py": "python",
	"golang": "go", "rs": "rust",
	"cxx": "cpp", "c++": "cpp", "h": "c", "hpp": "cpp",
	"cs": "csharp", "c#": "csharp",
	"yml": "yaml", "jsonc": "json", "json5": "json",
	"html5": "html", "htm": "html", "vue": "html", "svelte": "html", "xml": "html", "svg": "html",
	"scss": "css", "sass": "css", "less": "css", "stylus": "css",
	"md": "markdown", "text": "markdown", "txt": "markdown", "plain": "markdown",
}

func normalizeLang(lang string) string {
	l := strings.ToLower(lang)
	if a, ok := langAlias[l]; ok {
		return a
	}
	return l
}

// Highlight 内置轻量语法高亮。
func Highlight(code, lang string) string {
	id := normalizeLang(lang)
	cfg, ok := langs[id]
	if !ok || cfg.kind == "plain" {
		return EscapeHTML(code)
	}
	if cfg.kind == "markup" {
		return highlightMarkup(code)
	}
	if cfg.kind == "css" {
		return highlightCSS(code)
	}
	quotes := map[byte]bool{}
	for _, q := range cfg.quotes {
		if q != "" {
			quotes[q[0]] = true
		}
	}
	special := map[byte]bool{}
	for _, p := range cfg.line {
		if p != "" {
			special[p[0]] = true
		}
	}
	if len(cfg.block) == 2 && cfg.block[0] != "" {
		special[cfg.block[0][0]] = true
	}
	for q := range quotes {
		special[q] = true
	}

	type seg struct {
		typ, text string
	}
	var segs []seg
	n := len(code)
	i := 0
	codeStart := 0
	for i < n {
		if !special[code[i]] {
			i++
			continue
		}
		matched := false
		if len(cfg.block) == 2 {
			open, close := cfg.block[0], cfg.block[1]
			if strings.HasPrefix(code[i:], open) {
				if i > codeStart {
					segs = append(segs, seg{"code", code[codeStart:i]})
				}
				endIdx := strings.Index(code[i+len(open):], close)
				stop := n
				if endIdx >= 0 {
					stop = i + len(open) + endIdx + len(close)
				}
				segs = append(segs, seg{"comment", code[i:stop]})
				i = stop
				codeStart = i
				matched = true
			}
		}
		if matched {
			continue
		}
		for _, p := range cfg.line {
			if p != "" && strings.HasPrefix(code[i:], p) {
				if i > codeStart {
					segs = append(segs, seg{"code", code[codeStart:i]})
				}
				end := strings.IndexByte(code[i:], '\n')
				if end < 0 {
					end = n
				} else {
					end += i
				}
				segs = append(segs, seg{"comment", code[i:end]})
				i = end
				codeStart = i
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		ch := code[i]
		if quotes[ch] {
			j := i + 1
			for j < n {
				if code[j] == '\\' {
					j += 2
					continue
				}
				if code[j] == ch {
					j++
					break
				}
				if code[j] == '\n' && ch != '`' {
					break
				}
				j++
			}
			if j > i+1 {
				if i > codeStart {
					segs = append(segs, seg{"code", code[codeStart:i]})
				}
				segs = append(segs, seg{"string", code[i:j]})
				i = j
				codeStart = i
				matched = true
			}
		}
		if matched {
			continue
		}
		i++
	}
	if codeStart < n {
		segs = append(segs, seg{"code", code[codeStart:]})
	}

	var out strings.Builder
	for _, s := range segs {
		switch s.typ {
		case "comment":
			out.WriteString(`<span class="hl-c">` + EscapeHTML(s.text) + `</span>`)
		case "string":
			out.WriteString(`<span class="hl-s">` + EscapeHTML(s.text) + `</span>`)
		default:
			out.WriteString(paintCode(EscapeHTML(s.text), id))
		}
	}
	return out.String()
}

var kwCache = map[string]*regexp.Regexp{}

func paintCode(escaped, id string) string {
	cfg, ok := langs[id]
	if !ok || cfg.kw == "" {
		return escaped
	}
	re, ok := kwCache[id]
	if !ok {
		words := strings.Fields(cfg.kw)
		re = regexp.MustCompile(`\b(?:` + strings.Join(words, "|") + `)\b`)
		kwCache[id] = re
	}
	escaped = re.ReplaceAllString(escaped, `<span class="hl-k">$0</span>`)
	escaped = reNumber.ReplaceAllString(escaped, `<span class="hl-n">$1</span>`)
	return escaped
}

var reNumber = regexp.MustCompile(`\b(0x[\da-fA-F]+|\d+(?:\.\d+)?)\b`)

var (
	reTagPaint  = regexp.MustCompile(`^(</?)([a-zA-Z][\w:-]*)([\s\S]*?)(/?>)$`)
	reAttrPaint = regexp.MustCompile("([\\w:@.\\[\\]-]+)(\\s*=\\s*)(\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+)?")
)

func highlightMarkup(code string) string {
	var out strings.Builder
	n := len(code)
	i := 0
	for i < n {
		if strings.HasPrefix(code[i:], "<!--") {
			end := strings.Index(code[i+4:], "-->")
			stop := n
			if end >= 0 {
				stop = i + 4 + end + 3
			}
			out.WriteString(`<span class="hl-c">` + EscapeHTML(code[i:stop]) + `</span>`)
			i = stop
			continue
		}
		if code[i] == '<' {
			end := strings.IndexByte(code[i:], '>')
			stop := n
			if end >= 0 {
				stop = i + end + 1
			}
			out.WriteString(paintTag(code[i:stop]))
			i = stop
			continue
		}
		next := strings.IndexByte(code[i:], '<')
		if next < 0 {
			next = n
		} else {
			next += i
		}
		out.WriteString(EscapeHTML(code[i:next]))
		i = next
	}
	return out.String()
}

func paintTag(tag string) string {
	m := reTagPaint.FindStringSubmatch(tag)
	if m == nil {
		return EscapeHTML(tag)
	}
	open, name, attrs, close := m[1], m[2], m[3], m[4]
	paintAttrs := func(raw string) string {
		var b strings.Builder
		last := 0
		for _, am := range reAttrPaint.FindAllStringSubmatchIndex(raw, -1) {
			b.WriteString(EscapeHTML(raw[last:am[0]]))
			b.WriteString(`<span class="hl-a">` + EscapeHTML(raw[am[2]:am[3]]) + `</span>`)
			if am[4] >= 0 {
				b.WriteString(EscapeHTML(raw[am[4]:am[5]]))
			}
			if am[6] >= 0 {
				b.WriteString(`<span class="hl-s">` + EscapeHTML(raw[am[6]:am[7]]) + `</span>`)
			}
			last = am[1]
		}
		b.WriteString(EscapeHTML(raw[last:]))
		return b.String()
	}
	return `<span class="hl-p">` + EscapeHTML(open) + `</span><span class="hl-k">` + EscapeHTML(name) + `</span>` + paintAttrs(attrs) + `<span class="hl-p">` + EscapeHTML(close) + `</span>`
}

func highlightCSS(code string) string {
	n := len(code)
	i := 0
	readUntil := func(stops string) string {
		start := i
		for i < n {
			c := code[i]
			if c == '/' && i+1 < n && code[i+1] == '*' {
				e := strings.Index(code[i+2:], "*/")
				if e < 0 {
					i = n
				} else {
					i = i + 2 + e + 2
				}
				continue
			}
			if c == '"' || c == '\'' {
				q := c
				i++
				for i < n && code[i] != q {
					i++
				}
				i++
				continue
			}
			if strings.IndexByte(stops, c) >= 0 {
				break
			}
			i++
		}
		if i > n {
			i = n
		}
		return code[start:i]
	}

	var paintDecls func() string
	paintDecls = func() string {
		var out strings.Builder
		for i < n {
			c := code[i]
			if c == '}' {
				i++
				return out.String() + `<span class="hl-p">}</span>`
			}
			if c == ';' {
				i++
				out.WriteString(`<span class="hl-p">;</span>`)
				continue
			}
			if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
				j := i
				for j < n && (code[j] == ' ' || code[j] == '\t' || code[j] == '\n' || code[j] == '\r') {
					j++
				}
				out.WriteString(code[i:j])
				i = j
				continue
			}
			if c == '/' && i+1 < n && code[i+1] == '*' {
				e := strings.Index(code[i+2:], "*/")
				stop := n
				if e >= 0 {
					stop = i + 2 + e + 2
				}
				out.WriteString(`<span class="hl-c">` + EscapeHTML(code[i:stop]) + `</span>`)
				i = stop
				continue
			}
			head := readUntil("{};:")
			if i < n && code[i] == '{' {
				i++
				out.WriteString(`<span class="hl-k">` + EscapeHTML(head) + `</span><span class="hl-p">{</span>`)
				out.WriteString(paintDecls())
				continue
			}
			if i < n && code[i] == ':' {
				i++
				value := readUntil(";}")
				out.WriteString(`<span class="hl-a">` + EscapeHTML(head) + `</span><span class="hl-p">:</span><span class="hl-s">` + EscapeHTML(value) + `</span>`)
				continue
			}
			out.WriteString(EscapeHTML(head))
			if i < n && (code[i] == ';' || code[i] == '}') {
				continue
			}
			if i >= n {
				break
			}
		}
		return out.String()
	}

	var out strings.Builder
	for i < n {
		if code[i] == '/' && i+1 < n && code[i+1] == '*' {
			e := strings.Index(code[i+2:], "*/")
			stop := n
			if e >= 0 {
				stop = i + 2 + e + 2
			}
			out.WriteString(`<span class="hl-c">` + EscapeHTML(code[i:stop]) + `</span>`)
			i = stop
			continue
		}
		if code[i] == '}' {
			i++
			continue
		}
		sel := readUntil("{}")
		if strings.TrimSpace(sel) != "" {
			cls := "hl-k"
			if strings.HasPrefix(strings.TrimLeft(sel, " \t\n\r"), "@") {
				cls = "hl-p"
			}
			out.WriteString(`<span class="` + cls + `">` + EscapeHTML(sel) + `</span>`)
		} else if sel != "" {
			out.WriteString(sel)
		}
		if i < n && code[i] == '{' {
			i++
			out.WriteString(`<span class="hl-p">{</span>`)
			out.WriteString(paintDecls())
		} else if i < n {
			i++
		}
	}
	return out.String()
}
