/* 畫面與操作：3D 場景、本機玩家移動、其他玩家／怪物的顯示、HUD、近距離語音音量 */
(function () {
'use strict';
const RR = window.RR, W = RR.World, Sfx = RR.Sfx, Voice = RR.Voice;
const CS = W.CS, WH = W.WH;
const $ = function (id) { return document.getElementById(id); };
const COLORS = [0xffb84a, 0x6ecbff, 0xc79bff, 0xff7eb6];
const CSSCOL = ['#ffb84a', '#6ecbff', '#c79bff', '#ff7eb6'];

let renderer, scene, camera, torch, canvas, ready = false;
let myId = null, active = false;
const me = { x: W.VAN[0], z: W.VAN[1], yaw: -Math.PI * 0.75, pitch: 0, stam: 1, tired: false, walkT: 0, running: false, alive: true, bagN: 0, hp: 100 };
let atkT = 0, swingT = 0, pipe = null, hurtFlash = 0;
const view = { phase: 'lobby', day: 1, money: 0, quota: 0, time: 0, players: new Map(), monsters: [], items: [] };
// 角色屬性：0 回收員 1 機器人 2 太空人 3 貓貓 4 南瓜頭 5 紙箱人
const CHAR_SPEED = [1, 1, 1.05, 1.10, 1, 1, 0.97, 1];
const COSTUME_COL = [null, 0x566b3a, 0x39e8ff, 0xffd24a, 0x1d2027, 0xf2f4f8];   // 服裝顏色（0 = 隊伍色）
const FX_COL = [0xfff1b0, 0x6ad8ff, 0xff7eb6, 0xb98cff];                          // 彈道特效顏色
function myEq(k) { const pm = view.players.get(myId); return !!(pm && pm.eq && pm.eq.indexOf(k) >= 0); }
function myGem(i) { const pm = view.players.get(myId); return pm && pm.gems ? pm.gems[i] | 0 : 0; }
function hpPct() { return Math.max(0, Math.min(100, me.hp / (myEq(4) ? 130 : 100) * 100)) + '%'; }
function myPet() { const pm = view.players.get(myId); return pm && pm.pet ? pm.pet : 0; }
function myC() { const pm = view.players.get(myId); return pm && pm.c ? pm.c : 0; }
// 藍色（冰）怪物附近：減速
function iceNear() {
  for (let i = 1; i < view.monsters.length; i += 4) {
    const m = view.monsters[i];
    if (m.group.visible && Math.hypot(m.x - me.x, m.z - me.z) < 4) return true;
  }
  return false;
}
// 太空人月光波：淡藍光環向外擴散
function showMoon(x, z) {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.9, 48), new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  r.rotation.x = -Math.PI / 2; r.position.set(x, 0.1, z); scene.add(r);
  let t = 0;
  const id = setInterval(function () {
    t += 0.05; const s = 1 + t * 12; r.scale.set(s, s, s); r.material.opacity = Math.max(0, 0.9 - t * 1.5);
    if (t >= 0.6) { clearInterval(id); scene.remove(r); }
  }, 50);
  Sfx.tone(880, 0.5, 'sine', 0.1, 440);
}
// 煙霧彈：場景中冒出一團看得到的煙，約 6 秒後散掉
function showCloud(x, z) {
  const g = new THREE.Group(), puffs = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xc9cdc4, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    const a = Math.random() * 6.283, r = i ? 0.6 + Math.random() * 1.6 : 0;
    m.position.set(Math.cos(a) * r, 0.7 + Math.random() * 1.3, Math.sin(a) * r); g.add(m); puffs.push(m);
  }
  g.position.set(x, 0, z); g.scale.set(0.2, 0.2, 0.2); scene.add(g);
  const t0 = Date.now();
  const id = setInterval(function () {
    const t = (Date.now() - t0) / 1000;
    const s = Math.min(1, 0.2 + t * 1.6), o = t < 0.5 ? t * 1.3 : t > 5 ? Math.max(0, (6 - t) * 0.65) : 0.65;
    g.scale.set(s, s, s); g.rotation.y += 0.01;
    puffs.forEach(function (m) { m.material.opacity = o; });
    if (t >= 6) { clearInterval(id); scene.remove(g); puffs.forEach(function (m) { m.geometry.dispose(); m.material.dispose(); }); }
  }, 50);
  Sfx.noise(0.5, 0.14);
}
function trySmoke() {
  if (!canControl()) return;
  const left = Math.ceil((smEnd - Date.now()) / 1000);
  if (left > 0) { toast('煙霧彈冷卻中，還要 ' + left + ' 秒'); return; }
  smQ = true;
}
// 小遊戲獨立頁面：先選小遊戲，再進圈圈叉叉棋盤
let miniInPlay = false, skEnd = 0, smEnd = 0;
function miniShowList(on) { if (RR.Mini) RR.Mini.showBox(on ? 'miniList' : 'miniTTBox'); else { $('miniList').classList.toggle('hide', !on); $('miniTTBox').classList.toggle('hide', on); } }
function openMini() {
  miniInPlay = canControl();
  miniShowList(true);
  $('scrMini').classList.remove('hide');
  try { if (document.exitPointerLock) document.exitPointerLock(); } catch (err) {}
}
function closeMini() { $('scrMini').classList.add('hide'); miniInPlay = false; if (RR.Mini) RR.Mini.stop(); }
function initMini() {
  const grid = $('ttGrid');
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('button'); b.type = 'button';
    b.addEventListener('click', function () { if (canControl()) ttQ = i; });
    grid.appendChild(b);
  }
  $('miniBtn').addEventListener('click', openMini);
  $('miniClose').addEventListener('click', closeMini);
  $('miniBack').addEventListener('click', function () { miniShowList(true); });
  $('miniTT').addEventListener('click', function () {
    if (!canControl()) { RR.UI.say('隊伍圈圈叉叉要在遊戲中和隊友玩：開始遊戲後按右上角「小遊戲」（電腦按 G）。想現在玩可以選「圈圈叉叉」和電腦下。'); return; }
    miniShowList(false);
  });
}
// 技能：冷卻中按下會提示剩餘秒數
function trySkill() {
  if (!canControl()) return;
  const left = Math.ceil((skEnd - Date.now()) / 1000);
  if (left > 0) { toast('技能冷卻中，還要 ' + left + ' 秒'); return; }
  skQ = true;
}
function renderTT() {
  const left = Math.ceil((skEnd - Date.now()) / 1000), sb = $('skill'), txt = left > 0 ? String(left) : '技';
  if (sb.textContent !== txt) { sb.textContent = txt; sb.classList.toggle('cd', left > 0); }
  const sl = Math.ceil((smEnd - Date.now()) / 1000), mb = $('smoke'), mt = sl > 0 ? String(sl) : '煙';
  if (mb.textContent !== mt) { mb.textContent = mt; mb.classList.toggle('cd', sl > 0); }
  if ($('scrMini').classList.contains('hide')) return;
  if (miniInPlay && !canControl()) { closeMini(); return; }
  if ($('miniTTBox').classList.contains('hide') || !view.tt) return;
  const t = view.tt, cells = $('ttGrid').children;
  for (let i = 0; i < 9; i++) {
    const c = t[0][i]; cells[i].textContent = c === '.' ? '' : c;
    cells[i].disabled = c !== '.' || t[4] !== null;
  }
  const who = t[4] ? (t[4] === 'win' ? (t[5] + ' 獲勝！6 秒後重新開始') : '平手，6 秒後重新開始') : (t[1] + ' 的回合' + (!t[2] ? '（還沒有人落子）' : !t[3] ? '（等另一位玩家加入）' : ''));
  $('ttSub').textContent = who;
}
// 煙霧干擾：畫面模糊 5 秒
function showSmoke() {
  let el = document.getElementById('smokeFx');
  if (!el) {
    el = document.createElement('div'); el.id = 'smokeFx';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:15;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);background:rgba(120,120,110,.55);opacity:0;transition:opacity .5s';
    document.body.appendChild(el);
  }
  el.style.opacity = '1'; clearTimeout(smokeT); smokeT = setTimeout(function () { el.style.opacity = '0'; }, 5000);
  Sfx.noise(0.3, 0.12);
}
// 字幕（畫面中央下方，約 2 秒後淡出）
let subEl = null, subHide = 0;
function showSub(text) {
  if (!subEl) {
    subEl = document.createElement('div');
    subEl.style.cssText = 'position:fixed;left:50%;bottom:22%;transform:translateX(-50%);color:#ff6b5e;font:700 22px/1.2 sans-serif;letter-spacing:.08em;text-shadow:0 0 8px #000;pointer-events:none;transition:opacity .4s;opacity:0;z-index:20;white-space:nowrap';
    document.body.appendChild(subEl);
  }
  subEl.textContent = text; subEl.style.opacity = '1';
  clearTimeout(subHide); subHide = setTimeout(function () { subEl.style.opacity = '0'; }, 2000);
}
const keys = {};
let smQ = false, skQ = false, smokeT = null, padMesh = null, ttQ = null, trophyMesh = null, boardMesh = null;   // Q 丟煙霧彈（按一下送一次）
const touch = { joyId: null, lookId: null, ox: 0, oy: 0, jx: 0, jy: 0, lx: 0, ly: 0, run: false };
const settings = { sens: 1 };
// 手機改用 Lambert 材質（逐頂點打光），GPU 負擔約少一半，畫面差異很小；電腦維持 Phong
const LITE = ('ontouchstart' in window) || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function litMat(o) {
  if (!LITE) return new THREE.MeshPhongMaterial(o);
  const m = new THREE.MeshLambertMaterial(), p = {};
  Object.keys(o || {}).forEach(function (k) { if (m[k] !== undefined) p[k] = o[k]; });
  m.setValues(p); return m;
}
let specId = null, beatT = 0, toastT = 0, fullHintT = 0, loudT = 0, spk = false, hudT = 0, lastL = me, dragging = false;
let itemGeos = null, skinGeos = null;

// 飄字（賣出金額、受傷）
function floatText(text, bad) {
  const el = document.createElement('span'); el.textContent = text; if (bad) el.className = 'bad';
  $('floats').appendChild(el); setTimeout(function () { el.remove(); }, 1350);
}
let shakeT = 0, jumpQ = false, dashQ = false, dashT = 0, dashCd = 0, dashDir = [0, 0];
me.y = 0; me.vy = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.style.opacity = 1; toastT = 2.4; }
let editing = false;
function canControl() { return active && view.phase === 'play' && me.alive && !editing; }
function nameOf(id) { const p = view.players.get(id); return p ? p.name : '隊友'; }

/* ---------- 建場景 ---------- */
// 窗戶／艙板貼圖：city 是亮燈的窗戶，space 是金屬板加燈條
function makeWinTex(base, windows) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'); g.scale(2, 2);
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  if (windows) {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = Math.random() < 0.55 ? '#ffd98a' : '#27303a'; g.fillRect(8 + x * 30, 8 + y * 30, 20, 18); }
  } else {
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(2, 2, 124, 124); g.strokeRect(10, 10, 108, 50); g.strokeRect(10, 68, 108, 50);
    g.fillStyle = '#6ad8ff'; g.fillRect(14, 60, 100, 4);
    g.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 0; k < 8; k++) g.fillRect(16 + k * 13, 14, 3, 3);
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; return t;
}
// 材質貼圖：512px，柔和的色塊與細顆粒（不要一格一格的雜點），遠看是平滑的牆面／地面
function makeTex(base, speck, lines) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d'); g.scale(4, 4);
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 46; i++) {   // 大片柔和的明暗
    const x = Math.random() * 128, y = Math.random() * 128, r = 10 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r), c = Math.random() < 0.5 ? speck : '255,255,255';
    gr.addColorStop(0, 'rgba(' + c + ',' + (0.05 + Math.random() * 0.07).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(' + c + ',0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 5000; i++) {  // 很細的顆粒
    g.fillStyle = 'rgba(' + speck + ',' + (Math.random() * 0.07).toFixed(3) + ')';
    g.fillRect(Math.random() * 128, Math.random() * 128, 0.3, 0.3);
  }
  if (lines) {
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, 127, 127);
    g.beginPath(); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
    for (let i = 0; i < 5; i++) {   // 水漬：由上往下淡出
      const x = Math.random() * 120, y = Math.random() * 60, w = 3 + Math.random() * 5, h = 30 + Math.random() * 60;
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(60,20,10,.22)'); gr.addColorStop(1, 'rgba(60,20,10,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
    }
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; return t;
}

let maxAniso = 1;
let wallsMesh = null, wallIdx = {}, brokenVis = {};
// 牆被炸開：藏起那一格牆（和它上面的布景）、噴碎塊、重畫小地圖
function showBreak(c, r, quiet) {
  const key = r * W.COLS + c;
  if (brokenVis[key]) return;
  brokenVis[key] = true;
  W.breakWall(c, r);   // 房主／單人已經炸過了，這裡只對其他玩家的地圖生效
  if (wallsMesh && wallIdx[key] != null) { wallsMesh.setMatrixAt(wallIdx[key], new THREE.Matrix4().makeScale(0, 0, 0)); wallsMesh.instanceMatrix.needsUpdate = true; }
  if (level) level.children.filter(function (o) { return o.userData && o.userData.cell === key; }).forEach(function (o) { level.remove(o); });
  // 缺口旁貼牆的木箱、鐵桶一起炸掉（不然會擋住新開的路）
  const bx = c * CS + CS / 2, bz = r * CS + CS / 2, near = function (x, z) { return Math.abs(x - bx) < CS / 2 + 0.9 && Math.abs(z - bz) < CS / 2 + 0.9; };
  solids = solids.filter(function (q) { return q[2] >= 0.5 || !near(q[0], q[1]); });   // 櫃子（半徑 0.5）留著
  if (level) level.children.filter(function (o) { const t = o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.type; return (t === 'BoxGeometry' || t === 'CylinderGeometry') && o.position.y < 1.6 && near(o.position.x, o.position.z); }).forEach(function (o) { level.remove(o); });
  buildMini();
  if (quiet) return;
  const cx = bx, cz = bz, bits = [], col = new THREE.Color(W.theme.wall);
  for (let i = 0; i < 16; i++) {
    const s = 0.18 + Math.random() * 0.4, m = part(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: col }), cx + (Math.random() - 0.5) * CS * 0.8, 0.4 + Math.random() * 2, cz + (Math.random() - 0.5) * CS * 0.8);
    m.userData.v = [(Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7]; scene.add(m); bits.push(m);
  }
  showCloud(cx, cz);
  const t0 = Date.now(); let last = t0;
  const id = setInterval(function () {
    const now = Date.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    bits.forEach(function (m) { const v = m.userData.v; v[1] -= 16 * dt; m.position.x += v[0] * dt; m.position.z += v[2] * dt; m.position.y = Math.max(m.geometry.parameters.height / 2, m.position.y + v[1] * dt); if (m.position.y <= m.geometry.parameters.height / 2 + 0.001) { v[0] *= 0.8; v[2] *= 0.8; } m.rotation.x += v[0] * dt; m.rotation.z += v[2] * dt; });
    if (now - t0 > 2600) { clearInterval(id); bits.forEach(function (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }); }
  }, 30);
  const d = Math.hypot(cx - me.x, cz - me.z);
  Sfx.noise(0.7, Math.max(0.06, 0.45 - d * 0.012)); Sfx.tone(90, 0.5, 'sawtooth', Math.max(0.04, 0.3 - d * 0.008), 30);
  if (d < 14) shakeT = Math.max(shakeT, 0.5 - d * 0.03);
}
let solids = [];   // 擺設的碰撞圓（櫃子、木箱、鐵桶）：[x, z, 半徑]
function hitSolid(x, z) { for (let i = 0; i < solids.length; i++) { const q = solids[i]; if (Math.hypot(q[0] - x, q[1] - z) < q[2] + 0.34) return true; } return false; }
let level = null, builtMap = -1, ambient = null, hemi = null, sun = null, torchBase = 2.2;

