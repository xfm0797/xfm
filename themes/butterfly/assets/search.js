/*!
 * search.js — 站内搜索面板（Ctrl/⌘+K）
 * 索引由 xfm 的 search 插件在构建时生成（search.json），这里只做拉取与筛选。
 * 无依赖；没有 [data-search-open] 按钮或索引 404 时安静退出。
 */
(function () {
  'use strict';

  var triggers = document.querySelectorAll('[data-search-open]');
  if (!triggers.length) return;

  // 用脚本自身地址推导索引位置：不管部署在根路径还是 /repo/ 子路径都对
  var self = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) if (/search\.js(\?|$)/.test(all[i].src)) return all[i];
    return null;
  })();
  var indexPath = self ? self.src.replace(/[^/]*$/, '') + 'search.json' : '/search.json';
  if (self && self.getAttribute('data-index')) indexPath = self.getAttribute('data-index');

  var panel = null;
  var input = null;
  var list = null;
  var state = { items: null, loading: false, active: -1, results: [] };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function highlight(text, terms) {
    var out = esc(text);
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (!t) continue;
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    }
    return out;
  }

  function build() {
    panel = el('div', 'xfm-search');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '站内搜索');
    panel.innerHTML =
      '<div class="xfm-search-box">' +
      '<input class="xfm-search-input" type="search" placeholder="搜索文章…（Esc 关闭）" autocomplete="off" spellcheck="false">' +
      '<kbd class="xfm-search-kbd">Esc</kbd>' +
      '</div>' +
      '<div class="xfm-search-list" role="listbox"></div>' +
      '<div class="xfm-search-foot"><span class="xfm-search-hint">↑↓ 选择 · ↵ 打开</span><span class="xfm-search-count"></span></div>';
    document.body.appendChild(panel);
    input = panel.querySelector('.xfm-search-input');
    list = panel.querySelector('.xfm-search-list');

    panel.addEventListener('click', function (e) {
      if (e.target === panel) close();
    });
    input.addEventListener('input', function () { run(input.value); });
    input.addEventListener('keydown', onKey);
  }

  function open() {
    if (!panel) build();
    panel.classList.add('is-open');
    document.documentElement.classList.add('xfm-no-scroll');
    input.value = '';
    run('');
    input.focus();
    if (!state.items && !state.loading) load();
  }

  function close() {
    if (!panel) return;
    panel.classList.remove('is-open');
    document.documentElement.classList.remove('xfm-no-scroll');
  }

  function load() {
    state.loading = true;
    list.innerHTML = '<p class="xfm-search-empty">正在读取索引…</p>';
    fetch(indexPath, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        state.items = (data && data.items) || [];
        state.loading = false;
        run(input.value);
      })
      .catch(function () {
        state.loading = false;
        list.innerHTML = '<p class="xfm-search-empty">索引没找到：先在 config.plugins 里启用 <code>search</code> 再构建。</p>';
      });
  }

  function score(item, terms) {
    var hay = (item.title + ' ' + item.tags.join(' ') + ' ' + item.description + ' ' + item.text).toLowerCase();
    for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) === -1) return 0;
    var s = 0;
    var title = item.title.toLowerCase();
    for (var j = 0; j < terms.length; j++) {
      var t = terms[j];
      if (title === t) s += 20;
      else if (title.indexOf(t) === 0) s += 12;
      else if (title.indexOf(t) > -1) s += 8;
      if (item.tags.join(' ').toLowerCase().indexOf(t) > -1) s += 4;
      if (item.description.toLowerCase().indexOf(t) > -1) s += 3;
      if (item.text.toLowerCase().indexOf(t) > -1) s += 1;
    }
    return s;
  }

  function snippet(item, terms) {
    var text = item.text || item.description || '';
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length; i++) {
      var k = lower.indexOf(terms[i]);
      if (k > -1 && (at === -1 || k < at)) at = k;
    }
    if (at === -1) return text.slice(0, 110);
    var start = Math.max(0, at - 40);
    return (start > 0 ? '…' : '') + text.slice(start, start + 130) + '…';
  }

  function run(query) {
    if (!state.items) return;
    var terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    var results = terms.length
      ? state.items
          .map(function (it) { return { it: it, s: score(it, terms) }; })
          .filter(function (x) { return x.s > 0; })
          .sort(function (a, b) { return b.s - a.s || String(b.it.date).localeCompare(String(a.it.date)); })
          .slice(0, 12)
          .map(function (x) { return x.it; })
      : state.items.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 8);

    state.results = results;
    state.active = results.length ? 0 : -1;

    if (!results.length) {
      list.innerHTML = '<p class="xfm-search-empty">没有匹配的文章。</p>';
    } else {
      list.innerHTML = results
        .map(function (it, i) {
          return (
            '<a class="xfm-hit' + (i === 0 ? ' is-active' : '') + '" role="option" href="' + esc(it.url) + '">' +
            '<span class="xfm-hit-title">' + highlight(it.title, terms) + '</span>' +
            (it.date ? '<span class="xfm-hit-date">' + esc(it.date) + '</span>' : '') +
            '<span class="xfm-hit-desc">' + highlight(snippet(it, terms), terms) + '</span>' +
            '</a>'
          );
        })
        .join('');
    }

    panel.querySelector('.xfm-search-count').textContent = terms.length
      ? results.length + ' 条结果'
      : '最近 ' + results.length + ' 篇';
  }

  function move(delta) {
    if (!state.results.length) return;
    var hits = list.querySelectorAll('.xfm-hit');
    if (state.active >= 0 && hits[state.active]) hits[state.active].classList.remove('is-active');
    state.active = (state.active + delta + hits.length) % hits.length;
    var cur = hits[state.active];
    cur.classList.add('is-active');
    cur.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      var hits = list.querySelectorAll('.xfm-hit');
      if (hits[state.active]) { e.preventDefault(); window.location.href = hits[state.active].getAttribute('href'); }
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  for (var i = 0; i < triggers.length; i++) {
    triggers[i].addEventListener('click', function (e) { e.preventDefault(); open(); });
  }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
    else if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      open();
    }
  });
})();
