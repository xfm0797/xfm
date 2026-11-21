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

const { pathToFileURL } = require('url');
const { parseFrontMatter, parseYaml } = require('./frontmatter');
const { Theme } = require('./theme');
const { PluginSystem } = require('./plugins');
const helpers = require('./helpers');
const { summarize, createLinkResolver, renderBody, buildContext } = require('./render');
const { normalizeBase } = require('./url');

const WORKER_FILE = path.join(__dirname, 'worker.js');
// 增量缓存结构版本：字段不兼容时整体丢弃，避免读到半旧数据
const CACHE_VERSION = 3;

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
    } else if (!exts || exts.includes(path.extname(e.name).toLowerCase())) {
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

const DATE_ONLY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DATE_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * 解析日期：合法返回 Date，非法返回 null（避免后续 toISOString 崩溃）
 *
 * date-only 一律按**本地**日历日解析。`new Date('2026-11-10')` 按规范是 UTC 零点，
 * 东八区看不出差别，但在 UTC-5 会退到 11 月 9 日 —— 西半球用户的文章日期整体前移一天。
 */
function formatDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  let m = DATE_ONLY.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // `2026-11-10 22:30` 也不是标准格式（各引擎解释不一致），显式按本地时间构造
  m = DATE_TIME.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const d = new Date(s);
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

/**
 * 分页导航条目
 * 页数少时全列；页数多时只留首末与当前左右各一页，中间用省略号占位，
 * 由引擎算好交给模板，模板不必写区间判断。
 */
function pagerLinks(current, totalPages, urlFor) {
  const out = [];
  let last = 0;
  for (let n = 1; n <= totalPages; n++) {
    const near = n === 1 || n === totalPages || Math.abs(n - current) <= 1;
    if (!near) continue;
    if (last && n - last > 1) out.push({ gap: true });
    out.push({ n, url: urlFor(n), current: n === current });
    last = n;
  }
  return out;
}

/**
 * URL 拼接与规范化
 */
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
 * 删掉本次不会再生成的旧产物
 *
 * 语义等同整体 rm -rf（dist 只保留本次产物），但只动陈旧文件。
 * 目录同样只在真有文件被删时才清：目录变空只可能是里面的文件被删了。
 * Windows 上 rmdir 一个非空目录要 1–3ms，1000 个页面目录无脑扫一遍就是 3s，
 * 而什么都没删的构建本来一次都不用调。
 */
async function pruneStale(outDir, planned) {
  const tree = await walkTree(outDir);
  const stale = tree.files.filter((f) => !planned.has(f));
  if (!stale.length) return 0;

  await Promise.all(stale.map((f) => fsp.unlink(f).catch(() => {})));

  // 只清理被删文件所在目录及其祖先，深的先删（父目录要等子目录删完才空）
  const dirs = new Set();
  for (const f of stale) {
    let d = path.dirname(f);
    while (d !== outDir && d.length > outDir.length) {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  // 必须串行：并行 rmdir 时父目录可能先于子目录执行，ENOTEMPTY 留下空目录
  for (const d of sorted) await fsp.rmdir(d).catch(() => {});
  return stale.length;
}

/**
 * 目标文件是否已经是这份内容
 * 先比大小再读内容：大小不同就直接判为要重写，省一次 8KB 读取。
 * @returns {Promise<{existed:boolean, same:boolean}>}
 */
async function inspectOutput(dest, buf) {
  let st;
  try {
    st = await fsp.stat(dest);
  } catch (e) {
    return { existed: false, same: false };
  }
  if (!st.isFile()) return { existed: false, same: false };
  if (st.size !== buf.length) return { existed: true, same: false };
  try {
    return { existed: true, same: (await fsp.readFile(dest)).equals(buf) };
  } catch (e) {
    return { existed: true, same: false };
  }
}

/**
 * 资源是否需要重新复制
 * 大小相同且目标不比源旧，就认为已经是最新的（make 的规则，避免读大图片）
 * @returns {Promise<{existed:boolean, stale:boolean}>}
 */
async function inspectCopy(src, dest) {
  let s;
  let d = null;
  try {
    s = await fsp.stat(src);
  } catch (e) {
    return { existed: false, stale: false }; // 源没了：跳过，下轮 prune 会清掉
  }
  try {
    d = await fsp.stat(dest);
  } catch (e) {
    return { existed: false, stale: true };
  }
  if (!d.isFile() || d.size !== s.size) return { existed: true, stale: true };
  return { existed: true, stale: d.mtimeMs < s.mtimeMs };
}

class Site {
  constructor(config, root, opts = {}) {
    this.config = config;
    this.config.site = this.config.site || {};
    this.root = root;
    this.mode = opts.mode || 'production';
    // 开发模式默认使用缓存；生产构建必须显式开启，且两种模式共用文件时按 hash 隔离。
    this.incremental = typeof opts.incremental === 'boolean' ? opts.incremental : this.mode !== 'production';
    this.pages = []; // 所有页面元数据
    this.documents = []; // 供插件读取的完整文档（含正文 HTML）
    this.theme = null;
    this.plugins = new PluginSystem(this);
    // 插件工具集：插件包不 require 核心内部文件，只用 site.helpers
    this.helpers = helpers;
    this.cacheFile = path.join(root, '.xfm', 'cache.json');
    this.cache = null;
    this.contentAssets = []; // content/ 下的 Page Bundle 附件，collect() 填充
    this.scheduledCount = 0; // 生产构建中因未来日期被跳过的文章数（定时发布）
    this.siteData = {}; // 全局数据文件（data/）加载结果，注入 siteContext.data
    this._assetDirs = new Set();
    this._assetDirDigest = new Map();
    this.timings = {};
    this.stats = { pages: 0, assets: 0, cached: 0, workers: 0, written: 0, unchanged: 0 };
    // markdown.highlight: false 时关闭代码高亮
    this.highlight = this.config.markdown && this.config.markdown.highlight === false ? false : undefined;
  }

  async init() {
    const t0 = performance.now();
    // 主题：先找站点内路径，再找内置主题（xfm/themes/<name>）
    const themeDir = resolveTheme(this.root, this.config.theme);
    this.theme = await Theme.load(themeDir, this.config.site);

    this._loadPlugins();

    if (this.incremental) this._loadCache();
    this.timings.init = performance.now() - t0;
    return this;
  }

  /** 加载插件：配置显式列表 → package.json 自动发现 → 站点 plugins/ 目录 */
  _loadPlugins() {
    for (const spec of this.config.plugins || []) {
      this.plugins.load(spec, this.root);
    }
    this.plugins.loadAuto(this.root);
    this.plugins.loadDir(path.join(this.root, 'plugins'));
  }

  /**
   * 热重载插件：清空已加载插件并重新走 init 的加载序列，
   * requireFresh 会读到最新代码。插件代码变化会改变 plugins.fingerprint()，
   * prepare 阶段所有页面 hash 失效、自动重渲染，无需手动清缓存。
   */
  reloadPlugins() {
    this.plugins.reset();
    this._loadPlugins();
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

  /**
   * 加载全局数据文件：<root>/<dataDir> 下的 *.json / *.yaml / *.yml / *.js / *.mjs
   * 合并为 site.data，供模板与插件使用。嵌套目录对应嵌套对象：
   *   data/authors.json      → site.data.authors
   *   data/team/members.yml  → site.data.team.members
   * 只保留可 JSON 序列化的纯数据（函数等会被丢弃），保证能安全传给 worker。
   */
  async loadData() {
    const dir = path.resolve(this.root, this.config.dataDir || 'data');
    const out = {};
    let files;
    try {
      files = await walk(dir, null);
    } catch {
      return out;
    }
    for (const f of files) {
      if (path.basename(f).startsWith('.')) continue;
      const ext = path.extname(f).toLowerCase();
      if (!['.json', '.yaml', '.yml', '.js', '.mjs'].includes(ext)) continue;
      let value;
      try {
        if (ext === '.json') value = JSON.parse(await fsp.readFile(f, 'utf8'));
        else if (ext === '.yaml' || ext === '.yml') value = parseYaml(await fsp.readFile(f, 'utf8')) || {};
        else {
          const mod = await import(pathToFileURL(f).href + '?t=' + Date.now());
          value = mod.default !== undefined ? mod.default : mod;
        }
        // 确保可序列化（丢弃函数 / 循环引用），否则 worker 结构化克隆会抛错
        value = JSON.parse(JSON.stringify(value));
      } catch {
        value = null;
      }
      if (value === null || value === undefined) continue;
      const rel = path.relative(dir, f).replace(/\\/g, '/');
      const parts = rel.slice(0, -ext.length).split('/');
      let node = out;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = value;
    }
    return out;
  }

  /** 扫描内容目录，生成页面元数据 */
  async collect() {
    const t0 = performance.now();
    this.scheduledCount = 0; // 每次重建重算（dev 热重载也会清零）
    this.siteData = await this.loadData();
    // 多语言：site.languages 声明启用的语言；未声明时退化为单语 [site.lang]。
    // 单语站不输出 hreflang、不生成翻译切换，保证现有产物零变化。
    const siteCfg = this.config.site;
    const defaultLang = String(siteCfg.lang || 'zh-CN');
    this.languages = Array.isArray(siteCfg.languages) && siteCfg.languages.length
      ? siteCfg.languages.map((l) => String(l))
      : [defaultLang];
    this.defaultLang = this.languages[0] || defaultLang;
    const contentDir = path.resolve(this.root, this.config.contentDir || 'content');
    const allFiles = await walk(contentDir, null);

    // 一次遍历把内容文件（页面）与资源文件（Page Bundle 附件）分开：
    // content/ 下非 md/html 的文件会原样复制到输出，相对链接 ./cover.png
    // 天然落到文章 URL 下；dotfile 忽略。
    const CONTENT_EXTS = new Set(['.md', '.markdown', '.html', '.htm']);
    const files = [];
    const assetSrcs = [];
    for (const f of allFiles) {
      if (path.basename(f).startsWith('.')) continue;
      CONTENT_EXTS.has(path.extname(f).toLowerCase()) ? files.push(f) : assetSrcs.push(f);
    }

    // 资源按目录算一份摘要（路径 + mtime + size），资源改动时让引用它的页面缓存失效
    this.contentAssets = [];
    const assetDirs = new Set();
    const dirParts = new Map();
    if (assetSrcs.length) {
      const stats = await Promise.all(assetSrcs.map((f) => fsp.stat(f).catch(() => null)));
      for (let i = 0; i < assetSrcs.length; i++) {
        const st = stats[i];
        if (!st) continue;
        const rel = path.relative(contentDir, assetSrcs[i]).replace(/\\/g, '/');
        this.contentAssets.push({ src: assetSrcs[i], dest: rel });
        const d = path.posix.dirname(rel);
        assetDirs.add(d);
        if (!dirParts.has(d)) dirParts.set(d, []);
        dirParts.get(d).push(`${rel}:${st.mtimeMs}:${st.size}`);
      }
    }
    this._assetDirs = assetDirs;
    this._assetDirDigest = new Map();
    for (const [d, parts] of dirParts) this._assetDirDigest.set(d, hash(parts.sort().join('|')));

    // 并行读取全部源文件（原实现逐文件 await，1000 页 ≈ 1000 次 RTT 串行）
    const raws = await Promise.all(files.map((f) => fsp.readFile(f, 'utf8')));

    const pages = [];
    for (let fi = 0; fi < files.length; fi++) {
      const abs = files[fi];
      const rel = path.relative(contentDir, abs).replace(/\\/g, '/');
      const raw = raws[fi];
      const { data, content } = parseFrontMatter(raw);

      // 草稿与定时发布：生产构建默认都不输出，dev 仍可见以便预览。
      // date / published 在未来的文章视为"尚未发布"，buildScheduled 或 --scheduled 才纳入。
      const pubDate = formatDate(data.date) || formatDate(data.published) || null;
      const isDraft = data.draft === true;
      const isScheduled = pubDate ? pubDate.getTime() > Date.now() : false;
      if (this.mode === 'production') {
        if (isDraft && !this.config.buildDrafts) continue;
        if (isScheduled && !this.config.buildScheduled) {
          this.scheduledCount++;
          continue;
        }
      }

      const ext = path.extname(rel).toLowerCase();
      const isMd = ext === '.md' || ext === '.markdown';

      // 用户手写的 url / permalink / slug 可能省略前导斜杠，统一规范化
      let url = data.url || data.permalink || (data.slug ? normalizePath(data.slug) : deriveRoute(rel));
      url = normalizePath(url);
      if (url !== '/' && !url.endsWith('/') && !path.posix.extname(url)) url += '/';

      const date = pubDate;
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
        lang: String(data.lang || defaultLang), // 页面语言：front-matter lang 优先，否则站点默认
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

    // 翻译分组：front-matter 里相同 translationKey 的页面互为翻译。
    // 单语站跳过整步（transMap 为空，p.translations 恒为 []），不影响产物。
    const transMap = new Map();
    if (this.languages.length > 1) {
      for (const p of pages) {
        const key = p.data.translationKey;
        if (!key) continue;
        let arr = transMap.get(key);
        if (!arr) transMap.set(key, (arr = []));
        arr.push(p);
      }
    }
    for (const p of pages) {
      const group = p.data.translationKey ? transMap.get(p.data.translationKey) : null;
      p.translations = group && group.length > 1
        ? group.map((q) => ({ lang: q.lang, url: q.url, title: q.title }))
        : [];
    }

    // 自定义集合：在 siteContext 构建之前归组并打标，条目才会被排除出默认文章流
    this._resolveCollections();

    // ---- 文章流：按语言分流 ----
    // 多语言站（site.languages 长度 > 1）里，默认文章流只收默认语言的页面：
    // 首页列表、分页、归档、分类/标签/系列聚合、prev/next、RSS 都不再混进翻译版本。
    // 单语站这块整段不生效（multiLang=false），产物逐字节不变。
    this.multiLang = this.languages.length > 1;
    this._inStream = (p) =>
      p.data.type !== 'page' &&
      p.url !== '/' &&
      !!p.date &&
      (!p.collection || this._collectionPostsEnabled.has(p.collection));
    this._inDefaultStream = (p) => this._inStream(p) && (!this.multiLang || p.lang === this.defaultLang);
    // 每种语言各自的文章流：site.postsByLang 与语言首页（/<lang>/）共用
    this._langStream = new Map();
    for (const p of pages) {
      if (!this._inStream(p)) continue;
      let arr = this._langStream.get(p.lang);
      if (!arr) this._langStream.set(p.lang, (arr = []));
      arr.push(p);
    }
    // 多语言站给首页补一份「语言首页」翻译表，语言切换器在 / 上也能用
    const homePage = pages.find((p) => p.url === '/');
    if (this.multiLang && homePage && !homePage.data.translationKey) {
      const rooms = this._langHomes();
      if (rooms.length > 1) homePage.translations = rooms;
    }

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
    // 完整对象按需通过 ref 数组暴露，避免 tags 体积翻倍。
    // count 只算默认语言，和首页文章流对得上；items 保留全部语言，
    // 因为 /tags/<name>/ 这类 URL 只按名字索引，词条页必须覆盖所有语言的链接，
    // 否则非默认语言文章的标签/分类链接会变成死链。
    const toItems = (m, prefix) =>
      [...m.entries()].map(([name, items]) => ({
        name,
        url: `/${prefix}/${encodeURIComponent(name)}/`,
        count: (this.multiLang ? items.filter((p) => p.lang === this.defaultLang) : items).length,
        items: items.map((p) => ser(p)),
        posts: items, // 构建期内部使用（含 file 等私有字段），不参与序列化
      }));

    const allTags = toItems(tagMap, 'tags');
    const allCategories = toItems(catMap, 'categories');
    const allSeries = toItems(seriesMap, 'series');
    // 词条页覆盖全部语言；模板看到的 site.tags / site.categories 只留默认语言
    this._allTerms = { tags: allTags, categories: allCategories, series: allSeries };
    this.tags = allTags.filter((t) => t.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    this.categories = allCategories.filter((t) => t.count > 0);
    this.series = allSeries.filter((t) => t.count > 0);

    const stripPosts = (list) => list.map((t) => ({ name: t.name, url: t.url, count: t.count, items: t.items }));

    // 站点上下文：模板可见的普通对象，同时作为 worker 的传输载荷
    this.siteContext = {
      ...this.config.site,
      base: normalizeBase(this.config.site.base),
      assets: this.config.site.assets || '/assets/',
      data: this.siteData, // 全局数据文件：模板与插件通过 site.data 读取
      languages: this.languages, // 启用的语言列表（单语站为 [defaultLang]）
      defaultLang: this.defaultLang, // 默认语言 = languages[0]
      pages: pages.map(ser),
      // 集合条目不进默认文章流，除非该集合声明 posts: true；多语言站只收默认语言
      posts: pages.filter((p) => this._inDefaultStream(p)).map(ser),
      // 每种语言各自的文章流：模板写 site.postsByLang[page.lang] 即可拿到当前语言列表
      postsByLang: Object.fromEntries([...this._langStream].map(([l, arr]) => [l, arr.map(ser)])),
      tags: stripPosts(this.tags),
      categories: stripPosts(this.categories),
      series: stripPosts(this.series),
      collections: this.collections, // 自定义集合：模板通过 site.collections.<name> 访问
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

    // 分类索引 / 归档：同上，仅作为输出文件存在
    const indexPages = this._indexPages();
    for (const p of indexPages) {
      this.pages.push(p);
      this.pageByKey.set(p.key, p);
    }

    // 列表分页：首页吃第 1 页，其余挂在 /page/N/ 上
    const paginated = this._paginationPages(pages);
    for (const p of paginated) {
      this.pages.push(p);
      this.pageByKey.set(p.key, p);
    }

    // 语言首页：多语言站每种非默认语言一套 /<lang>/ + /<lang>/page/N/
    const langPages = this._langIndexPages(pages);
    for (const p of langPages) {
      this.pages.push(p);
      this.pageByKey.set(p.key, p);
    }

    // 自定义集合：列表页 /<name>/ + 分页页 /<name>/page/N/
    const collectionPages = this._collectionPages();
    for (const p of collectionPages) {
      this.pages.push(p);
      this.pageByKey.set(p.key, p);
    }

    // afterCollect：全部页面（含聚合/分页/索引页/集合页）就位后、渲染开始前，
    // 插件可往 page.data 写跨页数据（相关文章、系列排序…）。
    // 放在这里而不是单页钩子，是为了让 worker 池仍能并行渲染。
    await this.plugins.call('afterCollect', null, this);

    this.timings.collect = performance.now() - t0;
    return pages;
  }

  /**
   * 列表分页
   * -------------------------------------------------------------------
   * 首页（url === '/'，layout index.html）取第一页数据，其余页生成
   * `${pagination.url}N/` 真实静态页；三处共享同一个 pagination 结构，
   * 模板只需遍历 pagination.posts，不必关心自己是第几页。
   * 分页页与聚合页同属"生成页"：不进 site.pages/RSS/prev-next/navGroups。
   * @returns {Array} 需要额外输出的页面（不含首页）
   */
  _paginationPages(pages) {
    const conf = this.config.pagination || {};
    if (conf.enabled === false) return [];
    const perPage = Math.max(1, Number(conf.perPage) || 9);
    const posts = this.siteContext.posts || [];
    if (!posts.length) return [];

    const home = pages.find((p) => p.url === '/') || null;
    // 首页模板不渲染文章列表（如 docs 主题只列导航分组）时不生成分页页，
    // 否则会产生一堆内容雷同的 /page/2/ 死页。
    if (!home || !this._layoutUsesPosts(home.layout)) return [];
    const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
    const prefix = normalizePath(conf.url || '/page/');
    const pageUrl = (n) => (n === 1 ? '/' : normalizePath(`${prefix}${n}/`));
    // 首页自身也要带分页数据：即便只有一页，模板里的 pager 也要能判断"不显示"
    const homeData = {
      current: 1,
      totalPages,
      perPage,
      total: posts.length,
      url: '/',
      prev: null,
      next: totalPages > 1 ? pageUrl(2) : null,
      links: pagerLinks(1, totalPages, pageUrl),
      posts: posts.slice(0, perPage),
    };

    if (home) {
      home.data.pagination = homeData;
      // 列表页的内容由 siteContext.posts 决定：文章增删/改标题都要击穿缓存
      home.listing = true;
    }

    const out = [];
    if (totalPages <= 1) return out;

    const layout = (home && home.layout) || 'index.html';
    const title = (home && home.title) || this.config.site.title;
    const zh = String(this.config.site.lang || '').toLowerCase().startsWith('zh');

    for (let i = 2; i <= totalPages; i++) {
      const chunk = posts.slice((i - 1) * perPage, i * perPage);
      const url = normalizePath(`${prefix}${i}/`);
      out.push({
        key: `pagination:${i}`,
        rel: '',
        url,
        layout,
        title: `${title} · ${zh ? `第 ${i} 页` : `Page ${i}`}`,
        description: (home && home.description) || '',
        date: null,
        updated: null,
        tags: [],
        category: null,
        series: null,
        weight: 0,
        draft: false,
        toc: false,
        data: {
          type: 'pagination',
          pagination: {
            current: i,
            totalPages,
            perPage,
            total: posts.length,
            url,
            prev: i === 2 ? '/' : normalizePath(`${prefix}${i - 1}/`),
            next: i < totalPages ? pageUrl(i + 1) : null,
            links: pagerLinks(i, totalPages, pageUrl),
            posts: chunk,
          },
        },
        body: '',
        isMd: false,
        ext: '.html',
        excerpt: '',
        readTime: 0,
        raw: `pagination|${i}|${chunk.map((p) => p.url + '|' + p.title).join(',')}`,
        taxonomy: true,
      });
    }
    return out;
  }

  /**
   * 语言首页
   * -------------------------------------------------------------------
   * 多语言站为每种非默认语言生成 /<lang>/ 列表页，分页形如 /<lang>/page/2/。
   * 与首页共用同一个布局和 pagination 结构，模板不用改就能复用；
   * page.lang 设成该语言，所以 <html lang>、导航本地化、语言切换器都对得上。
   * 该语言没有文章时不生成（避免空页）；URL 已被内容文件占用时让位给用户页面。
   * @returns {Array} 需要额外输出的页面
   */
  _langIndexPages(pages) {
    if (!this.multiLang) return [];
    const conf = this.config.pagination || {};
    if (conf.enabled === false) return [];
    const home = pages.find((p) => p.url === '/') || null;
    if (!home || !this._layoutUsesPosts(home.layout) || !this._hasTemplate(home.layout)) return [];

    const perPage = Math.max(1, Number(conf.perPage) || 9);
    const taken = new Set(this.pages.map((p) => p.url));
    const rooms = this._langHomes();
    const out = [];
    for (const lang of this.languages.slice(1)) {
      const posts = this.siteContext.postsByLang[lang] || [];
      if (!posts.length) continue;
      const root = normalizePath(`/${lang}/`);
      if (taken.has(root)) continue;
      const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
      const pageUrl = (n) => (n === 1 ? root : normalizePath(`${root}page/${n}/`));
      const zh = /^zh/i.test(lang);
      const title = home.title || this.config.site.title;
      // 列表页内容由数据决定：标题/摘要/顺序变了都要让缓存失效
      const digest = posts.map((p) => `${p.url}|${p.title}|${p.date}|${p.desc}`).join('\n');
      for (let i = 1; i <= totalPages; i++) {
        const url = pageUrl(i);
        if (taken.has(url)) continue;
        out.push({
          key: `lang:${lang}:${i}`,
          rel: '',
          url,
          layout: home.layout,
          title: i === 1 ? title : `${title} · ${zh ? `第 ${i} 页` : `Page ${i}`}`,
          description: home.description || '',
          date: null,
          updated: null,
          tags: [],
          category: null,
          series: null,
          weight: 0,
          draft: false,
          toc: false,
          lang,
          translations: rooms,
          data: {
            type: 'index',
            index: 'home',
            lang,
            pagination: {
              current: i,
              totalPages,
              perPage,
              total: posts.length,
              url,
              prev: i > 1 ? pageUrl(i - 1) : null,
              next: i < totalPages ? pageUrl(i + 1) : null,
              links: pagerLinks(i, totalPages, pageUrl),
              posts: posts.slice((i - 1) * perPage, i * perPage),
            },
          },
          body: '',
          isMd: false,
          ext: '.html',
          excerpt: '',
          readTime: 0,
          raw: `langHome|${lang}|${i}|${digest}`,
          taxonomy: true, // 生成页：不进 RSS / prev-next / site.pages
        });
      }
    }
    return out;
  }

  /**
   * 为 tags / categories / series 生成聚合页
   * URL 与 site.tags[].url 完全一致（已编码），模板复用 taxonomy.html。
   * 某聚合下文章超过 pagination.perPage 时按 /tags/foo/page/2/ 分页，复用首页
   * 同一套 pagination 数据结构，模板里 {% include "pager.html" %} 即可渲染导航。
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
      // 用全量词条生成页面：默认语言的词条 + 只出现在其它语言的词条都要有落地页
      ['tags', this._allTerms.tags],
      ['categories', this._allTerms.categories],
      ['series', this._allTerms.series],
    ];

    const conf = this.config.pagination || {};
    const paginate = conf.enabled !== false && conf.taxonomy !== false;
    const perPage = Math.max(1, Number(conf.perPage) || 9);

    const out = [];
    for (const [kind, list] of groups) {
      for (const item of list) {
        // 复用聚合阶段已序列化的视图，只保留列表需要的字段（避免把 front-matter 塞进每个聚合页）
        const posts = item.items
          .map((s) => ({
            url: s.url,
            title: s.title,
            description: s.description,
            desc: s.desc,
            date: s.date,
            excerpt: s.excerpt,
          }))
          .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

        const totalPages = paginate ? Math.max(1, Math.ceil(posts.length / perPage)) : 1;
        const base = item.url.endsWith('/') ? item.url : item.url + '/';
        const pageUrl = (n) => (n === 1 ? base : normalizePath(`${base}page/${n}/`));

        for (let i = 1; i <= totalPages; i++) {
          const chunk = paginate ? posts.slice((i - 1) * perPage, i * perPage) : posts;
          const url = pageUrl(i);
          const pagination = paginate
            ? {
                current: i,
                totalPages,
                perPage,
                total: posts.length,
                url,
                prev: i === 1 ? null : pageUrl(i - 1),
                next: i < totalPages ? pageUrl(i + 1) : null,
                links: pagerLinks(i, totalPages, pageUrl),
                posts: chunk,
              }
            : null;

          out.push({
            key: `taxonomy:${kind}:${item.name}${i === 1 ? '' : `:${i}`}`,
            rel: '',
            url,
            layout: 'taxonomy.html',
            title: i === 1 ? item.name : `${item.name} · ${zh ? `第 ${i} 页` : `Page ${i}`}`,
            description: `${labels[kind]} · 共 ${posts.length} 篇`,
            date: null,
            updated: null,
            tags: [],
            category: null,
            series: null,
            weight: 0,
            draft: false,
            toc: false,
            data: { type: 'taxonomy', taxonomy: kind, term: item.name, posts: chunk, pagination },
            body: '',
            isMd: false,
            ext: '.html',
            excerpt: '',
            readTime: 0,
            // 内容变化（文章增删/改名）击穿增量缓存；分页页带上页码与本分页内容
            raw: `taxonomy|${kind}|${item.name}|${i}|${chunk.map((p) => p.url + '|' + p.title).join(',')}`,
            taxonomy: true,
          });
        }
      }
    }
    return out;
  }

  /**
   * 解析自定义集合（collect 阶段、siteContext 构建之前调用）。
   * config.collections: { [name]: { dir, url, layout, perPage, title, description, posts } }
   *   - dir    : 相对 contentDir 的子目录，默认等于集合名
   *   - url    : 列表页 URL，默认 /<name>/
   *   - layout : 列表页布局，默认 collection.html
   *   - perPage: 每页条数；0 表示不分页（单页列出全部）；缺省继承站点 pagination.perPage
   *   - posts  : true 时条目同时进入默认文章流 site.posts，默认 false（集合独立）
   * 副作用：给命中的条目打 p.collection / p.data.collection 标记。
   */
  _resolveCollections() {
    const confs = this.config.collections || {};
    const sitePag = this.config.pagination || {};
    const sitePerPage = sitePag.enabled === false ? 0 : Math.max(1, Number(sitePag.perPage) || 9);
    this.collectionDefs = {};
    this.collections = {};
    this._collectionPostsEnabled = new Set();
    for (const [name, cfg] of Object.entries(confs)) {
      const c = cfg || {};
      const dirRel = String(c.dir || name).replace(/^\/+/, '').replace(/\/+$/, '') + '/';
      const pages = this.pages.filter((p) => {
        if (!p.rel.startsWith(dirRel)) return false;
        // 集合根目录下的 index.* 留给用户手写列表页（会与生成页 URL 撞车时用户页优先）
        const rest = p.rel.slice(dirRel.length);
        if (/^index\.(md|markdown|html|htm)$/i.test(rest)) return false;
        return true;
      });
      // 排序：weight → date 倒序 → url，与首页文章流一致
      pages.sort((a, b) => {
        const wa = a.weight || 0, wb = b.weight || 0;
        if (wa !== wb) return wa - wb;
        const da = a.date ? a.date.getTime() : 0, db = b.date ? b.date.getTime() : 0;
        if (da !== db) return db - da;
        return a.url.localeCompare(b.url);
      });
      for (const p of pages) {
        p.collection = name;
        p.data.collection = name;
        // 集合独立：默认也不进 RSS / JSON Feed（这两个插件读 documents，按 data.rss 过滤）。
        // front-matter 显式写了 rss 的尊重用户选择；posts: true 的集合不加此标记。
        if (c.posts !== true && p.data.rss === undefined) p.data.rss = false;
      }
      if (c.posts === true) this._collectionPostsEnabled.add(name);
      const perPage = c.perPage === undefined ? sitePerPage : Math.max(0, Number(c.perPage) || 0);
      let url = normalizePath(c.url || ('/' + name + '/'));
      if (url !== '/' && !url.endsWith('/')) url += '/';
      const layout = c.layout || 'collection.html';
      this.collectionDefs[name] = { conf: c, url, layout, perPage, pages };
      this.collections[name] = {
        name,
        url,
        count: pages.length,
        layout,
        perPage,
        items: pages.map((p) => this.serializePage(p)),
      };
    }
  }

  /**
   * 自定义集合的列表页 /<name>/ 与分页页 /<name>/page/N/。
   * 复用 taxonomy 分页的数据结构：模板遍历 page.data.posts，{% include "pager.html" %} 渲染导航。
   * 生成页与聚合页同属"生成页"：不进 site.pages / RSS / prev-next / navGroups；
   * 条目清单 baked 进 raw，条目增删改会击穿增量缓存。
   */
  _collectionPages() {
    const zh = String(this.config.site.lang || '').toLowerCase().startsWith('zh');
    const out = [];
    const occupied = new Set(this.pages.map((p) => p.url));
    for (const [name, def] of Object.entries(this.collectionDefs || {})) {
      const c = def.conf || {};
      const base = def.url.endsWith('/') ? def.url : def.url + '/';
      const title = c.title || name;
      const posts = def.pages.map((p) => {
        const s = this.serializePage(p);
        return { url: s.url, title: s.title, description: s.description, desc: s.desc, date: s.date, excerpt: s.excerpt };
      });
      const totalPages = def.perPage > 0 ? Math.max(1, Math.ceil(posts.length / def.perPage)) : 1;
      const pageUrl = (n) => (n === 1 ? base : normalizePath(`${base}page/${n}/`));
      for (let i = 1; i <= totalPages; i++) {
        const chunk = def.perPage > 0 ? posts.slice((i - 1) * def.perPage, i * def.perPage) : posts;
        const url = pageUrl(i);
        if (occupied.has(url)) continue; // 用户手写的同 URL 内容页优先
        const pagination = def.perPage > 0 ? {
          current: i,
          totalPages,
          perPage: def.perPage,
          total: posts.length,
          url,
          prev: i === 1 ? null : pageUrl(i - 1),
          next: i < totalPages ? pageUrl(i + 1) : null,
          links: pagerLinks(i, totalPages, pageUrl),
          posts: chunk,
        } : null;
        out.push({
          key: `collection:${name}${i === 1 ? '' : `:${i}`}`,
          rel: '',
          url,
          layout: def.layout,
          title: i === 1 ? title : `${title} · ${zh ? `第 ${i} 页` : `Page ${i}`}`,
          description: c.description || `${title} · 共 ${posts.length} 项`,
          date: null,
          updated: null,
          tags: [],
          category: null,
          series: null,
          weight: 0,
          draft: false,
          toc: false,
          data: { type: 'collection', collection: name, posts: chunk, pagination },
          body: '',
          isMd: false,
          ext: '.html',
          excerpt: '',
          readTime: 0,
          raw: `collection|${name}|${i}|${chunk.map((p) => p.url + '|' + p.title + '|' + (p.date || '')).join(',')}`,
          taxonomy: true,
        });
      }
    }
    return out;
  }

  /** 主题里是否存在某个布局/片段（用于按主题能力决定是否生成页面） */
  _hasTemplate(name) {
    if (!name || !this.theme || !this.theme.dir) return false;
    return [path.join(this.theme.dir, 'layouts', name), path.join(this.theme.dir, 'partials', name)].some((p) =>
      fs.existsSync(p)
    );
  }

  /** 布局是否会渲染文章列表（决定要不要生成分页页） */
  _layoutUsesPosts(layout) {
    try {
      const src = fs.readFileSync(this.theme.resolve(layout), 'utf8');
      return /\bposts\b/.test(src) || src.includes('post-list');
    } catch (e) {
      return false;
    }
  }

  /**
   * 分类索引页 / 归档页
   * 主题没有对应布局时直接跳过：自定义主题升级后不会因为缺模板而构建失败，
   * 也不会产生指向空白布局的死链。
   */
  _indexPages() {
    const zh = String(this.config.site.lang || '').toLowerCase().startsWith('zh');
    const conf = this.config.indexes || {};
    const specs = [
      {
        key: 'categories',
        url: '/categories/',
        layout: 'categories.html',
        title: zh ? '分类' : 'Categories',
        description: zh ? '按主题浏览全部文章' : 'Browse all posts by topic',
      },
      {
        key: 'archives',
        url: '/archives/',
        layout: 'archives.html',
        title: zh ? '归档' : 'Archives',
        description: zh ? '按时间线浏览全部文章' : 'Browse all posts by date',
      },
    ];

    const out = [];
    for (const def of specs) {
      const user = conf[def.key] || {};
      if (user.enabled === false) continue;
      const layout = user.layout || def.layout;
      if (!this._hasTemplate(layout)) continue;

      const url = normalizePath(user.url || def.url);
      const title = user.title || def.title;
      const description = user.description || def.description;

      let data;
      let raw;
      if (def.key === 'categories') {
        const terms = this.categories
          .map((c) => ({
            name: c.name,
            url: c.url,
            count: c.count,
            // 每类取最新一篇，卡片上给出一个入口
            latest: c.items[0] ? { url: c.items[0].url, title: c.items[0].title, date: c.items[0].date } : null,
          }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        data = { type: 'index', index: 'categories', terms, total: terms.length };
        raw = `categories|${terms.map((t) => t.name + ':' + t.count).join(',')}`;
      } else {
        const posts = this.siteContext.posts
          .map((p) => ({ url: p.url, title: p.title, date: p.date, tags: p.tags || [] }))
          .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
        const years = [];
        const byYear = new Map();
        for (const p of posts) {
          const year = (p.date || '').slice(0, 4) || '—';
          let bucket = byYear.get(year);
          if (!bucket) byYear.set(year, (bucket = []));
          bucket.push(p);
        }
        for (const [year, list] of byYear) years.push({ year, posts: list });
        data = { type: 'index', index: 'archives', years, total: posts.length };
        raw = `archives|${posts.map((p) => p.url + '|' + p.date).join(',')}`;
      }

      out.push({
        key: `index:${def.key}`,
        rel: '',
        url: url.endsWith('/') ? url : url + '/',
        layout,
        title,
        description,
        date: null,
        updated: null,
        tags: [],
        category: null,
        series: null,
        weight: 0,
        draft: false,
        toc: false,
        data,
        body: '',
        isMd: false,
        ext: '.html',
        excerpt: '',
        readTime: 0,
        raw,
        taxonomy: true, // 与聚合页同属"生成页"：不进 RSS / prev-next / 页面列表
      });
    }
    return out;
  }

  /** 语言首页清单：默认语言是 /，其它语言是 /<lang>/（该语言有文章才算一版） */
  _langHomes() {
    const title = this.config.site.title || '';
    return this.languages
      .filter((l) => l === this.defaultLang || (this._langStream.get(l) || []).length)
      .map((l) => ({ lang: l, url: l === this.defaultLang ? '/' : normalizePath(`/${l}/`), title }));
  }

  /** 自动补全 prev / next（按 pages 的最终顺序：weight → 日期 → url） */
  _linkNeighbors() {
    // 集合条目不与默认文章流串 prev/next（保持集合独立）；
    // 多语言站按语言各串各的，翻译版本不会跳到另一种语言的文章上
    const groups = new Map();
    for (const p of this.pages) {
      if (p.data.type === 'page' || p.url === '/' || !p.date || p.collection) continue;
      const k = this.multiLang ? p.lang : '';
      let arr = groups.get(k);
      if (!arr) groups.set(k, (arr = []));
      arr.push(p);
    }
    for (const posts of groups.values()) {
      for (let i = 0; i < posts.length; i++) {
        const cur = posts[i];
        const prev = posts[i + 1];
        const next = posts[i - 1];
        if (prev) cur.data.prev = { url: prev.url, title: prev.title };
        if (next) cur.data.next = { url: next.url, title: next.title };
      }
    }
  }

  /** 页面对象 → 模板可见的精简结构 */
  serializePage(p) {
    return {
      url: p.url,
      title: p.title,
      description: p.description,
      desc: p.description || p.excerpt || '', // 列表卡片/摘要优先用 description，没有则回退自动摘要
      date: formatDay(p.date),
      updated: formatDay(p.updated),
      tags: p.tags,
      category: p.category,
      series: p.series,
      lang: p.lang || this.defaultLang, // 页面语言（生成页回退默认语言）
      translations: p.translations || [], // 同 translationKey 的其他语言版本：{lang,url,title}
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
      // 插件可按 mode 注入不同内容（如 analytics 仅生产启用），不能跨模式复用整页 HTML。
      mode: this.mode,
      theme: this.theme.dir,
      site: this.config.site,
      defaults: this.config.defaults,
      markdown: this.config.markdown,
      // 插件升级/改代码/改配置都要让缓存失效，否则增量构建会留下旧插件产物
      plugins: this.plugins.fingerprint(this.config),
      // 全局数据文件变化也要让所有页面缓存失效：模板可能在任意页面引用 site.data
      data: this.siteData,
      // 集合配置变化（增删集合 / 改分页 / 改布局）可能影响引用 site.collections 的页面
      collections: this.config.collections,
    }));
    // raw 已在 collect 阶段读入，这里只做哈希计算（无 IO）
    // 列表类页面（首页）的正文没变，但"列表内容"会随文章增删改变化，
    // 所以额外掺入一份文章清单摘要，否则 dev 增量构建会留下旧列表。
    const postsDigest = hash(
      (this.siteContext.posts || []).map((p) => `${p.url}|${p.title}|${p.date}|${p.excerpt}`).join('\n')
    );
    const hasPluginKey = this.plugins.hasCacheKey();
    // Page Bundle：页面所在目录（及叶子同名子目录）的资源摘要参与哈希，
    // 改了文章配图/附件时引用它的页面会重渲染，不会留下旧 HTML。
    const assetDigest = (p) => {
      const dir = path.posix.dirname(p.rel);
      let ad = this._assetDirDigest.get(dir) || '';
      const leaf = p.rel.slice(0, -p.ext.length); // posts/hello.md → posts/hello
      if (this._assetDirs.has(leaf)) ad += '|' + (this._assetDirDigest.get(leaf) || '');
      return ad ? `|${ad}` : '';
    };
    for (const p of this.pages) {
      const listing = p.listing ? `|${postsDigest}` : '';
      // 插件通过 cacheKey 声明的跨页数据（如相关文章）也要参与哈希，
      // 否则别的文章改了标签，这一页的增量缓存不会失效，相关推荐会留旧值
      const pluginKey = hasPluginKey ? this.plugins.pageCacheKey(p) : '';
      p.hash = hash(`${p.layout}|${this.themeFingerprint}|${cfgFingerprint}|${p.raw}${listing}${pluginKey}${assetDigest(p)}`);
    }
    this.timings.hash = performance.now() - t1;
  }

  /** 并行渲染（worker 池） */
  async renderAll() {
    const t0 = performance.now();
    const pages = this.pages;
    const jobs = [];

    // 生产模式下插件若不参与单页渲染，才能安全地交给 worker。
    // transformHtml 不算：worker 只做 Markdown + 模板渲染，这类钩子
    // （SEO meta、HTML 压缩）在主线程结果回来后补跑一次。
    const workerSafe =
      this.mode === 'production' &&
      pages.length >= this.config.workerThreshold &&
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
      // transformHtml 在主线程补跑（worker 不做这一步，否则无法并行）
      if (this.plugins.has('transformHtml')) {
        for (const p of jobs) {
          if (p.html == null) continue;
          const ctx = buildContext({
            view: this.serializePage(p),
            bodyHtml: p.bodyHtml || '',
            headings: p.tocData || [],
            site: this.siteContext,
          });
          p.html = await this.plugins.call('transformHtml', p.html, ctx);
        }
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
      // content/ 下的 Page Bundle 附件：dest 为相对 contentDir 的 posix 路径
      contentAssets: this.contentAssets || [],
    };
  }

  /**
   * 插件附加产物（sitemap.xml / feed.xml / search.json …）：只生成内容，不落盘
   * build 由 writeOutput 写盘；dev 模式下 server 直接从 this.extraFiles 取内存内容
   * （否则 `xfm dev` 里这些文件根本不存在，搜索面板会 404）
   */
  async collectExtras() {
    // documents[].html 是「正文 HTML」，不含布局——RSS 全文必须用正文，
    // 曾经在这里塞过整页 HTML，导致 feed 里混进导航和页脚
    // inStream：该文档属不属于站点的默认文章流（多语言站的翻译版本为 false），
    // rss / feed-json 用它过滤，search / llms 仍可索引全部页面。
    this.documents = this.pages.map((p) => ({
      ...this.serializePage(p),
      html: p.bodyHtml || '',
      inStream: this._inDefaultStream(p),
    }));
    // 逐步累积：afterBuild 期间排在前面的插件产物要能被后面的插件看到（见 plugins.js call）
    this.extraFiles = [];
    const extra = await this.plugins.call('afterBuild', [], this);
    this.extraFiles = (extra || [])
      .filter((it) => it && it.path)
      .map((it) => ({ path: String(it.path).replace(/^\/+/, ''), contents: it.contents }));
    return this.extraFiles;
  }

  /**
   * 写输出目录：清陈旧产物 → 写页面 → 复制资源 → 生成插件产物
   * 不再整体 rm -rf，只删除"本次不会再生成"的旧文件：
   * Windows 上全删 500 个页面目录约 1.8s，是构建的主要开销。
   *
   * 内容没变的文件不重写，顺带连目录都不建：NTFS 上 1000 次 mkdir 约 1.1s、
   * 重写 1000 个 8KB 页面约 1.3s，而 stat + 读回来比一下只要 0.6s。
   * @returns {Promise<{extraOutputs:number, outDir:string}>}
   */
  async writeOutput() {
    const outDir = path.resolve(this.root, this.config.outDir || 'dist');
    await fsp.mkdir(outDir, { recursive: true });

    // 页面：保留来源信息，冲突时报错才能定位到内容文件或生成页。
    const pageFiles = this.pages.map((p) => [
      path.join(outDir, urlToFilePath(p.url)),
      p.html,
      p.rel ? `页面 ${p.rel}（${p.url}）` : `生成页 ${p.key}（${p.url}）`,
    ]);

    // 资源（主题 assets / public / content Page Bundle 附件）
    const { themeAssets, publicFiles, contentAssets } = await this.assets();
    const copyList = themeAssets.concat(publicFiles).concat(contentAssets).map((a) => [a.src, path.join(outDir, a.dest)]);
    this.stats.assets = copyList.length;

    // 插件附加产物：documents[].html 是「正文 HTML」，不含布局
    // （曾经在这里把整页 HTML 写进 documents，导致 RSS 全文里塞进了导航和页脚）
    const extraFiles = (await this.collectExtras()).map((it) => [
      path.join(outDir, it.path),
      it.contents,
      `插件产物 ${it.path}`,
    ]);

    // 先登记全部产物并检测冲突，再清理或写入，避免同一路径被并行覆盖。
    const planned = new Set();
    const owners = new Map();
    const collisions = [];
    const plan = (dest, owner) => {
      planned.add(dest);
      const key = process.platform === 'win32' ? dest.toLowerCase() : dest;
      const previous = owners.get(key);
      if (previous) collisions.push({ dest, first: previous, second: owner });
      else owners.set(key, owner);
    };
    for (const [dest, , owner] of pageFiles) plan(dest, owner);
    for (const [src, dest] of copyList) plan(dest, `资源 ${src}`);
    for (const [dest, , owner] of extraFiles) plan(dest, owner);

    if (collisions.length) {
      const details = collisions
        .slice(0, 10)
        .map((c) => `  ${path.relative(outDir, c.dest)}\n    - ${c.first}\n    - ${c.second}`)
        .join('\n');
      const more = collisions.length > 10 ? `\n  …另有 ${collisions.length - 10} 处` : '';
      throw new Error(`[xfm] 检测到 ${collisions.length} 处输出路径冲突，已停止写盘：\n${details}${more}`);
    }

    // 清理旧产物（先清后写，避免误删本次生成的文件）
    await pruneStale(outDir, planned);

    // 页面 + 附加产物：逐个体检，内容一致就跳过
    const writes = [];
    await Promise.all(
      pageFiles.concat(extraFiles).map(async ([dest, data]) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        const { existed, same } = await inspectOutput(dest, buf);
        if (!same) writes.push({ dest, buf, existed });
      })
    );

    // 资源：源文件不比目标新就跳过（同 make 的规则，不必读内容）
    const copies = [];
    await Promise.all(
      copyList.map(async ([src, dest]) => {
        const { existed, stale } = await inspectCopy(src, dest);
        if (stale) copies.push({ src, dest, existed });
      })
    );

    // 建目录 + 落盘：两阶段执行，避免 writeFile 早于 mkdir。
    // 目标文件原本就在的，目录必然存在，不用再 mkdir。
    const dirSet = new Set();
    for (const it of writes.concat(copies)) if (!it.existed) dirSet.add(path.dirname(it.dest));
    await Promise.all([...dirSet].map((d) => fsp.mkdir(d, { recursive: true })));
    await Promise.all(writes.map((it) => fsp.writeFile(it.dest, it.buf)));
    await Promise.all(copies.map((it) => fsp.copyFile(it.src, it.dest)));

    this.stats.written = writes.length + copies.length;
    this.stats.unchanged = pageFiles.length + extraFiles.length + copyList.length - this.stats.written;
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

    // 增量缓存（开发模式或显式启用 incremental 的生产构建）
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

module.exports = { Site, walk, hash, normalizePath, urlToFilePath, deriveRoute, formatDate, formatDay };
