# xfm 安装与使用说明

> 面向 Node 22 环境，从零到跑起来大约 1 分钟。
> 项目地址：`https://github.com/xfm0797/xfm`

[English](./INSTALL.md) | 简体中文

---

## 一、先决条件

| 项目 | 要求 | 检查命令 |
| --- | --- | --- |
| Node.js | **18 或更高**（推荐 22 LTS） | `node -v` |
| npm | 随 Node 附带（推荐 ≥ 9） | `npm -v` |

```bash
node -v    # 期望 v22.x
npm -v     # 期望 10.x 或 11.x
```

Node 版本过旧会报 `EBADENGINE`，用 [nvm](https://github.com/nvm-sh/nvm) 或 [fnm](https://github.com/Schniz/fnm) 切到 22 即可：

```bash
nvm install 22 && nvm use 22
```

xfm 是**零运行时依赖**的，安装时不会拉取任何第三方包，也因此不会出现依赖树冲突、`npm audit` 报警。

---

## 二、安装（三种方式，按需选一种）

### 方式 A：全局安装 —— 和 Hexo 一样用 `xfm` 命令

```bash
npm install -g xfmpress
```

验证：

```bash
xfm --help
```

看到 `⚡ xfm v0.3.0` 的版本横幅即安装成功。

> **命名说明**：npm 包名是 **`xfmpress`**，命令是 **`xfm`**（`npm i -g xfmpress` 之后用 `xfm` 调用）。定位是 Static Site Generator（静态站点生成器），与同系列的 `hexo-theme-xfm` 共用品牌。项目早期叫 `bolt`，`bolt`/`bolt-ssg` 已被占用，`xmssg` 与 `xfm` 又分别被 npm 的"名字过于相似"校验拦下（撞 `xss`、以及 `xo`/`xml`/`htm` 等一批短包名），0.1.0 起定为 `xfmpress`。

**权限报错怎么办**（`EACCES: permission denied`）？有两种正规解法，不要用 `sudo npm i -g`：

```bash
# 解法 1（推荐）：把全局前缀改到用户目录
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc   # bash 用户改成 ~/.bashrc
source ~/.zshrc

# 解法 2：用 nvm 管理 Node（全局包天然在用户目录，无需额外配置）
```

### 方式 B：免安装运行 —— 只想先试试

```bash
npx xfmpress --help
npx xfmpress create my-blog --template=blog
```

`npx` 会自动下载到临时缓存并执行，不在系统里留下全局命令。适合快速体验或 CI 里一次性构建。

### 方式 C：项目内安装 —— 团队协作推荐

把 xfm 作为开发依赖写进项目，任何人 `npm install` 后即可获得**完全一致**的版本：

```bash
mkdir my-blog && cd my-blog
npm init -y
npm i -D xfmpress
```

然后在 `package.json` 里加脚本：

```json
{
  "scripts": {
    "dev": "xfm dev",
    "build": "xfm build",
    "new": "xfm new",
    "clean": "xfm clean"
  }
}
```

之后用 `npm run dev` / `npm run build` 即可；临时调用可用 `npx xfmpress info`。

> 方式 C 的缺点是不能在空目录里用 `xfm create` 生成脚手架（那时还没有 `node_modules`）。建议先用方式 A 或 B 生成站点，再进目录装成本地依赖。

---

## 三、快速上手

### 1. 创建站点

```bash
xfm create my-blog --template=blog
cd my-blog
```

可选模板：

| `--template` | 外观 | 适合 |
| --- | --- | --- |
| `blog`（默认） | 博客：首页列表 + 文章页 + 右侧目录 | 个人博客、技术随笔 |
| `docs` | 文档：左侧分组侧栏 + 正文 | 产品文档、知识库 |

也能指定站名：

```bash
xfm create my-blog --template=docs --title="我的知识库"
```

生成的结构：

```
my-blog/
├── xfm.config.mjs      # 站点配置（有合理默认值，可按需改）
├── content/             # 所有 Markdown 源文件
│   ├── index.md
│   ├── about.md
│   └── posts/
│       └── hello-world.md
├── plugins/             # 你自己的插件
├── public/              # 原样拷贝到产物根目录的静态文件
└── README.md
```

### 2. 本地开发

```bash
xfm dev
```

打开 `http://127.0.0.1:4173/`。改 `content/` 里的 Markdown 或 `themes/` 里的模板，保存后浏览器**自动刷新**（SSE 推送，无需装浏览器插件）。

```bash
xfm dev --port=5000     # 换端口
```

### 3. 写文章

```bash
xfm new "我的第一篇文章"
# ✓ 已创建 content/posts/我的第一篇文章.md   （文件名由标题自动转为 slug）
```

带空格或多语言的标题会自动处理文件名：

```bash
xfm new "Hello, World!"                  # → content/posts/hello-world.md
xfm new "部署笔记" --slug=deploy-notes    # → 手动指定文件名
xfm new "关于" --dir=pages               # → 放到 content/pages/ 下
```

> **注意**：`xfm new` 生成的文章**默认可发布**，`xfm build` 立刻就能看到。想先写半成品，用 `xfm new --draft`（会写入 `draft: true`），这类文章不会出现在生产构建里；要发布时把 `draft` 改成 `false` 或删掉该行即可。

### 4. 生产构建

```bash
xfm build
```

产物在 `dist/`，纯静态，扔到 Nginx / 对象存储 / Vercel / Netlify / GitHub Pages 都能跑。

```
✓ 页面      5 个
✓ 附加产物  4 个（sitemap / rss 等）
✓ 输出目录  dist
耗时 30 ms
```

重构建会走增量缓存，只重新渲染改动过的页面：

```bash
xfm build --dev     # 开发模式下也启用增量缓存
```

### 5. 其他命令

```bash
xfm info        # 查看当前站点解析后的配置（主题、内容目录、插件、Node 版本）
xfm clean       # 清空 dist/ 与增量缓存
xfm --help      # 全部命令与选项
```

---

## 四、写 Markdown

内容就是标准 Markdown，没有私有语法。常用增强：

````markdown
---
title: 文章标题
date: 2024-06-01
tags: [性能, Node]
description: 用于 SEO 与列表摘要
layout: post.html
draft: false
---

## 二级标题会自动进右侧目录

普通段落支持 **加粗**、*斜体*、`行内代码`、~~删除线~~、[链接](/about/)。

| 语法 | 说明 |
| --- | --- |
| 表格 | 标准 GFM |
| 引用式链接 | `[文字][id]`、简写 `[id]`，配合 `[id]: https://… "标题"` 定义 |
| 脚注 | `正文[^1]` 配合 `[^1]: 注释`，按首次引用编号，多次引用各自回链 |
| Setext 标题 | 段落下一行写 `====`（一级）或 `----`（二级） |
| 缩进代码块 | 行首四个空格或一个 tab（列表之外） |
| 转义 | `\*原样星号\*`、`` \`原样反引号\` `` |

- [x] 任务列表已支持
- [ ] 未完成项

::: tip 提示容器
支持 `tip` / `info` / `warning` / `danger` 四种。
:::

```js
const ok = true; // 代码块自动语法高亮
```
````

代码高亮支持：`js / javascript / jsx / ts / tsx / java / c / cpp / csharp / go / rust / swift / kotlin / scala / php / python / bash / sh / json / yaml / html / xml / svg / vue / css / scss / markdown`，大小写与常见别名都能识别；未知语言降级为纯文本，不会报错。围栏可加标题：`` ```js app.js ``。

---

## 五、配置

`xfm.config.mjs` 是一个普通 ESM 模块，导出对象即可，改动后 dev 服务器会自动重启：

```js
export default {
  site: {
    title: '我的博客',
    description: '记录技术与生活',
    url: 'https://example.com',    // 用于 sitemap / rss 的绝对链接
    lang: 'zh-CN',
    base: '/',
    nav: [{ title: '首页', url: '/' }],
  },
  contentDir: 'content',
  outDir: 'dist',
  theme: 'default',                // 内置主题：default | docs；也可填本地路径
  plugins: [                        // 可选：装好的 xfm-plugin-* 依赖本来就会自动加载
    'sitemap',
    'rss',
    './plugins/my-plugin.js',       // 本地插件
  ],
  workers: 0,                      // 0 = 自动；渲染进程数
  server: { port: 4173 },          // dev 端口
};
```

所有字段都有默认值，最小配置就是一个空对象。完整字段见 `README_CN.md`（中文）/ `README.md`（English）。

---

## 六、常见问题

**`xfm: command not found`**
全局 npm 的 `bin` 目录不在 `PATH` 里。执行 `npm bin -g`（旧版）或 `npm config get prefix`，把其下的 `bin` 加进 `PATH`。用 nvm 的话重开一个终端通常就能解决。

**安装时报 `EACCES: permission denied`**
见「方式 A」里的全局前缀改法，不要用 `sudo`。

**`node -v` 低于 18**
升级 Node 后重装：`npm i -g xfmpress --force`。

**`xfm new` 建了文章但页面上没有**
大概率是 `draft: true`。改成 `false` 后重新 `xfm build`。

**Windows 下 `xfm` 提示不是内部或外部命令**
用 Git Bash 或 PowerShell 重开终端；仍不行则检查 `%APPDATA%\npm` 是否在 `Path` 中。

**想升级**
```bash
npm i -g xfmpress@latest       # 全局
npm i -D xfmpress@latest       # 项目内
```

---

## 七、一键脚本（复制即用）

```bash
# 全局安装 + 创建博客 + 本地预览
npm i -g xfmpress \
  && xfm create my-blog --template=blog \
  && cd my-blog \
  && xfm dev
```
