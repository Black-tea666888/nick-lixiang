/* 流程：登入 → 選單 → 大廳 → 遊戲 → 結算；以及房主迴圈、訊息分派、聊天 */
(function () {
'use strict';
const RR = window.RR, W = RR.World, Net = RR.Net, Voice = RR.Voice, Sfx = RR.Sfx, Auth = RR.Auth, Game = RR.Game;
const $ = function (id) { return document.getElementById(id); };
const CSSCOL = ['#ffb84a', '#6ecbff', '#c79bff', '#ff7eb6'];
const SCREENS = ['scrLogin', 'scrMenu', 'scrPick', 'scrWheel', 'scrLobby', 'scrResult', 'scrMap', 'scrShop', 'scrClan'];
// 角色資料：技能名、技能說明、屬性
const CINFO = [
  ['鼓舞', '6 公尺內隊友移動加速 5 秒', '均衡型'],
  ['護盾', '4 秒內不會被怪物抓到', '攻擊力高（一下 65）'],
  ['月光波', '7 公尺內怪物暫停 3 秒', '移動速度 +5%'],
  ['潛行', '6 秒內怪物較難發現你', '移動速度 +10%'],
  ['加血', '回復 35 點生命', '揮擊速度較快'],
  ['隱身', '4 秒內怪物看不到你', '平常就較不容易被怪物發現'],
  ['咆哮', '6 公尺內怪物嚇呆 2.5 秒', '移動速度 −3%'],
  ['瞬移', '往前瞬間移動 6 公尺', '體力回復 +15%']
];

const S = { mode: null, pvp: true, map: 0, sim: null, myId: null, hostId: null, roster: [], timers: [], lastHost: 0, seen: {}, tickN: 0, lastTick: 0, chatRate: {}, flags: {} };

function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
let showMapName = function () {};
function show(id) { SCREENS.forEach(function (s) { $(s).classList.toggle('hide', s !== id); }); }
function say(text) { $('msgText').textContent = text; $('msg').classList.remove('hide'); }
function busy(on, text) { $('busyText').textContent = text || '請稍候…'; $('busy').classList.toggle('hide', !on); if (!on) $('busyCancel').classList.add('hide'); }
// 配對伺服器（Render 免費方案閒置 15 分鐘會休眠，喚醒要 30～60 秒）：開遊戲就先叫醒，連線失敗時自動重試並判斷原因
function peerBase() { const k = RR.CONFIG && RR.CONFIG.peer; if (!k || !k.host) return null; return (k.secure === false ? 'http://' : 'https://') + k.host + (k.port && k.port !== 443 && k.port !== 80 ? ':' + k.port : ''); }
function serverCheck(cb) {
  const b = peerBase(); if (!b || !window.fetch) { cb('unknown'); return; }
  let done = false; const t = setTimeout(function () { if (!done) { done = true; cb('down'); } }, 8000);
  fetch(b + '/relay-health', { cache: 'no-store' }).then(function (r) {
    if (done) return; done = true; clearTimeout(t);
    if (r.status === 404) { cb('old'); return; }
    return r.json().then(function (j) { cb(j && j.ok ? 'ok' : 'old'); }, function () { cb('old'); });
  }, function () { if (!done) { done = true; clearTimeout(t); cb('down'); } });
}
function wakeServer() { serverCheck(function () {}); }
const NO_RETRY = { 'peer-unavailable': 1, 'full': 1, 'browser-incompatible': 1 };
let netCancel = false;
function connectRetry(label, attempt, ok) {
  const t0 = Date.now(); netCancel = false;
  const go = function () {
    attempt(function (err, a, b) {
      if (netCancel) return;
      if (!err) { busy(false); ok(a, b); return; }
      const waited = Math.round((Date.now() - t0) / 1000);
      if (NO_RETRY[err.type] || waited > 75) {
        serverCheck(function (st) {
          busy(false);
          if (NO_RETRY[err.type]) say(netErr(err));
          else if (st === 'old') say('配對伺服器是舊版本，沒有「中繼」功能，所以手機之間常常連不上。請到 Render 後台的 nick-lixiang 服務按「Manual Deploy → Deploy latest commit」（分支 main），等 2～3 分鐘再試。');
          else if (st === 'down') say('配對伺服器一直沒有回應（' + waited + ' 秒）。可能還在喚醒或暫時故障，請稍後再試；也可以先玩單人。');
          else say(netErr(err));
        });
        return;
      }
      $('busyCancel').classList.remove('hide');
      busy(true, label + ' 伺服器喚醒中…已等 ' + waited + ' 秒（免費伺服器閒置會休眠，最多約 1 分鐘）');
      $('busyCancel').classList.remove('hide');
      setTimeout(function () { if (!netCancel) go(); }, 2500);
    });
  };
  busy(true, label); go();
}
function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 12) || '玩家'; }
function myName() { const u = Auth.user(); return cleanName(u ? u.name : '玩家'); }
/* ---------- 配件與寶石 ---------- */
const ACC_COST = [0, 80, 120, 100, 150, 100, 200];
function myEquip(p) {
  let a = []; try { a = JSON.parse(ls('rr_eq') || '[]'); } catch (e) {}
  return (Array.isArray(a) ? a : []).filter(function (v, i, arr) { return p.acc.indexOf(v) >= 0 && arr.indexOf(v) === i; }).slice(0, 2);
}
function pushEquip(eq) {
  lsSet('rr_eq', JSON.stringify(eq));
  if (!S.mode || !S.sim && S.mode !== 'client') return;
  if (S.mode === 'client') Net.send({ t: 'eq', eq: eq, gems: prog().gems });
  else { const me = S.sim.player(S.myId); S.sim.setEquip(S.myId, eq); if (me) me.gems = prog().gems.slice(); hostBroadcast(rosterAny()); }
}
function renderGear() {
  const p = prog(), eq = myEquip(p);
  $('coinTag4').textContent = p.coins; $('eqCount').textContent = eq.length;
  const mk = function (cls, title, note, tag, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'grow' + cls;
    const t = document.createElement('span'); t.className = 'htxt'; const tb = document.createElement('b'); tb.textContent = title; const ts = document.createElement('small'); ts.textContent = note;
    t.appendChild(tb); t.appendChild(ts); const e = document.createElement('em'); e.textContent = tag; b.appendChild(t); b.appendChild(e); b.addEventListener('click', fn); return b;
  };
  const al = $('accList'); al.textContent = '';
  for (let i = 1; i < W.ACCS.length; i++) (function (i) {
    const own = p.acc.indexOf(i) >= 0, on = eq.indexOf(i) >= 0;
    al.appendChild(mk(on ? ' on' : '', W.ACCS[i], W.ACC_NOTE[i], on ? '已裝備' : own ? '裝備' : ACC_COST[i] + ' 金幣', function () {
      const q = prog(); let e2 = myEquip(q);
      if (q.acc.indexOf(i) < 0) {
        if (q.coins < ACC_COST[i]) { say('金幣不夠：「' + W.ACCS[i] + '」要 ' + ACC_COST[i] + ' 金幣，你有 ' + q.coins + '。'); return; }
        q.coins -= ACC_COST[i]; q.acc.push(i); progSave(q);
        if (e2.length < 2) { e2.push(i); pushEquip(e2); }
      } else if (e2.indexOf(i) >= 0) { e2 = e2.filter(function (v) { return v !== i; }); pushEquip(e2); }
      else { if (e2.length >= 2) e2.shift(); e2.push(i); pushEquip(e2); }
      renderGear(); renderProg();
    }));
  })(i);
  const gl = $('gemList'); gl.textContent = '';
  W.GEMS.forEach(function (g, i) {
    const lv = p.gems[i], cost = 40 * (lv + 1);
    gl.appendChild(mk(lv ? ' on' : '', g + '　Lv.' + lv, W.GEM_NOTE[i], lv >= 5 ? '已滿級' : '升級 ' + cost, function () {
      const q = prog(); if (q.gems[i] >= 5) return;
      const c = 40 * (q.gems[i] + 1);
      if (q.coins < c) { say('金幣不夠：升級要 ' + c + ' 金幣，你有 ' + q.coins + '。'); return; }
      q.coins -= c; q.gems[i]++; progSave(q); pushEquip(myEquip(q)); renderGear(); renderProg();
    }));
  });
}
function myLook() {
  const p = prog(), n = function (k) { return parseInt(ls(k) || '0', 10) || 0; }, own = function (cat, v) { return p.own[cat].indexOf(v) >= 0 ? v : 0; };
  const h = n('rr_h');
  return { c: n('rr_c'), w: n('rr_w'), h: p.hats.indexOf(h) >= 0 ? h : 0, o: own('o', n('rr_o')), pet: own('pet', n('rr_pet')), gun: Math.min(W.GUNS.length - 1, n('rr_gun')), eq: myEquip(p), gems: p.gems };
}
// 只影響自己畫面的造型：回收品、怪物、彈道
function applyLocalSkins() {
  const p = prog(), n = function (k) { return parseInt(ls(k) || '0', 10) || 0; }, own = function (cat, v) { return p.own[cat].indexOf(v) >= 0 ? v : 0; };
  Game.settings.itemSkin = own('is', n('rr_is')); Game.settings.fx = own('fx', n('rr_fx')); Game.setGunSkin(own('gs', n('rr_gs')));
  const ms = own('ms', n('rr_ms')); if ((Game.settings.monSkin | 0) !== ms) Game.setMonSkin(ms);
}
const SKIN_NAMES = { is: ['預設', '糖果', '寶石'], ms: ['預設', '骸骨白', '霓虹'], fx: ['金黃', '冰藍', '粉紅', '紫光'], gs: ['原廠', '沙漠迷彩', '叢林迷彩', '黃金', '黑金', '霓虹粉', '寒冰'] };
const PET_NOTE = ['', '速度 +5%', '偵測 +8m', '賣出 +10%', '體力 +20%'];
function catNames(cat) { return cat === 'o' ? W.COSTUMES : cat === 'pet' ? W.PETS : cat === 'hat' ? W.HATS : SKIN_NAMES[cat]; }
const CAT_LABEL = { o: '服裝', pet: '寵物', hat: '頭飾', is: '回收品造型', ms: '怪物造型', fx: '彈道特效', gs: '槍枝造型' };
function owns(p, cat, i) { return cat === 'hat' ? p.hats.indexOf(i) >= 0 : p.own[cat].indexOf(i) >= 0; }
/* ---------- 回收抽獎機 ---------- */
const WHEELS = [
  { n: '綜合', cost: 50, seg: [['o'], ['pet'], ['hat'], ['is'], ['coin', 30], ['ms'], ['fx'], ['gs']] },
  { n: '服裝', cost: 80, seg: [['o', 1], ['o', 2], ['o', 3], ['o', 4], ['o', 5], ['coin', 30], ['coin', 60], ['coin', 100]] },
  { n: '寵物', cost: 80, seg: [['pet', 1], ['coin', 20], ['pet', 2], ['coin', 40], ['pet', 3], ['coin', 60], ['pet', 4], ['coin', 100]] },
  { n: '造型特效', cost: 60, seg: [['is', 1], ['is', 2], ['ms', 1], ['ms', 2], ['fx', 1], ['fx', 2], ['fx', 3], ['coin', 50]] },
  { n: '槍枝造型', cost: 60, seg: [['gs', 1], ['gs', 2], ['gs', 3], ['gs', 4], ['gs', 5], ['gs', 6], ['coin', 30], ['coin', 60]] }
];
let wheelI = 0, wheelBusy = false;
const M_NAME = ['綜合機', '服裝機', '寵物機', '特效機', '槍械機'];
// 吊牌上的手繪圖示（墨線 SVG，不用 emoji）
const ICON = {
  o: '<path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c-1 2-2 3-4 3S9 5 8 3z"/>',
  pet: '<ellipse cx="12" cy="16" rx="4.5" ry="3.8"/><circle cx="6" cy="10" r="1.8"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/>',
  hat: '<path d="M5 15c0-5 3-8 7-8s7 3 7 8z"/><path d="M2 15h17l3 2H2z"/>',
  is: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  ms: '<path d="M5 11a7 7 0 1 1 14 0v3l-2 1v3H7v-3l-2-1z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10 18v-2M14 18v-2"/>',
  fx: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4"/>',
  coin: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>',
  gs: '<path d="M3 9h15l2-2h1v4h-6l-1 2h-3l-1 5H6l1-5H3z"/><path d="M10 13l-1 2"/>'
};
function iconSvg(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[k] || ICON.coin) + '</svg>'; }
function segLabel(sg) { return sg[0] === 'coin' ? '金幣 +' + sg[1] : sg.length > 1 ? catNames(sg[0])[sg[1]] : CAT_LABEL[sg[0]]; }
function segKind(sg) { return sg[0] === 'coin' ? '金幣' : sg.length > 1 ? CAT_LABEL[sg[0]] : '隨機'; }
function poolStatus(p, sg) {
  if (sg[0] === 'coin') return '';
  const names = catNames(sg[0]);
  if (sg.length > 1) return owns(p, sg[0], sg[1]) ? '已擁有' : '';
  let n = 0; for (let k = 1; k < names.length; k++) if (owns(p, sg[0], k)) n++;
  return '已收集 ' + n + ' / ' + (names.length - 1);
}
// 抽獎機：8 個獎品排成一圈（九宮格，中間是說明），亮框繞圈後停在中獎格；點任何一格就在預覽區看大圖
const RING = [0, 1, 2, 5, 8, 7, 6, 3];   // 九宮格位置，順時針
let dwSel = 0, dwWin = -1, dwOn = -1;
function segTier(sg) { return sg[0] === 'coin' ? 'coin' : sg.length === 1 ? 'rand' : sg[0] === 'gs' ? 'gun' : 'item'; }
function segDesc(sg, p) {
  if (sg[0] === 'coin') return '直接得到 ' + sg[1] + ' 金幣。';
  if (sg.length === 1) return '從「' + CAT_LABEL[sg[0]] + '」裡隨機一件你還沒有的（全部有了就換 25 金幣）。' + poolStatus(p, sg) + '。';
  const own = owns(p, sg[0], sg[1]);
  const extra = sg[0] === 'pet' ? '寵物加成：' + PET_NOTE[sg[1]] + '。' : sg[0] === 'gs' ? '換上後，所有槍都用這個配色。' : sg[0] === 'o' ? '角色的服裝。' : sg[0] === 'fx' ? '開槍彈道的顏色。' : sg[0] === 'is' ? '地圖上回收品的樣子。' : sg[0] === 'ms' ? '怪物的樣子（只有你看得到）。' : '';
  return extra + (own ? '你已經有了，抽到會換成 25 金幣。' : '你還沒有。');
}
function dwPreview(i) {
  const wh = WHEELS[wheelI], sg = wh.seg[i], p = prog(), look = myLook(); dwSel = i;
  Array.prototype.forEach.call($('dwGrid').querySelectorAll('.dwCell'), function (c) { c.classList.toggle('sel', +c.dataset.i === i); });
  $('dwKind').textContent = sg[0] === 'coin' ? '金幣' : sg.length === 1 ? '隨機' + CAT_LABEL[sg[0]] : CAT_LABEL[sg[0]];
  $('dwName').textContent = segLabel(sg); $('dwDesc').textContent = segDesc(sg, p);
  const cv = $('dwCanvas'), ic = $('dwIcon'); let three = false;
  if (sg.length > 1 && sg[0] === 'gs') { Game.gunPreview(cv, look.gun, sg[1]); three = true; }
  else if (sg.length > 1 && (sg[0] === 'o' || sg[0] === 'pet' || sg[0] === 'hat')) { Game.preview(cv, look.c, look.w, sg[0] === 'hat' ? sg[1] : look.h, sg[0] === 'o' ? sg[1] : look.o, sg[0] === 'pet' ? sg[1] : look.pet, true); three = true; }
  cv.classList.toggle('hide', !three); ic.classList.toggle('hide', three); ic.innerHTML = three ? '' : iconSvg(sg[0]);
}
function wheelDraw() {
  const wh = WHEELS[wheelI], p = prog();
  const free = wheelI === 0 && p.freeDay !== today();
  $('wheelSpin').querySelector('b').textContent = free ? '免費抽' : '抽一次';
  $('mCost').textContent = free ? '今天免費一次' : wh.cost + ' 金幣';
  $('coinTag3').textContent = p.coins;
  $('mName').textContent = M_NAME[wheelI];
  Array.prototype.forEach.call($('wheelSel').children, function (b, k) { b.classList.toggle('on', k === wheelI); b.setAttribute('aria-selected', k === wheelI); });
  const g = $('dwGrid'); g.textContent = '';
  for (let pos = 0; pos < 9; pos++) {
    const ri = RING.indexOf(pos);
    if (ri < 0) {   // 中間：說明
      const c = document.createElement('div'); c.className = 'dwMid';
      c.innerHTML = '<b></b><span></span>'; c.querySelector('b').textContent = M_NAME[wheelI]; c.querySelector('span').textContent = '每格 12.5%，點獎品看預覽';
      g.appendChild(c); continue;
    }
    const sg = wh.seg[ri], own = sg.length > 1 && sg[0] !== 'coin' && owns(p, sg[0], sg[1]);
    const c = document.createElement('button'); c.type = 'button'; c.className = 'dwCell t-' + segTier(sg) + (own ? ' own' : '') + (ri === dwWin ? ' won' : ''); c.dataset.i = ri;
    c.innerHTML = iconSvg(sg[0]) + '<b></b><small></small>';
    c.querySelector('b').textContent = segLabel(sg); c.querySelector('small').textContent = own ? '已擁有' : sg.length === 1 && sg[0] !== 'coin' ? poolStatus(p, sg) : segKind(sg);
    c.addEventListener('click', function () { if (!wheelBusy) dwPreview(ri); });
    g.appendChild(c);
  }
  dwPreview(Math.min(dwSel, wh.seg.length - 1));
}
function wheelSpin() {
  if (wheelBusy) return;
  const wh = WHEELS[wheelI], p = prog(), free = wheelI === 0 && p.freeDay !== today();
  if (!free && p.coins < wh.cost) { say('金幣不夠：這台一次要 ' + wh.cost + ' 金幣，你有 ' + p.coins + '。過關、每日任務和小遊戲可以賺金幣。'); return; }
  if (free) p.freeDay = today(); else p.coins -= wh.cost;
  const idx = Math.floor(Math.random() * wh.seg.length), sg = wh.seg[idx];
  let msg, fresh = false, shown = sg;
  if (sg[0] === 'coin') { p.coins += sg[1]; msg = '金幣 +' + sg[1]; }
  else {
    const cat = sg[0], names = catNames(cat);
    let pickI = sg[1];
    if (pickI == null) { const pool = []; for (let k = 1; k < names.length; k++) if (!owns(p, cat, k)) pool.push(k); pickI = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 1 + Math.floor(Math.random() * (names.length - 1)); }
    shown = [cat, pickI];
    if (owns(p, cat, pickI)) { p.coins += 25; msg = '「' + names[pickI] + '」已經有了，換成金幣 +25'; }
    else { if (cat === 'hat') p.hats.push(pickI); else p.own[cat].push(pickI); fresh = true; msg = '抽到' + CAT_LABEL[cat] + '「' + names[pickI] + '」'; }
  }
  progSave(p); $('coinTag3').textContent = p.coins;
  wheelBusy = true; dwWin = -1; $('wheelSpin').disabled = true; $('wheelWear').classList.add('hide');
  const cells = function () { return $('dwGrid').querySelectorAll('.dwCell'); };
  Array.prototype.forEach.call(cells(), function (c) { c.classList.remove('won', 'sel'); });
  const finish = function () {
    wheelBusy = false; dwWin = idx; $('wheelSpin').disabled = false;
    wheelDrawKeep(); dwPreview(idx);
    if (sg.length === 1 && sg[0] !== 'coin') { $('dwName').textContent = segLabel(shown); }   // 隨機格：顯示實際抽到哪一件
    const won = $('dwGrid').querySelector('.dwCell[data-i="' + idx + '"]');
    if (won && fresh) { const st = document.createElement('i'); st.className = 'stamp'; st.textContent = '新到手'; won.appendChild(st); }
    toastMsg(msg, fresh);
    $('wheelWear').classList.toggle('hide', !fresh || shown[0] === 'coin');
    if (fresh) { Sfx.tone(660, 0.12, 'triangle', 0.14, 880); setTimeout(function () { Sfx.tone(990, 0.22, 'triangle', 0.14, 1320); }, 120); }
    else Sfx.tone(520, 0.15, 'triangle', 0.1, 600);
    renderProg(); if (window.RR_refreshWardrobe) window.RR_refreshWardrobe();
  };
  if ($('dwSkip').checked) { finish(); return; }
  // 亮框繞圈：先快後慢，繞 3 圈再停在中獎格
  const order = RING.map(function (pos, ri) { return ri; });
  const total = order.length * 3 + idx; let step = 0;
  const tick = function () {
    const ri = step % order.length;
    Array.prototype.forEach.call(cells(), function (c) { c.classList.toggle('hl', +c.dataset.i === ri); });
    Sfx.tone(1200 + (step % 2) * 200, 0.025, 'square', 0.03);
    if (step >= total) { setTimeout(function () { Array.prototype.forEach.call(cells(), function (c) { c.classList.remove('hl'); }); finish(); }, 260); return; }
    step++;
    const k = step / total; setTimeout(tick, 45 + Math.pow(k, 3) * 330);
  };
  tick();
}
function toastMsg(m, good) { const el = $('dwDesc'); el.textContent = m + '。'; el.classList.toggle('good', !!good); setTimeout(function () { el.classList.remove('good'); }, 2500); }
function wheelDrawKeep() { const b = wheelBusy; wheelBusy = true; wheelDraw(); wheelBusy = b; }
function mtoast(msg, kind) { const el = $('mtoast'); el.textContent = msg; el.className = 'k-' + (kind || 'info'); void el.offsetWidth; el.classList.add('show'); clearTimeout(mtoast.t); mtoast.t = setTimeout(function () { el.classList.remove('show'); }, Math.min(4200, 1800 + msg.length * 70)); }
/* ---------- 市集：免費補給、每日精選直購 ---------- */
const SHOP_PRICE = { o: 300, pet: 350, gs: 250, fx: 180, is: 150, ms: 150 };
const SUPPLY_MS = 4 * 3600e3;
const FREE = [
  { id: 'gift', n: '每日禮物', give: ['coin', 30], note: '每天一次' },
  { id: 'box', n: '補給箱', give: ['coin', 15], note: '每 4 小時' },
  { id: 'xp', n: '訓練手冊', give: ['xp', 40], note: '每天一次' }
];
function seedRand(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return function () { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/** 今天的 6 件精選：第一次打開時決定並存起來（優先挑還沒有的），當天不再變 */
function shopToday(p) {
  if (p.shop && p.shop.d === today() && Array.isArray(p.shop.it)) return p.shop;
  const rnd = seedRand(today() + (RR.Cloud && RR.Cloud.uid() || '')), pool = [];
  Object.keys(SHOP_PRICE).forEach(function (cat) { const names = catNames(cat); for (let i = 1; i < names.length; i++) pool.push([cat, i]); });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  const fresh = pool.filter(function (x) { return !owns(p, x[0], x[1]); }), had = pool.filter(function (x) { return owns(p, x[0], x[1]); });
  p.shop = { d: today(), it: fresh.concat(had).slice(0, 6), b: [] };
  return p.shop;
}
function freeLeft(p, f) {
  const fr = p.free || {};
  if (f.id === 'box') return Math.max(0, (fr.box || 0) + SUPPLY_MS - Date.now());
  return fr[f.id] === today() ? msToMidnight() : 0;
}
function msToMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d - Date.now(); }
function hm(ms) { const m = Math.ceil(ms / 60000), h = Math.floor(m / 60); return h ? h + ' 小時 ' + (m % 60) + ' 分' : m + ' 分'; }
function shopCard(cls, icon, title, kind, foot, onClick) {
  const c = mk('button', 'spCard ' + cls); c.type = 'button';
  c.innerHTML = iconSvg(icon); c.appendChild(mk('b', null, title)); c.appendChild(mk('span', 'spKindT', kind)); c.appendChild(mk('span', 'spFoot', foot));
  c.addEventListener('click', onClick); return c;
}
function shopDraw() {
  const p = prog(), sh = shopToday(p); progSave(p);
  $('coinTag4').textContent = p.coins;
  $('spTimer').textContent = '刷新倒數 ' + hm(msToMidnight());
  const fg = $('spFree'); fg.textContent = '';
  FREE.forEach(function (f) {
    const left = freeLeft(p, f), lbl = f.give[0] === 'coin' ? '金幣 +' + f.give[1] : '經驗 +' + f.give[1];
    fg.appendChild(shopCard(left ? 'done' : 'free', f.give[0] === 'coin' ? 'coin' : 'is', f.n, lbl, left ? '再 ' + hm(left) : '免費領取', function () {
      const q = prog(); if (freeLeft(q, f)) { mtoast('還要等 ' + hm(freeLeft(q, f))); return; }
      q.free = q.free || {}; q.free[f.id] = f.id === 'box' ? Date.now() : today();
      if (f.give[0] === 'coin') q.coins += f.give[1]; else q.xp += f.give[1];
      progSave(q); renderProg(); shopDraw(); mtoast('已領取 ' + lbl, 'good'); Sfx.tone(880, 0.1, 'triangle', 0.12, 1180);
    }));
  });
  const dg = $('spDaily'); dg.textContent = '';
  sh.it.forEach(function (x, k) {
    const own = owns(p, x[0], x[1]), bought = sh.b.indexOf(k) >= 0, price = SHOP_PRICE[x[0]];
    dg.appendChild(shopCard('t-' + (x[0] === 'gs' ? 'gun' : 'item') + (own ? ' done' : ''), x[0], catNames(x[0])[x[1]], CAT_LABEL[x[0]], bought ? '已購買' : own ? '已擁有' : price + ' 金幣', function () { shopAsk(k); }));
  });
  $('shopSub').textContent = FREE.some(function (f) { return !freeLeft(p, f); }) ? '有免費補給可領' : '每日精選、免費補給';
}
let spK = -1;
function shopAsk(k) {
  const p = prog(), x = shopToday(p).it[k], own = owns(p, x[0], x[1]), price = SHOP_PRICE[x[0]], look = myLook();
  spK = k;
  $('spKind').textContent = CAT_LABEL[x[0]]; $('spName').textContent = catNames(x[0])[x[1]];
  $('spDesc').textContent = own ? '你已經有了。' : segDesc([x[0], x[1]], p).replace('你還沒有。', '') + '價格 ' + price + ' 金幣，你有 ' + p.coins + '。';
  $('spOk').classList.toggle('hide', own); $('spOk').textContent = '用 ' + price + ' 金幣買';
  const cv = $('spCanvas'), ic = $('spIcon'); let three = false;
  if (x[0] === 'gs') { Game.gunPreview(cv, look.gun, x[1]); three = true; }
  else if (x[0] === 'o' || x[0] === 'pet') { Game.preview(cv, look.c, look.w, look.h, x[0] === 'o' ? x[1] : look.o, x[0] === 'pet' ? x[1] : look.pet, true); three = true; }
  cv.classList.toggle('hide', !three); ic.classList.toggle('hide', three); ic.innerHTML = three ? '' : iconSvg(x[0]);
  $('spModal').classList.remove('hide');
}
function shopBuy() {
  const p = prog(), sh = shopToday(p), x = sh.it[spK]; if (!x) return;
  const price = SHOP_PRICE[x[0]], name = catNames(x[0])[x[1]];
  if (owns(p, x[0], x[1])) { $('spModal').classList.add('hide'); return; }
  if (p.coins < price) { mtoast('金幣不夠：要 ' + price + '，你有 ' + p.coins, 'warn'); return; }
  p.coins -= price; p.own[x[0]].push(x[1]); sh.b.push(spK); progSave(p);
  $('spModal').classList.add('hide'); renderProg(); shopDraw(); if (window.RR_refreshWardrobe) window.RR_refreshWardrobe();
  mtoast('買到' + CAT_LABEL[x[0]] + '「' + name + '」，到出戰角色換上', 'good'); Sfx.tone(660, 0.12, 'triangle', 0.14, 990);
}
/* ---------- 戰隊聊天 ---------- */
const ASK_CD = 7 * 3600e3;
let ccOff = null, ccRows = [], ccLast = 0, ccTimer = null;
function ccNote(text, btn) {
  const log = $('ccLog'); log.textContent = ''; log.appendChild(mk('p', 'ccEmpty', text));
  if (btn) { const b = mk('button', 'btn primary', btn); b.type = 'button'; b.addEventListener('click', function () { clanClose(); socTab = 'clan'; $('scrSocial').classList.remove('hide'); renderSocial(); }); log.appendChild(b); }
}
function clanOpen() {
  show('scrClan'); $('coinTag5').textContent = prog().coins; ccAskDraw();
  const C = RR.Cloud, me = C.me();
  $('ccName').textContent = me && me.clanName ? me.clanName : '戰隊聊天';
  if (!C.ready()) { ccNote('戰隊聊天要先用 Google 或訪客登入並連上網路。'); return; }
  if (!me || !me.clan) { ccNote('你還沒加入戰隊。', '去加入或建立戰隊'); return; }
  ccNote('讀取中…');
  if (ccOff) ccOff();
  ccOff = C.clanChat(function (err, rows) { if (err) { ccNote(C.message(err)); return; } ccRows = rows; ccDraw(); });
  clearInterval(ccTimer); ccTimer = setInterval(ccAskDraw, 30000);
}
function clanClose() { if (ccOff) ccOff(); ccOff = null; clearInterval(ccTimer); showMenu(); }
function ccAskDraw() {
  const left = (prog().askAt || 0) + ASK_CD - Date.now();
  $('ccAsk').disabled = left > 0; $('ccAskT').textContent = left > 0 ? hm(left) : '隊友捐給你';
}
function ccDraw() {
  const C = RR.Cloud, my = C.uid(), log = $('ccLog'), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.textContent = '';
  if (!ccRows.length) { log.appendChild(mk('p', 'ccEmpty', '還沒有人說話。打個招呼，或請求金幣。')); return; }
  ccRows.slice().reverse().forEach(function (m) {
    const mine = m.uid === my;
    if (m.k === 'say') { const r = mk('div', 'ccMsg' + (mine ? ' me' : '')); r.appendChild(mk('b', null, mine ? '你' : m.name)); r.appendChild(mk('span', null, m.text)); log.appendChild(r); return; }
    if (m.k !== 'req') return;
    const got = m.got | 0, need = m.need | 0, gave = (m.donors && m.donors[my]) | 0;
    const card = mk('div', 'ccReq' + (mine ? ' me' : ''));
    card.appendChild(mk('div', 'ccWho', (mine ? '你' : m.name) + ' 正在請求金幣'));
    const body = mk('div', 'ccBody'), bar = mk('div', 'ccMeter'), fill = mk('i');
    fill.style.width = Math.min(100, got / need * 100) + '%'; bar.appendChild(fill); bar.appendChild(mk('span', null, got + ' / ' + need)); body.appendChild(bar);
    let btn;
    if (mine) {
      const n = got - (m.claimed | 0);
      btn = mk('button', 'btn' + (n > 0 ? ' primary' : ''), n > 0 ? '領取 +' + n : got >= need ? '已領完' : '等隊友捐');
      btn.disabled = n <= 0;
      btn.addEventListener('click', function () { btn.disabled = true; C.clanClaim(m.id, function (err, k) { if (err) { mtoast(C.message(err), 'warn'); btn.disabled = false; return; } if (k > 0) { const q = prog(); q.coins += k; progSave(q); renderProg(); $('coinTag5').textContent = q.coins; mtoast('領到金幣 +' + k, 'good'); } }); });
    } else {
      const full = got >= need, max = gave >= C.GIVE_MAX;
      btn = mk('button', 'btn' + (full || max ? '' : ' primary'), full ? '已收滿' : max ? '已捐 ' + gave : '捐 ' + C.GIVE);
      btn.disabled = full || max;
      btn.addEventListener('click', function () {
        const q = prog(); if (q.coins < C.GIVE) { mtoast('金幣不夠捐', 'warn'); return; }
        btn.disabled = true;
        C.clanGive(m.id, function (err) {
          if (err) { mtoast(C.message(err), 'warn'); btn.disabled = false; return; }
          const q2 = prog(); q2.coins -= C.GIVE; q2.xp += 10; progSave(q2); renderProg(); $('coinTag5').textContent = q2.coins;
          mtoast('捐了 ' + C.GIVE + ' 金幣，經驗 +10', 'good');
        });
      });
    }
    body.appendChild(btn); card.appendChild(body); log.appendChild(card);
  });
  if (atEnd || !ccDraw.did) log.scrollTop = log.scrollHeight;
  ccDraw.did = true;
}
function ccSend() {
  const el = $('ccInput'), text = el.value.trim(); if (!text) return;
  if (Date.now() - ccLast < 1500) { mtoast('說慢一點'); return; }
  ccLast = Date.now(); el.value = '';
  RR.Cloud.clanSay(text, function (err) { if (err) mtoast(RR.Cloud.message(err), 'warn'); });
}
function ccAsk() {
  const p = prog(); if ((p.askAt || 0) + ASK_CD > Date.now()) return;
  $('ccAsk').disabled = true;
  RR.Cloud.clanAsk(function (err) {
    if (err) { mtoast(RR.Cloud.message(err), 'warn'); ccAskDraw(); return; }
    const q = prog(); q.askAt = Date.now(); progSave(q); ccAskDraw(); mtoast('已請求，隊友捐了就能領', 'good');
  });
}
/* ---------- 成長系統（存在這台裝置上）：金幣、經驗、每日任務、頭飾 ---------- */
const HAT_COST = [0, 60, 100, 150, 250, 400];
const MISSIONS = [['完成 1 天', 1, 30], ['團隊累計賺到 $800', 800, 40], ['拿到一次 3 顆星', 1, 50]];
function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function prog() {
  let p = null; try { p = JSON.parse(ls('rr_prog') || 'null'); } catch (e) {}
  if (!p || typeof p !== 'object') p = {};
  p.coins = Math.max(0, Math.floor(+p.coins || 0)); p.xp = Math.max(0, Math.floor(+p.xp || 0));
  if (!Array.isArray(p.hats)) p.hats = [0];
  if (!p.own || typeof p.own !== 'object') p.own = {};
  ['o', 'pet', 'is', 'ms', 'fx', 'gun', 'gs'].forEach(function (k) { if (!Array.isArray(p.own[k])) p.own[k] = [0]; });
  if (!Array.isArray(p.acc)) p.acc = [];
  if (!Array.isArray(p.gems) || p.gems.length !== 3) p.gems = [0, 0, 0];
  if (p.day !== today() || !Array.isArray(p.m)) { p.day = today(); p.m = [0, 0, 0]; p.done = [false, false, false]; }
  if (!Array.isArray(p.done)) p.done = [false, false, false];
  if (!p.st || typeof p.st !== 'object') p.st = {};
  ['games', 'wins', 'mk', 'brWins', 'coop', 'hunt', 'td'].forEach(function (k) { p.st[k] = Math.max(0, Math.floor(+p.st[k] || 0)); });
  if (!Array.isArray(p.ach)) p.ach = [];
  if (typeof p.region !== 'number') p.region = 0;   // 預設台灣，玩家可自行選擇
  p.region = Math.max(0, Math.min(1, p.region | 0));
  return p;
}
function progSave(p) { lsSet('rr_prog', JSON.stringify(p)); if (RR.Cloud) RR.Cloud.saveSoon(); }
function levelOf(xp) { return 1 + Math.floor(Math.sqrt(xp / 60)); }
function renderProg() {
  const p = prog(), lv = levelOf(p.xp), lo = 60 * (lv - 1) * (lv - 1), hi = 60 * lv * lv;
  $('lvTag').textContent = lv; $('coinTag').textContent = p.coins; $('coinTag2').textContent = p.coins;
  $('xpFill').style.width = Math.min(100, (p.xp - lo) / (hi - lo) * 100) + '%';
  const box = $('missions'); box.textContent = '';
  MISSIONS.forEach(function (m, i) {
    const row = document.createElement('div'); if (p.done[i]) row.className = 'ok';
    const t = document.createElement('span'); t.textContent = (p.done[i] ? '✓ ' : '') + m[0];
    const s = document.createElement('small'); s.textContent = p.done[i] ? '已領 +' + m[2] : Math.min(p.m[i], m[1]) + ' / ' + m[1] + '，金幣 +' + m[2];
    row.appendChild(t); row.appendChild(s); box.appendChild(row);
  });
  { const fm = $('fsMis'); if (fm) fm.textContent = p.done.filter(Boolean).length + ' / ' + MISSIONS.length + ' 完成'; }
}
// 一局結束時結算：回傳要顯示的文字
function progOnResult(e, stars) {
  const p = prog();
  const coins = e.win ? Math.floor(e.money / 10) + stars * 10 : Math.floor(e.money / 20), xp = coins + 10;
  p.coins += coins; p.xp += xp;
  if (e.win) p.m[0] += 1;
  p.m[1] += e.money; if (stars >= 3) p.m[2] += 1;
  let bonus = 0;
  MISSIONS.forEach(function (m, i) { if (!p.done[i] && p.m[i] >= m[1]) { p.done[i] = true; p.coins += m[2]; bonus += m[2]; } });
  progSave(p);
  return '金幣 +' + coins + '，經驗 +' + xp + (bonus ? '，每日任務完成 +' + bonus : '');
}
function myMap() { const m = parseInt(ls('rr_map') || '0', 10) || 0; return m >= 0 && m < W.MAPS.length ? m : 0; }
function rosterEntry(id) { for (let i = 0; i < S.roster.length; i++) if (S.roster[i].id === id) return S.roster[i]; return null; }

// 單機小遊戲的金幣：每天最多 60
function miniReward(n, why, el, add) {
  const p = prog(), d = today();
  if (p.miniDay !== d) { p.miniDay = d; p.miniGot = 0; }
  const give = Math.max(0, Math.min(n, 60 - (p.miniGot | 0)));
  const txt = give > 0 ? '金幣 +' + give : '今天小遊戲金幣已經拿滿（每天 60）';
  if (give > 0) { p.miniGot = (p.miniGot | 0) + give; p.coins += give; progSave(p); renderProg(); }
  if (el) el.textContent = add && el.textContent ? el.textContent + '，' + txt : txt;
}
RR.UI = { say: say, miniReward: miniReward };
// 槍的數值條：傷害（單發×顆數）、射速、射程、彈量，用最強的那把當 100%
function renderGunStats(i) {
  const box = $('gStats'); if (!box) return;
  const G = W.GUNS[i], all = W.GUNS;
  const v = function (g) { return [g.dmg * g.n, 1 / g.cd, g.range, g.clip[1]]; }, mx = [0, 0, 0, 0];
  all.forEach(function (g) { v(g).forEach(function (x, k) { mx[k] = Math.max(mx[k], x); }); });
  const vals = v(G), names = ['傷害', '射速', '射程', '彈量'];
  box.textContent = '';
  const title = document.createElement('p'); title.className = 'gNote';
  title.textContent = G.name + (G.n > 1 ? '：一次 ' + G.n + ' 顆，近距離很強' : G.auto ? '：按住連發' : G.range >= 70 ? '：一發入魂，射得最遠' : '：穩定好用') + '。回收模式每天 ' + G.clip[0] + ' 發，命中讓怪物暈 ' + G.stun + ' 秒。';
  box.appendChild(title);
  vals.forEach(function (x, k) {
    const row = document.createElement('div'); row.className = 'gRow';
    row.innerHTML = '<span></span><i><b></b></i>'; row.firstChild.textContent = names[k];
    row.querySelector('b').style.width = Math.max(6, Math.round(x / mx[k] * 100)) + '%'; box.appendChild(row);
  });
}

/* ---------- 聊天 ---------- */
function chatAdd(name, text, slot) {
  const log = $('chatLog'), line = document.createElement('div');
  if (name == null) { line.className = 'sys'; line.textContent = text; }
  else {
    const b = document.createElement('b'); b.textContent = name + '：'; b.style.color = CSSCOL[(slot || 0) % 4];
    line.appendChild(b); line.appendChild(document.createTextNode(text));
  }
  log.appendChild(line);
  while (log.children.length > 30) log.removeChild(log.firstChild);
  setTimeout(function () { line.classList.add('old'); }, 9000);
}
function chatOpen(on) {
  document.body.classList.toggle('chatting', !!on);
  if (on) { try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {} setTimeout(function () { $('chatInput').focus(); }, 30); }
  else $('chatInput').blur();
}
function chatSend() {
  const el = $('chatInput'), text = el.value.replace(/\s+/g, ' ').trim().slice(0, 80);
  el.value = '';
  if (document.body.classList.contains('playing')) chatOpen(false);
  if (!text || !S.mode) return;
  if (S.mode === 'client') Net.send({ t: 'chat', text: text });
  else hostChat(S.myId, text);
}
function hostChat(id, text) {
  if (!S.sim || !S.sim.player(id)) return;
  text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!text) return;
  const now = Date.now(), r = S.chatRate[id] || (S.chatRate[id] = []);
  while (r.length && now - r[0] > 4000) r.shift();
  if (r.length >= 5) return;            // 防洗頻：4 秒內最多 5 則
  r.push(now);
  hostBroadcast({ t: 'chat', id: id, text: text });
}

