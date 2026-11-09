'use strict';
/**
 * 基准脚本：node bench/bench.js [页数]
 * 生成临时站点 → 冷构建 → 增量构建 → 分阶段耗时
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig } = require('../lib/engine/config');
const { Site } = require('../lib/engine/site');

const N = Number(process.argv[2] || 1000);
const BIN = path.join(__dirname, '..', 'bin', 'xfm.js');
const dir = path.join(os.tmpdir(), `xfm-bench-${N}`);

function genSite() {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'content/posts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'xfm.config.mjs'),
    `export default {
  site: { title: 'bench', base: '/' },
  theme: 'default',
  plugins: ['sitemap', 'rss', 'reading-stats'],
  defaults: { layout: 'post.html' },
  // 基准跟踪的是引擎本身的吞吐：关掉分页，避免 1000 篇额外派生 112 个 /page/N/
  pagination: { enabled: false },
};\n`);
  fs.writeFileSync(path.join(dir, 'content/index.md'), '---\ntitle: 首页\nlayout: index.html\n---\n');

  const para = '这是一段测试文本，包含 **强调** 与 `代码`，用来模拟真实文章段落。The quick brown fox jumps over the lazy dog.';
  const body = Array.from({ length: 12 }, () => para).join('\n\n');
  for (let i = 0; i < N; i++) {
    const tags = [['性能', 'Node.js'], ['前端', 'CSS'], ['架构', '设计']][i % 3];
    const md = `---\ntitle: 压测文章 第 ${i + 1} 篇\ndate: 2026-01-0${(i % 9) + 1} 12:00:00\ntags: [${tags.join(', ')}]\ndescription: 压测模拟文章\n---\n\n# 压测文章 第 ${i + 1} 篇\n\n${body}\n\n## 小节\n\n\`\`\`js\nconst x = ${i}; // comment\nfunction t(){ return "ok" }\n\`\`\`\n`;
    fs.writeFileSync(path.join(dir, 'content/posts/post-' + String(i).padStart(4, '0') + '.md'), md);
  }
}

async function phases() {
  const cfg = await loadConfig(dir);
  const s = new Site(cfg, dir, { mode: 'production' });
  const T = {};
  let t = performance.now();
  const mark = (k) => { const n = performance.now(); T[k] = Math.round(n - t); t = n; };
  await s.init(); mark('init');
  await s.collect(); mark('collect');
  await s.prepare(); mark('hash');
  await s.renderAll(); mark(`render(${s.stats.workers}w)`);
  await s.writeOutput(); mark('write');
  return { T, total: Object.values(T).reduce((a, b) => a + b, 0), pages: s.pages.length };
}

(async () => {
  console.log(`\n⚡ xfm benchmark — ${N} 篇，${os.cpus().length} 核，Node ${process.version}\n`);
  genSite();

  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    execFileSync(process.execPath, [BIN, 'build', dir], { stdio: 'pipe' });
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  const med = runs[2];

  const p = await phases();
  console.log('分阶段（毫秒）:', p.T);
  console.log(`\n端到端最优 ${runs[0].toFixed(0)}ms  中位 ${med.toFixed(0)}ms  ≈ ${(p.pages / (med / 1000)).toFixed(0)} 页/秒\n`);

  fs.rmSync(dir, { recursive: true, force: true });
})();
