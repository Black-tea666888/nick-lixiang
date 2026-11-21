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
const FX_COL = [0xfff1b0, 0x6ad8ff, 0xff7eb6, 0xb98cff, 0xff5a2a, 0xdfe8ff, 0x7dffb0, 0x4fa8ff];                          // 彈道特效顏色
function myEq(k) { const pm = view.players.get(myId); return !!(pm && pm.eq && pm.eq.indexOf(k) >= 0); }
function myGem(i) { const pm = view.players.get(myId); return pm && pm.gems ? pm.gems[i] | 0 : 0; }
function hpPct() { return Math.max(0, Math.min(100, me.hp / (myEq(4) ? 130 : 100) * 100)) + '%'; }
function myPet() { const pm = view.players.get(myId); return pm && pm.pet ? pm.pet : 0; }
// 背包容量：基礎 3 格 + 背包等級（每 10 等 +1，最多 +10）+ 大背包配件 + 推車
function myBt() { const pm = view.players.get(myId); return pm && pm.bt ? pm.bt | 0 : 0; }
function myCap() { const pm = view.players.get(myId); return W.BAG_MAX + (pm && pm.bt ? pm.bt | 0 : 0) + (myEq(2) ? 1 : 0) + (me.riding ? 2 : 0); }
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
// 煙霧彈：地上一個冒煙的罐子，煙團（柔邊雲朵貼圖）一顆顆冒出、擴散、往上飄，約 7 秒後散掉
function showCloud(x, z) {
  const g = new THREE.Group(), puffs = [], tex = getPuffTex();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10), new THREE.MeshLambertMaterial({ color: 0x4a5a3a }));
  can.position.set(0, 0.11, 0); can.rotation.z = Math.PI / 2; g.add(can);
  const N = 26;
  for (let i = 0; i < N; i++) {
    const shade = 0.56 + Math.random() * 0.14, sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(shade, shade, shade), transparent: true, opacity: 0, depthWrite: false, fog: false }));
    const a = Math.random() * 6.283, r = 0.4 + Math.random() * 1.6;
    sp.userData = { born: i * 0.06 + Math.random() * 0.1, x: Math.cos(a) * r, z: Math.sin(a) * r, dx: Math.cos(a), dz: Math.sin(a), y: 0.3 + Math.random() * 1.5, s: 1.6 + Math.random() * 1.4, rise: 0.06 + Math.random() * 0.1, spin: (Math.random() - 0.5) * 0.5, peak: 0.6 + Math.random() * 0.25 };
    sp.position.set(0, 0.2, 0); sp.scale.setScalar(0.1); g.add(sp); puffs.push(sp);
  }
  g.position.set(x, 0, z); scene.add(g);
  const t0 = Date.now(); let last = t0;
  const id = setInterval(function () {
    const now = Date.now(), t = (now - t0) / 1000, dt = (now - last) / 1000; last = now;
    puffs.forEach(function (sp) {
      const u = sp.userData, a = t - u.born; if (a < 0) return;
      const grow = Math.min(1, a / 1.2), ease = 1 - Math.pow(1 - grow, 3);
      const drift = a * 0.22;   // 慢慢往外散開
      sp.position.set(u.x * ease + u.dx * drift, 0.2 + (u.y - 0.2) * ease + a * u.rise, u.z * ease + u.dz * drift);
      sp.scale.setScalar(0.3 + u.s * ease + a * 0.22);
      sp.material.rotation += u.spin * dt;
      sp.material.opacity = (a < 0.4 ? a / 0.4 : t > 6 ? Math.max(0, (8.5 - t) / 2.5) : 1) * u.peak;
    });
    if (t >= 8.5) { clearInterval(id); scene.remove(g); can.geometry.dispose(); can.material.dispose(); puffs.forEach(function (sp) { sp.material.dispose(); }); }
  }, 30);
  Sfx.noise(0.5, 0.14); setTimeout(function () { Sfx.noise(1.6, 0.05); }, 200);   // 噗一聲＋嘶嘶聲
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
/** 冷卻中：圖示變淡，上面疊倒數秒數 */
function cdNum(id, left) {
  const el = $(id); if (!el) return;
  let n = el.querySelector('.cdNum'); if (!n) { n = document.createElement('b'); n.className = 'cdNum'; el.appendChild(n); }
  const t = left > 0 ? String(left) : ''; if (n.textContent !== t) { n.textContent = t; el.classList.toggle('cd', left > 0); }
}
/** 技能提示：自動跳出技能名稱與效果，技能鍵閃一下 */
function skillHint(head) {
  const t = RR.Game.skillText ? RR.Game.skillText() : ''; if (!t) return;
  toast(head + '｜' + t + (isTouchDev() ? '（按閃電鍵）' : '（按 R）'));
  const b = $('skill'); if (b) { b.classList.remove('ready'); void b.offsetWidth; b.classList.add('ready'); setTimeout(function () { b.classList.remove('ready'); }, 2100); }
}
/* 陀螺儀瞄準：轉動手機時把轉速加到視角（依直式／橫式換軸） */
let gyroOn = false, gyroT = 0;
function gyroSet(on) {
  gyroOn = !!on; try { localStorage.setItem('rr_gyro', on ? '1' : '0'); } catch (e) {}
  if (!on) return;
  const D = window.DeviceMotionEvent;
  if (D && typeof D.requestPermission === 'function') D.requestPermission().then(function (r) { if (r !== 'granted') { gyroOn = false; const c = $('setGyro'); if (c) c.checked = false; toast('沒有取得動作感應權限，陀螺儀瞄準已關閉'); } }).catch(function () {});
}
window.addEventListener('devicemotion', function (e) {
  const now = performance.now(), dt = Math.min(0.05, (now - (gyroT || now)) / 1000); gyroT = now;
  if (!gyroOn || !canControl() || !e.rotationRate || me.inLk) return;
  const r = e.rotationRate, D2R = Math.PI / 180, k = 1.1 * (settings.sens || 1) * dt * D2R;
  const ang = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
  const b = r.beta || 0, g = r.gamma || 0;
  let dy, dp;
  if (ang === 90) { dy = b; dp = -g; } else if (ang === 270 || ang === -90) { dy = -b; dp = g; } else { dy = g; dp = b; }
  me.yaw += dy * k; me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch + dp * k));
});
function renderTT() {
  const skLeft = Math.ceil((skEnd - Date.now()) / 1000);
  if (renderTT.prevSk > 0 && skLeft <= 0 && canControl()) skillHint('技能好了');
  renderTT.prevSk = skLeft;
  cdNum('skill', skLeft);
  cdNum('smoke', Math.ceil((smEnd - Date.now()) / 1000));
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
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:15;opacity:0;transition:opacity .6s;background:radial-gradient(60% 50% at 20% 30%,rgba(150,152,150,.88),rgba(150,152,150,0) 70%),radial-gradient(55% 45% at 80% 25%,rgba(138,140,138,.85),rgba(138,140,138,0) 70%),radial-gradient(70% 60% at 50% 80%,rgba(146,148,146,.9),rgba(146,148,146,0) 75%),rgba(120,122,120,.5)';
    document.body.appendChild(el);
  }
  el.style.opacity = '1'; clearTimeout(smokeT); smokeT = setTimeout(function () { el.style.opacity = '0'; }, 5000);
  Sfx.noise(0.3, 0.12);
}
// 字幕（畫面中央下方，約 2 秒後淡出）
// 字幕改用提示訊息條（紅色）
function showSub(text) { toast(text, 'warn'); }
const keys = {};
let scopeOn = false;   // 狙擊槍開鏡（Z 或「鏡」鍵）
let smQ = false, skQ = false, smokeT = null, padMesh = null, ttQ = null, trophyMesh = null, boardMesh = null;   // Q 丟煙霧彈（按一下送一次）
const touch = { joyId: null, lookId: null, ox: 0, oy: 0, jx: 0, jy: 0, lx: 0, ly: 0, run: false, runLock: false };
const settings = { sens: 1 };
// 手機改用 Lambert 材質（逐頂點打光），GPU 負擔約少一半，畫面差異很小；電腦維持 Phong
const LITE = ('ontouchstart' in window) || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
// 即時陰影：高畫質（電腦的標準畫質也開）時，手電筒與陽光會投出真的影子
let SHADOWS = false, dust = null, sunTgt = null;
function shadowWanted() { return quality === 'high' || (quality === 'mid' && !LITE); }
/** 角色、怪物身上的實心零件會投影（描邊外殼與腳下的圓形陰影除外） */
function castAll(g) { g.traverse(function (o) { if (o.isMesh && !o.material.transparent && o.material.side !== THREE.BackSide) o.castShadow = true; }); }
let glowTex = null;
function getGlowTex() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); glowTex = new THREE.CanvasTexture(cv); return glowTex;
}
/** 發光光暈（怪物眼睛）：加色混合的小貼片，暗處特別明顯 */
function glowSprite(col, s) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sp.scale.set(s, s, 1); return sp;
}
/** 空氣中飄的灰塵：圍著鏡頭的一團小點，慢慢飄，超出範圍就從另一邊繞回來 */
function buildDust() {
  const N = LITE ? 160 : 320, pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = Math.random() * 3.4; pos[i * 3 + 2] = (Math.random() - 0.5) * 16; vel[i * 3] = (Math.random() - 0.5) * 0.12; vel[i * 3 + 1] = (Math.random() - 0.5) * 0.05; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.12; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8d0b8, map: getGlowTex(), size: 0.03, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; pts.userData.vel = vel; return pts;
}
/* 賽車的車子：玩家自己的車跟著 me 走，其他車（AI）用主機傳來的位置 */
const RACE_COLS = [0xe0b040, 0x3a8fd9, 0x3fae5a, 0xd9573a];
let raceMyCar = null, raceAiCars = new Map();
function buildRaceCar(col) {
  const g = new THREE.Group(), body = pmat(col, 0.3), dark = pmat(0x1a2330, 0.2), wheel = pmat(0x161616, 0.1), skin = pmat(0xf2c9a0, 0.2);
  g.add(part(new THREE.BoxGeometry(1.0, 0.3, 1.9), body, 0, 0.36, 0));                                   // 車身底盤
  g.add(part(new THREE.BoxGeometry(0.62, 0.22, 0.6), body, 0, 0.56, -0.45));                              // 車頭（前端稍尖）
  g.add(part(new THREE.BoxGeometry(0.5, 0.16, 0.45), dark, 0, 0.27, -1.05));                              // 前保險桿
  g.add(part(new THREE.SphereGeometry(0.22, 12, 10), skin, 0, 0.72, 0.1));                                // 駕駛
  g.add(part(new THREE.BoxGeometry(0.5, 0.36, 0.16), dark, 0, 0.72, 0.42));                               // 座椅靠背
  g.add(part(new THREE.BoxGeometry(1.1, 0.08, 0.32), body, 0, 0.98, 0.95));                               // 尾翼
  [-0.5, 0.5].forEach(function (x) { g.add(part(new THREE.BoxGeometry(0.08, 0.36, 0.08), dark, x, 0.78, 0.95)); });
  const wGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.26, 14);
  [[-0.58, 0.28, -0.66], [0.58, 0.28, -0.66], [-0.6, 0.3, 0.66], [0.6, 0.3, 0.66]].forEach(function (w) {
    const m = part(wGeo, wheel, w[0], w[1], w[2]); m.rotation.z = Math.PI / 2; g.add(m);
  });
  // 加速火焰（噴射時才顯示）
  const flame = part(new THREE.ConeGeometry(0.32, 1.3, 10), new THREE.MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.8, depthWrite: false, fog: false }), 0, 0.4, 1.7);
  flame.rotation.x = Math.PI / 2; flame.visible = false; g.add(flame); g.userData.flame = flame;
  return g;
}
function syncRaceAi(list) {
  const seen = new Set();
  list.forEach(function (a, i) {
    seen.add(a[0]);
    let m = raceAiCars.get(a[0]);
    if (!m) { m = buildRaceCar(RACE_COLS[(i + 1) % RACE_COLS.length]); scene.add(m); raceAiCars.set(a[0], m); }
    m.visible = true; m.position.set(a[1], 0, a[2]); m.rotation.y = a[3];
  });
  raceAiCars.forEach(function (m, id) { if (!seen.has(id)) { scene.remove(m); raceAiCars.delete(id); } });
}
function clearRaceAi() { raceAiCars.forEach(function (m) { scene.remove(m); }); raceAiCars.clear(); }
/* 賽車賽道：在地面畫出該場地的賽道路線（BFS 貼著通道走），並在起點畫白色終點線 */
let raceTrackMesh = null;
function buildRaceTrack(map) {
  if (raceTrackMesh) { scene.remove(raceTrackMesh); raceTrackMesh.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); raceTrackMesh = null; }
  if (map < 0 || typeof MAPS === 'undefined' || !MAPS[map]) return;
  const cells = raceTrackOf(map).map(function (q) { return [q[1], q[0]]; }), pts = [];
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i], b = cells[(i + 1) % cells.length], path = bfs(a[0], a[1], b[0], b[1]) || [a];
    path.slice(0, -1).forEach(function (c) { pts.push(center(c[0], c[1])); });
  }
  if (pts.length < 2) return;
  const g = new THREE.Group(), road = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.01) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, L + 0.2), road);
    m.rotation.set(-Math.PI / 2, Math.atan2(-dx, -dz), 0, 'YXZ');
    m.position.set((a[0] + b[0]) / 2, 0.03, (a[1] + b[1]) / 2);
    g.add(m);
  }
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, fog: false }));
  fin.rotation.x = -Math.PI / 2; fin.position.set(pts[0][0], 0.04, pts[0][1]); g.add(fin);
  // 彈跳台：沿路線隔一段放一個；靠牆的那幾個是近道（跳過牆），顏色跟地板很像，不容易發現
  raceRamps = [];
  for (let i = 9, k = 0; i < pts.length - 2; i += 14, k++) {
    const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
    const cell = [Math.floor(p[0] / CS), Math.floor(p[1] / CS)];
    const nearWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) { return W.isWall(cell[0] + d[0], cell[1] + d[1]); });
    const sc = nearWall && k % 2 === 0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.4), new THREE.MeshBasicMaterial({ color: sc ? 0x6b6257 : 0xff8a3a, fog: false }));
    m.position.set(p[0], 0.07, p[1]); m.rotation.y = Math.atan2(-dx, -dz); g.add(m);
    raceRamps.push({ x: p[0], z: p[1], dx: dx / L, dz: dz / L, sc: sc, t: 0 });
  }
  // 道具箱：沿路線每隔一段放一個，拿到後 4 秒重生
  raceBoxes = [];
  for (let i = 5; i < pts.length; i += 10) {
    const p = pts[i], m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
    m.position.set(p[0], 0.9, p[1]); g.add(m); raceBoxes.push({ x: p[0], z: p[1], m: m, on: true, t: 0 });
  }
  raceTrackMesh = g; scene.add(g);
}
let raceBoxes = [], raceUseQ = false, raceRamps = [];
/* 道具：目前只有「加速」（按 E 或按鈕使用，噴射 1.3 秒）。拿到道具箱就有一個，用掉才會再拿 */
function raceUseItem() {
  if (!me.item) { toast('還沒有道具，去撞黃色道具箱'); return; }
  me.boostT = Math.max(me.boostT || 0, 1.3); me.item = null; Sfx.tone(780, 0.1, 'triangle', 0.06, 1200);
}
function raceTickBoxes(dt) {
  if (!me.alive) return;
  raceBoxes.forEach(function (b) {
    if (!b.on) { b.t -= dt; if (b.t <= 0) { b.on = true; b.m.visible = true; } return; }
    b.m.rotation.y += dt * 1.8;
    if (me.alive && !me.item && Math.hypot(me.x - b.x, me.z - b.z) < 1.4) { b.on = false; b.t = 4; b.m.visible = false; me.item = 'boost'; toast('拿到道具：加速（按 E 或道具鈕）'); Sfx.tone(520, 0.08, 'square', 0.05, 880); }
  });
}
document.getElementById('raceUse') && document.getElementById('raceUse').addEventListener('click', function () { if (view.mode === 'race') raceUseItem(); });
function tickRaceCars(dt) {
  const on = view.mode === 'race' && me.alive;
  if (on && !raceMyCar) { raceMyCar = buildRaceCar(0xd9573a); scene.add(raceMyCar); }
  if (raceMyCar) { raceMyCar.visible = on; if (on) { raceMyCar.position.set(me.x, 0, me.z); raceMyCar.rotation.y = me.yaw; raceMyCar.userData.flame.visible = (me.boostT || 0) > 0 || (me.nitroT || 0) > 0; } }
  const ub = document.getElementById('raceUse');
  if (ub) { ub.classList.toggle('hide', !(view.mode === 'race' && me.alive)); ub.textContent = me.item ? '加速道具（E）' : '無道具'; ub.disabled = !me.item; }
  if (keys.KeyE && !raceUseQ) { if (view.mode === 'race') raceUseItem(); }
  raceUseQ = !!keys.KeyE;
  if (view.mode === 'race' && me.ckX == null) { me.ckX = me.x; me.ckZ = me.z; me.ckYaw = me.yaw; }   // 復位點：這局開始的位置
  raceTickRamps(dt || 0.016);
  if (keys.KeyN && !raceNitroQ) { if (view.mode === 'race') raceNitro(); }
  raceNitroQ = !!keys.KeyN;
  if (keys.KeyR && !raceResetQ) { if (view.mode === 'race' && me.alive) raceRespawn(false); }
  raceResetQ = !!keys.KeyR;
  const bn = document.getElementById('raceNitro'), br = document.getElementById('raceReset'), st = document.getElementById('raceStat');
  const rOn = view.mode === 'race' && me.alive;
  [bn, br, st].forEach(function (el) { if (el) el.classList.toggle('hide', !rOn); });
  if (bn) { bn.disabled = (me.nitro || 0) < 1; bn.textContent = '氮氣 ' + Math.floor((me.nitro || 0) * 100) + '%'; }
  if (st && rOn) st.textContent = '車況 ' + Math.ceil(me.hp == null ? 100 : me.hp) + '%'
    + (me.drifting ? '　集氣 ' + Math.min(100, Math.floor((me.charge || 0) / 2.2 * 100)) + '%' : '')
    + (me.nitroT > 0 ? '　氮氣中' : '') + (me.pauseT > 0 ? '　爆炸復位中' : '');
  if (view.mode === 'race' && (me.hitFlash || 0) > 0) { me.hitFlash = Math.max(0, me.hitFlash - dt); const fl = $('flash'); if (fl) fl.style.opacity = (me.hitFlash * 0.8).toFixed(2); }
}
let raceNitroQ = false, raceResetQ = false;
/* 不同角色的彈射力道不一樣（0.9 到 1.15 倍） */
const RACE_LAUNCH_K = [1, 0.95, 1.1, 1, 1.15, 0.9, 1.05, 1];
/* 彈射需要的漂移角度倍率：越小越容易彈射，越大要甩得更開 */
const RACE_SLING_K = [1, 0.9, 1.1, 1, 1.2, 0.85, 1, 1];
/* 彈跳台：在地上、速度夠快經過就彈起來；近道的力道足以跳過牆 */
function raceTickRamps(dt) {
  if (!me.alive || view.mode !== 'race') return;
  const k = RACE_LAUNCH_K[myC() % RACE_LAUNCH_K.length] || 1;
  raceRamps.forEach(function (r) {
    if (r.t > 0) { r.t -= dt; return; }
    if (Math.hypot(me.x - r.x, me.z - r.z) > 0.9 || (me.spd || 0) < 5) return;
    if (me.vy !== 0 || me.y > groundAt(me.x, me.z) + 0.05) return;
    me.vy = (r.sc ? 11 : 6.5) * k; me.air2 = false;
    r.t = 1.5;
    Sfx.tone(r.sc ? 380 : 600, 0.12, 'triangle', 0.08, r.sc ? 500 : 900);
  });
}
document.getElementById('raceNitro') && document.getElementById('raceNitro').addEventListener('click', function () { if (view.mode === 'race') raceNitro(); });
document.getElementById('raceReset') && document.getElementById('raceReset').addEventListener('click', function () { if (view.mode === 'race' && me.alive) raceRespawn(false); });
/* 氮氣：開滿（1 格）才能按，短暫衝到更高速 */
function raceNitro() { if ((me.nitro || 0) >= 1 && !(me.nitroT > 0) && !(me.pauseT > 0)) { me.nitroT = 2.2; me.nitro = 0; Sfx.tone(300, 0.2, 'sawtooth', 0.06, 900); } }
/* 撞牆：車速大時扣車況、減速；車況 0 就爆炸，停 3 秒後強制復位 */
function raceImpact(bx, bz, dx, dz) {
  const want = Math.hypot(dx, dz), got = Math.hypot(me.x - bx, me.z - bz);
  if (want < 0.05 || got > want * 0.5 || me.pauseT > 0) return;
  const hit = Math.abs(me.spd || 0);
  me.spd *= 0.35;                                  // 撞牆減速
  if (hit < 3 || (me.hitCd || 0) > 0) return;
  me.hitCd = 0.3; me.hitFlash = 0.3;
  me.hp = Math.max(0, (me.hp == null ? 100 : me.hp) - Math.min(18, hit * 1.1));
  Sfx.noise(0.08, 0.1);
  if (me.hp <= 0) raceExplode();
}
function raceExplode() {
  me.hp = 0; me.pauseT = 3; me.spd = 0; me.boostT = 0; me.nitroT = 0;
  Sfx.noise(0.5, 0.2); toast('車子爆炸了！3 秒後強制復位');
}
/* 復位：回到這局的起點（爆炸後車況會補滿；手動復位不補） */
function raceRespawn(full) {
  if (me.ckX == null) return;
  me.x = me.ckX; me.z = me.ckZ; me.yaw = me.ckYaw;
  me.spd = 0; me.slideAng = 0; me.drifting = false; me.charge = 0; me.boostT = 0; me.nitroT = 0; me.pauseT = 0;
  if (full) me.hp = 100;
  toast(full ? '已復位，車況補滿' : '已復位');
}
/* 賽車操控（卡丁車）：油門加減速、方向盤轉向；按住「漂移」（Shift）過彎會甩尾並累積氣，放開時依氣量噴射加速 */
const RACE_VMAX = 11;
function raceDrive(f, steer, dt, driftKey) {
  if (me.spd == null) me.spd = 0;
  if (me.boostT == null) me.boostT = 0;
  if (me.pauseT > 0) { me.pauseT -= dt; me.spd = 0; if (me.pauseT <= 0) raceRespawn(true); return; }   // 爆炸後停 3 秒
  if (me.hitCd > 0) me.hitCd -= dt;
  me.nitro = Math.min(1, (me.nitro || 0) + (me.nitroT > 0 ? 0 : (me.spd > 6 ? dt * 0.12 : 0) + (me.drifting ? dt * 0.1 : 0)));
  if (me.nitroT > 0) me.nitroT -= dt;
  const boosting = me.boostT > 0 || me.nitroT > 0;
  const vmax = RACE_VMAX * (me.nitroT > 0 ? 1.7 : boosting ? 1.45 : 1);
  const target = f >= 0 ? vmax * f : 4 * f;                       // 倒車慢慢退
  me.spd += (target - me.spd) * Math.min(1, dt * (target > me.spd ? 2.2 : 3.5));
  const frac = Math.min(1, Math.abs(me.spd) / RACE_VMAX);
  const canDrift = !!driftKey && Math.abs(steer) > 0.35 && me.spd > 6;
  if (canDrift) { if (!me.drifting) { me.drifting = true; me.charge = 0; } me.charge = (me.charge || 0) + dt * (0.6 + frac); }
  const turn = 2.2 * (me.drifting ? 1.6 : 0.5 + 0.5 * frac);
  me.yaw -= steer * turn * dt * (me.spd < -0.5 ? -1 : 1);       // 倒車時方向盤反過來，跟真車一樣
  me.slideAng = (me.slideAng || 0) + ((me.drifting ? -steer * 0.45 : 0) - (me.slideAng || 0)) * Math.min(1, dt * 6);
  if (me.drifting && !canDrift) {                                  // 放開漂移
    const c = me.charge || 0, ang = Math.abs(me.slideAng || 0);
    const sling = 0.3 * (RACE_SLING_K[myC() % RACE_SLING_K.length] || 1);   // 每個角色彈射需要的角度不一樣
    if (c >= 0.9 && ang >= sling) {                                // 彈射：角度夠大，放開像彈弓一樣衝出去
      me.boostT = c >= 2.2 ? 1.6 : 0.9;
      me.spd = Math.max(me.spd, RACE_VMAX * 1.35);
      Sfx.tone(660, 0.12, 'square', 0.05, 980);
    } else if (c >= 0.4 && ang >= 0.12) {                          // 小噴：角度較小，只有短暫加速
      me.boostT = Math.max(me.boostT, 0.35);
      Sfx.tone(520, 0.08, 'square', 0.03, 700);
    }
    me.drifting = false; me.charge = 0;
  }
  if (me.boostT > 0) me.boostT = Math.max(0, me.boostT - dt);
}
function tickFx(dt) {
  if (dust) {
    const p = dust.geometry.attributes.position.array, v = dust.userData.vel, cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] += v[i + 2] * dt;
      if (p[i] - cx > 8) p[i] -= 16; else if (p[i] - cx < -8) p[i] += 16;
      if (p[i + 2] - cz > 8) p[i + 2] -= 16; else if (p[i + 2] - cz < -8) p[i + 2] += 16;
      if (p[i + 1] > 3.4) p[i + 1] = 0.1; else if (p[i + 1] < 0.05) p[i + 1] = 3.3;
    }
    dust.geometry.attributes.position.needsUpdate = true;
  }
  // 陽光的陰影範圍跟著玩家走（只算附近 30 公尺，影子比較清楚）
  if (sun && sun.castShadow && sunTgt) {
    sunTgt.position.set(camera.position.x, 0, camera.position.z);
    sun.position.set(camera.position.x + 18, 40, camera.position.z + 12);
  }
}
function applyShadows() {
  if (!renderer) return;
  const on = shadowWanted();
  if (on !== SHADOWS) { SHADOWS = on; renderer.shadowMap.enabled = on; if (scene) scene.traverse(function (o) { if (o.material) [].concat(o.material).forEach(function (m) { m.needsUpdate = true; }); }); }
  if (torch) torch.castShadow = on && !(baseLight && baseLight.open);
  if (sun) sun.castShadow = on && !!(baseLight && baseLight.open);
}
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
let ksN = 0, ksT = 0, uavT = 0, airCdT = 0;   // 連殺數、最後擊倒時間、無人機剩餘秒數、空襲冷卻
let shakeT = 0, jumpQ = false, dashQ = false, dashT = 0, dashCd = 0, dashDir = [0, 0];
me.y = 0; me.vy = 0;
// 提示訊息條：深色底板＋左側色條（warn 紅、good 綠、info 黃），時間依字數調整
const WARN_RE = /用完|不夠|冷卻|不能|沒子彈|滿了|扣血|被抓|殺了|你被|危險|小心|闖進|發現你|地震|失敗|中斷/;
const GOOD_RE = /獲得|撿到|加血|救起|成功|蓋好|命中|已傳回|掙脫|護盾|隱身|開啟了|完成/;
function toast(msg, kind) {
  const el = $('toast');
  kind = kind || (WARN_RE.test(msg) ? 'warn' : GOOD_RE.test(msg) ? 'good' : 'info');
  el.textContent = msg; el.className = 'k-' + kind;
  void el.offsetWidth; el.classList.add('show');
  toastT = Math.min(4.2, 1.8 + msg.length * 0.07);
}
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
/* ---------- 場景細節：天空漸層、牆面／地面紋理、樹、遠景、地面小物 ---------- */
// 各開放地圖的天空（上方、地平線）與壓頂／地面小物設定
const SKY = { beach: [0x4aa8e8, 0xd6eef9], city: [0x5f4f92, 0xf5ae78], forest: [0x58a4da, 0xd7ecef], snow: [0x8eb2d4, 0xedf3f7], park: [0x76649f, 0xffbf8a], site: [0x4c93d6, 0xd9e9f4], station: [0x6aaee0, 0xcfe9f5], rest: [0xe0865a, 0xf7c99a], fair: [0x6fb8ff, 0xffe6f0], field: [0x9ad8ff, 0xf2fbff], market: [0x141733, 0x3b3366] };
// 有貼圖的地圖樣式（牆、地）
const WALL_STYLES = ['beach', 'forest', 'snow', 'park', 'site', 'hospital', 'garage', 'subway', 'dock', 'library', 'crypt', 'station', 'rest', 'fair', 'field', 'market'];
const FLOOR_STYLES = ['hospital', 'garage', 'subway', 'dock', 'library', 'crypt'];
const CAP = { beach: [0xd9c9a0, 0.12, 0.1], snow: [0xf6f9fc, 0.3, 0.16], park: [0xf1e7d8, 0.1, 0.08], site: [0xb8b6ad, 0.1, 0.08] };
let skyDome = null;
// 把多個幾何（各帶一個矩陣與顏色）合成一個，讓同一種東西只要一次繪製
// 回收品模型：每種東西用幾個小零件組成（顏色寫在頂點上）
let salvageM = null;
function salvageMat() { if (!salvageM) salvageM = litMat({ vertexColors: true }); return salvageM; }
function salvageGeo(k) {
  const P = [], T = function (g, x, y, z, rx, ry, rz, c) { P.push([g, M4(x, y, z, rx || 0, ry || 0, rz || 0), c]); };
  const B = function (sx, sy, sz) { return new THREE.BoxGeometry(sx, sy, sz); }, C = function (r, h) { return new THREE.CylinderGeometry(r, r, h, 14); };
  if (k === 0) {   // 齒輪
    T(new THREE.TorusGeometry(0.3, 0.09, 8, 22), 0, 0, 0, 0, 0, 0, 0xb08d3a);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; T(B(0.13, 0.14, 0.12), Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0, 0, 0, a, 0xb08d3a); }
    T(C(0.13, 0.16), 0, 0, 0, Math.PI / 2, 0, 0, 0x7a5c24);
  } else if (k === 1) {   // 電池
    T(B(0.6, 0.32, 0.3), 0, 0, 0, 0, 0, 0, 0x2a2e33);
    T(B(0.4, 0.33, 0.31), -0.04, 0, 0, 0, 0, 0, 0xd23a2a);
    T(C(0.07, 0.06), 0.3, 0.1, 0.06, Math.PI / 2, 0, 0, 0xf0c020); T(C(0.07, 0.06), 0.3, -0.1, -0.06, Math.PI / 2, 0, 0, 0xc0c0c0);
  } else if (k === 2) {   // 銅線圈
    [-0.12, 0, 0.12].forEach(function (z) { T(new THREE.TorusGeometry(0.3, 0.07, 8, 20), 0, 0, z, 0, 0, 0, 0xc8793a); });
    T(C(0.1, 0.5), 0, 0, 0, Math.PI / 2, 0, 0, 0x9a9a9a);
  } else if (k === 3) {   // 舊收音機
    T(B(0.7, 0.44, 0.3), 0, 0, 0, 0, 0, 0, 0x7a4a2a);
    T(new THREE.CircleGeometry(0.14, 16), 0.12, -0.04, 0.16, 0, 0, 0, 0x2a2420);
    T(B(0.2, 0.12, 0.02), -0.2, 0.1, 0.16, 0, 0, 0, 0xe8dcc0);
    T(C(0.012, 0.6), 0.22, 0.42, 0, 0, 0, -0.5, 0xbfc5cc);
  } else if (k === 4) {   // 玩具積木
    T(B(0.34, 0.32, 0.34), -0.12, -0.14, 0, 0, 0, 0, 0x2a6fb8);
    T(B(0.34, 0.32, 0.34), 0.14, -0.14, 0, 0, 0, 0, 0xf2c12e);
    T(new THREE.SphereGeometry(0.2, 14, 10), 0.0, 0.14, 0, 0, 0, 0, 0xd9423a);
  } else if (k === 5) {   // 馬達
    T(C(0.26, 0.5), 0, 0, 0, 0, 0, Math.PI / 2, 0xb8c0c8);
    T(C(0.27, 0.12), 0.28, 0, 0, 0, 0, Math.PI / 2, 0xc23a2a);
    T(C(0.03, 0.22), -0.36, 0, 0, 0, 0, Math.PI / 2, 0x6a6a6a);
  } else if (k === 6) {   // 金條
    T(B(0.7, 0.24, 0.38), 0, 0, 0, 0, 0, 0, 0xf2c230);
    T(B(0.5, 0.26, 0.2), 0, 0.02, 0, 0, 0, 0, 0xffe27a);
  } else if (k === 7) {   // 燈泡
    T(new THREE.SphereGeometry(0.24, 16, 12), 0, 0.1, 0, 0, 0, 0, 0xfff3c0);
    T(C(0.13, 0.2), 0, -0.2, 0, 0, 0, 0, 0x9a9a9a);
    T(B(0.14, 0.06, 0.14), 0, -0.34, 0, 0, 0, 0, 0x5a5a5a);
  } else if (k === 8) {   // 電路板
    T(B(0.72, 0.05, 0.52), 0, 0, 0, 0, 0, 0, 0x2e7d4a);
    [[-0.2, 0.1], [0.12, -0.08], [0.2, 0.14], [-0.1, -0.16]].forEach(function (q) { T(B(0.16, 0.06, 0.14), q[0], 0.05, q[1], 0, 0, 0, 0x222222); });
    for (let i = 0; i < 6; i++) T(B(0.04, 0.04, 0.12), -0.3 + i * 0.12, 0.04, 0.26, 0, 0, 0, 0xd4a017);
  } else if (k === 9) {   // 儀表
    T(C(0.3, 0.1), 0, 0, 0, Math.PI / 2, 0, 0, 0xf2f2ef);
    T(new THREE.TorusGeometry(0.3, 0.05, 8, 22), 0, 0, 0.05, 0, 0, 0, 0x2a2a2a);
    T(B(0.04, 0.22, 0.02), 0, 0.1, 0.07, 0, 0, 0.6, 0xd23a2a);
  } else {   // 鐵罐
    T(C(0.2, 0.55), 0, 0, 0, 0, 0, 0, 0xa9b0b8);
    T(C(0.205, 0.2), 0, 0, 0, 0, 0, 0, 0xd23a2a);
    T(C(0.19, 0.02), 0, 0.28, 0, 0, 0, 0, 0x8a9098);
  }
  return mergeGeos(P);
}

