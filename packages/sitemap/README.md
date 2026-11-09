# xfm-plugin-sitemap

Sitemap and robots.txt generator for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-sitemap
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['sitemap'],   // short name, resolved to xfm-plugin-sitemap
};
```

## What it does

Writes `sitemap.xml` (with `lastmod`, optional `priority`) and a matching `robots.txt` that points at the sitemap once `site.url` is set.

| | |
| --- | --- |
| Output | `sitemap.xml`, `robots.txt` |
| Options | No options. `site.url` makes `<loc>` absolute; `site.base` is prefixed automatically. |
| Front-matter | `sitemap: false` drops a page; `updated` adds `lastmod`. |
| Hooks | see source |

## License

MIT © xfm0797
