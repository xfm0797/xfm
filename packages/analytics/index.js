'use strict';
/**
 * analytics 插件（xfm-plugin-analytics）
 *
 * 安装：npm i -D xfm-plugin-analytics —— 装了就生效（也可在 config.plugins 写 'analytics'）
 * -------------------------------------------------------------------
 * 往每个页面的 </body> 前插入一段访问统计脚本。支持四种常见服务，
 * 外加 'custom' 直接贴自己的代码 —— 没有账号体系、没有鉴权接口，
 * 就是个纯静态站能用的浏览计数。
 *
 * 配置：
 *   analytics: {
 *     provider: 'umami',                       // umami | plausible | google | baidu | custom
 *     umami: { src: 'https://umami.example.com/script.js', id: 'xxxx' },
 *     plausible: { domain: 'example.com', src: 'https://plausible.io/js/script.js' },
 *     google: { id: 'G-XXXXXXX' },
 *     baidu: { id: '0123456789abcdef' },
 *     script: '<script>...</script>',          // provider: 'custom' 时使用
 *     dev: false,                              // dev 下是否也注入（默认只在生产）
 *     exclude: ['/draft-preview/'],            // 这些路径不注入
 *   }
 *
 * 页面级：front-matter 写 analytics: false 可让单页跳过统计。
 *
 * provider 也可以是数组：['umami', 'google'] 同时埋两套（迁移期常见）。
 */
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 各服务的最小可用片段 */
const PROVIDERS = {
  umami(o) {
    const src = o.src || 'https://umami.example.com/script.js';
    return `<script defer src="${esc(src)}" data-website-id="${esc(o.id || '')}"></script>`;
  },

  plausible(o) {
    const src = o.src || 'https://plausible.io/js/script.js';
    return `<script defer data-domain="${esc(o.domain || '')}" src="${esc(src)}"></script>`;
  },

  google(o) {
    const id = esc(o.id || '');
    return (
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>` +
      `<script>window.dataLayer=window.dataLayer||[];` +
      `function gtag(){dataLayer.push(arguments)}` +
      `gtag('js',new Date());gtag('config','${id}');</script>`
    );
  },

  baidu(o) {
    const id = String(o.id || '').replace(/[^\w]/g, '');
    return (
      `<script>var _hmt=_hmt||[];(function(){` +
      `var hm=document.createElement("script");` +
      `hm.src="https://hm.baidu.com/hm.js?${id}";` +
      `var s=document.getElementsByTagName("script")[0];` +
      `s.parentNode.insertBefore(hm,s)})();</script>`
    );
  },

  custom(o) {
    return String(o.script || '');
  },
};

module.exports = (site) => {
  const cfg = site.config.analytics || {};
  const providers = Array.isArray(cfg.provider) ? cfg.provider : [cfg.provider || 'umami'];
  const inDev = cfg.dev === true;
  const exclude = (cfg.exclude || []).map(String);

  // 片段只算一次（每页都要插，重复拼字符串纯属浪费）
  const snippet = providers
    .map((name) => {
      const fn = PROVIDERS[String(name).toLowerCase()];
      if (!fn) {
        console.warn(`[xfm-plugin-analytics] 未知 provider "${name}"，可选：${Object.keys(PROVIDERS).join(' / ')}`);
        return '';
      }
      return fn(cfg[name] || cfg);
    })
    .filter(Boolean)
    .join('\n');

  return {
    name: 'analytics',

    transformHtml(html, ctx) {
      if (!snippet) return html;
      if (!inDev && site.mode !== 'production') return html;
      const page = (ctx && ctx.page) || null;
      if (!page) return html;
      if (page.data && page.data.analytics === false) return html;
      if (exclude.some((p) => String(page.url || '').startsWith(p))) return html;

      const at = html.lastIndexOf('</body>');
      if (at === -1) return html;
      // 同一页重复注入没有意义（多布局拼装时可能出现两次 </body>）
      if (html.includes('data-xfm-analytics')) return html;
      return `${html.slice(0, at)}<div data-xfm-analytics hidden></div>\n${snippet}\n${html.slice(at)}`;
    },
  };
};