/* ---------- 小地圖（每張地圖自動產生；北方固定朝上，點一下放大） ---------- */
const MC = 10;   // 每格的像素
let mini = null, miniCtx = null, miniBase = null, miniT = 0;
function buildMini() {
  mini = $('mini'); if (!mini) return;
  const COLS = W.COLS, ROWS = W.ROWS;
  mini.width = COLS * MC; mini.height = ROWS * MC; mini.style.aspectRatio = COLS + ' / ' + ROWS;
  miniCtx = mini.getContext('2d');
  miniBase = document.createElement('canvas'); miniBase.width = mini.width; miniBase.height = mini.height;
  const g = miniBase.getContext('2d');
  g.fillStyle = 'rgba(9,13,22,.78)'; g.fillRect(0, 0, mini.width, mini.height);
  g.fillStyle = 'rgba(120,160,230,.28)';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (W.MAP[r][c] !== '#') g.fillRect(c * MC, r * MC, MC, MC);
  // 回收車
  const v = W.VAN, k = MC / CS;
  g.fillStyle = '#ffd27a'; towerMeshes.forEach(function (t) { g.fillRect(t.position.x * k - MC * 0.3, t.position.z * k - MC * 0.3, MC * 0.6, MC * 0.6); });   // 砲塔
  g.fillStyle = '#5fb4e6'; (W.lockers || []).forEach(function (q) { g.fillRect(q[0] * k - MC * 0.25, q[1] * k - MC * 0.25, MC * 0.5, MC * 0.5); });   // 櫃子
  g.fillStyle = '#ffc24a'; g.fillRect(v[0] * k - MC * 0.45, v[1] * k - MC * 0.45, MC * 0.9, MC * 0.9);
  g.fillStyle = '#1b1305'; g.font = 'bold ' + (MC * 0.8) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('車', v[0] * k, v[1] * k + 0.5);
}
function drawMini(L) {
  if (!miniCtx) return;
  const g = miniCtx, k = MC / CS;
  g.clearRect(0, 0, mini.width, mini.height);
  g.drawImage(miniBase, 0, 0);
  if (view.zone) {   // 大逃殺安全區
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(view.zone[0] * k, view.zone[1] * k, Math.max(1, view.zr * k), 0, Math.PI * 2); g.stroke();
  }
  view.players.forEach(function (p) {          // 還活著的隊友（大逃殺不顯示對手）
    if (p.id === myId || !p.alive || view.mode === 'br') return;
    g.fillStyle = CSSCOL[p.slot % 4];
    g.beginPath(); g.arc(p.x * k, p.z * k, MC * 0.38, 0, Math.PI * 2); g.fill();
  });
  // 怪物：靠近（14 公尺內）才顯示；依種類上色（火紅、冰藍、毒綠、暗影紫），追人時外圈閃爍
  const MC_COL = ['#ff5a2a', '#5ad0ff', '#8cff5a', '#b070ff'];
  for (let i = 0; i < view.monsters.length; i++) {
    const m = view.monsters[i];
    if (!m.group.visible || view.weather === 4 || (view.mode !== 'hunt' && view.mode !== 'td' && Math.hypot(m.x - L.x, m.z - L.z) > (myPet() === 2 ? 22 : 14))) continue;   // 14 公尺內才顯示
    const mx = m.x * k, my = m.z * k;
    if (m.chase && Math.floor(Date.now() / 250) % 2) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath(); g.arc(mx, my, MC * 0.75, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = MC_COL[i % 4]; g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(mx, my - MC * 0.55); g.lineTo(mx + MC * 0.5, my + MC * 0.4); g.lineTo(mx - MC * 0.5, my + MC * 0.4); g.closePath(); g.fill(); g.stroke();
  }
  // 自己（或觀戰對象）：箭頭指向面對的方向
  const fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw), x = L.x * k, y = L.z * k, s = MC * 0.75;
  g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x + fx * s, y + fz * s);
  g.lineTo(x - fx * s * 0.6 - fz * s * 0.6, y - fz * s * 0.6 + fx * s * 0.6);
  g.lineTo(x - fx * s * 0.6 + fz * s * 0.6, y - fz * s * 0.6 - fx * s * 0.6);
  g.closePath(); g.fill(); g.stroke();
}
function buildLevel() {
  if (level) {
    scene.remove(level);
    level.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
  level = new THREE.Group(); builtMap = W.mapIndex; solids = []; wallIdx = {}; brokenVis = {};
  const COLS = W.COLS, ROWS = W.ROWS, MAP = W.MAP, T = W.theme, VAN = W.VAN;
  // 光線：室內也調亮；開放場景（海邊、城市、太空站）沒有天花板，有天空與陽光
  const open = !!T.open, br = T.bright || 1.5, skyC = open ? T.sky : 0x0a0f0d;
  scene.fog.density = open ? T.fog : T.fog * 0.3; scene.fog.color.setHex(skyC); scene.background.setHex(skyC);
  if (ambient) { ambient.color.setHex(T.amb); ambient.intensity = open ? 0.5 : 0.95 * br; }
  if (hemi) hemi.intensity = open ? 0.3 : 0.45 * br;
  if (sun) sun.intensity = open ? (T.sun || 0.5) : 0;
  torchBase = T.torch != null ? T.torch : 2.2;
  baseLight = { fog: scene.fog.density, fogC: skyC, amb: ambient ? ambient.intensity : 1, hemi: hemi ? hemi.intensity : 0.4, sun: sun ? sun.intensity : 0, torch: torchBase, open: open };
  const style = T.style || 'ruin', wallH = T.wallH || WH;
  const floorTex = makeTex(T.floor, style === 'beach' ? '255,255,255' : '0,0,0', false); floorTex.repeat.set(COLS, ROWS);
  const Wd = COLS * CS, D = ROWS * CS;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Wd, D, LITE ? COLS * 2 : 1, LITE ? ROWS * 2 : 1), litMat({ map: floorTex, shininess: style === 'space' ? 40 : 8 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(Wd / 2, 0, D / 2); level.add(floor);
  if (!open) {
    const ceilTex = makeTex(T.ceil, '0,0,0', false); ceilTex.repeat.set(COLS, ROWS);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Wd, D, LITE ? COLS : 1, LITE ? ROWS : 1), litMat({ map: ceilTex, shininess: 2 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(Wd / 2, WH, D / 2); level.add(ceil);
  }
  const wallTex = style === 'city' ? makeWinTex(T.wall, true) : style === 'space' ? makeWinTex(T.wall, false) : makeTex(T.wall, '20,20,20', style !== 'beach' && style !== 'office');
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === '#') n++;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, 1, CS), litMat({ map: wallTex, shininess: style === 'space' ? 50 : 4 }), n);
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), sc3 = new THREE.Vector3(); let i = 0;
  let hs = 99 + W.mapIndex; const hr = function () { hs = (hs * 16807) % 2147483647; return hs / 2147483647; };
  const tops = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === '#') {
    const edge = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
    let hgt = wallH;
    if (style === 'city') hgt = edge ? 3.6 : 5 + Math.floor(hr() * 4) * 1.8;
    else if (style === 'beach') hgt = edge ? 1.5 : 1.9 + hr() * 0.9;
    else if (style === 'space') hgt = edge ? 1.4 : 3;
    v3.set(c * CS + CS / 2, hgt / 2, r * CS + CS / 2); sc3.set(1, hgt, 1); m4.compose(v3, q4, sc3); walls.setMatrixAt(i++, m4);
    wallIdx[r * COLS + c] = i - 1;
    if (!edge) tops.push([c * CS + CS / 2, hgt, r * CS + CS / 2, r * COLS + c]);
  }
  walls.instanceMatrix.needsUpdate = true; level.add(walls); wallsMesh = walls;
  // 開放場景的布景
  if (style === 'beach') {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), litMat({ color: 0x2a9fd6, emissive: 0x0a3a5a, shininess: 90 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(Wd / 2, -0.25, D / 2); level.add(sea);
    const trunkM = pmat(0x8a6238, 0.15), leafM = litMat({ color: 0x2f9a4a, emissive: 0x0c3a16, side: THREE.DoubleSide });
    tops.forEach(function (t, k) {
      if (k % 2) return;
      const pg = new THREE.Group(), tr = part(new THREE.CylinderGeometry(0.12, 0.2, 3.2, 7), trunkM, 0, 1.6, 0); tr.rotation.z = 0.12; pg.add(tr);
      for (let j = 0; j < 6; j++) { const lf = part(new THREE.ConeGeometry(0.35, 2.1, 4), leafM, Math.cos(j * 1.047) * 0.85 + 0.2, 3.25, Math.sin(j * 1.047) * 0.85); lf.rotation.z = Math.PI / 2 - 0.5; lf.rotation.y = -j * 1.047; lf.scale.z = 0.25; pg.add(lf); }
      pg.position.set(t[0], t[1] - 0.1, t[2]); pg.userData.cell = t[3]; level.add(pg);
    });
    const sunDisc = part(new THREE.SphereGeometry(9, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6c0, fog: false }), Wd / 2 + 120, 90, D / 2 - 160); level.add(sunDisc);
  } else if (style === 'city') {
    const sunDisc = part(new THREE.SphereGeometry(14, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false }), Wd / 2 - 150, 30, D / 2 - 170); level.add(sunDisc);
    const far = new THREE.MeshBasicMaterial({ color: 0x4a3f52, fog: false });
    for (let k = 0; k < 26; k++) { const a = k / 26 * 6.283, hh = 18 + hr() * 40; level.add(part(new THREE.BoxGeometry(10 + hr() * 10, hh, 10), far, Wd / 2 + Math.cos(a) * 130, hh / 2 - 2, D / 2 + Math.sin(a) * 130)); }
    const poleM = pmat(0x2a2e33, 0.05), bulbM = new THREE.MeshBasicMaterial({ color: 0xffe7a8 });
    W.floorCells.forEach(function (fc, k) { if (k % 9) return; const x = fc[0] * CS + CS / 2 + 1.6, z = fc[1] * CS + CS / 2 + 1.6; level.add(part(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 6), poleM, x, 1.8, z), part(new THREE.SphereGeometry(0.16, 8, 8), bulbM, x, 3.65, z)); });
  } else if (style === 'space') {
    const sg = new THREE.BufferGeometry(), pos = new Float32Array(900 * 3);
    for (let k = 0; k < 900; k++) { const a = hr() * 6.283, e = hr() * 1.45 + 0.05, R = 260; pos[k * 3] = Wd / 2 + Math.cos(a) * Math.cos(e) * R; pos[k * 3 + 1] = Math.sin(e) * R; pos[k * 3 + 2] = D / 2 + Math.sin(a) * Math.cos(e) * R; }
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    level.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })));
    const planet = part(new THREE.SphereGeometry(46, 28, 20), litMat({ color: 0x3a78c8, emissive: 0x0f2a55, shininess: 12, fog: false }), Wd / 2 - 90, 70, D / 2 - 190); level.add(planet);
    level.add(part(new THREE.SphereGeometry(8, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd9d9d0, fog: false }), Wd / 2 + 150, 110, D / 2 + 60));
    const glowM = new THREE.MeshBasicMaterial({ color: 0x6ad8ff });
    tops.forEach(function (t) { const gl = part(new THREE.BoxGeometry(CS * 0.9, 0.06, 0.12), glowM, t[0], t[1] + 0.03, t[2]); gl.userData.cell = t[3]; level.add(gl); });
  }
  // 回收車
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 40), new THREE.MeshBasicMaterial({ color: 0xffc24a, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(VAN[0], 0.03, VAN[1]); level.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, WH, 28, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.set(VAN[0], WH / 2, VAN[1]); level.add(beam);
  const vl = new THREE.PointLight(0xffc24a, 0.9, 12, 1.6); vl.position.set(VAN[0], 2.4, VAN[1]); level.add(vl);
  // 櫃子（躲藏點）
  const lockM = new THREE.MeshLambertMaterial({ color: 0x2a4a60, emissive: 0x0b1c28 }), lineM = new THREE.MeshBasicMaterial({ color: 0x0a141a }), tagM = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
  (W.lockers || []).forEach(function (k) {
    const lg = new THREE.Group();
    lg.add(part(new THREE.BoxGeometry(1.0, 2.1, 0.6), lockM, 0, 1.05, 0), part(new THREE.BoxGeometry(0.02, 1.9, 0.02), lineM, 0, 1.05, 0.31),
      part(new THREE.BoxGeometry(0.3, 0.03, 0.02), lineM, -0.25, 1.75, 0.31), part(new THREE.BoxGeometry(0.3, 0.03, 0.02), lineM, 0.25, 1.75, 0.31),
      part(new THREE.BoxGeometry(0.04, 0.14, 0.04), lineM, -0.08, 1.05, 0.32), part(new THREE.BoxGeometry(0.04, 0.14, 0.04), lineM, 0.08, 1.05, 0.32),
      part(new THREE.BoxGeometry(0.22, 0.08, 0.02), tagM, 0, 2.22, 0.2));
    lg.position.set(k[0], 0, k[1]); lg.rotation.y = k[2]; level.add(lg); solids.push([k[0], k[1], 0.5]);
  });
  // 擺設：木箱、鐵桶貼牆放；天花板燈條（固定種子，每張地圖每次都一樣）
  let seed = 1234 + W.mapIndex * 77; const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const crateM = litMat({ map: makeTex('#7a5a3a', '30,20,10', true), shininess: 4 }), barrelM = litMat({ color: 0x556b5a, emissive: 0x0c140e, shininess: 40 });
  const lampM = new THREE.MeshBasicMaterial({ color: 0xdfeee6 }), bandM = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
  let lamps = 0;
  W.floorCells.forEach(function (fc) {
    const c = fc[0], r = fc[1], cx = c * CS + CS / 2, cz = r * CS + CS / 2;
    if (Math.hypot(cx - VAN[0], cz - VAN[1]) < CS * 1.5) return;
    if ((W.lockers || []).some(function (k) { return Math.hypot(k[0] - cx, k[1] - cz) < CS * 0.75; })) return;
    const walls4 = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(function (d) { return W.isWall(c + d[0], r + d[1]); });
    const roll = rnd();
    if (walls4.length && roll < 0.22) {
      const d = walls4[Math.floor(rnd() * walls4.length)], off = CS / 2 - 0.42, side = (rnd() - 0.5) * 1.6;
      const px = cx + d[0] * off + (d[0] ? 0 : side), pz = cz + d[1] * off + (d[1] ? 0 : side);
      if (roll < 0.12) {
        const sz = 0.55 + rnd() * 0.25, cr = part(new THREE.BoxGeometry(sz, sz, sz), crateM, px, sz / 2, pz); solids.push([px, pz, sz * 0.55]); cr.rotation.y = rnd() * 0.5; level.add(cr);
        if (rnd() < 0.4) { const s2 = sz * 0.7, c2 = part(new THREE.BoxGeometry(s2, s2, s2), crateM, px, sz + s2 / 2, pz); c2.rotation.y = rnd(); level.add(c2); }
      } else {
        solids.push([px, pz, 0.32]);
        level.add(part(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), barrelM, px, 0.45, pz), part(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 12), bandM, px, 0.62, pz));
      }
    }
    if (!open && (c + r * 2) % (style === 'office' ? 3 : 5) === 0 && lamps < 70) {   // 燈條：發光但不投光（省效能）
      lamps++;
      const lp = part(new THREE.BoxGeometry(1.3, 0.05, 0.22), lampM, cx, WH - 0.04, cz); if (c % 2) lp.rotation.y = Math.PI / 2; level.add(lp);
    }
  });
  // 回收車車體（放在光圈旁，緊貼最近的牆）
  const sc0 = W.cellOf(VAN[0], VAN[1]), vw = [[-1, 0], [0, -1], [1, 0], [0, 1]].filter(function (d) { return W.isWall(sc0[0] + d[0], sc0[1] + d[1]); })[0];
  if (vw) {
    const tg = new THREE.Group(), bodyM = pmat(0xd9902f, 0.25), cabM = pmat(0xe8eef2, 0.15), tyre = pmat(0x111413, 0.02);
    tg.add(part(new THREE.BoxGeometry(1.5, 0.9, 0.8), bodyM, 0, 0.75, 0), part(new THREE.BoxGeometry(0.55, 0.7, 0.8), cabM, 1.05, 0.65, 0), part(new THREE.BoxGeometry(0.3, 0.25, 0.7), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }), 1.2, 0.82, 0));
    [[-0.5, 0.42], [0.95, 0.42], [-0.5, -0.42], [0.95, -0.42]].forEach(function (q) { const w = part(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10), tyre, q[0], 0.2, q[1]); w.rotation.x = Math.PI / 2; tg.add(w); });
    tg.position.set(VAN[0] + vw[0] * (CS / 2 - 0.5), 0, VAN[1] + vw[1] * (CS / 2 - 0.5)); tg.rotation.y = vw[0] ? Math.PI / 2 : 0; level.add(tg);
  }
  scene.add(level);
  buildMini();
}

