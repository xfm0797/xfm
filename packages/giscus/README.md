# xfm-plugin-giscus

GitHub Discussions comments for xfmpress — giscus or utterances.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-giscus
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['giscus'],   // short name, resolved to xfm-plugin-giscus
};
```

## What it does

Mounts a comment widget on post pages. Static, no backend, no sign-up: readers comment with their GitHub account. The widget follows the theme toggle, so dark mode stays dark.

| | |
| --- | --- |
| Output | comment block inserted before `</article>`, plus `site.comments` in the template context |
| Options | `comments.provider` (`giscus` / `utterances`), `comments.repo`, `comments.repoId`, `comments.category`, `comments.categoryId`, `comments.mapping`, `comments.theme`, `comments.lang`, `comments.title`, `comments.dev`. |
| Front-matter | `comments: false` disables the widget for one page. |

## License

MIT © xfm0797
