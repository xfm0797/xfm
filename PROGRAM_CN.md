# xfm v0.2.2 —— 源码包

极致性能的 Node.js 静态站点生成器。**零运行时依赖**，不需要 `npm install` 就能直接运行。

[English](./PROGRAM.md) | 简体中文

## 直接用（无需安装依赖）

```bash
cd xfm-0.2.2

node bin/xfm.js --help               # 查看命令
node bin/xfm.js build examples/blog  # 构建示例站点
node bin/xfm.js dev examples/blog    # 本地预览（默认 http://127.0.0.1:4173/）
node test/run.js                     # 跑 92 项测试
node bench/bench.js                  # 1000 页性能基准
```

## 装成全局命令

```bash
npm install -g .          # 在当前目录执行，之后可用 xfm 命令
xfm --help
```

或直接引用路径：`npm link`（开发调试用）。

## 目录结构

```
xfm-0.2.2/
├── bin/xfm.js            CLI 入口（build / dev / new / create / clean / info）
├── lib/
│   ├── index.js           编程式 API（build / createSite）
│   ├── cli/scaffold.js    站点脚手架生成
│   ├── engine/            核心引擎
│   │   ├── markdown.js    线性扫描 Markdown 编译器 + 语法高亮
│   │   ├── template.js    模板编译为 JS 函数
│   │   ├── site.js        构建编排、增量缓存、worker 调度
│   │   ├── render.js      渲染管线（主线程与 worker 共用）
│   │   ├── worker.js      worker 线程渲染
│   │   ├── theme.js       主题加载与继承
│   │   ├── plugins.js     插件系统（5 个钩子）
│   │   ├── frontmatter.js YAML 子集解析
│   │   ├── config.js      配置加载与深合并
│   │   └── server.js      开发服务器（SSE 热更新）
│   └── plugins/           内置插件：sitemap / rss / reading-stats
├── themes/
│   ├── default/           博客主题
│   └── docs/              文档主题（左侧分组侧栏）
├── examples/blog/         可运行的示例站点
├── test/run.js            测试套件
├── bench/bench.js         性能基准
├── INSTALL.md / INSTALL_CN.md  安装与使用说明（英文 / 中文）
└── README.md / README_CN.md    项目文档（英文 / 中文）
```

## 从零建一个站点

```bash
node bin/xfm.js create my-blog --template=blog
cd my-blog
node ../../bin/xfm.js dev      # 或用全局命令 xfm dev
```

## 环境要求

Node.js ≥ 18（推荐 22 LTS）。无任何第三方依赖。

## 性能

1000 篇文档冷构建约 0.40 秒（≈2300 页/秒），增量命中后渲染阶段约 1 ms。

详细文档见 `INSTALL_CN.md` 与 `README_CN.md`（英文版为 `INSTALL.md` / `README.md`）。
