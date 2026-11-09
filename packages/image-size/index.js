'use strict';
/**
 * image-size 插件（xfm-plugin-image-size）
 *
 * 安装：npm i -D xfm-plugin-image-size —— 装了就生效（也可在 config.plugins 写 'image-size'）
 * -------------------------------------------------------------------
 * 给正文里的 <img> 补上 width / height 属性。
 *
 * 为什么值得装：浏览器提前知道图片长宽，就能先把位置留出来，
 * 图片加载完成时页面不会往下蹦一下（CLS，Core Web Vitals 里的一项）。
 * 只读本地文件头几十个字节，不联网、不解码整张图。
 *
 * 支持的格式：PNG / JPEG / GIF / WebP / SVG。
 * 图片来源：public/ 目录（默认）与当前主题的 assets/ 目录。
 *
 * 配置：
 *   imageSize: {
 *     publicDir: 'public',     // 站点静态资源目录
 *     lazy: true,              // 顺带给没有 loading 的图片补 loading="lazy"
 *     dev: false,              // dev 下是否也处理（默认只在生产构建）
 *   }
 *
 * 已经是外链、data:、或已有 width+height 的图片原样放过。
 */
const fs = require('fs');
const path = require('path');

module.exports = (site) => {
  const { normalizeBase } = site.helpers;
  const cfg = site.config.imageSize || {};
  const base = normalizeBase((site.config.site || {}).base);
  const publicDir = path.resolve(site.root, cfg.publicDir || site.config.publicDir || 'public');
  const lazy = cfg.lazy !== false;
  const inDev = cfg.dev === true;

  const cache = new Map(); // 文件绝对路径 → {width,height} | null

  /** 从文件头解析尺寸：只读前 64KB，足够覆盖 EXIF 之后的 SOF 段 */
  function readSize(file) {
    if (cache.has(file)) return cache.get(file);
    let size = null;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        size = parseSize(buf.subarray(0, n));
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      size = null;
    }
    cache.set(file, size);
    return size;
  }

  /** 把 /img/a.png 映射回磁盘文件；越界（../）直接放弃 */
  function resolveFile(urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch (e) { rel = urlPath; }
    rel = rel.replace(/^\/+/, '');
    if (!rel || rel.includes('\0')) return null;

    const candidates = [];
    const safe = (dir, sub) => {
      const abs = path.resolve(dir, sub);
      // 必须落在该目录内，防止 ../../etc/passwd 这类路径
      if (abs === dir || abs.startsWith(dir + path.sep)) candidates.push(abs);
    };

    safe(publicDir, rel);
    if (rel.startsWith('assets/') && site.theme && site.theme.dir) {
      safe(path.join(site.theme.dir, 'assets'), rel.slice('assets/'.length));
    }
    for (const abs of candidates) {
      try {
        if (fs.statSync(abs).isFile()) return abs;
      } catch (e) { /* 不存在，试下一个 */ }
    }
    return null;
  }

  return {
    name: 'image-size',

    transformHtml(html, ctx) {
      if (!html || !html.includes('<img')) return html;
      if (!inDev && site.mode !== 'production') return html;
      const page = (ctx && ctx.page) || null;
      if (page && page.data && page.data.imageSize === false) return html;

      return html.replace(/<img\b[^>]*>/gi, (tag) => {
        // 两个尺寸都有就没什么可补的
        const hasW = /\swidth\s*=/.test(tag);
        const hasH = /\sheight\s*=/.test(tag);
        if (hasW && hasH) return tag;

        const m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
        if (!m) return tag;
        let src = m[1] !== undefined ? m[1] : m[2];
        if (!src || /^([a-z][\w+.-]*:|\/\/|#)/i.test(src)) return tag; // 外链 / data: / 锚点

        // 剥 base 前缀，只留站点内裸路径
        src = src.split('#')[0].split('?')[0];
        if (base !== '/' && src.startsWith(base)) src = '/' + src.slice(base.length);
        if (!src.startsWith('/')) return tag;

        const file = resolveFile(src);
        const size = file ? readSize(file) : null;
        if (!size || !size.width || !size.height) return tag;

        const attrs = [];
        if (!hasW) attrs.push(`width="${size.width}"`);
        if (!hasH) attrs.push(`height="${size.height}"`);
        if (lazy && !/\sloading\s*=/.test(tag)) attrs.push('loading="lazy"');
        if (!attrs.length) return tag;
        return tag.replace(/<img\b/i, `<img ${attrs.join(' ')}`);
      });
    },
  };
};

/** 按魔数分派：PNG / JPEG / GIF / WebP / SVG */
function parseSize(buf) {
  if (!buf || buf.length < 12) return null;

  // PNG：IHDR 里的宽高（大端 32 位）
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF：逻辑屏幕描述符（小端 16 位）
  const head3 = buf.slice(0, 3).toString('ascii');
  if (head3 === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP：RIFF 容器，三种子格式
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const fmt = buf.slice(12, 16).toString('ascii');
    if (fmt === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fmt === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fmt === 'VP8X' && buf.length >= 30) {
      return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    return null;
  }

  // JPEG：跳过各类段，找 SOF0/1/2…
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // 无长度字段的标记
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      // SOF：C0–CF，但 C4(DHT)、C8(JPG)、CC(DAC) 不是
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }

  // SVG：width/height 属性优先，退回 viewBox
  const text = buf.slice(0, Math.min(buf.length, 4096)).toString('utf8');
  if (/<svg[\s>]/i.test(text)) {
    const w = /\swidth\s*=\s*["']?\s*([\d.]+)/i.exec(text);
    const h = /\sheight\s*=\s*["']?\s*([\d.]+)/i.exec(text);
    if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
    const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
  }

  return null;
}
