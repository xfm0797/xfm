'use strict';
/**
 * 开发服务器
 * -------------------------------------------------------------------
 * - 内存中按需构建：请求到达时若该页 hash 未变直接返回缓存 HTML
 * - fs.watch 监听 content/ themes/ plugins/ config
 * - 变更后立即增量重建受影响页面，通过 SSE 通知浏览器局部刷新
 * - 无需写盘，毫秒级反馈
 */

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { Site } = require('./site');
const { loadConfig } = require('./config');
const { normalizeBase } = require('./url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // PWA 清单：规范要求类型，缺了 Chrome 会拒绝安装
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.pdf': 'application/pdf',
};

const RELOAD_SNIPPET = `
<script>
(function(){
  if (location.protocol === 'file:') return;
  var es = new EventSource('/__xfm/events');
  es.addEventListener('reload', function(e){
    var d = JSON.parse(e.data || '{}');
    var cur = location.pathname.replace(/index\\.html$/, '').replace(/\\/$/, '') || '/';
    if (d.kind === 'css') {
      document.querySelectorAll('link[rel=stylesheet]').forEach(function(l){
        l.href = l.href.split('?')[0] + '?t=' + Date.now();
      });
      return;
    }
    if (d.kind === 'page' && d.url && d.url !== cur) {
      console.log('[xfm] 其他页面已更新：' + d.url);
      return;
    }
    // 保持滚动位置刷新
    var y = window.scrollY;
    sessionStorage.setItem('__xfm_scroll', String(y));
    location.reload();
  });
  window.addEventListener('load', function(){
    var y = sessionStorage.getItem('__xfm_scroll');
    if (y !== null) { sessionStorage.removeItem('__xfm_scroll'); window.scrollTo(0, +y); }
  });
})();
</script>`;

class DevServer {
  constructor(root, cfgOverride = {}) {
    this.root = root;
    this.clients = new Set();
    this.site = null;
    this.cfgOverride = cfgOverride;
    this.pending = null;
    this.watchers = [];
    this.pageIndex = new Map();
  }

