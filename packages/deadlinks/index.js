'use strict';
/**
 * deadlinks 插件（xfm-plugin-deadlinks）
 *
 * 安装：npm i -D xfm-plugin-deadlinks —— 装了就生效（也可在 config.plugins 写 'deadlinks'）
 * -------------------------------------------------------------------
 * 构建结束后把成品页面里所有站内链接与资源地址过一遍，对不上任何产物的就是死链。
 * 只查站内（同源）地址，外链不发请求 —— 静态构建不该为了检查去联网。
 *
 * 配置：
 *   deadlinks: {
 *     report: true,          // 额外产出 deadlinks.json（排查用）
 *     strict: false,         // true = 发现死链时构建失败（当 CI 门禁用）
 *     limit: 20,             // 控制台最多列多少条
 *     ignore: [              // 前缀匹配，或 /正则/
 *       '/api/',
 *       /^\/assets\/legacy\//,
 *     ],
 *     dev: false,            // dev 下是否也检查（默认只在 build 时）
 *   }
 *
 * 为什么能查准：页面、主题资源、public 文件、其他插件产出（sitemap/feed/manifest…）
 * 都参与比对；插件产物名还额外有一份内置白名单，避免插件注册顺序影响结果。
 */
/** 常见插件产物：即使该插件排在本插件之后，也不至于误报 */
const KNOWN_OUTPUTS = [
  'sitemap.xml',
  'robots.txt',
  'feed.xml',
  'feed.json',
  'search.json',
  'llms.txt',
  'llms-full.txt',
  'manifest.webmanifest',
  'sw.js',
  'offline.html',
  'icon.svg',
  'stats.json',
  '404.html',
];

const RE_LINK = /\s(?:href|src)\s*=\s*"([^"]*)"|\s(?:href|src)\s*=\s*'([^']*)'/gi;
const SKIP_SCHEME = /^(?:[a-z][\w+.-]*:|\/\/)/i; // http:、mailto:、data:、//cdn…

module.exports = (site) => {
  const { normalizeBase } = site.helpers;
  const cfg = site.config.deadlinks || {};
  const base = normalizeBase((site.config.site || {}).base);
  const limit = Number(cfg.limit) || 20;

  const ignore = (cfg.ignore || []).map((it) => (it instanceof RegExp ? it : String(it)));
  const ignored = (url) => ignore.some((it) => (it instanceof RegExp ? it.test(url) : url.startsWith(it)));

  /** 页面上出现的地址 → 裸 URL（去 base、去 query/hash、解码） */
  const toBare = (raw, pageUrl) => {
    let u = String(raw).trim();
    if (!u || u.startsWith('#')) return null;
    if (SKIP_SCHEME.test(u)) return null;

    // 相对地址按当前页面解析（以页面 URL 为基准，补前导斜杠当目录处理）
    if (!u.startsWith('/')) {
      try {
        u = new URL(u, 'http://x.invalid' + (pageUrl || '/')).pathname;
      } catch (e) {
        return null;
      }
    }
    try { u = decodeURI(u); } catch (e) { /* 保留原样 */ }

    if (base !== '/' && base !== '' && u.startsWith(base)) u = '/' + u.slice(base.length);
    return u;
  };

  return {
    name: 'deadlinks',

    async afterBuild(site) {
      if (site.mode !== 'production' && !cfg.dev) return [];

      // ---- 1. 收集所有产物地址 ----
      const ok = new Set(['/']);
      // 页面 URL 带百分号编码（/tags/%E6%B5%8B/），链接侧已解码，这里统一成解码形式再比
      const dec = (u) => {
        try { return decodeURI(u); } catch (e) { return u; }
      };
      const add = (p) => {
        const clean = dec('/' + String(p).replace(/\\/g, '/').replace(/^\/+/, ''));
        ok.add(clean);
        if (clean.endsWith('/index.html')) {
          const dir = clean.slice(0, -'index.html'.length);
          ok.add(dir); // /posts/x/
          ok.add(dir.replace(/\/$/, '')); // /posts/x
        }
      };

      for (const p of site.pages || []) {
        add(p.url);
        const u = dec(p.url);
        ok.add(u);
        ok.add(u.replace(/\/$/, ''));
        if (u.endsWith('/')) ok.add(u + 'index.html');
      }
      try {
        const { themeAssets, publicFiles } = await site.assets();
        for (const a of themeAssets) add(a.dest);
        for (const f of publicFiles) add(f.dest);
      } catch (e) { /* 资源清单拿不到就只比页面 */ }
      for (const f of site.extraFiles || []) add(f.path);
      for (const f of KNOWN_OUTPUTS) add(f);

      // ---- 2. 扫页面里的链接 ----
      const dead = [];
      const seen = new Set();
      for (const p of site.pages || []) {
        if (!p.html) continue;
        RE_LINK.lastIndex = 0;
        let m;
        while ((m = RE_LINK.exec(p.html))) {
          const raw = m[1] !== undefined ? m[1] : m[2];
          const u = toBare(raw, p.url);
          if (!u || ignored(u)) continue;

          // 目录形式、无斜杠形式、带 index.html 形式都认
          const hit = ok.has(u) || ok.has(u.replace(/\/$/, '') + '/') || ok.has(u.replace(/\/$/, '') + '/index.html');
          if (hit) continue;

          const key = u;
          if (seen.has(key)) continue;
          seen.add(key);
          dead.push({ from: p.url, href: u });
        }
      }

      // ---- 3. 汇报 ----
      if (!dead.length) {
        if (site.mode === 'production') console.log(`  ${'✓'} 死链检查  未发现站内死链`);
        return [];
      }

      const lines = dead.slice(0, limit).map((d) => `    ${d.href}  ← ${d.from}`);
      console.warn(
        `\n[xfm-plugin-deadlinks] 发现 ${dead.length} 处站内死链${dead.length > limit ? `（只列前 ${limit} 条）` : ''}\n` +
          lines.join('\n') +
          `\n`
      );

      if (cfg.strict) {
        throw new Error(`[xfm-plugin-deadlinks] ${dead.length} 处站内死链（deadlinks.strict = true）`);
      }

      return cfg.report === false
        ? []
        : [{ path: 'deadlinks.json', contents: JSON.stringify({ total: dead.length, links: dead }, null, 2) + '\n' }];
    },
  };
};
