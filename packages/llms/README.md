# xfm-plugin-llms

llms.txt and llms-full.txt for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-llms
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['llms'],   // short name, resolved to xfm-plugin-llms
};
```

## What it does

Writes `llms.txt` and `llms-full.txt` following [llmstxt.org](https://llmstxt.org): a grouped index of posts with one-line summaries, plus optional full text, so LLM crawlers can read the site cheaply.

| | |
| --- | --- |
| Output | `llms.txt`, `llms-full.txt` |
| Options | `llms: { path, full, fullPath, maxItems }` — `full: false` skips the full-text file, `maxItems` caps the list (0 = all). |
| Front-matter | `llms: false` excludes a page. |
| Hooks | see source |

## License

MIT © xfm0797
