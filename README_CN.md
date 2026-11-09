# ⚡ xfm

[![npm version](https://img.shields.io/npm/v/xfmpress?style=flat-square&color=4f46e5&label=npm)](https://www.npmjs.com/package/xfmpress)
[![npm downloads](https://img.shields.io/npm/dm/xfmpress?style=flat-square)](https://www.npmjs.com/package/xfmpress)
[![node](https://img.shields.io/node/v/xfmpress?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/xfmpress?style=flat-square)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)

**A zero-dependency static site generator for Node.js.** 极致性能的静态站点生成器 —— 零运行时依赖、多线程渲染、Nunjucks 风格模板、即插即用的主题与插件。

[English](./README.md) | 简体中文

## 安装与上手

```bash
npm i -g xfmpress    # 全局安装（Node ≥ 18），装完命令是 xfm
xfm create my-blog   # 30 秒创建站点
cd my-blog && xfm dev   # 毫秒级热更新
xfm build            # 生产构建
```

> **包名 `xfmpress`，命令 `xfm`**（`npm i -g xfmpress` → 用 `xfm` 调用）。定位是 **Static Site Generator（静态站点生成器）**：把 Markdown 压成纯静态 HTML。
> 与同系列的 [hexo-theme-xfm](https://github.com/xfm0797/hexo-theme-xfm) 共用 `xfm` 品牌。
> 完整的三种安装方式、权限排错与 FAQ 见 **[INSTALL_CN.md](./INSTALL_CN.md)**。
> 插件**不随内核发布**：站点里 `npm i -D xfm-plugin-rss` 装了就生效，详见 [插件](#插件)。

## 性能

压测环境：4 核 Windows 机器、Node 22、1000 篇中文文档（约 5MB HTML 产出）。运行 `npm run bench` 可复现。

| 指标 | 数值 |
| --- | --- |
| 全量冷构建 | **≈4.4–5.5 s**（≈180–230 页/秒） |
| 增量缓存命中后渲染阶段 | **1 ms**（1001 页） |
| 4 worker 渲染阶段 | **≈0.5 s**（1000 页） |
| dev 热更新单页重建 | **2–7 ms** |
| 产物运行时 | 纯静态 HTML + CSS，**零 JavaScript 依赖** |

分阶段耗时（1000 页）：

| 阶段 | 耗时 | 优化手段 |
| --- | --- | --- |
| 扫描与解析 | ~690 ms | 目录并行遍历 + 源文件并行读取，raw 只读一次 |
| 哈希 | ~15 ms | 复用已读入的源文本，无二次 IO |
| 渲染 | ~510 ms | worker 池复用线程，上下文只传一次 |
| 写盘 | ~3800 ms | 同目录只 mkdir 一次，两阶段并行写 |

在 Windows/NTFS 上写盘是绝对瓶颈：1000 个小文件的落盘成本超过解析与渲染之和，
这一阶段受限于文件系统元数据操作，而非生成器本身。

性能来自四层设计：

1. **线性扫描的 Markdown 引擎**：块级逐行推进 + 一次性行内正则，不构造 AST；内置中英文锚点、表格、任务列表（含续行与嵌套）、引用式链接、脚注、代码高亮、`::: callout` 容器。
2. **模板编译成函数**：Nunjucks 风格语法在构建期编译为 JS 函数，渲染只做字符串拼接，未定义变量安全返回 undefined。
3. **worker 池**：线程与模板编译缓存全程复用，站点上下文只序列化一次；并发度按"每线程最少工作量"标定（实测 2–4 个最优，堆到 8 个反而更慢）。
4. **增量构建**：`源文件哈希 + 主题指纹` 判定，未变页面直接复用缓存 HTML。

> 并发度不是越多越好：worker 的启动与上下文克隆成本约 30–60 ms/个，
> 在小任务量下会吃掉并行收益。`pickConcurrency()` 依据实测数据标定，而非按 CPU 核数堆线程。

## 特性

- **主题**：`{% extend %}` / `{% block %}` 模板继承、`{% include %}` 片段、`{# 注释 #}`、CSS 变量深浅色主题；内置 `default`（博客）与 `docs`（侧栏文档）两套主题。
- **插件**：六个钩子（`extendContext` / `markdown` / `transformHtml` / `afterCollect` / `afterBuild` / `configureServer`）。**内核不带任何插件** —— 像 Hexo 一样从 npm 装（`npm i -D xfm-plugin-rss`），装了就自动生效；9 个官方插件在 [`packages/`](./packages) 里独立发布。
- **内容**：YAML front-matter、草稿、标签/分类/系列聚合、自动 prev/next、按 weight 排序、`.md` 相对链接自动解析。每个标签/分类/系列都会生成独立页面（`/tags/<name>/`、`/categories/<name>/`、`/series/<name>/`），URL 编码的路径会还原成可读的目录名。默认主题还带分类索引页（`/categories/`）与按年归档页（`/archives/`），由 `indexes` 配置项驱动，主题提供对应布局时才会生成。文章页右侧目录会跟随滚动高亮当前小节。列表分页生成真实静态页（`/page/2/`…，`pagination` 配置驱动）。
- **搜索与阅读**：内置 `search` 插件生成 `search.json` 索引，主题带 Ctrl/⌘+K 搜索面板（纯前端筛选、零依赖）；代码块复制、图片点击放大、阅读进度条、外链新窗口均为主题自带的小交互。
- **SEO 与 AI 友好**：`seo` 插件按页注入 canonical / Open Graph / Twitter Card / JSON-LD；`llms` 生成 `llms.txt` 与 `llms-full.txt`（按 llmstxt.org 约定）；`feed-json` 提供 JSON Feed 1.1。
- **相关文章**：`related` 在渲染前按标签/分类/系列加权算好，写进 `page.data.related`，主题直接遍历。
- **子路径部署**：`site.base`（如 `/blog/`）由引擎在渲染出口统一补前缀，模板/Markdown/sitemap/RSS 全部生效，dev 预览同样按前缀访问。
- **开发体验**：`xfm dev` 内存构建 + SSE 热更新（保持滚动位置）、CSS 单独热替换、404 页列出可用路由。
- **易迁移**：模板语法兼容 Nunjucks/Liquid 习惯，配置文件支持 `.mjs/.js/.json`。

## 安装

```bash
npm i -g xfmpress      # 全局安装，然后直接使用 xfm 命令（Node ≥ 18）
# 或免安装试用：npx xfmpress --help
```

> 包名是 `xfmpress`，命令是 `xfm`，装一次即可全局使用。
> 完整的安装、权限排错与三种安装方式见 **[INSTALL_CN.md](./INSTALL_CN.md)**。

## 命令

| 命令 | 说明 |
| --- | --- |
| `xfm create [目录]` | 创建站点（`--template=blog\|docs`，`--title=`），别名 `xfm init` |
| `xfm dev [目录]` | 开发服务器（`--port=`），别名 `serve` / `server` / `preview` |
| `xfm build [目录]` | 生产构建（`--dev` 启用增量缓存），别名 `generate` / `gen` |
| `xfm new "标题"` | 新建文章（`--dir=posts --slug=xxx --draft --force`，同名自动追加编号） |
| `xfm clean` / `xfm info` | 清理产物 / 查看配置 |

## 配置示例（xfm.config.mjs）

```js
export default {
  site: {
    title: 'XFM Notes',
    description: '关于静态站点与前端的笔记',
    lang: 'zh-CN',
    base: '/',                       // 子路径部署示例：'/blog/'，所有站内链接自动加前缀
    url: 'https://example.com',      // 供 sitemap/RSS 使用
    nav: [{ title: '文章', url: '/' }],
  },
  theme: 'default',                  // 主题名或路径
  plugins: ['sitemap', 'rss'],       // 可选 —— 装好的 xfm-plugin-* 依赖本来就会自动加载
                                     // （短名 → xfm-plugin-<name>；'./plugins/x.js' → 站点内本地插件）
  seo: { image: '/og.png', twitter: '@handle' }, // xfm-plugin-seo 用
  related: { limit: 3, minScore: 2 },   // xfm-plugin-related 用：数量与最低相关度
  minify: { aggressive: false },        // xfm-plugin-minify 用：aggressive 会折叠标签间换行
  search: { path: 'search.json' },      // xfm-plugin-search 用
  defaults: { layout: 'post.html' },
  pagination: { perPage: 9 },        // 列表分页：/page/2/、/page/3/…
  indexes: {                         // 分类索引页 / 归档页
    categories: { enabled: true, url: '/categories/' },
    archives: { enabled: true, url: '/archives/' },
  },                                 // 主题提供对应布局时才会生成
  workers: 0,                        // worker 并发数；0=自动按任务量标定
  server: { port: 4173 },
};
```

## 写作（content/ 目录）

```markdown
---
title: 文章标题
date: 2026-10-28 09:00:00
tags: [Node.js, 性能]
description: 摘要（列表页与 RSS 使用）
draft: false
---

正文支持 GFM 全部常用语法，另加：

::: tip 提示容器
带标题的高亮提示框。
:::

\`\`\`js
const ok = true; // 内置语法高亮
\`\`\`

代码围栏语言标记（含别名归一，大小写不敏感）：`js / javascript / jsx / ts / tsx / java / c / cpp / csharp / go / golang / rust / rs / swift / kotlin / scala / php / python / py / bash / sh / shell / json / yaml / yml / html / xml / svg / vue / css / scss / markdown / md / text`。未知语言降级为纯转义文本，不会报错。

围栏首行可附加标题：\`\`\`js app.js（元信息如 `{1,3-5}` 会被忽略）。
```

在 GFM 之外，引擎还支持：

- **引用式链接** —— `[文字][id]`、简写 `[id]`，地址只需在文末写一次 `[id]: https://example.com "标题"`（定义行不会出现在正文里）。
- **脚注** —— `正文[^1]` 配合 `[^1]: 注释`，按首次引用顺序编号，每处引用都有独立回链。
- **Setext 标题** —— 段落下一行写 `====`（一级）或 `----`（二级）。
- **缩进代码块** —— 行首四个空格或一个 tab（列表之外）。
- **转义** —— `\*不是斜体\*`、`` \`不是代码\` ``。
- **松散列表** —— 缩进续行与无缩进惰性续行都会并入同一项；有序列表保留起始编号（`3.` 起就是 `start="3"`）。

`group: 使用指南` + `weight: 1` 字段可在 docs 主题生成侧栏导航。

## 钩子语义

| 钩子 | 参数 | 返回值处理 |
| --- | --- | --- |
| `extendContext(ctx)` | 站点上下文 | 替换上下文（返回值写入 `site.*`） |
| `markdown(src, page)` | 当前源码 | 替换源码 |
| `transformHtml(html, ctx)` | 当前 HTML | 替换 HTML |
| `afterBuild(site)` | 站点实例（`site.documents[].html` 为**正文** HTML，不含布局） | 返回的 `[{path, contents}]` 被汇总写出 |
| `afterCollect(site)` | 全部页面已收集（含聚合页、分页页） | 忽略；可往 `page.data` 写跨页数据（如相关文章） |
| `configureServer(server)` / `finish(site)` | 站点/服务器 | 忽略 |

## 插件

**内核不带任何插件。** `npm i -g xfmpress` 只装生成器和两套主题，其余都按需安装 —— 和 Hexo 的做法一致：

```bash
npm i -D xfm-plugin-sitemap xfm-plugin-rss xfm-plugin-search
```

站点 `package.json` 里任何 `xfm-plugin-*` 依赖都会被自动加载，不需要改配置。插件在启动时解析，装完要重启 `xfm dev`。

想固定加载顺序，或者混入站点内的本地插件，也可以显式声明：

```js
// xfm.config.mjs
export default {
  plugins: ['sitemap', 'rss', './plugins/my-plugin.js'],
};
```

短名解析成 `xfm-plugin-<name>`，路径指向站点里的文件。写了却没装会直接报错，并给出对应的 `npm i` 命令。

### 官方插件

| 包名 | 产物 | 主要配置 |
| --- | --- | --- |
| [`xfm-plugin-sitemap`](./packages/sitemap) | `sitemap.xml`、`robots.txt` | —（配了 `site.url` 才输出绝对 `<loc>`） |
| [`xfm-plugin-rss`](./packages/rss) | `feed.xml`（RSS 2.0，正文全文） | `site.rss.limit` |
| [`xfm-plugin-feed-json`](./packages/feed-json) | `feed.json`（JSON Feed 1.1） | `feedJson.path`、`feedJson.limit` |
| [`xfm-plugin-search`](./packages/search) | `search.json` + Ctrl/⌘+K 面板 | `search.path`、`search.maxChars`、`search.hint` |
| [`xfm-plugin-seo`](./packages/seo) | canonical、Open Graph、Twitter Card、JSON-LD | `seo.image`、`seo.twitter`、`seo.jsonLd` |
| [`xfm-plugin-related`](./packages/related) | 相关文章 → `page.data.related` | `related.limit`、`related.minScore` |
| [`xfm-plugin-llms`](./packages/llms) | `llms.txt`、`llms-full.txt` | `llms.full`、`llms.maxItems` |
| [`xfm-plugin-minify`](./packages/minify) | 更小的 HTML（仅生产构建） | `minify.enabled`、`minify.aggressive` |
| [`xfm-plugin-reading-stats`](./packages/reading-stats) | `stats.json`、`site.stats` | — |

每个包都有自己的 README，写了安装方式、可选项与产物。

`related` 在渲染前按标签（3 分）/ 分类（2 分）/ 系列（3 分）加权算好写进 `page.data.related`，因此不会让渲染退回单线程；两套主题只要发现这个键就渲染推荐区块。`seo` 不会重复注入模板里已经手写的 canonical / `og:*`。`minify` 跳过 `<pre>`、`<code>`、`<textarea>`、`<script>`、`<style>`，dev 模式完全不执行。

### 页面级开关（front-matter）

| front-matter | 作用 |
| --- | --- |
| `sitemap: false` | 不进 `sitemap.xml` |
| `rss: false` | 不进 `feed.xml` 与 `feed.json` |
| `search: false` | 不进搜索索引 |
| `llms: false` | 不进 `llms.txt` |
| `related: false` / `related: [url, ...]` | 关闭推荐 / 手动指定推荐列表 |
| `seo: false`、`noindex: true`、`image`、`canonical` | SEO 插件行为 |

主题只判断 `site.search` 与 `page.data.related` 是否存在，卸掉这两个插件只会少一块功能，不会让构建失败。

## 编写插件

插件就是导出 `(site) => ({ name, ...hooks })` 的模块。按 `xfm-plugin-<name>` 发布到 npm 即可被自动加载，也可以直接放进站点的 `plugins/` 目录。`site.helpers` 提供官方插件用的 URL 与文本工具，插件不必去 require 内核内部文件：

```js
// plugins/reading-index.js —— 放进 plugins/ 目录即生效
module.exports = (site) => {
  const { plainText, absoluteUrl } = site.helpers;
  return {
    name: 'reading-index',
    afterBuild(site) {
      const index = site.documents.map((d) => ({
        title: d.title,
        url: absoluteUrl(site.config.site, d.url),
        text: plainText(d.html).slice(0, 800),
      }));
      return [{ path: 'index.json', contents: JSON.stringify(index) }];
    },
  };
};
```

## 主题结构

```
themes/my-theme/
├── layouts/        # base.html（骨架）、index/post/page.html（继承 base）
├── partials/       # 可复用片段（toc、卡片等）
└── assets/         # style.css 等，构建时复制到站点 /assets/
```

模板上下文：`site.*`（站点配置与聚合数据）、`page.*`（当前页元数据）、`content`（正文 HTML）、`headings`（目录）。可选布局 `taxonomy.html`、`categories.html`、`archives.html` 让主题获得标签聚合页、分类索引页与归档页——缺哪个布局就少生成哪类页面，不会报错。

## 目录

```
xfm/
├── bin/xfm.js         # CLI（build/dev/new/create/clean/info）
├── lib/engine/         # markdown / template / render / frontmatter / theme / plugins / site / worker / server / config
├── lib/cli/scaffold.js # create 脚手架
├── packages/           # 官方插件，各自以 xfm-plugin-* 独立发布
├── themes/default/     # 博客主题（深浅色）
├── themes/docs/        # 文档主题（侧栏导航）
├── examples/blog/      # 可构建的示例站点
├── bench/bench.js      # 基准测试（分阶段耗时）
└── test/run.js         # 111 项测试（零依赖）
```

## 部署

`xfm build` 产出纯静态文件到 `dist/`，Nginx、对象存储、Vercel、Netlify、GitHub Pages 都能直接托管，不需要运行时。

本仓库自带 GitHub Pages 流水线：`.github/workflows/pages.yml` 会在推送到 `main` 且改动涉及示例站、引擎或主题时，跑测试 → 构建 `examples/blog` → 部署产物。首次使用只需在 **Settings → Pages → Build and deployment → Source** 里选一次 **GitHub Actions**。

> **项目页需要子路径前缀。** 站内 URL 目前生成为根绝对路径（`/posts/x/`），`site.base` 还没有作用到 URL 生成，所以从 `https://<user>.github.io/<repo>/` 访问时 CSS 和站内链接会 404。workflow 用 `scripts/pages-base.js` 在构建后补前缀；等 `site.base` 真正接入 URL 生成后，删掉这一步、直接在配置里写 `base` 即可。

## 本地开发

```bash
npm test               # 111 项测试
npm run bench          # 1000 页基准（分阶段耗时）
npm run build:example  # 构建示例站点
npm run dev            # 开发示例站点
```

MIT License
