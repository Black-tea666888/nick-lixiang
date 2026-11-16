/* 主選單的單機小遊戲：不用進房間就能玩。
   - 圈圈叉叉：和電腦（簡單／困難）或兩人同一支手機輪流
   - 分類回收：30 秒內把廢棄物點進正確的回收桶
   金幣獎勵每天有上限（RR.UI.miniReward 處理），避免洗金幣。 */
(function () {
'use strict';
const RR = window.RR = window.RR || {};
const $ = function (id) { return document.getElementById(id); };
const tone = function (f, d, t, v, f2) { try { RR.Sfx && RR.Sfx.tone(f, d, t, v, f2); } catch (e) {} };

/* ---------------- 圈圈叉叉 ---------------- */
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
let tt = null;   // { b: [9], turn: 'X'|'O', vs: 'easy'|'hard'|'two', over: null|'X'|'O'|'draw', youStart }
function winner(b) {
  for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return { w: b[l[0]], line: l };
  return b.every(Boolean) ? { w: 'draw', line: null } : null;
}
function minimax(b, me, cur) {
  const r = winner(b);
  if (r) return { s: r.w === 'draw' ? 0 : r.w === me ? 10 : -10 };
  let best = { s: cur === me ? -99 : 99, i: -1 };
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = cur; const v = minimax(b, me, cur === 'X' ? 'O' : 'X').s; b[i] = null;
    const sc = v - Math.sign(v) * 0.01;   // 同分時偏好比較快贏、比較慢輸
    if (cur === me ? sc > best.s : sc < best.s) best = { s: sc, i: i };
  }
  return best;
}
function aiMove() {
  const empty = []; tt.b.forEach(function (c, i) { if (!c) empty.push(i); });
  if (!empty.length) return;
  let i;
  if (tt.vs === 'easy' && Math.random() < 0.55) i = empty[Math.floor(Math.random() * empty.length)];
  else i = empty.length === 9 ? [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)] : minimax(tt.b.slice(), 'O', 'O').i;
  place(i);
}
function ttNew(keepMode) {
  const vs = keepMode && tt ? tt.vs : (tt ? tt.vs : 'easy');
  const youStart = tt ? !tt.youStart : true;
  tt = { b: Array(9).fill(null), turn: 'X', vs: vs, over: null, line: null, youStart: youStart };
  if (vs !== 'two' && !youStart) { tt.turn = 'O'; setTimeout(function () { if (tt && !tt.over) aiMove(); }, 420); }
  ttDraw();
}
function place(i) {
  if (!tt || tt.over || tt.b[i]) return;
  tt.b[i] = tt.turn; tone(tt.turn === 'X' ? 520 : 390, 0.06, 'square', 0.06);
  const r = winner(tt.b);
  if (r) {
    tt.over = r.w; tt.line = r.line;
    if (tt.vs !== 'two') {
      if (r.w === 'X') { tone(660, 0.14, 'triangle', 0.14, 990); RR.UI.miniReward(tt.vs === 'hard' ? 12 : 5, '圈圈叉叉獲勝', $('ttLocalMsg')); }
      else if (r.w === 'O') tone(300, 0.2, 'triangle', 0.1, 200);
    }
  } else {
    tt.turn = tt.turn === 'X' ? 'O' : 'X';
    if (tt.vs !== 'two' && tt.turn === 'O') setTimeout(function () { if (tt && !tt.over) aiMove(); }, 380);
  }
  ttDraw();
}
function ttDraw() {
  const cells = $('ttLocal').children;
  for (let i = 0; i < 9; i++) {
    cells[i].textContent = tt.b[i] || '';
    cells[i].disabled = !!tt.b[i] || !!tt.over || (tt.vs !== 'two' && tt.turn === 'O');
    cells[i].classList.toggle('hit', !!(tt.line && tt.line.indexOf(i) >= 0));
  }
  let s;
  if (tt.over === 'draw') s = '平手';
  else if (tt.over) s = tt.vs === 'two' ? tt.over + ' 獲勝' : tt.over === 'X' ? '你贏了' : '電腦贏了';
  else s = tt.vs === 'two' ? '輪到 ' + tt.turn : tt.turn === 'X' ? '輪到你（X）' : '電腦想一下…';
  $('ttLocalSub').textContent = s;
  $('ttAgain').classList.toggle('hide', !tt.over);
  Array.prototype.forEach.call($('ttMode').children, function (b) { b.classList.toggle('on', b.dataset.vs === tt.vs); });
  if (!tt.over) $('ttLocalMsg').textContent = '';
}

