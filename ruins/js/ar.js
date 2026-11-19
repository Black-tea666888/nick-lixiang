/* AR 抓怪：用手機相機當背景，轉動手機找怪物，對準後丟回收網把牠抓起來（類似 Pokémon GO 的捕捉畫面）
 * 稀有度：普通／稀有／傳說，越稀有越難抓、獎勵越多。
 * 時機圈：怪物身上的圈圈會一直縮小，圈越小時丟中，抓到的機率越高（Nice／Great／Excellent）。
 * 往上滑丟網（也可以按按鈕）；掙脫 3 次牠就會逃走。
 * AR 迷宮：迷宮的牆疊在相機畫面上，像真的走進迷宮；轉動手機看方向、按住「前進」走，撿 3 個零件找到出口。
 * 相機打不開時改用一般背景；沒有陀螺儀（電腦）時用手指或滑鼠拖曳轉方向。 */
(function () {
  'use strict';
  const RR = window.RR = window.RR || {};
  const KINDS = ['fire', 'ice', 'poison', 'shadow'];
  const KIND_NAMES = ['火焰', '寒冰', '劇毒', '暗影'];
  const VAR_NAMES = ['基本', '長顎', '背刺', '駝背', '肋骨', '三眼', '枯瘦', '巨獸'];
  // 稀有度：[名稱, 出現權重, 基本捕捉率, 顏色, 體型倍率]
  const RARITY = [['普通', 70, 0.6, '#f4efe2', 1], ['稀有', 25, 0.4, '#6ecbff', 1.1], ['傳說', 5, 0.25, '#f0c040', 1.25]];
  const AIM_DEG = 11, SPAWN_DIST = 5, RING_T = 1.8, MAX_ESCAPE = 3;
  let box = null, video = null, stream = null, renderer = null, scene = null, cam = null, raf = 0, last = 0;
  let mon = null, monYaw = 0, monT = 0, spawnT = 0, net = null, netT = 0, shakeT = 0, gone = 0, escapes = 0, ringT = 0;
  let orient = null, dragYaw = 0, dragPitch = 0, drag = null, swipe = null, opts = {};
  // 迷宮：N×N 個房間，牆和通道都是一格（格子大小 MZ_S 公尺）
  const MZ_N = 6, MZ_S = 1.4, MZ_SPEED = 1.6, EYE = 1.5;
  let mode = 'pick', mz = null, fwdHeld = false;
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler();

  function $(id) { return document.getElementById(id); }
  function sfx(f, d, type, vol, slide) { try { if (RR.Sfx) RR.Sfx.tone(f, d, type, vol, slide); } catch (e) {} }
  function hud(t) { $('arMsg').textContent = t; }
  function counts() { const c = opts.counts ? opts.counts() : null; if (c) $('arCount').textContent = '今日 ' + c.today + ' / ' + c.max + '　圖鑑 ' + c.dex + ' / ' + (KINDS.length * VAR_NAMES.length); }

  function onOrient(e) { if (e.alpha == null) return; orient = { a: e.alpha, b: e.beta, g: e.gamma }; }
  function screenAngle() { return (screen.orientation && screen.orientation.angle) || window.orientation || 0; }
  // 手機方向 → 相機朝向（與 three.js DeviceOrientationControls 相同的換算）
  function applyOrient() {
    if (orient) {
      const d = THREE.MathUtils.degToRad;
      eul.set(d(orient.b), d(orient.a), -d(orient.g), 'YXZ');
      cam.quaternion.setFromEuler(eul); cam.quaternion.multiply(q1); cam.quaternion.multiply(q0.setFromAxisAngle(zee, -d(screenAngle())));
    } else {
      cam.rotation.set(dragPitch, dragYaw, 0, 'YXZ');
    }
  }

  function rollRarity() {
    let r = Math.random() * 100;
    for (let i = 0; i < RARITY.length; i++) { if (r < RARITY[i][1]) return i; r -= RARITY[i][1]; }
    return 0;
  }

  function spawn() {
    if (mon) { scene.remove(mon.group); mon = null; }
    if (!RR.Game || !RR.Game.buildMonster) return;
    const k = Math.floor(Math.random() * KINDS.length), v = Math.floor(Math.random() * VAR_NAMES.length), rar = rollRarity();
    mon = RR.Game.buildMonster(KINDS[k], v);
    mon.k = k; mon.v = v; mon.rar = rar;
    mon.group.scale.multiplyScalar(0.55 * RARITY[rar][4]); mon.group.visible = true;   // 遊戲裡新建的怪物預設隱藏，等定位後才顯示
    // 腳下的光圈顯示稀有度
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 40), new THREE.MeshBasicMaterial({ color: RARITY[rar][3], transparent: true, opacity: rar ? 0.9 : 0.45, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.02; mon.group.add(halo); mon.halo = halo;
    // 出現在身邊隨機方向：要轉身找
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    monYaw = Math.atan2(-fwd.x, -fwd.z) + (Math.random() - 0.5) * Math.PI * 1.6;
    monT = 0; gone = 0; shakeT = 0; escapes = 0; ringT = 0;
    scene.add(mon.group);
    const isNew = opts.isNew ? opts.isNew(k, v) : false;
    $('arName').textContent = (isNew ? '新！' : '') + RARITY[rar][0] + '・' + KIND_NAMES[k] + VAR_NAMES[v];
    $('arName').style.borderColor = RARITY[rar][3];
    hud(rar === 2 ? '傳說怪物出現了！圈圈縮到最小時丟網' : '轉動手機找到怪物，圈圈越小時丟中越容易抓');
    if (rar) sfx(rar === 2 ? 880 : 660, 0.25, 'triangle', 0.12, rar === 2 ? 1320 : 990);
  }

  function monPos(out) { return out.set(-Math.sin(monYaw) * SPAWN_DIST, -1.4, -Math.cos(monYaw) * SPAWN_DIST); }
  function ringScale() { return 1 - 0.7 * ((ringT % RING_T) / RING_T); }   // 1 → 0.3 一直循環

  /** side：往上滑時左右偏移的角度（弧度），按按鈕丟就是 0 */
  function throwNet(side) {
    if (net || !mon || gone) return;
    net = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshBasicMaterial({ color: 0xf0c040, wireframe: true }));
    net.userData.from = new THREE.Vector3(0, -0.5, -0.3).applyQuaternion(cam.quaternion).add(cam.position);
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -(side || 0)).applyQuaternion(cam.quaternion);
    net.userData.dir = dir;
    // 判定：丟出去的方向和怪物的方向夾角夠小才算打中；圈圈大小在丟出去的那一刻決定加成
    const to = monPos(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0)).sub(cam.position).normalize();
    net.userData.hit = THREE.MathUtils.radToDeg(dir.angleTo(to)) < AIM_DEG;
    net.userData.ring = ringScale();
    netT = 0; scene.add(net);
    sfx(420, 0.12, 'sine', 0.08, 700);
  }

  function netLand() {
    const hit = net.userData.hit, rs = net.userData.ring; scene.remove(net); net.geometry.dispose(); net = null;
    if (!hit) { hud('沒丟中，再對準一點'); sfx(180, 0.15, 'square', 0.06, 120); return; }
    const grade = rs < 0.45 ? ['Excellent！', 0.25, 2] : rs < 0.7 ? ['Great！', 0.15, 1] : ['Nice', 0.05, 0];
    const rate = Math.min(0.95, RARITY[mon.rar][2] + grade[1]);
    if (Math.random() < rate) {
      gone = 1;
      const msg = opts.onCatch ? opts.onCatch({ k: mon.k, v: mon.v, rar: mon.rar, g: grade[2] }) : '';
      hud(grade[0] + '　抓到了！' + (msg ? '　' + msg : '')); counts();
      if (navigator.vibrate) navigator.vibrate(60);
      sfx(660, 0.1, 'triangle', 0.12, 990); setTimeout(function () { sfx(990, 0.18, 'triangle', 0.12, 1320); }, 110);
      spawnT = 1.6;
    } else if (++escapes >= MAX_ESCAPE) {
      gone = 2; hud('牠逃走了…'); sfx(300, 0.3, 'sawtooth', 0.06, 90); spawnT = 1.6;
    } else {
      shakeT = 0.6; hud(grade[0] + '　牠掙脫了！還剩 ' + (MAX_ESCAPE - escapes) + ' 次機會'); sfx(240, 0.2, 'square', 0.07, 160);
    }
  }

  /* ---------- AR 迷宮 ---------- */
  function brickTex() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
    c.fillStyle = '#5a4a3e'; c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      const v = 70 + Math.floor(Math.random() * 30);
      c.fillStyle = 'rgb(' + (v + 40) + ',' + (v + 10) + ',' + v + ')';
      c.fillRect(x * 32 + (y % 2 ? 16 : 0) - 16 + 2, y * 16 + 2, 28, 12);
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  // 深度優先挖迷宮：grid[r][c] = 1 是牆
  function makeMaze() {
    const W = MZ_N * 2 + 1, grid = [];
    for (let r = 0; r < W; r++) { grid.push([]); for (let c = 0; c < W; c++) grid[r].push(1); }
    const stack = [[1, 1]]; grid[1][1] = 0;
    while (stack.length) {
      const cur = stack[stack.length - 1], nb = [];
      [[0, 2], [0, -2], [2, 0], [-2, 0]].forEach(function (d) { const r = cur[0] + d[0], c = cur[1] + d[1]; if (r > 0 && c > 0 && r < W - 1 && c < W - 1 && grid[r][c]) nb.push([r, c, d]); });
      if (!nb.length) { stack.pop(); continue; }
      const n = nb[Math.floor(Math.random() * nb.length)];
      grid[cur[0] + n[2][0] / 2][cur[1] + n[2][1] / 2] = 0; grid[n[0]][n[1]] = 0; stack.push([n[0], n[1]]);
    }
    return grid;
  }
  function cellPos(r, c) { return new THREE.Vector3((c - MZ_N) * MZ_S, 0, (r - MZ_N) * MZ_S); }
  function blocked(x, z) {
    const W = mz.grid.length, rad = 0.22;
    for (let dr = -1; dr <= 1; dr += 2) for (let dc = -1; dc <= 1; dc += 2) {
      const c = Math.round((x + dc * rad) / MZ_S + MZ_N), r = Math.round((z + dr * rad) / MZ_S + MZ_N);
      if (r < 0 || c < 0 || r >= W || c >= W || mz.grid[r][c]) return true;
    }
    return false;
  }
  function startMaze() {
    mode = 'maze'; box.classList.add('maze'); $('arPick').classList.add('hide');
    const grid = makeMaze(), W = grid.length, root = new THREE.Group();
    let walls = 0; grid.forEach(function (row) { row.forEach(function (v) { walls += v; }); });
    const tex = brickTex(); tex.repeat.set(1, 2);
    // 牆半透明：看得到後面真實的環境，像牆真的立在房間裡
    const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(MZ_S, 2.2, MZ_S), new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.88 }), walls);
    const mtx = new THREE.Matrix4(); let i = 0;
    grid.forEach(function (row, r) { row.forEach(function (v, c) { if (!v) return; const p = cellPos(r, c); mtx.makeTranslation(p.x, 1.1 - EYE, p.z); wm.setMatrixAt(i++, mtx); }); });
    root.add(wm);
    // 地上的格線（地板本身透明，看得到真的地面）
    const gh = new THREE.GridHelper(W * MZ_S, W, 0xf0c040, 0xf0c040); gh.material.transparent = true; gh.material.opacity = 0.35; gh.position.y = -EYE + 0.01; root.add(gh);
    // 出口：發光的光柱
    const ex = cellPos(W - 2, W - 2), beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x7dffe0, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    beam.position.set(ex.x, 1.5 - EYE, ex.z); root.add(beam);
    // 3 個零件：放在離起點和出口都遠的通道上
    const open = []; grid.forEach(function (row, r) { row.forEach(function (v, c) { if (!v && r + c > 6 && !(r === W - 2 && c === W - 2)) open.push([r, c]); }); });
    const parts = [];
    for (let k = 0; k < 3 && open.length; k++) {
      const pick = open.splice(Math.floor(Math.random() * open.length), 1)[0], p = cellPos(pick[0], pick[1]);
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshLambertMaterial({ color: 0xf0c040, emissive: 0x6a4a00 }));
      m.position.set(p.x, 1.0 - EYE, p.z); root.add(m); parts.push(m);
    }
    // 整個迷宮轉到「起點的通道正對著手機現在的方向」，一開始不會面對牆
    const f0 = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), camYaw = Math.atan2(-f0.x, -f0.z);
    const openYaw = !grid[1][2] ? -Math.PI / 2 : Math.PI, rot = camYaw - openYaw;
    root.rotation.y = rot; scene.add(root);
    const st = cellPos(1, 1);
    mz = { grid: grid, root: root, beam: beam, exit: ex, parts: parts, got: 0, x: st.x, z: st.z, t: 0, done: false, rot: rot };
    hud('轉動手機看方向，按住「前進」走。撿 3 個零件，找到發光的出口');
  }
  function mazeFrame(dt) {
    const cr = Math.cos(mz.rot), sr = Math.sin(mz.rot);
    cam.position.set(mz.x * cr + mz.z * sr, 0, -mz.x * sr + mz.z * cr);   // 迷宮座標 → 畫面座標
    if (mz.done) return;
    mz.t += dt;
    if (fwdHeld) {
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), f = new THREE.Vector3(fw.x * cr - fw.z * sr, 0, fw.x * sr + fw.z * cr);   // 畫面方向 → 迷宮座標
      if (f.lengthSq() > 1e-4) {
        f.normalize().multiplyScalar(MZ_SPEED * dt);
        if (!blocked(mz.x + f.x, mz.z)) mz.x += f.x;   // 分開檢查 x、z，撞牆時可以沿著牆滑
        if (!blocked(mz.x, mz.z + f.z)) mz.z += f.z;
      }
    }
    mz.parts.forEach(function (m) {
      if (!m.visible) return; m.rotation.y += dt * 2;
      if (Math.hypot(m.position.x - mz.x, m.position.z - mz.z) < 0.6) { m.visible = false; mz.got++; sfx(880, 0.12, 'triangle', 0.1, 1320); hud('撿到零件 ' + mz.got + ' / 3'); }
    });
    mz.beam.material.opacity = 0.35 + Math.sin(mz.t * 3) * 0.15;
    if (Math.hypot(mz.exit.x - mz.x, mz.exit.z - mz.z) < 0.6) {
      if (mz.got < 3) { if (!mz.warn) { hud('還差 ' + (3 - mz.got) + ' 個零件才能出去'); mz.warn = 1; } }
      else {
        mz.done = true; fwdHeld = false;
        const msg = opts.onMaze ? opts.onMaze({ time: mz.t }) : '';
        hud('逃出迷宮！用了 ' + mz.t.toFixed(1) + ' 秒' + (msg ? '　' + msg : ''));
        sfx(660, 0.1, 'triangle', 0.12, 990); setTimeout(function () { sfx(990, 0.25, 'triangle', 0.12, 1480); }, 120);
        $('arAgain').classList.remove('hide');
      }
    } else mz.warn = 0;
    $('arCount').textContent = '零件 ' + mz.got + ' / 3　' + mz.t.toFixed(0) + ' 秒';
    miniMap();
  }
  // 小地圖：右上角，顯示走過附近的牆、自己的方向、出口和零件
  function miniMap() {
    const cv = $('arMap'), c = cv.getContext('2d'), W = mz.grid.length, k = cv.width / W;
    c.clearRect(0, 0, cv.width, cv.height); c.fillStyle = 'rgba(234,213,177,.85)'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#1e1a16';
    mz.grid.forEach(function (row, r) { row.forEach(function (v, col) { if (v) c.fillRect(col * k, r * k, k, k); }); });
    c.fillStyle = '#2bb39a'; c.fillRect((W - 2) * k, (W - 2) * k, k, k);
    c.fillStyle = '#f0c040'; mz.parts.forEach(function (m) { if (m.visible) c.fillRect((m.position.x / MZ_S + MZ_N) * k + k * 0.25, (m.position.z / MZ_S + MZ_N) * k + k * 0.25, k / 2, k / 2); });
    const px = (mz.x / MZ_S + MZ_N + 0.5) * k, pz = (mz.z / MZ_S + MZ_N + 0.5) * k, fw = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), cr = Math.cos(mz.rot), sr = Math.sin(mz.rot);
    const f = { x: fw.x * cr - fw.z * sr, z: fw.x * sr + fw.z * cr };
    c.fillStyle = '#d9423a'; c.beginPath(); c.arc(px, pz, k * 0.4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#d9423a'; c.lineWidth = 2; c.beginPath(); c.moveTo(px, pz); c.lineTo(px + f.x * k * 1.2, pz + f.z * k * 1.2); c.stroke();
  }
  function clearMaze() { if (mz && scene) scene.remove(mz.root); mz = null; fwdHeld = false; if (cam) cam.position.set(0, 0, 0); }
  function startCatch() { mode = 'catch'; box.classList.remove('maze'); $('arPick').classList.add('hide'); counts(); spawnT = 0; spawn(); }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    applyOrient();
    if (mode === 'maze' && mz) mazeFrame(dt);
    if (mon) {
      monT += dt; ringT += dt;
      const p = monPos(new THREE.Vector3());
      if (gone === 1) { mon.group.scale.setScalar(Math.max(0.001, mon.group.scale.x - dt * 1.2)); mon.group.position.y += dt * 1.5; }
      else if (gone === 2) { monYaw += dt * 0.8; mon.group.position.set(p.x, p.y, p.z); mon.group.scale.setScalar(Math.max(0.001, mon.group.scale.x - dt * 0.5)); }
      else { mon.group.position.set(p.x + (shakeT > 0 ? Math.sin(t / 25) * 0.15 : 0), p.y + Math.abs(Math.sin(monT * 2)) * 0.08, p.z); }
      mon.group.rotation.y = monYaw;   // 面向玩家
      if (mon.arms) { const s = Math.sin(monT * 3) * 0.25; mon.arms[0].rotation.x = s; mon.arms[1].rotation.x = -s; }
      if (mon.halo) mon.halo.material.opacity = (mon.rar ? 0.6 : 0.3) + Math.sin(monT * 4) * 0.25;
      if (shakeT > 0) shakeT -= dt;
      arrow(p); timingRing(p);
    }
    if (spawnT > 0) { spawnT -= dt; if (spawnT <= 0) spawn(); }
    if (net) {
      netT += dt; const k = Math.min(1, netT / 0.5);
      net.position.copy(net.userData.from).addScaledVector(net.userData.dir, k * SPAWN_DIST * 0.95); net.position.y += Math.sin(k * Math.PI) * 0.6;
      net.rotation.x += dt * 8; net.rotation.y += dt * 6;
      if (k >= 1) netLand();
    }
    renderer.render(scene, cam);
  }

  // 怪物身上的時機圈：跟著怪物在畫面上的位置，越縮越小
  function timingRing(p) {
    const el = $('arTiming'), v = p.clone().add(new THREE.Vector3(0, 0.8, 0)).project(cam);
    if (gone || v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { el.classList.add('hide'); return; }
    const s = ringScale();
    el.style.left = ((v.x + 1) / 2 * 100) + '%'; el.style.top = ((1 - v.y) / 2 * 100) + '%';
    el.style.transform = 'translate(-50%,-50%) scale(' + s.toFixed(3) + ')';
    el.style.borderColor = s < 0.45 ? '#7dffe0' : s < 0.7 ? '#f0c040' : '#ffffff';
    el.classList.remove('hide');
  }

  // 怪物不在畫面裡時，邊緣顯示箭頭指方向
  function arrow(p) {
    const a = $('arArrow'), v = p.clone().add(new THREE.Vector3(0, 0.8, 0)).project(cam);
    const behind = v.z > 1, inView = !behind && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9;
    if (inView || gone) { a.classList.add('hide'); return; }
    let x = v.x, y = v.y; if (behind) { x = -x; y = -y; }
    const ang = Math.atan2(-y, x);
    a.style.transform = 'translate(-50%,-50%) translate(' + (Math.cos(ang) * 38) + 'vmin,' + (Math.sin(ang) * 38) + 'vmin) rotate(' + ang + 'rad)';
    a.classList.remove('hide');
  }

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  // 畫面下方往上滑＝丟網；其他地方拖曳＝轉方向（沒有陀螺儀時）
  function pt(e) { return e.changedTouches ? e.changedTouches[0] : e.touches ? e.touches[0] : e; }
  function onDown(e) {
    if (e.target.closest && e.target.closest('button, .arDex')) return;
    const p = pt(e);
    if (p.clientY > window.innerHeight * 0.62) { swipe = { x: p.clientX, y: p.clientY }; return; }
    if (!orient) drag = { x: p.clientX, y: p.clientY };
  }
  function onMove(e) {
    if (!drag || orient) return; const p = pt(e);
    dragYaw += (p.clientX - drag.x) * 0.005; dragPitch = Math.max(-1.2, Math.min(1.2, dragPitch + (p.clientY - drag.y) * 0.005));
    drag = { x: p.clientX, y: p.clientY };
  }
  function onUp(e) {
    drag = null;
    if (!swipe) return; const p = pt(e), dy = p.clientY - swipe.y, dx = p.clientX - swipe.x; swipe = null;
    if (dy < -60) throwNet(Math.max(-0.25, Math.min(0.25, dx / window.innerWidth * 0.6)));
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { box.classList.add('noCam'); hud('這個瀏覽器不能開相機，改用一般背景'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      if (!box || box.classList.contains('hide')) { s.getTracks().forEach(function (tk) { tk.stop(); }); return; }
      stream = s; video.srcObject = s; video.play().catch(function () {});
    }).catch(function () { box.classList.add('noCam'); hud('相機沒有開啟（沒有允許權限），改用一般背景'); });
  }

  // 圖鑑：4 種屬性 × 8 種外觀；點抓過的格子可以設成大廳展示的怪物。上方是今日 AR 任務
  function dexDraw() {
    const g = $('arDexGrid'), got = opts.dex ? opts.dex() : [], buddy = opts.buddy ? opts.buddy() : '';
    const mis = $('arMis'); mis.textContent = '';
    (opts.missions ? opts.missions() : []).forEach(function (m) {
      const r = document.createElement('div'); r.className = m[3] ? 'on' : '';
      const a = document.createElement('span'); a.textContent = (m[3] ? '✓ ' : '') + m[0];
      const b = document.createElement('small'); b.textContent = m[3] ? '已領 +' + m[4] : Math.min(m[1], m[2]) + ' / ' + m[2] + '，+' + m[4] + ' 金幣';
      r.appendChild(a); r.appendChild(b); mis.appendChild(r);
    });
    g.textContent = '';
    KIND_NAMES.forEach(function (kn) { const h = document.createElement('i'); h.textContent = kn; g.appendChild(h); });   // 每一欄是一種屬性
    VAR_NAMES.forEach(function (vn, v) {
      KINDS.forEach(function (_, k) {
        const key = k + ':' + v, has = got.indexOf(key) >= 0, c = document.createElement(has ? 'button' : 'span');
        c.className = (has ? 'on' : '') + (key === buddy ? ' pick' : ''); c.textContent = has ? KIND_NAMES[k] + vn : '？';
        if (has) { c.type = 'button'; c.addEventListener('click', function () { if (opts.pick) opts.pick(k, v); dexDraw(); }); }
        g.appendChild(c);
      });
    });
    $('arDexN').textContent = got.length + ' / ' + (KINDS.length * VAR_NAMES.length);
  }

  const AR = {
    /** o: { onCatch({k,v,rar}) → 獎勵文字, counts() → {today,max,dex}, dex() → ['k:v'…], isNew(k,v) } ；要在點擊事件裡直接呼叫（iOS 需要） */
    open: function (o) {
      opts = o || {}; box = $('arBox'); video = $('arVideo');
      box.classList.remove('hide', 'noCam'); $('arDex').classList.add('hide'); orient = null; dragYaw = dragPitch = 0;
      // iOS 13 起要使用者同意才能讀陀螺儀
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') DOE.requestPermission().then(function (r) { if (r === 'granted') window.addEventListener('deviceorientation', onOrient); }).catch(function () {});
      else window.addEventListener('deviceorientation', onOrient);
      startCamera();
      try { renderer = new THREE.WebGLRenderer({ canvas: $('arCanvas'), alpha: true, antialias: true }); } catch (e) { hud('這台裝置不支援 3D 畫面'); return; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(60, 1, 0.05, 50);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.1));
      const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(2, 4, 3); scene.add(dl);
      resize(); last = 0; spawnT = 0; mode = 'pick'; box.classList.remove('maze'); $('arPick').classList.remove('hide'); $('arAgain').classList.add('hide');
      $('arCount').textContent = ''; $('arName').textContent = ''; $('arArrow').classList.add('hide'); $('arTiming').classList.add('hide'); hud('選一種玩法');
      window.addEventListener('resize', resize);
      box.addEventListener('touchstart', onDown, { passive: true }); box.addEventListener('touchmove', onMove, { passive: true }); box.addEventListener('touchend', onUp);
      box.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
      raf = requestAnimationFrame(frame);
    },
    close: function () {
      cancelAnimationFrame(raf); raf = 0;
      window.removeEventListener('deviceorientation', onOrient); window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      if (box) { box.removeEventListener('touchstart', onDown); box.removeEventListener('touchmove', onMove); box.removeEventListener('touchend', onUp); box.removeEventListener('mousedown', onDown); box.classList.add('hide'); }
      if (stream) { stream.getTracks().forEach(function (tk) { tk.stop(); }); stream = null; }
      if (video) video.srcObject = null;
      if (renderer) { renderer.dispose(); renderer = null; }
      clearMaze(); if (box) box.classList.remove('maze');
      scene = null; mon = null; net = null; swipe = drag = null;
    },
    throwNet: function () { throwNet(0); },
    start: function (m) { if (m === 'maze') startMaze(); else startCatch(); },
    fwd: function (on) { fwdHeld = !!on && mode === 'maze'; },
    again: function () { $('arAgain').classList.add('hide'); clearMaze(); startMaze(); },
    dexToggle: function () { const d = $('arDex'); if (d.classList.contains('hide')) dexDraw(); d.classList.toggle('hide'); },
    TOTAL: KINDS.length * VAR_NAMES.length
  };
  RR.AR = AR;
})();
