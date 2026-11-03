'use strict';
/**
 * 主题加载器
 * -------------------------------------------------------------------
 * 主题目录结构：
 *   theme.config.js   可选，暴露 layout 映射与 hooks
 *   layouts/          页面骨架（可 extend base.html）
 *   partials/         局部片段
 *   assets/           静态资源（打包时复制到站点 assets/）
 *
 * 支持 {% extend "base.html" %} + {% block name %} 覆盖，
 * 编译期拼接，运行期零额外开销。
 */

const fs = require('fs');
const path = require('path');
const { compile } = require('./template');

class Theme {
  constructor(dir, site) {
    this.dir = dir;
    this.site = site;
    this.config = {};
    this.fileCache = new Map(); // absPath -> { mtime, source, blocks }
    this.tplCache = new Map(); // absPath -> render fn
    this.includeIndex = new Map(); // include 名称 -> 绝对路径（避免每页 existsSync）
  }

  static async load(dir, site) {
    const theme = new Theme(dir, site);
    const cfgFile = path.join(dir, 'theme.config.js');
    if (fs.existsSync(cfgFile)) {
      delete require.cache[require.resolve(cfgFile)];
      const mod = require(cfgFile);
      theme.config = typeof mod === 'function' ? mod(site) : mod;
    }
    return theme;
  }

  /** 解析模板路径：layouts/ 与 partials/ 都能被直接引用 */
  resolve(name) {
    const cached = this.includeIndex.get(name);
    if (cached) return cached;
    const candidates = [
      path.join(this.dir, 'layouts', name),
      path.join(this.dir, 'partials', name),
      path.join(this.dir, name),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        this.includeIndex.set(name, c);
        return c;
      }
    }
    throw new Error(`[xfm] 模板不存在：${name}（主题：${this.dir}）`);
  }

  /** 读取并拆分模板：返回 { source, parent, blocks } */
  read(absPath) {
    const st = fs.statSync(absPath);
    const cached = this.fileCache.get(absPath);
    if (cached && cached.mtime === st.mtimeMs) return cached;
    let source = fs.readFileSync(absPath, 'utf8');
    let parent = null;

    const ext = /^\s*{%\s*extend[s]?\s+["'](.+?)["']\s*%}/.exec(source);
    if (ext) parent = ext[1];

    const blocks = new Map();
    const blockRe = /{%\s*block\s+([\w-]+)\s*%}([\s\S]*?){%\s*endblock\s*%}/g;
    let m;
    while ((m = blockRe.exec(source))) blocks.set(m[1], m[2]);

    const entry = { mtime: st.mtimeMs, source, parent, blocks };
    this.fileCache.set(absPath, entry);
    return entry;
  }

  /**
   * 解析继承链，得到最终模板源码
   * 子模板 block 覆盖父模板同名 block，父模板其余内容保留
   */
  flatten(absPath, depth = 0) {
    if (depth > 10) throw new Error('[xfm] 模板继承层级过深');
    const tpl = this.read(absPath);
    if (!tpl.parent) return tpl.source;
    const parentAbs = this.resolve(tpl.parent);
    let parentSrc = this.flatten(parentAbs, depth + 1);
    for (const [name, content] of tpl.blocks) {
      const re = new RegExp(`{%\\s*block\\s+${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*%}([\\s\\S]*?){%\\s*endblock\\s*%}`, 'g');
      if (re.test(parentSrc)) parentSrc = parentSrc.replace(re, content);
      else parentSrc += content; // 父模板没有该 block：追加到末尾
    }
    return parentSrc;
  }

  /** 取渲染函数（带 mtime 缓存） */
  template(name) {
    return this.templateAbs(this.resolve(name));
  }

  /** 按绝对路径取渲染函数（include 直接走这里，避免二次 resolve） */
  templateAbs(abs) {
    const tpl = this.read(abs);
    const cached = this.tplCache.get(abs);
    if (cached && cached.mtime === tpl.mtime) return cached.fn;
    const src = this.flatten(abs);
    const fn = compile(src, abs);
    this.tplCache.set(abs, { mtime: tpl.mtime, fn });
    return fn;
  }

  /** 渲染布局 */
  render(layout, ctx) {
    const fn = this.template(layout);
    // include 递归复用同一个 env：局部片段里再 include 也能正常展开
    const env = {
      globals: { site: this.site },
      include: (name) => this.templateAbs(this.resolve(name))(ctx, env),
    };
    return fn(ctx, env);
  }

  /** 清空缓存（dev 热更新用） */
  invalidate() {
    this.fileCache.clear();
    this.tplCache.clear();
    this.includeIndex.clear();
  }
}

module.exports = { Theme };
