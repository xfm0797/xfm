'use strict';
/**
 * 极简模板引擎
 * ------------------------------------------------------------------
 * 语法与 Nunjucks / Liquid 高度接近，便于迁移。
 * 实现方式：模板一次性编译为 JS 函数（渲染只做字符串拼接），
 * 相比每次解析 AST 的模板引擎，单次渲染开销接近原生字符串拼接。
 *
 *   {{ expr }}                     输出，默认 HTML 转义；{{ expr | safe }} 关闭转义
 *   {{ name | upper | trim }}      过滤器：safe / length / upper / lower / trim / json / default
 *   {% if a > 1 and b %} … {% elif %} … {% else %} … {% endif %}
 *   {% for post in posts %} … {{ loop.index }} … {% else %}空态 … {% endfor %}
 *   {% set x = expr %}
 *   {% include "partials/head.html" %}
 *   {% extend "base.html" %} + {% block main %}…{% endblock %}
 *   {% raw %} 原样输出 {% endraw %}
 *   {# 注释 #}
 *
 * 变量查找：编译后的函数体用 with(scope) 包裹（非严格模式），
 * 未定义变量返回 undefined 而不抛错，写法最接近 Nunjucks。
 * 循环变量与 set 变量写入 scope 而非声明为 const，
 * 这样"循环外引用循环变量"只会得到 undefined，不会抛 ReferenceError。
 */

const { escapeHtml } = require('./markdown');

// 每个模板名只保留一份编译结果（源码变了就原地替换），
// 避免 dev 反复改模板时 Map 无限增长
const fnCache = new Map();

class TemplateError extends Error {}

const LOGIC = { not: '!', and: '&&', or: '||' };

/**
 * 把模板风格的逻辑运算符翻译为 JS 运算符（跳过字符串字面量内部）
 * 同时把成员访问的点号改写成可选链：`a.b.c` → `a?.b?.c`。
 * 这样未定义变量的属性访问得到 undefined 而不是 TypeError，且没有运行时开销
 * （可选链是原生语法，不需要 try/catch 或代理包装）。
 */
function jsExpr(expr) {
  let out = '';
  let quote = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') out += expr[++i] || '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '.' && isMemberDot(expr, i)) {
      out += '?.';
      continue;
    }
    if (c === '[' && isIndexAccess(expr, i)) {
      out += '?.[';
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[\w$]/.test(expr[j])) j++;
      const word = expr.slice(i, j);
      out += LOGIC[word] || word;
      i = j - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * 判断位置 i 的 `.` 是否是成员访问（而非小数点 / 已经带 ?. 的可选链）
 * - 左侧：标识符、`)`、`]`（跳过空白）
 * - 右侧：标识符首字符（跳过空白），且左右不同时为数字（排除 1.5）
 */
function isMemberDot(expr, i) {
  let p = i - 1;
  while (p >= 0 && /\s/.test(expr[p])) p--;
  if (p < 0) return false;
  const prev = expr[p];
  if (prev === '?' || prev === '.') return false;
  if (!/[A-Za-z0-9_$\])]/.test(prev)) return false;
  let q = i + 1;
  while (q < expr.length && /\s/.test(expr[q])) q++;
  const next = expr[q];
  if (!next || !/[A-Za-z0-9_$]/.test(next)) return false;
  if (/\d/.test(prev) && /\d/.test(next)) return false; // 1.5
  return true;
}

/** 关键字后面跟 `[` 是数组字面量，不能改成下标访问 */
const NOT_INDEX = new Set(['in', 'of', 'return', 'typeof', 'void', 'delete', 'case', 'new', 'instanceof']);

/**
 * 判断位置 i 的 `[` 是否是下标访问（`a[0]` / `a["k"]`），而非数组字面量
 * 左侧同样要求标识符 / `)` / `]`，并排除 `in [`、`of [` 这类写法
 */
