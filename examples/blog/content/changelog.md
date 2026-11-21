---
title: 更新日志
layout: page.html
type: page
description: xfmpress 从 0.1.0 到 0.4.17 的全部版本记录，最新的在最前面。
---

xfmpress 用 [语义化版本](https://semver.org/lang/zh-CN/)：补丁位从 `x.y.0` 一路滚到 `x.y.99`，再进 `x.y+1.0`（`0.4.99` → `0.5.0`）。新功能也走补丁位，所以版本号涨得比较快。英文原文在仓库的 `CHANGELOG.md`，本页随每次发版同步。

::: tip 当前版本
**0.4.17** · 2026-11-21 · 多语言站的文章流按语言分流：`site.posts` 只含默认语言，非默认语言各生成 `/<lang>/` 列表页。测试 178 项全绿。
:::

## 版本一览

| 版本 | 日期 | 类型 | 重点 |
| --- | --- | --- | --- |
| 0.4.17 | 2026-11-21 | 特性 | 文章流按语言分流：`site.posts` 只含默认语言、`/<lang>/` 语言首页、`site.postsByLang` |
| 0.4.16 | 2026-11-21 | 特性 | 评论插件支持十家（giscus / beaudar / utterances / Disqus / Waline / Twikoo / Valine / Gitalk / Artalk / Cusdis） |
| 0.4.15 | 2026-11-21 | 特性 | `xfm-plugin-math`（构建期 KaTeX）与 `xfm-plugin-mermaid`；修复插件产物可见性 |
| 0.4.14 | 2026-11-21 | 特性 | `data/` 数据文件、`collections` 自定义集合、多语言 hreflang 与语言切换、`page.desc` 自动摘要 |
| 0.4.13 | 2026-11-15 | 性能 | 重复构建不再重写未变化的文件；写盘 5.3s → 0.9s |
| 0.4.12 | 2026-11-15 | Markdown | 列表项首的缩进代码块；段落前导空格 |
| 0.4.11 | 2026-11-15 | Markdown | 松散列表：空行不再切断列表 |
| 0.4.10 | 2026-11-15 | Markdown | 列表项内块级内容；脚注 4 空格；定义只在段首 |
| 0.4.9 | 2026-11-15 | 修复 | CLI 与 dev server 评审，八处「不报错但结果是错的」 |
| 0.4.8 | 2026-11-10 | 特性 | `xfm new` 支持 post / page / draft 三种布局与 `scaffolds/` |
| 0.4.7 | 2026-11-10 | 文档 | 接入官方文档站，README 双语补十章索引 |
| 0.4.6 | 2026-11-09 | 特性 | 六个新插件，官方插件 9 → 15 |
| 0.4.5 | 2026-11-09 | 修复 | `create` 输出清理；已在的插件直接列出 |
| 0.4.4 | 2026-11-09 | 修复 | `create` 不再覆盖已有 `package.json` |
| 0.4.3 | 2026-11-09 | 特性 | build / dev 打印实际加载的插件与产物 |
| 0.4.2 | 2026-11-09 | **破坏性** | 插件拆成独立 npm 包，改成 Hexo 式安装 |
| 0.4.1 | 2026-11-09 | 特性 | 五个内置插件：seo / related / llms / feed-json / minify |
| 0.4.0 | 2026-11-09 | 特性 | 站内搜索、列表分页、阅读体验；`site.base` 由引擎统一补 |
| 0.3.0 | 2026-11-04 | 特性 | 分类与归档页、标签页、主题改版、目录跟随阅读 |
| 0.2.1 | 2026-11-04 | 特性 | Hexo 肌肉记忆的命令别名；未知命令给建议 |
| 0.2.0 | 2026-11-04 | 特性 | Markdown 大补：引用式链接、脚注、Setext、缩进代码块 |
| 0.1.1 | 2026-11-03 | 文档 | 文档中英成对；dev 端口统一 4173 |
| 0.1.0 | 2026-11-02 | 首个版本 | 零依赖静态站点生成器 |

## 0.4.17 · 2026-11-21

0.4.14 的多语言只做到「认得翻译」：`translationKey` 配对、`hreflang` 互指、导航里能切。文章流没管——中文首页会把英文文章一起列出来，分类计数把两种语言混算，RSS 里同一篇出现两遍。这一版把流拆开了。

### 变更

- **默认文章流只收默认语言**（`languages[0]`）：首页、`/page/N/`、归档、分类/标签/系列的索引与计数、`prev`/`next`、RSS 与 JSON Feed 一并按此过滤。翻译版本仍然保留自己的 URL 和 `hreflang`。
- **每种非默认语言各有一版首页**：`/<lang>/` 加 `/<lang>/page/N/`，复用首页布局与 `pagination` 结构，`page.lang` 设为该语言，`<html lang>` 与导航本地化自然对上；该语言没有文章就不生成，URL 已被内容文件占用时让位。
- **`site.postsByLang[lang]`**：每种语言自己的文章列表，模板直接取；列表页新增 `postsTotal`，`/en/` 上就是英文篇数（default 主题侧栏已改用它）。
- **`documents[].inStream`**：告诉插件这篇属不属于默认流。`xfm-plugin-rss`、`xfm-plugin-feed-json`（0.4.3）据此过滤，`xfm-plugin-related`（0.4.3）只在同一语言内推荐；`search.json` 与 `llms.txt` 仍然索引全部页面。
- **词条页保留全量**：`/tags/<name>/` 只按名字索引，只出现在英文里的标签/分类也会生成落地页，否则英文文章的标签链接就是死链；索引页仍只列默认语言。
- **单语站零变化**：没声明 `languages`（或只声明一个）时不进入任何新分支，产物逐字节不变。

本页所在的示例站就是演示：中文首页列不到本文的英文版，[/en/](/en/) 里只有英文那篇，两者靠 `translationKey: lang-stream` 互相切换。

## 0.4.16 · 2026-11-21

评论插件从一个「GitHub 专用」的小工具扩成十家通吃：**giscus、beaudar、utterances、Disqus、Waline、Twikoo、Valine、Gitalk、Artalk、Cusdis**，切一个 `provider` 就行，模板和样式都不用动。

### 变更

- 包名 `xfm-plugin-giscus` → **`xfm-plugin-comments`**。配置键一直是 `comments`，所以老配置里 `provider: 'giscus'` 原样可用，只需要换安装命令。
- 新增 `comments.identifier`：评论与哪一页绑定，`path`（默认，站点内路径，换域名不丢评论）、`url`（完整地址）、`title`（标题）。
- 必需字段按 provider 校验：giscus 缺 `repoId`、twikoo 缺 `envId`、gitalk 缺 `admin` 之类，构建日志里直接说缺什么，页面照常输出但不留半截坏控件；未知 provider 会把可选列表打出来。
- 只有用到样式的 provider（Waline、Gitalk、Artalk）才往 `<head>` 插样式表，且只插在真正挂了控件的页面。
- 依然只挂文章页：首页、归档、标签页、独立页面不会出现评论区；front-matter 写 `comments: false` 可单页关闭。

### 跟随主题

giscus 与 beaudar 通过 `postMessage` 跟着站点的 `data-theme` 切换；Waline 用 CSS 选择器 `html[data-theme="dark"]` 自己切；Cusdis 用 `auto`。

## 0.4.15 · 2026-11-21

两个新官方插件，一个在构建期把公式画好，一个把图表留给浏览器。

### 新增

- **`xfm-plugin-math`**：构建期用 KaTeX 渲染，页面里只有 HTML + CSS，前端零 JS、零 CDN 请求。支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`；公式在 Markdown 解析前换成占位符，`$a_1$` 的下划线不会再变成斜体；围栏/缩进/行内代码与 `\$` 都保持原样。CSS 与 woff2 字体（约 300KB）复制进 `assets/katex/`，只给有公式的页面注入。
- **`xfm-plugin-mermaid`**：` ```mermaid ` 围栏块转成 `<pre class="mermaid">`，浏览器里画成 SVG；只有含图表的页面才注入渲染脚本，默认自托管 `mermaid.min.js`，也可切 CDN。

### 修复

- **后运行的 `afterBuild` 插件看不到前面插件的产物**：`site.extraFiles` 原本在整个钩子跑完才赋值，导致 `deadlinks` 把 `assets/katex/katex.min.css` 报成死链。现在每跑完一个插件就累积一次。

## 0.4.13 · 2026-11-15

1000 页站点上，重复构建的写盘阶段从 **5.3 秒降到 0.9 秒**，冷构建不变。两处浪费是数文件系统调用数出来的，跟「写文件」本身关系不大。

### 修复

- **`pruneStale` 每次构建都对 `dist` 里每个目录试一次 `rmdir`。** 1000 个页面目录全是非空的，等于 1000 次注定失败的系统调用，NTFS 上串行跑约 3.3 秒。一个目录只会因为里面的文件被删而变空，所以现在只在真有删除时才清扫，且只清被删文件的祖先目录（深的先删、并发执行）。没删东西就一次都不调。
- **未变化的页面每次都被整批重写。** 旧逻辑每次都把全部页面刷盘（约 1.5 秒）并给页面目录 `mkdir`（约 1.1 秒），哪怕字节完全一样。现在逐个比对（先比大小，相同再读回来比内容），一致就跳过，跳过的文件连目录也不建。静态资源用 make 规则（大小相同且目标不比源新就跳过），`public/` 里的大图不会被读进来。

### 新增

- `xfm build` 会多一行「未变化 N 个文件（内容一致，未重写）」，跳过了多少一目了然。
- `bench/bench.js` 把冷构建（先删 `dist`）和重复构建分开报，不再混成一个中位数。

### 数据

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| 冷构建（`dist` 为空） | 6620ms | 6668ms（噪声） |
| 重复构建 | 9607ms | **2905ms** |
| 写盘阶段本身 | 5318ms | **894ms** |

## 0.4.12 · 2026-11-15

缩进（四空格）代码块在列表项里和在列表外的行为终于一致了，「这里只支持围栏代码」这条限制彻底消掉。

### 修复

- **`-     code`（标记后 5 个空格）被当成正文。** 列表项正则把标记后的空格全吃了，看不出这一行其实是项首的缩进代码块，输出 `<li>code</li>`。按 CommonMark，标记后 1–4 个空格算缩进、5 个以上只算 1 个、其余属于内容；现在项首即代码块，后续行缩进到内容位置再 4 格仍归它。
- **段落前导空格漏进产物。** 行首 1–3 个空格的段落会把空格带进 `<p>`，列表项内容缩进被剥掉后也残留两格。现在 1–3 个前导空格一律剥掉，4 个以上是代码块，走另一条分支。

项内空行之后、引用块里、`:::` 容器里、脚注里的缩进代码块本来就支持，这几条路径没动。

## 0.4.11 · 2026-11-15

松散列表（tight / loose list）：空行不再结束一个列表。全部改动都在 `lib/engine/markdown.js`。

### 修复

- **项与项之间的空行会把一个列表拆成两个 `<ul>`。** `- a` + 空行 + `- b` 变成两个独立列表，有序列表编号断掉、子列表错位、`li + li` 这类样式失效。
- **项内空行后的内容会掉出列表。** `- 第一段` + 空行 + `␣␣第二段` 让第二段变成列表外的独立段落，缩进还留着。

### 调整

- 按 CommonMark 的 tight / loose 规则：只要有一处项间或项内空行，该列表所有段落都补 `<p>`；紧凑列表输出不变（`<li>a</li>`），项内有块的保持原有 `<p>`。列表之后的空行仍然结束列表，空行后也不再允许惰性续行。
- 属于外层列表的空行（`- a` / `␣␣- b` / 空行 / `- d`）交回上层处理，不会把内层误判成松散。

## 0.4.10 · 2026-11-15

三条长期挂在「已知限制」里的 Markdown 边界，都在 `lib/engine/markdown.js`。

### 修复

- **列表项内的块级内容按块渲染。** `- 安装：` 后面跟缩进的围栏代码，以前被拍平成一行文本（`<li>安装： npm i -g xfmpress</li>`），缩进的 `>` 还会被转义成 `&gt;`。现在按列表项的内容缩进收集行，交给块解析器：`<li><p>安装：</p><div class="code-block">…</div></li>`。`- 标题` + `␣␣---` 仍按 Setext 标题处理，不会降级成分隔线。
- **脚注块内容要求规范的 4 空格。** 旧规则按 2 空格吃行并统一去 4 空格，紧跟脚注定义的 2 空格子列表会被吞进脚注。现在 4 空格（或 tab）才是块内容，1–3 空格的普通行仍算同一段的续行（向后兼容），脚注后面无缩进的段落也不会被当成续行。
- **引用定义不再打断段落。** `collectDefinitions` 以前把每行 `[a]: /url` 都抽走，段中定义会让一段话变成两段、还少一行。现在只在段首收集（CommonMark 语义），段中的定义退化成普通文字，也不再注册成引用。
- 两个主题：列表项里的块级子元素不再额外撑开首尾行距。

### 测试

128 → 131：列表项内块级内容（引用 / 围栏代码 / 容器）、段落中的定义行、脚注缩进边界。

## 0.4.9 · 2026-11-15

一轮针对 CLI 与 dev server 的评审。下面八处都是「工具高高兴兴给出错误结果，而不是报错」。

### 修复

- **空目录里 `xfm new` 现在直接报错。** 以前会静默造出 `content/posts/<slug>.md` 并提示「build 即可看到」，而 build 因为缺主题直接失败。现在停下、给出路径、指向 `xfm create`，不产生任何文件。
- **`xfm create` 能识别所有配置形式。** 以前只看 `xfm.config.mjs`，用 `xfm.config.js` / `.cjs` / `.json` 或 `package.json` 的 `"xfm"` 字段配的站点，不加 `--force` 也会被覆盖（`content/index.md`、`about.md`、示例文章全没了）。新增 `hasConfig()`，dev 的配置监听也共用它。
- **UTF-8 BOM 不再吞掉 front-matter。** 存成「UTF-8 with BOM」（几个 Windows 编辑器的默认）的文件会整块丢 front-matter：标题退回文件路径，`date` / `layout` / `tags` 全消失。现在找 `---` 之前先剥 BOM。
- **布局压过自相矛盾的脚手架。** `scaffolds/draft.md` 里还留着 `draft: false`（从别的模板复制时常有）会生成一个其实已发布的文件，而 CLI 却打印「不会出现在构建产物里」。现在 `layout` / `type` / `draft` 按命令的布局强制覆盖，反向的残留 `draft: true` 也会写回 `false`。
- **`--dir=` 带反斜杠**（`xfm new page about --dir=docs\sub`）提示 `/docs\sub/about/`，真实 URL 是 `/docs/sub/about/`。现在先规范化，且 `--dir` 不允许跳出内容目录。
- **只有日期时按本地日历日解析。** 按规范 `new Date('2026-11-10')` 是 UTC 零点，UTC 以西的站点会整体早一天。现在 date-only 与 `YYYY-MM-DD HH:mm` 显式按本地时间构造，带时区的值保持原样。
- **子路径下的 dev server**（`site.base: '/blog/'`）：热更新事件流跟随 base（`/blog/__xfm/events`），404 页的链接补前缀，半死的浏览器连接不再能中断重建，`xfm.config.cjs` / `config.js` 也纳入监听。

### 新增

- `xfm create` 会写 `.gitignore`（`node_modules/`、`dist/`、`.xfm/` 等），第一次构建不再糊满 `git status`；已有 `.gitignore` 保持原样。
- 测试 120 → 128。

## 0.4.8 · 2026-11-10

`xfm new [布局] <标题>`，形状对齐 `hexo new [layout] <title>`。

### 新增

- `xfm new page about` → `content/about.md`，发布在 `/about/`；`xfm new draft "半成品"` → `content/posts/半成品.md` 且 `draft: true`；`xfm new "你好"` / `xfm new post "你好"` 仍是文章。
- 页面会同时拿到 `layout: page.html` **和** `type: page`：有自己的 URL、可以进 `site.nav`，但不会混进首页列表、RSS、JSON Feed、相关文章和搜索索引。以前这行得手写。
- **`scaffolds/`**：新建内容的初始正文来自站点的 `scaffolds/<布局>.md`，占位符 `{{ title }}` / `{{ date }}` / `{{ layout }}`，和 Hexo 一样。`xfm create` 会写三份默认模板供修改，站点没有这个目录就用内置模板。
- 自定义脚手架漏掉的 front-matter 字段会被补齐（标题、日期、布局、`type: page`、`draft`），免得一个裸模板悄悄产出「像文章的页面」或「已发布的草稿」。

### 调整

- 输出会打印布局与最终 URL（`[page] → /about/`）、用的是哪个脚手架，首个词像是拼错的布局时给出正确命令。
- 多词标题整体保留：`xfm new 我的 文章` 建的是「我的 文章」。单个参数永远是标题（`xfm new page` 是叫 page 的文章），与 Hexo 一致。

## 0.4.7 · 2026-11-10

### 新增

- **官方手册上线：doc.lovou.pw/docs/xfmpress**，十章覆盖安装、CLI、配置、内容、模板、主题、插件、部署与架构。两份 README 都加了 `docs` 徽章与文档索引表，CLI / 配置 / 插件 / 主题 / 部署五处补上对应章节链接。
- npm 的 `homepage` 字段与脚手架生成的站点 README 都指向手册。
- 脚手架 README 的插件清单补齐到十五个（之前停在九个）。

### 修复

- README 里的测试数过期（111 → 118）。

## 0.4.6 · 2026-11-09

六个新插件，官方插件从九个到十五个，全部零依赖。

### 新增

- `xfm-plugin-analytics`：访问统计统一入口，支持 Umami / Plausible / Google Analytics / 百度 / 自定义片段。`provider` 可以是数组，方便迁移期两套并行。
- `xfm-plugin-giscus`：基于 GitHub Discussions 的评论（giscus 或 utterances），只挂在文章页。iframe 通过 `postMessage` 跟随主题切换，深色模式不会突然变白。
- `xfm-plugin-redirect`：为每个别名（front-matter 的 `redirect_from` 或全局 `redirects` 表）生成跳转页：`meta refresh` + `location.replace` + 可见链接，`noindex,follow`，canonical 指向新地址。
- `xfm-plugin-pwa`：`manifest.webmanifest`、Service Worker（页面网络优先、资源缓存优先，预缓存表按真实主题资源与 `public/` 生成）、`offline.html`，没提供图标时用站点标题现场生成 `icon.svg`。
- `xfm-plugin-deadlinks`：构建后用真实产物校验站内 `href` / `src`，列出不指向任何文件的链接。`strict: true` 可让构建直接失败，适合 CI。外链不发请求。
- `xfm-plugin-image-size`：读 PNG / JPEG / GIF / WebP / SVG 文件头，给 `<img>` 补 `width` / `height` 占位（减轻 CLS）。只读本地文件前 64KB，不联网、不解码。

### 修复

- `xfm dev` 以前只按精确路径响应插件产物，跳转页写在 `old/index.html` 时访问 `/old/` 是 404（构建本身是对的）。现在目录形式产物也响应目录 URL，MIME 按真实文件判断（`/old/` 以前被当成 `application/octet-stream`）。
- dev server 认识 `.webmanifest` → `application/manifest+json`；Chrome 拒绝安装以 octet-stream 提供的 manifest。

### 调整

- README 中英把插件表按**站点产物**与**页面增强**重排（十五个包），front-matter 开关表补上 `pwa` / `comments` / `analytics` / `imageSize`。
- 示例站启用 `pwa` 与 `deadlinks`，每次构建顺带当 PWA 演示与死链自检。

## 0.4.5 · 2026-11-09

### 调整

- `xfm create` 的输出：在当前目录建站不再打印 `cd .`；`package.json` 里已有的插件直接列出，不重复提示安装。

## 0.4.4 · 2026-11-09

### 修复

- `xfm create` 不再覆盖已有的 `package.json`，改为合并。先装插件再建站的流程以前会把 `xfm-plugin-*` 依赖冲掉，插件随后静默失效。

### 新增

- 一项测试（111 → 112）覆盖合并逻辑与「`create` 之后插件仍能加载」。

## 0.4.3 · 2026-11-09

### 调整

- `xfm build` / `xfm dev` 打印实际加载的插件，以及它们产出的文件（`sitemap.xml, robots.txt, feed.xml, …`）。插件变成外部包之后，「装了但没被加载」必须不打开配置就能看见。

## 0.4.2 · 2026-11-09

**破坏性变更**：插件不再随内核发布。

### 破坏性

- `lib/plugins/` 撤掉，九个插件搬进 `packages/` 成为独立 npm 包（`xfm-plugin-sitemap`、`-rss`、`-feed-json`、`-search`、`-seo`、`-related`、`-llms`、`-minify`、`-reading-stats`），单独发版。以前写 `plugins: ['rss']` 的站点要执行 `npm i -D xfm-plugin-rss`；插件缺失时构建会直接失败并给出确切的安装命令，而不是悄悄回退到内置副本。
- `xfm create` 会写 `package.json` 且**不带** `plugins` 字段，新站点默认零插件。`xfm:` 前缀与 `lib/plugins/<name>.js` 回退一并移除。

### 新增

- Hexo 式插件发现：站点 `package.json` 里每个 `xfm-plugin-*`（或 `@scope/xfm-plugin-*`）依赖都会自动加载，不用改配置。`plugins: ['rss']` 里的短名解析为 `xfm-plugin-rss`。
- 解析顺序明确：站点本地文件（`./plugins/x.js`）→ 站点 `node_modules` → CLI 自身的 `node_modules`，所以全局安装的插件也能用。
- `site.helpers`：一组冻结的公开辅助函数（`absoluteUrl`、`withBase`、`normalizeBase`、`applyBase`、`plainText`、`markdownPlain`、`escapeHtml`）。插件包不再 require `xfm/lib/...`，换任何一种安装方式都能工作。
- `xfm info` 并列列出显式声明与自动发现的插件。
- 四项测试（107 → 111）：自动发现、重复注册、缺失报错、「内核不依赖任何插件包」。

### 调整

- 仓库改成 npm workspace（`packages/*`），`npm publish --workspaces` 一次发整套插件，每个包带自己的 README。
- README 中英补上完整插件章节：安装命令、九个官方插件表（包名 / 产物 / 选项）、按页的 front-matter 开关、基于 `site.helpers` 的插件编写示例。
- 脚手架输出与生成的站点 README 都写明 `npm i -D xfm-plugin-…`。

## 0.4.1 · 2026-11-09

### 新增

- 五个内置插件，全部零依赖、全部被测试覆盖：
  - `seo`：每页的 canonical、Open Graph、Twitter Card 与 JSON-LD（文章用 Article，首页用 WebSite + SearchAction）。模板里手写的 `canonical` / `og:title` 会被尊重；front-matter 可设 `image`、`canonical`、`noindex`，或用 `seo: false` 跳过。
  - `related`：渲染前按共同标签（3 分）、分类（2 分）、系列（3 分）给每篇打分，结果放进 `page.data.related`，不阻塞 worker 池。`related.limit` / `related.minScore` 可调，front-matter 能传固定列表或用 `related: false` 退出。
  - `llms`：按 llmstxt.org 约定写 `llms.txt` 与 `llms-full.txt`（分组文章索引，可选全文，`llms.full: false` 关掉）。
  - `feed-json`：在 RSS 之外再出 JSON Feed 1.1。
  - `minify`：只在生产环境生效的 HTML 压缩（注释、行尾空白、空行、缩进），`<pre>` / `<code>` / `<textarea>` / `<script>` / `<style>` 内部不动；`minify.aggressive` 会连标签间换行一起折叠。
- 新的 `afterCollect` 钩子：在所有页面收集完（含分类、索引、分页页）之后、渲染之前执行一次，插件可以往 `page.data` 写跨页数据。
- 两个主题都会在启用 `related` 时渲染「相关文章」块。
- 脚手架默认启用现代组合：`sitemap`、`rss`、`feed-json`、`search`、`seo`、`related`、`llms`、`minify`。

### 调整

- `transformHtml` 插件不再关闭 worker 池：Markdown 与模板渲染仍在 worker 里跑，钩子在主线程每页执行一次。大站点开 `seo` / `minify` 不再退化。
- 相关文章的 URL 计入页面哈希，文章增减邻居后增量缓存会重渲染。

### 修复

- `xfm dev` 现在直接从内存提供插件产物（`search.json`、`sitemap.xml`、`feed.xml`、`feed.json`、`llms.txt` 等）。以前 dev 从不跑 `afterBuild`，本地搜索面板直接 404。
- `minify` 折叠空白前先统一 CRLF（模板与 Markdown 输出混用换行），纯空白行一并丢弃。

## 0.4.0 · 2026-11-09

### 新增

- 站内搜索：新 `search` 插件把所有内容页编译成单个 `search.json`（标题 / 描述 / 标签 / 正文前 N 字，`search.maxChars` 可调），两个主题都内置零依赖的 Ctrl/⌘+K（或 `/`）搜索面板，按需拉索引、纯前端过滤。首页、分类、索引与分页页默认排除，单页可用 `search: false` 退出。
- 列表分页：`pagination: { perPage }` 把文章列表切成真正的静态页 `/page/2/`、`/page/3/`……，带上一页 / 页码 / 下一页的分页器（间隔用省略号）。第一页就是首页本身，所以模板在任何地方读到的 `pagination` 结构都一样。首页布局不渲染文章列表时（比如 docs 主题）自动跳过分页，分页页也不进 RSS、导航组、前后篇与搜索索引。
- 阅读体验优化，两个主题共用 `ux.js`：代码块复制按钮、图片点击放大、文章阅读进度条、外链新窗口打开（带 `noopener noreferrer`）。Markdown 图片现在带 `loading="lazy" decoding="async"`。

### 调整

- `site.base` 改由引擎统一应用：渲染完成后把页面 HTML 里每个根绝对路径的 `href` / `src` 补一次前缀（模板、Markdown 链接、原始 HTML 全覆盖），sitemap / RSS / 搜索索引的 URL 走同一套逻辑，dev server 也在配置的前缀下提供服务。磁盘上的产物路径不变。构建期的补丁脚本 `scripts/pages-base.js` 删除，Pages 工作流改为通过 `SITE_BASE` 传值。注意：`robots.txt` 现在只在配了 `site.url` 时才输出 `Sitemap:` 行。

## 0.3.0 · 2026-11-04

### 新增

- 分类与归档页：默认主题导航变成 首页 / 分类 / 归档 / 关于，引擎按新的 `indexes` 配置生成 `/categories/`（带文章数的分类卡片）与 `/archives/`（按年份分组）。只有主题提供对应布局时才生成，自定义主题不受影响，`indexes.categories.enabled: false` 可关。索引页进 `sitemap.xml`，但不进 RSS、导航组与前后篇。
- 默认主题重做：沉稳的玉青色系，首页双列卡片 + 吸顶侧栏（站点简介、分类、标签、归档入口），新头部导航与胶囊高亮，卡片上有分类小标签，响应式一直适配到手机宽度。
- 标签、分类、系列页：每个词条都真正生成 `/tags/<name>/`、`/categories/<name>/`、`/series/<name>/`，用主题的 `taxonomy.html` 渲染、按时间倒序列出文章。以前模板链向这些 URL 但没人生成，文章上的每个标签链接都是 404。
- GitHub Pages 工作流（`.github/workflows/pages.yml`）：站点、引擎或主题变更时跑测试、构建 `examples/blog` 并部署产物，`SITE_URL` 从仓库坐标注入。
- 跟随阅读位置的目录：`assets/toc.js` 高亮视口顶部的章节（扣掉吸顶头部高度再留一点空隙），滚到底部时强制选中最后一项，目录自身溢出时把当前项滚进视野，只有真有标题的页面才请求它。两个主题都用 `.toc a.is-active` 上色。

### 修复

- dev server 的配置热更新可能一直用旧配置：`.mjs` 配置用 `?t=Date.now()` 破坏缓存，同毫秒内保存两次 URL 一样，Node 的 ESM 缓存就返回旧模块。改成单调递增的计数器。
- 百分号编码的 URL 会写出百分号编码的目录（`dist/tags/%E6%8F%92%E4%BB%B6/`），静态服务器会先解码请求路径，所以谁也解析不到。现在落盘路径解码（`dist/tags/插件/`），URL 与 `sitemap.xml` 保持编码。
- `sitemap.xml` 与 `feed.xml` 在没配 `site.url` 时输出相对 `<loc>`；示例站改为从环境变量读 `SITE_URL`，CI 构建产出绝对链接。

## 0.2.1 · 2026-11-04

### 新增

- 对齐 Hexo 肌肉记忆的命令别名：`init` → `create`，`generate` / `gen` → `build`，`serve` / `server` / `preview` → `dev`。
- 未知命令给出最接近的建议（`xfm buils` → 「你是不是想用 `xfm build`？」），不再倾倒整份帮助。
- 两份 README 加 npm / Node / 许可证 / 零依赖徽章。

### 修复

- `xfm constructor`（以及任何 `Object.prototype` 上的键）会被当成命令并执行原型方法；命令查表改用自有属性。
- `xfm --port=4173` 这类以短横线开头的输入报成未知**选项**并给用法提示，不再打印整张命令表。

## 0.2.0 · 2026-11-04

### 新增

- 引用式链接与图片：`[文字][id]`、简写 `[id]`、`![替代][id]`，都由一条 `[id]: url "title"` 定义解析（定义本身不再漏进正文）。
- 脚注：`文字[^1]` 配 `[^1]: 注释`，按首次引用编号，每个引用都有回链，末尾生成 `.footnotes` 区。
- Setext 标题：段落行后跟 `====`（h1）或 `----`（h2）。
- 四空格 / tab 缩进代码块。
- 反斜杠转义（`\*不是强调\*`、`` \`不是代码\` ``）。
- 惰性（无缩进）列表续行，与 CommonMark 一致。
- 有序列表保留起始编号（`3.` 渲染成 `<ol start="3">`）。
- `xfm new` 遇到重名自动加序号（`title.md`、`title-2.md`……），不再报错退出。

### 调整

- 标题锚点与目录项忽略行内标记，`## 现在用 [xfm](/x) **试试**` 的锚点是 `现在用-xfm-试试`。
- 自动摘要会剥掉链接定义、脚注定义与脚注标记，不把 `[id]: https://…` 当正文露出来。
- front-matter 解析器按 JSON 语义处理双引号字符串的转义（`\"`、`\n`），单引号内的 `''` 也对。
- 新建文章把标题写成双引号包裹，`Hexo: 入门` 这类标题仍是合法 YAML。
- README 的性能数字按 4 核 Windows 机器重测，阶段拆分更正（瓶颈是写盘，不是渲染）。
- 两个主题的 CSS 都补上脚注样式。

### 修复

- 标题里带 YAML 特殊字符（`:` / `#`）会产出解析不了的 front-matter。
- 引用块、容器、表格里的引用式链接解析不到，因为嵌套渲染从空的定义作用域开始。

## 0.1.1 · 2026-11-03

### 调整

- 英文 `README.md` 成为 npm 页面默认文档，中文版是 `README_CN.md`，两份互相链接。
- 文档拆成中英成对：`README` / `README_CN`、`INSTALL` / `INSTALL_CN`、`PROGRAM` / `PROGRAM_CN`。
- dev 端口在文档与脚手架里统一为 `4173`（之前有的写 `4000`、有的写 `4321`）。
- 包描述改成英文，与 npm 页面上的 README 对齐。

### 修复

- 文档里写的安装目标是错的（`npm i -D xfm`）；可安装的包是 `xfmpress`，命令仍是 `xfm`。
- 配置示例统一成 `site: {}` 结构加顶层 `outDir`。

## 0.1.0 · 2026-11-02

### 新增

- 首个版本：零依赖静态站点生成器，主线程与 worker 线程共用同一条渲染管线。
- 多线程页面渲染，内容哈希的增量构建。
- Nunjucks 风格模板引擎，构建期编译成 JavaScript 函数，编译期生成可选链守卫。
- 插件系统，支持 `markdown`、`transformHtml`、`extendContext`、`afterBuild`、`configureServer`、`finish` 钩子。
- 内置 `default` 与 `docs` 两套主题，以及 `xfm create` 脚手架。
- dev server 带 SSE 热更新与配置热重载。
- `xfm new`、`xfm build`、`xfm dev`、`xfm clean` 四条命令。