/* ---------- 訊息分派（所有模式共用） ---------- */
function dispatch(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'roster':
      S.roster = msg.players || []; S.hostId = msg.hostId; S.pvp = msg.pvp !== false; S.map = msg.map || 0; S.gmode = msg.mode || 'coop'; S.base = msg.base | 0;
      if (!document.body.classList.contains('playing')) Game.showMap(S.map);
      Game.setRoster(S.roster); renderLobby(msg.code); voiceSync();
      break;
    case 'day':
      show(null); Game.setActive(true); Game.onDay(msg); chatOpen(false);
      if (!ls('rr_tut')) tutShow(0);
      break;
    case 's':
      Game.onSnapshot(msg);
      for (let i = 0; i < msg.p.length; i++) S.flags[msg.p[i][0]] = msg.p[i][6];
      break;
    case 'ev':
      Game.onEvent(msg.e);
      if (msg.e.t === 'end') showResult(msg.e);
      break;
    case 'lobby':
      Game.setActive(false); showLobby();
      break;
    case 'chat': {
      const p = rosterEntry(msg.id);
      if (p) { chatAdd(p.name, String(msg.text).slice(0, 80), p.slot); if (msg.id !== S.myId) Sfx.tone(880, 0.05, 'sine', 0.05); }
      break;
    }
    case 'sys':
      chatAdd(null, String(msg.text).slice(0, 60));
      break;
    case 'no':
      leave();
      say(msg.why === 'full' ? '房間已滿（最多 4 人）。' : '這個房間正在遊戲中，請等他們回到大廳再加入。');
      break;
  }
}
function hostBroadcast(msg) { dispatch(msg); if (S.mode === 'host') Net.broadcast(msg); }
function voiceSync() {
  if (S.mode !== 'host' && S.mode !== 'client') return;
  Voice.sync(S.myId, S.roster.map(function (p) { return p.id; }).filter(function (id) { return id !== S.myId; }));
}

