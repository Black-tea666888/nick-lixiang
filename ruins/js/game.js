/* 畫面與操作：3D 場景、本機玩家移動、其他玩家／怪物的顯示、HUD、近距離語音音量 */
(function () {
'use strict';
const RR = window.RR, W = RR.World, Sfx = RR.Sfx, Voice = RR.Voice;
const CS = W.CS, WH = W.WH;
const $ = function (id) { return document.getElementById(id); };
const COLORS = [0x7dffb0, 0x6ecbff, 0xffd166, 0xff7eb6];
const CSSCOL = ['#7dffb0', '#6ecbff', '#ffd166', '#ff7eb6'];

let renderer, scene, camera, torch, canvas, ready = false;
let myId = null, active = false;
const me = { x: W.VAN[0], z: W.VAN[1], yaw: -Math.PI * 0.75, pitch: 0, stam: 1, tired: false, walkT: 0, running: false, alive: true, bagN: 0, hp: 100 };
let atkT = 0, swingT = 0, pipe = null, hurtFlash = 0;
const view = { phase: 'lobby', day: 1, money: 0, quota: 0, time: 0, players: new Map(), monsters: [], items: [] };
const keys = {};
const touch = { joyId: null, lookId: null, ox: 0, oy: 0, jx: 0, jy: 0, lx: 0, ly: 0, run: false };
const settings = { sens: 1 };
let specId = null, beatT = 0, toastT = 0, fullHintT = 0, loudT = 0, spk = false, hudT = 0, lastL = me, dragging = false;
let itemGeos = null;

function toast(msg) { const el = $('toast'); el.textContent = msg; el.style.opacity = 1; toastT = 2.4; }
function canControl() { return active && view.phase === 'play' && me.alive; }
function nameOf(id) { const p = view.players.get(id); return p ? p.name : '隊友'; }

/* ---------- 建場景 ---------- */
function makeTex(base, speck, lines) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = 'rgba(' + speck + ',' + (Math.random() * 0.18).toFixed(3) + ')';
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  if (lines) {
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
    g.beginPath(); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
    g.fillStyle = 'rgba(60,20,10,.25)';
    for (let i = 0; i < 5; i++) g.fillRect(Math.random() * 120, Math.random() * 60, 3 + Math.random() * 5, 30 + Math.random() * 60);
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

let level = null, builtMap = -1, ambient = null;

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
  g.fillStyle = 'rgba(5,8,7,.72)'; g.fillRect(0, 0, mini.width, mini.height);
  g.fillStyle = 'rgba(125,255,176,.2)';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (W.MAP[r][c] !== '#') g.fillRect(c * MC, r * MC, MC, MC);
  // 回收車
  const v = W.VAN, k = MC / CS;
  g.fillStyle = '#4dff9a'; g.fillRect(v[0] * k - MC * 0.45, v[1] * k - MC * 0.45, MC * 0.9, MC * 0.9);
  g.fillStyle = '#04140a'; g.font = 'bold ' + (MC * 0.8) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('車', v[0] * k, v[1] * k + 0.5);
}
function drawMini(L) {
  if (!miniCtx) return;
  const g = miniCtx, k = MC / CS;
  g.clearRect(0, 0, mini.width, mini.height);
  g.drawImage(miniBase, 0, 0);
  view.players.forEach(function (p) {          // 還活著的隊友
    if (p.id === myId || !p.alive) return;
    g.fillStyle = CSSCOL[p.slot % 4];
    g.beginPath(); g.arc(p.x * k, p.z * k, MC * 0.38, 0, Math.PI * 2); g.fill();
  });
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
  level = new THREE.Group(); builtMap = W.mapIndex;
  const COLS = W.COLS, ROWS = W.ROWS, MAP = W.MAP, T = W.theme, VAN = W.VAN;
  scene.fog.density = T.fog; if (ambient) ambient.color.setHex(T.amb);
  const floorTex = makeTex(T.floor, '0,0,0', false); floorTex.repeat.set(COLS, ROWS);
  const ceilTex = makeTex(T.ceil, '0,0,0', false); ceilTex.repeat.set(COLS, ROWS);
  const wallTex = makeTex(T.wall, '20,20,20', true);
  const Wd = COLS * CS, D = ROWS * CS;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Wd, D), new THREE.MeshPhongMaterial({ map: floorTex, shininess: 8 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(Wd / 2, 0, D / 2); level.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Wd, D), new THREE.MeshPhongMaterial({ map: ceilTex, shininess: 2 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(Wd / 2, WH, D / 2); level.add(ceil);
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === '#') n++;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, WH, CS), new THREE.MeshPhongMaterial({ map: wallTex, shininess: 4 }), n);
  const m4 = new THREE.Matrix4(); let i = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === '#') {
    m4.makeTranslation(c * CS + CS / 2, WH / 2, r * CS + CS / 2); walls.setMatrixAt(i++, m4);
  }
  walls.instanceMatrix.needsUpdate = true; level.add(walls);
  // 回收車
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 40), new THREE.MeshBasicMaterial({ color: 0x4dff9a, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(VAN[0], 0.03, VAN[1]); level.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, WH, 28, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.set(VAN[0], WH / 2, VAN[1]); level.add(beam);
  const vl = new THREE.PointLight(0x4dff9a, 0.9, 12, 1.6); vl.position.set(VAN[0], 2.4, VAN[1]); level.add(vl);
  scene.add(level);
  buildMini();
}

function buildMonster() {
  const g = new THREE.Group();
  const dark = new THREE.MeshPhongMaterial({ color: 0x0c0c0e, shininess: 30 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 2.2, 10), dark); body.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), dark); head.position.y = 2.5; head.scale.y = 1.25;
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeM); e1.position.set(-0.13, 2.56, 0.3);
  const e2 = e1.clone(); e2.position.x = 0.13;
  const armG = new THREE.CylinderGeometry(0.05, 0.04, 1.9, 6);
  const a1 = new THREE.Mesh(armG, dark); a1.position.set(-0.42, 1.35, 0.1); a1.rotation.z = 0.16;
  const a2 = new THREE.Mesh(armG, dark); a2.position.set(0.42, 1.35, 0.1); a2.rotation.z = -0.16;
  const glow = new THREE.PointLight(0xff2020, 0.8, 7, 1.5); glow.position.set(0, 2.5, 0.5);
  g.add(body, head, e1, e2, a1, a2, glow);
  g.visible = false; scene.add(g);
  return { group: g, x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, chase: false, fresh: true };
}

