package tmpl

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// ---------- 作用域 ----------

// Scope 是一个带父级回退的可变作用域：set 写入本地，循环变量为临时遮蔽。
type Scope struct {
	base  map[string]any
	local map[string]any
}

// NewScope 基于上下文创建作用域。
func NewScope(base map[string]any) *Scope {
	return &Scope{base: base, local: map[string]any{}}
}

// Get 读取变量（本地优先，回退到上下文）。
func (s *Scope) Get(name string) any {
	if v, ok := s.local[name]; ok {
		return v
	}
	if v, ok := s.base[name]; ok {
		return v
	}
	return nil
}

// Set 写入本地作用域。
func (s *Scope) Set(name string, v any) { s.local[name] = v }

// shadow 保存变量当前值，返回恢复函数。
func (s *Scope) shadow(name string) func() {
	old, existed := s.local[name]
	return func() {
		if existed {
			s.local[name] = old
		} else {
			delete(s.local, name)
		}
	}
}

// ---------- 词法 ----------

type token struct {
	kind string // num / str / ident / op / eof
	val  string
}

func lex(s string) []token {
	var toks []token
	i := 0
	n := len(s)
	for i < n {
		c := s[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i++
			continue
		}
		// 字符串
		if c == '"' || c == '\'' || c == '`' {
			q := c
			j := i + 1
			var b strings.Builder
			for j < n {
				if s[j] == '\\' && j+1 < n {
					b.WriteByte(s[j+1])
					j += 2
					continue
				}
				if s[j] == q {
					j++
					break
				}
				b.WriteByte(s[j])
				j++
			}
			toks = append(toks, token{"str", b.String()})
			i = j
			continue
		}
		// 数字
		if c >= '0' && c <= '9' {
			j := i
			for j < n && ((s[j] >= '0' && s[j] <= '9') || s[j] == '.') {
				j++
			}
			toks = append(toks, token{"num", s[i:j]})
			i = j
			continue
		}
		// 标识符
		if isIdentStart(c) {
			j := i + 1
			for j < n && isIdentPart(s[j]) {
				j++
			}
			toks = append(toks, token{"ident", s[i:j]})
			i = j
			continue
		}
		// 运算符（优先多字符）
		two := ""
		if i+1 < n {
			two = s[i : i+2]
		}
		switch two {
		case "||", "&&", "==", "!=", "<=", ">=":
			toks = append(toks, token{"op", two})
			i += 2
			continue
		}
		toks = append(toks, token{"op", string(c)})
		i++
	}
	toks = append(toks, token{"eof", ""})
	return toks
}

func isIdentStart(c byte) bool {
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentPart(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9')
}

// ---------- 语法 ----------

type exprParser struct {
	toks  []token
	pos   int
	scope *Scope
}

// EvalExpr 计算模板表达式。
func EvalExpr(src string, scope *Scope) any {
	p := &exprParser{toks: lex(src), scope: scope}
	return p.parseOr()
}

func (p *exprParser) peek() token { return p.toks[p.pos] }

func (p *exprParser) next() token {
	t := p.toks[p.pos]
	if p.pos < len(p.toks)-1 {
		p.pos++
	}
	return t
}

func (p *exprParser) acceptOp(ops ...string) (string, bool) {
	t := p.peek()
	if t.kind != "op" {
		return "", false
	}
	for _, o := range ops {
		if t.val == o {
			p.next()
			return o, true
		}
	}
	return "", false
}

func (p *exprParser) acceptWord(words ...string) (string, bool) {
	t := p.peek()
	if t.kind != "ident" {
		return "", false
	}
	for _, w := range words {
		if t.val == w {
			p.next()
			return w, true
		}
	}
	return "", false
}

func (p *exprParser) parseOr() any {
	left := p.parseAnd()
	for {
		if _, ok := p.acceptOp("||"); ok {
			right := p.parseAnd()
			if truthy(left) {
				continue
			}
			left = right
			continue
		}
		if _, ok := p.acceptWord("or"); ok {
			right := p.parseAnd()
			if truthy(left) {
				continue
			}
			left = right
			continue
		}
		return left
	}
}

func (p *exprParser) parseAnd() any {
	left := p.parseEquality()
	for {
		if _, ok := p.acceptOp("&&"); ok {
			right := p.parseEquality()
			if !truthy(left) {
				continue
			}
			left = right
			continue
		}
		if _, ok := p.acceptWord("and"); ok {
			right := p.parseEquality()
			if !truthy(left) {
				continue
			}
			left = right
			continue
		}
		return left
	}
}

func (p *exprParser) parseEquality() any {
	left := p.parseCompare()
	for {
		if op, ok := p.acceptOp("==", "!="); ok {
			right := p.parseCompare()
			eq := looseEqual(left, right)
			if op == "!=" {
				eq = !eq
			}
			left = eq
			continue
		}
		return left
	}
}

func (p *exprParser) parseCompare() any {
	left := p.parseAdd()
	for {
		op, ok := p.acceptOp("<", ">", "<=", ">=")
		if !ok {
			return left
		}
		right := p.parseAdd()
		left = compare(op, left, right)
	}
}

func (p *exprParser) parseAdd() any {
	left := p.parseMul()
	for {
		op, ok := p.acceptOp("+", "-")
		if !ok {
			return left
		}
		right := p.parseMul()
		if op == "+" {
			left = add(left, right)
		} else {
			left = numBinary(left, right, "-")
		}
	}
}

func (p *exprParser) parseMul() any {
	left := p.parseUnary()
	for {
		op, ok := p.acceptOp("*", "/", "%")
		if !ok {
			return left
		}
		right := p.parseUnary()
		left = numBinary(left, right, op)
	}
}

func (p *exprParser) parseUnary() any {
	if _, ok := p.acceptOp("!"); ok {
		return !truthy(p.parseUnary())
	}
	if _, ok := p.acceptWord("not"); ok {
		return !truthy(p.parseUnary())
	}
	if _, ok := p.acceptOp("-"); ok {
		return numBinary(int64(0), p.parseUnary(), "-")
	}
	return p.parsePostfix(p.parsePrimary())
}

func (p *exprParser) parsePrimary() any {
	t := p.peek()
	switch t.kind {
	case "num":
		p.next()
		if strings.Contains(t.val, ".") {
			f, _ := strconv.ParseFloat(t.val, 64)
			return f
		}
		n, _ := strconv.ParseInt(t.val, 10, 64)
		return n
	case "str":
		p.next()
		return t.val
	case "ident":
		p.next()
		switch t.val {
		case "true":
			return true
		case "false":
			return false
		case "null", "undefined":
			return nil
		}
		return p.scope.Get(t.val)
	case "op":
		if t.val == "(" {
			p.next()
			v := p.parseOr()
			p.acceptOp(")")
			return v
		}
		p.next()
		return nil
	}
	p.next()
	return nil
}

func (p *exprParser) parsePostfix(v any) any {
	for {
		if _, ok := p.acceptOp("."); ok {
			name := p.next()
			v = getMember(v, name.val)
			continue
		}
		if _, ok := p.acceptOp("["); ok {
			idx := p.parseOr()
			p.acceptOp("]")
			v = getIndex(v, idx)
			continue
		}
		return v
	}
}

// ---------- 值运算 ----------

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case int:
		return x != 0
	case int64:
		return x != 0
	case float64:
		return x != 0
	default:
		return true // 数组 / 对象在 JS 中恒为真
	}
}

