'use strict';
/**
 * 评论插件（xfm-plugin-comments）
 *
 * 安装：npm i -D xfm-plugin-comments —— 装了就生效（也可在 config.plugins 写 'comments'）
 * -------------------------------------------------------------------
 * 一个插件接十家评论系统，切 provider 就行，模板与样式不用动：
 *
 *   giscus      GitHub Discussions（推荐：无后端、无广告、跟随主题）
 *   beaudar     giscus 的国内可访问版本
 *   utterances  GitHub Issues，更轻量
 *   disqus      老牌通用评论
 *   waline      可自托管，支持 Markdown / 表情 / 浏览量
 *   twikoo      腾讯云开发或 Vercel 部署，国内常用
 *   valine      LeanCloud 存储，轻量
 *   gitalk      GitHub Issues + OAuth
 *   artalk      可自托管，带后台管理
 *   cusdis      极简自托管
 *
 * 只挂在文章页（有 date、且不是 type: page），首页 / 归档 / 404 不插入。
 * 默认只在生产构建生效（第三方脚本不该拖慢本地预览），comments.dev = true 可打开。
 *
 * 通用配置：
 *   comments: {
 *     provider: 'giscus',
 *     title: '评论',            // 区块标题，'' 则不显示
 *     identifier: 'path',       // 评论与哪一页绑定：path（默认）| url | title
 *     dev: false,               // dev 下是否也渲染
 *   }
 *
 * 各 provider 的专属字段（都写在 comments 下）：
 *   giscus / beaudar: repo, repoId, category, categoryId, mapping, theme, lang,
 *                     strict, reactionsEnabled, inputPosition
 *   utterances:       repo, issueTerm, label, theme
 *   disqus:           shortname, theme
 *   waline:           serverURL, lang, emoji, requiredMeta, login, commentSorting, dark
 *   twikoo:           envId, region, lang
 *   valine:           appId, appKey, placeholder, serverURLs
 *   gitalk:           clientID, clientSecret, repo, owner, admin, distractionFreeMode, proxy
 *   artalk:           server, site, dark, pageTitle
 *   cusdis:           host, appId
 *
 * 页面级：front-matter 写 comments: false 关闭单页评论；
 * 模板里放 `<div data-xfm-comments></div>` 可自定位置，插件只补脚本不重复建容器。
 */
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** JSON → 安全的脚本字面量（内容里的 </script> 不会提前闭合） */
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/** 对象 → HTML 属性串；true 渲染成裸属性，false / 空值跳过 */
function attrs(map) {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');
}

/** giscus / beaudar：iframe 是异步插进来的，主题切换用 postMessage 通知 */
const themeSync = (origin) => `<script>
(function () {
  var root = document.documentElement;
  function sync() {
    var f = document.querySelector('iframe.giscus-frame');
    if (!f) return;
    var theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    f.contentWindow.postMessage({ giscus: { setConfig: { theme: theme } } }, '${origin}');
  }
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
})();
</script>`;

/** giscus 系的主题取值，写错就回落成跟随系统 */
const GISCUS_THEMES = /^(?:light|dark|dark_dimmed|dark_high_contrast|preferred_color_scheme|transparent_dark|custom)$/;

