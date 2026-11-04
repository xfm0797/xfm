#!/usr/bin/env node
'use strict';
/**
 * xfm CLI
 * -------------------------------------------------------------------
 * xfm dev        启动开发服务器（热更新）
 * xfm build      生产构建（并行 worker 渲染）
 * xfm new <path> 新建文章
 * xfm create     交互式/非交互式创建站点脚手架
 * xfm clean      清理缓存与产物
 * xfm info       查看配置与主题信息
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../lib/engine/config');
const { Site } = require('../lib/engine/site');

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};
const tty = process.stdout.isTTY;
const paint = (color, s) => (tty ? color + s + C.reset : s);
const logo = `${paint(C.cyan, '⚡')} ${paint(C.bold, 'xfm')}`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('-')) args[k] = argv[++i];
      else args[k] = true;
    } else if (a.startsWith('-') && a.length > 1) {
      args[a.slice(1)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function human(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

async function dirSize(dir) {
  let total = 0;
  let count = 0;
  async function walk(d) {
    let entries;
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else { const st = await fs.promises.stat(abs); total += st.size; count++; }
    }
  }
  await walk(dir);
  return { total, count };
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

async function cmdBuild(args) {
  const root = path.resolve(args._[0] || process.cwd());
  const t0 = performance.now();
  const config = await loadConfig(root);

  console.log(`\n${logo} ${paint(C.dim, 'build')}  ${paint(C.dim, root)}\n`);

  const site = new Site(config, root, { mode: args.dev ? 'development' : 'production' });
  // dev 模式 init() 内部已加载增量缓存，这里不再重复读一次
  await site.init();
  await site.build();

  const outDir = path.resolve(root, config.outDir);
  const ms = performance.now() - t0;
  const size = await dirSize(outDir);
  console.log(`  ${paint(C.green, '✓')} 页面      ${paint(C.bold, String(site.pages.length))} 个`);
  console.log(`  ${paint(C.green, '✓')} 附加产物  ${site.stats.extraOutputs || 0} 个（sitemap / rss / 等）`);
  console.log(`  ${paint(C.green, '✓')} 静态资源  ${site.stats.assets} 个`);
  console.log(`  ${paint(C.green, '✓')} 输出目录  ${paint(C.dim, path.relative(process.cwd(), outDir) || outDir)}（共 ${human(size.total)}）`);
  if (site.stats.workers) console.log(`  ${paint(C.green, '✓')} 并行渲染  ${site.stats.workers} 个 worker 线程`);
  if (site.stats.cached) console.log(`  ${paint(C.green, '✓')} 缓存命中  ${site.stats.cached} 页（增量构建）`);
  console.log(`\n  ${paint(C.magenta, '耗时')} ${paint(C.bold, ms.toFixed(0) + ' ms')}  ${paint(C.dim, `(${(site.pages.length / (ms / 1000)).toFixed(0)} 页/秒)`)}\n`);
  return site;
}

/* ------------------------------------------------------------------ */
/* dev                                                                 */
/* ------------------------------------------------------------------ */

