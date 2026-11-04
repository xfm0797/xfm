'use strict';
/**
 * 极简高性能 Markdown 编译器
 * ------------------------------------------------------------------
 * 设计目标：单文件零依赖、线性扫描、避免回溯正则、输出可直接内联的 HTML。
 * 支持：ATX/Setext 标题(自动锚点+目录采集)、段落、强调/加粗/删除线/行内代码、
 *       围栏代码块(带语言钩子)、缩进代码块、GFM 表格、引用、
 *       有序/无序/任务列表(含续行、惰性续行与嵌套)、分隔线、
 *       行内链接 / 引用式链接([text][ref]、[ref])、图片、自动链接、
 *       脚注、反斜杠转义、硬换行、原始 HTML 透传、HTML 实体转义。
 * 不支持（刻意保持精简）：数学公式、定义列表（可由插件注入）。
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

/**
 * 行内语法：一次扫描、named group 分组
 * 分支顺序即优先级：
 *   转义 → 脚注引用 → 行内代码（内容不再解析）→ 自动链接 →
 *   行内链接 → 完整引用 → 简写引用 → 加粗/删除线/斜体 → 裸链接
 * 引用/简写分支放在行内链接之后，保证 `[a](b)` 不会被 `[a]` 抢先命中。
 */
const INLINE = new RegExp(
  [
    '\\\\([\\\\`*_{}\\[\\]()#+\\-.!>~|])', // 1 反斜杠转义
    '\\[\\^([^\\]\\s]+)\\]', // 2 脚注引用
    '(`+)([\\s\\S]*?)\\3', // 3,4 行内代码
    '<(https?:\\/\\/[^\\s>]+)>', // 5 自动链接
    '(!?)\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)', // 6,7,8,9 行内链接/图片
    '(!?)\\[([^\\]]*)\\]\\[([^\\]]*)\\]', // 10,11,12 [text][ref]
    '(!?)\\[([^\\]]+)\\](?!\\(|\\[)', // 13,14 [ref] 简写
    '\\*\\*([^*\\n]+?)\\*\\*', // 15 加粗
    '~~([^~\\n]+?)~~', // 16 删除线
    '(?<![*\\w])\\*([^*\\n]+?)\\*(?![*\\w])', // 17 斜体 *
    '(?<![_\\w])_([^_\\n]+?)_(?![_\\w])', // 18 斜体 _
    '(https?:\\/\\/[^\\s<>()"\\u4e00-\\u9fa5]+[^\\s<>()".,;:!?\\u4e00-\\u9fa5])', // 19 裸链接
  ].join('|'),
  'g'
);

// 预建 9 个正则会话（最大递归深度 8 + 首层），避免递归时反复 new RegExp
const INLINE_POOL = Array.from({ length: 9 }, () => new RegExp(INLINE.source, 'g'));

