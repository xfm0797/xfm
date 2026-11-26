/*!
 * toc.js — 目录跟随正文滚动高亮
 * 纯原生实现，无依赖。页面里没有 .toc 时直接退出（一行成本）。
 */
(function () {
  'use strict';

  var nav = document.querySelector('.toc');
  if (!nav) return;

  // 收集「目录项 ↔ 正文标题」的对应关系；找不到目标元素的链接直接忽略
  var links = nav.querySelectorAll('a[href^="#"]');
  var items = [];
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute('href') || '';
    if (href.length < 2) continue;
    var id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (err) { /* 非法编码就按原样找 */ }
    var el = document.getElementById(id);
    if (el) items.push({ link: links[i], el: el });
  }
  if (!items.length) return;

  var active = null;
  var queued = false;

  /** 判定「读到哪」的基准线：粘性头部高度 + 一点呼吸空间 */
  function baseline() {
    var header = document.querySelector('.site-header');
    var h = header ? header.getBoundingClientRect().height : 0;
    return h + 24;
  }

  /** 基准线之上最靠下的那个标题就是当前小节 */
  function current() {
    var line = baseline();
    var best = items[0];
    for (var i = 0; i < items.length; i++) {
      // 标题在文档里天然有序，遇到第一个没越线的就可以停
      if (items[i].el.getBoundingClientRect().top - line > 0) break;
      best = items[i];
    }
    // 已经滚到底：末节可能永远越不过基准线，强制点亮最后一项
    var doc = document.documentElement;
    if (doc.scrollHeight > window.innerHeight + 2 &&
        window.pageYOffset + window.innerHeight >= doc.scrollHeight - 2) {
      best = items[items.length - 1];
    }
    return best;
  }

  /** 目录自身可滚动时（max-height + overflow），把当前项留在可视区内 */
  function reveal(link) {
    if (nav.scrollHeight <= nav.clientHeight + 1) return;
    var lr = link.getBoundingClientRect();
    var br = nav.getBoundingClientRect();
    if (lr.top < br.top + 6) nav.scrollTop -= br.top + 6 - lr.top;
    else if (lr.bottom > br.bottom - 6) nav.scrollTop += lr.bottom - br.bottom + 6;
  }

  function paint(item) {
    if (!item || item === active) return;
    if (active) {
      active.link.classList.remove('is-active');
      active.link.removeAttribute('aria-current');
    }
    active = item;
    active.link.classList.add('is-active');
    active.link.setAttribute('aria-current', 'true');
    reveal(active.link);
  }

  function update() {
    queued = false;
    paint(current());
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('load', schedule); // 图片晚到会改变布局

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update);
  else update();
})();
