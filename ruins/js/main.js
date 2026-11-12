/* 流程：登入 → 選單 → 大廳 → 遊戲 → 結算；以及房主迴圈、訊息分派、聊天 */
(function () {
'use strict';
const RR = window.RR, W = RR.World, Net = RR.Net, Voice = RR.Voice, Sfx = RR.Sfx, Auth = RR.Auth, Game = RR.Game;
const $ = function (id) { return document.getElementById(id); };
const CSSCOL = ['#7dffb0', '#6ecbff', '#ffd166', '#ff7eb6'];
const SCREENS = ['scrLogin', 'scrMenu', 'scrLobby', 'scrResult'];

const S = { mode: null, pvp: true, map: 0, sim: null, myId: null, hostId: null, roster: [], timers: [], lastHost: 0, seen: {}, tickN: 0, lastTick: 0, chatRate: {}, flags: {} };

function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
let showMapName = function () {};
function show(id) { SCREENS.forEach(function (s) { $(s).classList.toggle('hide', s !== id); }); }
function say(text) { $('msgText').textContent = text; $('msg').classList.remove('hide'); }
function busy(on, text) { $('busyText').textContent = text || '請稍候…'; $('busy').classList.toggle('hide', !on); }
function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 12) || '玩家'; }
function myName() { const u = Auth.user(); return cleanName(u ? u.name : '玩家'); }
function myLook() { return { c: parseInt(ls('rr_c') || '0', 10) || 0, w: parseInt(ls('rr_w') || '0', 10) || 0 }; }
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
      S.roster = msg.players || []; S.hostId = msg.hostId; S.pvp = msg.pvp !== false; S.map = msg.map || 0;
      if (!document.body.classList.contains('playing')) Game.showMap(S.map);
      Game.setRoster(S.roster); renderLobby(msg.code); voiceSync();
      break;
    case 'day':
      show(null); Game.setActive(true); Game.onDay(msg); chatOpen(false);
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
function rosterMsg() { return { t: 'roster', code: Net.code(), hostId: S.myId, pvp: S.sim.pvp, map: S.sim.map, players: S.sim.roster() }; }
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
      if (p.id !== S.myId && now - (S.seen[p.id] || now) > 12000) { Net.drop(p.id); hostRemove(p.id); }
    });
  }
}
function startHostLoop() {
  S.lastTick = Date.now(); S.tickN = 0;
  S.timers.push(setInterval(hostTick, 33));
}
function hostStart(day) { hostBroadcast(S.sim.startDay(day || 1)); }

