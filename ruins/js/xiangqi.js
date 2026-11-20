/* 中國象棋規則（同機雙人用）：純邏輯，不碰畫面。
 * 棋盤 9 直行 × 10 橫線，index = r*9 + c；r=0 是黑方底線，r=9 是紅方底線。
 * 棋子用字母：大寫紅方、小寫黑方、null 是空點。
 *   K/k 將帥  A/a 士仕  B/b 象相  N/n 馬  R/r 車  C/c 炮  P/p 兵卒
 * 規則：各子走法、象眼、馬腿、炮要隔一子才能吃、兵過河才能橫走、
 *       將帥不能照面（同一直行中間無子）、被將軍的走法不合法、無子可走就輸。
 * 沒有做：長將判和、數步和棋（同機玩不會卡住，之後要加再補）。 */
(function (root) {
  'use strict';
  const START = ['rnbakabnr', '.........', '.c.....c.', 'p.p.p.p.p', '.........',
                 '.........', 'P.P.P.P.P', '.C.....C.', '.........', 'RNBAKABNR'];
  const ROWS = 10, COLS = 9;
  const color = function (p) { return p === null ? null : (p === p.toUpperCase() ? 'r' : 'b'); };
  const inb = function (r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; };
  const inPalace = function (col, r, c) { return c >= 3 && c <= 5 && (col === 'r' ? r >= 7 : r <= 2); };
  const ownSide = function (col, r) { return col === 'r' ? r >= 5 : r <= 4; };

  function start() {
    const b = [];
    START.forEach(function (row) { row.split('').forEach(function (ch) { b.push(ch === '.' ? null : ch); }); });
    return { b: b, turn: 'r', log: [] };
  }

  /** 一顆子能去的格子（不管會不會讓自己被將軍） */
  function targets(b, i) {
    const p = b[i], col = color(p), k = p.toUpperCase(), r = Math.floor(i / COLS), c = i % COLS, out = [];
    const add = function (nr, nc) {
      if (!inb(nr, nc)) return;
      const t = nr * COLS + nc;
      if (b[t] === null || color(b[t]) !== col) out.push(t);
    };
    const slide = function (dirs) {
      dirs.forEach(function (d) {
        let nr = r + d[0], nc = c + d[1];
        while (inb(nr, nc)) {
          const t = nr * COLS + nc;
          if (b[t] === null) out.push(t);
          else { if (color(b[t]) !== col) out.push(t); break; }
          nr += d[0]; nc += d[1];
        }
      });
    };
    const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (k === 'K') { ORTH.forEach(function (d) { if (inPalace(col, r + d[0], c + d[1])) add(r + d[0], c + d[1]); }); }
    else if (k === 'A') { [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (d) { if (inPalace(col, r + d[0], c + d[1])) add(r + d[0], c + d[1]); }); }
    else if (k === 'B') {
      [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(function (d) {
        const nr = r + d[0], nc = c + d[1];
        if (!inb(nr, nc) || !ownSide(col, nr)) return;
        if (b[(r + d[0] / 2) * COLS + c + d[1] / 2] !== null) return;   // 象眼被堵住就不能走
        add(nr, nc);
      });
    }
    else if (k === 'N') {
      // [走的方向, 馬腿的方向]：馬腿在走的長邊上，被擋住就不能走
      [[[-2, -1], [-1, 0]], [[-2, 1], [-1, 0]], [[2, -1], [1, 0]], [[2, 1], [1, 0]],
       [[-1, -2], [0, -1]], [[1, -2], [0, -1]], [[-1, 2], [0, 1]], [[1, 2], [0, 1]]].forEach(function (m) {
        const leg = (r + m[1][0]) * COLS + c + m[1][1];
        if (b[leg] !== null) return;
        add(r + m[0][0], c + m[0][1]);
      });
    }
    else if (k === 'R') slide(ORTH);
    else if (k === 'C') {
      // 炮：不吃子時像車；吃子要隔一個子（炮架）
      ORTH.forEach(function (d) {
        let nr = r + d[0], nc = c + d[1], screen = false;
        while (inb(nr, nc)) {
          const t = nr * COLS + nc;
          if (!screen) { if (b[t] === null) out.push(t); else screen = true; }
          else if (b[t] !== null) { if (color(b[t]) !== col) out.push(t); break; }
          nr += d[0]; nc += d[1];
        }
      });
    }
    else if (k === 'P') {
      const fwd = col === 'r' ? -1 : 1;
      add(r + fwd, c);
      if (!ownSide(col, r)) { add(r, c + 1); add(r, c - 1); }   // 過河才能橫走
    }
    return out;
  }

  function kingSq(b, col) { return b.indexOf(col === 'r' ? 'K' : 'k'); }

  /** col 的將帥是否被攻擊（含將帥照面） */
  function inCheck(s, col) {
    const b = s.b, g = kingSq(b, col), opp = col === 'r' ? 'b' : 'r';
    if (g < 0) return true;
    const og = kingSq(b, opp);
    if (og >= 0 && og % COLS === g % COLS) {
      let blocked = false;
      for (let t = Math.min(g, og) + COLS; t < Math.max(g, og); t += COLS) if (b[t] !== null) { blocked = true; break; }
      if (!blocked) return true;
    }
    for (let i = 0; i < ROWS * COLS; i++) if (b[i] !== null && color(b[i]) === opp && targets(b, i).indexOf(g) >= 0) return true;
    return false;
  }

  /** 所有合法走法（排除會讓自己被將軍的走法）；from 有給的話只算那一格 */
  function legalMoves(s, from) {
    const col = s.turn, out = [];
    for (let i = 0; i < ROWS * COLS; i++) {
      if (from !== undefined && i !== from) continue;
      const p = s.b[i];
      if (p === null || color(p) !== col) continue;
      targets(s.b, i).forEach(function (t) {
        const m = { from: i, to: t };
        if (!inCheck(apply(s, m), col)) out.push(m);
      });
    }
    return out;
  }

  /** 走一步，回傳新狀態（不改舊的） */
  function apply(s, m) {
    const b = s.b.slice();
    b[m.to] = b[m.from];
    b[m.from] = null;
    return { b: b, turn: s.turn === 'r' ? 'b' : 'r', log: s.log.concat([m]) };
  }

  /** 目前局面：play、check（將軍）、mate（無子可走，winner 是贏的一方；象棋沒有和局，無子可走即輸） */
  function status(s) {
    if (!legalMoves(s).length) return { k: 'mate', winner: s.turn === 'r' ? 'b' : 'r' };
    return { k: inCheck(s, s.turn) ? 'check' : 'play' };
  }

  const api = { start: start, legalMoves: legalMoves, apply: apply, status: status, inCheck: inCheck, color: color, targets: targets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Xiangqi = api; }
})(typeof window !== 'undefined' ? window : globalThis);
