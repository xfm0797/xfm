'use strict';
/**
 * create 脚手架：生成一个可运行的新站点
 * 用法：xfm create my-blog --template=blog|docs [--title="我的站点"]
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES = ['blog', 'docs'];

async function scaffold(args) {
  const target = path.resolve(args._[1] || args._[0] || '.');
  const template = args.template || 'blog';
  if (!TEMPLATES.includes(template)) {
    console.error(`未知模板：${template}（可选：${TEMPLATES.join(' / ')}）`);
    process.exit(1);
  }
  if (fs.existsSync(path.join(target, 'xfm.config.mjs')) && !args.force) {
    console.error(`目录已是一个 xfm 站点：${target}`);
    process.exit(1);
  }

  const name = path.basename(target);
  const title = args.title || name;

  const files = new Map();

  const layout = template === 'docs' ? 'page.html' : 'post.html';
  files.set(
    'xfm.config.mjs',
    `export default {
  site: {
    title: ${JSON.stringify(title)},
    description: '由 xfm 生成的站点',
    lang: 'zh-CN',
    base: '/',
    nav: [
      { title: '首页', url: '/' },
      { title: '关于', url: '/about/' },
    ],
  },
  theme: '${template === 'docs' ? 'docs' : 'default'}',
  plugins: ['sitemap', 'rss'],
  defaults: { layout: '${layout}' },
  server: { port: 4321 },
};
`
  );

  files.set(
    'content/index.md',
    `---
title: 首页
layout: index.html
---
`
  );

  files.set(
    'content/about.md',
    `---
title: 关于
layout: page.html
description: 关于这个站点。
---

# 关于

这是用 [xfm](https://github.com/xfm0797/xfm) 搭建的站点。

## 开始写作

\`\`\`bash
xfm new 我的第一篇文章
xfm dev
\`\`\`
`
  );

  if (template === 'blog') {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    files.set(
      'content/posts/hello-world.md',
      `---
title: 你好，世界
date: ${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}
tags: [随笔]
description: 第一篇文章。
---

# 你好，世界

这是第一篇文章。直接写 Markdown 即可，支持：

- **强调**、[链接](https://example.com)、\`行内代码\`
- 表格、任务列表、提示容器

::: tip 提示
保存文件后，dev 模式会在毫秒级内自动刷新浏览器。
:::
`
    );
  } else {
    files.set(
      'content/docs/getting-started.md',
      `---
title: 快速开始
group: 使用指南
weight: 1
layout: page.html
---

# 快速开始

安装与初始化：

\`\`\`bash
npm i -g xfmpress
xfm create my-site
\`\`\`
`
    );
    files.set(
      'content/docs/configuration.md',
      `---
title: 配置
group: 使用指南
weight: 2
layout: page.html
---

# 配置

编辑 \`xfm.config.mjs\` 即可，所有字段都有合理默认值。
`
    );
  }

  files.set('plugins/.gitkeep', '');
  files.set('public/.gitkeep', '');
  files.set(
    'README.md',
    `# ${title}

由 [xfm](https://github.com/xfm0797/xfm) 驱动。

## 命令

\`\`\`bash
xfm dev      # 本地开发（热更新）
xfm build    # 生产构建 → dist/
\`\`\`
`
  );

  for (const [rel, content] of files) {
    const abs = path.join(target, rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content);
  }

  console.log(`
⚡ ${'站点已创建'}：${path.relative(process.cwd(), target) || '.'}

  主题        ${template}
  下一步

    cd ${path.relative(process.cwd(), target) || '.'}
    xfm dev          # 启动开发服务器
    xfm build        # 生产构建
`);
}

module.exports = { scaffold, TEMPLATES };
