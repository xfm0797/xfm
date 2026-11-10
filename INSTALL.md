# xfm — Installation & Usage

> Assumes a Node 22 environment. From zero to a running site takes about a minute.
> Repository: `https://github.com/xfm0797/xfm`
> Full manual: `https://doc.lovou.pw/docs/xfmpress/`

[English](./INSTALL.md) | [简体中文](./INSTALL_CN.md)

---

## 1. Prerequisites

| Item | Requirement | Check |
| --- | --- | --- |
| Node.js | **18 or newer** (22 LTS recommended) | `node -v` |
| npm | Ships with Node (>= 9 recommended) | `npm -v` |

```bash
node -v    # expect v22.x
npm -v     # expect 10.x or 11.x
```

An outdated Node version triggers `EBADENGINE`. Switch to 22 with [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm):

```bash
nvm install 22 && nvm use 22
```

xfm has **zero runtime dependencies**, so installing it pulls no third-party packages — which also means no dependency-tree conflicts and no `npm audit` warnings.

---

## 2. Install (pick one of three methods)

### Option A: Global install — use `xfm` like you use `hexo`

```bash
npm install -g xfmpress
```

Verify:

```bash
xfm --help
```

If you see the `⚡ xfm v0.3.0` banner, you are good to go.

> **About the name**: the npm package is **`xfmpress`**, the command is **`xfm`** (`npm i -g xfmpress`, then call `xfm`). It is a Static Site Generator, sharing the `xfm` brand with the `hexo-theme-xfm` family. The project was originally called `bolt`; `bolt`/`bolt-ssg` were taken, and `xmssg` and `xfm` were both rejected by npm's "too similar to an existing package" check (against `xss`, then against `xo`/`xml`/`htm` and friends), so `xfmpress` has been the name since 0.1.0.

**Hit `EACCES: permission denied`?** There are two proper fixes; do not use `sudo npm i -g`:

```bash
# Fix 1 (recommended): move the global prefix into your home directory
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc   # use ~/.bashrc for bash
source ~/.zshrc

# Fix 2: manage Node with nvm (global packages already live in your home directory)
```

### Option B: Run without installing — just want to try it

```bash
npx xfmpress --help
npx xfmpress create my-blog --template=blog
```

`npx` downloads into a temporary cache and runs from there, leaving no global command behind. Good for a quick look or a one-off build in CI.

### Option C: Install into a project — best for teams

Add xfm as a dev dependency so everyone gets the **exact same** version after `npm install`:

```bash
mkdir my-blog && cd my-blog
npm init -y
npm i -D xfmpress
```

Then add scripts to `package.json`:

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

From then on use `npm run dev` / `npm run build`; for a one-off command use `npx xfmpress info`.

> The downside of Option C: you cannot run `xfm create` in an empty directory, because there is no `node_modules` yet. Scaffold the site with Option A or B first, then install it locally.

---

## 3. Quick start

### 1. Create a site

```bash
xfm create my-blog --template=blog
cd my-blog
```

Available templates:

| `--template` | Look | Good for |
| --- | --- | --- |
| `blog` (default) | Blog: post list on the home page, post pages, right-hand TOC | Personal blogs, tech notes |
| `docs` | Documentation: grouped left sidebar + body | Product docs, knowledge bases |

You can also set the site title:

```bash
xfm create my-blog --template=docs --title="My Knowledge Base"
```

Generated structure:

```
my-blog/
├── xfm.config.mjs      # site config (sensible defaults, edit as needed)
├── content/            # all Markdown sources
│   ├── index.md
│   ├── about.md
│   └── posts/
│       └── hello-world.md
├── plugins/            # your own plugins
├── public/             # static files copied verbatim to the output root
└── README.md
```

### 2. Local development

```bash
xfm dev
```

Open `http://127.0.0.1:4173/`. Edit Markdown under `content/` or templates under `themes/`, save, and the browser **refreshes itself** (SSE push, no browser extension needed).

```bash
xfm dev --port=5000     # different port
```

### 3. Write a post

```bash
xfm new "My First Post"
# ✓ created content/posts/my-first-post.md   (the title is slugified into the filename)
```

Titles with spaces or non-ASCII characters are handled automatically:

```bash
xfm new "Hello, World!"                  # → content/posts/hello-world.md
xfm new "Deploy notes" --slug=deploy-notes   # → explicit filename
xfm new "About" --dir=pages              # → under content/pages/
```

