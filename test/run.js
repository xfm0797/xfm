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

  await test('首页 title 拼上站点名', () => {
    const home = fs.readFileSync(path.join(tmp, 'dist', 'index.html'), 'utf8');
    const m = /<title>([^<]*)<\/title>/.exec(home);
    assert(m && m[1].includes('测试站'), '首页 title 缺少站点名：' + (m && m[1]));
    const post = fs.readFileSync(path.join(tmp, 'dist', 'posts', 'hello-world', 'index.html'), 'utf8');
    const mp = /<title>([^<]*)<\/title>/.exec(post);
    assert(mp[1].includes('你好，世界') && mp[1].includes('测试站'), '文章页 title 不完整：' + mp[1]);
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

(async () => {
  const t0 = performance.now();
  await testMarkdown();
  await testTemplate();
  await testFrontMatter();
  await testBuild();
  await testConsistency();
  const ms = (performance.now() - t0).toFixed(0);

  console.log(`\n${passed} 通过，${failed} 失败（${ms}ms）\n`);
  process.exit(failed ? 1 : 0);
})();
