'use strict';
/**
 * 插件系统
 * -------------------------------------------------------------------
 * 一个插件就是导出函数的模块：
 *
 *   module.exports = (site) => ({
 *     name: 'my-plugin',
 *     // 1. 扩展站点上下文（模板里可直接用）
 *     extendContext(ctx) {},
 *     // 2. 修改单页 front-matter / markdown 源
 *     markdown(raw, page) { return raw; },
 *     // 3. 页面 HTML 产出后、写入磁盘前（可追加内容）
 *     transformHtml(html, page) { return html; },
 *     // 4. 所有页面收集完毕、渲染开始前（跨页数据注入 page.data）
 *     afterCollect(site) {},
 *     // 5. 所有页面渲染完毕（此时全部文档已解析，可读取 site.documents）
 *     afterBuild(site) { return [{ path: 'sitemap.xml', contents: '...' }] },
 *     // 6. 开发服务器钩子
 *     configureServer(server) {},
 *     // 7. 注销开发服务器钩子（热重载插件前调用，用于移除中间件/监听器）
 *     unconfigureServer(server) {},
 *     // 8. 单页缓存的额外贡献（afterCollect 注入的跨页数据变化时使缓存失效）
 *     cacheKey(page, site) { return ''; },
 *   });
 *
 * 钩子按注册顺序串行执行；返回非空值即替换原值（Promise 也支持）。
 *
 * 插件来源（与 Hexo 一致：装了就生效，不装就不存在）
 * ---------------------------------------------------------------
 *   a. 站点 package.json 里以 `xfm-plugin-` 开头的依赖 —— 自动加载；
 *   b. 配置 plugins: ['rss'] 这类短名 —— 解析成 `xfm-plugin-rss`；
 *   c. 配置 plugins: ['./plugins/rss.js'] 这类路径 —— 站点本地文件；
 *   d. 配置文件里直接写函数/对象 —— 内联插件。
 *
 * 内核不带任何插件：`npm i -g xfmpress` 之后站点里一个插件都没有，
 * 需要哪个就 `npm i -D xfm-plugin-<name>` 装哪个。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** 官方插件包的命名前缀；自动发现与短名解析都按它来 */
const PLUGIN_PREFIX = 'xfm-plugin-';

/** 稳定哈希（用于缓存指纹，插件内容/版本变化即失效） */
function hash(s) {
  return crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
}

/**
 * 钩子语义表：明确每个钩子的参数来源与返回值如何合并，
 * 避免"某几个钩子参数顺序特殊"的隐式约定
 *
 *   kind: 'transform' → fn(当前值, ...args)，返回新值替换当前值
 *   kind: 'collect'   → fn(...args)，返回数组并汇总（用于产出额外文件）
 *   kind: 'event'     → fn(...args)，忽略返回值
 */
const HOOKS = {
  extendContext: { kind: 'transform' },
  markdown: { kind: 'transform' },
  transformHtml: { kind: 'transform' },
  afterCollect: { kind: 'event' },
  afterBuild: { kind: 'collect' },
  configureServer: { kind: 'event' },
  unconfigureServer: { kind: 'event' },
  finish: { kind: 'event' },
};

/** 读取 package.json（失败返回 null） */
function readPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

/** 包名是否是一个插件包（`xfm-plugin-x` 或 `@scope/xfm-plugin-x`） */
function isPluginPackage(name) {
  if (name.startsWith(PLUGIN_PREFIX)) return true;
  const parts = name.split('/');
  return name.startsWith('@') && parts.length === 2 && parts[1].startsWith(PLUGIN_PREFIX);
}

/** 站点 package.json 里声明的插件包名，按字母序（保证加载顺序稳定） */
function discover(root) {
  const pkg = readPackage(root);
  if (!pkg) return [];
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  return Object.keys(deps).filter(isPluginPackage).sort();
}

/** 短名 → 包名：`rss` → `xfm-plugin-rss`；已是包名或路径则原样返回 */
function toPackageName(spec) {
  const s = String(spec);
  if (s.startsWith('.') || s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s)) return null; // 路径
  if (s.includes('/')) return s; // @scope/pkg 或 pkg/subpath
  if (s.startsWith(PLUGIN_PREFIX)) return s;
  return PLUGIN_PREFIX + s;
}

