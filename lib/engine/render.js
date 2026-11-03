'use strict';
/**
 * 渲染管线（主线程与 worker 共用）
 * -------------------------------------------------------------------
 * 之前主线程和 worker 各自实现了一遍"解析 front-matter → 渲染 Markdown →
 * 组装模板上下文"，两份实现逐渐漂移，导致同一份源文件在
 * "页面数 < workerThreshold" 与 ">= workerThreshold" 时产出不同：
 *   - 相对 .md 链接只在主线程被重写
 *   - date 格式一个走 UTC、一个走字符串截断
 *   - page.data.prev/next 只有主线程有
 *   - 阅读时长为 0，列表页永远不显示
 *
 * 现在这里只保留一份实现，两边都调用，保证产物逐字节一致。
 */

const path = require('path');
const { renderMarkdown, stripDuplicateH1 } = require('./markdown');

const EXCERPT_MAX = 140;
const READ_CHARS_PER_MIN = 350;

/** HTML / 任意输入 → 纯文本（去标签、折叠空白） */
function plainText(input) {
  return String(input == null ? '' : input)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Markdown 源码 → 近似纯文本
 * 只做轻量符号剥离，不渲染 HTML：摘要与字数统计不需要完整解析，
 * 在 collect 阶段就能拿到，列表页因此也能显示阅读时长。
 */
function markdownPlain(src) {
  return String(src == null ? '' : src)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>)\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/gm, '')
    .replace(/^\s*:{3,}\s*\w*/gm, ' ')
    .replace(/[`*_~#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 摘要 + 阅读时长
 * @param {string} source 正文源码（Markdown 或 HTML）
 * @param {boolean} isMd
 * @param {string} [description] front-matter 里的 description 优先
 */
function summarize(source, isMd, description) {
  const text = isMd ? markdownPlain(source) : plainText(source);
  const excerpt = description || (text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX) + '…' : text);
  return { excerpt, readTime: Math.max(1, Math.round(text.length / READ_CHARS_PER_MIN)) };
}

const ABSOLUTE_LINK = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

/**
 * 相对链接解析器
 * @param {Map<string,string>} index rel 路径 → 页面 URL
 * @returns {(href:string, page:{rel:string}, cache?:Map)=>string}
 */
function createLinkResolver(index) {
  return function resolveLink(href, page, cache) {
    if (!href) return href;
    // 带协议、协议相对、根路径、纯锚点：交给浏览器
    if (ABSOLUTE_LINK.test(href)) return href;

    const hit = cache && cache.get(href);
    if (hit !== undefined) return hit;

    const hashAt = href.indexOf('#');
    const anchor = hashAt === -1 ? '' : href.slice(hashAt);
    const clean = (hashAt === -1 ? href : href.slice(0, hashAt)).replace(/^\.\//, '').split('?')[0];
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(page.rel), clean));

    let found = index.get(target);
    if (!found) {
      // 省略扩展名：./a → a.md
      for (const ext of ['.md', '.markdown', '.html']) {
        found = index.get(target + ext);
        if (found) break;
      }
    }
    if (!found) found = index.get(path.posix.join(target, 'index.md')); // 指向目录

    const result = found ? found + anchor : href;
    if (cache) cache.set(href, result);
    return result;
  };
}

/**
 * 正文渲染
 * @param {{isMd:boolean, rel:string}} page
 * @param {string} source 正文源码
 * @param {{link?:Function, highlight?:Function|false}} opts
 * @returns {{bodyHtml:string, headings:Array}}
 */
function renderBody(page, source, opts = {}) {
  const headings = [];
  const src = source == null ? '' : String(source);
  if (!page.isMd) return { bodyHtml: src, headings };
  const bodyHtml = renderMarkdown(src, {
    headings,
    link: opts.link,
    highlight: opts.highlight,
  });
  return { bodyHtml, headings };
}

/**
 * 组装模板上下文
 * @param {{view:object, bodyHtml:string, headings:Array, site:object}} args
 */
function buildContext({ view, bodyHtml, headings, site }) {
  const toc = (headings || []).filter((h) => h.level >= 2 && h.level <= 3);
  view.toc = toc; // 主线程与 worker 同源，page.toc 保持一致
  return {
    page: view,
    title: view.title,
    content: stripDuplicateH1(bodyHtml, view.title),
    data: view.data || {},
    headings: toc,
    excerpt: view.excerpt || '',
    readTime: view.readTime || 0,
    site,
  };
}

module.exports = {
  plainText,
  markdownPlain,
  summarize,
  createLinkResolver,
  renderBody,
  buildContext,
  EXCERPT_MAX,
};