/** 回收物的真實物品造型：每一種回收物有好幾種長相（同一種的價值一樣），v＝第幾款 */
function realGeo(k, v) {
  const P = [], T = function (g, x, y, z, rx, ry, rz, c) { P.push([g, M4(x, y, z, rx || 0, ry || 0, rz || 0), c]); };
  const B = function (sx, sy, sz) { return new THREE.BoxGeometry(sx, sy, sz); }, C = function (r, h, n) { return new THREE.CylinderGeometry(r, r, h, n || 16); };
  const Cy = function (a, b, h, n) { return new THREE.CylinderGeometry(a, b, h, n || 16); }, S = function (r) { return new THREE.SphereGeometry(r, 16, 12); };
  const Tor = function (R, r, arc) { return new THREE.TorusGeometry(R, r, 8, 24, arc || Math.PI * 2); };
  const H = Math.PI / 2;
  const key = k * 10 + v;
  switch (key) {
    case 1: {   // 腳踏車輪
      T(Tor(0.38, 0.04), 0, 0, 0, 0, 0, 0, 0x1c1c1c); T(Tor(0.34, 0.015), 0, 0, 0, 0, 0, 0, 0xbfc5cc);
      for (let i = 0; i < 12; i++) T(C(0.006, 0.66, 4), 0, 0, 0, 0, 0, i / 12 * Math.PI, 0xd0d4d8);
      T(C(0.05, 0.12), 0, 0, 0, H, 0, 0, 0x8a9098); break; }
    case 2:     // 扳手
      T(B(0.62, 0.08, 0.04), 0, 0, 0, 0, 0, 0.3, 0xa8afb6); T(Tor(0.09, 0.035, Math.PI * 1.5), 0.32, 0.1, 0, 0, 0, 0.3 - 2.3, 0xa8afb6);
      T(Tor(0.07, 0.03), -0.32, -0.1, 0, 0, 0, 0, 0xa8afb6); break;
    case 11:    // 兩顆 3 號電池
      [-0.11, 0.11].forEach(function (x) { T(C(0.1, 0.5), x, 0, 0, 0, 0, 0, 0x1f1f22); T(C(0.102, 0.18), x, 0.12, 0, 0, 0, 0, 0xd9a520); T(C(0.035, 0.04), x, 0.27, 0, 0, 0, 0, 0xc8c8c8); }); break;
    case 12:    // 行動電源
      T(B(0.36, 0.62, 0.12), 0, 0, 0, 0, 0, 0, 0xe8e8ea); T(B(0.3, 0.06, 0.125), 0, 0.2, 0, 0, 0, 0, 0x3a7bd5);
      T(B(0.1, 0.03, 0.04), 0, -0.31, 0, 0, 0, 0, 0x2a2a2a); [0, 1, 2, 3].forEach(function (i) { T(S(0.015), -0.06 + i * 0.04, 0.12, 0.065, 0, 0, 0, i < 3 ? 0x5affa0 : 0x444444); }); break;
    case 21:    // 延長線捲盤
      T(C(0.3, 0.03), 0, 0, -0.16, H, 0, 0, 0xe0442e); T(C(0.3, 0.03), 0, 0, 0.16, H, 0, 0, 0xe0442e);
      T(C(0.22, 0.3), 0, 0, 0, H, 0, 0, 0xf2f2f2); T(B(0.2, 0.12, 0.1), 0, 0.3, 0, 0, 0, 0, 0xe0442e); T(B(0.04, 0.4, 0.04), 0, 0.12, 0.2, 0, 0, 0, 0x2a2a2a); break;
    case 22:    // 耳機
      T(Tor(0.3, 0.035, Math.PI), 0, 0, 0, 0, 0, 0, 0x2a2a2e);
      [-0.3, 0.3].forEach(function (x) { T(C(0.14, 0.1), x, -0.04, 0, 0, 0, H, 0x2a2a2e); T(C(0.12, 0.11), x, -0.04, 0, 0, 0, H, 0xd23a3a); }); break;
    case 31:    // 映像管電視
      T(B(0.7, 0.54, 0.5), 0, 0, 0, 0, 0, 0, 0x5a4636); T(B(0.48, 0.38, 0.02), -0.06, 0.02, 0.26, 0, 0, 0, 0x2d3a3a);
      T(C(0.03, 0.04), 0.27, 0.12, 0.26, H, 0, 0, 0xc8c0a8); T(C(0.03, 0.04), 0.27, -0.02, 0.26, H, 0, 0, 0xc8c0a8);
      T(C(0.008, 0.5), -0.1, 0.45, 0, 0, 0, 0.5, 0xbfc5cc); T(C(0.008, 0.5), 0.1, 0.45, 0, 0, 0, -0.5, 0xbfc5cc); break;
    case 32:    // 錄音帶
      T(B(0.62, 0.4, 0.07), 0, 0, 0, 0, 0, 0, 0x1f1f22); T(B(0.48, 0.18, 0.075), 0, 0.06, 0, 0, 0, 0, 0xf0e2c0);
      [-0.14, 0.14].forEach(function (x) { T(C(0.06, 0.08), x, 0.06, 0, H, 0, 0, 0xfafafa); T(C(0.025, 0.085), x, 0.06, 0, H, 0, 0, 0x3a3a3a); }); break;
    case 41:    // 泰迪熊
      T(S(0.22), 0, -0.08, 0, 0, 0, 0, 0xb07a44); T(S(0.17), 0, 0.24, 0, 0, 0, 0, 0xb07a44); T(S(0.07), 0, 0.2, 0.15, 0, 0, 0, 0xe0c090);
      T(S(0.065), -0.13, 0.38, 0, 0, 0, 0, 0xb07a44); T(S(0.065), 0.13, 0.38, 0, 0, 0, 0, 0xb07a44); T(S(0.025), 0, 0.22, 0.21, 0, 0, 0, 0x1a1a1a);
      T(S(0.02), -0.06, 0.28, 0.15, 0, 0, 0, 0x1a1a1a); T(S(0.02), 0.06, 0.28, 0.15, 0, 0, 0, 0x1a1a1a);
      [[-0.2, -0.02], [0.2, -0.02], [-0.11, -0.28], [0.11, -0.28]].forEach(function (q) { T(S(0.08), q[0], q[1], 0.04, 0, 0, 0, 0xb07a44); }); break;
    case 42:    // 小黃鴨
      T(S(0.24), 0, -0.06, 0, 0, 0, 0, 0xffd21f); T(S(0.15), 0, 0.2, 0.08, 0, 0, 0, 0xffd21f);
      T(Cy(0.02, 0.07, 0.14, 8), 0, 0.18, 0.26, H, 0, 0, 0xff8a1f); T(S(0.025), -0.07, 0.25, 0.2, 0, 0, 0, 0x1a1a1a); T(S(0.025), 0.07, 0.25, 0.2, 0, 0, 0, 0x1a1a1a); break;
    case 43:    // 玩具車
      T(B(0.6, 0.16, 0.3), 0, -0.04, 0, 0, 0, 0, 0xd23a3a); T(B(0.32, 0.14, 0.28), -0.04, 0.1, 0, 0, 0, 0, 0xd23a3a); T(B(0.3, 0.1, 0.285), -0.04, 0.1, 0, 0, 0, 0, 0x9fd8f0);
      [[-0.2, 0.15], [0.2, 0.15], [-0.2, -0.15], [0.2, -0.15]].forEach(function (q) { T(C(0.07, 0.05), q[0], -0.12, q[1], H, 0, 0, 0x1a1a1a); }); break;
    case 51: {  // 電風扇
      T(C(0.2, 0.05), 0, -0.36, 0, 0, 0, 0, 0xf2f2f2); T(C(0.03, 0.4), 0, -0.14, 0, 0, 0, 0, 0xf2f2f2); T(C(0.08, 0.14), 0, 0.12, -0.04, H, 0, 0, 0xf2f2f2);
      T(Tor(0.25, 0.012), 0, 0.12, 0.06, 0, 0, 0, 0xd0d4d8); for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; T(B(0.1, 0.2, 0.01), Math.cos(a) * 0.12, 0.12 + Math.sin(a) * 0.12, 0.06, 0, 0, a + H, 0x6ac8ff); } break; }
    case 52:    // 電鑽
      T(Cy(0.08, 0.1, 0.42), 0, 0.1, 0, 0, 0, H, 0xf2a21f); T(B(0.1, 0.32, 0.12), 0.06, -0.12, 0, 0, 0, -0.2, 0x2a2a2a);
      T(B(0.2, 0.08, 0.16), 0.1, -0.3, 0, 0, 0, 0, 0x2a2a2a); T(C(0.015, 0.2), -0.3, 0.1, 0, 0, 0, H, 0xbfc5cc); break;
    case 61:    // 金錶
      T(C(0.16, 0.05), 0, 0, 0, H, 0, 0, 0xf2c230); T(C(0.13, 0.055), 0, 0, 0, H, 0, 0, 0xfaf6e8);
      T(B(0.12, 0.3, 0.03), 0, 0.28, -0.01, 0, 0, 0, 0xe0b028); T(B(0.12, 0.3, 0.03), 0, -0.28, -0.01, 0, 0, 0, 0xe0b028);
      T(B(0.01, 0.09, 0.01), 0, 0.04, 0.03, 0, 0, 0, 0x1a1a1a); T(B(0.07, 0.01, 0.01), 0.03, 0, 0.03, 0, 0, 0, 0x1a1a1a); break;
    case 62:    // 獎盃
      T(Cy(0.22, 0.08, 0.32, 18), 0, 0.16, 0, 0, 0, 0, 0xf2c230); T(C(0.03, 0.18), 0, -0.08, 0, 0, 0, 0, 0xf2c230);
      T(B(0.28, 0.1, 0.2), 0, -0.22, 0, 0, 0, 0, 0x3a2a1a); T(Tor(0.08, 0.02, Math.PI), -0.22, 0.18, 0, 0, 0, H, 0xf2c230); T(Tor(0.08, 0.02, Math.PI), 0.22, 0.18, 0, 0, 0, -H, 0xf2c230); break;
    case 71:    // 檯燈
      T(C(0.16, 0.04), 0, -0.34, 0, 0, 0, 0, 0x2a2a2e); T(C(0.02, 0.4), 0.04, -0.14, 0, 0, 0, -0.25, 0x2a2a2e); T(C(0.02, 0.3), 0.12, 0.14, 0, 0, 0, 0.8, 0x2a2a2e);
      T(Cy(0.06, 0.16, 0.18, 16), 0.0, 0.24, 0, 0, 0, 2.2, 0x2fa36b); T(S(0.05), -0.04, 0.2, 0, 0, 0, 0, 0xfff3c0); break;
    case 72:    // 手電筒
      T(C(0.07, 0.5), 0, 0, 0, 0, 0, H, 0x2a2a2e); T(Cy(0.12, 0.08, 0.14, 16), -0.3, 0, 0, 0, 0, H, 0x2a2a2e); T(C(0.105, 0.02), -0.37, 0, 0, 0, 0, H, 0xfff3c0);
      T(B(0.06, 0.03, 0.04), 0.05, 0.075, 0, 0, 0, 0, 0xd23a3a); break;
    case 81:    // 智慧型手機
      T(B(0.32, 0.62, 0.05), 0, 0, 0, 0, 0, 0, 0x1a1a1e); T(B(0.29, 0.56, 0.01), 0, 0, 0.026, 0, 0, 0, 0x2a4a7a);
      T(S(0.02), 0, 0.26, 0.03, 0, 0, 0, 0x0a0a0a); T(C(0.03, 0.01), 0.08, 0.22, -0.03, H, 0, 0, 0x3a3a3a); break;
    case 82:    // 筆記型電腦
      T(B(0.62, 0.03, 0.44), 0, -0.2, 0, 0, 0, 0, 0xb8bec4); T(B(0.54, 0.005, 0.24), 0, -0.183, -0.04, 0, 0, 0, 0x2a2a2e);
      T(B(0.62, 0.42, 0.025), 0, 0.0, -0.24, -0.25, 0, 0, 0xb8bec4); T(B(0.56, 0.36, 0.005), 0, 0.0, -0.225, -0.25, 0, 0, 0x2a5a8a); break;
    case 91:    // 鬧鐘
      T(C(0.24, 0.12), 0, 0, 0, H, 0, 0, 0xd23a3a); T(C(0.2, 0.125), 0, 0, 0, H, 0, 0, 0xfaf6e8);
      T(S(0.09), -0.16, 0.24, 0, 0, 0, 0, 0xc8c8c8); T(S(0.09), 0.16, 0.24, 0, 0, 0, 0, 0xc8c8c8);
      T(C(0.02, 0.14), -0.16, -0.26, 0, 0, 0, 0.4, 0x2a2a2a); T(C(0.02, 0.14), 0.16, -0.26, 0, 0, 0, -0.4, 0x2a2a2a);
      T(B(0.015, 0.14, 0.01), 0, 0.05, 0.07, 0, 0, 0, 0x1a1a1a); T(B(0.1, 0.015, 0.01), 0.04, 0, 0.07, 0, 0, 0, 0x1a1a1a); break;
    case 92:    // 相機
      T(B(0.56, 0.36, 0.22), 0, 0, 0, 0, 0, 0, 0x2a2a2e); T(C(0.13, 0.16), 0.02, -0.02, 0.18, H, 0, 0, 0x1a1a1a); T(C(0.09, 0.165), 0.02, -0.02, 0.18, H, 0, 0, 0x3a5a7a);
      T(B(0.12, 0.06, 0.08), -0.18, 0.2, 0, 0, 0, 0, 0x2a2a2e); T(C(0.03, 0.04), 0.18, 0.2, 0, 0, 0, 0, 0xc8c8c8); break;
    case 101:   // 寶特瓶
      T(C(0.13, 0.46), 0, -0.06, 0, 0, 0, 0, 0x8fd0ee); T(Cy(0.05, 0.13, 0.12), 0, 0.23, 0, 0, 0, 0, 0x8fd0ee);
      T(C(0.05, 0.06), 0, 0.32, 0, 0, 0, 0, 0x2a7ad5); T(C(0.132, 0.14), 0, -0.04, 0, 0, 0, 0, 0x3ab06a); break;
    case 102:   // 茶壺
      T(S(0.24), 0, 0, 0, 0, 0, 0, 0xbfc5cc); T(C(0.16, 0.04), 0, 0.2, 0, 0, 0, 0, 0xbfc5cc); T(S(0.04), 0, 0.25, 0, 0, 0, 0, 0x2a2a2a);
      T(Cy(0.03, 0.06, 0.26), 0.27, 0.04, 0, 0, 0, -0.9, 0xbfc5cc); T(Tor(0.13, 0.025, Math.PI), -0.2, 0.06, 0, 0, 0, H, 0x2a2a2a); break;
    case 103:   // 牛奶盒
      T(B(0.3, 0.46, 0.3), 0, -0.04, 0, 0, 0, 0, 0xfafafa); T(B(0.302, 0.16, 0.302), 0, -0.1, 0, 0, 0, 0, 0x3a7bd5);
      T(new THREE.ConeGeometry(0.22, 0.14, 4), 0, 0.26, 0, 0, Math.PI / 4, 0, 0xfafafa); T(B(0.04, 0.06, 0.04), 0.06, 0.32, 0, 0, 0, 0, 0xd23a3a); break;
    default: return salvageGeo(k);
  }
  return mergeGeos(P);
}
/** 每種回收物有幾款造型（第 0 款是原本的） */
const REAL_VARIANTS = [3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 4];

