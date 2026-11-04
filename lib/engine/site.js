'use strict';
/**
 * 站点构建核心
 * -------------------------------------------------------------------
 * 流程：
 *   1. 扫描 content/ → 解析 front-matter → 生成 Page 元数据（含摘要与阅读时长）
 *   2. 汇总标签/系列/分类等聚合数据（模板可直接用）
 *   3. 生产模式：worker_threads 并行渲染；开发模式：主线程 + 增量缓存
 *      两条路径共用 lib/engine/render.js，产物必须逐字节一致
 *   4. 触发插件钩子，收集附加产物（sitemap/rss 等）
 *   5. 写盘 + 复制主题资源
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

const { parseFrontMatter } = require('./frontmatter');
const { Theme } = require('./theme');
const { PluginSystem } = require('./plugins');
const { summarize, createLinkResolver, renderBody, buildContext } = require('./render');

const WORKER_FILE = path.join(__dirname, 'worker.js');
// 增量缓存结构版本：字段不兼容时整体丢弃，避免读到半旧数据
const CACHE_VERSION = 2;

// 主题资源与本站点 public 目录允许复制的扩展名
const THEME_ASSET_EXTS = ['.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff2', '.woff', '.ttf', '.txt', '.json', '.xml', '.map'];
const PUBLIC_ASSET_EXTS = THEME_ASSET_EXTS.concat(['.pdf', '.html', '.webmanifest']);

/**
 * 递归遍历目录，返回指定扩展名的文件
 * 子目录并行 readdir（原实现每个目录串行 await，深层目录退化为多次 RTT）
 */
async function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const subdirs = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      subdirs.push(path.join(dir, e.name));
    } else if (exts.includes(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  if (subdirs.length) await Promise.all(subdirs.map((d) => walk(d, exts, out)));
  return out;
}

/** 解析主题目录：站点本地优先，其次包内置 */
function resolveTheme(root, name) {
  const local = path.resolve(root, name);
  if (fs.existsSync(local)) return local;
  const builtin = path.resolve(__dirname, '..', '..', 'themes', name);
  if (fs.existsSync(builtin)) return builtin;
  // 允许写 "default" 这类简写
  const short = path.resolve(__dirname, '..', '..', 'themes', String(name).replace(/^themes[\\/]/, ''));
  if (fs.existsSync(short)) return short;
  throw new Error(`[xfm] 找不到主题 "${name}"\n  已尝试：${local}\n          ${builtin}`);
}

/** 目录内容指纹（文件名 + mtime + size） */
async function fingerprint(...dirs) {
  const files = [];
  for (const d of dirs) await walk(d, ['.html', '.htm', '.njk', '.tpl', '.css'], files);
  files.sort();
  const stats = await Promise.all(files.map((f) => fsp.stat(f).catch(() => null)));
  const parts = [];
  for (let i = 0; i < files.length; i++) {
    const st = stats[i];
    if (st) parts.push(path.basename(files[i]) + ':' + st.mtimeMs + ':' + st.size);
  }
  return parts.join('|');
}

/** 短哈希，用于增量缓存键 */
function hash(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 12);
}

/** 解析日期：合法返回 Date，非法返回 null（避免后续 toISOString 崩溃） */
function formatDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

/**
 * 日历日（按本地时区）
 * 之前用 toISOString().slice(0,10)，对 UTC+8 的 00:00–07:59 会倒退一天。
 */
