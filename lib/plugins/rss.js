'use strict';
/**
 * RSS 插件
 * 生成 feed.xml（RSS 2.0）。取最近 N 篇带日期的文章。
 */
module.exports = (site) => {
  const limit = (site.config.site && site.config.site.rss && site.config.site.rss.limit) || 20;
  return {
    name: 'rss',

    afterBuild(site) {
      const cfg = site.config.site;
      const base = (cfg.url || cfg.base || '').replace(/\/$/, '');
      const posts = site.documents
        .filter((p) => p.date && p.data.type !== 'page' && p.data.rss !== false && p.url !== '/')
        .slice(0, limit);

      const items = posts
        .map((p) => {
          const link = base + p.url;
          return (
            '    <item>\n' +
            `      <title>${esc(p.title)}</title>\n` +
            `      <link>${esc(link)}</link>\n` +
            `      <guid isPermaLink="true">${esc(link)}</guid>\n` +
            (p.date ? `      <pubDate>${new Date(p.date).toUTCString()}</pubDate>\n` : '') +
            `      <description>${esc(p.description || p.excerpt || '')}</description>\n` +
            (p.tags && p.tags.length
              ? p.tags.map((t) => `      <category>${esc(t)}</category>`).join('\n') + '\n'
              : '') +
            `      <content:encoded><![CDATA[${p.html || ''}]]></content:encoded>\n` +
            '    </item>'
          );
        })
        .join('\n');

      const now = new Date().toUTCString();
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
        '  <channel>\n' +
        `    <title>${esc(cfg.title)}</title>\n` +
        `    <link>${esc(base || '/')}</link>\n` +
        `    <description>${esc(cfg.description || '')}</description>\n` +
        `    <language>${esc(cfg.lang || 'zh-CN')}</language>\n` +
        `    <lastBuildDate>${now}</lastBuildDate>\n` +
        `    <atom:link href="${esc(base)}/feed.xml" rel="self" type="application/rss+xml"/>\n` +
        `${items}\n` +
        '  </channel>\n' +
        '</rss>\n';

      return [{ path: 'feed.xml', contents: xml }];
    },
  };
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
