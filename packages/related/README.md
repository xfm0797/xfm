# xfm-plugin-related

Related posts by shared tags, category and series for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-related
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['related'],   // short name, resolved to xfm-plugin-related
};
```

## What it does

Scores every post by shared tags (3), category (2) and series (3) before rendering and exposes the result as `page.data.related`, so the worker pool stays active. Both bundled themes render a related block when the key exists.

| | |
| --- | --- |
| Output | `page.data.related` |
| Options | `related: { limit, minScore }` — how many posts, and the minimum score (default 3, 2). |
| Front-matter | `related: false` disables it; `related: [url, ...]` pins a manual list. |
| Hooks | see source |

## License

MIT © xfm0797
