# xfm-plugin-search

Client-side search index for xfmpress.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-search
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['search'],   // short name, resolved to xfm-plugin-search
};
```

## What it does

Writes `search.json` (title, summary, tags, first N characters of each page) and injects `site.search` so a theme can render the search panel. Both bundled themes get <kbd>Ctrl/⌘ + K</kbd> for free.

| | |
| --- | --- |
| Output | `search.json`, plus `site.search` in the template context |
| Options | `search: { path, maxChars, hint }` — index path, body excerpt length (default 1500) and placeholder text. |
| Front-matter | `search: false` keeps a page out of the index. |
| Hooks | see source |

## License

MIT © xfm0797
