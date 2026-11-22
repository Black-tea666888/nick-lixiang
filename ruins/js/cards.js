/* 怪物卡牌：像 UNO 的出牌遊戲，跟電腦對戰（RR.Cards）
 * 牌：四種屬性（火、冰、毒、電）× 等級 1～9 的怪物（各兩張），每種屬性還有「禁止」「迴轉」「+2」各兩張，
 *     加上「王者怪物」（任選屬性）和「王者 +4」各四張，共 108 張。
 * 規則：出跟桌上同屬性或同等級／同功能的牌；沒牌可出就抽一張，抽到能出的可以馬上出。
 *       禁止：下一位跳過；迴轉：反方向（兩人時等於禁止）；+2／+4：下一位抽牌並跳過。
 *       誰先出完手牌誰贏；剩一張時會自動喊「最後一張！」。 */
(function () {
  'use strict';
  const RR = window.RR = window.RR || {};
  const COL = ['火', '冰', '毒', '電'], COLC = ['#d4472e', '#3478d1', '#3a9f47', '#e2ad19'];
  const MON = ['', '史萊姆', '地鼠', '蝙蝠', '骷髏', '殭屍', '狼人', '石像鬼', '巨魔', '深淵魔王'];
  const ACT = { skip: '禁止', rev: '迴轉', d2: '+2', wild: '王者怪物', w4: '王者 +4' };
  const AI_NAMES = ['電腦・阿鐵', '電腦・小罐', '電腦・齒輪'];
  // 怪物剪影：等級越高越大隻、角越多（墨線 SVG）
  function monSvg(v) {
    const lv = +v || 5, horns = lv >= 7 ? '<path d="M7 7 5 2l4 3M17 7l2-5-4 3"/>' : lv >= 4 ? '<path d="M8 6 7 3M16 6l1-3"/>' : '';
    const teeth = lv >= 5 ? '<path d="M9 15l1 1.5 1-1.5 1 1.5 1-1.5 1 1.5 1-1.5"/>' : '<path d="M9.5 15.5q2.5 1.5 5 0"/>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + horns + '<path d="M5 20c0-8 2.5-13 7-13s7 5 7 13l-2-1.5-1.5 1.5-1.5-1.5-2 1.5-2-1.5-1.5 1.5-1.5-1.5z"/><circle cx="9.5" cy="11.5" r="1.4"/><circle cx="14.5" cy="11.5" r="1.4"/>' + teeth + '</svg>';
  }
  const ACT_SVG = {
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg>',
    rev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12l-3-3M19 15H7l3 3"/></svg>',
    d2: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="9" height="13" rx="1"/><rect x="11" y="4" width="9" height="13" rx="1"/></svg>',
    wild: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 6 7l4 5 2-7 2 7 4-5 2 11z"/><path d="M4 21h16"/></svg>',
    w4: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 6 7l4 5 2-7 2 7 4-5 2 11z"/><path d="M4 21h16"/></svg>'
  };
  let G = null, hooks = { award: function () { return ''; }, back: function () {}, sfx: function () {}, send: function () {}, open: function () {} }, root = null;
  // 雙人線上：房主跑完整規則（NET.host），對手只收到房主送來的畫面狀態，出牌／抽牌則回傳給房主
  let NET = null;
  const $ = function (s) { return root.querySelector(s); };

  function newDeck() {
    const d = [];
    for (let c = 0; c < 4; c++) {
      for (let v = 1; v <= 9; v++) { d.push({ c: c, v: v }); d.push({ c: c, v: v }); }
      ['skip', 'rev', 'd2'].forEach(function (a) { d.push({ c: c, v: a }); d.push({ c: c, v: a }); });
    }
    for (let i = 0; i < 4; i++) { d.push({ c: 4, v: 'wild' }); d.push({ c: 4, v: 'w4' }); }
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
    return d;
  }
  function draw(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!G.deck.length) {   // 牌堆用完：把桌上除了最上面那張洗回去
        const top = G.pile.pop(); G.deck = G.pile.map(function (k) { return { c: k.c, v: k.v }; });   // 王者牌選過的屬性清掉
        for (let a = G.deck.length - 1; a > 0; a--) { const b = Math.floor(Math.random() * (a + 1)); const t = G.deck[a]; G.deck[a] = G.deck[b]; G.deck[b] = t; }
        G.pile = [top]; if (!G.deck.length) break;
      }
      out.push(G.deck.pop());
    }
    return out;
  }
  function top() { return G.pile[G.pile.length - 1]; }
  function canPlay(k) { const t = top(); return k.c === 4 || k.c === G.color || k.v === t.v; }
  function next(from, steps) { const n = G.hands.length; return ((from + G.dir * (steps || 1)) % n + n) % n; }
  function cardName(k) { return k.c === 4 ? ACT[k.v] : COL[k.c] + (typeof k.v === 'number' ? '・Lv' + k.v + ' ' + MON[k.v] : '・' + ACT[k.v]); }

  /** 開一局：opts.opp 對手人數 1～3、opts.hand 起手張數 */
  function start(opts) {
    const net = !!(opts && opts.net), opp = net ? 1 : Math.max(1, Math.min(3, (opts && opts.opp) | 0 || 3)), hand = (opts && opts.hand) | 0 || 7;
    NET = net ? { host: true, ready: false } : null;
    G = { deck: newDeck(), pile: [], hands: [], names: net ? ['你', '對手'] : ['你'].concat(AI_NAMES.slice(0, opp)), turn: 0, dir: 1, color: 0, busy: false, drew: false, over: false, winner: null, opts: { opp: opp, hand: hand, net: net }, log: '' };
    for (let i = 0; i <= opp; i++) G.hands.push([]);
    for (let r = 0; r < hand; r++) for (let i = 0; i <= opp; i++) G.hands[i].push(G.deck.pop());
    let first = G.deck.pop(); while (typeof first.v !== 'number') { G.deck.unshift(first); first = G.deck.pop(); }   // 第一張一定是數字牌
    G.pile.push(first); G.color = first.c;
    G.turn = Math.floor(Math.random() * (opp + 1));
    G.hands.forEach(function (_, w) { sortHand(w); }); ensureDom(); root.classList.remove('hide'); $('.cgEnd').classList.add('hide'); $('.cgPick').classList.add('hide');
    say(G.turn === 0 ? '你先出牌' : G.names[G.turn] + ' 先出牌'); render();
    if (isAI(G.turn)) aiSoon();
  }
  function isAI(w) { return w !== 0 && !NET; }
  function sortHand(w) { const h = G.hands[w || 0]; h.sort(function (a, b) { return a.c - b.c || (typeof a.v === 'number' ? a.v : 20) - (typeof b.v === 'number' ? b.v : 20); }); }
  function say(t) { if (G) G.log = t; const m = $('.cgMsg'); if (m) m.textContent = t; }

  /** 出牌（who 出 hand 裡第 idx 張），wc 是王者牌選的屬性 */
  function play(who, idx, wc) {
    const k = G.hands[who].splice(idx, 1)[0]; G.drew = false;
    if (k.c === 4) { k.wc = wc; G.color = wc; } else G.color = k.c;
    G.pile.push(k); hooks.sfx('play');
    let msg = (who === 0 ? '你' : G.names[who]) + ' 出了 ' + cardName(k) + (k.c === 4 ? '，指定' + COL[wc] : '');
    if (!G.hands[who].length) { say(msg + '，出完了！'); render(); end(who); return; }
    if (G.hands[who].length === 1) msg += '　— 最後一張！';
    let skip = false;
    if (k.v === 'rev') { if (G.hands.length === 2) skip = true; else G.dir = -G.dir; }
    if (k.v === 'skip') skip = true;
    let hitT = -1;
    if (k.v === 'd2' || k.v === 'w4') { const tgt = next(who), n = k.v === 'd2' ? 2 : 4; hitT = tgt; G.hands[tgt].push.apply(G.hands[tgt], draw(n)); msg += '，' + (tgt === 0 ? '你' : G.names[tgt]) + ' 抽 ' + n + ' 張'; skip = true; sortHand(tgt); }
    G.turn = next(who, skip ? 2 : 1);
    G.fx = { land: true, hit: hitT, wild: k.c === 4 };
    say(msg); render(); if (isAI(G.turn)) aiSoon(); else if (!G.over) setTimeout(function () { if (G && G.turn === 0 && !G.over) say(G.log + '。輪到你'); }, 700);
  }
  function pass(who) { G.drew = false; G.turn = next(who); render(); if (isAI(G.turn)) aiSoon(); }
  function end(winner) {
    G.over = true; G.winner = winner; hooks.sfx(winner === 0 ? 'win' : 'lose');
    const txt = hooks.award(winner === 0, G.hands.length - 1) || '';
    $('.cgEndT').textContent = winner === 0 ? '你贏了！' : G.names[winner] + ' 贏了';
    $('.cgEndS').textContent = txt;
    $('.cgEnd').classList.remove('hide');
    netSync(null);
  }

  // ---------- 電腦 ----------
  function aiSoon() { if (G.over) return; G.busy = true; render(); clearTimeout(G.t); G.t = setTimeout(aiTurn, 750 + Math.random() * 450); }
  function bestColor(h) { const n = [0, 0, 0, 0]; h.forEach(function (k) { if (k.c < 4) n[k.c] += 1; }); let b = 0; for (let i = 1; i < 4; i++) if (n[i] > n[b]) b = i; return n[b] ? b : Math.floor(Math.random() * 4); }
  function aiPick(who) {
    const h = G.hands[who], nx = next(who), danger = G.hands[nx].length <= 2;
    let best = -1, score = -1e9;
    h.forEach(function (k, i) {
      if (!canPlay(k)) return;
      let s = typeof k.v === 'number' ? k.v : 12;
      if (k.c === 4) s = danger ? 30 : -20 + (k.v === 'w4' ? 5 : 0);   // 王者牌留到後面，除非下一家快贏了
      else if (danger && (k.v === 'd2' || k.v === 'skip')) s = 40;
      if (k.c === G.color) s += 3;
      if (s > score) { score = s; best = i; }
    });
    return best;
  }
  function aiTurn() {
    if (!G || G.over) return; const who = G.turn; if (who === 0) { G.busy = false; render(); return; }
    let i = aiPick(who);
    if (i < 0) {
      const got = draw(1); G.hands[who].push.apply(G.hands[who], got); hooks.sfx('draw');
      if (got.length && canPlay(got[0])) { i = G.hands[who].length - 1; }
      else { say(G.names[who] + ' 抽了一張，換下一位'); G.busy = false; pass(who); return; }
    }
    const k = G.hands[who][i]; G.busy = false;
    play(who, i, k.c === 4 ? bestColor(G.hands[who].filter(function (_, j) { return j !== i; })) : undefined);
  }

  // ---------- 玩家 ----------
  function tapCard(i) {
    if (!G || G.over || G.turn !== 0 || G.busy) return;
    const k = G.hands[0][i]; if (!canPlay(k)) { hooks.sfx('no'); say('這張不能出：要' + COL[G.color] + '屬性，或跟桌上同等級／同功能'); return; }
    if (G.drew && i !== G.drewIdx) { say('抽到的那張才可以出，或按「不出」'); return; }
    if (k.c === 4) { G.pickIdx = i; $('.cgPick').classList.remove('hide'); return; }
    doPlay(i, undefined);
  }
  // 出牌：房主（或單人）直接出；對手端只把動作送給房主，等房主回傳新畫面
  function doPlay(i, wc) {
    if (NET && !NET.host) { const k = G.hands[0][i]; G.busy = true; render(); netSend({ t: 'card_act', a: 'play', c: k.c, v: k.v, wc: wc }); return; }
    play(0, i, wc);
  }
  function tapDraw() {
    if (!G || G.over || G.turn !== 0 || G.busy || G.drew) return;
    if (NET && !NET.host) { G.busy = true; render(); netSend({ t: 'card_act', a: 'draw' }); return; }
    drawFor(0);
  }
  // 抽一張（who 為座位）：抽到能出的可以馬上出，否則換下一位；對手抽牌不顯示牌名
  function drawFor(who) {
    if (!G || G.over || G.turn !== who || G.busy || G.drew) return;
    const got = draw(1); if (!got.length) { pass(who); return; }
    G.hands[who].push(got[0]); hooks.sfx('draw'); sortHand(who);
    const mine = who === 0;
    if (canPlay(got[0])) { G.drew = true; G.drewIdx = G.hands[who].indexOf(got[0]); say(mine ? '抽到 ' + cardName(got[0]) + '，可以出，或按「不出」' : '對手抽了一張，可以出，或按「不出」'); render(); }
    else { say(mine ? '抽到 ' + cardName(got[0]) + '，不能出，換下一位' : '對手抽了一張，換下一位'); pass(who); }
  }

  // ---------- 畫面 ----------
  function cardEl(k, opts) {
    const el = document.createElement('button'); el.type = 'button';
    const wc = k.c === 4 ? k.wc : k.c;
    el.className = 'cgCard' + (k.c === 4 ? ' wild' : '') + (typeof k.v === 'number' ? ' num' : ' act');
    if (wc != null && wc < 4) el.style.setProperty('--cc', COLC[wc]);
    const big = typeof k.v === 'number' ? k.v : ACT[k.v].replace('王者 ', '');
    el.innerHTML = '<span class="cgCor">' + (typeof k.v === 'number' ? k.v : k.v === 'w4' ? '+4' : k.v === 'd2' ? '+2' : '') + '</span><span class="cgArt">' + (typeof k.v === 'number' ? monSvg(k.v) : ACT_SVG[k.v]) + '</span><span class="cgNm"></span>';
    el.querySelector('.cgNm').textContent = typeof k.v === 'number' ? MON[k.v] : (k.c === 4 && k.wc != null ? COL[k.wc] + '・' : '') + ACT[k.v];
    el.setAttribute('aria-label', cardName(k)); void big;
    if (opts && opts.small) el.classList.add('sm');
    return el;
  }
  function render() {
    if (!root || !G) return;
    const fx = G.fx || {}; G.fx = null; netSync(fx);
    const opp = $('.cgOpps'); opp.textContent = '';
    for (let i = 1; i < G.hands.length; i++) {
      const o = document.createElement('div'); o.className = 'cgOpp' + (G.turn === i ? ' on' : '') + (G.hands[i].length === 1 ? ' last' : '') + (fx.hit === i ? ' hit' : '');
      o.innerHTML = '<b></b><span class="cgBacks"></span><small></small>';
      o.querySelector('b').textContent = G.names[i];
      const bk = o.querySelector('.cgBacks'); for (let j = 0; j < Math.min(8, G.hands[i].length); j++) bk.appendChild(document.createElement('i'));
      o.querySelector('small').textContent = G.hands[i].length + ' 張' + (G.hands[i].length === 1 ? '・最後一張！' : '');
      opp.appendChild(o);
    }
    const disc = $('.cgDisc'); disc.textContent = ''; const topEl = cardEl(top()); if (fx.land) topEl.classList.add('land'); disc.appendChild(topEl);
    const colEl = $('.cgCol'); if (fx.wild) { colEl.classList.remove('pulse'); void colEl.offsetWidth; colEl.classList.add('pulse'); }
    colEl.style.setProperty('--cc', COLC[G.color]); $('.cgCol b').textContent = COL[G.color];
    $('.cgDir').textContent = G.dir > 0 ? '順時針 ⟳' : '逆時針 ⟲';
    $('.cgDeckN').textContent = G.deck.length;
    const mine = G.turn === 0 && !G.busy && !G.over;
    root.classList.toggle('myTurn', mine);
    $('.cgDeck').disabled = !mine || G.drew;
    $('.cgPass').classList.toggle('hide', !(mine && G.drew));
    $('.cgMe').textContent = '你的手牌 ' + G.hands[0].length + ' 張' + (G.hands[0].length === 1 ? '・最後一張！' : '');
    const hand = $('.cgHand'); hand.textContent = '';
    G.hands[0].forEach(function (k, i) {
      const el = cardEl(k);
      const ok = mine && canPlay(k) && (!G.drew || i === G.drewIdx);
      el.classList.toggle('ok', ok); el.classList.toggle('dim', mine && !ok);
      el.addEventListener('click', function () { tapCard(i); });
      hand.appendChild(el);
    });
  }
  function ensureDom() {
    if (root) return;
    root = document.createElement('div'); root.className = 'screen hide cgScr'; root.id = 'scrCard';
    root.innerHTML =
      '<div class="cg">' +
      '<header class="cgTop"><button class="icon" type="button" aria-label="返回" data-a="back">‹</button><b class="cgTitle">怪物卡牌</b><button class="btn cgHelpB" type="button" data-a="help">規則</button></header>' +
      '<div class="cgOpps"></div>' +
      '<div class="cgTable">' +
      '<button class="cgDeck" type="button" aria-label="抽一張"><span class="cgBack"></span><small>抽牌 <b class="cgDeckN"></b></small></button>' +
      '<div class="cgDisc" aria-live="polite"></div>' +
      '<div class="cgSide"><span class="cgCol">屬性 <b></b></span><span class="cgDir"></span><button class="btn cgPass hide" type="button">不出</button></div>' +
      '</div>' +
      '<p class="cgMsg" role="status"></p>' +
      '<div class="cgMe"></div>' +
      '<div class="cgHand"></div>' +
      '</div>' +
      '<div class="cgPick hide"><div class="panel small"><h2>王者怪物：指定屬性</h2><div class="cgPickRow">' + COL.map(function (c, i) { return '<button type="button" class="cgPickB" data-c="' + i + '" style="--cc:' + COLC[i] + '">' + c + '</button>'; }).join('') + '</div><button class="btn" type="button" data-a="pickNo">取消</button></div></div>' +
      '<div class="cgEnd hide"><div class="panel small"><h2 class="cgEndT"></h2><p class="cgEndS"></p><div class="row"><button class="btn" type="button" data-a="back2">回大廳</button><button class="btn primary" type="button" data-a="again">再來一局</button></div></div></div>' +
      '<div class="cgAsk hide"><div class="panel small"><h2>離開這局？</h2><p>離開這局卡牌，這局不算。</p><div class="row"><button class="btn" type="button" data-a="askNo">繼續玩</button><button class="btn primary" type="button" data-a="askYes">離開</button></div></div></div>' +
      '<div class="cgHelp hide"><div class="panel small tut"><h2>怪物卡牌規則</h2><ul>' +
      '<li>出跟桌上<b>同屬性</b>（火、冰、毒、電）或<b>同等級／同功能</b>的牌。</li>' +
      '<li>沒牌可出就按牌堆抽一張；抽到能出的可以馬上出，或按「不出」。</li>' +
      '<li>禁止：下一位跳過。迴轉：反方向。+2：下一位抽 2 張並跳過。</li>' +
      '<li>王者怪物：任何時候都能出，指定下一個屬性。王者 +4：再讓下一位抽 4 張並跳過。</li>' +
      '<li>先出完手牌的人贏！</li></ul><div class="row"><button class="btn primary" type="button" data-a="helpNo">知道了</button></div></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      const a = e.target.closest('[data-a]'); const pk = e.target.closest('.cgPickB');
      if (pk) { $('.cgPick').classList.add('hide'); if (G.pickIdx != null) { const i = G.pickIdx; G.pickIdx = null; doPlay(i, +pk.dataset.c); } return; }
      if (!a) return;
      const act = a.dataset.a;
      if (act === 'back') { if (G && !G.over) { $('.cgAsk').classList.remove('hide'); return; } close(); }
      else if (act === 'askNo') $('.cgAsk').classList.add('hide');
      else if (act === 'askYes') { $('.cgAsk').classList.add('hide'); close(); }
      else if (act === 'back2') close();
      else if (act === 'again') { if (NET && !NET.host) { say('請房主再來一局'); return; } start(G.opts); }
      else if (act === 'pickNo') { $('.cgPick').classList.add('hide'); G.pickIdx = null; }
      else if (act === 'help') $('.cgHelp').classList.remove('hide');
      else if (act === 'helpNo') $('.cgHelp').classList.add('hide');
    });
    $('.cgDeck').addEventListener('click', tapDraw);
    $('.cgPass').addEventListener('click', function () { if (G && G.turn === 0 && G.drew) { if (NET && !NET.host) { G.busy = true; render(); netSend({ t: 'card_act', a: 'pass' }); return; } say('你不出，換下一位'); pass(0); } });
  }
  function close() { if (G) { clearTimeout(G.t); G.over = true; } NET = null; if (root) root.classList.add('hide'); hooks.back(); }

  // ---------- 雙人線上（房主為準）----------
  function netSend(m) { hooks.send(m); }
  // 房主把畫面狀態送給對手：只給對手自己的手牌，對手那邊只看得到張數
  function netSync(fx) {
    if (!NET || !NET.host || !NET.ready || !G) return;
    const g = G, f = fx || g.fx || {};
    netSend({
      t: 'card_state', hand: g.hands[1].map(function (k) { return { c: k.c, v: k.v, wc: k.wc }; }),
      oppN: g.hands[0].length, deckN: g.deck.length, top: top(), color: g.color,
      turn: g.turn === 1 ? 0 : 1, drew: g.turn === 1 && !!g.drew, drewIdx: g.turn === 1 && g.drew ? g.drewIdx : -1,
      over: !!g.over, win: !!g.over && g.winner === 1, log: g.log,
      fx: { land: !!f.land, hit: f.hit === 1 ? 0 : f.hit === 0 ? 1 : -1, wild: !!f.wild }
    });
  }
  // 房主：收到對手動作後依牌面身分找到那張牌再執行；不管成不成功都回傳一次畫面，讓對手解鎖
  function netMsg(d) {
    if (!NET && d.t === 'card_state') NET = { host: false, ready: false };
    if (!NET) return;
    if (!NET.host) { if (d.t === 'card_state') applyView(d); return; }
    if (!G) return;
    if (d.t !== 'card_act' || G.over || G.turn !== 1) { netSync(null); return; }
    if (d.a === 'draw') drawFor(1);
    else if (d.a === 'pass') { if (G.drew) { say('對手不出，換下一位'); pass(1); } }
    else if (d.a === 'play') {
      const h = G.hands[1], idx = [];
      h.forEach(function (k, j) { if (k.c === d.c && k.v === d.v) idx.push(j); });
      const i = G.drew && idx.indexOf(G.drewIdx) >= 0 ? G.drewIdx : idx[0];
      if (i != null && i >= 0 && canPlay(h[i]) && !(G.drew && i !== G.drewIdx) && !(h[i].c === 4 && !(d.wc >= 0 && d.wc < 4))) {
        play(1, i, h[i].c === 4 ? d.wc : undefined);
      }
    }
    netSync(null);
  }
  // 對手：套用房主送來的畫面
  function applyView(d) {
    const was = G && G.over;
    G = {
      deck: new Array(d.deckN | 0), pile: [d.top], hands: [d.hand, new Array(d.oppN | 0).fill(null)],
      names: ['你', '對手'], turn: d.turn, dir: 1, color: d.color, busy: false,
      drew: !!d.drew, drewIdx: d.drewIdx, over: !!d.over, winner: d.win ? 0 : 1, log: d.log,
      fx: d.fx, opts: { opp: 1, hand: 7, net: true }
    };
    ensureDom(); hooks.open(); root.classList.remove('hide'); $('.cgPick').classList.add('hide');
    if (d.over && !was) {
      hooks.sfx(d.win ? 'win' : 'lose');
      const txt = hooks.award(!!d.win, 1) || '';
      $('.cgEndT').textContent = d.win ? '你贏了！' : '對手贏了';
      $('.cgEndS').textContent = txt;
      $('.cgEnd').classList.remove('hide');
    } else if (!d.over) $('.cgEnd').classList.add('hide');
    say(d.log || '');
    render();
  }
  // 雙人房間開局：房主開新局（等對手加入前不送畫面）；對手只進入等待畫面
  function netStart(host, opts) {
    ensureDom(); root.classList.remove('hide');
    if (host) { start({ opp: 1, hand: (opts && opts.hand) || 7, net: true }); return G; }
    NET = { host: false, ready: false }; G = null;
    $('.cgEnd').classList.add('hide'); $('.cgPick').classList.add('hide');
    say('等待房主開局');
    return G;
  }
  function netReady() { if (NET && NET.host) { NET.ready = true; netSync(null); } }
  // 對手離開：這局不算
  function peerLeft() {
    if (!G) return;
    G.over = true; NET = null; clearTimeout(G.t);
    $('.cgEndT').textContent = '對方離開了';
    $('.cgEndS').textContent = '這局不算。';
    $('.cgEnd').classList.remove('hide');
  }

  ensureDom();
  RR.Cards = {
    /** main.js 提供：award(贏了?, 對手數) 回傳獎勵文字、back() 回大廳、sfx(種類) */
    hooks: function (h) { Object.keys(h).forEach(function (k) { hooks[k] = h[k]; }); },
    start: start,
    close: close,
    netStart: netStart,
    netReady: netReady,
    netMsg: netMsg,
    peerLeft: peerLeft,
    /** 測試用 */
    _state: function () { return G; }
  };
})();
