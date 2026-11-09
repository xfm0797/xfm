'use strict';
/**
 * feed-json 插件（xfm-plugin-feed-json）
 *
 * 安装：npm i -D xfm-plugin-feed-json —— 装了就生效（也可在 config.plugins 写 'feed-json'）
 * -------------------------------------------------------------------
 * 生成 JSON Feed 1.1（feed.json），与内置 rss 插件互补：
 * 阅读器、自动化脚本、前端 fetch 都能直接消费，不用解析 XML。
 *
 * 配置：feedJson: { path: 'feed.json', limit: 20 }
 * 页面级：rss: false 同时作用于两个 feed（沿用既有开关）。
 */
function iso(day) {
  const s = String(day || '');
  if (!s) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00+00:00` : s;
}

module.exports = (site) => {
  const { absoluteUrl } = site.helpers;
  const cfg = site.config.feedJson || {};
  const limit = Number(cfg.limit) || 20;

  return {
    name: 'feed-json',

    afterBuild(site) {
      const siteConf = site.config.site || {};
      const posts = (site.documents || [])
        .filter((p) => p.date && p.data.type !== 'page' && p.data.rss !== false && p.url !== '/')
        .slice(0, limit);

      const feedUrl = absoluteUrl(siteConf, '/' + (cfg.path || 'feed.json'));
      const items = posts.map((p) => ({
        id: absoluteUrl(siteConf, p.url),
        url: absoluteUrl(siteConf, p.url),
        title: p.title || '',
        content_html: p.html || '',
        summary: p.description || p.excerpt || '',
        date_published: iso(p.date),
        date_modified: iso(p.updated || p.date),
        tags: p.tags && p.tags.length ? p.tags : undefined,
        authors: siteConf.author ? [{ name: siteConf.author }] : undefined,
      }));

      const feed = {
        version: 'https://jsonfeed.org/version/1.1',
        title: siteConf.title || '',
        home_page_url: absoluteUrl(siteConf, '/'),
        feed_url: feedUrl,
        description: siteConf.description || '',
        language: siteConf.lang || 'zh-CN',
        authors: siteConf.author ? [{ name: siteConf.author }] : undefined,
        items,
      };

      return [{ path: cfg.path || 'feed.json', contents: JSON.stringify(feed, null, 2) + '\n' }];
    },
  };
};
