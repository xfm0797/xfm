'use strict';
/**
 * 极简高性能 Markdown 编译器
 * ------------------------------------------------------------------
 * 设计目标：单文件零依赖、线性扫描、避免回溯正则、输出可直接内联的 HTML。
 * 支持：ATX 标题(自动锚点+目录采集)、段落、强调/加粗/删除线/行内代码、
 *       围栏代码块(带语言钩子)、GFM 表格、引用、有序/无序/任务列表(含续行与嵌套)、
 *       分隔线、链接/图片/自动链接、硬换行、原始 HTML 透传、HTML 实体转义。
 * 不支持（刻意保持精简）：脚注、数学公式（可由插件注入）。
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(s) {
  if (typeof s === 'string') return s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 ? s : s.replace(/[&<>"]/g, (c) => ESC[c]);
  return s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ESC[c]);
}

/** 生成 URL 友好锚点：保留中英文与数字，其余折叠为 - */
function slugify(text, used) {
  let base = text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = 'section';
  if (!used) return base;
  let slug = base;
  let i = 1;
  while (used.has(slug)) slug = `${base}-${i++}`;
  used.add(slug);
  return slug;
}

/* ------------------------------------------------------------------ */
/* 行内解析                                                            */
/* ------------------------------------------------------------------ */

// 行内代码、自动链接、链接/图片、强调、删除线、裸链接
const INLINE = new RegExp(
  [
    '(`+)([\\s\\S]*?)\\1', // 1,2 行内代码
    '<(https?:\\/\\/[^\\s>]+)>', // 3 自动链接
    '(!?)\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)', // 4,5,6,7 链接/图片
    '\\*\\*([^*\\n]+?)\\*\\*', // 8 加粗
    '~~([^~\\n]+?)~~', // 9 删除线
    '(?<![*\\w])\\*([^*\\n]+?)\\*(?![*\\w])', // 10 斜体
    '(?<![_\\w])_([^_\\n]+?)_(?![_\\w])', // 11 下划线斜体
    '(https?:\\/\\/[^\\s<>()"\\u4e00-\\u9fa5]+[^\\s<>()".,;:!?\\u4e00-\\u9fa5])', // 12 裸链接
  ].join('|'),
  'g'
);

// 预建 9 个正则会话（最大递归深度 8 + 首层），避免递归时反复 new RegExp
const INLINE_POOL = Array.from({ length: 9 }, () => new RegExp(INLINE.source, 'g'));

function inline(text, env, depth = 0) {
  if (depth > 8) return escapeHtml(text); // 防御异常嵌套
  let out = '';
  let last = 0;
  const re = INLINE_POOL[depth];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      // 行内代码：内容不解析
      out += '<code>' + escapeHtml(m[2].trim() || m[2]) + '</code>';
    } else if (m[3]) {
      out += `<a href="${escapeHtml(m[3])}" rel="noopener">${escapeHtml(m[3])}</a>`;
    } else if (m[5] !== undefined) {
      const isImg = m[4] === '!';
      const href = env.link ? env.link(m[6]) : m[6];
      const title = m[7] ? ` title="${escapeHtml(m[7])}"` : '';
      if (isImg) {
        out += `<img src="${escapeHtml(href)}" alt="${escapeHtml(m[5])}"${title} loading="lazy" decoding="async">`;
      } else {
        const external = /^https?:\/\//.test(m[6]);
        out += `<a href="${escapeHtml(href)}"${title}${external ? ' target="_blank" rel="noopener"' : ''}>${inline(m[5], env, depth + 1)}</a>`;
      }
    } else if (m[8] !== undefined) {
      out += `<strong>${inline(m[8], env, depth + 1)}</strong>`;
    } else if (m[9] !== undefined) {
      out += `<del>${inline(m[9], env, depth + 1)}</del>`;
    } else if (m[10] !== undefined) {
      out += `<em>${inline(m[10], env, depth + 1)}</em>`;
    } else if (m[11] !== undefined) {
      out += `<em>${inline(m[11], env, depth + 1)}</em>`;
    } else {
      out += `<a href="${escapeHtml(m[12])}" target="_blank" rel="noopener">${escapeHtml(m[12])}</a>`;
    }
  }
  out += escapeHtml(text.slice(last));
  return out;
}

/* ------------------------------------------------------------------ */
/* 代码高亮（内置轻量实现，覆盖常见语言的关键字/字符串/注释/数字）      */
/* ------------------------------------------------------------------ */

