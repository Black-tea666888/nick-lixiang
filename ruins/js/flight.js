/* 飛行棋（同機 2～4 人）：純邏輯，不碰畫面。
 * 每人 4 架飛機。擲到 6 才能從基地出發；擲 6 可再擲一次。
 * 環形跑道 52 格，各色起點為 0、13、26、39（2 人時用紅與綠，對角）。
 * 每架飛機從起點走 51 格後進入專屬跑道，共 56 步到終點，需剛好走完。
 * 停在別人飛機的格子會把對方送回基地；起點格是安全區。 */
(function (root) {
  'use strict';
  const RING = 52, HOME = 56, RING_LEN = 51;
  const SAFE = [0, 13, 26, 39];

  function colorsFor(n) { return n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]; }

  function start(n) {
    n = Math.max(2, Math.min(4, n | 0));
    const pl = [];
    for (let i = 0; i < n; i++) pl.push([-1, -1, -1, -1]);
    return { n: n, col: colorsFor(n), pl: pl, cur: 0, phase: 'roll', dice: 0, legal: [], win: null, msg: '' };
  }

  function ringOf(color, p) { return (color * 13 + p) % RING; }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  function legalPlanes(s, d) {
    const out = [];
    for (let j = 0; j < 4; j++) {
      const p = s.pl[s.cur][j];
      if ((p === -1 && d === 6) || (p >= 0 && p + d <= HOME)) out.push(j);
    }
    return out;
  }

  function nextTurn(s) {
    s.cur = (s.cur + 1) % s.n;
    s.phase = 'roll'; s.legal = []; s.dice = 0;
    return s;
  }

  /** 實際走一步：處理吃子、勝負、以及是否再擲一次 */
  function apply(s, j) {
    const d = s.dice, cur = s.cur;
    const p = s.pl[cur][j];
    const np = p === -1 ? 0 : p + d;
    s.pl[cur][j] = np;
    let note = '';
    if (np >= 0 && np <= RING_LEN) {
      const ring = ringOf(s.col[cur], np);
      if (SAFE.indexOf(ring) < 0) {
        for (let q = 0; q < s.n; q++) {
          if (q === cur) continue;
          for (let k = 0; k < 4; k++) {
            const qp = s.pl[q][k];
            if (qp >= 0 && qp <= RING_LEN && ringOf(s.col[q], qp) === ring) { s.pl[q][k] = -1; note = '吃掉對方一架，送回基地！'; }
          }
        }
      }
    }
    if (s.pl[cur].every(function (x) { return x === HOME; })) {
      s.win = cur; s.phase = 'done'; s.legal = []; s.msg = '全部飛機到達終點，獲勝！';
      return s;
    }
    if (d === 6) {
      s.phase = 'roll'; s.legal = []; s.dice = 0;
      s.msg = (note ? note + ' ' : '') + '擲到 6，再擲一次';
      return s;
    }
    s.msg = note;
    return nextTurn(s);
  }

  /** 擲骰（rng 回傳 1～6）。只有一架可走時自動走，有多架時等待 pick */
  function roll(s, rng) {
    if (s.win !== null || s.phase !== 'roll') return s;
    const t = clone(s);
    t.dice = rng();
    const legal = legalPlanes(t, t.dice);
    if (legal.length === 0) {
      t.msg = '沒有可以走的飛機，換下一位';
      if (t.dice === 6) { t.msg = '擲到 6 但沒有可以出發的飛機，換下一位'; }
      return nextTurn(t);
    }
    if (legal.length === 1) return apply(t, legal[0]);
    t.phase = 'pick'; t.legal = legal;
    t.msg = '請選一架飛機移動';
    return t;
  }

  function pick(s, j) {
    if (s.win !== null || s.phase !== 'pick' || s.legal.indexOf(j) < 0) return s;
    return apply(clone(s), j);
  }

  function status(s) {
    if (s.win !== null) return { k: 'win', winner: s.win };
    return { k: 'play', turn: s.cur, phase: s.phase };
  }

  const api = { RING: RING, HOME: HOME, SAFE: SAFE, start: start, roll: roll, pick: pick, status: status, ringOf: ringOf, colorsFor: colorsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Flight = api; }
})(typeof window !== 'undefined' ? window : globalThis);