function pmat(col, em) { return new THREE.MeshPhongMaterial({ color: col, emissive: new THREE.Color(col).multiplyScalar(em == null ? 0.22 : em), shininess: 20 }); }
function part(geo, m, x, y, z) { const o = new THREE.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); return o; }

/** 角色造型（純外觀）。身體用玩家顏色，正面朝 +z。 */
function buildChar(c, slot) {
  const g = new THREE.Group();
  const M = pmat(COLORS[slot % 4]);
  const dark = new THREE.MeshBasicMaterial({ color: 0x0a0f0c }), glow = new THREE.MeshBasicMaterial({ color: 0xfff0cc });
  const body = function () { return part(new THREE.CylinderGeometry(0.27, 0.3, 1.2, 12), M, 0, 0.75, 0); };
  if (c === 1) {            // 機器人
    const grey = pmat(0x9aa3a8, 0.12), eye = new THREE.BoxGeometry(0.1, 0.08, 0.05);
    g.add(part(new THREE.BoxGeometry(0.56, 1.0, 0.4), M, 0, 0.8, 0), part(new THREE.BoxGeometry(0.46, 0.4, 0.4), grey, 0, 1.58, 0),
      part(eye, glow, -0.11, 1.6, 0.21), part(eye, glow, 0.11, 1.6, 0.21),
      part(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 6), grey, 0, 1.9, 0),
      part(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4a3d }), 0, 2.03, 0),
      part(new THREE.BoxGeometry(0.3, 0.18, 0.02), dark, 0, 0.95, 0.21));
  } else if (c === 2) {     // 太空人
    const white = pmat(0xe8eef2, 0.14);
    g.add(body(), part(new THREE.SphereGeometry(0.33, 16, 14), white, 0, 1.62, 0), part(new THREE.SphereGeometry(0.25, 14, 12), dark, 0, 1.62, 0.13),
      part(new THREE.BoxGeometry(0.4, 0.6, 0.2), white, 0, 0.95, -0.33), part(new THREE.SphereGeometry(0.05, 8, 8), glow, 0.2, 1.25, 0.26));
  } else if (c === 3) {     // 貓貓
    const ear = new THREE.ConeGeometry(0.09, 0.2, 4), eye = new THREE.SphereGeometry(0.04, 8, 8);
    const tail = part(new THREE.CylinderGeometry(0.035, 0.05, 0.7, 6), M, 0, 0.75, -0.42); tail.rotation.x = -0.7;
    g.add(body(), part(new THREE.SphereGeometry(0.27, 14, 12), M, 0, 1.6, 0), part(ear, M, -0.15, 1.9, 0), part(ear, M, 0.15, 1.9, 0),
      part(eye, glow, -0.1, 1.63, 0.24), part(eye, glow, 0.1, 1.63, 0.24), part(new THREE.SphereGeometry(0.03, 6, 6), dark, 0, 1.55, 0.27), tail);
  } else if (c === 4) {     // 南瓜頭
    const head = part(new THREE.SphereGeometry(0.36, 16, 12), pmat(0xff8a1f, 0.4), 0, 1.6, 0); head.scale.y = 0.8;
    const eye = new THREE.ConeGeometry(0.06, 0.1, 3);
    const mouth = part(new THREE.BoxGeometry(0.22, 0.04, 0.03), dark, 0, 1.5, 0.34);
    g.add(part(new THREE.CylinderGeometry(0.2, 0.26, 1.2, 12), M, 0, 0.75, 0), head, part(new THREE.CylinderGeometry(0.03, 0.045, 0.14, 6), pmat(0x4f7a3a, 0.2), 0, 1.93, 0),
      part(eye, dark, -0.12, 1.65, 0.33), part(eye, dark, 0.12, 1.65, 0.33), mouth);
  } else if (c === 5) {     // 紙箱人
    const eye = new THREE.BoxGeometry(0.09, 0.09, 0.03);
    g.add(body(), part(new THREE.BoxGeometry(0.52, 0.5, 0.5), pmat(0xb98a55, 0.18), 0, 1.62, 0), part(eye, dark, -0.12, 1.66, 0.26), part(eye, dark, 0.12, 1.66, 0.26),
      part(new THREE.BoxGeometry(0.52, 0.03, 0.08), pmat(0x8a6238, 0.15), 0, 1.88, 0));
  } else {                  // 回收員
    g.add(body(), part(new THREE.SphereGeometry(0.24, 14, 12), M, 0, 1.6, 0), part(new THREE.BoxGeometry(0.34, 0.12, 0.1), dark, 0, 1.63, 0.2),
      part(new THREE.SphereGeometry(0.05, 8, 8), glow, 0.2, 1.25, 0.26));
  }
  return g;
}

