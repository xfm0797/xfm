export default {
  site: {
    title: 'XFM Notes',
    description: '关于静态站点、性能与前端的笔记。',
    lang: 'zh-CN',
    author: 'XFM',
    base: '/',
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
  server: { port: 4321 },
};