function mergeGeos(list) {
  let n = 0;
  const parts = list.map(function (e) {
    const src = e[0], sh = src.userData && src.userData.shade, g = src.index ? src.toNonIndexed() : src.clone();
    const cnt = g.attributes.position.count, p0 = g.attributes.position.array, shade = new Float32Array(cnt);
    for (let k = 0; k < cnt; k++) shade[k] = sh ? sh(p0, k) : 1;   // 用變形前的座標算明暗
    g.applyMatrix4(e[1]); n += cnt; return [g, new THREE.Color(e[2] == null ? 0xffffff : e[2]), shade];
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  parts.forEach(function (pc) {
    const g = pc[0], c = pc[1], sd = pc[2], cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < cnt; k++) { col[(o + k) * 3] = c.r * sd[k]; col[(o + k) * 3 + 1] = c.g * sd[k]; col[(o + k) * 3 + 2] = c.b * sd[k]; }
    o += cnt; g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
function M4(x, y, z, rx, ry, rz, sx, sy, sz) { const m = new THREE.Matrix4(); m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(sx || 1, sy || sx || 1, sz || sx || 1)); return m; }
// 一片下垂的棕櫚葉：沿著葉脈往外、兩側往下摺成 V 形
function frondGeo(len, wid, droop) {
  const seg = 9, pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, x = t * len, y = -droop * t * t, w = wid * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35);
    pos.push(x, y, 0, x, y - w * 0.35, w, x, y - w * 0.35, -w);
  }
  for (let i = 0; i < seg; i++) { const a = i * 3, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1, a, a + 2, b, a + 2, b + 2, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const treeCache = {};
function palmGeos() {
  if (treeCache.palm) return treeCache.palm;
  const tr = [], lv = []; let x = 0, y = 0, a = 0;
  for (let i = 0; i < 7; i++) {   // 微彎的樹幹，一節一節，深淺交錯
    const h = 0.52, r0 = 0.2 - i * 0.013, cg = new THREE.CylinderGeometry(r0 - 0.012, r0, h, 8);
    a += 0.035; tr.push([cg, M4(x, y + h / 2, 0, 0, 0, -a), i % 2 ? 0x8a6238 : 0x9b7346]);
    x += Math.sin(a) * h; y += Math.cos(a) * h;
  }
  for (let k = 0; k < 3; k++) tr.push([new THREE.SphereGeometry(0.11, 8, 6), M4(x + Math.cos(k * 2.1) * 0.13, y - 0.12, Math.sin(k * 2.1) * 0.13), 0x6b4a22]);
  for (let j = 0; j < 9; j++) {   // 9 片外圈下垂葉＋3 片向上的嫩葉
    const ang = j / 9 * Math.PI * 2 + (j % 2) * 0.2, fg = frondGeo(2.1 + (j % 3) * 0.25, 0.42, 1.0 + (j % 2) * 0.35);
    lv.push([fg, M4(x, y + 0.05, 0, 0, ang, 0.28), j % 3 ? 0x3c9a48 : 0x2f8a3e]);
  }
  for (let j = 0; j < 3; j++) lv.push([frondGeo(1.3, 0.3, 0.2), M4(x, y + 0.1, 0, 0, j * 2.1 + 0.5, 0.9), 0x58b45a]);
  treeCache.palm = [mergeGeos(tr), mergeGeos(lv)]; return treeCache.palm;
}
function pineGeos(snowy) {
  const key = snowy ? 'pineS' : 'pine';
  if (treeCache[key]) return treeCache[key];
  const tr = [[new THREE.CylinderGeometry(0.1, 0.16, 1.2, 7), M4(0, 0.6, 0), 0x6a4a30]], lv = [];
  const tiers = [[1.15, 1.5, 0.9], [0.95, 1.35, 1.6], [0.72, 1.2, 2.3], [0.45, 1.0, 2.95]];
  tiers.forEach(function (t, i) {
    const g = new THREE.ConeGeometry(t[0], t[1], 10); g.userData.shade = function (p, k) { return 0.78 + (p[k * 3 + 1] + t[1] / 2) / t[1] * 0.32; };
    lv.push([g, M4(0, t[2], 0, 0, i * 0.4, 0), i % 2 ? 0x2f6b3a : 0x2a6034]);
    if (snowy) lv.push([new THREE.ConeGeometry(t[0] * 0.62, t[1] * 0.42, 10), M4(0, t[2] + t[1] * 0.3, 0, 0, i * 0.4, 0), 0xf4f8fb]);
  });
  treeCache[key] = [mergeGeos(tr), mergeGeos(lv)]; return treeCache[key];
}
// 同一種樹全部用 InstancedMesh：不管幾棵都只畫兩次
function plantTrees(geos, spots, cellInst) {
  const mat = litMat({ vertexColors: true, side: THREE.DoubleSide }), tm = litMat({ vertexColors: true });
  const a = new THREE.InstancedMesh(geos[0], tm, spots.length), b = new THREE.InstancedMesh(geos[1], mat, spots.length);
  spots.forEach(function (s, i) { const m = M4(s[0], s[1], s[2], 0, s[3], 0, s[4], s[4], s[4]); a.setMatrixAt(i, m); b.setMatrixAt(i, m); if (s[5] != null) { (cellInst[s[5]] = cellInst[s[5]] || []).push([a, i], [b, i]); } });
  a.instanceMatrix.needsUpdate = b.instanceMatrix.needsUpdate = true; return [a, b];
}
function makeSky(top, hor) {
  const g = new THREE.SphereGeometry(420, 24, 14), p = g.attributes.position, col = new Float32Array(p.count * 3), ct = new THREE.Color(top), ch = new THREE.Color(hor), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const t = Math.max(0, Math.min(1, p.getY(i) / 420)); c.copy(ch).lerp(ct, Math.pow(t, 0.55)); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}
// 牆面：依地圖畫不同的材質，再加上「底部變暗、頂部微亮」讓牆像是站在地上
function makeWallTex(style, base) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d'); g.scale(4, 4); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  const R = Math.random, rgba = function (c, a) { return 'rgba(' + c + ',' + a + ')'; };
  if (style === 'beach') {   // 砂岩砌塊
    for (let y = 0; y < 128; y += 16) { const off = (y / 16) % 2 ? 0 : 20; for (let x = -off; x < 128; x += 40) { g.fillStyle = rgba(R() < 0.5 ? '255,240,210' : '60,40,20', (0.05 + R() * 0.08).toFixed(2)); g.fillRect(x + 1, y + 1, 38, 14); } g.fillStyle = 'rgba(60,40,20,.28)'; g.fillRect(0, y, 128, 1); }
    for (let y = 0; y < 128; y += 16) for (let x = ((y / 16) % 2 ? 0 : 20); x < 128; x += 40) { g.fillStyle = 'rgba(60,40,20,.28)'; g.fillRect(x, y, 1, 16); }
  } else if (style === 'forest') {   // 樹籬：很多片葉子
    for (let i = 0; i < 900; i++) { const v = R(); g.fillStyle = v < 0.45 ? 'rgba(20,45,15,.45)' : v < 0.8 ? 'rgba(90,140,60,.4)' : 'rgba(150,190,90,.35)'; g.beginPath(); g.ellipse(R() * 128, R() * 128, 1.2 + R() * 2.2, 0.8 + R() * 1.2, R() * 3, 0, 6.3); g.fill(); }
  } else if (style === 'snow') {   // 木屋：橫的原木
    for (let y = 0; y < 128; y += 14) { const gr = g.createLinearGradient(0, y, 0, y + 14); gr.addColorStop(0, 'rgba(255,220,180,.18)'); gr.addColorStop(0.6, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(30,15,5,.45)'); g.fillStyle = gr; g.fillRect(0, y, 128, 14); for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(40,20,8,.25)'; g.fillRect(R() * 128, y + 3 + R() * 8, 6 + R() * 18, 0.6); } }
  } else if (style === 'park') {   // 紅白直條圍板，舊舊的
    for (let x = 0; x < 128; x += 16) { if ((x / 16) % 2) { g.fillStyle = '#efe6d6'; g.fillRect(x, 0, 16, 128); } g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, 0, 1, 128); }
    for (let i = 0; i < 160; i++) { g.fillStyle = rgba(R() < 0.5 ? '90,60,40' : '255,255,255', (0.08 + R() * 0.15).toFixed(2)); g.fillRect(R() * 128, R() * 128, 1 + R() * 4, 0.6 + R() * 2); }
    g.fillStyle = '#3a3330'; g.fillRect(0, 0, 128, 5); g.fillRect(0, 123, 128, 5);
  } else if (style === 'hospital') {   // 醫院牆：白綠瓷磚、縫線、腰線
    for (let y = 0; y < 128; y += 16) for (let x = 0; x < 128; x += 16) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, y, 16, 1); g.fillRect(x, y, 1, 16); }
    g.fillStyle = 'rgba(60,140,115,.55)'; g.fillRect(0, 84, 128, 6); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 84, 128, 1);
  } else if (style === 'site') {   // 清水模：模板線、繫桿孔、底部警示條
    for (let x = 0; x <= 128; x += 64) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, 0, 1, 128); }
    g.fillRect(0, 42, 128, 1); g.fillRect(0, 85, 128, 1);
    for (let y = 21; y < 128; y += 42) for (let x = 16; x < 128; x += 32) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x, y, 1.4, 0, 6.3); g.fill(); }
    for (let i = 0; i < 40; i++) { const x = R() * 128, y = R() * 128, gr = g.createRadialGradient(x, y, 0, x, y, 8 + R() * 14); gr.addColorStop(0, rgba(R() < 0.5 ? '0,0,0' : '255,255,255', 0.06)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    for (let x = -12; x < 140; x += 12) { g.fillStyle = '#e8b400'; g.beginPath(); g.moveTo(x, 128); g.lineTo(x + 6, 128); g.lineTo(x + 14, 118); g.lineTo(x + 8, 118); g.fill(); g.fillStyle = '#1e1a16'; g.beginPath(); g.moveTo(x + 6, 128); g.lineTo(x + 12, 128); g.lineTo(x + 20, 118); g.lineTo(x + 14, 118); g.fill(); }
  }
  if (style === 'garage') {   // 停車場：黃色柱邊、水泥接縫
    for (let x = 0; x < 128; x += 64) { g.fillStyle = 'rgba(230,185,40,.6)'; g.fillRect(x, 0, 6, 128); }
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 60, 128, 1.2);
  } else if (style === 'subway') {   // 地鐵：白色瓷磚、藍色腰線、塗鴉點
    for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) { g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(x, y, 8, 0.8); g.fillRect(x, y, 0.8, 8); }
    g.fillStyle = 'rgba(30,70,140,.7)'; g.fillRect(0, 100, 128, 6);
    for (let i = 0; i < 14; i++) { g.fillStyle = rgba(R() < 0.5 ? '200,60,40' : '60,160,90', 0.5); g.beginPath(); g.arc(R() * 128, 20 + R() * 60, 1 + R() * 2, 0, 6.3); g.fill(); }
  } else if (style === 'dock') {   // 碼頭：波浪鐵皮
    for (let x = 0; x < 128; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, 'rgba(0,0,0,.25)'); gr.addColorStop(0.5, 'rgba(255,220,170,.12)'); gr.addColorStop(1, 'rgba(0,0,0,.25)'); g.fillStyle = gr; g.fillRect(x, 0, 16, 128); }
    g.fillStyle = 'rgba(40,30,20,.5)'; g.fillRect(0, 118, 128, 4);
  } else if (style === 'library') {   // 圖書館：書架層板、各色書脊
    for (let y = 0; y < 128; y += 32) { g.fillStyle = 'rgba(40,25,10,.55)'; g.fillRect(0, y, 128, 3); for (let x = 2; x < 126; x += 4) { if (R() < 0.8) { g.fillStyle = rgba(['120,40,30', '40,70,110', '60,100,50', '150,120,50', '90,60,100'][Math.floor(R() * 5)], 0.75); g.fillRect(x, y + 6 + R() * 2, 2.5, 22 + R() * 3); } } }
  } else if (style === 'crypt') {   // 墓穴：石磚、苔痕、裂縫
    for (let y = 0; y < 128; y += 16) for (let x = ((y / 16) % 2 ? 0 : 16); x < 128; x += 32) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y, 1, 16); g.fillRect(x, y, 32, 1); }
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(60,110,70,.3)'; g.beginPath(); g.ellipse(R() * 128, R() * 128, 4 + R() * 6, 2 + R() * 3, R() * 3, 0, 6.3); g.fill(); }
  } else if (style === 'station') {   // 加油站：白色面板、紅色腰線、藍色上緣
    for (let x = 0; x <= 128; x += 32) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x, 0, 1, 128); }
    g.fillStyle = 'rgba(200,40,40,.75)'; g.fillRect(0, 108, 128, 8); g.fillStyle = 'rgba(40,120,220,.6)'; g.fillRect(0, 4, 128, 4);
  } else if (style === 'rest') {   // 休息站：金屬壁板、橫向排水線
    for (let y = 0; y < 128; y += 12) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y, 128, 1.2); const gr = g.createLinearGradient(0, y, 0, y + 12); gr.addColorStop(0, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, y, 128, 12); }
  } else if (style === 'fair') {   // 遊樂園：粉白直條（嘉年華）
    for (let x = 0; x < 128; x += 16) { if ((x / 16) % 2) { g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x, 0, 8, 128); } }
    g.fillStyle = 'rgba(255,90,160,.5)'; g.fillRect(0, 0, 128, 4);
  } else if (style === 'field') {   // 操場：紅磚、白色踢腳線
    for (let y = 0; y < 128; y += 8) for (let x = ((y / 8) % 2 ? 0 : 8); x < 128; x += 16) { g.fillStyle = 'rgba(120,50,30,.22)'; g.fillRect(x, y, 15, 7); g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x, y + 7, 15, 0.6); }
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(0, 118, 128, 5);
  } else if (style === 'market') {   // 夜市：磚牆＋色布招牌條
    for (let y = 0; y < 128; y += 10) for (let x = ((y / 10) % 2 ? 0 : 8); x < 128; x += 16) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, 0.8, 10); }
    for (let x = 0; x < 128; x += 24) { g.fillStyle = (x / 24) % 2 ? 'rgba(240,200,80,.7)' : 'rgba(220,60,50,.7)'; g.fillRect(x, 0, 12, 10); }
  }
  for (let i = 0; i < 2500; i++) { g.fillStyle = 'rgba(0,0,0,' + (R() * 0.06).toFixed(3) + ')'; g.fillRect(R() * 128, R() * 128, 0.35, 0.35); }
  const ao = g.createLinearGradient(0, 128, 0, 80); ao.addColorStop(0, 'rgba(0,0,0,.38)'); ao.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = ao; g.fillRect(0, 80, 128, 48);
  const hi = g.createLinearGradient(0, 0, 0, 10); hi.addColorStop(0, 'rgba(255,255,255,.16)'); hi.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = hi; g.fillRect(0, 0, 128, 10);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = maxAniso; return t;
}
// 地面：沙紋、草地、雪地、地磚、工地泥土
function makeFloorTex(style, base) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d'); g.scale(4, 4); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  const R = Math.random;
  for (let i = 0; i < 40; i++) { const x = R() * 128, y = R() * 128, r = 12 + R() * 30, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, R() < 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  if (style === 'beach') {
    g.lineWidth = 0.8;
    for (let k = 0; k < 14; k++) { const y0 = k * 9.2 + R() * 3; g.strokeStyle = 'rgba(120,90,40,.16)'; g.beginPath(); for (let x = 0; x <= 128; x += 4) g.lineTo(x, y0 + Math.sin(x * 0.09 + k) * 2.2); g.stroke(); g.strokeStyle = 'rgba(255,250,230,.2)'; g.beginPath(); for (let x = 0; x <= 128; x += 4) g.lineTo(x, y0 + 1.2 + Math.sin(x * 0.09 + k) * 2.2); g.stroke(); }
  } else if (style === 'forest') {
    for (let i = 0; i < 7; i++) { const x = R() * 128, y = R() * 128, r = 6 + R() * 12, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(110,85,50,.5)'); gr.addColorStop(1, 'rgba(110,85,50,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 2600; i++) { const v = R(); g.strokeStyle = v < 0.4 ? 'rgba(40,70,25,.4)' : v < 0.8 ? 'rgba(130,170,80,.35)' : 'rgba(180,200,110,.3)'; g.lineWidth = 0.5; const x = R() * 128, y = R() * 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 1.5, y - 1.5 - R() * 2); g.stroke(); }
  } else if (style === 'snow') {
    for (let i = 0; i < 30; i++) { const x = R() * 128, y = R() * 128, r = 8 + R() * 16, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(150,175,205,.18)'); gr.addColorStop(1, 'rgba(150,175,205,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.4 + R() * 0.6).toFixed(2) + ')'; g.fillRect(R() * 128, R() * 128, 0.5, 0.5); }
  } else if (style === 'park') {
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) { g.fillStyle = 'rgba(' + (R() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (0.03 + R() * 0.06).toFixed(2) + ')'; g.fillRect(x + 1, y + 1, 30, 30); }
    g.fillStyle = 'rgba(60,45,30,.35)'; for (let k = 0; k <= 128; k += 32) { g.fillRect(k, 0, 1, 128); g.fillRect(0, k, 128, 1); }
    g.strokeStyle = 'rgba(50,40,30,.3)'; g.lineWidth = 0.5; for (let i = 0; i < 6; i++) { let x = R() * 128, y = R() * 128; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 10; y += (R() - 0.5) * 10; g.lineTo(x, y); } g.stroke(); }
  } else if (style === 'hospital') {   // 醫院地磚：棋盤格、深色縫
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) { if (((x + y) / 32) % 2) { g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(x, y, 32, 32); } }
    g.fillStyle = 'rgba(70,80,75,.35)'; for (let k = 0; k <= 128; k += 32) { g.fillRect(k, 0, 1, 128); g.fillRect(0, k, 128, 1); }
  } else if (style === 'site') {
    for (let i = 0; i < 1400; i++) { g.fillStyle = R() < 0.5 ? 'rgba(60,45,30,.35)' : 'rgba(200,185,160,.3)'; g.fillRect(R() * 128, R() * 128, 0.6 + R(), 0.6 + R()); }
    g.fillStyle = 'rgba(50,38,25,.18)'; g.fillRect(40, 0, 9, 128); g.fillRect(78, 0, 9, 128);
    for (let y = 0; y < 128; y += 4) { g.fillStyle = 'rgba(40,30,20,.12)'; g.fillRect(40, y, 9, 1.5); g.fillRect(78, y, 9, 1.5); }
  }
  if (style === 'garage') {   // 停車格線
    g.fillStyle = 'rgba(255,255,255,.55)'; for (let y = 40; y < 128; y += 44) g.fillRect(0, y, 128, 2);
    for (let x = 0; x < 128; x += 42) g.fillRect(x, 40, 2, 88);
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(R() * 128, R() * 128, 6 + R() * 8, 3 + R() * 4, 0, 0, 6.3); g.fill(); }
  } else if (style === 'subway') {   // 軌道與枕木
    for (let y = 0; y < 128; y += 10) { g.fillStyle = 'rgba(60,40,25,.5)'; g.fillRect(0, y, 128, 3); }
    g.fillStyle = 'rgba(160,168,180,.55)'; g.fillRect(36, 0, 3, 128); g.fillRect(89, 0, 3, 128);
  } else if (style === 'dock') {   // 木板地
    for (let y = 0; y < 128; y += 16) { g.fillStyle = 'rgba(30,18,8,.45)'; g.fillRect(0, y, 128, 1.5); for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(60,35,15,.18)'; g.fillRect(R() * 128, y + 3 + R() * 10, 20 + R() * 30, 0.7); } }
  } else if (style === 'library') {   // 木地板斜紋
    g.strokeStyle = 'rgba(60,35,15,.3)'; g.lineWidth = 1; for (let k = -128; k < 256; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke(); }
  } else if (style === 'crypt') {   // 石板地
    g.fillStyle = 'rgba(0,0,0,.4)'; for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 1.5); for (let x = 0; x < 128; x += 42) g.fillRect(x, 0, 1.5, 128);
    for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(120,30,30,.12)'; g.beginPath(); g.ellipse(R() * 128, R() * 128, 5 + R() * 6, 3 + R() * 4, 0, 0, 6.3); g.fill(); }
  } else if (style === 'station') {   // 油漬水泥
    for (let i = 0; i < 16; i++) { const x = R() * 128, y = R() * 128, r = 4 + R() * 9, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(20,20,25,.35)'); gr.addColorStop(1, 'rgba(20,20,25,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  } else if (style === 'rest') {   // 停車場柏油與中央虛線
    g.fillStyle = 'rgba(245,200,60,.7)'; for (let y = 0; y < 128; y += 24) g.fillRect(63, y, 2, 12);
  } else if (style === 'fair') {   // 木棧道
    for (let x = 0; x < 128; x += 20) { g.fillStyle = 'rgba(80,50,30,.25)'; g.fillRect(x, 0, 1.2, 128); }
  } else if (style === 'field') {   // 草皮條紋與白線
    for (let x = 0; x < 128; x += 32) { g.fillStyle = (x / 32) % 2 ? 'rgba(255,255,255,.08)' : 'rgba(0,60,0,.08)'; g.fillRect(x, 0, 32, 128); }
    g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(0, 63, 128, 1.5); g.beginPath(); g.arc(64, 64, 14, 0, 6.3); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5; g.stroke();
  } else if (style === 'market') {   // 石板路
    for (let y = 0; y < 128; y += 16) for (let x = ((y / 16) % 2 ? 0 : 16); x < 128; x += 32) { g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.strokeRect(x + 1, y + 1, 30, 14); }
  }
  for (let i = 0; i < 3000; i++) { g.fillStyle = 'rgba(0,0,0,' + (R() * 0.05).toFixed(3) + ')'; g.fillRect(R() * 128, R() * 128, 0.3, 0.3); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; return t;
}
let wallsMesh = null, wallIdx = {}, brokenVis = {}, cellInst = {}, brokenSave = {};
// 炸開的牆過一段時間長回來：還原那一格的牆與布景矩陣、重畫小地圖
function healWall(c, r) {
  const key = r * W.COLS + c;
  if (!brokenVis[key]) return;
  brokenVis[key] = false;
  W.restoreCell(c, r);
  (brokenSave[key] || []).forEach(function (q) { q[0].setMatrixAt(q[1], q[2]); q[0].instanceMatrix.needsUpdate = true; });
  delete brokenSave[key];
  buildMini();
}
// 牆被炸開：藏起那一格牆（和它上面的布景）、噴碎塊、重畫小地圖
function showBreak(c, r, quiet) {
  const key = r * W.COLS + c;
  if (brokenVis[key]) return;
  brokenVis[key] = true;
  W.breakWall(c, r);   // 房主／單人已經炸過了，這裡只對其他玩家的地圖生效
  // 記下原本的牆與裝飾矩陣，過一段時間長回來時用
  const save = [], tmp = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  if (wallsMesh && wallIdx[key] != null) { wallsMesh.getMatrixAt(wallIdx[key], tmp); save.push([wallsMesh, wallIdx[key], tmp.clone()]); wallsMesh.setMatrixAt(wallIdx[key], zero); wallsMesh.instanceMatrix.needsUpdate = true; }
  if (level) level.children.filter(function (o) { return o.userData && o.userData.cell === key; }).forEach(function (o) { level.remove(o); });
  (cellInst[key] || []).forEach(function (q) { q[0].getMatrixAt(q[1], tmp); save.push([q[0], q[1], tmp.clone()]); q[0].setMatrixAt(q[1], zero); q[0].instanceMatrix.needsUpdate = true; });
  brokenSave[key] = save;
  // 缺口旁貼牆的木箱、鐵桶一起炸掉（不然會擋住新開的路）
  const bx = c * CS + CS / 2, bz = r * CS + CS / 2, near = function (x, z) { return Math.abs(x - bx) < CS / 2 + 0.9 && Math.abs(z - bz) < CS / 2 + 0.9; };
  solids = solids.filter(function (q) { return q[3] >= 2 || !near(q[0], q[1]); });   // 櫃子（高 2.1，半徑 0.3）留著
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
let solids = [];   // 擺設的碰撞圓（櫃子、木箱、鐵桶）：[x, z, 半徑, 高度]
// 腳的高度 y 已經高過擺設頂端就不擋（跳上木箱、鐵桶）
function hitSolid(x, z, y) { for (let i = 0; i < solids.length; i++) { const q = solids[i]; if ((y || 0) < (q[3] || 9) - 0.3 && Math.hypot(q[0] - x, q[1] - z) < q[2] + 0.34) return true; } return false; }
// 這個位置腳下的高度：站在擺設上就是它的頂端
function groundAt(x, z) { let g = W.isWall(Math.floor(x / CS), Math.floor(z / CS)) ? WH : 0; /* 站在牆頂 */ for (let i = 0; i < solids.length; i++) { const q = solids[i]; if (q[3] && q[3] < 1.5 && Math.hypot(q[0] - x, q[1] - z) < q[2] + 0.12) g = Math.max(g, q[3]); } return g; }
let vanRing = null, inBaseNow = false;
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
  if (view.zone) {   // 廢墟生存戰安全區
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(view.zone[0] * k, view.zone[1] * k, Math.max(1, view.zr * k), 0, Math.PI * 2); g.stroke();
  }
  view.players.forEach(function (p) {          // 還活著的隊友（廢墟生存戰不顯示對手）
    if (p.id === myId || !p.alive || (view.mode === 'br' && uavT <= 0)) return;
    g.fillStyle = CSSCOL[p.slot % 4];
    g.beginPath(); g.arc(p.x * k, p.z * k, MC * 0.38, 0, Math.PI * 2); g.fill();
  });
  // 怪物：靠近（14 公尺內）才顯示；依種類上色（火紅、冰藍、毒綠、暗影紫），追人時外圈閃爍
  const MC_COL = ['#ff5a2a', '#5ad0ff', '#8cff5a', '#b070ff'];
  for (let i = 0; i < view.monsters.length; i++) {
    const m = view.monsters[i];
    if (!m.group.visible || (view.weather === 4 && uavT <= 0) || (uavT <= 0 && view.mode !== 'hunt' && view.mode !== 'td' && Math.hypot(m.x - L.x, m.z - L.z) > (myPet() === 2 ? 22 : 14))) continue;   // 無人機開啟時顯示全圖敵人   // 14 公尺內才顯示
    const mx = m.x * k, my = m.z * k;
    if (m.chase && Math.floor(Date.now() / 250) % 2) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath(); g.arc(mx, my, MC * 0.75, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = MC_COL[i % 4]; g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(mx, my - MC * 0.55); g.lineTo(mx + MC * 0.5, my + MC * 0.4); g.lineTo(mx - MC * 0.5, my + MC * 0.4); g.closePath(); g.fill(); g.stroke();
  }
  // 自己（或觀戰對象）：箭頭指向面對的方向
  const fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw), x = L.x * k, y = L.z * k, s = MC * 0.75;
  if (view.pad) {   // 傳送陣：青色脈動圓圈
    const px = view.pad[0] * k, py = view.pad[1] * k, pr = MC * (0.9 + 0.25 * Math.sin(Date.now() / 200));
    g.strokeStyle = '#66e0ff'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(102,224,255,0.35)'; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x + fx * s, y + fz * s);
  g.lineTo(x - fx * s * 0.6 - fz * s * 0.6, y - fz * s * 0.6 + fx * s * 0.6);
  g.lineTo(x - fx * s * 0.6 + fz * s * 0.6, y - fz * s * 0.6 - fx * s * 0.6);
  g.closePath(); g.fill(); g.stroke();
}
// 基地（回收車）造型：顏色與形狀依房主選的 W.BASE_STYLES 而定；換造型時會重建關卡
let builtBase = -1, baseCol = 0xffc24a;
function buildBase() {
  const st = W.BASE_STYLES[view.base | 0] || W.BASE_STYLES[0], col = st.c, sh = st.sh, VAN = W.VAN;
  baseCol = col; builtBase = view.base | 0;
  const ring = new THREE.Mesh(new THREE.RingGeometry(sh === 3 ? 1.2 : 1.5, sh === 3 ? 1.5 : 1.85, 40), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(VAN[0], 0.03, VAN[1]); level.add(ring); vanRing = ring;
  const bH = sh === 1 ? WH * 1.8 : WH;
  // 光柱：只畫外側（站在裡面抬頭不會看到一個圓），由下往上淡出
  const bcv = document.createElement('canvas'); bcv.width = 4; bcv.height = 64; { const bg = bcv.getContext('2d'), gr = bg.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); bg.fillStyle = gr; bg.fillRect(0, 0, 4, 64); }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, bH, 28, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, alphaMap: new THREE.CanvasTexture(bcv), side: THREE.FrontSide, depthWrite: false }));
  beam.position.set(VAN[0], bH / 2, VAN[1]); level.add(beam);
  const glow = new THREE.MeshBasicMaterial({ color: col });
  if (sh === 1) {   // 信號塔：細桿＋頂端燈球
    level.add(part(new THREE.CylinderGeometry(0.12, 0.18, bH, 10), new THREE.MeshLambertMaterial({ color: 0x2a3a48 }), VAN[0], bH / 2, VAN[1]));
    level.add(part(new THREE.SphereGeometry(0.28, 14, 10), glow, VAN[0], bH + 0.1, VAN[1]));
  } else if (sh === 2) {   // 圓頂營地：半透明圓頂
    level.add(part(new THREE.ConeGeometry(1.6, 1.1, 28, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }), VAN[0], 2.9, VAN[1]));
  } else if (sh === 3) {   // 四柱燈：四角小柱頂著燈
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (q) {
      level.add(part(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), new THREE.MeshLambertMaterial({ color: 0x2a3a48 }), VAN[0] + q[0] * 1.35, 1.2, VAN[1] + q[1] * 1.35));
      level.add(part(new THREE.SphereGeometry(0.16, 10, 8), glow, VAN[0] + q[0] * 1.35, 2.5, VAN[1] + q[1] * 1.35));
    });
  }
  const vl = new THREE.PointLight(col, 0.9, 12, 1.6); vl.position.set(VAN[0], 2.4, VAN[1]); level.add(vl);
}
function buildLevel() {
  if (level) {
    scene.remove(level);
    level.traverse(function (o) { if (o.geometry && !o.userData.keep) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
  const raceLvl = !!(typeof MAPS !== 'undefined' && MAPS[W.mapIndex] && MAPS[W.mapIndex].track);
  level = new THREE.Group(); lockerMeshes = []; builtMap = W.mapIndex; solids = []; wallIdx = {}; brokenVis = {}; cellInst = {}; brokenSave = {};
  const COLS = W.COLS, ROWS = W.ROWS, MAP = W.MAP, T = W.theme, VAN = W.VAN;
  // 光線：室內也調亮；開放場景（海邊、城市、太空站）沒有天花板，有天空與陽光
  const open = !!T.open, br = T.bright || 1.5, sk = SKY[T.style], skyC = open ? (sk ? sk[1] : T.sky) : 0x0a0f0d;
  scene.fog.density = open ? T.fog : T.fog * 0.3; scene.fog.color.setHex(skyC); scene.background.setHex(skyC);
  const ex = T.exp || 1;   // 每張地圖的曝光倍率（太亮的開放場景調低）
  if (ambient) { ambient.color.setHex(T.amb); ambient.intensity = (open ? 0.42 : 0.95 * br) * ex; }
  // 半球光：天空色從上照、地面色從下反射，開放地圖的明暗比較自然
  if (hemi) { hemi.intensity = (open ? 0.55 : 0.45 * br) * ex; hemi.color.setHex(open && sk ? sk[0] : 0xcfd8e6).lerp(new THREE.Color(0xffffff), open ? 0.55 : 0); hemi.groundColor.set(open ? T.floor : '#3a3f3a').multiplyScalar(open ? 0.7 : 1); }
  if (sun) { sun.intensity = open ? ((T.sun || 0.5) + 0.12) * ex : 0; sun.color.setHex(T.style === 'park' || T.style === 'city' ? 0xffd2a0 : 0xfff2d8); }
  skyDome = null;
  // 戶外總亮度上限：環境光＋半球光＋陽光加起來不超過 1.05，淺色牆面才不會過曝
  if (open && ambient && hemi && sun) {
    const tot = ambient.intensity + hemi.intensity + sun.intensity, cap = 1.05;
    if (tot > cap) { const k = cap / tot; ambient.intensity *= k; hemi.intensity *= k; sun.intensity *= k; }
  }
  if (camera) { camera.far = open ? 600 : 80; camera.updateProjectionMatrix(); }
  // 遠景用：不吃霧，但顏色先往地平線色混，看起來像隔著空氣
  const hazeMat = function (c, k) { return litMat({ color: new THREE.Color(c).lerp(new THREE.Color(skyC), k == null ? 0.5 : k), fog: false }); };
  if (open && sk) { skyDome = makeSky(sk[0], sk[1]); skyDome.position.set(W.COLS * CS / 2, 0, W.ROWS * CS / 2); skyDome.renderOrder = -1; level.add(skyDome); }
  // 戶外沒設定手電筒亮度時用 0.2：白天開 2.2 的手電筒，靠近淺色牆會整片反白
  torchBase = T.torch != null ? T.torch : open ? 0.2 : 2.2;
  baseLight = { fog: scene.fog.density, fogC: skyC, amb: ambient ? ambient.intensity : 1, hemi: hemi ? hemi.intensity : 0.4, sun: sun ? sun.intensity : 0, torch: torchBase, open: open };
  const style = T.style || 'ruin', wallH = T.wallH || WH;
  const floorTex = (open || FLOOR_STYLES.indexOf(style) >= 0) && style !== 'city' && style !== 'space' ? makeFloorTex(style, T.floor) : makeTex(T.floor, '0,0,0', false); floorTex.repeat.set(COLS, ROWS);
  const Wd = COLS * CS, D = ROWS * CS;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Wd, D, LITE ? COLS * 2 : 1, LITE ? ROWS * 2 : 1), litMat({ map: floorTex, shininess: style === 'space' ? 40 : 8 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(Wd / 2, 0, D / 2); level.add(floor);
  if (!open) {
    const ceilTex = makeTex(T.ceil, '0,0,0', false); ceilTex.repeat.set(COLS, ROWS);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Wd, D, LITE ? COLS : 1, LITE ? ROWS : 1), litMat({ map: ceilTex, shininess: 2 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(Wd / 2, WH, D / 2); level.add(ceil);
  }
  const wallTex = style === 'city' ? makeWinTex(T.wall, true) : style === 'space' ? makeWinTex(T.wall, false) : WALL_STYLES.indexOf(style) >= 0 ? makeWallTex(style, T.wall) : makeTex(T.wall, '20,20,20', style !== 'office');
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === '#') n++;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, 1, CS), litMat({ map: wallTex, shininess: style === 'space' ? 50 : 4 }), n);
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), sc3 = new THREE.Vector3(); let i = 0;
  let hs = 99 + W.mapIndex; const hr = function () { hs = (hs * 16807) % 2147483647; return hs / 2147483647; };
  const tops = [], caps = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === '#') {
    const edge = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
    let hgt = wallH;
    if (style === 'city') hgt = edge ? 3.6 : 5 + Math.floor(hr() * 4) * 1.8;
    else if (style === 'beach') hgt = edge ? 1.5 : 1.9 + hr() * 0.9;
    else if (style === 'space') hgt = edge ? 1.4 : 3;
    else if (style === 'forest') hgt = edge ? 1.6 : 2.2 + hr() * 0.8;
    else if (style === 'park') hgt = edge ? 1.6 : 2.2;
    else if (style === 'snow') hgt = edge ? 1.6 : 2.6 + hr() * 0.6;
    else if (style === 'site') hgt = edge ? 2.0 : 2.6 + Math.floor(hr() * 3) * 0.6;
    v3.set(c * CS + CS / 2, hgt / 2, r * CS + CS / 2); sc3.set(1, hgt, 1); m4.compose(v3, q4, sc3); walls.setMatrixAt(i++, m4);
    wallIdx[r * COLS + c] = i - 1;
    if (!edge) tops.push([c * CS + CS / 2, hgt, r * CS + CS / 2, r * COLS + c]);
    caps.push([c * CS + CS / 2, hgt, r * CS + CS / 2, r * COLS + c]);
  }
  walls.instanceMatrix.needsUpdate = true; level.add(walls); wallsMesh = walls;
  // 牆頂壓頂（砂岩頂、積雪、圍板頂條、混凝土頂）
  const cp = CAP[style];
  if (cp) {
    const cm = new THREE.InstancedMesh(new THREE.BoxGeometry(CS + cp[2] * 2, cp[1], CS + cp[2] * 2), litMat({ color: cp[0] }), caps.length);
    caps.forEach(function (t, k) { cm.setMatrixAt(k, M4(t[0], t[1] + cp[1] / 2, t[2])); (cellInst[t[3]] = cellInst[t[3]] || []).push([cm, k]); });
    cm.instanceMatrix.needsUpdate = true; level.add(cm);
  }
  // 地圖外圍一圈的位置（種樹當遠景，讓邊界不會是一片空地）
  const ringSpots = function (n, minD, maxD) { const out = []; for (let k = 0; k < n; k++) { const side = k % 4, t = hr(), d = minD + hr() * (maxD - minD);
    out.push(side === 0 ? [t * Wd, -d] : side === 1 ? [t * Wd, D + d] : side === 2 ? [-d, t * D] : [Wd + d, t * D]); } return out; };
  // 地面小物：石頭、草叢、雪堆、三角錐、紙屑（不擋路，只是畫面）
  const scatterGround = function (style, rr) {
    const spots = [];
    W.floorCells.forEach(function (fc) {
      const c = fc[0], r = fc[1], cx = c * CS + CS / 2, cz = r * CS + CS / 2;
      if (Math.hypot(cx - VAN[0], cz - VAN[1]) < CS * 1.2) return;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { if (W.isWall(c + d[0], r + d[1]) && rr() < 0.55) spots.push([cx + d[0] * (CS / 2 - 0.35) + (d[0] ? 0 : (rr() - 0.5) * 3), cz + d[1] * (CS / 2 - 0.35) + (d[1] ? 0 : (rr() - 0.5) * 3)]); });
    });
    const kinds = { beach: [[new THREE.DodecahedronGeometry(0.22, 0), [0xb8a684, 0x8f8770, 0xe8dcc0], 0.08], [new THREE.BoxGeometry(0.26, 0.12, 0.2), [0xd8c9a6, 0x9c8f74], 0.05], [new THREE.ConeGeometry(0.16, 0.3, 6), [0xe8dcc0, 0xc9b48a], 0.12]],
      forest: [[new THREE.ConeGeometry(0.14, 0.55, 5), [0x3f7a35, 0x5a9a42, 0x2f6a2c], 0.27], [new THREE.DodecahedronGeometry(0.2, 0), [0x6b5a3a, 0x4d4030], 0.1], [new THREE.CylinderGeometry(0.1, 0.12, 0.4, 6), [0x7a5a32, 0x5a4224], 0.2]],
      snow: [[new THREE.SphereGeometry(0.35, 8, 6), [0xf4f8fb, 0xe6eef5], 0.05], [new THREE.DodecahedronGeometry(0.25, 0), [0xdfe9f2, 0xc5d3e0], 0.08], [new THREE.ConeGeometry(0.15, 0.4, 7), [0x9fd0e6, 0xf4f8fb], 0.2]],
      park: [[new THREE.BoxGeometry(0.25, 0.03, 0.18), [0xd94a3a, 0xf2b84b, 0x4a8fd9, 0xffffff], 0.02], [new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), [0xf2b84b, 0x4a8fd9, 0xd94a3a], 0.03], [new THREE.OctahedronGeometry(0.16), [0xff7ad1, 0x6ad8ff], 0.17]],
      site: [[new THREE.ConeGeometry(0.2, 0.55, 10), [0xf26a1b], 0.27], [new THREE.BoxGeometry(0.4, 0.1, 0.25), [0xf26a1b, 0x333333], 0.06], [new THREE.DodecahedronGeometry(0.2, 0), [0xf2b84b, 0xd94a3a], 0.13]],
      city: [[new THREE.BoxGeometry(0.3, 0.03, 0.2), [0xd8d2c4, 0x9aa0a8], 0.02], [new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8), [0x9aa0a8, 0x6f7680], 0.1], [new THREE.OctahedronGeometry(0.18), [0xd8d2c4, 0xb07a4a], 0.18]], space: null, station: [[new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8), [0xc0392b, 0x2b5fb0, 0x9a9a9a], 0.25]], field: [[new THREE.ConeGeometry(0.14, 0.3, 6), [0xff7a1a, 0xffffff], 0.15]] };
    const vs = kinds[style]; if (!vs) return;
    const groups = vs.map(function () { return []; });
    spots.forEach(function (q) { groups[Math.floor(rr() * vs.length)].push(q); });   // 每個位置隨機挑一種外形
    const col = new THREE.Color(); let m = null;
    vs.forEach(function (k, vi) {
      const g = groups[vi]; if (!g.length) return;
      const im = new THREE.InstancedMesh(k[0], litMat({ color: 0xffffff }), g.length);
      g.forEach(function (q, i) { const s = 0.7 + rr() * 0.7; im.setMatrixAt(i, M4(q[0], k[2] * s, q[1], style === 'park' || style === 'city' ? 0 : (rr() - 0.5) * 0.3, rr() * 6.3, 0, s, style === 'snow' ? s * 0.45 : s, s)); im.setColorAt(i, col.setHex(k[1][Math.floor(rr() * k[1].length)])); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; level.add(im);
      if (vi === 0) m = im;
    });
    if (style === 'forest' || style === 'beach') {   // 再加一些石頭
      const rk = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.3, 0), litMat({ color: 0x8a8a80 }), 30);
      for (let i = 0; i < 30; i++) { const q = spots[Math.floor(rr() * spots.length)] || [0, 0], s = 0.6 + rr(); rk.setMatrixAt(i, M4(q[0] + (rr() - 0.5), 0.1 * s, q[1] + (rr() - 0.5), rr(), rr() * 6, 0, s, s * 0.6, s)); }
      rk.instanceMatrix.needsUpdate = true; level.add(rk);
    }
    if (style === 'site' && m) {   // 三角錐上的白色反光條
      const band = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.14, 0.08, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), m.count);
      for (let i = 0; i < m.count; i++) { const mm = new THREE.Matrix4(); m.getMatrixAt(i, mm); const p = new THREE.Vector3(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(); mm.decompose(p, q4, sc); band.setMatrixAt(i, M4(p.x, p.y + 0.05 * sc.y, p.z, 0, 0, 0, sc.x, sc.y, sc.z)); }
      band.instanceMatrix.needsUpdate = true; level.add(band);
    }
  };
  // 開放場景的布景
  if (style === 'beach') {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), litMat({ color: 0x2a9fd6, emissive: 0x0a3a5a, shininess: 90 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(Wd / 2, -0.25, D / 2); level.add(sea);
    const spots = [];
    tops.forEach(function (t, k) { if (k % 2) return; spots.push([t[0] + (hr() - 0.5) * 1.2, t[1], t[2] + (hr() - 0.5) * 1.2, hr() * 6.3, 0.9 + hr() * 0.35, t[3]]); });
    ringSpots(18, 6, 26).forEach(function (q) { spots.push([q[0], 0, q[1], hr() * 6.3, 1.1 + hr() * 0.5]); });
    plantTrees(palmGeos(), spots, cellInst).forEach(function (m) { m.userData.keep = true; level.add(m); });
    const isl = hazeMat(0x4f8a46, 0.45), sand = hazeMat(0xd9c38e, 0.4);
    for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + 0.4, R = 120 + hr() * 40, sx = 16 + hr() * 22; const il = part(new THREE.SphereGeometry(1, 16, 8), isl, Wd / 2 + Math.cos(a) * R, -2, D / 2 + Math.sin(a) * R); il.scale.set(sx, 6 + hr() * 8, sx * 0.7); level.add(il); const sb = part(new THREE.CylinderGeometry(1, 1, 0.5, 20), sand, Wd / 2 + Math.cos(a) * R, -0.2, D / 2 + Math.sin(a) * R); sb.scale.set(sx * 1.15, 1, sx * 0.8); level.add(sb); }
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
  else if (style === 'forest' || style === 'snow') {
    const snowy = style === 'snow', spots = [];
    tops.forEach(function (t, k) { if (snowy ? k % 3 : k % 2 === 1) return; spots.push([t[0] + (hr() - 0.5) * 1.6, t[1], t[2] + (hr() - 0.5) * 1.6, hr() * 6.3, 0.8 + hr() * 0.4, t[3]]); });
    ringSpots(snowy ? 26 : 40, 4, 30).forEach(function (q) { spots.push([q[0], 0, q[1], hr() * 6.3, 1.3 + hr() * 1.1]); });
    plantTrees(pineGeos(snowy), spots, cellInst).forEach(function (m) { m.userData.keep = true; level.add(m); });
    // 遠山
    const hillM = hazeMat(snowy ? 0x7d8ca0 : 0x3a6440, 0.5), capM = hazeMat(0xf4f8fb, 0.25);
    for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283 + hr() * 0.4, R = 120 + hr() * 35, h = (snowy ? 45 : 26) + hr() * 30, w = 34 + hr() * 26;
      level.add(part(new THREE.ConeGeometry(w, h, 7), hillM, Wd / 2 + Math.cos(a) * R, h / 2 - 4, D / 2 + Math.sin(a) * R));
      if (snowy) level.add(part(new THREE.ConeGeometry(w * 0.36, h * 0.36, 7), capM, Wd / 2 + Math.cos(a) * R, h - 4 - h * 0.18 + 0.4, D / 2 + Math.sin(a) * R)); }
  } else if (style === 'park') {
    // 摩天輪：輪框、輻條、車廂合成一個物件
    const fw = [], R0 = 16, cx = Wd + 26, cz = D * 0.3, gcol = [0xd94a3a, 0xf2b84b, 0x4a8fd9, 0x5cb85c];
    fw.push([new THREE.TorusGeometry(R0, 0.35, 6, 48), M4(0, 0, 0), 0xe9e2d6], [new THREE.TorusGeometry(R0 * 0.55, 0.22, 6, 36), M4(0, 0, 0), 0xe9e2d6]);
    for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; fw.push([new THREE.CylinderGeometry(0.12, 0.12, R0, 5), M4(Math.cos(a) * R0 / 2, Math.sin(a) * R0 / 2, 0, 0, 0, a - Math.PI / 2), 0xd8d0c4], [new THREE.BoxGeometry(1.6, 1.4, 1.4), M4(Math.cos(a) * R0, Math.sin(a) * R0 - 1, 0), gcol[k % 4]]); }
    fw.push([new THREE.CylinderGeometry(0.4, 0.6, R0 + 4, 6), M4(-4, -(R0 + 4) / 2 + 2, 0, 0, 0, -0.25), 0x8a8478], [new THREE.CylinderGeometry(0.4, 0.6, R0 + 4, 6), M4(4, -(R0 + 4) / 2 + 2, 0, 0, 0, 0.25), 0x8a8478]);
    const wheel = new THREE.Mesh(mergeGeos(fw), litMat({ vertexColors: true })); wheel.position.set(cx, R0 + 2, cz); wheel.rotation.y = 1.3; level.add(wheel);
    // 馬戲帳篷：紅白相間
    const tent = new THREE.ConeGeometry(14, 12, 16, 1, true), tp = tent.attributes.position, tc = new Float32Array(tp.count * 3);
    for (let k = 0; k < tp.count; k++) { const ang = Math.atan2(tp.getZ(k), tp.getX(k)), st = Math.floor((ang + Math.PI) / (Math.PI * 2) * 16) % 2; tc.set(st ? [0.94, 0.9, 0.84] : [0.78, 0.22, 0.18], k * 3); }
    tent.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    const tx = -30, tz = D * 0.72;
    level.add(part(tent, litMat({ vertexColors: true, side: THREE.DoubleSide }), tx, 18, tz), part(new THREE.CylinderGeometry(14, 14, 12, 16, 1, true), litMat({ color: 0xc23a2c, side: THREE.DoubleSide }), tx, 6, tz));
    // 燈泡串的燈桿
    const poleM = pmat(0x3a3330, 0.05), bulbM = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    W.floorCells.forEach(function (fc, k) { if (k % 11) return; const x = fc[0] * CS + CS / 2 + 1.5, z = fc[1] * CS + CS / 2 + 1.5; level.add(part(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), poleM, x, 1.6, z), part(new THREE.SphereGeometry(0.18, 8, 8), bulbM, x, 3.25, z)); });
  } else if (style === 'site') {
    // 塔吊：格狀塔身＋吊臂＋配重
    const cr = [], Y = 0xe8b400;
    for (let y = 0; y < 40; y += 2.5) { cr.push([new THREE.BoxGeometry(2.4, 0.15, 0.15), M4(0, y, 1.2), Y], [new THREE.BoxGeometry(2.4, 0.15, 0.15), M4(0, y, -1.2), Y], [new THREE.BoxGeometry(0.15, 0.15, 2.4), M4(1.2, y, 0), Y], [new THREE.BoxGeometry(0.15, 0.15, 2.4), M4(-1.2, y, 0), Y], [new THREE.BoxGeometry(0.1, 3.4, 0.1), M4(0, y + 1.25, 1.2, 0, 0, 0.75), Y], [new THREE.BoxGeometry(0.1, 3.4, 0.1), M4(0, y + 1.25, -1.2, 0, 0, -0.75), Y]); }
    [[1.2, 1.2], [1.2, -1.2], [-1.2, 1.2], [-1.2, -1.2]].forEach(function (q) { cr.push([new THREE.BoxGeometry(0.22, 40, 0.22), M4(q[0], 20, q[1]), Y]); });
    cr.push([new THREE.BoxGeometry(34, 1.2, 1.2), M4(9, 41, 0), Y], [new THREE.BoxGeometry(6, 2.4, 2.2), M4(-6, 40.6, 0), 0x5a5a55], [new THREE.BoxGeometry(2.6, 2.4, 2.6), M4(0, 42.6, 0), 0xdedad0], [new THREE.CylinderGeometry(0.04, 0.04, 22, 4), M4(22, 30, 0), 0x222222], [new THREE.BoxGeometry(1.4, 0.6, 1.4), M4(22, 19, 0), 0x333333]);
    const crane = mergeGeos(cr), cm = litMat({ vertexColors: true });
    const c1 = new THREE.Mesh(crane, cm); c1.position.set(Wd / 2 + 55, 0, D / 2 - 50); c1.rotation.y = 2.4; level.add(c1);
    const c2 = new THREE.Mesh(crane, cm); c2.position.set(Wd / 2 - 70, 0, D / 2 + 40); c2.rotation.y = -0.6; c2.scale.setScalar(0.8); level.add(c2);
    // 蓋到一半的大樓骨架
    const bf = [];
    for (let fl = 0; fl < 7; fl++) { bf.push([new THREE.BoxGeometry(24, 0.5, 16), M4(0, fl * 4, 0), 0xa9a7a0]); if (fl < 6) for (let x = -11; x <= 11; x += 5.5) for (let z = -7; z <= 7; z += 7) bf.push([new THREE.BoxGeometry(0.6, 4, 0.6), M4(x, fl * 4 + 2, z), 0x9a988f]); }
    const bld = mergeGeos(bf);
    [[-60, -80, 0.3], [80, 60, -0.8], [-20, 110, 1.2]].forEach(function (q) { const m = new THREE.Mesh(bld, cm); m.position.set(Wd / 2 + q[0], 0, D / 2 + q[1]); m.rotation.y = q[2]; level.add(m); });
  }
  if (open && !raceLvl) scatterGround(style, hr);
  if (!raceLvl) buildProps(style, hr);
  if (!raceLvl) buildBase();
  // 櫃子（躲藏點）
  const lockM = new THREE.MeshLambertMaterial({ color: 0x2a4a60, emissive: 0x0b1c28 }), lineM = new THREE.MeshBasicMaterial({ color: 0x0a141a }), tagM = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
  (W.lockers || []).forEach(function (k) {
    const lg = new THREE.Group();
    lg.add(part(new THREE.BoxGeometry(1.0, 2.1, 0.6), lockM, 0, 1.05, 0), part(new THREE.BoxGeometry(0.02, 1.9, 0.02), lineM, 0, 1.05, 0.31),
      part(new THREE.BoxGeometry(0.3, 0.03, 0.02), lineM, -0.25, 1.75, 0.31), part(new THREE.BoxGeometry(0.3, 0.03, 0.02), lineM, 0.25, 1.75, 0.31),
      part(new THREE.BoxGeometry(0.04, 0.14, 0.04), lineM, -0.08, 1.05, 0.32), part(new THREE.BoxGeometry(0.04, 0.14, 0.04), lineM, 0.08, 1.05, 0.32),
      part(new THREE.BoxGeometry(0.22, 0.08, 0.02), tagM, 0, 2.22, 0.2));
    lg.position.set(k[0], 0, k[1]); lg.rotation.y = k[2]; level.add(lg); lockerMeshes.push(lg); solids.push([k[0], k[1], 0.3, 2.1]);
  });
  // 擺設：木箱、鐵桶貼牆放；天花板燈條（固定種子，每張地圖每次都一樣）
  let seed = 1234 + W.mapIndex * 77; const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const crateM = litMat({ map: makeTex('#7a5a3a', '30,20,10', true), shininess: 4 }), barrelM = litMat({ color: 0x556b5a, emissive: 0x0c140e, shininess: 40 });
  const lampM = new THREE.MeshBasicMaterial({ color: 0xdfeee6 }), bandM = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
  let lamps = 0; const shafts = [];
  W.floorCells.forEach(function (fc) {
    if (raceLvl) return;   // 賽車場地不放擺設
    const c = fc[0], r = fc[1], cx = c * CS + CS / 2, cz = r * CS + CS / 2;
    if (Math.hypot(cx - VAN[0], cz - VAN[1]) < CS * 1.5) return;
    if ((W.lockers || []).some(function (k) { return Math.hypot(k[0] - cx, k[1] - cz) < CS * 0.75; })) return;
    const walls4 = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(function (d) { return W.isWall(c + d[0], r + d[1]); });
    const roll = rnd();
    if (walls4.length && roll < 0.22) {
      const d = walls4[Math.floor(rnd() * walls4.length)], off = CS / 2 - 0.42, side = (rnd() - 0.5) * 1.6;
      const px = cx + d[0] * off + (d[0] ? 0 : side), pz = cz + d[1] * off + (d[1] ? 0 : side);
      if (roll < 0.12) {
        const sz = 0.55 + rnd() * 0.25, cr = part(new THREE.BoxGeometry(sz, sz, sz), crateM, px, sz / 2, pz), sol = [px, pz, sz * 0.55, sz]; solids.push(sol); cr.rotation.y = rnd() * 0.5; level.add(cr);
        if (rnd() < 0.4) { const s2 = sz * 0.7, c2 = part(new THREE.BoxGeometry(s2, s2, s2), crateM, px, sz + s2 / 2, pz); c2.rotation.y = rnd(); level.add(c2); sol[3] = sz + s2; }
      } else {
        solids.push([px, pz, 0.32, 0.92]);
        level.add(part(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), barrelM, px, 0.45, pz), part(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 12), bandM, px, 0.62, pz));
      }
    }
    if (!open && (c + r * 2) % (/office|hospital/.test(style) ? 3 : 5) === 0 && lamps < 70) {   // 燈條：發光但不投光（省效能）
      lamps++;
      const lp = part(new THREE.BoxGeometry(1.3, 0.05, 0.22), lampM, cx, WH - 0.04, cz); if (c % 2) lp.rotation.y = Math.PI / 2; level.add(lp);
      shafts.push([cx, cz]);
    }
  });
  // 燈下的光柱：上亮下淡的半透明圓錐（加色混合，不算光照，很省）
  if (shafts.length) {
    const hh = WH - 0.06, sg = mergeGeos(shafts.map(function (s) { return [new THREE.CylinderGeometry(0.5, 1.6, hh, 18, 1, true), M4(s[0], hh / 2, s[1]), 0xe6efe8]; }));
    const sp = sg.attributes.position.array, scol = sg.attributes.color.array;
    for (let k = 0; k < sp.length; k += 3) { const f = Math.pow(Math.max(0, sp[k + 1] / hh), 1.8); scol[k] *= f; scol[k + 1] *= f; scol[k + 2] *= f; }
    const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sm.renderOrder = 2; level.add(sm);
  }
  // 回收車車體（放在光圈旁，緊貼最近的牆）
  const sc0 = W.cellOf(VAN[0], VAN[1]), vw = [[-1, 0], [0, -1], [1, 0], [0, 1]].filter(function (d) { return W.isWall(sc0[0] + d[0], sc0[1] + d[1]); })[0];
  if (vw && !raceLvl) {
    const tg = new THREE.Group(), bodyM = pmat(0xd9902f, 0.25), cabM = pmat(0xe8eef2, 0.15), tyre = pmat(0x111413, 0.02);
    tg.add(part(new THREE.BoxGeometry(1.5, 0.9, 0.8), bodyM, 0, 0.75, 0), part(new THREE.BoxGeometry(0.55, 0.7, 0.8), cabM, 1.05, 0.65, 0), part(new THREE.BoxGeometry(0.3, 0.25, 0.7), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }), 1.2, 0.82, 0));
    [[-0.5, 0.42], [0.95, 0.42], [-0.5, -0.42], [0.95, -0.42]].forEach(function (q) { const w = part(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10), tyre, q[0], 0.2, q[1]); w.rotation.x = Math.PI / 2; tg.add(w); });
    tg.position.set(VAN[0] + vw[0] * (CS / 2 - 0.5), 0, VAN[1] + vw[1] * (CS / 2 - 0.5)); tg.rotation.y = vw[0] ? Math.PI / 2 : 0; level.add(tg);
  }
  // 場景陰影：牆、道具會投影也會接影子；地板、天花板只接影子
  level.traverse(function (o) {
    if (!o.isMesh || !o.material || o === skyDome || !(o.material.isMeshPhongMaterial || o.material.isMeshLambertMaterial)) return;
    o.receiveShadow = true; o.castShadow = o.geometry.type !== 'PlaneGeometry';
  });
  scene.add(level);
  if (dust) dust.visible = !open;
  applyShadows();
  buildMini();
}

