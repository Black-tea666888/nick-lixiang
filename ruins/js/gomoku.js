/* 五子棋（同機雙人）：純邏輯，不碰畫面。
 * 棋盤 15×15，index = r*15 + c。黑先。先連成五子（含以上）者勝；下滿棋盤為和局。 */
(function (root) {
  'use strict';
  const N = 15;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function start() { return { b: new Array(N * N).fill(null), turn: 'b', last: -1, win: null, draw: false }; }

  /** 以 i 為中心，四個方向找連續同色的棋，連到五子以上就回傳那一整條（沒有就 null） */
  function winLine(b, i) {
    const p = b[i], r = Math.floor(i / N), c = i % N;
    if (!p) return null;
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1], line = [i];
      [1, -1].forEach(function (sg) {
        let rr = r + dr * sg, cc = c + dc * sg;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr * N + cc] === p) { line.push(rr * N + cc); rr += dr * sg; cc += dc * sg; }
      });
      if (line.length >= 5) return line;
    }
    return null;
  }

  /** 下一子；不合法就回傳 {ok:false}，合法回傳新狀態（不改舊的） */
  function move(s, i) {
    if (s.win || s.draw) return { ok: false, why: '這局已經結束' };
    if (i < 0 || i >= N * N || s.b[i] !== null) return { ok: false, why: '這裡不能下' };
    const b = s.b.slice();
    b[i] = s.turn;
    const line = winLine(b, i);
    const full = b.every(function (x) { return x !== null; });
    return { ok: true, state: { b: b, turn: s.turn === 'b' ? 'w' : 'b', last: i, win: line ? { color: s.turn, line: line } : null, draw: !line && full } };
  }

  /** 目前局面 */
  function status(s) {
    if (s.win) return { k: 'win', winner: s.win.color };
    if (s.draw) return { k: 'draw' };
    return { k: 'play', turn: s.turn };
  }

  const api = { N: N, start: start, move: move, status: status, winLine: winLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Gomoku = api; }
})(typeof window !== 'undefined' ? window : globalThis);
