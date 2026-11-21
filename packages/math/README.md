# xfm-plugin-math

KaTeX math for xfmpress — rendered **at build time**, so pages ship plain HTML + CSS with no client-side JavaScript and no CDN request.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-math
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['math'],
};
```

## Usage

```markdown
Inline: $a^2 + b^2 = c^2$ renders in the middle of a sentence.

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

Also supported: \(x^2\) and \[x^2\] (LaTeX habit).
```

KaTeX covers the vast majority of everyday LaTeX — fractions, roots, sums and integrals,
matrices, `aligned` environments, Greek letters, accents, arrows, `\text{中文}` and more.
The full command list lives at <https://katex.org/docs/supported.html>.

`$` inside fenced code, indented code and inline code is left alone, and `\$` prints a
literal dollar sign, so prices like `$5 和 $10` stay intact.

## Options

```js
export default {
  math: {
    css: 'local',         // 'local' copy into the output | 'cdn' | 'none' (bring your own)
    path: 'assets/katex', // output directory for the CSS and fonts
    cdn: 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css',
    fonts: 'woff2',       // 'woff2' (~300 KB) | 'all' (woff2 + woff + ttf)
    macros: {},           // e.g. { '\\RR': '\\mathbb{R}', '\\dd': '\\mathrm{d}' }
    output: 'html',       // 'html' | 'htmlAndMathml' (MathML aids screen readers, larger HTML)
    strict: false,        // KaTeX strict mode
    errorColor: '#cc0000',
  },
};
```

| | |
| --- | --- |
| Output | KaTeX HTML inside the page; `assets/katex/katex.min.css` + `fonts/*.woff2` when `css: 'local'` |
| Styles | Injected only on pages that actually contain math, with `site.base` applied |
| Hooks | `markdown`, `transformHtml`, `afterBuild` |
| Front-matter | — |

## How it works (and the one trade-off)

`$a_1$` contains an underscore, which Markdown would happily turn into emphasis. So the
plugin swaps every formula for a private-use placeholders **before** Markdown runs
(`markdown` hook), then replaces the placeholders with KaTeX HTML after the page is
rendered (`transformHtml`). The placeholder carries the TeX source in base64url, so no
state has to survive between the two hooks.

Because the `markdown` hook exists, production builds of the site render on the main
thread instead of the worker pool (`lib/engine/site.js`). That only affects sites that
install this plugin; a 1000-page site stays well under a second of extra render time.

## License

MIT © xfm0797
