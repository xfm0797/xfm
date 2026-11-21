'use strict';
/**
 * seo 插件（xfm-plugin-seo）
 *
 * 安装：npm i -D xfm-plugin-seo —— 装了就生效（也可在 config.plugins 写 'seo'）
 * -------------------------------------------------------------------
 * 给每个页面补上爬虫与社交平台需要的元信息：
 *
 *   - <link rel="canonical">
 *   - Open Graph（og:type/title/description/url/image/site_name/locale，
 *     文章额外有 article:published_time / modified_time / tag）
 *   - Twitter Card（summary_large_image 或 summary）
 *   - JSON-LD（文章 Article、首页 WebSite，site.search 开启时附 SearchAction）
 *
 * 尊重模板：head 里已经手写了 canonical / og:title 时不重复注入。
 * 页面级开关（front-matter）：
 *   image: /cover.png    覆盖分享图
 *   canonical: https://… 覆盖规范地址
 *   noindex: true        输出 noindex,follow
 *   seo: false           整页跳过本插件
 *
 * 配置：
 *   seo: { image: '/og.png', twitter: '@handle', jsonLd: true }
 */
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 本地日历日 → ISO 8601（补零点，避免不同运行环境解析出前一天） */
function isoDate(day) {
  if (!day) return '';
  const s = String(day);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00+00:00`;
  return s;
}

/** zh-CN → zh_CN */
function ogLocale(lang) {
  return String(lang || 'zh-CN').replace('-', '_');
}

module.exports = (site) => {
  const { absoluteUrl } = site.helpers;
  const cfg = site.config.seo || {};
  const siteConf = site.config.site || {};
  const siteName = siteConf.title || '';
  const lang = siteConf.lang || 'zh-CN';
  const defaultImage = cfg.image ? absoluteUrl(siteConf, cfg.image) : '';
  const twitter = cfg.twitter || '';

  return {
    name: 'seo',

    transformHtml(html, ctx) {
      const page = (ctx && ctx.page) || null;
      if (!page || !html) return html;
      const data = page.data || {};
      if (data.seo === false) return html;
      if (!/<\/head>/i.test(html)) return html;

      // 多语言：仅当站点声明了多个语言时才注入 hreflang / og:locale:alternate，
      // 单语站完全不输出，保证现有产物零变化。
      const pageLang = page.lang || lang;
      const pageTranslations = Array.isArray(page.translations) ? page.translations : [];
      const langs = siteConf.languages;
      const isMultilingual = Array.isArray(langs) && langs.length > 1;

      const isPost = !!page.date && page.url !== '/' && data.type !== 'page';
      const canonical = data.canonical
        ? String(data.canonical)
        : absoluteUrl(siteConf, page.url || '/');

      const title = page.title || siteName;
      const desc =
        data.description ||
        page.description ||
        (page.excerpt || '').replace(/\s+/g, ' ').slice(0, 160) ||
        siteConf.description ||
        '';

      let image = '';
      const rawImage = data.image || cfg.image;
      if (rawImage) image = /^https?:\/\//i.test(rawImage) ? rawImage : absoluteUrl(siteConf, rawImage);

      const out = [];

      // canonical：模板手写过就不动
      if (!/rel=["']canonical["']/i.test(html)) {
        out.push(`<link rel="canonical" href="${esc(canonical)}">`);
      }

      // hreflang alternate：多语站 + 页面有翻译版本时注入；模板已手写 hreflang 则不动
      if (isMultilingual && pageTranslations.length && !/hreflang=/i.test(html)) {
        for (const t of pageTranslations) {
          out.push(`<link rel="alternate" hreflang="${esc(t.lang)}" href="${esc(absoluteUrl(siteConf, t.url))}">`);
        }
        const xDefault = pageTranslations.find((t) => t.lang === langs[0]) || pageTranslations[0];
        if (xDefault) {
          out.push(`<link rel="alternate" hreflang="x-default" href="${esc(absoluteUrl(siteConf, xDefault.url))}">`);
        }
      }

      if (data.noindex === true) {
        out.push('<meta name="robots" content="noindex, follow">');
      }

      // Open Graph：模板已写 og:title 时视为用户自行接管
      if (!/property=["']og:title["']/i.test(html)) {
        const og = [
          `<meta property="og:type" content="${isPost ? 'article' : 'website'}">`,
          `<meta property="og:title" content="${esc(title)}">`,
          desc && `<meta property="og:description" content="${esc(desc)}">`,
          `<meta property="og:url" content="${esc(canonical)}">`,
          siteName && `<meta property="og:site_name" content="${esc(siteName)}">`,
          `<meta property="og:locale" content="${esc(ogLocale(pageLang))}">`,
          image && `<meta property="og:image" content="${esc(image)}">`,
        ];
        if (isPost) {
          const published = isoDate(page.date);
          const modified = isoDate(page.updated || page.date);
          if (published) og.push(`<meta property="article:published_time" content="${esc(published)}">`);
          if (modified) og.push(`<meta property="article:modified_time" content="${esc(modified)}">`);
          for (const t of page.tags || []) og.push(`<meta property="article:tag" content="${esc(t)}">`);
        }
        out.push(...og.filter(Boolean));

        // og:locale:alternate：多语站列出其他语言版本（单语站不输出）
        if (isMultilingual) {
          for (const t of pageTranslations) {
            if (t.lang !== pageLang) out.push(`<meta property="og:locale:alternate" content="${esc(ogLocale(t.lang))}">`);
          }
        }

        // Twitter Card 跟着 OG 走，避免出现只有一半的情况
        out.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`);
        out.push(`<meta name="twitter:title" content="${esc(title)}">`);
        if (desc) out.push(`<meta name="twitter:description" content="${esc(desc)}">`);
        if (image) out.push(`<meta name="twitter:image" content="${esc(image)}">`);
        if (twitter) out.push(`<meta name="twitter:site" content="${esc(twitter)}">`);
      }

      // JSON-LD
      if (cfg.jsonLd !== false) {
        let ld;
        if (isPost) {
          ld = {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: title,
            description: desc || undefined,
            image: image ? [image] : undefined,
            datePublished: isoDate(page.date) || undefined,
            dateModified: isoDate(page.updated || page.date) || undefined,
            author: siteConf.author
              ? { '@type': 'Person', name: siteConf.author }
              : undefined,
            publisher: siteName ? { '@type': 'Organization', name: siteName } : undefined,
            mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
            keywords: (page.tags || []).join(', ') || undefined,
          };
        } else {
          ld = {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: siteName,
            url: canonical,
            description: desc || undefined,
            inLanguage: lang,
          };
          if (site.search && site.search.url) {
            ld.potentialAction = {
              '@type': 'SearchAction',
              target: `${absoluteUrl(siteConf, site.search.url)}?q={search_term_string}`,
              'query-input': 'required name=search_term_string',
            };
          }
        }
        out.push(
          `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`
        );
      }

      const block = out.filter(Boolean).join('\n');
      if (!block) return html;
      return html.replace(/<\/head>/i, `${block}\n</head>`);
    },
  };
};
