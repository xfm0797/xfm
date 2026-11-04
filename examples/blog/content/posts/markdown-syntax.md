---
title: "Markdown 语法速查：引用式链接、脚注与更多"
date: 2026-11-04 10:00:00
tags: [markdown, 语法]
description: 除了常见 GFM 语法，XFM 还支持引用式链接、脚注、Setext 标题与缩进代码块。
category: 写作
layout: post.html
---

# Markdown 语法速查

日常写作用得最多的还是标题、列表、表格和代码块。下面这些语法在 XFM 里同样开箱可用，写长文时能省不少事。

## 引用式链接

同一个地址在文里出现多次时，用引用式链接更省心：正文只写 `[XFM 仓库][repo]`，地址统一定义在文末，改一次就全改。简写形式 `[repo]` 也能直接识别。

正文示例：项目源码在 [XFM 仓库][repo]，文档见 [xfm-docs]。

## 脚注

结论后面挂一个脚注[^bench]，读者想深究时再跳转；同一个脚注被引用多次时，回链会分别指回每一处[^bench]。

[^bench]: 数据来自 `npm run bench`，500 篇中文文档，4 核机器，取中位数。

## Setext 标题

连续两个短横线也能构成二级标题，写法更接近手写笔记：

二级标题写法
--------------

注意它只在紧跟段落文字时生效；单独一行 `---` 仍然是分隔线。

## 缩进代码块

不想写围栏时，行首缩进四个空格即可：

    $ npm i -g xfmpress
    $ xfm create my-blog
    $ cd my-blog && xfm dev

## 有序列表可以从任意数字开始

3. 第三步
4. 第四步

## 转义

需要原样输出符号时，用反斜杠转义：\*这不是斜体\*、\`这不是代码\`。

[repo]: https://github.com/xfm0797/xfm
[xfm-docs]: https://github.com/xfm0797/xfm#readme