/** 每个 provider：必需字段、容器与脚本 */
const PROVIDERS = {
  giscus: {
    needs: ['repo', 'repoId'],
    build(c) {
      return {
        container: '<div class="giscus" data-xfm-comments></div>',
        scripts:
          '<script src="https://giscus.app/client.js"' +
          attrs({
            'data-repo': c.repo,
            'data-repo-id': c.repoId,
            'data-category': c.category || 'General',
            'data-category-id': c.categoryId || '',
            'data-mapping': c.mapping || 'pathname',
            'data-strict': c.strict ? '1' : '0',
            'data-reactions-enabled': c.reactionsEnabled === false ? '0' : '1',
            'data-emit-metadata': '0',
            'data-input-position': c.inputPosition || 'bottom',
            'data-theme': GISCUS_THEMES.test(c.theme || '') ? c.theme : 'preferred_color_scheme',
            'data-lang': c.lang || 'zh-CN',
            crossorigin: 'anonymous',
            async: true,
          }) +
          '></script>' +
          themeSync('https://giscus.app'),
      };
    },
  },

  beaudar: {
    needs: ['repo', 'repoId'],
    build(c) {
      return {
        container: '<div class="giscus" data-xfm-comments></div>',
        scripts:
          '<script src="https://beaudar.lipk.org/client.js"' +
          attrs({
            'data-repo': c.repo,
            'data-repo-id': c.repoId,
            'data-category': c.category || 'General',
            'data-category-id': c.categoryId || '',
            'data-mapping': c.mapping || 'pathname',
            'data-theme': c.theme || 'preferred_color_scheme',
            'data-lang': c.lang || 'zh-CN',
            crossorigin: 'anonymous',
            async: true,
          }) +
          '></script>' +
          themeSync('https://beaudar.lipk.org'),
      };
    },
  },

  utterances: {
    needs: ['repo'],
    build(c) {
      return {
        container: '<div class="utterances" data-xfm-comments></div>',
        scripts:
          '<script src="https://utteranc.es/client.js"' +
          attrs({
            repo: c.repo,
            'issue-term': c.issueTerm || c.mapping || 'pathname',
            label: c.label || 'comment',
            theme: c.theme || 'preferred-color-scheme',
            crossorigin: 'anonymous',
            async: true,
          }) +
          '></script>',
      };
    },
  },

  disqus: {
    needs: ['shortname'],
    build(c, ctx) {
      const config = `{ this.page.url = ${json(ctx.url)}; this.page.identifier = ${json(ctx.key)}; }`;
      return {
        container: '<div id="disqus_thread" data-xfm-comments></div>',
        scripts: `<script>
(function () {
  var d = document;
  window.disqus_config = function () ${config};
  var s = d.createElement('script');
  s.src = 'https://' + ${json(c.shortname)} + '.disqus.com/embed.js';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);
})();
</script>`,
      };
    },
  },

  waline: {
    needs: ['serverURL'],
    build(c, ctx) {
      const opt = {
        el: '#waline',
        serverURL: c.serverURL,
        path: ctx.key,
        lang: c.lang || 'zh-CN',
        dark: c.dark === false ? false : 'html[data-theme="dark"]',
      };
      for (const k of ['emoji', 'requiredMeta', 'login', 'commentSorting']) {
        if (c[k]) opt[k] = c[k];
      }
      return {
        css: '<link rel="stylesheet" href="https://unpkg.com/@waline/client@v3/dist/waline.css">',
        container: '<div id="waline" data-xfm-comments></div>',
        scripts:
          '<script type="module">' +
          "import { init } from 'https://unpkg.com/@waline/client@v3/dist/waline.js';" +
          `init(${json(opt)});` +
          '</script>',
      };
    },
  },

  twikoo: {
    needs: ['envId'],
    build(c, ctx) {
      const opt = { envId: c.envId, el: '#tcomment', path: ctx.key };
      if (c.lang) opt.lang = c.lang;
      if (c.region) opt.region = c.region;
      return {
        container: '<div id="tcomment" data-xfm-comments></div>',
        scripts:
          '<script src="https://cdn.jsdelivr.net/npm/twikoo@2/dist/twikoo.min.js"></script>' +
          `<script>twikoo.init(${json(opt)});</script>`,
      };
    },
  },

  valine: {
    needs: ['appId', 'appKey'],
    build(c, ctx) {
      const opt = {
        el: '#vcomments',
        appId: c.appId,
        appKey: c.appKey,
        path: ctx.key,
        placeholder: c.placeholder || '欢迎留言',
      };
      for (const k of ['serverURLs', 'lang', 'meta']) {
        if (c[k]) opt[k] = c[k];
      }
      return {
        container: '<div id="vcomments" data-xfm-comments></div>',
        scripts:
          '<script src="https://unpkg.com/valine@1/dist/Valine.min.js"></script>' +
          `<script>new Valine(${json(opt)});</script>`,
      };
    },
  },

  gitalk: {
    needs: ['clientID', 'clientSecret', 'repo', 'owner', 'admin'],
    build(c, ctx) {
      const opt = {
        clientID: c.clientID,
        clientSecret: c.clientSecret,
        repo: c.repo,
        owner: c.owner,
        admin: Array.isArray(c.admin) ? c.admin : [c.admin],
        id: ctx.key,
        distractionFreeMode: c.distractionFreeMode !== false,
      };
      if (c.proxy) opt.proxy = c.proxy;
      return {
        css: '<link rel="stylesheet" href="https://unpkg.com/gitalk/dist/gitalk.css">',
        container: '<div id="gitalk-container" data-xfm-comments></div>',
        scripts:
          '<script src="https://unpkg.com/gitalk/dist/gitalk.min.js"></script>' +
          `<script>new Gitalk(${json(opt)}).render('gitalk-container');</script>`,
      };
    },
  },

  artalk: {
    needs: ['server'],
    build(c, ctx) {
      const opt = {
        el: '#Comments',
        server: c.server,
        pageKey: ctx.key,
        pageTitle: c.pageTitle === false ? '' : ctx.title,
      };
      if (c.site) opt.site = c.site;
      if (c.dark !== false) opt.darkMode = 'auto';
      return {
        css: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/artalk@2/dist/Artalk.css">',
        container: '<div id="Comments" data-xfm-comments></div>',
        scripts:
          '<script src="https://cdn.jsdelivr.net/npm/artalk@2/dist/Artalk.js"></script>' +
          `<script>Artalk.init(${json(opt)});</script>`,
      };
    },
  },

  cusdis: {
    needs: ['appId'],
    build(c, ctx) {
      const host = String(c.host || 'https://cusdis.com').replace(/\/+$/, '');
      return {
        container:
          '<div id="cusdis_thread"' +
          attrs({
            'data-xfm-comments': true,
            'data-host': host,
            'data-app-id': c.appId,
            'data-page-id': ctx.key,
            'data-page-url': ctx.url,
            'data-page-title': ctx.title,
            'data-theme': c.dark === false ? 'light' : 'auto',
          }) +
          '></div>',
        scripts: `<script async defer src="${esc(host)}/js/cusdis.es.js"></script>`,
      };
    },
  },
};

