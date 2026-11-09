# xfm-plugin-seo

Canonical, Open Graph, Twitter Card and JSON-LD for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-seo
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['seo'],   // short name, resolved to xfm-plugin-seo
};
```

## What it does

Injects per-page `<link rel="canonical">`, Open Graph, Twitter Card and JSON-LD (Article for posts, WebSite + SearchAction for the home page). Hand-written tags in your template are respected, never duplicated.

| | |
| --- | --- |
| Output | `<head>` markup only |
| Options | `seo: { image, twitter, jsonLd }` — default share image, Twitter handle, disable JSON-LD with `jsonLd: false`. |
| Front-matter | `image`, `canonical`, `noindex: true`, `seo: false`. |
| Hooks | see source |

## License

MIT © xfm0797
