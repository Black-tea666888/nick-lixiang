/* 四子連珠（同機雙人）：純邏輯，不碰畫面。
 * 棋盤 7 欄 × 6 列，index = r*7 + c，r=0 為最上列。紅先。點欄位讓棋子落到該欄最底。
 * 先在直、橫、斜任一方向連成四子者勝；棋盤下滿為和局。 */
(function (root) {
  'use strict';
  const COLS = 7, ROWS = 6;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function start() { return { b: new Array(COLS * ROWS).fill(null), turn: 'r', last: -1, win: null, draw: false }; }

  /** 以 i 為中心，四個方向找連續同色的棋，連到四子以上就回傳那一整條（沒有就 null） */
  function winLine(b, i) {
    const p = b[i], r = Math.floor(i / COLS), c = i % COLS;
    if (!p) return null;
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1], line = [i];
      [1, -1].forEach(function (sg) {
        let rr = r + dr * sg, cc = c + dc * sg;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) { line.push(rr * COLS + cc); rr += dr * sg; cc += dc * sg; }
      });
      if (line.length >= 4) return line;
    }
    return null;
  }

  /** 某欄最底下空的格子編號；整欄滿了回傳 -1 */
  function dropCell(b, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (b[r * COLS + col] === null) return r * COLS + col;
    return -1;
  }

  /** 落子到第 col 欄（0 起算）；不合法回傳 {ok:false}，合法回傳新狀態（不改舊的） */
  function move(s, col) {
    if (s.win || s.draw) return { ok: false, why: '這局已經結束' };
    if (col < 0 || col >= COLS) return { ok: false, why: '沒有這一欄' };
    const i = dropCell(s.b, col);
    if (i < 0) return { ok: false, why: '這一欄已經滿了' };
    const b = s.b.slice();
    b[i] = s.turn;
    const line = winLine(b, i);
    const full = b.every(function (x) { return x !== null; });
    return { ok: true, state: { b: b, turn: s.turn === 'r' ? 'y' : 'r', last: i, win: line ? { color: s.turn, line: line } : null, draw: !line && full } };
  }

  /** 目前局面 */
  function status(s) {
    if (s.win) return { k: 'win', winner: s.win.color };
    if (s.draw) return { k: 'draw' };
    return { k: 'play', turn: s.turn };
  }

  const api = { COLS: COLS, ROWS: ROWS, start: start, move: move, status: status, winLine: winLine, dropCell: dropCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Connect4 = api; }
})(typeof window !== 'undefined' ? window : globalThis);
