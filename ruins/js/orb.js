/* 轉珠（單人關卡）：純邏輯，不碰畫面。
   6×5 盤面、6 種顏色；拖動相鄰兩顆交換，能連成 3 顆以上就消除，珠子掉落補位，連鎖越多分數越高。
   每關有步數上限與目標消除數，達成過關、步數用完失敗。 */
(function () {
  'use strict';
  const RR = window.RR = window.RR || {};
  const COLS = 6, ROWS = 5, NCOL = 6;
  const LEVELS = [
    { name: '第 1 關', moves: 20, goal: 30 },
    { name: '第 2 關', moves: 18, goal: 45 },
    { name: '第 3 關', moves: 15, goal: 60 }
  ];

  // 雙人模式用同一組種子開局；沒有種子時用 Math.random（單機不受影響）
  let R = Math.random;
  function mulberry(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const rnd = function (n) { return Math.floor(R() * n); };
  const idx = function (c, r) { return r * COLS + c; };

  /** 產生一盤沒有開局連消的盤面 */
  function newBoard() {
    const b = [];
    for (let i = 0; i < COLS * ROWS; i++) b.push(rnd(NCOL));
    // 把開局就能連成 3 顆的地方換掉，避免一開始就自動消除
    let guard = 0;
    while (findMatches(b).length && guard++ < 500) {
      findMatches(b).forEach(function (i) { b[i] = rnd(NCOL); });
    }
    return b;
  }

  /** 找出所有 3 顆以上連成一線的珠子位置（不重複的索引陣列） */
  function findMatches(b) {
    const hit = {};
    for (let r = 0; r < ROWS; r++) {
      let run = 1;
      for (let c = 1; c <= COLS; c++) {
        const same = c < COLS && b[idx(c, r)] === b[idx(c - 1, r)];
        if (same) { run++; continue; }
        if (run >= 3) for (let k = c - run; k < c; k++) hit[idx(k, r)] = true;
        run = 1;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let run = 1;
      for (let r = 1; r <= ROWS; r++) {
        const same = r < ROWS && b[idx(c, r)] === b[idx(c, r - 1)];
        if (same) { run++; continue; }
        if (run >= 3) for (let k = r - run; k < r; k++) hit[idx(c, k)] = true;
        run = 1;
      }
    }
    return Object.keys(hit).map(Number);
  }

  /** 消除 + 掉落補位，回傳這一輪的連鎖資訊 */
  function resolve(b) {
    let cleared = 0, combos = 0, hits = null;
    let m = findMatches(b);
    while (m.length) {
      if (!hits) hits = m.slice();
      combos++;
      cleared += m.length;
      m.forEach(function (i) { b[i] = -1; });
      for (let c = 0; c < COLS; c++) {
        let w = ROWS - 1;
        for (let r = ROWS - 1; r >= 0; r--) {
          if (b[idx(c, r)] !== -1) { b[idx(c, w)] = b[idx(c, r)]; w--; }
        }
        for (let r = w; r >= 0; r--) b[idx(c, r)] = rnd(NCOL);
      }
      m = findMatches(b);
    }
    return { cleared: cleared, combos: combos, hits: hits || [] };
  }

  /** 交換兩顆相鄰珠子；有消除才算一步（沒有就還原） */
  function trySwap(b, a, c) {
    const ca = a % COLS, ra = Math.floor(a / COLS), cc = c % COLS, rc = Math.floor(c / COLS);
    if (Math.abs(ca - cc) + Math.abs(ra - rc) !== 1) return null;
    const t = b[a]; b[a] = b[c]; b[c] = t;
    if (!findMatches(b).length) { b[c] = b[a]; b[a] = t; return null; }
    return resolve(b);
  }

  /** 新遊戲：關卡 0..2 */
  function start(level, seed) {
    R = seed == null ? Math.random : mulberry(seed);
    const lv = LEVELS[level || 0];
    return { level: level || 0, board: newBoard(), movesLeft: lv.moves, goal: lv.goal, cleared: 0, score: 0, over: false, won: false };
  }

  /** 在某一關玩一步（a→c 交換）；回傳這一步的結果，遊戲狀態會直接更新 */
  function move(s, a, c) {
    if (s.over) return null;
    const res = trySwap(s.board, a, c);
    if (!res) return null;
    s.movesLeft -= 1;
    s.cleared += res.cleared;
    s.score += res.cleared * 10 * res.combos;
    if (s.cleared >= s.goal) { s.over = true; s.won = true; }
    else if (s.movesLeft <= 0) { s.over = true; s.won = false; }
    return res;
  }

  RR.Orb = { LEVELS: LEVELS, COLS: COLS, ROWS: ROWS, start: start, move: move, findMatches: findMatches, resolve: resolve };
})();
