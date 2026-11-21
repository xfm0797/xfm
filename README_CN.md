# ⚡ xfm

[![npm version](https://img.shields.io/npm/v/xfmpress?style=flat-square&color=4f46e5&label=npm)](https://www.npmjs.com/package/xfmpress)
[![npm downloads](https://img.shields.io/npm/dm/xfmpress?style=flat-square)](https://www.npmjs.com/package/xfmpress)
[![node](https://img.shields.io/node/v/xfmpress?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/xfmpress?style=flat-square)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-doc.lovou.pw-4f46e5?style=flat-square)](https://doc.lovou.pw/docs/xfmpress/)

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

## 官方文档

完整手册在 **[doc.lovou.pw/docs/xfmpress](https://doc.lovou.pw/docs/xfmpress/)**，是所有配置字段、钩子与命令行参数的权威说明。本 README 只是快速纵览，两者不一致时以手册为准。

| 章节 | 内容 | 什么时候看 |
| --- | --- | --- |
| [安装与升级](https://doc.lovou.pw/docs/xfmpress/install/) | 三种安装方式、权限排错、升级 | 第一次用 |
| [命令行](https://doc.lovou.pw/docs/xfmpress/cli/) | `create` / `dev` / `build` / `new` / `clean` / `info` 全部选项 | 日常操作 |
| [配置](https://doc.lovou.pw/docs/xfmpress/config/) | 配置文件查找顺序与所有字段的默认值 | 调整站点行为 |
| [内容与 Markdown](https://doc.lovou.pw/docs/xfmpress/content/) | front-matter、目录约定、URL 规则、扩展语法 | 写内容 |
| [模板语法](https://doc.lovou.pw/docs/xfmpress/templates/) | 变量、过滤器、控制结构、继承、模板上下文 | 改布局 |
| [主题开发](https://doc.lovou.pw/docs/xfmpress/theme/) | 目录结构、布局与片段的职责、资源打包 | 做主题 |
| [插件](https://doc.lovou.pw/docs/xfmpress/plugins/) | 钩子语义、自动加载、官方插件清单、自己写插件 | 扩能力 |
| [构建与部署](https://doc.lovou.pw/docs/xfmpress/deploy/) | 增量缓存、子路径、GitHub Pages / Netlify / Nginx | 上线 |
| [架构与性能](https://doc.lovou.pw/docs/xfmpress/architecture/) | 渲染管线、worker 池、缓存指纹、bench 读法 | 想搞懂原理 |
| [版本记录](https://doc.lovou.pw/docs/xfmpress/changelog/) | v0.1.0 以来的版本主线 | 评估升级 |

## 性能

压测环境：4 核 Windows 机器、Node 22、1000 篇中文文档（约 5MB HTML 产出）。运行 `npm run bench` 可复现。

| 指标 | 数值 |
| --- | --- |
| 全量冷构建（dist 为空） | **≈5–6.5 s**（≈160–200 页/秒） |
| 重复构建（产物基本没变） | **≈2.8–2.9 s**（≈340 页/秒） |
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
| 写盘（冷构建） | ~2600 ms | 只给真要写的文件建目录，两阶段并行落盘 |
| 写盘（重复构建） | ~900 ms | 内容一致就不重写、不建目录；没有旧文件就不扫目录 |

在 Windows/NTFS 上写盘仍是最大的一块：1000 个目录的 `mkdir` 约 1.1 s、1000 个页面的
落盘约 1.5 s，这部分受限于文件系统元数据操作，而非生成器本身。所以重复构建会先比内容：
一样的文件既不重写也不建目录（`stat` + 读回来比一次约 0.8 s，不到重写的三分之一）。
旧产物清理同样只在真有文件被删时才去 `rmdir`——以前无脑对 1000 个目录各试一次，
光这一项就要 3 s，而且整个 dist 里根本不可能有空目录。

性能来自四层设计：

1. **线性扫描的 Markdown 引擎**：块级逐行推进 + 一次性行内正则，不构造 AST；内置中英文锚点、表格、任务列表（含续行与嵌套）、引用式链接、脚注、代码高亮、`::: callout` 容器。
2. **模板编译成函数**：Nunjucks 风格语法在构建期编译为 JS 函数，渲染只做字符串拼接，未定义变量安全返回 undefined。
3. **worker 池**：线程与模板编译缓存全程复用，站点上下文只序列化一次；并发度按"每线程最少工作量"标定（实测 2–4 个最优，堆到 8 个反而更慢）。
4. **增量构建**：`源文件哈希 + 主题指纹` 判定，未变页面直接复用缓存 HTML。

> 并发度不是越多越好：worker 的启动与上下文克隆成本约 30–60 ms/个，
> 在小任务量下会吃掉并行收益。`pickConcurrency()` 依据实测数据标定，而非按 CPU 核数堆线程。

## 特性

- **主题**：`{% extend %}` / `{% block %}` 模板继承、`{% include %}` 片段、`{# 注释 #}`、CSS 变量深浅色主题；内置 `default`（博客）与 `docs`（侧栏文档）两套主题。
- **插件**：六个钩子（`extendContext` / `markdown` / `transformHtml` / `afterCollect` / `afterBuild` / `configureServer`）。**内核不带任何插件** —— 像 Hexo 一样从 npm 装（`npm i -D xfm-plugin-rss`），装了就自动生效；17 个官方插件在 [`packages/`](./packages) 里独立发布。
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
| `xfm build [目录]` | 生产构建；`--incremental` 启用缓存，`--drafts` / `--no-drafts` 覆盖草稿配置；`--scheduled` / `--no-scheduled` 纳入或排除 `date` 在未来的文章；`--dev` 是 `--incremental` 的兼容别名。别名 `generate` / `gen` |
| `xfm new [布局] "标题"` | 新建内容：`post` 文章（默认）/ `page` 页面 / `draft` 草稿；`--dir= --slug= --layout= --draft --force`，同名自动追加编号 |
| `xfm clean` / `xfm info` | 清理产物 / 查看配置 |

每个参数、退出码与别名见 [命令行](https://doc.lovou.pw/docs/xfmpress/cli/)。

## 配置示例（xfm.config.mjs）

> 完整字段、默认值与配置文件查找顺序见 **[配置](https://doc.lovou.pw/docs/xfmpress/config/)**。

```js
export default {
  site: {
    title: 'XFM Notes',
    description: '关于静态站点与前端的笔记',
    lang: 'zh-CN',
    base: '/',                       // 子路径部署示例：'/blog/'，所有站内链接自动加前缀
    url: 'https://example.com',      // 供 sitemap/RSS 使用
    nav: [{ title: '文章', url: '/' }],
    // languages: ['zh-CN', 'en'],   // 开启多语言：注入 hreflang + 语言切换；单语不产生任何额外输出
  },
  theme: 'default',                  // 主题名或路径
  plugins: ['sitemap', 'rss'],       // 可选 —— 装好的 xfm-plugin-* 依赖本来就会自动加载
                                     // （短名 → xfm-plugin-<name>；'./plugins/x.js' → 站点内本地插件）
  seo: { image: '/og.png', twitter: '@handle' }, // xfm-plugin-seo 用
  related: { limit: 3, minScore: 2 },   // xfm-plugin-related 用：数量与最低相关度
  minify: { aggressive: false },        // xfm-plugin-minify 用：aggressive 会折叠标签间换行
  search: { path: 'search.json' },      // xfm-plugin-search 用
  defaults: { layout: 'post.html' },
  pagination: { perPage: 9 },        // 首页 + 标签/分类/系列页都分页：/page/2/…；加 taxonomy:false 则只给首页分页
  dataDir: 'data',                   // data/ 下的 *.json / *.yaml / *.js → site.data；嵌套目录 → 嵌套对象
  // collections: { projects: { dir: 'projects', perPage: 9 } },  // 自定义集合 → 生成 /projects/ 列表 + 详情 + 分页
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

新建文件用 `xfm new`，布局规则和 Hexo 一致：

```bash
xfm new "你好世界"             # content/posts/你好世界.md      → /posts/你好世界/
xfm new page about            # content/about.md               → /about/
xfm new draft "写一半的想法"    # content/posts/写一半的想法.md   带 draft: true
xfm new page intro --dir=docs # content/docs/intro.md          → /docs/intro/
```

`page` 会写 `layout: page.html` 与 `type: page`：页面有自己的 URL、可以挂进 `site.nav`，但不会混进文章列表、RSS、相关推荐和搜索索引。`draft` 会写 `draft: true`，生产构建直接跳过，删掉那行就发布。只给一个参数时它一定是标题——`xfm new page` 建的是**文章**，标题叫 “page”；`xfm new 我的 文章` 也不会被截断。

**定时发布** —— 把文章的 `date`（或 `published`）设为未来时间，生产构建会暂缓发布（不进页面、RSS、sitemap 与文章列表计数），到点自动发布；`dev` 模式下依然可见，方便预览。加 `--scheduled` 或在 `xfm.config.mjs` 里设 `buildScheduled: true` 可强制发布。有文章被暂缓时，构建会输出 `调度中  N 篇`。

初始内容取自站点的 `scaffolds/<布局>.md`，改一次之后所有 `xfm new` 都按它来，占位符是 `{{ title }}`、`{{ date }}`、`{{ layout }}`。漏写的 front-matter 字段（标题、布局、`type: page`、`draft`）会自动补齐，所以哪怕脚手架里完全不写 front-matter，生成出来的页面也是能正常构建的。

在 GFM 之外，引擎还支持：

- **引用式链接** —— `[文字][id]`、简写 `[id]`，地址只需在文末写一次 `[id]: https://example.com "标题"`（定义行不会出现在正文里）。
- **脚注** —— `正文[^1]` 配合 `[^1]: 注释`，按首次引用顺序编号，每处引用都有独立回链。
- **Setext 标题** —— 段落下一行写 `====`（一级）或 `----`（二级）。
- **缩进代码块** —— 行首四个空格或一个 tab。列表项里同样可用：空行后缩进到条目内容位置再多四格，或直接写成 `-     code`（标记后 5 个空格，多出的空格算内容缩进）。
- **转义** —— `\*不是斜体\*`、`` \`不是代码\` ``。
- **松散列表** —— 项与项之间、或项内含空行时分隔照旧合并成一个列表，并按松散列表渲染（段落补 `<p>`）；空行后缩进到内容位置的段落、子列表、代码块仍属本项。缩进续行与无缩进惰性续行并入同一项；有序列表保留起始编号（`3.` 起就是 `start="3"`）。

`group: 使用指南` + `weight: 1` 字段可在 docs 主题生成侧栏导航。

### Page Bundle：内容目录下的附件

`content/` 下不是页面的文件（除 `.md` / `.markdown` / `.html` / `.htm` 之外的图片、PDF、zip 等）会原样复制到输出，路径保持相对 `content/` 不变。把附件和使用它的页面放在一起，用相对链接引用：

```text
content/posts/hello/
  index.md      → /posts/hello/
  cover.png     → /posts/hello/cover.png
```

在 `index.md` 里写 `![cover](./cover.png)`。相对 URL 会解析到页面自身 URL 之下，所以同一份源码换任何 `site.base` 都能用。散落在 `content/` 其他位置的文件（如 `content/files/doc.pdf`）也会按原路径复制（`/files/doc.pdf`）。

- 这些附件和页面、`public/` 文件一样，参与产物冲突检测与旧产物清理。
- 改动同目录附件会使该目录（以及叶子同名子目录）下页面的缓存失效，增量构建会重渲染。
- `dev` 模式下直接从源文件服务，不落盘。
- `xfm-plugin-image-size` 与 `xfm-plugin-deadlinks` 已兼容：能从 `./cover.png` 读尺寸，相对链接不会被误报死链。

以 `.` 开头的隐藏文件会被忽略。

## 数据文件、集合与多语言

### 全局数据文件（`data/`）

在 `data/` 目录（可通过 `dataDir` 配置）下放 `.json`、`.yaml`/`.yml`、`.js`/`.mjs` 文件，模板与插件里都能通过 `site.data` 读取。嵌套目录会变成嵌套对象——`data/team/members.yml` 即 `site.data.team.members`；以 `.` 开头的隐藏文件会被忽略。`.js`/`.mjs` 取默认导出：

```js
// data/meta.js
export default { version: 3, live: true };   // CJS 写 module.exports = {...} 也可以
```
```html
<p>v{{ site.data.meta.version }}</p>
```

改动任意数据文件会使所有页面的缓存失效，因为任何模板都可能引用 `site.data`。值在交给模板前会经过 JSON 克隆，函数与循环引用会被丢弃（保证 worker 载荷可结构化克隆）。

### 自动摘要（`page.desc`）

页面没有 `description` 时，xfm 会把渲染后的正文截断到约 140 字作为 `excerpt`。模板拿到的 `page.desc` = `description || excerpt`——列表卡片和 meta 标签直接用它即可，不必到处写 `||` 兜底。default 与 docs 主题已在文章列表渲染 `post.desc`，并在 `<meta name="description">` 里兜底。

### 自定义集合

把 `content/` 某个子目录下的文件归为一个独立栏目，有自己的列表页、分页与布局：

```js
collections: {
  projects: {
    dir: 'projects',            // content/ 下的子目录（默认等于集合名）
    url: '/projects/',          // 列表页 URL（默认 /<name>/）
    layout: 'collection.html',  // 列表布局；两个主题都自带 collection.html
    perPage: 9,                 // 0 = 不分页；默认继承站点 pagination.perPage
    title: '作品集',
    description: '我做的东西',
    posts: false,               // true = 条目同时进入默认文章流 site.posts
  },
}
```

`content/projects/*.md` 是正常的详情页（有自己的 URL，布局取 front-matter/defaults），xfm 另外生成 `/projects/` 以及 `/projects/page/2/…`，按日期倒序列出。集合条目默认不进文章流、RSS、上下篇和首页，除非设 `posts: true`。模板在列表页遍历 `page.data.posts`，或在任意页面读 `site.collections.projects`（含 `.count`、`.items`、`.url`）。

### 多语言（i18n）

在 `site.languages` 里声明要启用的语言：

```js
site: { lang: 'zh-CN', languages: ['zh-CN', 'en'] }
```

- 页面语言取 front-matter 的 `lang`，缺省回退 `site.lang`；`<html lang>` 跟随当前页。
- front-matter 里 `translationKey` 相同的页面互为翻译，会拿到 `page.translations`——`[{ lang, url, title }]`。
- 装了 `xfm-plugin-seo` 时，每个页面会为每个翻译版本注入 `<link rel="alternate" hreflang="…">` 及 `x-default`，并补上 `og:locale:alternate`。**单语站完全不输出这些**，现有产物保持不变。
- default 与 docs 主题在导航里包含了 `lang-switcher.html` 片段（页面没有翻译时自动隐藏）。
- 导航本地化：给某个 nav 条目加 `translations` 映射——`{ title: '关于', url: '/about/', translations: { en: { title: 'About', url: '/about-en/' } } }`——引擎会按当前页语言选用对应条目。
- 所有模板都能访问 `site.languages` 与 `site.defaultLang`。

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

插件手册（钩子语义、加载顺序、每个选项、编写方法）见 **[插件章节](https://doc.lovou.pw/docs/xfmpress/plugins/)**。

**站点产物** —— 给爬虫和客户端读的文件：

| 包名 | 产物 | 主要配置 |
| --- | --- | --- |
| [`xfm-plugin-sitemap`](./packages/sitemap) | `sitemap.xml`、`robots.txt` | —（配了 `site.url` 才输出绝对 `<loc>`） |
| [`xfm-plugin-rss`](./packages/rss) | `feed.xml`（RSS 2.0，正文全文） | `site.rss.limit` |
| [`xfm-plugin-feed-json`](./packages/feed-json) | `feed.json`（JSON Feed 1.1） | `feedJson.path`、`feedJson.limit` |
| [`xfm-plugin-llms`](./packages/llms) | `llms.txt`、`llms-full.txt` | `llms.full`、`llms.maxItems` |
| [`xfm-plugin-search`](./packages/search) | `search.json` + Ctrl/⌘+K 面板 | `search.path`、`search.maxChars`、`search.hint` |
| [`xfm-plugin-pwa`](./packages/pwa) | `manifest.webmanifest`、`sw.js`、`offline.html`、`icon.svg` | `pwa.themeColor`、`pwa.icons`、`pwa.offline` |
| [`xfm-plugin-redirect`](./packages/redirect) | 每个旧地址一个跳转页 | `redirects`、front-matter `redirect_from` |
| [`xfm-plugin-reading-stats`](./packages/reading-stats) | `stats.json`、`site.stats` | — |

**页面增强** —— 往已生成的页面里补东西：

| 包名 | 作用 | 主要配置 |
| --- | --- | --- |
| [`xfm-plugin-seo`](./packages/seo) | canonical、Open Graph、Twitter Card、JSON-LD | `seo.image`、`seo.twitter`、`seo.jsonLd` |
| [`xfm-plugin-related`](./packages/related) | 相关文章 → `page.data.related` | `related.limit`、`related.minScore` |
| [`xfm-plugin-math`](./packages/math) | 构建期用 KaTeX 渲染公式，前端零 JS | `math.css`、`math.path`、`math.macros`、`math.fonts` |
| [`xfm-plugin-mermaid`](./packages/mermaid) | mermaid 围栏代码块 → 浏览器里渲染成 SVG 图 | `mermaid.mode`、`mermaid.theme`、`mermaid.securityLevel` |
| [`xfm-plugin-minify`](./packages/minify) | 更小的 HTML（仅生产构建） | `minify.enabled`、`minify.aggressive` |
| [`xfm-plugin-image-size`](./packages/image-size) | 读文件头给 `&lt;img&gt;` 补 `width`/`height` | `imageSize.publicDir`、`imageSize.lazy` |
| [`xfm-plugin-deadlinks`](./packages/deadlinks) | 列出指向空处的站内链接 | `deadlinks.strict`、`deadlinks.ignore` |
| [`xfm-plugin-comments`](./packages/comments) | 十家评论系统：giscus / beaudar / utterances / Disqus / Waline / Twikoo / Valine / Gitalk / Artalk / Cusdis | `comments.provider`、`comments.repo`、`comments.serverURL` … |
| [`xfm-plugin-analytics`](./packages/analytics) | Umami / Plausible / GA / 百度 / 自定义 | `analytics.provider` … |

每个包都有自己的 README，写了安装方式、可选项与产物。

`related` 在渲染前按标签（3 分）/ 分类（2 分）/ 系列（3 分）加权算好写进 `page.data.related`，因此不会让渲染退回单线程；两套主题只要发现这个键就渲染推荐区块。`seo` 不会重复注入模板里已经手写的 canonical / `og:*`。`minify` 跳过 `<pre>`、`<code>`、`<textarea>`、`<script>`、`<style>`，dev 模式完全不执行。

`image-size` 只读本地图片的头部字节（PNG / JPEG / GIF / WebP / SVG），让浏览器提前留出位置，图片加载完页面不会往下蹦一下；`deadlinks` 在构建结束后拿所有站内链接去对真实产物，列出指向空处的那几条（外链一律不发请求）；`redirect` 给每个旧地址写一个 `meta refresh` + `location.replace` 的跳转页，文章换地址不丢外链；`pwa` 让站点可安装、可离线。`comments` 与 `analytics` 会加载第三方脚本，所以默认只在生产构建生效，想本地预览就把 `dev: true` 打开。

### 页面级开关（front-matter）

| front-matter | 作用 |
| --- | --- |
| `sitemap: false` | 不进 `sitemap.xml` |
| `rss: false` | 不进 `feed.xml` 与 `feed.json` |
| `search: false` | 不进搜索索引 |
| `llms: false` | 不进 `llms.txt` |
| `related: false` / `related: [url, ...]` | 关闭推荐 / 手动指定推荐列表 |
| `seo: false`、`noindex: true`、`image`、`canonical` | SEO 插件行为 |
| `pwa: false` | 该页不注入 manifest 链接 |
| `comments: false` | 该页不显示评论区 |
| `analytics: false` | 该页不计入统计 |
| `imageSize: false` | 该页 `&lt;img&gt;` 不加宽高 |

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

> 布局与片段的分工、资源打包、从零做一个主题：**[主题开发](https://doc.lovou.pw/docs/xfmpress/theme/)**。

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
└── test/run.js         # 118 项测试（零依赖）
```

## 部署

> GitHub Pages、Netlify、Vercel、Nginx 与对象存储的上线步骤：**[构建与部署](https://doc.lovou.pw/docs/xfmpress/deploy/)**。

`xfm build` 产出纯静态文件到 `dist/`，Nginx、对象存储、Vercel、Netlify、GitHub Pages 都能直接托管，不需要运行时。

本仓库自带 GitHub Pages 流水线：`.github/workflows/pages.yml` 会在推送到 `main` 且改动涉及示例站、引擎或主题时，跑测试 → 构建 `examples/blog` → 部署产物。首次使用只需在 **Settings → Pages → Build and deployment → Source** 里选一次 **GitHub Actions**。

> **项目页需要子路径前缀。** 站内 URL 目前生成为根绝对路径（`/posts/x/`），`site.base` 还没有作用到 URL 生成，所以从 `https://<user>.github.io/<repo>/` 访问时 CSS 和站内链接会 404。workflow 用 `scripts/pages-base.js` 在构建后补前缀；等 `site.base` 真正接入 URL 生成后，删掉这一步、直接在配置里写 `base` 即可。

## 本地开发

```bash
npm test               # 118 项测试
npm run bench          # 1000 页基准（分阶段耗时）
npm run build:example  # 构建示例站点
npm run dev            # 开发示例站点
```

MIT License
