'use strict';
/**
 * 配置加载
 * -------------------------------------------------------------------
 * 支持 xfm.config.mjs / xfm.config.js / xfm.config.json
 * 也支持在 package.json 中写 "xfm" 字段。
 * 配置与默认值深合并，用户只需写关心的项。
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  site: {
    title: 'My XFM Site',
    description: '',
    base: '/',
    lang: 'zh-CN',
    author: '',
    assets: '/assets/',
    nav: [],
  },
  contentDir: 'content',
  outDir: 'dist',
  publicDir: 'public',
  theme: 'themes/default',
  plugins: [],
  defaults: {
    layout: 'page.html',
  },
  buildDrafts: false,
  // 页面数达到该阈值才启用 worker 池（小站点主线程更快）
  workerThreshold: 40,
  // 索引页：主题提供对应布局时才会生成，自定义主题可 enabled: false 关闭
  indexes: {
    categories: { enabled: true, url: '/categories/' },
    archives: { enabled: true, url: '/archives/' },
  },
  // 列表分页：首页取第 1 页，其余落在 /page/2/、/page/3/…（真实静态页，利于 SEO）
  pagination: {
    enabled: true,
    perPage: 9,
    url: '/page/',
  },
  // 站内搜索：启用 search 插件后生成索引文件
  search: {
    path: 'search.json',
    maxChars: 1500,
  },
  // SEO 元信息（启用 seo 插件后生效）：canonical / OG / Twitter / JSON-LD
  seo: {
    image: '', // 默认分享图（根绝对路径或完整 URL）
    twitter: '', // @handle
    jsonLd: true,
  },
  // HTML 压缩（启用 minify 插件后生效）
  minify: {
    enabled: true,
    aggressive: false, // true 会折叠标签间换行，可能影响行内元素间距
  },
  // llms.txt（启用 llms 插件后生效）
  llms: {
    path: 'llms.txt',
    full: true,
    fullPath: 'llms-full.txt',
    maxItems: 0, // 0 = 不限
  },
  // JSON Feed（启用 feed-json 插件后生效）
  feedJson: {
    path: 'feed.json',
    limit: 20,
  },
  // 相关文章（启用 related 插件后生效）
  related: {
    limit: 3,
    minScore: 2,
  },
  // worker 并发数；0/未设置 = 自动（min(核数, 16)）
  workers: 0,
  server: {
    port: 4173,
    host: '127.0.0.1',
    open: false,
  },
  markdown: {
    highlight: true,
  },
};

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(extra)) {
    const b = out[k];
    const e = extra[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && e && typeof e === 'object' && !Array.isArray(e)) {
      out[k] = deepMerge(b, e);
    } else if (e !== undefined) {
      out[k] = e;
    }
  }
  return out;
}

const CONFIG_FILES = ['xfm.config.mjs', 'xfm.config.js', 'xfm.config.cjs', 'xfm.config.json', 'config.js'];

/**
 * 加载配置
 * @param {string} root 站点根目录
 * @returns {Promise<object>}
 */
// ESM 的 import() 按 URL 缓存模块，配置改一次就要换一个 URL 才能重新求值。
// 不能用 Date.now()：连续两次写配置可能落在同一毫秒（CI 上很容易发生），
// 那样第二次 import 会命中缓存拿到旧配置，dev 热重载看起来"没生效"。
let importSeq = 0;

async function loadConfig(root) {
  let user = null;
  let source = null;

  for (const f of CONFIG_FILES) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) continue;
    source = abs;
    if (f.endsWith('.mjs')) {
      const mod = await import(require('url').pathToFileURL(abs).href + '?v=' + ++importSeq);
      user = mod.default || mod;
    } else if (f.endsWith('.json')) {
      user = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } else {
      delete require.cache[require.resolve(abs)];
      const mod = require(abs);
      user = mod.default || mod;
    }
    break;
  }

  if (!user) {
    const pkgFile = path.join(root, 'package.json');
    if (fs.existsSync(pkgFile)) {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      if (pkg.xfm) { user = pkg.xfm; source = pkgFile; }
    }
  }

  const config = deepMerge(DEFAULTS, user || {});
  config.__source = source;
  config.__root = root;

  // 导航以外的基础路径规范化
  if (!config.site.base.endsWith('/')) config.site.base += '/';
  return config;
}

module.exports = { loadConfig, DEFAULTS, deepMerge };
