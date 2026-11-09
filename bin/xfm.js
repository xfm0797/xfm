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
const { discover } = require('../lib/engine/plugins');

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
  // 插件是外部包，装没装、生效没生效要看得见
  const loaded = site.plugins.names();
  console.log(`  ${paint(C.green, '✓')} 插件      ${loaded.length ? loaded.join(', ') : paint(C.dim, '无（npm i -D xfm-plugin-xxx 按需安装）')}`);
  const extras = (site.extraFiles || []).map((f) => f.path);
  const extraLabel = !extras.length
    ? paint(C.dim, '无（插件产出，装了插件才有）')
    : extras.length <= 6
      ? extras.join(', ')
      : `${extras.length} 个（${extras.slice(0, 4).join(', ')} …）`;
  console.log(`  ${paint(C.green, '✓')} 附加产物  ${extraLabel}`);
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
  const loaded = dev.site.plugins.names();
  console.log(`  ${paint(C.green, '✓')} 插件      ${loaded.length ? loaded.join(', ') : paint(C.dim, '无（npm i -D xfm-plugin-xxx 按需安装）')}`);
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
  // 插件：配置里显式声明的 + package.json 里自动发现的，都列出来（去重保序）
  const declared = (config.plugins || []).filter((p) => typeof p === 'string');
  const auto = discover(root).map((n) => n.replace(/^(@[^/]+\/)?xfm-plugin-/, ''));
  const plugins = [...new Set([...declared, ...auto])];
  console.log(
    `  插件      ${
      plugins.length
        ? plugins.map((n) => (declared.includes(n) ? n : `${n}${paint(C.dim, '（自动）')}`)).join(', ')
        : paint(C.dim, '无（npm i -D xfm-plugin-xxx 按需安装）')
    }`
  );
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

// 别名：来自 Hexo 的使用习惯（hexo init / hexo generate / hexo server），
// 让 npx xfm init 这类最自然的手势直接生效，而不是丢一份帮助就退出。
const ALIASES = {
  init: 'create',
  generate: 'build',
  gen: 'build',
  serve: 'dev',
  server: 'dev',
  preview: 'dev',
};

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 未知命令时给一个最可能的候选：前缀命中优先，其次编辑距离足够近 */
function suggestCommand(name) {
  const pool = [...Object.keys(COMMANDS).filter((k) => k !== 'help'), ...Object.keys(ALIASES)];
  const lower = name.toLowerCase();
  const prefix = pool.filter((k) => k.startsWith(lower) && k !== lower).sort((a, b) => a.length - b.length)[0];
  if (prefix) return prefix;
  let best = null;
  let bestD = Infinity;
  for (const k of pool) {
    const d = editDistance(lower, k);
    if (d < bestD) { best = k; bestD = d; }
  }
  return bestD <= 2 ? best : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return help();
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    return console.log(require('../package.json').version);
  }

  // 未知选项（xfm --port=4173 这类把选项当命令写）
  if (cmd.startsWith('-')) {
    console.error(`\n${paint(C.red, '✗')} 未知选项：${paint(C.bold, cmd)}`);
    console.error(paint(C.dim, '  用 xfm <命令> [选项]，例如 xfm dev --port=4173；查看 xfm --help\n'));
    process.exit(1);
  }

  // 别名解析：init → create，generate → build，serve/preview → dev
  // 用 own property 判定：否则 xfm constructor / toString 会命中原型链上的函数
  const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
  const resolved = own(COMMANDS, cmd) ? cmd : own(ALIASES, cmd) ? ALIASES[cmd] : null;
  const fn = resolved ? COMMANDS[resolved] : null;
  if (!fn) {
    console.error(`\n${paint(C.red, '✗')} 未知命令：${paint(C.bold, cmd)}`);
    const guess = suggestCommand(cmd);
    if (guess) console.error(`  你是不是想用 ${paint(C.cyan, 'xfm ' + guess)}？`);
    console.error(paint(C.dim, '  运行 xfm --help 查看全部命令\n'));
    process.exit(1);
  }
  try {
    await fn(args);
  } catch (e) {
    const msg = String((e && e.message) || e);
    // 引擎主动抛出的 [xfm] 错误已经写明怎么修，不必再糊一屏调用栈
    const detail = msg.startsWith('[xfm]') ? msg : e.stack || msg;
    console.error(`\n${paint(C.red, '✗ 出错了')}\n${detail}\n`);
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

${paint(C.bold, '别名')}
  init = create        generate / gen = build        serve / server / preview = dev

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
  xfm init my-blog            # 同 create，Hexo 习惯
  cd my-blog && xfm dev
  xfm build
`);
  process.exit(code);
}

if (require.main === module) main();

module.exports = { parseArgs, cmdBuild };
