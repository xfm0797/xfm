export default {
  site: {
    title: 'XFM Notes',
    description: '关于静态站点、性能与前端的笔记。',
    lang: 'zh-CN',
    author: 'XFM',
    base: '/',
    // 部署域名：本地构建留空（产物用相对地址），CI 里由 SITE_URL 注入绝对地址，
    // sitemap / rss 需要它才能输出合法的 <loc>https://…</loc>
    url: process.env.SITE_URL || '',
    copyright: '© 2026 XFM Notes · 保留所有权利',
    nav: [
      { title: '文章', url: '/' },
      { title: '关于', url: '/about/' },
    ],
  },
  theme: 'themes/default',
  plugins: ['./plugins/sitemap.js', './plugins/rss.js', './plugins/reading-stats.js'],
  defaults: {
    layout: 'post.html',
  },
  server: { port: 4173 },
};