// 毒圈：地圖外的黃色區域，內圈半徑由伺服器的 pz 決定（變化超過 0.25 公尺才重建）
let poisonMesh = null, poisonR = -1;
function setPoison(R) {
  if (R == null) { if (poisonMesh) { scene.remove(poisonMesh); poisonMesh.geometry.dispose(); poisonMesh = null; } poisonR = -1; return; }
  if (poisonMesh && Math.abs(R - poisonR) < 0.25) return;
  poisonR = R; if (poisonMesh) { scene.remove(poisonMesh); poisonMesh.geometry.dispose(); }
  const big = 400, sh = new THREE.Shape();
  sh.moveTo(-big, -big); sh.lineTo(big, -big); sh.lineTo(big, big); sh.lineTo(-big, big); sh.closePath();
  const hole = new THREE.Path();
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, x = Math.cos(a) * R, y = Math.sin(a) * R; if (i) hole.lineTo(x, y); else hole.moveTo(x, y); }
  sh.holes.push(hole);
  poisonMesh = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0xd8e83a, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  poisonMesh.rotation.x = -Math.PI / 2; poisonMesh.position.set(W.VAN[0], 0.04, W.VAN[1]); scene.add(poisonMesh);
}
const MON_COL = { fire: [0xff6a1a, 0xff4a10], ice: [0x6ad8ff, 0x3ac8ff], poison: [0x7dff5a, 0x5aff3a], shadow: [0xb070ff, 0x9040ff] };
// 怪物頭上的血量條（紅）與護盾條（藍）；只有受過傷才顯示
function drawMonBar(m) {
  const hp = Math.max(0, m.hpV || 0), mx = m.maxV || 100, sh = Math.max(0, m.shV || 0), shMx = m.shMaxV || 40;
  m.bar.visible = hp < mx || sh < shMx;
  if (!m.bar.visible) return;
  const key = hp + '|' + sh + '|' + mx + '|' + shMx;
  if (key === m.barKey) return; m.barKey = key;
  const c = m.barCv.getContext('2d');
  c.clearRect(0, 0, 128, 24);
  c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(0, 0, 128, 24);
  c.fillStyle = '#6ad8ff'; c.fillRect(3, 3, 122 * Math.min(1, sh / shMx), 6);
  c.fillStyle = '#e04848'; c.fillRect(3, 13, 122 * Math.min(1, hp / mx), 8);
  m.barTex.needsUpdate = true;
}

function buildMonster(kind, v) {
  const col = MON_COL[kind] || MON_COL.fire;
  v = (v | 0) % 8;   // 怪物外觀變化：每隻怪固定一種輪廓，全部都是黑色系（玩家不能自訂）
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
  if (v === 1) {                    // 長顎：拉長的頭、一排尖牙
    head.scale.z = 1.5; head.position.z = 0.12;
    for (let k = -2; k <= 2; k++) { const t = part(new THREE.ConeGeometry(0.03, 0.13, 4), dark, k * 0.06, 2.3, 0.5); t.rotation.x = Math.PI / 2; g.add(t); }
  } else if (v === 2) {             // 背刺：背上一排黑色骨刺
    for (let k = 0; k < 5; k++) { const sp = part(new THREE.ConeGeometry(0.08, 0.3, 5), dark, 0, 1.0 + k * 0.32, -0.24); sp.rotation.x = -Math.PI / 2; g.add(sp); }
  } else if (v === 3) {             // 駝背長臂：身體前傾、手臂更長
    body.rotation.x = 0.28; head.position.set(0, 2.35, 0.3); e1.position.set(-0.13, 2.41, 0.6); e2.position.set(0.13, 2.41, 0.6); mouth.position.set(0, 2.19, 0.62);
    a1.scale.y = a2.scale.y = 1.3;
  } else if (v === 4) {             // 肋骨：身體外露的環狀肋骨
    for (let k = 0; k < 4; k++) { const rib = part(new THREE.TorusGeometry(0.27, 0.03, 8, 18), dark, 0, 0.85 + k * 0.3, 0); rib.rotation.x = Math.PI / 2; g.add(rib); }
  } else if (v === 5) {             // 三眼：額頭多一顆發光眼
    g.add(part(new THREE.SphereGeometry(0.06, 20, 16), eyeM, 0, 2.72, 0.3));
  } else if (v === 6) {             // 枯瘦長臂：細到見骨的身體、垂到地上的手臂、拉長的頭、直裂的嘴
    body.scale.set(0.6, 1, 0.6); head.scale.set(0.8, 1.6, 0.9); head.position.y = 2.6;
    a1.scale.y = a2.scale.y = 1.5; a1.rotation.z = -0.06; a2.rotation.z = 0.06;
    mouth.scale.set(0.25, 4, 1); mouth.position.y = 2.36;
    for (let k = 0; k < 5; k++) { const rib = part(new THREE.TorusGeometry(0.15, 0.018, 6, 14), dark, 0, 1.25 + k * 0.17, 0); rib.rotation.x = Math.PI / 2; g.add(rib); }
  } else if (v === 7) {             // 巨獸：體型大一倍半、頭頂角冠、粗尾巴、胸口發光裂紋
    const hornG = new THREE.ConeGeometry(0.08, 0.5, 6);
    [-0.22, 0, 0.22].forEach(function (x, k) { const h = part(hornG, dark, x, 3.0 + (k === 1 ? 0.1 : 0), -0.05); h.rotation.x = -0.4; h.rotation.z = -x * 1.2; g.add(h); });
    const tail = part(new THREE.ConeGeometry(0.3, 2.2, 10), dark, 0, 0.45, -1.1); tail.rotation.x = -Math.PI / 2 + 0.25; g.add(tail);
    for (let k = 0; k < 4; k++) { const ck = part(new THREE.BoxGeometry(0.03, 0.34, 0.02), tint, (k - 1.5) * 0.09, 1.5 + (k % 2) * 0.22, 0.33); ck.rotation.z = (k % 2 ? 0.5 : -0.5); g.add(ck); }
    body.scale.set(1.35, 1, 1.35);
  }
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
  castAll(g);
  addOutline(g, col[1], 1.06); addShadow(g, 0.6);
  // 眼睛的光暈：黑暗中遠遠就看得到兩點紅光
  [e1, e2].forEach(function (e) { const gs = glowSprite(col[0], 0.42); gs.position.copy(e.position); gs.position.z += 0.02; g.add(gs); });
  g.scale.set(1, tall, 1);
  g.visible = false; scene.add(g);
  // 血量條＋護盾條：畫在同一張小畫布上，數值變了才重畫
  const barCv = document.createElement('canvas'); barCv.width = 128; barCv.height = 24;
  const barTex = new THREE.CanvasTexture(barCv);
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: barTex, transparent: true, depthTest: false, fog: false }));
  bar.scale.set(1.3, 0.24, 1); bar.position.set(0, 3.05, 0); bar.visible = false; bar.renderOrder = 10; g.add(bar);
  if (v === 7) g.scale.setScalar(1.5);
  return { group: g, arms: [a1, a2], x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, chase: false, fresh: true, bar: bar, barCv: barCv, barTex: barTex, barKey: '' };
}

// 描邊（反面放大的外殼）讓造型輪廓清楚；腳下加一塊圓形陰影
// 角色表面：布料織紋（貼圖，依 UV 鋪在身上）＋亮色部件（盔甲、機器人、太空衣）的金屬光澤；深色不加，保留原本的黑色細節
let clothTex = null;
function getClothTex() {
  if (clothTex) return clothTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 4) for (let x = 0; x < 128; x += 4) {
    if (((x + y) / 4) % 2) { c.fillStyle = 'rgba(0,0,0,0.07)'; c.fillRect(x, y, 4, 4); }   // 斜紋交錯
  }
  for (let i = 0; i < 400; i++) { c.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.12).toFixed(3) + ')'; c.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); }
  clothTex = new THREE.CanvasTexture(cv); clothTex.wrapS = clothTex.wrapT = THREE.RepeatWrapping; clothTex.repeat.set(2, 2);
  return clothTex;
}
function addSurface(group) {
  const seen = new Set();
  group.traverse(function (o) {
    if (!o.isMesh) return; const m = o.material;
    if (!m || seen.has(m) || m.transparent || !(m.isMeshPhongMaterial || m.isMeshLambertMaterial)) return; seen.add(m);
    const lum = (m.color.r + m.color.g + m.color.b) / 3;
    if (lum < 0.12) return;
    if (!m.map) m.map = getClothTex();
    if (lum > 0.5 && m.isMeshPhongMaterial) { m.shininess = 80; m.specular.setHex(0x9a9a9a); }
    m.needsUpdate = true;
  });
}
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
// 寫實道具：依場景放桌椅、床、書架、車、貨櫃等（貼牆或散落在地面，只是畫面，不擋路）
const PROP_STYLES = ['hospital', 'library', 'garage', 'subway', 'dock', 'crypt', 'station', 'rest', 'field', 'market'];
function buildProps(style, hr) {
  if (PROP_STYLES.indexOf(style) < 0) return;
  const P = [], VX = W.VAN[0], VZ = W.VAN[1];
  const box = function (x, y, z, sx, sy, sz, col) { P.push([new THREE.BoxGeometry(sx, sy, sz), M4(x, y, z), col]); };
  const pick = function (arr) { return arr[Math.floor(hr() * arr.length)]; };
  const edges = [], free = [];
  W.floorCells.forEach(function (fc) {
    const c = fc[0], r = fc[1], cx = c * CS + CS / 2, cz = r * CS + CS / 2;
    if (Math.hypot(cx - VX, cz - VZ) < CS * 1.5) return;
    free.push([cx, cz]);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { if (W.isWall(c + d[0], r + d[1])) edges.push({ cx: cx, cz: cz, d: d }); });
  });
  // 貼牆位置：L 沿牆長度、D 離牆深度
  const slot = function (e, L, D) { const hz = e.d[0] !== 0, o = CS / 2 - D / 2 - 0.03; return { x: e.cx + e.d[0] * o, z: e.cz + e.d[1] * o, sx: hz ? D : L, sz: hz ? L : D, d: e.d }; };
  const spot = function () { const f = pick(free); return [f[0] + (hr() - 0.5) * 1.4, f[1] + (hr() - 0.5) * 1.4]; };
  const each = function (p, fn) { edges.forEach(function (e) { if (hr() < p) fn(e); }); };
  const freeEach = function (p, fn) { free.forEach(function (f) { if (hr() < p) fn(f[0] + (hr() - 0.5) * 1.4, f[1] + (hr() - 0.5) * 1.4); }); };
  if (style === 'hospital') {   // 病床：白色床架、床墊、床頭點滴架
    each(0.3, function (e) { const b = slot(e, 2.3, 1.1); box(b.x, 0.3, b.z, b.sx, 0.6, b.sz, 0xb8c4c8); box(b.x, 0.66, b.z, b.sx * 0.94, 0.14, b.sz * 0.94, 0xf5f7f6);
      const ir = slot(e, 0.1, 0.1); const off = e.d[0] !== 0 ? [0, 0.9] : [0.9, 0]; box(ir.x + off[0], 1.1, ir.z + off[1], 0.06, 2.2, 0.06, 0xdfe4e6); });
    freeEach(0.03, function (x, z) { box(x, 0.4, z, 1.2, 0.8, 0.6, 0xe8ecef); });   // 推車
  } else if (style === 'library') {   // 書架：木層板、彩色書脊
    const bookCols = [0x7a2e22, 0x2e4f72, 0x3c6e3a, 0x96762f, 0x5c3f74, 0x8a4a2a];
    each(0.45, function (e) { const b = slot(e, 3.4, 0.9); box(b.x, 1.4, b.z, b.sx, 2.8, b.sz, 0x5b3a1e);
      [0.45, 1.25, 2.05].forEach(function (y) { box(b.x - b.d[0] * 0.46, y, b.z - b.d[1] * 0.46, b.d[0] !== 0 ? 0.04 : b.sx * 0.9, 0.5, b.d[0] !== 0 ? b.sz * 0.9 : 0.04, pick(bookCols)); }); });
    freeEach(0.04, function (x, z) { box(x, 0.38, z, 1.6, 0.06, 0.9, 0x8a6a40); box(x, 0.18, z, 1.4, 0.36, 0.7, 0x6e4e2e); });   // 閱覽桌
  } else if (style === 'garage') {   // 停好的車
    const carCols = [0x9aa4ae, 0x8b1e1e, 0x1f3f7a, 0xe8e8e4, 0x2e2e2e];
    each(0.22, function (e) { const b = slot(e, 3.4, 1.8); box(b.x, 0.55, b.z, b.sx, 0.7, b.sz, pick(carCols)); box(b.x, 1.2, b.z, b.sx * 0.82, 0.55, b.sz * 0.6, 0x2a3440); });
    freeEach(0.03, function (x, z) { box(x, 1.8, z, 0.6, 3.6, 0.6, 0x9a9a92); });   // 柱子
  } else if (style === 'subway') {   // 候車長椅、車站指示牌
    each(0.3, function (e) { const b = slot(e, 2.4, 0.6); box(b.x, 0.25, b.z, b.sx, 0.5, b.sz, 0x6f7d8c); box(b.x - b.d[0] * 0.25, 0.7, b.z - b.d[1] * 0.25, b.d[0] !== 0 ? 0.1 : b.sx, 0.5, b.d[0] !== 0 ? b.sz : 0.1, 0x566270); });
    each(0.2, function (e) { const sg = slot(e, 1.8, 0.1); box(sg.x, 2.6, sg.z, sg.sx, 0.5, sg.sz, pick([0x1e4f9a, 0xc84a2a, 0x2e8b57])); });
  } else if (style === 'dock') {   // 貨櫃
    each(0.3, function (e) { const b = slot(e, 4.0, 2.2); box(b.x, 1.2, b.z, b.sx, 2.4, b.sz, pick([0xb83a2a, 0x2a5ea8, 0x3d8b4a, 0xd08a2a])); });
    freeEach(0.02, function (x, z) { box(x, 0.35, z, 1.0, 0.7, 1.0, 0x6b5438); });   // 木箱
  } else if (style === 'crypt') {   // 石棺
    each(0.3, function (e) { const b = slot(e, 2.0, 0.8); box(b.x, 0.4, b.z, b.sx, 0.7, b.sz, 0x6e6a74); box(b.x, 0.8, b.z, b.sx * 1.05, 0.15, b.sz * 1.05, 0x5a5660); });
  } else if (style === 'station') {   // 加油機
    freeEach(0.05, function (x, z) { box(x, 0.8, z, 0.9, 1.6, 0.6, 0xd83a2a); box(x, 1.7, z, 0.9, 0.2, 0.6, 0xf2f2f2); box(x, 1.2, z + 0.31, 0.5, 0.3, 0.02, 0x1e2a33); });
  } else if (style === 'rest') {   // 野餐桌、販賣機
    freeEach(0.04, function (x, z) { box(x, 0.75, z, 2.0, 0.08, 0.9, 0xa37a4a); box(x, 0.42, z, 2.0, 0.06, 0.4, 0x7a5a32); box(x, 0.42, z + 1.3, 2.0, 0.06, 0.4, 0x7a5a32); });
    each(0.12, function (e) { const b = slot(e, 0.9, 0.8); box(b.x, 1.0, b.z, b.sx, 2.0, b.sz, pick([0xd23a3a, 0x2a6fb8, 0x2e8b57])); });
  } else if (style === 'field') {   // 看台
    each(0.2, function (e) { const b = slot(e, 4.0, 1.0); box(b.x, 0.45, b.z, b.sx, 0.9, b.sz, 0xc8c8c8); box(b.x, 0.92, b.z, b.sx, 0.04, b.sz, 0x2a5aa0); });
  } else if (style === 'market') {   // 攤位：布棚、桌子、柱子
    freeEach(0.05, function (x, z) { const cc = pick([0xd9423a, 0xf2f2f2]); box(x, 2.4, z, 2.6, 0.12, 2.0, cc); box(x, 0.9, z, 2.2, 0.08, 1.0, 0x8a6a40);
      [[-1.2, -0.9], [1.2, -0.9], [-1.2, 0.9], [1.2, 0.9]].forEach(function (q) { box(x + q[0], 1.2, z + q[1], 0.08, 2.4, 0.08, 0x3a3330); }); });
  }
  if (!P.length) return;
  const m = new THREE.Mesh(mergeGeos(P), litMat({ vertexColors: true })); level.add(m);
}
function part(geo, m, x, y, z) { const o = new THREE.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); return o; }

