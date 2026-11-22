// 2048（無限板）：4×4 起步，往某一邊滑、貼到那一邊時自動多開一排，棋盤可以一直變大。
// 紀錄板：本機前 10 名（分數、最大數字）。
(function (g) {
  'use strict';
  const KEY = 'rr_2048_rec';
  function empty(n) { const b = []; for (let r = 0; r < n; r++) b.push(new Array(n).fill(0)); return b; }
  let R = Math.random;
  function mulberry(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function addTile(b) {
    const cells = [];
    for (let r = 0; r < b.length; r++) for (let c = 0; c < b[r].length; c++) if (!b[r][c]) cells.push([r, c]);
    if (!cells.length) return false;
    const p = cells[Math.floor(R() * cells.length)];
    b[p[0]][p[1]] = R() < 0.9 ? 2 : 4;
    return true;
  }
  // 一排往左滑並合併（同一次滑動每個方塊只合併一次）
  function slideRow(row) {
    const v = row.filter(function (x) { return x; }), out = [], mg = []; let gain = 0;
    for (let i = 0; i < v.length; i++) {
      if (i + 1 < v.length && v[i] === v[i + 1]) { out.push(v[i] * 2); mg.push(true); gain += v[i] * 2; i++; }
      else { out.push(v[i]); mg.push(false); }
    }
    while (out.length < row.length) { out.push(0); mg.push(false); }
    return { row: out, gain: gain, mg: mg };
  }
  function transpose(b) { return b[0].map(function (_, c) { return b.map(function (r) { return r[c]; }); }); }
  function reverseRows(b) { return b.map(function (r) { return r.slice().reverse(); }); }
  function maxTile(b) { let m = 0; b.forEach(function (r) { r.forEach(function (x) { if (x > m) m = x; }); }); return m; }
  function canMove(b) {
    for (let r = 0; r < b.length; r++) for (let c = 0; c < b[r].length; c++) {
      if (!b[r][c]) return true;
      if (c + 1 < b[r].length && b[r][c] === b[r][c + 1]) return true;
      if (r + 1 < b.length && b[r][c] === b[r + 1][c]) return true;
    }
    return false;
  }
  function start(seed) {
    R = seed == null ? Math.random : mulberry(seed);
    const s = { board: empty(4), score: 0, over: false, moves: 0 };
    addTile(s.board); addTile(s.board);
    return s;
  }
  // dir: 'L' 'R' 'U' 'D'。回傳 { ok, state }；ok=false 表示這次滑不動
  function move(state, dir) {
    if (state.over) return { ok: false, state: state };
    // 把四個方向都轉成「往左滑」來算：先轉置／反轉，滑完再轉回來
    const flipIn = dir === 'R' || dir === 'D', tIn = dir === 'U' || dir === 'D';
    let b = state.board.map(function (r) { return r.slice(); });
    if (tIn) b = transpose(b);
    if (flipIn) b = reverseRows(b);
    // mg 跟著同樣的轉換走，記錄哪些格子是這一步合成的（給畫面特效用）
    let mg = state.board.map(function (r) { return r.map(function () { return false; }); });
    if (tIn) mg = transpose(mg);
    if (flipIn) mg = reverseRows(mg);
    let gain = 0;
    b = b.map(function (r, i) { const s = slideRow(r); gain += s.gain; mg[i] = s.mg; return s.row; });
    if (flipIn) { b = reverseRows(b); mg = reverseRows(mg); }
    if (tIn) { b = transpose(b); mg = transpose(mg); }
    if (JSON.stringify(b) === JSON.stringify(state.board)) return { ok: false, state: state };
    // 無限板：貼到哪一邊，那一邊就多開一排（之後還能往那邊滑）
    const w = b[0].length;
    if (dir === 'L' && b.some(function (r) { return r[0]; })) { b.forEach(function (r) { r.unshift(0); }); mg.forEach(function (r) { r.unshift(false); }); }
    if (dir === 'R' && b.some(function (r) { return r[r.length - 1]; })) { b.forEach(function (r) { r.push(0); }); mg.forEach(function (r) { r.push(false); }); }
    if (dir === 'U' && b[0].some(function (x) { return x; })) { b.unshift(new Array(w).fill(0)); mg.unshift(new Array(w).fill(false)); }
    if (dir === 'D' && b[b.length - 1].some(function (x) { return x; })) { b.push(new Array(w).fill(0)); mg.push(new Array(w).fill(false)); }
    const before = b.map(function (r) { return r.slice(); });
    addTile(b);
    // 新出現的方塊（用來播放出現動畫）
    const sp = before.map(function (r) { return r.map(function () { return false; }); });
    for (let r = 0; r < b.length; r++) for (let c = 0; c < b[r].length; c++) if (b[r][c] !== before[r][c]) sp[r][c] = true;
    const next = { board: b, score: state.score + gain, over: false, moves: state.moves + 1 };
    if (!canMove(b)) next.over = true;
    return { ok: true, state: next, fx: { m: mg, s: sp } };
  }
  function records() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function saveRecord(state) {
    const list = records();
    list.push({ score: state.score, max: maxTile(state.board), size: state.board.length, date: new Date().toISOString().slice(0, 10) });
    list.sort(function (a, b) { return b.score - a.score; });
    const top = list.slice(0, 10);
    try { localStorage.setItem(KEY, JSON.stringify(top)); } catch (e) { /* 無法寫入就不記錄 */ }
    return top;
  }
  g.G2048 = { start: start, move: move, records: records, saveRecord: saveRecord, maxTile: maxTile };
})(window.RR = window.RR || {});
