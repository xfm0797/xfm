---
title: 0.4.14：数据文件、自定义集合与多语言
date: 2026-11-21 10:00:00
tags: [特性, 数据文件, 多语言]
category: 工程
author: xfm
layout: post.html
---

# 0.4.14 新特性

这个示例站已经用上了 0.4.14 的全部新能力，本页即是演示之一：
文章没有写 `description`，列表卡片里的摘要就是引擎从正文自动截断的；
标题下方的署名来自 `data/authors.json`，由本地插件 `plugins/author-byline.js` 注入。

## 全局数据文件

`data/` 下的 `.json` / `.yaml` / `.js` 文件合并成 `site.data`，嵌套目录对应嵌套对象，
模板和插件都能读。改动数据文件会让所有页面缓存失效——任何模板都可能引用它。

## 自定义集合

```js
collections: {
  projects: { title: '作品', description: '用 XFM 做的东西', perPage: 9 },
}
```

`content/projects/` 下的条目归到 [作品列表](/projects/)，按日期排序、支持分页，
默认不进首页文章流与 RSS。模板里还能通过 `site.collections.projects` 拿到清单。

## 多语言

`site.languages: ['zh-CN', 'en']` 开启后，`translationKey` 相同的页面互为翻译：
seo 插件互注 `hreflang`，导航出现语言切换。看看 [关于](/about/) 与
[About](/about-en/) 这对页面，导航条目也按页面语言显示了不同的文案。