/** 角色造型（純外觀）：寫實比例的士兵（約 1.8 公尺、頭身比約 1:7.5），正面朝 +z。
 * 每個角色都是真人，用頭盔、面罩、塗裝表現主題；以後新增角色也照這個身體做，只換 THEME 裡的裝備。
 * 隊伍色（或服裝顏色）用在防彈背心上。 */
const SKIN = [0xc68e64, 0xe0b48e, 0x8d5a3b, 0xf0c8a8];   // 依隊伍位置換膚色
/* ---------- 寫實士兵模型（models/Soldier.glb，three.js 範例裡的 Mixamo 角色，有待機／走路／跑步動畫） ----------
 * 模型載入前先用程式畫的士兵（buildCharCode）；載好之後所有角色與預覽自動換成模型。
 * 每個角色用不同的塗裝顏色分辨，服裝（金色、霓虹…）會蓋過角色顏色。 */
let SOLDIER = null, SOLDIER_K = 1, soldierLoading = false;
const CHAR_TINT = [0x8a9a6a, 0x9aa6ae, 0xf0f2f4, 0x4a4a52, 0xe0782a, 0xb8915c, 0x5f8f45, 0x5fb8a0];   // 回收員、機器人、太空人、貓貓、南瓜頭、紙箱人、恐龍、外星人
function loadSoldier() {
  if (SOLDIER || soldierLoading || !THREE.GLTFLoader || !THREE.SkeletonUtils) return;
  soldierLoading = true;
  new THREE.GLTFLoader().load('models/Soldier.glb', function (gl) {
    gl.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gl.scene), h = box.max.y - box.min.y;
    SOLDIER_K = h > 0.1 ? 1.8 / h : 1;
    gl.scene.traverse(function (o) { if (o.isMesh && o.material && o.material.map) { o.material.map.encoding = THREE.LinearEncoding; o.material.needsUpdate = true; } });
    SOLDIER = gl;
    // 已經在畫面上的角色與預覽換成模型
    view.players.forEach(function (p) {
      if (!p.avatar) return; const vis = p.avatar.visible, pos = p.avatar.position.clone(), rot = p.avatar.rotation.y;
      scene.remove(p.avatar); p.avatar = buildAvatar(p); p.avatar.visible = vis; p.avatar.position.copy(pos); p.avatar.rotation.y = rot;
    });
    pvs.forEach(function (pv) { if (!pv.gun && pv.args) RR.Game.preview.apply(null, [pv.canvas].concat(pv.args)); });
  }, undefined, function () { soldierLoading = false; });
}
function buildSoldier(c, slot, h, o, pet) {
  const g = new THREE.Group(), m = THREE.SkeletonUtils.clone(SOLDIER.scene);
  m.scale.multiplyScalar(SOLDIER_K); m.rotation.y = Math.PI;   // 模型原本面向 -z，轉成面向 +z
  const tint = new THREE.Color(o && COSTUME_COL[o] ? COSTUME_COL[o] : CHAR_TINT[c] || CHAR_TINT[0]), glowO = o === 2 || o === 3;
  m.traverse(function (x) {
    if (!x.isMesh) return;
    x.frustumCulled = false; x.castShadow = true;
    x.material = x.material.clone();
    if (/visor/i.test(x.name)) { x.material.emissive = new THREE.Color(c === 1 || c === 7 ? 0x6ad8ff : 0x223344); x.material.emissiveIntensity = c === 1 || c === 7 ? 0.8 : 0.3; }
    else { x.material.color = tint.clone().lerp(new THREE.Color(0xffffff), 0.18); if (glowO) { x.material.emissive = tint.clone().multiplyScalar(0.25); } }
  });
  g.add(m);
  const mixer = new THREE.AnimationMixer(m), acts = {};
  SOLDIER.animations.forEach(function (a) { acts[a.name] = mixer.clipAction(a); });
  if (acts.Idle) { acts.Idle.play(); acts.Idle.time = Math.random() * 2; }
  mixer.update(0.01);
  g.userData.mixer = mixer; g.userData.acts = acts; g.userData.cur = 'Idle';
  g.updateMatrixWorld(true);
  const bone = function (n) { return m.getObjectByName('mixamorig' + n); };
  const head = bone('Head'), hand = bone('RightHand');
  g.userData.handBone = hand;
  if (hand) { const v = new THREE.Vector3(); hand.getWorldPosition(v); g.worldToLocal(v); g.userData.hand = [v.x, v.y, v.z]; }
  // 頭飾掛在頭的骨頭上（骨頭有 0.01 的縮放，要放大回來）
  const hat = buildHat(h || 0);
  if (hat && head) { const ws = new THREE.Vector3(); head.getWorldScale(ws); hat.scale.setScalar(0.62 / ws.x); hat.position.set(0, 0.2 / ws.x, 0.01 / ws.x); head.add(hat); }
  addShadow(g, 0.36);
  const pm = buildPet(pet || 0); if (pm) { pm.position.set(-0.75, 0, -0.25); g.add(pm); g.userData.pet = pm; }
  return g;
}
/** 換動畫：待機／走路／跑步之間淡入淡出 */
function soldierAnim(g, name) {
  const a = g.userData.acts; if (!a || g.userData.cur === name || !a[name]) return;
  const from = a[g.userData.cur]; a[name].reset().play(); if (from) a[name].crossFadeFrom(from, 0.25, false);
  g.userData.cur = name;
}
/** 武器跟著模型的右手走（模型有動畫，手的位置每格都會變） */
const _hv = new THREE.Vector3();
function followHand(g) {
  const hb = g.userData.handBone, w = g.userData.weapon; if (!hb || !w) return;
  hb.getWorldPosition(_hv); g.worldToLocal(_hv); w.position.set(_hv.x - 0.04, _hv.y - 0.02, _hv.z + 0.16); w.rotation.z = 0.35;   // 握在手前面、往外斜，不會被身體擋住
}
function buildChar(c, slot, h, o, pet) { return SOLDIER ? buildSoldier(c, slot, h, o, pet) : buildCharCode(c, slot, h, o, pet); }
function buildCharCode(c, slot, h, o, pet) {
  const g = new THREE.Group();
  const vest = o && COSTUME_COL[o] ? litMat({ color: COSTUME_COL[o], emissive: new THREE.Color(COSTUME_COL[o]).multiplyScalar(o === 2 ? 0.45 : o === 3 ? 0.25 : 0.08), shininess: o === 3 ? 90 : 18 })
    : pmat(new THREE.Color(COLORS[slot % 4]).lerp(new THREE.Color(0x3a4032), 0.55).getHex(), 0.08);   // 隊伍色混軍綠，比較像真的裝備
  // 主題：[軍服, 頭盔, 面罩/皮膚露出, 護目鏡]
  const TH = [
    { cloth: 0x3c4a3a, helm: 0x4a5640, face: 'skin', goggle: 0x1a1f22 },   // 回收員：露臉、反光條、回收背包
    { cloth: 0x50585e, helm: 0x8a949a, face: 'visor', goggle: 0x6ad8ff },  // 機器人：金屬外骨骼、發光面罩
    { cloth: 0xd8dde2, helm: 0xe8eef2, face: 'visor', goggle: 0x1c2a3a },  // 太空人：白色防護服、大面罩
    { cloth: 0x3a3a40, helm: 0x2c2c32, face: 'mask', goggle: 0x1a1f22 },   // 貓貓：頭盔上的貓耳、貓臉面罩
    { cloth: 0x3d3a30, helm: 0xd9711c, face: 'mask', goggle: 0x1a1f22 },   // 南瓜頭：橘色頭盔、南瓜面罩
    { cloth: 0x6e5a3e, helm: 0x9a7a50, face: 'mask', goggle: 0x1a1f22 },   // 紙箱人：紙箱色裝甲
    { cloth: 0x3f5a36, helm: 0x4f7a3a, face: 'mask', goggle: 0x1a1f22 },   // 恐龍：綠迷彩、恐龍下顎面罩、背脊
    { cloth: 0x2e3a3a, helm: 0x2a3434, face: 'alien', goggle: 0x050608 }   // 外星人：青色皮膚、大黑護目鏡
  ][c] || null;
  const T = TH || { cloth: 0x3c4a3a, helm: 0x4a5640, face: 'skin', goggle: 0x1a1f22 };
  const cloth = pmat(T.cloth, 0.06), clothD = pmat(new THREE.Color(T.cloth).multiplyScalar(0.7).getHex(), 0.05);
  const gear = pmat(0x24282a, 0.04), strapM = pmat(0x1a1d1e, 0.03), helm = pmat(T.helm, c === 1 ? 0.14 : 0.06);
  const skin = pmat(c === 7 ? 0x7fc8b0 : SKIN[slot % 4], 0.12), black = new THREE.MeshBasicMaterial({ color: 0x0a0c0d });
  const glass = litMat({ color: T.goggle, emissive: new THREE.Color(T.goggle).multiplyScalar(c === 1 ? 0.9 : 0.15), shininess: 120 });
  const add = function (o2) { g.add(o2); return o2; };
  const flat = function (m, sz) { m.scale.z = sz; return m; };
  // --- 軀幹 ---
  add(part(new THREE.BoxGeometry(0.33, 0.16, 0.2), clothD, 0, 0.95, 0));                                   // 骨盆
  add(flat(part(new THREE.CylinderGeometry(0.155, 0.16, 0.24, 20), cloth, 0, 1.12, 0), 0.74));            // 腹部
  add(flat(part(new THREE.CylinderGeometry(0.23, 0.17, 0.3, 24), cloth, 0, 1.35, 0), 0.7));                // 胸
  add(part(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 14), skin, 0, 1.53, 0));                          // 脖子
  // 防彈背心：前後板、側邊、彈匣袋
  add(part(new THREE.BoxGeometry(0.4, 0.36, 0.09), vest, 0, 1.3, 0.12));
  add(part(new THREE.BoxGeometry(0.4, 0.38, 0.08), vest, 0, 1.31, -0.12));
  add(part(new THREE.BoxGeometry(0.07, 0.28, 0.22), vest, -0.19, 1.27, 0)); add(part(new THREE.BoxGeometry(0.07, 0.28, 0.22), vest, 0.19, 1.27, 0));
  for (let k = 0; k < 3; k++) add(part(new THREE.BoxGeometry(0.085, 0.12, 0.05), gear, -0.11 + k * 0.11, 1.2, 0.18));
  add(part(new THREE.BoxGeometry(0.1, 0.07, 0.04), gear, 0.11, 1.38, 0.175));                                // 無線電
  add(part(new THREE.BoxGeometry(0.05, 0.12, 0.02), strapM, -0.13, 1.47, 0.08)); add(part(new THREE.BoxGeometry(0.05, 0.12, 0.02), strapM, 0.13, 1.47, 0.08));   // 肩帶
  // 腰帶與腰包
  add(part(new THREE.BoxGeometry(0.36, 0.05, 0.22), strapM, 0, 1.0, 0));
  add(part(new THREE.BoxGeometry(0.07, 0.09, 0.06), gear, -0.19, 0.97, 0.06)); add(part(new THREE.BoxGeometry(0.08, 0.1, 0.07), gear, 0.19, 0.96, -0.02));
  // 背包
  add(part(new THREE.BoxGeometry(0.3, 0.34, 0.14), pmat(c === 0 ? 0x2a6a3a : 0x3a4034, 0.05), 0, 1.3, -0.23));
  add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 12), clothD, 0, 1.5, -0.23)).rotation.z = Math.PI / 2;   // 捲起的睡墊
  // --- 頭 ---
  const head = add(part(new THREE.SphereGeometry(0.105, 28, 22), T.face === 'skin' || T.face === 'alien' ? skin : black, 0, 1.665, 0.005)); head.scale.set(0.9, 1.12, 1);
  if (T.face === 'skin' || T.face === 'alien') {
    add(part(new THREE.BoxGeometry(0.03, 0.05, 0.03), skin, 0, 1.655, 0.1));                                 // 鼻子
    add(part(new THREE.BoxGeometry(0.06, 0.012, 0.01), pmat(0x6a3a2a, 0.1), 0, 1.612, 0.098));              // 嘴
    add(part(new THREE.SphereGeometry(0.075, 18, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), c === 7 ? skin : pmat(0x2a1e18, 0.05), 0, 1.63, 0.01)).scale.set(1, 1.2, 1.25);   // 下巴（鬍渣）
  } else if (T.face === 'mask') {
    add(part(new THREE.BoxGeometry(0.14, 0.07, 0.04), gear, 0, 1.6, 0.09));                                  // 防護面罩
  }
  // 頭盔＋護目鏡
  const dome = add(part(new THREE.SphereGeometry(0.13, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), helm, 0, 1.69, 0)); dome.scale.set(1, 0.95, 1.08);
  add(part(new THREE.CylinderGeometry(0.135, 0.135, 0.035, 28, 1, true), helm, 0, 1.7, 0));
  add(part(new THREE.BoxGeometry(0.06, 0.04, 0.03), gear, 0, 1.76, 0.125));                                 // 夜視鏡座
  if (T.face === 'visor') { add(part(new THREE.SphereGeometry(0.11, 24, 16, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.3, Math.PI * 0.4), glass, 0, 1.66, 0.01)); }
  else {
    const gw = T.face === 'alien' ? 0.19 : 0.17;
    add(part(new THREE.BoxGeometry(gw, 0.05, 0.04), glass, 0, 1.68, 0.095));
    add(part(new THREE.TorusGeometry(0.115, 0.01, 6, 28), strapM, 0, 1.68, 0)).rotation.x = Math.PI / 2;
  }
  // --- 主題裝備 ---
  if (c === 0) {      // 回收員：反光條
    const hv = litMat({ color: 0xd9f23a, emissive: 0x4a5a08, shininess: 60 });
    add(part(new THREE.BoxGeometry(0.41, 0.025, 0.1), hv, 0, 1.38, 0.125)); add(part(new THREE.BoxGeometry(0.41, 0.025, 0.09), hv, 0, 1.38, -0.125));
  } else if (c === 1) {   // 機器人：肩甲、胸口能量核心
    add(part(new THREE.SphereGeometry(0.03, 14, 10), new THREE.MeshBasicMaterial({ color: 0x5dff8a }), 0, 1.33, 0.17));
    [-1, 1].forEach(function (s) { add(part(new THREE.BoxGeometry(0.12, 0.05, 0.16), helm, s * 0.28, 1.5, 0)).rotation.z = s * -0.3; });
  } else if (c === 2) {   // 太空人：氧氣管
    add(part(new THREE.TorusGeometry(0.09, 0.015, 8, 20, Math.PI), pmat(0x9aa3a8, 0.1), 0.12, 1.45, 0.05)).rotation.y = Math.PI / 2;
  } else if (c === 3) {   // 貓貓：頭盔上的貓耳
    [-1, 1].forEach(function (s) { const e = add(part(new THREE.ConeGeometry(0.035, 0.08, 4), helm, s * 0.08, 1.82, 0)); e.rotation.z = -s * 0.25; });
    add(part(new THREE.BoxGeometry(0.02, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: 0xdddddd }), -0.08, 1.6, 0.112));
    add(part(new THREE.BoxGeometry(0.02, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: 0xdddddd }), 0.08, 1.6, 0.112));
  } else if (c === 4) {   // 南瓜頭：面罩上刻南瓜臉、頭盔頂蒂頭
    add(part(new THREE.CylinderGeometry(0.012, 0.018, 0.05, 8), pmat(0x4f7a3a, 0.2), 0, 1.83, 0));
    add(part(new THREE.BoxGeometry(0.1, 0.012, 0.005), new THREE.MeshBasicMaterial({ color: 0xffa53a }), 0, 1.592, 0.112));
  } else if (c === 5) {   // 紙箱人：背心外面再綁紙箱板
    add(part(new THREE.BoxGeometry(0.34, 0.24, 0.02), pmat(0xb98a55, 0.15), 0, 1.3, 0.175));
    add(part(new THREE.BoxGeometry(0.34, 0.03, 0.025), pmat(0xd9c3a0, 0.2), 0, 1.3, 0.187));
  } else if (c === 6) {   // 恐龍：下顎面罩上的牙、背上一排脊刺
    for (let k = 0; k < 4; k++) add(part(new THREE.ConeGeometry(0.008, 0.02, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), -0.045 + k * 0.03, 1.575, 0.112)).rotation.x = Math.PI;
    for (let k = 0; k < 4; k++) add(part(new THREE.ConeGeometry(0.025, 0.07, 5), pmat(0x6a9a3a, 0.15), 0, 1.8 - k * 0.14, -0.13 - (k ? 0.14 : 0))).rotation.x = -0.5;
  } else if (c === 7) {   // 外星人：耳後的發光觸鬚
    [-1, 1].forEach(function (s) { add(part(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7dffe0 }), s * 0.1, 1.64, -0.02)); });
  }
  // --- 手（以肩膀為軸）：上臂、手肘、前臂、手套 ---
  const glove = pmat(0x1e2022, 0.04);
  const mkArm = function (s) {
    const pv = new THREE.Group(); pv.position.set(s * 0.27, 1.45, 0);
    pv.add(part(new THREE.SphereGeometry(0.08, 16, 12), cloth, 0, 0, 0));
    pv.add(part(new THREE.CylinderGeometry(0.07, 0.058, 0.29, 14), cloth, 0, -0.15, 0));
    pv.add(part(new THREE.SphereGeometry(0.058, 14, 10), clothD, 0, -0.3, 0));
    const fa = new THREE.Group(); fa.position.set(0, -0.3, 0); fa.rotation.x = -0.25; pv.add(fa);
    fa.add(part(new THREE.CylinderGeometry(0.056, 0.046, 0.26, 14), cloth, 0, -0.13, 0));
    fa.add(part(new THREE.BoxGeometry(0.085, 0.1, 0.055), glove, 0, -0.3, 0.01));
    const tip = new THREE.Object3D(); tip.position.set(0, -0.3, 0.01); fa.add(tip); pv.userData.tip = tip;
    return pv;
  };
  // --- 腳（以髖關節為軸）：大腿、護膝、小腿、軍靴 ---
  const mkLeg = function (s) {
    const pv = new THREE.Group(); pv.position.set(s * 0.105, 0.93, 0);
    pv.add(part(new THREE.CylinderGeometry(0.1, 0.076, 0.44, 14), clothD, 0, -0.22, 0));
    pv.add(part(new THREE.BoxGeometry(0.06, 0.12, 0.08), gear, s * 0.095, -0.2, 0.01));                 // 大腿口袋
    pv.add(part(new THREE.BoxGeometry(0.1, 0.1, 0.05), gear, 0, -0.45, 0.06));                          // 護膝
    pv.add(part(new THREE.CylinderGeometry(0.072, 0.056, 0.38, 14), clothD, 0, -0.64, 0));
    pv.add(part(new THREE.BoxGeometry(0.12, 0.13, 0.27), pmat(0x2a2420, 0.04), 0, -0.86, 0.035));      // 軍靴
    pv.add(part(new THREE.BoxGeometry(0.13, 0.03, 0.29), black, 0, -0.915, 0.035));
    return pv;
  };
  const aL = mkArm(-1), aR = mkArm(1), fL = mkLeg(-1), fR = mkLeg(1);
  aR.rotation.x = -0.45;   // 右手往前握著攻擊物
  g.add(aL, aR, fL, fR);
  g.userData.limbs = [aL, aR, fL, fR];
  // 右手手心的位置（武器握在這裡）
  g.updateMatrixWorld(true);
  const hp = new THREE.Vector3(); aR.userData.tip.getWorldPosition(hp); g.userData.hand = [hp.x + 0.02, hp.y - 0.04, hp.z];
  const hat = buildHat(h || 0); if (hat) { hat.scale.setScalar(0.62); hat.position.y = 1.85; g.add(hat); }
  addSurface(g);
  castAll(g);
  addShadow(g, 0.36);   // 不加卡通描邊，看起來比較寫實
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
  } else if (h === 6) {   // 冠軍王冠：金色大光環、上面五顆紅寶石
    const gold = pmat(0xffd24a, 0.45), red = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
    g.add(part(new THREE.TorusGeometry(0.22, 0.03, 12, 36), gold, 0, 0.02, 0));
    g.children[0].rotation.x = Math.PI / 2;
    for (let k = 0; k < 5; k++) g.add(part(new THREE.SphereGeometry(0.035, 10, 8), red, Math.cos(k * 1.2566 + 1.57) * 0.22, 0.02, Math.sin(k * 1.2566 + 1.57) * 0.22));
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
  const wg = buildWeapon(p.w || 0), hd = g.userData.hand || [0.37, 0.67, 0.3]; wg.position.set(hd[0], hd[1], hd[2]); wg.rotation.x = 0.5; wg.rotation.z = -0.4; g.add(wg);   // 握在右手上
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
let gunT = 0, gunMesh = null, gunHeld = false;
// 開火鍵：單擊射擊（近戰模式則揮砍）；切槍／近戰由旁邊的「切槍」鍵負責
let wpnMode = 'gun';
function gunPress() {
  if (wpnMode === 'melee') attack(); else shoot();
}
/* 射擊鍵（電腦 X、右鍵、手把 RT）：近戰狀態下會先自動切回槍再開槍，不用多按一次切槍 */
function fireInput() {
  if (!canControl()) return;
  if (wpnMode === 'melee') weaponPress();
  shoot();
}
// 連殺：自己擊倒怪物或玩家就 +1；15 秒沒有擊倒或死亡就歸零
function addKill() {
  ksN++; ksT = Date.now();
  if (ksN === 3) toast('連殺 3！「偵」無人機可用（看全圖敵人）');
  if (ksN === 6) toast('連殺 6！「空」空中掃射可用');
}
function useUav() { if (ksN >= 3 && uavT <= 0 && canControl()) { uavT = 15; toast('無人機偵察中（15 秒）'); } }
function useAir() {
  if (ksN < 6 || airCdT > 0 || !canControl() || !me.alive) return;
  const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
  if (RR.Game.onAir) RR.Game.onAir(me.x + fx * 12, me.z + fz * 12);
  ksN -= 6; airCdT = 25; toast('呼叫空中掃射…');
}
function reloadPress() { if (canControl() && RR.Game.onReload) RR.Game.onReload(); }
function weaponPress() { if (canControl() && RR.Game.onGunSwitch) { if (wpnMode === 'melee') swapPress(); RR.Game.onGunSwitch(); } }
function swapPress() {
  wpnMode = wpnMode === 'gun' ? 'melee' : 'gun'; toast(wpnMode === 'gun' ? '切回槍' : '切換到近戰');
}
function shoot() {
  if (!canControl() || gunT > 0) return;
  if (me.riding) { toast('在推車上不能開槍'); return; }
  gunT = (W.GUNS[settings.gun | 0] || W.GUNS[0]).cd;
  if (RR.Game.onShoot) RR.Game.onShoot(Math.round(me.yaw * 100) / 100);
}
let zoneMesh = null, outT = 0, poisonT = 0;
let lkSend = undefined, lkPos = null, lkIdx = -1, lockerMeshes = [];   // 櫃子：要送給房主的請求（-1＝出來）、躲在櫃子裡時的位置
function takeLk() { const v = lkSend; lkSend = undefined; return v; }
// 按「櫃」：靠近櫃子就進去（先在本機鎖定位置，房主回應若拒絕，下一次快照會讓你出來）；躲著再按一次就出來
function lockerPress() {
  if (!canControl() || !me.alive) return;
  if (me.inLk) { lkSend = -1; return; }
  let best = -1, bd = 1.8;
  (W.lockers || []).forEach(function (k, i) { const d = Math.hypot(k[0] - me.x, k[1] - me.z); if (d < bd) { bd = d; best = i; } });
  if (best < 0) { toast('靠近櫃子再按'); return; }
  lkSend = best; lkPos = [W.lockers[best][0], W.lockers[best][1]]; me.inLk = true; lkIdx = best;
  me.yaw = (W.lockers[best][2] || 0) + Math.PI; me.pitch = 0;   // 躲進去後面向櫃門，從門縫往外看
}
// 出來：在櫃子旁找一個沒被擋住的位置
function lkExitSpot() {
  const base = lkPos || [me.x, me.z], d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < d.length; i++) { const x = base[0] + d[i][0] * 1.1, z = base[1] + d[i][1] * 1.1; if (!W.blocked(x, z, 0.3) && !hitSolid(x, z, 0)) { me.x = x; me.z = z; return; } }
}
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
  if (skyDome) skyDome.visible = !view.weather;
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
/** 傳送陣：大圓環 + 好幾道光柱從天上往下降落，遠遠就看得到。 */
function makePadFx() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 48), new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  const bm = new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  g.userData.beams = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 9, 14, 1, true), bm);
    const a = i * Math.PI / 2 + 0.4, rr = 1.2;
    b.position.set(Math.cos(a) * rr, 4.5, Math.sin(a) * rr); g.add(b); g.userData.beams.push(b);
  }
  g.userData.t = 0; scene.add(g); return g;
}
function tickPad(dt) {
  if (!padMesh) return;
  padMesh.userData.t += dt;
  padMesh.userData.beams.forEach(function (b, i) {
    const ph = (padMesh.userData.t * 0.6 + i * 0.25) % 1;   // 光柱由上往下降，循環
    b.position.y = 9 - ph * 9; b.material.opacity = 0.15 + 0.3 * (1 - ph);
  });
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
// 死守：砲塔模型與射擊
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
/* ---------- 槍：第一人稱模型、開槍特效 ---------- */
const GM = { dark: 0x2a2e33, steel: 0x50565e, poly: 0x1c1f23, wood: 0x7a4b28, brass: 0xc9a24a, glass: 0x3a7fa8, green: 0x3e4a32 };
const B = function (w, h, d, x, y, z, c, rx, ry, rz) { return [new THREE.BoxGeometry(w, h, d), M4(x, y, z, rx, ry, rz), c]; };
const C = function (r, l, x, y, z, c, r2, seg) { return [new THREE.CylinderGeometry(r2 == null ? r : r2, r, l, seg || 12), M4(x, y, z, Math.PI / 2, 0, 0), c]; };
// 每把槍都是一個合成的網格（一次繪製），muzzle＝槍口位置（相機座標）
function gunParts(i) {
  const p = [];
  if (i === 1) {   // 霰彈槍：長槍管、管狀彈倉、木製護木與槍托
    p.push(B(0.05, 0.07, 0.2, 0, 0, 0.02, GM.dark), C(0.014, 0.5, 0, 0.018, -0.32, GM.steel), C(0.012, 0.38, 0, -0.016, -0.26, GM.dark),
      C(0.024, 0.15, 0, -0.016, -0.2, GM.wood), B(0.042, 0.075, 0.24, 0, -0.03, 0.2, GM.wood, 0.18), B(0.035, 0.09, 0.045, 0, -0.07, 0.08, GM.wood, 0.35),
      B(0.006, 0.012, 0.008, 0, 0.034, -0.56, GM.brass), B(0.012, 0.018, 0.05, 0, -0.045, 0.03, GM.dark));
    return [p, [0, 0.018, -0.58]];
  }
  if (i === 2) {   // 步槍：機匣、護木、彎彈匣、槍托、紅點瞄具
    p.push(B(0.05, 0.065, 0.26, 0, 0, 0, GM.dark), B(0.056, 0.056, 0.2, 0, -0.004, -0.22, GM.poly), C(0.008, 0.16, 0, 0.004, -0.4, GM.steel), C(0.014, 0.04, 0, 0.004, -0.48, GM.dark),
      B(0.03, 0.09, 0.05, 0, -0.07, -0.04, GM.dark, -0.2), B(0.03, 0.06, 0.05, 0, -0.13, -0.06, GM.dark, -0.45),
      B(0.035, 0.09, 0.045, 0, -0.07, 0.08, GM.poly, 0.3), B(0.04, 0.07, 0.2, 0, -0.02, 0.22, GM.poly), B(0.045, 0.085, 0.04, 0, -0.025, 0.33, GM.poly),
      B(0.03, 0.012, 0.2, 0, 0.038, -0.02, GM.steel), B(0.03, 0.035, 0.05, 0, 0.06, -0.02, GM.poly), C(0.011, 0.012, 0, 0.062, -0.047, GM.glass));
    return [p, [0, 0.004, -0.5]];
  }
  if (i === 3) {   // 衝鋒槍：短小、長直彈匣、前握把、折疊槍托
    p.push(B(0.048, 0.065, 0.2, 0, 0, 0, GM.dark), C(0.01, 0.1, 0, 0.008, -0.15, GM.steel), C(0.016, 0.05, 0, 0.008, -0.2, GM.dark),
      B(0.028, 0.17, 0.04, 0, -0.11, -0.05, GM.dark, -0.08), B(0.03, 0.08, 0.035, 0, -0.07, -0.13, GM.poly, -0.2), B(0.033, 0.085, 0.04, 0, -0.07, 0.06, GM.poly, 0.3),
      B(0.008, 0.008, 0.18, 0.018, -0.005, 0.18, GM.steel), B(0.008, 0.008, 0.18, -0.018, -0.005, 0.18, GM.steel), B(0.045, 0.05, 0.012, 0, -0.01, 0.27, GM.steel),
      B(0.006, 0.016, 0.006, 0, 0.042, -0.08, GM.steel), B(0.02, 0.012, 0.012, 0, 0.04, 0.07, GM.steel));
    return [p, [0, 0.008, -0.23]];
  }
  if (i === 4) {   // 狙擊槍：長槍管＋制退器、瞄準鏡、槍機拉柄、迷彩綠槍托、腳架
    p.push(B(0.05, 0.06, 0.3, 0, 0, 0, GM.dark), C(0.011, 0.55, 0, 0.006, -0.42, GM.dark), B(0.03, 0.03, 0.06, 0, 0.006, -0.71, GM.steel),
      C(0.022, 0.28, 0, 0.065, -0.02, GM.poly), C(0.03, 0.06, 0, 0.065, -0.17, GM.poly, 0.022), C(0.027, 0.05, 0, 0.065, 0.13, GM.poly, 0.022), C(0.022, 0.004, 0, 0.065, -0.2, GM.glass), C(0.019, 0.004, 0, 0.065, 0.155, GM.glass),
      B(0.01, 0.025, 0.02, 0, 0.04, -0.08, GM.steel), B(0.01, 0.025, 0.02, 0, 0.04, 0.06, GM.steel), C(0.006, 0.05, 0.03, 0.01, 0.06, GM.steel), [new THREE.SphereGeometry(0.01, 8, 6), M4(0.055, 0.01, 0.06), GM.steel],
      B(0.045, 0.09, 0.26, 0, -0.035, 0.24, GM.green, 0.1), B(0.04, 0.05, 0.12, 0, -0.03, -0.2, GM.green), B(0.035, 0.09, 0.045, 0, -0.08, 0.1, GM.green, 0.35),
      B(0.006, 0.1, 0.006, 0.012, -0.05, -0.3, GM.steel, 1.2), B(0.006, 0.1, 0.006, -0.012, -0.05, -0.3, GM.steel, 1.2), B(0.028, 0.05, 0.05, 0, -0.06, 0.0, GM.dark));
    return [p, [0, 0.006, -0.75]];
  }
  // 以下是 W.GUNS 第 5 種起的各槍造型（索引對應 sim.js 的 GUNS）
  if (i === 5) {   // 破甲重狙：粗重槍管、大型消音器、瞄準鏡、綠色機身
    p.push(B(0.06, 0.08, 0.3, 0, 0, 0, GM.dark), C(0.016, 0.7, 0, 0.005, -0.5, GM.steel), C(0.026, 0.09, 0, 0.005, -0.85, GM.dark),
      B(0.05, 0.06, 0.16, 0, 0, 0.2, GM.green), C(0.024, 0.2, 0, 0.07, -0.05, GM.dark), B(0.03, 0.08, 0.06, 0, -0.08, 0.04, GM.poly));
    return [p, [0, 0.005, -0.9]];
  }
  if (i === 6) {   // 機關槍：方形機匣、綠色彈箱、長槍管、提把
    p.push(B(0.07, 0.09, 0.36, 0, 0, 0, GM.dark), C(0.013, 0.4, 0, 0, -0.46, GM.steel), B(0.06, 0.1, 0.12, 0, -0.09, 0.02, GM.green),
      B(0.02, 0.04, 0.12, 0, 0.07, 0.05, GM.steel), B(0.035, 0.07, 0.12, 0, -0.04, 0.22, GM.poly));
    return [p, [0, 0, -0.68]];
  }
  if (i === 7) {   // 弓弩：木製槍身、左右弓臂、導軌、握把
    p.push(B(0.03, 0.04, 0.45, 0, 0, 0, GM.wood), B(0.25, 0.02, 0.02, -0.12, 0, -0.22, GM.dark, 0, 0.45, 0), B(0.25, 0.02, 0.02, 0.12, 0, -0.22, GM.dark, 0, -0.45, 0),
      B(0.01, 0.01, 0.3, 0, 0.03, -0.05, GM.steel), B(0.035, 0.09, 0.05, 0, -0.07, 0.1, GM.wood, 0.2));
    return [p, [0, 0.01, -0.25]];
  }
  if (i === 8) {   // 三連發：三根並排的槍管（三角排列）
    p.push(B(0.07, 0.07, 0.2, 0, 0, 0, GM.dark), C(0.011, 0.34, -0.022, 0, -0.3, GM.steel), C(0.011, 0.34, 0.022, 0, -0.3, GM.steel), C(0.011, 0.34, 0, 0.024, -0.3, GM.steel),
      B(0.035, 0.1, 0.05, 0, -0.09, 0.07, GM.poly, 0.2));
    return [p, [0, 0.008, -0.48]];
  }
  if (i === 9) {   // 雙管霰彈：兩根短槍管、木製槍托
    p.push(B(0.07, 0.06, 0.16, 0, 0, 0, GM.wood), C(0.014, 0.32, -0.02, 0.01, -0.26, GM.steel), C(0.014, 0.32, 0.02, 0.01, -0.26, GM.steel),
      B(0.035, 0.09, 0.05, 0, -0.07, 0.1, GM.wood, 0.25));
    return [p, [0, 0.01, -0.43]];
  }
  if (i === 10) {   // 迷你衝鋒：小機匣、頂上圓形彈鼓、短槍管
    p.push(B(0.06, 0.07, 0.16, 0, 0, 0, GM.dark), C(0.012, 0.1, 0, 0, -0.2, GM.steel), C(0.04, 0.1, 0, 0.06, 0, GM.poly), B(0.03, 0.05, 0.12, 0, -0.01, 0.14, GM.poly));
    return [p, [0, 0, -0.28]];
  }
  if (i === 11) {   // 重機槍：寬大機身、側邊彈箱、兩腳架、長槍管
    p.push(B(0.09, 0.1, 0.34, 0, 0, 0, GM.green), C(0.015, 0.5, 0, 0, -0.5, GM.dark), B(0.14, 0.1, 0.12, 0.09, -0.01, 0, GM.steel),
      B(0.01, 0.12, 0.01, -0.03, -0.11, -0.42, GM.steel, 0, 0, 0.25), B(0.01, 0.12, 0.01, 0.03, -0.11, -0.42, GM.steel, 0, 0, -0.25));
    return [p, [0, 0, -0.76]];
  }
  if (i === 12) {   // 雷射槍：流線機身、藍色發射口
    p.push(B(0.06, 0.07, 0.26, 0, 0, 0, GM.poly), B(0.04, 0.04, 0.2, 0, 0.05, 0, GM.glass), C(0.02, 0.08, 0, 0, -0.2, GM.glass), C(0.03, 0.05, 0, 0, -0.22, GM.steel),
      B(0.035, 0.09, 0.05, 0, -0.08, 0.08, GM.poly, 0.2));
    return [p, [0, 0, -0.27]];
  }
  if (i === 13) {   // 燃燒槍：背上的燃料桶、短寬噴嘴
    p.push(B(0.05, 0.06, 0.2, 0, 0, 0, GM.dark), C(0.04, 0.28, -0.06, 0.02, 0.1, GM.steel), C(0.02, 0.14, 0, 0, -0.2, GM.steel));
    return [p, [0, 0, -0.29]];
  }
  if (i === 14) {   // 魔法杖：木杖、頂端發光水晶球
    p.push(C(0.014, 0.6, 0, 0, -0.15, GM.wood), B(0.03, 0.09, 0.05, 0, -0.07, 0.1, GM.wood, 0.2), [new THREE.SphereGeometry(0.035, 12, 10), M4(0, 0, -0.5), GM.glass]);
    return [p, [0, 0, -0.52]];
  }
  if (i === 15) {   // 旋風巨炮：粗砲管、前方護盾板
    p.push(C(0.05, 0.55, 0, 0, -0.2, GM.green), C(0.06, 0.06, 0, 0, -0.48, GM.dark), B(0.12, 0.16, 0.02, 0, 0, 0.12, GM.steel), B(0.03, 0.09, 0.05, 0, -0.09, 0.12, GM.poly, 0.2));
    return [p, [0, 0, -0.51]];
  }
  if (i === 16) {   // 赤焰雙管：紅色機身、橘色雙角、長槍管
    p.push(B(0.06, 0.08, 0.22, 0, 0, 0, 0x7a1d12), B(0.045, 0.045, 0.12, 0, 0, -0.16, 0x9a2a18), C(0.012, 0.01, -0.03, 0.02, -0.22, 0xffe066), C(0.012, 0.01, 0.03, 0.02, -0.22, 0xffe066), C(0.018, 0.12, -0.035, 0.06, 0.02, 0xffb040, 0), C(0.018, 0.12, 0.035, 0.06, 0.02, 0xffb040, 0), C(0.014, 0.22, 0, 0, -0.2, GM.steel),
      B(0.035, 0.09, 0.05, 0, -0.07, 0.1, 0x7a1d12, 0.2));
    return [p, [0, 0, -0.33]];
  }
  if (i === 17) {   // 遊騎兵步槍：提把式機匣、彎彈匣、折疊槍托
    p.push(B(0.05, 0.06, 0.3, 0, 0, 0, GM.dark), B(0.03, 0.02, 0.2, 0, 0.04, 0, GM.poly), B(0.03, 0.09, 0.035, 0, -0.09, 0.02, GM.poly, 0.1), B(0.04, 0.07, 0.2, 0, -0.01, 0.24, GM.poly), C(0.009, 0.2, 0, 0, -0.35, GM.steel));
    return [p, [0, 0, -0.46]];
  }
  if (i === 18) {   // 冰紅茶：圓罐造型、藍色罐身、噴嘴
    p.push(C(0.05, 0.2, 0, 0, 0, 0x3fa9e0), C(0.035, 0.03, 0, 0, -0.11, GM.steel), C(0.012, 0.06, 0, 0, -0.15, GM.steel), B(0.04, 0.1, 0.05, 0, -0.1, 0.08, GM.poly, 0.2));
    return [p, [0, 0, -0.18]];
  }
  if (i === 19) {   // 水槍：玩具手槍外型、透明水箱、粉色噴嘴
    p.push(B(0.04, 0.05, 0.14, 0, 0.02, 0, 0x3fd0ff), B(0.05, 0.12, 0.06, 0, 0.09, 0.03, 0xdffaff), B(0.03, 0.08, 0.05, 0, -0.06, 0.05, 0x3fd0ff, 0.25), C(0.01, 0.08, 0, 0.02, -0.14, 0xff5a8a));
    return [p, [0, 0.02, -0.2]];
  }
  if (i === 20) {   // 魚槍：深藍槍身、長矛、捲線輪
    p.push(B(0.05, 0.05, 0.24, 0, 0, 0, 0x2a6ab0), C(0.008, 0.5, 0, 0, -0.45, GM.steel), B(0.03, 0.02, 0.1, 0, 0.04, 0.1, 0x2a6ab0), C(0.025, 0.04, 0, 0.05, 0.06, GM.brass));
    return [p, [0, 0, -0.7]];
  }
  if (i === 21) {   // 貓咪槍：橘色貓頭、貓耳、綠色眼睛
    p.push(B(0.06, 0.06, 0.2, 0, 0, 0, 0xffb347), B(0.02, 0.04, 0.02, -0.03, 0.05, -0.08, 0xffb347, 0, 0, 0.2), B(0.02, 0.04, 0.02, 0.03, 0.05, -0.08, 0xffb347, 0, 0, -0.2), C(0.012, 0.2, 0, 0, -0.25, GM.dark), C(0.008, 0.01, -0.02, 0.01, -0.1, GM.green), C(0.008, 0.01, 0.02, 0.01, -0.1, GM.green));
    return [p, [0, 0, -0.36]];
  }
  if (i === 23) {   // 大蔥槍：白色蔥白、綠色蔥葉，像一根大蔥
    p.push(C(0.03, 0.22, 0, 0, -0.02, 0xf4f8ef), C(0.024, 0.32, 0, 0, -0.3, 0x3c9a3a), C(0.02, 0.1, 0, 0, -0.52, 0x2f7d2b, 0.005), B(0.035, 0.09, 0.05, 0, -0.07, 0.1, GM.poly, 0.2));
    return [p, [0, 0, -0.6]];
  }
  if (i === 22) {   // 狗狗槍：棕色狗頭、垂耳、黑色鼻頭
    p.push(B(0.06, 0.06, 0.2, 0, 0, 0, 0xc98a4b), B(0.03, 0.06, 0.02, -0.04, -0.02, -0.04, 0x6b3f1f), B(0.03, 0.06, 0.02, 0.04, -0.02, -0.04, 0x6b3f1f), C(0.012, 0.2, 0, 0, -0.25, GM.dark));
    return [p, [0, 0, -0.36]];
  }
  // 手槍：滑套（後方防滑紋）、槍身、前後準星、斜握把、扳機護弓
  p.push(B(0.044, 0.048, 0.2, 0, 0.022, 0, GM.dark), B(0.04, 0.03, 0.17, 0, -0.016, 0.005, GM.poly), C(0.009, 0.02, 0, 0.022, -0.105, GM.steel),
    B(0.006, 0.01, 0.008, 0, 0.051, -0.09, GM.steel), B(0.02, 0.01, 0.008, 0, 0.051, 0.09, GM.steel),
    B(0.038, 0.115, 0.05, 0, -0.075, 0.07, GM.poly, 0.26), B(0.04, 0.012, 0.055, 0, -0.13, 0.085, GM.dark, 0.26),
    B(0.008, 0.006, 0.05, 0, -0.04, -0.01, GM.poly), B(0.008, 0.03, 0.006, 0, -0.03, -0.035, GM.poly), B(0.004, 0.02, 0.006, 0, -0.03, 0.005, GM.steel, 0.3));
  for (let k = 0; k < 5; k++) p.push(B(0.046, 0.04, 0.003, 0, 0.022, 0.06 + k * 0.009, 0x1a1d20));
  return [p, [0, 0.022, -0.115]];
}
let flashTex = null, puffTex = null;
function radialTex(stops, size) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size || 64; const g = cv.getContext('2d'), r = cv.width / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r); stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); }); g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.width);
  return new THREE.CanvasTexture(cv);
}
// 槍口火光：星形，加亮混色
function getFlashTex() {
  if (flashTex) return flashTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,210,120,.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr; g.beginPath();
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, rr = k % 2 ? 9 : 31; g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); }
  g.fill(); flashTex = new THREE.CanvasTexture(cv); return flashTex;
}
function getPuffTex() {
  if (puffTex) return puffTex;
  // 煙：柔邊灰色雲團。直接寫像素（RGB 固定白、只算透明度），不用 canvas 半透明繪圖：
  // iPhone 上 canvas 的低透明度像素會被預乘成彩色雜點
  const N = 64, data = new Uint8Array(N * N * 4), blobs = [];
  let sd = 7; const rr = function () { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let k = 0; k < 9; k++) blobs.push([0.5 + (rr() - 0.5) * 0.4, 0.5 + (rr() - 0.5) * 0.4, 0.16 + rr() * 0.14]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N; let a = 0;
    blobs.forEach(function (b) { const d = Math.hypot(u - b[0], v - b[1]) / b[2]; if (d < 1) a += (1 - d * d) * 0.5; });
    const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / 0.5);
    a = Math.min(1, a) * Math.min(1, edge * 2.2);
    const o = (y * N + x) * 4; data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = Math.round(a * 255);
  }
  puffTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); puffTex.magFilter = puffTex.minFilter = THREE.LinearFilter; puffTex.needsUpdate = true;
  return puffTex;
}
// 槍枝造型：替換配色（原廠、沙漠迷彩、叢林迷彩、黃金、黑金、霓虹粉、寒冰）
const GUN_SKIN = [null,
  { dark: 0x9c845e, poly: 0xb79c72, steel: 0x6b5a40, green: 0xa8915f, wood: 0x8a6a40 },
  { dark: 0x3f4f2e, poly: 0x556b3a, steel: 0x3a3f33, green: 0x4a5e33, wood: 0x5a4a2a },
  { dark: 0xd4ad52, poly: 0xb38a2e, steel: 0xf0d27a, green: 0xb38a2e, wood: 0x8a5a20, shine: 1 },
  { dark: 0x111214, poly: 0x18191c, steel: 0xc9a24a, green: 0x111214, wood: 0x1e1a16, shine: 1 },
  { dark: 0xe0559f, poly: 0x2a1630, steel: 0x7ad8ff, green: 0xe0559f, wood: 0x6a2a5a, glow: 0x3a0a28 },
  { dark: 0xc4e6f4, poly: 0x7fb6d6, steel: 0xffffff, green: 0x9fd0e8, wood: 0x9fd0e8, shine: 1 },
  // 第二輪槍枝：極地迷彩、熔岩裂紋、全息、鈦合金、暗夜霓虹
  { dark: 0xc9d3d8, poly: 0xe8eef2, steel: 0x9aa6ad, green: 0xbfcbd1, wood: 0x7d8c94 },
  { dark: 0x1a1412, poly: 0x2e1a14, steel: 0x3b2a22, green: 0xff5a2a, wood: 0x4a1e10, glow: 0x3a0a08 },
  { dark: 0x7fd6ff, poly: 0xc89cff, steel: 0xe8f7ff, green: 0x9dffe1, wood: 0xffc6f0, shine: 1 },
  { dark: 0x4a5058, poly: 0x6a7078, steel: 0xb8c0c8, green: 0x8a9099, wood: 0x2c3036, shine: 1 },
  { dark: 0x0c0f16, poly: 0x151b26, steel: 0x1f2736, green: 0x2de0ff, wood: 0x0a0d12, glow: 0x0a2a3a }];
