package plugin

import (
	"regexp"
	"strings"
)

var reSpaces = regexp.MustCompile(`\s+`)

// escXML 与各插件里的 esc() 对齐（额外转义单引号）。
func escXML(s string) string {
	return strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;",
	).Replace(s)
}

// collapseSpace 折叠连续空白并去首尾。
func collapseSpace(s string) string {
	return strings.TrimSpace(reSpaces.ReplaceAllString(s, " "))
}

// insertBefore 优先贴着文章结尾，其次主内容区，最后退回 body 末尾。
func insertBefore(html, body string) string {
	for _, tag := range []string{"</article>", "</main>", "</body>"} {
		if at := lastIndexFold(html, tag); at != -1 {
			return html[:at] + body + "\n" + html[at:]
		}
	}
	return html + body
}

// insertHead 把内容插到 </head> 前（没有 head 就原样返回）。
func insertHead(html, block string) string {
	if at := indexFold(html, "</head>"); at != -1 {
		return html[:at] + block + "\n" + html[at:]
	}
	return html
}

func indexFold(s, sub string) int {
	return strings.Index(strings.ToLower(s), strings.ToLower(sub))
}

func lastIndexFold(s, sub string) int {
	return strings.LastIndex(strings.ToLower(s), strings.ToLower(sub))
}

// replaceFirstFold 替换第一处（大小写不敏感）。
func replaceFirstFold(s, old, new string) (string, bool) {
	at := indexFold(s, old)
	if at == -1 {
		return s, false
	}
	return s[:at] + new + s[at+len(old):], true
}

// encodeURIComponent 对齐 JS 的同名函数。
func encodeURIComponent(s string) string {
	var b strings.Builder
	const hex = "0123456789ABCDEF"
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '!' || c == '~' || c == '*' || c == '\'' || c == '(' || c == ')' {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&0xf])
	}
	return b.String()
}
