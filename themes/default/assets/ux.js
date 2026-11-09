/*!
 * ux.js — 阅读体验细节（复制代码 / 图片放大 / 阅读进度 / 外链新窗口）
 * 无依赖，约 3KB；页面没有对应元素时静默跳过。
 */
(function () {
  'use strict';

  var prose = document.querySelector('.prose');

  /* ---------- 代码块复制 ---------- */
  function addCopyButtons() {
    var blocks = document.querySelectorAll('.prose pre');
    for (var i = 0; i < blocks.length; i++) {
      (function (pre) {
        if (pre.querySelector('.code-copy')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy';
        btn.textContent = '复制';
        btn.setAttribute('aria-label', '复制代码');
        btn.addEventListener('click', function () {
          var code = pre.querySelector('code') || pre;
          var text = code.textContent || '';
          var done = function () {
            btn.textContent = '已复制';
            btn.classList.add('is-done');
            setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('is-done'); }, 1400);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallback);
          } else {
            fallback();
          }
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
        });
        pre.appendChild(btn);
      })(blocks[i]);
    }
  }

  /* ---------- 图片点击放大 ---------- */
  function addImageZoom() {
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
  }

  /* ---------- 阅读进度条 ---------- */
  function addProgress() {
    var article = document.querySelector('.post-body .prose');
    if (!article) return;
    var bar = document.createElement('div');
    bar.className = 'read-progress';
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      ticking = false;
      var rect = article.getBoundingClientRect();
      var total = rect.height - window.innerHeight * 0.5;
      var passed = -rect.top + window.innerHeight * 0.25;
      var ratio = total > 0 ? passed / total : 0;
      bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, ratio)) + ')';
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------- 外链新窗口 ---------- */
  function markExternal() {
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
      a.classList.add('is-external');
    }
  }

  /* ---------- 骨架：代码块标记语言 ---------- */
  function tagCodeLang() {
    var pres = document.querySelectorAll('.prose pre');
    for (var i = 0; i < pres.length; i++) {
      var code = pres[i].querySelector('code');
      if (!code) continue;
      var m = /language-([\w+#-]+)/.exec(code.className || '');
      if (!m) continue;
      pres[i].setAttribute('data-lang', m[1]);
    }
  }

  function boot() {
    tagCodeLang();
    addCopyButtons();
    addImageZoom();
    addProgress();
    markExternal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
