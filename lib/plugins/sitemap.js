'use strict';
/**
 * sitemap 插件
 * 生成 sitemap.xml，自动排除草稿与 sitemap: false 的页面，
 * 有 updated 字段时输出 lastmod。
 */
module.exports = (site) => ({
  name: 'sitemap',

  afterBuild(site) {
    const base = (site.config.site.url || site.config.site.base || '').replace(/\/$/, '');
    const pages = site.documents.filter((p) => p.data.sitemap !== false);

    const urls = pages
      .map((p) => {
        const loc = base + (p.url === '/' ? '/' : p.url);
        const lastmod = p.updated || p.date;
        return (
          '  <url>\n' +
          `    <loc>${esc(loc)}</loc>\n` +
          (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
          (p.weight ? `    <priority>${Math.min(1, Math.max(0.1, 1 - p.weight / 100)).toFixed(1)}</priority>\n` : '') +
          '  </url>'
        );
      })
      .join('\n');

    return [
      {
        path: 'sitemap.xml',
        contents: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      },
      {
        path: 'robots.txt',
        contents: `User-agent: *\nAllow: /\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`,
      },
    ];
  },
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
