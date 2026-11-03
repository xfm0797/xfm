---
title: 用 Node.js 写一个极致性能的静态站点生成器
date: 2026-10-28 09:00:00
tags: [Node.js, 性能, 架构]
description: 从 Markdown 解析到多线程渲染，拆解一个 1000 页站点 1 秒内构建完成的实现路径。
layout: post.html
---

# 用 Node.js 写一个极致性能的静态站点生成器

静态站点生成器（SSG）看起来很简单：读取 Markdown，套上模板，写出 HTML。但当你把页面数量从 10 页推到 1000 页，真正的瓶颈才会显现出来。

## 瓶颈在哪

一个典型的 SSG 构建分为四个阶段：

| 阶段 | 耗时占比 | 主要开销 |
| --- | --- | --- |
| 扫描与解析 | 15% | 文件 IO、front-matter 解析 |
| Markdown 编译 | 55% | 正则回溯、AST 构造 |
| 模板渲染 | 20% | 模板解析、字符串拼接 |
| 写盘 | 10% | 目录创建与系统调用 |

可以看出，**Markdown 编译 + 模板渲染占了 75%**，而这两步纯 CPU 密集，非常适合并行化。

## 三个关键决策

### 1. 自研线性扫描的 Markdown 编译器

主流 Markdown 解析器（如 markdown-it）为了兼容 CommonMark 的边角情况，会构造完整 AST。这对于博客场景是巨大浪费。

XFM 的做法是**单遍线性扫描 + 轻量正则**：

- 块级用 `while` 逐行推进，不做递归下降
- 行内标签用一次性正则提取，避免多层嵌套回溯
- 代码高亮内置实现，拒绝引入 300KB 的 Prism

::: tip
如果确实需要完整 CommonMark，可以注册 markdown 插件钩子，替换成 remark 或 markdown-it。
:::

### 2. 模板编译成函数

```js
// 模板源码编译后长这样
const fn = new Function('__scope', '__e',
  `with(__scope){ let __o="";
     __o+="<h1>"+__e(title)+"</h1>";
     return __o;
   }`
);
```

渲染时只做字符串拼接，不再解析 AST。一个模板编译一次，之后每次渲染都是纳秒级。

### 3. worker_threads 并行渲染

Node.js 单线程，但有 `worker_threads`。把页面切成 N 片，每个 worker 独立持有主题与已编译模板：

```js
const chunks = Array.from({ length: size }, () => []);
jobs.forEach((job, i) => chunks[i % size].push(job));
const results = await Promise.all(chunks.map(c => runWorker(c, siteCtx)));
```

32 核机器上，1000 页从 3.2 秒降到 **0.9 秒**。

## 增量构建

开发模式不需要重新构建所有页面。XFM 用 `mtime + size + 主题指纹` 计算页面哈希：

```js
p.hash = hash(`${p.layout}|${st.mtimeMs}|${st.size}|${themeFingerprint}`);
if (cache[p.key]?.hash === p.hash) continue; // 命中缓存
```

改一篇文章，只重渲染这一篇，配合 SSE 热更新，**平均 40ms 内浏览器自动刷新**。

## 小结

- 减少抽象层次：不做 AST，直接输出字符串
- 编译期工作不放到运行期：模板一次编译，永久复用
- 把 CPU 密集任务下放给多线程

> 性能不是靠某个神奇技巧，而是靠每一层都不做无用功。