/* ---------- 房主端 ---------- */
function rosterMsg() { return { t: 'roster', code: Net.code(), hostId: S.myId, pvp: S.sim.pvp, map: S.sim.map, mode: S.sim.mode, base: S.base | 0, players: S.sim.roster() }; }
function flushEvents() { const evs = S.sim.events.splice(0); for (let i = 0; i < evs.length; i++) hostBroadcast({ t: 'ev', e: evs[i] }); }
function hostRemove(id) {
  const p = S.sim && S.sim.player(id);
  if (!p) return;
  S.sim.removePlayer(id); delete S.seen[id]; delete S.chatRate[id];
  hostBroadcast(rosterMsg()); hostBroadcast({ t: 'sys', text: p.name + ' 離開了' });
  flushEvents();
}
function hostTick() {
  const now = Date.now(), dt = Math.min(0.1, (now - S.lastTick) / 1000); S.lastTick = now;
  const sim = S.sim;
  sim.setInput(S.myId, Game.input());
  sim.step(dt);
  flushEvents();
  S.tickN++;
  if (sim.phase === 'play' ? S.tickN % 2 === 0 : S.tickN % 10 === 0) hostBroadcast(sim.snapshot());
  if (S.mode === 'host' && S.tickN % 30 === 0) {
    sim.players.forEach(function (p) {
      if (p.id !== S.myId && now - (S.seen[p.id] || now) > 8000) { Net.drop(p.id); hostRemove(p.id); }
    });
  }
}
function startHostLoop() {
  S.lastTick = Date.now(); S.tickN = 0;
  S.timers.push(setInterval(hostTick, 33));
}
function rosterAny() { return S.mode === 'solo' ? { t: 'roster', code: null, hostId: 'me', mode: S.sim.mode, base: S.base | 0, players: S.sim.roster() } : rosterMsg(); }
function hostStart(day) { const info = S.sim.startDay(day || 1); hostBroadcast(rosterAny()); hostBroadcast(info); }   // 先送名單（大逃殺會加入電腦玩家），再送開局資料