/** 攻擊物造型（純外觀，傷害相同）。握把在原點，往 +y 延伸。 */
function buildWeapon(w) {
  const g = new THREE.Group();
  const steel = new THREE.MeshPhongMaterial({ color: 0x8a8f93, shininess: 60, emissive: 0x15171a });
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
  const g = buildChar(p.c || 0, p.slot);
  const wg = buildWeapon(p.w || 0); wg.position.set(0.36, 0.85, 0.12); wg.rotation.x = 0.5; g.add(wg);
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
function attack() {
  if (!canControl() || atkT > 0) return;
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
    if (e.code === 'KeyF' || e.code === 'Space') { if (canControl()) { e.preventDefault(); attack(); } }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { for (const k in keys) keys[k] = false; });
  canvas.addEventListener('mousedown', function () {
    if (active && view.phase === 'play' && !me.alive) { nextSpec(); return; }
    if (!canControl()) return;
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
  const atkBtn = $('atk');
  atkBtn.addEventListener('touchstart', function (e) { e.preventDefault(); attack(); }, { passive: false });
  atkBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
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
  const wantRun = (keys.ShiftLeft || keys.ShiftRight || touch.run) && moving && !me.tired;
  if (wantRun) { me.stam -= 0.26 * dt; if (me.stam <= 0) { me.stam = 0; me.tired = true; } }
  else { me.stam = Math.min(1, me.stam + 0.17 * dt); if (me.tired && me.stam > 0.35) me.tired = false; }
  const speed = (wantRun ? 6.6 : 3.9) * (1 - 0.07 * me.bagN);
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  const dx = (-sy * f + cy * s) * speed * dt, dz = (-cy * f - sy * s) * speed * dt;
  const R = 0.42;
  if (!W.blocked(me.x + dx, me.z, R)) me.x += dx;
  if (!W.blocked(me.x, me.z + dz, R)) me.z += dz;
  if (moving) {
    const before = Math.floor(me.walkT / Math.PI);
    me.walkT += dt * (wantRun ? 13 : 8.5) * mag;
    if (Math.floor(me.walkT / Math.PI) !== before) Sfx.tone(wantRun ? 85 : 70, 0.06, 'sine', wantRun ? 0.09 : 0.045);
  }
  me.running = wantRun;
  camera.position.set(me.x, 1.65 + (moving ? Math.sin(me.walkT * 2) * 0.045 : 0), me.z);
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
    }
  });
  for (let i = 0; i < view.monsters.length; i++) {
    const m = view.monsters[i];
    if (!m.group.visible) continue;
    m.x += (m.tx - m.x) * k; m.z += (m.tz - m.z) * k; m.rot = lerpAngle(m.rot, m.trot, Math.min(1, dt * 8));
    m.group.position.set(m.x, Math.sin(now * (m.chase ? 14 : 5) + i) * 0.05, m.z);
    m.group.rotation.y = m.rot;
  }
  for (let i = 0; i < view.items.length; i++) {
    const it = view.items[i];
    if (it.taken) continue;
    it.mesh.rotation.y += dt * 1.6; it.mesh.rotation.x += dt * 0.5;
    it.mesh.position.set(it.x, 0.75 + Math.sin(now * 2 + i) * 0.08, it.z);
  }
}

