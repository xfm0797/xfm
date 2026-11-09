'use strict';
/**
 * llms 插件
 * -------------------------------------------------------------------
 * 按 llmstxt.org 约定生成给大模型读的纯文本索引：
 *
 *   llms.txt       站点摘要 + 分组的文章清单（标题 / 链接 / 一句话描述）
 *   llms-full.txt  同上，外加每篇正文的纯文本（llms.full: false 可关）
 *
 * 对 AI 搜索与「让模型了解这个站」的场景友好，体积远小于整站 HTML。
 *
 * 配置：llms: { path: 'llms.txt', full: true, fullPath: 'llms-full.txt', maxItems: 0 }
 * 页面级：front-matter 写 llms: false 可排除。
 */
const { absoluteUrl } = require('../engine/url');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** 粗糙但够用的 HTML → 纯文本 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&([a-z]+|#\d+);/gi, (m, k) => ENTITIES[k] || m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = (site) => {
  const cfg = site.config.llms || {};
  const siteConf = site.config.site || {};

  return {
    name: 'llms',

    afterBuild(site) {
      const all = (site.documents || []).filter(
        (p) => p.data && p.data.llms !== false && p.url !== '/' && p.date && p.data.type !== 'page'
      );
      const max = Number(cfg.maxItems) || 0;
      const posts = max > 0 ? all.slice(0, max) : all;
      if (!posts.length) return [];

      const byCat = new Map();
      for (const p of posts) {
        const key = p.category || '';
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key).push(p);
      }

      const line = (p) => {
        const url = absoluteUrl(siteConf, p.url);
        const desc = (p.description || '').replace(/\s+/g, ' ').trim();
        return `- [${p.title || p.url}](${url})${desc ? `: ${desc}` : ''}`;
      };

      const head = [`# ${siteConf.title || 'Site'}`, ''];
      if (siteConf.description) head.push(`> ${siteConf.description}`, '');
      head.push(`- 文章数：${posts.length}`, `- 语言：${siteConf.lang || 'zh-CN'}`, '');

      const body = [];
      for (const [cat, items] of byCat) {
        body.push(cat ? `## ${cat}` : '## 文章', '');
        for (const p of items) body.push(line(p));
        body.push('');
      }

      const files = [
        { path: cfg.path || 'llms.txt', contents: head.concat(body).join('\n').trimEnd() + '\n' },
      ];

      if (cfg.full !== false) {
        const full = [...head];
        for (const p of posts) {
          full.push(`## ${p.title || p.url}`, '', absoluteUrl(siteConf, p.url), '');
          const text = stripHtml(p.html);
          if (text) full.push(text, '');
        }
        files.push({
          path: cfg.fullPath || 'llms-full.txt',
          contents: full.join('\n').trimEnd() + '\n',
        });
      }

      return files;
    },
  };
};
