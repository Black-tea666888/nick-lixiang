/* 麻將（台灣十六張簡化版，對電腦）：純邏輯，不碰畫面。
   136 張（萬條筒 1–9、東南西北中發白，各 4 張，不含花牌）；每人 16 張，
   莊家（你）先摸成 17 張。湊成 5 組＋1 對即胡。本版不吃不碰，只能自摸或胡別人打出的牌。 */
(function () {
  'use strict';
  const RR = window.RR = window.RR || {};
  const NAMES = ['一萬', '二萬', '三萬', '四萬', '五萬', '六萬', '七萬', '八萬', '九萬',
    '一條', '二條', '三條', '四條', '五條', '六條', '七條', '八條', '九條',
    '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
    '東', '南', '西', '北', '中', '發', '白'];
  const HAND = 16, WIN = 17;

  function tileName(t) { return NAMES[t]; }

  // 4 張 × 34 種 → 洗牌
  function mulberry(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function newWall(rnd) {
    const w = [];
    for (let t = 0; t < 34; t++) for (let k = 0; k < 4; k++) w.push(t);
    for (let i = w.length - 1; i > 0; i--) { const j = Math.floor((rnd || Math.random)() * (i + 1)); const x = w[i]; w[i] = w[j]; w[j] = x; }
    return w;
  }

  function countsOf(hand) { const c = new Array(34).fill(0); for (const t of hand) c[t]++; return c; }

  // 能否把計數拆成若干組（刻子或同花色順子）
  function sets(c) {
    let i = 0; while (i < 34 && c[i] === 0) i++;
    if (i === 34) return true;
    if (c[i] >= 3) { c[i] -= 3; const ok = sets(c); c[i] += 3; if (ok) return true; }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      const ok = sets(c);
      c[i]++; c[i + 1]++; c[i + 2]++;
      if (ok) return true;
    }
    return false;
  }

  // 17 張：5 組＋1 對
  function winning(hand) {
    if (hand.length !== WIN) return false;
    const c = countsOf(hand);
    for (let i = 0; i < 34; i++) {
      if (c[i] >= 2) {
        c[i] -= 2; const ok = sets(c); c[i] += 2;
        if (ok) return true;
      }
    }
    return false;
  }

  // 給種子（雙人）時兩人拿到同一副牌堆；turns 記錄自己摸牌的巡數，用來比先胡快慢
  function newGame(seed) {
    const wall = newWall(seed == null ? null : mulberry(seed));
    const you = [], cpu = [];
    for (let i = 0; i < HAND; i++) { you.push(wall.pop()); cpu.push(wall.pop()); }
    const s = { wall, hand: { you, cpu }, discards: [], last: null, over: false, winner: null, draw: false, turns: 1 };
    drawTile(s, 'you');
    if (winning(you)) { s.over = true; s.winner = 'you'; }
    return s;
  }

  // 摸一張；牌堆空了回傳 null
  function drawTile(s, who) {
    if (s.wall.length === 0) { s.over = true; s.draw = true; return null; }
    const t = s.wall.pop(); s.hand[who].push(t); return t;
  }

  // 出一張（idx 為手牌索引）；回傳出的牌
  function discard(s, who, idx) {
    const t = s.hand[who].splice(idx, 1)[0];
    s.discards.push(t); s.last = { tile: t, who };
    return t;
  }

  // 能否胡上一張打出的牌（非自己打的）
  function canRon(s) {
    if (!s.last) return false;
    const other = s.last.who === 'you' ? 'cpu' : 'you';
    return winning(s.hand[other].concat([s.last.tile]));
  }

  function ron(s) {
    const other = s.last.who === 'you' ? 'cpu' : 'you';
    s.hand[other].push(s.last.tile);
    s.discards.pop(); s.last = null;
    s.over = true; s.winner = other;
  }

  // 電腦出牌：留對子、刻子與相鄰牌，優先丟孤立的字牌與邊張
  function aiChoose(hand) {
    const c = countsOf(hand);
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < hand.length; i++) {
      const t = hand[i];
      let score = (c[t] - 1) * 4;                       // 有成對、刻子加分
      if (t < 27) {
        const suit = Math.floor(t / 9), n = t % 9;
        for (const d of [-2, -1, 1, 2]) {
          const m = n + d;
          if (m >= 0 && m < 9 && c[suit * 9 + m] > 0) score += Math.abs(d) === 1 ? 2 : 1;
        }
        if (n === 0 || n === 8) score -= 1;             // 邊張
      } else {
        score -= 1;                                     // 字牌較難成組
      }
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  RR.Mj = { HAND, WIN, tileName, newGame, drawTile, discard, winning, canRon, ron, aiChoose };
})();
