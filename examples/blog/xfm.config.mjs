export default {
  site: {
    title: 'XFM Notes',
    description: '关于静态站点、性能与前端的笔记。',
    lang: 'zh-CN',
    // 多语言：声明后 seo 插件会为 translationKey 相同的页面互注 hreflang，
    // 导航右侧出现语言切换；单语页面不受影响。
    languages: ['zh-CN', 'en'],
    author: 'XFM',
    // 部署子路径：本地默认根路径；GitHub Pages 项目页由 SITE_BASE 注入 /<repo>/
    base: process.env.SITE_BASE || '/',
    // 部署域名：本地构建留空（产物用相对地址），CI 里由 SITE_URL 注入绝对地址，
    // sitemap / rss 需要它才能输出合法的 <loc>https://…</loc>
    url: process.env.SITE_URL || '',
    copyright: '© 2026 XFM Notes · 保留所有权利',
    // nav 条目的 translations 按当前页语言解析标题与链接（多语言导航）
    nav: [
      { title: '首页', url: '/', translations: { en: { title: 'Home', url: '/en/' } } },
      { title: '作品', url: '/projects/', translations: { en: { title: 'Projects' } } },
      { title: '分类', url: '/categories/', translations: { en: { title: 'Categories' } } },
      { title: '归档', url: '/archives/', translations: { en: { title: 'Archives' } } },
      { title: '更新日志', url: '/changelog/', translations: { en: { title: 'Changelog' } } },
      { title: '关于', url: '/about/', translations: { en: { title: 'About', url: '/about-en/' } } },
    ],
  },
  theme: 'themes/default',
  // 插件不随内核发布：npm i -D xfm-plugin-<name> 装上即自动加载（package.json 依赖扫描），
  // 这里写短名只是为了固定加载顺序；写成 './plugins/x.js' 则是站点内的本地插件。
  plugins: [
    'sitemap', 'rss', 'reading-stats', 'feed-json', 'search', 'seo', 'related',
    'llms', 'math', 'mermaid', 'minify', 'pwa', 'deadlinks',
  ],
  defaults: {
    layout: 'post.html',
  },
  pagination: { perPage: 9 },
  // 自定义集合：content/projects/ 下的条目归到 /projects/ 列表页（collection.html 布局），
  // 默认不进首页文章流 / RSS；dir/url/layout 都可省略，与集合名一致时用默认值。
  collections: {
    projects: { title: '作品', description: '用 XFM 做的东西', perPage: 9 },
  },
  server: { port: 4173 },
};