/** 是否是文件路径（用于区分 './plugins/x.js' 与 'rss'） */
function isPathLike(spec) {
  return spec.startsWith('.') || spec.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(spec);
}

class PluginSystem {
  constructor(site) {
    this.site = site;
    this.plugins = [];
    this.loaded = new Set(); // 已加载文件的绝对路径，避免自动发现与显式配置重复注册
  }

  use(plugin, from) {
    let p = plugin;
    if (typeof p === 'function') p = p(this.site);
    if (!p || typeof p !== 'object') return this;
    if (from) {
      const key = path.resolve(from);
      if (this.loaded.has(key)) return this;
      this.loaded.add(key);
    }
    p.name = p.name || (from ? path.basename(from, '.js') : 'anonymous');
    p.__file = from;
    this.plugins.push(p);
    return this;
  }

  /** 清空已加载插件（热重载时先 reset 再重新走 init 的加载序列） */
  reset() {
    this.plugins = [];
    this.loaded = new Set();
    return this;
  }

  /** 从目录批量加载插件（站点本地 plugins/ 目录，兼容 0.4 之前的手写插件） */
  loadDir(dir) {
    if (!fs.existsSync(dir)) return this;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
    for (const f of files) {
      const abs = path.join(dir, f);
      this.use(requireFresh(abs), abs);
    }
    return this;
  }

  /**
   * 自动加载站点 package.json 里声明的 xfm-plugin-* 依赖
   * 这就是 Hexo 的插件体验：`npm i -D xfm-plugin-rss` 之后不用改配置。
   */
  loadAuto(root) {
    for (const name of discover(root)) this.load(name, root);
    return this;
  }

  /**
   * 按「短名 / 包名 / 路径」加载单个插件
   * 解析顺序：站点本地文件 → 站点 node_modules → CLI 自身所在 node_modules
   * （全局安装时插件通常跟 CLI 装在同一个前缀下，两种情况都要认）
   */
  load(spec, baseDir) {
    if (spec && typeof spec === 'object') return this.use(spec);
    if (typeof spec !== 'string' || !spec) return this;

    const root = baseDir || process.cwd();
    const tries = [];

    // 0) 0.4.2 之前的内置前缀：给出迁移指引，别让 'xfm:rss' 变成 'xfm-plugin-xfm:rss'
    if (spec.startsWith('xfm:')) {
      const short = spec.slice(4);
      throw new Error(
        `[xfm] 不再支持 "xfm:${short}" 写法：插件已从内核拆成独立 npm 包\n` +
          `  改法：npm i -D ${PLUGIN_PREFIX}${short}，配置里写 '${short}'（或直接删掉配置，装上就会自动加载）`
      );
    }

    // 1) 显式路径，或站点 plugins/ 下的同名文件
    if (isPathLike(spec)) {
      tries.push(path.resolve(root, spec));
    } else {
      tries.push(path.resolve(root, 'plugins', spec + '.js'));
      tries.push(path.resolve(root, 'plugins', spec));
    }
    for (const abs of tries) {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return this.use(requireFresh(abs), abs);
    }

    // 2) node_modules：站点优先，其次 CLI 自己的安装位置
    const id = toPackageName(spec);
    if (id) {
      for (const from of [root, path.join(__dirname, '..', '..')]) {
        let abs = null;
        try {
          abs = require.resolve(id, { paths: [from] });
        } catch (e) {
          continue;
        }
        return this.use(requireFresh(abs), abs);
      }
    }

    throw new Error(
      `[xfm] 找不到插件 "${spec}"\n` +
        `  插件不再随内核发布，需要单独安装：\n` +
        `    npm i -D ${id || PLUGIN_PREFIX + 'name'}   （装完重启 xfm dev）\n` +
        `  也可以写路径指向站点内的本地插件：plugins: ['./plugins/${spec}.js']`
    );
  }

  has(hook) {
    return this.plugins.some((p) => typeof p[hook] === 'function');
  }

