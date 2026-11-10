# ⚡ xfm

[![npm version](https://img.shields.io/npm/v/xfmpress?style=flat-square&color=4f46e5&label=npm)](https://www.npmjs.com/package/xfmpress)
[![npm downloads](https://img.shields.io/npm/dm/xfmpress?style=flat-square)](https://www.npmjs.com/package/xfmpress)
[![node](https://img.shields.io/node/v/xfmpress?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/xfmpress?style=flat-square)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-doc.lovou.pw-4f46e5?style=flat-square)](https://doc.lovou.pw/docs/xfmpress/)

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
> Plugins are **not** bundled: install what you need in the site (`npm i -D xfm-plugin-rss`) — see [Plugins](#plugins).

## Documentation

The full manual lives at **[doc.lovou.pw/docs/xfmpress](https://doc.lovou.pw/docs/xfmpress/)** and is the
reference for every config field, hook and CLI flag. This README is the quick tour; when the two
disagree, the manual wins.

| Chapter | What it covers | Read it when |
| --- | --- | --- |
| [Install & upgrade](https://doc.lovou.pw/docs/xfmpress/install/) | three install methods, permission troubleshooting, upgrading | first time |
| [CLI](https://doc.lovou.pw/docs/xfmpress/cli/) | every option of `create` / `dev` / `build` / `new` / `clean` / `info` | daily use |
| [Configuration](https://doc.lovou.pw/docs/xfmpress/config/) | lookup order and the default of every field | tuning the site |
| [Content & Markdown](https://doc.lovou.pw/docs/xfmpress/content/) | front-matter, directory conventions, URL rules, extended syntax | writing |
| [Templates](https://doc.lovou.pw/docs/xfmpress/templates/) | variables, filters, control flow, inheritance, context | editing layouts |
| [Theme development](https://doc.lovou.pw/docs/xfmpress/theme/) | directory layout, layout and partial responsibilities, bundling assets | building a theme |
| [Plugins](https://doc.lovou.pw/docs/xfmpress/plugins/) | hook semantics, auto-loading, the fifteen official plugins, writing your own | extending |
| [Build & deploy](https://doc.lovou.pw/docs/xfmpress/deploy/) | incremental cache, sub-paths, GitHub Pages / Netlify / Nginx | shipping |
| [Architecture](https://doc.lovou.pw/docs/xfmpress/architecture/) | render pipeline, worker pool, cache fingerprints, reading the bench | understanding internals |
| [Changelog](https://doc.lovou.pw/docs/xfmpress/changelog/) | release history from v0.1.0 onward | evaluating an upgrade |

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

- **Themes**: `{% extend %}` / `{% block %}` template inheritance, `{% include %}` partials, `{# comments #}`, CSS-variable light/dark themes. Ships `default` (blog) and `docs` (sidebar documentation).
- **Plugins**: six hooks (`extendContext` / `markdown` / `transformHtml` / `afterCollect` / `afterBuild` / `configureServer`). **Nothing is bundled with the core** — install plugins from npm like Hexo (`npm i -D xfm-plugin-rss`) and they load themselves; fifteen official ones live in [`packages/`](./packages).
- **Content**: YAML front-matter, drafts, tag/category/series taxonomies, automatic prev/next, `weight` ordering, and relative `.md` links resolved automatically. Every term gets a real page at `/tags/<name>/`, `/categories/<name>/` and `/series/<name>/`, with encoded URLs written out as readable directories. The default theme also ships a category index (`/categories/`) and a year-grouped archive (`/archives/`), driven by the `indexes` config block and generated only when the theme provides the layout. The post sidebar table of contents highlights the section you are currently reading as you scroll.
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

Every flag, exit code and alias: [CLI chapter](https://doc.lovou.pw/docs/xfmpress/cli/).

## Configuration (`xfm.config.mjs`)

> The complete field list with defaults and the config-file lookup order: **[Configuration chapter](https://doc.lovou.pw/docs/xfmpress/config/)**.

```js
export default {
  site: {
    title: 'XFM Notes',
    description: 'Notes on static sites and the frontend',
    lang: 'en',
    base: '/',                       // sub-path deploy, e.g. '/blog/' prefixes every link
    url: 'https://example.com',      // origin, used by sitemap/RSS
    nav: [{ title: 'Posts', url: '/' }],
  },
  theme: 'default',                  // theme name or path
  plugins: ['sitemap', 'rss'],       // optional — installed xfm-plugin-* deps load anyway
                                     // (short name → xfm-plugin-<name>; './plugins/x.js' → local file)
  seo: { image: '/og.png', twitter: '@handle' }, // used by xfm-plugin-seo
  related: { limit: 3, minScore: 2 },   // used by xfm-plugin-related
  minify: { aggressive: false },        // used by xfm-plugin-minify; folds inter-tag newlines
  search: { path: 'search.json' },      // used by xfm-plugin-search
  defaults: { layout: 'post.html' },
  pagination: { perPage: 9 },        // listing pages at /page/2/, /page/3/, ...
  indexes: {                         // category index / archive pages
    categories: { enabled: true, url: '/categories/' },
    archives: { enabled: true, url: '/archives/' },
  },                                 // generated only if the theme has the layout
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
| `afterCollect(site)` | all pages collected (incl. taxonomy / pagination) | ignored; write cross-page data into `page.data` |
| `configureServer(server)` / `finish(site)` | Site / server | Ignored |

## Plugins

**The core ships no plugins.** `npm i -g xfmpress` installs the generator and the two themes;
everything else is an npm package you opt into, the same way Hexo does it:

```bash
npm i -D xfm-plugin-sitemap xfm-plugin-rss xfm-plugin-search
```

Any `xfm-plugin-*` entry in your site's `package.json` is loaded automatically — there is
nothing to configure. Restart `xfm dev` after installing, since plugins are resolved at startup.

Prefer to be explicit (to pin the load order, or to mix in a local file):

```js
// xfm.config.mjs
export default {
  plugins: ['sitemap', 'rss', './plugins/my-plugin.js'],
};
```

A short name resolves to `xfm-plugin-<name>`, a path points at a file inside your site.
A plugin that is referenced but not installed fails loudly, with the exact `npm i` command.

### Official plugins

The plugin manual — hook semantics, load order, every option, and a full authoring guide — is the **[Plugins chapter](https://doc.lovou.pw/docs/xfmpress/plugins/)**.

**Site output** — feeds, indexes and files crawlers read:

| Package | What it writes | Options |
| --- | --- | --- |
| [`xfm-plugin-sitemap`](./packages/sitemap) | `sitemap.xml`, `robots.txt` | — (`site.url` makes `<loc>` absolute) |
| [`xfm-plugin-rss`](./packages/rss) | `feed.xml` (RSS 2.0, full bodies) | `site.rss.limit` |
| [`xfm-plugin-feed-json`](./packages/feed-json) | `feed.json` (JSON Feed 1.1) | `feedJson.path`, `feedJson.limit` |
| [`xfm-plugin-llms`](./packages/llms) | `llms.txt`, `llms-full.txt` | `llms.full`, `llms.maxItems` |
| [`xfm-plugin-search`](./packages/search) | `search.json` + Ctrl/⌘+K panel | `search.path`, `search.maxChars`, `search.hint` |
| [`xfm-plugin-pwa`](./packages/pwa) | `manifest.webmanifest`, `sw.js`, `offline.html`, `icon.svg` | `pwa.themeColor`, `pwa.icons`, `pwa.offline` |
| [`xfm-plugin-redirect`](./packages/redirect) | one redirect page per alias | `redirects`, front-matter `redirect_from` |
| [`xfm-plugin-reading-stats`](./packages/reading-stats) | `stats.json`, `site.stats` | — |

**Page enhancements** — markup added to pages you already build:

| Package | What it does | Options |
| --- | --- | --- |
| [`xfm-plugin-seo`](./packages/seo) | canonical, Open Graph, Twitter Card, JSON-LD | `seo.image`, `seo.twitter`, `seo.jsonLd` |
| [`xfm-plugin-related`](./packages/related) | related posts → `page.data.related` | `related.limit`, `related.minScore` |
| [`xfm-plugin-minify`](./packages/minify) | smaller HTML (production only) | `minify.enabled`, `minify.aggressive` |
| [`xfm-plugin-image-size`](./packages/image-size) | `width`/`height` on `&lt;img&gt;`, read from the file header | `imageSize.publicDir`, `imageSize.lazy` |
| [`xfm-plugin-deadlinks`](./packages/deadlinks) | lists internal links that point nowhere | `deadlinks.strict`, `deadlinks.ignore` |
| [`xfm-plugin-giscus`](./packages/giscus) | GitHub Discussions comments (giscus / utterances) | `comments.repo`, `comments.repoId`, … |
| [`xfm-plugin-analytics`](./packages/analytics) | Umami / Plausible / GA / Baidu / custom | `analytics.provider`, … |

Every package has its own README with install, options and output.

`related` scores posts by shared tags (3), category (2) and series (3) and hands the result to
the template as `page.data.related` before rendering, so the worker pool stays active. Both
themes render a related block whenever the key exists. `seo` never duplicates a canonical /
`og:*` tag that your template already writes. `minify` leaves `<pre>`, `<code>`, `<textarea>`,
`<script>` and `<style>` untouched and is skipped entirely in dev.

`image-size` reads PNG / JPEG / GIF / WebP / SVG headers, so the browser can reserve space
before the image arrives — no layout jump, no extra dependency. `deadlinks` checks every
internal `href`/`src` against the real output set after the build and prints what is broken
(never fetches external URLs). `redirect` writes a `meta refresh` + `location.replace` page at
each old address, so moved posts keep their inbound links. `pwa` makes the site installable
and readable offline; `giscus` and `analytics` are opt-in because they load a third-party
script — both are skipped in `xfm dev` unless you set `dev: true`.

### Per-page switches (front-matter)

| Front-matter | Effect |
| --- | --- |
| `sitemap: false` | keep the page out of `sitemap.xml` |
| `rss: false` | keep the page out of `feed.xml` and `feed.json` |
| `search: false` | keep the page out of the search index |
| `llms: false` | keep the page out of `llms.txt` |
| `related: false` / `related: [url, ...]` | disable recommendations / pin a manual list |
| `seo: false`, `noindex: true`, `image`, `canonical` | SEO plugin behaviour |
| `pwa: false` | skip the manifest link on that page |
| `comments: false` | no comment widget on that page |
| `analytics: false` | no analytics on that page |
| `imageSize: false` | leave `&lt;img&gt;` untouched |

The themes only test `site.search` and `page.data.related`, so uninstalling those two plugins
degrades gracefully instead of breaking the build.

## Writing a plugin

A plugin is a module exporting `(site) => ({ name, ...hooks })`. Publish it as
`xfm-plugin-<name>` and install it like any dependency, or drop it into `plugins/` inside the
site. `site.helpers` exposes the URL and text utilities the official plugins use, so a plugin
never has to reach into the generator internals:

```js
// plugins/reading-index.js — loaded automatically from plugins/
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

## Theme structure

> Layout and partial responsibilities, asset bundling and a step-by-step theme walkthrough: **[Theme development](https://doc.lovou.pw/docs/xfmpress/theme/)**.

```
themes/my-theme/
├── layouts/        # base.html (skeleton), index/post/page.html (extend base)
├── partials/       # reusable fragments (toc, cards, ...)
└── assets/         # style.css and friends, copied to /assets/ on build
```

Template context: `site.*` (site config and aggregated data), `page.*` (current page metadata), `content` (body HTML), `headings` (table of contents). Optional layouts `taxonomy.html`, `categories.html` and `archives.html` opt a theme into taxonomy, category-index and archive pages — if a layout is missing, the corresponding pages are simply not generated.

## Project layout

```
xfm/
├── bin/xfm.js         # CLI (build/dev/new/create/clean/info)
├── lib/engine/         # markdown / template / render / frontmatter / theme / plugins / site / worker / server / config
├── lib/cli/scaffold.js # create scaffolding
├── packages/           # official plugins, published separately as xfm-plugin-*
├── themes/default/     # blog theme (light/dark)
├── themes/docs/        # docs theme (sidebar navigation)
├── examples/blog/      # buildable example site
├── bench/bench.js      # benchmark (per-stage timings)
└── test/run.js         # 118 tests (zero dependencies)
```

## Deployment

> Recipes for GitHub Pages, Netlify, Vercel, Nginx and object storage: **[Build & deploy](https://doc.lovou.pw/docs/xfmpress/deploy/)**.

`xfm build` emits plain static files in `dist/` — Nginx, object storage, Vercel, Netlify and GitHub Pages all work without a runtime.

This repository ships a ready-made GitHub Pages pipeline: `.github/workflows/pages.yml` runs the test suite, builds `examples/blog` and deploys the artifact on every push to `main` that touches the site, the engine or the themes. To turn it on, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once.

> **Project pages need a path prefix.** Page URLs are root-absolute (`/posts/x/`); the workflow injects `SITE_BASE=/<repo>/` and the engine's `site.base` support prefixes every link, `sitemap.xml` and `search.json` at build time. Fork it, set the same variable, and the same pipeline deploys your own copy.

## Local development

```bash
npm test               # 118 tests
npm run bench          # 1,000-page benchmark (per-stage timings)
npm run build:example  # build the example site
npm run dev            # dev-server the example site
```

MIT License
