# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-09

### Added

- Built-in site search: the new `search` plugin compiles every content page into
  a single `search.json` (title / description / tags / first N chars of body,
  `search.maxChars` to tune), and both themes ship a zero-dependency
  Ctrl/⌘+K (or `/`) search panel that lazily fetches the index and filters it
  client-side. Excluded by default: home, taxonomy, index and pagination pages;
  a page opts out with `search: false` in front-matter.
- Listing pagination: `pagination: { perPage }` splits the post list into real
  static pages at `/page/2/`, `/page/3/`, ... with a pager (prev / numbered /
  next, gaps ellipsized). Page 1 is the home page itself, so templates read the
  same `pagination` structure everywhere. Pagination is skipped when the home
  layout does not render a post list (e.g. the docs theme), and paged pages
  stay out of RSS, nav groups, prev/next and the search index.
- Reading-experience polish shipped in both themes via a shared `ux.js`:
  copy button on code blocks, click-to-zoom images, a reading progress bar on
  posts, and external links opened in a new tab with `noopener noreferrer`.
  Markdown images now render with `loading="lazy" decoding="async"`.

### Changed

- `site.base` is now applied by the engine itself: after rendering, every
  root-absolute `href`/`src` in the page HTML is prefixed once (templates,
  Markdown links and raw HTML all covered), sitemap/RSS/search index URLs are
  joined through the same helper, and the dev server serves the site under the
  configured prefix. Output paths on disk are unchanged. The build-time
  patcher `scripts/pages-base.js` is gone; the Pages workflow passes
  `SITE_BASE` to the build instead. Note: `robots.txt` now emits the
  `Sitemap:` line only when `site.url` is configured.

## [0.3.0] - 2026-11-04

### Added

- Category index and archive pages: the default theme's navigation now ships
  with 首页 / 分类 / 归档 / 关于, and the engine generates `/categories/`
  (term cards with post counts) and `/archives/` (posts grouped by year) from
  a new `indexes` config block. Pages are only generated when the theme
  provides the matching layout, so custom themes keep working, and
  `indexes.categories.enabled: false` turns them off. Index pages go into
  `sitemap.xml` but not RSS, nav groups or prev/next.
- Redesigned default theme: calm jade-green palette, two-column card grid on
  the home page with a sticky widget sidebar (site intro, categories, tags,
  archive link), refreshed header navigation with pill highlight, category
  chips on post cards, and responsive breakpoints down to mobile widths.
- Tag, category and series pages: every term now gets a real page at
  `/tags/<name>/`, `/categories/<name>/` and `/series/<name>/`, rendered with
  the theme's `taxonomy.html` layout and listing its posts newest first.
  Previously the templates linked to those URLs but nothing generated them,
  so every tag link on a post was a 404.
- GitHub Pages workflow (`.github/workflows/pages.yml`): tests, builds
  `examples/blog` and deploys the artifact when the site, engine or themes
  change, with `SITE_URL` injected from the repository coordinates.
- `scripts/pages-base.js`: temporary build-time prefixer for the root-absolute
  links produced today, so the example site works under a project page path.
  It should be removed once `site.base` is applied during URL generation.
- Table of contents that follows the reading position: `assets/toc.js` marks
  the section currently at the top of the viewport (sticky header height plus
  a small breathing gap), forces the last entry when the page bottom is
  reached, scrolls the entry back into view if the TOC itself overflows, and
  is only requested by pages that actually have headings. Styled through
  `.toc a.is-active` in both themes.

### Fixed

- Dev-server config hot reload could keep serving the old config: `.mjs`
  configs were imported with `?t=Date.now()`, so two saves in the same
  millisecond produced the same URL and Node's ESM cache returned the stale
  module. Cache-busting now uses a monotonically increasing counter.
- Percent-encoded URLs wrote percent-encoded directories
  (`dist/tags/%E6%8F%92%E4%BB%B6/`), which no static server resolves because
  they decode the request path first. Output paths are now decoded
  (`dist/tags/插件/`), while URLs and `sitemap.xml` stay encoded.
- `sitemap.xml` and `feed.xml` emitted relative `<loc>` values when
  `site.url` was unset; the example site now reads `SITE_URL` from the
  environment so CI builds produce absolute links.