  /** 已加载插件名（info 命令用） */
  names() {
    return this.plugins.map((p) => p.name);
  }

  /** 是否有插件声明了 cacheKey（避免无插件时每页多一次循环） */
  hasCacheKey() {
    return this.plugins.some((p) => typeof p.cacheKey === 'function');
  }

  /** 汇总各插件对单页缓存的额外贡献，返回拼接到 hash 的字符串 */
  pageCacheKey(page) {
    let out = '';
    for (const p of this.plugins) {
      if (typeof p.cacheKey !== 'function') continue;
      try {
        const r = p.cacheKey(page, this.site);
        if (r != null && r !== '') out += '|' + r;
      } catch (e) {
        // 插件算缓存键出错不应中断构建：最坏情况是这一页缓存不命中、重渲染一次
      }
    }
    return out;
  }

  /**
   * 插件指纹：名称 + 版本/文件内容 + 插件配置。
   * 混入页面缓存哈希后，插件升级、改代码或改配置都会让缓存整体失效，
   * 取代之前对 related 的硬编码特判。
   */
  fingerprint(siteConfig = {}) {
    const parts = [];
    for (const p of this.plugins) {
      let ver = p.version || '';
      if (!ver && p.__file) ver = pluginVersionOrHash(p.__file);
      parts.push(`${p.name}@${ver}|${JSON.stringify(siteConfig[p.name] == null ? null : siteConfig[p.name])}`);
    }
    return hash(parts.join('\n'));
  }

  async call(hook, value, ...args) {
    const spec = HOOKS[hook] || { kind: 'transform' };
    const collected = [];

    for (const p of this.plugins) {
      const fn = p[hook];
      if (typeof fn !== 'function') continue;

      if (spec.kind === 'collect') {
        const r = await fn.apply(p, args);
        const items = Array.isArray(r) ? r : r ? [r] : [];
        collected.push(...items);
        // 后面的插件要能看到前面插件的产物：deadlinks 需要知道 math/mermaid 生成的
        // 资源路径，否则会把 /assets/katex/katex.min.css 误报成死链。
        // 只暴露路径（内容是 Buffer，没必要共享）。
        const site = args[0];
        if (hook === 'afterBuild' && site && Array.isArray(site.extraFiles)) {
          for (const it of items) {
            if (it && it.path) site.extraFiles.push({ path: String(it.path).replace(/^\/+/, '') });
          }
        }
      } else if (spec.kind === 'event') {
        await fn.apply(p, args);
      } else {
        const r = await fn.call(p, value, ...args);
        if (r !== undefined && r !== null) value = r;
      }
    }
    return spec.kind === 'collect' ? collected : value;
  }

  /** 同步版本（仅用于不支持异步的钩子，如 configureServer） */
  callSync(hook, value, ...args) {
    for (const p of this.plugins) {
      const fn = p[hook];
      if (typeof fn !== 'function') continue;
      const r = fn.call(p, value, ...args);
      if (r !== undefined && r !== null) value = r;
    }
    return value;
  }
}

/** 重新 require（dev 模式下插件改动要生效） */
function requireFresh(abs) {
  try {
    delete require.cache[require.resolve(abs)];
  } catch (e) { /* 首次加载，无需清理 */ }
  return require(abs);
}

/**
 * 插件版本或内容指纹：
 *  - 有主包的插件（npm / workspace）：插件文件同目录即包根，相邻 package.json 带 version 时取 version；
 *  - 站点本地裸插件（无相邻 package.json）：返回文件内容哈希，确保编辑后缓存失效。
 * 注意：只能看插件文件的同级目录，不能向上遍历——否则会把站点根 package.json
 * 误判成插件包（站点名可能恰好以 xfm-plugin- 开头），导致版本号稳定、改代码不失效。
 */
function pluginVersionOrHash(file) {
  const pkgFile = path.join(path.dirname(file), 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); } catch (e) { /* 无相邻 package.json */ }
  if (pkg && pkg.version && pkg.name && isPluginPackage(pkg.name)) return pkg.version;
  try {
    return 'h:' + hash(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return 'h:unknown';
  }
}

module.exports = { PluginSystem, discover, PLUGIN_PREFIX };