function atmosphere(L, dt) {
  let dist = 1e9, chase = false;
  for (let i = 0; i < view.monsters.length; i++) {
    const m = view.monsters[i];
    if (!m.group.visible) continue;
    const d = Math.hypot(m.x - L.x, m.z - L.z);
    if (d < dist) { dist = d; chase = m.chase; }
  }
  let danger = Math.max(0, 1 - dist / 30);
  if (chase && danger > 0) danger = Math.min(1, danger + 0.35);
  $('vig').style.opacity = (danger * danger * 0.9).toFixed(2);
  beatT -= dt;
  if (danger > 0.12 && beatT <= 0) { Sfx.tone(58, 0.16, 'sine', 0.1 + danger * 0.3, 38); beatT = 1.15 - danger * 0.8; }
  torch.intensity = dist < 9 ? 1.7 * (Math.random() < 0.25 ? 0.25 : 1) : 1.7;
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
        const dx = p.x - L.x, dz = p.z - L.z, d = Math.hypot(dx, dz);
        g = d <= 5 ? 1 : d >= 28 ? 0 : Math.pow(1 - (d - 5) / 23, 2);
        if (g > 0 && !W.los(L.x, L.z, p.x, p.z)) g *= 0.5;   // 隔牆變小聲
        if (d > 0.5) pan = Math.max(-1, Math.min(1, (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d)) * 0.8;
      }
    }
    Voice.spatial(p.id, g, pan);
  });
}

function updateHud() {
  $('money').textContent = '$' + view.money;
  $('quota').textContent = '$' + view.quota;
  $('bag').textContent = me.bagN;
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
  b.textContent = !Voice.hasMic() ? '無麥克風' : Voice.isMuted() ? '麥克風 關' : loudT > 0 ? '太大聲！' : '麥克風 開';
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
    if (me.alive) { updateMe(dt); L = me; $('spec').classList.add('hide'); }
    else L = spectate();
    lastL = L;
    interpolate(dt, now);
    atmosphere(L, dt);
    miniT -= dt; if (miniT <= 0) { miniT = 0.08; drawMini(L); }
  } else if (active) {
    interpolate(dt, now);
  } else {
    camera.position.set(W.VAN[0], 1.65, W.VAN[1]);
    camera.rotation.set(0, -Math.PI * 0.75 + Math.sin(now * 0.3) * 0.5, 0);
    torch.intensity = 1.7;
  }
  voiceSpatial(playing, lastL);
  hudT -= dt; if (hudT <= 0) { hudT = 0.15; tickHud(); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  if (pv && pv.model && pv.canvas.offsetParent) { pv.model.rotation.y = now * 0.9; pv.r.render(pv.sc, pv.cam); }
  renderer.render(scene, camera);
}

