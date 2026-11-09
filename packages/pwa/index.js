'use strict';
/**
 * pwa 插件（xfm-plugin-pwa）
 *
 * 安装：npm i -D xfm-plugin-pwa —— 装了就生效（也可在 config.plugins 写 'pwa'）
 * -------------------------------------------------------------------
 * 让站点可以「添加到主屏幕」并离线可读：
 *
 *   - manifest.webmanifest（名称、图标、主题色、独立窗口）
 *   - sw.js（导航请求网络优先、静态资源缓存优先；断网时回退缓存/离线页）
 *   - offline.html（断网且没缓存时的兜底页）
 *   - 页面里注入 <link rel="manifest"> / <meta name="theme-color">
 *
 * 没准备图标也能用：插件会用站点标题首字生成一个 icon.svg。
 *
 * 配置：
 *   pwa: {
 *     name: '站点全名',            // 默认取 site.title
 *     shortName: '短名',           // 默认取 site.title（过长会截断）
 *     description: '…',            // 默认取 site.description
 *     themeColor: '#3b82f6',       // 浏览器地址栏 / 状态栏颜色
 *     backgroundColor: '#ffffff',
 *     display: 'standalone',
 *     icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
 *     offline: true,               // 生成离线兜底页
 *     cacheExtra: ['/assets/font.woff2'],   // 额外要预缓存的地址
 *     manifestPath: 'manifest.webmanifest',
 *     swPath: 'sw.js',
 *     dev: false,                  // dev 下是否为页面注入 manifest 链接（默认只在生产）
 *   }
 *
 * 注意：Service Worker 只在 https 或 localhost 下生效；构建产物直接用 file:// 打开时无效。
 */
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 稳定短 hash（缓存版本号用，不用加密级） */
function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** 只把"值得预缓存"的静态资源放进 sw 清单 */
const PRECACHE_EXT = /\.(css|js|mjs|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/i;

module.exports = (site) => {
  const { withBase, normalizeBase } = site.helpers;
  const cfg = site.config.pwa || {};
  const siteConf = site.config.site || {};
  const base = normalizeBase(siteConf.base);

  const name = cfg.name || siteConf.title || 'xfm site';
  const shortName = cfg.shortName || (name.length > 12 ? name.slice(0, 12) : name);
  const description = cfg.description || siteConf.description || '';
  const themeColor = cfg.themeColor || '#3b82f6';
  const backgroundColor = cfg.backgroundColor || '#ffffff';
  const manifestPath = String(cfg.manifestPath || 'manifest.webmanifest').replace(/^\/+/, '');
  const swPath = String(cfg.swPath || 'sw.js').replace(/^\/+/, '');
  const offline = cfg.offline !== false;
  const inDev = cfg.dev === true;

  /** 图标：用户给了就用用户的，否则生成一个首字母 SVG */
  const icons = Array.isArray(cfg.icons) && cfg.icons.length
    ? cfg.icons.map((i) => ({ ...i, src: withBase(base, String(i.src || '').startsWith('/') ? i.src : '/' + i.src) }))
    : [{ src: withBase(base, '/icon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];

  const iconSvg = () => {
    const ch = esc([...String(name).trim()][0] || 'x').toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${esc(name)}">
  <rect width="512" height="512" rx="96" fill="${esc(themeColor)}"/>
  <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif"
        font-size="272" font-weight="600" fill="#fff">${ch}</text>
</svg>
`;
  };

  const manifest = () =>
    JSON.stringify(
      {
        name,
        short_name: shortName,
        description,
        lang: siteConf.lang || 'zh-CN',
        start_url: withBase(base, '/'),
        scope: withBase(base, '/'),
        display: cfg.display || 'standalone',
        theme_color: themeColor,
        background_color: backgroundColor,
        icons,
      },
      null,
      2
    ) + '\n';

  /** 预缓存清单：首页 + 主题资源 + public 里的静态资源（css/js/字体/图片） */
  const precache = async () => {
    const list = new Set([withBase(base, '/')]);
    for (const extra of cfg.cacheExtra || []) list.add(withBase(base, extra));
    try {
      const { themeAssets, publicFiles } = await site.assets();
      for (const a of themeAssets) list.add(withBase(base, '/' + a.dest.replace(/\\/g, '/')));
      for (const f of publicFiles) {
        if (!PRECACHE_EXT.test(f.dest)) continue;
        list.add(withBase(base, '/' + f.dest.replace(/\\/g, '/')));
      }
    } catch (e) { /* 拿不到资源清单就只缓存首页 */ }
    return [...list].sort();
  };

  const serviceWorker = (assets) => {
    // 缓存名掺入内容摘要：清单变了就换新缓存，用户不会卡在旧版本上
    const version = shortHash(assets.join('\n') + themeColor);
    const offlineUrl = withBase(base, '/offline.html');
    return `/* 由 xfm-plugin-pwa 生成 */
const CACHE = 'xfm-${version}';
const OFFLINE = ${JSON.stringify(offlineUrl)};
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  // 页面导航：网络优先，断网回退缓存，再回退离线页
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE)))
    );
    return;
  }

  // 静态资源：缓存优先，未命中再取网络并顺手存下
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
`;
  };

  const offlinePage = () => {
    const home = withBase(base, '/');
    return `<!DOCTYPE html>
<html lang="${esc(siteConf.lang || 'zh-CN')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>离线 · ${esc(name)}</title>
</head>
<body style="font:16px/1.7 system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:0 1.25rem;text-align:center">
<h1 style="font-size:1.5rem">当前处于离线状态</h1>
<p style="color:#666">页面没有缓存，网络恢复后刷新即可。</p>
<p><a href="${esc(home)}" style="color:#2563eb">← 返回首页</a></p>
</body>
</html>
`;
  };

  return {
    name: 'pwa',

    transformHtml(html, ctx) {
      if (!inDev && site.mode !== 'production') return html;
      const page = (ctx && ctx.page) || null;
      if (page && page.data && page.data.pwa === false) return html;
      if (!/<\/head>/i.test(html) || html.includes('rel="manifest"')) return html;

      const head =
        `<link rel="manifest" href="${esc(withBase(base, '/' + manifestPath))}">\n` +
        `<meta name="theme-color" content="${esc(themeColor)}">\n` +
        `<link rel="apple-touch-icon" href="${esc(icons[0].src)}">`;

      let out = html.replace(/<\/head>/i, `${head}\n</head>`);

      // 注册脚本：只在生产、且页面有 </body> 时加
      const at = out.lastIndexOf('</body>');
      if (site.mode === 'production' && at !== -1 && !out.includes('data-xfm-pwa')) {
        const reg =
          `<script data-xfm-pwa>if('serviceWorker' in navigator&&location.protocol==='https:')` +
          `{addEventListener('load',function(){navigator.serviceWorker.register(` +
          `${JSON.stringify(withBase(base, '/' + swPath))}).catch(function(){})})}</script>\n`;
        out = out.slice(0, at) + reg + out.slice(at);
      }
      return out;
    },

    async afterBuild() {
      const files = [
        { path: manifestPath, contents: manifest() },
        { path: swPath, contents: serviceWorker(await precache()) },
      ];
      if (offline) files.push({ path: 'offline.html', contents: offlinePage() });
      // 用户没自带图标时才生成，避免覆盖同名文件
      if (!(Array.isArray(cfg.icons) && cfg.icons.length)) files.push({ path: 'icon.svg', contents: iconSvg() });
      return files;
    },
  };
};
