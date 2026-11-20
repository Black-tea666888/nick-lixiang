/* 跳關平台（休閒模式）：橫向捲動、跳上平台、踩敵人、吃金幣、頂問號磚、到旗桿過關。單機，用 2D 畫布畫。 */
(function (root) {
  'use strict';
  const T = 12, VW = 320, VH = 180, GRAV = 0.42, MAXFALL = 6, RUN = 2.1, ACC = 0.32, FRIC = 0.22, JUMP = -6.4;
  // 關卡：# 地面、= 磚塊、? 問號磚（頂一下掉金幣）、U 用過的磚、| 水管、C 金幣、E 栗寶寶、P 起點、F 旗桿頂
  function level() {
    const W = 150, H = 15, g = [];
    for (let r = 0; r < H; r++) g.push(new Array(W).fill('.'));
    const set = function (c, r, ch) { if (c >= 0 && c < W && r >= 0 && r < H) g[r][c] = ch; };
    for (let c = 0; c < W; c++) { set(c, 13, '#'); set(c, 14, '#'); }
    [[30, 33], [62, 64], [98, 101]].forEach(function (p) { for (let c = p[0]; c <= p[1]; c++) { set(c, 13, '.'); set(c, 14, '.'); } });   // 地面的洞
    for (let c = 20; c < 25; c++) set(c, 9, '=');                                                        // 空中平台
    set(26, 9, '?'); set(28, 9, '?'); set(30, 9, '?'); set(90, 9, '?');
    for (let c = 45; c < 50; c++) set(c, 6, '=');
    [[40, 2], [70, 3], [110, 2], [132, 4]].forEach(function (p) { for (let r = 13 - p[1]; r < 13; r++) { set(p[0], r, '|'); set(p[0] + 1, r, '|'); } });
    for (let c = 56; c < 60; c++) set(c, 10, '=');
    [[12, 12], [22, 8], [35, 12], [46, 5], [52, 12], [66, 12], [77, 12], [84, 12], [93, 8], [104, 12], [121, 12], [127, 12], [138, 12]].forEach(function (q) { set(q[0], q[1], 'E'); });
    for (let c = 4; c < 150; c += 3) if (c % 9 !== 0) set(c, 12, 'C');
    for (let c = 21; c < 25; c++) set(c, 8, 'C');
    for (let c = 46; c < 50; c++) set(c, 5, 'C');
    for (let r = 4; r < 13; r++) set(146, r, 'L');   // 旗桿
    set(146, 3, 'F');
    set(2, 12, 'P');
    return g.map(function (row) { return row.join(''); });
  }
  const SOLID = { '#': 1, '=': 1, '?': 1, 'U': 1, '|': 1 };
  let st = null, raf = 0, last = 0, acc = 0, keysDown = {}, onDone = null, host = null, cvs = null, ctx = null, touchDown = {};

  function reset(lives, coins, t0) {
    const rows = level();
    st = { rows: rows, W: rows[0].length, H: rows.length, lives: lives, coins: coins, t: t0 || 0, over: 0, msg: '', msgT: 0, won: false, dead: 0, flashT: 0,
      p: { x: 0, y: 0, w: 9, h: 12, vx: 0, vy: 0, on: false, face: 1 }, en: [], cam: 0 };
    for (let r = 0; r < st.H; r++) for (let c = 0; c < st.W; c++) {
      const ch = rows[r][c];
      if (ch === 'P') { st.p.x = c * T; st.p.y = r * T - 4; st.start = [c * T, r * T - 4]; }
      if (ch === 'E') st.en.push({ x: c * T + 1, y: r * T - 9, w: 10, h: 10, vx: -0.45, vy: 0, dead: 0, squash: 0 });
    }
    st.rows = rows.map(function (row) { return row.split(''); });
    for (let r = 0; r < st.H; r++) for (let c = 0; c < st.W; c++) if (st.rows[r][c] === 'E' || st.rows[r][c] === 'C' || st.rows[r][c] === 'P') st.rows[r][c] = '.';
    st.coinsAt = {};
    for (let r = 0; r < st.H; r++) for (let c = 0; c < st.W; c++) if (rows[r][c] === 'C') st.coinsAt[c + ',' + r] = 1;
  }
  function tile(c, r) {
    if (c < 0 || c >= st.W) return '#';
    if (r < 0) return '.';
    if (r >= st.H) return '.';
    return st.rows[r][c];
  }
  function solidAt(x, y, w, h) {
    const c0 = Math.floor(x / T), c1 = Math.floor((x + w - 0.01) / T), r0 = Math.floor(y / T), r1 = Math.floor((y + h - 0.01) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (SOLID[tile(c, r)]) return { c: c, r: r };
    return null;
  }
  function collectCoin(c, r) { if (st.coinsAt[c + ',' + r]) { delete st.coinsAt[c + ',' + r]; } }
  function takeCoin() { st.coins++; if (st.coins % 100 === 0) { st.lives++; say('1UP！'); } }
  function say(m) { st.msg = m; st.msgT = 2.2; }

  function die() {
    if (st.dead) return;
    st.dead = 1; st.lives--;
    st.deadT = 90;
  }
  function step() {
    const p = st.p;
    if (st.over) return;
    if (st.dead) { st.deadT--; if (st.deadT <= 0) { if (st.lives <= 0) { st.over = 'lose'; } else { const l = st.lives, cn = st.coins, tt = st.t; reset(l, cn, tt); st.dead = 0; } } return; }
    st.t += 1 / 60;
    const left = keysDown.left || touchDown.left, right = keysDown.right || touchDown.right, jump = keysDown.jump || touchDown.jump;
    // 水平
    if (right) { p.vx = Math.min(RUN, p.vx + ACC); p.face = 1; }
    else if (left) { p.vx = Math.max(-RUN, p.vx - ACC); p.face = -1; }
    else { if (p.vx > 0) p.vx = Math.max(0, p.vx - FRIC); else if (p.vx < 0) p.vx = Math.min(0, p.vx + FRIC); }
    p.x += p.vx;
    let hit = solidAt(p.x, p.y, p.w, p.h);
    if (hit) { if (p.vx > 0) p.x = hit.c * T - p.w - 0.01; else p.x = (hit.c + 1) * T + 0.01; p.vx = 0; }
    // 跳（按住可跳高一點）
    if (jump && p.on) { p.vy = JUMP; p.on = false; }
    if (!jump && p.vy < -2) p.vy = -2;   // 放開跳鍵就短跳
    p.vy = Math.min(MAXFALL, p.vy + GRAV);
    p.y += p.vy;
    p.on = false;
    hit = solidAt(p.x, p.y, p.w, p.h);
    if (hit) {
      if (p.vy > 0) { p.y = hit.r * T - p.h - 0.01; p.on = true; p.vy = 0; }
      else {
        p.y = (hit.r + 1) * T; p.vy = 0;
        if (tile(hit.c, hit.r) === '?') { st.rows[hit.r][hit.c] = 'U'; takeCoin(); say('金幣！'); }
      }
    }
    // 掉進洞
    if (p.y > st.H * T + 20) { die(); return; }
    // 金幣
    const pc0 = Math.floor(p.x / T), pc1 = Math.floor((p.x + p.w) / T), pr0 = Math.floor(p.y / T), pr1 = Math.floor((p.y + p.h) / T);
    for (let c = pc0; c <= pc1; c++) for (let r = pr0; r <= pr1; r++) if (st.coinsAt[c + ',' + r]) { collectCoin(c, r); takeCoin(); }
    // 旗桿
    if (pc1 >= 146 && pc0 <= 147) { st.over = 'win'; st.won = true; return; }
    // 敵人
    st.en.forEach(function (e) {
      if (e.dead) { e.squash += 1 / 60; return; }
      e.x += e.vx;
      const wall = solidAt(e.x, e.y, e.w, e.h);
      if (wall) { e.x = e.vx > 0 ? wall.c * T - e.w - 0.01 : (wall.c + 1) * T + 0.01; e.vx = -e.vx; }
      const edge = solidAt(e.vx > 0 ? e.x + e.w : e.x - 1, e.y + e.h + 1, 1, 1);
      if (!edge) e.vx = -e.vx;   // 前面沒地就轉身
      e.vy = Math.min(MAXFALL, (e.vy || 0) + GRAV);
      e.y += e.vy;
      const ground = solidAt(e.x, e.y, e.w, e.h);
      if (ground && e.vy > 0) { e.y = ground.r * T - e.h - 0.01; e.vy = 0; }
      // 踩或碰
      const ov = p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y;
      if (ov) {
        if (p.vy > 0 && p.y + p.h - e.y < 6) { e.dead = 1; p.vy = -4.6; say('踩扁！'); }
        else if (!st.dead) die();
      }
    });
    // 相機
    st.cam = Math.max(0, Math.min(st.W * T - VW, p.x - VW / 2 + 6));
    if (st.msgT > 0) st.msgT -= 1 / 60;
  }

  const COL = { sky: '#6fb6ff', sky2: '#a9dcff', ground: '#8a5a2b', groundTop: '#4b8f2a', brick: '#c0662e', q: '#ffcc33', qUsed: '#7a5a3a', pipe: '#2e9e3a', pipeEdge: '#1f6d28', coin: '#ffd23a', goomba: '#8b5a2b', goombaFoot: '#3b2412', mario: '#e0342a', overall: '#2e5fd6', skin: '#f2c9a0', flag: '#3ad08a' };
  function draw() {
    if (!ctx || !st) return;
    const cam = Math.floor(st.cam);
    const g = ctx; g.fillStyle = COL.sky; g.fillRect(0, 0, VW, VH);
    g.fillStyle = COL.sky2; g.fillRect(0, VH - 40, VW, 40);
    // 雲
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 8; i++) { const x = ((i * 137 - cam * 0.3) % (VW + 80) + VW + 80) % (VW + 80) - 40; g.fillRect(x, 18 + (i % 3) * 10, 26, 6); g.fillRect(x + 6, 14 + (i % 3) * 10, 14, 6); }
    const c0 = Math.max(0, Math.floor(cam / T)), c1 = Math.min(st.W - 1, Math.floor((cam + VW) / T) + 1);
    for (let r = 0; r < st.H; r++) for (let c = c0; c <= c1; c++) {
      const ch = st.rows[r][c], x = c * T - cam, y = r * T;
      if (ch === '#') { g.fillStyle = (r === 13 && tile(c, r - 1) === '.') ? COL.groundTop : COL.ground; g.fillRect(x, y, T, T); if (r === 13 && tile(c, r - 1) === '.') { g.fillStyle = COL.ground; g.fillRect(x, y + 3, T, T - 3); } }
      else if (ch === '=') { g.fillStyle = COL.brick; g.fillRect(x, y, T, T); g.fillStyle = '#6e3314'; g.fillRect(x, y + 5, T, 1); g.fillRect(x + 6, y, 1, 5); }
      else if (ch === '?') { g.fillStyle = COL.q; g.fillRect(x, y, T, T); g.fillStyle = '#7a4a00'; g.fillRect(x + 4, y + 3, 4, 1); g.fillRect(x + 4, y + 9, 4, 1); }
      else if (ch === 'U') { g.fillStyle = COL.qUsed; g.fillRect(x, y, T, T); }
      else if (ch === '|') { g.fillStyle = COL.pipe; g.fillRect(x, y, T, T); g.fillStyle = COL.pipeEdge; g.fillRect(x, y, 1, T); g.fillRect(x + T - 1, y, 1, T); if (r === 13 - 0 || tile(c, r - 1) !== '|') { g.fillStyle = COL.pipeEdge; g.fillRect(x - 1, y, T + 2, 3); } }
      else if (ch === 'L') { g.fillStyle = '#ddd'; g.fillRect(x + 5, y, 2, T); }
      else if (ch === 'F') { g.fillStyle = COL.flag; g.fillRect(x + 6, y + 2, 6, 5); }
      if (st.coinsAt[c + ',' + r]) { const cx = x + 6, cy = y + 6 + Math.sin(performance.now() / 200 + c) * 1.2; g.fillStyle = COL.coin; g.beginPath(); g.arc(cx, cy, 3.4, 0, Math.PI * 2); g.fill(); g.fillStyle = '#b8860b'; g.fillRect(cx - 0.5, cy - 2, 1, 4); }
    }
    st.en.forEach(function (e) {
      const x = e.x - cam, y = e.y;
      if (e.dead) { g.fillStyle = COL.goombaFoot; g.fillRect(x, y + e.h - 3, e.w, 3); return; }
      g.fillStyle = COL.goomba; g.fillRect(x + 1, y, e.w - 2, e.h - 3); g.fillRect(x, y + 3, e.w, e.h - 6);
      g.fillStyle = COL.goombaFoot; g.fillRect(x, y + e.h - 3, e.w, 3);
      g.fillStyle = '#fff'; g.fillRect(x + 2, y + 3, 2, 2); g.fillRect(x + e.w - 4, y + 3, 2, 2);
    });
    const p = st.p, px = p.x - cam, py = p.y;
    if (!(st.dead && (st.deadT % 12) < 6)) {
      g.fillStyle = COL.mario; g.fillRect(px + 1, py, p.w - 2, 3);                          // 帽子
      g.fillStyle = COL.skin; g.fillRect(px + 1, py + 3, p.w - 2, 3);                       // 臉
      g.fillStyle = COL.overall; g.fillRect(px, py + 6, p.w, 4); g.fillRect(px + 1, py + 10, 3, 2); g.fillRect(px + p.w - 4, py + 10, 3, 2);
    }
    // HUD
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, VW, 14);
    g.fillStyle = '#fff'; g.font = '9px monospace'; g.textBaseline = 'top';
    g.fillText('x' + st.lives + '  COIN ' + String(st.coins).padStart(2, '0') + '  TIME ' + Math.max(0, 300 - Math.floor(st.t)), 4, 3);
    if (st.msgT > 0) { g.fillStyle = '#fff'; g.font = 'bold 10px monospace'; g.textAlign = 'center'; g.fillText(st.msg, VW / 2, 22); g.textAlign = 'left'; }
    if (st.dead) { g.fillStyle = 'rgba(200,0,0,.18)'; g.fillRect(0, 0, VW, VH); }
    if (st.over) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, VW, VH); g.fillStyle = '#fff'; g.font = 'bold 16px monospace'; g.textAlign = 'center';
      g.fillText(st.over === 'win' ? '過關！' : 'GAME OVER', VW / 2, VH / 2 - 14);
      g.font = '10px monospace'; g.fillText('金幣 ' + st.coins + '　用時 ' + st.t.toFixed(1) + ' 秒', VW / 2, VH / 2 + 6); g.textAlign = 'left';
    }
  }
  function loop(ts) {
    if (!st) return;
    if (!last) last = ts;
    acc += Math.min(100, ts - last); last = ts;
    while (acc >= 1000 / 60) { step(); acc -= 1000 / 60; if (st.over) break; }
    draw();
    if (st.over && !st.endSent) { st.endSent = true; const r = { win: st.won, coins: st.coins, time: st.t }; setTimeout(function () { if (onDone) onDone(r); }, 1800); }
    raf = requestAnimationFrame(loop);
  }
  function onKey(e, v) {
    const k = e.code;
    if (k === 'ArrowLeft' || k === 'KeyA') keysDown.left = v;
    else if (k === 'ArrowRight' || k === 'KeyD') keysDown.right = v;
    else if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW' || k === 'KeyK') keysDown.jump = v;
    else return;
    e.preventDefault();
  }
  function bindTouch(el, name) {
    const set = function (v) { return function (e) { e.preventDefault(); touchDown[name] = v; }; };
    el.addEventListener('pointerdown', set(true)); el.addEventListener('pointerup', set(false)); el.addEventListener('pointercancel', set(false)); el.addEventListener('pointerleave', set(false));
  }
  /** 開始一局；done({win, coins, time}) 在過關或 GAME OVER 後呼叫 */
  function start(el, done) {
    stop();
    host = el; onDone = done; host.innerHTML = '';
    cvs = document.createElement('canvas'); cvs.width = VW; cvs.height = VH; cvs.className = 'platCanvas';
    ctx = cvs.getContext('2d'); ctx.imageSmoothingEnabled = false;
    host.appendChild(cvs);
    const pad = document.createElement('div'); pad.className = 'platPad';
    pad.innerHTML = '<button type="button" data-k="left">◀</button><button type="button" data-k="jump">跳</button><button type="button" data-k="right">▶</button>';
    host.appendChild(pad);
    Array.prototype.forEach.call(pad.querySelectorAll('button'), function (b) { bindTouch(b, b.dataset.k); });
    keysDown = {}; touchDown = {};
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    reset(3, 0, 0); last = 0; acc = 0; raf = requestAnimationFrame(loop);
  }
  function kd(e) { if (host && host.offsetParent !== null) onKey(e, true); }
  function ku(e) { if (host) onKey(e, false); }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; st = null; onDone = null;
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
    keysDown = {}; touchDown = {};
    if (host) host.innerHTML = '';
  }
  root.RR = root.RR || {};
  root.RR.Plat = { start: start, stop: stop };
})(typeof window !== 'undefined' ? window : this);
