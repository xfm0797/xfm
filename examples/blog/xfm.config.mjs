export default {
  site: {
    title: 'XFM Notes',
    description: '关于静态站点、性能与前端的笔记。',
    lang: 'zh-CN',
    author: 'XFM',
    // 部署子路径：本地默认根路径；GitHub Pages 项目页由 SITE_BASE 注入 /<repo>/
    base: process.env.SITE_BASE || '/',
    // 部署域名：本地构建留空（产物用相对地址），CI 里由 SITE_URL 注入绝对地址，
    // sitemap / rss 需要它才能输出合法的 <loc>https://…</loc>
    url: process.env.SITE_URL || '',
    copyright: '© 2026 XFM Notes · 保留所有权利',
    nav: [
      { title: '首页', url: '/' },
      { title: '分类', url: '/categories/' },
      { title: '归档', url: '/archives/' },
      { title: '关于', url: '/about/' },
    ],
  },
  theme: 'themes/default',
  plugins: [
    './plugins/sitemap.js',
    './plugins/rss.js',
    './plugins/reading-stats.js',
    'feed-json',
    'search',
    'seo',
    'related',
    'llms',
    'minify',
  ],
  defaults: {
    layout: 'post.html',
  },
  pagination: { perPage: 9 },
  server: { port: 4173 },
};