function formatDay(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** URL 拼接与规范化 */
function normalizePath(p) {
  let u = '/' + String(p).replace(/\\/g, '/').replace(/^\/+/, '');
  u = u.replace(/\/{2,}/g, '/');
  return u;
}

/**
 * 根据文件名推断 URL
 * - a.md / a/index.md → /a/
 * - index.md          → /
 * - a.html            → /a.html（保持原始扩展名，避免链接与产物不一致）
 */
function deriveRoute(relPath) {
  const ext = path.extname(relPath);
  if (ext === '.html' || ext === '.htm') return normalizePath(relPath);
  let route = relPath.slice(0, -ext.length);
  route = route.replace(/(^|\/)index$/, '$1');
  route = normalizePath(route);
  if (route !== '/' && !route.endsWith('/')) route += '/';
  return route;
}

/**
 * URL → 落盘相对路径（与 deriveRoute 严格互逆）
 * 路径里的百分号编码要还原：静态服务器（GitHub Pages / nginx / 本机 dev）
 * 都是先解码 URL 再查文件，落盘用 `%E6%8F%92%E4%BB%B6` 会 404。
 * 用 decodeURI 而非 decodeURIComponent：后者会把 %2F 变成真斜杠，可能越出目录。
 */
function urlToFilePath(url) {
  let clean = url;
  try { clean = decodeURI(url); } catch (e) { /* 非法转义：按原样落盘 */ }
  if (clean === '/') return 'index.html';
  if (/\.html?$/.test(clean)) return clean.slice(1);
  return path.posix.join(clean.slice(1), 'index.html');
}

/**
 * 文档导航分组：front-matter 的 group/section 决定分组，weight 决定顺序
 */
function buildNavGroups(pages) {
  const groups = new Map();
  for (const p of pages) {
    const g = p.data.group || p.data.section;
    if (!g || p.data.nav === false) continue;
    let arr = groups.get(g);
    if (!arr) groups.set(g, (arr = []));
    arr.push({ title: p.title, url: p.url, weight: p.weight });
  }
  return [...groups.entries()].map(([title, items]) => ({
    title,
    items: items.sort((a, b) => a.weight - b.weight).map((it) => ({ title: it.title, url: it.url })),
  }));
}

/** 收集目录下的文件与子目录（用于清理陈旧产物） */
async function walkTree(dir, acc = { files: [], dirs: [] }) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  const subdirs = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) subdirs.push(abs);
    else acc.files.push(abs);
  }
  acc.dirs.push(...subdirs);
  if (subdirs.length) await Promise.all(subdirs.map((d) => walkTree(d, acc)));
  return acc;
}

/**
 * 删除输出目录里"本次不会再生成"的旧文件
 * 语义等同整体 rm -rf（dist 只保留本次产物），但只动陈旧文件
 */
async function pruneStale(outDir, planned) {
  const tree = await walkTree(outDir);
  const stale = tree.files.filter((f) => !planned.has(f));
  await Promise.all(stale.map((f) => fsp.unlink(f).catch(() => {})));
  // 自底向上删空目录
  tree.dirs.sort((a, b) => b.length - a.length);
  for (const d of tree.dirs) {
    try { await fsp.rmdir(d); } catch (e) { /* 非空或不存在：忽略 */ }
  }
}

class Site {
  constructor(config, root, opts = {}) {
    this.config = config;
    this.config.site = this.config.site || {};
    this.root = root;
    this.mode = opts.mode || 'production';
    this.pages = []; // 所有页面元数据
    this.documents = []; // 供插件读取的完整文档（含正文 HTML）
    this.theme = null;
    this.plugins = new PluginSystem(this);
    this.cacheFile = path.join(root, '.xfm', 'cache.json');
    this.cache = null;
    this.timings = {};
    this.stats = { pages: 0, assets: 0, cached: 0, workers: 0 };
    // markdown.highlight: false 时关闭代码高亮
    this.highlight = this.config.markdown && this.config.markdown.highlight === false ? false : undefined;
  }

  async init() {
    const t0 = performance.now();
    // 主题：先找站点内路径，再找内置主题（xfm/themes/<name>）
    const themeDir = resolveTheme(this.root, this.config.theme);
    this.theme = await Theme.load(themeDir, this.config.site);

    // 插件
    for (const spec of this.config.plugins || []) {
      this.plugins.load(spec, this.root);
    }
    this.plugins.loadDir(path.join(this.root, 'plugins'));

    if (this.mode !== 'production') this._loadCache();
    this.timings.init = performance.now() - t0;
    return this;
  }

