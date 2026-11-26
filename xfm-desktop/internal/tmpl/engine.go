package tmpl

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"xfmdesk/internal/markdown"
)

// Engine 加载主题模板并渲染。
type Engine struct {
	Dir      string
	MaxDepth int
}

// NewEngine 创建模板引擎。
func NewEngine(dir string) *Engine {
	return &Engine{Dir: dir, MaxDepth: 10}
}

type tok struct {
	kind string // text / output / stmt
	val  string
}

type node interface {
	render(b *strings.Builder, sc *Scope, rc *renderCtx)
}

type renderCtx struct {
	e   *Engine
	ctx map[string]any
}

// Render 渲染指定布局。
func (e *Engine) Render(layout string, ctx map[string]any) (string, error) {
	abs, err := e.resolve(layout)
	if err != nil {
		return "", err
	}
	nodes, err := e.compileFile(abs)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	rc := &renderCtx{e: e, ctx: ctx}
	renderNodes(&b, nodes, NewScope(ctx), rc)
	return b.String(), nil
}

func (e *Engine) resolve(name string) (string, error) {
	candidates := []string{
		filepath.Join(e.Dir, "layouts", name),
		filepath.Join(e.Dir, "partials", name),
		filepath.Join(e.Dir, name),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("[xfm] 模板不存在：%s（主题：%s）", name, e.Dir)
}

var (
	reExtend = regexp.MustCompile(`(?s)^\s*\{%\s*extend[s]?\s+["'](.+?)["']\s*%\}`)
	reBlock  = regexp.MustCompile(`(?s)\{%\s*block\s+([\w-]+)\s*%\}(.*?)\{%\s*endblock\s*%\}`)
)

func (e *Engine) compileFile(abs string) ([]node, error) {
	src, err := e.flatten(abs, 0)
	if err != nil {
		return nil, err
	}
	return parse(src)
}

func (e *Engine) flatten(abs string, depth int) (string, error) {
	if depth > e.MaxDepth {
		return "", fmt.Errorf("[xfm] 模板继承层级过深：%s", abs)
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	src := string(data)
	m := reExtend.FindStringSubmatch(src)
	if m == nil {
		return src, nil
	}
	blocks := map[string]string{}
	for _, bm := range reBlock.FindAllStringSubmatch(src, -1) {
		blocks[bm[1]] = bm[2]
	}
	parentAbs, err := e.resolve(m[1])
	if err != nil {
		return "", err
	}
	parentSrc, err := e.flatten(parentAbs, depth+1)
	if err != nil {
		return "", err
	}
	for name, content := range blocks {
		re := regexp.MustCompile(`(?s)\{%\s*block\s+` + regexp.QuoteMeta(name) + `\s*%\}(.*?)\{%\s*endblock\s*%\}`)
		if re.MatchString(parentSrc) {
			parentSrc = re.ReplaceAllStringFunc(parentSrc, func(string) string { return content })
		} else {
			parentSrc += content
		}
	}
	return parentSrc, nil
}

// ---------- 解析 ----------

func parse(src string) ([]node, error) {
	toks := tokenize(src)
	pos := 0
	nodes, stop := parseNodes(toks, &pos, nil)
	if stop != "" {
		return nil, fmt.Errorf("[xfm] 模板存在多余的 {%% %s %%}", stop)
	}
	return nodes, nil
}

func tokenize(src string) []tok {
	var out []tok
	pos := 0
	n := len(src)
	for pos < n {
		idx := strings.IndexByte(src[pos:], '{')
		if idx < 0 {
			out = append(out, tok{"text", src[pos:]})
			break
		}
		idx += pos
		if idx+1 < n {
			c1 := src[idx+1]
			switch c1 {
			case '#':
				out = append(out, tok{"text", src[pos:idx]})
				end := strings.Index(src[idx+2:], "#}")
				if end < 0 {
					pos = n
				} else {
					pos = idx + 2 + end + 2
				}
				continue
			case '{':
				out = append(out, tok{"text", src[pos:idx]})
				end := strings.Index(src[idx+3:], "}}")
				if end < 0 {
					out = append(out, tok{"output", strings.TrimSpace(src[idx+3:])})
					pos = n
				} else {
					out = append(out, tok{"output", strings.TrimSpace(src[idx+3 : idx+3+end])})
					pos = idx + 3 + end + 2
				}
				continue
			case '%':
				out = append(out, tok{"text", src[pos:idx]})
				end := strings.Index(src[idx+2:], "%}")
				if end < 0 {
					pos = n
					continue
				}
				stmt := strings.TrimSpace(src[idx+2 : idx+2+end])
				pos = idx + 2 + end + 2
				if stmt == "raw" {
					m := reEndraw.FindStringIndex(src[pos:])
					if m == nil {
						out = append(out, tok{"text", src[pos:]})
						pos = n
					} else {
						out = append(out, tok{"text", src[pos : pos+m[0]]})
						pos = pos + m[1]
					}
					continue
				}
				out = append(out, tok{"stmt", stmt})
				continue
			}
		}
		// 普通字符：包含这个 '{'
		out = append(out, tok{"text", src[pos : idx+1]})
		pos = idx + 1
	}
	return out
}

var reEndraw = regexp.MustCompile(`\{%\s*endraw\s*%\}`)

var stopTags = map[string]bool{
	"elif": true, "else": true, "endif": true, "endfor": true, "endblock": true,
}

func stmtTag(s string) (string, string) {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, " \t\n"); i >= 0 {
		return s[:i], strings.TrimSpace(s[i+1:])
	}
	return s, ""
}

// parseNodes 解析节点直到遇到停止标签（返回 tag，不消费）。
func parseNodes(toks []tok, pos *int, stops map[string]bool) ([]node, string) {
	var nodes []node
	for *pos < len(toks) {
		t := toks[*pos]
		switch t.kind {
		case "text":
			*pos = *pos + 1
			if t.val != "" {
				nodes = append(nodes, &textNode{t.val})
			}
		case "output":
			*pos = *pos + 1
			expr := t.val
			safe := hasSafeFilter(expr)
			nodes = append(nodes, &outputNode{expr: expr, safe: safe})
		case "stmt":
			tag, rest := stmtTag(t.val)
			if stops != nil && stops[tag] {
				return nodes, tag
			}
			switch tag {
			case "if":
				*pos = *pos + 1
				in, stop := parseIf(toks, pos, rest)
				nodes = append(nodes, in)
				_ = stop
			case "for":
				*pos = *pos + 1
				nodes = append(nodes, parseFor(toks, pos, rest))
			case "set":
				*pos = *pos + 1
				name, expr := splitAssign(rest)
				nodes = append(nodes, &setNode{name: name, expr: expr})
			case "include":
				*pos = *pos + 1
				nodes = append(nodes, &includeNode{name: unquote(rest)})
			case "block":
				*pos = *pos + 1
				body, _ := parseNodes(toks, pos, stopTags)
				// 跳过 endblock
				if *pos < len(toks) && toks[*pos].kind == "stmt" {
					if tg, _ := stmtTag(toks[*pos].val); tg == "endblock" {
						*pos = *pos + 1
					}
				}
				nodes = append(nodes, &passthroughNode{body})
			case "extend", "extends":
				*pos = *pos + 1
			default:
				*pos = *pos + 1
			}
		}
	}
	return nodes, ""
}

func parseIf(toks []tok, pos *int, cond string) (node, string) {
	n := &ifNode{}
	curCond := cond
	for {
		body, stop := parseNodes(toks, pos, stopTags)
		n.branches = append(n.branches, ifBranch{cond: curCond, body: body})
		if stop == "" {
			return n, ""
		}
		// 消费停止标签
		tag, rest := stmtTag(toks[*pos].val)
		*pos = *pos + 1
		switch tag {
		case "elif":
			curCond = rest
			continue
		case "else":
			elseBody, _ := parseNodes(toks, pos, stopTags)
			if *pos < len(toks) {
				if tg, _ := stmtTag(toks[*pos].val); tg == "endif" {
					*pos = *pos + 1
				}
			}
			n.elseBody = elseBody
			return n, ""
		case "endif":
			return n, ""
		}
		return n, ""
	}
}

func parseFor(toks []tok, pos *int, rest string) node {
	re := regexp.MustCompile(`^([A-Za-z_$][\w$]*)\s+in\s+([\s\S]+)$`)
	m := re.FindStringSubmatch(rest)
	n := &forNode{}
	if m != nil {
		n.varName = m[1]
		n.collExpr = m[2]
	}
	body, stop := parseNodes(toks, pos, stopTags)
	n.body = body
	if stop == "else" {
		*pos = *pos + 1
		elseBody, _ := parseNodes(toks, pos, stopTags)
		n.elseBody = elseBody
		if *pos < len(toks) {
			if tg, _ := stmtTag(toks[*pos].val); tg == "endfor" {
				*pos = *pos + 1
			}
		}
	} else if *pos < len(toks) {
		if tg, _ := stmtTag(toks[*pos].val); tg == "endfor" {
			*pos = *pos + 1
		}
	}
	return n
}

func splitAssign(rest string) (string, string) {
	i := strings.Index(rest, "=")
	if i < 0 {
		return strings.TrimSpace(rest), ""
	}
	return strings.TrimSpace(rest[:i]), strings.TrimSpace(rest[i+1:])
}

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// ---------- 节点实现 ----------

type textNode struct{ text string }

func (n *textNode) render(b *strings.Builder, _ *Scope, _ *renderCtx) { b.WriteString(n.text) }

type passthroughNode struct{ body []node }

func (n *passthroughNode) render(b *strings.Builder, sc *Scope, rc *renderCtx) {
	renderNodes(b, n.body, sc, rc)
}

type outputNode struct {
	expr string
	safe bool
}

func (n *outputNode) render(b *strings.Builder, sc *Scope, _ *renderCtx) {
	v := evalOutput(n.expr, sc)
	if n.safe {
		b.WriteString(stringify(v))
	} else {
		b.WriteString(markdown.EscapeHTML(stringify(v)))
	}
}

type setNode struct {
	name string
	expr string
}

func (n *setNode) render(_ *strings.Builder, sc *Scope, _ *renderCtx) {
	sc.Set(n.name, EvalExpr(n.expr, sc))
}

type includeNode struct{ name string }

func (n *includeNode) render(b *strings.Builder, _ *Scope, rc *renderCtx) {
	if rc.e == nil {
		return
	}
	abs, err := rc.e.resolve(n.name)
	if err != nil {
		return
	}
	nodes, err := rc.e.compileFile(abs)
	if err != nil {
		return
	}
	// include 看到的是原始上下文（与 JS 引擎一致）
	renderNodes(b, nodes, NewScope(rc.ctx), rc)
}

type ifBranch struct {
	cond string
	body []node
}

type ifNode struct {
	branches []ifBranch
	elseBody []node
}

func (n *ifNode) render(b *strings.Builder, sc *Scope, rc *renderCtx) {
	for _, br := range n.branches {
		if truthy(EvalExpr(br.cond, sc)) {
			renderNodes(b, br.body, sc, rc)
			return
		}
	}
	if n.elseBody != nil {
		renderNodes(b, n.elseBody, sc, rc)
	}
}

type forNode struct {
	varName  string
	collExpr string
	body     []node
	elseBody []node
}

func (n *forNode) render(b *strings.Builder, sc *Scope, rc *renderCtx) {
	coll := toIterable(EvalExpr(n.collExpr, sc))
	if len(coll) == 0 {
		if n.elseBody != nil {
			renderNodes(b, n.elseBody, sc, rc)
		}
		return
	}
	restoreVar := sc.shadow(n.varName)
	restoreLoop := sc.shadow("loop")
	defer restoreVar()
	defer restoreLoop()
	length := len(coll)
	for i, item := range coll {
		sc.Set(n.varName, item)
		sc.Set("loop", map[string]any{
			"index":    int64(i + 1),
			"index0":   int64(i),
			"first":    i == 0,
			"last":     i == length-1,
			"length":   int64(length),
			"revindex": int64(length - i),
		})
		renderNodes(b, n.body, sc, rc)
	}
}

func renderNodes(b *strings.Builder, nodes []node, sc *Scope, rc *renderCtx) {
	for _, n := range nodes {
		n.render(b, sc, rc)
	}
}

func toIterable(v any) []any {
	switch x := v.(type) {
	case []any:
		return x
	case string:
		runes := []rune(x)
		out := make([]any, len(runes))
		for i, r := range runes {
			out[i] = string(r)
		}
		return out
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		out := make([]any, 0, len(keys))
		for _, k := range keys {
			out = append(out, map[string]any{"key": k, "value": x[k]})
		}
		return out
	}
	return nil
}

// ---------- 过滤器 ----------

func hasSafeFilter(expr string) bool {
	parts := splitFilters(expr)
	for _, p := range parts[1:] {
		name, _ := parseFilter(p)
		if name == "safe" {
			return true
		}
	}
	return false
}

func evalOutput(expr string, sc *Scope) any {
	parts := splitFilters(expr)
	if len(parts) == 0 {
		return ""
	}
	v := EvalExpr(parts[0], sc)
	for _, p := range parts[1:] {
		name, argsStr := parseFilter(p)
		var args []any
		if argsStr != "" {
			for _, a := range splitArgs(argsStr) {
				args = append(args, EvalExpr(a, sc))
			}
		}
		v = applyFilter(name, v, args)
	}
	return v
}

func parseFilter(s string) (string, string) {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '('); i >= 0 && strings.HasSuffix(s, ")") {
		return strings.TrimSpace(s[:i]), s[i+1 : len(s)-1]
	}
	return s, ""
}

