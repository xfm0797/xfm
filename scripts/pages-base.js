#!/usr/bin/env node
'use strict';
/**
 * 把构建产物里的根绝对链接统一加上子路径前缀，用于 GitHub Pages 的「项目页」。
 *
 * 用法：node scripts/pages-base.js <distDir> </repo/>
 *
 * 背景：引擎目前把站内 URL 一律生成为 `/posts/x/` 这种根绝对路径，`site.base`
 * 只作用于 sitemap / rss 的绝对地址，不会前缀到 HTML。所以在
 * https://<user>.github.io/<repo>/ 这种子路径下部署时，CSS 与站内链接会 404。
 *
 * 这是**临时补救**：等 `site.base` 真正落到 page.url / 资源 / 导航 / markdown 链接
 * 之后，删掉本脚本与 workflow 里的对应步骤即可（搜索 CHANGELOG 里的 base 待办）。
 *
 * 只处理 href / src 两个属性，且跳过外链、协议相对地址、锚点与已带前缀的值，
 * 因此对同一份产物重复执行是幂等的。
 */

const fs = require('fs');
const path = require('path');

const ATTR = /(\s(?:href|src))="(\/[^"]*)"/g;

function normalizeBase(raw) {
  const b = String(raw || '/').trim();
  // Windows 上的 Git Bash 会把 /xfm/ 这类参数当成本地路径转换成 /D:/... ，直接拒绝而不是写出错误产物
  if (/[:\\]/.test(b)) return null;
  if (!b.startsWith('/')) return '/' + b.replace(/\/+$/, '') + '/';
  return b.replace(/\/+$/, '') + '/';
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.(html?|xml|txt|css|json)$/i.test(entry.name)) out.push(abs);
  }
  return out;
}

function main() {
  const distDir = path.resolve(process.argv[2] || 'dist');
  const base = normalizeBase(process.argv[3]);

  if (!fs.existsSync(distDir)) {
    console.error(`目录不存在：${distDir}`);
    process.exit(1);
  }
  if (base === null) {
    console.error(
      `base 不合法：${process.argv[3]}\n` +
        '应形如 /xfm/；Windows 的 Git Bash 会把以 / 开头的参数转成本地路径，请用 MSYS_NO_PATHCONV=1 或改用 CI 执行'
    );
    process.exit(1);
  }
  // 根站（用户主页）不需要任何处理
  if (base === '/') {
    console.log(`base = /，无需前缀：${distDir}`);
    return;
  }

  let files = 0;
  let links = 0;
  for (const file of walk(distDir)) {
    const src = fs.readFileSync(file, 'utf8');
    const out = src.replace(ATTR, (whole, attr, value) => {
      if (value.startsWith(base)) return whole; // 已带前缀，幂等
      links++;
      return `${attr}="${base}${value.slice(1)}"`;
    });
    if (out !== src) {
      fs.writeFileSync(file, out);
      files++;
    }
  }

  // Actions 产物走 artifacts，本不需要 .nojekyll；留着是为了将来切 gh-pages 分支部署时不踩坑
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '');

  console.log(`已为 ${files} 个文件补前缀 ${base}（改写 ${links} 处链接）`);
}

if (require.main === module) main();

module.exports = { normalizeBase };
