package plugin

import (
	"encoding/base64"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

func init() { Register("math", newMath) }

const (
	mOpen       = '\uE000'
	mClose      = '\uE001'
	mBlockOpen  = '\uE002'
	mBlockClose = '\uE003'
)

const mathDefaultCDN = "https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css"

const mathCSS = `<style>
.m-math{font-family:"Latin Modern Math","STIX Two Math",Cambria Math,"Times New Roman",serif;font-size:1.05em;line-height:1.35}
.m-math.m-display{display:block;text-align:center;margin:1.1em 0;overflow-x:auto}
.m-math sup,.m-math sub{font-size:.7em;line-height:0}
.m-frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 .18em}
.m-frac>.m-num{border-bottom:1px solid currentColor;padding:0 .22em;line-height:1.15}
.m-frac>.m-den{padding:0 .22em;line-height:1.15}
.m-sqrt{display:inline-flex;align-items:flex-start;vertical-align:middle;margin:0 .1em}
.m-sqrt>.m-rad{font-size:1.1em;line-height:1}
.m-sqrt>.m-radicand{border-top:1px solid currentColor;padding:0 .15em}
.m-table{display:inline-table;border-collapse:collapse;vertical-align:middle}
.m-row{display:table-row}
.m-cell{display:table-cell;text-align:center;padding:.12em .38em}
.m-delim{font-size:1.15em;vertical-align:middle;padding:0 .1em}
.m-func,.m-rm,.m-text,.m-bb{font-style:normal}
.m-bf{font-weight:600}
.m-it{font-style:italic}
.m-unknown{color:#b45309}
.m-space{display:inline-block}
</style>`

var reMathPlaceholder = regexp.MustCompile(string(mOpen) + `([di])([A-Za-z0-9_-]+)` + string(mClose))
var reMathBlockPlaceholder = regexp.MustCompile(string(mBlockOpen) + `(\d+)` + string(mBlockClose))

// math：构建期渲染公式（Go 内置的 TeX 子集渲染器，对齐 Node 版插件行为）。
func newMath(h Host) *Instance {
	conf := h.Section("math")
	cssMode := defaultStr(Str(conf, "css"), "local")
	cdn := defaultStr(Str(conf, "cdn"), mathDefaultCDN)
	base := Str(h.SiteConfig(), "base")

	return &Instance{
		Name: "math",
		Markdown: func(src string, page *Doc) string {
			if src == "" || (!strings.Contains(src, "$") && !strings.Contains(src, `\(`) && !strings.Contains(src, `\[`)) {
				return src
			}
			blocks := []string{}
			text := protectCodeBlocks(src, &blocks)
			text = protectMath(text)
			text = restoreCodeBlocks(text, blocks)
			return text
		},
		TransformHTML: func(html string, page *Doc) string {
			if !strings.ContainsRune(html, mOpen) {
				return html
			}
			used := false
			out := reMathPlaceholder.ReplaceAllStringFunc(html, func(m string) string {
				sub := reMathPlaceholder.FindStringSubmatch(m)
				if len(sub) != 3 {
					return m
				}
				tex, err := base64.RawURLEncoding.DecodeString(sub[2])
				if err != nil {
					return m
				}
				used = true
				return renderTeX(string(tex), sub[1] == "d")
			})
			if !used || cssMode == "none" {
				return out
			}
			css := mathCSS
			if cssMode == "cdn" {
				css = `<link rel="stylesheet" href="` + EscHTML(WithBase(base, cdn)) + `">` + mathCSS
			}
			if loc := reHeadClose.FindStringIndex(out); loc != nil {
				return out[:loc[0]] + css + "\n" + out[loc[0]:]
			}
			return out
		},
	}
}

// ---------- 公式占位 ----------

func mathToken(tex string, display bool) string {
	kind := "i"
	if display {
		kind = "d"
	}
	return string(mOpen) + kind + base64.RawURLEncoding.EncodeToString([]byte(tex)) + string(mClose)
}

func protectCodeBlocks(src string, blocks *[]string) string {
	lines := strings.Split(src, "\n")
	var out []string
	fence := ""
	prevBlank := true
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if fence != "" {
			out = append(out, line)
			trimmed := strings.TrimSpace(line)
			if len(trimmed) >= len(fence) && strings.HasPrefix(trimmed, fence) && strings.Trim(trimmed, string(fence[0])) == "" {
				fence = ""
			}
			prevBlank = false
			continue
		}
		t := strings.TrimLeft(line, " ")
		indent := len(line) - len(t)
		if indent <= 3 && (strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~")) {
			fence = t[:3]
			out = append(out, line)
			prevBlank = false
			continue
		}
		if prevBlank && (strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t")) {
			var body []string
			j := i
			for j < len(lines) && (strings.TrimSpace(lines[j]) == "" || strings.HasPrefix(lines[j], "    ") || strings.HasPrefix(lines[j], "\t")) {
				body = append(body, lines[j])
				j++
			}
			*blocks = append(*blocks, strings.Join(body, "\n"))
			out = append(out, string(mBlockOpen)+itoa(len(*blocks)-1)+string(mBlockClose))
			prevBlank = false
			i = j - 1
			continue
		}
		out = append(out, line)
		prevBlank = strings.TrimSpace(line) == ""
	}
	return strings.Join(out, "\n")
}

