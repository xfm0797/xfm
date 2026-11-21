# xfm-plugin-share

Share bar for xfmpress — one config, twelve targets, zero dependencies, zero external requests.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-share
```

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

## Supported networks

| network | label | note |
| --- | --- | --- |
| `weibo` | 微博 | weibo share endpoint |
| `wechat` | 微信 | copies the link and shows a hint — no QR-code service needed |
| `qq` | QQ 好友 | QQ friend share |
| `qzone` | QQ 空间 | Qzone share endpoint |
| `twitter` | X | Twitter/X intent (alias: `x`) |
| `facebook` | Facebook | sharer.php |
| `linkedin` | LinkedIn | share-offsite |
| `telegram` | Telegram | t.me share |
| `whatsapp` | WhatsApp | api.whatsapp.com |
| `reddit` | Reddit | reddit submit |
| `email` | 邮件 | `mailto:` link (alias: `mail`) |
| `copy` | 复制链接 | clipboard API with an `execCommand` fallback + toast |

## Options

```js
// xfm.config.mjs
export default {
  share: {
    // Render order follows the array. Defaults to:
    // ['weibo', 'wechat', 'qq', 'twitter', 'telegram', 'copy']
    networks: ['weibo', 'wechat', 'qq', 'twitter', 'telegram', 'copy'],
    title: '分享', // label in front of the buttons; '' hides it
    dev: false,   // also render under `xfm dev` (default: production only)
  },
};
```

## Behavior

- Mounted at the end of each **post** (pages with a `date` that aren't `type: page`); home,
  archives, taxonomies and standalone pages are skipped.
- Front-matter `share: false` turns it off for a single page.
- Share links carry the **full URL**, so the site needs `site.url` configured. Without it the
  plugin still renders (relative links) but logs one reminder per build.
- Copy-type buttons (`copy`, `wechat`) embed the page URL in `data-share-url` and use a small
  inline script — clipboard API first, `document.execCommand` fallback, then a two-second toast.
  No third-party scripts are loaded, ever.
- Templates may place `<div data-xfm-share></div>` to control placement; the plugin then only
  appends the copy script and never duplicates the bar.
- Styling is a few lines of inline CSS injected into `<head>` on pages that mount a bar; it
  follows `--border` / `--muted` CSS variables when the theme defines them.

Part of the [xfm plugin family](https://github.com/xfm0797/xfm#plugins).
