'use strict';
/**
 * 数学公式插件（xfm-plugin-math）
 *
 * 安装：npm i -D xfm-plugin-math —— 装了就生效（也可在 config.plugins 写 'math'）
 * -------------------------------------------------------------------
 * 构建期用 KaTeX 把公式渲染成 HTML，页面里只有 `<span class="katex">`：
 * 前端零 JS、零 CDN 请求（CSS 与字体由本插件复制进站点产物），
 * 首屏不会因为等待脚本而闪一下未渲染的 LaTeX。
 *
 * 支持的写法（与主流 Markdown 编辑器一致）：
 *   $a^2+b^2=c^2$          行内
 *   $$ … $$                块级（可跨行）
 *   \( … \) 与 \[ … \]      LaTeX 习惯用法
 * 围栏代码块、行内代码、缩进代码块里的 `$` 不会被当成公式；`\$` 输出字面美元符号。
 *
 * KaTeX 覆盖绝大多数常用 LaTeX 命令（分式、根式、求和积分、矩阵、多行对齐、
 * 希腊字母、重音、箭头、\text 里的中文……），完整列表见
 * https://katex.org/docs/supported.html
 *
 * 为什么用 markdown 钩子：`$a_1$` 里的下划线会被 Markdown 当成强调，
 * 必须先于解析把公式换成占位符，页面渲染后再换回 KaTeX 的 HTML。
 * 占位符用 Unicode 私用区字符，Markdown 不会碰它们，且自带公式源码
 * （base64url），transformHtml 不需要任何跨阶段状态。
 * 代价：存在 markdown 钩子时生产构建不走 worker 池（见 lib/engine/site.js）。
 *
 * 配置：
 *   math: {
 *     css: 'local',        // 'local' 复制进产物 | 'cdn' 用 CDN | 'none' 自己引
 *     path: 'assets/katex',// css: 'local' 时的产物目录
 *     cdn: 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css',
 *     fonts: 'woff2',      // 'woff2' 只复制 woff2（约 300KB）| 'all' 连 woff/ttf 一起
 *     macros: {},          // 自定义宏，如 { '\\RR': '\\mathbb{R}' }
 *     output: 'html',      // 'html' | 'htmlAndMathml'（后者更利于无障碍，体积更大）
 *     strict: false,       // KaTeX 严格模式
 *   }
 */
const fs = require('fs');
const path = require('path');

const OPEN = '\uE000';
const CLOSE = '\uE001';
const BLOCK_OPEN = '\uE002';
const BLOCK_CLOSE = '\uE003';

const DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css';

/** UTF-8 文本 → base64url（不含 + / =，放进 HTML 与 Markdown 都安全） */
function encode(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** 公式 → 占位符：d 为块级，i 为行内；公式源码编码在占位符里 */
function token(tex, display) {
  return `${OPEN}${display ? 'd' : 'i'}${encode(tex)}${CLOSE}`;
}

/**
 * 把围栏代码块与缩进代码块替换成占位符，避免其中的 `$` 被当成公式
 * （内容原样保存，扫描结束后还原）
 */
function protectCodeBlocks(src, blocks) {
  const lines = src.split('\n');
  const out = [];
  let fence = null;
  let prevBlank = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      out.push(line);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      prevBlank = false;
      continue;
    }

    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = open[1];
      out.push(line);
      prevBlank = false;
      continue;
    }

    // 缩进代码块：空行之后、4 空格或 tab 开头的连续行（含中间空行）
    if (prevBlank && /^(?: {4}|\t)/.test(line)) {
      const body = [];
      let j = i;
      while (j < lines.length && (lines[j].trim() === '' || /^(?: {4}|\t)/.test(lines[j]))) {
        body.push(lines[j]);
        j++;
      }
      const idx = blocks.push(body.join('\n')) - 1;
      out.push(`${BLOCK_OPEN}${idx}${BLOCK_CLOSE}`);
      prevBlank = false;
      i = j - 1;
      continue;
    }

    out.push(line);
    prevBlank = line.trim() === '';
  }

  return out.join('\n');
}

function restoreCodeBlocks(src, blocks) {
  if (!blocks.length) return src;
  return src.replace(/\uE002(\d+)\uE003/g, (m, i) => {
    const b = blocks[Number(i)];
    return b == null ? '' : b;
  });
}