func restoreCodeBlocks(src string, blocks []string) string {
	if len(blocks) == 0 {
		return src
	}
	return reMathBlockPlaceholder.ReplaceAllStringFunc(src, func(m string) string {
		sub := reMathBlockPlaceholder.FindStringSubmatch(m)
		if len(sub) != 2 {
			return ""
		}
		n := 0
		for _, c := range sub[1] {
			n = n*10 + int(c-'0')
		}
		if n >= 0 && n < len(blocks) {
			return blocks[n]
		}
		return ""
	})
}

func protectMath(text string) string {
	var out strings.Builder
	i, n := 0, len(text)
	for i < n {
		c := text[i]
		if c == '\\' {
			if i+1 >= n {
				out.WriteByte(c)
				i++
				continue
			}
			next := text[i+1]
			if next == '$' {
				out.WriteByte('$')
				i += 2
				continue
			}
			if next == '[' || next == '(' {
				close := `\]`
				if next == '(' {
					close = `\)`
				}
				if end := strings.Index(text[i+2:], close); end != -1 {
					tex := strings.TrimSpace(text[i+2 : i+2+end])
					if tex != "" {
						out.WriteString(mathToken(tex, next == '['))
						i = i + 2 + end + 2
						continue
					}
				}
			}
			out.WriteByte(c)
			out.WriteByte(next)
			i += 2
			continue
		}
		if c == '`' {
			j := i
			for j < n && text[j] == '`' {
				j++
			}
			run := text[i:j]
			if end := strings.Index(text[j:], run); end != -1 {
				out.WriteString(text[i : j+end+len(run)])
				i = j + end + len(run)
			} else {
				out.WriteString(run)
				i = j
			}
			continue
		}
		if c == '$' {
			if i+1 < n && text[i+1] == '$' {
				if end := strings.Index(text[i+2:], "$$"); end != -1 {
					tex := strings.TrimSpace(text[i+2 : i+2+end])
					if tex != "" {
						out.WriteString(mathToken(tex, true))
						i = i + 2 + end + 2
						continue
					}
				}
				out.WriteString("$$")
				i += 2
				continue
			}
			// 行内 $…$：不跨行、开 $ 后不留空白、闭 $ 前不是反斜杠、闭 $ 后不接数字
			j := i + 1
			if j < n && !isSpaceByte(text[j]) {
				k := j
				for k < n && text[k] != '$' && text[k] != '\n' {
					k++
				}
				if k < n && text[k] == '$' && k > j && text[k-1] != '\\' &&
					(k+1 >= n || text[k+1] < '0' || text[k+1] > '9') {
					tex := text[j:k]
					if strings.TrimSpace(tex) == tex && tex != "" {
						out.WriteString(mathToken(tex, false))
						i = k + 1
						continue
					}
				}
			}
			out.WriteByte('$')
			i++
			continue
		}
		out.WriteByte(c)
		i++
	}
	return out.String()
}

func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

