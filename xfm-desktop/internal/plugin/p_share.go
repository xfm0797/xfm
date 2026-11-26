package plugin

import (
	"strings"
)

func init() { Register("share", newShare) }

type shareNetwork struct {
	label   string
	color   string
	copyMsg string
	href    func(u, t string) string
}

var shareNetworks = map[string]shareNetwork{
	"weibo": {label: "微博", color: "#e6162d", href: func(u, t string) string { return "https://service.weibo.com/share/share.php?url=" + u + "&title=" + t }},
	"qq": {label: "QQ 好友", color: "#12b7f5", href: func(u, t string) string {
		return "https://connect.qq.com/widget/shareqq/index.html?url=" + u + "&title=" + t + "&summary="
	}},
	"qzone": {label: "QQ 空间", color: "#f5b60d", href: func(u, t string) string {
		return "https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=" + u + "&title=" + t
	}},
	"wechat":   {label: "微信", color: "#07c160", copyMsg: "链接已复制，可在微信中粘贴分享"},
	"twitter":  {label: "X", color: "#1da1f2", href: func(u, t string) string { return "https://twitter.com/intent/tweet?url=" + u + "&text=" + t }},
	"facebook": {label: "Facebook", color: "#1877f2", href: func(u, t string) string { return "https://www.facebook.com/sharer/sharer.php?u=" + u }},
	"linkedin": {label: "LinkedIn", color: "#0a66c2", href: func(u, t string) string { return "https://www.linkedin.com/sharing/share-offsite/?url=" + u }},
	"telegram": {label: "Telegram", color: "#26a5e4", href: func(u, t string) string { return "https://t.me/share/url?url=" + u + "&text=" + t }},
	"whatsapp": {label: "WhatsApp", color: "#25d366", href: func(u, t string) string { return "https://api.whatsapp.com/send?text=" + t + "%20" + u }},
	"reddit":   {label: "Reddit", color: "#ff4500", href: func(u, t string) string { return "https://www.reddit.com/submit?url=" + u + "&title=" + t }},
	"email":    {label: "邮件", color: "#5f6368", href: func(u, t string) string { return "mailto:?subject=" + t + "&body=" + u }},
	"copy":     {label: "复制链接", color: "#5f6368", copyMsg: "链接已复制"},
}

var shareAliases = map[string]string{"x": "twitter", "mail": "email"}

var shareDefault = []string{"weibo", "wechat", "qq", "twitter", "telegram", "copy"}

const shareCSS = `<style>
.xfm-share{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin:2.5rem 0 0;padding-top:1.25rem;border-top:1px solid var(--border,#e6e6e6)}
.xfm-share-label{font-size:.88rem;color:var(--muted,#888)}
.xfm-share a{display:inline-block;padding:.22rem .85rem;border:1px solid var(--border,#d9d9d9);border-radius:999px;font-size:.85rem;line-height:1.5;color:inherit;text-decoration:none;transition:color .15s,border-color .15s}
.xfm-share a:hover{color:var(--c);border-color:var(--c)}
.xfm-share-toast{position:fixed;left:50%;bottom:2.5rem;transform:translateX(-50%);background:#333;color:#fff;padding:.4rem 1rem;border-radius:6px;font-size:.85rem;opacity:0;transition:opacity .25s;pointer-events:none;z-index:9999}
.xfm-share-toast.show{opacity:.92}
@media (prefers-color-scheme:dark){.xfm-share{border-top-color:var(--border,#333)}.xfm-share a{border-color:var(--border,#3a3a3a)}}
</style>`

const shareCopyScript = `<script>
(function(){
  function toast(msg){
    var t=document.querySelector('.xfm-share-toast');
    if(!t){t=document.createElement('div');t.className='xfm-share-toast';document.body.appendChild(t);}
    t.textContent=msg;t.classList.add('show');
    clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove('show');},2000);
  }
  function legacyCopy(text){
    var ta=document.createElement('textarea');
    ta.value=text;ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');}catch(e){}
    document.body.removeChild(ta);
  }
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-share-copy]');
    if(!el)return;
    e.preventDefault();
    var url=el.getAttribute('data-share-url')||location.href;
    var done=function(){toast(el.getAttribute('data-share-msg')||'已复制');};
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done,function(){legacyCopy(url);done();});
    }else{legacyCopy(url);done();}
  });
})();
</script>`

// share：在文章末尾追加分享栏。
func newShare(h Host) *Instance {
	cfg := h.Section("share")
	inDev := BoolVal(cfg, "dev", false)
	title := "分享"
	if v, ok := cfg["title"]; ok {
		title = toString(v)
	}

	wanted := shareDefault
	if arr := AnyList(cfg["networks"]); len(arr) > 0 {
		wanted = nil
		for _, it := range arr {
			wanted = append(wanted, toString(it))
		}
	}
	var names []string
	for _, raw := range wanted {
		name := strings.ToLower(raw)
		if alias, ok := shareAliases[name]; ok {
			name = alias
		}
		if _, ok := shareNetworks[name]; !ok {
			continue
		}
		dup := false
		for _, n := range names {
			if n == name {
				dup = true
				break
			}
		}
		if !dup {
			names = append(names, name)
		}
	}

	inst := &Instance{Name: "share"}
	if len(names) == 0 {
		return inst
	}

	inst.ExtendContext = func(ctx map[string]any) map[string]any {
		ctx["share"] = map[string]any{"networks": names, "title": title}
		return ctx
	}
	inst.TransformHTML = func(html string, page *Doc) string {
		if !inDev && h.Mode() != "production" {
			return html
		}
		if page == nil {
			return html
		}
		typ := Str(page.Data, "type")
		if v, ok := page.Data["share"].(bool); ok && !v {
			return html
		}
		if typ == "page" || typ == "index" || page.Date == "" || page.URL == "/" {
			return html
		}
		full := AbsoluteURL(h.SiteConfig(), page.URL)
		u := encodeURIComponent(full)
		t := encodeURIComponent(page.Title)

		var buttons []string
		for _, name := range names {
			def := shareNetworks[name]
			label := "<span>" + EscHTML(def.label) + "</span>"
			if def.copyMsg != "" {
				buttons = append(buttons, `<a href="#" style="--c:`+def.color+`" data-share-copy`+
					` data-share-url="`+EscHTML(full)+`" data-share-msg="`+EscHTML(def.copyMsg)+`"`+
					` title="`+EscHTML(def.label)+`">`+label+`</a>`)
				continue
			}
			buttons = append(buttons, `<a href="`+EscHTML(def.href(u, t))+`" style="--c:`+def.color+`"`+
				` target="_blank" rel="noopener"`+
				` title="分享到`+EscHTML(def.label)+`">`+label+`</a>`)
		}
		section := `<section class="xfm-share" data-share-networks="` + strings.Join(names, ",") + `" aria-label="分享">`
		if title != "" {
			section += `<span class="xfm-share-label">` + EscHTML(title) + `</span>`
		}
		section += strings.Join(buttons, "\n") + `</section>`

		needsCopy := false
		for _, n := range names {
			if shareNetworks[n].copyMsg != "" {
				needsCopy = true
			}
		}
		out := html
		if !strings.Contains(html, "data-xfm-share") {
			out = insertBefore(html, section)
		}
		out = insertHead(out, shareCSS)
		if needsCopy {
			return out + shareCopyScript
		}
		return out
	}
	return inst
}
