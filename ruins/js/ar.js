/* AR 抓怪：用手機相機當背景，轉動手機找怪物，對準後丟回收網把牠抓起來（類似 Pokémon GO 的捕捉畫面）
 * 相機打不開時改用一般背景；沒有陀螺儀（電腦）時用手指或滑鼠拖曳轉方向。 */
(function () {
  'use strict';
  const RR = window.RR = window.RR || {};
  const KINDS = ['fire', 'ice', 'poison', 'shadow'];
  const CATCH_RATE = 0.6, AIM_DEG = 11, SPAWN_DIST = 5;
  let box = null, video = null, stream = null, renderer = null, scene = null, cam = null, raf = 0, last = 0;
  let mon = null, monYaw = 0, monT = 0, spawnT = 0, net = null, netT = 0, caught = 0, shakeT = 0, gone = 0;
  let orient = null, dragYaw = 0, dragPitch = 0, drag = null, opts = {};
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler();

  function $(id) { return document.getElementById(id); }
  function hud(t) { $('arMsg').textContent = t; }
  function counts() { const c = opts.counts ? opts.counts() : null; if (c) $('arCount').textContent = '今日 ' + c.today + ' / ' + c.max + '　總共 ' + c.total; }

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

  function spawn() {
    if (mon) { scene.remove(mon.group); mon = null; }
    if (!RR.Game || !RR.Game.buildMonster) return;
    mon = RR.Game.buildMonster(KINDS[Math.floor(Math.random() * 4)], Math.floor(Math.random() * 8));
    mon.group.scale.multiplyScalar(0.55); mon.group.visible = true;   // 遊戲裡新建的怪物預設隱藏，等定位後才顯示
    mon.group.traverse(function (o) { o.layers.enableAll(); });
    // 出現在身邊隨機方向：要轉身找
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    monYaw = Math.atan2(-fwd.x, -fwd.z) + (Math.random() - 0.5) * Math.PI * 1.6;
    mon.base = mon.group.scale.x; monT = 0; gone = 0; shakeT = 0;
    scene.add(mon.group);
    hud('轉動手機找到怪物，對準中間的圈圈後丟回收網');
  }

  function monPos(out) { return out.set(-Math.sin(monYaw) * SPAWN_DIST, -1.4, -Math.cos(monYaw) * SPAWN_DIST); }

  function throwNet() {
    if (net || !mon || gone) return;
    net = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshBasicMaterial({ color: 0xf0c040, wireframe: true }));
    net.userData.from = new THREE.Vector3(0, -0.5, -0.3).applyQuaternion(cam.quaternion).add(cam.position);
    net.userData.dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    // 判定：丟出去的方向和怪物的方向夾角夠小才算打中
    const to = monPos(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0)).sub(cam.position).normalize();
    net.userData.hit = THREE.MathUtils.radToDeg(net.userData.dir.angleTo(to)) < AIM_DEG;
    netT = 0; scene.add(net);
  }

  function netLand() {
    const hit = net.userData.hit; scene.remove(net); net.geometry.dispose(); net = null;
    if (!hit) { hud('沒丟中，再對準一點'); return; }
    if (Math.random() < CATCH_RATE) {
      gone = 1; caught++;
      const msg = opts.onCatch ? opts.onCatch() : '';
      hud('抓到了！' + (msg ? '　' + msg : '')); counts();
      if (navigator.vibrate) navigator.vibrate(60);
      spawnT = 1.6;
    } else { shakeT = 0.6; hud('牠掙脫了！再丟一次'); }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    applyOrient();
    if (mon) {
      monT += dt;
      const p = monPos(new THREE.Vector3());
      if (gone) { mon.group.scale.setScalar(Math.max(0.001, mon.group.scale.x - dt * 1.2)); mon.group.position.y += dt * 1.5; }
      else { mon.group.position.set(p.x + (shakeT > 0 ? Math.sin(t / 25) * 0.15 : 0), p.y + Math.abs(Math.sin(monT * 2)) * 0.08, p.z); }
      mon.group.rotation.y = monYaw;   // 面向玩家
      if (mon.arms) { const s = Math.sin(monT * 3) * 0.25; mon.arms[0].rotation.x = s; mon.arms[1].rotation.x = -s; }
      if (shakeT > 0) shakeT -= dt;
      arrow(p);
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
  function onDown(e) { if (orient) return; const pt = e.touches ? e.touches[0] : e; drag = { x: pt.clientX, y: pt.clientY }; }
  function onMove(e) {
    if (!drag || orient) return; const pt = e.touches ? e.touches[0] : e;
    dragYaw += (pt.clientX - drag.x) * 0.005; dragPitch = Math.max(-1.2, Math.min(1.2, dragPitch + (pt.clientY - drag.y) * 0.005));
    drag = { x: pt.clientX, y: pt.clientY };
  }
  function onUp() { drag = null; }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { box.classList.add('noCam'); hud('這個瀏覽器不能開相機，改用一般背景'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      if (!box || box.classList.contains('hide')) { s.getTracks().forEach(function (tk) { tk.stop(); }); return; }
      stream = s; video.srcObject = s; video.play().catch(function () {});
    }).catch(function () { box.classList.add('noCam'); hud('相機沒有開啟（沒有允許權限），改用一般背景'); });
  }

  const AR = {
    /** o: { onCatch() → 要顯示的獎勵文字, counts() → {today, max, total} } ；要在點擊事件裡直接呼叫（iOS 需要） */
    open: function (o) {
      opts = o || {}; box = $('arBox'); video = $('arVideo');
      box.classList.remove('hide', 'noCam'); caught = 0; orient = null; dragYaw = dragPitch = 0;
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
      resize(); counts(); last = 0; spawnT = 0; spawn();
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
      scene = null; mon = null; net = null;
    },
    throwNet: throwNet
  };
  RR.AR = AR;
})();
