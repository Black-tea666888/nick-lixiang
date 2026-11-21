/* 流程：登入 → 選單 → 大廳 → 遊戲 → 結算；以及房主迴圈、訊息分派、聊天 */
(function () {
'use strict';
const RR = window.RR, W = RR.World, Net = RR.Net, Voice = RR.Voice, Sfx = RR.Sfx, Auth = RR.Auth, Game = RR.Game;
const $ = function (id) { return document.getElementById(id); };
const CSSCOL = ['#ffb84a', '#6ecbff', '#c79bff', '#ff7eb6'];
// 每次更新改這裡：版本號變了，主頁就會跳出一次更新提醒（記在 rr_upd_seen）
const UPD = { v: 'v270', items: ['近戰一刀秒殺怪物；死守模式出生在地圖正中間'] };
const SCREENS = ['scrLogin', 'scrMenu', 'scrPick', 'scrWheel', 'scrLobby', 'scrResult', 'scrMap', 'scrShop', 'scrClan', 'scrMarket', 'scrLevel', 'scrCard', 'scrHub', 'scrChess', 'scrPlat', 'scrMarble', 'scrXq', 'scrRummi', 'scrGomoku', 'scrC4', 'scrFlight', 'scrPachi', 'scrKangle'];
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
/* ---------- 自製下拉選單 ----------
 * 原生 <select> 的選單是手機系統畫的，每台裝置長得不一樣。這裡把畫面上所有 <select> 換成遊戲風格的按鈕＋選單面板；
 * 原本的 <select> 留著（隱藏）負責存值與觸發 change，所以其他程式不用改。之後新加的 <select> 也會自動換掉。 */
const SEL_PROTO = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const SEL_IDX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
function fancySelect(sel) {
  if (sel.dataset.fancy) return; sel.dataset.fancy = '1';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fsel';
  if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
  btn.setAttribute('aria-haspopup', 'listbox');
  const label = function () { const o = sel.options[SEL_IDX.get.call(sel)]; btn.textContent = o ? o.textContent : ''; };
  Object.defineProperty(sel, 'value', { configurable: true, get: function () { return SEL_PROTO.get.call(sel); }, set: function (v) { SEL_PROTO.set.call(sel, v); label(); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get: function () { return SEL_IDX.get.call(sel); }, set: function (v) { SEL_IDX.set.call(sel, v); label(); } });
  new MutationObserver(label).observe(sel, { childList: true, subtree: true, characterData: true });
  btn.addEventListener('click', function () {
    const ov = document.createElement('div'); ov.className = 'fselOv';
    const panel = document.createElement('div'); panel.className = 'fselPanel'; panel.setAttribute('role', 'listbox'); ov.appendChild(panel);
    Array.prototype.forEach.call(sel.options, function (o, i) {
      const it = document.createElement('button'); it.type = 'button'; it.className = 'fselItem' + (i === SEL_IDX.get.call(sel) ? ' on' : ''); it.setAttribute('role', 'option');
      it.textContent = o.textContent; it.disabled = o.disabled;
      it.addEventListener('click', function () { ov.remove(); if (i === SEL_IDX.get.call(sel)) return; SEL_IDX.set.call(sel, i); label(); sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true })); });
      panel.appendChild(it);
    });
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    const cur = panel.querySelector('.on'); if (cur) cur.scrollIntoView({ block: 'center' }); (cur || panel.firstChild || panel).focus && (cur || panel.firstChild).focus();
  });
  sel.classList.add('fselNative'); sel.insertAdjacentElement('afterend', btn); label();
}
function fancyAll(root) { Array.prototype.forEach.call((root || document).querySelectorAll('select'), fancySelect); }
new MutationObserver(function (list) { list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType !== 1) return; if (n.tagName === 'SELECT') fancySelect(n); else if (n.querySelectorAll) fancyAll(n); }); }); }).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', function () { fancyAll(); }); fancyAll();
function lsSet(k, v) { const same = ls(k) === String(v); try { localStorage.setItem(k, v); } catch (e) {} if (!same && RR.Cloud) RR.Cloud.localChanged(k); }
let showMapName = function () {};
function show(id) { SCREENS.forEach(function (s) { $(s).classList.toggle('hide', s !== id); }); $('mailBtn').classList.toggle('hide', id !== 'scrHub'); bannerHide(); const rh = document.getElementById('raceHud'); if (rh) rh.classList.add('hide'); if (id === 'scrHub') hubCounts(); }
/** 回到大廳：先離開所有休閒模式的在玩紀錄，再更新卡片上的人數 */
function pres(m, on) { if (RR.Cloud) RR.Cloud.presence(m, on); }
function hubCounts() {
  if (!RR.Cloud) return;
  ['marble', 'plat', 'chess'].forEach(function (m) { pres(m, false); });
  RR.Cloud.modeCounts(function (e, c) {
    ['marble', 'plat', 'chess'].forEach(function (m) {
      const el = document.querySelector('[data-pc="' + m + '"]');
      if (el) el.textContent = e ? '' : '在玩 ' + (c[m] | 0) + ' 人';
    });
  });
}   // 離開遊戲畫面時一起收起賽車計時
let sayDone = null, askYes = null;
function say(text, done) { $('msgText').textContent = text; $('msg').classList.remove('hide'); sayDone = done || null; }
function ask(text, onYes) { $('askText').textContent = text; askYes = onYes; $('askDlg').classList.remove('hide'); }
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
  return { c: n('rr_c'), w: n('rr_w'), h: p.hats.indexOf(h) >= 0 ? h : 0, o: own('o', n('rr_o')), pet: own('pet', n('rr_pet')), gun: Math.min(W.GUNS.length - 1, n('rr_gun')), eq: myEquip(p), gems: p.gems, bt: W.bagTierOf(levelOf(p.xp)) };
}
// 只影響自己畫面的造型：回收品、怪物、彈道
function applyLocalSkins() {
  const p = prog(), n = function (k) { return parseInt(ls(k) || '0', 10) || 0; }, own = function (cat, v) { return p.own[cat].indexOf(v) >= 0 ? v : 0; };
  Game.settings.itemSkin = own('is', n('rr_is')); Game.settings.fx = own('fx', n('rr_fx')); Game.setGunSkin(own('gs', n('rr_gs')));
  const ms = own('ms', n('rr_ms')); if ((Game.settings.monSkin | 0) !== ms) Game.setMonSkin(ms);
}
const SKIN_NAMES = { is: ['預設', '糖果', '寶石'], ms: ['預設', '骸骨白', '霓虹'], fx: ['金黃', '冰藍', '粉紅', '紫光', '熔岩紅', '星塵銀', '極光綠', '霓虹藍'], gs: ['原廠', '沙漠迷彩', '叢林迷彩', '黃金', '黑金', '霓虹粉', '寒冰', '極地迷彩', '熔岩裂紋', '全息', '鈦合金', '暗夜霓虹'] };
// 第二輪才會抽到的造型：不進商店（只能靠轉蛋機）
const WHEEL2_ONLY = { fx: 4, gs: 7 };
const PET_NOTE = ['', '速度 +5%', '偵測 +8m', '賣出 +10%', '體力 +20%'];
function catNames(cat) { return cat === 'o' ? W.COSTUMES : cat === 'pet' ? W.PETS : cat === 'hat' ? W.HATS : SKIN_NAMES[cat]; }
const CAT_LABEL = { o: '服裝', pet: '寵物', hat: '頭飾', is: '回收品造型', ms: '怪物造型', fx: '彈道特效', gs: '槍枝造型' };
function owns(p, cat, i) { return cat === 'hat' ? p.hats.indexOf(i) >= 0 : p.own[cat].indexOf(i) >= 0; }
/* ---------- 回收抽獎機 ---------- */
const WHEELS = [
  { n: '綜合', cost: 50, seg: [['o'], ['pet'], ['hat'], ['is'], ['coin', 30], ['ms'], ['fx'], ['gs']] },
  { n: '服裝', cost: 80, seg: [['o', 1], ['o', 2], ['o', 3], ['o', 4], ['o', 5], ['coin', 30], ['coin', 60], ['coin', 100]] },
  { n: '寵物', cost: 80, seg: [['pet', 1], ['coin', 20], ['pet', 2], ['coin', 40], ['pet', 3], ['coin', 60], ['pet', 4], ['coin', 100]] },
  { n: '造型特效', cost: 60, seg: [['is', 1], ['is', 2], ['ms', 1], ['ms', 2], ['fx', 1], ['fx', 2], ['fx', 3], ['coin', 50]],
    seg2: [['fx', 4], ['fx', 5], ['fx', 6], ['fx', 7], ['coin', 50], ['coin', 60], ['coin', 80], ['coin', 100]] },
  { n: '槍枝造型', cost: 60, seg: [['gs', 1], ['gs', 2], ['gs', 3], ['gs', 4], ['gs', 5], ['gs', 6], ['coin', 30], ['coin', 60]],
    seg2: [['gs', 7], ['gs', 8], ['gs', 9], ['gs', 10], ['gs', 11], ['coin', 30], ['coin', 60], ['coin', 100]] }
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
  bag: '<path d="M6 8h12l1 13H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2M8 13h8"/>',
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
/** 這台機器現在的獎品：第一輪全部抽到後自動進第二輪（只有有 seg2 的機器） */
function wheelSeg(p, i) {
  const w = WHEELS[i]; p.wr = Array.isArray(p.wr) ? p.wr : [];
  if (!(p.wr[i] | 0) && w.seg2 && w.seg.every(function (sg) { return sg[0] === 'coin' || owns(p, sg[0], sg[1]); })) { p.wr[i] = 1; progSave(p); say('「' + w.n + '」第一輪全部抽到了，進入第二輪！'); }
  return (p.wr[i] | 0) && w.seg2 ? w.seg2 : w.seg;
}
function dwPreview(i) {
  const p = prog(), sg = wheelSeg(p, wheelI)[i], look = myLook(); dwSel = i;
  Array.prototype.forEach.call($('dwGrid').querySelectorAll('.dwCell'), function (c) { c.classList.toggle('sel', +c.dataset.i === i); });
  $('dwKind').textContent = sg[0] === 'coin' ? '金幣' : sg.length === 1 ? '隨機' + CAT_LABEL[sg[0]] : CAT_LABEL[sg[0]];
  $('dwName').textContent = segLabel(sg); $('dwDesc').textContent = segDesc(sg, p);
  const cv = $('dwCanvas'), ic = $('dwIcon'); let three = false;
  if (sg.length > 1 && sg[0] === 'gs') { Game.gunPreview(cv, look.gun, sg[1]); three = true; }
  else if (sg.length > 1 && (sg[0] === 'o' || sg[0] === 'pet' || sg[0] === 'hat')) { Game.preview(cv, look.c, look.w, sg[0] === 'hat' ? sg[1] : look.h, sg[0] === 'o' ? sg[1] : look.o, sg[0] === 'pet' ? sg[1] : look.pet, true); three = true; }
  cv.classList.toggle('hide', !three); ic.classList.toggle('hide', three); ic.innerHTML = three ? '' : iconSvg(sg[0]);
}
function wheelDraw() {
  const wh = WHEELS[wheelI], p = prog(), seg = wheelSeg(p, wheelI);
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
    const sg = seg[ri], own = sg.length > 1 && sg[0] !== 'coin' && owns(p, sg[0], sg[1]);
    const c = document.createElement('button'); c.type = 'button'; c.className = 'dwCell t-' + segTier(sg) + (own ? ' own' : '') + (ri === dwWin ? ' won' : ''); c.dataset.i = ri;
    c.innerHTML = iconSvg(sg[0]) + '<b></b><small></small>';
    c.querySelector('b').textContent = segLabel(sg); c.querySelector('small').textContent = own ? '已擁有' : sg.length === 1 && sg[0] !== 'coin' ? poolStatus(p, sg) : segKind(sg);
    c.addEventListener('click', function () { if (!wheelBusy) dwPreview(ri); });
    g.appendChild(c);
  }
  dwPreview(Math.min(dwSel, seg.length - 1));
}
function wheelSpin() {
  if (wheelBusy) return;
  const wh = WHEELS[wheelI], p = prog(), free = wheelI === 0 && p.freeDay !== today();
  if (!wheelSeg(p, wheelI).some(function (sg) { return sg[0] === 'coin' || !owns(p, sg[0], sg[1]); })) say('這台的獎品已經全部收集，之後抽到會換成金幣。');
  if (!free && p.coins < wh.cost) { say('金幣不夠：這台一次要 ' + wh.cost + ' 金幣，你有 ' + p.coins + '。過關、每日任務和小遊戲可以賺金幣。'); return; }
  if (free) p.freeDay = today(); else p.coins -= wh.cost;
  const seg = wheelSeg(p, wheelI), idx = Math.floor(Math.random() * seg.length), sg = seg[idx];
  let msg, fresh = false, shown = sg;
  if (sg[0] === 'coin') { p.coins += sg[1]; msg = '金幣 +' + sg[1]; }
  else {
    const cat = sg[0], names = catNames(cat);
    let pickI = sg[1];
    if (pickI == null) { const pool = []; for (let k = 1; k < names.length; k++) if (!owns(p, cat, k) && !(cat === 'hat' && k === LIMITED_HAT)) pool.push(k); pickI = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 1 + Math.floor(Math.random() * (cat === 'hat' ? LIMITED_HAT - 1 : names.length - 1)); }
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
  Object.keys(SHOP_PRICE).forEach(function (cat) { const names = catNames(cat); for (let i = 1; i < names.length; i++) if (!(WHEEL2_ONLY[cat] && i >= WHEEL2_ONLY[cat])) pool.push([cat, i]); });
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
/* ---------- 拾荒團聊天 ---------- */
const ASK_CD = 7 * 3600e3;
let ccOff = null, ccRows = [], ccLast = 0, ccTimer = null;
function ccNote(text, btn) {
  const log = $('ccLog'); log.textContent = ''; log.appendChild(mk('p', 'ccEmpty', text));
  if (btn) { const b = mk('button', 'btn primary', btn); b.type = 'button'; b.addEventListener('click', function () { clanFrom = null; clanClose(); socTab = 'clan'; $('scrSocial').classList.remove('hide'); renderSocial(); }); log.appendChild(b); }
}
// 拾荒團未讀：背景監看拾荒團訊息，未讀數顯示在「拾荒團聊天」與「社群」按鈕上
let ccWatch = null, ccWatchClan = '', ccUnread = 0, rankUnread = 0, rankT = 0;
function ccSeen() { return +(ls('rr_cc_seen') || 0); }
function ccBadgeDraw() {
  const ccN = ccUnread + rankUnread;
  [['ccBadge', ccUnread], ['socBadge', ccN]].forEach(function (x) { const el = $(x[0]), n = x[1]; el.textContent = n > 99 ? '99+' : String(n); el.classList.toggle('hide', n <= 0); });
}
// 排行榜被超越提醒：各模式（總榜）記下上次看到的名次，名次變差就算未讀；打開社群時清除
function rankWatch(view) {
  const C = RR.Cloud, uid = C.ready() && C.me() ? C.uid() : '';
  if (!uid) return;
  if (!view && Date.now() - rankT < 600000) return;
  rankT = Date.now();
  let left = C.MODES.length, unread = 0;
  C.MODES.forEach(function (m) {
    C.top(m, 'all', function (err, rows) {
      if (!err && rows) {
        const i = rows.findIndex(function (r) { return r.uid === uid; }), now = i < 0 ? 99 : i + 1, key = 'rr_rank_seen_' + m, seen = +(ls(key) || 0);
        if (view || !seen) { lsSet(key, String(now)); }
        else if (now > seen) { unread++; }
      }
      if (--left === 0) { rankUnread = view ? 0 : unread; ccBadgeDraw(); }
    });
  });
}
function ccWatchStart() {
  const C = RR.Cloud, me = C.me(), clan = me && me.clan ? me.clan : '';
  if (clan === ccWatchClan) return;
  if (ccWatch) ccWatch(); ccWatch = null; ccWatchClan = clan; ccUnread = 0; ccBadgeDraw();
  if (!clan || !C.ready()) return;
  ccWatch = C.clanChat(function (err, rows) {
    if (err || !rows) return;
    if (!$('scrClan').classList.contains('hide') && rows.length) { lsSet('rr_cc_seen', String(rows[0].t || Date.now())); }
    ccUnread = rows.filter(function (r) { return (r.t || 0) > ccSeen() && r.uid !== C.uid(); }).length; ccBadgeDraw();
  });
}
/* ---------- 交易所：世界頻道與玩家掛單 ----------
 * 用金幣買賣造型、頭飾、配件、寶石等級。掛單時先從自己身上扣掉（下架才退回），
 * 有人買下後，買家當場拿到東西，賣家下次打開交易所時收到金幣。 */
let wcOff = null, mkOff = null, wcRows = [], mkRows = [], mkTab = 'chat';
const TRADE_CATS = ['o', 'pet', 'hat', 'is', 'ms', 'fx', 'gs'];
function tradeLabel(kind, it) {
  if (kind === 'skin') return CAT_LABEL[it.cat] + '「' + ((catNames(it.cat) || [])[it.i] || '?') + '」';
  if (kind === 'acc') return '配件「' + (W.ACCS[it.i] || '?') + '」';
  return (W.GEMS[it.i] || '寶石') + ' 1 級';
}
/** 身上可以賣的東西（預設款不能賣） */
function tradeables(p) {
  const out = [];
  TRADE_CATS.forEach(function (cat) { (cat === 'hat' ? p.hats : p.own[cat]).forEach(function (i) { if (i > 0) out.push({ kind: 'skin', item: { cat: cat, i: i } }); }); });
  p.acc.forEach(function (i) { out.push({ kind: 'acc', item: { i: i } }); });
  p.gems.forEach(function (lv, i) { if (lv > 0) out.push({ kind: 'gem', item: { i: i } }); });
  return out;
}
function tradeHas(p, kind, it) {
  if (kind === 'skin') return (it.cat === 'hat' ? p.hats : p.own[it.cat] || []).indexOf(it.i) >= 0;
  if (kind === 'acc') return p.acc.indexOf(it.i) >= 0;
  return p.gems[it.i] > 0;
}
/** 買家能不能收：已經有的造型、配件不能再買；寶石最多 5 級 */
function tradeCanGet(p, kind, it) {
  if (kind === 'skin') return TRADE_CATS.indexOf(it.cat) >= 0 && !tradeHas(p, kind, it);
  if (kind === 'acc') return it.i > 0 && it.i < W.ACCS.length && p.acc.indexOf(it.i) < 0;
  return it.i >= 0 && it.i < 3 && p.gems[it.i] < 5;
}
function tradeTake(p, kind, it) {
  if (kind === 'skin') { const a = it.cat === 'hat' ? p.hats : p.own[it.cat]; a.splice(a.indexOf(it.i), 1); }
  else if (kind === 'acc') p.acc.splice(p.acc.indexOf(it.i), 1);
  else p.gems[it.i]--;
}
function tradeGive(p, kind, it) {
  if (kind === 'skin') (it.cat === 'hat' ? p.hats : p.own[it.cat]).push(it.i);
  else if (kind === 'acc') p.acc.push(it.i);
  else p.gems[it.i] = Math.min(5, p.gems[it.i] + 1);
}
function mkCoins() { const c = prog().coins; $('coinTag6').textContent = c; renderProg(); }
function marketOpen() {
  show('scrMarket'); mkCoins(); mkSetTab(mkTab);
  mkFillSelect();
  const C = RR.Cloud;
  if (!C || !C.ready()) { $('wcLog').textContent = ''; $('wcLog').appendChild(mk('p', 'ccEmpty', '交易所要先登入（Google、Apple、LINE、Facebook 或訪客）並連上網路。')); $('mkList').textContent = ''; $('mkList').appendChild(mk('p', 'ccEmpty', '交易所要先登入並連上網路才能看掛單。')); tmNote('快速組隊要先登入並連上網路。'); return; }
  if (wcOff) wcOff(); if (mkOff) mkOff();
  wcOff = C.worldChat(function (err, rows) { if (err) { mtoast(C.message(err), 'warn'); return; } wcRows = rows; wcDraw(); });
  mkOff = C.marketWatch(function (err, rows) { if (err) { mtoast(C.message(err), 'warn'); return; } mkRows = rows; mkDraw(); });
  if (tmOff) tmOff(); tmOff = C.roomsWatch(function (err, rows) { if (err) { tmNote(C.message(err)); return; } tmRows = rows; tmDraw(); });
  // 收款：自己賣出去的東西
  C.marketPayouts(function (err, rows) {
    if (err || !rows.length) return;
    const q = prog(); let sum = 0; rows.forEach(function (r) { sum += r.price; tradeLogAdd('sell', r.label, r.price, r.buyerName); }); q.coins += sum; progSave(q); mkCoins();
    bannerShow('交易成功：賣出 ' + (rows.length > 1 ? rows.length + ' 件' : rows[0].label), '收到 ' + sum + ' 金幣');
    say('交易所收款：' + rows.map(function (r) { return r.buyerName + ' 買了你的' + r.label + '（' + r.price + ' 金幣）'; }).join('、') + '。共收到 ' + sum + ' 金幣。');
  });
  mkFillSelect();
}
let clanFrom = null, pickFrom = null;
function marketClose(keep) { if (wcOff) wcOff(); if (mkOff) mkOff(); if (tmOff) tmOff(); wcOff = mkOff = tmOff = null; bannerHide(); if (!keep) showMenu(); }
/* 快速組隊：列出別人公開的房間，點「加入」或「快速加入」直接進房 */
let tmOff = null, tmRows = [];
function tmNote(t) { const l = $('tmList'); l.textContent = ''; l.appendChild(mk('p', 'ccEmpty', t)); }
function tmJoin(code) { if (wcOff) wcOff(); if (mkOff) mkOff(); if (tmOff) tmOff(); wcOff = mkOff = tmOff = null; $('scrMarket').classList.add('hide'); $('codeInput').value = code; joinRoom(); }
function tmDraw() {
  const l = $('tmList'); l.textContent = '';
  if (!tmRows.length) { tmNote('目前沒有公開的房間。按「建立房間」開一個，別人就能快速加入。'); return; }
  tmRows.forEach(function (r) {
    const row = mk('div', 'tmRow'), av = mk('span', 'ccAv', (r.hostName || '?').charAt(0)); av.style.background = '#f0c040';
    const info = mk('div', 'tmInfo'); info.appendChild(mk('b', null, (r.hostName || '玩家') + ' 的房間'));
    info.appendChild(mk('span', null, (MODE_NAME[r.mode] || '組隊回收') + (r.map ? '・' + r.map : '') + (r.play ? '・遊戲中' : '・等待中')));
    statsLink(av, r.host, r.hostName);
    const n = mk('span', 'tmN', (r.n | 0) + '/' + (r.max || 4));
    const bt = mk('button', 'btn primary', '加入'); bt.type = 'button'; bt.addEventListener('click', function () { tmJoin(r.code); });
    row.appendChild(av); row.appendChild(info); row.appendChild(n); row.appendChild(bt); l.appendChild(row);
  });
}
/** 房主：每 30 秒或人數改變時更新公開房間資料 */
let tmPubT = 0, tmPubKey = '';
function tmPublish() {
  if (S.mode !== 'host' || !S.sim || !RR.Cloud || !RR.Cloud.ready()) return;
  const n = S.sim.players.filter(function (p) { return !p.ai; }).length, play = S.sim.phase === 'play', key = n + '|' + play + '|' + S.sim.mode;
  if (key === tmPubKey && Date.now() - tmPubT < 30000) return;
  tmPubKey = key; tmPubT = Date.now();
  RR.Cloud.roomPublish(Net.code(), { mode: S.sim.mode, map: (W.MAPS[S.sim.map | 0] || {}).name || '', n: n, max: S.sim.mode === 'br' ? 6 : 4, play: play });
}
function mkSetTab(t) {
  if (t === 'clan') { marketClose(true); clanFrom = 'market'; clanOpen(); return; }
  mkTab = t;
  document.getElementById('scrMarket').classList.toggle('tmOn', t === 'team');
  Array.prototype.forEach.call(document.querySelectorAll('.mkTabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
  $('wcLog').classList.toggle('hide', t !== 'chat' && t !== 'team'); $('wcForm').classList.toggle('hide', t !== 'chat' && t !== 'team');
  $('mkList').classList.toggle('hide', t !== 'shop'); $('mkForm').classList.toggle('hide', t !== 'shop');
}
function wcDraw() {
  const my = RR.Cloud.uid(), log = $('wcLog');
  log.textContent = '';
  if (!wcRows.length) { log.appendChild(mk('p', 'ccEmpty', '世界頻道還沒有人說話。打個招呼，或喊價買賣。')); return; }
  let lastT = 0;
  wcRows.slice().reverse().forEach(function (m) {
    if ((m.t || 0) - lastT > 300000) { const d = new Date(m.t || 0); log.appendChild(mk('div', 'wcTime', String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'))); }
    lastT = m.t || 0;
    const mine = m.uid === my, r = mk('div', 'wcMsg' + (mine ? ' me' : '')), av = mk('span', 'wcAv', (m.name || '?').charAt(0)), body = mk('div', 'wcBody'), head = mk('div', 'wcHead');
    const img = mine ? ls('rr_avatar_img') : '';
    if (img) { av.textContent = ''; av.style.background = 'center / cover no-repeat url(' + img + ')'; } else av.style.background = (mine && ls('rr_avatar')) || ['#f0c040', '#6ad8ff', '#ff8a6a', '#9be564', '#c9a0ff'][((m.name || '').charCodeAt(0) || 0) % 5];
    head.appendChild(mk('b', null, mine ? '你' : (m.name || '玩家'))); if (m.lv) head.appendChild(mk('i', 'wcLv', 'Lv.' + m.lv));
    body.appendChild(head); body.appendChild(mk('div', 'wcText' + (/^【掛單】/.test(m.text) ? ' deal' : ''), m.text));
    statsLink(av, m.uid, m.name); statsLink(head, m.uid, m.name);
    r.appendChild(av); r.appendChild(body); log.appendChild(r);
  });
  log.scrollTop = log.scrollHeight;
}
function mkDraw() {
  const my = RR.Cloud.uid(), list = $('mkList'), p = prog();
  list.textContent = '';
  if (!mkRows.length) { list.appendChild(mk('p', 'ccEmpty', '目前沒有人掛單。用下面的欄位把你多的造型、配件或寶石賣掉。')); tradeLogDraw(list); return; }
  mkRows.forEach(function (o) {
    const mine = o.seller === my, card = mk('div', 'ccReq' + (mine ? ' me' : ''));
    card.appendChild(mk('div', 'ccWho', (mine ? '你' : o.sellerName) + ' 在賣'));
    const body = mk('div', 'ccBody'), info = mk('div', 'mkInfo');
    info.appendChild(mk('b', null, o.label)); info.appendChild(mk('span', null, o.price + ' 金幣')); body.appendChild(info);
    let btn;
    if (mine) {
      btn = mk('button', 'btn', '下架');
      btn.addEventListener('click', function () {
        btn.disabled = true;
        RR.Cloud.marketCancel(o.id, function (err, d) {
          if (err) { mtoast(err.code === 'sold' ? '已經有人買走了' : RR.Cloud.message(err), 'warn'); btn.disabled = false; return; }
          const q = prog(); tradeGive(q, d.kind, d.item); progSave(q); pushEquip(myEquip(q)); mkFillSelect();
          tradeLogAdd('cancel', d.label, 0); bannerShow('已下架：' + d.label, '物品已還給你'); mkDraw();
        });
      });
    } else {
      const ok = tradeCanGet(p, o.kind, o.item || {}), rich = p.coins >= o.price;
      btn = mk('button', 'btn' + (ok && rich ? ' primary' : ''), !ok ? (o.kind === 'gem' ? '已滿級' : '已擁有') : rich ? '買' : '金幣不夠');
      btn.disabled = !ok || !rich;
      btn.addEventListener('click', function () {
        ask('用 ' + o.price + ' 金幣買' + o.label + '？', function () {
          btn.disabled = true;
          RR.Cloud.marketBuy(o.id, function (err, d) {
            if (err) { mtoast(err.code === 'sold' || err.code === 'gone' ? '慢了一步，已經被買走了' : RR.Cloud.message(err), 'warn'); btn.disabled = false; return; }
            const q = prog(); q.coins = Math.max(0, q.coins - (d.price | 0)); if (tradeCanGet(q, d.kind, d.item)) tradeGive(q, d.kind, d.item); progSave(q);
            RR.Cloud.marketGot(o.id); mkCoins(); mkFillSelect();
            tradeLogAdd('buy', d.label, d.price, o.sellerName); bannerShow('交易成功：買到 ' + d.label, '花費 ' + (d.price | 0) + ' 金幣，已放進你的收藏');
          });
        });
      });
    }
    body.appendChild(btn); card.appendChild(body); list.appendChild(card);
  });
  tradeLogDraw(list);
}
/* 交易紀錄（存在本機，最近 50 筆）與成功橫幅 */
const TRADE_TXT = { buy: '買入', sell: '賣出', post: '掛單', cancel: '下架' };
function tradeLogList() { try { return JSON.parse(localStorage.getItem('rr_trades') || '[]'); } catch (e) { return []; } }
function tradeLogAdd(k, label, price, who) {
  lsSet('rr_trades', JSON.stringify([{ t: Date.now(), k: k, label: label || '', price: price | 0, who: who || '' }].concat(tradeLogList()).slice(0, 50)));
}
function tradeLogDel(i) {
  const l = tradeLogList(); l.splice(i, 1);
  lsSet('rr_trades', JSON.stringify(l)); mkDraw();
}
function tradeLogDraw(list) {
  const head = mk('div', 'sec', '交易紀錄');
  if (tradeLogList().length) {
    const clr = mk('button', 'btn', '清空'); clr.type = 'button';
    clr.addEventListener('click', function () { ask('清空所有交易紀錄？（只刪除本機紀錄，不影響物品）', function () { lsSet('rr_trades', '[]'); mkDraw(); }); });
    head.appendChild(clr);
  }
  list.appendChild(head);
  const logs = tradeLogList();
  if (!logs.length) { list.appendChild(mk('p', 'ccEmpty', '還沒有交易紀錄。')); return; }
  logs.forEach(function (x, i) {
    const d = new Date(x.t), tm = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const r = mk('div', 'srow'), nm = mk('span', 'nm', TRADE_TXT[x.k] + ' ' + x.label + (x.who ? '（' + x.who + '）' : ''));
    nm.appendChild(mk('small', null, '　' + tm)); r.appendChild(nm);
    r.appendChild(mk('span', 'sc', x.k === 'sell' ? '+' + x.price : x.k === 'buy' ? '-' + x.price : x.k === 'post' ? x.price + ' 金幣' : ''));
    const del = mk('button', 'btn', '刪'); del.type = 'button';
    del.addEventListener('click', function () { tradeLogDel(i); });
    r.appendChild(del);
    list.appendChild(r);
  });
}
/* 房間邀請：好友或同拾荒團的人送來的邀請，頂部橫幅顯示；每秒檢查一次是否過期（90 秒） */
let invRows = [], invOff = null;
const INV_TTL = 90000;
function invWatchStart() { if (invOff) invOff(); invOff = RR.Cloud.invitesWatch(function (rows) { invRows = rows; invRender(); }); }
function invWatchStop() { if (invOff) invOff(); invOff = null; invRows = []; invRender(); }
function invRender() {
  const now = Date.now(), el = $('invBanner');
  if (!el) return;
  invRows.forEach(function (x) { if (now - (Number(x.t) || 0) >= INV_TTL) RR.Cloud.inviteDismiss(x.from); });
  invRows = invRows.filter(function (x) { return x.from && now - (Number(x.t) || 0) < INV_TTL; }).sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
  const x = invRows[0];
  if (!x) { el.classList.add('hide'); return; }
  el.querySelector('b').textContent = (x.fromName || '玩家') + ' 邀請你加入房間';
  el.querySelector('span').textContent = (LOBBY_MODE[x.mode] || '') + '　房間 ' + x.room;
  el.classList.remove('hide');
}
function invAccept() {
  const x = invRows[0]; if (!x) return;
  RR.Cloud.inviteDismiss(x.from); invRows = invRows.slice(1); invRender();
  if (S.mode) leave();
  $('codeInput').value = x.room; joinRoom();
}
function invDecline() {
  const x = invRows[0]; if (!x) return;
  RR.Cloud.inviteDismiss(x.from); invRows = invRows.slice(1); invRender();
}
/* 房間內的「邀請朋友」：列出好友與拾荒團成員，各自按一下送出邀請 */
function invPickOpen() {
  const C = RR.Cloud, room = Net.code && Net.code(), list = $('invList');
  if (!room) { say('先建立或加入房間，才能邀請朋友。'); return; }
  list.textContent = '讀取中…'; $('invPick').classList.remove('hide');
  C.friends(function (err, fr) {
    C.clan(function (e2, cl) {
      list.textContent = ''; const seen = new Set();
      const section = function (title, people, fail) {
        list.appendChild(mk('p', 'note', title));
        if (fail) { list.appendChild(mk('p', 'note', '讀取失敗')); return; }
        if (!people.length) { list.appendChild(mk('p', 'note', '（沒有人）')); return; }
        people.forEach(function (p) {
          if (!p.uid || p.uid === C.uid() || seen.has(p.uid)) return; seen.add(p.uid);
          const r = mk('div', 'srow'); r.appendChild(mk('span', 'nm', p.name || '玩家'));
          const b = mk('button', 'btn primary', '邀請'); b.type = 'button';
          b.addEventListener('click', function () { b.disabled = true; C.inviteSend(p.uid, room, S.gmode, function (e) { b.textContent = e ? '失敗' : '已送出'; }); });
          r.appendChild(b); list.appendChild(r);
        });
      };
      section('好友', err ? [] : fr || [], err);
      section('拾荒團', e2 || !cl || !cl.members ? [] : cl.members, e2);
    });
  });
}
setInterval(invRender, 1000);

let bannerT = null;
function bannerShow(title, sub) {
  const el = $('banner'); el.querySelector('b').textContent = title; el.querySelector('span').textContent = sub || '';
  el.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(bannerHide, 10000);
}
function bannerHide() { clearTimeout(bannerT); $('banner').classList.remove('show'); }
function mkFillSelect() {
  const sel = $('mkItem'), list = tradeables(prog());
  sel.textContent = '';
  if (!list.length) { const op = mk('option', null, '沒有可以賣的東西'); op.value = ''; sel.appendChild(op); return; }
  list.forEach(function (t, k) { const op = mk('option', null, tradeLabel(t.kind, t.item)); op.value = String(k); sel.appendChild(op); });
}
/** 掛單價格上限（同時要與 firestore.rules 的 price 上限一致） */
const MARKET_MAX = 1000;
function mkPost() {
  const C = RR.Cloud; if (!C || !C.ready()) { mtoast('要先登入並連上網路', 'warn'); return; }
  const list = tradeables(prog()), t = list[+$('mkItem').value], price = Math.floor(+$('mkPrice').value);
  if (!t) { mtoast('先選要賣的東西', 'warn'); return; }
  if (!(price >= 1 && price <= MARKET_MAX)) { mtoast('價格要在 1～' + MARKET_MAX + ' 金幣之間', 'warn'); return; }
  const label = tradeLabel(t.kind, t.item), q = prog();
  if (!tradeHas(q, t.kind, t.item)) return;
  tradeTake(q, t.kind, t.item); progSave(q); pushEquip(myEquip(q));   // 先扣掉，失敗再還
  C.marketPost(t.kind, t.item, label, price, function (err) {
    if (err) { const q2 = prog(); tradeGive(q2, t.kind, t.item); progSave(q2); mtoast(C.message(err), 'warn'); mkFillSelect(); return; }
    $('mkPrice').value = ''; mkFillSelect(); tradeLogAdd('post', label, price); bannerShow('掛單成功：' + label, price + ' 金幣，等待買家'); mkDraw();
    C.worldSay('【掛單】' + label + '，' + price + ' 金幣，到交易所的「掛單」買', function () {});
  });
}

function clanOpen() {
  lsSet('rr_cc_seen', String(Date.now())); ccUnread = 0; ccBadgeDraw();
  show('scrClan'); $('coinTag5').textContent = prog().coins; ccAskDraw();
  const C = RR.Cloud, me = C.me();
  $('ccName').textContent = me && me.clanName ? me.clanName : '拾荒團聊天';
  if (!C.ready()) { ccNote('拾荒團聊天要先用 Google 或訪客登入並連上網路。'); return; }
  if (!me || !me.clan) { ccNote('你還沒加入拾荒團。', '去加入或建立拾荒團'); return; }
  ccNote('讀取中…');
  if (ccOff) ccOff();
  ccOff = C.clanChat(function (err, rows) { if (err) { ccNote(C.message(err)); return; } ccRows = rows; ccDraw(); });
  clearInterval(ccTimer); ccTimer = setInterval(ccAskDraw, 30000);
}
function clanClose() {
  if (ccOff) ccOff(); ccOff = null; clearInterval(ccTimer);
  const f = clanFrom; clanFrom = null;
  if (f === 'market') { marketOpen(); return; }
  showMenu();
  if (f === 'social') { socTab = 'clan'; $('scrSocial').classList.remove('hide'); renderSocial(); }
}
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
    if (m.k === 'say') {
      const r = mk('div', 'ccMsg' + (mine ? ' me' : '')), head = mk('div', 'ccHead'), av = mk('span', 'ccAv', (m.name || '?').charAt(0));
      const myImg = mine ? ls('rr_avatar_img') : '';
      if (myImg) { av.textContent = ''; av.style.background = 'center / cover no-repeat url(' + myImg + ')'; } else { av.style.background = m.av || '#f0c040'; }
      head.appendChild(av); head.appendChild(mk('b', null, (mine ? '你' : m.name) + (m.lv ? '　Lv.' + m.lv : ''))); statsLink(head, m.uid, m.name);
      r.appendChild(head); r.appendChild(mk('span', null, m.text)); log.appendChild(r); return;
    }
    if (m.k !== 'req') return;
    const got = m.got | 0, need = m.need | 0, gave = (m.donors && m.donors[my]) | 0;
    const card = mk('div', 'ccReq' + (mine ? ' me' : ''));
    { const who = mk('div', 'ccWho'), av = mk('span', 'ccAv', (m.name || '?').charAt(0)), myImg = mine ? ls('rr_avatar_img') : '';
      if (myImg) { av.textContent = ''; av.style.background = 'center / cover no-repeat url(' + myImg + ')'; } else av.style.background = m.av || '#f0c040';
      who.appendChild(av); who.appendChild(mk('span', null, (mine ? '你' : m.name) + ' 正在請求金幣')); statsLink(who, m.uid, m.name); card.appendChild(who); }
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
const LIMITED_HAT = 6;   // 冠軍王冠：不進商店、不進轉蛋，只給上週週排行榜各模式前 3 名
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
// 等級 1～100：升到 Lv.L 需要的總經驗 = 60 × (L−1)^1.6（越後面越難，但 100 等打得到）
const LV_MAX = 100, LV_POW = 1.6;
function xpAt(lv) { return Math.ceil(60 * Math.pow(Math.max(0, lv - 1), LV_POW)); }
function levelOf(xp) { let lv = Math.min(LV_MAX, 1 + Math.floor(Math.pow(Math.max(0, xp) / 60, 1 / LV_POW) + 1e-9)); while (lv < LV_MAX && xp >= xpAt(lv + 1)) lv++; while (lv > 1 && xp < xpAt(lv)) lv--; return lv; }
/** 等級說明：怎麼拿經驗、每 10 等解鎖什麼 */
/* ---------- 怪物卡牌（js/cards.js）：玩法小選單、結算獎勵 ---------- */
function cardOpts() { let o = null; try { o = JSON.parse(ls('rr_card') || 'null'); } catch (e) {} o = o || {}; return { opp: [1, 2, 3].indexOf(o.opp) >= 0 ? o.opp : 3, hand: o.hand === 5 ? 5 : 7 }; }
function cardOptsText() { const o = cardOpts(); return '對手 ' + o.opp + ' 人・' + (o.hand === 5 ? '快速' : '標準'); }
function cardOptsOpen() {
  const o = cardOpts(), mark = function () {
    const c = cardOpts();
    Array.prototype.forEach.call($('coOpp').children, function (b) { b.classList.toggle('primary', +b.dataset.v === c.opp); });
    Array.prototype.forEach.call($('coHand').children, function (b) { b.classList.toggle('primary', +b.dataset.v === c.hand); });
  };
  void o; mark(); $('cardOpts').classList.remove('hide');
  $('coOpp').onclick = function (e) { const b = e.target.closest('[data-v]'); if (!b) return; const c = cardOpts(); c.opp = +b.dataset.v; lsSet('rr_card', JSON.stringify(c)); mark(); };
  $('coHand').onclick = function (e) { const b = e.target.closest('[data-v]'); if (!b) return; const c = cardOpts(); c.hand = +b.dataset.v; lsSet('rr_card', JSON.stringify(c)); mark(); };
}
/* ---------- 等級獎勵：Lv.2～100 每一等都有獎勵，升級後到這裡領 ----------
 * 每 10 等：新背包（升到就自動得到）；固定幾等送造型；其他等級送金幣（10 + 等級）。造型已經有了就換 25 金幣。 */
const LV_ITEM = { 5: ['hat', 1], 15: ['o', 1], 25: ['pet', 1], 35: ['gs', 1], 45: ['fx', 1], 55: ['is', 1], 65: ['ms', 1], 75: ['o', 3], 85: ['gs', 3], 95: ['hat', 5] };
function lvReward(lv) {
  if (lv % 10 === 0) return lv === 100 ? ['bag', 10, 1000] : ['bag', lv / 10];
  if (LV_ITEM[lv]) return LV_ITEM[lv];
  return ['coin', 10 + lv];
}
function lvRwName(r) { return r[0] === 'bag' ? W.BAG_TIERS[r[1]] + (r[2] ? ' + ' + r[2] + ' 金幣' : '') : r[0] === 'coin' ? r[1] + ' 金幣' : catNames(r[0])[r[1]]; }
function lvGot(p, lv) { const r = lvReward(lv); return r[0] === 'bag' && !r[2] ? levelOf(p.xp) >= lv : (Array.isArray(p.lvc) && p.lvc.indexOf(lv) >= 0); }
function lvCanClaim(p, lv) { return lv >= 2 && levelOf(p.xp) >= lv && !lvGot(p, lv); }
function lvClaimable(p) { let n = 0; for (let l = 2; l <= levelOf(p.xp); l++) if (lvCanClaim(p, l)) n++; return n; }
/** 領一個等級的獎勵（不存檔），回傳文字 */
function lvGive(p, lv) {
  const r = lvReward(lv); if (!Array.isArray(p.lvc)) p.lvc = []; p.lvc.push(lv);
  if (r[0] === 'coin') { p.coins += r[1]; return '+' + r[1] + ' 金幣'; }
  if (r[0] === 'bag') { p.coins += r[2] | 0; return '+' + (r[2] | 0) + ' 金幣'; }
  if (owns(p, r[0], r[1])) { p.coins += 25; return '「' + lvRwName(r) + '」已經有了，換成 25 金幣'; }
  if (r[0] === 'hat') p.hats.push(r[1]); else p.own[r[0]].push(r[1]);
  return '得到「' + lvRwName(r) + '」';
}
let lvSel = 2;
function lvSelect(lv) {
  const p = prog(), r = lvReward(lv); lvSel = lv;
  Array.prototype.forEach.call($('lvsCards').children, function (c) { const on = +c.dataset.lv === lv; c.classList.toggle('sel', on); if (on) c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  $('lvsKind').textContent = 'Lv.' + lv + '　' + (r[0] === 'bag' ? '背包' : r[0] === 'coin' ? '金幣' : CAT_LABEL[r[0]]);
  $('lvsName').textContent = lvRwName(r);
  $('lvsDesc').textContent = r[0] === 'bag' ? '背包 ' + (W.BAG_MAX + r[1]) + ' 格，一趟可以多帶回收物。升到 Lv.' + lv + ' 自動得到。' : r[0] === 'coin' ? '直接得到 ' + r[1] + ' 金幣。' : segDesc([r[0], r[1]], p);
  const got = lvGot(p, lv), can = lvCanClaim(p, lv), btn = $('lvsGet');
  btn.disabled = !can; btn.querySelector('b').textContent = got ? '已獲得' : can ? '領取' : '需要 Lv.' + lv;
  btn.classList.toggle('done', got);
  const cv = $('lvsCanvas'), ic = $('lvsIcon'), look = myLook(); let three = false;
  if (r[0] === 'gs') { Game.gunPreview(cv, look.gun, r[1]); three = true; }
  else if (r[0] === 'o' || r[0] === 'pet' || r[0] === 'hat') { Game.preview(cv, look.c, look.w, r[0] === 'hat' ? r[1] : look.h, r[0] === 'o' ? r[1] : look.o, r[0] === 'pet' ? r[1] : look.pet, true); three = true; }
  cv.classList.toggle('hide', !three); ic.classList.toggle('hide', three); ic.innerHTML = three ? '' : iconSvg(r[0] === 'bag' ? 'bag' : r[0]);
}
function lvsDraw(keepSel) {
  const p = prog(), me = levelOf(p.xp), box = $('lvsCards'); box.textContent = '';
  $('lvsLv').textContent = me >= LV_MAX ? 'Lv.100 滿等' : 'Lv.' + me;
  $('lvsXp').textContent = me >= LV_MAX ? '' : '再 ' + (xpAt(me + 1) - p.xp) + ' 經驗升到 Lv.' + (me + 1);
  const n = lvClaimable(p); $('lvsAll').disabled = !n; $('lvsAll').textContent = n ? '全部領取（' + n + '）' : '全部領取';
  for (let l = 2; l <= LV_MAX; l++) {
    const r = lvReward(l), got = lvGot(p, l), can = lvCanClaim(p, l);
    const c = document.createElement('button'); c.type = 'button'; c.dataset.lv = l;
    c.className = 'lvsCard t-' + r[0] + (got ? ' got' : can ? ' can' : ' lock') + (l % 10 === 0 ? ' big' : '');
    c.innerHTML = '<span class="lvsN">Lv.' + l + '</span><span class="lvsIc">' + iconSvg(r[0] === 'bag' ? 'bag' : r[0]) + '</span><span class="lvsNm"></span><span class="lvsSt">' + (got ? '已獲得' : can ? '領取' : '') + '</span>';
    c.querySelector('.lvsNm').textContent = lvRwName(r);
    c.addEventListener('click', function () { if (lvSel === l && lvCanClaim(prog(), l)) lvClaim(l); else lvSelect(l); });
    box.appendChild(c);
  }
  // 進度條：寬度跟卡片列一樣，填到目前等級
  const cards = box.children, last = cards[Math.min(cards.length - 1, Math.max(0, me - 2))];
  $('lvsFill').style.width = (me >= LV_MAX ? box.scrollWidth : last ? last.offsetLeft + last.offsetWidth / 2 : 0) + 'px';
  $('lvsTrack').querySelector('.lvsBar').style.width = box.scrollWidth + 'px';
  const first = Array.prototype.find.call(cards, function (c) { return c.classList.contains('can'); });
  const sel = keepSel ? lvSel : first ? +first.dataset.lv : Math.min(LV_MAX, Math.max(2, me + 1));
  lvSelect(sel);
  const sc = box.children[sel - 2]; if (sc && !keepSel) $('lvsTrack').scrollLeft = Math.max(0, sc.offsetLeft - $('lvsTrack').clientWidth / 2 + sc.offsetWidth / 2);
}
function lvClaim(lv) {
  const p = prog(); if (!lvCanClaim(p, lv)) return;
  const t = lvGive(p, lv); progSave(p); renderProg(); Sfx.coin && Sfx.coin(); mtoast('Lv.' + lv + ' 獎勵：' + t, 'good'); lvsDraw(true);
}
function lvClaimAll() {
  const p = prog(); let n = 0, coins0 = p.coins; const items = [];
  for (let l = 2; l <= levelOf(p.xp); l++) if (lvCanClaim(p, l)) { const t = lvGive(p, l); n++; if (t.indexOf('得到') === 0) items.push(t.slice(2)); }
  if (!n) return; progSave(p); renderProg(); Sfx.coin && Sfx.coin();
  mtoast('領了 ' + n + ' 個獎勵：金幣 +' + (p.coins - coins0) + (items.length ? '，' + items.join('、') : ''), 'good'); lvsDraw(true);
}
function lvsOpen() { show('scrLevel'); lvsDraw(false); }
function lvDotDraw() { const d = $('lvDot'); if (d) d.classList.toggle('on', lvClaimable(prog()) > 0); }
/** 等級說明：怎麼拿經驗、每 10 等解鎖什麼 */
function lvInfoOpen() {
  const p = prog(), lv = levelOf(p.xp), body = $('lvBody'); body.textContent = '';
  $('lvNow').textContent = lv >= LV_MAX ? '你已經是滿級 Lv.100！' : '你現在 Lv.' + lv + '，經驗 ' + p.xp + '，再 ' + (xpAt(lv + 1) - p.xp) + ' 升到 Lv.' + (lv + 1) + '。';
  const sec = function (t) { const b = document.createElement('b'); b.className = 'lvSec'; b.textContent = t; body.appendChild(b); };
  const line = function (t) { const d = document.createElement('p'); d.textContent = t; body.appendChild(d); return d; };
  sec('怎麼拿經驗');
  ['每打完一局：拿到的金幣 + 10', '廢墟生存戰：擊倒越多、名次越前面越多', 'AR 抓怪、AR 迷宮：每天有次數上限', '送朋友金幣：+10'].forEach(line);
  sec('每 10 等換一個更好的背包');
  const tbl = document.createElement('div'); tbl.className = 'lvTbl'; body.appendChild(tbl);
  for (let t = 0; t <= 10; t++) {
    const at = t === 0 ? 1 : t * 10;
    const row = document.createElement('div'); row.className = 'lvRow' + (W.bagTierOf(lv) >= t ? ' ok' : '') + (W.bagTierOf(lv) === t ? ' cur' : '');
    const a = document.createElement('span'); a.className = 'lvAt'; a.textContent = 'Lv.' + at;
    const b = document.createElement('span'); b.className = 'lvBag'; b.textContent = W.BAG_TIERS[t] + '　' + (W.BAG_MAX + t) + ' 格';
    const c = document.createElement('small'); c.textContent = (t ? '背包 +1 格' : '起始背包') + '　需要 ' + xpAt(at) + ' 經驗';
    row.appendChild(a); row.appendChild(b); row.appendChild(c); tbl.appendChild(row);
  }
  sec('其他');
  ['回收物有稀有度：地上的光圈灰色普通、綠色優良、藍色稀有、金色傳說，越稀有越值錢', '有些拾荒團要求最低等級才能加入', '滿級 Lv.100 拿到傳說背包'].forEach(line);
  $('lvInfo').classList.remove('hide');
}
function renderProg() {
  const p = prog(), lv = levelOf(p.xp), lo = xpAt(lv), hi = lv >= LV_MAX ? lo + 1 : xpAt(lv + 1);
  $('lvTag').textContent = lv; lvDotDraw(); $('coinTag').textContent = p.coins; $('coinTag2').textContent = p.coins;
  $('bagTag').textContent = W.BAG_TIERS[W.bagTierOf(lv)].replace('背包', '');
  $('xpFill').style.width = (lv >= LV_MAX ? 100 : Math.min(100, (p.xp - lo) / (hi - lo) * 100)) + '%';
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
  const lv0 = levelOf(p.xp);
  p.coins += coins; p.xp += xp;
  const bagUp = W.bagTierOf(levelOf(p.xp)) > W.bagTierOf(lv0) ? W.BAG_TIERS[W.bagTierOf(levelOf(p.xp))] : '';
  if (e.win) p.m[0] += 1;
  p.m[1] += e.money; if (stars >= 3) p.m[2] += 1;
  let bonus = 0;
  MISSIONS.forEach(function (m, i) { if (!p.done[i] && p.m[i] >= m[1]) { p.done[i] = true; p.coins += m[2]; bonus += m[2]; } });
  progSave(p);
  const lvUp = levelOf(p.xp) > lv0 ? '，升到 Lv.' + levelOf(p.xp) + '（大廳點等級領獎勵）' : '';
  return '金幣 +' + coins + '，經驗 +' + xp + (bonus ? '，每日任務完成 +' + bonus : '') + (bagUp ? '，解鎖' + bagUp + '（背包 +1 格）' : '') + lvUp;
}
function myMap() { const m = parseInt(ls('rr_map') || '0', 10) || 0; return m >= 0 && m < W.RUIN_N ? m : 0; }
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
// 槍的分類（依 W.GUNS 的順序）；之後新增的槍沒寫分類就放「特殊武器」
const GUN_CATS = ['手槍', '突擊步槍', '衝鋒槍', '霰彈槍', '狙擊槍', '機槍', '特殊武器'];
const GUN_CAT = [0, 3, 1, 2, 4, 4, 5, 4, 1, 3, 2, 5, 6, 6, 6, 6, 5, 1, 3, 6, 4, 6, 6, 6];
function gunCat(i) { const c = GUN_CAT[i]; return c == null ? 6 : c; }
function renderGunStats(i) {
  const box = $('gStats'); if (!box) return;
  const G = W.GUNS[i], all = W.GUNS;
  const v = function (g) { return [g.dmg * g.n, 1 / g.cd, g.range, g.clip[1], 1 - Math.min(0.25, g.spread) * 3, 1 / g.reload]; }, mx = [0, 0, 0, 0, 0, 0];
  all.forEach(function (g) { v(g).forEach(function (x, k) { mx[k] = Math.max(mx[k], x); }); });
  const vals = v(G), names = ['傷害', '射速', '射程', '彈量', '命中', '換彈'];
  box.textContent = '';
  const cat = document.createElement('p'); cat.className = 'gCatTag'; cat.textContent = GUN_CATS[gunCat(i)]; box.appendChild(cat);
  const title = document.createElement('p'); title.className = 'gNote';
  title.textContent = G.name + (G.n > 1 ? '：一次 ' + G.n + ' 顆，近距離很強' : G.auto ? '：按住連發' : G.range >= 70 ? '：一發入魂，射得最遠' : '：穩定好用') + '。回收任務每天 ' + G.clip[0] + ' 發，命中讓怪物暈 ' + G.stun + ' 秒。';
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
  // 單人拾荒打開選單時暫停（多人不能暫停，別人還在玩）
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
function hostStart(day) { if ((day || 1) === 1) recApply(); const info = S.sim.startDay(day || 1); hostBroadcast(rosterAny()); hostBroadcast(info); }   // 先送名單（廢墟生存戰會加入電腦玩家），再送開局資料

/* ---------- 進入各種模式 ---------- */
function startSolo(gmode) {
  Sfx.unlock();
  S.mode = 'solo'; S.myId = 'me'; S.sim = new W.Sim(); S.sim.mode = gmode === 'hunt' || gmode === 'br' || gmode === 'td' || gmode === 'race' ? gmode : 'coop'; S.gmode = S.sim.mode; S.base = 0;
  document.body.classList.add('solo');
  S.sim.map = gmode === 'race' ? W.arenaIdx(Math.floor(Math.random() * W.ARENA_N)) : myMap();   // 賽車：隨機一座賽道場地
  S.sim.raceAi = Math.max(1, Math.min(6, +ls('rr_raceai') || 3));
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
/** 大廳換裝備後同步給房主（開局時房主用的是加入房間當下的裝備） */
function pushLoadout() {
  if (!S.myId) return;
  if (S.mode === 'client') Net.send({ t: 'look', look: myLook() });
  else if (S.mode === 'host' && S.sim) S.sim.updateLook(S.myId, myLook());
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
      else if (d.t === 'look') S.sim.updateLook(from, d.look);
      else if (d.t === 'chat') hostChat(from, d.text);
      else if (d.t === 'atk') S.sim.attack(from, d.yaw);
      else if (d.t === 'gun') S.sim.shoot(from, d.yaw);
      else if (d.t === 'tower') S.sim.buildTower(from);
      else if (d.t === 'bomb') S.sim.bomb(from, d.yaw);
      else if (d.t === 'reload') S.sim.reloadGun(from);
      else if (d.t === 'gunsw') S.sim.switchGun(from);
      else if (d.t === 'air') S.sim.airStrike(from, d.x, d.z);
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
  tmPubKey = ''; S.timers.push(setInterval(function () { voiceSync(); tmPublish(); if (!$('scrLobby').classList.contains('hide')) tickLobby(); }, 400));
}
function leave() {
  S.timers.forEach(clearInterval); S.timers = [];
  if (S.mode === 'client') Net.send({ t: 'bye' });   // 主動告訴房主我走了，不用等逾時
  if (S.mode === 'host') RR.Cloud.roomClose(Net.code());
  Voice.closeAll(); Net.leave(); RR.Cloud.setRoom(null);
  S.mode = null; S.sim = null; S.myId = null; S.roster = []; S.seen = {}; S.chatRate = {}; S.flags = {};
  Game.setActive(false); Game.setRoster([]);
  document.body.classList.remove('solo');
  $('chat').classList.add('hide'); chatOpen(false);
  $('confirm').classList.add('hide'); $('scrHelp').classList.add('hide'); $('scrGear').classList.add('hide');
  Game.showMap(myMap());
  hubCat = null;   // 離開對戰後回到大廳，先進分類畫面
  if (Auth.user()) showMenu(); else show('scrLogin');
}

/* ---------- 畫面 ---------- */
function refreshPickSummary() {
  const ci = (+ls('rr_c') || 0) % W.CHARS.length, c = W.CHARS[ci], w = W.WEAPONS[((+ls('rr_w') || 0) % W.WEAPONS.length)], m = W.MAPS[myMap()];
  $('pickSum').textContent = c + '、' + (W.GUNS[myLook().gun] || W.GUNS[0]).name + '、' + (m ? m.name : '');
  const img = ls('rr_avatar_img');
  if (img) { $('avatar').textContent = ''; $('avatar').style.background = 'center / cover no-repeat url(' + img + ')'; }
  else { $('avatar').textContent = c.charAt(0); $('avatar').style.background = ls('rr_avatar') || 'var(--haz)'; }
}
// 頭像顏色：點頭像選一個底色（記在 rr_avatar）
const AVA_COLORS = ['#f0c040', '#6ecbff', '#c79bff', '#ff7eb6', '#7dffe0', '#9be86a', '#ff8a3d', '#ff5b4d', '#e8dca0', '#8fa3ad', '#f1e6d6', '#2f4f6f'];
function avaDraw() {
  const cur = ls('rr_avatar') || '';
  $('avaGrid').innerHTML = '';
  AVA_COLORS.forEach(function (col) {
    const b = mk('button', col === cur ? 'on' : ''); b.type = 'button'; b.style.background = col;
    b.addEventListener('click', function () { lsSet('rr_avatar', col); try { localStorage.removeItem('rr_avatar_img'); } catch (e) {} refreshPickSummary(); $('avaPick').classList.add('hide'); if (RR.Cloud) RR.Cloud.saveSoon(); });
    $('avaGrid').appendChild(b);
  });
}
/* ---------- 國際象棋（同機雙人） ---------- */
let chessS = null, chessSel = -1, chessMoves = [];
/* 彈珠（休閒）：仿怪物彈珠，拖曳瞄準、放開發射，結束後回到大廳 */
function marbleOpen() {
  show('scrMarble'); pres('marble', true);
  RR.Marble.start($('marbleHost'), function (r) {
    RR.Marble.stop(); show('scrHub');
    mtoast(r.win ? '撐住了！齒輪 ' + r.gears : '被怪物吞了，齒輪 ' + r.gears + '（第 ' + r.round + ' 回合）', r.win ? 'good' : '');
  });
}
/* 跳關（休閒）：單機橫向跳關，過關或 GAME OVER 後回到大廳 */
function platOpen() {
  show('scrPlat'); pres('plat', true);
  RR.Plat.start($('platHost'), function (r) {
    RR.Plat.stop(); show('scrHub');
    mtoast(r.win ? '過關！金幣 ' + r.coins + '，用時 ' + r.time.toFixed(1) + ' 秒' : '遊戲結束，金幣 ' + r.coins, r.win ? 'good' : '');
  });
}
function chessOpen() { show('scrChess'); pres('chess', true); if (!chessS) chessS = RR.Chess.start(); chessSel = -1; chessMoves = []; chessDraw(); }
function chessNew() { chessS = RR.Chess.start(); chessSel = -1; chessMoves = []; chessDraw(); }
function chessTap(i) {
  const C = RR.Chess, s = chessS, st = C.status(s);
  if (st.k === 'mate' || st.k === 'stale') return;
  const hit = chessMoves.filter(function (m) { return m.to === i; });
  if (hit.length) { chessS = C.apply(s, hit[0]); chessSel = -1; chessMoves = []; chessDraw(); return; }
  const p = s.b[i];
  if (p && C.color(p) === s.turn) { chessSel = i; chessMoves = C.legalMoves(s, i); }
  else { chessSel = -1; chessMoves = []; }
  chessDraw();
}
/* 中國象棋（同機雙人）：棋子用中文字，點棋子再點要去的點 */
let xqS = null, xqSel = -1, xqMoves = [];
const XQ_GLYPH = { K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵', k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' };
function xqOpen() { show('scrXq'); if (!xqS) xqS = RR.Xiangqi.start(); xqSel = -1; xqMoves = []; xqDraw(); }
function xqNew() { xqS = RR.Xiangqi.start(); xqSel = -1; xqMoves = []; xqDraw(); }
function xqTap(i) {
  const X = RR.Xiangqi, s = xqS, st = X.status(s);
  if (st.k === 'mate') return;
  const hit = xqMoves.filter(function (m) { return m.to === i; });
  if (hit.length) { xqS = X.apply(s, hit[0]); xqSel = -1; xqMoves = []; xqDraw(); return; }
  const p = s.b[i];
  if (p && X.color(p) === s.turn) { xqSel = i; xqMoves = X.legalMoves(s, i); }
  else { xqSel = -1; xqMoves = []; }
  xqDraw();
}
function xqDraw() {
  const X = RR.Xiangqi, s = xqS, st = X.status(s), bd = $('xqBoard');
  bd.textContent = '';
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 90 100'); svg.setAttribute('aria-hidden', 'true');
  const line = function (x1, y1, x2, y2) { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); svg.appendChild(l); };
  const PX = function (c) { return 5 + c * 10; }, PY = function (r) { return 5 + r * 10; };
  for (let r = 0; r < 10; r++) line(PX(0), PY(r), PX(8), PY(r));
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) line(PX(c), PY(0), PX(c), PY(9));
    else { line(PX(c), PY(0), PX(c), PY(4)); line(PX(c), PY(5), PX(c), PY(9)); }
  }
  line(PX(3), PY(0), PX(5), PY(2)); line(PX(5), PY(0), PX(3), PY(2));
  line(PX(3), PY(7), PX(5), PY(9)); line(PX(5), PY(7), PX(3), PY(9));
  bd.appendChild(svg);
  const river = document.createElement('div'); river.className = 'xqRiver'; river.textContent = '楚河　漢界'; bd.appendChild(river);
  const tg = {}; xqMoves.forEach(function (m) { tg[m.to] = true; });
  for (let i = 0; i < 90; i++) {
    const r = Math.floor(i / 9), c = i % 9, p = s.b[i];
    if (!p && !tg[i]) continue;
    const cls = 'xqPt' + (p ? ' ' + (X.color(p) === 'r' ? 'r' : 'b') : ' dot') + (i === xqSel ? ' sel' : '') + (p && tg[i] ? ' cap' : '');
    const b = mk('button', cls, p ? XQ_GLYPH[p] : '');
    b.type = 'button';
    b.style.left = (PX(c) / 90 * 100) + '%'; b.style.top = (PY(r) / 100 * 100) + '%';
    b.addEventListener('click', (function (k) { return function () { xqTap(k); }; })(i));
    bd.appendChild(b);
  }
  const who = s.turn === 'r' ? '紅方' : '黑方';
  let msg;
  if (st.k === 'mate') msg = (st.winner === 'r' ? '紅方' : '黑方') + '獲勝！（對方無子可走）';
  else if (st.k === 'check') msg = who + '被將軍，輪到' + who + '走';
  else msg = '輪到' + who + '走';
  $('xqStatus').textContent = msg;
}
/* 德國麻將（拉密）：玩家（座位 0）對兩個電腦。
 * 這回合的桌面先在畫面上暫存（rmWT），按「出牌」才一次送進規則檢查。
 * rmLoose 是從桌上拉起來、還沒放回去的散牌。 */
let rmS = null, rmSel = {}, rmWT = [], rmLoose = [], rmBusy = false;
const RM_CLS = ['c0', 'c1', 'c2', 'c3'];
/* 五子棋（同機雙人） */
let gmS = null;
function gmOpen() { show('scrGomoku'); if (!gmS) gmS = RR.Gomoku.start(); gmDraw(); }
function gmNew() { gmS = RR.Gomoku.start(); gmDraw(); }
function gmTap(i) {
  const r = RR.Gomoku.move(gmS, i);
  if (r.ok) gmS = r.state;
  gmDraw();
}
function gmDraw() {
  const G = RR.Gomoku, bd = $('gomokuBoard');
  bd.textContent = '';
  const winSet = {};
  if (gmS.win) gmS.win.line.forEach(function (i) { winSet[i] = 1; });
  for (let i = 0; i < G.N * G.N; i++) {
    const p = gmS.b[i];
    const cls = 'gmCell' + (p === 'b' ? ' B' : p === 'w' ? ' W' : '') + (winSet[i] ? ' win' : '') + (gmS.last === i ? ' last' : '');
    const cell = mk('button', cls, '');
    cell.type = 'button';
    cell.setAttribute('aria-label', (Math.floor(i / G.N) + 1) + '列' + (i % G.N + 1) + '行' + (p ? (p === 'b' ? '黑子' : '白子') : '空'));
    cell.addEventListener('click', (function (k) { return function () { gmTap(k); }; })(i));
    bd.appendChild(cell);
  }
  const st = G.status(gmS);
  let msg;
  if (st.k === 'win') msg = (st.winner === 'b' ? '黑方' : '白方') + '連成五子，獲勝！';
  else if (st.k === 'draw') msg = '棋盤下滿了，和局。';
  else msg = (gmS.turn === 'b' ? '黑方' : '白方') + '下子';
  $('gomokuStatus').textContent = msg;
}
/* 四子連珠（同機雙人） */
let c4S = null;
function c4Open() { show('scrC4'); if (!c4S) c4S = RR.Connect4.start(); c4Draw(); }
function c4New() { c4S = RR.Connect4.start(); c4Draw(); }
function c4Tap(col) {
  const r = RR.Connect4.move(c4S, col);
  if (r.ok) c4S = r.state;
  c4Draw();
}
function c4Draw() {
  const G = RR.Connect4, bd = $('c4Board');
  bd.textContent = '';
  const winSet = {};
  if (c4S.win) c4S.win.line.forEach(function (i) { winSet[i] = 1; });
  const full = c4S.win || c4S.draw;
  for (let col = 0; col < G.COLS; col++) {
    const colBtn = mk('button', 'c4Col', '');
    colBtn.type = 'button';
    colBtn.disabled = !!full || G.dropCell(c4S.b, col) < 0;
    colBtn.setAttribute('aria-label', (col + 1) + '號欄');
    for (let r = 0; r < G.ROWS; r++) {
      const i = r * G.COLS + col, p = c4S.b[i];
      const cls = 'c4Slot' + (p === 'r' ? ' R' : p === 'y' ? ' Y' : '') + (winSet[i] ? ' win' : '') + (c4S.last === i ? ' last' : '');
      colBtn.appendChild(mk('span', cls, ''));
    }
    colBtn.addEventListener('click', (function (k) { return function () { c4Tap(k); }; })(col));
    bd.appendChild(colBtn);
  }
  const st = G.status(c4S);
  let msg;
  if (st.k === 'win') msg = (st.winner === 'r' ? '紅方' : '黃方') + '連成四子，獲勝！';
  else if (st.k === 'draw') msg = '棋盤下滿了，和局。';
  else msg = (c4S.turn === 'r' ? '紅方' : '黃方') + '落子';
  $('c4Status').textContent = msg;
}
/* 飛行棋（同機 2～4 人） */
let flS = null;
const FL_COLS = ['紅', '藍', '綠', '黃'];
const FL_CLS = ['c0', 'c1', 'c2', 'c3'];
function flOpen() { show('scrFlight'); flDraw(); }
function flSetup() { flS = null; flDraw(); }
function flNew(n) { flS = RR.Flight.start(n); flDraw(); }
function flRoll() { if (!flS) return; flS = RR.Flight.roll(flS, function () { return 1 + Math.floor(Math.random() * 6); }); flDraw(); }
function flPick(j) { flS = RR.Flight.pick(flS, j); flDraw(); }
function flPos(ring) {
  const a = -Math.PI / 2 + ring * 2 * Math.PI / RR.Flight.RING;
  return { x: 50 + 42 * Math.cos(a), y: 50 + 42 * Math.sin(a) };
}
function flDraw() {
  const setup = $('flSetup'), board = $('flBoard');
  if (!flS) { setup.classList.remove('hide'); board.classList.add('hide'); $('flightStatus').textContent = '選擇人數開始'; $('flightRoll').disabled = true; return; }
  setup.classList.add('hide'); board.classList.remove('hide');
  const F = RR.Flight, ring = $('flRing');
  ring.textContent = '';
  // 跑道格：每格一個點，各色起點較大
  for (let i = 0; i < F.RING; i++) {
    const pt = flPos(i), dot = mk('span', 'flDot' + (F.SAFE.indexOf(i) >= 0 ? ' safe' : ''), '');
    dot.style.left = pt.x + '%'; dot.style.top = pt.y + '%';
    ring.appendChild(dot);
  }
  // 飛機：依位置放在環上（跑道上的才放）
  for (let q = 0; q < flS.n; q++) {
    for (let j = 0; j < 4; j++) {
      const p = flS.pl[q][j];
      if (p < 0 || p > 50) continue;
      const pt = flPos(F.ringOf(flS.col[q], p)), tok = mk('span', 'flTok ' + FL_CLS[flS.col[q]], '');
      tok.style.left = pt.x + '%'; tok.style.top = pt.y + '%';
      ring.appendChild(tok);
    }
  }
  // 玩家面板
  const list = $('flPlayers');
  list.textContent = '';
  for (let q = 0; q < flS.n; q++) {
    const row = mk('div', 'flRow' + (flS.cur === q && flS.win === null ? ' now' : ''), '');
    row.appendChild(mk('b', FL_CLS[flS.col[q]], FL_COLS[flS.col[q]] + '方'));
    for (let j = 0; j < 4; j++) {
      const p = flS.pl[q][j];
      const label = p === -1 ? '基地' : p === F.HOME ? '終點' : '第 ' + (p + 1) + ' 步';
      const canPick = flS.phase === 'pick' && q === flS.cur && flS.legal.indexOf(j) >= 0;
      const btn = mk('button', 'flPlane' + (canPick ? ' pick' : ''), '✈ ' + (j + 1) + '：' + label);
      btn.type = 'button';
      btn.disabled = !canPick;
      if (canPick) btn.addEventListener('click', (function (k) { return function () { flPick(k); }; })(j));
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
  const st = F.status(flS);
  $('flightRoll').disabled = !(flS.phase === 'roll' && st.k === 'play');
  $('flightStatus').textContent = st.k === 'win' ? FL_COLS[flS.col[st.winner]] + '方獲勝！' : (FL_COLS[flS.col[flS.cur]] + '方' + (flS.phase === 'pick' ? '選擇要走的飛機' : '擲骰子')) + (flS.dice ? '（上次點數 ' + flS.dice + '）' : '') + (flS.msg ? '　' + flS.msg : '');
}
/* 彈珠台 */
let pcS = null, pcRaf = 0;
function pcOpen() { show('scrPachi'); if (!pcS) pcNew(); else pcDraw(); }
function pcNew() { if (pcRaf) cancelAnimationFrame(pcRaf); pcRaf = 0; pcS = { balls: 30, won: 0, path: null, idx: 0, payout: 0, pocket: -1 }; pcDraw(); }
function pcFire() {
  if (!pcS || pcS.path || pcS.balls <= 0) return;
  const deg = +$('pcAngle').value, pw = +$('pcPower').value / 100;
  const r = RR.Pachinko.sim(deg * Math.PI / 180, pw, Math.random);
  pcS.balls--; pcS.path = r.path; pcS.idx = 0; pcS.payout = r.payout; pcS.pocket = r.pocket;
  pcStep();
}
function pcStep() {
  pcS.idx = Math.min(pcS.path.length - 1, pcS.idx + 3);
  pcDraw();
  if (pcS.idx < pcS.path.length - 1) { pcRaf = requestAnimationFrame(pcStep); return; }
  pcRaf = 0;
  pcS.balls += pcS.payout; pcS.won += pcS.payout;
  pcS.path = null;
  pcDraw();
}
function pcDraw() {
  const P = RR.Pachinko, cv = $('pcCanvas'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, P.W, P.H);
  ctx.fillStyle = '#1b2a3a'; ctx.fillRect(0, 0, P.W, P.H);
  // 袋子
  const pw = P.W / P.PAYOUT.length;
  P.PAYOUT.forEach(function (v, i) {
    ctx.fillStyle = i === 2 ? 'rgba(255,210,58,.35)' : 'rgba(255,255,255,.08)';
    ctx.fillRect(i * pw + 2, P.H - 36, pw - 4, 34);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(v + '顆', i * pw + pw / 2, P.H - 14);
  });
  // 釘子
  ctx.fillStyle = '#c9d6e3';
  P.pins().forEach(function (p) { ctx.beginPath(); ctx.arc(p.x, p.y, P.PIN_R, 0, Math.PI * 2); ctx.fill(); });
  // 發射軌跡提示：角度線
  if (!pcS.path) {
    const a = +$('pcAngle').value * Math.PI / 180;
    ctx.strokeStyle = 'rgba(255,210,58,.7)'; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(P.W / 2, 14); ctx.lineTo(P.W / 2 + Math.sin(a) * 70, 14 + Math.cos(a) * 70); ctx.stroke(); ctx.setLineDash([]);
  }
  // 球
  if (pcS.path) { const q = pcS.path[pcS.idx]; ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(q.x, q.y, P.BALL_R, 0, Math.PI * 2); ctx.fill(); }
  $('pcBalls').textContent = pcS.balls;
  $('pcWon').textContent = pcS.won;
  $('pcAngleVal').textContent = $('pcAngle').value + '°';
  $('pcPowerVal').textContent = $('pcPower').value + '%';
  $('pcFire').disabled = !!pcS.path || pcS.balls <= 0;
  let msg;
  if (pcS.path) msg = '彈珠滾動中…';
  else if (pcS.balls <= 0) msg = '彈珠用完了，按「重新開始」再玩一次。';
  else if (pcS.pocket >= 0) msg = pcS.payout === 0 ? '沒有進袋，可惜。' : (pcS.pocket === 2 ? '大獎！' : '') + '回收 ' + pcS.payout + ' 顆';
  else msg = '調整角度與力道，按發射。';
  $('pcStatus').textContent = msg;
}
/* 康樂球（桌上撞擊） */
let kgS = null, kgRaf = 0;
function kgOpen() { show('scrKangle'); if (!kgS) kgNew(); else kgDraw(); }
function kgNew() { if (kgRaf) cancelAnimationFrame(kgRaf); kgRaf = 0; kgS = RR.Carrom.newGame(); kgDraw(); }
function kgFire() {
  if (!kgS || kgRaf || kgS.winner !== null) return;
  const res = RR.Carrom.shoot(kgS, +$('kgX').value, +$('kgAngle').value * Math.PI / 180, +$('kgPower').value / 100);
  const frames = res.frames;
  let i = 0;
  if (!frames.length) { kgS = res.state; kgDraw(); return; }
  kgRaf = 1;
  kgDraw();
  (function tick() {
    if (i < frames.length) { kgDrawBoard(frames[i]); i++; kgRaf = requestAnimationFrame(tick); return; }
    kgRaf = 0; kgS = res.state; kgDraw();
  })();
}
function kgDrawBoard(list) {
  const C = RR.Carrom, cv = $('kgCanvas'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, C.W, C.H);
  ctx.fillStyle = '#c8924f'; ctx.fillRect(0, 0, C.W, C.H);
  ctx.strokeStyle = '#7a4f22'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, C.W - 4, C.H - 4);
  // 底線
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(60,30,10,.5)';
  [C.BASE_Y[0], C.BASE_Y[1]].forEach(function (y) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(C.W - 60, y); ctx.stroke(); });
  // 洞
  ctx.fillStyle = '#1e120a';
  C.POCKETS.forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], C.POCKET_R, 0, Math.PI * 2); ctx.fill(); });
  // 棋子與射子
  list.forEach(function (b) {
    const isS = b.c === 's';
    ctx.beginPath(); ctx.arc(b.x, b.y, isS ? C.STRIKER_R : C.PIECE_R, 0, Math.PI * 2);
    ctx.fillStyle = b.c === 'r' ? '#c62828' : b.c === 'b' ? '#222' : '#f5f0e6';
    ctx.fill(); ctx.strokeStyle = '#3a2412'; ctx.lineWidth = 2; ctx.stroke();
  });
}
function kgDraw() {
  if (!kgS) return;
  const C = RR.Carrom;
  const list = kgS.pieces.filter(function (p) { return p.alive; }).map(function (p) { return { x: p.x, y: p.y, c: p.c }; });
  if (kgS.winner === null) {
    const sx = Math.max(60, Math.min(C.W - 60, +$('kgX').value));
    list.push({ x: sx, y: C.BASE_Y[kgS.turn], c: 's' });
    const a = +$('kgAngle').value * Math.PI / 180, y0 = C.BASE_Y[kgS.turn], dy = kgS.turn === 0 ? -1 : 1;
    kgDrawBoard(list);
    const cv = $('kgCanvas').getContext('2d');
    cv.strokeStyle = 'rgba(255,210,58,.8)'; cv.setLineDash([5, 5]); cv.beginPath(); cv.moveTo(sx, y0);
    cv.lineTo(sx + Math.sin(a) * 90, y0 + dy * Math.cos(a) * 90); cv.stroke(); cv.setLineDash([]);
  } else {
    kgDrawBoard(list);
  }
  $('kgScore').textContent = '紅 ' + kgS.score[0] + '　黑 ' + kgS.score[1];
  $('kgAngleVal').textContent = $('kgAngle').value + '°';
  $('kgPowerVal').textContent = $('kgPower').value + '%';
  $('kgFire').disabled = !!kgRaf || kgS.winner !== null;
  const who = kgS.turn === 0 ? '紅方（下）' : '黑方（上）';
  $('kgStatus').textContent = kgS.winner !== null ? kgS.msg : (kgRaf ? '棋子滑動中…' : (kgS.msg ? kgS.msg + '　' : '') + who + '射擊');
}
let rmDeadline = 0, rmTimer = null;
const RM_TURN_MS = 60000;   // 每回合 1 分鐘
function rmOpen() { show('scrRummi'); if (!rmS) rmS = RR.Rummi.start(); rmResetTurn(); rmStartTurn(); rmDraw(); if (!rmTimer) rmTimer = setInterval(rmTick, 1000); }
function rmStartTurn() { rmDeadline = Date.now() + RM_TURN_MS; }
/** 每秒檢查：時間到就結束這回合（桌面亂了抽 3 張懲罰，沒動就抽 1 張） */
function rmTick() {
  if (!rmS || rmS.over || rmS.turn !== 0 || rmBusy) return;
  const left = Math.ceil((rmDeadline - Date.now()) / 1000);
  if (left > 0) { rmStatus(); return; }   // 只更新文字，不重建牌面，免得點擊被吃掉
  const dirty = rmDirty();
  if (dirty) { rmResetTurn(); mtoast('超時了！桌面還原，抽 3 張懲罰', 'bad'); }
  else mtoast('超時了，抽 1 張', 'bad');
  const r = dirty ? RR.Rummi.penalty(rmS, 0) : RR.Rummi.draw(rmS, 0);
  if (r.ok) { rmS = r.state; rmResetTurn(); rmAfter(); }
}
function rmNewGame() { rmS = RR.Rummi.start(); rmBusy = false; rmResetTurn(); rmStartTurn(); rmDraw(); }
function rmCopyTable() { return rmS.table.map(function (ts) { return ts.slice(); }); }
function rmResetTurn() { rmSel = {}; rmWT = rmCopyTable(); rmLoose = []; }
function rmIdSet(list) { const o = {}; list.forEach(function (t) { o[t.id] = 1; }); return o; }
/** 手上還沒放上桌的牌 */
function rmHand() {
  const old = rmIdSet(rmS.table.reduce(function (a, ts) { return a.concat(ts); }, []));
  const placed = {};
  rmWT.forEach(function (ts) { ts.forEach(function (t) { if (!old[t.id]) placed[t.id] = 1; }); });
  return rmS.hands[0].filter(function (t) { return !placed[t.id]; });
}
/** 這回合有沒有動到桌面（有就不能抽牌） */
function rmDirty() { return rmLoose.length > 0 || JSON.stringify(rmWT.map(function (ts) { return ts.map(function (t) { return t.id; }); })) !== JSON.stringify(rmS.table.map(function (ts) { return ts.map(function (t) { return t.id; }); })) || rmHand().length !== rmS.hands[0].length; }
function rmTileBtn(t, cls) {
  const b = mk('button', 'rmTile ' + (t.joker ? 'joker' : RM_CLS[t.color]) + (cls ? ' ' + cls : ''), t.joker ? '鬼' : String(t.num));
  b.type = 'button';
  return b;
}
function rmSelectedTiles() { return rmHand().concat(rmLoose).filter(function (t) { return rmSel[t.id]; }); }
function rmTapHand(t) { if (rmBusy) return; rmSel[t.id] = !rmSel[t.id]; rmDraw(); }
function rmTapLoose(t) { if (rmBusy) return; rmSel[t.id] = !rmSel[t.id]; rmDraw(); }
/** 點桌上的牌：拉起來成為散牌（破冰後才能動桌上的牌） */
function rmPullFromTable(setIdx, t) {
  if (rmBusy) return;
  if (!rmS.opened[0]) { mtoast('破冰前不能動桌上的牌', 'bad'); return; }
  rmWT[setIdx] = rmWT[setIdx].filter(function (x) { return x.id !== t.id; });
  rmWT = rmWT.filter(function (ts) { return ts.length; });
  rmLoose.push(t); rmDraw();
}
function rmRemoveSelectedLoose(tiles) {
  const ids = rmIdSet(tiles);
  rmLoose = rmLoose.filter(function (t) { return !ids[t.id]; });
}
function rmMakeSet() {
  const tiles = rmSelectedTiles();
  if (!tiles.length) { mtoast('先選牌', 'bad'); return; }
  if (!RR.Rummi.setValid(tiles)) { mtoast('這些牌不是合法的組（群組或順組）', 'bad'); return; }
  rmWT.push(tiles.slice()); rmRemoveSelectedLoose(tiles); rmSel = {}; rmDraw();
}
/** 點桌上的組：把選到的牌接上去（破冰前只能接自己這回合新組的組） */
function rmExtendSet(i) {
  if (rmBusy) return;
  const tiles = rmSelectedTiles();
  if (!tiles.length) return;
  const isOld = i < rmS.table.length;   // 破冰前桌面的順序不會變，前面幾組就是舊的
  if (!rmS.opened[0] && isOld) { mtoast('破冰前只能接在自己新組的組上', 'bad'); return; }
  const merged = rmWT[i].concat(tiles);
  if (!RR.Rummi.setValid(merged)) { mtoast('接不上這組', 'bad'); return; }
  rmWT[i] = merged; rmRemoveSelectedLoose(tiles); rmSel = {}; rmDraw();
}
function rmUndo() { if (rmBusy) return; rmResetTurn(); rmDraw(); }
function rmDrawTile() {
  if (rmBusy || rmS.turn !== 0) return;
  if (rmDirty()) { mtoast('先出牌或復原，再抽牌', 'bad'); return; }
  const r = RR.Rummi.draw(rmS, 0);
  if (r.ok) { rmS = r.state; rmResetTurn(); rmAfter(); }
}
function rmConfirm() {
  if (rmBusy || rmS.turn !== 0) return;
  if (rmLoose.length) { mtoast('還有散牌沒放上桌', 'bad'); return; }
  const r = rmS.opened[0]
    ? RR.Rummi.rearrange(rmS, 0, rmWT, rmHandUsed())
    : RR.Rummi.play(rmS, 0, rmAddedSets(), []);
  if (!r.ok) { mtoast(r.why, 'bad'); return; }
  rmS = r.state; rmResetTurn(); rmAfter();
}
/** 還沒破冰時：這回合新加的組（舊的桌面不能動） */
function rmAddedSets() {
  const old = rmS.table.length;
  if (rmWT.length < old || rmWT.slice(0, old).some(function (ts, i) { return ts.length !== rmS.table[i].length; })) return [];
  return rmWT.slice(old);
}
function rmHandUsed() {
  const old = rmIdSet(rmS.table.reduce(function (a, ts) { return a.concat(ts); }, []));
  const out = [];
  rmWT.forEach(function (ts) { ts.forEach(function (t) { if (!old[t.id]) out.push(t); }); });
  return out;
}
/** 玩家出完或抽完牌之後：遊戲結束就結算，否則讓電腦依序走 */
function rmAfter() {
  if (rmS.over) { rmDraw(); return; }
  if (rmS.turn !== 0) { rmAi(); return; }
  rmStartTurn(); rmDraw();
}
function rmAi() {
  rmBusy = true; rmDraw();
  const step = function () {
    if (rmS.over || rmS.turn === 0) { rmBusy = false; rmStartTurn(); rmDraw(); return; }
    rmS = RR.Rummi.aiMove(rmS, rmS.turn).state;
    rmDraw();
    setTimeout(step, 700);
  };
  setTimeout(step, 500);
}
function rmDraw() {
  const X = RR.Rummi, bd = $('rummiTable'), hd = $('rummiHand');
  const mine = rmS.turn === 0 && !rmS.over && !rmBusy;
  bd.textContent = '';
  rmWT.forEach(function (ts, i) {
    const set = mk('button', 'rsSet', '');
    set.type = 'button';
    ts.forEach(function (t) {
      const b = rmTileBtn(t);
      b.addEventListener('click', function (e) { e.stopPropagation(); rmPullFromTable(i, t); });
      set.appendChild(b);
    });
    set.addEventListener('click', function () { rmExtendSet(i); });
    bd.appendChild(set);
  });
  if (!rmWT.length) bd.appendChild(mk('p', 'ccEmpty', '桌上還沒有牌'));
  const loose = $('rummiLoose');
  loose.textContent = '';
  rmLoose.forEach(function (t) {
    const b = rmTileBtn(t, rmSel[t.id] ? 'sel' : '');
    b.addEventListener('click', function () { rmTapLoose(t); });
    loose.appendChild(b);
  });
  loose.classList.toggle('hide', !rmLoose.length);
  hd.textContent = '';
  rmHand().forEach(function (t) {
    const b = rmTileBtn(t, rmSel[t.id] ? 'sel' : '');
    b.addEventListener('click', function () { rmTapHand(t); });
    hd.appendChild(b);
  });
  ['rummiMake', 'rummiDraw', 'rummiUndo', 'rummiOk'].forEach(function (id) { $(id).disabled = !mine; });
  $('rummiDraw').textContent = rmS.deck.length ? '抽牌（剩 ' + rmS.deck.length + '）' : '抽牌（牌庫已空）';
  rmStatus();
}
function rmStatus() {
  const X = RR.Rummi, names = ['你', '電腦一', '電腦二'];
  let msg;
  if (rmS.over) {
    const sc = X.score(rmS);
    msg = (rmS.winner === 0 ? '你贏了！' : names[rmS.winner] + '贏了') + '　點數：' + sc.map(function (v, i) { return names[i] + ' ' + (v > 0 ? '+' : '') + v; }).join('、');
  } else if (rmBusy || rmS.turn !== 0) msg = names[rmS.turn] + '思考中…';
  else msg = (rmS.opened[0] ? '' : '你還沒破冰（需要 ' + X.OPEN_MIN + ' 點以上）。') + '輪到你出牌（剩 ' + Math.max(0, Math.ceil((rmDeadline - Date.now()) / 1000)) + ' 秒）';
  $('rummiStatus').textContent = msg;
}
function chessDraw() {
  const C = RR.Chess, s = chessS, st = C.status(s), bd = $('chessBoard');
  bd.textContent = '';
  const tg = {}; chessMoves.forEach(function (m) { tg[m.to] = true; });
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8), c = i % 8, p = s.b[i];
    const cls = 'chSq' + ((r + c) % 2 ? ' dk' : '') + (i === chessSel ? ' sel' : '') + (tg[i] ? ' tgt' : '') + (p ? (C.color(p) === 'w' ? ' pw' : ' pb') : '');
    const sq = mk('button', cls, '');
    sq.type = 'button';
    if (p) sq.innerHTML = RR.ChessArt.svg(p);
    sq.addEventListener('click', (function (k) { return function () { chessTap(k); }; })(i));
    bd.appendChild(sq);
  }
  const who = s.turn === 'w' ? '白方' : '黑方';
  let msg;
  if (st.k === 'mate') msg = (st.winner === 'w' ? '白方' : '黑方') + '將死，獲勝！';
  else if (st.k === 'stale') msg = '逼和，平手。';
  else if (st.k === 'check') msg = who + '被將軍，輪到' + who + '走';
  else msg = '輪到' + who + '走';
  $('chessStatus').textContent = msg;
}
function showMenu() {
  ccWatchStart(); rankWatch(false);
  const u = Auth.user();
  if (!u) { show('scrLogin'); return; }
  if (!ls('rr_region')) $('regionAsk').classList.remove('hide');   // 第一次進選地區
  $('whoProv').textContent = u.providerLabel + ' 登入';
  if (document.activeElement !== $('nick')) $('nick').value = u.name;
  $('nickPen').classList.toggle('pulse', !ls('rr_named') && /^訪客/.test(u.name || ''));
  $('best').textContent = ls('rr_best') || '0';
  show(hubCat ? 'scrMenu' : 'scrHub');
  refreshPickSummary(); renderProg(); refreshLobby();
  mailAddUpd(); mailDot();
}
/* ---------- 信箱：更新內容存進信箱（最多 30 封，超過就刪掉最舊的） ---------- */
const MAIL_MAX = 30;
function mailList() { try { return JSON.parse(ls('rr_mail') || '[]'); } catch (e) { return []; } }
function mailSave(l) { lsSet('rr_mail', JSON.stringify(l.slice(0, MAIL_MAX))); }   // 新的在前面，超過 30 封就從最舊的截掉
function mailAddUpd() {
  if (ls('rr_mail_upd') === UPD.v) return;
  mailSave([{ id: 'upd' + UPD.v, t: Date.now(), title: '更新了 ' + UPD.v, body: UPD.items.slice(), read: false }].concat(mailList()));
  lsSet('rr_mail_upd', UPD.v);
}
function mailDot() { const n = mailList().filter(function (m) { return !m.read; }).length; const d = $('mailDot'); d.textContent = n > 9 ? '9+' : String(n); d.classList.toggle('hide', !n); }
function mailRender() {
  const list = $('mailList'); list.textContent = '';
  const mails = mailList();
  if (!mails.length) list.appendChild(mk('li', 'ccEmpty', '信箱是空的。'));
  mails.forEach(function (m) {
    const li = mk('li', 'mailItem' + (m.read ? '' : ' unread'));
    const d = new Date(m.t), tm = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    li.appendChild(mk('b', null, m.title)); li.appendChild(mk('small', null, '　' + tm));
    const ul = mk('ul', 'mailBody'); (m.body || []).forEach(function (t) { ul.appendChild(mk('li', null, t)); }); li.appendChild(ul);
    list.appendChild(li);
  });
}
$('mailBtn').addEventListener('click', function () {
  mailRender(); $('mailBox').classList.remove('hide');
  mailSave(mailList().map(function (m) { m.read = true; return m; })); mailDot();
});
$('mailClose').addEventListener('click', function () { $('mailBox').classList.add('hide'); });
$('mailClear').addEventListener('click', function () { ask('清空信箱？（已讀與未讀都會刪掉）', function () { mailSave([]); mailRender(); mailDot(); }); });
/* ---------- 回收任務的難度與天數（本機設定，房主開局時套用） ---------- */
const REC_DIFF = { easy: '簡單', normal: '標準', hard: '困難' }, REC_DAYS = [0, 7, 14];
function recCfg() { const d = ls('rr_diff'), n = +ls('rr_days'); return { diff: REC_DIFF[d] ? d : 'normal', days: REC_DAYS.indexOf(n) >= 0 ? n : 0 }; }
function recText() { const c = recCfg(); return REC_DIFF[c.diff] + ' · ' + (c.days ? c.days + '天' : '無限'); }
function recApply() { if (!S.sim) return; const c = recCfg(); S.sim.diff = c.diff; S.sim.maxDay = S.sim.mode === 'coop' ? c.days : 0; }
function recOptsOpen() {
  const mark = function () { const c = recCfg();
    Array.prototype.forEach.call($('roDiff').children, function (b) { b.classList.toggle('primary', b.dataset.v === c.diff); });
    Array.prototype.forEach.call($('roDays').children, function (b) { b.classList.toggle('primary', +b.dataset.v === c.days); }); };
  mark(); $('recOpts').classList.remove('hide');
  $('roDiff').onclick = function (e) { const b = e.target.closest('[data-v]'); if (!b) return; lsSet('rr_diff', b.dataset.v); mark(); refreshLobby(); };
  $('roDays').onclick = function (e) { const b = e.target.closest('[data-v]'); if (!b) return; lsSet('rr_days', b.dataset.v); mark(); refreshLobby(); };
}
/* ---------- 大廳分類：主玩法（多人） / 休閒模式（AR、卡牌） ---------- */
const HUB_CATS = { main: ['coop', 'solo', 'hunt', 'td', 'br'], casual: ['ar', 'card', 'race', 'chess', 'xq', 'rummi', 'gomoku', 'c4', 'flight', 'pachi', 'kangle', 'plat', 'marble'] };
let hubCat = null;
function hubEnter(cat) { hubCat = cat; if (HUB_CATS[cat].indexOf(selMode()) < 0) lsSet('rr_mode', HUB_CATS[cat][0]); show('scrMenu'); refreshLobby(); }
// 大廳：選模式（卡片只選取）、開始鍵顯示模式與地圖、中間的角色
const LOBBY_MODE = { coop: '組隊回收', solo: '單人拾荒', hunt: '清剿行動', td: '死守回收車', br: '廢墟生存戰', ar: 'AR 實境', card: '怪物卡牌', race: '賽車', chess: '國際象棋', xq: '中國象棋', rummi: '德國麻將', gomoku: '五子棋', c4: '四子連珠', flight: '飛行棋', pachi: '彈珠台', kangle: '康樂球', plat: '跳關', marble: '彈珠' };
function selMode() { const m = ls('rr_mode') || 'coop'; return LOBBY_MODE[m] ? m : 'coop'; }
// 休閒模式的玩法說明（點大廳的「玩法說明」看）
const CAS_HELP = {
  ar: '在迷宮裡找怪物，用 AR 相機抓住它。\n迷宮會隨機生成，找到出口或抓滿怪物即可過關。',
  card: '每回合出一張卡，和電腦輪流對戰。\n先把電腦的血量打到 0 就獲勝。',
  race: '在廢墟賽道上計時跑圈，越快越好。\n按氮氣加速，撞牆會減速；跑完成績會記進排行。',
  marble: '在下方拖曳瞄準，放開發射彈珠。\n每回合 5 顆彈珠，撐過 15 回合就過關；彈珠落到底部就失敗。',
  plat: '橫向跳關，踩敵人、吃金幣。\n跳到終點旗子即過關；掉進坑裡或被敵人碰到就 GAME OVER。',
  chess: '同一台裝置兩人輪流下棋。\n點選棋子再點目標格移動，把對方的王將死就獲勝。',
  xq: '同一台裝置兩人輪流下棋。\n點選棋子再點目標格移動，把對方的將軍死就獲勝。',
  rummi: '依拉密規則排出順子或同數字的組合，先出完手牌者獲勝。\n和電腦對戰；可以先摸牌或直接出牌。',
  gomoku: '同一台裝置兩人輪流下子。\n先在橫、直、斜任一方向連成五子者獲勝。',
  c4: '同一台裝置兩人輪流投子，棋子會落到該欄最下方。\n先在橫、直、斜任一方向連成四子者獲勝。',
  flight: '2～4 人同一台裝置輪流。\n擲骰 6 點出發，沿路前進；踩到別人就把對方送回基地，先到終點者獲勝。',
  pachi: '調整角度與力道發射彈珠。\n彈珠落進中間的袋子就是大獎，落在其他地方則依分數計算。',
  kangle: '在桌上用球撞擊，兩人輪流。\n先把自己的 8 顆球打進洞者獲勝。',
};
function refreshLobby() {
  const m = selMode();
  $('scrMenu').classList.toggle('casualLobby', hubCat === 'casual');   // 休閒模式：隱藏主玩法的角色、抽獎、市集等
  Array.prototype.forEach.call($('modeStrip').children, function (b) { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  Array.prototype.forEach.call($('modeStrip').children, function (b) { b.classList.toggle('hide', !!hubCat && HUB_CATS[hubCat].indexOf(b.dataset.mode) < 0); });
  $('optChip').classList.toggle('hide', m !== 'coop');
  $('casHelp').classList.toggle('hide', hubCat !== 'casual'); $('optName').textContent = recText();
  $('startMode').textContent = LOBBY_MODE[m] + (m === 'coop' ? '：建立房間' : '');
  $('mapName').textContent = m === 'card' ? cardOptsText() : (W.MAPS[myMap()] || W.MAPS[0]).name;
  $('mapChip').querySelector('span').textContent = m === 'card' ? '玩法' : '地圖';
  $('mapChip').classList.toggle('dim', m === 'ar');   // AR 不用選地圖；卡牌模式這格改成選玩法
  const look = myLook();
  $('lbName').textContent = W.CHARS[look.c] + '　' + (W.GUNS[look.gun] || W.GUNS[0]).name;
  { const bd = String(prog().arBuddy || '').split(':'); Game.preview($('lobbyChar'), look.c, look.w, look.h, look.o, look.pet, true, bd.length === 2 ? [bd[0] | 0, bd[1] | 0] : null); }
}
/* ---------- 段位與地圖輪換 ---------- */
const PTIERS = [
  { n: '新秀', min: 0 }, { n: '專家', min: 1000 }, { n: '達人', min: 2000 }, { n: '菁英', min: 3000 },
  { n: '大師', min: 4500 }, { n: '宗師', min: 6000 }, { n: '傳奇', min: 8000 }
];
function ptierOf(s) { let i = 0; for (let k = 0; k < PTIERS.length; k++) if ((s | 0) >= PTIERS[k].min) i = k; return i; }
/** 卡牌、AR 的金幣也計入本週段位積分（與普通模式共用同一個段位） */
function addWeekPts(p, n) { const w = RR.Cloud.weekId(); if (p.wk !== w) { p.wk = w; p.wpts = 0; } p.wpts = (p.wpts | 0) + Math.round(n | 0); }
function myWeekPts() { const p = prog(); return p.wk === RR.Cloud.weekId() ? (p.wpts | 0) : 0; }
/** 本週輪換地圖：依週次固定抽 6 張，全部玩家一致 */
function rotMaps() {
  const N = W.RUIN_N, want = Math.min(6, N), out = [];
  let s = (RR.Cloud.weekId() * 9301 + 49297) % 233280;
  while (out.length < want) { s = (s * 9301 + 49297) % 233280; const i = Math.floor(s / 233280 * N); if (out.indexOf(i) < 0) out.push(i); }
  return out;
}
function openTierInfo() {
  const b = $('tierBody'), C = RR.Cloud, N = W.RUIN_N; b.textContent = '';
  const row = function (name, min, now) { const r = mk('div', 'srow' + (now ? ' me' : '')); r.appendChild(mk('span', 'nm', name)); r.appendChild(mk('span', 'sc', min + ' 分起')); b.appendChild(r); };
  b.appendChild(mk('div', 'sec', '拾荒團段位（本週積分）'));
  C.TIERS.forEach(function (t) { row(t.n, t.min, false); });
  b.appendChild(mk('p', 'note', '每局金幣累積成拾荒團本週積分，每週一重算，歷史最高段位會保留。'));
  b.appendChild(mk('div', 'sec', '個人段位（本週積分）'));
  const mine = myWeekPts(), now = ptierOf(mine);
  PTIERS.forEach(function (t, i) { row(t.n, t.min, i === now); });
  b.appendChild(mk('p', 'note', '你目前：' + PTIERS[now].n + '（本週 ' + mine + ' 分）。每局金幣累積成本週積分，每週一重算。'));
  b.appendChild(mk('div', 'sec', '地圖輪換'));
  b.appendChild(mk('p', 'note', '通用池：全部 ' + N + ' 張地圖隨時可選。'));
  b.appendChild(mk('p', 'note', '本週輪換（' + rotMaps().length + ' 張）：' + rotMaps().map(function (i) { return W.MAPS[i].name; }).join('、') + '。在輪換地圖上的對局，段位積分 +20%，金幣不變。每週一換。'));
  $('scrTier').classList.remove('hide');
}
function renderMapGrid() {
  const g = $('mapGrid'), cur = myMap(), rot = rotMaps(); g.textContent = '';
  W.MAPS.slice(0, W.RUIN_N).forEach(function (mp, i) {
    const T = mp.theme, b = document.createElement('button'); b.type = 'button'; b.className = 'mapCard' + (i === cur ? ' on' : '');
    // 縮圖直接畫出地圖的格子：牆、地板、出生點（綠）、怪物點（紅）
    const cv = document.createElement('canvas'); cv.className = 'mapPrev'; cv.width = mp.rows[0].length * 4; cv.height = mp.rows.length * 4;
    const x = cv.getContext('2d');
    mp.rows.forEach(function (row, r) { for (let c = 0; c < row.length; c++) { const ch = row[c]; x.fillStyle = ch === '#' ? T.wall : ch === 'S' ? '#5fd17a' : ch === 'M' ? '#e0503a' : T.floor; x.fillRect(c * 4, r * 4, 4, 4); } });
    b.appendChild(cv);
    const nm = document.createElement('b'), sp = document.createElement('span'); nm.textContent = mp.name; sp.textContent = (T.open ? '開放場景' : '室內') + (rot.indexOf(i) >= 0 ? ' · 本週輪換' : ''); b.appendChild(nm); b.appendChild(sp);
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
  $('modeBtn').textContent = '模式：' + (S.gmode === 'td' ? '死守（守住回收車）' : S.gmode === 'hunt' ? '清剿（用槍打怪物）' : S.gmode === 'br' ? '廢墟生存戰（互相對戰，活到最後）' : '回收（撿廢料賣錢）') + (S.mode === 'host' ? '（點擊切換）' : '（房主設定）');
  $('mapBtn').textContent = '地圖：' + W.MAPS[S.map || 0].name + (S.mode === 'host' ? '（點擊切換）' : '（房主設定）');
}
// 新手教學：第一次開始遊戲時出現，之後可從「設定與說明」重看
const TUT = [
  ['目標', '在時間內把廢料帶回金色回收車，賺到當天的目標金額。上方的進度條滿了就過關。'],
  ['撿與賣', '走近發亮的廢料就會撿起來，背包容量依等級提升（Lv10 起每 10 等多 1 格）。走回回收車會自動賣掉。跟著畫面上方的箭頭就能找到回收車。'],
  ['怪物', '怪物看得到你，也聽得到跑步聲。聽到心跳聲變快就代表牠在附近。背包滿時牠會被引過來。'],
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
  ['day5', '老練回收員', '回收任務通過第 5 天', function (t) { return t.coop >= 5; }, 100],
  ['day10', '廢墟傳說', '回收任務通過第 10 天', function (t) { return t.coop >= 10; }, 300],
  ['hunt3', '獵人', '清剿行動通過第 3 關', function (t) { return t.hunt >= 3; }, 100],
  ['td3', '守門員', '死守回收車通過第 3 關', function (t) { return t.td >= 3; }, 100],
  ['br1', '最後生還者', '廢墟生存戰拿到第 1 名', function (t) { return t.brWins >= 1; }, 150],
  ['mk50', '清道夫', '累計擊倒 50 隻怪物', function (t) { return t.mk >= 50; }, 150],
  ['g20', '常客', '玩滿 20 局', function (t) { return t.games >= 20; }, 200],
  ['rich', '小富翁', '同時持有 1000 金幣', function (t, p) { return p.coins >= 1000; }, 100],
  ['mk10', '新手獵手', '累計擊倒 10 隻怪物', function (t) { return t.mk >= 10; }, 50],
  ['mk200', '獵怪大師', '累計擊倒 200 隻怪物', function (t) { return t.mk >= 200; }, 400],
  ['wins10', '常勝軍', '累計過關 10 次', function (t) { return t.wins >= 10; }, 150],
  ['wins50', '過關達人', '累計過關 50 次', function (t) { return t.wins >= 50; }, 300],
  ['g50', '老鳥', '玩滿 50 局', function (t) { return t.games >= 50; }, 300],
  ['g100', '鐵人', '玩滿 100 局', function (t) { return t.games >= 100; }, 500],
  ['coop20', '回收大師', '回收任務通過第 20 天', function (t) { return t.coop >= 20; }, 500],
  ['hunt10', '清剿專家', '清剿行動通過第 10 關', function (t) { return t.hunt >= 10; }, 300],
  ['td10', '死守大師', '死守回收車通過第 10 關', function (t) { return t.td >= 10; }, 300],
  ['br3', '廢墟生存戰常客', '廢墟生存戰拿到第 1 名 3 次', function (t) { return t.brWins >= 3; }, 300],
  ['rich300', '小有積蓄', '同時持有 300 金幣', function (t, p) { return p.coins >= 300; }, 40],
  ['rich5000', '大富豪', '同時持有 5000 金幣', function (t, p) { return p.coins >= 5000; }, 300],
  ['wins3', '穩定輸出', '累計過關 3 次', function (t) { return t.wins >= 3; }, 60],
  ['mk500', '殺戮機器', '累計擊倒 500 隻怪物', function (t) { return t.mk >= 500; }, 600],
  ['mk1000', '屠怪王', '累計擊倒 1000 隻怪物', function (t) { return t.mk >= 1000; }, 800],
  ['wins100', '百戰百勝', '累計過關 100 次', function (t) { return t.wins >= 100; }, 800],
  ['g200', '資深員工', '玩滿 200 局', function (t) { return t.games >= 200; }, 1000],
  ['coop30', '廢墟長老', '回收任務通過第 30 天', function (t) { return t.coop >= 30; }, 800],
  ['hunt20', '清剿老手', '清剿行動通過第 20 關', function (t) { return t.hunt >= 20; }, 500],
  ['td20', '城牆守護者', '死守回收車通過第 20 關', function (t) { return t.td >= 20; }, 500],
  ['br10', '逃殺之王', '廢墟生存戰拿到第 1 名 10 次', function (t) { return t.brWins >= 10; }, 800],
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
/** 一局結束：更新統計、解鎖成就、回報排行榜與拾荒團。回傳要加在結算畫面的文字。 */
/* ---------- 歷史戰績 ----------
 * 每局結束記一筆（本機與雲端都只留最近 30 場；登入雲端時存到 users/{uid}/matches，換裝置也看得到，別人點你的頭像也看得到） */
function saveMatch(rec) {
  let a = []; try { a = JSON.parse(ls('rr_hist') || '[]'); } catch (e) {}
  if (!Array.isArray(a)) a = []; a.unshift(rec); lsSet('rr_hist', JSON.stringify(a.slice(0, 30)));
  if (RR.Cloud && RR.Cloud.ready()) RR.Cloud.addMatch(rec);
}
let stRows = [], stMode = 'all', stUid = null, stSeq = 0;
/** 本機與雲端戰績合併，依時間排序，只留 30 場 */
function mergeRows(a, b) {
  const seen = {}, out = [];
  a.concat(b).forEach(function (r) { if (r && !seen[r.t]) { seen[r.t] = 1; out.push(r); } });
  out.sort(function (x, y) { return (y.t || 0) - (x.t || 0); });
  return out.slice(0, 30);
}
/** 打開戰績：uid 省略＝自己 */
function statsOpen(uid, name) {
  const C = RR.Cloud, mine = !uid || (C && uid === C.uid()), seq = ++stSeq;
  stUid = mine ? null : uid; stMode = 'all';
  $('scrStats').classList.remove('hide'); $('stAva').classList.toggle('hide', !mine);
  $('stHead').textContent = ''; $('stSum').textContent = ''; $('stList').textContent = '';
  if (mine) {
    let a = []; try { a = JSON.parse(ls('rr_hist') || '[]'); } catch (e) {}
    const p = prog();
    stHeadDraw({ name: myName(), lv: levelOf(p.xp), clanTag: C && C.me() ? C.me().clanTag : '', code: C && C.me() ? C.me().code : '', bio: p.bio, st: p.st, ach: p.ach, days: p.pdays, since: p.since }, true);
    const local = Array.isArray(a) ? a : [];
    stRows = local; stDraw();
    // 先顯示本機，再拿雲端的戰績合併（換裝置玩的場次也會出現）
    if (C && C.ready()) C.playerStats(C.uid(), function (err, d) {
      if (seq !== stSeq || err) return;
      stRows = mergeRows(d.rows, local); stDraw();
    });
    return;
  }
  stHeadDraw({ name: name || '玩家' }, false);
  $('stList').appendChild(mk('p', 'ccEmpty', '讀取中…'));
  C.playerStats(uid, function (err, d) {
    if (seq !== stSeq) return;
    if (err) { $('stList').textContent = ''; $('stList').appendChild(mk('p', 'ccEmpty', C.message(err))); return; }
    stHeadDraw(Object.assign({ name: name || '玩家' }, d.prof || {}), false);
    stRows = d.rows; stDraw();
  });
}
function stHeadDraw(pf, mine) {
  const h = $('stHead'); h.textContent = '';
  const av = mk('span', 'ccAv stAv', (pf.name || '?').charAt(0));
  const img = mine ? ls('rr_avatar_img') : (pf.avImg || '');
  if (img) { av.textContent = ''; av.style.background = 'center / cover no-repeat url(' + img + ')'; } else av.style.background = (mine ? ls('rr_avatar') : pf.av) || '#f0c040';
  const tx = mk('div', 'stWho'); tx.appendChild(mk('b', null, (pf.name || '玩家') + (mine ? '（你）' : '')));
  tx.appendChild(mk('span', null, (pf.lv ? 'Lv.' + pf.lv : '') + (pf.clanTag ? '　拾荒團 [' + pf.clanTag + ']' : '') + (pf.region ? '　' + (pf.region === 'hk' ? '香港' : '台灣') : '')));
  tx.appendChild(mk('span', 'stId', 'ID ' + (pf.code || '—')));
  { const bits = []; if (pf.days) bits.push('遊玩 ' + pf.days + ' 天'); if (pf.since) bits.push(pf.since + ' 加入'); const sn = mine ? '線上' : seenText(pf.seen); if (sn) bits.push(sn); if (bits.length) tx.appendChild(mk('span', 'stDays', bits.join('　'))); }
  if (mine) {
    const bi = mk('input', 'stBio'); bi.type = 'text'; bi.maxLength = 30; bi.placeholder = '寫一句簡介（30 字內）'; bi.value = pf.bio || '';
    bi.addEventListener('change', function () { const p = prog(); p.bio = bi.value.replace(/[<>]/g, '').trim().slice(0, 30); progSave(p); RR.Cloud.saveSoon(); });
    tx.appendChild(bi);
  } else if (pf.bio) tx.appendChild(mk('span', 'stBioTxt', pf.bio));
  h.appendChild(av); h.appendChild(tx);
  // 成就：點開可以看到這個人完成了哪些（自己和朋友都看得到）
  { const got = Array.isArray(pf.ach) ? pf.ach : [], names = ACH.filter(function (a) { return got.indexOf(a[0]) >= 0; });
    if (pf.ach || mine) {
      const d = mk('details', 'stAch'), s = mk('summary', null, '成就 ' + names.length + ' / ' + ACH.length); d.appendChild(s);
      const box = mk('div', 'stAchList');
      ACH.forEach(function (a) { const ok = got.indexOf(a[0]) >= 0, c = mk('span', ok ? 'on' : '', (ok ? '✓ ' : '') + a[1]); c.title = a[2]; box.appendChild(c); });
      d.appendChild(box); h.appendChild(d);
    } }
  const st = pf.st || {};
  if (st.games) { const t = mk('div', 'stTot'); t.appendChild(mk('span', null, '總場數 ' + (st.games | 0))); t.appendChild(mk('span', null, '勝率 ' + Math.round((st.wins | 0) / Math.max(1, st.games) * 100) + '%')); t.appendChild(mk('span', null, '擊倒 ' + (st.mk | 0))); h.appendChild(t); }
}
function stDraw() {
  Array.prototype.forEach.call(document.querySelectorAll('#stTabs button'), function (b) { b.classList.toggle('on', b.dataset.m === stMode); });
  const rows = stRows.filter(function (r) { return stMode === 'all' || r.mode === stMode; }), list = $('stList'), sum = $('stSum');
  list.textContent = ''; sum.textContent = '';
  const w = rows.filter(function (r) { return r.win; }).length, k = rows.reduce(function (s, r) { return s + (r.kills | 0); }, 0), mvp = rows.filter(function (r) { return r.mvp; }).length;
  [['場數', rows.length], ['勝率', rows.length ? Math.round(w / rows.length * 100) + '%' : '—'], ['擊倒', k], ['MVP', mvp]].forEach(function (x) { const c = mk('div'); c.appendChild(mk('b', null, String(x[1]))); c.appendChild(mk('span', null, x[0])); sum.appendChild(c); });
  if (!rows.length) { list.appendChild(mk('p', 'ccEmpty', stMode === 'all' ? '還沒有戰績。打完一局就會記錄在這裡。' : '這個模式還沒有戰績。')); return; }
  const head = mk('div', 'stRow stTh'); ['結果', '分數', '擊倒/倒下', '模式'].forEach(function (t) { head.appendChild(mk('span', null, t)); }); list.appendChild(head);
  rows.forEach(function (r) {
    const row = mk('div', 'stRow' + (r.win ? ' win' : ''));
    const res = mk('span', 'stRes'); res.appendChild(mk('b', null, r.mode === 'br' ? '第 ' + (r.rank || '?') + ' 名' : r.win ? '勝利' : '失敗'));
    if (r.mvp) res.appendChild(mk('i', 'stMvp', 'MVP'));
    row.appendChild(res);
    row.appendChild(mk('span', 'stNum', String(r.score | 0)));
    row.appendChild(mk('span', 'stNum', (r.kills | 0) + ' / ' + (r.deaths | 0)));
    const md = mk('span', 'stMode'); md.appendChild(mk('b', null, (MODE_NAME[r.mode] || r.mode) + (r.mode !== 'br' ? '・第 ' + (r.day | 0) + (r.mode === 'coop' ? ' 天' : ' 關') : '')));
    const d = new Date(r.t || 0); md.appendChild(mk('small', null, (r.map ? r.map + '　' : '') + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')));
    row.appendChild(md); list.appendChild(row);
  });
}
/** 讓名字或頭像可以點：打開那個人的戰績 */
function statsLink(el, uid, name) {
  if (!el || !uid) return; el.classList.add('stLink'); el.setAttribute('role', 'button'); el.tabIndex = 0;
  el.addEventListener('click', function (e) { e.stopPropagation(); statsOpen(uid, name); });
}
function afterMatch(mode, win, day, myStat, coins, info) {
  const p = prog(), t = p.st;
  info = info || {};
  saveMatch({ mode: mode, win: !!win, day: day | 0, score: Math.max(0, Math.floor(info.score || 0)), kills: (info.kills != null ? info.kills : myStat && myStat.mk) | 0,
    deaths: info.deaths | 0, rank: info.rank | 0, mvp: !!info.mvp, n: info.n | 0, map: (W.MAPS[myMap()] || {}).name || '', t: Date.now() });
  t.games++; if (win) t.wins++;
  t.mk += (myStat && myStat.mk) | 0;
  if (mode === 'br') { if (win) t.brWins++; }
  else if (win && day > t[mode]) t[mode] = day;
  const got = [];
  ACH.forEach(function (a) { if (p.ach.indexOf(a[0]) < 0 && a[3](t, p)) { p.ach.push(a[0]); p.coins += a[4]; got.push(a[1] + ' +' + a[4]); } });
  // 段位積分：金幣同時累積成個人本週積分（跨週歸零）；輪換地圖 +20%，金幣本身不變
  const w = RR.Cloud.weekId(), pts = Math.round((coins | 0) * (rotMaps().indexOf(myMap()) >= 0 ? 1.2 : 1));
  if (p.wk !== w) { p.wk = w; p.wpts = 0; }
  p.wpts = (p.wpts | 0) + pts;
  progSave(p);
  if (RR.Cloud.ready()) {
    if (mode === 'br') { if (win) RR.Cloud.submit('br', 1); }
    else if (t[mode] > 0) RR.Cloud.submit(mode, t[mode]);
    RR.Cloud.clanAdd(pts);
  }
  return got.length ? '，成就：' + got.join('、') : '';
}
/** 上週排行榜各模式前 3 名：送限定頭飾（每週只結算一次，查詢失敗就下次再試） */
/* ---------- QR code 加好友 ----------
 * QR 內容是遊戲網址加上 ?add=好友代碼；用手機相機掃了會打開遊戲，登入後自動加好友 */
function qrUrl(code) { return location.origin + location.pathname + '?add=' + encodeURIComponent(code); }
function qrShow(name, code) {
  if (!code) { say('還沒有好友代碼，請先登入雲端帳號。'); return; }
  const draw = function () {
    let svg = '';
    try { const q = window.qrcode(0, 'M'); q.addData(qrUrl(code)); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { say('QR code 產生失敗。'); return; }
    $('qrImg').innerHTML = svg; $('qrName').textContent = name || '玩家'; $('qrCode').textContent = code; $('qrBox').classList.remove('hide');
  };
  if (window.qrcode) { draw(); return; }
  const sc = document.createElement('script'); sc.src = 'vendor/qrcode.js'; sc.onload = draw; sc.onerror = function () { say('QR code 載入失敗，請確認網路。'); }; document.head.appendChild(sc);
}
// 掃 QR 打開的網址：記下代碼，登入後再加
(function () {
  try {
    const add = new URLSearchParams(location.search).get('add');
    if (add) { lsSet('rr_pending_add', add.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); history.replaceState(null, '', location.pathname); }
  } catch (e) {}
})();
function pendingFriend() {
  const code = ls('rr_pending_add'); if (!code || !RR.Cloud.ready()) return;
  try { localStorage.removeItem('rr_pending_add'); } catch (e) {}
  RR.Cloud.addFriend(code, function (err, name) { say(err ? RR.Cloud.message(err) : '已和 ' + name + ' 成為好友。'); });
}
function checkWeekReward() {
  const C = RR.Cloud;
  if (!C || !C.ready()) return;
  const lastW = C.weekId() - 1, uid = C.uid();
  if (prog().rewW === lastW) return;
  let left = C.MODES.length, won = false, failed = false;
  C.MODES.forEach(function (m) {
    C.top(m, 'w' + lastW, function (err, rows) {
      if (err) failed = true;
      else if ((rows || []).slice(0, 3).some(function (r) { return r.uid === uid; })) won = true;
      if (--left === 0) finish();
    });
  });
  function finish() {
    if (failed) return;
    const q = prog();
    if (q.rewW === lastW) return;
    q.rewW = lastW;
    if (won && q.hats.indexOf(LIMITED_HAT) < 0) q.hats.push(LIMITED_HAT);
    progSave(q); renderProg();
    if (won) bannerShow('上週全區前 3 名！', '獲得限定頭飾「冠軍王冠」');
  }
}
/** 遊玩天數：每天第一次打開遊戲 +1（舊玩家第一次用戰績裡不同的日期補算） */
function markPlayDay() {
  const p = prog(), td = dayStr(0);
  if (p.pday === td) return;
  if (p.pdays == null) {
    let h = []; try { h = JSON.parse(ls('rr_hist') || '[]'); } catch (e) {}
    const ds = {}; (Array.isArray(h) ? h : []).forEach(function (r) { if (r && r.t) { const d = new Date(r.t); ds[d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()] = 1; } });
    delete ds[td]; p.pdays = Object.keys(ds).length;
    if (!p.since) { const ts = (Array.isArray(h) ? h : []).map(function (r) { return r && r.t; }).filter(Boolean); const d0 = new Date(ts.length ? Math.min.apply(null, ts) : Date.now()); p.since = d0.getFullYear() + '/' + (d0.getMonth() + 1) + '/' + d0.getDate(); }
  }
  p.pdays = (p.pdays | 0) + 1; p.pday = td;
  if (!p.since) { const d = new Date(); p.since = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
  progSave(p);
}
/** 上次上線：線上／幾分鐘前／幾小時前／幾天前 */
function seenText(t) {
  t = Number(t) || 0; if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 4) return '線上'; if (m < 60) return m + ' 分鐘前在線'; if (m < 1440) return Math.floor(m / 60) + ' 小時前在線';
  return Math.min(999, Math.floor(m / 1440)) + ' 天前在線';
}
function dailyLogin() {
  const p = prog(), td = dayStr(0);
  if (p.login && p.login.d === td) return;
  const streak = p.login && p.login.d === dayStr(-1) ? (p.login.s | 0) + 1 : 1, gift = 20 + 10 * Math.min(streak - 1, 6);
  p.login = { d: td, s: streak }; p.coins += gift; progSave(p); renderProg();
  say('每日登入獎勵：金幣 +' + gift + '（連續第 ' + streak + ' 天' + (streak < 7 ? '，明天再來會更多' : '') + '）');
}
/* ---------- 社群畫面 ---------- */
const MODE_NAME = { coop: '回收任務', hunt: '清剿行動', td: '死守回收車', br: '廢墟生存戰', card: '怪物卡牌' };
let socTab = 'rank', socMode = 'coop', socScope = 'week';
/* 社群排行可選的模式：主玩法（含卡牌）＋休閒的 AR */
const SOC_MODES = ['coop', 'hunt', 'td', 'br', 'card', 'ar'];
function socModeName(m) { return m === 'ar' ? 'AR 抓怪（隻數）' : MODE_NAME[m] + '模式'; }
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
    statsLink(row, r.uid, r.name);
    row.appendChild(mk('span', 'rk', String(i + 1)));
    const nm = mk('span', 'nm', r.name || '玩家'); if (r.clan) nm.appendChild(mk('small', null, ' [' + r.clan + ']')); row.appendChild(nm);
    row.appendChild(mk('span', 'sc', unit(r.score | 0))); b.appendChild(row);
  });
}
function scoreUnit(mode) { return function (v) { return mode === 'ar' ? v + ' 隻' : mode === 'br' || mode === 'card' ? v + ' 勝' : mode === 'coop' ? '第 ' + v + ' 天' : '第 ' + v + ' 關'; }; }
const CLAN_TYPE = { open: '開放加入', approve: '需要批准', invite: '僅限邀請' }, CLAN_REGION = { all: '全球', tw: '台灣', hk: '香港' };
/** 拾荒團名片：徽章、名稱、描述、類型、最低等級、地區、人數（拾荒團頁上方與拾荒團列表共用） */
function clanCard(c, extra) {
  const C = RR.Cloud, box = mk('div', 'clanCard');
  box.appendChild(mk('span', 'clanBadge', C.CLAN_BADGES[c.badge | 0] || C.CLAN_BADGES[0]));
  const tx = mk('div', 'clanTx'); tx.appendChild(mk('b', null, c.name || '拾荒團'));
  if (c.desc) tx.appendChild(mk('span', 'clanDesc', c.desc));
  const chips = mk('div', 'clanChips');
  [CLAN_TYPE[c.type || 'open'], (c.minLv | 0) ? 'Lv ' + (c.minLv | 0) + ' 以上' : '不限等級', CLAN_REGION[c.region || 'all'], (c.count | 0) + ' / 30 人'].concat(extra || []).forEach(function (t) { chips.appendChild(mk('i', null, t)); });
  tx.appendChild(chips); box.appendChild(tx);
  return box;
}
/** 拾荒團設定表單（團長、副團長） */
function clanSettingsForm(c, done) {
  const C = RR.Cloud, f = mk('div', 'clanSet'), st = { badge: c.badge | 0 };
  f.appendChild(mk('b', null, '拾荒團設定'));
  f.appendChild(mk('span', 'lbl', '徽章'));
  const bg = mk('div', 'clanBadges');
  C.CLAN_BADGES.forEach(function (e, i) { const bt = mk('button', i === st.badge ? 'on' : '', e); bt.type = 'button'; bt.addEventListener('click', function () { st.badge = i; Array.prototype.forEach.call(bg.children, function (x, k) { x.classList.toggle('on', k === i); }); }); bg.appendChild(bt); });
  f.appendChild(bg);
  f.appendChild(mk('span', 'lbl', '描述（60 字內）'));
  const ds = mk('textarea'); ds.maxLength = 60; ds.rows = 2; ds.value = c.desc || ''; ds.placeholder = '例如：每天上線、一起衝大師'; f.appendChild(ds);
  const sel = function (label, opts, cur) { f.appendChild(mk('span', 'lbl', label)); const s = mk('select'); opts.forEach(function (o) { const op = mk('option', null, o[1]); op.value = o[0]; if (String(o[0]) === String(cur)) op.selected = true; s.appendChild(op); }); f.appendChild(s); return s; };
  const ty = sel('類型', [['open', '開放加入（任何人都能直接加入）'], ['approve', '需要批准（申請後由團長或副團長同意）'], ['invite', '僅限邀請（只能用拾荒團代碼加入）']], c.type || 'open');
  const lv = sel('最低等級', Array.from({ length: 21 }, function (_, i) { return [i * 5, i ? 'Lv ' + i * 5 + ' 以上' : '不限']; }), c.minLv | 0);
  const rg = sel('地區', [['all', '全球'], ['tw', '台灣'], ['hk', '香港']], c.region || 'all');
  const sv = mk('button', 'btn primary', '儲存'); sv.type = 'button';
  sv.addEventListener('click', function () { sv.disabled = true; C.clanSettings({ badge: st.badge, desc: ds.value, type: ty.value, minLv: +lv.value, region: rg.value }, function (err) { sv.disabled = false; if (err) { say(C.message(err)); return; } mtoast('拾荒團設定已儲存'); done(); }); });
  f.appendChild(sv);
  return f;
}
let socRegion = null;   // 賽季頁正在看的地區（all／tw／hk），null＝自己的地區
function renderSocial() {
  const b = $('socBody'), C = RR.Cloud; b.textContent = '';
  renderSocial.token = {};   // 先換掉，上一個分頁還在讀取的資料回來時就不會塞進這一頁
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
  const modeSel = socSelect(SOC_MODES.map(function (m) { return [m, socModeName(m)]; }), socMode, function (v) { socMode = v; renderSocial(); });
  if (socTab === 'rank') {
    const mine = myWeekPts();
    const tr = mk('p', 'note', '我的本週段位：' + PTIERS[ptierOf(mine)].n + '（' + mine + ' 分）');
    b.appendChild(mk('p', 'note', '排行榜每週日 24:00（台灣時間）重新計算。上週各模式全區前 3 名，會獲得限定造型「冠軍王冠」。'));
    const tbtn = mk('button', 'btn', '段位與輪換說明'); tbtn.type = 'button'; tbtn.style.margin = '6px 0 10px';
    tbtn.addEventListener('click', openTierInfo); b.appendChild(tr); b.appendChild(tbtn);
    const rankSel = socSelect(SOC_MODES.map(function (m) { return [m, socModeName(m)]; }).concat([['mix', '全部模式']]), socMode, function (v) { socMode = v; renderSocial(); });
    const row = mk('div', 'soc-row'); row.appendChild(rankSel);
    row.appendChild(socSelect([['week', '本週'], ['all', '總榜']], socScope, function (v) { socScope = v; renderSocial(); })); b.appendChild(row);
    b.appendChild(mk('p', 'note wait', '讀取中…'));
    const scope = socScope === 'all' ? 'all' : 'w' + C.weekId();
    if (socMode !== 'mix') { C.top(socMode, scope, guard(function (rows) { socRows(rows, scoreUnit(socMode)); })); }
    else {
      // 全部模式：每個模式依名次給分（第 1 名 20 分，第 20 名 1 分，榜外 0 分），四個模式加總
      const pts = {}, who = {}; let left = C.MODES.length;
      C.MODES.forEach(function (m) {
        C.top(m, scope, function (err, rows) {
          if (renderSocial.token !== token) return;
          if (!err) rows.forEach(function (r, i) { if (!who[r.uid]) who[r.uid] = r; pts[r.uid] = (pts[r.uid] || 0) + (21 - (i + 1)); });
          if (--left > 0) return;
          const w = b.querySelector('.wait'); if (w) w.remove();
          const list = Object.keys(pts).map(function (k) { return Object.assign({}, who[k], { uid: k, score: pts[k] }); }).sort(function (x, y) { return y.score - x.score; }).slice(0, 20);
          socRows(list, function (v) { return v + ' 分'; }, '還沒有人上榜。');
        });
      });
    }
  } else if (socTab === 'season') {
    if (socMode === 'mix') socMode = 'coop';
    const p = prog(), rk = ['tw', 'hk'][p.region];
    // 下拉選單只切換「看哪一區」，不會改你自己的地區（地區在設定裡改）
    // 只看得到自己的賽區和全區；賽區每週只能換一次（週日 24:00 後）
    if (socRegion !== 'all') socRegion = rk;
    const row = mk('div', 'soc-row');
    row.appendChild(socSelect([[rk, C.REGIONS[p.region] + '區'], ['all', '全區']], socRegion, function (v) { socRegion = v; renderSocial(); }));
    row.appendChild(modeSel); b.appendChild(row);
    socNote('每週一換季。上週在自己賽區前 10 名可以領金幣（第 1 名 300、第 2～3 名 200、第 4～10 名 100）。');
    { const canSwap = p.regionW !== C.weekId(), sw = mk('button', 'btn', canSwap ? '換賽區（本週還可以換 1 次）' : '本週已選過賽區，週日 24:00 後才能再換'); sw.type = 'button'; sw.disabled = !canSwap; sw.style.margin = '0 0 10px';
      sw.addEventListener('click', function () { $('regionAsk').classList.remove('hide'); }); b.appendChild(sw); }
    const claim = mk('div'); b.appendChild(claim);
    b.appendChild(mk('p', 'note wait', '讀取中…'));
    C.top(socMode, (socRegion === 'all' ? '' : socRegion + '_') + 'w' + C.weekId(), guard(function (rows) { socRows(rows, scoreUnit(socMode), socRegion === 'all' ? '本週還沒有人上榜。' : '本週這個地區還沒有人上榜。'); }));
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
    { const myQr = mk('button', 'btn', '我的 QR code'); myQr.type = 'button'; myQr.addEventListener('click', function () { qrShow(myName(), C.me() && C.me().code); }); b.appendChild(myQr); }
    // 用名字搜尋玩家：可以直接加好友，或顯示對方的 QR code 讓別人掃
    const srow = mk('div', 'soc-row'), sinp = mk('input'); sinp.type = 'text'; sinp.maxLength = 12; sinp.placeholder = '輸入玩家名字或 6 碼代碼'; sinp.autocomplete = 'off';
    const sbtn = mk('button', 'btn', '搜尋'); sbtn.type = 'button';
    const sres = mk('div');
    const doSearch = function () {
      sres.textContent = ''; sres.appendChild(mk('p', 'ccEmpty', '搜尋中…'));
      const typed = String(sinp.value || '').replace(/\s+/g, ' ').trim().slice(0, 12), asCode = typed.toUpperCase();
      const lookup = /^[A-Z0-9]{6}$/.test(asCode) ? function (cb) { C.findByCode(asCode, cb); } : function (cb) { C.searchUsers(typed, cb); };
      lookup(function (err, rows) {
        sres.textContent = '';
        if (err) { sres.appendChild(mk('p', 'ccEmpty', C.message(err))); return; }
        if (!rows.length) { sres.appendChild(mk('p', 'ccEmpty', asCode.length === 6 && lookup.length && /^[A-Z0-9]{6}$/.test(asCode) ? '找不到這個代碼的玩家。' : '找不到這個名字的玩家。')); return; }
        rows.forEach(function (u) {
          const r = mk('div', 'srow'); r.appendChild(mk('span', 'nm', u.name + (u.lv ? '　Lv.' + u.lv : '')));
          const qb = mk('button', 'btn', 'QR'); qb.type = 'button'; qb.addEventListener('click', function () { qrShow(u.name, u.code); });
          const ab = mk('button', 'btn primary', '加好友'); ab.type = 'button';
          ab.addEventListener('click', function () { ab.disabled = true; C.addFriend(u.code, function (e2, name) { ab.disabled = false; if (e2) { say(C.message(e2)); return; } say('已和 ' + name + ' 成為好友。'); renderSocial(); }); });
          r.appendChild(qb); r.appendChild(ab); sres.appendChild(r);
        });
      });
    };
    sbtn.addEventListener('click', doSearch); sinp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    srow.appendChild(sinp); srow.appendChild(sbtn); b.appendChild(srow); b.appendChild(sres);
    const row = mk('div', 'soc-row'), inp = mk('input'); inp.type = 'text'; inp.maxLength = 6; inp.placeholder = '輸入朋友的代碼'; inp.autocapitalize = 'characters'; inp.autocomplete = 'off';
    const add = mk('button', 'btn primary', '加好友'); add.type = 'button';
    add.addEventListener('click', function () { add.disabled = true; C.addFriend(inp.value, function (err, name) { add.disabled = false; if (err) { say(C.message(err)); return; } say('已和 ' + name + ' 成為好友。'); renderSocial(); }); });
    row.appendChild(inp); row.appendChild(add); b.appendChild(row);
    const fl = mk('div'); b.appendChild(fl);
    // 先顯示上次的好友列表，再更新，不用每次都等
    const paint = function (rows) {
      lsSet('rr_friends', JSON.stringify(rows.slice(0, 40).map(function (f) { return { uid: f.uid, name: f.name, lv: f.lv, online: f.online, seen: f.seen, room: f.room, clan: f.clan }; })));
      fl.textContent = '';
      if (!rows.length) { fl.appendChild(mk('p', 'note', '還沒有好友。把上面的代碼傳給朋友，或輸入他的代碼。')); return; }
      rows.forEach(function (f) {
        const r = mk('div', 'srow'); r.appendChild(mk('span', f.online ? 'dotOn' : 'dotOff'));
        const nm = mk('span', 'nm', f.name); statsLink(nm, f.uid, f.name); nm.appendChild(mk('small', null, '　Lv.' + f.lv + (f.clan ? ' [' + f.clan + ']' : '') + (f.online ? (f.room ? '，在房間 ' + f.room : '，線上') : '，' + (seenText(f.seen) || '離線')))); r.appendChild(nm);
        if (f.online && f.room) { const j = mk('button', 'btn primary', '加入'); j.type = 'button'; j.addEventListener('click', function () { $('scrSocial').classList.add('hide'); $('codeInput').value = f.room; joinRoom(); }); r.appendChild(j); }
        if (Net.code && Net.code()) { const iv = mk('button', 'btn', '邀請'); iv.type = 'button'; iv.addEventListener('click', function () { iv.disabled = true; RR.Cloud.inviteSend(f.uid, Net.code(), S.gmode, function (e) { iv.textContent = e ? '失敗' : '已送出'; }); }); r.appendChild(iv); }
        const del = mk('button', 'btn', '刪除'); del.type = 'button'; del.addEventListener('click', function () { C.removeFriend(f.uid, function () { renderSocial(); }); }); r.appendChild(del);
        fl.appendChild(r);
      });
    };
    let cached = null; try { cached = JSON.parse(ls('rr_friends') || 'null'); } catch (e) {}
    if (Array.isArray(cached) && cached.length) { paint(cached); fl.appendChild(mk('p', 'note wait', '更新中…')); }
    else fl.appendChild(mk('p', 'note wait', '讀取中…'));
    C.friends(guard(paint));
  } else if (socTab === 'clan') {
    b.appendChild(mk('p', 'note wait', '讀取中…'));
    C.clan(guard(function (info) {
      if (!info) {
        socNote('加入拾荒團後，每局得到的金幣數會同時累積成拾荒團積分。本週積分決定段位，每週一重算。');
        // 申請中的拾荒團：被批准就自動加入
        const pend = mk('div'); b.appendChild(pend);
        C.checkApply(function (e2, r) {
          if (renderSocial.token !== token || e2 || !r) return;
          if (r.state === 'joined') { say('「' + r.name + '」批准了你的申請，已加入拾荒團。'); renderSocial(); return; }
          if (r.state === 'rejected') { pend.appendChild(mk('p', 'note', '你申請的拾荒團' + (r.name ? '「' + r.name + '」' : '') + '沒有通過，可以再找其他拾荒團。')); return; }
          if (r.state === 'wait') { pend.appendChild(mk('p', 'note', '已申請加入「' + r.name + '」，等待團長或副團長批准。')); const cx = mk('button', 'btn', '取消申請'); cx.type = 'button'; cx.addEventListener('click', function () { C.cancelApply(function () { renderSocial(); }); }); pend.appendChild(cx); }
        });
        const r1 = mk('div', 'soc-row'), tag = mk('input'); tag.type = 'text'; tag.maxLength = 4; tag.placeholder = '邀請代碼（4 碼）'; tag.autocapitalize = 'characters';
        const jb = mk('button', 'btn primary', '加入'); jb.type = 'button';
        jb.addEventListener('click', function () { jb.disabled = true; C.joinClan(tag.value, function (err, c) { jb.disabled = false; if (err) { say(C.message(err)); return; } say('已加入拾荒團「' + c.name + '」。'); renderSocial(); }); });
        r1.appendChild(tag); r1.appendChild(jb); b.appendChild(r1);
        const r2 = mk('div', 'soc-row'), nm = mk('input'); nm.type = 'text'; nm.maxLength = 12; nm.placeholder = '新拾荒團名稱';
        const cb = mk('button', 'btn', '建立（200 金幣）'); cb.type = 'button';
        cb.addEventListener('click', function () {
          const q = prog(); if (q.coins < 200) { say('金幣不夠：建立拾荒團要 200 金幣，你有 ' + q.coins + '。'); return; }
          cb.disabled = true;
          C.createClan(nm.value, function (err, c) { cb.disabled = false; if (err) { say(C.message(err)); return; } const q2 = prog(); q2.coins -= 200; progSave(q2); renderProg(); say('拾荒團「' + c.name + '」建立完成。把代碼 ' + c.tag + ' 傳給朋友就能加入。'); renderSocial(); });
        });
        r2.appendChild(nm); r2.appendChild(cb); b.appendChild(r2);
        // 瀏覽拾荒團：看得到每個拾荒團的設定，依類型直接加入或申請
        b.appendChild(mk('div', 'sec', '尋找拾荒團'));
        const bl = mk('div'); bl.appendChild(mk('p', 'ccEmpty', '讀取中…')); b.appendChild(bl);
        C.browseClans(function (e3, rows) {
          if (renderSocial.token !== token) return; bl.textContent = '';
          if (e3) { bl.appendChild(mk('p', 'ccEmpty', C.message(e3))); return; }
          if (!rows.length) { bl.appendChild(mk('p', 'ccEmpty', '還沒有拾荒團，建立第一個吧。')); return; }
          const myLv = levelOf(prog().xp), pending = C.me() && C.me().pendClan;
          rows.forEach(function (c) {
            const card = clanCard(c), t = c.type || 'open', full = (c.count | 0) >= 30, lowLv = (c.minLv | 0) > myLv;
            const bt = mk('button', 'btn' + (t === 'invite' ? '' : ' primary'), full ? '已滿' : lowLv ? '需要 Lv ' + (c.minLv | 0) : t === 'open' ? '加入' : t === 'approve' ? (pending === c.id ? '已申請' : '申請加入') : '僅限邀請');
            bt.type = 'button'; bt.disabled = full || lowLv || t === 'invite' || (t === 'approve' && !!pending);
            bt.addEventListener('click', function () {
              bt.disabled = true;
              if (t === 'open') C.joinOpenClan(c.id, function (err, cl) { bt.disabled = false; if (err) { say(C.message(err)); return; } say('已加入拾荒團「' + cl.name + '」。'); renderSocial(); });
              else C.applyClan(c.id, function (err) { if (err) { bt.disabled = false; say(C.message(err)); return; } say('已送出申請，團長或副團長批准後就會加入「' + c.name + '」。'); renderSocial(); });
            });
            card.appendChild(bt); bl.appendChild(card);
          });
        });
      } else {
        const wsNow = info.clan.wk === C.weekId() ? (info.clan.wscore | 0) : 0, ti = C.tierOf(wsNow), bi = info.clan.best | 0, TT = C.TIERS;
        b.appendChild(clanCard(Object.assign({}, info.clan, { count: info.members.length }), ['累計 ' + (info.clan.score | 0) + ' 分']));
        const staff = info.clan.owner === RR.Cloud.uid() || (info.clan.deputies || []).indexOf(RR.Cloud.uid()) >= 0;
        if (staff) {
          const setWrap = mk('div'), sb = mk('button', 'btn', '拾荒團設定'); sb.type = 'button'; sb.style.margin = '0 0 8px';
          sb.addEventListener('click', function () { if (setWrap.firstChild) { setWrap.textContent = ''; return; } setWrap.appendChild(clanSettingsForm(info.clan, renderSocial)); });
          b.appendChild(sb); b.appendChild(setWrap);
          // 加入申請
          const rq = mk('div'); b.appendChild(rq);
          C.clanReqs(function (e4, rows) {
            if (renderSocial.token !== token || e4 || !rows.length) return;
            rq.appendChild(mk('div', 'sec', '加入申請（' + rows.length + '）'));
            rows.forEach(function (x) {
              const r = mk('div', 'srow'); r.appendChild(mk('span', 'nm', (x.name || '玩家') + (x.lv ? '　Lv.' + x.lv : '')));
              const ok = mk('button', 'btn primary', '批准'), no = mk('button', 'btn', '拒絕'); ok.type = no.type = 'button';
              ok.addEventListener('click', function () { C.answerReq(x.uid, true, function (err) { if (err) say(C.message(err)); else mtoast('已批准，對方下次打開拾荒團頁就會加入'); renderSocial(); }); });
              no.addEventListener('click', function () { C.answerReq(x.uid, false, function (err) { if (err) say(C.message(err)); renderSocial(); }); });
              r.appendChild(ok); r.appendChild(no); rq.appendChild(r);
            });
          });
        }
        b.appendChild(mk('p', 'note', '邀請代碼（給朋友輸入就能加入）'));
        { const tb2 = mk('button', 'btn', '段位與輪換說明'); tb2.type = 'button'; tb2.style.margin = '0 0 8px'; tb2.addEventListener('click', openTierInfo); b.appendChild(tb2); }
        b.appendChild(mk('p', 'note', '本週 ' + wsNow + ' 分，段位 ' + TT[ti].n + (ti < TT.length - 1 ? '（下一階 ' + TT[ti + 1].n + ' 還差 ' + (TT[ti + 1].min - wsNow) + ' 分）' : '') + '；歷史最高 ' + TT[bi].n));
        b.appendChild(mk('div', 'bigcode', info.clan.tag));
        { const cc = mk('button', 'btn primary', '打開拾荒團聊天'); cc.type = 'button'; cc.style.width = '100%'; cc.style.margin = '6px 0 10px'; cc.addEventListener('click', function () { $('scrSocial').classList.add('hide'); renderSocial.token = null; clanFrom = 'social'; clanOpen(); }); b.appendChild(cc); }
        const isLeader = info.clan.owner === RR.Cloud.uid(), deps = info.clan.deputies || [];
        const roleOf = function (m) { return m.uid === info.clan.owner ? '團長' : deps.indexOf(m.uid) >= 0 ? '副團長' : '團員'; };
        socRows(info.members.map(function (m) { return Object.assign({}, m, { name: (m.name || '玩家') + ' 〔' + roleOf(m) + '〕' + (seenText(m.seen) ? '・' + seenText(m.seen) : '') }); }), function (v) { return v + ' 分'; });
        const my = RR.Cloud.uid();
        const amDep = deps.indexOf(my) >= 0;
        if (isLeader || amDep) info.members.forEach(function (m) {
          if (m.uid === info.clan.owner || m.uid === my) return;
          const isDep = deps.indexOf(m.uid) >= 0, r = mk('div', 'srow');
          r.appendChild(mk('span', 'nm', (m.name || '玩家') + ' · ' + roleOf(m) + (seenText(m.seen) ? ' · ' + seenText(m.seen) : '')));
          if (isLeader) {
            const bt = mk('button', 'btn', isDep ? '取消副團長' : '設為副團長'); bt.type = 'button';
            bt.addEventListener('click', function () { C.setDeputy(m.uid, !isDep, function (err) { if (err) say(C.message(err)); renderSocial(); }); });
            r.appendChild(bt);
            const tb = mk('button', 'btn', '轉移團長'); tb.type = 'button';
            tb.addEventListener('click', function () { ask('確定把團長轉給「' + (m.name || '玩家') + '」？你會變成團員。', function () { C.transferLeader(m.uid, function (err) { if (err) say(C.message(err)); renderSocial(); }); }); });
            r.appendChild(tb);
          }
          if (isLeader || !isDep) {
            const kb = mk('button', 'btn', '踢出'); kb.type = 'button';
            kb.addEventListener('click', function () { ask('確定要把「' + (m.name || '玩家') + '」踢出拾荒團？', function () { C.kickMember(m.uid, function (err) { if (err) say(C.message(err)); renderSocial(); }); }); });
            r.appendChild(kb);
          }
          b.appendChild(r);
        });
        const lv = mk('button', 'btn', '退出拾荒團'); lv.type = 'button'; lv.addEventListener('click', function () { C.leaveClan(function (err) { if (err) say(C.message(err)); renderSocial(); }); }); b.appendChild(lv);
      }
      b.appendChild(mk('div', 'sec', '拾荒團排行榜（本週）'));
      C.topClans(function (err, rows) {
        if (err || renderSocial.token !== token) return;
        if (!rows.length) { socNote('本週還沒有拾荒團得分。'); return; }
        rows.forEach(function (c, i) { const r = mk('div', 'srow' + (C.me() && C.me().clan === c.id ? ' me' : '')); r.appendChild(mk('span', 'rk', String(i + 1))); const nm = mk('span', 'nm', (C.CLAN_BADGES[c.badge | 0] || '') + ' ' + c.name); nm.appendChild(mk('small', null, '　' + (c.count | 0) + ' 人・' + CLAN_TYPE[c.type || 'open'])); r.appendChild(nm); r.appendChild(mk('span', 'sc', (c.wscore | 0) + ' 分 · ' + C.TIERS[C.tierOf(c.wscore)].n));
          if (!(C.me() && C.me().clan) && (c.count | 0) < 30 && (c.type || 'open') === 'open') { const j = mk('button', 'btn primary', '+'); j.type = 'button'; j.title = '加入拾荒團'; j.addEventListener('click', function () { j.disabled = true; C.joinOpenClan(c.id, function (err, cl) { j.disabled = false; if (err) { say(C.message(err)); return; } say('已加入拾荒團「' + cl.name + '」。'); renderSocial(); }); }); r.appendChild(j); }
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
  $('resGain').textContent = '金幣 +' + coins + '，經驗 +' + (coins + 10) + afterMatch('br', win, 1, null, coins, { score: (mine.kills || 0) * 100 + (n - mine.rank + 1) * 50, kills: mine.kills || 0, deaths: win ? 0 : 1, rank: mine.rank, mvp: win, n: n });
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
    let best = null; (e.stats || []).forEach(function (q) { if (q.earned > 0 && (!best || q.earned > best.earned)) best = q; });
    $('resGain').textContent = txt + afterMatch(S.gmode === 'hunt' || S.gmode === 'td' ? S.gmode : 'coop', !!e.win, e.day, mine, prog().coins - c0,
      { score: mine ? (mine.earned | 0) : (e.money | 0), kills: mine ? mine.mk | 0 : 0, deaths: mine && !mine.alive ? 1 : 0, mvp: !!(mine && best && best.id === mine.id && (e.stats || []).length > 1), n: (e.stats || []).length }); }
  let top = null; if (e.stats) e.stats.forEach(function (p) { if (p.earned > 0 && (!top || p.earned > top.earned)) top = p; });
  const hunt = S.gmode === 'hunt', td = S.gmode === 'td';
  if (hunt) $('resTitle').textContent = e.win ? '清剿第 ' + e.day + ' 關完成！' : '清剿失敗';
  $('resText').textContent = hunt ? (e.win
    ? '擊倒 ' + (e.money / 50) + ' 隻怪物（目標 ' + (e.quota / 50) + ' 隻），還剩 ' + e.time + ' 秒。下一關目標更多、怪物更快。'
    : (e.why === 'time' ? '時間到，只擊倒 ' + (e.money / 50) + ' / ' + (e.quota / 50) + ' 隻。' : '全員被抓，擊倒 ' + (e.money / 50) + ' / ' + (e.quota / 50) + ' 隻。') + ' 止步第 ' + e.day + ' 關。') : e.win
    ? '賺到 $' + e.money + '（目標 $' + e.quota + '），還剩 ' + e.time + ' 秒。明天目標更高，怪物也更快。'
    : (e.why === 'time' ? '時間到，只賺到 $' + e.money + ' / $' + e.quota + '。' : '全員被抓。帶回 $' + e.money + ' / $' + e.quota + '。') + ' 止步第 ' + e.day + ' 天。';
  if (td) {
    $('resTitle').textContent = e.win ? '死守第 ' + e.day + ' 關守住了！' : '回收車被攻破';
    $('resText').textContent = e.win ? '核心還剩 ' + e.core + '。下一關怪物更多、更硬、更快。' : (e.why === 'time' ? '時間到，怪物還沒清完。' : '核心歸零。') + ' 止步第 ' + e.day + ' 關。';
    const ts = e.win ? 1 + (e.core >= 70 ? 1 : 0) + (e.core >= 100 ? 1 : 0) : 0, sb2 = $('resStars'); sb2.textContent = '';
    for (let k = 0; k < 3; k++) { const x = document.createElement(k < ts ? 'span' : 'i'); x.textContent = '★'; sb2.appendChild(x); }
  }
  if (e.why === 'race') {   // 賽車：完賽看用時，成績上傳排行榜（圈數榜、完賽時間榜）
    $('resTitle').textContent = e.win ? '完賽！' : '比賽失敗';
    $('resText').textContent = e.win && e.rr ? '用時 ' + e.rr.time.toFixed(1) + ' 秒（' + e.rr.laps + ' 圈）。' : '中途被淘汰。';
    if (e.win && e.rr && RR.Cloud && RR.Cloud.ready()) { RR.Cloud.submit('race', e.rr.laps); RR.Cloud.submit('racet', 99999 - Math.floor(e.rr.time * 10)); }
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
  $('resNext').textContent = S.sim && S.sim.maxDay && S.sim.day >= S.sim.maxDay ? '通關，回大廳' : '下一天';
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
  $('delData').addEventListener('click', function () {
    ask('確定刪除所有資料？進度、排行榜、好友、拾荒團都會刪除，無法復原。', function () {
      const wipeLocal = function () {
        Object.keys(localStorage).forEach(function (k) { if (/^rr_/.test(k)) { try { localStorage.removeItem(k); } catch (e) {} } });
      };
      const reload = function () { location.reload(); };
      if (!RR.Cloud || !RR.Cloud.ready()) { wipeLocal(); RR.Auth.signOut().then(reload); return; }
      RR.Cloud.deleteMyData(function (e) {
        if (e) { say(e.code === 'owner' ? '你是團長，請先把團長位子轉給別人再刪除資料。' : '刪除失敗：' + (e.code || e.message || '未知錯誤') + '，請再試一次。'); return; }
        RR.Auth.deleteAccount().then(function () { wipeLocal(); say('資料已刪除。', reload); }, function (err) {
          wipeLocal();
          say(err && err.code === 'auth/requires-recent-login' ? '雲端資料已刪除。登入帳號需要重新登入後才能刪除，請先登出、登入一次後再按一次。' : '雲端資料已刪除，但登入帳號刪除失敗：' + ((err && err.code) || '未知錯誤'), reload);
        });
      });
    });
  });
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
  // 滑鼠滾輪：模式列與上方功能列都能橫向滑；模式列上滾輪＝上下切換模式
  const wheelX = function (el) { el.addEventListener('wheel', function (e) { if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; e.preventDefault(); el.scrollLeft += e.deltaY; }, { passive: false }); };
  wheelX(document.querySelector('.lbSide'));
  $('modeStrip').addEventListener('wheel', function (e) {
    e.preventDefault();
    const kids = Array.prototype.slice.call($('modeStrip').children), cur = Math.max(0, kids.findIndex(function (b) { return b.dataset.mode === selMode(); }));
    const next = kids[Math.max(0, Math.min(kids.length - 1, cur + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1)))];
    if (next && next.dataset.mode !== selMode()) { lsSet('rr_mode', next.dataset.mode); Sfx.tone(520, 0.04, 'square', 0.04); refreshLobby(); }
    next && next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, { passive: false });
  // 大廳角色可用滑鼠或手指左右拖曳轉動
  (function () { const cv = $('lobbyChar'); let lastX = null; cv.addEventListener('pointerdown', function (e) { lastX = e.clientX; cv.setPointerCapture(e.pointerId); }); cv.addEventListener('pointermove', function (e) { if (lastX == null) return; Game.previewSpin(cv, e.clientX - lastX); lastX = e.clientX; }); const up = function () { lastX = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); })();
  $('optChip').addEventListener('click', recOptsOpen);
  $('roOk').addEventListener('click', function () { $('recOpts').classList.add('hide'); refreshLobby(); });
  $('casHelp').addEventListener('click', function () { const k = selMode(); $('casHelpT').textContent = LOBBY_MODE[k] + '玩法'; $('casHelpB').textContent = CAS_HELP[k] || '這個模式的說明還沒寫好。'; $('casHelpM').classList.remove('hide'); });
  $('casHelpX').addEventListener('click', function () { $('casHelpM').classList.add('hide'); });
  $('hubMain').addEventListener('click', function () { hubEnter('main'); });
  $('hubCas').addEventListener('click', function () { hubEnter('casual'); });
  $('lbHub').addEventListener('click', function () { show('scrHub'); });
  $('goBtn').addEventListener('click', function () { const b = $('modeStrip').querySelector('[data-mode="' + selMode() + '"]'); if (b) $(b.dataset.go).click(); });
  $('mapChip').addEventListener('click', function () { if (selMode() === 'card') { cardOptsOpen(); return; } renderMapGrid(); show('scrMap'); });
  $('coOk').addEventListener('click', function () { $('cardOpts').classList.add('hide'); refreshLobby(); });
  $('cardOpen').addEventListener('click', function () { show('scrCard'); RR.Cards.start(cardOpts()); });
  RR.Cards.hooks({
    back: showMenu,
    sfx: function (k) { try { if (k === 'play') Sfx.tone(520, 0.05, 'square', 0.05, 700); else if (k === 'draw') Sfx.tone(330, 0.05, 'triangle', 0.05); else if (k === 'win') Sfx.tone(660, 0.25, 'triangle', 0.1, 1320); else if (k === 'lose') Sfx.tone(300, 0.3, 'sawtooth', 0.06, 150); else if (k === 'no') Sfx.tone(160, 0.08, 'square', 0.05); } catch (e) {} },
    award: function (win, opp) {
      const p = prog(), lv0 = levelOf(p.xp), coins = win ? 20 + opp * 10 : 5, xp = coins + 10;
      p.coins += coins; p.xp += xp; p.st.games += 1; if (win) p.st.wins += 1; addWeekPts(p, coins); progSave(p); renderProg();
      if (win && RR.Cloud && RR.Cloud.ready()) RR.Cloud.submit('card', 1);
      return '金幣 +' + coins + '，經驗 +' + xp + (levelOf(p.xp) > lv0 ? '，升到 Lv.' + levelOf(p.xp) + '（大廳點等級領獎勵）' : '');
    }
  });
  // 點一下就收起；捕獲階段處理，遊戲畫面攔截點擊也收得掉
  $('banner').addEventListener('pointerdown', bannerHide, true);
  $('banner').addEventListener('click', bannerHide);
  $('tierInfoMap').addEventListener('click', openTierInfo); $('tierDone').addEventListener('click', function () { $('scrTier').classList.add('hide'); });
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
    if (S.sim.mode === 'race') S.sim.map = W.arenaNext(S.sim.map);   // 賽車：只在賽道場地間切換
    else { S.sim.map = (S.sim.map + 1) % W.RUIN_N; lsSet('rr_map', String(S.sim.map)); }
    hostBroadcast(rosterMsg()); tickLobby(); showMapName();
  });
  $('baseBtn').addEventListener('click', function () { if (S.mode !== 'host') return; S.base = ((S.base | 0) + 1) % W.BASE_STYLES.length; S.sim.baseStyle = S.base; hostBroadcast(rosterMsg()); tickLobby(); });
  $('modeBtn').addEventListener('click', function () { if (S.mode !== 'host') return; S.sim.mode = S.sim.mode === 'coop' ? 'hunt' : S.sim.mode === 'hunt' ? 'br' : S.sim.mode === 'br' ? 'td' : 'coop'; hostBroadcast(rosterMsg()); tickLobby(); });
  $('brBtn').addEventListener('click', function () { startSolo('br'); });
  $('tdBtn').addEventListener('click', function () { startSolo('td'); });
  $('raceBtn').addEventListener('click', function () { startSolo('race'); });
  $('chessBtn').addEventListener('click', chessOpen);
  $('xqBtn').addEventListener('click', xqOpen);
  $('rummiBtn').addEventListener('click', rmOpen);
  $('gomokuBtn').addEventListener('click', gmOpen);
  $('c4Btn').addEventListener('click', c4Open);
  $('flightBtn').addEventListener('click', flOpen);
  $('pachiBtn').addEventListener('click', pcOpen);
  $('kangleBtn').addEventListener('click', kgOpen);
  $('kangleBack').addEventListener('click', showMenu);
  $('kangleNew').addEventListener('click', kgNew);
  $('kgFire').addEventListener('click', kgFire);
  ['kgX', 'kgAngle', 'kgPower'].forEach(function (id) { $(id).addEventListener('input', kgDraw); });
  $('pachiBack').addEventListener('click', showMenu);
  $('pachiNew').addEventListener('click', pcNew);
  $('pcFire').addEventListener('click', pcFire);
  $('pcAngle').addEventListener('input', pcDraw);
  $('pcPower').addEventListener('input', pcDraw);
  $('flightBack').addEventListener('click', showMenu);
  $('flightNew').addEventListener('click', flSetup);
  $('flightRoll').addEventListener('click', flRoll);
  document.querySelectorAll('[data-flp]').forEach(function (b) { b.addEventListener('click', function () { flNew(+b.getAttribute('data-flp')); }); });
  $('c4Back').addEventListener('click', showMenu);
  $('c4New').addEventListener('click', c4New);
  $('gomokuBack').addEventListener('click', showMenu);
  $('gomokuNew').addEventListener('click', gmNew);
  $('rummiBack').addEventListener('click', showMenu);
  $('rummiNew').addEventListener('click', rmNewGame);
  $('rummiMake').addEventListener('click', rmMakeSet);
  $('rummiDraw').addEventListener('click', rmDrawTile);
  $('rummiUndo').addEventListener('click', rmUndo);
  $('rummiOk').addEventListener('click', rmConfirm);
  $('xqBack').addEventListener('click', showMenu);
  $('xqNew').addEventListener('click', xqNew);
  $('platBtn').addEventListener('click', platOpen);
  $('marbleBtn').addEventListener('click', marbleOpen);
  $('marbleBack').addEventListener('click', function () { RR.Marble.stop(); show('scrHub'); });
  $('platBack').addEventListener('click', function () { RR.Plat.stop(); show('scrHub'); });
  $('chessBack').addEventListener('click', showMenu);
  $('chessNew').addEventListener('click', chessNew);
  $('huntBtn').addEventListener('click', function () { startSolo('hunt'); });
  $('pvpBtn').addEventListener('click', function () { if (S.mode !== 'host') return; S.sim.pvp = !S.sim.pvp; hostBroadcast(rosterMsg()); tickLobby(); });
  $('lobbyMic').addEventListener('click', function () { if (Voice.hasMic()) Voice.setMuted(!Voice.isMuted()); else say('沒有麥克風權限。請在瀏覽器允許麥克風後，重新進入房間。'); tickLobby(); });
  $('inviteBtn').addEventListener('click', invPickOpen);
  $('invPickClose').addEventListener('click', function () { $('invPick').classList.add('hide'); });
  $('invJoin').addEventListener('click', invAccept);
  $('invNo').addEventListener('click', invDecline);
  $('copyBtn').addEventListener('click', function () {
    const url = shareUrl($('roomCode').textContent);
    const fallback = function () { const i = $('shareLink'); i.value = url; i.classList.remove('hide'); i.focus(); i.select(); };
    try { navigator.clipboard.writeText(url).then(function () { Game.toast('已複製'); chatAdd(null, '邀請連結已複製'); }, fallback); } catch (e) { fallback(); }
  });
  $('resNext').addEventListener('click', function () { if (!S.sim) return; if (S.sim.maxDay && S.sim.day >= S.sim.maxDay) { const days = S.sim.maxDay; leave(); mtoast('通關！恭喜完成 ' + days + ' 天', 'good'); return; } hostStart(S.sim.day + 1); });
  $('resRetry').addEventListener('click', function () { if (S.sim) hostStart(1); });
  $('resLobby').addEventListener('click', function () { if (S.mode === 'host') { S.sim.toLobby(); hostBroadcast(rosterMsg()); hostBroadcast({ t: 'lobby' }); } });
  $('resLeave').addEventListener('click', leave);
  $('leaveBtn').addEventListener('click', function () { $('confirm').classList.remove('hide'); });
  $('hudMore').addEventListener('click', function () {
    const m = $('hudMenu'), open = m.classList.contains('hide');
    m.classList.toggle('hide', !open); this.setAttribute('aria-expanded', String(open));
    if (open) { try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {} }
  });
  $('hudResume').addEventListener('click', function () { $('hudMore').click(); });
  // 全螢幕（電腦、桌面版）
  $('setFull').addEventListener('click', function () {
    const el = document.documentElement;
    try { if (document.fullscreenElement) document.exitFullscreen(); else (el.requestFullscreen || el.webkitRequestFullscreen).call(el); } catch (e) {}
  });
  // 電腦按鍵自訂
  const keyName = function (c) { return String(c || '').replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', '左 Shift').replace('ShiftRight', '右 Shift').replace('ControlLeft', '左 Ctrl').replace('Space', '空白鍵').replace(/^Arrow/, '方向 '); };
  const drawKeys = function () {
    const box = $('keyBinds'); box.textContent = '';
    Game.KEY_ACTIONS.forEach(function (a) {
      const r = mk('button', 'keyRow'); r.type = 'button';
      r.appendChild(mk('span', null, a[0])); const k = mk('b', null, keyName(Game.keyOf(a[1]))); r.appendChild(k);
      r.addEventListener('click', function () { k.textContent = '按一個鍵…（Esc 取消）'; r.classList.add('on'); Game.captureKey(a[1], function () { drawKeys(); }); });
      box.appendChild(r);
    });
  };
  drawKeys();
  $('keyReset').addEventListener('click', function () { Game.resetKeys(); drawKeys(); mtoast('按鍵已恢復預設'); });
  $('lvInfoBtn').addEventListener('click', lvsOpen);
  $('lvsDone').addEventListener('click', showMenu);
  $('lvsHelp').addEventListener('click', lvInfoOpen);
  $('lvsGet').addEventListener('click', function () { lvClaim(lvSel); });
  $('lvsAll').addEventListener('click', lvClaimAll);
  $('lvClose').addEventListener('click', function () { $('lvInfo').classList.add('hide'); });
  $('moreBtn').addEventListener('click', function (e) {
    e.stopPropagation(); $('moreMenu').classList.toggle('hide');
  });
  $('moreMenu').addEventListener('click', function (e) {
    if (e.target.closest('.mItem')) $('moreMenu').classList.add('hide');
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#moreMenu') && !e.target.closest('#moreBtn')) $('moreMenu').classList.add('hide');
  });
  $('confirmNo').addEventListener('click', function () { $('confirm').classList.add('hide'); });
  $('confirmYes').addEventListener('click', leave);
  $('msgOk').addEventListener('click', function () { const f = sayDone; sayDone = null; $('msg').classList.add('hide'); if (f) f(); });
  $('askNo').addEventListener('click', function () { askYes = null; $('askDlg').classList.add('hide'); });
  $('askYes').addEventListener('click', function () { const f = askYes; askYes = null; $('askDlg').classList.add('hide'); if (f) f(); });
  $('qrClose').addEventListener('click', function () { $('qrBox').classList.add('hide'); });
  // 手機以橫式為主：按開始／加入時進全螢幕並鎖成橫式（Android 支援；iPhone 不能鎖，改用直式時的提示）
  const lockLandscape = function () {
    if (!('ontouchstart' in window)) return;
    const el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen;
    const lock = function () { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {} };
    try { if (rq && !document.fullscreenElement) { const pr = rq.call(el, { navigationUI: 'hide' }); if (pr && pr.then) pr.then(lock).catch(lock); else lock(); } else lock(); } catch (e) { lock(); }
  };
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#goBtn, #joinBtn, #startBtn, #tmQuick, #tmCreate, .tmJoin')) lockLandscape(); }, true);
  $('rotateSkip').addEventListener('click', function () { document.body.classList.add('allowPortrait'); });
  // AR 抓怪：每天前 10 隻有獎勵（普通 5、稀有 15、傳說 40 金幣）；第一次抓到的外觀記進圖鑑，集滿 32 種送 300 金幣
  const AR_MAX = 10, AR_COIN = [5, 15, 40], AR_XP = [3, 8, 20];
  // 每日 AR 任務：[說明, 統計欄位, 目標, 金幣]
  const AR_MIS = [['抓到 3 隻怪物', 'n', 3, 20], ['抓到 1 隻稀有以上', 'rare', 1, 30], ['Excellent 抓到 1 次', 'ex', 1, 30]];
  const arMisState = function (p) { if (!p.arMis || p.arMis.day !== today()) p.arMis = { day: today(), n: 0, rare: 0, ex: 0, done: [0, 0, 0] }; return p.arMis; };
  const arDex = function () { const p = prog(); return Array.isArray(p.arDex) ? p.arDex : []; };
  const arCounts = function () { const p = prog(); return { today: p.arDay === today() ? p.arToday | 0 : 0, max: AR_MAX, dex: arDex().length }; };
  $('arOpen').addEventListener('click', function () {
    if (!RR.AR) return;
    RR.AR.open({
      counts: arCounts, dex: arDex,
      // 迷宮：每天前 3 次逃出 +20 金幣 +10 經驗；記錄最快時間
      onMaze: function (r) {
        const p = prog(); if (p.mzDay !== today()) { p.mzDay = today(); p.mzToday = 0; }
        const parts = [], best = +p.mzBest || 0;
        if (!best || r.time < best) { p.mzBest = Math.round(r.time * 10) / 10; parts.push(best ? '新紀錄！' : '最快紀錄 ' + p.mzBest + ' 秒'); }
        if ((p.mzToday | 0) < 3) { p.mzToday = (p.mzToday | 0) + 1; p.coins += 20; p.xp += 10; parts.push('+20 金幣'); } else parts.push('今天的迷宮獎勵已領完');
        progSave(p); renderProg(); return parts.join('，');
      },
      buddy: function () { return prog().arBuddy || ''; },
      pick: function (k, v) { const p = prog(); p.arBuddy = k + ':' + v; progSave(p); },
      missions: function () { const p = prog(), m = arMisState(p); return AR_MIS.map(function (x, i) { return [x[0], m[x[1]] | 0, x[2], !!m.done[i], x[3]]; }); },
      isNew: function (k, v) { return arDex().indexOf(k + ':' + v) < 0; },
      onCatch: function (c) {
        const p = prog(); if (p.arDay !== today()) { p.arDay = today(); p.arToday = 0; }
        if (!Array.isArray(p.arDex)) p.arDex = [];
        p.arTotal = (p.arTotal | 0) + 1;
        const parts = [];
        if (p.arDex.indexOf(c.k + ':' + c.v) < 0) {
          p.arDex.push(c.k + ':' + c.v); parts.push('圖鑑新增');
          if (p.arDex.length >= RR.AR.TOTAL && !p.arDexDone) { p.arDexDone = 1; p.coins += 300; parts.push('圖鑑集滿 +300 金幣'); }
        }
        const ms = arMisState(p); ms.n++; if (c.rar >= 1) ms.rare++; if (c.g === 2) ms.ex++;
        AR_MIS.forEach(function (x, i) { if (!ms.done[i] && (ms[x[1]] | 0) >= x[2]) { ms.done[i] = 1; p.coins += x[3]; parts.push('任務完成 +' + x[3]); } });
        if (RR.Cloud && RR.Cloud.ready()) RR.Cloud.submit('ar', 1);
        if ((p.arToday | 0) < AR_MAX) { p.arToday = (p.arToday | 0) + 1; p.coins += AR_COIN[c.rar] || 5; addWeekPts(p, AR_COIN[c.rar] || 5); p.xp += AR_XP[c.rar] || 3; parts.push('+' + (AR_COIN[c.rar] || 5) + ' 金幣'); }
        else parts.push('今天的金幣已領完');
        progSave(p); renderProg(); return parts.join('，');
      }
    });
  });
  $('arDexBtn').addEventListener('click', function () { RR.AR.dexToggle(); });
  $('arPickCatch').addEventListener('click', function () { RR.AR.start('catch'); });
  $('arPickMaze').addEventListener('click', function () { RR.AR.start('maze'); });
  $('arAgain').addEventListener('click', function () { RR.AR.again(); });
  { const fb = $('arFwd'), on = function (e) { e.preventDefault(); e.stopPropagation(); RR.AR.fwd(true); fb.classList.add('on'); }, off = function (e) { e.preventDefault(); RR.AR.fwd(false); fb.classList.remove('on'); };
    fb.addEventListener('touchstart', on, { passive: false }); fb.addEventListener('touchend', off, { passive: false }); fb.addEventListener('touchcancel', off, { passive: false });
    fb.addEventListener('mousedown', on); fb.addEventListener('mouseup', off); fb.addEventListener('mouseleave', off); }
  $('arDexClose').addEventListener('click', function () { RR.AR.dexToggle(); });
  $('arClose').addEventListener('click', function () { RR.AR.close(); refreshLobby(); });
  $('arThrow').addEventListener('click', function (e) { e.stopPropagation(); RR.AR.throwNet(); });
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
  // 槍分類：每一類可以展開選擇，一次只開一類；旁邊（手機是下面）顯示選到的槍的屬性
  const gCatEls = GUN_CATS.map(function (name, ci) {
    const d = document.createElement('details'); d.className = 'gCat';
    const s = document.createElement('summary'); const nb = document.createElement('b'); nb.textContent = name; const em = document.createElement('em'); s.appendChild(nb); s.appendChild(em); d.appendChild(s);
    const grid = document.createElement('div'); grid.className = 'cards c3'; d.appendChild(grid);
    let n = 0; gBtns.forEach(function (b, i) { if (gunCat(i) === ci) { grid.appendChild(b); n++; } });
    d.addEventListener('toggle', function () { if (d.open) gCatEls.forEach(function (o) { if (o.el !== d) o.el.open = false; }); });
    if (n) $('gCats').appendChild(d);
    return { el: d, em: em, n: n };
  });
  const gCatMark = function () {
    const cur = gunCat(look.gun | 0);
    gCatEls.forEach(function (o, ci) { o.el.classList.toggle('has', ci === cur); o.em.textContent = ci === cur ? '使用中：' + W.GUNS[look.gun | 0].name : o.n + ' 把'; });
    if (!gCatEls.some(function (o) { return o.el.open; })) gCatEls[cur].el.open = true;
  };
  const hBtns = cards($('hGrid'), W.HATS.slice(0, LIMITED_HAT), function (i) { return ''; }, function (i) {
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
  const showLook = function () {
    look.c = ((look.c % W.CHARS.length) + W.CHARS.length) % W.CHARS.length;
    look.w = ((look.w % W.WEAPONS.length) + W.WEAPONS.length) % W.WEAPONS.length;
    const info = CINFO[look.c] || ['', '', ''];
    $('cName').textContent = W.CHARS[look.c]; $('cSkill').textContent = info[0];
    $('cDesc').textContent = info[1]; $('cAttr').textContent = '屬性：' + info[2];
    mark(cBtns, look.c); mark(wBtns, look.w); mark(hBtns, look.h);
    { look.gun = ((look.gun | 0) % W.GUNS.length + W.GUNS.length) % W.GUNS.length; mark(gBtns, look.gun);
      gBtns.forEach(function (b, i) { b.lastChild.textContent = i === look.gun ? '使用中' : ''; });
      renderGunStats(look.gun); Game.setGun(look.gun); gCatMark(); }
    pushLoadout();
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
  showMapName = function () { mapSel = myMap(); refreshPickSummary(); };
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
  $('wheelWear').addEventListener('click', function () { pickFrom = 'wheel'; show('scrPick'); });
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
  $('marketOpen').addEventListener('click', marketOpen);
  $('exOpen').addEventListener('click', function () { mkTab = 'shop'; marketOpen(); });
  $('mkDone').addEventListener('click', function () { marketClose(); });
  /* 滑鼠可以橫向滑動大廳的模式／功能列：滾輪轉成橫向、按住拖曳（不用捲軸，避免跳格） */
  document.querySelectorAll('.lbSide, .modeStrip').forEach(function (el) {
    el.addEventListener('wheel', function (e) {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      el.scrollLeft += d; e.preventDefault();
    }, { passive: false });
    let dragX = null, moved = false;
    el.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') return; dragX = e.clientX; moved = false; });
    el.addEventListener('pointermove', function (e) {
      if (dragX == null) return;
      const dx = e.clientX - dragX; if (Math.abs(dx) > 4) moved = true;
      el.scrollLeft -= dx; dragX = e.clientX;
    });
    const end = function () { dragX = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointerleave', end);
    el.addEventListener('click', function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.mkTabs button'), function (b) { b.addEventListener('click', function () { mkSetTab(b.dataset.tab); }); });
  $('wcForm').addEventListener('submit', function (e) {
    e.preventDefault(); const v = $('wcInput').value; if (!v.trim()) return;
    RR.Cloud.worldSay(v, function (err) { if (err) mtoast(RR.Cloud.message(err), 'warn'); else $('wcInput').value = ''; });
  });
  $('mkForm').addEventListener('submit', function (e) { e.preventDefault(); mkPost(); });
  $('tmCreate').addEventListener('click', function () { marketClose(); lsSet('rr_mode', 'coop'); createRoom(); });
  $('tmQuick').addEventListener('click', function () {
    const r = tmRows.filter(function (x) { return !x.play; })[0] || tmRows[0];
    if (r) tmJoin(r.code); else mtoast('目前沒有可以加入的房間，先建立一個吧', 'warn');
  });
  $('tmRefresh').addEventListener('click', function () { const C = RR.Cloud; if (!C || !C.ready()) return; if (tmOff) tmOff(); tmOff = C.roomsWatch(function (err, rows) { if (err) { tmNote(C.message(err)); return; } tmRows = rows; tmDraw(); }); });
  $('clanDone').addEventListener('click', clanClose);
  $('ccAsk').addEventListener('click', ccAsk);
  $('ccForm').addEventListener('submit', function (e) { e.preventDefault(); ccSend(); });
  $('ccInput').addEventListener('keydown', function (e) { e.stopPropagation(); });
  $('ccInput').addEventListener('keyup', function (e) { e.stopPropagation(); });
  $('pickBtn').addEventListener('click', function () { pickFrom = null; show('scrPick'); });
  function pickBack() { const f = pickFrom; pickFrom = null; if (f === 'wheel') openWheel(); else showMenu(); }
  $('pickDone').addEventListener('click', pickBack);
  $('pickOk').addEventListener('click', pickBack);
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
  Array.prototype.forEach.call(document.querySelectorAll('#regionAsk [data-r]'), function (b) { b.addEventListener('click', function () { const q = prog(); if (ls('rr_region') && +b.dataset.r === q.region) { $('regionAsk').classList.add('hide'); return; }   // 選同一區不算換
    if (q.regionW === RR.Cloud.weekId() && ls('rr_region')) { $('regionAsk').classList.add('hide'); say('本週已經選過賽區，週日 24:00 後才能再換。'); return; } q.region = +b.dataset.r; q.regionW = RR.Cloud.weekId(); progSave(q); socRegion = null; if ($('scrSocial') && !$('scrSocial').classList.contains('hide')) setTimeout(renderSocial, 0); if (RR.Cloud) setTimeout(function () { RR.Cloud.cleanRegions(); }, 4000); lsSet('rr_region', '1'); $('regionAsk').classList.add('hide'); }); });
  $('tutSkip').addEventListener('click', tutDone);
  $('avatar').addEventListener('click', function () { statsOpen(); });
  $('stAva').addEventListener('click', function () { avaDraw(); $('avaPick').classList.remove('hide'); });
  $('stDone').addEventListener('click', function () { $('scrStats').classList.add('hide'); stUid = null; });
  Array.prototype.forEach.call(document.querySelectorAll('#stTabs button'), function (b) { b.addEventListener('click', function () { stMode = b.dataset.m; stDraw(); }); });
  $('avaClose').addEventListener('click', function () { $('avaPick').classList.add('hide'); });
  // 本機照片：縮成 64×64 存在這台裝置，不上傳
  $('avaFile').addEventListener('change', function () {
    const f = this.files && this.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = function () {
      const im = new Image();
      im.onload = function () {
        const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
        const sz = Math.min(im.width, im.height); x.drawImage(im, (im.width - sz) / 2, (im.height - sz) / 2, sz, sz, 0, 0, 64, 64);
        try { lsSet('rr_avatar_img', cv.toDataURL('image/jpeg', 0.8)); } catch (e) {}
        refreshPickSummary(); $('avaPick').classList.add('hide'); if (RR.Cloud) RR.Cloud.saveSoon();
      };
      im.src = rd.result;
    };
    rd.readAsDataURL(f); this.value = '';
  });
  $('avaReset').addEventListener('click', function () { try { localStorage.removeItem('rr_avatar_img'); } catch (e) {} lsSet('rr_avatar', ''); refreshPickSummary(); $('avaPick').classList.add('hide'); if (RR.Cloud) RR.Cloud.saveSoon(); });
  $('updOk').addEventListener('click', function () { lsSet('rr_upd_seen', UPD.v); $('updNote').classList.add('hide'); });
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
  window.addEventListener('pagehide', function () { if (S.mode === 'client') Net.send({ t: 'bye' }); Net.leave(); RR.Cloud.flush(); });
  // 一開網頁就喚醒伺服器，之後每 4 分鐘再叫一次，避免在選單或大廳等待時又睡著
  Net.warm(); setInterval(function () { if (!document.hidden) Net.warm(); }, 240000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) Net.warm(); else { RR.Cloud.flush(); bannerHide(); } });
}

function boot() {
  if (!Game.init()) { show(null); say('這個瀏覽器無法啟動 3D 畫面（需要 WebGL）。'); return; }
  bind();
  Game.onAttack = function (yaw) {
    if (S.mode === 'client') Net.send({ t: 'atk', yaw: yaw });
    else if (S.sim) S.sim.attack(S.myId, yaw);
  };
  Game.onReload = function () {
    if (S.mode === 'client') Net.send({ t: 'reload' });
    else if (S.sim) S.sim.reloadGun(S.myId);
  };
  Game.onGunSwitch = function () {
    if (S.mode === 'client') Net.send({ t: 'gunsw' });
    else if (S.sim) S.sim.switchGun(S.myId);
  };
  /** 技能好了的提示文字（依出戰角色） */
  Game.skillText = function () { const c = CINFO[myLook().c % CINFO.length]; return c[0] + '：' + c[1]; };
  Game.onBomb = function (yaw) {
    if (S.mode === 'client') Net.send({ t: 'bomb', yaw: yaw });
    else if (S.sim) S.sim.bomb(S.myId, yaw);
  };
  Game.onTower = function () {
    if (S.mode === 'client') Net.send({ t: 'tower' });
    else if (S.sim) S.sim.buildTower(S.myId);
  };
  Game.onAir = function (x, z) {
    if (S.mode === 'client') Net.send({ t: 'air', x: x, z: z });
    else if (S.sim) S.sim.airStrike(S.myId, x, z);
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
  $('socialOpen').addEventListener('click', function () { $('scrSocial').classList.remove('hide'); $('scrSocial').scrollTop = 0; renderSocial(); rankWatch(true); });
  $('socDone').addEventListener('click', function () { $('scrSocial').classList.add('hide'); renderSocial.token = null; });
  Array.prototype.forEach.call(document.querySelectorAll('#socTabs button'), function (x) { x.addEventListener('click', function () { socTab = x.dataset.tab; renderSocial(); }); });
  let lastUid = null;
  Auth.init(function (user) {
    if (!user) { lastUid = null; invWatchStop(); RR.Cloud.onUser(null); if (S.mode) leave(); else show('scrLogin'); return; }
    if (!S.mode) showMenu();
    markPlayDay();
    if (user.uid !== lastUid) { lastUid = user.uid; RR.Cloud.onUser(user, function () { markPlayDay(); renderProg(); if (!S.mode) dailyLogin(); checkWeekReward(); pendingFriend(); invWatchStart(); }); }
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
