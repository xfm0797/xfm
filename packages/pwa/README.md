# xfm-plugin-pwa

PWA manifest, service worker and offline page for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-pwa
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['pwa'],   // short name, resolved to xfm-plugin-pwa
};
```

## What it does

Makes the site installable and readable offline: writes `manifest.webmanifest`, a service worker (network-first for pages, cache-first for assets) and an `offline.html` fallback. Generates an `icon.svg` from the site title when you bring no icons.

| | |
| --- | --- |
| Output | `manifest.webmanifest`, `sw.js`, `offline.html`, `icon.svg` |
| Options | `pwa.name`, `shortName`, `description`, `themeColor`, `backgroundColor`, `display`, `icons`, `offline`, `cacheExtra`, `manifestPath`, `swPath`, `dev`. |
| Front-matter | `pwa: false` skips the manifest link on one page. |

## License

MIT © xfm0797
