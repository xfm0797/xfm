# xfm-plugin-image-size

Add width/height to images for xfmpress — no layout shift.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-image-size
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['image-size'],   // short name, resolved to xfm-plugin-image-size
};
```

## What it does

Reads the first few bytes of each local image (PNG / JPEG / GIF / WebP / SVG) and writes `width`/`height` onto the `<img>`, so the browser reserves space before the image arrives. No network, no full decode.

| | |
| --- | --- |
| Output | `<img>` markup only |
| Options | `imageSize.publicDir`, `imageSize.lazy`, `imageSize.dev`. |
| Front-matter | `imageSize: false` skips a page. |

## License

MIT © xfm0797
