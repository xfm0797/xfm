# xfm-plugin-reading-stats

Word counts and reading time for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-reading-stats
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['reading-stats'],   // short name, resolved to xfm-plugin-reading-stats
};
```

## What it does

Counts words (CJK and Latin separately), estimates reading minutes and writes `stats.json`. Also injects `site.stats` — a compact example of the `extendContext` hook.

| | |
| --- | --- |
| Output | `stats.json`, `site.stats` |
| Options | No options. |
| Front-matter | — |
| Hooks | see source |

## License

MIT © xfm0797