// 槍身立體感：不用貼圖，改依法線調整頂點色——頂面較亮、底面較暗、側面有反光，避免像貼紙一樣平
function bevelGun(geo) {
  const nor = geo.attributes.normal.array, col = geo.attributes.color.array;
  for (let k = 0; k < nor.length / 3; k++) {
    const nx = nor[k * 3], ny = nor[k * 3 + 1];
    const f = 0.7 + 0.3 * Math.max(0, ny) + (ny > 0.9 ? 0.08 : 0) - (ny < -0.5 ? 0.15 : 0) + 0.08 * Math.abs(nx);
    col[k * 3] *= f; col[k * 3 + 1] *= f; col[k * 3 + 2] *= f;
  }
  geo.attributes.color.needsUpdate = true;
}
function buildGunView(i) {
  if (gunMesh) { camera.remove(gunMesh); gunMesh.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  const gp = gunParts(i | 0), sk = GUN_SKIN[settings.gunSkin | 0];
  if (sk) gp[0].forEach(function (e) { for (const k in GM) if (e[2] === GM[k] && sk[k] != null) { e[2] = sk[k]; break; } });
  gunMesh = new THREE.Group();
  const bodyGeo = mergeGeos(gp[0]); bevelGun(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, litMat({ vertexColors: true, shininess: sk && sk.shine ? 120 : 70, specular: sk && sk.shine ? 0xbbbbbb : 0x666666, emissive: sk && sk.glow ? sk.glow : 0x000000 }));
  gunMesh.add(body);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: getFlashTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const fl2 = fl.clone(); fl2.rotation.y = Math.PI / 2; fl.add(fl2);
  fl.position.set(gp[1][0], gp[1][1], gp[1][2] - 0.05); fl.visible = false; gunMesh.add(fl);
  gunMesh.userData = { kick: 0, flash: fl, muzzle: new THREE.Vector3(gp[1][0], gp[1][1], gp[1][2]), kind: i | 0 };
  gunMesh.position.set(-0.26, -0.27, -0.5); camera.add(gunMesh);
}
// 彈殼：從槍側邊彈出，受重力掉落（相機座標，只給自己看）
function ejectShell() {
  if (!gunMesh || gunMesh.userData.kind === 1) return;
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.022, 6), new THREE.MeshLambertMaterial({ color: GM.brass, emissive: 0x3a2a08 }));
  sh.position.copy(gunMesh.position).add(new THREE.Vector3(0.03, 0.04, 0.02)); camera.add(sh);
  const v = new THREE.Vector3(0.6 + Math.random() * 0.3, 0.8 + Math.random() * 0.4, 0.2), t0 = Date.now(); let last = t0;
  const id = setInterval(function () { const now = Date.now(), dt = (now - last) / 1000; last = now; v.y -= 4 * dt; sh.position.addScaledVector(v, dt); sh.rotation.x += 14 * dt; sh.rotation.z += 9 * dt;
    if (now - t0 > 500) { clearInterval(id); camera.remove(sh); sh.geometry.dispose(); sh.material.dispose(); } }, 16);
}
// 擊中點：火花＋小煙塵
function impactFx(to, hitMon) {
  const n = hitMon ? 8 : 5, bits = [];
  for (let k = 0; k < n; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: hitMon ? 0xff7a2a : 0xffe2a0, fog: false }));
    m.position.copy(to); m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4); scene.add(m); bits.push(m);
  }
  const dust = new THREE.Sprite(new THREE.SpriteMaterial({ map: getPuffTex(), color: hitMon ? 0x8a4a3a : 0xbdb6a8, transparent: true, opacity: 0.7, depthWrite: false }));
  dust.position.copy(to); dust.scale.setScalar(0.3); scene.add(dust);
  const t0 = Date.now(); let last = t0;
  const id = setInterval(function () {
    const now = Date.now(), dt = (now - last) / 1000, t = (now - t0) / 1000; last = now;
    bits.forEach(function (m) { m.userData.v.y -= 9 * dt; m.position.addScaledVector(m.userData.v, dt); m.material.opacity = 1; m.scale.setScalar(Math.max(0.01, 1 - t * 3)); });
    dust.scale.setScalar(0.3 + t * 1.6); dust.material.opacity = Math.max(0, 0.7 - t * 1.6);
    if (t > 0.45) { clearInterval(id); bits.forEach(function (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }); scene.remove(dust); dust.material.dispose(); }
  }, 16);
}
const GUN_SND = [[0.09, 0.22, 520, 140], [0.22, 0.32, 220, 60], [0.07, 0.2, 620, 180], [0.05, 0.15, 720, 220], [0.32, 0.36, 160, 40]];
function showShot(e) {
  const mine = e.id === myId, sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  let from;
  if (mine && gunMesh) { from = gunMesh.userData.muzzle.clone(); gunMesh.localToWorld(from); }
  else from = new THREE.Vector3(e.x, e.ty || 1.25, e.z);
  const to = new THREE.Vector3(e.hx, e.mi >= 0 ? 1.4 : 1.2 + Math.random() * 0.4, e.hz);
  // 彈道：一條很細、很快消失的亮線（用細長方塊，手機上也看得到粗細）
  const len = from.distanceTo(to), col = mine ? FX_COL[RR.Game.settings.fx | 0] || 0xfff1b0 : 0xfff1b0;
  const tr = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, Math.max(0.1, len)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  tr.position.copy(from).lerp(to, 0.5); tr.lookAt(to); scene.add(tr);
  const t0 = Date.now(), id = setInterval(function () {
    const k = (Date.now() - t0) / 90; tr.material.opacity = Math.max(0, 0.85 - k);
    if (k >= 1) { clearInterval(id); scene.remove(tr); tr.geometry.dispose(); tr.material.dispose(); }
  }, 16);
  impactFx(to, e.mi >= 0 || !!e.pk);
  if (e.q) return;   // 霰彈的其他顆：只畫彈道
  const snd = GUN_SND[e.g | 0] || GUN_SND[0], d = Math.hypot(e.x - me.x, e.z - me.z), v = mine ? snd[1] : Math.max(0.03, snd[1] - d * 0.006);
  Sfx.noise(snd[0], v); Sfx.tone(snd[2], 0.07, 'square', v * 0.6, snd[3]);
  if (mine) {
    shakeT = Math.max(shakeT, (e.g | 0) === 4 || (e.g | 0) === 1 ? 0.14 : 0.06); me.ammo = e.ammo;
    if (gunMesh) { gunMesh.userData.kick = (e.g | 0) === 4 || (e.g | 0) === 1 ? 1.6 : 1; const fl = gunMesh.userData.flash; fl.visible = true; fl.rotation.z = Math.random() * 6.3; fl.scale.setScalar((e.g | 0) === 1 || (e.g | 0) === 4 ? 1.5 : 1); setTimeout(function () { fl.visible = false; }, 45); }
    ejectShell();
  }
  if (e.mi >= 0 && view.monsters[e.mi]) view.monsters[e.mi].hitT = 0.18;
}
function isTouchDev() { return ('ontouchstart' in window) || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
// 畫質依「短邊像素」決定：high = 1080、mid = 720、low = 480（不超過螢幕本身的倍率）。太卡時自動降一級。
let quality = 'high', fpsT = 0, fpsN = 0, slowN = 0;
function applyQuality() {
  if (!renderer) return;
  document.body.classList.toggle('qHigh', quality === 'high');   // 高畫質：畫面加一點對比與飽和度、底片顆粒
  const short = Math.max(1, Math.min(window.innerWidth, window.innerHeight));
  const target = quality === 'low' ? 480 : quality === 'mid' ? 720 : 1080;
  renderer.setPixelRatio(Math.max(0.75, Math.min(window.devicePixelRatio || 1, target / short)));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  applyShadows();
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
const BTN = { reload: [154, 392, 46], wsw: [334, 62, 46], locker: [334, 140, 52], swap: [244, 378, 52], uav: [334, 218, 52], air: [334, 296, 52], scope: [58, 348, 58], bomb: [154, 314, 58], tower: [244, 296, 58], veh: [244, 218, 46], run: [64, 84, 76], atk: [154, 66, 64], gun: [154, 150, 58], rescue: [154, 232, 58], jump: [58, 184, 58], dash: [58, 266, 58], skill: [244, 62, 58], smoke: [244, 140, 58] };   // [離右邊, 離底部, 直徑]
// 橫式：畫面矮，改成 4 欄 × 3 列，避免按鍵疊到上方的資訊和按鈕
const BTN_L = { run: [62, 56, 76], atk: [142, 56, 64], gun: [222, 56, 58], swap: [302, 56, 52], uav: [382, 56, 52],
  jump: [62, 136, 58], dash: [142, 136, 58], rescue: [222, 136, 58], scope: [302, 136, 58], air: [382, 136, 52],
  skill: [62, 216, 58], smoke: [142, 216, 58], bomb: [222, 216, 58], tower: [302, 216, 58], veh: [382, 216, 46],
  reload: [462, 56, 46], wsw: [462, 136, 46], locker: [462, 216, 52] };   // 橫式：三排、每排五顆（與螢幕右下角的道具列一樣排成一橫列）
function btnMap() { return window.innerWidth > window.innerHeight ? BTN_L : BTN; }
// 按鍵區太高、畫面放不下時自動縮小（上方留 84px 給資訊列）
function fitScale(map) {
  let ext = 0; Object.keys(map).forEach(function (k) { ext = Math.max(ext, map[k][1] + map[k][2] / 2); });
  return Math.max(0.6, Math.min(1, (window.innerHeight - 84) / (ext * btnScale)));
}
let btnScale = 1, dragBtn = null;
// 左手模式：按鍵整組左右對調（記在 rr_lefty；自訂位置也一起對調）
function isLefty() { try { return localStorage.getItem('rr_lefty') === '1'; } catch (e) { return false; } }
function layoutKey() { return 'rr_layout_' + (window.innerWidth > window.innerHeight ? 'l' : 'p'); }
function loadLayout() { try { return JSON.parse(localStorage.getItem(layoutKey()) || 'null') || {}; } catch (e) { return {}; } }
function layoutButtons() {
  const Wv = window.innerWidth, Hv = window.innerHeight, saved = loadLayout(), map = btnMap(), k = btnScale * fitScale(map);
  Object.keys(map).forEach(function (id) {
    const el = $(id), d = map[id], size = d[2] * k, sv = saved[id];
    let cx = sv ? sv[0] * Wv : Wv - d[0] * k, cy = sv ? sv[1] * Hv : Hv - d[1] * k;
    if (isLefty()) cx = Wv - cx;
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
      const cxN = parseFloat(el.style.left) + size / 2, cxS = isLefty() ? window.innerWidth - cxN : cxN;
      saved[id] = [cxS / window.innerWidth, (parseFloat(el.style.top) + size / 2) / window.innerHeight];
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
let gunSway = 0;   // 槍身左右擺動（視角轉動時槍會跟著往反方向晃）
function look(dx, dy, k) {
  gunSway = Math.max(-0.12, Math.min(0.12, gunSway - dx * k * 0.6));
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
/* 觸控按鍵圖示（白色線條，不寫字）；狀態改變時換圖示 */
const ICONS = {
  run: '<path d="M13 4.5a1.8 1.8 0 1 0 0-.1"/><path d="M9 21l2.5-5.5 3 2.5v4"/><path d="M6 12l3-3.5 4 1 2.5 3.5 3 .5"/><path d="M11.5 15.5l1.5-6"/>',
  atk: '<path d="M14.5 3.5l6 6-9 9-3-3z"/><path d="M8.5 15.5l-5 5"/><path d="M6 13l5 5"/>',
  knife: '<path d="M4 20l9-9"/><path d="M13 11c2-4 5-6 8-7-1 3-3 6-7 8z"/><path d="M6 16l2 2"/>',
  gun: '<path d="M8 21h8v-3H8z"/><path d="M8 18V9c0-3 1.8-5.5 4-6.5 2.2 1 4 3.5 4 6.5v9"/><path d="M8 12h8"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  swap: '<path d="M4 9h13l-3.5-3.5"/><path d="M20 15H7l3.5 3.5"/>',
  uav: '<path d="M12 4v16"/><path d="M3 11l9-2 9 2"/><path d="M8 19l4-1.5 4 1.5"/><circle cx="12" cy="6" r="1.3"/>',
  air: '<path d="M12 2.5c1 1 1.4 3 1.4 5v3.5l8 4.5v2l-8-2.5V19l2.5 2v1.2L12 21.4l-3.9.8V21l2.5-2v-4l-8 2.5v-2l8-4.5V7.5c0-2 .4-4 1.4-5z"/>',
  tower: '<path d="M6 21h12"/><path d="M8 21l1.5-7h5L16 21"/><path d="M8 14h8l-1-4H9z"/><path d="M12 10V4l6 2"/>',
  bomb: '<circle cx="10" cy="14" r="6.5"/><path d="M14.5 9.5l2-2"/><path d="M17 5l1.5-1.5M19 7.5h2M16.5 3V1.5"/>',
  veh: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M3.8 10.5c5 1.5 11.4 1.5 16.4 0"/><path d="M12 14v6.5"/>',
  exit: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4"/><path d="M18 12H9"/>',
  jump: '<path d="M6 13l6-6 6 6"/><path d="M6 19l6-6 6 6"/>',
  dash: '<path d="M5 6l6 6-6 6"/><path d="M12 6l6 6-6 6"/>',
  rescue: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
  locker: '<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M12 3v18"/><path d="M8.5 6.5h2M13.5 6.5h2M8.5 8.5h2M13.5 8.5h2"/><path d="M10.5 13v2M13.5 13v2"/>',
  smoke: '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 0 9.5z"/>',
  scope: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
  skill: '<path d="M13 2L5 13.5h6L10 22l9-12.5h-6z"/>',
  wsw: '<path d="M3 10h12l2-2h3v5h-4l-1 1H9l-1 3H5l1-4H3z"/><path d="M7 20h10l-2.5-2.5"/>'
};
function setIcon(id, name) {
  const el = $(id); if (!el || el.dataset.icon === name) return;
  el.dataset.icon = name;
  el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
}
function initIcons() {
  ['run', 'atk', 'gun', 'swap', 'uav', 'air', 'tower', 'bomb', 'veh', 'jump', 'dash', 'rescue', 'locker', 'smoke', 'scope', 'skill', 'reload', 'wsw'].forEach(function (id) {
    const el = $(id); if (!el) return;
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.trim());
    el.title = el.getAttribute('aria-label'); setIcon(id, id);
  });
  // 設定裡的「手機上顯示的按鈕」勾選框也改用同一套圖示（不再顯示舊的文字）
  Array.prototype.forEach.call(document.querySelectorAll('#btnChks .btnChk'), function (lb) {
    const inp = lb.querySelector('input'), sp = lb.querySelector('span'), id = inp && inp.dataset.btn;
    if (!sp || !id || !ICONS[id]) return;
    sp.textContent = ''; sp.setAttribute('aria-label', (lb.dataset.label || id));
    sp.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[id] + '</svg>';
  });
}
function bindInput() {
  initIcons();
  { const g = $('setGyro'); let saved = false; try { saved = localStorage.getItem('rr_gyro') === '1'; } catch (e) {} gyroOn = saved; if (g) { g.checked = saved; g.addEventListener('change', function () { gyroSet(g.checked); }); } }
  window.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (keyCapture) { e.preventDefault(); const cb = keyCapture; keyCapture = null; cb(e.code); return; }   // 設定頁正在改按鍵
    if (e.code === 'Escape' && active) { const mb = $('hudMore'); if (mb) mb.click(); return; }
    const kc = keyCode(e.code);
    keys[kc] = true;
    if (canControl() && kc.indexOf('Arrow') === 0) e.preventDefault();
    if (active && kc === 'KeyM') RR.Game.toggleMic();
    if (kc === 'KeyQ' && !e.repeat) trySmoke();
    if (kc === 'KeyE' && !e.repeat && canControl()) swapPress();
    if (kc === 'KeyU' && !e.repeat) useUav();
    if (kc === 'KeyH' && !e.repeat) reloadPress();
    if (kc === 'KeyK' && !e.repeat) weaponPress();
    if (kc === 'KeyJ' && !e.repeat) useAir();
    if (kc === 'KeyR' && !e.repeat) trySkill();
    if (kc === 'KeyY' && !e.repeat && canControl()) { e.preventDefault(); lockerPress(); }
    if (kc === 'KeyG' && !e.repeat && canControl() && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) { if ($('scrMini').classList.contains('hide')) openMini(); else closeMini(); }
    if (kc === 'KeyF') { if (canControl()) { e.preventDefault(); attack(); } }
    if (kc === 'Space') { if (canControl()) { e.preventDefault(); if (!e.repeat) jumpQ = true; } }
    if (kc === 'KeyC' && !e.repeat && canControl()) dashQ = true;
    if (kc === 'KeyX' && canControl()) { gunHeld = true; if (!e.repeat) fireInput(); }
    if (kc === 'KeyB' && !e.repeat && canControl() && RR.Game.onBomb) RR.Game.onBomb(Math.round(me.yaw * 100) / 100);
    if (kc === 'KeyZ' && !e.repeat && canControl()) scopeOn = !scopeOn;
    if (kc === 'KeyT' && !e.repeat && canControl() && view.mode === 'td' && RR.Game.onTower) RR.Game.onTower();
    if (kc === 'KeyV' && !e.repeat && canControl()) vhQ = true;
  });
  window.addEventListener('keyup', function (e) { const kc = keyCode(e.code); keys[kc] = false; if (kc === 'KeyX') gunHeld = false; });
  window.addEventListener('blur', function () { for (const k in keys) keys[k] = false; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (ev) {
    if (active && view.phase === 'play' && !me.alive) { nextSpec(); return; }
    if (!canControl()) return;
    if (ev.button === 2) { gunHeld = true; fireInput(); return; }
    dragging = true;
    if (document.pointerLockElement !== canvas) lockPointer(); else attack();   // 鎖定滑鼠後，左鍵 = 揮擊
  });
  window.addEventListener('mouseup', function () { dragging = false; gunHeld = false; });
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
  // 跑步鍵：按住跑；點一下切換「自動連續跑」（再點一下關掉）
  let runDownT = 0;
  runBtn.addEventListener('touchstart', function (e) { e.preventDefault(); touch.run = true; runDownT = Date.now(); runBtn.classList.add('on'); }, { passive: false });
  const runOff = function (e) {
    e.preventDefault(); touch.run = false; runBtn.classList.remove('on');
    if (e.type === 'touchend' && Date.now() - runDownT < 250) { touch.runLock = !touch.runLock; runBtn.classList.toggle('lock', touch.runLock); toast(touch.runLock ? '自動跑步：開' : '自動跑步：關'); }
  };
  runBtn.addEventListener('touchend', runOff, { passive: false }); runBtn.addEventListener('touchcancel', runOff, { passive: false });
  runBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  $('micBtn').addEventListener('click', function () { RR.Game.toggleMic(); });
  $('mini').addEventListener('click', function () { $('mini').classList.toggle('big'); });
  [['jump', function () { jumpQ = true; }], ['dash', function () { dashQ = true; }], ['gun', gunPress], ['swap', swapPress], ['uav', useUav], ['air', useAir], ['reload', reloadPress], ['wsw', weaponPress], ['bomb', function () { if (RR.Game.onBomb) RR.Game.onBomb(Math.round(me.yaw * 100) / 100); }], ['veh', function () { vhQ = true; }], ['tower', function () { if (view.mode === 'td' && RR.Game.onTower) RR.Game.onTower(); }]].forEach(function (q) {
    const b = $(q[0]);
    b.addEventListener('touchstart', function (e) { e.preventDefault(); if (q[0] === 'gun') gunHeld = wpnMode === 'gun'; if (canControl()) q[1](); }, { passive: false });
    if (q[0] === 'gun') { const up = function (e) { e.preventDefault(); gunHeld = false; }; b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false }); }
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  const atkBtn = $('atk');
  atkBtn.addEventListener('touchstart', function (e) { e.preventDefault(); attack(); }, { passive: false });
  atkBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // 手機：救援（按住）與煙霧彈（按一下）
  const lockerBtn = $('locker');
  lockerBtn.addEventListener('touchstart', function (e) { e.preventDefault(); lockerPress(); }, { passive: false });
  const rescueBtn = $('rescue');
  const rescueOff = function (e) { e.preventDefault(); keys.KeyE = false; rescueBtn.classList.remove('on'); };
  rescueBtn.addEventListener('touchstart', function (e) { e.preventDefault(); keys.KeyE = true; rescueBtn.classList.add('on'); }, { passive: false });
  rescueBtn.addEventListener('touchend', rescueOff, { passive: false }); rescueBtn.addEventListener('touchcancel', rescueOff, { passive: false });
  rescueBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  $('scope').addEventListener('click', function () { scopeOn = !scopeOn; });
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

/* ---------- 電腦按鍵自訂 ----------
 * 程式裡都用預設按鍵判斷；玩家改了按鍵，就把新按鍵翻譯成預設按鍵（keyCode），原本的預設按鍵則停用，避免一鍵兩用。 */
const KEY_ACTIONS = [['前進', 'KeyW'], ['後退', 'KeyS'], ['左移', 'KeyA'], ['右移', 'KeyD'], ['跑步', 'ShiftLeft'], ['跳', 'Space'], ['衝刺', 'KeyC'],
  ['開槍', 'KeyX'], ['近戰攻擊', 'KeyF'], ['切近戰／救人', 'KeyE'], ['換槍', 'KeyK'], ['開鏡', 'KeyZ'], ['煙霧彈', 'KeyQ'], ['技能', 'KeyR'], ['炸藥', 'KeyB'],
  ['躲櫃子', 'KeyY'], ['上車', 'KeyV'], ['無人機', 'KeyU'], ['空中掃射', 'KeyJ'], ['蓋塔（死守）', 'KeyT'], ['小遊戲', 'KeyG'], ['麥克風', 'KeyM']];
let keyMap = {}, keyBack = {}, keyCapture = null;
function keyLoad() {
  keyMap = {}; keyBack = {};
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('rr_keys') || '{}') || {}; } catch (e) {}
  KEY_ACTIONS.forEach(function (a) { const cur = saved[a[1]]; if (cur && cur !== a[1]) { keyMap[cur] = a[1]; keyBack[a[1]] = cur; } });
}
function keyCode(c) { if (keyMap[c]) return keyMap[c]; if (keyBack[c]) return '_off_' + c; return c; }
keyLoad();
// 電腦：玩家按 Esc 讓滑鼠離開鎖定時（瀏覽器吃掉 Esc，頁面收不到），自動打開選單；程式自己解除鎖定時不算
let codeUnlock = false;
if (document.exitPointerLock) { const _ex = document.exitPointerLock.bind(document); document.exitPointerLock = function () { codeUnlock = true; setTimeout(function () { codeUnlock = false; }, 300); return _ex(); }; }
document.addEventListener('pointerlockchange', function () {
  if (document.pointerLockElement || codeUnlock || !active) return;
  const m = document.getElementById('hudMenu'); if (m && m.classList.contains('hide')) { const mb = document.getElementById('hudMore'); if (mb) mb.click(); }
});
/* ---------- 遊戲手把（Xbox／PS 標準配置，Steam Deck 也一樣） ----------
 * 左搖桿移動、右搖桿轉視角、RT 開槍（按住連射）、LT 開鏡、A 跳、B 衝刺、X 切近戰／救人（按住）、Y 換槍、
 * LB 煙霧彈、RB 技能、L3 切換跑步、R3 近戰攻擊、十字鍵：上 UAV、下 櫃子、左 炸藥、右 空中掃射、Back 上車、Start 選單 */
const pad = { x: 0, y: 0, prev: [], run: false, shoot: false, scope: false, on: false };
function padDead(v) { return Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82; }
function pollPad(dt) {
  const gps = navigator.getGamepads ? navigator.getGamepads() : null, gp = gps && Array.prototype.find.call(gps, function (g) { return g && g.connected; });
  if (!gp) { pad.x = pad.y = 0; if (pad.shoot) { pad.shoot = false; gunHeld = false; } return; }
  if (RR.PadNav && RR.PadNav.owns()) { pad.x = pad.y = 0; if (pad.shoot) { pad.shoot = false; gunHeld = false; } pad.prev = gp.buttons.map(function (b) { return !!(b && (b.pressed || b.value > 0.5)); }); return; }   // 選單開著：手把交給選單
  pad.on = true;
  const ax = gp.axes, bt = function (i) { const b = gp.buttons[i]; return b ? (typeof b === 'object' ? b.value > 0.5 || b.pressed : b > 0.5) : false; };
  const down = function (i) { const now = bt(i), was = !!pad.prev[i]; pad.prev[i] = now; return now && !was; };
  pad.x = padDead(ax[0] || 0); pad.y = padDead(ax[1] || 0);
  const rx = padDead(ax[2] || 0), ry = padDead(ax[3] || 0);
  if ((rx || ry) && canControl()) look(rx * Math.abs(rx) * dt * 1100, ry * Math.abs(ry) * dt * 760, 0.0024);
  if (!canControl()) { pad.prev = gp.buttons.map(function (_, i) { return bt(i); }); return; }
  if (down(0)) jumpQ = true;
  if (down(1)) dashQ = true;
  if (down(2)) swapPress(); keys.PadRescue = bt(2);
  if (down(3)) weaponPress();
  if (down(4)) trySmoke();
  if (down(5)) trySkill();
  const lt = bt(6); if (lt !== pad.scope) { pad.scope = lt; scopeOn = lt; }
  const rt = bt(7); if (rt && !pad.shoot) { pad.shoot = true; gunHeld = true; fireInput(); } else if (!rt && pad.shoot) { pad.shoot = false; gunHeld = false; }
  if (down(8)) vhQ = true;
  if (down(9)) { const mb = document.getElementById('hudMore'); if (mb) mb.click(); }
  if (down(10)) { pad.run = !pad.run; toast(pad.run ? '跑步：開' : '跑步：關'); }
  if (down(11)) attack();
  if (down(12)) useUav();
  if (down(13)) lockerPress();
  if (down(14) && RR.Game.onBomb) RR.Game.onBomb(Math.round(me.yaw * 100) / 100);
  if (down(15)) { if (view.mode === 'td' && RR.Game.onTower) RR.Game.onTower(); else useAir(); }
}
window.addEventListener('gamepadconnected', function (e) { toast('已連接手把：' + String(e.gamepad.id || '').slice(0, 24)); });
window.addEventListener('gamepaddisconnected', function () { toast('手把已中斷'); pad.x = pad.y = 0; });
/* 回收物稀有度：地上一圈顏色光圈（灰 普通、綠 優良、藍 稀有、金 傳說），稀有以上加一道光柱，遠遠就看得出哪個值錢 */
const RAR_COL = [0xd8d2c4, 0x5ee07a, 0x4aa8ff, 0xffc63a];
const rarGeo = { ring: new THREE.RingGeometry(0.34, 0.5, 28), beam: new THREE.CylinderGeometry(0.05, 0.12, 2.6, 10, 1, true) };
function rarFx(x, z, kind) {
  const kd = W.KINDS[kind]; if (!kd) return null;
  const r = kd.rar | 0, col = RAR_COL[r], g = new THREE.Group();
  const ring = new THREE.Mesh(rarGeo.ring, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  if (r >= 2) { const bm = new THREE.Mesh(rarGeo.beam, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: r === 3 ? 0.4 : 0.26, blending: THREE.AdditiveBlending, depthWrite: false })); bm.position.y = 1.3; g.add(bm); }
  g.position.set(x, 0, z); scene.add(g); return g;
}
/** 依照 [x, z, 種類, 價值] 做出一件地上物品（開局與換物品共用）。 */
function makeItem(a) {
  const isk = RR.Game.settings.itemSkin | 0;   // 回收品造型：0 預設、1 糖果（圓球粉彩）、2 寶石（八面體亮色）
  const icol = isk === 1 ? [0xffb3d1, 0xb3e5ff, 0xfff0a8, 0xd5b8ff, 0xb8ffd9][a[2] % 5] : isk === 2 ? [0xff4a6a, 0x4ac8ff, 0x6aff8a, 0xffd24a, 0xc86aff][a[2] % 5] : [0xffd166, 0x6ecbff, 0xff9f5a, 0xc9a0ff, 0xff7eb6, 0x9be564, 0xffe94a, 0xfff3b0, 0x5affc9, 0xffb86b, 0xbfc7d1][a[2] % 11];
  if (a[2] >= 20) {   // 廢墟生存戰補給箱：綠 急救、藍 護甲、紅 火力
    const lm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), new THREE.MeshBasicMaterial({ color: [0x4ade80, 0x5aa9ff, 0xff5a5a][a[2] - 20] || 0xffffff }));
    lm.position.set(a[0], 0.45, a[1]); scene.add(lm);
    return { x: a[0], z: a[1], kind: a[2], value: 0, taken: false, mesh: lm };
  }
  const mesh = new THREE.Mesh(isk === 1 ? skinGeos[0] : isk === 2 ? skinGeos[1] : (function () { const vs = itemGeos[a[2] % itemGeos.length]; return vs[Math.abs(Math.floor(a[0] * 7 + a[1] * 13)) % vs.length]; })(), isk ? new THREE.MeshBasicMaterial({ color: icol }) : salvageMat());
  mesh.position.set(a[0], 0.75, a[1]); scene.add(mesh);
  return { x: a[0], z: a[1], kind: a[2], value: a[3], taken: false, mesh: mesh, fx: rarFx(a[0], a[1], a[2]) };
}
/* 地圖陷阱：彈簧（綠色彈簧圈，踩到衝刺）、大坑（深色坑洞，踩到減速） */
let trapMeshes = [];
function clearTraps() { trapMeshes.forEach(function (m) { scene.remove(m); }); trapMeshes = []; }
function buildTraps() {
  clearTraps();
  (view.traps || []).forEach(function (t) {
    const g = new THREE.Group();
    if (t[2] === 0) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 8, 20), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; g.add(ring);
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x86efac, wireframe: true }));
      coil.position.y = 0.18; g.add(coil);
    } else {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), new THREE.MeshBasicMaterial({ color: 0x1a120c }));
      hole.rotation.x = -Math.PI / 2; hole.position.y = 0.03; g.add(hole);
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 24), new THREE.MeshBasicMaterial({ color: 0x8a6a4a, side: THREE.DoubleSide }));
      rim.rotation.x = -Math.PI / 2; rim.position.y = 0.035; g.add(rim);
    }
    g.position.set(t[0], 0, t[1]); scene.add(g); trapMeshes.push(g);
  });
}
/** 站在陷阱上的速度倍率：彈簧衝刺 1.2 秒（冷卻 1.5 秒），大坑減速。 */
function trapMul(dt) {
  if (!view.traps || !view.traps.length || me.riding || me.passenger || !me.alive) return 1;
  me.springCd = Math.max(0, (me.springCd || 0) - dt); me.springT = Math.max(0, (me.springT || 0) - dt);
  let m = 1;
  view.traps.forEach(function (t) {
    const d = Math.hypot(t[0] - me.x, t[1] - me.z);
    if (t[2] === 0 && d < 1.0 && me.springCd <= 0) { me.springT = 1.2; me.springCd = 1.5; }
    if (t[2] === 1 && d < 1.0) m *= 0.45;
  });
  if (me.springT > 0) m *= 1.8;
  return m;
}
function itemVis(it, v) { it.mesh.visible = v; if (it.fx) it.fx.visible = v; }
/* ---------- 每幀更新 ---------- */
function updateMe(dt) {
  pollPad(dt);
  if (keys.ArrowLeft) me.yaw += 2.2 * dt;
  if (keys.ArrowRight) me.yaw -= 2.2 * dt;
  if (me.inLk) { if (lkPos) { me.x = lkPos[0]; me.z = lkPos[1]; } return; }   // 躲在櫃子裡不能移動
  if (me.passenger && view.veh) {   // 坐後座：跟著車子走，可以轉頭、開槍
    let vx = view.veh[0], vz = view.veh[1]; const rp = view.players.get(view.veh[2]); if (rp) { vx = rp.x; vz = rp.z; }
    me.x = vx + (me.passIdx ? -0.75 : 0.75); me.z = vz + 0.4; return;
  }
  let f = 0, s = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD) s += 1;
  if (keys.KeyA) s -= 1;
  f -= touch.jy + pad.y; s += touch.jx + pad.x;
  let mag = Math.hypot(f, s);
  if (mag > 1) { f /= mag; s /= mag; mag = 1; }
  // 賽車：開車，前後是油門、左右是方向盤（轉向），不能跑步
  let raceMove = false;
  if (view.mode === 'race') { const steer = Math.max(-1, Math.min(1, s)), dk = keys.ShiftLeft || keys.ShiftRight || touch.run || pad.run; raceDrive(Math.max(-0.4, Math.min(1, f)), steer, dt, dk); s = 0; f = Math.max(-0.4, Math.min(1, f)); mag = Math.abs(f); raceMove = true; }
  const moving = mag > 0.15;
  const wantRun = (keys.ShiftLeft || keys.ShiftRight || touch.run || touch.runLock || pad.run) && moving && !me.tired && !me.riding && view.mode !== 'race';
  if (wantRun) { me.stam -= 0.15 * (1 - 0.05 * myGem(1)) * dt; if (me.stam <= 0) { me.stam = 0; me.tired = true; } }
  else { me.stam = Math.min(1, me.stam + 0.28 * (myPet() === 4 ? 1.2 : 1) * (myC() === 7 ? 1.15 : 1) * dt); if (me.tired && me.stam > 0.2) me.tired = false; }
  if (me.rallyT > 0) me.rallyT -= dt;
  const speed0 = (wantRun ? 9.0 : 4.2) * (me.bagN ? 1 - 0.07 * me.bagN : 1.05) * CHAR_SPEED[myC()] * (myPet() === 1 ? 1.05 : 1) * (myEq(1) ? 1.06 : 1) * (iceNear() ? 0.75 : 1) * (me.rallyT > 0 ? 1.2 : 1);   // 靠近藍色（冰）怪物減速 25%
  const speed = (view.mode === 'race' ? 11 : me.riding ? 11.5 * (iceNear() ? 0.75 : 1) : speed0) * (quakeT > 0 ? 0.6 : 1) * trapMul(dt);   // 推車：固定高速、不受背包影響；地震時變慢
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  // 跳：耗 18% 體力，在空中時怪物抓不到；衝刺：往移動方向（沒動就往前）瞬間衝約 4 公尺，耗 25% 體力，冷卻 2.5 秒
  if (me.riding) { jumpQ = false; dashQ = false; }   // 推車上不能跳、衝
  if (jumpQ) { jumpQ = false; const g0 = groundAt(me.x, me.z), fx0 = -Math.sin(me.yaw), fz0 = -Math.cos(me.yaw);
    if (me.vy === 0 && me.y <= g0 + 0.01 && !me.tired && me.stam >= 0.18) { me.vy = 6.2; me.y += 0.001; me.stam -= 0.18; me.air2 = false; Sfx.tone(300, 0.12, 'triangle', 0.08, 520); }
    // 空中再按一次：靠著牆按就會往上爬到牆頂（3.6 公尺）；一般的二段跳高 1.3 公尺左右
    else if (me.y > g0 + 0.05 && !me.air2 && !me.tired && me.stam >= 0.18) { me.air2 = true; const wall = W.blocked(me.x + fx0 * 0.9, me.z + fz0 * 0.9, 0.2); me.vy = wall ? Math.sqrt(30 * Math.max(0.6, WH + 0.3 - me.y)) : 6.2; me.stam -= 0.18; Sfx.tone(420, 0.1, 'triangle', 0.08, 640); } }
  if (dashCd > 0) dashCd -= dt;
  if (dashQ) { dashQ = false; if (dashCd <= 0 && !me.tired && me.stam >= 0.25) {
    const df = moving ? f / mag : 1, ds = moving ? s / mag : 0;
    dashDir = [-sy * df + cy * ds, -cy * df - sy * ds]; dashT = 0.18; dashCd = 2.5; me.stam -= 0.25; Sfx.noise(0.14, 0.12); Sfx.tone(520, 0.14, 'sawtooth', 0.05, 180);
  } else if (dashCd > 0) toast('衝刺冷卻中'); }
  let dx = (-sy * f + cy * s) * speed * dt, dz = (-cy * f - sy * s) * speed * dt;
  if (raceMove) { const hh = me.yaw + (me.slideAng || 0); dx = -Math.sin(hh) * me.spd * dt; dz = -Math.cos(hh) * me.spd * dt; }
  if (dashT > 0) { dashT -= dt; dx += dashDir[0] * 22 * dt; dz += dashDir[1] * 22 * dt; }
  const R = 0.42;
  if (editing) { dx = 0; dz = 0; }   // 調整按鈕位置時不移動
  const bx0 = me.x, bz0 = me.z;
  const inS = hitSolid(me.x, me.z, me.y);   // 萬一已經卡在擺設裡就放行，讓玩家走得出來
  const onTop = me.y >= WH - 0.25 && (W.isWall(Math.floor(me.x / CS), Math.floor(me.z / CS)) || W.blocked(me.x, me.z, 1.1));   // 在牆頂（或牆邊起跳上牆）才可以走過牆；空中飄在空地上不行
  if ((onTop || !W.blocked(me.x + dx, me.z, R)) && (inS || !hitSolid(me.x + dx, me.z, me.y))) me.x += dx;
  if ((onTop || !W.blocked(me.x, me.z + dz, R)) && (inS || !hitSolid(me.x, me.z + dz, me.y))) me.z += dz;
  if (raceMove) raceImpact(bx0, bz0, dx, dz);
  // 重力：腳下是地板或擺設頂端；走出箱子邊緣會掉下來
  { const gnd = groundAt(me.x, me.z);
    if (me.y > gnd || me.vy > 0) { me.vy -= 15 * dt; me.y += me.vy * dt; if (me.y <= gnd) { if (me.vy < -2) Sfx.noise(0.05, 0.06); me.y = gnd; me.vy = 0; me.air2 = false; } }
    else { me.y = gnd; me.vy = 0; me.air2 = false; }
    me.gnd = gnd; }
  if (moving) {
    const before = Math.floor(me.walkT / Math.PI);
    me.walkT += dt * (wantRun ? 13 : 8.5) * mag;
    if (Math.floor(me.walkT / Math.PI) !== before) { Sfx.tone(wantRun ? 85 : 70, 0.06, 'sine', wantRun ? 0.09 : 0.045); Sfx.noise(0.035, wantRun ? 0.05 : 0.028); }
  }
  me.running = wantRun;
  if (uavT > 0) uavT -= dt;
  if (airCdT > 0) airCdT -= dt;
  if (ksN && (!me.alive || Date.now() - ksT > 15000)) ksN = 0;
  { const u = $('uav'), a = $('air'); if (u) u.classList.toggle('hide', !(ksN >= 3 && me.alive)); if (a) a.classList.toggle('hide', !(ksN >= 6 && me.alive)); }
  // 跑步時視野變寬，讓速度感更明顯
  const sniping = scopeOn && (settings.gun | 0) === 4;
  const fovT = sniping ? 24 : dashT > 0 ? 96 : wantRun ? 88 : 75;
  { const sb = $('scope'); if (sb) { sb.classList.toggle('hide', (settings.gun | 0) !== 4); sb.classList.toggle('on', sniping); } const sf = $('scopeFx'); if (sf) sf.classList.toggle('on', sniping);
    const ai = $('aim'); if (ai) ai.classList.toggle('hide', !(canControl() && me.alive && wpnMode === 'gun' && !sniping)); }
  if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  if (gunT > 0) gunT -= dt;
  // 回收車光圈＝安全區：走進去提示一次，光圈變綠、會呼吸發亮
  if (vanRing && view.phase === 'play') {
    const inB = view.mode !== 'br' && me.alive && Math.hypot(me.x - W.VAN[0], me.z - W.VAN[1]) < (W.BASE_R || 1.85);
    if (inB && !inBaseNow) toast('回到光圈：怪物打不到你，會慢慢回血', 'good');
    inBaseNow = inB;
    const t = performance.now() / 1000; vanRing.material.color.setHex(inB ? 0x5fd37a : baseCol); vanRing.scale.setScalar(inB ? 1 + Math.sin(t * 4) * 0.03 : 1);
  }
  if (view.pz != null && view.mode === 'coop' && me.alive && view.phase === 'play') {
    const dv = Math.hypot(me.x - W.VAN[0], me.z - W.VAN[1]);
    if (dv > view.pz && dv > (W.BASE_R || 1.85)) { poisonT -= dt; if (poisonT <= 0) { poisonT = 3; toast('你在毒圈裡！往基地光圈跑'); } hurtFlash = Math.max(hurtFlash, 0.2); }
    else poisonT = 0;
  }
  fpsWatch(dt); tickWeather(dt); tickPad(dt);
  if (view.zone && me.alive && Math.hypot(me.x - view.zone[0], me.z - view.zone[1]) > view.zr) { outT -= dt; if (outT <= 0) { outT = 2.5; toast('你在安全區外，正在扣血！往白圈裡跑'); Sfx.tone(300, 0.15, 'square', 0.08); } hurtFlash = Math.max(hurtFlash, 0.35); }
  if (gunMesh) { const kk = gunMesh.userData.kick || 0, tt = performance.now() / 1000, mv = (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || Math.abs(touch.jx) + Math.abs(touch.jy) > 0.1) ? 1 : 0.25;
    gunMesh.userData.kick = Math.max(0, kk - dt * 8); gunSway *= Math.max(0, 1 - dt * 6); gunMesh.position.set(-0.26 + gunSway + Math.sin(tt * 5) * 0.006 * mv, -0.27 + kk * 0.025 + Math.abs(Math.cos(tt * 5)) * 0.008 * mv, -0.5 + kk * 0.06); gunMesh.rotation.x = kk * 0.18; gunMesh.rotation.z = Math.sin(tt * 2.5) * 0.01 * mv; }
  if (gunHeld && gunT <= 0 && wpnMode === 'gun') shoot();   // 每一種槍按住都會連續射擊（速度依各槍的射擊間隔）
  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  const sk2 = shakeT * 0.22;
  if (view.mode === 'race') {   // 賽車：跟在車後面的追車視角（看得到自己的車）
    const ry = me.yaw + (me.slideAng || 0) * 0.5, sy2 = Math.sin(ry), cy2 = Math.cos(ry);
    camera.position.set(me.x + sy2 * 5.2, 2.6, me.z + cy2 * 5.2);
    camera.lookAt(me.x - sy2 * 2, 0.9, me.z - cy2 * 2);
    if (gunMesh) gunMesh.visible = false;
  } else {
    if (gunMesh) gunMesh.visible = true;
    camera.position.set(me.x + (Math.random() - 0.5) * sk2, 1.65 + me.y + (moving && me.vy === 0 ? Math.sin(me.walkT * 2) * 0.045 : 0) + (Math.random() - 0.5) * sk2, me.z + (Math.random() - 0.5) * sk2);
    camera.rotation.set(me.pitch, me.yaw, 0);
  }
  $('stamBar').style.width = (me.stam * 100).toFixed(0) + '%';
  $('stam').className = me.tired ? 'tired' : '';
  // 背包滿的提示
  fullHintT -= dt;
  if (me.bagN >= myCap() && fullHintT <= 0) {
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
      if (p.avatar.userData.mixer) { soldierAnim(p.avatar, sp > 0.6 ? 'Run' : sp > 0.05 ? 'Walk' : 'Idle'); p.avatar.userData.mixer.update(dt); followHand(p.avatar); }
      if (L) { L[0].rotation.x = sw * 0.9; L[1].rotation.x = -0.45 - sw * 0.25 - (p.swingT > 0 ? Math.sin((1 - p.swingT / 0.28) * Math.PI) * 1.1 : 0); L[2].rotation.x = -sw * 0.7; L[3].rotation.x = sw * 0.7; }
      p.airY = (p.airY || 0) + (((p.flags & 8) ? 0.75 : 0) - (p.airY || 0)) * Math.min(1, dt * 10);
      p.avatar.position.y = Math.abs(Math.sin(p.walk)) * 0.04 * sp + p.airY;
      p.avatar.scale.y = 1 + Math.sin(now * 2.1 + (p.walk || 0)) * 0.012 * (1 - sp);   // 站著時微微呼吸
      const pt = p.avatar.userData.pet; if (pt) { pt.position.y = (pt.userData.fly ? Math.sin(now * 3) * 0.08 : Math.abs(Math.sin(p.walk * 1.3)) * 0.07 * sp) - p.airY; }
    }
  });
  for (let i = 0; i < view.monsters.length; i++) {
    const m = view.monsters[i];
    if (!m.group.visible) { m.bar.visible = false; continue; }
    drawMonBar(m);
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
    if (it.fx) { it.fx.position.set(it.x, 0, it.z); it.fx.children[0].rotation.z += dt * 0.8; const pu = 0.75 + Math.sin(now * 3 + i) * 0.2; it.fx.children[0].material.opacity = pu * 0.8; }
  }
}

