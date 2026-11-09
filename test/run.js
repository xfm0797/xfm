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
  const { execFileSync } = require('child_process');
  const bin = path.join(__dirname, '..', 'bin', 'xfm.js');

  execFileSync(process.execPath, [bin, 'create', tmp, '--template=blog', '--title=测试站', '--force'], { stdio: 'pipe' });
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

  await test('HTML 语义结构', () => {
    const html = fs.readFileSync(path.join(tmp, 'dist', 'posts', 'hello-world', 'index.html'), 'utf8');
    assert(html.includes('<h1'), '缺少 h1');
    assert(html.includes('lang="zh-CN"'), '缺少 lang');
    assert(html.includes('/assets/style.css'), '缺少样式引用');
  });

  await test('目录滚动高亮脚本随文章页下发', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-toc-'));
    try {
      execFileSync(process.execPath, [bin, 'create', dir, '--template=blog', '--force'], { stdio: 'pipe' });
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

  await test('草稿不发布', () => {
    fs.writeFileSync(path.join(tmp, 'content', 'posts', 'draft-test.md'),
      '---\ntitle: 草稿测试\ndraft: true\n---\n草稿');
    execFileSync(process.execPath, [bin, 'build', tmp], { stdio: 'pipe' });
    assert(!fs.existsSync(path.join(tmp, 'dist', 'posts', 'draft-test', 'index.html')), '草稿被发布了');
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
      execFileSync(process.execPath, [bin, 'create', docsTmp, '--template=docs', '--title=文档站', '--force'], { stdio: 'pipe' });
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
      execFileSync(process.execPath, [bin, 'create', taxTmp, '--template=blog', '--title=标签站', '--force'], { stdio: 'pipe' });
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
      execFileSync(process.execPath, [bin, 'create', taxTmp, '--template=blog', '--title=索引站', '--force'], { stdio: 'pipe' });
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

  await test('分类索引页与归档页生成', () => {
    const idxTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfm-idx-'));
    try {
      execFileSync(process.execPath, [bin, 'create', idxTmp, '--template=blog', '--title=索引站', '--force'], { stdio: 'pipe' });
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
      execFileSync(process.execPath, [bin, 'create', docsTmp, '--template=docs', '--force'], { stdio: 'pipe' });
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
      execFileSync(process.execPath, [bin, 'create', offTmp, '--template=blog', '--force'], { stdio: 'pipe' });
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
        execFileSync(process.execPath, [bin, 'create', docsRoot, '--template=docs', '--force'], { stdio: 'pipe' });
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
        execFileSync(process.execPath, [bin, 'create', off, '--template=blog', '--force'], { stdio: 'pipe' });
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
      const plugin = require('../lib/plugins/minify.js')({
        config: { minify: {} },
        mode: 'production',
      });
      const src = '<html>\n  <!-- 注释 -->\n  <body>\n\n\n    <p>文本</p>\n    <pre>\n  a\n\n\n  b\n</pre>\n  </body>\n</html>';
      const out = plugin.transformHtml(src);
      assert(!out.includes('<!--'), '注释未删除');
      assert(!/\n\s*\n/.test(out.replace(/\n?<pre>[\s\S]*?<\/pre>/g, '')), 'pre 之外仍有连续空行');
      assert(out.includes('<pre>\n  a\n\n\n  b\n</pre>'), 'pre 内容被改动');
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