## [0.2.1] - 2026-11-04

### Added

- Command aliases matching Hexo muscle memory: `init` → `create`,
  `generate` / `gen` → `build`, `serve` / `server` / `preview` → `dev`.
- Unknown commands now suggest the closest match (`xfm buils` →
  "did you mean `xfm build`?") instead of reprinting the whole help text.
- npm / Node / license / zero-dependency badges in both READMEs.

### Fixed

- `xfm constructor` (or any `Object.prototype` key) was resolved as a command
  and invoked the prototype method; command lookup now uses own properties.
- Leading-dash input such as `xfm --port=4173` is reported as an unknown
  *option* with a usage hint, rather than dumping the command list.

## [0.2.0] - 2026-11-04

### Added

- Reference-style links and images: `[text][id]`, shorthand `[id]`,
  `![alt][id]`, resolved from a single `[id]: url "title"` definition
  (definitions no longer leak into the rendered body).
- Footnotes: `text[^1]` with `[^1]: note`, numbered by first reference,
  with a back link for every reference and a `.footnotes` section at the end.
- Setext headings: a paragraph line followed by `====` (h1) or `----` (h2).
- Four-space / tab indented code blocks.
- Backslash escapes (`\*literal\*`, `` \`literal\` ``).
- Lazy (unindented) list continuation lines, as in CommonMark.
- Ordered lists keep their start number (`3.` renders `<ol start="3">`).
- `xfm new` auto-numbers duplicate titles (`title.md`, `title-2.md`, …)
  instead of exiting with an error.

### Changed

- Heading anchors and TOC entries ignore inline markup, so
  `## Use [xfm](/x) **now**` becomes `use-xfm-now` instead of `use-xfmx-now`.
- Auto-generated excerpts strip link definitions, footnote definitions and
  footnote markers instead of exposing `[id]: https://…` as body text.
- Front-matter parser now unescapes double-quoted strings with JSON semantics
  (`\"`, `\n`) and `''` inside single quotes.
- New posts write the title double-quoted, so `Hexo: 入门` stays valid YAML.
- README benchmark numbers re-measured on a 4-core Windows machine and the
  stage breakdown corrected (writing, not rendering, is the bottleneck).
- Theme CSS gains footnote styling in both `default` and `docs`.

### Fixed

- A title containing YAML special characters (`:` / `#`) produced
  unparsable front-matter.
- Referenced links inside blockquotes, callouts and tables were not resolved
  because nested rendering started from an empty definition scope.

## [0.1.1] - 2026-11-03

### Changed

- English `README.md` is now the default document shown on the npm page;
  the Chinese version ships as `README_CN.md`, and both link to each other.
- Documentation split into English/Chinese pairs: `README` / `README_CN`,
  `INSTALL` / `INSTALL_CN`, `PROGRAM` / `PROGRAM_CN`.
- Dev server port corrected to `4173` in all docs and scaffolds
  (previously documented inconsistently as `4000` / `4321`).
- Package description rewritten in English to match the npm-facing README.

### Fixed

- Docs referenced the wrong install target (`npm i -D xfm`); the installable
  package is `xfmpress` while the CLI command remains `xfm`.
- Configuration examples now consistently use the `site: {}` shape with
  a top-level `outDir`.

## [0.1.0] - 2026-11-02

### Added

- Initial release: zero-dependency static site generator with a shared
  render pipeline used by both the main thread and worker threads.
- Multi-threaded page rendering with content-hashed incremental builds.
- Nunjucks-style template engine compiled to JavaScript functions at build
  time, with optional-chaining guards generated at compile time.
- Plugin system with `markdown`, `transformHtml`, `extendContext`,
  `afterBuild`, `configureServer` and `finish` hooks.
- Built-in `default` and `docs` themes, plus `xfm create` scaffolding.
- Dev server with SSE live reload and configuration hot reload.
- `xfm new`, `xfm build`, `xfm dev`, `xfm clean` commands.

[0.3.0]: https://github.com/xfm0797/xfm/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/xfm0797/xfm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xfm0797/xfm/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/xfm0797/xfm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/xfm0797/xfm/releases/tag/v0.1.0
