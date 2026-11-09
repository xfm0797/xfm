# xfm-plugin-redirect

Alias and redirect pages for xfmpress — old URLs never 404.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-redirect
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['redirect'],   // short name, resolved to xfm-plugin-redirect
};
```

## What it does

Writes a tiny redirect page at every old address: `meta refresh` + `location.replace` + a visible link. Old links, search-engine indexes and bookmarks keep working after you move a post.

| | |
| --- | --- |
| Output | one HTML file per alias, with `rel=canonical` and `noindex,follow` |
| Options | `redirects: { '/old/': '/new/' }` for a global map; targets may be absolute URLs. |
| Front-matter | `redirect_from: ['/old/', ...]` (or `aliases`) on the post itself; `redirect: false` skips it. |

## License

MIT © xfm0797