const MON_COL = { fire: [0xff6a1a, 0xff4a10], ice: [0x6ad8ff, 0x3ac8ff], poison: [0x7dff5a, 0x5aff3a], shadow: [0xb070ff, 0x9040ff] };
function buildMonster(kind) {
  const col = MON_COL[kind] || MON_COL.fire;
  const g = new THREE.Group();
  const skinM = RR.Game && RR.Game.settings ? RR.Game.settings.monSkin | 0 : 0;   // 怪物造型：0 預設（黑）、1 骸骨白、2 霓虹
  const dark = litMat({ color: skinM === 1 ? 0xe8e2d0 : skinM === 2 ? 0x101018 : 0x0c0c0e, shininess: 30, emissive: new THREE.Color(col[1]).multiplyScalar(skinM === 2 ? 0.75 : skinM === 1 ? 0.02 : 0.07) });
  const tint = litMat({ color: col[1], emissive: new THREE.Color(col[1]).multiplyScalar(0.5), shininess: 40 });
  const eyeM = new THREE.MeshBasicMaterial({ color: col[0] });
  const tall = kind === 'shadow' ? 1.12 : kind === 'poison' ? 0.9 : 1;
  const body = part(new THREE.CylinderGeometry(kind === 'poison' ? 0.3 : 0.2, kind === 'poison' ? 0.46 : 0.34, 2.2, 20), dark, 0, 1.1, 0);
  const head = part(new THREE.SphereGeometry(0.34, 28, 24), dark, 0, 2.5, 0); head.scale.y = 1.25;
  const e1 = part(new THREE.SphereGeometry(0.065, 20, 16), eyeM, -0.13, 2.56, 0.3), e2 = part(new THREE.SphereGeometry(0.065, 20, 16), eyeM, 0.13, 2.56, 0.3);
  const mouth = part(new THREE.BoxGeometry(0.26, 0.05, 0.04), eyeM, 0, 2.34, 0.31);
  const armG = new THREE.CylinderGeometry(0.05, 0.035, 1.9, 16), clawG = new THREE.ConeGeometry(0.035, 0.22, 5);
  const mkArm = function (x) {
    const pv = new THREE.Group(); pv.position.set(x, 2.15, 0.05);
    pv.add(part(armG, dark, 0, -0.9, 0));
    for (let k = -1; k <= 1; k++) { const cl = part(clawG, tint, k * 0.05, -1.92, 0.02); cl.rotation.x = Math.PI; pv.add(cl); }
    pv.rotation.z = x < 0 ? -0.16 : 0.16; return pv;
  };
  const a1 = mkArm(-0.42), a2 = mkArm(0.42);
  g.add(body, head, e1, e2, mouth, a1, a2);
  if (kind === 'fire') {            // 火：兩支角、背後火焰
    const hornG = new THREE.ConeGeometry(0.07, 0.42, 6);
    const h1 = part(hornG, tint, -0.2, 2.98, 0), h2 = part(hornG, tint, 0.2, 2.98, 0); h1.rotation.z = 0.35; h2.rotation.z = -0.35;
    g.add(h1, h2);
    for (let k = 0; k < 4; k++) g.add(part(new THREE.ConeGeometry(0.09, 0.5 + k % 2 * 0.2, 5), tint, (k - 1.5) * 0.14, 1.5 + k % 2 * 0.25, -0.3));
  } else if (kind === 'ice') {      // 冰：肩膀與頭頂的冰晶
    const cr = new THREE.OctahedronGeometry(0.2);
    [[-0.36, 2.05, 0], [0.36, 2.05, 0], [0, 3.0, 0], [-0.2, 1.3, -0.25], [0.22, 0.9, -0.22]].forEach(function (q, k) { const m = part(cr, tint, q[0], q[1], q[2]); m.scale.set(0.8, 1.5 - k * 0.1, 0.8); g.add(m); });
  } else if (kind === 'poison') {   // 毒：身上的膿包、駝背
    [[-0.3, 1.5, 0.15, 0.2], [0.34, 1.0, 0.1, 0.24], [0.1, 1.8, -0.28, 0.18], [-0.2, 0.6, -0.2, 0.22], [0.28, 2.0, 0.05, 0.13]].forEach(function (q) { g.add(part(new THREE.SphereGeometry(q[3], 20, 16), tint, q[0], q[1], q[2])); });
    head.position.set(0, 2.3, 0.18); e1.position.set(-0.13, 2.36, 0.48); e2.position.set(0.13, 2.36, 0.48); mouth.position.set(0, 2.14, 0.49);
  } else {                          // 暗影：破斗篷、尖帽
    const cloak = part(new THREE.ConeGeometry(0.62, 2.3, 9, 1, true), litMat({ color: 0x140a22, emissive: 0x1a0a30, side: THREE.DoubleSide, shininess: 5 }), 0, 1.25, -0.05);
    const hood = part(new THREE.ConeGeometry(0.4, 0.7, 9), litMat({ color: 0x140a22, emissive: 0x1a0a30 }), 0, 3.05, -0.05);
    g.add(cloak, hood);
  }
  // 不再每隻怪掛一盞點光源：光源數一變，所有材質都要重新編譯（手機會頓一下），怪多時每個像素也要多算一盞光
  addOutline(g, col[1], 1.06); addShadow(g, 0.6);
  g.scale.set(1, tall, 1);
  g.visible = false; scene.add(g);
  return { group: g, arms: [a1, a2], x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, chase: false, fresh: true };
}

// 描邊（反面放大的外殼）讓造型輪廓清楚；腳下加一塊圓形陰影
function addOutline(group, color, k) {
  const om = new THREE.MeshBasicMaterial({ color: color, side: THREE.BackSide }), list = [];
  group.traverse(function (o) { if (o.isMesh && !o.material.transparent && o.material.side !== THREE.DoubleSide) list.push(o); });
  list.forEach(function (o) { const sh = new THREE.Mesh(o.geometry, om); sh.scale.setScalar(k); o.add(sh); });
}
let shadowTex = null;
function addShadow(group, r) {
  if (!shadowTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); shadowTex = new THREE.CanvasTexture(cv);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.4, r * 2.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; group.add(m);
}
function pmat(col, em) { return litMat({ color: col, emissive: new THREE.Color(col).multiplyScalar(em == null ? 0.22 : em), shininess: 20 }); }
function part(geo, m, x, y, z) { const o = new THREE.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); return o; }

/** 角色造型（純外觀）。身體用玩家顏色，正面朝 +z。 */
function buildChar(c, slot, h, o, pet) {
  const g = new THREE.Group();
  const M = o && COSTUME_COL[o] ? litMat({ color: COSTUME_COL[o], emissive: new THREE.Color(COSTUME_COL[o]).multiplyScalar(o === 2 ? 0.55 : o === 3 ? 0.3 : 0.12), shininess: o === 3 ? 90 : 20 }) : pmat(COLORS[slot % 4]);
  const dark = new THREE.MeshBasicMaterial({ color: 0x0a0f0c }), glow = new THREE.MeshBasicMaterial({ color: 0xfff0cc });
  const body = function () { return part(new THREE.CylinderGeometry(0.27, 0.25, 0.8, 28), M, 0, 0.99, 0); };   // 上身；腿另外做，走路會擺動
  if (c === 1) {            // 機器人
    const grey = pmat(0x9aa3a8, 0.12), eye = new THREE.BoxGeometry(0.1, 0.08, 0.05);
    g.add(part(new THREE.BoxGeometry(0.56, 0.74, 0.4), M, 0, 0.97, 0), part(new THREE.BoxGeometry(0.46, 0.4, 0.4), grey, 0, 1.58, 0),
      part(eye, glow, -0.11, 1.6, 0.21), part(eye, glow, 0.11, 1.6, 0.21),
      part(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 16), grey, 0, 1.9, 0),
      part(new THREE.SphereGeometry(0.05, 20, 16), new THREE.MeshBasicMaterial({ color: 0xff4a3d }), 0, 2.03, 0),
      part(new THREE.BoxGeometry(0.3, 0.18, 0.02), dark, 0, 0.95, 0.21));
  } else if (c === 2) {     // 太空人
    const white = pmat(0xe8eef2, 0.14);
    g.add(body(), part(new THREE.SphereGeometry(0.33, 32, 28), white, 0, 1.62, 0), part(new THREE.SphereGeometry(0.25, 28, 24), dark, 0, 1.62, 0.13),
      part(new THREE.BoxGeometry(0.4, 0.6, 0.2), white, 0, 0.95, -0.33), part(new THREE.SphereGeometry(0.05, 20, 16), glow, 0.2, 1.25, 0.26));
  } else if (c === 3) {     // 貓貓
    const ear = new THREE.ConeGeometry(0.09, 0.2, 4), eye = new THREE.SphereGeometry(0.04, 20, 16);
    const tail = part(new THREE.CylinderGeometry(0.035, 0.05, 0.7, 16), M, 0, 0.75, -0.42); tail.rotation.x = -0.7;
    g.add(body(), part(new THREE.SphereGeometry(0.27, 28, 24), M, 0, 1.6, 0), part(ear, M, -0.15, 1.9, 0), part(ear, M, 0.15, 1.9, 0),
      part(eye, glow, -0.1, 1.63, 0.24), part(eye, glow, 0.1, 1.63, 0.24), part(new THREE.SphereGeometry(0.03, 20, 16), dark, 0, 1.55, 0.27), tail);
  } else if (c === 4) {     // 南瓜頭
    const head = part(new THREE.SphereGeometry(0.36, 32, 24), pmat(0xff8a1f, 0.4), 0, 1.6, 0); head.scale.y = 0.8;
    const eye = new THREE.ConeGeometry(0.06, 0.1, 3);
    const mouth = part(new THREE.BoxGeometry(0.22, 0.04, 0.03), dark, 0, 1.5, 0.34);
    g.add(part(new THREE.CylinderGeometry(0.2, 0.24, 0.8, 28), M, 0, 0.99, 0), head, part(new THREE.CylinderGeometry(0.03, 0.045, 0.14, 16), pmat(0x4f7a3a, 0.2), 0, 1.93, 0),
      part(eye, dark, -0.12, 1.65, 0.33), part(eye, dark, 0.12, 1.65, 0.33), mouth);
  } else if (c === 6) {     // 恐龍：長吻、牙齒、背棘、尾巴
    const skin = o ? M : pmat(0x4fae5a, 0.25), belly = pmat(0xe8dca0, 0.2), tooth = pmat(0xffffff, 0.3);
    const head = part(new THREE.BoxGeometry(0.4, 0.36, 0.44), skin, 0, 1.62, 0.02), snout = part(new THREE.BoxGeometry(0.3, 0.22, 0.34), skin, 0, 1.55, 0.36);
    const tail = part(new THREE.ConeGeometry(0.15, 0.8, 12), skin, 0, 0.72, -0.5); tail.rotation.x = -1.95;
    g.add(part(new THREE.CylinderGeometry(0.27, 0.27, 0.8, 28), skin, 0, 0.99, 0), part(new THREE.BoxGeometry(0.3, 0.6, 0.06), belly, 0, 0.98, 0.26), head, snout, tail,
      part(new THREE.SphereGeometry(0.05, 20, 16), glow, -0.14, 1.72, 0.2), part(new THREE.SphereGeometry(0.05, 20, 16), glow, 0.14, 1.72, 0.2),
      part(new THREE.SphereGeometry(0.025, 12, 10), dark, -0.14, 1.72, 0.245), part(new THREE.SphereGeometry(0.025, 12, 10), dark, 0.14, 1.72, 0.245));
    for (let k = 0; k < 4; k++) g.add(part(new THREE.ConeGeometry(0.025, 0.07, 6), tooth, -0.1 + k * 0.066, 1.42, 0.5));
    g.children.slice(-4).forEach(function (t) { t.rotation.x = Math.PI; });
    for (let k = 0; k < 4; k++) g.add(part(new THREE.ConeGeometry(0.06, 0.2, 6), pmat(0xff9f3a, 0.35), 0, 1.86 - k * 0.3, -0.2 - (k ? 0.08 : 0)));
  } else if (c === 7) {     // 外星人：大頭、大黑眼、觸角
    const skin = o ? M : pmat(0x9be8c8, 0.3);
    const head = part(new THREE.SphereGeometry(0.33, 32, 24), skin, 0, 1.68, 0); head.scale.set(1, 1.2, 0.95);
    const e1 = part(new THREE.SphereGeometry(0.1, 24, 18), dark, -0.13, 1.66, 0.25), e2 = part(new THREE.SphereGeometry(0.1, 24, 18), dark, 0.13, 1.66, 0.25);
    e1.scale.set(0.8, 1.25, 0.5); e2.scale.set(0.8, 1.25, 0.5); e1.rotation.z = 0.35; e2.rotation.z = -0.35;
    const a1 = part(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), skin, -0.12, 2.14, 0), a2 = part(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), skin, 0.12, 2.14, 0);
    a1.rotation.z = 0.3; a2.rotation.z = -0.3;
    g.add(part(new THREE.CylinderGeometry(0.2, 0.23, 0.8, 28), M, 0, 0.99, 0), head, e1, e2, a1, a2,
      part(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshBasicMaterial({ color: 0x7dffe0 }), -0.16, 2.28, 0), part(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshBasicMaterial({ color: 0x7dffe0 }), 0.16, 2.28, 0),
      part(new THREE.BoxGeometry(0.1, 0.015, 0.02), dark, 0, 1.46, 0.3));
  } else if (c === 5) {     // 紙箱人
    const eye = new THREE.BoxGeometry(0.09, 0.09, 0.03);
    g.add(body(), part(new THREE.BoxGeometry(0.52, 0.5, 0.5), pmat(0xb98a55, 0.18), 0, 1.62, 0), part(eye, dark, -0.12, 1.66, 0.26), part(eye, dark, 0.12, 1.66, 0.26),
      part(new THREE.BoxGeometry(0.52, 0.03, 0.08), pmat(0x8a6238, 0.15), 0, 1.88, 0));
  } else {                  // 回收員
    g.add(body(), part(new THREE.SphereGeometry(0.24, 28, 24), M, 0, 1.6, 0), part(new THREE.BoxGeometry(0.34, 0.12, 0.1), dark, 0, 1.63, 0.2),
      part(new THREE.SphereGeometry(0.035, 20, 16), glow, -0.08, 1.63, 0.25), part(new THREE.SphereGeometry(0.035, 20, 16), glow, 0.08, 1.63, 0.25),
      part(new THREE.SphereGeometry(0.25, 28, 24, 0, Math.PI * 2, 0, Math.PI / 2.4), pmat(0xffc928, 0.3), 0, 1.66, 0),
      part(new THREE.SphereGeometry(0.05, 20, 16), glow, 0.2, 1.25, 0.26));
  }
  // 手腳（以肩膀／腳踝為軸，走路時擺動）
  const sx = c === 1 ? 0.34 : 0.33, limb = c === 1 ? pmat(0x9aa3a8, 0.12) : o ? M : pmat(c === 6 ? 0x4fae5a : c === 7 ? 0x9be8c8 : COLORS[slot % 4], 0.12), shoe = pmat(0x1c2220, 0.05);
  const mkArm = function (x) { const pv = new THREE.Group(); pv.position.set(x, 1.22, 0); pv.add(part(new THREE.CylinderGeometry(0.07, 0.06, 0.62, 16), limb, 0, -0.3, 0), part(new THREE.SphereGeometry(0.08, 20, 16), pmat(0xf1e6d6, 0.2), 0, -0.63, 0)); return pv; };
  const pants = pmat(c === 1 ? 0x7d868c : 0x27313c, 0.1);
  const mkFoot = function (x) { const pv = new THREE.Group(); pv.position.set(x, 0.64, 0); pv.add(part(new THREE.CylinderGeometry(0.105, 0.09, 0.56, 16), pants, 0, -0.28, 0), part(new THREE.BoxGeometry(0.18, 0.12, 0.32), shoe, 0, -0.58, 0.06)); return pv; };
  const aL = mkArm(-sx), aR = mkArm(sx), fL = mkFoot(-0.13), fR = mkFoot(0.13);
  aR.rotation.x = -0.45;   // 右手往前握著攻擊物
  g.add(aL, aR, fL, fR);
  g.userData.limbs = [aL, aR, fL, fR];
  if (c !== 1) {   // 細節：腰帶、領口、肩膀圓角
    const trim = pmat(0x1c2220, 0.05);
    const belt = part(new THREE.TorusGeometry(c === 4 ? 0.235 : 0.25, 0.035, 12, 36), trim, 0, 0.62, 0); belt.rotation.x = Math.PI / 2;
    const buckle = part(new THREE.BoxGeometry(0.1, 0.08, 0.03), pmat(0xffd24a, 0.4), 0, 0.62, c === 4 ? 0.26 : 0.275);
    const collar = part(new THREE.TorusGeometry(0.2, 0.045, 12, 36), M, 0, 1.36, 0); collar.rotation.x = Math.PI / 2;
    g.add(belt, buckle, collar, part(new THREE.SphereGeometry(0.1, 20, 16), limb, -sx, 1.24, 0), part(new THREE.SphereGeometry(0.1, 20, 16), limb, sx, 1.24, 0));
  }
  const hat = buildHat(h || 0); if (hat) { hat.position.y = [1.84, 1.78, 1.95, 1.87, 1.89, 1.9, 1.84, 2.08][c] || 1.84; if (c === 1) hat.position.x = 0.14; g.add(hat); }
  addOutline(g, 0x05080a, 1.07); addShadow(g, 0.42);
  const pm = buildPet(pet || 0); if (pm) { pm.position.set(-0.75, 0, -0.25); g.add(pm); g.userData.pet = pm; }
  return g;
}
/** 寵物：1 小狗、2 貓頭鷹（會飄）、3 小機器人、4 史萊姆 */
function buildPet(k) {
  if (!k) return null;
  const g = new THREE.Group(), dark = new THREE.MeshBasicMaterial({ color: 0x0a0f0c });
  if (k === 1) {
    const fur = pmat(0xc98a4a, 0.2), ear = pmat(0x7a4a22, 0.15);
    const tail = part(new THREE.CylinderGeometry(0.025, 0.02, 0.2, 8), fur, 0, 0.36, -0.26); tail.rotation.x = -0.7;
    g.add(part(new THREE.BoxGeometry(0.22, 0.2, 0.4), fur, 0, 0.24, 0), part(new THREE.SphereGeometry(0.14, 20, 16), fur, 0, 0.42, 0.22), part(new THREE.BoxGeometry(0.1, 0.08, 0.1), fur, 0, 0.38, 0.34),
      part(new THREE.BoxGeometry(0.05, 0.12, 0.04), ear, -0.11, 0.48, 0.2), part(new THREE.BoxGeometry(0.05, 0.12, 0.04), ear, 0.11, 0.48, 0.2), tail,
      part(new THREE.SphereGeometry(0.02, 10, 8), dark, -0.05, 0.45, 0.34), part(new THREE.SphereGeometry(0.02, 10, 8), dark, 0.05, 0.45, 0.34), part(new THREE.SphereGeometry(0.025, 10, 8), dark, 0, 0.4, 0.4));
    [[-0.08, 0.14], [0.08, 0.14], [-0.08, -0.14], [0.08, -0.14]].forEach(function (q) { g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), fur, q[0], 0.08, q[1])); });
  } else if (k === 2) {
    const fe = pmat(0x8a6a4a, 0.2), eye = new THREE.MeshBasicMaterial({ color: 0xffe07a });
    const b = part(new THREE.SphereGeometry(0.17, 24, 18), fe, 0, 1.25, 0); b.scale.y = 1.25;
    const w1 = part(new THREE.BoxGeometry(0.05, 0.24, 0.16), fe, -0.19, 1.25, 0), w2 = part(new THREE.BoxGeometry(0.05, 0.24, 0.16), fe, 0.19, 1.25, 0);
    g.add(b, w1, w2, part(new THREE.SphereGeometry(0.055, 16, 12), eye, -0.07, 1.32, 0.14), part(new THREE.SphereGeometry(0.055, 16, 12), eye, 0.07, 1.32, 0.14),
      part(new THREE.SphereGeometry(0.022, 10, 8), dark, -0.07, 1.32, 0.19), part(new THREE.SphereGeometry(0.022, 10, 8), dark, 0.07, 1.32, 0.19), part(new THREE.ConeGeometry(0.03, 0.07, 6), pmat(0xffa53a, 0.4), 0, 1.25, 0.18));
    g.children[7].rotation.x = Math.PI / 2; g.userData.fly = true;
  } else if (k === 3) {
    const met = pmat(0xaab4bd, 0.15);
    g.add(part(new THREE.BoxGeometry(0.28, 0.26, 0.24), met, 0, 0.32, 0), part(new THREE.BoxGeometry(0.2, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0x6ad8ff }), 0, 0.35, 0.125),
      part(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 6), met, 0, 0.52, 0), part(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a5a }), 0, 0.6, 0),
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14), pmat(0x22262b, 0.05), -0.16, 0.1, 0), part(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14), pmat(0x22262b, 0.05), 0.16, 0.1, 0));
    g.children[4].rotation.z = Math.PI / 2; g.children[5].rotation.z = Math.PI / 2;
  } else {
    const b = part(new THREE.SphereGeometry(0.22, 24, 18), litMat({ color: 0x6ad8ff, emissive: 0x1a4a7a, shininess: 90, transparent: true, opacity: 0.85 }), 0, 0.17, 0); b.scale.y = 0.75;
    g.add(b, part(new THREE.SphereGeometry(0.03, 10, 8), dark, -0.07, 0.22, 0.18), part(new THREE.SphereGeometry(0.03, 10, 8), dark, 0.07, 0.22, 0.18));
  }
  addShadow(g, k === 2 ? 0.16 : 0.2);
  return g;
}
/** 頭飾（純外觀）：1 安全帽、2 頭燈、3 天線、4 光環、5 皇冠 */
function buildHat(h) {
  if (!h) return null;
  const g = new THREE.Group();
  if (h === 1) {
    const dome = part(new THREE.SphereGeometry(0.29, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), pmat(0xffc928, 0.3), 0, -0.1, 0);
    g.add(dome, part(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 32), pmat(0xffc928, 0.3), 0, -0.09, 0.04));
  } else if (h === 2) {
    g.add(part(new THREE.TorusGeometry(0.25, 0.025, 12, 36), pmat(0x30363a, 0.1), 0, -0.14, 0), part(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 20), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }), 0, -0.14, 0.26));
    g.children[0].rotation.x = Math.PI / 2; g.children[1].rotation.x = Math.PI / 2;
  } else if (h === 3) {
    g.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.38, 16), pmat(0xb8c0c4, 0.2), 0, 0.17, 0), part(new THREE.SphereGeometry(0.05, 20, 16), new THREE.MeshBasicMaterial({ color: 0x7dffb0 }), 0, 0.38, 0));
  } else if (h === 4) {
    const r = part(new THREE.TorusGeometry(0.2, 0.025, 12, 36), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }), 0, 0.18, 0); r.rotation.x = Math.PI / 2; g.add(r);
  } else {
    const gold = pmat(0xffd24a, 0.45);
    g.add(part(new THREE.CylinderGeometry(0.2, 0.18, 0.1, 24, 1, true), gold, 0, 0.0, 0));
    for (let k = 0; k < 6; k++) g.add(part(new THREE.ConeGeometry(0.045, 0.13, 4), gold, Math.cos(k * 1.047) * 0.19, 0.1, Math.sin(k * 1.047) * 0.19));
  }
  return g;
}