/**
 * 语言词法配置
 * - kw:      关键字
 * - line:    行注释前缀（数组）
 * - block:   块注释 [开始, 结束]
 * - quotes:  字符串定界符
 * 注意：以前用 `html: ''` 这样的空字符串占位，导致 !KEYWORDS[id] 判断为真、
 * 直接返回未高亮文本 (html/css/jsx 全都失效)。现在改为显式配置，无关键字的
 * 语言只要不在表里走默认分支即可。
 */
const LANGS = {
  js: {
    kw: 'const let var function return if else for while do switch case break continue class extends new this typeof instanceof import export default from async await try catch finally throw yield of in delete void null undefined true false',
    line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'],
  },
  ts: {
    kw: 'const let var function return if else for while do switch case break continue class extends implements interface type enum namespace declare new this typeof instanceof import export default from async await try catch finally throw yield of in delete void null undefined true false as public private protected readonly abstract string number boolean any never unknown',
    line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'],
  },
  jsx: { kw: 'const let var function return if else for while class extends new this import export default from async await try catch finally throw typeof null undefined true false', line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'] },
  tsx: { kw: 'const let var function return if else for while class extends interface type new import export default from async await try catch finally null undefined true false', line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'] },
  java: { kw: 'public private protected class interface extends implements new return if else for while switch case break continue static final void int long double float boolean char String import package try catch finally throw throws this super null true false', line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  c: { kw: 'int char float double void return if else for while switch case break continue struct union enum typedef const static sizeof extern include define unsigned long short', line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  cpp: { kw: 'int char float double void return if else for while switch case break continue struct class union enum typedef const static sizeof namespace using template typename public private protected new delete this nullptr true false bool auto', line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  csharp: { kw: 'public private protected class interface struct new return if else for while switch case break continue static readonly void int string bool var using namespace try catch finally throw this null true false async await', line: ['//'], block: ['/*', '*/'], quotes: ['"', "'"] },
  go: { kw: 'package import func return if else for range switch case default break continue type struct interface var const map chan go defer select nil true false fallthrough', line: ['//'], block: ['/*', '*/'], quotes: ['"', '`'] },
  rust: { kw: 'fn let mut const static struct enum impl trait pub use mod return if else for while loop match break continue move ref self Self unsafe async await dyn where crate super true false None Some Ok Err', line: ['//'], block: ['/*', '*/'], quotes: ['"'] },
  swift: { kw: 'func let var class struct enum protocol extension import return if else for while switch case break continue public private internal static self nil true false guard defer', line: ['//'], block: ['/*', '*/'], quotes: ['"'] },
  kotlin: { kw: 'fun val var class object interface import return if else for while when break continue public private internal open override data sealed null true false', line: ['//'], block: ['/*', '*/'], quotes: ['"'] },
  scala: { kw: 'def val var class object trait import return if else for while match case break object extends with new null true false', line: ['//'], block: ['/*', '*/'], quotes: ['"'] },
  php: { kw: 'function class return if else for while switch case break continue public private protected static new echo namespace use try catch finally throw null true false', line: ['//', '#'], block: ['/*', '*/'], quotes: ['"', "'"] },
  json: { kw: 'true false null', quotes: ['"'] },
  python: { kw: 'def class return if elif else for while in not and or import from as pass break continue try except finally with lambda yield global nonlocal None True False raise assert del is async await', line: ['#'], quotes: ['"', "'"] },
  bash: { kw: 'if then else elif fi for in do done while until case esac function return export local readonly echo cd ls mkdir rm cp mv cat grep sed awk curl exit source set shift', line: ['#'], quotes: ['"', "'"] },
  yaml: { kw: 'true false null yes no on off', line: ['#'], quotes: ['"', "'"] },
  // 标记类语言用独立的轻量规则（见 highlightMarkup / highlightCss）
  html: { markup: true },
  css: { css: true },
  markdown: { plain: true },
};

/** 别名归一：让常见写法都能命中 */
const ALIAS = {
  javascript: 'js', typescript: 'ts', tsx: 'tsx', node: 'js', mjs: 'js', cjs: 'js',
  shell: 'bash', sh: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
  python3: 'python', py: 'python',
  golang: 'go', rs: 'rust',
  cxx: 'cpp', 'c++': 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', 'c#': 'csharp',
  yml: 'yaml', jsonc: 'json', json5: 'json',
  html5: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'html', svg: 'html',
  scss: 'css', sass: 'css', less: 'css', stylus: 'css',
  md: 'markdown', text: 'markdown', txt: 'markdown', plain: 'markdown',
};

/** 语言是否已知（用于给 <pre> 加 class，未知语言按纯文本处理） */
function normalizeLang(lang) {
  const l = String(lang || '').toLowerCase();
  return ALIAS[l] || l;
}

/**
 * 通用高亮：按 lexer 配置切分「注释 / 字符串」，其余部分着色关键字与数字
 * 关键修正：字符串匹配在「已转义」的文本上进行，但 `&quot;` 不是定界符，
 * 原实现会把 &quot; 当成 " 配对，导致后续内容被误判成字符串。
 * 这里先对原始代码做词法切分，再逐段转义，彻底避免实体参与配对。
 */
function highlight(code, lang) {
  const id = normalizeLang(lang);
  const cfg = LANGS[id];
  if (!cfg || cfg.plain) return escapeHtml(code);
  if (cfg.markup) return highlightMarkup(code);
  if (cfg.css) return highlightCss(code);

  const quotes = cfg.quotes || [];
  const segments = []; // { type: 'code'|'comment'|'string', text }

  // 构造扫描器：注释与字符串按出现位置择先匹配
  const linePrefixes = cfg.line || [];
  const blockPairs = cfg.block ? [cfg.block] : [];

  let i = 0;
  let codeStart = 0;
  const n = code.length;
  const special = specialCharsRe(cfg);

  while (i < n) {
    // 用原生正则直接跳到下一个"可能是注释/字符串起点"的字符，
    // 避免对每个字符都做若干次 startsWith（长代码块下差距明显）
    special.lastIndex = i;
    const hit = special.exec(code);
    if (!hit) break;
    i = hit.index;
    const ch = code[i];

    let matched = false;

    // 块注释（优先，避免 /* 被 // 截断）
    for (const [open, close] of blockPairs) {
      if (code.startsWith(open, i)) {
        if (i > codeStart) segments.push({ type: 'code', text: code.slice(codeStart, i) });
        const endIdx = code.indexOf(close, i + open.length);
        const stop = endIdx === -1 ? n : endIdx + close.length;
        segments.push({ type: 'comment', text: code.slice(i, stop) });
        i = stop;
        codeStart = i;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 行注释
    for (const p of linePrefixes) {
      if (code.startsWith(p, i)) {
        if (i > codeStart) segments.push({ type: 'code', text: code.slice(codeStart, i) });
        let end = code.indexOf('\n', i);
        if (end === -1) end = n;
        segments.push({ type: 'comment', text: code.slice(i, end) });
        i = end;
        codeStart = i;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 字符串
    if (quotes.includes(ch)) {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === ch) { j++; break; }
        // 单行字符串不允许跨行（模板字符串除外）
        if (code[j] === '\n' && ch !== '`') break;
        j++;
      }
      if (j > i + 1) {
        if (i > codeStart) segments.push({ type: 'code', text: code.slice(codeStart, i) });
        segments.push({ type: 'string', text: code.slice(i, j) });
        i = j;
        codeStart = i;
        matched = true;
      }
    }
    if (matched) continue;

    i++;
  }
  if (codeStart < n) segments.push({ type: 'code', text: code.slice(codeStart) });

  // 逐段输出：字符串保留 <span class="hl-s"> 外层，内部内容已转义
  let out = '';
  for (const seg of segments) {
    if (seg.type === 'comment') out += `<span class="hl-c">${escapeHtml(seg.text)}</span>`;
    else if (seg.type === 'string') out += `<span class="hl-s">${escapeHtml(seg.text)}</span>`;
    else out += paintCode(escapeHtml(seg.text), id);
  }
  return out;
}

/** 关键字 + 数字着色 */
const kwRegexCache = new Map();

/**
 * 每种语言"特殊字符"的正则（注释/字符串的第一个字符）
 * 用 Set 去重后编成字符类，配合 lastIndex 直接跳到下一个候选位置。
 */
const specialCache = new WeakMap();
function specialCharsRe(cfg) {
  let re = specialCache.get(cfg);
  if (re) return re;
  const chars = new Set();
  for (const p of cfg.line || []) if (p) chars.add(p[0]);
  if (cfg.block && cfg.block[0]) chars.add(cfg.block[0][0]);
  for (const q of cfg.quotes || []) chars.add(q);
  const cls = [...chars].map((c) => c.replace(/[\\\]^[-]/g, '\\$&')).join('');
  re = new RegExp(`[${cls}]`, 'g');
  specialCache.set(cfg, re);
  return re;
}
function paintCode(escaped, id) {
  const cfg = LANGS[id];
  if (!cfg || !cfg.kw) return escaped;
  let kwRe = kwRegexCache.get(id);
  if (!kwRe) {
    const words = cfg.kw.split(/\s+/).filter(Boolean);
    kwRe = new RegExp(`\\b(?:${words.join('|')})\\b`, 'g');
    kwRegexCache.set(id, kwRe);
  }
  return escaped
    .replace(kwRe, (m) => `<span class="hl-k">${m}</span>`)
    .replace(/\b(0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/g, '<span class="hl-n">$1</span>');
}

/**
 * HTML/XML 高亮：标签名、属性名、属性值、注释 分别着色
 * 不追求完整解析，只求 90% 场景视觉正确且零依赖
 */
function highlightMarkup(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      out += `<span class="hl-c">${escapeHtml(code.slice(i, stop))}</span>`;
      i = stop;
      continue;
    }
    if (code[i] === '<') {
      const end = code.indexOf('>', i);
      const stop = end === -1 ? n : end + 1;
      const tag = code.slice(i, stop);
      out += paintTag(tag);
      i = stop;
      continue;
    }
    // 普通文本
    let next = code.indexOf('<', i);
    if (next === -1) next = n;
    out += escapeHtml(code.slice(i, next));
    i = next;
  }
  return out;
}

const TAG_RE = /^(<\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?>)$/;
function paintTag(tag) {
  const m = TAG_RE.exec(tag);
  if (!m) return escapeHtml(tag);
  const [, open, name, attrs, close] = m;
  // 属性：name="value" / name='value' / name
  const paintAttrs = (raw) => {
    let out = '';
    const re = /([\w:@.\[\]-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)?/g;
    let last = 0;
    let am;
    while ((am = re.exec(raw))) {
      out += escapeHtml(raw.slice(last, am.index));
      out += `<span class="hl-a">${escapeHtml(am[1])}</span>`;
      if (am[2]) out += escapeHtml(am[2]);
      if (am[3]) out += `<span class="hl-s">${escapeHtml(am[3])}</span>`;
      last = am.index + am[0].length;
    }
    out += escapeHtml(raw.slice(last));
    return out;
  };
  return `<span class="hl-p">${escapeHtml(open)}</span><span class="hl-k">${escapeHtml(name)}</span>${paintAttrs(attrs)}<span class="hl-p">${escapeHtml(close)}</span>`;
}

/**
 * CSS 高亮
 * 思路：把样式表看作「块结构」——
 *   块外 = 选择器 / @规则（整段着色）
 *   块内 = 声明序列 `prop: value;`，或嵌套块（如 @media）
 * 用递归解析块，避免"逐字符猜上下文"带来的歧义。
 */
function highlightCss(code) {
  let i = 0;
  const n = code.length;

  /** 读一段直到遇到 stopChars 之一（跳过注释与字符串），返回原文 */
  function readUntil(stops) {
    const start = i;
    while (i < n) {
      const c = code[i];
      if (c === '/' && code[i + 1] === '*') {
        const e = code.indexOf('*/', i + 2);
        i = e === -1 ? n : e + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        while (i < n && code[i] !== q) i++;
        i++;
        continue;
      }
      if (stops.includes(c)) break;
      i++;
    }
    return code.slice(start, i);
  }

  function paintDecls() {
    // 已在 { 之后，解析到匹配的 }
    let out = '';
    while (i < n) {
      if (code[i] === '}') { i++; return out + '<span class="hl-p">}</span>'; }
      if (code[i] === ';') { i++; out += '<span class="hl-p">;</span>'; continue; }
      if (/\s/.test(code[i])) { let j = i; while (j < n && /\s/.test(code[j])) j++; out += code.slice(i, j); i = j; continue; }
      if (code[i] === '/' && code[i + 1] === '*') {
        const e = code.indexOf('*/', i + 2);
        const stop = e === -1 ? n : e + 2;
        out += `<span class="hl-c">${escapeHtml(code.slice(i, stop))}</span>`;
        i = stop;
        continue;
      }
      // 读一段：属性名 或 嵌套选择器
      const head = readUntil(['{', '}', ';', ':']);
      if (code[i] === '{') {
        // 嵌套块（@media / 嵌套选择器）
        i++;
        out += `<span class="hl-k">${escapeHtml(head)}</span><span class="hl-p">{</span>`;
        out += paintDecls();
        continue;
      }
      if (code[i] === ':') {
        i++;
        const value = readUntil([';', '}']);
        out += `<span class="hl-a">${escapeHtml(head)}</span><span class="hl-p">:</span><span class="hl-s">${escapeHtml(value)}</span>`;
        continue;
      }
      out += escapeHtml(head);
      if (i < n && (code[i] === ';' || code[i] === '}')) continue;
      if (i >= n) break;
    }
    return out;
  }

  let out = '';
  while (i < n) {
    // 块外：注释
    if (code[i] === '/' && code[i + 1] === '*') {
      const e = code.indexOf('*/', i + 2);
      const stop = e === -1 ? n : e + 2;
      out += `<span class="hl-c">${escapeHtml(code.slice(i, stop))}</span>`;
      i = stop;
      continue;
    }
    if (code[i] === '}') { i++; continue; }
    const sel = readUntil(['{', '}']);
    if (sel.trim()) {
      out += `<span class="${sel.trimStart().startsWith('@') ? 'hl-p' : 'hl-k'}">${escapeHtml(sel)}</span>`;
    } else if (sel) {
      out += sel;
    }
    if (code[i] === '{') {
      i++;
      out += '<span class="hl-p">{</span>';
      out += paintDecls();
    } else if (i < n) {
      i++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 块级解析                                                            */
/* ------------------------------------------------------------------ */

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?\s*(.*)$/;
const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_QUOTE = /^ {0,3}>\s?(.*)$/;
const RE_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_CONTAINER = /^ {0,3}:{3,}\s*(\w*)\s*(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * 解析列表：支持续行与嵌套
 * - 缩进大于当前项的列表项 → 子列表（递归，缩进层级不固定 2 或 4 都能识别）
 * - 缩进大于当前项的普通行 → 该项的续行，合并进同一段
 * @returns {{html:string, next:number}}
 */
function parseList(lines, start, indent, ordered, env) {
  const tag = ordered ? 'ol' : 'ul';
  const attrs = ordered ? '' : ' class="md-list"';
  let html = `<${tag}${attrs}>`;
  let i = start;

  while (i < lines.length) {
    const m = RE_ITEM.exec(lines[i]);
    if (!m) break;
    const ind = m[1].length;
    const itemOrdered = /\d/.test(m[2]);
    if (ind !== indent || itemOrdered !== ordered) break;

    let content = m[3];
    let children = '';
    i++;

    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      const li = RE_ITEM.exec(l);
      const lInd = li ? li[1].length : l.match(/^ */)[0].length;
      if (lInd <= indent) break; // 回到同级或更外层
      if (li) {
        const sub = parseList(lines, i, lInd, /\d/.test(li[2]), env);
        children += sub.html;
        i = sub.next;
        continue;
      }
      content += ' ' + l.trim(); // 续行
      i++;
    }

    const task = /^\[([ xX])\]\s+/.exec(content);
    if (task) {
      const checked = task[1] !== ' ';
      const text = content.slice(task[0].length);
      html += `<li class="task"><span class="task-box${checked ? ' done' : ''}">${
        checked ? '✓' : ''
      }</span>${inline(text, env)}${children}</li>`;
      continue;
    }
    html += `<li>${inline(content, env)}${children}</li>`;
  }

  return { html: `${html}</${tag}>`, next: i };
}

/**
 * 编译 Markdown
 * @param {string} src 源文本
 * @param {object} opts { highlight?:fn, link?:fn, headings?:[] , anchors?:boolean }
 * @returns {string} html
 */
function renderMarkdown(src, opts = {}) {
  if (!src) return '';
  const env = { link: opts.link };
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = opts.headings || [];
  const used = new Set();
  const anchors = opts.anchors !== false;
  let i = 0;
  let buf = []; // 段落缓冲

  const flush = () => {
    if (!buf.length) return;
    // 多行段落先逐行内联，再用 <br> 连接（<br> 不能被转义）
    if (buf.length === 1) {
      out.push('<p>' + inline(buf[0], env) + '</p>');
    } else {
      let acc = '';
      for (let k = 0; k < buf.length; k++) {
        if (k) acc += '<br>';
        acc += inline(buf[k], env);
      }
      out.push('<p>' + acc + '</p>');
    }
    buf = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) { flush(); i++; continue; }

    // 围栏代码
    const fence = RE_FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const lang = (fence[2] || '').toLowerCase();
      const meta = fence[3] || '';
      const body = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith(marker[0].repeat(marker.length)) && /^ {0,3}[`~]+\s*$/.test(l)) { i++; break; }
        body.push(l);
        i++;
      }
      const code = body.join('\n');
      // opts.highlight 语义：false = 关闭高亮；函数 = 自定义高亮器（返回空则回落内置）
      const hl =
        opts.highlight === false
          ? escapeHtml(code)
          : typeof opts.highlight === 'function'
            ? opts.highlight(code, lang) || highlight(code, lang)
            : highlight(code, lang);
      const title = meta && !/^[{}[]/.test(meta) ? `<div class="code-title">${escapeHtml(meta)}</div>` : '';
      out.push(
        `<div class="code-block">${title}<pre class="language-${lang || 'text'}"><code>${hl}</code></pre></div>`
      );
      continue;
    }

    // 标题
    const h = RE_HEADING.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const text = h[2];
      const id = anchors ? slugify(text, used) : '';
      if (level <= 3 && anchors) headings.push({ level, text: text.replace(/[*_`]/g, ''), id });
      out.push(`<h${level}${id ? ` id="${id}"` : ''}>${inline(text, env)}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (RE_HR.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    // ::: 容器（tip / warning / info / danger / details）
    const container = RE_CONTAINER.exec(line);
    if (container) {
      flush();
      const type = container[1] || 'info';
      const title = container[2] || '';
      const body = [];
      i++;
      while (i < lines.length && !/^\s*:::\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 :::
      out.push(
        `<div class="callout callout-${type}">` +
          (title ? `<div class="callout-title">${inline(title, env)}</div>` : '') +
          renderMarkdown(body.join('\n'), opts) +
        '</div>'
      );
      continue;
    }

    // 引用
    if (RE_QUOTE.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && (RE_QUOTE.test(lines[i]) || (body.length && lines[i].trim() && !RE_FENCE.test(lines[i])))) {
        const m = RE_QUOTE.exec(lines[i]);
        body.push(m ? m[1] : lines[i]);
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), opts)}</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''
      );
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let html = '<div class="table-wrap"><table><thead><tr>';
      head.forEach((c, k) => {
        html += `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c, env)}</th>`;
      });
      html += '</tr></thead><tbody>';
      for (const r of rows) {
        html += '<tr>';
        for (let k = 0; k < head.length; k++) {
          html += `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(r[k] || '', env)}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table></div>';
      out.push(html);
      continue;
    }

    // 列表（支持续行与递归子列表）
    const item = RE_ITEM.exec(line);
    if (item && item[1].length <= 3) {
      flush();
      const r = parseList(lines, i, item[1].length, /\d/.test(item[2]), env);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // 原始 HTML 块（独占一行的 <div>...</div> 等）
    if (/^ {0,3}<[a-zA-Z!/]/.test(line)) {
      flush();
      const body = [line];
      i++;
      // 简单闭合判断：标签数平衡则视为块结束
      const opens = (line.match(/<([a-zA-Z][\w-]*)[^/>]*>/g) || []).length;
      const closes = (line.match(/<\/([a-zA-Z][\w-]*)>/g) || []).length;
      if (opens > closes && !/\/>$/.test(line)) {
        while (i < lines.length) {
          const l = lines[i++];
          body.push(l);
          if (l.includes('</')) break;
        }
      }
      out.push(body.join('\n'));
      continue;
    }

    // 段落
    buf.push(line);
    i++;
  }
  flush();
  return out.join('\n');
}

/** 正文首行 H1 与页面标题重复时移除，避免与模板标题重复展示 */
function stripDuplicateH1(html, title) {
  if (!html || !title) return html;
  const m = /^<h1[^>]*>([\s\S]*?)<\/h1>\s*/.exec(html);
  if (!m) return html;
  const text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
  if (text === String(title).trim()) return html.slice(m[0].length);
  return html;
}

module.exports = { renderMarkdown, inline, escapeHtml, slugify, highlight, stripDuplicateH1 };