// splitFilters 按顶层 | 切分（|| 视为运算符、引号与括号内不切）。
func splitFilters(raw string) []string {
	var parts []string
	var cur strings.Builder
	var quote byte
	depth := 0
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if quote != 0 {
			cur.WriteByte(c)
			if c == '\\' && i+1 < len(raw) {
				cur.WriteByte(raw[i+1])
				i++
			} else if c == quote {
				quote = 0
			}
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			quote = c
			cur.WriteByte(c)
			continue
		}
		if c == '(' {
			depth++
		}
		if c == ')' {
			depth--
		}
		if c == '|' && depth == 0 {
			if i+1 < len(raw) && raw[i+1] == '|' {
				cur.WriteString("||")
				i++
				continue
			}
			parts = append(parts, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	parts = append(parts, strings.TrimSpace(cur.String()))
	out := parts[:0]
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func splitArgs(raw string) []string {
	var out []string
	var cur strings.Builder
	var quote byte
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if quote != 0 {
			cur.WriteByte(c)
			if c == '\\' && i+1 < len(raw) {
				cur.WriteByte(raw[i+1])
				i++
			} else if c == quote {
				quote = 0
			}
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			quote = c
			cur.WriteByte(c)
			continue
		}
		if c == ',' {
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	if strings.TrimSpace(cur.String()) != "" {
		out = append(out, strings.TrimSpace(cur.String()))
	}
	return out
}

func applyFilter(name string, v any, args []any) any {
	switch name {
	case "safe":
		return v
	case "length":
		switch x := v.(type) {
		case nil:
			return int64(0)
		case []any:
			return int64(len(x))
		case map[string]any:
			return int64(len(x))
		case string:
			return int64(len([]rune(x)))
		default:
			return int64(len([]rune(stringify(v))))
		}
	case "upper":
		return strings.ToUpper(stringify(v))
	case "lower":
		return strings.ToLower(stringify(v))
	case "trim":
		return strings.TrimSpace(stringify(v))
	case "json":
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(b)
	case "default":
		if v == nil || stringify(v) == "" {
			if len(args) > 0 {
				return args[0]
			}
			return ""
		}
		return v
	}
	return v
}
