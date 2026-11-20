/* 德國麻將（拉密規則）：純邏輯，不碰畫面。
 * 牌：4 色（紅、藍、橘、黑）× 數字 1～13 各兩張，加 2 張百搭（鬼牌），共 106 張。
 * 牌組：群組（同數字、不同顏色，3～4 張）或順組（同顏色、數字連續，3 張以上，13 後面不能接 1）。
 * 破冰：第一次出牌只能用手上的牌組成新組，數字總和至少 30。
 * 破冰後：至少從手上出一張，可以把手牌接到桌上的組上。
 * 破冰後可以拆開桌上的組、和手上的牌重新組合（rearrange），桌上的牌不能少也不能多。
 * 結束：有人出完手牌就贏；其他人手上的點數加總當負分，有百搭每張另扣 30，贏家得全部負分。 */
(function (root) {
  'use strict';
  const COLORS = 4, MAXN = 13, JOKER_N = 2;
  const JOKER_PENALTY = 30, OPEN_MIN = 30;

  function tile(id, color, num) { return { id: id, color: color, num: num, joker: num === 0 }; }

  /** 完整牌組（106 張），洗好的 */
  function deck(rng) {
    const d = [];
    let id = 0;
    for (let rep = 0; rep < 2; rep++) for (let c = 0; c < COLORS; c++) for (let n = 1; n <= MAXN; n++) d.push(tile(id++, c, n));
    for (let j = 0; j < JOKER_N; j++) d.push(tile(id++, -1, 0));
    const r = rng || Math.random;
    for (let i = d.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)), t = d[i]; d[i] = d[k]; d[k] = t; }
    return d;
  }

  /** 群組：數字都一樣、顏色都不同、3～4 張（百搭補缺色）。回傳 {ok, value} */
  function asGroup(ts) {
    if (ts.length < 3 || ts.length > 4) return null;
    const real = ts.filter(function (t) { return !t.joker; });
    if (!real.length) return null;
    const n = real[0].num;
    if (real.some(function (t) { return t.num !== n; })) return null;
    const colors = {};
    for (let i = 0; i < real.length; i++) { if (colors[real[i].color]) return null; colors[real[i].color] = 1; }
    return { value: n * ts.length };
  }

  /** 順組：同顏色、數字不重複、連續（百搭補空位或接兩端，不能超出 1～13）。回傳 {ok, value} */
  function asRun(ts) {
    const L = ts.length;
    if (L < 3) return null;
    const real = ts.filter(function (t) { return !t.joker; });
    if (!real.length) return null;
    const col = real[0].color;
    if (real.some(function (t) { return t.color !== col; })) return null;
    const nums = real.map(function (t) { return t.num; }).sort(function (a, b) { return a - b; });
    for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1]) return null;
    const lo = nums[0], hi = nums[nums.length - 1], jokers = L - real.length;
    if (hi - lo + 1 - real.length > jokers) return null;   // 中間的空位不夠補
    let best = null;
    for (let s = 1; s + L - 1 <= MAXN; s++) {
      if (s > lo || s + L - 1 < hi) continue;
      const v = (s + s + L - 1) * L / 2;   // 這個順組的點數（百搭取它代表的數字）
      if (best === null || v > best) best = v;
    }
    return best === null ? null : { value: best };
  }

  /** 合法的一組（群組或順組） */
  function setInfo(ts) { return asGroup(ts) || asRun(ts); }

  function setValid(ts) { return !!setInfo(ts); }

  function countVal(ts) { let s = 0; ts.forEach(function (t) { s += t.joker ? 0 : t.num; }); return s; }

  /** 玩家（狀態）：手牌、是否已破冰；桌上是一組組的牌 */
  function start(rng, seats) {
    const n = seats || 3, d = deck(rng), hands = [];
    for (let s = 0; s < n; s++) hands.push(d.splice(0, 14));
    return { deck: d, hands: hands, table: [], opened: hands.map(function () { return false; }), turn: 0, over: false, winner: -1, log: [] };
  }

  /** 玩家出牌（一回合）：newSets 是手牌組的新組，extend 是接到桌上某組。
   *  回傳 {ok, why}。ok 時回傳新狀態（不改舊的）。 */
  function play(s, seat, newSets, extends_) {
    const extend = extends_ || [];
    if (s.over || seat !== s.turn) return { ok: false, why: '還沒輪到你' };
    const hand = s.hands[seat].slice();
    const used = {};
    const takeFromHand = function (ts) {
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i];
        const idx = hand.findIndex(function (h) { return h.id === t.id; });
        if (idx < 0 || used[t.id]) return false;
        used[t.id] = 1;
      }
      return true;
    };
    for (let i = 0; i < newSets.length; i++) {
      if (!takeFromHand(newSets[i])) return { ok: false, why: '牌不在手上' };
      if (!setValid(newSets[i])) return { ok: false, why: '這不是合法的組' };
    }
    const table = s.table.map(function (x) { return x.slice(); });
    for (let i = 0; i < extend.length; i++) {
      if (!takeFromHand(extend[i].tiles)) return { ok: false, why: '牌不在手上' };
      const target = table[extend[i].setIdx];
      if (!target) return { ok: false, why: '桌上沒有這組' };
      const merged = target.concat(extend[i].tiles);
      if (!setValid(merged)) return { ok: false, why: '接不上這組' };
      table[extend[i].setIdx] = merged;
    }
    if (!s.opened[seat] && extend.length) return { ok: false, why: '破冰前只能用手上的牌組新組' };
    const newValue = newSets.reduce(function (a, ts) { return a + setInfo(ts).value; }, 0);
    if (!s.opened[seat] && newSets.length && newValue < OPEN_MIN) return { ok: false, why: '破冰需要至少 30 點' };
    if (!s.opened[seat] && !newSets.length) return { ok: false, why: '破冰需要至少 30 點' };
    if (!newSets.length && !extend.length) return { ok: false, why: '至少要出一張' };
    newSets.forEach(function (ts) { table.push(ts.slice()); });
    const left = hand.filter(function (h) { return !used[h.id]; });
    const hands = s.hands.map(function (h, i) { return i === seat ? left : h; });
    const opened = s.opened.map(function (o, i) { return i === seat ? true : o; });
    const over = left.length === 0;
    return { ok: true, state: { deck: s.deck, hands: hands, table: table, opened: opened, turn: over ? seat : (seat + 1) % hands.length, over: over, winner: over ? seat : -1, pass: 0, log: s.log.concat([{ seat: seat, act: 'play' }]) } };
  }

  /** 破冰後重排桌面：newTable 是出完牌後的整個桌面，fromHand 是這回合從手上放上桌的牌。
   *  桌上的牌不能少、不能多；每一組都要合法。 */
  function rearrange(s, seat, newTable, fromHand) {
    if (s.over || seat !== s.turn) return { ok: false, why: '還沒輪到你' };
    if (!s.opened[seat]) return { ok: false, why: '破冰前不能動桌上的牌' };
    const hand = s.hands[seat];
    if (!fromHand.length) return { ok: false, why: '至少要從手上放一張牌' };
    fromHand.forEach(function (t) { if (!hand.some(function (h) { return h.id === t.id; })) throw new Error('not in hand'); });
    const want = {};
    s.table.forEach(function (ts) { ts.forEach(function (t) { want[t.id] = (want[t.id] || 0) + 1; }); });
    fromHand.forEach(function (t) { want[t.id] = (want[t.id] || 0) + 1; });
    const got = {};
    for (let i = 0; i < newTable.length; i++) {
      if (!newTable[i].length || !setValid(newTable[i])) return { ok: false, why: '有一組不是合法的組' };
      newTable[i].forEach(function (t) { got[t.id] = (got[t.id] || 0) + 1; });
    }
    const ids = Object.keys(want), gotIds = Object.keys(got);
    if (ids.length !== gotIds.length || ids.some(function (k) { return want[k] !== got[k]; })) return { ok: false, why: '桌上的牌對不上（有牌消失或多出來）' };
    const used = {};
    fromHand.forEach(function (t) { used[t.id] = 1; });
    const left = hand.filter(function (h) { return !used[h.id]; });
    const hands = s.hands.map(function (h, i) { return i === seat ? left : h; });
    const over = left.length === 0;
    return { ok: true, state: { deck: s.deck, hands: hands, table: newTable.map(function (x) { return x.slice(); }), opened: s.opened, turn: over ? seat : (seat + 1) % hands.length, over: over, winner: over ? seat : -1, pass: 0, log: s.log.concat([{ seat: seat, act: 'rearrange' }]) } };
  }

  /** 抽一張（沒有能出的牌時）：結束回合 */
  function draw(s, seat) {
    if (s.over || seat !== s.turn) return { ok: false, why: '還沒輪到你' };
    const d = s.deck.slice(), hands = s.hands.map(function (h) { return h.slice(); });
    if (d.length) { hands[seat].push(d.shift()); return { ok: true, state: { deck: d, hands: hands, table: s.table, opened: s.opened, turn: (seat + 1) % hands.length, over: false, winner: -1, pass: 0, log: s.log.concat([{ seat: seat, act: 'draw' }]) } }; }
    // 牌庫抽完：大家都無牌可出就結束，手上點數最少的贏
    const passes = (s.pass || 0) + 1, n = hands.length;
    if (passes < n) return { ok: true, state: { deck: d, hands: hands, table: s.table, opened: s.opened, turn: (seat + 1) % n, over: false, winner: -1, pass: passes, log: s.log.concat([{ seat: seat, act: 'pass' }]) } };
    const pen = hands.map(function (h) { let p = 0; h.forEach(function (t) { p += t.joker ? JOKER_PENALTY : t.num; }); return p; });
    const w = pen.indexOf(Math.min.apply(null, pen));
    return { ok: true, state: { deck: d, hands: hands, table: s.table, opened: s.opened, turn: w, over: true, winner: w, pass: passes, log: s.log.concat([{ seat: seat, act: 'end' }]) } };
  }

  /** 超時或亂了桌面：抽 3 張作為懲罰，結束回合 */
  function penalty(s, seat) {
    if (s.over || seat !== s.turn) return { ok: false, why: '還沒輪到你' };
    const d = s.deck.slice(), hands = s.hands.map(function (h) { return h.slice(); });
    for (let k = 0; k < 3 && d.length; k++) hands[seat].push(d.shift());
    return { ok: true, state: { deck: d, hands: hands, table: s.table, opened: s.opened, turn: (seat + 1) % hands.length, over: false, winner: -1, pass: 0, log: s.log.concat([{ seat: seat, act: 'penalty' }]) } };
  }

  /** 結算：贏家得其他人手上點數的總和（百搭每張另扣 30） */
  function score(s) {
    const pen = s.hands.map(function (h) {
      let p = 0; h.forEach(function (t) { p += t.joker ? JOKER_PENALTY : t.num; }); return p;
    });
    const total = pen.reduce(function (a, b) { return a + b; }, 0) - pen[s.winner];
    return pen.map(function (p, i) { return i === s.winner ? total : -p; });
  }

  /** 電腦走一步（簡單策略）：先找能破冰的組，破冰後能接就接，否則抽牌。回傳 {ok, state} */
  function aiMove(s, seat) {
    const hand = s.hands[seat];
    const real = hand.filter(function (t) { return !t.joker; });
    if (!s.opened[seat]) {
      const cands = candidateSets(real);
      cands.sort(function (a, b) { return setInfo(b).value - setInfo(a).value; });
      const pick = [], used = {};
      let sum = 0;
      cands.forEach(function (ts) {
        if (ts.some(function (t) { return used[t.id]; })) return;
        pick.push(ts); ts.forEach(function (t) { used[t.id] = 1; });
        sum += setInfo(ts).value;
      });
      if (sum >= OPEN_MIN) {
        const sel = []; let acc = 0;
        for (let i = 0; i < pick.length && acc < OPEN_MIN; i++) { sel.push(pick[i]); acc += setInfo(pick[i]).value; }
        const r = play(s, seat, sel, []);
        if (r.ok) return r;
      }
    } else {
      for (let t = 0; t < hand.length; t++) {
        for (let i = 0; i < s.table.length; i++) {
          const r = play(s, seat, [], [{ setIdx: i, tiles: [hand[t]] }]);
          if (r.ok) return r;
        }
      }
      const cands = candidateSets(real);
      if (cands.length) { const r = play(s, seat, [cands[0]], []); if (r.ok) return r; }
    }
    return draw(s, seat);
  }

  /** 手上所有可能的組（群組與順組），供電腦選擇 */
  function candidateSets(real) {
    const out = [];
    for (let n = 1; n <= MAXN; n++) {
      const same = real.filter(function (t) { return t.num === n; });
      const seen = {};
      same.forEach(function (t) { if (!seen[t.color]) { seen[t.color] = t; } });
      const list = Object.keys(seen).map(function (k) { return seen[k]; });
      if (list.length >= 3) out.push(list.slice(0, 4));
    }
    for (let c = 0; c < COLORS; c++) {
      const byN = {};
      real.forEach(function (t) { if (t.color === c && !byN[t.num]) byN[t.num] = t; });
      for (let a = 1; a <= MAXN; a++) {
        let run = [];
        for (let b = a; b <= MAXN && byN[b]; b++) {
          run.push(byN[b]);
          if (run.length >= 3) out.push(run.slice());
        }
      }
    }
    return out.filter(setValid);
  }

  const api = { deck: deck, start: start, play: play, rearrange: rearrange, draw: draw, penalty: penalty, score: score, aiMove: aiMove, setValid: setValid, setInfo: setInfo, OPEN_MIN: OPEN_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Rummi = api; }
})(typeof window !== 'undefined' ? window : globalThis);
