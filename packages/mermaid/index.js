'use strict';
/**
 * Mermaid 图表插件（xfm-plugin-mermaid）
 *
 * 安装：npm i -D xfm-plugin-mermaid —— 装了就生效（也可在 config.plugins 写 'mermaid'）
 * -------------------------------------------------------------------
 * 把 ```mermaid 围栏代码块变成图表：
 *
 *   ```mermaid
 *   graph TD
 *     A[开始] --> B{判断}
 *     B -->|是| C[结束]
 *   ```
 *
 * 产物是 `<pre class="mermaid">…</pre>`，由浏览器里的 mermaid 渲染成 SVG。
 * 只有真正含图表的页面才会注入脚本（5MB 的 UMD 包不会拖慢其他页面）。
 *
 * 为什么不在构建期渲染：mermaid 需要 DOM 与测量，Node 里得挂 jsdom/headless
 * 浏览器，会把"零依赖、秒级构建"的承诺毁掉。客户端渲染的代价是首屏多一次
 * 脚本执行，换来构建零依赖、图随主题/字号自适应。
 *
 * 资源默认自托管（离线可用、无第三方请求）：构建时把 node_modules 里的
 * `mermaid.min.js` 复制到 `dist/assets/mermaid/`；也可以改用 CDN。
 *
 * 配置：
 *   mermaid: {
 *     mode: 'local',        // 'local' 复制进产物 | 'cdn' 用 CDN | 'none' 自己引
 *     path: 'assets/mermaid',
 *     cdn: 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.min.js',
 *     theme: 'default',     // default | neutral | dark | forest | base
 *     securityLevel: 'loose', // 允许 click 交互 / HTML 标签；不信任内容时用 'strict'
 *     option: {},           // 其余原样并入 mermaid.initialize()
 *   }
 * 页面级关闭：front-matter 写 mermaid: false
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.min.js';

/** 代码块（可能带标题行）→ `<pre class="mermaid">`；内容保持已转义状态 */
const BLOCK = /<div class="code-block">(?:<div class="code-title">[\s\S]*?<\/div>)?\s*<pre class="language-mermaid"><code>([\s\S]*?)<\/code><\/pre>\s*<\/div>/g;

module.exports = (site) => {
  const conf = (site.config && site.config.mermaid) || {};
  const esc = site.helpers.escapeHtml;
  const mode = conf.mode || 'local';
  const assetPath = String(conf.path || 'assets/mermaid').replace(/^\/+/, '').replace(/\/+$/, '');
  const base = (site.config && site.config.site && site.config.site.base) || '/';
  const init = Object.assign(
    {
      startOnLoad: false,
      theme: conf.theme || 'default',
      securityLevel: conf.securityLevel || 'loose',
    },
    conf.option || {}
  );

  const scriptUrl =
    mode === 'cdn' ? conf.cdn || DEFAULT_CDN : mode === 'local' ? `/${assetPath}/mermaid.min.js` : '';

  /** 页面里是否有需要渲染的图表（代码块或手写的 <pre class="mermaid">） */
  function hasDiagram(html) {
    return /<pre class="language-mermaid"|<pre class="mermaid"/.test(html);
  }

  return {
    name: 'mermaid',

    transformHtml(html, ctx) {
      if (!html) return html;
      const page = (ctx && ctx.page) || null;
      if (page && page.data && page.data.mermaid === false) return html;
      if (!hasDiagram(html)) return html;

      const body = html.replace(BLOCK, (m, code) => `<pre class="mermaid">${code}</pre>`);
      if (!body.includes('class="mermaid"')) return html;

      // 已经注入过（多个插件/手写脚本）就不重复
      if (/mermaid(?:\.min)?\.js/.test(body)) return body;

      const options = JSON.stringify(init).replace(/</g, '\\u003c');
      const style =
        '<style>pre.mermaid{background:transparent;border:0;padding:0;margin:1.2em 0;' +
        'text-align:center;overflow-x:auto;font-family:inherit}</style>';
      const script = scriptUrl
        ? `<script src="${esc(site.helpers.withBase(base, scriptUrl))}"></script>`
        : '';
      const boot =
        '<script>(function(){if(!window.mermaid)return;' +
        `window.mermaid.initialize(${options});` +
        "window.mermaid.run({querySelector:'.mermaid'});})();</script>";

      return /<\/body>/i.test(body)
        ? body.replace(/<\/body>/i, `${style}${script}${boot}</body>`)
        : body + style + script + boot;
    },

    afterBuild() {
      if (mode !== 'local') return [];
      let file;
      try {
        file = require.resolve('mermaid/dist/mermaid.min.js');
      } catch (e) {
        throw new Error('[mermaid] 没找到 mermaid 包，请先在站点里 npm i -D xfm-plugin-mermaid（会带上 mermaid）');
      }
      return [{ path: `${assetPath}/mermaid.min.js`, contents: fs.readFileSync(file) }];
    },
  };
};
