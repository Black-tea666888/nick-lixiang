/* 流程：登入 → 選單 → 大廳 → 遊戲 → 結算；以及房主迴圈、訊息分派、聊天 */
(function () {
'use strict';
const RR = window.RR, W = RR.World, Net = RR.Net, Voice = RR.Voice, Sfx = RR.Sfx, Auth = RR.Auth, Game = RR.Game;
const $ = function (id) { return document.getElementById(id); };
const CSSCOL = ['#ffb84a', '#6ecbff', '#c79bff', '#ff7eb6'];
const SCREENS = ['scrLogin', 'scrMenu', 'scrPick', 'scrWheel', 'scrLobby', 'scrResult'];
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
function busy(on, text) { $('busyText').textContent = text || '請稍候…'; $('busy').classList.toggle('hide', !on); }
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
  return { c: n('rr_c'), w: n('rr_w'), h: p.hats.indexOf(h) >= 0 ? h : 0, o: own('o', n('rr_o')), pet: own('pet', n('rr_pet')), eq: myEquip(p), gems: p.gems };
}
// 只影響自己畫面的造型：回收品、怪物、彈道
function applyLocalSkins() {
  const p = prog(), n = function (k) { return parseInt(ls(k) || '0', 10) || 0; }, own = function (cat, v) { return p.own[cat].indexOf(v) >= 0 ? v : 0; };
  Game.settings.itemSkin = own('is', n('rr_is')); Game.settings.fx = own('fx', n('rr_fx'));
  const ms = own('ms', n('rr_ms')); if ((Game.settings.monSkin | 0) !== ms) Game.setMonSkin(ms);
}
const SKIN_NAMES = { is: ['預設', '糖果', '寶石'], ms: ['預設', '骸骨白', '霓虹'], fx: ['金黃', '冰藍', '粉紅', '紫光'] };
const PET_NOTE = ['', '速度 +5%', '偵測 +8m', '賣出 +10%', '體力 +20%'];
function catNames(cat) { return cat === 'o' ? W.COSTUMES : cat === 'pet' ? W.PETS : cat === 'hat' ? W.HATS : SKIN_NAMES[cat]; }
const CAT_LABEL = { o: '服裝', pet: '寵物', hat: '頭飾', is: '回收品造型', ms: '怪物造型', fx: '彈道特效' };
function owns(p, cat, i) { return cat === 'hat' ? p.hats.indexOf(i) >= 0 : p.own[cat].indexOf(i) >= 0; }
/* ---------- 造型轉盤 ---------- */
const WHEELS = [
  { n: '綜合', cost: 50, seg: [['o'], ['pet'], ['hat'], ['is'], ['coin', 30], ['ms'], ['fx'], ['coin', 80]] },
  { n: '服裝', cost: 80, seg: [['o', 1], ['o', 2], ['o', 3], ['o', 4], ['o', 5], ['coin', 30], ['coin', 60], ['coin', 100]] },
  { n: '寵物', cost: 80, seg: [['pet', 1], ['coin', 20], ['pet', 2], ['coin', 40], ['pet', 3], ['coin', 60], ['pet', 4], ['coin', 100]] },
  { n: '造型特效', cost: 60, seg: [['is', 1], ['is', 2], ['ms', 1], ['ms', 2], ['fx', 1], ['fx', 2], ['fx', 3], ['coin', 50]] }
];
let wheelI = 0, wheelBusy = false, wheelTurn = 0;
function segLabel(sg) { return sg[0] === 'coin' ? '金幣 +' + sg[1] : sg.length > 1 ? catNames(sg[0])[sg[1]] : CAT_LABEL[sg[0]]; }
function wheelDraw() {
  const wh = WHEELS[wheelI], box = $('wheel'), p = prog();
  box.textContent = '';
  wh.seg.forEach(function (sg, i) {
    const sp = document.createElement('span'), t = document.createElement('i');
    sp.style.transform = 'rotate(' + (i * 45 + 22.5) + 'deg)'; t.textContent = segLabel(sg); sp.appendChild(t); box.appendChild(sp);
  });
  const free = wheelI === 0 && p.freeDay !== today();
  $('wheelSpin').textContent = free ? '免費轉一次' : '轉一次（' + wh.cost + ' 金幣）';
  $('coinTag3').textContent = p.coins;
  Array.prototype.forEach.call($('wheelSel').children, function (b, k) { b.classList.toggle('on', k === wheelI); });
}
function wheelSpin() {
  if (wheelBusy) return;
  const wh = WHEELS[wheelI], p = prog(), free = wheelI === 0 && p.freeDay !== today();
  if (!free && p.coins < wh.cost) { say('金幣不夠：這個轉盤一次要 ' + wh.cost + ' 金幣，你有 ' + p.coins + '。過關和每日任務可以賺金幣。'); return; }
  if (free) p.freeDay = today(); else p.coins -= wh.cost;
  const idx = Math.floor(Math.random() * 8), sg = wh.seg[idx];
  let msg;
  if (sg[0] === 'coin') { p.coins += sg[1]; msg = '金幣 +' + sg[1]; }
  else {
    const cat = sg[0], names = catNames(cat);
    let pickI = sg[1];
    if (pickI == null) { const pool = []; for (let k = 1; k < names.length; k++) if (!owns(p, cat, k)) pool.push(k); pickI = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 1 + Math.floor(Math.random() * (names.length - 1)); }
    if (owns(p, cat, pickI)) { p.coins += 25; msg = CAT_LABEL[cat] + '「' + names[pickI] + '」已經有了，換成金幣 +25'; }
    else { if (cat === 'hat') p.hats.push(pickI); else p.own[cat].push(pickI); msg = '獲得' + CAT_LABEL[cat] + '「' + names[pickI] + '」！到「出戰角色」換上'; }
  }
  progSave(p);
  wheelBusy = true; $('wheelMsg').textContent = ''; $('coinTag3').textContent = p.coins;
  wheelTurn += 360 * 5 + ((360 - (idx * 45 + 22.5)) - (wheelTurn % 360) + 360) % 360;
  $('wheel').style.transform = 'rotate(' + wheelTurn + 'deg)';
  Sfx.tone(520, 0.08, 'triangle', 0.08, 700);
  setTimeout(function () { wheelBusy = false; $('wheelMsg').textContent = msg; Sfx.tone(660, 0.25, 'triangle', 0.14, 990); wheelDraw(); renderProg(); if (window.RR_refreshWardrobe) window.RR_refreshWardrobe(); }, 3300);
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
  ['o', 'pet', 'is', 'ms', 'fx'].forEach(function (k) { if (!Array.isArray(p.own[k])) p.own[k] = [0]; });
  if (!Array.isArray(p.acc)) p.acc = [];
  if (!Array.isArray(p.gems) || p.gems.length !== 3) p.gems = [0, 0, 0];
  if (p.day !== today() || !Array.isArray(p.m)) { p.day = today(); p.m = [0, 0, 0]; p.done = [false, false, false]; }
  if (!Array.isArray(p.done)) p.done = [false, false, false];
  if (!p.st || typeof p.st !== 'object') p.st = {};
  ['games', 'wins', 'mk', 'brWins', 'coop', 'hunt', 'td'].forEach(function (k) { p.st[k] = Math.max(0, Math.floor(+p.st[k] || 0)); });
  if (!Array.isArray(p.ach)) p.ach = [];
  p.region = Math.max(0, Math.min(7, p.region | 0));
  return p;
}
function progSave(p) { lsSet('rr_prog', JSON.stringify(p)); if (RR.Cloud) RR.Cloud.saveSoon(); }
function levelOf(xp) { return 1 + Math.floor(Math.sqrt(xp / 60)); }
function renderProg() {
  const p = prog(), lv = levelOf(p.xp), lo = 60 * (lv - 1) * (lv - 1), hi = 60 * lv * lv;
  $('lvTag').textContent = 'Lv.' + lv; $('coinTag').textContent = p.coins; $('coinTag2').textContent = p.coins;
  $('xpFill').style.width = Math.min(100, (p.xp - lo) / (hi - lo) * 100) + '%';
  const box = $('missions'); box.textContent = '';
  MISSIONS.forEach(function (m, i) {
    const row = document.createElement('div'); if (p.done[i]) row.className = 'ok';
    const t = document.createElement('span'); t.textContent = (p.done[i] ? '✓ ' : '') + m[0];
    const s = document.createElement('small'); s.textContent = p.done[i] ? '已領 +' + m[2] : Math.min(p.m[i], m[1]) + ' / ' + m[1] + ' · 金幣 +' + m[2];
    row.appendChild(t); row.appendChild(s); box.appendChild(row);
  });
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
  return '金幣 +' + coins + ' · 經驗 +' + xp + (bonus ? ' · 每日任務完成 +' + bonus : '');
}
function myMap() { const m = parseInt(ls('rr_map') || '0', 10) || 0; return m >= 0 && m < W.MAPS.length ? m : 0; }
function rosterEntry(id) { for (let i = 0; i < S.roster.length; i++) if (S.roster[i].id === id) return S.roster[i]; return null; }

RR.UI = { say: say };

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
      S.roster = msg.players || []; S.hostId = msg.hostId; S.pvp = msg.pvp !== false; S.map = msg.map || 0; S.gmode = msg.mode || 'coop';
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
function rosterMsg() { return { t: 'roster', code: Net.code(), hostId: S.myId, pvp: S.sim.pvp, map: S.sim.map, mode: S.sim.mode, players: S.sim.roster() }; }
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
function rosterAny() { return S.mode === 'solo' ? { t: 'roster', code: null, hostId: 'me', mode: S.sim.mode, players: S.sim.roster() } : rosterMsg(); }
function hostStart(day) { const info = S.sim.startDay(day || 1); hostBroadcast(rosterAny()); hostBroadcast(info); }   // 先送名單（大逃殺會加入電腦玩家），再送開局資料

/* ---------- 進入各種模式 ---------- */
function startSolo(gmode) {
  Sfx.unlock();
  S.mode = 'solo'; S.myId = 'me'; S.sim = new W.Sim(); S.sim.mode = gmode === 'hunt' || gmode === 'br' || gmode === 'td' ? gmode : 'coop'; S.gmode = S.sim.mode;
  document.body.classList.add('solo');
  S.sim.map = myMap();
  S.sim.addPlayer('me', myName(), myLook());
  Game.setMe('me');
  dispatch({ t: 'roster', code: null, hostId: 'me', mode: S.sim.mode, players: S.sim.roster() });
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
  Sfx.unlock(); busy(true, '建立房間中…（第一次連線要先喚醒伺服器，最多約 40 秒）');
  await Voice.init(false);   // 不主動要求麥克風（會打斷 Discord 等其他通話）；要講話再按遊戲裡的「麥克風」
  Net.host(function (err) {
    busy(false);
    if (err) { say(netErr(err)); return; }
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
  Sfx.unlock(); busy(true, '加入房間中…（第一次連線要先喚醒伺服器，最多約 40 秒）');
  await Voice.init(false);   // 不主動要求麥克風（會打斷 Discord 等其他通話）；要講話再按遊戲裡的「麥克風」
  const u = Auth.user();
  const look = myLook();
  Net.join(code, { name: myName(), uid: u ? u.uid : '', c: look.c, w: look.w, h: look.h, o: look.o, pet: look.pet, eq: look.eq, gems: look.gems }, function (err, id) {
    busy(false);
    if (err) { say(netErr(err)); return; }
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
  $('pickSum').textContent = c + ' · ' + w + ' · ' + (m ? m.name : '');
  $('avatar').textContent = c.charAt(0);
}
function showMenu() {
  const u = Auth.user();
  if (!u) { show('scrLogin'); return; }
  $('whoProv').textContent = u.providerLabel + ' 登入';
  if (document.activeElement !== $('nick')) $('nick').value = u.name;
  $('best').textContent = ls('rr_best') || '0';
  show('scrMenu');
  refreshPickSummary(); renderProg();
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
  ['rich', '小富翁', '同時持有 1000 金幣', function (t, p) { return p.coins >= 1000; }, 100]
];
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
  return got.length ? ' · 成就：' + got.join('、') : '';
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
      row.appendChild(mk('span', 'rk', ok ? '✓' : '·'));
      const nm = mk('span', 'nm', a[1]); nm.appendChild(mk('small', null, '　' + a[2])); row.appendChild(nm);
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
    const p = prog(), rk = ['tw', 'hk', 'jp', 'kr', 'sea', 'na', 'eu', 'xx'][p.region];
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
        const nm = mk('span', 'nm', f.name); nm.appendChild(mk('small', null, '　Lv.' + f.lv + (f.clan ? ' [' + f.clan + ']' : '') + (f.online ? (f.room ? ' · 在房間 ' + f.room : ' · 線上') : ' · 離線'))); r.appendChild(nm);
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
        b.appendChild(mk('p', 'note', '戰隊「' + info.clan.name + '」· 積分 ' + (info.clan.score | 0) + ' · ' + info.members.length + ' / 30 人 · 代碼'));
        b.appendChild(mk('div', 'bigcode', info.clan.tag));
        socRows(info.members, function (v) { return v + ' 分'; });
        const lv = mk('button', 'btn', '退出戰隊'); lv.type = 'button'; lv.addEventListener('click', function () { C.leaveClan(function (err) { if (err) say(C.message(err)); renderSocial(); }); }); b.appendChild(lv);
      }
      b.appendChild(mk('div', 'sec', '戰隊排行榜'));
      C.topClans(function (err, rows) {
        if (err || renderSocial.token !== token) return;
        if (!rows.length) { socNote('還沒有任何戰隊。'); return; }
        rows.forEach(function (c, i) { const r = mk('div', 'srow' + (C.me() && C.me().clan === c.id ? ' me' : '')); r.appendChild(mk('span', 'rk', String(i + 1))); const nm = mk('span', 'nm', c.name); nm.appendChild(mk('small', null, '　' + (c.count | 0) + ' 人')); r.appendChild(nm); r.appendChild(mk('span', 'sc', (c.score | 0) + ' 分')); b.appendChild(r); });
      });
    }));
  }
}
function showResultBR(e) {
  const host = S.mode === 'host', solo = S.mode === 'solo';
  const mine = (e.stats || []).filter(function (p) { return p.id === S.myId; })[0] || { rank: e.stats ? e.stats.length : 1, kills: 0 };
  const win = mine.rank === 1, n = e.stats ? e.stats.length : 1;
  $('resTitle').textContent = win ? '第 1 名！你活到最後' : '第 ' + mine.rank + ' 名'; $('resTitle').style.color = win ? '' : '#ffd98a';
  const stars = win ? 3 : mine.rank <= 3 ? 2 : 1, sb = $('resStars'); sb.textContent = '';
  for (let k = 0; k < 3; k++) { const x = document.createElement(k < stars ? 'span' : 'i'); x.textContent = '★'; sb.appendChild(x); }
  $('resText').textContent = '共 ' + n + ' 人，你淘汰了 ' + (mine.kills || 0) + ' 人。';
  const p = prog(), coins = 15 + (mine.kills || 0) * 15 + (win ? 60 : mine.rank <= 3 ? 20 : 0); p.coins += coins; p.xp += coins + 10; if (win) p.m[0] += 1; progSave(p);
  $('resGain').textContent = '金幣 +' + coins + ' · 經驗 +' + (coins + 10) + afterMatch('br', win, 1, null, coins);
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
  $('resTitle').style.color = e.win ? '' : '#ff4a3d';
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
    const sm = document.createElement('small'); sm.textContent = hunt ? '擊倒怪物 ' + (p.mk || 0) + ' 隻' : '賣出 $' + p.earned + ' · 擊殺 ' + p.kills;
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
    b.addEventListener('click', function () {
      Sfx.unlock();
      Auth.signIn(name).catch(function (e) { if (!e || e.code !== 'auth/popup-closed-by-user') say(Auth.message(e)); });
    });
  });
  if (!Auth.configured()) $('loginNote').textContent = '社群登入尚未設定金鑰（見 README），目前可用訪客登入。';
  $('guestBtn').addEventListener('click', function () { Sfx.unlock(); Auth.guest(); });
  $('logoutBtn').addEventListener('click', function () { Auth.signOut(); });
  $('nick').addEventListener('change', function () { Auth.setNick($('nick').value); RR.Cloud.saveSoon(); });
  $('soloBtn').addEventListener('click', function () { startSolo('coop'); });
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
  const hBtns = cards($('hGrid'), W.HATS, function (i) { return ''; }, function (i) {
    const p = prog();
    if (p.hats.indexOf(i) < 0) {
      if (p.coins < HAT_COST[i]) { say('金幣不夠：「' + W.HATS[i] + '」要 ' + HAT_COST[i] + ' 金幣，你有 ' + p.coins + '。過關和每日任務可以賺金幣。'); return; }
      p.coins -= HAT_COST[i]; p.hats.push(i); progSave(p);
    }
    look.h = i; showLook();
  });
  // 服裝、寵物（隊友看得到）與只影響自己畫面的造型
  const wardrobe = [['o', 'oGrid', 'rr_o'], ['pet', 'petGrid', 'rr_pet'], ['is', 'isGrid', 'rr_is'], ['ms', 'msGrid', 'rr_ms'], ['fx', 'fxGrid', 'rr_fx']].map(function (d) {
    const cat = d[0], btns = cards($(d[1]), catNames(cat), function () { return ''; }, function (i) {
      if (!owns(prog(), cat, i)) { say('「' + catNames(cat)[i] + '」還沒取得，到「造型轉盤」抽。'); return; }
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
    const pg = prog();
    hBtns.forEach(function (b, i) { const own = pg.hats.indexOf(i) >= 0; b.classList.toggle('lock', !own); b.lastChild.textContent = own ? (i === look.h ? '使用中' : '已擁有') : HAT_COST[i] + ' 金幣'; });
    wardrobe.forEach(function (wd) {
      const cur = parseInt(ls(wd.key) || '0', 10) || 0, sel = owns(pg, wd.cat, cur) ? cur : 0;
      wd.btns.forEach(function (b, i) { const own = owns(pg, wd.cat, i); b.classList.toggle('lock', !own); b.classList.toggle('on', i === sel); b.lastChild.textContent = !own ? '轉盤取得' : i === sel ? '使用中' : wd.cat === 'pet' && i ? PET_NOTE[i] : '已擁有'; });
    });
    look.o = owns(pg, 'o', look.o) ? look.o : 0; look.pet = owns(pg, 'pet', look.pet) ? look.pet : 0;
    applyLocalSkins();
    lsSet('rr_c', String(look.c)); lsSet('rr_w', String(look.w)); lsSet('rr_h', String(look.h)); renderProg();
    refreshPickSummary();
    Game.preview($('lookPrev'), look.c, look.w, look.h, look.o, look.pet);
  };
  showMapName = function () { mapSel = myMap(); mark(mBtns, mapSel); refreshPickSummary(); };
  showMapName(); Game.showMap(mapSel);
  showLook();
  window.RR_refreshWardrobe = showLook;
  WHEELS.forEach(function (wh, k) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'card';
    const t = document.createElement('b'); t.textContent = wh.n; const u = document.createElement('span'); u.textContent = wh.cost + ' 金幣';
    b.appendChild(t); b.appendChild(u); b.addEventListener('click', function () { if (wheelBusy) return; wheelI = k; $('wheelMsg').textContent = ''; wheelDraw(); });
    $('wheelSel').appendChild(b);
  });
  const openGear = function () { renderGear(); $('scrGear').classList.remove('hide'); $('scrGear').scrollTop = 0; try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {} };
  $('gearOpen').addEventListener('click', openGear); $('hudGear').addEventListener('click', openGear);
  $('gearDone').addEventListener('click', function () { $('scrGear').classList.add('hide'); });
  const openWheel = function () { wheelDraw(); show('scrWheel'); };
  $('wheelOpen').addEventListener('click', openWheel); $('wheelOpen2').addEventListener('click', openWheel);
  $('wheelDone').addEventListener('click', function () { if (!wheelBusy) showMenu(); });
  $('wheelSpin').addEventListener('click', wheelSpin);
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
  $('tutSkip').addEventListener('click', tutDone);
  $('tutAgain').addEventListener('click', function () { tutShow(0); });
  $('miniInfoBtn').addEventListener('click', function () { Game.openMini(); });
  // 設定
  const sens = parseFloat(ls('rr_sens') || '1'), sfx = parseFloat(ls('rr_sfx') || '0.8'), vv = parseFloat(ls('rr_voice') || '1');
  $('setQ').value = ls('rr_q') || (('ontouchstart' in window) ? 'mid' : 'high'); Game.setQuality($('setQ').value);
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
    if (m) $('codeInput').value = m[1].toUpperCase();
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
let installEv = null;
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEv = e; const b = document.getElementById('installBtn'); if (b) b.classList.remove('hide'); });
window.addEventListener('appinstalled', function () { installEv = null; const b = document.getElementById('installBtn'); if (b) b.classList.add('hide'); });
{ const ib = document.getElementById('installBtn'); if (ib) ib.addEventListener('click', function () { if (!installEv) return; installEv.prompt(); installEv.userChoice.finally(function () { installEv = null; ib.classList.add('hide'); }); }); }
// 離線快取與「加到主畫面」（只在 https 上啟用；本機測試不註冊）
if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
{ const bt = document.getElementById('boot'); if (bt) { bt.classList.add('gone'); setTimeout(function () { bt.remove(); }, 400); } }
})();