/** 常见写法归一：github 其实就是 giscus，comments 是旧名字 */
const ALIASES = { github: 'giscus', comments: 'giscus' };

module.exports = (site) => {
  const c = site.config.comments || {};
  const raw = String(c.provider || 'giscus').toLowerCase();
  const provider = ALIASES[raw] || raw;
  const def = PROVIDERS[provider];
  const inDev = c.dev === true;
  const title = c.title === undefined ? '评论' : String(c.title);
  const base = (site.config.site && site.config.site.base) || '/';

  const missing = def ? def.needs.filter((k) => !c[k] || (Array.isArray(c[k]) && !c[k].length)) : [];

  let warned = false;
  const warn = (msg) => {
    if (warned || site.mode !== 'production') return;
    warned = true;
    console.warn(msg);
  };

  return {
    name: 'comments',

    /** 模板可用：{% if site.comments %}<div data-xfm-comments></div>{% endif %} */
    extendContext(ctx) {
      if (!def || missing.length) return ctx;
      return { ...ctx, comments: { provider, title } };
    },

    transformHtml(html, ctx) {
      if (!def) {
        warn(`[xfm-plugin-comments] 不支持的 provider "${raw}"，可选：${Object.keys(PROVIDERS).join(' / ')}`);
        return html;
      }
      if (missing.length) {
        warn(`[xfm-plugin-comments] provider ${provider} 缺少配置：${missing.join(', ')}，评论区不会显示`);
        return html;
      }
      if (!inDev && site.mode !== 'production') return html;

      const page = (ctx && ctx.page) || null;
      if (!page) return html;
      const data = page.data || {};
      if (data.comments === false) return html;
      // 只挂文章：聚合页、首页、分类页、独立页面一律跳过
      if (data.type === 'page' || data.type === 'index' || !page.date || page.url === '/') return html;

      // 评论与页面的绑定键：默认用站点内路径（换域名不影响），也可用完整 URL 或标题
      const path = site.helpers.withBase(base, page.url || '/');
      const key =
        c.identifier === 'url'
          ? site.helpers.absoluteUrl(site.config.site, page.url)
          : c.identifier === 'title'
            ? page.title || path
            : path;
      const url = site.helpers.absoluteUrl(site.config.site, page.url);

      const snippet = def.build(c, { key, url, title: page.title || '' });
      const section =
        `<section class="comments" data-comments-provider="${provider}" style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border,#e6e6e6)">` +
        (title ? `<h2 style="font-size:1.15rem;margin:0 0 1rem">${esc(title)}</h2>` : '') +
        snippet.container +
        snippet.scripts +
        '</section>';

      // 模板自己留了挂载点：只补脚本，不重复建容器
      const body = html.includes('data-xfm-comments') ? snippet.scripts : section;

      const out = insertBefore(html, body);
      return snippet.css ? insertHead(out, snippet.css) : out;
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

module.exports.PROVIDERS = Object.keys(PROVIDERS);