/* ---------------- 分類回收 ---------------- */
// 圖示：墨線 SVG
const ITEM_SVG = {
  bottle: '<path d="M10 2h4v3l2 3v13H8V8l2-3z"/><path d="M8 12h8"/>',
  can: '<rect x="7" y="4" width="10" height="17" rx="2"/><path d="M7 7h10M7 18h10"/>',
  paper: '<path d="M4 5h13v15H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v10a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h5"/>',
  box: '<path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/>',
  battery: '<rect x="6" y="5" width="12" height="16" rx="1.5"/><path d="M10 3h4v2h-4zM12 9v6M9 12h6"/>',
  nail: '<path d="M6 4h12M12 4v14l-2 3M12 18l2 3"/>',
  bag: '<path d="M6 8h12l-1 13H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  bulb: '<path d="M9 17h6M10 21h4M8 13a5 5 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4z"/>',
  cup: '<path d="M6 6h12l-2 15H8z"/><path d="M5 6h14"/>',
  pan: '<circle cx="10" cy="13" r="6"/><path d="M15 9l6-5"/>'
};
const ITEMS = [
  ['寶特瓶', 'plastic', 'bottle'], ['塑膠袋', 'plastic', 'bag'], ['塑膠杯', 'plastic', 'cup'],
  ['鋁罐', 'metal', 'can'], ['鐵釘', 'metal', 'nail'], ['舊鐵鍋', 'metal', 'pan'],
  ['報紙', 'paper', 'paper'], ['紙箱', 'paper', 'box'],
  ['電池', 'haz', 'battery'], ['燈管', 'haz', 'bulb']
];
const BINS = { paper: '紙類', plastic: '塑膠', metal: '金屬', haz: '有害' };
let sg = null;   // { t, score, combo, item, end, timer }
function svg(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ITEM_SVG[k] + '</svg>'; }
function sortNext() {
  let it; do { it = ITEMS[Math.floor(Math.random() * ITEMS.length)]; } while (sg.item && it === sg.item && ITEMS.length > 1);
  sg.item = it;
  const c = $('sortItem'); c.innerHTML = svg(it[2]) + '<b></b>'; c.querySelector('b').textContent = it[0];
  c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
}
function sortStart() {
  sg = { score: 0, combo: 0, item: null, end: performance.now() + 30000 };
  $('sortStartBox').classList.add('hide'); $('sortPlay').classList.remove('hide'); $('sortMsg').textContent = '';
  sortNext(); sortTick();
}
function sortTick() {
  if (!sg) return;
  const left = Math.max(0, sg.end - performance.now());
  $('sortTime').style.width = (left / 300) + '%';
  $('sortTimeTxt').textContent = Math.ceil(left / 1000) + ' 秒';
  $('sortScore').textContent = sg.score;
  if (left <= 0) { sortOver(); return; }
  requestAnimationFrame(sortTick);
}
function sortPick(bin) {
  if (!sg || !sg.item) return;
  const ok = sg.item[1] === bin, card = $('sortItem');
  if (ok) {
    sg.combo++; sg.score += sg.combo >= 5 ? 2 : 1;
    tone(700 + Math.min(sg.combo, 8) * 40, 0.05, 'square', 0.05);
    $('sortCombo').textContent = sg.combo >= 5 ? '連續 ' + sg.combo + '，每個 2 分' : sg.combo >= 2 ? '連續 ' + sg.combo : '';
    sortNext();
  } else {
    sg.combo = 0; sg.end -= 2000; $('sortCombo').textContent = '分錯了：' + sg.item[0] + '是' + BINS[sg.item[1]] + '（-2 秒）';
    tone(180, 0.15, 'sawtooth', 0.06);
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    sortNext();
  }
}
function sortOver() {
  const s = sg.score; sg = null;
  $('sortPlay').classList.add('hide'); $('sortStartBox').classList.remove('hide');
  let best = 0; try { best = parseInt(localStorage.getItem('rr_sortBest') || '0', 10) || 0; } catch (e) {}
  const nb = s > best; if (nb) { best = s; try { localStorage.setItem('rr_sortBest', String(s)); } catch (e) {} }
  $('sortBest').textContent = best;
  $('sortMsg').textContent = '這回合 ' + s + ' 分' + (nb ? '，新紀錄' : '');
  const coins = Math.min(10, Math.floor(s / 3));
  if (coins > 0) RR.UI.miniReward(coins, '分類回收 ' + s + ' 分', $('sortMsg'), true);
  tone(nb ? 880 : 520, 0.2, 'triangle', 0.12, nb ? 1320 : 600);
}
function sortStop() { sg = null; $('sortPlay').classList.add('hide'); $('sortStartBox').classList.remove('hide'); }

/* ---------------- 頁面切換 ---------------- */
function showBox(id) {
  ['miniList', 'miniTTBox', 'miniLocalTT', 'miniSort'].forEach(function (k) { $(k).classList.toggle('hide', k !== id); });
  if (id !== 'miniSort') sortStop();
}
function init() {
  const g = $('ttLocal');
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', '第 ' + (i + 1) + ' 格');
    b.addEventListener('click', function () { if (tt && (tt.vs === 'two' || tt.turn === 'X')) place(i); });
    g.appendChild(b);
  }
  Array.prototype.forEach.call($('ttMode').children, function (b) {
    b.addEventListener('click', function () { tt = tt || {}; tt.vs = b.dataset.vs; tt.youStart = false; ttNew(true); });
  });
  $('ttAgain').addEventListener('click', function () { ttNew(true); });
  $('miniLocalTTBtn').addEventListener('click', function () { showBox('miniLocalTT'); if (!tt) ttNew(); else ttDraw(); });
  $('miniSortBtn').addEventListener('click', function () {
    showBox('miniSort');
    let best = 0; try { best = parseInt(localStorage.getItem('rr_sortBest') || '0', 10) || 0; } catch (e) {}
    $('sortBest').textContent = best;
  });
  $('sortGo').addEventListener('click', sortStart);
  Array.prototype.forEach.call($('sortBins').children, function (b) { b.addEventListener('click', function () { sortPick(b.dataset.bin); }); });
  document.addEventListener('keydown', function (e) {
    if (!sg || $('scrMini').classList.contains('hide')) return;
    const k = { Digit1: 'paper', Digit2: 'plastic', Digit3: 'metal', Digit4: 'haz' }[e.code];
    if (k) { e.preventDefault(); sortPick(k); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.miniHome'), function (b) { b.addEventListener('click', function () { showBox('miniList'); }); });
}
RR.Mini = { init: init, showBox: showBox, stop: sortStop };
})();