/** 攻擊物造型（純外觀，傷害相同）。握把在原點，往 +y 延伸。 */
function buildWeapon(w) {
  const g = new THREE.Group();
  const steel = litMat({ color: 0x8a8f93, shininess: 60, emissive: 0x15171a });
  if (w === 1) {            // 扳手
    g.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 8), steel, 0, 0.25, 0), part(new THREE.BoxGeometry(0.15, 0.13, 0.04), steel, 0, 0.6, 0),
      part(new THREE.BoxGeometry(0.06, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0x050505 }), 0, 0.64, 0));
  } else if (w === 2) {     // 球棒
    g.add(part(new THREE.CylinderGeometry(0.055, 0.025, 0.8, 10), pmat(0xb07a45, 0.15), 0, 0.33, 0));
  } else if (w === 3) {     // 平底鍋
    const pan = part(new THREE.CylinderGeometry(0.2, 0.18, 0.04, 18), pmat(0x2f3338, 0.2), 0, 0.55, 0); pan.rotation.x = Math.PI / 2;
    g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), pmat(0x1c1e21, 0.2), 0, 0.15, 0), pan);
  } else if (w === 4) {     // 雨傘
    g.add(part(new THREE.CylinderGeometry(0.014, 0.014, 0.9, 6), steel, 0, 0.36, 0), part(new THREE.ConeGeometry(0.075, 0.55, 10), pmat(0xff7eb6, 0.3), 0, 0.5, 0),
      part(new THREE.SphereGeometry(0.03, 8, 8), pmat(0x3a2a1c, 0.2), 0, -0.1, 0));
  } else if (w === 5) {     // 鹹魚
    const fb = part(new THREE.SphereGeometry(1, 12, 10), pmat(0x9fb7c9, 0.2), 0, 0.42, 0); fb.scale.set(0.1, 0.32, 0.045);
    const tail = part(new THREE.ConeGeometry(0.1, 0.16, 4), pmat(0x7f97a9, 0.2), 0, 0.06, 0); tail.scale.z = 0.3;
    g.add(fb, tail, part(new THREE.SphereGeometry(0.018, 6, 6), new THREE.MeshBasicMaterial({ color: 0x050505 }), 0.03, 0.62, 0.04));
  } else {                  // 鐵管
    g.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 8), steel, 0, 0.3, 0));
  }
  return g;
}

function buildAvatar(p) {
  const g = buildChar(p.c || 0, p.slot, p.h || 0, p.o || 0, p.pet || 0);
  const wg = buildWeapon(p.w || 0); wg.position.set(0.37, 0.67, 0.3); wg.rotation.x = 0.5; g.add(wg);   // 握在右手上
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(p.name, 128, 32);
  c.fillStyle = CSSCOL[p.slot % 4]; c.fillText(p.name, 128, 32);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  label.scale.set(1.7, 0.42, 1); label.position.y = 2.3;
  const talk = part(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 2.62, 0); talk.visible = false;
  g.add(label, talk);
  g.userData.talk = talk; g.userData.weapon = wg;
  scene.add(g);
  return g;
}