function atmosphere(L, dt) {
  const hidNow = me.alive && !me.running && (W.lockers || []).some(function (q) { return Math.hypot(q[0] - me.x, q[1] - me.z) < 1.4; });
  $('hideTag').classList.toggle('hide', !hidNow);
  // 「櫃」鍵只在櫃子旁邊（或已經躲在裡面）才出現；躲著時改成「出」
  const lkNear = me.alive && (me.inLk || (W.lockers || []).some(function (q) { return Math.hypot(q[0] - me.x, q[1] - me.z) < 1.8; }));
  document.body.classList.toggle('lk-near', !!lkNear);
  setIcon('locker', me.inLk ? 'exit' : 'locker');
  $('lkView').classList.toggle('hide', !me.inLk);
  if (!me.inLk) lkIdx = -1;
  lockerMeshes.forEach(function (g, i) { g.visible = i !== lkIdx; });   // 躲在裡面時隱藏自己那個櫃子，才不會看到櫃子內壁
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
  const bm = $('bombs'), bt = '∞'; if (bm.textContent !== bt) bm.textContent = bt;
  const am = $('ammo'), at = '∞'; if (am.textContent !== at) am.textContent = at;
  const gb = $('gun'); setIcon('gun', wpnMode === 'melee' ? 'knife' : me.reloading ? 'reload' : 'gun'); gb.classList.toggle('cd', !!me.reloading || !(me.ammo > 0));
  // 近戰模式下「槍」鍵已經是近戰攻擊，攻擊鍵隱藏避免兩顆一樣
  $('atk').classList.toggle('hide', wpnMode === 'melee');
  const qf = $('qfill'), pct = view.mode === 'td' && view.td ? view.td[0] : view.quota ? Math.min(100, view.money / view.quota * 100) : 0;
  qf.style.width = pct + '%'; qf.classList.toggle('done', pct >= 100);
  const cap = myCap(), pp = $('pips'); while (pp.children.length < 16) pp.appendChild(document.createElement('i')); if ($('bagCap').textContent !== String(cap)) $('bagCap').textContent = cap;
  for (let i = 0; i < 16; i++) { pp.children[i].className = i < me.bagN ? 'on' : ''; pp.children[i].style.display = i < cap ? '' : 'none'; } pp.className = (me.bagN >= cap ? 'full' : '') + (cap > 6 ? ' many' : '');
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

let last = 0, pvs = [];
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
    // 一次只拿一把：近戰模式（或用槍時按「打」揮一下）只顯示近戰武器，用槍時只顯示槍
    const meleeUp = wpnMode === 'melee' || !gunMesh || swingT > 0;
    pipe.visible = active && me.alive && meleeUp;
    if (gunMesh) gunMesh.visible = active && me.alive && !meleeUp;
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
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
  pvs.forEach(function (pv) { if (pv.model && pv.model.userData.mixer && pv.canvas.offsetParent) { pv.model.userData.mixer.update(dt); followHand(pv.model); } });
  pvs.forEach(function (pv) { if (pv.model && pv.canvas.offsetParent) { pv.model.rotation.y = (pv.gun ? Math.PI / 2 + Math.sin(now * 0.7) * 0.6 : pv.sway ? -0.35 + Math.sin(now * 0.6) * 0.3 : now * 0.9) + (pv.spin || 0); pv.model.rotation.x = pv.gun ? 0.15 : 0; pv.r.render(pv.sc, pv.cam); } });
  tickFx(dt);
  tickRaceCars(dt);
  if (view.mode === 'race') raceTickBoxes(dt);
  renderer.render(scene, camera);
}