/* ---------- 進入各種模式 ---------- */
function startSolo() {
  Sfx.unlock();
  S.mode = 'solo'; S.myId = 'me'; S.sim = new W.Sim();
  document.body.classList.add('solo');
  S.sim.map = myMap();
  S.sim.addPlayer('me', myName(), myLook());
  Game.setMe('me');
  dispatch({ t: 'roster', code: null, hostId: 'me', players: S.sim.roster() });
  startHostLoop();
  hostStart(1);
}
function netErr(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return '找不到這個房間，請確認代碼。';
  if (t === 'timeout') return '連線逾時，請再試一次。';
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
    } else if (S.mode === 'client') { S.lastHost = Date.now(); dispatch(d); }
  });
  Net.on('call', function (call) { Voice.onIncoming(call); });
  Net.on('hostleft', function () { if (S.mode === 'client') { leave(); say('房主離開了，房間已關閉。'); } });
  Net.on('error', function (e) { console.warn('net', e && e.type); });
}
function micNotice() {
  if (!Voice.hasMic()) chatAdd(null, '沒有麥克風權限：你聽得到隊友，但他們聽不到你。');
}
async function createRoom() {
  Sfx.unlock(); busy(true, '建立房間中…');
  await Voice.init(true);
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
  Sfx.unlock(); busy(true, '加入房間中…');
  await Voice.init(true);
  const u = Auth.user();
  const look = myLook();
  Net.join(code, { name: myName(), uid: u ? u.uid : '', c: look.c, w: look.w }, function (err, id) {
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
  Voice.closeAll(); Net.leave();
  S.mode = null; S.sim = null; S.myId = null; S.roster = []; S.seen = {}; S.chatRate = {}; S.flags = {};
  Game.setActive(false); Game.setRoster([]);
  document.body.classList.remove('solo');
  $('chat').classList.add('hide'); chatOpen(false);
  $('confirm').classList.add('hide');
  Game.showMap(myMap());
  if (Auth.user()) showMenu(); else show('scrLogin');
}

/* ---------- 畫面 ---------- */
function showMenu() {
  const u = Auth.user();
  if (!u) { show('scrLogin'); return; }
  $('whoProv').textContent = u.providerLabel + ' 登入';
  if (document.activeElement !== $('nick')) $('nick').value = u.name;
  $('best').textContent = ls('rr_best') || '0';
  show('scrMenu');
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
  $('mapBtn').textContent = '地圖：' + W.MAPS[S.map || 0].name + (S.mode === 'host' ? '（點擊切換）' : '（房主設定）');
}
function showResult(e) {
  const host = S.mode === 'host', solo = S.mode === 'solo';
  if (e.win) { const best = parseInt(ls('rr_best') || '0', 10); if (e.day > best) lsSet('rr_best', String(e.day)); }
  $('resTitle').textContent = e.win ? '第 ' + e.day + ' 天完成！' : '任務失敗';
  $('resTitle').style.color = e.win ? '' : '#ff4a3d';
  $('resText').textContent = e.win
    ? '賺到 $' + e.money + '（目標 $' + e.quota + '），還剩 ' + e.time + ' 秒。明天目標更高，怪物也更快。'
    : (e.why === 'time' ? '時間到，只賺到 $' + e.money + ' / $' + e.quota + '。' : '全員被抓。帶回 $' + e.money + ' / $' + e.quota + '。') + ' 止步第 ' + e.day + ' 天。';
  const st = $('resStats'); st.textContent = '';
  if (!solo && e.stats) e.stats.forEach(function (p) {
    const row = document.createElement('div'); row.className = 'prow' + (p.alive ? '' : ' dead');
    const dot = document.createElement('i'); dot.style.background = CSSCOL[p.slot % 4];
    const nm = document.createElement('span'); nm.textContent = p.name;
    const sm = document.createElement('small'); sm.textContent = '賣出 $' + p.earned + ' · 擊殺 ' + p.kills;
    row.appendChild(dot); row.appendChild(nm); row.appendChild(sm); st.appendChild(row);
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
  $('nick').addEventListener('change', function () { Auth.setNick($('nick').value); });
  $('soloBtn').addEventListener('click', startSolo);
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
  $('pvpBtn').addEventListener('click', function () { if (S.mode !== 'host') return; S.sim.pvp = !S.sim.pvp; hostBroadcast(rosterMsg()); tickLobby(); });
  $('lobbyMic').addEventListener('click', function () { if (Voice.hasMic()) Voice.setMuted(!Voice.isMuted()); else say('沒有麥克風權限。請在瀏覽器允許麥克風後，重新進入房間。'); tickLobby(); });
  $('copyBtn').addEventListener('click', function () {
    const url = shareUrl($('roomCode').textContent);
    const fallback = function () { const i = $('shareLink'); i.value = url; i.classList.remove('hide'); i.focus(); i.select(); };
    try { navigator.clipboard.writeText(url).then(function () { Game.toast('已複製'); chatAdd(null, '邀請連結已複製'); }, fallback); } catch (e) { fallback(); }
  });
  $('resNext').addEventListener('click', function () { if (S.sim) hostStart(S.sim.day + 1); });
  $('resRetry').addEventListener('click', function () { if (S.sim) hostStart(1); });
  $('resLobby').addEventListener('click', function () { if (S.mode === 'host') { S.sim.toLobby(); hostBroadcast({ t: 'lobby' }); } });
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
  // 造型選擇
  const look = myLook();
  const showLook = function () {
    look.c = ((look.c % W.CHARS.length) + W.CHARS.length) % W.CHARS.length;
    look.w = ((look.w % W.WEAPONS.length) + W.WEAPONS.length) % W.WEAPONS.length;
    $('cName').textContent = W.CHARS[look.c]; $('wName').textContent = W.WEAPONS[look.w];
    lsSet('rr_c', String(look.c)); lsSet('rr_w', String(look.w));
    Game.preview($('lookPrev'), look.c, look.w);
  };
  let mapSel = myMap();
  showMapName = function () { mapSel = myMap(); $('mName').textContent = W.MAPS[mapSel].name; };
  const stepMap = function (d) { mapSel = (mapSel + d + W.MAPS.length) % W.MAPS.length; lsSet('rr_map', String(mapSel)); showMapName(); Game.showMap(mapSel); };
  $('mPrev').addEventListener('click', function () { stepMap(-1); });
  $('mNext').addEventListener('click', function () { stepMap(1); });
  showMapName(); Game.showMap(mapSel);
  $('cPrev').addEventListener('click', function () { look.c--; showLook(); });
  $('cNext').addEventListener('click', function () { look.c++; showLook(); });
  $('wPrev').addEventListener('click', function () { look.w--; showLook(); });
  $('wNext').addEventListener('click', function () { look.w++; showLook(); });
  showLook();
  // 設定
  const sens = parseFloat(ls('rr_sens') || '1'), sfx = parseFloat(ls('rr_sfx') || '0.8'), vv = parseFloat(ls('rr_voice') || '1');
  $('setSens').value = sens; $('setSfx').value = sfx; $('setVoice').value = vv;
  Game.settings.sens = sens;
  const apply = function () {
    Game.settings.sens = parseFloat($('setSens').value); lsSet('rr_sens', $('setSens').value);
    Sfx.setVolume(parseFloat($('setSfx').value)); lsSet('rr_sfx', $('setSfx').value);
    Voice.setVolume(parseFloat($('setVoice').value)); lsSet('rr_voice', $('setVoice').value);
  };
  ['setSens', 'setSfx', 'setVoice'].forEach(function (id) { $(id).addEventListener('input', apply); });
  document.addEventListener('click', function once() { document.removeEventListener('click', once); apply(); });
  window.addEventListener('pagehide', function () { Net.leave(); });
}

function boot() {
  if (!Game.init()) { show(null); say('這個瀏覽器無法啟動 3D 畫面（需要 WebGL）。'); return; }
  bind();
  Game.onAttack = function (yaw) {
    if (S.mode === 'client') Net.send({ t: 'atk', yaw: yaw });
    else if (S.sim) S.sim.attack(S.myId, yaw);
  };
  try {
    const m = /[?&]room=([A-Za-z0-9]{5})/.exec(location.search);
    if (m) $('codeInput').value = m[1].toUpperCase();
  } catch (e) {}
  Auth.init(function (user) {
    if (!user) { if (S.mode) leave(); else show('scrLogin'); return; }
    if (!S.mode) showMenu();
  });
}
boot();
})();
