# xfm butterfly 主题

仿 [hexo-theme-butterfly](https://github.com/jerryc127/hexo-theme-butterfly) 视觉风格的 xfmpress 内置主题：毛玻璃固定导航、全屏渐变/图片横幅、封面在右的横向文章卡、右侧作者卡与标签云、时间线归档、深浅色切换、阅读进度条与回到顶部。

零依赖、零构建：模板引擎用 xfm 内置的 `{% extend %} / {% block %} / {% include %}`，样式与脚本纯手写。

## 启用

站点配置里指定主题即可：

```js
// xfm.config.mjs
export default {
  theme: 'themes/butterfly', // 或简写 'butterfly'
};
```

## 可选站点字段

都是 `site` 配置里的普通字段，不配也能跑（横幅走渐变、头像走 ✍ 占位）：

| 字段 | 说明 |
| --- | --- |
| `site.banner` | 首页横幅背景图（建议根绝对路径 `/img/banner.jpg` 或外链） |
| `site.subtitle` | 横幅副标题；缺省回退 `site.description` |
| `site.avatar` | 侧栏作者卡头像 |
| `site.copyright` | 页脚版权行 |

## 文章封面

文章 front-matter 加 `cover` 即可，卡片与文章横幅都会用上：

```yaml
---
title: 我的第一篇文章
date: 2026-11-22
cover: /img/hello.jpg   # 建议根绝对路径或外链；Page Bundle 里可写 ./cover.png
---
```

封面只影响 butterfly 主题的展示，不影响 RSS / sitemap / 其它主题。

## 布局

| 布局 | 用途 |
| --- | --- |
| `index.html` | 首页：横幅 + 文章卡 + 侧栏 |
| `post.html` | 文章页：封面横幅 + 正文卡 + 版权框 + 上下篇 + 相关推荐 + TOC |
| `page.html` | 独立页 |
| `archives.html` | 归档时间线（按年分组） |
| `categories.html` | 分类列表页 |
| `taxonomy.html` | 单个分类/标签的文章列表 |
| `collection.html` | 自定义集合列表页 |

## 与其它主题共存

主题目录互不影响；从 `themes/default` 切回来改回 `theme: 'themes/default'` 即可。深浅色偏好存在 `localStorage`（键 `xfm-theme-butterfly`），跟随系统 `prefers-color-scheme`。