  async start() {
    const config = await loadConfig(this.root);
    Object.assign(config.server, this.cfgOverride);
    this.config = config;
    await this.rebuild('init');

    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.server.port, config.server.host, resolve);
    });

    const addr = server.address();
    this.url = `http://${config.server.host === '0.0.0.0' ? 'localhost' : config.server.host}:${addr.port}/`;

    // configureServer：插件可以在这里挂中间件/路由
    if (this.site.plugins.has('configureServer')) {
      await this.site.plugins.call('configureServer', server);
    }

    this.watch();
    return this;
  }

  /**
   * 重建站点（复用同一 Site 实例）
   * 修正两处缺陷：
   *  1. 原实现每次变更都 new Site()，插件模块被反复 require，事件监听与内存持续增长
   *  2. theme.invalidate() 在重建之后才调用，等于没清缓存
   */
  async rebuild() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      // 首次：创建并初始化（dev 模式 init 内部会加载增量缓存）；之后：只失效模板缓存
      if (!this.site) {
        this.site = new Site(this.config, this.root, { mode: 'development' });
        await this.site.init();
      } else {
        this.site.theme.invalidate();
      }
      const site = this.site;
      await site.collect();
      await site.prepare();
      await site.renderAll();
      await site.collectExtras();
      this.indexPages();
      return site;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  /** 页面 URL → page 索引，避免每个请求线性扫描 pages */
  indexPages() {
    const index = new Map();
    for (const p of this.site.pages) {
      index.set(p.url, p);
      if (p.url.endsWith('/')) index.set(p.url + 'index.html', p);
    }
    this.pageIndex = index;

    // 插件产物只在内存里（dev 不落盘），按 /path 建索引
    // 目录形式的产物（跳转页 old/index.html）要同时挂上 "/old/"，
    // 否则浏览器请求目录路径会在 dev 下 404，构建出来却是好的
    const extras = new Map();
    for (const it of this.site.extraFiles || []) {
      const p = '/' + it.path;
      const entry = { contents: it.contents, path: p };
      extras.set(p, entry);
      if (p.endsWith('/index.html')) extras.set(p.slice(0, -'index.html'.length), entry);
    }
    this.extraIndex = extras;
  }

  /**
   * 配置文件变更：重新读取配置并重建 Site
   * 之前只替换 this.config，站点实例仍持旧配置对象，改标题/主题完全没反应
   */
  async reloadConfig() {
    this.config = await loadConfig(this.root);
    Object.assign(this.config.server, this.cfgOverride);
    this.site = null; // 下次 rebuild 会按新配置重建实例与插件
  }

  broadcast(msg) {
    const payload = `event: reload\ndata: ${JSON.stringify(msg)}\n\n`;
    for (const res of this.clients) {
      res.write(payload);
    }
  }

  handle(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('400 Bad Request');
    }

    if (pathname === '/__xfm/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 1000\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }

    this.serve(pathname, res).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 ' + e.message);
    });
  }

  async serve(pathname, res) {
    const site = this.site;
    if (!site) { res.writeHead(503); return res.end('building…'); }

    // site.base 子路径部署：浏览器请求 /blog/posts/x/，内部路由仍是 /posts/x/
    const base = normalizeBase(this.config.site && this.config.site.base);
    if (base !== '/') {
      const prefix = base.slice(0, -1);
      if (pathname === prefix) pathname = '/';
      else if (pathname.startsWith(prefix + '/')) pathname = pathname.slice(prefix.length);
    }

    // 静态资源：主题 assets / public
    const assetName = pathname.startsWith('/assets/') ? pathname.slice(8) : null;
    if (assetName) {
      const p1 = safeJoin(path.join(site.theme.dir, 'assets'), assetName);
      const p2 = safeJoin(path.join(this.root, this.config.publicDir), assetName);
      for (const f of [p1, p2]) {
        if (f && (await isFile(f))) return this.sendFile(f, res);
      }
    }
    const pub = safeJoin(path.join(this.root, this.config.publicDir), pathname);
    if (pub && (await isFile(pub))) return this.sendFile(pub, res);

    // 插件产物（search.json / sitemap.xml / feed.xml / 跳转页 …）：dev 不落盘，取内存内容
    const extra = this.extraIndex && this.extraIndex.get(pathname);
    if (extra != null) {
      // 目录路径（/old/）本身没有扩展名，MIME 要按真实文件（/old/index.html）判断
      const real = typeof extra === 'string' ? pathname : extra.path;
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      return res.end(typeof extra === 'string' ? extra : extra.contents);
    }

    // 页面
    const norm = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const page =
      this.pageIndex.get(pathname) ||
      this.pageIndex.get(norm) ||
      this.pageIndex.get(pathname + '/');

    if (!page) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(this.notFound(pathname, site));
    }

    if (!page.html) {
      await site.renderPage(page).then((r) => { page.html = r.html; page.bodyHtml = r.bodyHtml; });
    }
    let html = page.html;
    html = html.replace('</body>', RELOAD_SNIPPET + '</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  }

  notFound(pathname, site) {
    const list = site.pages
      .map((p) => `<li><a href="${p.url}">${p.url}</a> — ${escape(p.title)}</li>`)
      .join('');
    return `<!doctype html><meta charset="utf-8"><title>404</title>
<style>body{font:16px/1.7 system-ui,sans-serif;max-width:720px;margin:4rem auto;padding:0 1.5rem;color:#222}code{background:#f3f3f3;padding:.1em .4em;border-radius:4px}a{color:#2563eb}</style>
<h1>404</h1><p>路径 <code>${escape(pathname)}</code> 没有对应页面。</p><h3>可用页面</h3><ul>${list}</ul>`;
  }

  sendFile(file, res) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  watch() {
    const dirs = [
      path.join(this.root, this.config.contentDir),
      path.join(this.root, 'themes'),
      path.join(this.root, 'plugins'),
      path.join(this.root, this.config.publicDir),
    ].filter((d) => fs.existsSync(d));

    let timer = null;
    const onChange = (file) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const rel = file ? path.relative(this.root, String(file)) : '';
        const isCss = /\.css$/.test(rel);
        if (isCss) {
          this.broadcast({ kind: 'css' });
          return;
        }
        const isConfig = /xfm\.config\./.test(rel);
        const t0 = performance.now();
        try {
          // 配置文件改动：重读配置并重建站点实例（端口等监听参数仍需重启）
          if (isConfig) await this.reloadConfig();
          await this.rebuild();
          this.broadcast({ kind: 'reload', ms: Math.round(performance.now() - t0), file: rel });
          console.log(`  ↻ ${rel || '变更'}  重建 ${(performance.now() - t0).toFixed(0)}ms`);
        } catch (e) {
          console.error('  构建失败：', e.message);
          this.broadcast({ kind: 'error', message: e.message });
        }
      }, 40);
    };

    for (const d of dirs) {
      try {
        this.watchers.push(fs.watch(d, { recursive: true }, (ev, f) => onChange(f ? path.join(d, String(f)) : d)));
      } catch (e) {
        // 某些平台不支持递归 watch，退回单层
        this.watchers.push(fs.watch(d, (ev, f) => onChange(f ? path.join(d, String(f)) : d)));
      }
    }

    // 配置文件变更
    for (const f of ['xfm.config.mjs', 'xfm.config.js', 'xfm.config.cjs', 'xfm.config.json']) {
      const abs = path.join(this.root, f);
      if (!fs.existsSync(abs)) continue;
      fs.watchFile(abs, { interval: 300 }, () => onChange(abs));
      this.watchers.push({ close: () => fs.unwatchFile(abs) });
    }
  }

  async close() {
    for (const w of this.watchers) {
      try { w.close(); } catch (e) { /* 已关闭 */ }
    }
    this.watchers = [];
    for (const res of this.clients) { try { res.end(); } catch (e) {} }
    this.clients.clear();
    if (this.server) await new Promise((r) => this.server.close(r));
  }
}

/**
 * 安全拼接：拒绝跳出 base 目录的路径（目录穿越防护）
 * @returns {string|null} 绝对路径；越界返回 null
 */
function safeJoin(base, rel) {
  const abs = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  const baseAbs = path.resolve(base);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) return null;
  return abs;
}

/** 异步判断普通文件（避免同步 IO 阻塞事件循环） */
async function isFile(p) {
  try {
    return (await fsp.stat(p)).isFile();
  } catch {
    return false;
  }
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

module.exports = { DevServer };
