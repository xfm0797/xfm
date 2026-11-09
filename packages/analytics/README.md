# xfm-plugin-analytics

Page-view analytics for xfmpress — Umami, Plausible, Google Analytics, Baidu or your own snippet.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-analytics
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['analytics'],   // short name, resolved to xfm-plugin-analytics
};
```

## What it does

Injects a page-view analytics snippet before `</body>` on every page. Five providers are built in; `provider` accepts an array to run several during a migration.

| | |
| --- | --- |
| Output | `<script>` in every page (skipped in `xfm dev` by default) |
| Options | `analytics.provider` (`umami` / `plausible` / `google` / `baidu` / `custom`), then `analytics.umami.{src,id}`, `analytics.plausible.{domain,src}`, `analytics.google.id`, `analytics.baidu.id`, `analytics.script` (custom), `analytics.dev`, `analytics.exclude`. |
| Front-matter | `analytics: false` keeps a page out of the stats. |

## License

MIT © xfm0797
