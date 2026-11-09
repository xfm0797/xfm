# xfm-plugin-deadlinks

Internal dead-link checker for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-deadlinks
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['deadlinks'],   // short name, resolved to xfm-plugin-deadlinks
};
```

## What it does

Walks every built page, resolves each internal `href`/`src` against the real output set (pages, theme assets, `public/`, other plugins) and lists what points nowhere. External links are never fetched.

| | |
| --- | --- |
| Output | console report; `deadlinks.json` when `report` is on |
| Options | `deadlinks.report`, `deadlinks.strict` (fail the build), `deadlinks.limit`, `deadlinks.ignore` (prefixes or RegExp), `deadlinks.dev`. |
| Front-matter | — |

## License

MIT © xfm0797
