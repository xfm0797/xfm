# xfm-plugin-comments

Comment systems for xfmpress — one plugin, ten providers, one config key.

Part of [xfm](https://github.com/xfm0797/xfm) — a zero-dependency static site generator for Node.js.
**Plugins are not bundled with the core**: install only the ones you need.

## Install

```bash
npm i -D xfm-plugin-comments
```

> Replaces the deprecated `xfm-plugin-giscus`. The config key is unchanged — drop the old package,
> install this one, and an existing `comments: { provider: 'giscus', … }` block keeps working.

That is all — the generator loads every `xfm-plugin-*` dependency found in your site's
`package.json` automatically (same as Hexo). Restart `xfm dev` if it is already running.

Explicit configuration also works:

```js
// xfm.config.mjs
export default {
  plugins: ['comments'],
};
```

> Replaces `xfm-plugin-giscus` (0.4.2). The config key is still `comments`, and
> `provider: 'giscus'` behaves exactly as before — just swap the package.

## Pick a provider

```js
export default {
  comments: { provider: 'giscus', repo: 'owner/repo', repoId: 'R_kgDO…' },
};
```

| `provider` | Backend needed | Sign-in | Notes |
| --- | --- | --- | --- |
| `giscus` | none (GitHub Discussions) | GitHub | Default. Threads follow the theme toggle. |
| `beaudar` | none (GitHub Discussions) | GitHub | giscus-compatible fork, reachable from mainland China. |
| `utterances` | none (GitHub Issues) | GitHub | Lightest GitHub option, no reactions. |
| `disqus` | none (hosted) | many | Long-standing, ad-supported tier. |
| `waline` | self-host (Vercel/…+ DB) | email or socials | Markdown, emoji, page views. |
| `twikoo` | Tencent CloudBase / Vercel | email or socials | Popular in China, one-click deploy. |
| `valine` | LeanCloud | email or socials | Lightweight, older but stable. |
| `gitalk` | GitHub Issues + OAuth app | GitHub | Issues stored in your repo. |
| `artalk` | self-host (Docker/binary) | email or socials | Built-in admin dashboard. |
| `cusdis` | self-host or cusdis.com | email | Minimal, tiny script. |

Unknown providers and missing required fields fail loudly in the build log and leave the
page untouched — a typo in `repoId` never ships a broken widget silently.

## Configuration

Common options:

| Option | Default | Meaning |
| --- | --- | --- |
| `provider` | `giscus` | See the table above. Aliases: `github` → `giscus`. |
| `title` | `评论` | Section heading; `''` hides it. |
| `identifier` | `path` | What binds a thread to a page: `path` (site-relative URL), `url` (absolute), `title`. |
| `dev` | `false` | Also render in `xfm dev` (third-party scripts stay out of local previews by default). |

Provider-specific options:

```js
// giscus / beaudar
{ provider: 'giscus', repo, repoId, category: 'General', categoryId, mapping: 'pathname',
  theme: 'preferred_color_scheme', lang: 'zh-CN', strict: false, reactionsEnabled: true,
  inputPosition: 'bottom' }

// utterances
{ provider: 'utterances', repo, issueTerm: 'pathname', label: 'comment', theme: 'preferred-color-scheme' }

// disqus
{ provider: 'disqus', shortname: 'my-blog' }

// waline
{ provider: 'waline', serverURL: 'https://comments.example.com', lang: 'zh-CN',
  emoji: ['https://…/emoji/'], requiredMeta: ['nick', 'mail'], login: 'enable', commentSorting: 'newest' }

// twikoo
{ provider: 'twikoo', envId: 'https://xxx.vercel.app', region: 'ap-shanghai', lang: 'zh-CN' }

// valine
{ provider: 'valine', appId, appKey, placeholder: '欢迎留言', serverURLs, meta: ['nick', 'mail', 'link'] }

// gitalk
{ provider: 'gitalk', clientID, clientSecret, repo, owner, admin: ['owner'], distractionFreeMode: true, proxy }

// artalk
{ provider: 'artalk', server: 'https://artalk.example.com', site: 'My Blog', dark: true }

// cusdis
{ provider: 'cusdis', host: 'https://cusdis.com', appId }
```

## Behaviour

- Inserts a `.comments` section just before `</article>` (falling back to `</main>` / `</body>`),
  with the heading, the mount point and the provider script.
- **Post pages only** — a page needs a `date` and must not be `type: page` / `type: index`.
  Home, archives, tag pages and standalone pages never get a widget.
- `comments: false` in front-matter disables it for one page.
- Put `<div data-xfm-comments></div>` in your template to choose the position yourself; the
  plugin then injects only the scripts.
- `site.comments` (`{ provider, title }`) is available in templates.
- Stylesheets the provider needs (Waline, Gitalk, Artalk) are added to `<head>` once, on
  pages that actually mount a widget.
- giscus and beaudar follow the site's `data-theme` toggle via `postMessage`; Waline switches
  by CSS selector, Cusdis uses `auto`.

## License

MIT © xfm0797
