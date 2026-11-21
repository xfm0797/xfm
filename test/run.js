'use strict';
/**
 * 测试运行器：node test/run.js
 * 零依赖，覆盖 Markdown / 模板 / front-matter / 配置 / 端到端构建与插件产物
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { renderMarkdown, escapeHtml, slugify, stripDuplicateH1 } = require('../lib/engine/markdown');
const { compile, TemplateError } = require('../lib/engine/template');
const { parseFrontMatter, parseYaml } = require('../lib/engine/frontmatter');
const { loadConfig, deepMerge } = require('../lib/engine/config');
const { formatDate, formatDay } = require('../lib/engine/site');

const BIN = path.join(__dirname, '..', 'bin', 'xfm.js');

/** 脚手架默认不带插件（内核不带插件，装哪个用哪个） */
function scaffoldSite(dir, args = ['--template=blog'], plugins = ['sitemap', 'rss']) {
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [BIN, 'create', dir, ...args, '--force'], { stdio: 'pipe' });
  if (!plugins.length) return dir;
  const file = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.dependencies = Object.assign({}, pkg.dependencies);
  for (const n of plugins) pkg.dependencies['xfm-plugin-' + n] = '^0.4.2';
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  return dir;
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; process.stdout.write(`  ${'\x1b[32m'}✓${'\x1b[0m'} ${name}\n`); })
    .catch((e) => {
      failed++;
      failures.push({ name, e });
      process.stdout.write(`  ${'\x1b[31m'}✗${'\x1b[0m'} ${name}\n      ${e.message.split('\n')[0]}\n`);
      // CI 里同时输出 annotation，失败原因直接出现在 Actions 摘要与 API 上
      if (process.env.GITHUB_ACTIONS) {
        const msg = String(e.message).split('\n')[0].replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
        process.stdout.write(`::error file=test/run.js,title=${name}::${msg}\n`);
      }
    });
}

/* ---------------- Markdown ---------------- */
async function testMarkdown() {
  console.log('\nMarkdown 引擎');

  await test('标题 + 锚点', () => {
    const html = renderMarkdown('## Hello World');
    assert(html.includes('<h2 id="hello-world">'), html);
  });

  await test('中文锚点保留', () => {
    const html = renderMarkdown('## 快速开始指南');
    assert(html.includes('id="快速开始指南"'), html);
  });

  await test('行内样式：加粗/斜体/行内代码/删除线', () => {
    const html = renderMarkdown('**b** *i* `c` ~~d~~');
    assert(html.includes('<strong>b</strong>'), html);
    assert(html.includes('<em>i</em>'), html);
    assert(html.includes('<code>c</code>'), html);
    assert(html.includes('<del>d</del>'), html);
  });

  await test('HTML 转义', () => {
    assert.strictEqual(escapeHtml('<div class="x">'), '&lt;div class=&quot;x&quot;&gt;');
    const html = renderMarkdown('a < b & c');
    assert(html.includes('a &lt; b &amp; c'), html);
  });

  await test('链接与外链', () => {
    const html = renderMarkdown('[内链](/foo/) 与 [外链](https://example.com)');
    assert(html.includes('<a href="/foo/">'), html);
    assert(html.includes('target="_blank"'), html);
  });

  await test('图片', () => {
    const html = renderMarkdown('![描述](/img.png)');
    assert(html.includes('<img src="/img.png" alt="描述"'), html);
  });

  await test('围栏代码块 + 高亮', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');
    assert(html.includes('language-js'), html);
    assert(html.includes('<span class="hl-k">const</span>'), html);
  });

  await test('高亮：html 标签/属性/属性值', () => {
    const html = renderMarkdown('```html\n<div class="a">x</div>\n```');
    assert(html.includes('<span class="hl-k">div</span>'), html);
    assert(html.includes('<span class="hl-a">class</span>'), html);
    assert(html.includes('<span class="hl-s">&quot;a&quot;</span>'), html);
    // 转义后的实体不能被当作字符串定界符
    assert(!html.includes('hl-s&quot;'), html);
  });

  await test('高亮：css 选择器完整（伪类不被切开）', () => {
    const html = renderMarkdown('```css\n.a:hover { color: red; }\n```');
    // 选择器整体作为一个 token，内部的 `:` 不被拆成标点
    const m = html.match(/<span class="hl-k">([^<]*)<\/span>/);
    assert(m && m[1].trim() === '.a:hover', html);
    assert(html.includes('<span class="hl-a">color</span>'), html);
  });

  await test('高亮：字符串内的关键字不高亮', () => {
    const html = renderMarkdown('```js\nconst s = "const let var";\n```');
    const m = html.match(/<span class="hl-s">[^<]*<\/span>/g) || [];
    assert(m.some((x) => x.includes('const let var')), html);
    assert.strictEqual((html.match(/<span class="hl-k">const<\/span>/g) || []).length, 1, html);
  });

  await test('高亮：注释优先于关键字', () => {
    const html = renderMarkdown('```python\n# const 是关键字\nx = 1\n```');
    assert(html.includes('hl-c'), html);
    assert(!html.includes('<span class="hl-k">const</span>'), html);
  });

  await test('高亮：别名与大小写归一', () => {
    for (const [fence, token] of [['javascript', 'const'], ['JS', 'const'], ['sh', 'echo'], ['py', 'def'], ['rs', 'fn']]) {
      const html = renderMarkdown('```' + fence + '\n' + token + ' x\n```');
      assert(html.includes('<span class="hl-k">' + token + '</span>'), fence + ' → ' + html);
    }
  });

  await test('高亮：未知语言降级为纯转义文本', () => {
    const html = renderMarkdown('```nolang_lab\nif (a < b) x();\n```');
    assert(html.includes('&lt;'), html);
    assert(!html.includes('hl-k'), html);
  });

  await test('围栏标题语法', () => {
    const html = renderMarkdown('```js title.js\nconst a = 1;\n```');
    assert(html.includes('title.js'), html);
    assert(html.includes('<span class="hl-k">const</span>'), html);
  });

  await test('表格与对齐', () => {
    const html = renderMarkdown('| a | b |\n|---|:-:|\n| 1 | 2 |');
    assert(html.includes('<table>'), html);
    assert(html.includes('text-align:center'), html);
  });

  await test('任务列表', () => {
    const html = renderMarkdown('- [x] 完成\n- [ ] 待办');
    assert(html.includes('task-box done'), html);
    assert(html.includes('task-box'), html);
  });

  await test('列表续行合并到同一项', () => {
    const html = renderMarkdown('- 第一项\n  这里是续行\n- 第二项');
    assert(html.includes('<li>第一项 这里是续行</li>'), html);
    assert.strictEqual((html.match(/<li>/g) || []).length, 2, html);
  });

  await test('嵌套列表（子列表在父项内部）', () => {
    const html = renderMarkdown('- 父项\n  - 子项一\n  - 子项二\n- 第二个父项');
    assert(html.includes('<li>父项<ul class="md-list"><li>子项一</li><li>子项二</li></ul></li>'), html);
    // 有序列表里嵌无序列表
    const mixed = renderMarkdown('1. 一\n   - 子 a\n2. 二');
    assert(mixed.startsWith('<ol>') && mixed.includes('<ul class="md-list"><li>子 a</li></ul>'), mixed);
  });

  await test('列表不被续行规则吞掉后续块', () => {
    const html = renderMarkdown('- a\n- b\n\n段落\n\n```js\nconst x = 1\n```');
    assert(html.includes('<p>段落</p>'), html);
    assert(html.includes('code-block'), html);
    assert(!html.includes('<li>a段落'), html);
  });

  await test('列表项里的引用与代码块按块渲染', () => {
    const quote = renderMarkdown('1. 第一项\n   > 项内引用\n2. 第二项');
    assert(quote.includes('<blockquote><p>项内引用</p></blockquote>'), quote);
    assert(!quote.includes('&gt; 项内引用'), '引用被当成纯文本转义了：' + quote);
    assert.strictEqual((quote.match(/<li>/g) || []).length, 2, quote);

    const code = renderMarkdown('- 安装：\n  ```bash\n  npm i -g xfmpress\n  ```\n- 下一步');
    assert(code.includes('<pre class="language-bash"><code>npm i -g xfmpress</code></pre>'), code);
    assert(code.includes('<p>安装：</p>'), '块的上一行应成为独立段落：' + code);
    // 代码内容不能被拼进 li 的文本里
    assert(!code.includes('<li>安装： npm i -g xfmpress'), code);

    const callout = renderMarkdown('- 提示\n  ::: tip 注意\n  内容\n  :::');
    assert(callout.includes('callout-tip') && callout.includes('<li><p>提示</p>'), callout);
  });

  await test('引用定义不能打断段落', () => {
    const html = renderMarkdown('前一句\n[a]: /x\n后一句\n\n[a] 还是引用吗');
    assert.strictEqual((html.match(/<p>/g) || []).length, 2, '段落被定义行切断了：' + html);
    assert(html.includes('前一句<br>'), '定义行没留在段落里：' + html);
    // 段中的定义不生效，后面的 [a] 不应被解析成链接
    assert(!html.includes('href="/x"'), '段中的定义被当成真定义了：' + html);

    // 段首（空行之后）的定义照旧生效
    const ok = renderMarkdown('见[文档][d]\n\n[d]: /docs/');
    assert(ok.includes('href="/docs/"'), ok);
  });

  await test('引用', () => {
    const html = renderMarkdown('> 引用文字');
    assert(html.includes('<blockquote>'), html);
  });

  await test('提示容器', () => {
    const html = renderMarkdown('::: warning 注意\n内容\n:::');
    assert(html.includes('callout-warning'), html);
    assert(html.includes('<div class="callout-title">注意</div>'), html);
  });

  await test('分隔线', () => {
    assert(renderMarkdown('---').includes('<hr>'));
  });

  await test('引用式链接与图片', () => {
    const html = renderMarkdown('[官网][home] [home] ![logo][img]\n\n[home]: https://example.com "Example"\n[IMG]: /logo.png');
    assert.strictEqual((html.match(/<a href="https:\/\/example.com"/g) || []).length, 2, html);
    assert(html.includes('title="Example"'), html);
    assert(html.includes('<img src="/logo.png" alt="logo"'), html);
    assert(!html.includes('[home]:'), '定义行不应输出到正文');
    assert(!html.includes('[home]'), '简写引用未解析');
  });

  await test('未定义引用保持原样，代码内不解析', () => {
    const html = renderMarkdown('[未定义] 和 `[未定义]`\n\n```md\n[x][y]\n```');
    assert(html.includes('[未定义] 和'), html);
    assert(html.includes('<code>[未定义]</code>'), html);
    assert(html.includes('[x][y]'), html);
  });

  await test('脚注编号、多次引用与回链', () => {
    const html = renderMarkdown('正文[^a] 再引用[^a] 和[^b]，未知[^zz]\n\n[^a]: 甲\n[^b]: 乙');
    assert(html.includes('id="fnref-a"'), html);
    assert(html.includes('id="fnref-a-2"'), html);
    assert.strictEqual((html.match(/class="footnote-ref"/g) || []).length, 3, html);
    assert(html.includes('<li id="fn-b">'), html);
    assert(html.includes('[^zz]'), '未定义脚注应保持原样');
    assert(!html.includes('[^a]:'), '脚注定义不应输出');
    assert(html.indexOf('甲') < html.indexOf('乙'), '脚注应按首次引用顺序排列');
  });

  await test('脚注定义的块内容缩进 4 空格，2 空格不算', () => {
    // 4 空格：列表属于脚注
    const inside = renderMarkdown('正文[^a]\n\n[^a]: 说明\n    - 列表项');
    assert(inside.includes('<li id="fn-a"><p>说明</p>'), inside);
    assert(/<li id="fn-a">[\s\S]*md-list/.test(inside), '4 空格缩进的列表应进脚注：' + inside);

    // 2 空格：只是段落续行，块内容留在正文（旧实现会吞进脚注）
    const outside = renderMarkdown('正文[^a]\n\n[^a]: 说明\n  - 这是独立列表');
    assert(outside.includes('<ul class="md-list"><li>这是独立列表</li></ul>'), outside);
    assert(!/<li id="fn-a">[\s\S]*md-list/.test(outside), '2 空格的列表不应进脚注：' + outside);

    // 2 空格缩进的普通文字仍算同一段（不破坏既有写法）
    const text = renderMarkdown('正文[^a]\n\n[^a]: 第一行\n  第二行');
    assert(/<li id="fn-a"><p>第一行<br>第二行<\/p>/.test(text), text);

    // 紧跟脚注的独立段落不被吞掉
    const after = renderMarkdown('正文[^a]\n\n[^a]: 说明\n后面这段是独立的');
    assert(after.includes('<p>后面这段是独立的</p>'), after);
  });

  await test('松散列表：项之间有空行仍是同一个列表', () => {
    const html = renderMarkdown('- a\n\n- b');
    assert.strictEqual((html.match(/<ul[^>]*>/g) || []).length, 1, '拆成了多个列表：' + html);
    assert(html.includes('<li><p>a</p></li><li><p>b</p></li>'), html);

    const ol = renderMarkdown('3. 三\n\n4. 四');
    assert(ol.startsWith('<ol start="3">') && ol.includes('<li><p>三</p></li>'), ol);
  });

  await test('松散列表：项内空行后的内容仍属该项', () => {
    const html = renderMarkdown('- 第一段\n\n  第二段\n\n- 第二项');
    assert.strictEqual((html.match(/<li>/g) || []).length, 2, html);
    assert(html.includes('<li><p>第一段</p>'), html);
    assert(html.includes('<p>第二段</p>'), html);
    assert(html.includes('<li><p>第二项</p></li>'), html);

    // 项内空行后接块级内容也认
    const code = renderMarkdown('- 安装\n\n  ```bash\n  npm i\n  ```');
    assert(code.includes('<li><p>安装</p>') && code.includes('code-block'), code);
  });

  await test('松散列表：空行属于外层，内层保持紧凑', () => {
    const html = renderMarkdown('- a\n  - b\n\n- d');
    assert(html.includes('<li><p>a</p>'), '外层应松散：' + html);
    assert(html.includes('<ul class="md-list"><li>b</li></ul>'), '内层不该跟着松散：' + html);
    assert(html.includes('<li><p>d</p></li>'), html);
  });

  await test('列表后的空行不会把后续段落吞进列表', () => {
    const html = renderMarkdown('- a\n- b\n\n段落');
    assert(html.includes('<li>a</li><li>b</li></ul>'), '紧凑列表不该被补 <p>：' + html);
    assert(html.includes('<p>段落</p>'), html);
    // 空行之后的惰性续行不算本项（CommonMark）
    const lazy = renderMarkdown('- a\n\n无缩进的下一段');
    assert(lazy.includes('<li>a</li></ul>') && lazy.includes('<p>无缩进的下一段</p>'), lazy);
  });

  await test('Setext 标题', () => {
    const html = renderMarkdown('一级\n===\n\n二级\n---');
    assert(html.includes('<h1 id="一级">'), html);
    assert(html.includes('<h2 id="二级">'), html);
  });

  await test('缩进代码块', () => {
    const html = renderMarkdown('    const a = 1;\n    <b>');
    assert(html.includes('<pre class="language-text">'), html);
    assert(html.includes('&lt;b&gt;'), html);
    assert(!html.includes('<b>'), '缩进代码块内容不应被当成 HTML');

    // 段落行首 1–3 个空格只是缩进，不算内容
    assert.strictEqual(renderMarkdown('   foo'), '<p>foo</p>');
  });

  await test('列表项首就是缩进代码块', () => {
    // `-` 后 5 个空格：多出来的空格属于内容，构成项首的缩进代码块
    const html = renderMarkdown('-     const a = 1\n      more\n- 下一项');
    assert(html.includes('<pre class="language-text"><code>const a = 1\nmore</code></pre>'), html);
    assert(!html.includes('<li>const a'), '代码内容被当成列表文字了：' + html);

    const nested = renderMarkdown('- a\n  -     code\n        more');
    assert(/<ul class="md-list"><li>a<ul class="md-list"><li><div class="code-block">/.test(nested), nested);

    // 空行后接 4 空格（相对内容缩进只有 2 格）仍是段落，不是代码
    const para = renderMarkdown('- foo\n\n    code');
    assert(para.includes('<p>code</p>'), para);
  });

  await test('列表惰性续行', () => {
    const html = renderMarkdown('- 第一项\n无缩进续行\n- 第二项');
    assert(html.includes('<li>第一项 无缩进续行</li>'), html);
    assert.strictEqual((html.match(/<li>/g) || []).length, 2, html);
  });

  await test('有序列表起始编号', () => {
    assert(renderMarkdown('3. 三\n4. 四').includes('<ol start="3">'));
    assert(renderMarkdown('1. 一').includes('<ol>'));
  });

  await test('反斜杠转义', () => {
    const html = renderMarkdown('\\*不是斜体\\* \\`不是代码\\`');
    assert(html.includes('*不是斜体*'), html);
    assert(html.includes('`不是代码`'), html);
    assert(!html.includes('<em>'), html);
  });

  await test('标题锚点忽略行内语法', () => {
    const headings = [];
    renderMarkdown('## 用 [xfm](/x) **构建**', { headings });
    assert.strictEqual(headings.length, 1);
    assert.strictEqual(headings[0].text, '用 xfm 构建', JSON.stringify(headings));
    assert.strictEqual(headings[0].id, '用-xfm-构建', headings[0].id);
  });

  await test('引用块内可使用文档级链接定义', () => {
    const html = renderMarkdown('> 见 [文档][d]\n\n[d]: /docs/');
    assert(html.includes('<a href="/docs/">文档</a>'), html);
  });

  await test('摘要剔除引用定义与脚注标记', () => {
    const { markdownPlain } = require('../lib/engine/render');
    const text = markdownPlain('[文字][ref] 和脚注[^1]\n\n[ref]: https://x.example\n[^1]: 注释');
    assert(text.includes('文字'), text);
    assert(!text.includes('https://x.example'), text);
    assert(!text.includes('[^1]'), text);
  });

  await test('目录采集', () => {
    const headings = [];
    renderMarkdown('## A\n\n### B\n\n#### 不采集\n\n## C', { headings });
    assert.strictEqual(headings.length, 3, JSON.stringify(headings));
  });

  await test('slug 冲突自动编号', () => {
    const used = new Set();
    const a = slugify('重复', used);
    const b = slugify('重复', used);
    assert.notStrictEqual(a, b);
  });

  await test('正文 H1 去重', () => {
    const html = renderMarkdown('# 我的标题\n\n正文');
    const out = stripDuplicateH1(html, '我的标题');
    assert(!out.startsWith('<h1'), out);
  });

  await test('性能：1000 段落线性耗时', () => {
    const md = Array.from({ length: 1000 }, (_, i) => `段落 ${i}，包含 **加粗** 与 \`代码\`。`).join('\n\n');
    const t = performance.now();
    renderMarkdown(md);
    const ms = performance.now() - t;
    assert(ms < 300, `耗时 ${ms.toFixed(0)}ms 超出预期`);
  });
}