/* ---------- 對外介面 ---------- */
RR.Game = {
  /** 正在遊戲中、可以控制角色（手把選單用來判斷要不要接管） */
  controlling: function () { return canControl(); },
  buildMonster: buildMonster,   // AR 抓怪借用怪物模型
  KEY_ACTIONS: KEY_ACTIONS,
  /** 目前每個動作綁的按鍵（預設按鍵 → 實際按鍵） */
  keyOf: function (def) { return keyBack[def] || def; },
  /** 等玩家按下一個鍵，綁到這個動作；cb(新按鍵) */
  captureKey: function (def, cb) {
    keyCapture = function (code) {
      if (code === 'Escape') { cb(null); return; }
      let saved = {}; try { saved = JSON.parse(localStorage.getItem('rr_keys') || '{}') || {}; } catch (e) {}
      // 新按鍵已經被別的動作用了：兩個動作互換
      const prev = keyBack[def] || def;
      KEY_ACTIONS.forEach(function (a) { if (a[1] !== def && (saved[a[1]] || a[1]) === code) saved[a[1]] = prev; });
      saved[def] = code;
      try { localStorage.setItem('rr_keys', JSON.stringify(saved)); } catch (e) {}
      keyLoad(); cb(code);
    };
  },
  resetKeys: function () { try { localStorage.removeItem('rr_keys'); } catch (e) {} keyLoad(); },
  dbg: function () { return { pvs: pvs, scene: scene, renderer: renderer, camera: camera, cloud: showCloud, me: me, solids: solids, groundAt: groundAt }; },
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    torch.shadow.mapSize.set(LITE ? 512 : 2048, LITE ? 512 : 2048);   // 高畫質：手電筒影子更清楚 torch.shadow.camera.near = 0.3; torch.shadow.camera.far = 30; torch.shadow.bias = -0.0008;
    sun.shadow.mapSize.set(LITE ? 1024 : 2048, LITE ? 1024 : 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    { const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120; }
    sunTgt = new THREE.Object3D(); scene.add(sunTgt); sun.target = sunTgt;
    dust = buildDust(); scene.add(dust);
    loadSoldier();
    buildGunView(settings.gun | 0);
    cartView = new THREE.Group(); cartView.add(part(new THREE.BoxGeometry(0.9, 0.3, 0.6), pmat(0xd9902f, 0.25), 0, -0.78, -1.05), part(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), pmat(0x9aa3a8, 0.15), 0, -0.5, -0.62)); cartView.children[1].rotation.z = Math.PI / 2; cartView.visible = false; camera.add(cartView);
    torch.position.set(0.25, -0.2, 0); camera.add(torch); camera.add(torch.target); torch.target.position.set(0, -0.05, -1);
    buildLevel();
    for (let i = 0; i < 6; i++) view.monsters.push(buildMonster(['fire', 'ice', 'poison', 'shadow'][i % 4], i + (view.day | 0) * 2));
    setViewWeapon(0);
    skinGeos = [new THREE.SphereGeometry(0.28, 18, 14), new THREE.OctahedronGeometry(0.34, 0)];
    itemGeos = REAL_VARIANTS.map(function (n, k) { const out = []; for (let v = 0; v < n; v++) out.push(realGeo(k, v)); return out; });
    window.addEventListener('resize', resize); resize(); applyShadows();
    bindInput();
    ready = true;
    requestAnimationFrame(frame);
    return true;
  },
  settings: settings,
  setGun: function (i) { i = i | 0; if (settings.gun === i && gunMesh) return; settings.gun = i; if (camera) buildGunView(i); },
  setGunSkin: function (k) { k = k | 0; if (settings.gunSkin === k) return; settings.gunSkin = k; if (camera) buildGunView(settings.gun | 0); },
  /** 選單／大廳換地圖時，背景跟著換 */
  showMap: function (i) { if (!ready || active) return; W.setMap(i); if (builtMap !== W.mapIndex) buildLevel(); },
  /** 選單裡的造型預覽 */
  // 角色預覽：每張畫布各有一個（出戰角色、大廳），大小照畫布的 width／height；sway＝大廳用的輕微左右擺動
  // 拖曳轉動預覽角色（滑鼠或手指左右拖）
  previewSpin: function (canvas, dx) { const pv = pvs.filter(function (q) { return q.canvas === canvas; })[0]; if (pv) pv.spin = (pv.spin || 0) + dx * 0.012; },
  preview: function (canvas, c, w, h, o, pet, sway, buddy) {
    if (!ready) return;
    loadSoldier();
    let pv = pvs.filter(function (q) { return q.canvas === canvas; })[0];
    if (!pv) {
      try {
        const W0 = canvas.width || 150, H0 = canvas.height || 170;
        const r = new THREE.WebGLRenderer({ canvas: canvas, antialias: !LITE, alpha: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setSize(W0, H0, false);
        const sc = new THREE.Scene();
        sc.add(new THREE.AmbientLight(0xffffff, 0.7));
        const d = new THREE.DirectionalLight(0xfff2dc, 0.95); d.position.set(2, 4, 3); sc.add(d);
        const d2 = new THREE.DirectionalLight(0x9fc4ff, 0.35); d2.position.set(-3, 2, -2); sc.add(d2);
        const cam = new THREE.PerspectiveCamera(35, W0 / H0, 0.1, 20); cam.position.set(0, 1.3, 4.7); cam.lookAt(0, 1.08, 0);
        pv = { r: r, sc: sc, cam: cam, canvas: canvas, model: null, sway: !!sway }; pvs.push(pv);
      } catch (e) { return; }
    }
    if (pv.model) pv.sc.remove(pv.model);
    pv.gun = false; pv.args = [c, w, h, o, pet, sway, buddy]; pv.cam.position.set(0, 1.3, 4.7); pv.cam.lookAt(0, 1.08, 0);
    const g = buildChar(c, 0, h || 0, o || 0, pet || 0), wg = buildWeapon(w);
    const hd = g.userData.hand || [0.37, 0.67, 0.3]; wg.position.set(hd[0], hd[1], hd[2]); wg.rotation.x = 0.5; wg.rotation.z = -0.4; g.add(wg);
    // 大廳展示：AR 抓到的怪物站在角色旁邊（buddy＝[屬性, 外觀]）
    if (buddy) { const m = buildMonster(['fire', 'ice', 'poison', 'shadow'][buddy[0] | 0], buddy[1] | 0); m.group.visible = true; m.group.scale.multiplyScalar(0.33); m.group.position.set(-0.85, 0, -0.2); m.group.rotation.y = 0.5; if (m.bar) m.bar.visible = false; g.add(m.group); }
    g.userData.weapon = wg; pv.model = g; pv.sc.add(g);
  },
  // 槍的 3D 預覽（抽獎機看槍枝造型用）：同一張畫布可以在角色和槍之間切換
  gunPreview: function (canvas, gi, skin) {
    if (!ready) return;
    RR.Game.preview(canvas, 0, 0, 0, 0, 0, true);
    const pv = pvs.filter(function (q) { return q.canvas === canvas; })[0]; if (!pv) return;
    pv.sc.remove(pv.model);
    const gp = gunParts(gi | 0), sk = GUN_SKIN[skin | 0];
    if (sk) gp[0].forEach(function (e) { for (const k in GM) if (e[2] === GM[k] && sk[k] != null) { e[2] = sk[k]; break; } });
    const m = new THREE.Mesh(mergeGeos(gp[0]), litMat({ vertexColors: true, shininess: sk && sk.shine ? 120 : 70, specular: sk && sk.shine ? 0xbbbbbb : 0x666666, emissive: sk && sk.glow ? sk.glow : 0x000000 }));
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    m.position.sub(ctr); const g = new THREE.Group(); g.add(m); g.scale.setScalar(2.6 / Math.max(size.z, 0.3)); g.position.set(0, 1.1, 0);
    pv.model = g; pv.gun = true; pv.sc.add(g);
  },
  setMe: function (id) { myId = id; },
  state: function () { const others = {}; view.players.forEach(function (p) { if (p.id !== myId) others[p.id] = [p.x, p.z, p.alive, !!(p.avatar && p.avatar.visible)]; }); return { phase: view.phase, alive: me.alive, x: me.x, z: me.z, others: others, spec: specId, players: view.players.size, items: view.items.length, monsters: view.monsters.filter(function (m) { return m.group.visible; }).length }; },
  setActive: function (b) {
    active = !!b;
    document.body.classList.toggle('playing', active); if (!active) document.body.classList.remove('allowPortrait');
    if (!active) { clearTraps(); view.traps = []; }   // 每局重新提醒轉橫式
    $('hud').classList.toggle('hide', !active);
    if (!active) {
      view.mode = 'coop';   // 離開對局：賽車 HUD（氮氣、復位、車況、道具）跟著收起來
      ['raceNitro', 'raceReset', 'raceStat', 'raceUse', 'raceHud'].forEach(function (id) { const el = document.getElementById(id); if (el) el.classList.add('hide'); });
      if (miniInPlay) closeMini();
      releaseTouch(); Sfx.drone(false);
      try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
      $('vig').style.opacity = 0; $('flash').style.opacity = 0; $('spec').classList.add('hide');
      view.monsters.forEach(function (m) { m.group.visible = false; });
      view.items.forEach(function (it) { itemVis(it, false); });
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
        p = { id: r.id, name: r.name, slot: r.slot, c: r.c || 0, w: r.w || 0, h: r.h || 0, o: r.o || 0, pet: r.pet || 0, bt: r.bt | 0, eq: r.eq || [], gems: r.gems || [0, 0, 0], swingT: 0, x: W.VAN[0], z: W.VAN[1], yaw: 0, tx: W.VAN[0], tz: W.VAN[1], tyaw: 0, alive: true, bagN: 0, flags: 0, avatar: null, row: null, fresh: true };
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
    view.base = info.base | 0;
    if (builtMap !== W.mapIndex || builtBase !== view.base || Object.keys(brokenVis).length) buildLevel();   // 前一天炸開的牆恢復原狀
    view.items.forEach(function (it) { scene.remove(it.mesh); if (it.fx) scene.remove(it.fx); });
    view.items = info.items.map(makeItem);
    view.traps = info.traps || []; buildTraps();
    view.mode = info.mode || 'coop'; document.body.classList.toggle('td', view.mode === 'td'); syncTowers([]); view.td = null;
    buildRaceTrack(view.mode === 'race' ? (info.map || 0) : -1);
    if (view.mode === 'race') { me.spd = 0; me.boostT = 0; me.charge = 0; me.slideAng = 0; me.drifting = false; me.item = null; me.ckX = null; me.hp = 100; me.nitro = 0; me.nitroT = 0; me.pauseT = 0; me.hitCd = 0; }
    document.body.classList.toggle('hunt', view.mode === 'hunt'); document.body.classList.toggle('br', view.mode === 'br');
    applyWeather(info.weather || 0); quakeT = 0; me.riding = false; rings.forEach(function (r) { scene.remove(r.mesh); }); rings.length = 0;
    setTimeout(function () { if (canControl() && view.mode !== 'br') skillHint('你的技能'); }, info.weather ? 7000 : 3500);
    if (info.weather) setTimeout(function () { toast('今天的天氣：' + W.WEATHERS[info.weather] + ['', '（雨聲蓋過腳步，怪物比較聽不到你）', '（你和怪物都看不遠）', '（很暗，靠手電筒；怪物也看不遠）', '（能見度低，小地圖看不到怪物）'][info.weather]); }, 2600);
    view.zone = info.zone || null; view.zr = info.zone ? info.zone[2] : 0; outT = 0;
    if (zoneMesh) { scene.remove(zoneMesh); zoneMesh = null; }
    setPoison(null);
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
    toast(view.mode === 'td' ? '死守第 ' + info.day + ' 關：守住回收車！開槍打怪，按「塔」花 $100 蓋砲塔' : view.mode === 'br' ? '廢墟生存戰：活到最後！白圈外會扣血，補給箱：綠 急救、藍 護甲、紅 火力' : view.mode === 'hunt' ? '清剿第 ' + info.day + ' 關：用槍擊倒 ' + (info.quota / 50) + ' 隻怪物（每隻 $50）' : '第 ' + info.day + ' 天：把廢料帶回金色回收車，賺到 $' + info.quota);
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
    if (s.race && s.race[3]) syncRaceAi(s.race[3]); else clearRaceAi();
    if (s.race) {   // 賽車 HUD：圈數與時間
      const mineR = s.race[2].filter(function (x) { return x[0] === myId; })[0] || [myId, 0, 0];
      const hud = document.getElementById('raceHud');
      if (hud) { hud.classList.remove('hide'); const tt = mineR[2] || s.race[0]; hud.textContent = '第 ' + Math.min(mineR[1] + 1, s.race[1]) + ' / ' + s.race[1] + ' 圈　' + tt.toFixed(1) + ' 秒'; }
    } else { const hud0 = document.getElementById('raceHud'); if (hud0) hud0.classList.add('hide'); }
    if (view.mode === 'td') syncTowers(s.tw);
    if (s.veh) {
      if (!cartMesh) { cartMesh = buildCart(); scene.add(cartMesh); }
      const rid = s.veh[2]; me.riding = rid === myId && me.alive;
      const ps = s.veh[3] || []; me.passIdx = me.alive ? ps.indexOf(myId) : -1; me.passenger = me.passIdx >= 0;
      let cx = s.veh[0], cz = s.veh[1], cyaw = cartMesh.rotation.y;
      if (rid && rid !== myId) { const rp = view.players.get(rid); if (rp) { cx = rp.x; cz = rp.z; cyaw = rp.yaw; } }
      // 沒人開的推車若落在箱子、櫃子裡，就移到附近的空地（最多 1.5 格，玩家仍在上車距離內）
      if (!rid && hitSolid(cx, cz, 0)) {
        let fixed = null;
        for (let r = 0.5; r <= 1.5 && !fixed; r += 0.5) for (let a = 0; a < 16 && !fixed; a++) {
          const x = cx + Math.cos(a * Math.PI / 8) * r, z = cz + Math.sin(a * Math.PI / 8) * r;
          if (!hitSolid(x, z, 0) && !W.blocked(x, z, 0.4)) fixed = [x, z];
        }
        if (fixed) { cx = fixed[0]; cz = fixed[1]; }
      }
      cartMesh.visible = rid !== myId; cartMesh.position.set(cx, 0, cz); cartMesh.rotation.y = cyaw;
      view.veh = [cx, cz, s.veh[2], s.veh[3]];
    } else { if (cartMesh) cartMesh.visible = false; view.veh = null; me.riding = false; me.passenger = false; }
    if (cartView) cartView.visible = !!me.riding;
    const seatFree = !view.veh || !view.veh[2] || (view.veh[3] || []).length < 2;   // 沒人開車可以開；有人開車可以坐後座（最多 2 人）
    const nearV = view.veh && me.alive && (me.riding || me.passenger || (seatFree && Math.hypot(view.veh[0] - me.x, view.veh[1] - me.z) < 2.4));
    document.body.classList.toggle('nearveh', !!nearV); setIcon('veh', me.riding || me.passenger ? 'exit' : 'veh');
    if (s.pad && !padMesh) padMesh = makePadFx();
    view.pad = s.pad || null;
    view.pz = s.pz != null ? s.pz : null; setPoison(view.pz);
    if (s.pad && padMesh) padMesh.position.set(s.pad[0], 0, s.pad[1]);
    if (!s.pad && padMesh) { scene.remove(padMesh); padMesh = null; }
    view.phase = s.ph; view.day = s.day; view.money = s.money; view.quota = s.quota; view.time = s.time;
    for (let i = 0; i < s.p.length; i++) {
      const a = s.p[i], p = view.players.get(a[0]);
      if (!p) continue;
      p.alive = !!a[4]; p.bagN = a[5]; p.flags = a[6];
      if (a[0] === myId) {
        const inLk = !!(a[6] & 16);
        if (inLk !== !!me.inLk) { if (!inLk) lkExitSpot(); }
        me.inLk = inLk; if (!inLk) lkPos = null;
        me.bagN = a[5]; if (s.ph === 'play' && !a[4]) me.alive = false;
        if (s.zr != null) { view.zr = s.zr; if (zoneMesh) zoneMesh.scale.set(s.zr, 1, s.zr); }
        if (a[8] != null) { me.ammo = a[8]; me.reloading = !!a[9]; }
        if (a[7] != null && a[7] !== me.hp) { me.hp = a[7]; $('hpBar').style.width = hpPct(); }
        continue;
      }
      p.tx = a[1]; p.tz = a[2]; p.tyaw = a[3];
      if (p.fresh) { p.x = p.tx; p.z = p.tz; p.yaw = p.tyaw; p.fresh = false; }
    }
    for (let i = 0; i < view.monsters.length; i++) {
      const m = view.monsters[i], a = s.m[i];
      if (!a || s.ph === 'lobby') { m.group.visible = false; continue; }
      m.tx = a[0]; m.tz = a[1]; m.trot = a[2]; m.chase = !!a[3]; m.hpV = a[4]; m.shV = a[5] || 0; m.maxV = a[6] || 100; m.shMaxV = a[7] || 40;
      if (m.fresh) { m.x = m.tx; m.z = m.tz; m.rot = m.trot; m.fresh = false; }
      m.group.visible = a[4] !== 0;   // 清剿行動：被擊倒的怪物先消失，重生後再出現
      if (!m.group.visible) m.fresh = true;
    }
    if (s.it && s.it.length === view.items.length) {
      for (let i = 0; i < view.items.length; i++) {
        const it = view.items[i]; it.taken = s.it[i] === '1'; itemVis(it, !it.taken);
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
      if (it) { it.taken = true; itemVis(it, false); }
      if (e.id === myId && it) { Sfx.tone(660, 0.09, 'triangle', 0.12, 990); toast('撿到' + (W.KINDS[it.kind].rar ? W.RARITY[W.KINDS[it.kind].rar] + '的' : ' ') + W.KINDS[it.kind].n + '（$' + it.value + '）'); }
    } else if (e.t === 'sell') {
      Sfx.tone(523, 0.12, 'triangle', 0.14); setTimeout(function () { Sfx.tone(784, 0.2, 'triangle', 0.14); }, 110);
      toast((e.id === myId ? '賣出' : nameOf(e.id) + ' 賣出') + ' +$' + e.sum); floatText('+$' + e.sum);
    } else if (e.t === 'swap') {
      const old = view.items[e.i];
      if (old) { scene.remove(old.mesh); if (old.fx) scene.remove(old.fx); view.items[e.i] = makeItem([e.x, e.z, e.kind, e.value]); }
    } else if (e.t === 'drop') {
      e.list.forEach(function (a) { const it = view.items[a[0]]; if (it) { it.x = a[1]; it.z = a[2]; it.taken = false; itemVis(it, true); } });
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
    } else if (e.t === 'lkw') { if (e.id === myId) toast('櫃子裡有「' + e.w + '」，已經拿到了！'); } else if (e.t === 'warp') {
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
    } else if (e.t === 'gunsw') {
      if (e.id === myId) { RR.Game.setGun(e.gun); toast('換成' + ((W.GUNS[e.gun] || {}).name || '槍')); }
    } else if (e.t === 'reload') {
      if (e.id === myId) { Sfx.tone(180, 0.08, 'square', 0.05, 120); }
    } else if (e.t === 'veh') {
      if (e.id === myId) toast(e.pass ? (e.on ? '坐上推車後座：隊友開車，你可以開槍掩護' : '下車了') : e.on ? '推上推車：速度快、多放 2 件，但很吵，不能跳、衝、開槍；隊友可以坐後座' : '下車了');
      else if (e.on && e.pass && view.veh && view.veh[2] === myId) toast(nameOf(e.id) + ' 坐上你的推車');
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
    } else if (e.t === 'heal') {
      healWall(e.c, e.r);
    } else if (e.t === 'break') {
      showBreak(e.c, e.r); if (e.id === myId) { toast('炸開了！'); }
    } else if (e.t === 'nobomb') {
      if (e.id === myId) toast('炸藥沒有炸開東西');
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
      if (e.kill && e.id === myId) addKill();
      if (e.kill) { Sfx.tone(180, 0.35, 'sawtooth', 0.14, 60); floatText('+$50'); toast((e.id === myId ? '你' : nameOf(e.id)) + '擊倒了怪物！'); }
      else if (e.mi >= 0 && e.id === myId && view.mode !== 'hunt') toast('命中！怪物暈 2.5 秒');
    } else if (e.t === 'air') {
      Sfx.noise(0.5, 0.5); shakeT = Math.max(shakeT, 0.6);
      if (e.id === myId) { for (let k = 0; k < (e.kills | 0); k++) addKill(); toast(e.kills ? '空中掃射擊倒 ' + e.kills + ' 隻！' : '空中掃射沒有命中'); }
      else toast(nameOf(e.id) + ' 呼叫了空中掃射');
    } else if (e.t === 'boom') {
      Sfx.noise(0.35, 0.35); shakeT = Math.max(shakeT, 0.3);
      if (e.id === myId) toast('轟！附近的怪物暈了'); else if (me.alive && Math.hypot(e.x - me.x, e.z - me.z) < 10) toast(nameOf(e.id) + ' 丟了炸藥');
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
      if (e.id === myId) { hurtFlash = 1; shakeT = 0.3; Sfx.tone(160, 0.25, 'square', 0.2, 70); if (e.hp > 0) toast(e.by ? '被 ' + nameOf(e.by) + ' 打了！' : '被怪物打傷了，再被碰到就倒了！'); }
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
      vh: vh || undefined, run: me.running && me.alive, air: me.y - (me.gnd || 0) > 0.25 && me.alive, loud: loudT > 0 && me.alive, spk: spk, rs: !!(keys.KeyE || keys.PadRescue) && me.alive, lk: takeLk(), sm: sm, sk: sk, tt: tt === null ? undefined : tt };
  },
  setMonSkin: function (v) {
    RR.Game.settings.monSkin = v | 0;
    if (!ready) return;
    view.monsters.forEach(function (m) { scene.remove(m.group); });
    view.monsters = []; for (let i = 0; i < 6; i++) view.monsters.push(buildMonster(['fire', 'ice', 'poison', 'shadow'][i % 4], i + (view.day | 0) * 2));
  },
  setQuality: function (q) { quality = q === 'low' || q === 'mid' ? q : 'high'; applyQuality(); },
  setBtnScale: function (v) { btnScale = Math.max(0.7, Math.min(1.5, +v || 1)); layoutButtons(); },
  setLefty: function (on) { try { localStorage.setItem('rr_lefty', on ? '1' : '0'); } catch (e) {} layoutButtons(); },
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
