/* 手把操作選單（Steam Deck / Xbox / PS 手把）
   十字鍵或左搖桿：移動選取框　A：確定　B：返回／關閉　LB／RB：切換分頁　右搖桿：捲動
   遊戲進行中（可以控制角色、沒開選單）時不接管，交給 game.js 的 pollPad。 */
(function () {
  'use strict';
  const RR = window.RR = window.RR || {};
  const SEL = 'button, a[href], input:not([type=hidden]), textarea, label.btn, [data-tab], [tabindex]:not([tabindex="-1"])';
  let cur = null, prev = [], rep = { dir: '', t: 0 }, owning = false, lastT = 0;

  function vis(el) {
    if (!el || el.disabled || el.closest('.hide')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }
  function shown(el) { return el && !el.classList.contains('hide') && el.getBoundingClientRect().width > 0; }
  /** 現在最上層的選單：開著的小視窗 > 遊戲內選單 > 畫面 */
  function root() {
    const fs = document.querySelector('.fselOv'); if (fs) return fs;   // 下拉選單
    const ms = Array.prototype.filter.call(document.querySelectorAll('.modal'), shown); if (ms.length) return ms[ms.length - 1];
    const more = document.getElementById('moreMenu'); if (shown(more)) return more;
    const hm = document.getElementById('hudMenu'); if (shown(hm)) return hm;
    const sc = Array.prototype.filter.call(document.querySelectorAll('.screen'), shown); return sc.length ? sc[sc.length - 1] : null;
  }
  function items(r) { return r ? Array.prototype.filter.call(r.querySelectorAll(SEL), vis) : []; }
  function playing() { return RR.Game && RR.Game.controlling && RR.Game.controlling(); }
  /** 選單要不要接管手把 */
  function owns() {
    if (!playing()) return true;
    const r = root(); return !!r && !r.classList.contains('screen');
  }
  function mark(el) {
    if (cur && cur !== el) cur.classList.remove('padFocus');
    cur = el; if (!el) return;
    el.classList.add('padFocus');
    try { el.focus({ preventScroll: true }); } catch (e) {}
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function centre(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r }; }
  /** 依方向找最近的按鈕：主軸距離 + 2 倍側向偏移 */
  function move(dir) {
    const list = items(root()); if (!list.length) return;
    if (!cur || list.indexOf(cur) < 0) { mark(list[0]); return; }
    const a = centre(cur); let best = null, bs = 1e9;
    list.forEach(function (el) {
      if (el === cur) return;
      const b = centre(el), dx = b.x - a.x, dy = b.y - a.y;
      let main, side;
      if (dir === 'L') { main = a.r.left - b.r.right; side = dy; if (dx >= -2) return; }
      else if (dir === 'R') { main = b.r.left - a.r.right; side = dy; if (dx <= 2) return; }
      else if (dir === 'U') { main = a.r.top - b.r.bottom; side = dx; if (dy >= -2) return; }
      else { main = b.r.top - a.r.bottom; side = dx; if (dy <= 2) return; }
      const s = Math.max(0, main) + 2 * Math.abs(side);
      if (s < bs) { bs = s; best = el; }
    });
    if (best) { mark(best); try { RR.Sfx && RR.Sfx.tone && RR.Sfx.tone(700, 0.03, 'square', 0.03); } catch (e) {} }
  }
  /** 返回：找這一層的返回／關閉／取消鍵，找不到就送 Esc */
  function back() {
    const r = root(); if (!r) return;
    if (r.classList.contains('fselOv')) { r.remove(); return; }
    if (r.id === 'hudMenu') { const mb = document.getElementById('hudMore'); if (mb) mb.click(); return; }
    if (r.id === 'moreMenu') { r.classList.add('hide'); return; }
    const all = items(r);
    const b = all.find(function (el) { return el.getAttribute('aria-label') === '返回' || /(Done|Close|Back|No|Cancel)$/.test(el.id || ''); })
      || all.find(function (el) { return /^(取消|關閉|返回|知道了|好)$/.test((el.textContent || '').trim()); });
    if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
  /** LB／RB：在目前畫面的第一排分頁裡左右切換 */
  function tab(d) {
    const r = root(); if (!r) return;
    const bar = Array.prototype.find.call(r.querySelectorAll('.tabs, .mkTabs, [role=tablist]'), shown); if (!bar) return;
    const ts = Array.prototype.filter.call(bar.children, vis); if (!ts.length) return;
    let i = ts.findIndex(function (t) { return t.classList.contains('on') || t.getAttribute('aria-selected') === 'true'; });
    i = (i + d + ts.length) % ts.length; ts[i].click(); mark(ts[i]);
  }
  function scroll(dy) {
    let el = cur || root(); while (el && el !== document.body) { if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) break; el = el.parentElement; }
    (el && el !== document.body ? el : root() || document.scrollingElement).scrollBy(0, dy);
  }
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - lastT) / 1000 || 0); lastT = t;
    const gps = navigator.getGamepads ? navigator.getGamepads() : null, gp = gps && Array.prototype.find.call(gps, function (g) { return g && g.connected; });
    if (!gp) { if (cur) { cur.classList.remove('padFocus'); cur = null; } owning = false; return; }
    const btn = function (i) { const b = gp.buttons[i]; return b ? (b.pressed || b.value > 0.5) : false; };
    const now = gp.buttons.map(function (_, i) { return btn(i); });
    const down = function (i) { return now[i] && !prev[i]; };
    owning = owns();
    if (!owning) { prev = now; if (cur) { cur.classList.remove('padFocus'); cur = null; } return; }
    document.documentElement.classList.add('padMode');
    const r = root(), list = items(r);
    if (cur && list.indexOf(cur) < 0) cur.classList.remove('padFocus'), cur = null;
    if (!cur && list.length) mark(list.find(function (el) { return el.classList.contains('primary'); }) || list[0]);
    const ax = gp.axes || [], lx = ax[0] || 0, ly = ax[1] || 0;
    let dir = btn(12) || ly < -0.55 ? 'U' : btn(13) || ly > 0.55 ? 'D' : btn(14) || lx < -0.55 ? 'L' : btn(15) || lx > 0.55 ? 'R' : '';
    if (dir) { if (dir !== rep.dir) { rep.dir = dir; rep.t = 0.38; move(dir); } else if ((rep.t -= dt) <= 0) { rep.t = 0.11; move(dir); } }
    else rep.dir = '';
    if (down(0) && cur) { const el = cur; if (el.matches('input, textarea')) el.focus(); else el.click(); }
    if (down(1)) back();
    if (down(9)) { if (r && r.id === 'hudMenu') back(); else if (cur) cur.click(); }
    if (down(4)) tab(-1);
    if (down(5)) tab(1);
    const ry = ax[3] || 0; if (Math.abs(ry) > 0.2) scroll(ry * 900 * dt);
    prev = now;
  }
  // 滑鼠或觸控一動就收起選取框
  ['mousemove', 'touchstart'].forEach(function (ev) { addEventListener(ev, function () { document.documentElement.classList.remove('padMode'); }, { passive: true }); });
  requestAnimationFrame(loop);
  RR.PadNav = { owns: function () { return owning; }, move: move, focus: mark, items: function () { return items(root()); } };
})();