let viewW = -1;
function setViewWeapon(w) {
  if (w === viewW && pipe) return;
  if (pipe) camera.remove(pipe);
  pipe = buildWeapon(w); viewW = w;
  pipe.position.set(0.32, -0.42, -0.55); pipe.rotation.set(-0.5, 0, -0.25);
  camera.add(pipe);
  if (renderer) resize();
}
// 開槍（電腦 X 或滑鼠右鍵、手機「槍」）：實際命中由房主判定
let gunT = 0, gunMesh = null;
function shoot() {
  if (!canControl() || gunT > 0) return;
  if (me.riding) { toast('在推車上不能開槍'); return; }
  gunT = 0.22;
  if (RR.Game.onShoot) RR.Game.onShoot(Math.round(me.yaw * 100) / 100);
}
let zoneMesh = null, outT = 0;
/* ---------- 天氣、災害、載具 ---------- */
let baseLight = null, rain = null, quakeT = 0, vhQ = false, cartMesh = null, cartView = null;
const rings = [];   // 落石警示圈
function applyWeather(w) {
  view.weather = w | 0;
  const b = baseLight; if (!b) return;
  const fogK = [1, 1.6, b.open ? 5 : 3.2, 1.3, b.open ? 4.5 : 2.4][view.weather], lightK = [1, 0.8, 0.85, 0.32, 0.75][view.weather];
  scene.fog.density = b.fog * fogK;
  const fc = view.weather === 4 ? (b.open ? 0xb58a5a : 0x3a2f28) : view.weather === 2 ? (b.open ? 0xc4ccd4 : 0x4a5258) : view.weather === 1 ? 0x6f7f90 : b.fogC;
  scene.fog.color.setHex(fc); scene.background.setHex(fc);
  if (ambient) ambient.intensity = b.amb * lightK; if (hemi) hemi.intensity = b.hemi * lightK; if (sun) sun.intensity = b.sun * (view.weather ? 0.45 : 1);
  torchBase = view.weather === 3 ? Math.max(b.torch, 2.4) : b.torch;
  if (rain) { camera.remove(rain); rain.geometry.dispose(); rain.material.dispose(); rain = null; }
  if (view.weather === 1 || view.weather === 4) {
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = (Math.random() - 0.5) * 9; pos[i * 3 + 2] = -Math.random() * 14; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.Points(g, new THREE.PointsMaterial({ color: view.weather === 1 ? 0xbfd8f0 : 0xd9b98a, size: view.weather === 1 ? 0.05 : 0.07, transparent: true, opacity: 0.75, fog: false }));
    camera.add(rain);
  }
  const chip = $('wx'); chip.textContent = view.weather ? W.WEATHERS[view.weather] : ''; chip.classList.toggle('hide', !view.weather);
}
function tickWeather(dt) {
  if (rain) {
    const a = rain.geometry.attributes.position, storm = view.weather === 4;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) - (storm ? 2 : 13) * dt, x = a.getX(i) + (storm ? 9 : 0.6) * dt;
      if (y < -4.5) y += 9; if (x > 8) x -= 16;
      a.setY(i, y); a.setX(i, x);
    }
    a.needsUpdate = true;
    if (Math.random() < dt * 5) Sfx.noise(0.25, storm ? 0.035 : 0.022);
  }
  if (quakeT > 0) { quakeT -= dt; shakeT = Math.max(shakeT, 0.25); if (Math.random() < dt * 6) Sfx.tone(46 + Math.random() * 14, 0.3, 'sawtooth', 0.12, 34); }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t -= dt; const k = 1 + Math.sin(Date.now() / 90) * 0.12; r.mesh.scale.set(k, k, k); r.mesh.material.opacity = 0.45 + Math.sin(Date.now() / 90) * 0.25;
    if (r.t <= -0.3) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); rings.splice(i, 1); }
  }
}
function showBoom(x, z) {
  const m = part(new THREE.SphereGeometry(0.6, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.9, fog: false }), x, 0.8, z);
  const rock = part(new THREE.DodecahedronGeometry(0.55, 0), litMat({ color: 0x5a4a40, emissive: 0x301808 }), x, 0.4, z);
  scene.add(m, rock);
  const t0 = Date.now(), id = setInterval(function () {
    const k = (Date.now() - t0) / 500; m.scale.setScalar(1 + k * 3.5); m.material.opacity = Math.max(0, 0.9 - k);
    if (k >= 1) { clearInterval(id); scene.remove(m); m.geometry.dispose(); m.material.dispose(); setTimeout(function () { scene.remove(rock); rock.geometry.dispose(); rock.material.dispose(); }, 8000); }
  }, 30);
  const d = Math.hypot(x - me.x, z - me.z);
  Sfx.noise(0.5, Math.max(0.05, 0.4 - d * 0.02)); Sfx.tone(90, 0.5, 'sawtooth', Math.max(0.03, 0.25 - d * 0.012), 40);
  if (d < 10) shakeT = Math.max(shakeT, 0.5 - d * 0.04);
}
function buildCart() {
  const g = new THREE.Group(), body = pmat(0xd9902f, 0.25), dark = pmat(0x1c2026, 0.05), steel = pmat(0x9aa3a8, 0.15);
  g.add(part(new THREE.BoxGeometry(0.8, 0.45, 1.1), body, 0, 0.5, 0), part(new THREE.BoxGeometry(0.7, 0.05, 1.0), dark, 0, 0.74, 0),
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), steel, -0.3, 0.95, -0.55), part(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), steel, 0.3, 0.95, -0.55), part(new THREE.CylinderGeometry(0.025, 0.025, 0.66, 8), steel, 0, 1.3, -0.55));
  g.children[4].rotation.z = Math.PI / 2;
  [[-0.42, 0.38], [0.42, 0.38], [-0.42, -0.38], [0.42, -0.38]].forEach(function (q) { const w = part(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), dark, q[0], 0.16, q[1]); w.rotation.z = Math.PI / 2; g.add(w); });
  addShadow(g, 0.7);
  return g;
}
// 塔防：砲塔模型與射擊
const towerMeshes = [];
function syncTowers(list) {
  list = list || [];
  while (towerMeshes.length > list.length) scene.remove(towerMeshes.pop());
  for (let i = towerMeshes.length; i < list.length; i++) {
    const g = new THREE.Group(), base = pmat(0x4a5360, 0.1), gold = pmat(0xffc24a, 0.45);
    const head = new THREE.Group(); head.position.y = 1.05;
    head.add(part(new THREE.BoxGeometry(0.42, 0.3, 0.5), gold, 0, 0, 0), part(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 12), base, 0, 0.02, 0.5));
    head.children[1].rotation.x = Math.PI / 2;
    g.add(part(new THREE.CylinderGeometry(0.42, 0.55, 0.3, 20), base, 0, 0.15, 0), part(new THREE.CylinderGeometry(0.14, 0.18, 0.75, 16), base, 0, 0.65, 0), head);
    g.userData.head = head; addOutline(g, 0x05080a, 1.06); addShadow(g, 0.6);
    g.position.set(list[i][0], 0, list[i][1]); scene.add(g); towerMeshes.push(g);
  }
}
function showTowerShot(e) {
  const tm = towerMeshes.find(function (t) { return Math.hypot(t.position.x - e.x, t.position.z - e.z) < 0.5; });
  if (tm) tm.userData.head.rotation.y = Math.atan2(e.hx - e.x, e.hz - e.z);
  showShot({ id: null, x: e.x, z: e.z, hx: e.hx, hz: e.hz, mi: e.mi, ty: 1.1 });
}
function showShot(e) {
  const mine = e.id === myId, sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  const from = mine ? new THREE.Vector3(me.x - sy * 0.5 + cy * 0.22, 1.42 + me.y, me.z - cy * 0.5 - sy * 0.22) : new THREE.Vector3(e.x, e.ty || 1.25, e.z);
  const to = new THREE.Vector3(e.hx, e.mi >= 0 ? 1.7 : 1.4, e.hz);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color: mine ? FX_COL[RR.Game.settings.fx | 0] || 0xfff1b0 : 0xfff1b0, transparent: true, opacity: 0.95, fog: false }));
  const spark = part(new THREE.SphereGeometry(e.mi >= 0 ? 0.28 : 0.12, 10, 8), new THREE.MeshBasicMaterial({ color: e.mi >= 0 ? 0xff8a3a : 0xfff1b0, transparent: true, opacity: 0.9, fog: false }), to.x, to.y, to.z);
  scene.add(line, spark);
  const t0 = Date.now(), id = setInterval(function () {
    const k = (Date.now() - t0) / 160; line.material.opacity = Math.max(0, 0.95 - k); spark.material.opacity = Math.max(0, 0.9 - k); spark.scale.setScalar(1 + k * 1.5);
    if (k >= 1) { clearInterval(id); scene.remove(line, spark); line.geometry.dispose(); line.material.dispose(); spark.geometry.dispose(); spark.material.dispose(); }
  }, 30);
  const d = Math.hypot(e.x - me.x, e.z - me.z), v = mine ? 0.22 : Math.max(0.03, 0.2 - d * 0.006);
  Sfx.noise(0.09, v); Sfx.tone(520, 0.07, 'square', v * 0.6, 140);
  if (mine) { shakeT = Math.max(shakeT, 0.07); if (gunMesh) gunMesh.userData.kick = 1; me.ammo = e.ammo; }
  if (e.mi >= 0 && view.monsters[e.mi]) view.monsters[e.mi].hitT = 0.18;
}
function isTouchDev() { return ('ontouchstart' in window) || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
// 畫質依「短邊像素」決定：high = 1080、mid = 720、low = 480（不超過螢幕本身的倍率）。太卡時自動降一級。
let quality = 'high', fpsT = 0, fpsN = 0, slowN = 0;
function applyQuality() {
  if (!renderer) return;
  const short = Math.max(1, Math.min(window.innerWidth, window.innerHeight));
  const target = quality === 'low' ? 480 : quality === 'mid' ? 720 : 1080;
  renderer.setPixelRatio(Math.max(0.75, Math.min(window.devicePixelRatio || 1, target / short)));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
function fpsWatch(dt) {
  fpsT += dt; fpsN++;
  if (fpsT < 2) return;
  const fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
  if (settings.showFps) {
    let el = document.getElementById('fpsBox');
    if (!el) { el = document.createElement('div'); el.id = 'fpsBox'; document.body.appendChild(el); }
    const c = renderer.domElement; el.style.display = active ? '' : 'none';
    el.textContent = Math.round(fps) + ' FPS  ' + c.width + '×' + c.height;
  } else { const el = document.getElementById('fpsBox'); if (el) el.style.display = 'none'; }
  if (!active || document.hidden) { slowN = 0; return; }
  slowN = fps < 28 ? slowN + 1 : 0;
  if (slowN >= 2 && quality !== 'low' && RR.Game.settings.autoQ !== false) {
    slowN = 0; quality = quality === 'high' ? 'mid' : 'low'; applyQuality();
    toast('畫面有點卡，已自動降低畫質（可在設定調回）'); if (RR.Game.onQuality) RR.Game.onQuality(quality);
  }
}
/* ---------- 手機按鈕：位置與大小可自訂（直式、橫式各存一份） ---------- */
const BTN = { bomb: [154, 314, 58], tower: [244, 296, 58], veh: [244, 218, 58], run: [64, 84, 76], atk: [154, 66, 64], gun: [154, 150, 58], rescue: [154, 232, 58], jump: [58, 184, 58], dash: [58, 266, 58], skill: [244, 62, 58], smoke: [244, 140, 58] };   // [離右邊, 離底部, 直徑]
// 橫式：畫面矮，改成 4 欄 × 3 列，避免按鍵疊到上方的資訊和按鈕
const BTN_L = { run: [62, 68, 76], atk: [150, 60, 64], gun: [150, 136, 58], rescue: [150, 212, 58], jump: [58, 154, 58], dash: [58, 226, 58],
  skill: [232, 56, 58], smoke: [232, 134, 58], bomb: [232, 212, 58], tower: [314, 56, 58], veh: [314, 134, 58] };
function btnMap() { return window.innerWidth > window.innerHeight ? BTN_L : BTN; }
// 按鍵區太高、畫面放不下時自動縮小（上方留 84px 給資訊列）
function fitScale(map) {
  let ext = 0; Object.keys(map).forEach(function (k) { ext = Math.max(ext, map[k][1] + map[k][2] / 2); });
  return Math.max(0.6, Math.min(1, (window.innerHeight - 84) / (ext * btnScale)));
}
let btnScale = 1, dragBtn = null;
function layoutKey() { return 'rr_layout_' + (window.innerWidth > window.innerHeight ? 'l' : 'p'); }
function loadLayout() { try { return JSON.parse(localStorage.getItem(layoutKey()) || 'null') || {}; } catch (e) { return {}; } }
function layoutButtons() {
  const Wv = window.innerWidth, Hv = window.innerHeight, saved = loadLayout(), map = btnMap(), k = btnScale * fitScale(map);
  Object.keys(map).forEach(function (id) {
    const el = $(id), d = map[id], size = d[2] * k, sv = saved[id];
    let cx = sv ? sv[0] * Wv : Wv - d[0] * k, cy = sv ? sv[1] * Hv : Hv - d[1] * k;
    cx = Math.max(size / 2, Math.min(Wv - size / 2, cx)); cy = Math.max(size / 2, Math.min(Hv - size / 2, cy));
    el.style.width = el.style.height = size + 'px'; el.style.fontSize = Math.round(size * 0.29) + 'px';
    el.style.left = (cx - size / 2) + 'px'; el.style.top = (cy - size / 2) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  });
}
function setEditing(on) {
  editing = on; document.body.classList.toggle('btnedit', on); $('btnEdit').classList.toggle('hide', !on);
  if (on) { for (const k in keys) keys[k] = false; touch.run = false; layoutButtons(); }
}
function initLayout() {
  Object.keys(BTN).forEach(function (id) {
    const el = $(id);
    el.addEventListener('pointerdown', function (e) {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation(); dragBtn = { id: id, el: el };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }, true);
    el.addEventListener('pointermove', function (e) {
      if (!editing || !dragBtn || dragBtn.id !== id) return;
      const size = el.offsetWidth;
      el.style.left = Math.max(0, Math.min(window.innerWidth - size, e.clientX - size / 2)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - size, e.clientY - size / 2)) + 'px';
    });
    const drop = function (e) {
      if (!dragBtn || dragBtn.id !== id) return;
      dragBtn = null;
      const size = el.offsetWidth, saved = loadLayout();
      saved[id] = [(parseFloat(el.style.left) + size / 2) / window.innerWidth, (parseFloat(el.style.top) + size / 2) / window.innerHeight];
      try { localStorage.setItem(layoutKey(), JSON.stringify(saved)); } catch (err) {}
    };
    el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
  });
  $('btnEditDone').addEventListener('click', function () { setEditing(false); });
  $('btnEditReset').addEventListener('click', function () { try { localStorage.removeItem(layoutKey()); } catch (e) {} layoutButtons(); });
  window.addEventListener('resize', layoutButtons);
  layoutButtons();
}
function attack() {
  if (!canControl() || atkT > 0) return;
  if (me.riding) return;
  atkT = 0.7; swingT = 0.28;
  Sfx.noise(0.12, 0.1);
  if (RR.Game.onAttack) RR.Game.onAttack(Math.round(me.yaw * 100) / 100);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (pipe) pipe.position.x = Math.min(0.32, 0.422 * (w / h) * 0.7);   // 直式螢幕把鐵管往內收，才看得到
}

/* ---------- 輸入 ---------- */
function lockPointer() {
  if (document.body.classList.contains('touch')) return;
  try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
}
function look(dx, dy, k) {
  me.yaw -= dx * k * settings.sens;
  me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch - dy * k * settings.sens));
}
function nextSpec() {
  const ids = []; view.players.forEach(function (p) { if (p.id !== myId && p.alive) ids.push(p.id); });
  if (!ids.length) { specId = null; return; }
  specId = ids[(ids.indexOf(specId) + 1) % ids.length];
}
function releaseTouch() {
  touch.joyId = touch.lookId = null; touch.jx = touch.jy = 0; touch.run = false;
  $('joy').style.display = $('knob').style.display = 'none'; $('run').classList.remove('on');
}
function bindInput() {
  window.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    keys[e.code] = true;
    if (canControl() && e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (active && e.code === 'KeyM') RR.Game.toggleMic();
    if (e.code === 'KeyQ' && !e.repeat) trySmoke();
    if (e.code === 'KeyR' && !e.repeat) trySkill();
    if (e.code === 'KeyG' && !e.repeat && canControl() && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) { if ($('scrMini').classList.contains('hide')) openMini(); else closeMini(); }
    if (e.code === 'KeyF') { if (canControl()) { e.preventDefault(); attack(); } }
    if (e.code === 'Space') { if (canControl()) { e.preventDefault(); if (!e.repeat) jumpQ = true; } }
    if (e.code === 'KeyC' && !e.repeat && canControl()) dashQ = true;
    if (e.code === 'KeyX' && canControl()) shoot();
    if (e.code === 'KeyB' && !e.repeat && canControl() && RR.Game.onBomb) RR.Game.onBomb(Math.round(me.yaw * 100) / 100);
    if (e.code === 'KeyT' && !e.repeat && canControl() && view.mode === 'td' && RR.Game.onTower) RR.Game.onTower();
    if (e.code === 'KeyV' && !e.repeat && canControl()) vhQ = true;
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { for (const k in keys) keys[k] = false; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (ev) {
    if (active && view.phase === 'play' && !me.alive) { nextSpec(); return; }
    if (!canControl()) return;
    if (ev.button === 2) { shoot(); return; }
    dragging = true;
    if (document.pointerLockElement !== canvas) lockPointer(); else attack();   // 鎖定滑鼠後，左鍵 = 揮擊
  });
  window.addEventListener('mouseup', function () { dragging = false; });
  window.addEventListener('mousemove', function (e) {
    if (!canControl()) return;
    if (document.pointerLockElement === canvas || dragging) look(e.movementX || 0, e.movementY || 0, 0.0024);
  });
  const enableTouch = function () { document.body.classList.add('touch'); };
  if (('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) enableTouch();
  window.addEventListener('touchstart', enableTouch, { passive: true });
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (active && view.phase === 'play' && !me.alive) { nextSpec(); return; }
    if (!canControl()) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < window.innerWidth / 2 && touch.joyId === null) {
        touch.joyId = t.identifier; touch.ox = t.clientX; touch.oy = t.clientY; touch.jx = touch.jy = 0;
        const j = $('joy'), k = $('knob');
        j.style.left = k.style.left = t.clientX + 'px'; j.style.top = k.style.top = t.clientY + 'px';
        j.style.display = k.style.display = 'block';
      } else if (touch.lookId === null) { touch.lookId = t.identifier; touch.lx = t.clientX; touch.ly = t.clientY; }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touch.joyId) {
        let dx = t.clientX - touch.ox, dy = t.clientY - touch.oy;
        const d = Math.hypot(dx, dy), R = 50;
        if (d > R) { dx *= R / d; dy *= R / d; }
        touch.jx = dx / R; touch.jy = dy / R;
        $('knob').style.left = (touch.ox + dx) + 'px'; $('knob').style.top = (touch.oy + dy) + 'px';
      } else if (t.identifier === touch.lookId) {
        if (canControl()) look(t.clientX - touch.lx, t.clientY - touch.ly, 0.006);
        touch.lx = t.clientX; touch.ly = t.clientY;
      }
    }
  }, { passive: false });
  const touchEnd = function (e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touch.joyId) { touch.joyId = null; touch.jx = touch.jy = 0; $('joy').style.display = $('knob').style.display = 'none'; }
      if (t.identifier === touch.lookId) touch.lookId = null;
    }
  };
  canvas.addEventListener('touchend', touchEnd); canvas.addEventListener('touchcancel', touchEnd);
  const runBtn = $('run');
  runBtn.addEventListener('touchstart', function (e) { e.preventDefault(); touch.run = true; runBtn.classList.add('on'); }, { passive: false });
  const runOff = function (e) { e.preventDefault(); touch.run = false; runBtn.classList.remove('on'); };
  runBtn.addEventListener('touchend', runOff, { passive: false }); runBtn.addEventListener('touchcancel', runOff, { passive: false });
  runBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  $('micBtn').addEventListener('click', function () { RR.Game.toggleMic(); });
  $('mini').addEventListener('click', function () { $('mini').classList.toggle('big'); });
  [['jump', function () { jumpQ = true; }], ['dash', function () { dashQ = true; }], ['gun', shoot], ['bomb', function () { if (RR.Game.onBomb) RR.Game.onBomb(Math.round(me.yaw * 100) / 100); }], ['veh', function () { vhQ = true; }], ['tower', function () { if (view.mode === 'td' && RR.Game.onTower) RR.Game.onTower(); }]].forEach(function (q) {
    const b = $(q[0]);
    b.addEventListener('touchstart', function (e) { e.preventDefault(); if (canControl()) q[1](); }, { passive: false });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  const atkBtn = $('atk');
  atkBtn.addEventListener('touchstart', function (e) { e.preventDefault(); attack(); }, { passive: false });
  atkBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // 手機：救援（按住）與煙霧彈（按一下）
  const rescueBtn = $('rescue');
  const rescueOff = function (e) { e.preventDefault(); keys.KeyE = false; rescueBtn.classList.remove('on'); };
  rescueBtn.addEventListener('touchstart', function (e) { e.preventDefault(); keys.KeyE = true; rescueBtn.classList.add('on'); }, { passive: false });
  rescueBtn.addEventListener('touchend', rescueOff, { passive: false }); rescueBtn.addEventListener('touchcancel', rescueOff, { passive: false });
  rescueBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  const smokeBtn = $('smoke');
  smokeBtn.addEventListener('touchstart', function (e) { e.preventDefault(); trySmoke(); }, { passive: false });
  smokeBtn.addEventListener('click', trySmoke);
  smokeBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  const skillBtn = $('skill');
  skillBtn.addEventListener('touchstart', function (e) { e.preventDefault(); trySkill(); }, { passive: false });
  skillBtn.addEventListener('click', trySkill);
  skillBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  initMini(); initLayout();
}

/* ---------- 每幀更新 ---------- */
function updateMe(dt) {
  if (keys.ArrowLeft) me.yaw += 2.2 * dt;
  if (keys.ArrowRight) me.yaw -= 2.2 * dt;
  let f = 0, s = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD) s += 1;
  if (keys.KeyA) s -= 1;
  f -= touch.jy; s += touch.jx;
  let mag = Math.hypot(f, s);
  if (mag > 1) { f /= mag; s /= mag; mag = 1; }
  const moving = mag > 0.15;
  const wantRun = (keys.ShiftLeft || keys.ShiftRight || touch.run) && moving && !me.tired && !me.riding;
  if (wantRun) { me.stam -= 0.15 * (1 - 0.05 * myGem(1)) * dt; if (me.stam <= 0) { me.stam = 0; me.tired = true; } }
  else { me.stam = Math.min(1, me.stam + 0.28 * (myPet() === 4 ? 1.2 : 1) * (myC() === 7 ? 1.15 : 1) * dt); if (me.tired && me.stam > 0.2) me.tired = false; }
  if (me.rallyT > 0) me.rallyT -= dt;
  const speed0 = (wantRun ? 9.0 : 4.2) * (me.bagN ? 1 - 0.07 * me.bagN : 1.05) * CHAR_SPEED[myC()] * (myPet() === 1 ? 1.05 : 1) * (myEq(1) ? 1.06 : 1) * (iceNear() ? 0.75 : 1) * (me.rallyT > 0 ? 1.2 : 1);   // 靠近藍色（冰）怪物減速 25%
  const speed = (me.riding ? 11.5 * (iceNear() ? 0.75 : 1) : speed0) * (quakeT > 0 ? 0.6 : 1);   // 推車：固定高速、不受背包影響；地震時變慢
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  // 跳：耗 18% 體力，在空中時怪物抓不到；衝刺：往移動方向（沒動就往前）瞬間衝約 4 公尺，耗 25% 體力，冷卻 2.5 秒
  if (me.riding) { jumpQ = false; dashQ = false; }   // 推車上不能跳、衝
  if (jumpQ) { jumpQ = false; if (me.y <= 0 && !me.tired && me.stam >= 0.18) { me.vy = 5.6; me.y = 0.001; me.stam -= 0.18; Sfx.tone(300, 0.12, 'triangle', 0.08, 520); } }
  if (me.y > 0) { me.vy -= 15 * dt; me.y += me.vy * dt; if (me.y <= 0) { me.y = 0; me.vy = 0; Sfx.noise(0.05, 0.06); } }
  if (dashCd > 0) dashCd -= dt;
  if (dashQ) { dashQ = false; if (dashCd <= 0 && !me.tired && me.stam >= 0.25) {
    const df = moving ? f / mag : 1, ds = moving ? s / mag : 0;
    dashDir = [-sy * df + cy * ds, -cy * df - sy * ds]; dashT = 0.18; dashCd = 2.5; me.stam -= 0.25; Sfx.noise(0.14, 0.12); Sfx.tone(520, 0.14, 'sawtooth', 0.05, 180);
  } else if (dashCd > 0) toast('衝刺冷卻中'); }
  let dx = (-sy * f + cy * s) * speed * dt, dz = (-cy * f - sy * s) * speed * dt;
  if (dashT > 0) { dashT -= dt; dx += dashDir[0] * 22 * dt; dz += dashDir[1] * 22 * dt; }
  const R = 0.42;
  if (editing) { dx = 0; dz = 0; }   // 調整按鈕位置時不移動
  const inS = hitSolid(me.x, me.z);   // 萬一已經卡在擺設裡就放行，讓玩家走得出來
  if (!W.blocked(me.x + dx, me.z, R) && (inS || !hitSolid(me.x + dx, me.z))) me.x += dx;
  if (!W.blocked(me.x, me.z + dz, R) && (inS || !hitSolid(me.x, me.z + dz))) me.z += dz;
  if (moving) {
    const before = Math.floor(me.walkT / Math.PI);
    me.walkT += dt * (wantRun ? 13 : 8.5) * mag;
    if (Math.floor(me.walkT / Math.PI) !== before) { Sfx.tone(wantRun ? 85 : 70, 0.06, 'sine', wantRun ? 0.09 : 0.045); Sfx.noise(0.035, wantRun ? 0.05 : 0.028); }
  }
  me.running = wantRun;
  // 跑步時視野變寬，讓速度感更明顯
  const fovT = dashT > 0 ? 96 : wantRun ? 88 : 75;
  if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  if (gunT > 0) gunT -= dt;
  fpsWatch(dt); tickWeather(dt);
  if (view.zone && me.alive && Math.hypot(me.x - view.zone[0], me.z - view.zone[1]) > view.zr) { outT -= dt; if (outT <= 0) { outT = 2.5; toast('你在安全區外，正在扣血！往白圈裡跑'); Sfx.tone(300, 0.15, 'square', 0.08); } hurtFlash = Math.max(hurtFlash, 0.35); }
  if (gunMesh) { const kk = gunMesh.userData.kick || 0; gunMesh.userData.kick = Math.max(0, kk - dt * 9); gunMesh.position.set(-0.3, -0.3 + kk * 0.03, -0.62 + kk * 0.07); gunMesh.rotation.x = kk * 0.22; }
  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  const sk2 = shakeT * 0.22;
  camera.position.set(me.x + (Math.random() - 0.5) * sk2, 1.65 + me.y + (moving && me.y <= 0 ? Math.sin(me.walkT * 2) * 0.045 : 0) + (Math.random() - 0.5) * sk2, me.z + (Math.random() - 0.5) * sk2);
  camera.rotation.set(me.pitch, me.yaw, 0);
  $('stamBar').style.width = (me.stam * 100).toFixed(0) + '%';
  $('stam').className = me.tired ? 'tired' : '';
  // 背包滿的提示
  fullHintT -= dt;
  if (me.bagN >= W.BAG_MAX && fullHintT <= 0) {
    for (let i = 0; i < view.items.length; i++) {
      const it = view.items[i];
      if (!it.taken && Math.hypot(it.x - me.x, it.z - me.z) < 1.5) { toast('背包滿了，先回回收車賣掉'); fullHintT = 3; break; }
    }
  }
}