// ---------- TeX → HTML ----------

type texParser struct {
	r []rune
	i int
}

func renderTeX(src string, display bool) string {
	html := renderFragment(src)
	class := "m-math"
	if display {
		class += " m-display"
	}
	return `<span class="` + class + `">` + html + `</span>`
}

func renderFragment(src string) string {
	p := &texParser{r: []rune(src)}
	return p.parseSeq()
}

func (p *texParser) peek() rune {
	if p.i < len(p.r) {
		return p.r[p.i]
	}
	return 0
}

func (p *texParser) skipSpace() {
	for p.i < len(p.r) && (p.r[p.i] == ' ' || p.r[p.i] == '\t' || p.r[p.i] == '\n' || p.r[p.i] == '\r') {
		p.i++
	}
}

func (p *texParser) parseSeq() string {
	var atoms []string
	for p.i < len(p.r) {
		c := p.r[p.i]
		switch c {
		case '}':
			return strings.Join(atoms, "")
		case '{':
			p.i++
			inner := p.parseSeq()
			if p.peek() == '}' {
				p.i++
			}
			atoms = append(atoms, inner)
		case '^', '_':
			p.i++
			arg := p.parseArg()
			if len(atoms) == 0 {
				atoms = append(atoms, "")
			}
			last := atoms[len(atoms)-1]
			if c == '^' {
				last += "<sup>" + arg + "</sup>"
			} else {
				last += "<sub>" + arg + "</sub>"
			}
			atoms[len(atoms)-1] = last
		case '\\':
			atoms = append(atoms, p.parseCommand())
		case '~':
			p.i++
			atoms = append(atoms, "&nbsp;")
		case '&':
			p.i++
			atoms = append(atoms, `<span class="m-space" style="width:.5em"></span>`)
		case ' ', '\t', '\n', '\r':
			p.i++
		default:
			p.i++
			atoms = append(atoms, EscHTML(string(c)))
		}
	}
	return strings.Join(atoms, "")
}

func (p *texParser) parseArg() string {
	p.skipSpace()
	if p.i >= len(p.r) {
		return ""
	}
	switch p.r[p.i] {
	case '{':
		p.i++
		s := p.parseSeq()
		if p.peek() == '}' {
			p.i++
		}
		return s
	case '}':
		return ""
	case '\\':
		return p.parseCommand()
	default:
		c := p.r[p.i]
		p.i++
		return EscHTML(string(c))
	}
}

func (p *texParser) parseRawGroup() string {
	p.skipSpace()
	if p.peek() != '{' {
		return ""
	}
	p.i++
	depth := 1
	start := p.i
	for p.i < len(p.r) {
		switch p.r[p.i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				s := string(p.r[start:p.i])
				p.i++
				return s
			}
		}
		p.i++
	}
	return string(p.r[start:])
}

func (p *texParser) parseCommand() string {
	p.i++ // 反斜杠
	if p.i >= len(p.r) {
		return ""
	}
	c := p.r[p.i]
	if !unicode.IsLetter(c) {
		p.i++
		return p.specialCommand(c)
	}
	start := p.i
	for p.i < len(p.r) && unicode.IsLetter(p.r[p.i]) {
		p.i++
	}
	return p.namedCommand(string(p.r[start:p.i]))
}

func (p *texParser) specialCommand(c rune) string {
	switch c {
	case '\\':
		return "<br>"
	case ',':
		return `<span class="m-space" style="width:.17em"></span>`
	case ';':
		return `<span class="m-space" style="width:.28em"></span>`
	case ':':
		return `<span class="m-space" style="width:.22em"></span>`
	case '!':
		return ""
	case ' ':
		return " "
	case '{', '}', '%', '$', '&', '#', '_':
		return EscHTML(string(c))
	case '|':
		return "‖"
	}
	return EscHTML(string(c))
}