/* ---------- 進入各種模式 ---------- */
function startSolo(gmode) {
  Sfx.unlock();
  S.mode = 'solo'; S.myId = 'me'; S.sim = new W.Sim(); S.sim.mode = gmode === 'hunt' || gmode === 'br' || gmode === 'td' ? gmode : 'coop'; S.gmode = S.sim.mode; S.base = 0;
  document.body.classList.add('solo');
  S.sim.map = myMap();
  S.sim.addPlayer('me', myName(), myLook());
  Game.setMe('me');
  dispatch({ t: 'roster', code: null, hostId: 'me', mode: S.sim.mode, base: S.base | 0, players: S.sim.roster() });
  startHostLoop();
  hostStart(1);
}
function netErr(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return '找不到這個房間，請確認代碼。';
  if (t === 'full') return '房間已滿。';
  if (t === 'timeout') return '連線逾時。伺服器可能還在喚醒，請等 10 秒再試一次。';
  if (t === 'browser-incompatible') return '這裡無法使用連線功能。如果你是在 Claude 的預覽頁，預覽頁會擋掉連線與麥克風，只能玩單人；把專案部署到自己的網址（例如 GitHub Pages）後用 Safari 或 Chrome 開啟就能連線。';
  return '無法連線到配對伺服器（' + (t || (e && e.message) || '未知錯誤') + '）。請檢查網路後再試。';
}
function wireNet() {
  Net.on('join', function (id, meta) {
    if (S.mode !== 'host') return;
    const sim = S.sim;
    if (sim.phase !== 'lobby' || sim.players.length >= W.MAX_PLAYERS) {
      Net.sendTo(id, { t: 'no', why: sim.phase !== 'lobby' ? 'busy' : 'full' });
      setTimeout(function () { Net.drop(id); }, 800);
      return;
    }
    const p = sim.addPlayer(id, cleanName(meta && meta.name), meta || {});
    if (!p) return;
    S.seen[id] = Date.now();
    hostBroadcast(rosterMsg()); hostBroadcast({ t: 'sys', text: p.name + ' 加入了房間' });
  });
  Net.on('leave', function (id) { if (S.mode === 'host') hostRemove(id); });
  Net.on('msg', function (from, d) {
    if (!d || typeof d !== 'object') return;
    if (S.mode === 'host') {
      S.seen[from] = Date.now();
      if (d.t === 'i') S.sim.setInput(from, d);
      else if (d.t === 'chat') hostChat(from, d.text);
      else if (d.t === 'atk') S.sim.attack(from, d.yaw);
      else if (d.t === 'gun') S.sim.shoot(from, d.yaw);
      else if (d.t === 'tower') S.sim.buildTower(from);
      else if (d.t === 'bomb') S.sim.bomb(from, d.yaw);
      else if (d.t === 'eq') { const pl = S.sim.player(from); if (pl && S.sim.setEquip(from, d.eq)) { if (Array.isArray(d.gems)) pl.gems = [0, 1, 2].map(function (k) { return Math.max(0, Math.min(5, d.gems[k] | 0)); }); hostBroadcast(rosterMsg()); } }
      else if (d.t === 'bye') { Net.drop(from); hostRemove(from); }
    } else if (S.mode === 'client') { S.lastHost = Date.now(); dispatch(d); }
  });
  Net.on('call', function (call) { Voice.onIncoming(call); });
  Net.on('hostleft', function () { if (S.mode === 'client') { leave(); say('房主離開了，房間已關閉。'); } });
  Net.on('error', function (e) { console.warn('net', e && e.type); });
}
function micNotice() {
  if (!Voice.hasMic()) chatAdd(null, '麥克風預設關閉。要講話請在遊戲中按右上角「麥克風」。');
}
async function createRoom() {
  Sfx.unlock(); wakeServer();
  await Voice.init(false);   // 不主動要求麥克風（會打斷 Discord 等其他通話）；要講話再按遊戲裡的「麥克風」
  connectRetry('建立房間中…', function (cb) { Net.host(cb); }, function () {
    S.mode = 'host'; S.myId = Net.id(); S.sim = new W.Sim();
    S.sim.map = myMap();
    S.sim.addPlayer(S.myId, myName(), myLook());
    Game.setMe(S.myId); wireNet();
    enterRoom();
    dispatch(rosterMsg());
    startHostLoop();
    showLobby(); micNotice();
  });
}
async function joinRoom() {
  const code = Net.normalizeCode($('codeInput').value);
  if (code.length !== 5) { say('請輸入 5 碼房間代碼。'); return; }
  Sfx.unlock(); wakeServer();
  await Voice.init(false);   // 不主動要求麥克風（會打斷 Discord 等其他通話）；要講話再按遊戲裡的「麥克風」
  const u = Auth.user();
  const look = myLook();
  const meta = { name: myName(), uid: u ? u.uid : '', c: look.c, w: look.w, h: look.h, o: look.o, pet: look.pet, gun: look.gun, eq: look.eq, gems: look.gems };
  connectRetry('加入房間中…', function (cb) { Net.join(code, meta, cb); }, function (id) {
    S.mode = 'client'; S.myId = id; S.lastHost = Date.now();
    Game.setMe(id); wireNet();
    enterRoom();
    let n = 0;
    S.timers.push(setInterval(function () {
      n++;
      const st = Game.state();
      if (st.phase === 'play' || n % 5 === 0) Net.send(Game.input());
      if (Date.now() - S.lastHost > 12000) { leave(); say('與房主的連線中斷了。'); }
    }, 66));
    showLobby(code); micNotice();
  });
}
function enterRoom() {
  $('chatLog').textContent = '';
  $('chat').classList.remove('hide');
  S.timers.push(setInterval(function () { voiceSync(); if (!$('scrLobby').classList.contains('hide')) tickLobby(); }, 400));
}
function leave() {
  S.timers.forEach(clearInterval); S.timers = [];
  if (S.mode === 'client') Net.send({ t: 'bye' });   // 主動告訴房主我走了，不用等逾時
  Voice.closeAll(); Net.leave(); RR.Cloud.setRoom(null);
  S.mode = null; S.sim = null; S.myId = null; S.roster = []; S.seen = {}; S.chatRate = {}; S.flags = {};
  Game.setActive(false); Game.setRoster([]);
  document.body.classList.remove('solo');
  $('chat').classList.add('hide'); chatOpen(false);
  $('confirm').classList.add('hide'); $('scrHelp').classList.add('hide'); $('scrGear').classList.add('hide');
  Game.showMap(myMap());
  if (Auth.user()) showMenu(); else show('scrLogin');
}