function spectate() {
  let t = specId ? view.players.get(specId) : null;
  if (!t || !t.alive) { nextSpec(); t = specId ? view.players.get(specId) : null; }
  if (!t) { $('spec').classList.add('hide'); return lastL; }
  camera.position.set(t.x, 1.6, t.z); camera.rotation.set(0, t.yaw, 0);
  $('spec').classList.remove('hide');
  $('specName').textContent = t.name;
  return t;
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
function interpolate(dt, now) {
  const k = Math.min(1, dt * 12);
  view.players.forEach(function (p) {
    if (p.id === myId) { p.x = me.x; p.z = me.z; p.yaw = me.yaw; return; }
    p.x += (p.tx - p.x) * k; p.z += (p.tz - p.z) * k; p.yaw = lerpAngle(p.yaw, p.tyaw, k);
    if (p.avatar) {
      p.avatar.visible = p.alive && view.phase !== 'lobby' && !(specId === p.id && !me.alive);
      p.avatar.position.set(p.x, 0, p.z); p.avatar.rotation.y = p.yaw + Math.PI;
      p.avatar.userData.talk.visible = !!(p.flags & 2);
      if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);
      p.avatar.userData.weapon.rotation.x = 0.5 + (p.swingT > 0 ? Math.sin((1 - p.swingT / 0.28) * Math.PI) * 1.5 : 0);
      const sp = Math.min(1, Math.hypot(p.tx - p.x, p.tz - p.z) * 2.2); p.walk = (p.walk || 0) + dt * (5 + sp * 9) * (sp > 0.05 ? 1 : 0);
      const L = p.avatar.userData.limbs, sw = Math.sin(p.walk) * sp;
      if (L) { L[0].rotation.x = sw * 0.9; L[1].rotation.x = -0.45 - sw * 0.25 - (p.swingT > 0 ? Math.sin((1 - p.swingT / 0.28) * Math.PI) * 1.1 : 0); L[2].rotation.x = -sw * 0.7; L[3].rotation.x = sw * 0.7; }
      p.airY = (p.airY || 0) + (((p.flags & 8) ? 0.75 : 0) - (p.airY || 0)) * Math.min(1, dt * 10);
      p.avatar.position.y = Math.abs(Math.sin(p.walk)) * 0.04 * sp + p.airY;
      const pt = p.avatar.userData.pet; if (pt) { pt.position.y = (pt.userData.fly ? Math.sin(now * 3) * 0.08 : Math.abs(Math.sin(p.walk * 1.3)) * 0.07 * sp) - p.airY; }
    }
  });
  for (let i = 0; i < view.monsters.length; i++) {
    const m = view.monsters[i];
    if (!m.group.visible) continue;
    m.x += (m.tx - m.x) * k; m.z += (m.tz - m.z) * k; m.rot = lerpAngle(m.rot, m.trot, Math.min(1, dt * 8));
    m.group.position.set(m.x, Math.sin(now * (m.chase ? 14 : 5) + i) * 0.05, m.z);
    m.group.rotation.y = m.rot;
    if (m.hitT > 0) { m.hitT -= dt; const hs = 1 + Math.max(0, m.hitT) * 1.2; m.group.scale.x = hs; m.group.scale.z = hs; } else if (m.group.scale.x !== 1) { m.group.scale.x = 1; m.group.scale.z = 1; }
    if (m.arms) { const sw = Math.sin(now * (m.chase ? 11 : 3.5) + i); m.arms[0].rotation.x = m.chase ? -1.25 + sw * 0.25 : sw * 0.35; m.arms[1].rotation.x = m.chase ? -1.25 - sw * 0.25 : -sw * 0.35; }
  }
  for (let i = 0; i < view.items.length; i++) {
    const it = view.items[i];
    if (it.taken) continue;
    it.mesh.rotation.y += dt * 1.6; it.mesh.rotation.x += dt * 0.5;
    it.mesh.position.set(it.x, 0.75 + Math.sin(now * 2 + i) * 0.08, it.z);
  }
}

function atmosphere(L, dt) {
  const hidNow = me.alive && !me.running && (W.lockers || []).some(function (q) { return Math.hypot(q[0] - me.x, q[1] - me.z) < 1.4; });
  $('hideTag').classList.toggle('hide', !hidNow);
  let dist = 1e9, chase = false;
  for (let i = 0; i < view.monsters.length; i++) {
    const m = view.monsters[i];
    if (!m.group.visible) continue;
    const d = Math.hypot(m.x - L.x, m.z - L.z);
    if (d < dist) { dist = d; chase = m.chase; }
  }
  let danger = Math.max(0, 1 - dist / 30);
  if (chase && danger > 0) danger = Math.min(1, danger + 0.35);
  // 怪物靠近：恐怖低鳴；非常近且追逐時顯示字幕並播放音效
  view.scareT = Math.max(0, (view.scareT || 0) - dt); view.subT = Math.max(0, (view.subT || 0) - dt);
  if (dist < 12 && view.scareT <= 0 && me.alive) { Sfx.tone(44, 1.2, 'sawtooth', 0.05, 30); view.scareT = 6; }
  if (dist < 5 && chase && view.subT <= 0 && me.alive && view.mode !== 'td') {
    Sfx.tone(92, 0.35, 'square', 0.16, 46); view.subT = 4;
    showSub('發現你了！');
  }
  RR.Music.setMood(chase ? 'chase' : danger > 0.4 ? 'tense' : 'calm');
  $('vig').style.opacity = (danger * danger * 0.9).toFixed(2);
  beatT -= dt;
  if (danger > 0.12 && beatT <= 0) { Sfx.tone(58, 0.16, 'sine', 0.1 + danger * 0.3, 38); beatT = 1.15 - danger * 0.8; }
  torch.intensity = dist < 9 ? torchBase * (Math.random() < 0.25 ? 0.25 : 1) : torchBase;
  // 回收車方向
  const rel = Math.atan2(-(W.VAN[0] - L.x), -(W.VAN[1] - L.z)) - L.yaw;
  $('arrow').style.transform = 'rotate(' + (-rel).toFixed(3) + 'rad)';
}

function voiceSpatial(playing, L) {
  view.players.forEach(function (p) {
    if (p.id === myId) return;
    let g = 1, pan = 0;
    if (playing) {
      if (!me.alive) g = 0.9;                 // 死掉後聽得到所有人
      else if (!p.alive) g = 0;               // 活人聽不到死人
      else {
        g = 1; pan = 0;   // 活著的隊友音量固定，不隨距離或牆壁改變，方便溝通
      }
    }
    Voice.spatial(p.id, g, pan);
  });
}

function updateHud() {
  if (view.mode === 'br') { let al = 0; view.players.forEach(function (p) { if (p.id === myId ? me.alive : p.alive) al++; }); $('money').textContent = al; $('quota').textContent = view.players.size + ' 人'; }
  else if (view.mode === 'td' && view.td) { $('money').textContent = '$' + view.money; $('quota').textContent = '核心 ' + view.td[0] + '｜剩 ' + view.td[1] + ' 隻'; }
  else { $('money').textContent = '$' + view.money; $('quota').textContent = '$' + view.quota; }
  $('bag').textContent = me.bagN;
  const bm = $('bombs'), bt = String(me.bombs == null ? 2 : me.bombs); if (bm.textContent !== bt) bm.textContent = bt;
  const am = $('ammo'), at = me.reloading ? '裝填中' : String(me.ammo || 0); if (am.textContent !== at) am.textContent = at;
  const gb = $('gun'), gt = me.reloading ? '…' : '槍'; if (gb.textContent !== gt) gb.textContent = gt; gb.classList.toggle('cd', !!me.reloading || !(me.ammo > 0));
  const qf = $('qfill'), pct = view.mode === 'td' && view.td ? view.td[0] : view.quota ? Math.min(100, view.money / view.quota * 100) : 0;
  qf.style.width = pct + '%'; qf.classList.toggle('done', pct >= 100);
  const cap = (myEq(2) ? 4 : 3) + (me.riding ? 2 : 0), pp = $('pips'); while (pp.children.length < 6) pp.appendChild(document.createElement('i')); if ($('bagCap').textContent !== String(cap)) $('bagCap').textContent = cap;
  for (let i = 0; i < 6; i++) { pp.children[i].className = i < me.bagN ? 'on' : ''; pp.children[i].style.display = i < cap ? '' : 'none'; } pp.className = me.bagN >= cap ? 'full' : '';
  $('day').textContent = view.day;
  const s = Math.max(0, Math.ceil(view.time)), mm = Math.floor(s / 60), ss = s % 60;
  $('timer').textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
  $('timer').className = s <= 30 ? 'low' : '';
}
function buildPlist() {
  const el = $('plist'); el.textContent = '';
  view.players.forEach(function (p) {
    const row = document.createElement('div'); row.className = 'prow';
    const dot = document.createElement('i'); dot.style.background = CSSCOL[p.slot % 4];
    const nm = document.createElement('span'); nm.textContent = p.name + (p.id === myId ? '（你）' : '');
    row.appendChild(dot); row.appendChild(nm); el.appendChild(row); p.row = row;
  });
}
function tickHud() {
  view.players.forEach(function (p) {
    if (!p.row) return;
    const talking = p.id === myId ? spk : !!(p.flags & 2);
    p.row.className = 'prow' + (p.alive ? '' : ' dead') + (talking ? ' spk' : '');
  });
  const b = $('micBtn');
  b.className = !Voice.hasMic() ? 'nomic' : Voice.isMuted() ? 'muted' : loudT > 0 ? 'loud' : spk ? 'spk' : '';
  b.textContent = !Voice.hasMic() ? '開麥克風' : Voice.isMuted() ? '麥克風 關' : loudT > 0 ? '太大聲！' : '麥克風 開';
}

let last = 0, pv = null;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  const now = nowMs / 1000;
  const lvl = Voice.level();
  spk = lvl > 0.035;
  if (lvl > 0.16) loudT = 0.6; else loudT = Math.max(0, loudT - dt);
  const playing = active && view.phase === 'play';
  if (atkT > 0) atkT -= dt;
  if (swingT > 0) swingT = Math.max(0, swingT - dt);
  if (pipe) {
    const k = Math.sin((1 - swingT / 0.28) * Math.PI) * (swingT > 0 ? 1 : 0);
    pipe.rotation.x = -0.5 - k * 1.5; pipe.rotation.z = -0.25 + k * 0.5;
    pipe.visible = active && me.alive;
  }
  if (hurtFlash > 0) { hurtFlash = Math.max(0, hurtFlash - dt * 1.6); if (me.alive) $('flash').style.opacity = (hurtFlash * 0.5).toFixed(2); }
  if (playing) {
    let L;
    renderTT();
    if (me.alive) { updateMe(dt); L = me; $('spec').classList.add('hide'); }
    else L = spectate();
    lastL = L;
    interpolate(dt, now);
    atmosphere(L, dt);
    miniT -= dt; if (miniT <= 0) { miniT = 0.08; drawMini(L); }
  } else if (active) {
    interpolate(dt, now);
    RR.Music.setMood('lobby');
  } else {
    RR.Music.setMood('menu');
    camera.position.set(W.VAN[0], 1.65, W.VAN[1]);
    camera.rotation.set(0, -Math.PI * 0.75 + Math.sin(now * 0.3) * 0.5, 0);
    torch.intensity = torchBase;
  }
  voiceSpatial(playing, lastL);
  hudT -= dt; if (hudT <= 0) { hudT = 0.15; tickHud(); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  if (pv && pv.model && pv.canvas.offsetParent) { pv.model.rotation.y = now * 0.9; pv.r.render(pv.sc, pv.cam); }
  renderer.render(scene, camera);
}