/* ---------- 對外介面 ---------- */
RR.Game = {
  init: function () {
    if (ready) return true;
    if (!window.THREE) return false;
    canvas = $('c');
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true }); } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.075);
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 80); camera.rotation.order = 'YXZ'; scene.add(camera);
    ambient = new THREE.AmbientLight(0x4a5568, 0.28); scene.add(ambient);
    torch = new THREE.SpotLight(0xfff0cc, 1.7, 30, 0.55, 0.55, 1.4);
    torch.position.set(0.25, -0.2, 0); camera.add(torch); camera.add(torch.target); torch.target.position.set(0, -0.05, -1);
    buildLevel();
    for (let i = 0; i < 3; i++) view.monsters.push(buildMonster());
    setViewWeapon(0);
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
  preview: function (canvas, c, w) {
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
    const g = buildChar(c, 0), wg = buildWeapon(w);
    wg.position.set(0.36, 0.85, 0.12); wg.rotation.x = 0.5; g.add(wg);
    pv.model = g; pv.sc.add(g);
  },
  setMe: function (id) { myId = id; },
  state: function () { const others = {}; view.players.forEach(function (p) { if (p.id !== myId) others[p.id] = [p.x, p.z, p.alive, !!(p.avatar && p.avatar.visible)]; }); return { phase: view.phase, alive: me.alive, x: me.x, z: me.z, others: others, spec: specId, players: view.players.size, items: view.items.length, monsters: view.monsters.filter(function (m) { return m.group.visible; }).length }; },
  setActive: function (b) {
    active = !!b;
    document.body.classList.toggle('playing', active);
    $('hud').classList.toggle('hide', !active);
    if (!active) {
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
      if (p && (p.name !== r.name || p.slot !== r.slot || p.c !== r.c || p.w !== r.w)) { if (p.avatar) scene.remove(p.avatar); view.players.delete(r.id); p = null; }
      if (!p) {
        p = { id: r.id, name: r.name, slot: r.slot, c: r.c || 0, w: r.w || 0, swingT: 0, x: W.VAN[0], z: W.VAN[1], yaw: 0, tx: W.VAN[0], tz: W.VAN[1], tyaw: 0, alive: true, bagN: 0, flags: 0, avatar: null, row: null, fresh: true };
        if (r.id !== myId) { p.avatar = buildAvatar(p); p.avatar.visible = false; }
        else setViewWeapon(p.w);
        view.players.set(r.id, p);
      }
    });
    Array.from(view.players.keys()).forEach(function (id) {
      if (!seen[id]) { const p = view.players.get(id); if (p.avatar) scene.remove(p.avatar); view.players.delete(id); }
    });
    buildPlist();
  },
  onDay: function (info) {
    W.setMap(info.map || 0);
    if (builtMap !== W.mapIndex) buildLevel();
    view.items.forEach(function (it) { scene.remove(it.mesh); });
    view.items = info.items.map(function (a) {
      const mesh = new THREE.Mesh(itemGeos[a[2] % itemGeos.length], new THREE.MeshBasicMaterial({ color: [0xffd166, 0x6ecbff, 0xff9f5a, 0xc9a0ff, 0xff7eb6, 0x9be564, 0xffe94a, 0xfff3b0, 0x5affc9, 0xffb86b, 0xbfc7d1][a[2] % 11] }));
      mesh.position.set(a[0], 0.75, a[1]); scene.add(mesh);
      return { x: a[0], z: a[1], kind: a[2], value: a[3], taken: false, mesh: mesh };
    });
    view.phase = 'play'; view.day = info.day; view.quota = info.quota; view.time = info.time; view.money = 0;
    view.players.forEach(function (p) {
      const s = info.spawns[p.id] || W.VAN;
      p.alive = true; p.bagN = 0; p.flags = 0; p.x = p.tx = s[0]; p.z = p.tz = s[1]; p.yaw = p.tyaw = -Math.PI * 0.75;
    });
    view.monsters.forEach(function (m) { m.group.visible = false; m.fresh = true; m.chase = false; });
    const sp = info.spawns[myId] || W.VAN;
    me.x = sp[0]; me.z = sp[1]; me.yaw = -Math.PI * 0.75; me.pitch = 0; me.stam = 1; me.tired = false; me.alive = true; me.bagN = 0; me.running = false; me.hp = 100; atkT = 0; swingT = 0; hurtFlash = 0;
    $('hpBar').style.width = '100%';
    specId = null; beatT = 0; lastL = me;
    $('flash').style.opacity = 0; $('warn').style.opacity = 0; $('spec').classList.add('hide');
    Sfx.drone(true);
    updateHud();
    toast('第 ' + info.day + ' 天：把廢料帶回綠色回收車，賺到 $' + info.quota);
    lockPointer();
  },
  onSnapshot: function (s) {
    const prevSec = Math.ceil(view.time), prevMoney = view.money, prevBag = me.bagN;
    view.phase = s.ph; view.day = s.day; view.money = s.money; view.quota = s.quota; view.time = s.time;
    for (let i = 0; i < s.p.length; i++) {
      const a = s.p[i], p = view.players.get(a[0]);
      if (!p) continue;
      p.alive = !!a[4]; p.bagN = a[5]; p.flags = a[6];
      if (a[0] === myId) {
        me.bagN = a[5]; if (s.ph === 'play' && !a[4]) me.alive = false;
        if (a[7] != null && a[7] !== me.hp) { me.hp = a[7]; $('hpBar').style.width = Math.max(0, me.hp) + '%'; }
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
      m.group.visible = true;
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
      toast((e.id === myId ? '賣出' : nameOf(e.id) + ' 賣出') + ' +$' + e.sum);
    } else if (e.t === 'drop') {
      e.list.forEach(function (a) { const it = view.items[a[0]]; if (it) { it.x = a[1]; it.z = a[2]; it.taken = false; it.mesh.visible = true; } });
    } else if (e.t === 'caught') {
      const p = view.players.get(e.id); if (p) p.alive = false;
      if (e.id === myId) {
        me.alive = false; me.running = false; releaseTouch();
        Sfx.noise(0.8, 0.5); Sfx.tone(220, 0.8, 'sawtooth', 0.25, 55);
        $('flash').style.opacity = 0.85; setTimeout(function () { $('flash').style.opacity = 0; }, 900);
        toast('你被抓到了');
      } else { Sfx.tone(90, 0.5, 'sawtooth', 0.12, 45); toast(nameOf(e.id) + ' 被抓走了，身上的廢料掉在原地'); }
    } else if (e.t === 'swing') {
      if (e.id !== myId) { const p = view.players.get(e.id); if (p) { p.swingT = 0.28; if (Math.hypot(p.x - lastL.x, p.z - lastL.z) < 14) Sfx.noise(0.1, 0.05); } }
    } else if (e.t === 'hit') {
      if (e.id === myId) { hurtFlash = 1; Sfx.tone(160, 0.25, 'square', 0.2, 70); if (e.hp > 0) toast('被 ' + nameOf(e.by) + ' 打了！'); }
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
      view.phase = e.win ? 'won' : 'lost'; Sfx.drone(false); releaseTouch();
      try { if (document.exitPointerLock) document.exitPointerLock(); } catch (err) {}
      $('vig').style.opacity = 0;
    }
  },
  input: function () {
    return { t: 'i', x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, yaw: Math.round(me.yaw * 100) / 100,
      run: me.running && me.alive, loud: loudT > 0 && me.alive, spk: spk };
  },
  toggleMic: function () {
    if (!Voice.hasMic()) { RR.UI.say('沒有麥克風權限。請在瀏覽器允許麥克風後，重新進入房間。'); return; }
    Voice.setMuted(!Voice.isMuted()); tickHud();
  },
  toast: toast
};
})();
