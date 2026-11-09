'use strict';
/**
 * 站内搜索插件（xfm-plugin-search）
 * -------------------------------------------------------------------
 * 构建时把全部页面压缩成一份 search.json（标题 / 摘要 / 标签 / 正文前 N 字），
 * 主题里的 search.js 打开面板时按需拉取，纯前端筛选 —— 没有服务端，也不引入依赖。
 *
 * 安装：npm i -D xfm-plugin-search（package.json 里有了依赖，构建时自动加载）
 * 关闭某篇：front-matter 写 search: false。
 */
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

module.exports = (site) => {
  const { plainText, withBase } = site.helpers;

  return {
    name: 'search',

    /** 让模板知道要不要引入搜索脚本、索引在哪个地址 */
    extendContext(siteContext) {
      const cfg = site.config.site || {};
      const conf = site.config.search || {};
      const file = String(conf.path || 'search.json').replace(/^\/+/, '');
      siteContext.search = {
        url: withBase(cfg.base, '/' + file),
        file,
        hint: conf.hint || '',
      };
      return siteContext;
    },

    afterBuild(site) {
      const cfg = site.config.site || {};
      const conf = site.config.search || {};
      const maxChars = Number(conf.maxChars) || 1500;
      const file = String(conf.path || 'search.json').replace(/^\/+/, '');

      const items = [];
      for (const p of site.documents) {
        // 聚合页 / 索引页 / 分页页不是内容，不进搜索
        if (p.data && (p.data.type === 'taxonomy' || p.data.type === 'index' || p.data.type === 'pagination')) continue;
        if (p.data && p.data.search === false) continue;
        if (p.url === '/') continue; // 首页是列表，不参与检索

        const text = plainText(p.html || '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] || ' ');
        items.push({
          url: withBase(cfg.base, p.url),
          title: p.title,
          description: p.description || '',
          tags: p.tags || [],
          category: p.category || '',
          date: p.date || '',
          text: text.slice(0, maxChars),
        });
      }

      const payload = {
        version: 1,
        generated: new Date().toISOString(),
        count: items.length,
        items,
      };

      return [{ path: file, contents: JSON.stringify(payload) }];
    },
  };
};
