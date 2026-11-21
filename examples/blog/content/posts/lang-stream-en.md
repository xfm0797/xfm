---
title: Splitting the post stream by language
date: 2026-11-21 21:30:00
lang: en
tags: [i18n, engine]
category: Engineering
translationKey: lang-stream
---

# Splitting the post stream by language

**This page is the English half of a translation pair.** Its front-matter says `lang: en` and
shares `translationKey: lang-stream` with [/posts/lang-stream/](/posts/lang-stream/), so the
two cross-link through `hreflang` and the switcher in the nav jumps between them.

It lives at `/posts/lang-stream-en/` and is listed in [/en/](/en/) — not in the Chinese home
page. That is exactly the behaviour 0.4.17 added.

## What `site.languages` now does

- `site.posts` only holds the default language (`languages[0]`)
- home page, `/page/N/`, archives, tag/category/series counts, `prev`/`next`, RSS and JSON
  Feed are filtered the same way, so a translation never appears twice in one list
- `site.postsByLang[lang]` gives every language its own list for templates
- each non-default language that has posts gets `/<lang>/` plus `/<lang>/page/N/`, rendered
  with the home layout; `page.lang` is set there, so `<html lang>` and localized nav labels match
- `xfm-plugin-related` (0.4.3) only recommends posts in the same language

```js
site: { lang: 'zh-CN', languages: ['zh-CN', 'en'] }
```

## Why term pages stay global

`/tags/<name>/` is keyed by name rather than by language, so a term that only exists in
English still gets a page — otherwise every tag link on an English post would be a dead link.
The index pages (`/categories/`, `/tags/`) keep listing the default language only.

## Zero change for single-language sites

Nothing above runs unless `site.languages` declares more than one language, so an existing
site builds byte-identical output.

`postsTotal` is the size of the current list, which is why the sidebar on this page counts
this language only.
