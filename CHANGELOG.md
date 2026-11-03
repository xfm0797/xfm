# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/xfm0797/xfm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/xfm0797/xfm/releases/tag/v0.1.0