/** 扫描正文里的公式，换成占位符 */
function protectMath(text) {
  let out = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    // 反斜杠：\$ 输出字面 $，\( \[ 走 LaTeX 分隔符
    if (c === '\\') {
      const next = text[i + 1];
      if (next === '$') {
        out += '$';
        i += 2;
        continue;
      }
      if (next === '[' || next === '(') {
        const close = next === '[' ? '\\]' : '\\)';
        const end = text.indexOf(close, i + 2);
        if (end !== -1) {
          const tex = text.slice(i + 2, end).trim();
          if (tex) {
            out += token(tex, next === '[');
            i = end + 2;
            continue;
          }
        }
      }
      out += next === undefined ? c : c + next;
      i += 2;
      continue;
    }

    // 行内代码：整段原样保留
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i))[0];
      const end = text.indexOf(run, i + run.length);
      if (end !== -1) {
        out += text.slice(i, end + run.length);
        i = end + run.length;
      } else {
        out += run;
        i += run.length;
      }
      continue;
    }

    if (c === '$') {
      // 块级 $$…$$（可跨行）
      if (text[i + 1] === '$') {
        const end = text.indexOf('$$', i + 2);
        if (end !== -1) {
          const tex = text.slice(i + 2, end).trim();
          if (tex) {
            out += token(tex, true);
            i = end + 2;
            continue;
          }
        }
        out += '$$';
        i += 2;
        continue;
      }

      // 行内 $…$：不跨行、开 $ 后不留空白、闭 $ 前不是反斜杠、闭 $ 后不接数字，
      // 纯数字不当公式（避免把 $5 吃掉），`\$` 已在上面的反斜杠分支处理
      const m = /^\$(?!\s)([^\n$]+?)(?<!\\)\$(?!\d)/.exec(text.slice(i));
      if (m) {
        const tex = m[1];
        if (tex.trim() === tex) {
          out += token(tex, false);
          i += m[0].length;
          continue;
        }
      }
      out += '$';
      i++;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/** KaTeX 的 dist 目录（插件依赖可能被 npm 提升到上层 node_modules，用 resolve 兜住） */
function katexDist() {
  return path.dirname(require.resolve('katex/dist/katex.min.css'));
}

module.exports = (site) => {
  const conf = (site.config && site.config.math) || {};
  const katex = require('katex');
  const esc = site.helpers.escapeHtml;

  const cssMode = conf.css || 'local';
  const cssPath = String(conf.path || 'assets/katex').replace(/^\/+/, '').replace(/\/+$/, '');
  const cssHref =
    cssMode === 'cdn' ? conf.cdn || DEFAULT_CDN : cssMode === 'local' ? `/${cssPath}/katex.min.css` : '';
  const base = (site.config && site.config.site && site.config.site.base) || '/';

  /** 渲染单个公式；KaTeX 出错时保留可读片段，不让整页构建失败 */
  function renderTex(tex, display) {
    try {
      return katex.renderToString(tex, {
        displayMode: !!display,
        throwOnError: false,
        strict: conf.strict === undefined ? 'ignore' : conf.strict,
        trust: conf.trust === true,
        macros: conf.macros || {},
        output: conf.output || 'html',
        errorColor: conf.errorColor || '#cc0000',
      });
    } catch (e) {
      return `<code class="math-error" title="${esc(e.message)}">${esc(tex)}</code>`;
    }
  }

  return {
    name: 'math',

    markdown(raw) {
      if (!raw) return raw;
      if (raw.indexOf('$') === -1 && raw.indexOf('\\(') === -1 && raw.indexOf('\\[') === -1) return raw;
      const blocks = [];
      let text = protectCodeBlocks(raw, blocks);
      text = protectMath(text);
      text = restoreCodeBlocks(text, blocks);
      return text;
    },

    transformHtml(html) {
      if (!html || html.indexOf(OPEN) === -1) return html;

      let used = 0;
      const out = html.replace(/\uE000([di])([A-Za-z0-9_-]+)\uE001/g, (m, kind, encoded) => {
        used++;
        return renderTex(decode(encoded), kind === 'd');
      });
      if (!used || !cssHref) return out;

      // 样式只在真有公式的页面注入；页面自己引过 katex.css 就不重复
      if (/katex(?:\.min)?\.css/.test(out)) return out;
      const block =
        `<link rel="stylesheet" href="${site.helpers.withBase(base, cssHref)}">` +
        '<style>.katex-display{overflow-x:auto;overflow-y:hidden;padding:.2em 0}.katex-error{color:#cc0000}</style>';
      return /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${block}\n</head>`) : out;
    },

    afterBuild() {
      if (cssMode !== 'local') return [];
      const dist = katexDist();
      let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
      const fontDir = path.join(dist, 'fonts');
      const all = conf.fonts === 'all';
      const keep = all ? /\.(?:woff2|woff|ttf)$/ : /\.woff2$/;
      // 只带 woff2 时把 CSS 里的 woff/ttf 回落源删掉，产物里不留指向不存在文件的 url()
      if (!all) css = css.replace(/,\s*url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '');
      const files = [{ path: `${cssPath}/katex.min.css`, contents: css }];
      for (const name of fs.readdirSync(fontDir)) {
        if (!keep.test(name)) continue;
        files.push({
          path: `${cssPath}/fonts/${name}`,
          contents: fs.readFileSync(path.join(fontDir, name)),
        });
      }
      return files;
    },
  };
};
