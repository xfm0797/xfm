'use strict';
/**
 * URL 工具
 * -------------------------------------------------------------------
 * `site.base` 是站点部署的子路径（例如 GitHub Pages 项目页 `/xfm/`）。
 * 约定：
 *   - 页面内部（聚合、路由、落盘路径、sitemap 之外的索引）一律用"裸 URL"，
 *     即不带 base 的 `/posts/x/`，这样 urlToFilePath 与增量缓存都不受 base 影响；
 *   - 只在产出给浏览器/爬虫的字符串上补前缀：HTML 里的 href/src、
 *     sitemap/rss 的 <loc>/<link>、search.json 里的 url。
 * HTML 前缀由 Theme.render 统一做一次（主线程与 worker 共用同一处），
 * 因此模板里可以放心写 `href="/tags/x/"` 这类根绝对路径。
 */

/** 规范化 base：始终以 / 开头、以 / 结尾、无重复斜杠 */
function normalizeBase(base) {
  let b = String(base == null ? '' : base).trim();
  if (!b || b === '.') return '/';
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b.replace(/\/{2,}/g, '/');
}

/** 裸 URL → 带 base 的 URL（base 为 / 时原样返回） */
function withBase(base, url) {
  const b = normalizeBase(base);
  const u = String(url == null ? '' : url);
  if (b === '/') return u;
  const prefix = b.slice(0, -1); // 去掉结尾斜杠，保留开头的
  if (u === '/') return b;
  if (!u.startsWith('/')) return prefix + '/' + u;
  return prefix + u;
}

/** 绝对地址：site.url（源） + base + 裸 URL */
function absoluteUrl(siteConfig, url) {
  const cfg = siteConfig || {};
  const origin = String(cfg.url || '').replace(/\/+$/, '');
  return origin + withBase(cfg.base, url);
}

// 只认根绝对路径（`/x`），跳过协议相对地址（`//cdn`）与完整 URL
const ATTR_DOUBLE = /(\s(?:href|src|poster|action)=")\/(?!\/)([^"]*)"/g;
const ATTR_SINGLE = /(\s(?:href|src|poster|action)=')\/(?!\/)([^']*)'/g;

/**
 * 给整页 HTML 的根绝对链接补 base 前缀
 * 在 Theme.render 出口调用一次：模板、Markdown、用户原始 HTML 三类来源一并覆盖。
 * @param {string} html
 * @param {string} base
 */
function applyBase(html, base) {
  const b = normalizeBase(base);
  if (b === '/' || !html) return html;
  const prefix = b.slice(0, -1);
  const repl = (m, lead, rest) => `${lead}${prefix}/${rest}"`;
  const replSingle = (m, lead, rest) => `${lead}${prefix}/${rest}'`;
  return html.replace(ATTR_DOUBLE, repl).replace(ATTR_SINGLE, replSingle);
}

module.exports = { normalizeBase, withBase, absoluteUrl, applyBase };