  _loadCache() {
    let loaded = null;
    try {
      loaded = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch (e) { /* 无缓存或损坏 */ }
    // 旧版缓存没有 bodyHtml 字段，命中后插件会拿到空正文，直接丢弃重建
    this.cache = loaded && loaded.version === CACHE_VERSION ? loaded : null;
    if (!this.cache) this.cache = { version: CACHE_VERSION, html: {}, assets: {} };
    if (!this.cache.html) this.cache.html = {};
    if (!this.cache.assets) this.cache.assets = {};
  }

  _saveCache() {
    if (!this.cache) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      // 清理已不存在页面的缓存
      const alive = new Set(this.pages.map((p) => p.key));
      for (const k of Object.keys(this.cache.html)) if (!alive.has(k)) delete this.cache.html[k];
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache));
    } catch (e) { /* 缓存失败不影响构建 */ }
  }

  /** 扫描内容目录，生成页面元数据 */
  async collect() {
    const t0 = performance.now();
    const contentDir = path.resolve(this.root, this.config.contentDir || 'content');
    const files = await walk(contentDir, ['.md', '.markdown', '.html', '.htm']);

    // 并行读取全部源文件（原实现逐文件 await，1000 页 ≈ 1000 次 RTT 串行）
    const raws = await Promise.all(files.map((f) => fsp.readFile(f, 'utf8')));

    const pages = [];
    for (let fi = 0; fi < files.length; fi++) {
      const abs = files[fi];
      const rel = path.relative(contentDir, abs).replace(/\\/g, '/');
      const raw = raws[fi];
      const { data, content } = parseFrontMatter(raw);

      if (data.draft === true && this.mode === 'production' && !this.config.buildDrafts) continue;

      const ext = path.extname(rel).toLowerCase();
      const isMd = ext === '.md' || ext === '.markdown';

      // 用户手写的 url / permalink / slug 可能省略前导斜杠，统一规范化
      let url = data.url || data.permalink || (data.slug ? normalizePath(data.slug) : deriveRoute(rel));
      url = normalizePath(url);
      if (url !== '/' && !url.endsWith('/') && !path.posix.extname(url)) url += '/';

      const date = formatDate(data.date) || formatDate(data.published) || null;
      const tags = Array.isArray(data.tags) ? data.tags.map(String) : data.tags ? String(data.tags).split(',').map((s) => s.trim()) : [];
      const { excerpt, readTime } = summarize(content, isMd, data.description || data.summary);

      pages.push({
        key: rel,
        file: abs,
        rel,
        url,
        layout: data.layout || (data.title ? this.config.defaults.layout : 'page.html'),
        title: data.title || rel.replace(/\.\w+$/, ''),
        description: data.description || data.summary || '',
        date,
        updated: formatDate(data.updated),
        tags,
        category: data.category || null,
        series: data.series || null,
        weight: typeof data.weight === 'number' ? data.weight : (data.order || 0),
        draft: !!data.draft,
        toc: data.toc !== false,
        data,
        body: content, // 正文源码（Markdown 或 HTML），渲染与缓存复用
        excerpt,
        readTime,
        isMd,
        ext,
        raw, // 供哈希使用，避免二次读盘
      });
    }

    // 排序：首页置顶；文档模式按 weight；其余按日期倒序
    pages.sort((a, b) => {
      if (a.url === '/' && b.url !== '/') return -1;
      if (b.url === '/' && a.url !== '/') return 1;
      const wa = a.weight || 0;
      const wb = b.weight || 0;
      if (wa !== wb) return wa - wb;
      const da = a.date ? a.date.getTime() : 0;
      const db = b.date ? b.date.getTime() : 0;
      if (da !== db) return db - da;
      return a.url.localeCompare(b.url);
    });

    this.pages = pages;
    // 相对链接解析索引：rel → url，主线程与 worker 共用同一份
    this.linkIndex = new Map(pages.map((p) => [p.rel, p.url]));
    this.linkResolver = createLinkResolver(this.linkIndex);
    this.pageByKey = new Map(pages.map((p) => [p.key, p]));

    this._linkNeighbors();

    // ---- 聚合 ----
    const tagMap = new Map();
    const catMap = new Map();
    const seriesMap = new Map();
    const bucket = (map, key, p) => {
      let arr = map.get(key);
      if (!arr) map.set(key, (arr = []));
      arr.push(p);
    };

    // 序列化只做一次，全局共享同一个对象引用（避免 4000+ 次重复分配）
    const serialized = new Map();
    const ser = (p) => {
      let s = serialized.get(p);
      if (!s) serialized.set(p, (s = this.serializePage(p)));
      return s;
    };

    for (const p of pages) {
      if (p.url === '/') continue; // 首页不进聚合
      for (const t of p.tags) bucket(tagMap, t, p);
      if (p.category) bucket(catMap, p.category, p);
      if (p.series) bucket(seriesMap, p.series, p);
    }

    // 分类聚合：模板通常只需要"列表项"（url/title/date），
    // 完整对象按需通过 ref 数组暴露，避免 tags 体积翻倍
    const toItems = (m, prefix) =>
      [...m.entries()].map(([name, items]) => ({
        name,
        url: `/${prefix}/${encodeURIComponent(name)}/`,
        count: items.length,
        items: items.map((p) => ser(p)),
        posts: items, // 构建期内部使用（含 file 等私有字段），不参与序列化
      }));

    this.tags = toItems(tagMap, 'tags').sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    this.categories = toItems(catMap, 'categories');
    this.series = toItems(seriesMap, 'series');

    const stripPosts = (list) => list.map((t) => ({ name: t.name, url: t.url, count: t.count, items: t.items }));

    // 站点上下文：模板可见的普通对象，同时作为 worker 的传输载荷
    this.siteContext = {
      ...this.config.site,
      base: this.config.site.base || '/',
      assets: this.config.site.assets || '/assets/',
      pages: pages.map(ser),
      posts: pages.filter((p) => p.data.type !== 'page' && p.url !== '/' && p.date).map(ser),
      tags: stripPosts(this.tags),
      categories: stripPosts(this.categories),
      series: stripPosts(this.series),
      navGroups: buildNavGroups(pages),
    };

    // extendContext：插件向站点上下文注入全局数据（如阅读统计）
    if (this.plugins.has('extendContext')) {
      this.siteContext = (await this.plugins.call('extendContext', this.siteContext)) || this.siteContext;
    }

    // ---- taxonomy 聚合页 ----
    // 放在 siteContext 之后构建：site.pages 只保留内容页，聚合页仅用于输出文件，
    // 不参与导航分组、prev/next 与 RSS（RSS 依赖 date，聚合页没有 date 自然被过滤）。
    const taxonomyPages = this._taxonomyPages();
    for (const p of taxonomyPages) {
      this.pages.push(p);
      this.pageByKey.set(p.key, p);
    }

    this.timings.collect = performance.now() - t0;
    return pages;
  }

  /**
   * 为 tags / categories / series 生成聚合页
   * URL 与 site.tags[].url 完全一致（已编码），模板复用 taxonomy.html
   */
  _taxonomyPages() {
    const lang = String(this.config.site.lang || '').toLowerCase();
    const zh = lang.startsWith('zh');
    const labels = {
      tags: zh ? '标签' : 'Tag',
      categories: zh ? '分类' : 'Category',
      series: zh ? '系列' : 'Series',
    };
    const groups = [
      ['tags', this.tags],
      ['categories', this.categories],
      ['series', this.series],
    ];

    const out = [];
    for (const [kind, list] of groups) {
      for (const item of list) {
        // 复用聚合阶段已序列化的视图，只保留列表需要的字段（避免把 front-matter 塞进每个聚合页）
        const posts = item.items
          .map((s) => ({
            url: s.url,
            title: s.title,
            description: s.description,
            date: s.date,
            excerpt: s.excerpt,
          }))
          .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

        out.push({
          key: `taxonomy:${kind}:${item.name}`,
          rel: '',
          url: item.url,
          layout: 'taxonomy.html',
          title: item.name,
          description: `${labels[kind]} · 共 ${posts.length} 篇`,
          date: null,
          updated: null,
          tags: [],
          category: null,
          series: null,
          weight: 0,
          draft: false,
          toc: false,
          data: { type: 'taxonomy', taxonomy: kind, term: item.name, posts },
          body: '',
          isMd: false,
          ext: '.html',
          excerpt: '',
          readTime: 0,
          // 内容变化（文章增删/改名）要能击穿增量缓存
          raw: `taxonomy|${kind}|${item.name}|${posts.map((p) => p.url + '|' + p.title).join(',')}`,
          taxonomy: true,
        });
      }
    }
    return out;
  }

  /** 自动补全 prev / next（按 pages 的最终顺序：weight → 日期 → url） */
  _linkNeighbors() {
    const posts = this.pages.filter((p) => p.data.type !== 'page' && p.url !== '/' && p.date);
    for (let i = 0; i < posts.length; i++) {
      const cur = posts[i];
      const prev = posts[i + 1];
      const next = posts[i - 1];
      if (prev) cur.data.prev = { url: prev.url, title: prev.title };
      if (next) cur.data.next = { url: next.url, title: next.title };
    }
  }

  /** 页面对象 → 模板可见的精简结构 */
  serializePage(p) {
    return {
      url: p.url,
      title: p.title,
      description: p.description,
      date: formatDay(p.date),
      updated: formatDay(p.updated),
      tags: p.tags,
      category: p.category,
      series: p.series,
      weight: p.weight,
      layout: p.layout,
      data: p.data,
      excerpt: p.excerpt || '',
      readTime: p.readTime || 0,
      toc: p.tocData || [],
    };
  }

  /** 计算页面渲染任务（用于 worker） */
  async prepare() {
    const t1 = performance.now();
    // 主题指纹：模板/资源任何变化都会使所有页面缓存失效
    this.themeFingerprint = await fingerprint(path.join(this.theme.dir, 'layouts'), path.join(this.theme.dir, 'partials'));
    // 配置指纹：站点标题/导航等改动同样要失效缓存，否则增量构建会留下旧页面
    const cfgFingerprint = hash(JSON.stringify({
      theme: this.theme.dir,
      site: this.config.site,
      defaults: this.config.defaults,
      markdown: this.config.markdown,
    }));
    // raw 已在 collect 阶段读入，这里只做哈希计算（无 IO）
    for (const p of this.pages) {
      p.hash = hash(`${p.layout}|${this.themeFingerprint}|${cfgFingerprint}|${p.raw}`);
    }
    this.timings.hash = performance.now() - t1;
  }

  /** 并行渲染（worker 池） */
  async renderAll() {
    const t0 = performance.now();
    const pages = this.pages;
    const jobs = [];

    // 生产模式下插件若不参与单页渲染，才能安全地交给 worker
    const workerSafe =
      this.mode === 'production' &&
      pages.length >= this.config.workerThreshold &&
      !this.plugins.has('transformHtml') &&
      !this.plugins.has('markdown');

    let cacheHits = 0;
    for (const p of pages) {
      const cached = this.cache && this.cache.html[p.key];
      if (cached && cached.hash === p.hash) {
        p.html = cached.html;
        p.bodyHtml = cached.bodyHtml || '';
        cacheHits++;
        continue;
      }
      jobs.push(p);
    }

    if (workerSafe && jobs.length > 0) {
      const results = await this.renderWithPool(jobs);
      for (const r of results) {
        const p = this.pageByKey.get(r.key);
        if (!p) continue;
        p.html = r.html;
        p.bodyHtml = r.bodyHtml;
      }
    } else {
      for (const p of jobs) {
        const r = await this.renderPage(p);
        p.html = r.html;
        p.bodyHtml = r.bodyHtml;
      }
    }

    this.stats.cached = cacheHits;
    this.timings.render = performance.now() - t0;
    return pages;
  }

  /**
   * 用 worker 池渲染
   * - 线程复用：整批页面只创建一次 worker
   * - 上下文只传一次（init），之后只传任务
   * - 按字符数均衡分片（lpt 贪心），避免某个 worker 拖尾
   */
  async renderWithPool(jobs) {
    const totalChars = jobs.reduce((s, p) => s + p.raw.length, 0);
    const size = this.pickConcurrency(jobs.length, totalChars);
    this.stats.workers = size;

    // 分片：按体积降序贪心装箱
    const sorted = [...jobs].sort((a, b) => b.raw.length - a.raw.length);
    const buckets = Array.from({ length: size }, () => ({ weight: 0, jobs: [] }));
    for (const p of sorted) {
      let min = buckets[0];
      for (const b of buckets) if (b.weight < min.weight) min = b;
      min.jobs.push(p);
      min.weight += p.raw.length;
    }

    // 先全部启动（init 并发送任务），再统一等待结果
    const pending = buckets
      .map((b, i) => (b.jobs.length ? this.spawnWorker(i, b.jobs) : null))
      .filter(Boolean);

    try {
      const results = await Promise.all(pending.map((h) => h.result));
      return results.flat();
    } finally {
      await Promise.all(pending.map((h) => h.dispose()));
    }
  }

  /**
   * 并发度决策（实测标定，非拍脑袋）
   * 1000 页 / 32 核实测端到端：1w=504ms  2w=435ms  3w=438ms  4w=471ms  6w=438ms  8w=476ms
   * 结论：worker 的启动成本（线程创建 + 上下文结构化克隆 ≈ 30–60ms/个）
   *       在小任务量下无法被并行收益抵消，最佳区间是 2–4 个。
   * 策略：按"每线程最小工作量"决定并发，而不是按 CPU 核数堆线程。
   */
  pickConcurrency(jobCount, totalChars = 0) {
    if (this.config.workers) return Math.max(1, Math.min(jobCount, this.config.workers, 32));
    const MIN_PER_WORKER = 300_000; // 每个 worker 至少承担的源文本字节数
    const byVolume = totalChars > 0 ? Math.ceil(totalChars / MIN_PER_WORKER) : jobCount;
    const byCores = Math.min(os.cpus().length || 1, 4);
    return Math.max(1, Math.min(jobCount, byCores, byVolume));
  }

  /** 创建一个可复用的 worker 句柄：{ result, dispose } */
  spawnWorker(index, jobs) {
    let worker;
    const done = new Promise((resolve, reject) => {
      worker = new Worker(WORKER_FILE);
      let settled = false;

      worker.once('error', (e) => {
        if (!settled) { settled = true; reject(new Error(`[xfm] worker#${index} 异常：${e.message}`)); }
      });

      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          worker.postMessage({
            type: 'render',
            id: 1,
            jobs: jobs.map((p) => ({
              key: p.key,
              rel: p.rel,
              isMd: p.isMd,
              body: p.body,
              view: this.serializePage(p),
            })),
          });
          return;
        }
        if (msg.type === 'done') {
          settled = true;
          resolve(msg.results);
          return;
        }
        if (msg.type === 'error') {
          settled = true;
          reject(new Error(`[xfm] worker#${index} 渲染失败：${msg.message}\n${msg.stack || ''}`));
        }
      });

      // 上下文与链接索引只传一次
      worker.postMessage({
        type: 'init',
        site: this.siteContext,
        themeDir: this.theme.dir,
        defaults: this.config.defaults,
        links: [...this.linkIndex],
        highlight: this.highlight,
      });
    });

    const handle = {
      result: done,
      dispose: () =>
        new Promise((r) => {
          if (!worker) return r();
          const finish = () => r();
          worker.once('exit', finish);
          worker.terminate().then(finish, finish);
        }),
    };
    return handle;
  }

  /** 单页渲染（主线程路径） */
  async renderPage(p) {
    let src = p.body;
    if (this.plugins.has('markdown')) src = await this.plugins.call('markdown', src, p);

    // 链接解析结果按页面复用，避免同一目标重复 normalize
    const linkCache = new Map();
    const { bodyHtml, headings } = renderBody(p, src, {
      link: (href) => this.linkResolver(href, p, linkCache),
      highlight: this.highlight,
    });

    p.tocData = headings.filter((h) => h.level >= 2 && h.level <= 3);
    p.bodyHtml = bodyHtml;

    const view = this.serializePage(p);
    const ctx = buildContext({ view, bodyHtml, headings, site: this.siteContext });

    let html = this.theme.render(p.layout, ctx);
    if (this.plugins.has('transformHtml')) html = await this.plugins.call('transformHtml', html, ctx);

    return { key: p.key, html, bodyHtml };
  }

  /** 计算资源文件清单 */
  async assets() {
    const themeAssets = path.join(this.theme.dir, 'assets');
    const files = await walk(themeAssets, THEME_ASSET_EXTS);
    const publicDir = path.resolve(this.root, this.config.publicDir || 'public');
    const pubFiles = await walk(publicDir, PUBLIC_ASSET_EXTS);
    return {
      themeAssets: files.map((f) => ({ src: f, dest: path.join('assets', path.relative(themeAssets, f)) })),
      publicFiles: pubFiles.map((f) => ({ src: f, dest: path.relative(publicDir, f) })),
    };
  }

  /**
   * 写输出目录：清陈旧产物 → 写页面 → 复制资源 → 生成插件产物
   * 不再整体 rm -rf，只删除"本次不会再生成"的旧文件：
   * Windows 上全删 500 个页面目录约 1.8s，是构建的主要开销。
   * @returns {Promise<{extraOutputs:number, outDir:string}>}
   */
  async writeOutput() {
    const outDir = path.resolve(this.root, this.config.outDir || 'dist');
    await fsp.mkdir(outDir, { recursive: true });

    // 页面
    const pageFiles = this.pages.map((p) => [path.join(outDir, urlToFilePath(p.url)), p.html]);

    // 资源
    const { themeAssets, publicFiles } = await this.assets();
    const copyList = themeAssets.concat(publicFiles).map((a) => [a.src, path.join(outDir, a.dest)]);
    this.stats.assets = copyList.length;

    // 插件附加产物：documents[].html 是「正文 HTML」，不含布局
    // （曾经在这里把整页 HTML 写进 documents，导致 RSS 全文里塞进了导航和页脚）
    this.documents = this.pages.map((p) => ({ ...this.serializePage(p), html: p.bodyHtml || '' }));
    const extra = await this.plugins.call('afterBuild', [], this);
    const extraFiles = (extra || [])
      .filter((it) => it && it.path)
      .map((it) => [path.join(outDir, it.path), it.contents]);

    // 清理旧产物（先清后写，避免误删本次生成的文件）
    const planned = new Set();
    for (const [dest] of pageFiles) planned.add(dest);
    for (const [, dest] of copyList) planned.add(dest);
    for (const [dest] of extraFiles) planned.add(dest);
    await pruneStale(outDir, planned);

    // 建目录 + 写文件：两阶段执行，避免 writeFile 早于 mkdir
    const dirSet = new Set();
    for (const [dest] of pageFiles) dirSet.add(path.dirname(dest));
    for (const [, dest] of copyList) dirSet.add(path.dirname(dest));
    for (const [dest] of extraFiles) dirSet.add(path.dirname(dest));
    await Promise.all([...dirSet].map((d) => fsp.mkdir(d, { recursive: true })));

    await Promise.all(pageFiles.map(([dest, data]) => fsp.writeFile(dest, data)));
    await Promise.all(copyList.map(([src, dest]) => fsp.copyFile(src, dest)));
    await Promise.all(extraFiles.map(([dest, contents]) => fsp.writeFile(dest, contents)));

    this.stats.extraOutputs = extraFiles.length;
    return { extraOutputs: extraFiles.length, outDir };
  }

  /** 全量构建 */
  async build() {
    const t0 = performance.now();
    await this.collect();
    await this.prepare();
    await this.renderAll();
    await this.writeOutput();

    // 增量缓存（dev 模式）
    if (this.cache) {
      for (const p of this.pages) {
        this.cache.html[p.key] = { hash: p.hash, html: p.html, bodyHtml: p.bodyHtml || '' };
      }
      this._saveCache();
    }

    this.stats.pages = this.pages.length;
    this.timings.total = performance.now() - t0;
    await this.plugins.call('finish', null, this);
    return this;
  }
}

module.exports = { Site, walk, hash, normalizePath, urlToFilePath, deriveRoute };
