---
title: 插件体系：20 行代码生成 sitemap
date: 2026-10-12 10:00:00
tags: [插件, Node.js]
description: 用钩子机制扩展构建流程，从 sitemap 到全文搜索索引都可以做成插件。
category: 工程
layout: post.html
---

# 插件体系

插件是一个导出函数的文件，函数接收 `site`，返回一组钩子：

```js
module.exports = (site) => ({
  name: 'sitemap',
  afterBuild(site) {
    const urls = site.documents
      .map(p => `<url><loc>${site.config.site.url}${p.url}</loc></url>`)
      .join('');
    return [{
      path: 'sitemap.xml',
      contents: `<?xml version="1.0"?><urlset>${urls}</urlset>`
    }];
  }
});
```

把它放进 `plugins/` 目录，XFM 会自动加载，无需任何注册代码。

## 可用的钩子

| 钩子 | 时机 | 能做什么 |
| --- | --- | --- |
| `extendContext` | 收集完成后 | 向 `site` 注入全局数据 |
| `markdown` | Markdown 编译前 | 修改源文本，如变量替换 |
| `transformHtml` | 页面渲染后 | 压缩 HTML、注入脚本 |
| `afterBuild` | 全部写盘前 | 产出额外文件，返回 `{path, contents}` |
| `configureServer` | dev 启动时 | 挂载自定义路由 |

## 官方插件

内核不带插件，官方插件各自发布在 npm 上（`xfm-plugin-*`），站点里装哪个就有哪个：

```bash
npm i -D xfm-plugin-sitemap xfm-plugin-rss xfm-plugin-search
```

- **sitemap**：生成 `sitemap.xml`，自动排除草稿
- **rss** / **feed-json**：RSS 2.0 与 JSON Feed
- **search**：`search.json` + `Ctrl/⌘+K` 面板
- **seo** / **related**：社交元信息、相关推荐
- **math** / **mermaid**：KaTeX 公式与流程图（见[另一篇](/posts/math-and-mermaid/)）
- **share**：文章末尾的分享栏，微博 / 微信 / QQ / X / Telegram / 复制链接，零外部请求
- **minify**、**pwa**、**image-size**、**deadlinks** …

装了就生效；想固定加载顺序时再写进配置：

```js
export default {
  plugins: ['sitemap', 'rss'],
};
```

## 编写搜索索引插件

只需要在 `afterBuild` 里收集正文即可：

```js
afterBuild(site) {
  const index = site.documents.map(d => ({
    title: d.title,
    url: d.url,
    text: d.html.replace(/<[^>]+>/g, ' ').slice(0, 800),
  }));
  return [{ path: 'search.json', contents: JSON.stringify(index) }];
}
```

前端用一个几十行的脚本做模糊匹配，就是完整的站内搜索。

> 插件系统的价值不在功能多，而在于**扩展成本足够低**——加一个文件就生效。