/* ---------- 畫面 ---------- */
function refreshPickSummary() {
  const ci = (+ls('rr_c') || 0) % W.CHARS.length, c = W.CHARS[ci], w = W.WEAPONS[((+ls('rr_w') || 0) % W.WEAPONS.length)], m = W.MAPS[myMap()];
  $('pickSum').textContent = c + '、' + (W.GUNS[myLook().gun] || W.GUNS[0]).name + '、' + (m ? m.name : '');
  $('avatar').textContent = c.charAt(0);
}
function showMenu() {
  const u = Auth.user();
  if (!u) { show('scrLogin'); return; }
  if (!ls('rr_region')) $('regionAsk').classList.remove('hide');   // 第一次進選地區
  $('whoProv').textContent = u.providerLabel + ' 登入';
  if (document.activeElement !== $('nick')) $('nick').value = u.name;
  $('nickPen').classList.toggle('pulse', !ls('rr_named') && /^訪客/.test(u.name || ''));
  $('best').textContent = ls('rr_best') || '0';
  show('scrMenu');
  refreshPickSummary(); renderProg(); refreshLobby();
}
// 大廳：選模式（卡片只選取）、開始鍵顯示模式與地圖、中間的角色
const LOBBY_MODE = { coop: '多人合作', solo: '單人遊玩', hunt: '獵殺模式', td: '塔防模式', br: '大逃殺' };
function selMode() { const m = ls('rr_mode') || 'coop'; return LOBBY_MODE[m] ? m : 'coop'; }
function refreshLobby() {
  const m = selMode();
  Array.prototype.forEach.call($('modeStrip').children, function (b) { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('startMode').textContent = LOBBY_MODE[m] + (m === 'coop' ? '：建立房間' : '');
  $('mapName').textContent = (W.MAPS[myMap()] || W.MAPS[0]).name;
  const look = myLook();
  $('lbName').textContent = W.CHARS[look.c] + '　' + (W.GUNS[look.gun] || W.GUNS[0]).name;
  Game.preview($('lobbyChar'), look.c, look.w, look.h, look.o, look.pet, true);
}
function renderMapGrid() {
  const g = $('mapGrid'), cur = myMap(); g.textContent = '';
  W.MAPS.forEach(function (mp, i) {
    const T = mp.theme, b = document.createElement('button'); b.type = 'button'; b.className = 'mapCard' + (i === cur ? ' on' : '');
    const sky = T.open ? '#' + (T.sky || 0).toString(16).padStart(6, '0') : '#1a1d20';
    b.innerHTML = '<i class="sw"><u></u><s></s></i><b></b><span></span>';
    b.querySelector('u').style.background = sky; b.querySelector('s').style.background = T.wall;
    b.querySelector('.sw').style.background = T.floor;
    b.querySelector('b').textContent = mp.name; b.querySelector('span').textContent = T.open ? '開放場景' : '室內';
    b.addEventListener('click', function () { lsSet('rr_map', String(i)); Game.showMap(i); renderMapGrid(); });
    g.appendChild(b);
  });
}
function shareUrl(code) { return location.origin + location.pathname + '?room=' + code; }
function showLobby(code) {
  if (code || Net.code()) $('roomCode').textContent = code || Net.code();
  const host = S.mode === 'host';
  $('startBtn').classList.toggle('hide', !host);
  $('waitHost').classList.toggle('hide', host);
  $('shareLink').classList.add('hide');
  $('micNote').textContent = Voice.hasMic() ? '語音已連線：進遊戲後離得越遠聲音越小。' : '沒有麥克風權限，只能聽。';
  renderLobby(); tickLobby();
  if (S.mode !== 'solo') RR.Cloud.setRoom(code || Net.code());
  show('scrLobby');
}
function renderLobby(code) {
  if (code) $('roomCode').textContent = code;
  const el = $('lobbyList'); el.textContent = '';
  S.roster.forEach(function (p) {
    const row = document.createElement('div'); row.className = 'prow'; row.dataset.id = p.id;
    const dot = document.createElement('i'); dot.style.background = CSSCOL[p.slot % 4];
    const nm = document.createElement('span'); nm.textContent = p.name;
    row.appendChild(dot); row.appendChild(nm);
    const tag = (p.id === S.hostId ? '房主' : '') + (p.id === S.myId ? (p.id === S.hostId ? '・你' : '你') : '');
    if (tag) { const sm = document.createElement('small'); sm.textContent = tag; row.appendChild(sm); }
    el.appendChild(row);
  });
}
function tickLobby() {
  const rows = $('lobbyList').children;
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].dataset.id;
    const talking = id === S.myId ? Voice.level() > 0.035 : !!((S.flags[id] || 0) & 2);
    rows[i].classList.toggle('spk', talking);
  }
  const b = $('lobbyMic');
  b.textContent = !Voice.hasMic() ? '無麥克風' : Voice.isMuted() ? '麥克風 關' : '麥克風 開';
  b.classList.toggle('off', !Voice.hasMic() || Voice.isMuted());
  const pv = $('pvpBtn');
  pv.textContent = '互相傷害：' + (S.pvp ? '開' : '關') + (S.mode === 'host' ? '' : '（房主設定）');
  pv.classList.toggle('off', !S.pvp);
  $('baseBtn').textContent = '基地：' + W.BASE_STYLES[S.base | 0].n + (S.mode === 'host' ? '（點擊切換）' : '（房主設定）');
  $('modeBtn').textContent = '模式：' + (S.gmode === 'td' ? '塔防（守住回收車）' : S.gmode === 'hunt' ? '獵殺（用槍打怪物）' : S.gmode === 'br' ? '大逃殺（互相對戰，活到最後）' : '回收（撿廢料賣錢）') + (S.mode === 'host' ? '（點擊切換）' : '（房主設定）');
  $('mapBtn').textContent = '地圖：' + W.MAPS[S.map || 0].name + (S.mode === 'host' ? '（點擊切換）' : '（房主設定）');
}
// 新手教學：第一次開始遊戲時出現，之後可從「設定與說明」重看
const TUT = [
  ['目標', '在時間內把廢料帶回金色回收車，賺到當天的目標金額。上方的進度條滿了就過關。'],
  ['撿與賣', '走近發亮的廢料就會撿起來，背包最多 3 件。走回回收車會自動賣掉。跟著畫面上方的箭頭就能找到回收車。'],
  ['怪物', '怪物看得到你，也聽得到跑步聲。聽到心跳聲變快就代表牠在附近。背包滿 3 件時牠會被引過來。'],
  ['保命工具', '「技」是角色技能、「煙」是煙霧彈（躲進煙裡怪物看不到你），按鈕上的數字是冷卻秒數。隊友倒地時按住「救」。']
];
let tutI = 0;
function tutShow(i) {
  tutI = i; $('tutN').textContent = (i + 1) + ' / ' + TUT.length; $('tutTitle').textContent = TUT[i][0]; $('tutText').textContent = TUT[i][1];
  $('tutNext').textContent = i === TUT.length - 1 ? '開始' : '下一步'; $('tut').classList.remove('hide');
}
function tutDone() { $('tut').classList.add('hide'); lsSet('rr_tut', '1'); }
/* ---------- 成就、每日登入、雲端成績 ---------- */
const ACH = [
  ['first', '初次出勤', '完成第一局', function (t) { return t.games >= 1; }, 20],
  ['win1', '第一桶金', '第一次過關', function (t) { return t.wins >= 1; }, 30],
  ['day5', '老練回收員', '回收模式通過第 5 天', function (t) { return t.coop >= 5; }, 100],
  ['day10', '廢墟傳說', '回收模式通過第 10 天', function (t) { return t.coop >= 10; }, 300],
  ['hunt3', '獵人', '獵殺模式通過第 3 關', function (t) { return t.hunt >= 3; }, 100],
  ['td3', '守門員', '塔防模式通過第 3 關', function (t) { return t.td >= 3; }, 100],
  ['br1', '最後生還者', '大逃殺拿到第 1 名', function (t) { return t.brWins >= 1; }, 150],
  ['mk50', '清道夫', '累計擊倒 50 隻怪物', function (t) { return t.mk >= 50; }, 150],
  ['g20', '常客', '玩滿 20 局', function (t) { return t.games >= 20; }, 200],
  ['rich', '小富翁', '同時持有 1000 金幣', function (t, p) { return p.coins >= 1000; }, 100],
  ['mk10', '新手獵手', '累計擊倒 10 隻怪物', function (t) { return t.mk >= 10; }, 50],
  ['mk200', '獵怪大師', '累計擊倒 200 隻怪物', function (t) { return t.mk >= 200; }, 400],
  ['wins10', '常勝軍', '累計過關 10 次', function (t) { return t.wins >= 10; }, 150],
  ['wins50', '過關達人', '累計過關 50 次', function (t) { return t.wins >= 50; }, 300],
  ['g50', '老鳥', '玩滿 50 局', function (t) { return t.games >= 50; }, 300],
  ['g100', '鐵人', '玩滿 100 局', function (t) { return t.games >= 100; }, 500],
  ['coop20', '回收大師', '回收模式通過第 20 天', function (t) { return t.coop >= 20; }, 500],
  ['hunt10', '獵殺專家', '獵殺模式通過第 10 關', function (t) { return t.hunt >= 10; }, 300],
  ['td10', '塔防大師', '塔防模式通過第 10 關', function (t) { return t.td >= 10; }, 300],
  ['br3', '大逃殺常客', '大逃殺拿到第 1 名 3 次', function (t) { return t.brWins >= 3; }, 300],
  ['rich300', '小有積蓄', '同時持有 300 金幣', function (t, p) { return p.coins >= 300; }, 40],
  ['rich5000', '大富豪', '同時持有 5000 金幣', function (t, p) { return p.coins >= 5000; }, 300],
  ['wins3', '穩定輸出', '累計過關 3 次', function (t) { return t.wins >= 3; }, 60],
  ['mk500', '殺戮機器', '累計擊倒 500 隻怪物', function (t) { return t.mk >= 500; }, 600],
  ['mk1000', '屠怪王', '累計擊倒 1000 隻怪物', function (t) { return t.mk >= 1000; }, 800],
  ['wins100', '百戰百勝', '累計過關 100 次', function (t) { return t.wins >= 100; }, 800],
  ['g200', '資深員工', '玩滿 200 局', function (t) { return t.games >= 200; }, 1000],
  ['coop30', '廢墟長老', '回收模式通過第 30 天', function (t) { return t.coop >= 30; }, 800],
  ['hunt20', '獵殺老手', '獵殺模式通過第 20 關', function (t) { return t.hunt >= 20; }, 500],
  ['td20', '城牆守護者', '塔防模式通過第 20 關', function (t) { return t.td >= 20; }, 500],
  ['br10', '逃殺之王', '大逃殺拿到第 1 名 10 次', function (t) { return t.brWins >= 10; }, 800],
  ['rich10000', '億萬富翁', '同時持有 10000 金幣', function (t, p) { return p.coins >= 10000; }, 800]
];
// 任務進度：每個成就的（統計欄位, 目標數）；金幣看目前持有量。列表上會顯示「目前 / 目標」
const ACH_GOAL = { first: ['games', 1], win1: ['wins', 1], day5: ['coop', 5], day10: ['coop', 10], hunt3: ['hunt', 3], td3: ['td', 3], br1: ['brWins', 1], mk50: ['mk', 50], g20: ['games', 20], rich: ['coins', 1000], mk10: ['mk', 10], mk200: ['mk', 200], wins10: ['wins', 10], wins50: ['wins', 50], g50: ['games', 50], g100: ['games', 100], coop20: ['coop', 20], hunt10: ['hunt', 10], td10: ['td', 10], br3: ['brWins', 3], rich300: ['coins', 300], rich5000: ['coins', 5000], wins3: ['wins', 3], mk500: ['mk', 500], mk1000: ['mk', 1000], wins100: ['wins', 100], g200: ['games', 200], coop30: ['coop', 30], hunt20: ['hunt', 20], td20: ['td', 20], br10: ['brWins', 10], rich10000: ['coins', 10000] };
function achProgress(a, p) {
  const g = ACH_GOAL[a[0]]; if (!g) return null;
  const cur = g[0] === 'coins' ? (p.coins | 0) : ((p.st && p.st[g[0]]) | 0);
  return [Math.min(cur, g[1]), g[1]];
}
function dayStr(off) { const d = new Date(Date.now() + (off || 0) * 864e5); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
/** 一局結束：更新統計、解鎖成就、回報排行榜與戰隊。回傳要加在結算畫面的文字。 */
function afterMatch(mode, win, day, myStat, coins) {
  const p = prog(), t = p.st;
  t.games++; if (win) t.wins++;
  t.mk += (myStat && myStat.mk) | 0;
  if (mode === 'br') { if (win) t.brWins++; }
  else if (win && day > t[mode]) t[mode] = day;
  const got = [];
  ACH.forEach(function (a) { if (p.ach.indexOf(a[0]) < 0 && a[3](t, p)) { p.ach.push(a[0]); p.coins += a[4]; got.push(a[1] + ' +' + a[4]); } });
  progSave(p);
  if (RR.Cloud.ready()) {
    if (mode === 'br') { if (win) RR.Cloud.submit('br', 1); }
    else if (t[mode] > 0) RR.Cloud.submit(mode, t[mode]);
    RR.Cloud.clanAdd(coins);
  }
  return got.length ? '，成就：' + got.join('、') : '';
}
function dailyLogin() {
  const p = prog(), td = dayStr(0);
  if (p.login && p.login.d === td) return;
  const streak = p.login && p.login.d === dayStr(-1) ? (p.login.s | 0) + 1 : 1, gift = 20 + 10 * Math.min(streak - 1, 6);
  p.login = { d: td, s: streak }; p.coins += gift; progSave(p); renderProg();
  say('每日登入獎勵：金幣 +' + gift + '（連續第 ' + streak + ' 天' + (streak < 7 ? '，明天再來會更多' : '') + '）');
}
/* ---------- 社群畫面 ---------- */
const MODE_NAME = { coop: '回收', hunt: '獵殺', td: '塔防', br: '大逃殺' };
let socTab = 'rank', socMode = 'coop', socScope = 'week';
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function socNote(text) { const b = $('socBody'); b.appendChild(mk('p', 'note', text)); }
function socSelect(opts, val, onChange) {
  const sel = mk('select'); opts.forEach(function (o) { const x = mk('option', null, o[1]); x.value = o[0]; sel.appendChild(x); }); sel.value = val;
  sel.addEventListener('change', function () { onChange(sel.value); }); return sel;
}
function socRows(rows, unit, emptyText) {
  const b = $('socBody'), my = RR.Cloud.uid();
  if (!rows.length) { socNote(emptyText || '還沒有人上榜，快去拿第一名。'); return; }
  rows.forEach(function (r, i) {
    const row = mk('div', 'srow' + (r.uid === my ? ' me' : ''));
    row.appendChild(mk('span', 'rk', String(i + 1)));
    const nm = mk('span', 'nm', r.name || '玩家'); if (r.clan) nm.appendChild(mk('small', null, ' [' + r.clan + ']')); row.appendChild(nm);
    row.appendChild(mk('span', 'sc', unit(r.score | 0))); b.appendChild(row);
  });
}
function scoreUnit(mode) { return function (v) { return mode === 'br' ? v + ' 勝' : mode === 'coop' ? '第 ' + v + ' 天' : '第 ' + v + ' 關'; }; }
function renderSocial() {
  const b = $('socBody'), C = RR.Cloud; b.textContent = '';
  Array.prototype.forEach.call(document.querySelectorAll('#socTabs button'), function (x) { x.classList.toggle('on', x.dataset.tab === socTab); });
  if (socTab === 'ach') {
    const p = prog();
    socNote('已完成 ' + p.ach.length + ' / ' + ACH.length);
    ACH.forEach(function (a) {
      const ok = p.ach.indexOf(a[0]) >= 0, row = mk('div', 'srow' + (ok ? ' done' : ''));
      row.appendChild(mk('span', 'rk', ok ? '✓' : ''));
      const pr = ok ? null : achProgress(a, p);
      const nm = mk('span', 'nm', a[1]); nm.appendChild(mk('small', null, '　' + a[2] + (pr ? '（' + pr[0] + ' / ' + pr[1] + '）' : ''))); row.appendChild(nm);
      row.appendChild(mk('span', 'sc', '+' + a[4])); b.appendChild(row);
    });
    return;
  }
  if (!C.ready()) { socNote('雲端還沒連上。請用 Google 或訪客登入並確認網路；如果剛登入，等幾秒再打開一次。'); return; }
  const token = {}; renderSocial.token = token;
  const guard = function (fn) { return function (err, data) { if (renderSocial.token !== token) return; const w = b.querySelector('.wait'); if (w) w.remove(); if (err) { socNote(C.message(err)); return; } fn(data); }; };
  const modeSel = socSelect(C.MODES.map(function (m) { return [m, MODE_NAME[m] + '模式']; }), socMode, function (v) { socMode = v; renderSocial(); });
  if (socTab === 'rank') {
    const row = mk('div', 'soc-row'); row.appendChild(modeSel);
    row.appendChild(socSelect([['week', '本週'], ['all', '總榜']], socScope, function (v) { socScope = v; renderSocial(); })); b.appendChild(row);
    b.appendChild(mk('p', 'note wait', '讀取中…'));
    C.top(socMode, socScope === 'all' ? 'all' : 'w' + C.weekId(), guard(function (rows) { socRows(rows, scoreUnit(socMode)); }));
  } else if (socTab === 'season') {
    const p = prog(), rk = ['tw', 'hk'][p.region];
    const row = mk('div', 'soc-row');
    row.appendChild(socSelect(C.REGIONS.map(function (n, i) { return [String(i), n + '區']; }), String(p.region), function (v) { const q = prog(); q.region = +v; progSave(q); renderSocial(); }));
    row.appendChild(modeSel); b.appendChild(row);
    socNote('每週一換季。這裡是你所在地區本週的排名；上週前 10 名可以領金幣（第 1 名 300、第 2～3 名 200、第 4～10 名 100）。');
    const claim = mk('div'); b.appendChild(claim);
    b.appendChild(mk('p', 'note wait', '讀取中…'));
    C.top(socMode, rk + '_w' + C.weekId(), guard(function (rows) { socRows(rows, scoreUnit(socMode), '本週這個地區還沒有人上榜。'); }));
    const lastKey = socMode + ':' + rk + ':' + C.weekId(-1);
    if ((p.claimed || []).indexOf(lastKey) < 0) C.top(socMode, rk + '_w' + C.weekId(-1), function (err, rows) {
      if (err || renderSocial.token !== token) return;
      const at = rows.findIndex(function (r) { return r.uid === C.uid(); });
      if (at < 0 || at > 9) return;
      const gift = at === 0 ? 300 : at < 3 ? 200 : 100, btn = mk('button', 'btn primary', '領取上週第 ' + (at + 1) + ' 名獎勵：金幣 +' + gift); btn.type = 'button';
      btn.addEventListener('click', function () { const q = prog(); q.claimed = (q.claimed || []).slice(-30); if (q.claimed.indexOf(lastKey) >= 0) return; q.claimed.push(lastKey); q.coins += gift; progSave(q); renderProg(); btn.remove(); say('已領取金幣 +' + gift); });
      claim.appendChild(btn);
    });
  } else if (socTab === 'friends') {
    b.appendChild(mk('p', 'note', '你的好友代碼（給朋友輸入）'));
    b.appendChild(mk('div', 'bigcode', (C.me() && C.me().code) || '------'));
    const row = mk('div', 'soc-row'), inp = mk('input'); inp.type = 'text'; inp.maxLength = 6; inp.placeholder = '輸入朋友的代碼'; inp.autocapitalize = 'characters'; inp.autocomplete = 'off';
    const add = mk('button', 'btn primary', '加好友'); add.type = 'button';
    add.addEventListener('click', function () { add.disabled = true; C.addFriend(inp.value, function (err, name) { add.disabled = false; if (err) { say(C.message(err)); return; } say('已和 ' + name + ' 成為好友。'); renderSocial(); }); });
    row.appendChild(inp); row.appendChild(add); b.appendChild(row);
    b.appendChild(mk('p', 'note wait', '讀取中…'));
    C.friends(guard(function (rows) {
      if (!rows.length) { socNote('還沒有好友。把上面的代碼傳給朋友，或輸入他的代碼。'); return; }
      rows.forEach(function (f) {
        const r = mk('div', 'srow'); r.appendChild(mk('span', f.online ? 'dotOn' : 'dotOff'));
        const nm = mk('span', 'nm', f.name); nm.appendChild(mk('small', null, '　Lv.' + f.lv + (f.clan ? ' [' + f.clan + ']' : '') + (f.online ? (f.room ? '，在房間 ' + f.room : '，線上') : '，離線'))); r.appendChild(nm);
        if (f.online && f.room) { const j = mk('button', 'btn primary', '加入'); j.type = 'button'; j.addEventListener('click', function () { $('scrSocial').classList.add('hide'); $('codeInput').value = f.room; joinRoom(); }); r.appendChild(j); }
        const del = mk('button', 'btn', '刪除'); del.type = 'button'; del.addEventListener('click', function () { C.removeFriend(f.uid, function () { renderSocial(); }); }); r.appendChild(del);
        b.appendChild(r);
      });
    }));
  } else if (socTab === 'clan') {
    b.appendChild(mk('p', 'note wait', '讀取中…'));
    C.clan(guard(function (info) {
      if (!info) {
        socNote('加入戰隊後，每局得到的金幣數會同時累積成戰隊積分。');
        const r1 = mk('div', 'soc-row'), tag = mk('input'); tag.type = 'text'; tag.maxLength = 4; tag.placeholder = '戰隊代碼（4 碼）'; tag.autocapitalize = 'characters';
        const jb = mk('button', 'btn primary', '加入'); jb.type = 'button';
        jb.addEventListener('click', function () { jb.disabled = true; C.joinClan(tag.value, function (err, c) { jb.disabled = false; if (err) { say(C.message(err)); return; } say('已加入戰隊「' + c.name + '」。'); renderSocial(); }); });
        r1.appendChild(tag); r1.appendChild(jb); b.appendChild(r1);
        const r2 = mk('div', 'soc-row'), nm = mk('input'); nm.type = 'text'; nm.maxLength = 12; nm.placeholder = '新戰隊名稱';
        const cb = mk('button', 'btn', '建立（200 金幣）'); cb.type = 'button';
        cb.addEventListener('click', function () {
          const q = prog(); if (q.coins < 200) { say('金幣不夠：建立戰隊要 200 金幣，你有 ' + q.coins + '。'); return; }
          cb.disabled = true;
          C.createClan(nm.value, function (err, c) { cb.disabled = false; if (err) { say(C.message(err)); return; } const q2 = prog(); q2.coins -= 200; progSave(q2); renderProg(); say('戰隊「' + c.name + '」建立完成。把代碼 ' + c.tag + ' 傳給朋友就能加入。'); renderSocial(); });
        });
        r2.appendChild(nm); r2.appendChild(cb); b.appendChild(r2);
      } else {
        b.appendChild(mk('p', 'note', '戰隊「' + info.clan.name + '」，積分 ' + (info.clan.score | 0) + '，' + info.members.length + ' / 30 人，代碼'));
        b.appendChild(mk('div', 'bigcode', info.clan.tag));
        { const cc = mk('button', 'btn primary', '打開戰隊聊天'); cc.type = 'button'; cc.style.width = '100%'; cc.style.margin = '6px 0 10px'; cc.addEventListener('click', function () { $('scrSocial').classList.add('hide'); renderSocial.token = null; clanOpen(); }); b.appendChild(cc); }
        const isLeader = info.clan.owner === RR.Cloud.uid(), deps = info.clan.deputies || [];
        const roleOf = function (m) { return m.uid === info.clan.owner ? '隊長' : deps.indexOf(m.uid) >= 0 ? '副隊長' : '隊員'; };
        socRows(info.members.map(function (m) { return Object.assign({}, m, { name: (m.name || '玩家') + ' 〔' + roleOf(m) + '〕' }); }), function (v) { return v + ' 分'; });
        const my = RR.Cloud.uid();
        const amDep = deps.indexOf(my) >= 0;
        if (isLeader || amDep) info.members.forEach(function (m) {
          if (m.uid === info.clan.owner || m.uid === my) return;
          const isDep = deps.indexOf(m.uid) >= 0, r = mk('div', 'srow');
          r.appendChild(mk('span', 'nm', (m.name || '玩家') + ' · ' + roleOf(m)));
          if (isLeader) {
            const bt = mk('button', 'btn', isDep ? '取消副隊長' : '設為副隊長'); bt.type = 'button';
            bt.addEventListener('click', function () { C.setDeputy(m.uid, !isDep, function (err) { if (err) say(C.message(err)); renderSocial(); }); });
            r.appendChild(bt);
            const tb = mk('button', 'btn', '轉移隊長'); tb.type = 'button';
            tb.addEventListener('click', function () { if (!window.confirm('確定把隊長轉給「' + (m.name || '玩家') + '」？你會變成隊員。')) return; C.transferLeader(m.uid, function (err) { if (err) say(C.message(err)); renderSocial(); }); });
            r.appendChild(tb);
          }
          if (isLeader || !isDep) {
            const kb = mk('button', 'btn', '踢出'); kb.type = 'button';
            kb.addEventListener('click', function () { if (!window.confirm('確定要把「' + (m.name || '玩家') + '」踢出戰隊？')) return; C.kickMember(m.uid, function (err) { if (err) say(C.message(err)); renderSocial(); }); });
            r.appendChild(kb);
          }
          b.appendChild(r);
        });
        const lv = mk('button', 'btn', '退出戰隊'); lv.type = 'button'; lv.addEventListener('click', function () { C.leaveClan(function (err) { if (err) say(C.message(err)); renderSocial(); }); }); b.appendChild(lv);
      }
      b.appendChild(mk('div', 'sec', '戰隊排行榜'));
      C.topClans(function (err, rows) {
        if (err || renderSocial.token !== token) return;
        if (!rows.length) { socNote('還沒有任何戰隊。'); return; }
        rows.forEach(function (c, i) { const r = mk('div', 'srow' + (C.me() && C.me().clan === c.id ? ' me' : '')); r.appendChild(mk('span', 'rk', String(i + 1))); const nm = mk('span', 'nm', c.name); nm.appendChild(mk('small', null, '　' + (c.count | 0) + ' 人')); r.appendChild(nm); r.appendChild(mk('span', 'sc', (c.score | 0) + ' 分'));
          if (!(C.me() && C.me().clan) && (c.count | 0) < 30 && c.tag) { const j = mk('button', 'btn primary', '+'); j.type = 'button'; j.title = '加入戰隊'; j.addEventListener('click', function () { j.disabled = true; C.joinClan(c.tag, function (err, cl) { j.disabled = false; if (err) { say(C.message(err)); return; } say('已加入戰隊「' + cl.name + '」。'); renderSocial(); }); }); r.appendChild(j); }
          b.appendChild(r); });
      });
    }));
  }
}
function showResultBR(e) {
  const host = S.mode === 'host', solo = S.mode === 'solo';
  const mine = (e.stats || []).filter(function (p) { return p.id === S.myId; })[0] || { rank: e.stats ? e.stats.length : 1, kills: 0 };
  const win = mine.rank === 1, n = e.stats ? e.stats.length : 1;
  $('resTitle').textContent = win ? '第 1 名！你活到最後' : '第 ' + mine.rank + ' 名'; $('resTitle').style.color = '';
  const stars = win ? 3 : mine.rank <= 3 ? 2 : 1, sb = $('resStars'); sb.textContent = '';
  for (let k = 0; k < 3; k++) { const x = document.createElement(k < stars ? 'span' : 'i'); x.textContent = '★'; sb.appendChild(x); }
  $('resText').textContent = '共 ' + n + ' 人，你淘汰了 ' + (mine.kills || 0) + ' 人。';
  const p = prog(), coins = 15 + (mine.kills || 0) * 15 + (win ? 60 : mine.rank <= 3 ? 20 : 0); p.coins += coins; p.xp += coins + 10; if (win) p.m[0] += 1; progSave(p);
  $('resGain').textContent = '金幣 +' + coins + '，經驗 +' + (coins + 10) + afterMatch('br', win, 1, null, coins);
  const st = $('resStats'); st.textContent = '';
  (e.stats || []).slice().sort(function (a, b) { return a.rank - b.rank; }).forEach(function (q) {
    const row = document.createElement('div'); row.className = 'prow' + (q.rank === 1 ? '' : ' dead');
    const dot = document.createElement('i'); dot.style.background = CSSCOL[q.slot % 4];
    const nm = document.createElement('span'); nm.textContent = '#' + q.rank + '　' + q.name + (q.ai ? '（電腦）' : '') + (q.id === S.myId ? '（你）' : '');
    const sm = document.createElement('small'); sm.textContent = '淘汰 ' + (q.kills || 0);
    row.appendChild(dot); row.appendChild(nm); row.appendChild(sm); st.appendChild(row);
  });
  st.classList.remove('hide');
  $('resNext').classList.add('hide'); $('resRetry').classList.toggle('hide', !solo); $('resLobby').classList.toggle('hide', !host); $('resWait').classList.toggle('hide', host || solo);
  setTimeout(function () { if (S.mode && Game.state().phase !== 'play') show('scrResult'); }, 900);
}
function showResult(e) {
  if (S.gmode === 'br') { showResultBR(e); return; }
  const host = S.mode === 'host', solo = S.mode === 'solo';
  if (e.win) { const best = parseInt(ls('rr_best') || '0', 10); if (e.day > best) lsSet('rr_best', String(e.day)); }
  $('resTitle').textContent = e.win ? '第 ' + e.day + ' 天完成！' : '任務失敗';
  $('resTitle').style.color = e.win ? '' : '#b8432b';
  // 星等：過關 1 顆，超過目標 30% 或剩 60 秒以上各再加 1 顆
  const stars = e.win ? 1 + (e.money >= e.quota * 1.3 ? 1 : 0) + (e.time >= 60 ? 1 : 0) : 0;
  const sb = $('resStars'); sb.textContent = '';
  for (let k = 0; k < 3; k++) { const x = document.createElement(k < stars ? 'span' : 'i'); x.textContent = '★'; sb.appendChild(x); }
  { const c0 = prog().coins, txt = progOnResult(e, stars), mine = (e.stats || []).filter(function (q) { return q.id === S.myId; })[0];
    $('resGain').textContent = txt + afterMatch(S.gmode === 'hunt' || S.gmode === 'td' ? S.gmode : 'coop', !!e.win, e.day, mine, prog().coins - c0); }
  let top = null; if (e.stats) e.stats.forEach(function (p) { if (p.earned > 0 && (!top || p.earned > top.earned)) top = p; });
  const hunt = S.gmode === 'hunt', td = S.gmode === 'td';
  if (hunt) $('resTitle').textContent = e.win ? '獵殺第 ' + e.day + ' 關完成！' : '獵殺失敗';
  $('resText').textContent = hunt ? (e.win
    ? '擊倒 ' + (e.money / 50) + ' 隻怪物（目標 ' + (e.quota / 50) + ' 隻），還剩 ' + e.time + ' 秒。下一關目標更多、怪物更快。'
    : (e.why === 'time' ? '時間到，只擊倒 ' + (e.money / 50) + ' / ' + (e.quota / 50) + ' 隻。' : '全員被抓，擊倒 ' + (e.money / 50) + ' / ' + (e.quota / 50) + ' 隻。') + ' 止步第 ' + e.day + ' 關。') : e.win
    ? '賺到 $' + e.money + '（目標 $' + e.quota + '），還剩 ' + e.time + ' 秒。明天目標更高，怪物也更快。'
    : (e.why === 'time' ? '時間到，只賺到 $' + e.money + ' / $' + e.quota + '。' : '全員被抓。帶回 $' + e.money + ' / $' + e.quota + '。') + ' 止步第 ' + e.day + ' 天。';
  if (td) {
    $('resTitle').textContent = e.win ? '塔防第 ' + e.day + ' 關守住了！' : '回收車被攻破';
    $('resText').textContent = e.win ? '核心還剩 ' + e.core + '。下一關怪物更多、更硬、更快。' : (e.why === 'time' ? '時間到，怪物還沒清完。' : '核心歸零。') + ' 止步第 ' + e.day + ' 關。';
    const ts = e.win ? 1 + (e.core >= 70 ? 1 : 0) + (e.core >= 100 ? 1 : 0) : 0, sb2 = $('resStars'); sb2.textContent = '';
    for (let k = 0; k < 3; k++) { const x = document.createElement(k < ts ? 'span' : 'i'); x.textContent = '★'; sb2.appendChild(x); }
  }
  const st = $('resStats'); st.textContent = '';
  if (!solo && e.stats) e.stats.forEach(function (p) {
    const row = document.createElement('div'); row.className = 'prow' + (p.alive ? '' : ' dead');
    const dot = document.createElement('i'); dot.style.background = CSSCOL[p.slot % 4];
    const nm = document.createElement('span'); nm.textContent = p.name;
    const sm = document.createElement('small'); sm.textContent = hunt ? '擊倒怪物 ' + (p.mk || 0) + ' 隻' : '賣出 $' + p.earned + '，擊殺 ' + p.kills;
    row.appendChild(dot); row.appendChild(nm);
    if (top && top.id === p.id) { const mv = document.createElement('span'); mv.className = 'mvp'; mv.textContent = 'MVP'; row.appendChild(mv); }
    row.appendChild(sm); st.appendChild(row);
  });
  st.classList.toggle('hide', solo || !e.stats);
  $('resNext').classList.toggle('hide', !(e.win && (host || solo)));
  $('resRetry').classList.toggle('hide', !(!e.win && solo));
  $('resLobby').classList.toggle('hide', !(!e.win && host));
  $('resWait').classList.toggle('hide', host || solo);
  setTimeout(function () { if (S.mode && Game.state().phase !== 'play') show('scrResult'); }, e.win ? 400 : 1000);
}

/* ---------- 綁定 ---------- */
function bind() {
  Array.prototype.forEach.call(document.querySelectorAll('.prov'), function (b) {
    const name = b.dataset.provider;
    if (RR.CONFIG.providers && RR.CONFIG.providers[name] === false) { b.classList.add('hide'); return; }
    if (!Auth.configured()) b.classList.add('off');
    if (name === 'google' && Auth.gisReady()) {   // 加到主畫面：用 Google 官方按鈕取代
      const box = document.createElement('div'); box.className = 'gisBox'; b.parentNode.replaceChild(box, b);
      Auth.gisButton(box, function (e) { say(Auth.message(e)); }); return;
    }
    b.addEventListener('click', function () {
      Sfx.unlock();
      if (name !== 'guest' && Auth.standalone() && !RR.CONFIG.googleClientId) { say('加到主畫面的版本無法用社群登入（iPhone 限制）。請用 Safari 開啟，或先用訪客登入。'); return; }
      Auth.signIn(name).catch(function (e) { if (!e || e.code !== 'auth/popup-closed-by-user') say(Auth.message(e)); });
    });
  });
  if (!Auth.configured()) $('loginNote').textContent = '社群登入尚未設定金鑰（見 README），目前可用訪客登入。';
  $('guestBtn').addEventListener('click', function () { Sfx.unlock(); Auth.guest(); });
  $('logoutBtn').addEventListener('click', function () { Auth.signOut(); });
  $('nick').addEventListener('change', function () {
    const v = $('nick').value.trim();
    if (!v) { const u = Auth.user(); $('nick').value = u ? u.name : ''; return; }
    Auth.setNick(v); RR.Cloud.saveSoon();
    const pen = $('nickPen'); pen.textContent = '已儲存'; pen.classList.add('saved'); pen.classList.remove('pulse');
    try { localStorage.setItem('rr_named', '1'); } catch (e) {}
    setTimeout(function () { pen.textContent = '改名'; pen.classList.remove('saved'); }, 2000);
  });
  $('nick').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('nick').blur(); });

  $('soloBtn').addEventListener('click', function () { startSolo('coop'); });
  Array.prototype.forEach.call($('modeStrip').children, function (b) { b.addEventListener('click', function () { lsSet('rr_mode', b.dataset.mode); Sfx.tone(520, 0.04, 'square', 0.04); refreshLobby(); }); });
  $('goBtn').addEventListener('click', function () { const b = $('modeStrip').querySelector('[data-mode="' + selMode() + '"]'); if (b) $(b.dataset.go).click(); });
  $('mapChip').addEventListener('click', function () { renderMapGrid(); show('scrMap'); });
  $('mapOk').addEventListener('click', function () { showMenu(); }); $('mapDone').addEventListener('click', function () { showMenu(); });
  $('joinOpen').addEventListener('click', function () { $('joinModal').classList.remove('hide'); setTimeout(function () { $('codeInput').focus(); }, 50); });
  $('joinClose').addEventListener('click', function () { $('joinModal').classList.add('hide'); });
  $('joinBtn').addEventListener('click', function () { $('joinModal').classList.add('hide'); });
  $('misBtn').addEventListener('click', function () { $('misModal').classList.remove('hide'); });
  $('misClose').addEventListener('click', function () { $('misModal').classList.add('hide'); });
  $('coinBtn').addEventListener('click', function () { $('wheelOpen').click(); });
  $('createBtn').addEventListener('click', createRoom);
  $('joinBtn').addEventListener('click', joinRoom);
  $('codeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') joinRoom(); });
  $('startBtn').addEventListener('click', function () { if (S.mode === 'host') hostStart(1); });
  $('lobbyLeave').addEventListener('click', leave);
  $('mapBtn').addEventListener('click', function () {
    if (S.mode !== 'host') return;
    S.sim.map = (S.sim.map + 1) % W.MAPS.length; lsSet('rr_map', String(S.sim.map));
    hostBroadcast(rosterMsg()); tickLobby(); showMapName();
  });
  $('baseBtn').addEventListener('click', function () { if (S.mode !== 'host') return; S.base = ((S.base | 0) + 1) % W.BASE_STYLES.length; S.sim.baseStyle = S.base; hostBroadcast(rosterMsg()); tickLobby(); });
  $('modeBtn').addEventListener('click', function () { if (S.mode !== 'host') return; S.sim.mode = S.sim.mode === 'coop' ? 'hunt' : S.sim.mode === 'hunt' ? 'br' : S.sim.mode === 'br' ? 'td' : 'coop'; hostBroadcast(rosterMsg()); tickLobby(); });
  $('brBtn').addEventListener('click', function () { startSolo('br'); });
  $('tdBtn').addEventListener('click', function () { startSolo('td'); });
  $('huntBtn').addEventListener('click', function () { startSolo('hunt'); });
  $('pvpBtn').addEventListener('click', function () { if (S.mode !== 'host') return; S.sim.pvp = !S.sim.pvp; hostBroadcast(rosterMsg()); tickLobby(); });
  $('lobbyMic').addEventListener('click', function () { if (Voice.hasMic()) Voice.setMuted(!Voice.isMuted()); else say('沒有麥克風權限。請在瀏覽器允許麥克風後，重新進入房間。'); tickLobby(); });
  $('copyBtn').addEventListener('click', function () {
    const url = shareUrl($('roomCode').textContent);
    const fallback = function () { const i = $('shareLink'); i.value = url; i.classList.remove('hide'); i.focus(); i.select(); };
    try { navigator.clipboard.writeText(url).then(function () { Game.toast('已複製'); chatAdd(null, '邀請連結已複製'); }, fallback); } catch (e) { fallback(); }
  });
  $('resNext').addEventListener('click', function () { if (S.sim) hostStart(S.sim.day + 1); });
  $('resRetry').addEventListener('click', function () { if (S.sim) hostStart(1); });
  $('resLobby').addEventListener('click', function () { if (S.mode === 'host') { S.sim.toLobby(); hostBroadcast(rosterMsg()); hostBroadcast({ t: 'lobby' }); } });
  $('resLeave').addEventListener('click', leave);
  $('leaveBtn').addEventListener('click', function () { $('confirm').classList.remove('hide'); });
  $('confirmNo').addEventListener('click', function () { $('confirm').classList.add('hide'); });
  $('confirmYes').addEventListener('click', leave);
  $('msgOk').addEventListener('click', function () { $('msg').classList.add('hide'); });
  $('chatBtn').addEventListener('click', function () { chatOpen(!document.body.classList.contains('chatting')); });
  $('chatForm').addEventListener('submit', function (e) { e.preventDefault(); chatSend(); });
  $('chatInput').addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('chatInput').value = ''; chatOpen(false); } e.stopPropagation(); });
  $('chatInput').addEventListener('keyup', function (e) { e.stopPropagation(); });
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !S.mode || S.mode === 'solo') return;
    if (e.target && /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) return;
    if (document.body.classList.contains('playing')) { e.preventDefault(); chatOpen(true); }
  });
  // 造型選擇（卡片式）
  const look = myLook();
  const cards = function (box, names, sub, onPick) {
    const out = [];
    names.forEach(function (n, i) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'card';
      const t = document.createElement('b'); t.textContent = n; b.appendChild(t);
      if (sub) { const u = document.createElement('span'); u.textContent = sub(i); b.appendChild(u); }
      b.addEventListener('click', function () { onPick(i); });
      box.appendChild(b); out.push(b);
    });
    return out;
  };
  const mark = function (list, i) { list.forEach(function (b, k) { b.classList.toggle('on', k === i); }); };
  let mapSel = myMap();
  const cBtns = cards($('cGrid'), W.CHARS, function (i) { return CINFO[i] ? CINFO[i][0] : ''; }, function (i) { look.c = i; showLook(); });
  const wBtns = cards($('wGrid'), W.WEAPONS, null, function (i) { look.w = i; showLook(); });
  // 槍：全部免費（造型才要抽）
  const gBtns = cards($('gGrid'), W.GUNS.map(function (g) { return g.name; }), function () { return ''; }, function (i) {
    look.gun = i; lsSet('rr_gun', String(i)); showLook();
  });
  const hBtns = cards($('hGrid'), W.HATS, function (i) { return ''; }, function (i) {
    const p = prog();
    if (p.hats.indexOf(i) < 0) {
      if (p.coins < HAT_COST[i]) { say('金幣不夠：「' + W.HATS[i] + '」要 ' + HAT_COST[i] + ' 金幣，你有 ' + p.coins + '。過關和每日任務可以賺金幣。'); return; }
      p.coins -= HAT_COST[i]; p.hats.push(i); progSave(p);
    }
    look.h = i; showLook();
  });
  // 服裝、寵物（隊友看得到）與只影響自己畫面的造型
  const wardrobe = [['o', 'oGrid', 'rr_o'], ['pet', 'petGrid', 'rr_pet'], ['is', 'isGrid', 'rr_is'], ['ms', 'msGrid', 'rr_ms'], ['fx', 'fxGrid', 'rr_fx'], ['gs', 'gsGrid', 'rr_gs']].map(function (d) {
    const cat = d[0], btns = cards($(d[1]), catNames(cat), function () { return ''; }, function (i) {
      if (!owns(prog(), cat, i)) { say('「' + catNames(cat)[i] + '」還沒取得，到「回收抽獎機」抽。'); return; }
      lsSet(d[2], String(i)); if (cat === 'o') look.o = i; if (cat === 'pet') look.pet = i; showLook();
    });
    return { cat: cat, key: d[2], btns: btns };
  });
  const mBtns = cards($('mGrid'), W.MAPS.map(function (m) { return m.name; }), null, function (i) { mapSel = i; lsSet('rr_map', String(i)); showMapName(); Game.showMap(mapSel); });
  const showLook = function () {
    look.c = ((look.c % W.CHARS.length) + W.CHARS.length) % W.CHARS.length;
    look.w = ((look.w % W.WEAPONS.length) + W.WEAPONS.length) % W.WEAPONS.length;
    const info = CINFO[look.c] || ['', '', ''];
    $('cName').textContent = W.CHARS[look.c]; $('cSkill').textContent = info[0];
    $('cDesc').textContent = info[1]; $('cAttr').textContent = '屬性：' + info[2];
    mark(cBtns, look.c); mark(wBtns, look.w); mark(hBtns, look.h);
    { look.gun = ((look.gun | 0) % W.GUNS.length + W.GUNS.length) % W.GUNS.length; mark(gBtns, look.gun);
      gBtns.forEach(function (b, i) { b.lastChild.textContent = i === look.gun ? '使用中' : ''; });
      renderGunStats(look.gun); Game.setGun(look.gun); }
    const pg = prog();
    hBtns.forEach(function (b, i) { const own = pg.hats.indexOf(i) >= 0; b.classList.toggle('lock', !own); b.lastChild.textContent = own ? (i === look.h ? '使用中' : '已擁有') : HAT_COST[i] + ' 金幣'; });
    wardrobe.forEach(function (wd) {
      const cur = parseInt(ls(wd.key) || '0', 10) || 0, sel = owns(pg, wd.cat, cur) ? cur : 0;
      wd.btns.forEach(function (b, i) { const own = owns(pg, wd.cat, i); b.classList.toggle('lock', !own); b.classList.toggle('on', i === sel); b.lastChild.textContent = !own ? '抽獎機取得' : i === sel ? '使用中' : wd.cat === 'pet' && i ? PET_NOTE[i] : '已擁有'; });
    });
    look.o = owns(pg, 'o', look.o) ? look.o : 0; look.pet = owns(pg, 'pet', look.pet) ? look.pet : 0;
    applyLocalSkins();
    lsSet('rr_c', String(look.c)); lsSet('rr_w', String(look.w)); lsSet('rr_h', String(look.h)); renderProg();
    refreshPickSummary();
    // 收合標題列：顯示目前選的東西
    { const pg1 = prog(), cur = function (cat, key) { const v = parseInt(ls(key) || '0', 10) || 0; return catNames(cat)[owns(pg1, cat, v) ? v : 0]; };
      $('fsChar').textContent = W.CHARS[look.c];
      $('fsArms').textContent = W.WEAPONS[look.w] + '、' + W.GUNS[look.gun].name + (cur('gs', 'rr_gs') !== '原廠' ? '（' + cur('gs', 'rr_gs') + '）' : '');
      $('fsLook').textContent = [look.h ? W.HATS[look.h] : '', look.o ? W.COSTUMES[look.o] : '', look.pet ? W.PETS[look.pet] : ''].filter(Boolean).join('、') || '預設';
      $('fsFx').textContent = cur('fx', 'rr_fx') + '彈道'; }
    Game.preview($('lookPrev'), look.c, look.w, look.h, look.o, look.pet);
  };
  showMapName = function () { mapSel = myMap(); mark(mBtns, mapSel); refreshPickSummary(); $('fsMap').textContent = W.MAPS[mapSel].name; };
  // 收合狀態記在 rr_fold（預設只展開「角色」）
  { let open = null; try { open = JSON.parse(ls('rr_fold') || 'null'); } catch (e) {} if (!open) open = { char: 1, m_play: 1, m_mis: 1, h_help: 1, g_acc: 1 };
    ['m_play', 'h_help', 'g_acc'].forEach(function (k) { if (open[k] == null) open[k] = 1; });
    Array.prototype.forEach.call(document.querySelectorAll('details.fold'), function (d) { d.open = !!open[d.dataset.fold]; d.addEventListener('toggle', function () { open[d.dataset.fold] = d.open ? 1 : 0; lsSet('rr_fold', JSON.stringify(open)); }); }); }
  showMapName(); Game.showMap(mapSel);
  showLook();
  window.RR_refreshWardrobe = showLook;
  WHEELS.forEach(function (wh, k) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = ['綜合', '服裝', '寵物', '特效', '槍械'][k] || wh.n;
    b.addEventListener('click', function () { if (wheelBusy) return; wheelI = k; dwWin = -1; dwSel = 0; $('wheelWear').classList.add('hide'); wheelDraw(); });
    $('wheelSel').appendChild(b);
  });
  $('wheelWear').addEventListener('click', function () { show('scrPick'); });
  $('dwSkip').checked = ls('rr_skipAnim') === '1'; $('dwSkip').addEventListener('change', function () { lsSet('rr_skipAnim', $('dwSkip').checked ? '1' : '0'); });
  const openGear = function () { renderGear(); $('scrGear').classList.remove('hide'); $('scrGear').scrollTop = 0; try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {} };
  $('gearOpen').addEventListener('click', openGear); $('hudGear').addEventListener('click', openGear);
  $('gearDone').addEventListener('click', function () { $('scrGear').classList.add('hide'); });
  const openWheel = function () { dwWin = -1; $('wheelWear').classList.add('hide'); show('scrWheel'); wheelDraw(); };
  $('wheelOpen').addEventListener('click', openWheel); $('wheelOpen2').addEventListener('click', openWheel);
  $('wheelDone').addEventListener('click', function () { if (!wheelBusy) showMenu(); });
  $('wheelSpin').addEventListener('click', wheelSpin);
  $('shopOpen').addEventListener('click', function () { show('scrShop'); shopDraw(); });
  $('shopDone').addEventListener('click', function () { showMenu(); });
  $('spCancel').addEventListener('click', function () { $('spModal').classList.add('hide'); });
  $('spOk').addEventListener('click', shopBuy);
  setInterval(function () { if (!$('scrShop').classList.contains('hide')) shopDraw(); }, 30000);
  $('clanChatOpen').addEventListener('click', clanOpen);
  $('clanDone').addEventListener('click', clanClose);
  $('ccAsk').addEventListener('click', ccAsk);
  $('ccForm').addEventListener('submit', function (e) { e.preventDefault(); ccSend(); });
  $('ccInput').addEventListener('keydown', function (e) { e.stopPropagation(); });
  $('ccInput').addEventListener('keyup', function (e) { e.stopPropagation(); });
  $('pickBtn').addEventListener('click', function () { show('scrPick'); });
  $('pickDone').addEventListener('click', function () { showMenu(); });
  $('pickOk').addEventListener('click', function () { showMenu(); });
  // 說明頁：主題選單 → 單一主題；遊戲中也能從右上角「說明」打開（蓋在遊戲上，關掉就回到遊戲）
  const helpList = function () { $('helpTopic').classList.add('hide'); document.querySelector('#scrHelp .helpBody').classList.remove('hide'); };
  const helpOpen = function () { helpList(); $('scrHelp').classList.remove('hide'); $('scrHelp').scrollTop = 0; try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {} };
  const helpClose = function () { if (!$('helpTopic').classList.contains('hide')) { helpList(); return; } $('scrHelp').classList.add('hide'); };
  $('helpBtn').addEventListener('click', helpOpen);
  $('hudHelp').addEventListener('click', helpOpen);
  $('helpDone').addEventListener('click', helpClose);
  $('helpBack').addEventListener('click', helpList);
  Array.prototype.forEach.call(document.querySelectorAll('#helpMenu .hrow'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#helpTopic .htopic'), function (t) { t.classList.toggle('hide', t.dataset.topic !== b.dataset.topic); });
      document.querySelector('#scrHelp .helpBody').classList.add('hide'); $('helpTopic').classList.remove('hide'); $('scrHelp').scrollTop = 0;
    });
  });
  $('tutNext').addEventListener('click', function () { if (tutI < TUT.length - 1) tutShow(tutI + 1); else tutDone(); });
  Array.prototype.forEach.call(document.querySelectorAll('#regionAsk [data-r]'), function (b) { b.addEventListener('click', function () { const q = prog(); q.region = +b.dataset.r; progSave(q); lsSet('rr_region', '1'); $('regionAsk').classList.add('hide'); }); });
  $('tutSkip').addEventListener('click', tutDone);
  $('tutAgain').addEventListener('click', function () { tutShow(0); });
  $('miniInfoBtn').addEventListener('click', function () { Game.openMini(); });
  RR.Mini.init();
  // 設定
  const sens = parseFloat(ls('rr_sens') || '1'), sfx = parseFloat(ls('rr_sfx') || '0.8'), vv = parseFloat(ls('rr_voice') || '1');
  $('setQ').value = ls('rr_q') || (('ontouchstart' in window) ? 'mid' : 'high'); Game.setQuality($('setQ').value);
  // 隱藏的手機按鈕：存在 rr_hidebtn（逗號分隔），套用成 body 的 hb-xxx class
  const applyHide = function () { const h = (ls('rr_hidebtn') || '').split(',').filter(Boolean); Array.prototype.forEach.call($('btnChks').querySelectorAll('input'), function (c) { const id = c.dataset.btn, off = h.indexOf(id) >= 0; c.checked = !off; document.body.classList.toggle('hb-' + id, off); }); };
  Array.prototype.forEach.call($('btnChks').querySelectorAll('input'), function (c) { c.addEventListener('change', function () { const h = Array.prototype.filter.call($('btnChks').querySelectorAll('input'), function (x) { return !x.checked; }).map(function (x) { return x.dataset.btn; }); lsSet('rr_hidebtn', h.join(',')); applyHide(); }); });
  applyHide();
  $('setLefty').checked = ls('rr_lefty') === '1'; Game.setLefty($('setLefty').checked);
  $('setLefty').addEventListener('change', function () { lsSet('rr_lefty', $('setLefty').checked ? '1' : '0'); Game.setLefty($('setLefty').checked); });
  $('setFps').checked = ls('rr_fps') === '1'; Game.settings.showFps = $('setFps').checked;
  $('setFps').addEventListener('change', function () { lsSet('rr_fps', $('setFps').checked ? '1' : '0'); Game.settings.showFps = $('setFps').checked; });
  $('setQ').addEventListener('change', function () { lsSet('rr_q', $('setQ').value); Game.setQuality($('setQ').value); });
  Game.onQuality = function (q) { $('setQ').value = q; };
  $('setBtn').value = ls('rr_btn') || '1'; Game.setBtnScale($('setBtn').value);
  $('setBtn').addEventListener('input', function () { lsSet('rr_btn', $('setBtn').value); Game.setBtnScale($('setBtn').value); });
  $('btnEditOpen').addEventListener('click', function () { $('scrHelp').classList.add('hide'); Game.editButtons(); });
  $('setSens').value = sens; $('setSfx').value = sfx; $('setVoice').value = vv; $('setMusic').value = ls('rr_music') || '0.6';
  Game.settings.sens = sens;
  const apply = function () {
    Game.settings.sens = parseFloat($('setSens').value); lsSet('rr_sens', $('setSens').value);
    Sfx.setVolume(parseFloat($('setSfx').value)); lsSet('rr_sfx', $('setSfx').value);
    Voice.setVolume(parseFloat($('setVoice').value)); lsSet('rr_voice', $('setVoice').value);
    RR.Music.setVolume(parseFloat($('setMusic').value)); lsSet('rr_music', $('setMusic').value);
  };
  ['setSens', 'setSfx', 'setVoice', 'setMusic'].forEach(function (id) { $(id).addEventListener('input', apply); });
  document.addEventListener('click', function once() { document.removeEventListener('click', once); apply(); });
  window.addEventListener('pagehide', function () { if (S.mode === 'client') Net.send({ t: 'bye' }); Net.leave(); });
  // 一開網頁就喚醒伺服器，之後每 4 分鐘再叫一次，避免在選單或大廳等待時又睡著
  Net.warm(); setInterval(function () { if (!document.hidden) Net.warm(); }, 240000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) Net.warm(); });
}