/* ---------------- 模板 ---------------- */
async function testTemplate() {
  console.log('\n模板引擎');

  await test('变量输出与转义', () => {
    const t = compile('{{ v }}', 't');
    assert.strictEqual(t({ v: '<b>' }, {}), '&lt;b&gt;');
  });

  await test('safe 过滤器', () => {
    const t = compile('{{ v | safe }}', 't');
    assert.strictEqual(t({ v: '<b>' }, {}), '<b>');
  });

  await test('if / else / elif', () => {
    const t = compile('{% if a %}A{% elif b %}B{% else %}C{% endif %}', 't');
    assert.strictEqual(t({ a: 1 }, {}), 'A');
    assert.strictEqual(t({ a: 0, b: 1 }, {}), 'B');
    assert.strictEqual(t({}, {}), 'C');
  });

  await test('for 循环与 loop 变量', () => {
    const t = compile('{% for x in list %}{{ loop.index }}:{{ x }};{% else %}空{% endfor %}', 't');
    assert.strictEqual(t({ list: ['a', 'b'] }, {}), '1:a;2:b;');
    assert.strictEqual(t({ list: [] }, {}), '空');
  });

  await test('and / or / not 运算符', () => {
    const t = compile('{% if a and b %}Y{% endif %}{% if not a %}N{% endif %}', 't');
    assert.strictEqual(t({ a: 1, b: 1 }, {}), 'Y');
    assert.strictEqual(t({ a: 0 }, {}), 'N');
  });

  await test('set 与表达式', () => {
    const t = compile('{% set n = a * 2 %}{{ n }}', 't');
    assert.strictEqual(t({ a: 21 }, {}), '42');
  });

  await test('未定义变量不抛错', () => {
    const t = compile('{{ missing }}', 't');
    assert.strictEqual(t({}, {}), '');
    const t2 = compile('{% if nope %}Y{% else %}N{% endif %}', 't2');
    assert.strictEqual(t2({}, {}), 'N');
  });

  await test('未定义变量的属性与下标访问安全', () => {
    const t = compile('[{{ a.b }}][{{ a.b.c }}][{{ a.b[0] }}][{{ a.b[0].c }}]', 't');
    assert.strictEqual(t({}, {}), '[][][][]');
    // 正常访问、数字字面量、方法调用不受影响
    const t2 = compile('{{ page.title }}|{{ list[0] }}|{{ 1.5 }}|{{ s.split(",").join("-") }}', 't2');
    assert.strictEqual(t2({ page: { title: 'T' }, list: [9], s: 'a,b' }, {}), 'T|9|1.5|a-b');
    // 数组字面量不能被当成下标
    const t3 = compile('{% for x in [1,2] %}{{ x }}{% endfor %}', 't3');
    assert.strictEqual(t3({}, {}), '12');
  });

  await test('include 支持', () => {
    const t = compile('前{% include "inc.html" %}后', 't');
    assert.strictEqual(t({}, { include: () => 'INC' }), '前INC后');
  });

  await test('全局变量', () => {
    const t = compile('{{ siteName }}', 't');
    assert.strictEqual(t({}, { globals: { siteName: 'demo' } }), 'demo');
  });

  await test('语法错误提示', () => {
    assert.throws(() => compile('{% endif %}', 't'), TemplateError);
    assert.throws(() => compile('{% for %}', 't'), TemplateError);
  });

  await test('字符串字面量里的 and / or 不被改写', () => {
    const t = compile('{{ "a and b or c" }}', 't');
    assert.strictEqual(t({}, {}), 'a and b or c');
  });

  await test('未知过滤器报错而不是静默输出 0', () => {
    assert.throws(() => compile('{{ x | nosuchfilter }}', 't'), /不支持的过滤器/);
  });

  await test('过滤器链', () => {
    const t = compile('{{ " ab " | trim | upper }}/{{ list | length }}/{{ nope | default("d") }}', 't');
    assert.strictEqual(t({ list: [1, 2, 3] }, {}), 'AB/3/d');
  });

  await test('raw 原样输出', () => {
    const t = compile('{% raw %}{{ x }}{% endraw %}', 't');
    assert.strictEqual(t({ x: 1 }, {}), '{{ x }}');
  });

  await test('循环外引用循环变量不抛错', () => {
    const t = compile('{% for x in [1,2] %}{{ x }}{% endfor %}[{{ x }}]', 't');
    assert.strictEqual(t({}, {}), '12[]');
  });

  await test('重复 set 与 for 内 set', () => {
    const t = compile('{% set a = 1 %}{{ a }}{% set a = 2 %}{{ a }}{% for i in [1] %}{% set a = i %}{% endfor %}{{ a }}', 't');
    assert.strictEqual(t({}, {}), '121');
  });

  await test('性能：10000 次渲染', () => {
    const t = compile('{% for i in items %}<li>{{ i.name }}</li>{% endfor %}', 't');
    const data = { items: Array.from({ length: 50 }, (_, i) => ({ name: 'x' + i })) };
    const start = performance.now();
    for (let i = 0; i < 10000; i++) t(data, {});
    const ms = performance.now() - start;
    assert(ms < 1500, `耗时 ${ms.toFixed(0)}ms 超出预期`);
  });
}