/** 引用标签归一：大小写不敏感、连续空白折叠 */
function refKey(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 输出链接或图片（统一处理相对链接解析、外链属性与转义） */
function linkTag(href, text, title, env, depth, isImg) {
  const url = env.link ? env.link(href) : href;
  const t = title ? ` title="${escapeHtml(title)}"` : '';
  if (isImg) {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${t} loading="lazy" decoding="async">`;
  }
  const external = /^https?:\/\//.test(href);
  return `<a href="${escapeHtml(url)}"${t}${external ? ' target="_blank" rel="noopener"' : ''}>${inline(text, env, depth + 1)}</a>`;
}

/**
 * 脚注编号：按「首次引用顺序」编号，同一个脚注被多次引用时生成多个回链锚点
 * 定义不存在时保持原样输出（不制造 href="#fn-xxx" 的死链）
 */
function footnoteRef(id, env) {
  const raw = `[^${id}]`;
  const state = env.state;
  if (!state) return escapeHtml(raw);
  const def = state.footnotes.get(refKey(id));
  if (!def) return escapeHtml(raw);
  const n = def.refs.length + 1;
  def.refs.push(n);
  if (def.number === 0) {
    state.fnOrder.push(def);
    def.number = state.fnOrder.length;
  }
  const anchor = n === 1 ? `fnref-${def.key}` : `fnref-${def.key}-${n}`;
  return `<sup class="footnote-ref"><a href="#fn-${escapeHtml(def.key)}" id="${escapeHtml(anchor)}">${def.number}</a></sup>`;
}

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

    if (m[1] !== undefined) {
      out += escapeHtml(m[1]);
    } else if (m[2] !== undefined) {
      out += footnoteRef(m[2], env);
    } else if (m[3]) {
      // 行内代码：内容不解析
      out += '<code>' + escapeHtml(m[4].trim() || m[4]) + '</code>';
    } else if (m[5]) {
      out += `<a href="${escapeHtml(m[5])}" rel="noopener">${escapeHtml(m[5])}</a>`;
    } else if (m[7] !== undefined) {
      out += linkTag(m[8], m[7], m[9], env, depth, m[6] === '!');
    } else if (m[11] !== undefined) {
      const def = env.refs && env.refs.get(refKey(m[12] || m[11]));
      out += def ? linkTag(def.href, m[11], def.title, env, depth, m[10] === '!') : escapeHtml(m[0]);
    } else if (m[14] !== undefined) {
      const def = env.refs && env.refs.get(refKey(m[14]));
      out += def ? linkTag(def.href, m[14], def.title, env, depth, m[13] === '!') : escapeHtml(m[0]);
    } else if (m[15] !== undefined) {
      out += `<strong>${inline(m[15], env, depth + 1)}</strong>`;
    } else if (m[16] !== undefined) {
      out += `<del>${inline(m[16], env, depth + 1)}</del>`;
    } else if (m[17] !== undefined) {
      out += `<em>${inline(m[17], env, depth + 1)}</em>`;
    } else if (m[18] !== undefined) {
      out += `<em>${inline(m[18], env, depth + 1)}</em>`;
    } else {
      out += `<a href="${escapeHtml(m[19])}" target="_blank" rel="noopener">${escapeHtml(m[19])}</a>`;
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
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_QUOTE = /^ {0,3}>\s?(.*)$/;
const RE_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_CONTAINER = /^ {0,3}:{3,}\s*(\w*)\s*(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RE_INDENT_CODE = /^(?: {4}|\t)/;
// [label]: url "title"   —— 引用式链接的定义
const RE_REF_DEF = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+["'(]([^"')]*)["')])?[ \t]*$/;
// [^id]: 脚注内容
const RE_FN_DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

/** 引用定义 / 脚注定义在正式解析前统一收集，正文中这些行不再输出 */
function collectDefinitions(lines, state) {
  const skip = new Uint8Array(lines.length);
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块内的 [x]: y 是代码，不是定义
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const f = RE_FENCE.exec(line);
    if (f) { fence = f[1]; continue; }

    const fn = RE_FN_DEF.exec(line);
    if (fn) {
      const body = [fn[2]];
      skip[i] = 1;
      // 后续缩进行属于同一个脚注（含空行后的缩进行）
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (/^(?: {2,}|\t)/.test(next)) {
          body.push(next.replace(/^(?: {1,4}|\t)/, ''));
          skip[++i] = 1;
          continue;
        }
        if (!next.trim() && i + 2 < lines.length && /^(?: {2,}|\t)/.test(lines[i + 2])) {
          body.push('');
          skip[++i] = 1;
          continue;
        }
        break;
      }
      const key = refKey(fn[1]);
      if (!state.footnotes.has(key)) state.footnotes.set(key, { key, lines: body, refs: [], number: 0 });
      continue;
    }

    const rd = RE_REF_DEF.exec(line);
    if (rd && rd[1][0] !== '^') {
      const key = refKey(rd[1]);
      if (key && !state.refs.has(key)) state.refs.set(key, { href: rd[2], title: rd[3] || '' });
      skip[i] = 1;
    }
  }
  return skip;
}

/** 一次渲染的共享状态：嵌套（引用/容器/脚注）复用，保证锚点与编号不重复 */
function createState(opts) {
  return {
    refs: new Map(),
    footnotes: new Map(),
    fnOrder: [],
    used: new Set(),
    headings: opts.headings || [],
    anchors: opts.anchors !== false,
  };
}

/** 标题的纯文本形式（锚点与目录都用它，避免把链接语法算进 slug） */
function headingText(t) {
  return String(t)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/[`*_~]/g, '')
    .trim();
}

/** 缩进不足时是否应中断列表项：新块起始就中断，否则按惰性续行并入 */
function lazyBreak(line) {
  return (
    RE_HEADING.test(line) ||
    RE_FENCE.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_CONTAINER.test(line) ||
    /^ {0,3}<[a-zA-Z!/]/.test(line)
  );
}

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
 * 解析列表：支持续行、惰性续行与嵌套
 * - 缩进大于当前项的列表项 → 子列表（递归，2/4 空格都能识别）
 * - 缩进大于当前项的普通行 → 该项的续行，合并进同一段
 * - 缩进不足但不是新块起始 → 惰性续行（CommonMark），仍属于当前项
 */
