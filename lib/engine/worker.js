'use strict';
/**
 * 渲染 worker（池模式）
 * -------------------------------------------------------------------
 * 与主线程共用 Theme / render 模块，只负责"批量渲染 + 结果回传"。
 * 早期版本在 worker 里重写了一遍 MiniTheme 与页面上下文组装，
 * 结果与主线程逐渐漂移（相对链接、date 格式、prev/next、嵌套 include）。
 * 现在唯一差异只是线程边界。
 *
 * 消息协议：
 *   主 → worker  { type: 'init', site, themeDir, defaults, links, highlight }
 *   主 → worker  { type: 'render', id, jobs }
 *   worker → 主  { type: 'ready' }
 *   worker → 主  { type: 'done', id, results }
 *   worker → 主  { type: 'error', id, message, stack }
 */

const fs = require('fs');
const path = require('path');
const { parentPort } = require('worker_threads');

const { Theme } = require('./theme');
const { createLinkResolver, renderBody, buildContext } = require('./render');

let site = {};
let defaults = { layout: 'page.html' };
let theme = null;
let resolveLink = null;
let highlight;

function renderJobs(jobs) {
  const results = [];
  for (const job of jobs) {
    const linkCache = new Map();
    const { bodyHtml, headings } = renderBody(job, job.body, {
      link: (href) => resolveLink(href, job, linkCache),
      highlight,
    });
    const ctx = buildContext({ view: job.view, bodyHtml, headings, site });
    let html;
    try {
      html = theme.render(job.view.layout || defaults.layout, ctx);
    } catch (e) {
      // 与主线程一致：模板错误直接失败，不产出半成品页面
      throw new Error(`页面渲染失败 ${job.key}：${e.message}\n${e.stack || ''}`);
    }
    results.push({ key: job.key, html, bodyHtml });
  }
  return results;
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') {
      site = msg.site || {};
      defaults = msg.defaults || defaults;
      highlight = msg.highlight;
      resolveLink = createLinkResolver(new Map(msg.links || []));
      theme = await Theme.load(msg.themeDir, site);

      // 预热：把所有 layout 编译一次，后续任务零编译开销
      const layoutsDir = path.join(msg.themeDir, 'layouts');
      if (fs.existsSync(layoutsDir)) {
        for (const f of fs.readdirSync(layoutsDir)) {
          if (!f.endsWith('.html')) continue;
          try { theme.template(f); } catch (e) { /* 单个模板错误交给实际渲染时报出 */ }
        }
      }
      parentPort.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'render') {
      const results = renderJobs(msg.jobs);
      parentPort.postMessage({ type: 'done', id: msg.id, results });
    }
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg.id, message: e.message, stack: e.stack });
  }
});
