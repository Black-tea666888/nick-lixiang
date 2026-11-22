/* 撲克牌：21 點（單人對莊家）。莊家 17 點必停；21 點直接贏；爆牌輸。 */
(function (root) {
  const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  function makeDeck() { const d = []; SUITS.forEach(function (s) { RANKS.forEach(function (r) { d.push({ r: r, s: s }); }); }); return d; }
  function shuffle(d) { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; } return d; }
  function value(hand) {
    let v = 0, aces = 0;
    hand.forEach(function (c) { if (c.r === 'A') { aces++; v += 11; } else if ('JQK'.indexOf(c.r) >= 0) v += 10; else v += +c.r; });
    while (v > 21 && aces > 0) { v -= 10; aces--; }
    return v;
  }
  function draw(s) { if (s.deck.length < 15) s.deck = shuffle(makeDeck()); return s.deck.pop(); }
  function settle(s) {
    const pv = value(s.player), dv = value(s.dealer);
    s.phase = 'over';
    if (pv > 21) { s.msg = '爆牌，莊家贏'; s.l++; }
    else if (dv > 21 || pv > dv) { s.msg = '你贏了！'; s.w++; }
    else if (pv === dv) { s.msg = '平手'; s.t++; }
    else { s.msg = '莊家贏'; s.l++; }
    return s;
  }
  function start() { return { deck: shuffle(makeDeck()), player: [], dealer: [], phase: 'over', msg: '按「發牌」開始一局', w: 0, l: 0, t: 0 }; }
  function deal(s) {
    if (s.phase === 'play') return s;
    s.player = [draw(s), draw(s)]; s.dealer = [draw(s), draw(s)]; s.phase = 'play'; s.msg = '要牌或停牌？';
    if (value(s.player) === 21) return stand(s);
    return s;
  }
  function hit(s) {
    if (s.phase !== 'play') return s;
    s.player.push(draw(s));
    if (value(s.player) > 21) return settle(s);
    return s;
  }
  function stand(s) {
    if (s.phase !== 'play') return s;
    while (value(s.dealer) < 17) s.dealer.push(draw(s));
    return settle(s);
  }
  const api = { start: start, deal: deal, hit: hit, stand: stand, value: value };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.BJ = api; }
})(typeof window !== 'undefined' ? window : globalThis);
