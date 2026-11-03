---
title: 主题开发指南：从 30 行模板开始
date: 2026-10-20 14:30:00
tags: [主题, 教程]
description: 了解 XFM 的模板语法、继承机制与上下文对象，写出你自己的主题。
layout: post.html
---

# 主题开发指南

XFM 的主题就是一个目录：

```
themes/my-theme/
├── layouts/         # 页面骨架
│   ├── base.html    # 基础布局
│   ├── post.html    # 文章页
│   └── page.html    # 普通页
├── partials/        # 可复用片段
└── assets/          # 样式与脚本
```

## 模板语法

语法与 Nunjucks 几乎一致，学习成本极低。

### 输出与转义

```html
{{ page.title }}        <!-- 自动 HTML 转义 -->
{{ content | safe }}    <!-- 关闭转义，用于注入 HTML -->
```

### 条件与循环

```html
{% if page.tags.length > 0 %}
  <ul>
  {% for tag in page.tags %}
    <li>{{ tag }}</li>
  {% endfor %}
  </ul>
{% else %}
  <p>没有标签</p>
{% endif %}
```

循环体内可用 `loop.index`、`loop.first`、`loop.last`、`loop.length`。

### 继承

子模板用 `{% extend %}` 指定父模板，再用 `{% block %}` 覆盖：

```html
{% extend "base.html" %}
{% block main %}
  <h1>{{ page.title }}</h1>
  {{ content | safe }}
{% endblock %}
```

### 引入片段

```html
{% include "toc.html" %}
```

## 可用的上下文

模板里可以直接访问：

| 变量 | 说明 |
| --- | --- |
| `site.title` | 站点标题 |
| `site.pages` | 全部页面（已排序） |
| `site.posts` | 带日期的文章列表 |
| `site.tags` | 标签聚合，含文章引用 |
| `page.url` / `page.title` / `page.date` | 当前页面元数据 |
| `content` | 渲染后的正文 HTML |
| `headings` | 标题列表，含 id 与层级 |

> 所有数据在构建期就已准备好，模板里不需要任何异步逻辑。

## 编写主题的最佳实践

1. **保持 `base.html` 精简**：只放骨架与全局资源
2. **把重复结构抽到 partials**：卡片、分页、目录
3. **样式使用 CSS 变量**：方便用户覆盖主题色
4. **不要依赖构建时 JavaScript**：产出必须是纯静态 HTML

一条命令切换主题：

```bash
xfm build --theme=themes/minimal
```
