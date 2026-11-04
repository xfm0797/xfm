# ⚡ xfm

[![npm version](https://img.shields.io/npm/v/xfmpress?style=flat-square&color=4f46e5&label=npm)](https://www.npmjs.com/package/xfmpress)
[![npm downloads](https://img.shields.io/npm/dm/xfmpress?style=flat-square)](https://www.npmjs.com/package/xfmpress)
[![node](https://img.shields.io/node/v/xfmpress?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/xfmpress?style=flat-square)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)

**A zero-dependency static site generator for Node.js.** Zero runtime dependencies, multi-threaded rendering, Nunjucks-style templates, drop-in themes and plugins.

[English](./README.md) | [简体中文](./README_CN.md)

## Install & Quick Start

```bash
npm i -g xfmpress    # install globally (Node >= 18); the command is xfm
xfm create my-blog   # scaffold a site in 30 seconds
cd my-blog && xfm dev   # instant hot reload
xfm build            # production build
```

> **Package name `xfmpress`, command `xfm`** (`npm i -g xfmpress`, then call `xfm`).
> This is a **static site generator**: it compresses Markdown into plain static HTML.
> Shares the `xfm` brand with [hexo-theme-xfm](https://github.com/xfm0797/hexo-theme-xfm).
> All three install methods, permission troubleshooting and the FAQ live in **[INSTALL.md](./INSTALL.md)**.

## Performance

Benchmark: 4-core Windows machine, Node 22, 1,000 Chinese documents (~5 MB of HTML output). Reproduce with `npm run bench`.

| Metric | Value |
| --- | --- |
| Full cold build | **≈4.4–5.5 s** (≈180–230 pages/s) |
| Render phase with warm cache | **1 ms** (1,001 pages) |
| Render phase, 4 workers | **≈0.5 s** (1,000 pages) |
| Dev hot rebuild of a single page | **2–7 ms** |
| Runtime footprint | plain static HTML + CSS, **zero JavaScript** |

Per-stage timing (1,000 pages):

| Stage | Time | How |
| --- | --- | --- |
| Scan & parse | ~690 ms | Parallel directory walk + parallel source reads; each file is read once |
| Hashing | ~15 ms | Reuses the already-read source text, no second IO |
| Render | ~510 ms | Worker pool reuses threads; site context is serialized once |
| Write | ~3,800 ms | One `mkdir` per directory, two-phase parallel writes |

Writing dominates on Windows/NTFS: 1,000 small files cost more than parsing and rendering combined,
and that stage is bounded by filesystem metadata operations rather than by the generator.

Four design decisions carry the performance:

1. **Line-scanning Markdown engine**: advances line by line at block level plus a single inline regex pass, no AST. Ships CJK and English anchors, tables, task lists (with continuation lines and nesting), reference links, footnotes, syntax highlighting and `::: callout` containers.
2. **Templates compiled to functions**: Nunjucks-style syntax is compiled into plain JS functions at build time, so rendering is string concatenation; undefined variables resolve safely to `undefined`.
3. **Worker pool**: threads and template compile caches are reused for the whole run, and the site context is serialized only once. Concurrency is calibrated by *minimum work per thread* — 2–4 threads measured fastest; forcing 8 is actually slower.
4. **Incremental builds**: a page is reused from cache when `source hash + theme fingerprint` are unchanged.

> More workers is not better: spinning up a worker and cloning the context costs ~30–60 ms each,
> which eats the parallel gain on small workloads. `pickConcurrency()` calibrates from measurements
> instead of blindly matching CPU core count.

## Features

- **Themes**: `{% extend %}` / `{% block %}` template inheritance, `{% include %}` partials, CSS-variable light/dark themes. Ships `default` (blog) and `docs` (sidebar documentation).
- **Plugins**: five hooks (`extendContext` / `markdown` / `transformHtml` / `afterBuild` / `configureServer`); drop a file into `plugins/` and it loads itself. Ships sitemap, RSS and reading-stats.
- **Content**: YAML front-matter, drafts, tag/category/series taxonomies, automatic prev/next, `weight` ordering, and relative `.md` links resolved automatically. Every term gets a real page at `/tags/<name>/`, `/categories/<name>/` and `/series/<name>/`, with encoded URLs written out as readable directories.
- **Developer experience**: `xfm dev` builds in memory with SSE hot reload (keeps your scroll position), hot-swaps CSS separately, and lists available routes on 404.
- **Easy to migrate**: template syntax follows Nunjucks/Liquid conventions; config supports `.mjs/.js/.json`.

## Install

```bash
npm i -g xfmpress      # then use the xfm command (Node >= 18)
# or try without installing: npx xfmpress --help
```

> The package is `xfmpress`, the command is `xfm` — install once, use anywhere.
> Full install guide, permission troubleshooting and three install methods: **[INSTALL.md](./INSTALL.md)**.

## Commands

| Command | Description |
| --- | --- |
| `xfm create [dir]` | Scaffold a site (`--template=blog\|docs`, `--title=`). Alias: `xfm init` |
| `xfm dev [dir]` | Dev server (`--port=`). Aliases: `serve`, `server`, `preview` |
| `xfm build [dir]` | Production build (`--dev` enables incremental cache). Aliases: `generate`, `gen` |
| `xfm new "Title"` | New post (`--dir=posts --slug=xxx --draft --force`; duplicate titles auto-number) |
| `xfm clean` / `xfm info` | Clean output / show config |

## Configuration (`xfm.config.mjs`)

```js
export default {
  site: {
    title: 'XFM Notes',
    description: 'Notes on static sites and the frontend',
    lang: 'en',
    base: '/',
    url: 'https://example.com',      // used by sitemap/RSS
    nav: [{ title: 'Posts', url: '/' }],
  },
  theme: 'default',                  // theme name or path
  plugins: ['sitemap', 'rss'],       // built-in names or paths
  defaults: { layout: 'post.html' },
  workers: 0,                        // worker count; 0 = auto-calibrated
  server: { port: 4173 },
};
```

## Writing (`content/`)

```markdown
---
title: Post title
date: 2026-10-28 09:00:00
tags: [nodejs, performance]
description: Summary (used by list pages and RSS)
draft: false
---

Body supports the common GFM syntax, plus:

::: tip Callout
A highlighted box with a title.
:::

\`\`\`js
const ok = true; // built-in syntax highlighting
\`\`\`

Fence languages (aliases normalized, case-insensitive): `js / javascript / jsx / ts / tsx / java / c / cpp / csharp / go / golang / rust / rs / swift / kotlin / scala / php / python / py / bash / sh / shell / json / yaml / yml / html / xml / svg / vue / css / scss / markdown / md / text`. Unknown languages fall back to escaped plain text instead of failing.

A fence can carry a title on its first line: \`\`\`js app.js (meta such as `{1,3-5}` is ignored).
```

Beyond GFM, the engine also understands:

- **Reference links** — `[text][id]`, shorthand `[id]`, resolved from a single `[id]: https://example.com "title"` definition (removed from the output).
- **Footnotes** — `text[^1]` with `[^1]: the note`; numbered by first reference, with a back link per reference.
- **Setext headings** — `Title` followed by `====` (h1) or `----` (h2).
- **Indented code blocks** — four leading spaces or a tab, outside lists.
- **Escapes** — `\*not italic\*`, `` \`not code\` ``.
- **Loose lists** — indented *and* unindented (lazy) continuation lines stay in the same item; ordered lists keep their start number.

In the `docs` theme, `group: Getting Started` plus `weight: 1` builds the sidebar navigation.

## Hook semantics

| Hook | Arguments | Return value |
| --- | --- | --- |
| `extendContext(ctx)` | Site context | Replaces the context (merged into `site.*`) |
| `markdown(src, page)` | Current source | Replaces the source |
| `transformHtml(html, ctx)` | Current HTML | Replaces the HTML |
| `afterBuild(site)` | Site instance (`site.documents[].html` is **body** HTML, without layout) | Returned `[{path, contents}]` are written out |
| `configureServer(server)` / `finish(site)` | Site / server | Ignored |

## Plugin example

```js
// plugins/search-index.js — drop into plugins/ and it runs
module.exports = () => ({
  name: 'search-index',
  afterBuild(site) {
    const index = site.documents.map(d => ({
      title: d.title, url: d.url,
      text: d.html.replace(/<[^>]+>/g, ' ').slice(0, 800),
    }));
    return [{ path: 'search.json', contents: JSON.stringify(index) }];
  },
});
```

## Theme structure

```
themes/my-theme/
├── layouts/        # base.html (skeleton), index/post/page.html (extend base)
├── partials/       # reusable fragments (toc, cards, ...)
└── assets/         # style.css and friends, copied to /assets/ on build
```

Template context: `site.*` (site config and aggregated data), `page.*` (current page metadata), `content` (body HTML), `headings` (table of contents).

## Project layout

```
xfm/
├── bin/xfm.js         # CLI (build/dev/new/create/clean/info)
├── lib/engine/         # markdown / template / render / frontmatter / theme / plugins / site / worker / server / config
├── lib/plugins/        # built-in plugins (sitemap / rss / reading-stats)
├── lib/cli/scaffold.js # create scaffolding
├── themes/default/     # blog theme (light/dark)
├── themes/docs/        # docs theme (sidebar navigation)
├── examples/blog/      # buildable example site
├── bench/bench.js      # benchmark (per-stage timings)
└── test/run.js         # 91 tests (zero dependencies)
```

## Deployment

`xfm build` emits plain static files in `dist/` — Nginx, object storage, Vercel, Netlify and GitHub Pages all work without a runtime.

This repository ships a ready-made GitHub Pages pipeline: `.github/workflows/pages.yml` runs the test suite, builds `examples/blog` and deploys the artifact on every push to `main` that touches the site, the engine or the themes. To turn it on, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once.

> **Project pages need a path prefix.** Page URLs are generated as root-absolute (`/posts/x/`), and `site.base` does not prefix them yet, so serving from `https://<user>.github.io/<repo>/` would 404 on CSS and internal links. The workflow runs `scripts/pages-base.js` to add that prefix at build time. Once `site.base` is honoured by URL generation, drop the step and set `base` in the config instead.

## Local development

```bash
npm run test           # 91 tests
npm run bench          # 1,000-page benchmark (per-stage timings)
npm run build:example  # build the example site
npm run dev            # dev-server the example site
```

MIT License