var texSymbols = map[string]string{
	"cdot": "·", "times": "×", "div": "÷", "pm": "±", "mp": "∓",
	"le": "≤", "leq": "≤", "ge": "≥", "geq": "≥", "ne": "≠", "neq": "≠",
	"approx": "≈", "equiv": "≡", "sim": "∼", "simeq": "≃", "propto": "∝",
	"infty": "∞", "partial": "∂", "nabla": "∇", "sum": "∑", "prod": "∏",
	"int": "∫", "oint": "∮", "to": "→", "rightarrow": "→", "leftarrow": "←",
	"Rightarrow": "⇒", "Leftarrow": "⇐", "leftrightarrow": "↔", "mapsto": "↦",
	"in": "∈", "notin": "∉", "subset": "⊂", "subseteq": "⊆", "cup": "∪",
	"cap": "∩", "forall": "∀", "exists": "∃", "neg": "¬", "land": "∧",
	"lor": "∨", "cdots": "⋯", "ldots": "…", "dots": "…", "vdots": "⋮",
	"qquad": "\u2003\u2003", "quad": "\u2003", "alpha": "α", "beta": "β",
	"gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ",
	"eta": "η", "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ",
	"lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π", "varpi": "ϖ",
	"rho": "ρ", "varrho": "ϱ", "sigma": "σ", "varsigma": "ς", "tau": "τ",
	"upsilon": "υ", "phi": "φ", "varphi": "ϕ", "chi": "χ", "psi": "ψ",
	"omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ",
	"Xi": "Ξ", "Pi": "Π", "Sigma": "Σ", "Upsilon": "Υ", "Phi": "Φ",
	"Psi": "Ψ", "Omega": "Ω",
}

var texFunctions = map[string]string{
	"sin": "sin", "cos": "cos", "tan": "tan", "cot": "cot", "sec": "sec",
	"csc": "csc", "log": "log", "ln": "ln", "exp": "exp", "det": "det",
	"lim": "lim", "max": "max", "min": "min", "sup": "sup", "inf": "inf",
	"gcd": "gcd", "arcsin": "arcsin", "arccos": "arccos", "arctan": "arctan",
}

var texAccents = map[string]string{
	"hat": "\u0302", "bar": "\u0304", "vec": "\u20d7", "dot": "\u0307",
	"ddot": "\u0308", "tilde": "\u0303",
}

