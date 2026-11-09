'use strict';
/**
 * related 插件
 * -------------------------------------------------------------------
 * 渲染前为每篇文章算「相关文章」，写进 page.data.related，
 * 模板里直接遍历即可：
 *
 *   {% for item in page.data.related %}
 *     <a href="{{ item.url }}">{{ item.title }}</a>
 *   {% endfor %}
 *
 * 相关性按标签 / 分类 / 系列加权（标签 3 分、分类 2 分、系列 3 分），
 * 同分按日期新→旧。只推荐文章，不含首页、聚合页与普通页面。
 *
 * 用 afterCollect 而不是单页钩子：全部页面就位后才算得准，
 * 同时不会让渲染退回单线程（worker 池仍可用）。
 *
 * 配置：related: { limit: 3, minScore: 2 }
 * 页面级：front-matter 写 related: false 关闭；写 related: [url, ...] 手动指定。
 */
const MAX_TAGS = 200; // 单个标签下最多考察这么多篇（避免"随笔"这类大标签淹没结果）

/** 本地日历日（与站内其他日期展示保持一致，不走 toISOString 以免跨时区偏一天） */
function localDay(d) {
  if (!d) return '';
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

module.exports = (site) => {
  const cfg = site.config.related || {};
  const limit = Math.max(1, Number(cfg.limit) || 3);
  const minScore = Number(cfg.minScore) || 2;

  return {
    name: 'related',

    afterCollect(site) {
      const posts = (site.pages || []).filter((p) => p.date && p.url !== '/' && p.data.type !== 'page');
      if (posts.length < 2) return;

      const byTag = new Map();
      const byCat = new Map();
      const bySeries = new Map();
      const push = (map, key, p) => {
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
      };

      for (const p of posts) {
        for (const t of p.tags || []) push(byTag, t, p);
        push(byCat, p.category, p);
        push(bySeries, p.series, p);
      }

      const brief = (p) => ({
        url: p.url,
        title: p.title,
        date: localDay(p.date),
        description: p.description || '',
        tags: p.tags || [],
        category: p.category || '',
      });

      for (const p of posts) {
        const manual = p.data && p.data.related;
        if (manual === false) continue;
        if (Array.isArray(manual)) {
          p.data.related = manual
            .map((u) => posts.find((q) => q.url === u))
            .filter(Boolean)
            .slice(0, limit)
            .map(brief);
          continue;
        }

        const score = new Map();
        const add = (list, weight) => {
          if (!list) return;
          // posts 已按日期倒序，大标签只考察最近的一批
          const pool = list.length > MAX_TAGS ? list.slice(0, MAX_TAGS) : list;
          for (const q of pool) {
            if (q === p) continue;
            score.set(q, (score.get(q) || 0) + weight);
          }
        };

        for (const t of p.tags || []) add(byTag.get(t), 3);
        add(byCat.get(p.category), 2);
        add(bySeries.get(p.series), 3);

        const ranked = [...score.entries()]
          .filter(([, s]) => s >= minScore)
          .sort((a, b) => b[1] - a[1] || (b[0].date || 0) - (a[0].date || 0))
          .slice(0, limit)
          .map(([q]) => brief(q));

        p.data.related = ranked;
      }
    },
  };
};
