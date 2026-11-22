/*!
 * butterfly 主题 main.js — 无依赖
 * 导航抽屉 / 滚动阴影 / 回到顶部 / 目录高亮 / 代码复制 / 图片放大 / 外链新窗口 / 阅读进度
 * 页面里没有对应元素时静默跳过。
 */
(function () {
  'use strict';

  /* ---------- 导航：滚动阴影 + 移动端抽屉 ---------- */
  var nav = document.getElementById('site-nav');
  var menuToggle = document.getElementById('menu-toggle');
  if (nav && menuToggle) {
    menuToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('menu-open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // 点了菜单项就收起抽屉（页内跳转时不留遮挡）
    nav.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) {
        nav.classList.remove('menu-open');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- 回到顶部 ---------- */
  var backTop = document.getElementById('back-top');
  if (backTop) {
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- 阅读进度 + 回到顶部显隐 + 导航阴影（统一 rAF） ---------- */
  var bar = document.querySelector('.read-progress');
  var article = document.querySelector('.prose');
  var queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () {
      queued = false;
      var y = window.pageYOffset;
      if (nav) nav.classList.toggle('is-scrolled', y > 10);
      if (backTop) backTop.classList.toggle('is-visible', y > 400);
      if (bar && article) {
        var rect = article.getBoundingClientRect();
        var total = rect.height - window.innerHeight * 0.5;
        var passed = -rect.top + window.innerHeight * 0.25;
        var ratio = total > 0 ? Math.max(0, Math.min(1, passed / total)) : 0;
        bar.style.transform = 'scaleX(' + ratio + ')';
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ---------- 目录跟随滚动高亮 ---------- */
  (function () {
    var tocNav = document.querySelector('.toc');
    if (!tocNav) return;
    var links = tocNav.querySelectorAll('a[href^="#"]');
    var items = [];
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.length < 2) continue;
      var id = href.slice(1);
      try { id = decodeURIComponent(id); } catch (err) { /* 按原样找 */ }
      var el = document.getElementById(id);
      if (el) items.push({ link: links[i], el: el });
    }
    if (!items.length) return;

    var active = null;
    function paint(item) {
      if (!item || item === active) return;
      if (active) active.link.classList.remove('is-active');
      active = item;
      active.link.classList.add('is-active');
      active.link.setAttribute('aria-current', 'true');
    }
    function update() {
      var line = (nav ? nav.getBoundingClientRect().height : 0) + 24;
      var best = items[0];
      for (var i = 0; i < items.length; i++) {
        if (items[i].el.getBoundingClientRect().top - line > 0) break;
        best = items[i];
      }
      var doc = document.documentElement;
      if (doc.scrollHeight > window.innerHeight + 2 &&
          window.pageYOffset + window.innerHeight >= doc.scrollHeight - 2) {
        best = items[items.length - 1];
      }
      paint(best);
    }
    var tocQueued = false;
    function schedule() {
      if (tocQueued) return;
      tocQueued = true;
      window.requestAnimationFrame(function () { tocQueued = false; update(); });
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('load', schedule);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update);
    else update();
  })();

  /* ---------- 代码块：标记语言 + 复制按钮 ---------- */
  var prose = document.querySelector('.prose');
  (function () {
    var blocks = document.querySelectorAll('.prose pre');
    for (var i = 0; i < blocks.length; i++) {
      (function (pre) {
        var code = pre.querySelector('code');
        if (code) {
          var m = /language-([\w+#-]+)/.exec(code.className || '');
          if (m) pre.setAttribute('data-lang', m[1]);
        }
        if (pre.querySelector('.code-copy')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy';
        btn.textContent = '复制';
        btn.setAttribute('aria-label', '复制代码');
        btn.addEventListener('click', function () {
          var text = (pre.querySelector('code') || pre).textContent || '';
          var done = function () {
            btn.textContent = '已复制';
            btn.classList.add('is-done');
            setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('is-done'); }, 1400);
          };
          function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
            document.body.removeChild(ta);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallback);
          } else {
            fallback();
          }
        });
        pre.appendChild(btn);
      })(blocks[i]);
    }
  })();

  /* ---------- 图片点击放大 ---------- */
  (function () {
    if (!prose) return;
    var imgs = prose.querySelectorAll('img');
    if (!imgs.length) return;
    var box = null;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      img.classList.add('zoomable');
      img.addEventListener('click', function (e) {
        e.preventDefault();
        if (!box) {
          box = document.createElement('div');
          box.className = 'img-zoom';
          box.innerHTML = '<img alt="">';
          box.addEventListener('click', function () { box.classList.remove('is-open'); });
          document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') box.classList.remove('is-open');
          });
          document.body.appendChild(box);
        }
        box.querySelector('img').src = this.currentSrc || this.src;
        box.querySelector('img').alt = this.alt || '';
        box.classList.add('is-open');
      });
    }
  })();

  /* ---------- 外链新窗口 ---------- */
  (function () {
    if (!prose) return;
    var links = prose.querySelectorAll('a[href^="http"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.hostname && a.hostname === window.location.hostname) continue;
      a.target = '_blank';
      var rels = {};
      (a.rel || '').split(/\s+/).forEach(function (t) { if (t) rels[t] = 1; });
      rels.noopener = rels['noreferrer'] = 1;
      a.rel = Object.keys(rels).join(' ');
    }
  })();
})();
