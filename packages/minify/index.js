'use strict';
/**
 * minify 插件（xfm-plugin-minify）
 *
 * 安装：npm i -D xfm-plugin-minify —— 装了就生效（也可在 config.plugins 写 'minify'）
 * -------------------------------------------------------------------
 * 构建时压缩 HTML：
 *   - 删除 HTML 注释（保留 `<!--[if ...]>` 条件注释）
 *   - 删除行尾空白与连续空行
 *   - `minify.aggressive: true` 时额外折叠标签之间的换行（`>\n<` → `><`）
 *
 * 只折叠「跨行」的空白，不碰同一行里的单个空格——那是行内元素之间的
 * 语义间距，删掉会让 `<a>甲</a> <b>乙</b>` 粘成一坨。
 * 激进模式才动它，且文档里标明可能有副作用。
 *
 * <pre> / <code> / <textarea> / <script> / <style> 整体跳过，内容原样保留。
 *
 * 配置：minify: { enabled: true, aggressive: false }
 */
const PROTECT = /<(pre|code|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

module.exports = (site) => {
  const cfg = site.config.minify || {};
  const aggressive = cfg.aggressive === true;
  // dev 下不压缩：源码保持可读，热更新与调试时看 HTML 更直观
  const dev = site.mode === 'development';

  return {
    name: 'minify',

    transformHtml(html) {
      if (!html) return html;
      if (cfg.enabled === false || dev) return html;

      // 原文块先摘出来，避免正则误伤其中的空白与注释。
      // 占位符写成标签形式：行首缩进规则 `\n[ \t]+(?=<)` 才会把它前面的缩进一并清掉
      const stash = [];
      let out = html.replace(PROTECT, (m) => {
        stash.push(m);
        return `<xfm-stash-${stash.length - 1}/>`;
      });

      out = out
        .replace(/\r\n?/g, '\n') // 模板与 Markdown 的换行符可能不一致，先统一
        .replace(/<!--(?!\[if)[\s\S]*?-->/g, '') // 注释
        .replace(/[ \t]+$/gm, '') // 行尾空白
        .replace(/^[ \t]+$/gm, '') // 只含空白的行
        .replace(/\n[ \t]+(?=<)/g, '\n') // 行首缩进（保留换行，渲染结果不变）
        .replace(/\n{2,}/g, '\n') // 连续空行
        .trim();

      if (aggressive) out = out.replace(/>\s*\n\s*</g, '><');

      return out.replace(/<xfm-stash-(\d+)\/>/g, (m, i) => stash[Number(i)]);
    },
  };
};