/* ---------- 對外介面 ---------- */
RR.Game = {
  dbg: function () { return { scene: scene, renderer: renderer, camera: camera }; },
  stats: function () { const i = renderer.info; let n = 0, lights = 0, outl = 0; scene.traverse(function (o) { if (o.isMesh && o.visible) n++; if (o.isLight) lights++; if (o.userData && o.userData.outline) outl++; }); return { calls: i.render.calls, tris: i.render.triangles, geo: i.memory.geometries, tex: i.memory.textures, progs: i.programs ? i.programs.length : 0, meshes: n, lights: lights, outl: outl, pr: renderer.getPixelRatio() }; },
  openMini: openMini,
  init: function () {
    if (ready) return true;
    if (!window.THREE) return false;
    canvas = $('c');
    // 觸控裝置螢幕倍率高，反鋸齒的效益小、耗能大，所以關掉
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !isTouchDev(), powerPreference: 'high-performance' }); } catch (e) { return false; }
    applyQuality();
    try { maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x0a0f0d, 0.04);
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 80); camera.rotation.order = 'YXZ'; scene.add(camera);
    ambient = new THREE.AmbientLight(0x4a5568, 0.95); scene.add(ambient);
    hemi = new THREE.HemisphereLight(0xcfd8e6, 0x3a3f3a, 0.45); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff2d8, 0); sun.position.set(30, 60, 20); scene.add(sun);
    torch = new THREE.SpotLight(0xfff0cc, 2.2, 42, 0.62, 0.55, 1.2);
    gunMesh = new THREE.Group();
    { const gm = pmat(0x2b3038, 0.08), gg = pmat(0x8a6238, 0.12);
      gunMesh.add(part(new THREE.BoxGeometry(0.07, 0.09, 0.34), gm, 0, 0, 0), part(new THREE.BoxGeometry(0.06, 0.16, 0.08), gg, 0, -0.11, 0.11), part(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 10), gm, 0, 0.01, -0.21));
      gunMesh.children[2].rotation.x = Math.PI / 2; }
    gunMesh.position.set(-0.3, -0.3, -0.62); camera.add(gunMesh);
    cartView = new THREE.Group(); cartView.add(part(new THREE.BoxGeometry(0.9, 0.3, 0.6), pmat(0xd9902f, 0.25), 0, -0.78, -1.05), part(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), pmat(0x9aa3a8, 0.15), 0, -0.5, -0.62)); cartView.children[1].rotation.z = Math.PI / 2; cartView.visible = false; camera.add(cartView);
    torch.position.set(0.25, -0.2, 0); camera.add(torch); camera.add(torch.target); torch.target.position.set(0, -0.05, -1);
    buildLevel();
    for (let i = 0; i < 6; i++) view.monsters.push(buildMonster(['fire', 'ice', 'poison', 'shadow'][i % 4]));
    setViewWeapon(0);
    skinGeos = [new THREE.SphereGeometry(0.28, 18, 14), new THREE.OctahedronGeometry(0.34, 0)];
    itemGeos = [
      new THREE.TorusGeometry(0.26, 0.1, 8, 16), new THREE.BoxGeometry(0.3, 0.5, 0.3), new THREE.CylinderGeometry(0.25, 0.25, 0.3, 12),
      new THREE.BoxGeometry(0.55, 0.35, 0.25), new THREE.IcosahedronGeometry(0.28, 0), new THREE.CylinderGeometry(0.2, 0.28, 0.45, 10),
      new THREE.BoxGeometry(0.6, 0.18, 0.28), new THREE.SphereGeometry(0.24, 12, 10), new THREE.BoxGeometry(0.5, 0.06, 0.4),
      new THREE.OctahedronGeometry(0.3, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.5, 12)
    ];
    window.addEventListener('resize', resize); resize();
    bindInput();
    ready = true;
    requestAnimationFrame(frame);
    return true;
  },
  settings: settings,
  /** 選單／大廳換地圖時，背景跟著換 */
  showMap: function (i) { if (!ready || active) return; W.setMap(i); if (builtMap !== W.mapIndex) buildLevel(); },
  /** 選單裡的造型預覽 */
  preview: function (canvas, c, w, h, o, pet) {
    if (!ready) return;
    if (!pv) {
      try {
        const r = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setSize(150, 170, false);
        const sc = new THREE.Scene();
        sc.add(new THREE.AmbientLight(0xffffff, 0.75));
        const d = new THREE.DirectionalLight(0xffffff, 0.9); d.position.set(2, 4, 3); sc.add(d);
        const cam = new THREE.PerspectiveCamera(35, 150 / 170, 0.1, 20); cam.position.set(0, 1.3, 4.7); cam.lookAt(0, 1.08, 0);
        pv = { r: r, sc: sc, cam: cam, canvas: canvas, model: null };
      } catch (e) { pv = null; return; }
    }
    if (pv.model) pv.sc.remove(pv.model);
    const g = buildChar(c, 0, h || 0, o || 0, pet || 0), wg = buildWeapon(w);
    wg.position.set(0.37, 0.67, 0.3); wg.rotation.x = 0.5; g.add(wg);
    pv.model = g; pv.sc.add(g);
  },
  setMe: function (id) { myId = id; },
  state: function () { const others = {}; view.players.forEach(function (p) { if (p.id !== myId) others[p.id] = [p.x, p.z, p.alive, !!(p.avatar && p.avatar.visible)]; }); return { phase: view.phase, alive: me.alive, x: me.x, z: me.z, others: others, spec: specId, players: view.players.size, items: view.items.length, monsters: view.monsters.filter(function (m) { return m.group.visible; }).length }; },
  setActive: function (b) {
    active = !!b;
    document.body.classList.toggle('playing', active);
    $('hud').classList.toggle('hide', !active);
    if (!active) {
      if (miniInPlay) closeMini();
      releaseTouch(); Sfx.drone(false);
      try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
      $('vig').style.opacity = 0; $('flash').style.opacity = 0; $('spec').classList.add('hide');
      view.monsters.forEach(function (m) { m.group.visible = false; });
      view.items.forEach(function (it) { it.mesh.visible = false; });
      view.players.forEach(function (p) { if (p.avatar) p.avatar.visible = false; });
      view.phase = 'lobby';
    }
  },
  setRoster: function (list) {
    const seen = {};
    list.forEach(function (r) {
      seen[r.id] = true;
      let p = view.players.get(r.id);
      if (p && (p.name !== r.name || p.slot !== r.slot || p.c !== r.c || p.w !== r.w || (p.h || 0) !== (r.h || 0) || (p.o || 0) !== (r.o || 0) || (p.pet || 0) !== (r.pet || 0))) { if (p.avatar) scene.remove(p.avatar); view.players.delete(r.id); p = null; }
      if (!p) {
        p = { id: r.id, name: r.name, slot: r.slot, c: r.c || 0, w: r.w || 0, h: r.h || 0, o: r.o || 0, pet: r.pet || 0, eq: r.eq || [], gems: r.gems || [0, 0, 0], swingT: 0, x: W.VAN[0], z: W.VAN[1], yaw: 0, tx: W.VAN[0], tz: W.VAN[1], tyaw: 0, alive: true, bagN: 0, flags: 0, avatar: null, row: null, fresh: true };
        if (r.id !== myId) { p.avatar = buildAvatar(p); p.avatar.visible = false; }
        else setViewWeapon(p.w);
        view.players.set(r.id, p);
      }
      p.eq = r.eq || []; p.gems = r.gems || [0, 0, 0];   // 配件可在對局中更換
    });
    Array.from(view.players.keys()).forEach(function (id) {
      if (!seen[id]) { const p = view.players.get(id); if (p.avatar) scene.remove(p.avatar); view.players.delete(id); }
    });
    buildPlist();
  },
  onDay: function (info) {
    skEnd = 0; smEnd = 0; me.bombs = 2;
    W.setMap(info.map || 0); W.restoreMap();
    if (builtMap !== W.mapIndex || Object.keys(brokenVis).length) buildLevel();   // 前一天炸開的牆恢復原狀
    view.items.forEach(function (it) { scene.remove(it.mesh); });
    view.items = info.items.map(function (a) {
      const isk = RR.Game.settings.itemSkin | 0;   // 回收品造型：0 預設、1 糖果（圓球粉彩）、2 寶石（八面體亮色）
      const icol = isk === 1 ? [0xffb3d1, 0xb3e5ff, 0xfff0a8, 0xd5b8ff, 0xb8ffd9][a[2] % 5] : isk === 2 ? [0xff4a6a, 0x4ac8ff, 0x6aff8a, 0xffd24a, 0xc86aff][a[2] % 5] : [0xffd166, 0x6ecbff, 0xff9f5a, 0xc9a0ff, 0xff7eb6, 0x9be564, 0xffe94a, 0xfff3b0, 0x5affc9, 0xffb86b, 0xbfc7d1][a[2] % 11];
      if (a[2] >= 20) {   // 大逃殺補給箱：綠 急救、藍 護甲、紅 火力
        const lm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), new THREE.MeshBasicMaterial({ color: [0x4ade80, 0x5aa9ff, 0xff5a5a][a[2] - 20] || 0xffffff }));
        lm.position.set(a[0], 0.45, a[1]); scene.add(lm);
        return { x: a[0], z: a[1], kind: a[2], value: 0, taken: false, mesh: lm };
      }
      const mesh = new THREE.Mesh(isk === 1 ? skinGeos[0] : isk === 2 ? skinGeos[1] : itemGeos[a[2] % itemGeos.length], new THREE.MeshBasicMaterial({ color: icol }));
      mesh.position.set(a[0], 0.75, a[1]); scene.add(mesh);
      return { x: a[0], z: a[1], kind: a[2], value: a[3], taken: false, mesh: mesh };
    });
    view.mode = info.mode || 'coop'; document.body.classList.toggle('td', view.mode === 'td'); syncTowers([]); view.td = null;
    document.body.classList.toggle('hunt', view.mode === 'hunt'); document.body.classList.toggle('br', view.mode === 'br');
    applyWeather(info.weather || 0); quakeT = 0; me.riding = false; rings.forEach(function (r) { scene.remove(r.mesh); }); rings.length = 0;
    if (info.weather) setTimeout(function () { toast('今天的天氣：' + W.WEATHERS[info.weather] + ['', '（雨聲蓋過腳步，怪物比較聽不到你）', '（你和怪物都看不遠）', '（很暗，靠手電筒；怪物也看不遠）', '（能見度低，小地圖看不到怪物）'][info.weather]); }, 2600);
    view.zone = info.zone || null; view.zr = info.zone ? info.zone[2] : 0; outT = 0;
    if (zoneMesh) { scene.remove(zoneMesh); zoneMesh = null; }
    if (view.zone) {
      zoneMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 30, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      zoneMesh.position.set(view.zone[0], 15, view.zone[1]); zoneMesh.scale.set(view.zr, 1, view.zr); scene.add(zoneMesh);
    }
    $('moneyLbl').textContent = view.mode === 'td' ? '資金' : view.mode === 'hunt' ? '擊倒得分' : view.mode === 'br' ? '存活' : '收入'; me.ammo = view.mode === 'coop' ? 6 : 12; me.reloading = false;
    view.phase = 'play'; view.day = info.day; view.quota = info.quota; view.time = info.time; view.money = 0;
    view.players.forEach(function (p) {
      const s = info.spawns[p.id] || W.VAN;
      p.alive = true; p.bagN = 0; p.flags = 0; p.x = p.tx = s[0]; p.z = p.tz = s[1]; p.yaw = p.tyaw = -Math.PI * 0.75;
    });
    view.monsters.forEach(function (m) { m.group.visible = false; m.fresh = true; m.chase = false; });
    const sp = info.spawns[myId] || W.VAN;
    me.x = sp[0]; me.z = sp[1]; me.yaw = -Math.PI * 0.75; me.pitch = 0; me.stam = 1; me.tired = false; me.alive = true; me.bagN = 0; me.running = false; me.y = 0; me.vy = 0; dashT = 0; dashCd = 0; me.hp = 100; atkT = 0; swingT = 0; hurtFlash = 0;
    $('hpBar').style.width = '100%';
    specId = null; beatT = 0; lastL = me;
    $('flash').style.opacity = 0; $('warn').style.opacity = 0; $('spec').classList.add('hide');
    Sfx.drone(true);
    updateHud();
    toast(view.mode === 'td' ? '塔防第 ' + info.day + ' 關：守住回收車！開槍打怪，按「塔」花 $100 蓋砲塔' : view.mode === 'br' ? '大逃殺：活到最後！白圈外會扣血，補給箱：綠 急救、藍 護甲、紅 火力' : view.mode === 'hunt' ? '獵殺第 ' + info.day + ' 關：用槍擊倒 ' + (info.quota / 50) + ' 隻怪物（每隻 $50）' : '第 ' + info.day + ' 天：把廢料帶回金色回收車，賺到 $' + info.quota);
    lockPointer();
  },
  onSnapshot: function (s) {
    const prevSec = Math.ceil(view.time), prevMoney = view.money, prevBag = me.bagN;
    // 搶獎盃與圈圈叉叉棋盤
    if (s.tr && !trophyMesh) {
      trophyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.8, 12), litMat({ color: 0xffc83a, emissive: 0x553300, shininess: 80 }));
      trophyMesh.position.y = 0.6; scene.add(trophyMesh);
    }
    if (s.tr) trophyMesh.position.set(s.tr[0], 0.6, s.tr[1]);
    if (!s.tr && trophyMesh) { scene.remove(trophyMesh); trophyMesh = null; }
    if (s.bp && !boardMesh) {
      boardMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 2.4), litMat({ color: 0x6b4a2b }));
      boardMesh.position.set(s.bp[0], 0.45, s.bp[1]); scene.add(boardMesh);
    }
    if (s.bp && s.tt) view.bp = s.bp;
    if (s.tt) view.tt = s.tt;
    else view.tt = null;
    // 傳送陣的顯示
    // 推車
    if (s.bk) s.bk.forEach(function (q) { showBreak(q[0], q[1], true); });   // 補上漏掉的（例如中途才連上）
    if (s.td) view.td = s.td;
    if (view.mode === 'td') syncTowers(s.tw);
    if (s.veh) {
      if (!cartMesh) { cartMesh = buildCart(); scene.add(cartMesh); }
      const rid = s.veh[2]; me.riding = rid === myId && me.alive;
      let cx = s.veh[0], cz = s.veh[1], cyaw = cartMesh.rotation.y;
      if (rid && rid !== myId) { const rp = view.players.get(rid); if (rp) { cx = rp.x; cz = rp.z; cyaw = rp.yaw; } }
      cartMesh.visible = rid !== myId; cartMesh.position.set(cx, 0, cz); cartMesh.rotation.y = cyaw;
      view.veh = s.veh;
    } else { if (cartMesh) cartMesh.visible = false; view.veh = null; me.riding = false; }
    if (cartView) cartView.visible = !!me.riding;
    const nearV = view.veh && me.alive && (me.riding || (!view.veh[2] && Math.hypot(view.veh[0] - me.x, view.veh[1] - me.z) < 2.4));
    document.body.classList.toggle('nearveh', !!nearV); const vb = $('veh'), vt = me.riding ? '下車' : '車'; if (vb.textContent !== vt) vb.textContent = vt;
    if (s.pad && !padMesh) {
      padMesh = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 40), new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      padMesh.rotation.x = -Math.PI / 2; padMesh.position.y = 0.05; scene.add(padMesh);
    }
    if (s.pad && padMesh) padMesh.position.set(s.pad[0], 0.05, s.pad[1]);
    if (!s.pad && padMesh) { scene.remove(padMesh); padMesh = null; }
    view.phase = s.ph; view.day = s.day; view.money = s.money; view.quota = s.quota; view.time = s.time;
    for (let i = 0; i < s.p.length; i++) {
      const a = s.p[i], p = view.players.get(a[0]);
      if (!p) continue;
      p.alive = !!a[4]; p.bagN = a[5]; p.flags = a[6];
      if (a[0] === myId) {
        me.bagN = a[5]; if (s.ph === 'play' && !a[4]) me.alive = false;
        if (s.zr != null) { view.zr = s.zr; if (zoneMesh) zoneMesh.scale.set(s.zr, 1, s.zr); }
        if (a[8] != null) { me.ammo = a[8]; me.reloading = !!a[9]; }
        if (a[10] != null) me.bombs = a[10];
        if (a[7] != null && a[7] !== me.hp) { me.hp = a[7]; $('hpBar').style.width = hpPct(); }
        continue;
      }
      p.tx = a[1]; p.tz = a[2]; p.tyaw = a[3];
      if (p.fresh) { p.x = p.tx; p.z = p.tz; p.yaw = p.tyaw; p.fresh = false; }
    }
    for (let i = 0; i < view.monsters.length; i++) {
      const m = view.monsters[i], a = s.m[i];
      if (!a || s.ph === 'lobby') { m.group.visible = false; continue; }
      m.tx = a[0]; m.tz = a[1]; m.trot = a[2]; m.chase = !!a[3];
      if (m.fresh) { m.x = m.tx; m.z = m.tz; m.rot = m.trot; m.fresh = false; }
      m.group.visible = a[4] !== 0;   // 獵殺模式：被擊倒的怪物先消失，重生後再出現
      if (!m.group.visible) m.fresh = true;
    }
    if (s.it && s.it.length === view.items.length) {
      for (let i = 0; i < view.items.length; i++) {
        const it = view.items[i]; it.taken = s.it[i] === '1'; it.mesh.visible = !it.taken;
      }
    }
    const sec = Math.ceil(view.time);
    if (sec !== prevSec || view.money !== prevMoney || me.bagN !== prevBag) {
      updateHud();
      if (sec !== prevSec && s.ph === 'play' && sec <= 10 && sec > 0) Sfx.tone(880, 0.05, 'square', 0.05);
    }
  },
  onEvent: function (e) {
    if (e.t === 'pickup') {
      const it = view.items[e.i];
      if (it) { it.taken = true; it.mesh.visible = false; }
      if (e.id === myId && it) { Sfx.tone(660, 0.09, 'triangle', 0.12, 990); toast('撿到 ' + W.KINDS[it.kind].n + '（$' + it.value + '）'); }
    } else if (e.t === 'sell') {
      Sfx.tone(523, 0.12, 'triangle', 0.14); setTimeout(function () { Sfx.tone(784, 0.2, 'triangle', 0.14); }, 110);
      toast((e.id === myId ? '賣出' : nameOf(e.id) + ' 賣出') + ' +$' + e.sum); floatText('+$' + e.sum);
    } else if (e.t === 'drop') {
      e.list.forEach(function (a) { const it = view.items[a[0]]; if (it) { it.x = a[1]; it.z = a[2]; it.taken = false; it.mesh.visible = true; } });
    } else if (e.t === 'caught') {
      const p = view.players.get(e.id); if (p) p.alive = false;
      if (e.id === myId) {
        me.alive = false; me.running = false; releaseTouch();
        Sfx.noise(0.8, 0.5); Sfx.tone(220, 0.8, 'sawtooth', 0.25, 55); shakeT = 0.6;
        $('flash').style.opacity = 0.85; setTimeout(function () { $('flash').style.opacity = 0; }, 900);
        toast('你被抓到了');
      } else { Sfx.tone(90, 0.5, 'sawtooth', 0.12, 45); toast(nameOf(e.id) + ' 被抓走了，身上的廢料掉在原地'); }
    } else if (e.t === 'pad') {
      toast('出現傳送陣！快去踩上去回基地');
      Sfx.tone(660, 0.4, 'sine', 0.12, 990);
    } else if (e.t === 'warp') {
      if (e.id === myId) { me.x = e.x; me.z = e.z; toast('已傳回基地'); }
      else { const p = view.players.get(e.id); if (p) { p.x = p.tx = e.x; p.z = p.tz = e.z; } }
    } else if (e.t === 'trophy') {
      toast(e.id === myId ? '搶到獎盃！+120' : nameOf(e.id) + ' 搶到獎盃！');
      Sfx.tone(523, 0.2, 'triangle', 0.15, 784); Sfx.tone(784, 0.4, 'triangle', 0.15, 1046);
    } else if (e.t === 'ttmove') {
      Sfx.tone(e.mark === 'X' ? 440 : 330, 0.12, 'square', 0.1);
    } else if (e.t === 'ttwin') {
      toast((e.mark === 'X' ? 'X' : 'O') + ' 連線獲勝！團隊 +150');
      Sfx.tone(523, 0.2, 'triangle', 0.15, 784); Sfx.tone(784, 0.4, 'triangle', 0.15, 1046);
    } else if (e.t === 'ttdraw') {
      toast('圈圈叉叉平手，下一局開始');
    } else if (e.t === 'rally') {
      if (e.ids.indexOf(myId) >= 0 && e.id !== myId) { me.rallyT = 5; toast(nameOf(e.id) + ' 的鼓舞：移動加速'); }
      else if (e.id === myId) { me.rallyT = 5; skEnd = Date.now() + 25000; toast('鼓舞！附近隊友加速'); }
      Sfx.tone(600, 0.2, 'triangle', 0.12, 900);
    } else if (e.t === 'shield') {
      if (e.id === myId) skEnd = Date.now() + 30000;
      if (e.id === myId) toast('護盾開啟，4 秒內不會被抓'); Sfx.tone(700, 0.3, 'sine', 0.1, 1000);
    } else if (e.t === 'stealth') {
      if (e.id === myId) skEnd = Date.now() + 25000;
      if (e.id === myId) toast('潛行中，怪物較難發現你'); Sfx.tone(300, 0.3, 'sine', 0.08, 220);
    } else if (e.t === 'heal') {
      if (e.id === myId) skEnd = Date.now() + 25000;
      if (e.id === myId) { me.hp = e.hp; $('hpBar').style.width = hpPct(); toast('加血 +35'); } Sfx.tone(660, 0.2, 'sine', 0.1, 880);
    } else if (e.t === 'hide') {
      if (e.id === myId) skEnd = Date.now() + 30000;
      if (e.id === myId) toast('隱身 4 秒，怪物看不到你'); Sfx.tone(180, 0.4, 'sine', 0.08, 120);
    } else if (e.t === 'moon') {
      if (e.id === myId) { skEnd = Date.now() + 25000; toast('月光波！附近怪物暫停 3 秒'); }
      showMoon(e.x, e.z);
    } else if (e.t === 'quake') {
      quakeT = e.dur || 4; toast('地震！所有人變慢，怪物也站不穩'); Sfx.tone(50, 1.2, 'sawtooth', 0.2, 30);
    } else if (e.t === 'strike') {
      toast(baseLight && baseLight.open ? '隕石來襲！離開紅圈' : '天花板落石！離開紅圈'); Sfx.tone(880, 0.5, 'square', 0.1, 440);
      (e.pts || []).forEach(function (q) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.5, 40), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(q[0], 0.06, q[1]); scene.add(ring); rings.push({ mesh: ring, t: e.delay || 2.5 });
      });
    } else if (e.t === 'boom') {
      showBoom(e.x, e.z);
    } else if (e.t === 'veh') {
      if (e.id === myId) toast(e.on ? '推上推車：速度快、多放 2 件，但很吵，不能跳、衝、開槍' : '下車了');
      Sfx.tone(e.on ? 300 : 220, 0.12, 'triangle', 0.1, e.on ? 450 : 160);
    } else if (e.t === 'brkill') {
      const vp = view.players.get(e.id); if (vp) vp.alive = false;
      let left = 0; view.players.forEach(function (p) { if (p.id === myId ? (me.alive && e.id !== myId) : p.alive) left++; });
      if (e.id === myId) {
        me.alive = false; me.running = false; releaseTouch(); Sfx.noise(0.6, 0.4);
        $('flash').style.opacity = 0.85; setTimeout(function () { $('flash').style.opacity = 0; }, 900);
        toast((e.by ? '你被 ' + nameOf(e.by) + ' 淘汰' : '你倒在安全區外') + '，第 ' + e.rank + ' 名');
      } else toast((e.by === myId ? '你淘汰了 ' + nameOf(e.id) : e.by ? nameOf(e.by) + ' 淘汰了 ' + nameOf(e.id) : nameOf(e.id) + ' 倒在安全區外') + '，剩 ' + left + ' 人');
      if (e.by === myId) { floatText('淘汰 +1'); Sfx.tone(520, 0.2, 'triangle', 0.14, 880); }
    } else if (e.t === 'loot') {
      if (e.id === myId) { me.hp = e.hp; $('hpBar').style.width = Math.min(100, me.hp) + '%'; toast(e.k === 20 ? '急救箱：生命 +40' : e.k === 21 ? '護甲：生命上限 150' : '火力強化：傷害 ×1.5'); Sfx.tone(660, 0.12, 'triangle', 0.12, 990); }
    } else if (e.t === 'escape') {
      if (e.id === myId) { toast('急救針發動！掙脫了，快跑'); shakeT = 0.4; hurtFlash = 0.6; } else toast(nameOf(e.id) + ' 用急救針掙脫了');
      Sfx.tone(700, 0.2, 'triangle', 0.14, 1200);
    } else if (e.t === 'roar') {
      if (e.id === myId) { skEnd = Date.now() + 22000; toast('咆哮！附近怪物嚇呆 2.5 秒'); }
      Sfx.tone(140, 0.6, 'sawtooth', 0.22, 70); Sfx.noise(0.4, 0.15); if (Math.hypot(e.x - me.x, e.z - me.z) < 8) shakeT = Math.max(shakeT, 0.35);
    } else if (e.t === 'blink') {
      if (e.id === myId) {
        skEnd = Date.now() + 18000;
        const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw); let d = 0;
        while (d < 6 && !W.blocked(me.x - sy * (d + 0.5), me.z - cy * (d + 0.5), 0.42) && !hitSolid(me.x - sy * (d + 0.5), me.z - cy * (d + 0.5))) d += 0.5;
        me.x -= sy * d; me.z -= cy * d; toast('瞬移！');
      }
      Sfx.tone(900, 0.25, 'sine', 0.12, 1800);
    } else if (e.t === 'break') {
      showBreak(e.c, e.r); if (e.id === myId) { me.bombs = e.n; toast('炸開了！還剩 ' + e.n + ' 顆炸藥'); }
    } else if (e.t === 'nobomb') {
      if (e.id === myId) toast(e.why === 'none' ? '炸藥用完了（每天 2 顆）' : e.why === 'edge' ? '最外圈的牆炸不開' : '面前沒有牆，再靠近一點');
    } else if (e.t === 'tshot') {
      showTowerShot(e); if (e.kill) floatText('+$50');
    } else if (e.t === 'leak') {
      toast('怪物闖進回收車！核心剩 ' + e.core); shakeT = Math.max(shakeT, 0.35); Sfx.tone(140, 0.3, 'sawtooth', 0.16, 60);
    } else if (e.t === 'tower') {
      Sfx.tone(520, 0.1, 'triangle', 0.1, 780); if (e.id === myId) toast('砲塔蓋好了（-$100）');
    } else if (e.t === 'notower') {
      if (e.id === myId) toast(e.why === 'money' ? '資金不足：砲塔要 $100' : e.why === 'max' ? '最多 6 座砲塔' : '離另一座砲塔太近');
    } else if (e.t === 'shot') {
      showShot(e);
      if (e.kill) { Sfx.tone(180, 0.35, 'sawtooth', 0.14, 60); floatText('+$50'); toast((e.id === myId ? '你' : nameOf(e.id)) + '擊倒了怪物！'); }
      else if (e.mi >= 0 && e.id === myId && view.mode !== 'hunt') toast('命中！怪物暈 2.5 秒');
    } else if (e.t === 'noammo') {
      if (e.id === myId) { toast('沒子彈了'); Sfx.tone(900, 0.04, 'square', 0.06); }
    } else if (e.t === 'smoke') {
      showCloud(e.x, e.z);
      if (e.id === myId) { smEnd = Date.now() + 20000; toast('煙霧彈！煙裡的人怪物看不到'); }
      else if (me.alive && Math.hypot(e.x - me.x, e.z - me.z) < 6) showSmoke();
    } else if (e.t === 'revive') {
      const p = view.players.get(e.id); if (p) p.alive = true;
      if (e.id === myId) { me.alive = true; me.hp = 50; hurtFlash = 0; Sfx.tone(520, 0.3, 'sine', 0.15, 780); toast('被隊友救起來了'); }
      else toast(nameOf(e.by) + ' 救起了 ' + nameOf(e.id));
    } else if (e.t === 'swing') {
      if (e.id !== myId) { const p = view.players.get(e.id); if (p) { p.swingT = 0.28; if (Math.hypot(p.x - lastL.x, p.z - lastL.z) < 14) Sfx.noise(0.1, 0.05); } }
    } else if (e.t === 'hit') {
      if (e.id === myId) { hurtFlash = 1; shakeT = 0.3; Sfx.tone(160, 0.25, 'square', 0.2, 70); if (e.hp > 0) toast('被 ' + nameOf(e.by) + ' 打了！'); }
      else if (e.by === myId) Sfx.tone(240, 0.12, 'square', 0.12, 120);
    } else if (e.t === 'killed') {
      const p = view.players.get(e.id); if (p) p.alive = false;
      if (e.id === myId) {
        me.alive = false; me.running = false; releaseTouch();
        Sfx.noise(0.6, 0.4); hurtFlash = 0;
        $('flash').style.opacity = 0.85; setTimeout(function () { $('flash').style.opacity = 0; }, 900);
        toast('你被 ' + nameOf(e.by) + ' 殺了');
      } else toast(e.by === myId ? '你殺了 ' + nameOf(e.id) + '，廢料掉在原地' : nameOf(e.by) + ' 殺了 ' + nameOf(e.id));
    } else if (e.t === 'chase') {
      if (e.id === myId) {
        Sfx.tone(110, 0.9, 'sawtooth', 0.12, 330);
        $('warn').style.opacity = 1; setTimeout(function () { $('warn').style.opacity = 0; }, 1400);
      } else Sfx.tone(110, 0.6, 'sawtooth', 0.04, 220);
    } else if (e.t === 'end') {
      view.phase = e.win ? 'won' : 'lost'; RR.Music.sting(e.win ? 'win' : 'lose'); releaseTouch();
      try { if (document.exitPointerLock) document.exitPointerLock(); } catch (err) {}
      $('vig').style.opacity = 0;
    }
  },
  input: function () {
    const vh = vhQ; vhQ = false;
    const sm = smQ; smQ = false; const sk = skQ; skQ = false; const tt = ttQ; ttQ = null;
    return { t: 'i', x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, yaw: Math.round(me.yaw * 100) / 100,
      vh: vh || undefined, run: me.running && me.alive, air: me.y > 0.25 && me.alive, loud: loudT > 0 && me.alive, spk: spk, rs: !!keys.KeyE && me.alive, sm: sm, sk: sk, tt: tt === null ? undefined : tt };
  },
  setMonSkin: function (v) {
    RR.Game.settings.monSkin = v | 0;
    if (!ready) return;
    view.monsters.forEach(function (m) { scene.remove(m.group); });
    view.monsters = []; for (let i = 0; i < 6; i++) view.monsters.push(buildMonster(['fire', 'ice', 'poison', 'shadow'][i % 4]));
  },
  setQuality: function (q) { quality = q === 'low' || q === 'mid' ? q : 'high'; applyQuality(); },
  setBtnScale: function (v) { btnScale = Math.max(0.7, Math.min(1.5, +v || 1)); layoutButtons(); },
  editButtons: function () { setEditing(true); },
  toggleMic: function () {
    if (!Voice.hasMic()) {
      toast('正在開啟麥克風…');
      Voice.enableMic().then(function (ok) { if (ok) { Voice.setMuted(false); toast('麥克風已開啟'); } else RR.UI.say('無法開啟麥克風。請在瀏覽器允許麥克風權限後再按一次。'); tickHud(); });
      return;
    }
    Voice.setMuted(!Voice.isMuted()); tickHud();
  },
  toast: toast
};
})();
