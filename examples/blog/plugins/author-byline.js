'use strict';
/**
 * 站点内本地插件（plugins/ 目录自动加载），演示「全局数据文件」：
 * 作者资料集中在 data/authors.json → site.data.authors，
 * 文章 front-matter 里写 author: xfm，构建时在这里注入署名。
 */
module.exports = () => ({
  name: 'author-byline',
  transformHtml(html, ctx) {
    const page = ctx && ctx.page;
    const id = page && page.data && page.data.author;
    if (!id) return html;
    const author = (ctx.site.data.authors || {})[id];
    if (!author) return html;
    const byline = `<p class="post-author">作者：<a href="${author.url}">${author.name}</a> · ${author.bio || ''}</p>`;
    // post.html 的文章头以 </header> 收尾，署名插在标题/元信息之后
    return html.includes('</header>') ? html.replace('</header>', byline + '\n  </header>') : html;
  },
});