/* ---------------- front-matter ---------------- */
async function testFrontMatter() {
  console.log('\nFront-matter 与配置');

  await test('基础解析', () => {
    const { data, content } = parseFrontMatter('---\ntitle: 测试\ndraft: false\n---\n正文');
    assert.strictEqual(data.title, '测试');
    assert.strictEqual(data.draft, false);
    assert.strictEqual(content, '正文');
  });

  await test('数组（行内与多行）', () => {
    const { data } = parseFrontMatter('---\ntags: [a, b]\n---\nx');
    assert.deepStrictEqual(data.tags, ['a', 'b']);
    const r2 = parseFrontMatter('---\ntags:\n  - one\n  - two\n---\nx');
    assert.deepStrictEqual(r2.data.tags, ['one', 'two']);
  });

  await test('嵌套对象', () => {
    const y = parseYaml('meta:\n  author: 张三\n  age: 30');
    assert.deepStrictEqual(y.meta, { author: '张三', age: 30 });
  });

  await test('数字与多行字符串', () => {
    const { data } = parseFrontMatter('---\nweight: 3\nsummary: |\n  第一行\n  第二行\n---\nx');
    assert.strictEqual(data.weight, 3);
    assert.strictEqual(data.summary, '第一行\n第二行');
  });

  await test('无 front-matter', () => {
    const r = parseFrontMatter('普通内容');
    assert.deepStrictEqual(r.data, {});
  });

  await test('BOM 开头的文件仍能解析 front-matter', () => {
    // Windows 编辑器常见的 UTF-8 with BOM：BOM 会让 startsWith('---') 落空，
    // 结果是整块 front-matter 被当成正文，标题退回文件名、日期和布局全丢
    const r = parseFrontMatter('\ufeff---\ntitle: 带 BOM\ndate: 2026-01-02\n---\n正文');
    assert.strictEqual(r.data.title, '带 BOM', JSON.stringify(r.data));
    assert.strictEqual(r.data.date, '2026-01-02');
    assert.strictEqual(r.content, '正文');
  });

  await test('date-only 按本地日历日解析', () => {
    // new Date('2026-11-10') 是 UTC 零点，UTC-5 会退到 11 月 9 日
    const d = formatDate('2026-11-10');
    assert.strictEqual(d.getHours(), 0, 'date-only 应是本地零点，实际 ' + d.getHours() + ' 点');
    assert.strictEqual(formatDay(d), '2026-11-10');
    // 带时间的写法（Hexo 风格）也按本地时间解释，且不丢时分
    const t = formatDate('2026-11-10 22:30:15');
    assert.strictEqual(t.getHours(), 22);
    assert.strictEqual(t.getMinutes(), 30);
    assert.strictEqual(formatDay(t), '2026-11-10');
    assert.strictEqual(formatDate('不是日期'), null);
  });

  await test('配置深合并', () => {
    const merged = deepMerge({ a: { x: 1, y: 2 }, b: [1] }, { a: { y: 9 } });
    assert.deepStrictEqual(merged, { a: { x: 1, y: 9 }, b: [1] });
  });

  await test('加载站点配置', async () => {
    const cfg = await loadConfig(path.join(__dirname, '..', 'examples', 'blog'));
    assert.strictEqual(cfg.site.title, 'XFM Notes');
    assert.strictEqual(cfg.theme, 'themes/default');
  });

  await test('同一毫秒内改写 .mjs 配置也能读到新值', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-cfg-'));
    const file = path.join(dir, 'xfm.config.mjs');
    const realNow = Date.now;
    // 把时钟钉死：只要实现用 Date.now() 做 cache-busting，两次 import 就会撞 URL 命中旧模块
    Date.now = () => 1700000000000;
    try {
      fs.writeFileSync(file, "export default { site: { title: 'A' } };\n");
      const a = await loadConfig(dir);
      fs.writeFileSync(file, "export default { site: { title: 'B' } };\n");
      const b = await loadConfig(dir);
      assert.strictEqual(a.site.title, 'A');
      assert.strictEqual(b.site.title, 'B', '配置被 ESM 模块缓存住了');
    } finally {
      Date.now = realNow;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

/* ---------------- 端到端构建 ---------------- */
async function testBuild() {
  console.log('\n端到端构建');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-test-'));
  const { execFileSync, spawnSync } = require('child_process');
  const bin = path.join(__dirname, '..', 'bin', 'xfm.js');

  scaffoldSite(tmp, ['--template=blog', '--title=测试站']);
  execFileSync(process.execPath, [bin, 'build', tmp], { stdio: 'pipe' });

  await test('首页与文章页生成', () => {
    assert(fs.existsSync(path.join(tmp, 'dist', 'index.html')));
    assert(fs.existsSync(path.join(tmp, 'dist', 'posts', 'hello-world', 'index.html')));
    assert(fs.existsSync(path.join(tmp, 'dist', 'about', 'index.html')));
  });

  await test('sitemap / rss / robots 产物', () => {
    assert(fs.existsSync(path.join(tmp, 'dist', 'sitemap.xml')));
    assert(fs.existsSync(path.join(tmp, 'dist', 'feed.xml')));
    assert(fs.existsSync(path.join(tmp, 'dist', 'robots.txt')));
    const rss = fs.readFileSync(path.join(tmp, 'dist', 'feed.xml'), 'utf8');
    assert(rss.includes('<rss'), 'rss 头缺失');
    assert(rss.includes('你好，世界'), '文章未进入 rss');
  });

  await test('重复构建：内容没变的页面不重写，改过的才重写', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-inc-'));
    try {
      scaffoldSite(dir, ['--template=blog', '--title=增量站']);
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });

      const page = path.join(dir, 'dist', 'posts', 'hello-world', 'index.html');
      const first = fs.readFileSync(page, 'utf8');
      const mtime = fs.statSync(page).mtimeMs;

      // 第二次：产物一致，应当整批跳过
      const out = execFileSync(process.execPath, [bin, 'build', dir], { encoding: 'utf8' });
      assert(/未变化/.test(out), '第二次构建没有报告跳过：' + out);
      assert.strictEqual(fs.statSync(page).mtimeMs, mtime, '内容没变的页面被重写了');
      assert.strictEqual(fs.readFileSync(page, 'utf8'), first, '产物内容变了');

      // 改一篇文章：这一页重写，别的页面不动
      const src = path.join(dir, 'content', 'posts', 'hello-world.md');
      fs.appendFileSync(src, '\n\n新增的一段话。\n');
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(fs.readFileSync(page, 'utf8').includes('新增的一段话'), '改过的页面没重写');
      assert(fs.statSync(page).mtimeMs > mtime, '改过的页面 mtime 没变');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('删掉文章后旧产物与其目录一起清掉', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-inc-del-'));
    try {
      scaffoldSite(dir, ['--template=blog', '--title=清理站']);
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const dirOut = path.join(dir, 'dist', 'posts', 'hello-world');
      assert(fs.existsSync(path.join(dirOut, 'index.html')), '首次构建没产物');

      fs.rmSync(path.join(dir, 'content', 'posts', 'hello-world.md'));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(!fs.existsSync(path.join(dirOut, 'index.html')), '陈旧页面没删掉');
      assert(!fs.existsSync(dirOut), '空目录没清掉');
      // 兄弟目录不能被误删
      assert(fs.existsSync(path.join(dir, 'dist', 'about', 'index.html')), '误删了别的页面');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('插件装了就生效：package.json 依赖自动发现，不必写配置', () => {
    const { Site } = require('../lib/engine/site');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-plug-auto-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'auto', dependencies: { 'xfm-plugin-seo': '^0.4.2' }, devDependencies: { 'xfm-plugin-llms': '^0.4.2' } })
      );
      const site = new Site({ site: {}, plugins: [], theme: 'default', defaults: {} }, dir);
      site.plugins.loadAuto(dir);
      assert.deepStrictEqual(site.plugins.names(), ['llms', 'seo'], '自动发现结果不对：' + site.plugins.names());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('显式短名与自动发现指向同一个插件时只注册一次', () => {
    const { Site } = require('../lib/engine/site');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-plug-dedupe-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'd', dependencies: { 'xfm-plugin-rss': '^0.4.2' } }));
      const site = new Site({ site: {}, plugins: ['rss'], theme: 'default', defaults: {} }, dir);
      site.plugins.load('rss', dir);
      site.plugins.loadAuto(dir);
      assert.deepStrictEqual(site.plugins.names(), ['rss'], '同一插件被注册了两次');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('插件未安装时报错并给出安装命令', () => {
    const { Site } = require('../lib/engine/site');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-plug-miss-'));
    try {
      const site = new Site({ site: {}, plugins: [], theme: 'default', defaults: {} }, dir);
      assert.throws(() => site.plugins.load('no-such-plugin', dir), /npm i -D xfm-plugin-no-such-plugin/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('xfm create 合并已有的 package.json，不冲掉装好的插件', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-plug-merge-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify(
          { name: 'keep-me', scripts: { test: 'echo hi' }, dependencies: { 'xfm-plugin-rss': '^0.4.2' } },
          null,
          2
        )
      );
      scaffoldSite(dir, ['--template=blog'], []);
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      assert.strictEqual(pkg.name, 'keep-me', '已有 name 被覆盖');
      assert.strictEqual(pkg.scripts.test, 'echo hi', '已有 scripts 被覆盖');
      assert.strictEqual(pkg.scripts.dev, 'xfm dev', '没有补上 dev 脚本');
      assert(pkg.dependencies && pkg.dependencies['xfm-plugin-rss'], '依赖被脚手架冲掉了');

      // 依赖还在，插件就还应该生效
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(fs.existsSync(path.join(dir, 'dist', 'feed.xml')), 'create 之后插件不再自动加载');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('插件不再随内核发布：lib/plugins 目录已移除', () => {
    assert(!fs.existsSync(path.join(__dirname, '..', 'lib', 'plugins')), 'lib/plugins 仍存在');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    assert(!deps.some((d) => d.startsWith('xfm-plugin-')), '内核不该依赖任何插件包');
  });

  await test('HTML 语义结构', () => {
    const html = fs.readFileSync(path.join(tmp, 'dist', 'posts', 'hello-world', 'index.html'), 'utf8');
    assert(html.includes('<h1'), '缺少 h1');
    assert(html.includes('lang="zh-CN"'), '缺少 lang');
    assert(html.includes('/assets/style.css'), '缺少样式引用');
  });

  await test('目录滚动高亮脚本随文章页下发', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-toc-'));
    try {
      scaffoldSite(dir);
      fs.writeFileSync(
        path.join(dir, 'content', 'posts', 'toc-demo.md'),
        '---\ntitle: 目录演示\ndate: 2026-01-01\n---\n\n## 第一节\n\n正文\n\n### 小节\n\n正文\n\n## 第二节\n\n正文\n'
      );
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });

      assert(fs.existsSync(path.join(dir, 'dist', 'assets', 'toc.js')), 'toc.js 没被复制到 dist/assets');

      const html = fs.readFileSync(path.join(dir, 'dist', 'posts', 'toc-demo', 'index.html'), 'utf8');
      assert(html.includes('<script src="/assets/toc.js" defer></script>'), '文章页没有引入 toc.js');
      assert(html.includes('href="#第一节"'), '目录锚点与标题 id 不一致');
      assert(html.includes('class="toc-h3"'), '缺少三级标题缩进');

      // 无标题的页面不白拉一次请求
      const page = fs.readFileSync(path.join(dir, 'dist', 'about', 'index.html'), 'utf8');
      assert(!page.includes('toc.js'), '没有目录的页面也引入了 toc.js');

      const css = fs.readFileSync(path.join(dir, 'dist', 'assets', 'style.css'), 'utf8');
      assert(css.includes('.toc li a.is-active'), '缺少当前项高亮样式');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('首页 title 拼上站点名', () => {
    const home = fs.readFileSync(path.join(tmp, 'dist', 'index.html'), 'utf8');
    const m = /<title>([^<]*)<\/title>/.exec(home);
    assert(m && m[1].includes('测试站'), '首页 title 缺少站点名：' + (m && m[1]));
    const post = fs.readFileSync(path.join(tmp, 'dist', 'posts', 'hello-world', 'index.html'), 'utf8');
    const mp = /<title>([^<]*)<\/title>/.exec(post);
    assert(mp[1].includes('你好，世界') && mp[1].includes('测试站'), '文章页 title 不完整：' + mp[1]);
  });

  await test('create 生成的站点带 .gitignore', () => {
    const gi = path.join(tmp, '.gitignore');
    assert(fs.existsSync(gi), '没有生成 .gitignore，build 后 dist/ 会全进版本库');
    const text = fs.readFileSync(gi, 'utf8');
    for (const rule of ['dist/', '.xfm/', 'node_modules/']) {
      assert(text.includes(rule), '.gitignore 缺少 ' + rule + '：' + text);
    }
  });

  await test('create 不覆盖已有的 .gitignore', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-gi-'));
    try {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'my-secret.env\n');
      execFileSync(process.execPath, [bin, 'create', dir, '--force'], { stdio: 'pipe' });
      assert.strictEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'my-secret.env\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('create 认出 .js 配置的站点，不冲掉已有内容', () => {
    // 只检查 xfm.config.mjs 的话，用 .js / .cjs / .json 配的站点会被直接覆盖
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-jsx-'));
    try {
      fs.writeFileSync(path.join(dir, 'xfm.config.js'), "module.exports = { site: { title: '手写' } };\n");
      fs.mkdirSync(path.join(dir, 'content'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'content', 'index.md'), '---\ntitle: 我写的首页\n---\n原有内容\n');
      let code = 0;
      try {
        execFileSync(process.execPath, [bin, 'create', dir], { stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        code = e.status;
      }
      assert.strictEqual(code, 1, '应拒绝覆盖已有站点，实际退出码 ' + code);
      assert(fs.readFileSync(path.join(dir, 'content', 'index.md'), 'utf8').includes('我写的首页'), '已有首页被覆盖');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('init 是 create 的别名', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-alias-'));
    execFileSync(process.execPath, [bin, 'init', path.join(dir, 'site'), '--template=blog', '--force'], { stdio: 'pipe' });
    assert(fs.existsSync(path.join(dir, 'site', 'xfm.config.mjs')), 'init 未生成站点');
    assert(fs.existsSync(path.join(dir, 'site', 'content')), 'init 未生成内容目录');
  });

  await test('未知命令给建议、退出码 1、不倒整份帮助', () => {
    let code = 0;
    let out = '';
    try {
      execFileSync(process.execPath, [bin, 'buils'], { stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
      code = e.status;
      out = String(e.stdout || '') + String(e.stderr || '');
    }
    assert(code === 1, '退出码应为 1，实际 ' + code);
    assert(out.includes('未知命令') && out.includes('xfm build'), '缺少拼写建议：' + out);
    assert(!out.includes('极致性能的静态站点生成器'), '仍然倒出了整份帮助');
  });

  await test('未知命令不会命中原型链方法', () => {
    for (const bad of ['constructor', 'toString']) {
      let code = 0;
      let out = '';
      try {
        execFileSync(process.execPath, [bin, bad], { stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        code = e.status;
        out = String(e.stdout || '') + String(e.stderr || '');
      }
      assert(code === 1, bad + ' 退出码应为 1，实际 ' + code);
      assert(out.includes('未知命令'), bad + ' 未按未知命令处理：' + out.slice(0, 120));
    }
  });

  await test('new 默认生成可发布文章，--draft 才进草稿', () => {
    execFileSync(process.execPath, [bin, 'new', '默认可见'], { cwd: tmp, stdio: 'pipe' });
    const normal = fs.readFileSync(path.join(tmp, 'content', 'posts', '默认可见.md'), 'utf8');
    assert(!normal.includes('draft: true'), '默认不应带 draft: true');
    execFileSync(process.execPath, [bin, 'new', '半成品', '--draft'], { cwd: tmp, stdio: 'pipe' });
    const draft = fs.readFileSync(path.join(tmp, 'content', 'posts', '半成品.md'), 'utf8');
    assert(draft.includes('draft: true'), '--draft 应写入 draft: true');
    execFileSync(process.execPath, [bin, 'build', tmp], { stdio: 'pipe' });
    assert(fs.existsSync(path.join(tmp, 'dist', 'posts', '默认可见', 'index.html')), '新文章未出现在产物里');
    assert(!fs.existsSync(path.join(tmp, 'dist', 'posts', '半成品', 'index.html')), '草稿被发布了');
  });

  await test('new 同名自动编号，标题含 YAML 特殊字符也能解析', () => {
    execFileSync(process.execPath, [bin, 'new', '同名标题'], { cwd: tmp, stdio: 'pipe' });
    execFileSync(process.execPath, [bin, 'new', '同名标题'], { cwd: tmp, stdio: 'pipe' });
    const files = fs.readdirSync(path.join(tmp, 'content', 'posts')).filter((f) => f.startsWith('同名标题')).sort();
    assert.deepStrictEqual(files, ['同名标题-2.md', '同名标题.md'], files.join(','));
    execFileSync(process.execPath, [bin, 'new', 'Hexo: 入门'], { cwd: tmp, stdio: 'pipe' });
    const fm = parseFrontMatter(fs.readFileSync(path.join(tmp, 'content', 'posts', 'hexo-入门.md'), 'utf8'));
    assert.strictEqual(fm.data.title, 'Hexo: 入门', JSON.stringify(fm.data));
  });

  await test('new page 生成独立页面，不进文章列表', () => {
    execFileSync(process.execPath, [bin, 'new', 'page', '关于我'], { cwd: tmp, stdio: 'pipe' });
    const file = path.join(tmp, 'content', '关于我.md');
    assert(fs.existsSync(file), '页面应落在 content 根目录');
    const fm = parseFrontMatter(fs.readFileSync(file, 'utf8')).data;
    assert.strictEqual(fm.layout, 'page.html', JSON.stringify(fm));
    assert.strictEqual(fm.type, 'page', '页面应带 type: page');
    execFileSync(process.execPath, [bin, 'build', tmp], { stdio: 'pipe' });
    assert(fs.existsSync(path.join(tmp, 'dist', '关于我', 'index.html')), '页面未生成 /关于我/');
    const home = fs.readFileSync(path.join(tmp, 'dist', 'index.html'), 'utf8');
    assert(!home.includes('关于我'), '页面被当成文章列进了首页');
  });

  await test('new draft 布局与站点自定义脚手架', () => {
    execFileSync(process.execPath, [bin, 'new', 'draft', '稍后写'], { cwd: tmp, stdio: 'pipe' });
    const draft = fs.readFileSync(path.join(tmp, 'content', 'posts', '稍后写.md'), 'utf8');
    assert(draft.includes('draft: true'), 'draft 布局应写入 draft: true');

    // scaffolds/page.md 覆盖内置模板，漏写的 front-matter 字段要自动补上
    fs.mkdirSync(path.join(tmp, 'scaffolds'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'scaffolds', 'page.md'),
      '---\ntitle: {{ title }}\n---\n\n自定义脚手架 {{ title }}\n'
    );
    execFileSync(process.execPath, [bin, 'new', 'page', '联系'], { cwd: tmp, stdio: 'pipe' });
    const page = fs.readFileSync(path.join(tmp, 'content', '联系.md'), 'utf8');
    assert(page.includes('自定义脚手架 联系'), '没有用站点 scaffolds/page.md：' + page);
    assert(page.includes('layout: page.html'), '缺 front-matter 的脚手架应补齐 layout');
    assert(page.includes('type: page'), '缺 front-matter 的脚手架应补齐 type: page');
  });

  await test('脚手架与布局冲突时以布局为准', () => {
    // draft.md 里留着 draft: false / layout: page.html（多半是从别的模板改来的），
    // 若不覆盖，"草稿"会直接发布出去，而命令还在报告"不会出现在产物里"
    fs.writeFileSync(
      path.join(tmp, 'scaffolds', 'draft.md'),
      '---\ntitle: {{ title }}\ndraft: false\nlayout: page.html\n---\n\n草稿模板\n'
    );
    execFileSync(process.execPath, [bin, 'new', 'draft', '模板冲突'], { cwd: tmp, stdio: 'pipe' });
    const fm = parseFrontMatter(fs.readFileSync(path.join(tmp, 'content', 'posts', '模板冲突.md'), 'utf8')).data;
    assert.strictEqual(fm.draft, true, '脚手架里的 draft: false 把草稿变成了可发布：' + JSON.stringify(fm));
    assert.strictEqual(fm.layout, 'post.html', '脚手架里的 layout 盖过了 draft 布局');

    // 反向：post 布局碰到留在模板里的 draft: true，要写回 draft: false
    fs.writeFileSync(
      path.join(tmp, 'scaffolds', 'post.md'),
      '---\ntitle: {{ title }}\ndraft: true\n---\n\n正文\n'
    );
    execFileSync(process.execPath, [bin, 'new', '从草稿改来'], { cwd: tmp, stdio: 'pipe' });
    const post = parseFrontMatter(fs.readFileSync(path.join(tmp, 'content', 'posts', '从草稿改来.md'), 'utf8')).data;
    assert.strictEqual(post.draft, false, 'post 布局仍留下 draft: true：' + JSON.stringify(post));

    fs.unlinkSync(path.join(tmp, 'scaffolds', 'draft.md'));
    fs.unlinkSync(path.join(tmp, 'scaffolds', 'post.md'));
  });

  await test('new --dir 用反斜杠时 URL 仍是正斜杠', () => {
    const out = execFileSync(process.execPath, [bin, 'new', 'page', '子页', '--dir=docs\\sub'], {
      cwd: tmp,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    assert(out.includes('/docs/sub/子页/'), '提示里的 URL 带了反斜杠：' + out.trim());
    assert(fs.existsSync(path.join(tmp, 'content', 'docs', 'sub', '子页.md')), '文件没有落在 docs/sub');
  });

  await test('new 在非站点目录直接报错', () => {
    // 之前会静默造出 content/posts/x.md，然后提示"xfm build 即可看到"
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-nosite-'));
    try {
      let code = 0;
      let out = '';
      try {
        execFileSync(process.execPath, [bin, 'new', '随便写写'], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        code = e.status;
        out = String(e.stdout || '') + String(e.stderr || '');
      }
      assert.strictEqual(code, 1, '应当报错退出，实际 ' + code);
      assert(out.includes('不是 xfm 站点') && out.includes('xfm create'), '错误信息没有指路：' + out);
      assert(!fs.existsSync(path.join(dir, 'content')), '仍然造出了 content 目录');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('草稿不发布', () => {
    fs.writeFileSync(path.join(tmp, 'content', 'posts', 'draft-test.md'),
      '---\ntitle: 草稿测试\ndraft: true\n---\n草稿');
    execFileSync(process.execPath, [bin, 'build', tmp], { stdio: 'pipe' });
    assert(!fs.existsSync(path.join(tmp, 'dist', 'posts', 'draft-test', 'index.html')), '草稿被发布了');
  });

  await test('build 增量缓存与草稿开关解耦', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-build-modes-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.writeFileSync(
        path.join(dir, 'content', 'posts', 'secret-draft.md'),
        '---\ntitle: 私密草稿\ndate: 2026-01-01\ndraft: true\n---\n\n不应意外发布。\n'
      );
      const draftOutput = path.join(dir, 'dist', 'posts', 'secret-draft', 'index.html');
      const run = (...flags) => spawnSync(process.execPath, [bin, 'build', dir, ...flags], { encoding: 'utf8' });

      let r = run('--incremental');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(!fs.existsSync(draftOutput), '--incremental 发布了草稿');
      assert(fs.existsSync(path.join(dir, '.xfm', 'cache.json')), '--incremental 没有写缓存');

      r = run('--dev');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(/缓存命中/.test(r.stdout), '--dev 没有作为增量缓存别名工作：' + r.stdout);
      assert(!fs.existsSync(draftOutput), '--dev 改变了生产构建的草稿语义');

      r = run('--dev', '--drafts');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(fs.existsSync(draftOutput), '--drafts 没有包含草稿');

      const configFile = path.join(dir, 'xfm.config.mjs');
      fs.writeFileSync(
        configFile,
        fs.readFileSync(configFile, 'utf8').replace('export default {', 'export default {\n  buildDrafts: true,')
      );
      r = run('--incremental', '--no-drafts');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(!fs.existsSync(draftOutput), '--no-drafts 没有覆盖 buildDrafts 配置');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('定时发布：未来日期的文章生产构建不输出，--scheduled 纳入，dev 可见', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-sched-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      const future = new Date(Date.now() + 10 * 86400000);
      const fStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'future.md'),
        `---\ntitle: 未来文章\ndate: ${fStr}\ntags: [x]\n---\n未到发布时间\n`);
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'past.md'),
        '---\ntitle: 旧文章\ndate: 2020-01-01\ntags: [x]\n---\n已发布\n');
      const futureOut = path.join(dir, 'dist', 'posts', 'future', 'index.html');
      const pastOut = path.join(dir, 'dist', 'posts', 'past', 'index.html');

      let r = spawnSync(process.execPath, [bin, 'build', dir], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert(!fs.existsSync(futureOut), '默认发布了未来文章');
      assert(fs.existsSync(pastOut), '过去文章未发布');
      assert(/调度中\s+1 篇/.test(r.stdout), '未报告调度篇数：' + r.stdout);

      r = spawnSync(process.execPath, [bin, 'build', dir, '--scheduled'], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert(fs.existsSync(futureOut), '--scheduled 未发布未来文章');
      assert(!/调度中/.test(r.stdout), '--scheduled 仍报告调度中');

      // buildScheduled 配置为 true，但 --no-scheduled 覆盖并清理旧产物
      const cfg = path.join(dir, 'xfm.config.mjs');
      fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8')
        .replace('export default {', 'export default {\n  buildScheduled: true,'));
      r = spawnSync(process.execPath, [bin, 'build', dir, '--no-scheduled'], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert(!fs.existsSync(futureOut), '--no-scheduled 未覆盖 buildScheduled 配置');

      // dev 模式预览未来文章
      const { DevServer } = require('../lib/engine/server');
      const dev = new DevServer(dir, { port: 0 });
      await dev.start();
      try {
        const res = await fetch(dev.url + 'posts/future/');
        assert.strictEqual(res.status, 200, 'dev 未服务未来文章：' + res.status);
      } finally {
        await dev.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('定时发布：未来文章不进 RSS / sitemap / 聚合计数', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-sched-feed-'));
    try {
      scaffoldSite(dir, ['--template=blog']); // 默认带 sitemap + rss
      const future = new Date(Date.now() + 10 * 86400000);
      const fStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'future.md'),
        `---\ntitle: 未来文章\ndate: ${fStr}\ntags: [x]\n---\n正文\n`);
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'live.md'),
        '---\ntitle: 在线文章\ndate: 2020-01-01\ntags: [x]\n---\n正文\n');
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const rss = fs.readFileSync(path.join(dir, 'dist', 'feed.xml'), 'utf8');
      assert(!rss.includes('/posts/future/'), 'RSS 收录了未来文章');
      assert(rss.includes('/posts/live/'), 'RSS 漏了在线文章');
      const sm = fs.readFileSync(path.join(dir, 'dist', 'sitemap.xml'), 'utf8');
      assert(!sm.includes('/posts/future/'), 'sitemap 收录了未来文章');
      const tagPage = fs.readFileSync(path.join(dir, 'dist', 'tags', 'x', 'index.html'), 'utf8');
      assert(!tagPage.includes('未来文章'), '聚合页列出了未来文章');
      assert(tagPage.includes('共 1 篇'), '聚合计数未排除未来文章');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('生产增量构建不会复用开发模式的页面缓存', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-cache-mode-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'plugins', 'mode-marker.js'),
        `module.exports = (site) => ({
          name: 'mode-marker',
          transformHtml(html) {
            return html.replace('</body>', '<div>mode-marker:' + site.mode + '</div></body>');
          },
        });\n`
      );

      const { build } = require('../lib');
      await build(dir, { mode: 'development' });
      const indexFile = path.join(dir, 'dist', 'index.html');
      assert(fs.readFileSync(indexFile, 'utf8').includes('mode-marker:development'));

      const r = spawnSync(process.execPath, [bin, 'build', dir, '--incremental'], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      const html = fs.readFileSync(indexFile, 'utf8');
      assert(html.includes('mode-marker:production'), '复用了开发模式缓存');
      assert(!html.includes('mode-marker:development'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('插件代码改动会使增量缓存失效', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-plugin-cache-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
      const pluginFile = path.join(dir, 'plugins', 'marker.js');
      const writePlugin = (word) => fs.writeFileSync(
        pluginFile,
        `module.exports = () => ({ name: 'marker', transformHtml(html) { return html.replace('</body>', '<div id="m">${word}</div></body>'); } });\n`
      );
      writePlugin('v1');
      const indexFile = path.join(dir, 'dist', 'index.html');
      const run = (...flags) => spawnSync(process.execPath, [bin, 'build', dir, ...flags], { encoding: 'utf8' });

      let r = run('--incremental');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(fs.readFileSync(indexFile, 'utf8').includes('id="m">v1'), '初始插件产物缺失');

      r = run('--incremental');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(/缓存命中/.test(r.stdout), '未命中缓存：' + r.stdout);
      assert(fs.readFileSync(indexFile, 'utf8').includes('id="m">v1'));

      writePlugin('v2');
      r = run('--incremental');
      assert.strictEqual(r.status, 0, r.stderr);
      const html = fs.readFileSync(indexFile, 'utf8');
      assert(html.includes('id="m">v2'), '插件改动后缓存未失效');
      assert(!html.includes('id="m">v1'), '旧插件产物残留');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('重复路由在清理和写盘前报错并列出两个来源', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-route-collision-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      for (const name of ['a', 'b']) {
        fs.writeFileSync(
          path.join(dir, 'content', name + '.md'),
          `---\ntitle: ${name}\nurl: /collision/\nlayout: page.html\n---\n\n${name}\n`
        );
      }
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'dist', 'keep.txt'), 'do not prune');

      const r = spawnSync(process.execPath, [bin, 'build', dir], { encoding: 'utf8' });
      const output = r.stdout + r.stderr;
      assert.strictEqual(r.status, 1, output);
      assert(output.includes('输出路径冲突'), output);
      assert(output.includes('a.md') && output.includes('b.md'), '错误信息没有列出两个内容来源：' + output);
      assert(!fs.existsSync(path.join(dir, 'dist', 'collision', 'index.html')), '冲突页面仍然被写入');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'dist', 'keep.txt'), 'utf8'), 'do not prune', '冲突前清理了旧产物');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('页面与 public 资源产物冲突也会拒绝写盘', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-asset-collision-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      const asset = path.join(dir, 'public', 'about', 'index.html');
      fs.mkdirSync(path.dirname(asset), { recursive: true });
      fs.writeFileSync(asset, 'public asset');

      const r = spawnSync(process.execPath, [bin, 'build', dir], { encoding: 'utf8' });
      const output = r.stdout + r.stderr;
      assert.strictEqual(r.status, 1, output);
      assert(output.includes('about.md') && output.includes('资源'), output);
      assert.strictEqual(fs.readFileSync(asset, 'utf8'), 'public asset');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('Page Bundle：content 下的图片/附件随页面输出，相对与绝对链接都可用且不死链', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-bundle-'));
    try {
      scaffoldSite(dir, ['--template=blog'], ['image-size', 'deadlinks']);
      fs.mkdirSync(path.join(dir, 'content', 'posts', 'hello'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'content', 'posts', 'hello', 'cover.png'),
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      );
      fs.writeFileSync(
        path.join(dir, 'content', 'posts', 'hello', 'index.md'),
        '---\ntitle: 带图文章\n---\n\n![相对](./cover.png)\n\n![绝对](/posts/hello/cover.png)\n'
      );
      // content 根下的松散附件也应原样复制
      fs.mkdirSync(path.join(dir, 'content', 'files'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'content', 'files', 'doc.pdf'), 'pdf-bytes');

      const r = spawnSync(process.execPath, [bin, 'build', dir], { encoding: 'utf8' });
      const output = r.stdout + r.stderr;
      assert.strictEqual(r.status, 0, output);

      assert(fs.existsSync(path.join(dir, 'dist', 'posts', 'hello', 'cover.png')), 'bundle 图片未复制');
      assert(fs.existsSync(path.join(dir, 'dist', 'files', 'doc.pdf')), 'content 根附件未复制');
      assert(!fs.existsSync(path.join(dir, 'dist', 'posts', 'hello', 'index.md')), '源 md 不该被复制');

      const html = fs.readFileSync(path.join(dir, 'dist', 'posts', 'hello', 'index.html'), 'utf8');
      assert(html.includes('src="./cover.png"'), '相对图片引用丢失：' + html);
      assert(html.includes('src="/posts/hello/cover.png"'), '绝对图片引用丢失：' + html);
      assert(/width="1"[\s\S]{0,80}height="1"/.test(html), 'image-size 未处理 bundle 图：' + html);
      assert(!/发现\s+\d+\s*处/.test(output), 'bundle 图片被误报死链：' + output);
      assert(!fs.existsSync(path.join(dir, 'dist', 'deadlinks.json')), '不应产出死链报告');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('Page Bundle：改文章配图后增量缓存失效并重渲染', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-bundle-cache-'));
    try {
      scaffoldSite(dir, ['--template=blog'], ['image-size']);
      fs.mkdirSync(path.join(dir, 'content', 'posts', 'hello'), { recursive: true });
      const cover = path.join(dir, 'content', 'posts', 'hello', 'cover.png');
      const pageOut = path.join(dir, 'dist', 'posts', 'hello', 'index.html');
      const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const png2x2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=';
      fs.writeFileSync(cover, Buffer.from(png1x1, 'base64'));
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'hello', 'index.md'),
        '---\ntitle: 配图文章\n---\n\n![cover](./cover.png)\n');
      const run = (...f) => spawnSync(process.execPath, [bin, 'build', dir, ...f], { encoding: 'utf8' });

      let r = run('--incremental');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(fs.readFileSync(pageOut, 'utf8').includes('width="1"'), '初始应为 1x1');

      r = run('--incremental');
      assert.strictEqual(r.status, 0, r.stderr);
      assert(/缓存命中/.test(r.stdout), '第二次应命中缓存：' + r.stdout);

      // 换成 2x2：资源摘要变化 → 页面 hash 变化 → 缓存失效 → 重渲染
      fs.writeFileSync(cover, Buffer.from(png2x2, 'base64'));
      r = run('--incremental');
      assert.strictEqual(r.status, 0, r.stderr);
      const html = fs.readFileSync(pageOut, 'utf8');
      assert(html.includes('width="2"'), '改图后页面未重渲染，仍是旧尺寸：' + html);
      assert(!html.includes('width="1"'), '旧尺寸残留：' + html);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('Page Bundle：content 附件与 public 冲突时拒绝写盘', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-bundle-collision-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'content', 'posts', 'hello'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'hello', 'cover.png'), 'from-content');
      const pub = path.join(dir, 'public', 'posts', 'hello', 'cover.png');
      fs.mkdirSync(path.dirname(pub), { recursive: true });
      fs.writeFileSync(pub, 'from-public');

      const r = spawnSync(process.execPath, [bin, 'build', dir], { encoding: 'utf8' });
      const output = r.stdout + r.stderr;
      assert.strictEqual(r.status, 1, output);
      assert(output.includes('输出路径冲突'), output);
      assert(output.includes('cover.png'), output);
      assert.strictEqual(fs.readFileSync(pub, 'utf8'), 'from-public', '冲突时不应改动源文件');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('dev server 直接服务 content Page Bundle 附件', async () => {
    const { DevServer } = require('../lib/engine/server');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-bundle-dev-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'content', 'posts', 'hello'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'hello', 'cover.png'), 'dev-bundle-bytes');
      const dev = new DevServer(dir, { port: 0 });
      await dev.start();
      try {
        const res = await fetch(dev.url + 'posts/hello/cover.png');
        assert.strictEqual(res.status, 200, 'dev 未服务 bundle 附件：' + res.status);
        assert.strictEqual(Buffer.from(await res.arrayBuffer()).toString(), 'dev-bundle-bytes');
      } finally {
        await dev.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('.html 页面 URL 与产物路径一致', () => {
    fs.writeFileSync(path.join(tmp, 'content', 'raw.html'), '---\ntitle: 原始页\n---\n<h1>raw</h1>');
    execFileSync(process.execPath, [bin, 'build', tmp], { stdio: 'pipe' });
    assert(fs.existsSync(path.join(tmp, 'dist', 'raw.html')), '应输出 dist/raw.html，而非 dist/raw.html/index.html');
  });

  await test('相对 .md 链接被重写（含省略扩展名）', () => {
    fs.writeFileSync(path.join(tmp, 'content', 'posts', 'linker.md'),
      '---\ntitle: 链接测试\nlayout: page.html\n---\n[a](./hello-world.md) [b](./hello-world) [c](/abs/)\n');
    execFileSync(process.execPath, [bin, 'build', tmp], { stdio: 'pipe' });
    const html = fs.readFileSync(path.join(tmp, 'dist', 'posts', 'linker', 'index.html'), 'utf8');
    assert(html.includes('href="/posts/hello-world/"'), '未重写 .md 链接：' + html.slice(0, 400));
    assert(!html.includes('href="./hello-world"'), '省略扩展名的相对链接未重写');
  });

  await test('路径穿越防护（dev server）', async () => {
    const { DevServer } = require('../lib/engine/server');
    const dev = new DevServer(tmp, { port: 0 });
    await dev.start();
    try {
      const port = dev.server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/assets/../../../../etc/passwd`);
      const body = await res.text();
      assert(res.status === 404 || !body.includes('root:'), '存在目录穿越：' + res.status);
    } finally {
      await dev.close();
    }
  });

  await test('清理命令', () => {
    execFileSync(process.execPath, [bin, 'clean', tmp], { stdio: 'pipe' });
    assert(!fs.existsSync(path.join(tmp, 'dist')));
    assert(!fs.existsSync(path.join(tmp, '.xfm')));
  });

  await test('docs 模板开箱即有侧栏分组', () => {
    const docsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-docs-'));
    try {
      scaffoldSite(docsTmp, ['--template=docs', '--title=文档站'], []);
      execFileSync(process.execPath, [bin, 'build', docsTmp], { stdio: 'pipe' });
      const html = fs.readFileSync(path.join(docsTmp, 'dist', 'docs', 'configuration', 'index.html'), 'utf8');
      assert(html.includes('docs-nav'), '缺少侧栏容器');
      assert(html.includes('使用指南'), '侧栏没有分组（内容缺少 group 字段）');
      assert(html.includes('href="/docs/getting-started/"'), '侧栏没有导航项');
    } finally {
      fs.rmSync(docsTmp, { recursive: true, force: true });
    }
  });

  await test('URL 中的百分号编码会还原成真实目录名', () => {
    const { urlToFilePath } = require('../lib/engine/site');
    assert.strictEqual(urlToFilePath('/tags/%E6%8F%92%E4%BB%B6/'), path.posix.join('tags', '插件', 'index.html'));
    assert.strictEqual(urlToFilePath('/tags/Node.js/'), path.posix.join('tags', 'Node.js', 'index.html'));
    // %2F 不能被还原成路径分隔符
    assert(!urlToFilePath('/a%2Fb/').includes('a/b'), 'decodeURI 不应拆开编码后的斜杠');
  });

  await test('标签聚合页生成，中文标签落盘与链接一致', () => {
    const taxTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-tax-'));
    try {
      scaffoldSite(taxTmp, ['--template=blog', '--title=标签站'], []);
      fs.writeFileSync(
        path.join(taxTmp, 'content', 'posts', 'tagged.md'),
        '---\ntitle: 带标签的文章\ndate: 2026-02-01\ntags: [中文 标签, 随笔]\n---\n\n正文\n'
      );
      execFileSync(process.execPath, [bin, 'build', taxTmp], { stdio: 'pipe' });

      const zh = path.join(taxTmp, 'dist', 'tags', '中文 标签', 'index.html');
      assert(fs.existsSync(zh), '中文标签目录没有落盘（可能被百分号编码了）');
      const html = fs.readFileSync(zh, 'utf8');
      assert(html.includes('<h1>中文 标签</h1>'), '聚合页标题不对');
      assert(html.includes('带标签的文章'), '聚合页没有列出文章');
      assert(html.includes('共 1 篇'), '缺少文章数描述');

      // 同一标签下两篇文章
      const fen = fs.readFileSync(path.join(taxTmp, 'dist', 'tags', '随笔', 'index.html'), 'utf8');
      assert((fen.match(/card-title/g) || []).length === 2, '随笔标签应聚合 2 篇');
    } finally {
      fs.rmSync(taxTmp, { recursive: true, force: true });
    }
  });

  await test('聚合页进 sitemap，不进 RSS 与首页页面列表', () => {
    const taxTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-tax2-'));
    try {
      scaffoldSite(taxTmp, ['--template=blog', '--title=索引站']);
      execFileSync(process.execPath, [bin, 'build', taxTmp], { stdio: 'pipe' });
      const read = (p) => fs.readFileSync(path.join(taxTmp, 'dist', p), 'utf8');

      assert(read('sitemap.xml').includes('/tags/'), 'sitemap 缺少聚合页');
      assert(!read('feed.xml').includes('/tags/'), 'RSS 不应包含聚合页');
      assert(!read('feed.xml').includes('/categories/'), 'RSS 不应包含索引页');
      assert(!read('feed.xml').includes('/archives/'), 'RSS 不应包含归档页');
    } finally {
      fs.rmSync(taxTmp, { recursive: true, force: true });
    }
  });

  await test('聚合页分页：标签下文章超过 perPage 时生成 /tags/x/page/N/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-taxopage-'));
    try {
      scaffoldSite(dir, ['--template=blog']); // 默认带 sitemap + rss
      for (let i = 1; i <= 11; i++) {
        fs.writeFileSync(path.join(dir, 'content', 'posts', `p${i}.md`),
          `---\ntitle: 文章${i}\ndate: 2020-01-${String(i).padStart(2, '0')}\ntags: [foo]\n---\n正文${i}\n`);
      }
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });

      const p1 = path.join(dir, 'dist', 'tags', 'foo', 'index.html');
      const p2 = path.join(dir, 'dist', 'tags', 'foo', 'page', '2', 'index.html');
      assert(fs.existsSync(p1), '标签首页未生成');
      assert(fs.existsSync(p2), '未生成分页第 2 页');
      assert(!fs.existsSync(path.join(dir, 'dist', 'tags', 'foo', 'page', '3')), '多生成了第 3 页');

      const h1 = fs.readFileSync(p1, 'utf8');
      const h2 = fs.readFileSync(p2, 'utf8');
      assert.strictEqual((h1.match(/card-title/g) || []).length, 9, '第 1 页卡片数应等于 perPage=9');
      assert.strictEqual((h2.match(/card-title/g) || []).length, 2, '第 2 页应只有 2 篇');
      assert(h1.includes('href="/tags/foo/page/2/"'), '第 1 页缺下一页链接');
      assert(h2.includes('href="/tags/foo/"'), '第 2 页缺上一页链接');
      assert(/第 2 页/.test(h2), '分页页标题未标注页码');
      assert(h2.includes('is-current'), '分页组件未标出当前页');

      const rss = fs.readFileSync(path.join(dir, 'dist', 'feed.xml'), 'utf8');
      assert(!rss.includes('/tags/foo/page/'), '分页页混进了 RSS');
      const sm = fs.readFileSync(path.join(dir, 'dist', 'sitemap.xml'), 'utf8');
      assert(sm.includes('/tags/foo/page/2/'), '分页页未进 sitemap');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('聚合页分页：perPage 配置生效，pagination.taxonomy=false 关闭聚合分页', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-taxocfg-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(path.join(dir, 'content', 'posts', `p${i}.md`),
          `---\ntitle: 文章${i}\ndate: 2020-02-0${i}\ntags: [bar]\n---\n正文\n`);
      }
      const cfg = path.join(dir, 'xfm.config.mjs');
      // 替换脚手架已有的 pagination 行，避免重复键被原值覆盖
      fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8')
        .replace('pagination: { perPage: 9 },', 'pagination: { perPage: 2 },'));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(fs.existsSync(path.join(dir, 'dist', 'tags', 'bar', 'page', '3', 'index.html')), 'perPage=2 应生成第 3 页');
      const h1 = fs.readFileSync(path.join(dir, 'dist', 'tags', 'bar', 'index.html'), 'utf8');
      assert.strictEqual((h1.match(/card-title/g) || []).length, 2, 'perPage 未生效');

      // 关闭聚合分页：单页列出全部，且旧分页页被清理
      fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8')
        .replace('pagination: { perPage: 2 },', 'pagination: { perPage: 2, taxonomy: false },'));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(!fs.existsSync(path.join(dir, 'dist', 'tags', 'bar', 'page')), 'taxonomy:false 仍生成分页页');
      const all = fs.readFileSync(path.join(dir, 'dist', 'tags', 'bar', 'index.html'), 'utf8');
      assert.strictEqual((all.match(/card-title/g) || []).length, 5, 'taxonomy:false 应单页列全部');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('分类索引页与归档页生成', () => {
    const idxTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-idx-'));
    try {
      scaffoldSite(idxTmp, ['--template=blog', '--title=索引站']);
      const postDir = path.join(idxTmp, 'content', 'posts');
      fs.writeFileSync(path.join(postDir, 'a.md'), '---\ntitle: 甲\ndate: 2026-05-01\ncategory: 技术\ntags: [x]\n---\n\n甲\n');
      fs.writeFileSync(path.join(postDir, 'b.md'), '---\ntitle: 乙\ndate: 2026-06-01\ncategory: 技术\n---\n\n乙\n');
      fs.writeFileSync(path.join(postDir, 'c.md'), '---\ntitle: 丙\ndate: 2025-01-01\ncategory: 生活\n---\n\n丙\n');
      execFileSync(process.execPath, [bin, 'build', idxTmp], { stdio: 'pipe' });
      const read = (p) => fs.readFileSync(path.join(idxTmp, 'dist', p), 'utf8');

      const catHtml = read('categories/index.html');
      assert(catHtml.includes('技术') && catHtml.includes('2 篇'), '分类索引缺少词条与计数');
      assert(catHtml.includes('/categories/%E6%8A%80%E6%9C%AF/'), '分类索引缺少分类页链接');

      const archHtml = read('archives/index.html');
      assert(archHtml.includes('2026') && archHtml.includes('2025'), '归档缺少年份分组');
      assert(archHtml.indexOf('乙') < archHtml.indexOf('甲'), '归档未按日期倒序');
      assert(archHtml.includes('3 篇') || archHtml.includes('2 篇'), '归档缺少篇数');

      const sitemap = read('sitemap.xml');
      assert(sitemap.includes('/categories/'), 'sitemap 缺少分类索引');
      assert(sitemap.includes('/archives/'), 'sitemap 缺少归档');

      // 脚手架默认导航包含四项，且指向的页面都存在
      const home = read('index.html');
      for (const u of ['/categories/', '/archives/', '/about/']) {
        assert(home.includes(`href="${u}"`), `导航缺少 ${u}`);
        assert(fs.existsSync(path.join(idxTmp, 'dist', u, 'index.html')), `${u} 页面未生成`);
      }
    } finally {
      fs.rmSync(idxTmp, { recursive: true, force: true });
    }
  });

  await test('主题缺布局或 indexes 关闭时跳过索引页', () => {
    // docs 主题没有 categories/archives.html：不应生成，也不应报错
    const docsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-idx-docs-'));
    try {
      scaffoldSite(docsTmp, ['--template=docs'], []);
      execFileSync(process.execPath, [bin, 'build', docsTmp], { stdio: 'pipe' });
      // 注意：/categories/<name>/ 是 taxonomy 聚合页，索引页特指 /categories/ 根
      assert(!fs.existsSync(path.join(docsTmp, 'dist', 'categories', 'index.html')), 'docs 主题不应生成分类索引');
      assert(!fs.existsSync(path.join(docsTmp, 'dist', 'archives')), 'docs 主题不应生成归档');
    } finally {
      fs.rmSync(docsTmp, { recursive: true, force: true });
    }

    // enabled: false 显式关闭
    const offTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-idx-off-'));
    try {
      scaffoldSite(offTmp, ['--template=blog'], []);
      const cfgFile = path.join(offTmp, 'xfm.config.mjs');
      fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(
        "server: { port: 4173 },",
        "indexes: { categories: { enabled: false }, archives: { enabled: false } },\n  server: { port: 4173 },"
      ));
      execFileSync(process.execPath, [bin, 'build', offTmp], { stdio: 'pipe' });
      assert(!fs.existsSync(path.join(offTmp, 'dist', 'categories', 'index.html')), 'enabled:false 不应生成分类索引');
      assert(!fs.existsSync(path.join(offTmp, 'dist', 'archives')), 'enabled:false 不应生成归档');
    } finally {
      fs.rmSync(offTmp, { recursive: true, force: true });
    }
  });

  await test('全局数据文件：json/yaml/js 加载，嵌套目录映射为嵌套对象', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-data-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'data', 'team'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'data', 'authors.json'), JSON.stringify([{ name: 'Alice' }, { name: 'Bob' }]));
      fs.writeFileSync(path.join(dir, 'data', 'team', 'members.yml'), 'lead: Carol\nmembers:\n  - Dan\n  - Eve\n');
      fs.writeFileSync(path.join(dir, 'data', 'meta.js'), 'module.exports = { version: 3, live: true };\n');
      const cfgFile = path.join(dir, 'xfm.config.mjs');
      fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(
        "pagination: { perPage: 9 },",
        "pagination: { perPage: 9 },\n  plugins: [\n    { name: 'probe', afterBuild(s) { return [{ path: 'data.json', contents: JSON.stringify(s.siteContext.data) }]; }, transformHtml(html, ctx) { return html + '\\n<!--V:' + (ctx.site.data && ctx.site.data.meta && ctx.site.data.meta.version) + '-->'; } }\n  ],"
      ));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const emitted = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'data.json'), 'utf8'));
      assert(Array.isArray(emitted.authors) && emitted.authors[0].name === 'Alice', 'authors.json 未加载：' + JSON.stringify(emitted));
      assert(emitted.team && emitted.team.members.lead === 'Carol' && emitted.team.members.members[0] === 'Dan', '嵌套 yml 未加载：' + JSON.stringify(emitted && emitted.team));
      assert(emitted.meta && emitted.meta.version === 3 && emitted.meta.live === true, 'meta.js 未加载：' + JSON.stringify(emitted && emitted.meta));
      const idx = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
      assert(idx.includes('<!--V:3-->'), '插件/模板读不到 site.data');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('数据文件变更击穿增量构建缓存', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-data-inc-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'data', 'meta.js'), 'module.exports = { version: 3 };\n');
      const cfgFile = path.join(dir, 'xfm.config.mjs');
      fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(
        "pagination: { perPage: 9 },",
        "pagination: { perPage: 9 },\n  plugins: [\n    { name: 'probe', transformHtml(html, ctx) { return html + '\\n<!--V:' + (ctx.site.data && ctx.site.data.meta && ctx.site.data.meta.version) + '-->'; } }\n  ],"
      ));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8').includes('<!--V:3-->'), '首次构建未注入');
      fs.writeFileSync(path.join(dir, 'data', 'meta.js'), 'module.exports = { version: 9 };\n');
      const r = spawnSync(process.execPath, [bin, 'build', dir, '--incremental'], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, '增量构建失败：' + r.stderr);
      const idx2 = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
      assert(idx2.includes('<!--V:9-->') && !idx2.includes('<!--V:3-->'), '数据变更未击穿缓存：' + idx2.slice(-200));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('自动摘要：无 description 时列表卡片显示正文截断', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-excerpt-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'nodesc.md'),
        '---\ntitle: 没有描述的文章\ndate: 2020-01-01\ntags: [x]\n---\n这是一段很长的正文内容，用来测试自动摘要功能是否会在没有 description 的时候正确截断显示在列表卡片当中。\n');
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const idx = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
      assert(idx.includes('card-desc'), '列表卡片缺少摘要容器');
      assert(idx.includes('这是一段很长的正文'), '无描述文章未显示自动摘要');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('自动摘要：有 description 优先用手写描述，meta 兜底 excerpt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-excerpt2-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'withdesc.md'),
        '---\ntitle: 有描述的文章\ndate: 2020-01-02\ndescription: 我是手写描述\ntags: [x]\n---\n正文内容不应该出现在摘要里。\n');
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'nodesc.md'),
        '---\ntitle: 没有描述的文章\ndate: 2020-01-01\ntags: [x]\n---\n这是一段很长的正文内容，用来测试自动摘要。\n');
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const idx = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
      assert(idx.includes('我是手写描述'), '手写描述未出现在卡片');
      assert(!idx.includes('不应该出现在摘要'), '正文泄漏进了摘要');
      const postPage = fs.readFileSync(path.join(dir, 'dist', 'posts', 'nodesc', 'index.html'), 'utf8');
      assert(/<meta name="description" content="这是一段很长的正文/.test(postPage), '页面 meta 描述未兜底 excerpt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('自定义集合：列表页 / 详情页 / 分页 + 按日期倒序', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-col-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'content', 'projects'), { recursive: true });
      for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(dir, 'content', 'projects', `p${i}.md`),
          `---\ntitle: 项目 ${i}\ndate: 2020-01-0${i}\ndescription: 项目 ${i} 描述\n---\n正文。\n`);
      }
      const cfgFile = path.join(dir, 'xfm.config.mjs');
      fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(
        "pagination: { perPage: 9 },",
        "pagination: { perPage: 9 },\n  collections: { projects: { perPage: 2, title: '作品集', description: '我的项目集合' } },"
      ));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(fs.existsSync(path.join(dir, 'dist', 'projects', 'index.html')), '集合列表页未生成');
      assert(fs.existsSync(path.join(dir, 'dist', 'projects', 'page', '2', 'index.html')), '集合分页页未生成');
      assert(fs.existsSync(path.join(dir, 'dist', 'projects', 'p1', 'index.html')), '集合详情页未生成');
      const list = fs.readFileSync(path.join(dir, 'dist', 'projects', 'index.html'), 'utf8');
      assert(list.includes('<h1>作品集</h1>'), '列表页标题不对：' + list.slice(0, 200));
      // 按日期倒序：第 1 页 = 项目 3、项目 2
      assert(list.includes('项目 3') && list.includes('项目 2'), '第 1 页应含最新两项');
      assert(!list.includes('项目 1'), '第 1 页不应含最旧项');
      const page2 = fs.readFileSync(path.join(dir, 'dist', 'projects', 'page', '2', 'index.html'), 'utf8');
      assert(page2.includes('项目 1') && !page2.includes('项目 3'), '第 2 页应只含最旧项');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('集合条目默认不进首页文章流，posts:true 时进入', () => {
    const build = (extra) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-col-posts-'));
      try {
        scaffoldSite(d, ['--template=blog'], []);
        fs.mkdirSync(path.join(d, 'content', 'projects'), { recursive: true });
        fs.writeFileSync(path.join(d, 'content', 'projects', 'x.md'), '---\ntitle: 集合文章X\ndate: 2020-05-05\n---\n正文\n');
        const cfg = path.join(d, 'xfm.config.mjs');
        fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(
          "pagination: { perPage: 9 },",
          `pagination: { perPage: 9 },\n  collections: { projects: { ${extra} } },`
        ));
        execFileSync(process.execPath, [bin, 'build', d], { stdio: 'pipe' });
        return fs.readFileSync(path.join(d, 'dist', 'index.html'), 'utf8');
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    };
    assert(!build('').includes('集合文章X'), '默认集合条目不应进首页');
    assert(build('posts: true').includes('集合文章X'), 'posts:true 应进首页');
  });

  await test('集合 perPage:0 不分页，单页列出全部', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-col-nopage-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'content', 'projects'), { recursive: true });
      for (let i = 1; i <= 4; i++) {
        fs.writeFileSync(path.join(dir, 'content', 'projects', `p${i}.md`), `---\ntitle: P${i}\ndate: 2020-01-0${i}\n---\n`);
      }
      const cfg = path.join(dir, 'xfm.config.mjs');
      fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(
        "pagination: { perPage: 9 },",
        "pagination: { perPage: 9 },\n  collections: { projects: { perPage: 0 } },"
      ));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      assert(fs.existsSync(path.join(dir, 'dist', 'projects', 'index.html')), '列表页应生成');
      assert(!fs.existsSync(path.join(dir, 'dist', 'projects', 'page')), 'perPage:0 不应生成分页页');
      const list = fs.readFileSync(path.join(dir, 'dist', 'projects', 'index.html'), 'utf8');
      for (let i = 1; i <= 4; i++) assert(list.includes(`>P${i}<`), `列表缺 P${i}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('集合新增条目击穿列表页增量缓存', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-col-inc-'));
    try {
      scaffoldSite(dir, ['--template=blog'], []);
      fs.mkdirSync(path.join(dir, 'content', 'projects'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'content', 'projects', 'a.md'), '---\ntitle: A\ndate: 2020-01-01\n---\n');
      const cfg = path.join(dir, 'xfm.config.mjs');
      fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(
        "pagination: { perPage: 9 },",
        "pagination: { perPage: 9 },\n  collections: { projects: { perPage: 9 } },"
      ));
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const before = fs.readFileSync(path.join(dir, 'dist', 'projects', 'index.html'), 'utf8');
      assert(before.includes('>A<') && !before.includes('>B<'));
      fs.writeFileSync(path.join(dir, 'content', 'projects', 'b.md'), '---\ntitle: B\ndate: 2020-01-02\n---\n');
      const r = spawnSync(process.execPath, [bin, 'build', dir, '--incremental'], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, '增量构建失败：' + r.stderr);
      const after = fs.readFileSync(path.join(dir, 'dist', 'projects', 'index.html'), 'utf8');
      assert(after.includes('>A<') && after.includes('>B<'), '新增条目未刷新列表页：' + after.slice(-300));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('多语言：页 lang / hreflang / x-default / 语言切换 / site.languages', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-i18n-'));
    try {
      scaffoldSite(dir, ['--template=blog'], ['seo']);
      let cfg = fs.readFileSync(path.join(dir, 'xfm.config.mjs'), 'utf8');
      cfg = cfg.replace("    lang: 'zh-CN',", "    lang: 'zh-CN',\n    languages: ['zh-CN', 'en'],");
      cfg = cfg.replace(/^};\s*$/m, "  plugins: [\n    { name: 'probe', afterBuild(s) { return [{ path: 'i18n.json', contents: JSON.stringify({ langs: s.siteContext.languages, def: s.siteContext.defaultLang, t: (s.siteContext.pages.find((p) => p.url === '/posts/zh/') || {}).translations }) }]; } }\n  ],\n};");
      fs.writeFileSync(path.join(dir, 'xfm.config.mjs'), cfg);
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'zh.md'), '---\ntitle: 你好\ndate: 2020-01-01\nlang: zh-CN\ntranslationKey: hello\n---\n中文\n');
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'en.md'), '---\ntitle: Hello\ndate: 2020-01-01\nlang: en\ntranslationKey: hello\n---\nEnglish\n');
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const zh = fs.readFileSync(path.join(dir, 'dist', 'posts', 'zh', 'index.html'), 'utf8');
      const en = fs.readFileSync(path.join(dir, 'dist', 'posts', 'en', 'index.html'), 'utf8');
      assert(/<html lang="zh-CN">/.test(zh), 'zh 页 lang 不对');
      assert(/<html lang="en">/.test(en), 'en 页 lang 不对');
      assert(/hreflang="zh-CN"/.test(zh) && /hreflang="en"/.test(zh), 'zh 页缺 hreflang');
      assert(/hreflang="x-default"/.test(zh), '缺 x-default');
      assert(/og:locale:alternate/.test(zh), '缺 og:locale:alternate');
      assert(/lang-switcher/.test(zh) && /\/posts\/en\//.test(zh), 'zh 页缺切换到 en 的链接');
      assert(/lang-switcher/.test(en) && /\/posts\/zh\//.test(en), 'en 页缺切换到 zh 的链接');
      const info = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'i18n.json'), 'utf8'));
      assert.deepStrictEqual(info.langs, ['zh-CN', 'en'], 'site.languages 不对');
      assert.strictEqual(info.def, 'zh-CN', 'defaultLang 不对');
      assert(info.t && info.t.length === 2, 'page.translations 应为 2 项：' + JSON.stringify(info.t));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('单语站不输出 hreflang / 语言切换器 / og:locale:alternate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-mono-'));
    try {
      scaffoldSite(dir, ['--template=blog'], ['seo']);
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'solo.md'), '---\ntitle: Solo\ndate: 2020-01-01\n---\nbody\n');
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const solo = fs.readFileSync(path.join(dir, 'dist', 'posts', 'solo', 'index.html'), 'utf8');
      assert(!/hreflang=/.test(solo), '单语站不应输出 hreflang');
      assert(!/lang-switcher/.test(solo), '单语站不应输出语言切换器');
      assert(!/og:locale:alternate/.test(solo), '单语站不应输出 og:locale:alternate');
      assert(/<html lang="zh-CN">/.test(solo), '默认 lang 应保持');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('多语言：导航按页语言本地化', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-nav-'));
    try {
      scaffoldSite(dir, ['--template=blog'], ['seo']);
      let cfg = fs.readFileSync(path.join(dir, 'xfm.config.mjs'), 'utf8');
      cfg = cfg.replace("    lang: 'zh-CN',", "    lang: 'zh-CN',\n    languages: ['zh-CN', 'en'],");
      cfg = cfg.replace("{ title: '关于', url: '/about/' }", "{ title: '关于', url: '/about/', translations: { en: { title: 'About', url: '/about-en/' } } }");
      fs.writeFileSync(path.join(dir, 'xfm.config.mjs'), cfg);
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'zh.md'), '---\ntitle: 中文\ndate: 2020-01-01\nlang: zh-CN\ntranslationKey: n\n---\n');
      fs.writeFileSync(path.join(dir, 'content', 'posts', 'en.md'), '---\ntitle: English\ndate: 2020-01-02\nlang: en\ntranslationKey: n\n---\n');
      execFileSync(process.execPath, [bin, 'build', dir], { stdio: 'pipe' });
      const zh = fs.readFileSync(path.join(dir, 'dist', 'posts', 'zh', 'index.html'), 'utf8');
      const en = fs.readFileSync(path.join(dir, 'dist', 'posts', 'en', 'index.html'), 'utf8');
      assert(zh.includes('>关于<') && !zh.includes('>About<'), 'zh 页导航应显示中文');
      assert(en.includes('>About<') && !en.includes('>关于<'), 'en 页导航应显示英文');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('模板注释 {# #} 不输出', () => {
    const html = compile('a{# 隐藏 #}b{% for i in [1] %}c{# 循环内注释 #}{% endfor %}')({});
    assert.strictEqual(html, 'abc');
  });

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------------- 主线程 / worker 一致性 ---------------- */
async function testConsistency() {
  console.log('\n渲染一致性（主线程 vs worker）');

  const { build, compileSite } = require('../lib');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-consist-'));
  const write = (rel, body) => {
    const abs = path.join(root, 'content', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  const writeConfig = (extra) =>
    fs.writeFileSync(
      path.join(root, 'xfm.config.mjs'),
      'export default ' + JSON.stringify(Object.assign({ site: { title: '一致性', base: '/' }, theme: 'default' }, extra), null, 2) + ';\n'
    );

  writeConfig({ workerThreshold: 1, workers: 2, plugins: ['rss'], defaults: { layout: 'post.html' } });
  write('index.md', '---\ntitle: 首页\nlayout: index.html\n---\n');
  write('docs/index.md', '---\ntitle: Docs\ngroup: d\nweight: 1\ndate: 2026-01-01\n---\n\n[去 B](./b.md)\n');
  write('docs/b.md', '---\ntitle: B\ngroup: d\nweight: 2\ndate: 2026-01-02 05:00:00\n---\n\nB 内容\n');
  write('c.md', '---\ntitle: C\ndate: 2026-03-05 05:00:00\n---\n\nC 内容 here\n');
  write('slugged.md', '---\ntitle: 无斜杠URL\nurl: custom\n---\n\nx\n');
  write(
    'syntax.md',
    '---\ntitle: 语法\ndate: 2026-02-01 08:00:00\n---\n\n原标题\n====\n\n引用[^a]、[引用链接][r] 与脚注复用[^a]\n\n[^a]: 注释内容\n[r]: ./docs/b.md\n'
  );

  const prod = await build(root);
  const dev = await compileSite(root);

  await test('生产模式确实走了 worker', () => {
    assert(prod.stats.workers >= 1, '未启用 worker：' + prod.stats.workers);
  });

  await test('两条渲染路径产物完全一致', () => {
    const devHtml = new Map(dev.pages.map((p) => [p.url, p.html]));
    for (const p of prod.pages) {
      const other = devHtml.get(p.url);
      assert(other !== undefined, `dev 缺少页面 ${p.url}`);
      assert.strictEqual(p.html, other, `页面 ${p.url} 产物不一致`);
    }
  });

  await test('相对 .md 链接在 worker 模式下也被重写', () => {
    const page = prod.pages.find((p) => p.url === '/docs/');
    assert(page.html.includes('href="/docs/b/"'), page.html.slice(0, 400));
  });

  await test('引用式链接与脚注在 worker 模式下同样解析', () => {
    const page = prod.pages.find((p) => p.url === '/syntax/');
    assert(page.html.includes('href="/docs/b/"'), '引用式链接未走链接解析：' + page.html.slice(0, 500));
    assert(page.html.includes('class="footnote-ref"'), '脚注未渲染');
    assert(page.html.includes('id="fnref-a-2"'), '脚注多次引用编号错误');
  });

  await test('日期按本地时区，不因时区倒退一天', () => {
    const c = prod.pages.find((p) => p.url === '/c/');
    assert.strictEqual(prod.serializePage(c).date, '2026-03-05');
  });

  await test('列表页能拿到阅读时长', () => {
    const home = prod.pages.find((p) => p.url === '/');
    assert(/分钟/.test(home.html), '首页没有阅读时长');
  });

  await test('RSS 全文是正文，而不是整页 HTML', () => {
    const rss = fs.readFileSync(path.join(root, 'dist', 'feed.xml'), 'utf8');
    assert(!rss.includes('<!DOCTYPE'), 'RSS 里塞进了整页 HTML');
    assert(rss.includes('<content:encoded>'), 'RSS 缺少全文');
  });

  await test('front-matter 的 url 省略前导斜杠会被规范化', () => {
    const p = prod.pages.find((x) => x.key === 'slugged.md');
    assert.strictEqual(p.url, '/custom/');
    assert(fs.existsSync(path.join(root, 'dist', 'custom', 'index.html')));
  });

  await test('删除页面后旧产物与空目录会被清理', async () => {
    write('temp-page.md', '---\ntitle: 临时\n---\n\nx\n');
    await build(root);
    assert(fs.existsSync(path.join(root, 'dist', 'temp-page', 'index.html')), '页面未生成');
    fs.rmSync(path.join(root, 'content', 'temp-page.md'));
    await build(root);
    assert(!fs.existsSync(path.join(root, 'dist', 'temp-page', 'index.html')), '旧产物未清理');
    assert(!fs.existsSync(path.join(root, 'dist', 'temp-page')), '空目录未清理');
  });

  await test('改配置后增量构建不会留下旧页面', async () => {
    const cacheDir = path.join(root, '.xfm');
    fs.rmSync(cacheDir, { recursive: true, force: true });
    await build(root, { mode: 'development' });
    assert(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8').includes('一致性'));
    writeConfig({ workerThreshold: 1, workers: 2, defaults: { layout: 'post.html' }, site: { title: '改过了', base: '/' } });
    await build(root, { mode: 'development' });
    assert(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8').includes('改过了'), '增量缓存未按配置失效');
  });

  await test('dev server 配置热重载生效', async () => {
    const { DevServer } = require('../lib/engine/server');
    const srvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-dev-'));
    fs.mkdirSync(path.join(srvRoot, 'content'), { recursive: true });
    const cfg = (t) => fs.writeFileSync(path.join(srvRoot, 'xfm.config.mjs'), `export default { site: { title: '${t}' }, theme: 'default' };\n`);
    cfg('旧标题');
    fs.writeFileSync(path.join(srvRoot, 'content', 'x.md'), '---\ntitle: X\nlayout: page.html\n---\n\nhi\n');
    const dev2 = new DevServer(srvRoot, { port: 0 });
    await dev2.start();
    try {
      await dev2.reloadConfig();
      cfg('新标题');
      await dev2.reloadConfig();
      await dev2.rebuild();
      const page = dev2.site.pages.find((p) => p.url === '/x/');
      assert(page.html.includes('新标题'), '配置未热重载');
    } finally {
      await dev2.close();
      fs.rmSync(srvRoot, { recursive: true, force: true });
    }
  });

  await test('dev 插件代码改动会热重载并重新渲染', async () => {
    const { DevServer } = require('../lib/engine/server');
    const srvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-dev-plugin-'));
    try {
      fs.mkdirSync(path.join(srvRoot, 'content'), { recursive: true });
      fs.mkdirSync(path.join(srvRoot, 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(srvRoot, 'xfm.config.mjs'), `export default { site: { title: 'T' }, theme: 'default' };\n`);
      fs.writeFileSync(path.join(srvRoot, 'content', 'x.md'), '---\ntitle: X\nlayout: page.html\n---\n\nhi\n');
      const pluginFile = path.join(srvRoot, 'plugins', 'marker.js');
      const writePlugin = (word) => fs.writeFileSync(
        pluginFile,
        `module.exports = () => ({ name: 'marker', transformHtml(html) { return html.replace('</body>', '<div id="m">${word}</div></body>'); } });\n`
      );
      writePlugin('old');

      const dev = new DevServer(srvRoot, { port: 0 });
      await dev.start();
      try {
        const markerCount = () => dev.site.plugins.names().filter((n) => n === 'marker').length;
        let page = dev.site.pages.find((p) => p.url === '/x/');
        assert(page.html.includes('id="m">old'), '初始插件未生效');
        assert.strictEqual(markerCount(), 1, '插件重复注册');

        writePlugin('new');
        await dev.reloadPlugins();
        await dev.rebuild();
        page = dev.site.pages.find((p) => p.url === '/x/');
        assert(page.html.includes('id="m">new'), '插件改动未热重载');
        assert(!page.html.includes('id="m">old'), '旧插件产物残留');
        assert.strictEqual(markerCount(), 1, '重载后插件重复注册');
      } finally {
        await dev.close();
      }
    } finally {
      fs.rmSync(srvRoot, { recursive: true, force: true });
    }
  });

  fs.rmSync(root, { recursive: true, force: true });
}

/* ---------------- 0.4.0：base / 分页 / 搜索 ---------------- */
async function testExtras() {
  console.log('\n站点扩展（base / 分页 / 搜索）');

  const { execFileSync } = require('child_process');
  const bin = path.join(__dirname, '..', 'bin', 'xfm.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-extra-'));

  const write = (rel, body) => {
    const abs = path.join(root, 'content', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };

  try {
    fs.writeFileSync(
      path.join(root, 'xfm.config.mjs'),
      `export default {
  site: {
    title: '扩展站',
    base: '/blog/',
    url: 'https://example.com',
    nav: [{ title: '首页', url: '/' }, { title: '归档', url: '/archives/' }],
  },
  theme: 'themes/default',
  plugins: ['sitemap', 'rss', 'feed-json', 'search', 'seo', 'related', 'llms'],
  pagination: { perPage: 2 },
  related: { limit: 2 },
  defaults: { layout: 'post.html' },
};
`
    );
    write('index.md', '---\ntitle: 首页\nlayout: index.html\n---\n');
    for (let i = 1; i <= 5; i++) {
      write(
        `posts/p${i}.md`,
        `---\ntitle: 文章 ${i}\ndate: 2026-03-0${i}\ntags: [标签${i}, 共同]\n---\n\n## 第 ${i} 节\n\n正文 ${i} 号，[外链](https://example.com/x${i})。\n`
      );
    }
    write('hidden.md', '---\ntitle: 不参与搜索\ntype: page\ndate: 2026-01-01\nsearch: false\n---\n\n这页不进索引。\n');

    execFileSync(process.execPath, [bin, 'build', root], { stdio: 'pipe' });

    await test('site.base 只影响链接，不影响落盘路径', () => {
      assert(fs.existsSync(path.join(root, 'dist', 'assets', 'style.css')), '资源落盘路径被 base 影响');
      assert(fs.existsSync(path.join(root, 'dist', 'posts', 'p1', 'index.html')), '页面落盘路径被 base 影响');

      const home = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
      assert(home.includes('href="/blog/assets/style.css"'), '样式表没带前缀');
      assert(home.includes('src="/blog/assets/ux.js"'), '脚本没带前缀');
      assert(home.includes('href="/blog/posts/p5/"'), '文章链接没带前缀');
      assert(home.includes('href="/blog/"'), '品牌/首页链接没带前缀');

      const post = fs.readFileSync(path.join(root, 'dist', 'posts', 'p1', 'index.html'), 'utf8');
      assert(post.includes('href="https://example.com/x1"'), '外链被改写了');
      assert(!post.includes('/blog/blog/'), '前缀被重复叠加');
    });

    await test('sitemap / 搜索索引里的地址带 base', () => {
      const sm = fs.readFileSync(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
      assert(sm.includes('<loc>https://example.com/blog/posts/p1/</loc>'), 'sitemap 未拼上 url+base：' + sm.slice(0, 200));
      const index = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'search.json'), 'utf8'));
      assert.strictEqual(index.count, 5, '索引条数不对：' + index.count);
      assert(index.items.every((it) => it.url.startsWith('/blog/')), '索引 url 没带 base');
      assert(!index.items.some((it) => it.title === '不参与搜索'), 'search:false 的页面进了索引');
      assert(!index.items.some((it) => it.url === '/blog/'), '首页不该进索引');
    });

    await test('分页生成真实静态页，条数按 perPage', () => {
      assert(fs.existsSync(path.join(root, 'dist', 'page', '2', 'index.html')), '第 2 页没生成');
      assert(fs.existsSync(path.join(root, 'dist', 'page', '3', 'index.html')), '第 3 页没生成');
      assert(!fs.existsSync(path.join(root, 'dist', 'page', '4')), '多生成了第 4 页');

      const home = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
      assert.strictEqual((home.match(/class="card"/g) || []).length, 2, '首页卡片数不等于 perPage');
      const p3 = fs.readFileSync(path.join(root, 'dist', 'page', '3', 'index.html'), 'utf8');
      assert.strictEqual((p3.match(/class="card"/g) || []).length, 1, '末页条数不对');

      assert(home.includes('href="/blog/page/2/"'), '首页缺下一页链接');
      assert(p3.includes('href="/blog/page/2/"'), '末页缺上一页链接');
      assert(/第 3 页/.test(p3), '分页页标题没标注页码');
      assert(p3.includes('is-current'), '分页组件没标出当前页');
    });

    await test('分页页不进 RSS、不进导航', () => {
      const rss = fs.readFileSync(path.join(root, 'dist', 'feed.xml'), 'utf8');
      assert(!rss.includes('/page/2/'), '分页页混进了 RSS');
      const idx = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'search.json'), 'utf8'));
      assert(!idx.items.some((it) => it.url.includes('/page/')), '分页页混进了搜索索引');
    });

    await test('首页模板不渲染列表时不生成分页', () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-nopage-'));
      try {
        scaffoldSite(docsRoot, ['--template=docs'], []);
        for (let i = 1; i <= 4; i++) {
          fs.writeFileSync(
            path.join(docsRoot, 'content', 'docs', `p${i}.md`),
            `---\ntitle: 文档 ${i}\ngroup: 指南\nweight: ${i}\ndate: 2026-02-0${i}\n---\n\n正文\n`
          );
        }
        execFileSync(process.execPath, [bin, 'build', docsRoot], { stdio: 'pipe' });
        assert(!fs.existsSync(path.join(docsRoot, 'dist', 'page')), 'docs 主题不该生成分页页');
      } finally {
        fs.rmSync(docsRoot, { recursive: true, force: true });
      }
    });

    await test('站点搜索生成索引且模板按需引入脚本', () => {
      const home = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
      assert(home.includes('data-search-open'), '导航缺搜索入口');
      assert(home.includes('/blog/assets/search.js'), '没引入 search.js');

      const off = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-nosearch-'));
      try {
        scaffoldSite(off, ['--template=blog'], []);
        const cfg = path.join(off, 'xfm.config.mjs');
        fs.writeFileSync(
          cfg,
          fs
            .readFileSync(cfg, 'utf8')
            .replace(/plugins:[^\n]*/, "plugins: ['sitemap', 'rss'],")
        );
        execFileSync(process.execPath, [bin, 'build', off], { stdio: 'pipe' });
        assert(!fs.existsSync(path.join(off, 'dist', 'search.json')), '未启用插件却生成了索引');
        const page = fs.readFileSync(path.join(off, 'dist', 'index.html'), 'utf8');
        assert(!page.includes('search.js'), '未启用插件却引入了 search.js');
      } finally {
        fs.rmSync(off, { recursive: true, force: true });
      }
    });

    await test('SEO 元信息按页注入且带 base 前缀', () => {
      const html = fs.readFileSync(path.join(root, 'dist', 'posts', 'p1', 'index.html'), 'utf8');
      assert(html.includes('<link rel="canonical" href="https://example.com/blog/posts/p1/">'), 'canonical 不对');
      assert(html.includes('property="og:type" content="article"'), '缺 og:type');
      assert(html.includes('property="og:url" content="https://example.com/blog/posts/p1/"'), 'og:url 不对');
      assert(html.includes('name="twitter:card"'), '缺 twitter card');
      assert(html.includes('"@type":"Article"'), '缺 Article 结构化数据');

      const home = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
      assert(home.includes('"@type":"WebSite"'), '首页缺 WebSite 结构化数据');
    });

    await test('相关文章按标签推荐且排除自身', () => {
      const html = fs.readFileSync(path.join(root, 'dist', 'posts', 'p1', 'index.html'), 'utf8');
      const m = html.match(/<section class="related">[\s\S]*?<\/section>/);
      assert(m, '缺相关文章区块');
      assert(!m[0].includes('href="/blog/posts/p1/"'), '推荐了自己');
      assert(/href="\/blog\/posts\/p[2-5]\/"/.test(m[0]), '没有推荐同标签文章');
    });

    await test('JSON Feed 与 llms.txt 产物', () => {
      const feed = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'feed.json'), 'utf8'));
      assert(feed.version === 'https://jsonfeed.org/version/1.1', 'JSON Feed 版本不对');
      assert(feed.items.length === 5, '条目数不对: ' + feed.items.length);
      assert(feed.items[0].url.startsWith('https://example.com/blog/posts/'), '条目地址缺域名或前缀');

      const llms = fs.readFileSync(path.join(root, 'dist', 'llms.txt'), 'utf8');
      assert(llms.startsWith('# 扩展站'), 'llms.txt 缺站点标题');
      assert(llms.includes('https://example.com/blog/posts/p1/'), 'llms.txt 缺文章地址');
      assert(fs.existsSync(path.join(root, 'dist', 'llms-full.txt')), '缺 llms-full.txt');
    });

    await test('dev 模式下插件产物按需生成并可访问', async () => {
      const { DevServer } = require('../lib/engine/server');
      const dev = new DevServer(root, { port: 0 });
      await dev.start();
      try {
        const res = await fetch(dev.url + 'blog/search.json');
        assert(res.status === 200, 'dev 下 search.json 不可访问：' + res.status);
        const json = await res.json();
        assert(Array.isArray(json.items) && json.items.length > 0, 'dev 搜索索引为空');

        const feed = await fetch(dev.url + 'blog/feed.json');
        assert(feed.status === 200, 'dev 下 feed.json 不可访问：' + feed.status);
      } finally {
        await dev.close();
      }
    });

    await test('minify 压缩空白并保护 pre/code', () => {
      const plugin = require('xfm-plugin-minify')({
        config: { minify: {} },
        mode: 'production',
      });
      const src = '<html>\n  <!-- 注释 -->\n  <body>\n\n\n    <p>文本</p>\n    <pre>\n  a\n\n\n  b\n</pre>\n  </body>\n</html>';
      const out = plugin.transformHtml(src);
      assert(!out.includes('<!--'), '注释未删除');
      assert(!/\n\s*\n/.test(out.replace(/\n?<pre>[\s\S]*?<\/pre>/g, '')), 'pre 之外仍有连续空行');
      assert(out.includes('<pre>\n  a\n\n\n  b\n</pre>'), 'pre 内容被改动');
    });

    // ---- 0.4.6 新增的六个插件（都用假 site 做单元测试，不依赖示例站） ----
    await test('analytics 注入统计脚本且 dev 下默认跳过', () => {
      const helpers = require('../lib/engine/helpers');
      const make = (mode, cfg) =>
        require('xfm-plugin-analytics')({ config: { analytics: cfg }, mode, helpers });
      const cfg = { provider: 'plausible', plausible: { domain: 'example.com' } };

      const prod = make('production', cfg);
      const html = prod.transformHtml('<html><body><p>x</p></body></html>', { page: { url: '/a/', data: {} } });
      assert(html.includes('src="https://plausible.io/js/script.js"'), '未注入 plausible');
      assert(html.includes('data-domain="example.com"'), '缺 data-domain');
      assert(html.indexOf('plausible') < html.indexOf('</body>'), '注入位置不在 body 末尾');

      const dev = make('development', cfg);
      assert(!dev.transformHtml('<html><body></body></html>', { page: { url: '/', data: {} } }).includes('plausible'), 'dev 下不该注入');

      const off = prod.transformHtml('<html><body></body></html>', { page: { url: '/x/', data: { analytics: false } } });
      assert(!off.includes('plausible'), 'front-matter analytics:false 未生效');
    });

    await test('giscus 只给文章页插评论区', () => {
      const plugin = require('xfm-plugin-giscus')({
        config: { comments: { repo: 'o/r', repoId: 'R_x', category: 'General', categoryId: 'D_x' } },
        mode: 'production',
        helpers: require('../lib/engine/helpers'),
      });

      const post = plugin.transformHtml('<article><p>x</p></article></body>', {
        page: { url: '/p/', date: '2026-01-01', data: {} },
      });
      assert(post.includes('giscus.app/client.js'), '文章页未插入评论区');
      assert(post.indexOf('data-xfm-comments') < post.indexOf('</article>'), '没插在文章内');

      const home = plugin.transformHtml('<main>x</main></body>', { page: { url: '/', date: '', data: {} } });
      assert(!home.includes('giscus'), '首页不该有评论区');

      const off = plugin.transformHtml('<article>x</article></body>', {
        page: { url: '/p/', date: '2026-01-01', data: { comments: false } },
      });
      assert(!off.includes('giscus'), 'front-matter comments:false 未生效');
    });

    await test('redirect 在旧地址生成跳转页', () => {
      const helpers = require('../lib/engine/helpers');
      const site = {
        mode: 'production',
        helpers,
        config: { site: { base: '/blog/', lang: 'zh-CN' }, redirects: { '/old/': '/new/' } },
        pages: [{ url: '/new/', data: {} }, { url: '/p/', data: { redirect_from: ['/2020/01/x.html'] } }],
        extraFiles: [],
      };
      const files = require('xfm-plugin-redirect')(site).afterBuild(site);
      const paths = files.map((f) => f.path).sort();
      assert(paths.includes('old/index.html'), '缺目录形式跳转页：' + paths.join(','));
      assert(paths.includes('2020/01/x.html'), '缺 .html 形式跳转页');

      const html = files.find((f) => f.path === 'old/index.html').contents;
      assert(html.includes('url=/blog/new/'), '跳转地址没带 base');
      assert(html.includes('noindex'), '跳转页缺 noindex');
    });

    await test('pwa 产出 manifest / sw / 离线页', async () => {
      const helpers = require('../lib/engine/helpers');
      const site = {
        root,
        mode: 'production',
        helpers,
        theme: null,
        config: { site: { title: '测试站', base: '/blog/' }, pwa: {}, publicDir: 'public' },
        pages: [{ url: '/' }],
        assets: async () => ({ themeAssets: [{ dest: 'assets/a.css' }], publicFiles: [] }),
        extraFiles: [],
      };
      const pwa = require('xfm-plugin-pwa')(site);
      const files = await pwa.afterBuild(site);
      const byName = new Map(files.map((f) => [f.path, f.contents]));

      const manifest = JSON.parse(byName.get('manifest.webmanifest'));
      assert(manifest.start_url === '/blog/', 'start_url 没带 base：' + manifest.start_url);
      assert(manifest.icons[0].src === '/blog/icon.svg', '图标路径没带 base');
      assert(byName.get('sw.js').includes('"/blog/assets/a.css"'), 'sw 预缓存缺资源');
      assert(byName.get('offline.html').includes('/blog/'), '离线页缺首页链接');
      assert(byName.get('icon.svg').includes('<svg'), '缺生成的图标');

      const html = pwa.transformHtml('<html><head></head><body></body></html>', { page: { url: '/', data: {} } });
      assert(html.includes('href="/blog/manifest.webmanifest"'), '未注入 manifest 链接');
      assert(html.includes('serviceWorker.register("/blog/sw.js")'), '未注册 service worker');
    });

    await test('image-size 读取 PNG 头补 width/height', () => {
      const helpers = require('../lib/engine/helpers');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-img-'));
      try {
        fs.mkdirSync(path.join(dir, 'public', 'img'), { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'public', 'img', 'a.png'),
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
          )
        );
        const site = { root: dir, mode: 'production', helpers, theme: null, config: { site: {}, imageSize: {} } };
        const plugin = require('xfm-plugin-image-size')(site);

        const out = plugin.transformHtml('<p><img src="/img/a.png" alt="a"></p>', { page: { url: '/', data: {} } });
        assert(out.includes('width="1"'), '缺 width：' + out);
        assert(out.includes('height="1"'), '缺 height：' + out);

        const ext = '<img src="https://cdn.example.com/a.png">';
        assert(plugin.transformHtml(ext, { page: { url: '/', data: {} } }) === ext, '外链不该被处理');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    await test('deadlinks 报出站内死链', async () => {
      const helpers = require('../lib/engine/helpers');
      const site = {
        mode: 'production',
        helpers,
        config: { site: { base: '/' }, deadlinks: {} },
        pages: [
          { url: '/a/', html: '<a href="/b/">ok</a><a href="/missing/">bad</a><a href="https://x.com/">ext</a>' },
          { url: '/b/', html: '' },
        ],
        extraFiles: [],
        assets: async () => ({ themeAssets: [], publicFiles: [] }),
      };

      const warn = console.warn;
      console.warn = () => {};
      let files;
      try {
        files = await require('xfm-plugin-deadlinks')(site).afterBuild(site);
      } finally {
        console.warn = warn;
      }
      const json = JSON.parse(files[0].contents);
      assert(json.total === 1, '死链数量不对：' + json.total);
      assert(json.links[0].href === '/missing/', '死链地址不对：' + json.links[0].href);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  const t0 = performance.now();
  await testMarkdown();
  await testTemplate();
  await testFrontMatter();
  await testBuild();
  await testConsistency();
  await testExtras();
  const ms = (performance.now() - t0).toFixed(0);

  console.log(`\n${passed} 通过，${failed} 失败（${ms}ms）\n`);
  process.exit(failed ? 1 : 0);
})();
