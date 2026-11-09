# xfm-plugin-feed-json

JSON Feed 1.1 output for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-feed-json
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['feed-json'],   // short name, resolved to xfm-plugin-feed-json
};
```

## What it does

Writes `feed.json` (JSON Feed 1.1) next to your RSS feed, so readers, scripts and front-end `fetch()` can consume the site without parsing XML.

| | |
| --- | --- |
| Output | `feed.json` |
| Options | `feedJson: { path, limit }` — output path and item count (default `feed.json`, 20). |
| Front-matter | `rss: false` also excludes the post from this feed. |
| Hooks | see source |

## License

MIT © xfm0797
