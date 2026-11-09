'use strict';
/**
 * 插件可用的工具集
 * -------------------------------------------------------------------
 * 插件是独立发布的 npm 包（`xfm-plugin-*`），既不能也不该去 require
 * xfmpress 的内部文件路径：
 *
 *   - 用户可能只装了全局 CLI，站点目录里没有 node_modules/xfmpress；
 *   - 内部路径一旦调整，所有插件包会集体炸掉。
 *
 * 所以引擎在 `site.helpers` 上挂一份稳定的工具集，插件只依赖它：
 *
 *   module.exports = (site) => {
 *     const { absoluteUrl } = site.helpers;
 *     return { name: 'my-plugin', afterBuild() {} };
 *   };
 *
 * 这里只收「与站点语义强相关、插件普遍需要」的函数，保持面窄：
 * 面越窄，越不容易在版本升级时变成破坏性变更。
 */

const { normalizeBase, withBase, absoluteUrl, applyBase } = require('./url');
const { plainText, markdownPlain } = require('./render');
const { escapeHtml } = require('./markdown');

module.exports = Object.freeze({
  // URL：site.base 补前缀、site.url 拼绝对地址
  normalizeBase,
  withBase,
  absoluteUrl,
  applyBase,
  // 文本：HTML → 纯文本、Markdown → 纯文本、HTML 转义
  plainText,
  markdownPlain,
  escapeHtml,
});