function boot() {
  if (!Game.init()) { show(null); say('這個瀏覽器無法啟動 3D 畫面（需要 WebGL）。'); return; }
  bind();
  Game.onAttack = function (yaw) {
    if (S.mode === 'client') Net.send({ t: 'atk', yaw: yaw });
    else if (S.sim) S.sim.attack(S.myId, yaw);
  };
  Game.onBomb = function (yaw) {
    if (S.mode === 'client') Net.send({ t: 'bomb', yaw: yaw });
    else if (S.sim) S.sim.bomb(S.myId, yaw);
  };
  Game.onTower = function () {
    if (S.mode === 'client') Net.send({ t: 'tower' });
    else if (S.sim) S.sim.buildTower(S.myId);
  };
  Game.onShoot = function (yaw) {
    if (S.mode === 'client') Net.send({ t: 'gun', yaw: yaw });
    else if (S.sim) S.sim.shoot(S.myId, yaw);
  };
  try {
    const m = /[?&]room=([A-Za-z0-9]{5})/.exec(location.search);
    if (m) { $('codeInput').value = m[1].toUpperCase(); $('joinModal').classList.remove('hide'); }
  } catch (e) {}
  RR.Cloud.hooks({ prog: prog, name: myName, level: function () { return levelOf(prog().xp); },
    adopt: function (p) { lsSet('rr_prog', JSON.stringify(p)); renderProg(); if (!S.mode && Auth.user()) { refreshPickSummary(); say('已從雲端取回你的進度。'); } } });
  $('socialOpen').addEventListener('click', function () { $('scrSocial').classList.remove('hide'); $('scrSocial').scrollTop = 0; renderSocial(); });
  $('socDone').addEventListener('click', function () { $('scrSocial').classList.add('hide'); renderSocial.token = null; });
  Array.prototype.forEach.call(document.querySelectorAll('#socTabs button'), function (x) { x.addEventListener('click', function () { socTab = x.dataset.tab; renderSocial(); }); });
  let lastUid = null;
  Auth.init(function (user) {
    if (!user) { lastUid = null; RR.Cloud.onUser(null); if (S.mode) leave(); else show('scrLogin'); return; }
    if (!S.mode) showMenu();
    if (user.uid !== lastUid) { lastUid = user.uid; RR.Cloud.onUser(user, function () { renderProg(); if (!S.mode) dailyLogin(); }); }
  });
}
boot();
wakeServer();
$('busyCancel').addEventListener('click', function () { netCancel = true; Net.leave(); busy(false); });
let installEv = null;
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEv = e; const b = document.getElementById('installBtn'); if (b) b.classList.remove('hide'); });
window.addEventListener('appinstalled', function () { installEv = null; const b = document.getElementById('installBtn'); if (b) b.classList.add('hide'); });
{ const ib = document.getElementById('installBtn'); if (ib) ib.addEventListener('click', function () { if (!installEv) return; installEv.prompt(); installEv.userChoice.finally(function () { installEv = null; ib.classList.add('hide'); }); }); }
// 離線快取與「加到主畫面」（只在 https 上啟用；本機測試不註冊）
if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
{ const bt = document.getElementById('boot'); if (bt) { bt.classList.add('gone'); setTimeout(function () { bt.remove(); }, 400); } }
})();