async function cmdDev(args) {
  const root = path.resolve(args._[0] || process.cwd());
  const { DevServer } = require('../lib/engine/server');
  const port = args.port ? Number(args.port) : undefined;
  const cfg = port ? { port } : {};
  console.log(`\n${logo} ${paint(C.dim, 'dev')}  ${paint(C.dim, root)}\n`);
  const t0 = performance.now();
  const dev = new DevServer(root, cfg);
  await dev.start();
  console.log(`  ${paint(C.green, '✓')} 首次构建 ${(performance.now() - t0).toFixed(0)}ms，${dev.site.pages.length} 个页面`);
  console.log(`  ${paint(C.green, '➜')} 本地访问  ${paint(C.cyan, dev.url)}`);
  console.log(`  ${paint(C.dim, '  监听 content/ themes/ plugins/ 变更，保存即刷新')}\n`);

  const shutdown = async () => {
    console.log(`\n${paint(C.dim, '已停止')}\n`);
    await dev.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return dev;
}

/* ------------------------------------------------------------------ */
/* new                                                                 */
/* ------------------------------------------------------------------ */

async function cmdNew(args) {
  const root = path.resolve(process.cwd());
  const config = await loadConfig(root);
  const title = args._[0] || '未命名文章';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
  const dir = args.dir || 'posts';
  // slug：显式指定优先，否则由标题生成；纯符号标题回落到 post
  const slug =
    String(args.slug || title)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'post';
  const dirPath = path.join(root, config.contentDir, dir);
  let file = path.join(dirPath, `${slug}.md`);
  // 同名不再直接失败：自动追加 -2 / -3，随时新建同题文章；--force 覆盖原文件
  if (!args.force) {
    let n = 2;
    while (fs.existsSync(file)) file = path.join(dirPath, `${slug}-${n++}.md`);
  }
  const renamed = path.basename(file, '.md') !== slug;
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const fm = [
    '---',
    // 标题里可能有 `:` `#` 等 YAML 特殊字符，统一用双引号包裹
    `title: ${JSON.stringify(String(title))}`,
    `date: ${date}`,
    'description: ""',
    `tags: []`,
    'layout: post.html',
    // 默认就是"可发布"状态：之前默认 draft: true，新文章构建后根本看不到，
    // 很容易被误判成命令没生效。要写半成品时显式加 --draft
    args.draft ? 'draft: true' : null,
    '---',
    '',
    `# ${title}`,
    '',
    '开始写作…',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');
  await fs.promises.writeFile(file, fm);
  console.log(`${paint(C.green, '✓')} 已创建 ${paint(C.cyan, path.relative(root, file))}`);
  if (renamed) {
    console.log(`  ${paint(C.dim, `同名文章已存在，自动改名为 ${path.basename(file)}（想覆盖原文件用 --force）。`)}`);
  }
  if (args.draft) {
    console.log(`  ${paint(C.dim, '草稿状态：不会出现在构建产物里。发布时把 front-matter 的 draft 改成 false 或删掉该行。')}`);
  } else {
    console.log(`  ${paint(C.dim, '已是可发布状态：xfm build 即可看到；想先写半成品用 xfm new --draft。')}`);
  }
}

/* ------------------------------------------------------------------ */
/* clean                                                               */
/* ------------------------------------------------------------------ */

async function cmdClean(args) {
  const root = path.resolve(args._[0] || process.cwd());
  const config = await loadConfig(root);
  const targets = [path.join(root, config.outDir), path.join(root, '.xfm')];
  for (const t of targets) {
    await fs.promises.rm(t, { recursive: true, force: true });
    console.log(`${paint(C.green, '✓')} 已删除 ${paint(C.dim, path.relative(root, t))}`);
  }
}

/* ------------------------------------------------------------------ */
/* info                                                                */
/* ------------------------------------------------------------------ */

async function cmdInfo(args) {
  const root = path.resolve(args._[0] || process.cwd());
  const config = await loadConfig(root);
  console.log(`\n${logo} ${paint(C.dim, 'info')}\n`);
  console.log(`  站点      ${config.site.title}`);
  console.log(`  主题      ${config.theme}`);
  console.log(`  内容目录  ${config.contentDir}`);
  console.log(`  输出目录  ${config.outDir}`);
  console.log(`  配置文件  ${config.__source ? path.relative(root, config.__source) : paint(C.dim, '（默认值）')}`);
  console.log(`  插件      ${(config.plugins || []).join(', ') || paint(C.dim, '无')}`);
  console.log(`  Node      ${process.version}  (${require('os').cpus().length} 核)\n`);
}

/* ------------------------------------------------------------------ */
/* create（脚手架）                                                     */
/* ------------------------------------------------------------------ */

async function cmdCreate(args) {
  const { scaffold } = require('../lib/cli/scaffold');
  await scaffold(args);
}

const COMMANDS = { build: cmdBuild, dev: cmdDev, new: cmdNew, clean: cmdClean, info: cmdInfo, create: cmdCreate, help };

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return help();
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    return console.log(require('../package.json').version);
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`未知命令：${cmd}\n`);
    return help(1);
  }
  try {
    await fn(args);
  } catch (e) {
    console.error(`\n${paint(C.red, '✗ 构建失败')}\n${e.stack || e.message}\n`);
    process.exit(1);
  }
}

function help(code = 0) {
  const pkg = require('../package.json');
  console.log(`
${logo} v${pkg.version} ${paint(C.dim, '— 极致性能的静态站点生成器')}

${paint(C.bold, '用法')}
  xfm <命令> [选项]

${paint(C.bold, '命令')}
  dev [目录]           启动开发服务器，文件变更秒级热更新
  build [目录]         生产构建（多线程并行渲染）
  new <标题>           新建文章（--dir=posts --slug=xxx --draft，同名自动编号）
  create [目录]        创建新站点（--template=blog|docs）
  clean [目录]         清理 dist 与增量缓存
  info [目录]          查看站点配置

${paint(C.bold, '选项')}
  --port=4173          dev 端口（默认 4173）
  --dev                build 时启用增量缓存
  --template=docs      create 时使用文档模板
  --draft              new 时生成草稿（默认直接可发布）
  --force              new 时覆盖同名文件，而不是自动编号
  -h, --help           帮助
  -v, --version        显示版本号

${paint(C.bold, '示例')}
  xfm create my-blog --template=blog
  cd my-blog && xfm dev
  xfm build
`);
  process.exit(code);
}

if (require.main === module) main();

module.exports = { parseArgs, cmdBuild };
