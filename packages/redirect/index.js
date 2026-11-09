'use strict';
/**
 * redirect 插件（xfm-plugin-redirect）
 *
 * 安装：npm i -D xfm-plugin-redirect —— 装了就生效（也可在 config.plugins 写 'redirect'）
 * -------------------------------------------------------------------
 * 页面换了地址，旧链接（外站引用、搜索引擎索引、别人收藏）不该 404。
 * 本插件在旧地址生成一个极小的跳转页：meta refresh + JS replace + 可见链接，
 * 三条腿都有，任何环境都能跳。
 *
 * 两种声明方式：
 *
 *   1) 全局映射（配置里写死）：
 *      redirects: {
 *        '/old-post/': '/posts/new-post/',
 *        '/2020/01/hello.html': '/posts/hello/',
 *      }
 *
 *   2) 跟着页面走（改文章地址时最方便，删了文章连带删跳转）：
 *      front-matter 里写
 *        redirect_from:
 *          - /old-post/
 *          - /2020/01/hello.html
 *      （`aliases` 是本插件认的别名写法）
 *
 * 跳转页带 rel=canonical + noindex follow，不污染索引；
 * 目标可以是站内路径，也可以是 https://… 外链。
 *
 * 冲突处理：旧地址上如果本来就有一篇真页面，跳过并告警 —— 不覆盖真实内容。
 */
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 旧地址规范化：补前导斜杠，去掉 query/hash，`/x` 视作 `/x/` */
function normFrom(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!s.startsWith('/')) s = '/' + s;
  s = s.split('#')[0].split('?')[0];
  if (!/\.[a-z0-9]+$/i.test(s) && !s.endsWith('/')) s += '/';
  return s.replace(/\/{2,}/g, '/');
}

/** 目标规范化：允许绝对 URL；站内路径补前导斜杠 */
function normTo(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return /^[a-z][\w+.-]*:/i.test(s) || s.startsWith('//') ? s : s.startsWith('/') ? s : '/' + s;
}

/** 与内核同规则：/ → index.html，/x/ → x/index.html，/x.html → x.html */
function toFilePath(url) {
  let clean = url;
  try { clean = decodeURI(url); } catch (e) { /* 非法转义按原样 */ }
  if (clean === '/') return 'index.html';
  if (/\.html?$/i.test(clean)) return clean.slice(1);
  return clean.slice(1).replace(/\/$/, '') + '/index.html';
}

module.exports = (site) => {
  const { withBase } = site.helpers;
  const base = site.config.site.base;

  /** 页面里引用的地址要补 base；外链原样 */
  const href = (u) => (/^([a-z][\w+.-]*:|\/\/)/i.test(u) ? u : withBase(base, u));

  const page = (from, to, lang) => {
    const target = href(to);
    return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>跳转中…</title>
<link rel="canonical" href="${esc(target)}">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')} + location.search + location.hash);</script>
</head>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:0 1.25rem">
<p>此地址已迁移到 <a href="${esc(target)}">${esc(target)}</a>。</p>
<p style="color:#888;font-size:.875rem">如果浏览器没有自动跳转，请点击上面的链接。</p>
</body>
</html>
`;
  };

  return {
    name: 'redirect',

    afterBuild(site) {
      const map = new Map();

      for (const [from, to] of Object.entries(site.config.redirects || {})) {
        const f = normFrom(from);
        const t = normTo(to);
        if (f && t) map.set(f, t);
      }

      for (const p of site.pages || []) {
        if (p.data && p.data.redirect === false) continue;
        const list = p.data.redirect_from || p.data.aliases || [];
        for (const from of Array.isArray(list) ? list : [list]) {
          const f = normFrom(from);
          if (f && f !== p.url) map.set(f, p.url);
        }
      }

      if (!map.size) return [];

      // 真实页面优先：不让跳转页覆盖已有内容
      const taken = new Set((site.pages || []).map((p) => p.url));
      const lang = site.config.site.lang || 'zh-CN';
      const out = [];

      for (const from of [...map.keys()].sort()) {
        const to = map.get(from);
        if (taken.has(from)) {
          console.warn(`[xfm-plugin-redirect] ${from} 已存在真实页面，跳过跳转（→ ${to}）`);
          continue;
        }
        if (from === normTo(to)) continue;
        out.push({ path: toFilePath(from), contents: page(from, to, lang) });
      }

      return out;
    },
  };
};