func (p *texParser) namedCommand(name string) string {
	switch name {
	case "frac", "dfrac", "tfrac":
		num := p.parseArg()
		den := p.parseArg()
		return `<span class="m-frac"><span class="m-num">` + num + `</span><span class="m-den">` + den + `</span></span>`
	case "sqrt":
		index := ""
		p.skipSpace()
		if p.peek() == '[' {
			p.i++
			start := p.i
			for p.i < len(p.r) && p.r[p.i] != ']' {
				p.i++
			}
			index = renderFragment(string(p.r[start:p.i]))
			if p.peek() == ']' {
				p.i++
			}
		}
		body := p.parseArg()
		if index != "" {
			return `<span class="m-sqrt"><sup>` + index + `</sup><span class="m-rad">√</span><span class="m-radicand">` + body + `</span></span>`
		}
		return `<span class="m-sqrt"><span class="m-rad">√</span><span class="m-radicand">` + body + `</span></span>`
	case "text", "mbox":
		return `<span class="m-text">` + EscHTML(p.parseRawGroup()) + `</span>`
	case "mathrm":
		return `<span class="m-rm">` + p.parseArg() + `</span>`
	case "mathbf":
		return `<span class="m-bf">` + p.parseArg() + `</span>`
	case "mathit":
		return `<span class="m-it">` + p.parseArg() + `</span>`
	case "mathbb", "mathcal", "mathsf", "mathtt":
		return `<span class="m-bb">` + p.parseArg() + `</span>`
	case "begin":
		env := p.parseRawGroup()
		raw := p.extractEnv(env)
		return renderEnv(env, raw)
	case "left", "right":
		d := p.readDelim()
		if d == "" {
			return ""
		}
		return `<span class="m-delim">` + EscHTML(d) + `</span>`
	case "langle":
		return "⟨"
	case "rangle":
		return "⟩"
	case "overline":
		return `<span style="text-decoration:overline">` + p.parseArg() + `</span>`
	case "underline":
		return `<span style="text-decoration:underline">` + p.parseArg() + `</span>`
	}
	if acc, ok := texAccents[name]; ok {
		return p.parseArg() + acc
	}
	if sym, ok := texSymbols[name]; ok {
		return sym
	}
	if fn, ok := texFunctions[name]; ok {
		return `<span class="m-func">` + fn + `</span>`
	}
	return `<span class="m-unknown">\` + name + `</span>`
}

func (p *texParser) readDelim() string {
	p.skipSpace()
	if p.i >= len(p.r) {
		return ""
	}
	if p.r[p.i] == '\\' {
		p.i++
		if p.i >= len(p.r) {
			return ""
		}
		c := p.r[p.i]
		if unicode.IsLetter(c) {
			start := p.i
			for p.i < len(p.r) && unicode.IsLetter(p.r[p.i]) {
				p.i++
			}
			switch string(p.r[start:p.i]) {
			case "langle":
				return "⟨"
			case "rangle":
				return "⟩"
			case "vert":
				return "|"
			case "Vert":
				return "‖"
			case "lbrace":
				return "{"
			case "rbrace":
				return "}"
			}
			return ""
		}
		p.i++
		switch c {
		case '{':
			return "{"
		case '}':
			return "}"
		case '|':
			return "‖"
		case '.':
			return ""
		}
		return string(c)
	}
	c := p.r[p.i]
	p.i++
	switch c {
	case '.':
		return ""
	}
	return string(c)
}

// extractEnv 取出 \begin{env} … \end{env} 之间的原始内容。
func (p *texParser) extractEnv(env string) string {
	rest := string(p.r[p.i:])
	open := `\begin{` + env + `}`
	close := `\end{` + env + `}`
	depth := 1
	idx := 0
	for {
		oi := strings.Index(rest[idx:], open)
		ci := strings.Index(rest[idx:], close)
		if ci == -1 {
			p.i = len(p.r)
			return rest
		}
		ciAbs := idx + ci
		if oi != -1 && idx+oi < ciAbs {
			depth++
			idx = idx + oi + len(open)
			continue
		}
		depth--
		if depth == 0 {
			content := rest[:ciAbs]
			consumed := rest[:ciAbs+len(close)]
			p.i += utf8.RuneCountInString(consumed)
			return content
		}
		idx = ciAbs + len(close)
	}
}

func renderEnv(env, raw string) string {
	rows := splitTop(raw, "\\\\")
	var sb strings.Builder
	sb.WriteString(`<span class="m-table">`)
	for _, row := range rows {
		if strings.TrimSpace(row) == "" {
			continue
		}
		sb.WriteString(`<span class="m-row">`)
		for _, cell := range splitTop(row, "&") {
			sb.WriteString(`<span class="m-cell">` + renderFragment(cell) + `</span>`)
		}
		sb.WriteString(`</span>`)
	}
	sb.WriteString(`</span>`)
	table := sb.String()
	switch env {
	case "pmatrix":
		return `<span class="m-delim">(</span>` + table + `<span class="m-delim">)</span>`
	case "bmatrix":
		return `<span class="m-delim">[</span>` + table + `<span class="m-delim">]</span>`
	case "Bmatrix":
		return `<span class="m-delim">{</span>` + table + `<span class="m-delim">}</span>`
	case "vmatrix":
		return `<span class="m-delim">|</span>` + table + `<span class="m-delim">|</span>`
	case "Vmatrix":
		return `<span class="m-delim">‖</span>` + table + `<span class="m-delim">‖</span>`
	}
	return table
}

// splitTop 在括号深度 0 处按分隔符切分（分隔符 "\\\\" 表示两个反斜杠）。
func splitTop(s, sep string) []string {
	var parts []string
	depth := 0
	start := 0
	r := []rune(s)
	sepR := []rune(sep)
	for i := 0; i < len(r); i++ {
		switch r[i] {
		case '{':
			depth++
		case '}':
			if depth > 0 {
				depth--
			}
		}
		if depth == 0 && i+len(sepR) <= len(r) && string(r[i:i+len(sepR)]) == sep {
			parts = append(parts, string(r[start:i]))
			i += len(sepR) - 1
			start = i + 1
		}
	}
	parts = append(parts, string(r[start:]))
	return parts
}
