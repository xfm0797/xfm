# xfm v0.2.1 — source package

An extremely fast static site generator for Node.js. **Zero runtime dependencies** — it runs straight from the source tree, no `npm install` required.

[English](./PROGRAM.md) | [简体中文](./PROGRAM_CN.md)

## Run it directly (no dependency install)

```bash
cd xfm-0.2.1

node bin/xfm.js --help               # list commands
node bin/xfm.js build examples/blog  # build the example site
node bin/xfm.js dev examples/blog    # preview locally (http://127.0.0.1:4173/)
node test/run.js                     # run the 88 tests
node bench/bench.js                  # 1,000-page benchmark
```

## Install as a global command

```bash
npm install -g .          # run inside this directory, then the xfm command is available
xfm --help
```

Or reference it by path with `npm link` (handy while debugging).

## Directory layout

```
xfm-0.2.1/
├── bin/xfm.js            CLI entry (build / dev / new / create / clean / info)
├── lib/
│   ├── index.js           programmatic API (build / createSite)
│   ├── cli/scaffold.js    site scaffolding
│   ├── engine/            core engine
│   │   ├── markdown.js    line-scanning Markdown compiler + syntax highlighting
│   │   ├── template.js    templates compiled to JS functions
│   │   ├── site.js        build orchestration, incremental cache, worker scheduling
│   │   ├── render.js      render pipeline (shared by main thread and workers)
│   │   ├── worker.js      worker-thread rendering
│   │   ├── theme.js       theme loading and inheritance
│   │   ├── plugins.js     plugin system (5 hooks)
│   │   ├── frontmatter.js YAML subset parser
│   │   ├── config.js      config loading and deep merge
│   │   └── server.js      dev server (SSE hot reload)
│   └── plugins/           built-in plugins: sitemap / rss / reading-stats
├── themes/
│   ├── default/           blog theme
│   └── docs/              docs theme (grouped left sidebar)
├── examples/blog/         runnable example site
├── test/run.js            test suite
├── bench/bench.js         benchmark
├── INSTALL.md / INSTALL_CN.md  installation and usage (English / Chinese)
└── README.md / README_CN.md    project docs (English / Chinese)
```

## Build a site from scratch

```bash
node bin/xfm.js create my-blog --template=blog
cd my-blog
node ../../bin/xfm.js dev      # or the global command: xfm dev
```

## Requirements

Node.js >= 18 (22 LTS recommended). No third-party dependencies at all.

## Performance

A cold build of 1,000 documents takes about 0.40 s (~2,300 pages/s); with a warm cache the render phase takes about 1 ms.

Full docs: `INSTALL.md` and `README.md` (Chinese versions: `INSTALL_CN.md` / `README_CN.md`).