function isIndexAccess(expr, i) {
  let p = i - 1;
  while (p >= 0 && /\s/.test(expr[p])) p--;
  if (p < 0) return false;
  const prev = expr[p];
  if (prev === '?' || prev === '.' || prev === '{' || prev === '(' || prev === ',' || prev === '=') return false;
  if (!/[A-Za-z0-9_$\])"']/.test(prev)) return false;
  let s = p;
  while (s >= 0 && /[\w$]/.test(expr[s])) s--;
  if (s < p && NOT_INDEX.has(expr.slice(s + 1, p + 1))) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* 过滤器                                                              */
/* ------------------------------------------------------------------ */

const FILTERS = {
  length: (v) => {
    if (v == null) return 0;
    if (typeof v === 'object') return Array.isArray(v) ? v.length : Object.keys(v).length;
    return String(v).length;
  },
  upper: (v) => String(v == null ? '' : v).toUpperCase(),
  lower: (v) => String(v == null ? '' : v).toLowerCase(),
  trim: (v) => String(v == null ? '' : v).trim(),
  json: (v) => JSON.stringify(v) || '',
  default: (v, d) => (v == null || v === '' ? d : v),
};

/** 按 | 切分表达式，跳过字符串与括号内部（|| 视为运算符） */
function splitFilters(raw) {
  const parts = [];
  let cur = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += raw[++i] || '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === '|' && depth === 0) {
      if (raw[i + 1] === '|') {
        cur += '||';
        i++;
        continue;
      }
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}

/** 按逗号切分过滤器参数，跳过引号内部（default("a,b") 不会被切开） */
function splitArgs(raw) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += raw[++i] || '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 把 {{ a | f(x) }} 编译成 JS 表达式；返回 { code, safe } */
function compileOutput(raw, name) {
  const parts = splitFilters(raw);
  let code = jsExpr(parts[0] || '');
  let safe = false;

  for (const part of parts.slice(1)) {
    const m = /^([A-Za-z_$][\w$]*)\s*(?:\(([\s\S]*)\))?$/.exec(part);
    if (!m) throw new TemplateError(`${name}: 无法解析的过滤器 "${part}"`);
    const fnName = m[1];
    if (fnName === 'safe') {
      safe = true;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(FILTERS, fnName)) {
      throw new TemplateError(
        `${name}: 不支持的过滤器 "${fnName}"（可用：safe, ${Object.keys(FILTERS).join(', ')}）`
      );
    }
    const args = m[2] ? splitArgs(m[2]).map((s) => jsExpr(s)).join(', ') : '';
    code = `__F.${fnName}(${code}${args ? ', ' + args : ''})`;
  }
  return { code, safe };
}

/**
 * 编译模板
 * @param {string} source 模板源码
 * @param {string} name 文件名（报错定位）
 * @returns {(ctx:object, env:object)=>string}
 */
function compile(source, name = 'template') {
  const hit = fnCache.get(name);
  if (hit && hit.source === source) return hit.fn;

  const body = [];
  const stack = []; // { kind, restore? }
  let pos = 0;
  let seq = 0;
  const text = (t) => { if (t) body.push(`__o+=${JSON.stringify(t)};`); };

  while (pos < source.length) {
    const i = source.indexOf('{', pos);
    if (i === -1) { text(source.slice(pos)); break; }
    const c1 = source[i + 1];
    const c2 = source[i + 2];

    // {# 注释 #}
    if (c1 === '#') {
      text(source.slice(pos, i));
      const end = source.indexOf('#}', i + 2);
      if (end === -1) throw new TemplateError(`${name}: 注释 {# 未闭合`);
      pos = end + 2;
      continue;
    }

    // {{ 输出 }}
    if (c1 === '{') {
      text(source.slice(pos, i));
      const end = source.indexOf('}}', i + 3);
      if (end === -1) throw new TemplateError(`${name}: 输出标签 {{ 未闭合`);
      const { code, safe } = compileOutput(source.slice(i + 3, end).trim(), name);
      body.push(safe ? `__o+=__s(${code});` : `__o+=__e(${code});`);
      pos = end + 2;
      continue;
    }

    // {% 语句 %}
    if (c1 === '%') {
      text(source.slice(pos, i));
      const end = source.indexOf('%}', i + 2);
      if (end === -1) throw new TemplateError(`${name}: 语句标签 {% 未闭合`);
      const stmt = source.slice(i + 2, end).trim();

      // {% raw %}…{% endraw %}：内容原样输出
      if (stmt === 'raw') {
        const fence = /\{%\s*endraw\s*%\}/g;
        fence.lastIndex = end + 2;
        const close = fence.exec(source);
        const stop = close ? close.index : source.length;
        text(source.slice(end + 2, stop));
        pos = close ? close.index + close[0].length : source.length;
        continue;
      }

      statement(stmt);
      pos = end + 2;
      continue;
    }

    // 普通字符：由于上面用 indexOf('{') 定位，遇到 "{{"/"{%"/"{#" 会命中第二个字符，
    // 这里回退到标签起点重新判断
    const nextCh = source[i - 1];
    if (i > pos && (nextCh === '{' || nextCh === '%' || nextCh === '#')) {
      text(source.slice(pos, i - 1));
      pos = i - 1;
      continue;
    }
    text(source.slice(pos, i + 1));
    pos = i + 1;
  }

  function statement(stmt) {
    const sp = stmt.indexOf(' ');
    const tag = sp === -1 ? stmt : stmt.slice(0, sp);
    const rest = sp === -1 ? '' : stmt.slice(sp + 1).trim();

    switch (tag) {
      case 'if':
        if (!rest) throw new TemplateError(`${name}: if 缺少条件`);
        body.push(`if(${jsExpr(rest)}){`);
        stack.push({ kind: 'if' });
        break;
      case 'elif':
        if (stack[stack.length - 1]?.kind !== 'if') throw new TemplateError(`${name}: elif 缺少对应的 if`);
        body.push(`}else if(${jsExpr(rest)}){`);
        break;
      case 'else':
        if (stack[stack.length - 1]?.kind === 'for') {
          body.push('}if(!__entered){');
          stack[stack.length - 1].kind = 'for-else';
        } else if (stack[stack.length - 1]?.kind === 'if') {
          body.push('}else{');
        } else {
          throw new TemplateError(`${name}: else 缺少对应的 if/for`);
        }
        break;
      case 'endif':
        if (stack.pop()?.kind !== 'if') throw new TemplateError(`${name}: endif 不匹配`);
        body.push('}');
        break;
      case 'for': {
        const m = /^([A-Za-z_$][\w$]*)\s+in\s+([\s\S]+)$/.exec(rest);
        if (!m) throw new TemplateError(`${name}: for 语法应为 {% for item in list %}`);
        const [, id, coll] = m;
        const s = `__seq${seq++}`;
        // 循环变量用 const 声明：块级作用域天然遮蔽 scope 上的同名变量，
        // 循环结束后引用会落回 scope 得到 undefined（而不是 ReferenceError）
        body.push(
          `{const ${s}=__iter(${jsExpr(coll)});let __entered=false;` +
            `for(let __i=0;__i<${s}.length;__i++){__entered=true;` +
            `const ${id}=${s}[__i];` +
            `const loop={index:__i+1,index0:__i,first:__i===0,last:__i===${s}.length-1,length:${s}.length,revindex:${s}.length-__i};`
        );
        stack.push({ kind: 'for' });
        break;
      }
      case 'endfor': {
        const top = stack.pop();
        if (top?.kind !== 'for' && top?.kind !== 'for-else') throw new TemplateError(`${name}: endfor 不匹配`);
        body.push('}}');
        break;
      }
      case 'include': {
        const m = /^(["'])(.+?)\1/.exec(rest);
        if (!m) throw new TemplateError(`${name}: include 需要字符串路径`);
        body.push(`__o+=__inc(${JSON.stringify(m[2].trim())});`);
        break;
      }
      case 'set': {
        const m = /^([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(rest);
        if (!m) throw new TemplateError(`${name}: set 语法应为 {% set x = expr %}`);
        // 写入 scope 而不是 let：允许重复 set、允许在 if/for 内 set 后外部读取
        body.push(`__scope[${JSON.stringify(m[1])}]=${jsExpr(m[2])};`);
        break;
      }
      case 'block':
        body.push('{');
        stack.push({ kind: 'block' });
        break;
      case 'endblock':
        if (stack.pop()?.kind !== 'block') throw new TemplateError(`${name}: endblock 不匹配`);
        body.push('}');
        break;
      case 'extend':
      case 'extends':
        break; // 由 loader 预处理器处理
      default:
        throw new TemplateError(`${name}: 未知标签 {% ${tag} %}`);
    }
  }

  if (stack.length) throw new TemplateError(`${name}: 存在未闭合的 {% ${stack[stack.length - 1].kind} %}`);

  body.push('return __o;');
  const fnBody = `let __o="";${body.join('\n')}`;

  let fn;
  try {
    // with(__scope)：变量先查作用域（含 Object.create(globals) 原型链），不存在则落回全局
    fn = new Function('__scope', '__e', '__s', '__inc', '__iter', '__F', `with(__scope){\n${fnBody}\n}`);
  } catch (e) {
    throw new TemplateError(`${name}: 编译失败 → ${e.message}`);
  }

  const render = (ctx, env) => {
    const scope = Object.create((env && env.globals) || EMPTY);
    if (ctx) {
      for (const k of Object.keys(ctx)) scope[k] = ctx[k];
    }
    return fn(
      makeScope(scope),
      (env && env.escape) || escapeHtml,
      (v) => (v == null ? '' : String(v)),
      (env && env.include) || (() => ''),
      iter,
      FILTERS
    );
  };

  fnCache.set(name, { source, fn: render });
  return render;
}

const EMPTY = Object.freeze({});

/** 全局内置对象：必须让 with 落回全局作用域，否则会被代理拦截成 undefined */
const GLOBALS = new Set(
  ('globalThis,Infinity,NaN,undefined,eval,isFinite,isNaN,parseFloat,parseInt,decodeURI,decodeURIComponent,' +
    'encodeURI,encodeURIComponent,Object,Function,Boolean,Symbol,Error,AggregateError,EvalError,RangeError,' +
    'ReferenceError,SyntaxError,TypeError,URIError,Number,BigInt,Math,Date,String,RegExp,Array,Int8Array,' +
    'Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,' +
    'BigInt64Array,BigUint64Array,Map,Set,WeakMap,WeakSet,ArrayBuffer,SharedArrayBuffer,DataView,Atomics,' +
    'JSON,Promise,Reflect,Proxy,Intl,WeakRef,FinalizationRegistry,escape,unescape,console,' +
    'require,module,exports,process,global,Buffer,setTimeout,setInterval,clearTimeout,clearInterval,queueMicrotask,' +
    'structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,arguments').split(',')
);

/**
 * 作用域代理
 * - has(): 声明"该名字在作用域中存在"，使 with 拦截读取；
 * - JS 全局内置 / 内部变量（__ 前缀）返回 false，交回原生作用域；
 * - get(): 未定义的值返回 undefined，模板不会抛 ReferenceError。
 */
function makeScope(target) {
  return new Proxy(target, {
    has: (t, k) => typeof k === 'string' && !GLOBALS.has(k) && !k.startsWith('__'),
    get: (t, k) => (k === Symbol.unscopables ? undefined : t[k]),
  });
}

function iter(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return Array.from(v);
  if (typeof v === 'object') return Object.keys(v).map((k) => ({ key: k, value: v[k] }));
  return [];
}

module.exports = { compile, TemplateError, iter, FILTERS };
