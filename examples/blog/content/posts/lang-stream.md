---
title: 多语言站点：文章流按语言分流
date: 2026-11-21 21:30:00
tags: [多语言, 引擎]
category: 工程
author: xfm
translationKey: lang-stream
---

# 文章流按语言分流

0.4.14 引入多语言时只做了「翻译标记」：`translationKey` 把两个页面认成一对，
`hreflang` 互相指一下，导航里多一个语言切换。但文章流没动——中文首页照样把英文文章
列出来，分类计数把两种语言混着算，RSS 里同一篇文章出现两次。

0.4.17 把这半件事补齐了：**声明 `site.languages` 之后，文章流按语言分流。**

## 分流规则

| 表面 | 多语言站里的行为 |
| --- | --- |
| `site.posts` | 只含默认语言（`languages[0]`）的文章 |
| 首页 + `/page/N/` | 同上，翻译版本不再重复出现 |
| 归档 `/archives/` | 只列默认语言 |
| 分类 / 标签 / 系列 | 索引与计数只算默认语言 |
| `prev` / `next` | 按语言各串各的，不会从中文跳到英文 |
| RSS / JSON Feed | 只推默认语言（按 `documents[].inStream` 过滤） |
| 相关推荐 | 只在同一语言里挑（`xfm-plugin-related` 0.4.3） |

## 其它语言去哪了

每种有文章的非默认语言会自动生成 `/<lang>/` —— 本页的英文版就在
[/en/](/en/)，分页是 `/en/page/N/`，和首页共用同一个布局与 `pagination` 结构：

```js
site: {
  lang: 'zh-CN',
  languages: ['zh-CN', 'en'],   // 除首项外的语言各生成一个语言首页
}
```

模板里想拿「当前语言的文章」用 `site.postsByLang[page.lang]`；列表页还能读
`postsTotal`——`/en/` 上就是英文篇数（右边侧栏那个数字就来自它）。

## 两个细节

- **词条页保留全量**：`/tags/<name>/` 的 URL 只按名字索引，没法按语言拆，
  所以只出现在英文文章里的标签、分类也会生成落地页，否则链接直接 404。
  索引页（`/categories/`、`/tags/`）仍然只列默认语言。
- **单语站零变化**：没声明 `languages`（或只声明一个）时整段逻辑不生效，
  产物与之前逐字节一致。

英文版见 [/posts/lang-stream-en/](/posts/lang-stream-en/)。