function parseList(lines, start, indent, ordered, env, startNum = 1) {
  const tag = ordered ? 'ol' : 'ul';
  const attrs = ordered ? (startNum !== 1 ? ` start="${startNum}"` : '') : ' class="md-list"';
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
      if (li) {
        const lInd = li[1].length;
        if (lInd <= indent) break; // 回到同级或更外层
        const sub = parseList(lines, i, lInd, /\d/.test(li[2]), env, parseInt(li[2], 10) || 1);
        children += sub.html;
        i = sub.next;
        continue;
      }
      const lInd = l.match(/^ */)[0].length;
      if (lInd > indent) {
        content += ' ' + l.trim(); // 缩进续行
        i++;
        continue;
      }
      if (lazyBreak(l)) break;
      content += ' ' + l.trim(); // 惰性续行
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

/** 文末脚注区：按首次引用顺序编号，支持同一脚注多次引用 */
function renderFootnoteSection(state, opts) {
  let html = '<section class="footnotes">\n<ol>';
  for (let k = 0; k < state.fnOrder.length; k++) {
    const def = state.fnOrder[k];
    const body = renderMarkdown(def.lines.join('\n').trim(), { ...opts, headings: state.headings, __state: state });
    const back = def.refs
      .map((n) => `<a href="#fnref-${escapeHtml(def.key)}${n > 1 ? `-${n}` : ''}" class="footnote-back" aria-label="返回正文">↩</a>`)
      .join(' ');
    html += `\n<li id="fn-${escapeHtml(def.key)}">${body} ${back}</li>`;
  }
  return `${html}\n</ol>\n</section>`;
}

/**
 * 编译 Markdown
 * @param {string} src 源文本
 * @param {object} opts { highlight?:fn|false, link?:fn, headings?:[], anchors?:boolean }
 * @returns {string} html
 */
function renderMarkdown(src, opts = {}) {
  if (!src) return '';
  if (typeof src !== 'string') src = String(src);

  const top = !opts.__state;
  const state = opts.__state || createState(opts);
  const env = { link: opts.link, refs: state.refs, state };
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const skip = collectDefinitions(lines, state);
  const out = [];
  const headings = state.headings;
  const anchors = state.anchors;
  let i = 0;
  let buf = []; // 段落缓冲

  // 嵌套内容（引用 / 容器 / 脚注）共用同一份状态，锚点与脚注编号不会重复
  const sub = (text) => renderMarkdown(text, { ...opts, headings, __state: state });

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

  const pushHeading = (level, text) => {
    const plain = headingText(text);
    const id = anchors ? slugify(plain || text, state.used) : '';
    if (level <= 3 && anchors) headings.push({ level, text: plain, id });
    out.push(`<h${level}${id ? ` id="${id}"` : ''}>${inline(text, env)}</h${level}>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    // 引用定义 / 脚注定义行
    if (skip[i]) { flush(); i++; continue; }

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

    // 标题（ATX）
    const h = RE_HEADING.exec(line);
    if (h) {
      flush();
      pushHeading(h[1].length, h[2]);
      i++;
      continue;
    }

    // 标题（Setext）：`标题` + 下一行 ==== / ----
    if (buf.length && RE_SETEXT.test(line)) {
      const text = buf.join(' ').trim();
      buf = [];
      pushHeading(line.trim()[0] === '=' ? 1 : 2, text);
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
          sub(body.join('\n')) +
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
      out.push(`<blockquote>${sub(body.join('\n'))}</blockquote>`);
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

    // 列表（支持续行、惰性续行与递归子列表）
    const item = RE_ITEM.exec(line);
    if (item && item[1].length <= 3) {
      flush();
      const r = parseList(lines, i, item[1].length, /\d/.test(item[2]), env, parseInt(item[2], 10) || 1);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // 缩进代码块（4 空格或 1 个 tab），只在段落之外生效
    if (!buf.length && RE_INDENT_CODE.test(line)) {
      const body = [];
      i++;
      body.push(line.replace(RE_INDENT_CODE, ''));
      while (i < lines.length) {
        const l = lines[i];
        if (RE_INDENT_CODE.test(l)) { body.push(l.replace(RE_INDENT_CODE, '')); i++; continue; }
        if (!l.trim()) { body.push(''); i++; continue; }
        break;
      }
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push(`<div class="code-block"><pre class="language-text"><code>${escapeHtml(body.join('\n'))}</code></pre></div>`);
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

  if (top && state.fnOrder.length) out.push(renderFootnoteSection(state, opts));
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
