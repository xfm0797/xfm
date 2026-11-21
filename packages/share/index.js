'use strict';
/**
 * 分享插件（xfm-plugin-share）
 *
 * 安装：npm i -D xfm-plugin-share —— 装了就生效（也可在 config.plugins 写 'share'）
 * -------------------------------------------------------------------
 * 给文章页末尾加一条分享栏，零依赖、零外部请求：外链按钮就是普通 <a>，
 * 复制按钮只靠一小段内联 JS（clipboard API + execCommand 回落），不加载任何第三方脚本。
 *
 * 支持的网络（networks，按数组顺序渲染）：
 *
 *   weibo    微博            qzone    QQ 空间
 *   qq       QQ 好友         wechat   微信（复制链接 + 提示，无需二维码服务）
 *   twitter  X（别名 x）     facebook Facebook
 *   linkedin LinkedIn        telegram Telegram
 *   whatsapp WhatsApp        reddit   Reddit
 *   email    邮件（别名 mail）copy     复制链接
 *
 * 通用配置：
 *   share: {
 *     networks: ['weibo', 'wechat', 'qq', 'twitter', 'telegram', 'copy'],
 *     title: '分享',   // 区块前缀文案，'' 则不显示
 *     dev: false,      // dev 下是否也渲染
 *   }
 *
 * 只挂在文章页（有 date、且不是 type: page），首页 / 归档 / 独立页面不插入。
 * 页面级：front-matter 写 share: false 关闭单页；
 * 模板里放 `<div data-xfm-share></div>` 可自定位置，插件只补脚本不重复建容器。
 * 分享出去的是完整地址，站点要配 site.url；没配也能跑，但构建日志会提醒一次。
 */
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** JSON → 安全的脚本字面量 */
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/** 各网络的按钮文案、品牌色与跳转地址（u = 编码后的 URL，t = 编码后的标题） */
const NETWORKS = {
  weibo: { label: '微博', color: '#e6162d', href: (u, t) => `https://service.weibo.com/share/share.php?url=${u}&title=${t}` },
  qq: { label: 'QQ 好友', color: '#12b7f5', href: (u, t) => `https://connect.qq.com/widget/shareqq/index.html?url=${u}&title=${t}&summary=` },
  qzone: { label: 'QQ 空间', color: '#f5b60d', href: (u, t) => `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=${u}&title=${t}` },
  wechat: { label: '微信', color: '#07c160', copyMsg: '链接已复制，可在微信中粘贴分享' },
  twitter: { label: 'X', color: '#1da1f2', href: (u, t) => `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
  facebook: { label: 'Facebook', color: '#1877f2', href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${u}` },
  linkedin: { label: 'LinkedIn', color: '#0a66c2', href: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
  telegram: { label: 'Telegram', color: '#26a5e4', href: (u, t) => `https://t.me/share/url?url=${u}&text=${t}` },
  whatsapp: { label: 'WhatsApp', color: '#25d366', href: (u, t) => `https://api.whatsapp.com/send?text=${t}%20${u}` },
  reddit: { label: 'Reddit', color: '#ff4500', href: (u, t) => `https://www.reddit.com/submit?url=${u}&title=${t}` },
  email: { label: '邮件', color: '#5f6368', href: (u, t) => `mailto:?subject=${t}&body=${u}` },
  copy: { label: '复制链接', color: '#5f6368', copyMsg: '链接已复制' },
};

/** 常见写法归一 */
const ALIASES = { x: 'twitter', mail: 'email' };

const DEFAULT_NETWORKS = ['weibo', 'wechat', 'qq', 'twitter', 'telegram', 'copy'];

const CSS = `<style>
.xfm-share{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin:2.5rem 0 0;padding-top:1.25rem;border-top:1px solid var(--border,#e6e6e6)}
.xfm-share-label{font-size:.88rem;color:var(--muted,#888)}
.xfm-share a{display:inline-block;padding:.22rem .85rem;border:1px solid var(--border,#d9d9d9);border-radius:999px;font-size:.85rem;line-height:1.5;color:inherit;text-decoration:none;transition:color .15s,border-color .15s}
.xfm-share a:hover{color:var(--c);border-color:var(--c)}
.xfm-share-toast{position:fixed;left:50%;bottom:2.5rem;transform:translateX(-50%);background:#333;color:#fff;padding:.4rem 1rem;border-radius:6px;font-size:.85rem;opacity:0;transition:opacity .25s;pointer-events:none;z-index:9999}
.xfm-share-toast.show{opacity:.92}
@media (prefers-color-scheme:dark){.xfm-share{border-top-color:var(--border,#333)}.xfm-share a{border-color:var(--border,#3a3a3a)}}
</style>`;

/** 复制按钮的点击处理：clipboard API 优先，execCommand 回落，toast 提示结果 */
const COPY_SCRIPT = `<script>
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
</script>`;

module.exports = (site) => {
  const c = site.config.share || {};
  const inDev = c.dev === true;
  const title = c.title === undefined ? '分享' : String(c.title);

  // networks 归一：别名 → 标准名；去重；过滤不认识的
  const wanted = Array.isArray(c.networks) && c.networks.length
    ? c.networks
    : DEFAULT_NETWORKS;
  const names = [];
  const unknown = [];
  for (const raw of wanted) {
    const name = ALIASES[String(raw).toLowerCase()] || String(raw).toLowerCase();
    if (NETWORKS[name]) {
      if (!names.includes(name)) names.push(name);
    } else {
      unknown.push(String(raw));
    }
  }

  let warned = false;
  const warn = (msg) => {
    if (warned || site.mode !== 'production') return;
    warned = true;
    console.warn(msg);
  };

  if (!names.length) {
    warn(`[xfm-plugin-share] 没有可用的分享网络（${wanted.join(', ')}），可选：${Object.keys(NETWORKS).join(' / ')}`);
    return { name: 'share', extendContext(x) { return x; }, transformHtml(h) { return h; } };
  }
  if (unknown.length) {
    warn(`[xfm-plugin-share] 未知的分享网络已跳过：${unknown.join(', ')}，可选：${Object.keys(NETWORKS).join(' / ')}`);
  }

  return {
    name: 'share',

    /** 模板可用：{% if site.share %}<div data-xfm-share></div>{% endif %} */
    extendContext(ctx) {
      return { ...ctx, share: { networks: names, title } };
    },

    transformHtml(html, ctx) {
      if (!inDev && site.mode !== 'production') return html;

      const page = (ctx && ctx.page) || null;
      if (!page) return html;
      const data = page.data || {};
      if (data.share === false) return html;
      // 只挂文章：聚合页、首页、分类页、独立页面一律跳过
      if (data.type === 'page' || data.type === 'index' || !page.date || page.url === '/') return html;

      const full = site.helpers.absoluteUrl(site.config.site, page.url || '/');
      if (!/^https?:\/\//.test(full)) {
        warn('[xfm-plugin-share] 未配置 site.url，分享链接不是完整地址；配置后才能正确分享');
      }
      const u = encodeURIComponent(full);
      const t = encodeURIComponent(page.title || '');

      const buttons = names
        .map((name) => {
          const def = NETWORKS[name];
          const label = `<span>${esc(def.label)}</span>`;
          if (def.copyMsg) {
            return (
              `<a href="#" style="--c:${def.color}" data-share-copy` +
              ` data-share-url="${esc(full)}" data-share-msg="${esc(def.copyMsg)}"` +
              ` title="${esc(def.label)}">${label}</a>`
            );
          }
          return (
            `<a href="${esc(def.href(u, t))}" style="--c:${def.color}"` +
            ' target="_blank" rel="noopener"' +
            ` title="分享到${esc(def.label)}">${label}</a>`
          );
        })
        .join('\n');

      const section =
        `<section class="xfm-share" data-share-networks="${names.join(',')}" aria-label="分享">` +
        (title ? `<span class="xfm-share-label">${esc(title)}</span>` : '') +
        buttons +
        '</section>';

      const needsCopyScript = names.some((n) => NETWORKS[n].copyMsg);

      // 模板自己留了挂载点：只补脚本，不重复建容器
      const mounted = html.includes('data-xfm-share');
      const out = mounted ? html : insertBefore(html, section);

      const withCss = insertHead(out, CSS);
      return needsCopyScript ? withCss + COPY_SCRIPT : withCss;
    },
  };
};

/** 优先贴着文章结尾，其次主内容区，最后退回 body 末尾 */
function insertBefore(html, body) {
  for (const tag of ['</article>', '</main>', '</body>']) {
    const at = html.lastIndexOf(tag);
    if (at !== -1) return html.slice(0, at) + body + '\n' + html.slice(at);
  }
  return html + body;
}

/** 样式表插到 head 末尾（没有 head 就原样返回） */
function insertHead(html, link) {
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${link}\n</head>`) : html;
}

module.exports.NETWORKS = Object.keys(NETWORKS);