func getMember(v any, name string) any {
	switch m := v.(type) {
	case map[string]any:
		return m[name]
	case []any:
		if name == "length" {
			return int64(len(m))
		}
		return nil
	case string:
		if name == "length" {
			return int64(utf8.RuneCountInString(m))
		}
		return nil
	}
	return nil
}

func getIndex(v, idx any) any {
	switch m := v.(type) {
	case []any:
		i := int(toFloat(idx))
		if i >= 0 && i < len(m) {
			return m[i]
		}
		return nil
	case map[string]any:
		return m[stringify(idx)]
	case string:
		runes := []rune(m)
		i := int(toFloat(idx))
		if i >= 0 && i < len(runes) {
			return string(runes[i])
		}
		return nil
	}
	return nil
}

func toFloat(v any) float64 {
	switch x := v.(type) {
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	case bool:
		if x {
			return 1
		}
		return 0
	}
	return 0
}

func isNumber(v any) bool {
	switch v.(type) {
	case int, int64, float64:
		return true
	}
	return false
}

func isInteger(v any) bool {
	switch v.(type) {
	case int, int64:
		return true
	}
	return false
}

func numBinary(a, b any, op string) any {
	fa, fb := toFloat(a), toFloat(b)
	bothInt := isInteger(a) && isInteger(b)
	switch op {
	case "-":
		if bothInt {
			return int64(fa) - int64(fb)
		}
		return fa - fb
	case "*":
		if bothInt {
			return int64(fa) * int64(fb)
		}
		return fa * fb
	case "/":
		if fb == 0 {
			return math.Inf(1)
		}
		return fa / fb
	case "%":
		if fb == 0 {
			return math.NaN()
		}
		if bothInt {
			return int64(fa) % int64(fb)
		}
		return math.Mod(fa, fb)
	}
	return nil
}

func add(a, b any) any {
	if _, ok := a.(string); ok {
		return stringify(a) + stringify(b)
	}
	if _, ok := b.(string); ok {
		return stringify(a) + stringify(b)
	}
	return numBinary(a, b, "+")
}

func looseEqual(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	if ab, ok := a.(bool); ok {
		if bb, ok2 := b.(bool); ok2 {
			return ab == bb
		}
	}
	if isNumber(a) && isNumber(b) {
		return toFloat(a) == toFloat(b)
	}
	if as, ok := a.(string); ok {
		if bs, ok2 := b.(string); ok2 {
			return as == bs
		}
	}
	return stringify(a) == stringify(b)
}

func compare(op string, a, b any) bool {
	if isNumber(a) && isNumber(b) {
		fa, fb := toFloat(a), toFloat(b)
		switch op {
		case "<":
			return fa < fb
		case ">":
			return fa > fb
		case "<=":
			return fa <= fb
		case ">=":
			return fa >= fb
		}
	}
	sa, sb := stringify(a), stringify(b)
	switch op {
	case "<":
		return sa < sb
	case ">":
		return sa > sb
	case "<=":
		return sa <= sb
	case ">=":
		return sa >= sb
	}
	return false
}

// stringify 将值转为字符串（输出/拼接使用）。
func stringify(v any) string {
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
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		if x == math.Trunc(x) && !math.IsInf(x, 0) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = stringify(e)
		}
		return strings.Join(parts, ",")
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprint(v)
		}
		return string(b)
	}
}
