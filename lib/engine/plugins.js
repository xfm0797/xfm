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
 *   });
 *
 * 钩子按注册顺序串行执行；返回非空值即替换原值（Promise 也支持）。
 * 插件可以来自：站点 plugins/ 目录、node_modules、或配置文件内联对象。
 */

const fs = require('fs');
const path = require('path');

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
  finish: { kind: 'event' },
};

class PluginSystem {
  constructor(site) {
    this.site = site;
    this.plugins = [];
  }

  use(plugin, from) {
    let p = plugin;
    if (typeof p === 'function') p = p(this.site);
    if (!p || typeof p !== 'object') return this;
    p.name = p.name || (from ? path.basename(from, '.js') : 'anonymous');
    p.__file = from;
    this.plugins.push(p);
    return this;
  }

  /** 从目录批量加载插件 */
  loadDir(dir) {
    if (!fs.existsSync(dir)) return this;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
    for (const f of files) {
      const abs = path.join(dir, f);
      // dev 模式需重新加载
      delete require.cache[require.resolve(abs)];
      const mod = require(abs);
      this.use(mod, abs);
    }
    return this;
  }

  /** 按模块名/路径加载 */
  load(spec, baseDir) {
    if (typeof spec === 'object') return this.use(spec);
    let abs = spec;
    if (!fs.existsSync(abs)) abs = path.resolve(baseDir || process.cwd(), spec);
    // 回退到内置插件：xfm:<name> 或 lib/plugins/<name>.js
    if (!fs.existsSync(abs)) {
      const name = path.basename(spec).replace(/^xfm:/, '').replace(/\.js$/, '');
      const builtin = path.join(__dirname, '..', 'plugins', name + '.js');
      if (fs.existsSync(builtin)) abs = builtin;
    }
    if (!fs.existsSync(abs)) {
      try { abs = require.resolve(spec, { paths: [baseDir || process.cwd()] }); } catch (e) { /* ignore */ }
    }
    if (!fs.existsSync(abs)) throw new Error(`[xfm] 找不到插件：${spec}`);
    delete require.cache[require.resolve(abs)];
    return this.use(require(abs), abs);
  }

  has(hook) {
    return this.plugins.some((p) => typeof p[hook] === 'function');
  }

  async call(hook, value, ...args) {
    const spec = HOOKS[hook] || { kind: 'transform' };
    const collected = [];

    for (const p of this.plugins) {
      const fn = p[hook];
      if (typeof fn !== 'function') continue;

      if (spec.kind === 'collect') {
        const r = await fn.apply(p, args);
        if (Array.isArray(r)) collected.push(...r);
        else if (r) collected.push(r);
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

module.exports = { PluginSystem };
