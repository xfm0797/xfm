'use strict';
/**
 * 新建内容的脚手架（scaffolds/）
 *
 * 与 Hexo 的 `scaffolds/` 同构：站点根目录下的 `scaffolds/<layout>.md` 决定
 * `xfm new <layout> <title>` 生成什么初始内容，支持三个占位符：
 *
 *   {{ title }}   标题
 *   {{ date }}    当前时间（本地时区）
 *   {{ layout }}  目标布局文件名，如 post.html
 *
 * 站点里没有对应文件时用下面的内置模板。`xfm create` 会把内置模板写进
 * 新站点的 scaffolds/ 目录，方便直接改。
 */

const fs = require('fs');
const path = require('path');

/**
 * 三种布局，对应 Hexo 的 post / page / draft
 * - post：content/posts/<slug>.md，进文章列表、RSS、搜索
 * - page：content/<slug>.md，`type: page` 让它留在列表之外（关于、联系这类固定页）
 * - draft：同 post，但 front-matter 带 draft: true，生产构建不输出
 */
const NEW_LAYOUTS = {
  post: { dir: 'posts', layout: 'post.html', draft: false },
  page: { dir: '', layout: 'page.html', draft: false, type: 'page' },
  draft: { dir: 'posts', layout: 'post.html', draft: true },
};

const DEFAULT_SCAFFOLDS = {
  post: [
    '---',
    'title: {{ title }}',
    'date: {{ date }}',
    'description: ""',
    'tags: []',
    'layout: {{ layout }}',
    '---',
    '',
    '开始写作…',
    '',
  ].join('\n'),
  page: [
    '---',
    'title: {{ title }}',
    'date: {{ date }}',
    'type: page',
    'layout: {{ layout }}',
    '---',
    '',
    '在这里写页面内容…',
    '',
  ].join('\n'),
  draft: [
    '---',
    'title: {{ title }}',
    'date: {{ date }}',
    'layout: {{ layout }}',
    'draft: true',
    '---',
    '',
    '草稿内容…',
    '',
  ].join('\n'),
};

/** 站点自带脚手架的路径，展示给用户看用 */
function scaffoldPath(siteRoot, layout) {
  return path.join(siteRoot, 'scaffolds', `${layout}.md`);
}

/**
 * 取模板：站点 scaffolds/<layout>.md 优先，没有就用内置
 * @returns {{ text: string, from: string|null }} from 为 null 表示内置模板
 */
function templateFor(siteRoot, layout) {
  const file = scaffoldPath(siteRoot, layout);
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    /* 没有自定义脚手架：用内置 */
  }
  if (text && text.trim()) return { text, from: path.relative(siteRoot, file).replace(/\\/g, '/') };
  return { text: DEFAULT_SCAFFOLDS[layout] || DEFAULT_SCAFFOLDS.post, from: null };
}

/** 替换 {{ title }} / {{ date }} / {{ layout }}，允许 {{title}} 这种紧凑写法 */
function renderTemplate(text, vars) {
  return text.replace(/\{\{\s*(title|date|layout)\s*\}\}/g, (m, key) =>
    vars[key] == null ? '' : String(vars[key])
  );
}

/**
 * 补齐 front-matter
 *
 * 自定义脚手架可能漏掉字段（标题、布局、type: page、draft），漏了就会出现
 * 「页面变成文章」「草稿被发布」这类难查的问题，这里兜一层。
 * 已有同名字段一律不动。
 */
function ensureFrontMatter(text, fields) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => `${k}: ${v}`);

  if (!text.startsWith('---')) {
    // 完全没写 front-matter：把字段补在最前面
    return `---\n${lines.join('\n')}\n---\n\n${text}`;
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;

  let head = text.slice(3, end);
  for (const line of lines) {
    const key = line.slice(0, line.indexOf(':'));
    if (!new RegExp(`^${key}\\s*:`, 'm').test(head)) head += `\n${line}`;
  }
  return '---' + head + text.slice(end);
}

/**
 * 标题里可能有 `:`、`#`、`-` 开头等 YAML 特殊字符，而模板里的 {{ title }}
 * 是裸插入的 —— 这里统一把 title / description 重新序列化成带引号的字符串，
 * 用户自己写成 `title: "{{ title }}"` 也不会变成双重引号。
 */
function normalizeFrontMatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;

  const head = text
    .slice(4, end)
    .split('\n')
    .map((line) => {
      const m = /^(title|description)\s*:\s*(.*)$/.exec(line);
      if (!m) return line;
      let v = m[2].trim();
      if (!v) return line; // 留空：页面标题回退到文件名，描述为空
      if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
      return `${m[1]}: ${JSON.stringify(v)}`;
    })
    .join('\n');

  return '---\n' + head + text.slice(end);
}

module.exports = {
  NEW_LAYOUTS,
  DEFAULT_SCAFFOLDS,
  scaffoldPath,
  templateFor,
  renderTemplate,
  ensureFrontMatter,
  normalizeFrontMatter,
};
