# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/xfm0797/xfm/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/xfm0797/xfm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/xfm0797/xfm/releases/tag/v0.1.0
