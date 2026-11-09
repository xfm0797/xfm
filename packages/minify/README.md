# xfm-plugin-minify

Production-only HTML minifier for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-minify
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['minify'],   // short name, resolved to xfm-plugin-minify
};
```

## What it does

Strips HTML comments, trailing whitespace, blank lines and indentation from the built HTML. `<pre>`, `<code>`, `<textarea>`, `<script>` and `<style>` are left untouched. Skipped entirely in `xfm dev`.

| | |
| --- | --- |
| Output | smaller HTML files |
| Options | `minify: { enabled, aggressive }` — `aggressive: true` also folds newlines between tags (may affect inline spacing). |
| Front-matter | — |
| Hooks | see source |

## License

MIT © xfm0797