> **Note**: posts created by `xfm new` are **publishable by default** and show up on the next `xfm build`. To write a work in progress, use `xfm new --draft` (writes `draft: true`); such posts never appear in production builds. Set `draft` to `false` or delete the line when you are ready to publish.

### 4. Production build

```bash
xfm build
```

Output goes to `dist/`, fully static — drop it on Nginx, object storage, Vercel, Netlify or GitHub Pages.

```
✓ pages        5
✓ extra files  4 (sitemap / rss, etc.)
✓ output       dist
done in 30 ms
```

Rebuilds use the incremental cache and only re-render changed pages:

```bash
xfm build --dev     # enable the incremental cache in dev mode too
```

### 5. Other commands

```bash
xfm info        # show the resolved config (theme, content dir, plugins, Node version)
xfm clean       # wipe dist/ and the incremental cache
xfm --help      # every command and option
```

---

## 4. Writing Markdown

Content is plain Markdown — no proprietary syntax. Common extensions:

````markdown
---
title: Post title
date: 2024-06-01
tags: [performance, node]
description: Used for SEO and list summaries
layout: post.html
draft: false
---

## H2 headings land in the right-hand TOC automatically

Normal paragraphs support **bold**, *italic*, `inline code`, ~~strikethrough~~, [links](/about/).

| Syntax | Notes |
| --- | --- |
| Tables | Standard GFM |
| Reference links | `[text][id]`, shorthand `[id]`, plus a `[id]: https://… "title"` definition |
| Footnotes | `text[^1]` with `[^1]: the note` — numbered by first reference, multi-reference back links |
| Setext headings | A paragraph line followed by `====` (h1) or `----` (h2) |
| Indented code | Four leading spaces or a tab, outside of lists |
| Escapes | `\*literal\*`, `` \`literal\` `` |

- [x] Task lists work
- [ ] Unfinished item

::: tip Callout
Four kinds: `tip` / `info` / `warning` / `danger`.
:::

```js
const ok = true; // code blocks are highlighted automatically
```
````

Highlighting supports: `js / javascript / jsx / ts / tsx / java / c / cpp / csharp / go / rust / swift / kotlin / scala / php / python / bash / sh / json / yaml / html / xml / svg / vue / css / scss / markdown`, case-insensitive and alias-aware; unknown languages degrade to plain text instead of failing. Fences can carry a title: `` ```js app.js ``.

---

## 5. Configuration

`xfm.config.mjs` is a plain ESM module — export an object and you are done. The dev server picks up changes automatically:

```js
export default {
  site: {
    title: 'My Blog',
    description: 'Notes on tech and life',
    url: 'https://example.com',    // absolute links for sitemap / rss
    lang: 'en',
    base: '/',
    nav: [{ title: 'Home', url: '/' }],
  },
  contentDir: 'content',
  outDir: 'dist',
  theme: 'default',                // built-in: default | docs; or a local path
  plugins: [                       // optional: installed xfm-plugin-* deps load anyway
    'sitemap',
    'rss',
    './plugins/my-plugin.js',      // local plugin
  ],
  workers: 0,                      // 0 = auto; number of render workers
  server: { port: 4173 },          // dev port
};
```

Every field has a default, so the minimal config is an empty object. Full reference: `README.md` (English) / `README_CN.md` (Chinese).

---

## 6. FAQ

**`xfm: command not found`**
The global npm `bin` directory is not on your `PATH`. Run `npm config get prefix` and add its `bin` subdirectory to `PATH`. With nvm, opening a fresh terminal usually fixes it.

**`EACCES: permission denied` during install**
See the global-prefix fix under Option A. Do not use `sudo`.

**`node -v` is below 18**
Upgrade Node, then reinstall: `npm i -g xfmpress --force`.

**`xfm new` created a post but it is not on the site**
Most likely `draft: true`. Change it to `false` and run `xfm build` again.

**On Windows, `xfm` is "not recognized as an internal or external command"**
Reopen your terminal in Git Bash or PowerShell. If it still fails, check that `%APPDATA%\npm` is on your `Path`.

**Upgrading**
```bash
npm i -g xfmpress@latest       # global
npm i -D xfmpress@latest       # in a project
```

---

## 7. One-liner (copy & paste)

```bash
# install globally + scaffold a blog + start the dev server
npm i -g xfmpress \
  && xfm create my-blog --template=blog \
  && cd my-blog \
  && xfm dev
```
