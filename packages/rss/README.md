# xfm-plugin-rss

RSS 2.0 feed for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-rss
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['rss'],   // short name, resolved to xfm-plugin-rss
};
```

## What it does

Writes `feed.xml` (RSS 2.0) with the latest dated posts, absolute links built from `site.url` + `site.base`.

| | |
| --- | --- |
| Output | `feed.xml` |
| Options | `site.rss.limit` — number of items (default 20). |
| Front-matter | `rss: false` drops a page; `type: page` pages are never included. |
| Hooks | see source |

## License

MIT © xfm0797
