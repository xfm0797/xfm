'use strict';
/**
 * giscus 插件（xfm-plugin-giscus）
 *
 * 安装：npm i -D xfm-plugin-giscus —— 装了就生效（也可在 config.plugins 写 'giscus'）
 * -------------------------------------------------------------------
 * 用 GitHub Discussions 做文章评论：纯静态、无需后端、无广告、无需注册。
 * 支持 giscus 与 utterances 两种（都挂 GitHub Issues/Discussions）。
 *
 * 配置：
 *   comments: {
 *     provider: 'giscus',                  // giscus（默认）| utterances
 *     repo: 'owner/repo',                  // 必填，仓库要公开
 *     repoId: 'R_kgDOxxxx',                // giscus 必填（giscus.app 上生成）
 *     category: 'Announcements',
 *     categoryId: 'DIC_kwDOxxxx',
 *     mapping: 'pathname',
 *     theme: 'preferred_color_scheme',     // 跟随明暗由插件自动接管
 *     lang: 'zh-CN',
 *     title: '评论',                        // 区块标题，写 '' 则不显示
 *     // utterances 专用
 *     issueTerm: 'pathname',
 *     label: 'comment',
 *     dev: false,                          // dev 下是否也渲染（默认只在生产）
 *   }
 *
 * 页面级：front-matter 写 comments: false 关闭单页评论；
 * 模板若自己写了 `<div data-xfm-comments>` 作为挂载点，插件只补脚本不重复建容器。
 *
 * 只给文章页插入（有 date 且不是 type: page 的页面），首页/归档/404 不会有评论区。
 */
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 明暗切换时通知 giscus 换主题（giscus 用 postMessage 改配置） */
const SYNC_SCRIPT = `<script>
(function () {
  var root = document.documentElement;
  function frame() { return document.querySelector('iframe.giscus-frame'); }
  function sync() {
    var f = frame();
    if (!f) return;
    var theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    f.contentWindow.postMessage({ giscus: { setConfig: { theme: theme } } }, 'https://giscus.app');
  }
  // iframe 是异步插进来的，等它出现再同步一次
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
})();
</script>`;

module.exports = (site) => {
  const cfg = site.config.comments || {};
  const provider = String(cfg.provider || 'giscus').toLowerCase();
  const repo = cfg.repo || '';
  const inDev = cfg.dev === true;
  const title = cfg.title === undefined ? '评论' : String(cfg.title);

  /** 生成挂载容器 + 客户端脚本；配置不全时返回空串 */
  const build = () => {
    if (!repo) return '';
    const map = cfg.mapping || cfg.issueTerm || 'pathname';

    if (provider === 'utterances') {
      return (
        `<div class="utterances" data-xfm-comments></div>` +
        `<script src="https://utteranc.es/client.js"` +
        ` repo="${esc(repo)}"` +
        ` issue-term="${esc(map)}"` +
        ` label="${esc(cfg.label || 'comment')}"` +
        ` theme="preferred-color-scheme"` +
        ` crossorigin="anonymous" async></script>`
      );
    }

    if (!cfg.repoId) return '';
    return (
      `<div class="giscus" data-xfm-comments></div>` +
      `<script src="https://giscus.app/client.js"` +
      ` data-repo="${esc(repo)}"` +
      ` data-repo-id="${esc(cfg.repoId)}"` +
      ` data-category="${esc(cfg.category || 'General')}"` +
      ` data-category-id="${esc(cfg.categoryId || '')}"` +
      ` data-mapping="${esc(map)}"` +
      ` data-strict="${cfg.strict ? '1' : '0'}"` +
      ` data-reactions-enabled="${cfg.reactionsEnabled === false ? '0' : '1'}"` +
      ` data-emit-metadata="0"` +
      ` data-input-position="${esc(cfg.inputPosition || 'bottom')}"` +
      ` data-theme="${esc(cfg.theme || 'preferred_color_scheme')}"` +
      ` data-lang="${esc(cfg.lang || 'zh-CN')}"` +
      ` crossorigin="anonymous" async></script>`
    );
  };

  const widget = build();

  if (!widget && site.mode === 'production') {
    console.warn(`[xfm-plugin-giscus] 未配置 comments.repo${provider === 'giscus' ? ' / repoId' : ''}，评论区不会显示`);
  }

  return {
    name: 'giscus',

    /** 让主题能自己放位置：{% if site.comments %}<div data-xfm-comments></div>{% endif %} */
    extendContext(ctx) {
      if (!widget) return ctx;
      return { ...ctx, comments: { provider, title, repo } };
    },

    transformHtml(html, ctx) {
      if (!widget) return html;
      if (!inDev && site.mode !== 'production') return html;

      const page = (ctx && ctx.page) || null;
      if (!page) return html;
      const data = page.data || {};
      if (data.comments === false) return html;
      // 只挂文章：聚合页、首页、分类页、独立页面一律跳过
      if (data.type === 'page' || data.type === 'index' || !page.date || page.url === '/') return html;

      const hasMount = html.includes('data-xfm-comments');
      const body = hasMount
        ? SYNC_SCRIPT
        : `<section class="comments" style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border,#e6e6e6)">` +
          (title ? `<h2 style="font-size:1.15rem;margin:0 0 1rem">${esc(title)}</h2>` : '') +
          widget +
          `</section>\n${SYNC_SCRIPT}`;

      // 优先贴着文章结尾，其次主内容区，最后退回 body 末尾
      for (const tag of ['</article>', '</main>', '</body>']) {
        const at = html.lastIndexOf(tag);
        if (at !== -1) return html.slice(0, at) + body + '\n' + html.slice(at);
      }
      return html + body;
    },
  };
};
