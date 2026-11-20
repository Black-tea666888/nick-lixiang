/* 遺跡跑酷（休閒模式「跳關」）：原創角色「撿荒者」，橫向捲動。
   機制：跑、跳、衝刺（衝刺撞碎脆石牆、撞碎碎石獸）。收集 12 個古代齒輪，才能打開回收點的齒輪門。 */
(function (root) {
  'use strict';
  const T = 12, VW = 320, VH = 180, STEP = 1 / 60;
  const GRAV = 0.42, MAXFALL = 6.5, RUN = 2.0, ACC = 0.3, FRIC = 0.26;
  const JUMP = -6.2, DASH_V = 5.4, DASH_T = 12, DASH_CD = 40, COYOTE = 6, JBUF = 6;
  const PW = 8, PH = 13, GEARS_NEED = 12, LIVES = 3, DEAD_T = 72, END_DELAY = 1500;
  const SOLID = { '#': 1, '=': 1, 'x': 1, 'W': 1 };
  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyJ: 'dash', KeyK: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash' };

  // 地圖（原創）：# 石磚  = 石台  x 脆石牆（衝刺撞碎）  W 齒輪門  G 回收點  g 古代齒輪  b 碎石獸  P 起點
  function buildMap() {
    const W = 170, H = 15, m = [];
    for (let r = 0; r < H; r++) m.push(new Array(W).fill('.'));
    const put = function (c, r, ch) { if (c >= 0 && c < W && r >= 0 && r < H) m[r][c] = ch; };
    const rect = function (c0, r0, c1, r1, ch) { for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) put(c, r, ch); };
    rect(0, 13, W - 1, 14, '#');
    [[27, 29], [61, 63], [99, 101], [133, 135]].forEach(function (p) { rect(p[0], 13, p[1], 14, '.'); });
    // 石台（不放在坑的正上方，免得起跳時撞頭）
    [[14, 18], [36, 40], [52, 56], [70, 74], [86, 90], [102, 106], [120, 124], [136, 140], [146, 150]].forEach(function (p) { rect(p[0], 10, p[1], 10, '='); });
    rect(46, 8, 46, 12, 'x'); rect(80, 8, 80, 12, 'x'); rect(116, 8, 116, 12, 'x');
    rect(158, 8, 158, 12, 'W');
    rect(166, 11, 166, 12, 'G');
    [[10, 12], [16, 9], [20, 9], [26, 7], [33, 12], [38, 9], [43, 12], [53, 9], [60, 12], [71, 9], [84, 7], [92, 12], [106, 9], [112, 7], [122, 9], [130, 12], [139, 12], [150, 9]].forEach(function (p) { put(p[0], p[1], 'g'); });
    [[32, 12], [58, 12], [76, 12], [98, 12], [118, 12], [141, 12]].forEach(function (p) { put(p[0], p[1], 'b'); });
    put(2, 12, 'P');
    return m;
  }

  let st = null, raf = 0, last = 0, acc = 0, keys = {}, touch = {}, onDone = null, host = null, cvs = null, ctx = null, endTimer = 0;

  function loadLevel(lives, t) {
    const m = buildMap();
    st = { m: m, W: m[0].length, H: m.length, lives: lives, gears: 0, gearList: [], beasts: [], parts: [], msg: '', msgT: 0,
      t: t || 0, over: 0, won: false, dead: 0, deadT: 0, gateOpen: false, prev: {}, cam: 0,
      p: { x: 0, y: 0, w: PW, h: PH, vx: 0, vy: 0, on: false, coy: 0, jbuf: 0, dash: 0, cd: 0, face: 1 } };
    for (let r = 0; r < st.H; r++) for (let c = 0; c < st.W; c++) {
      const ch = m[r][c];
      if (ch === 'P') { st.p.x = c * T; st.p.y = (r + 1) * T - PH; m[r][c] = '.'; }
      else if (ch === 'g') { st.gearList.push({ c: c, r: r, got: false }); m[r][c] = '.'; }
      else if (ch === 'b') { st.beasts.push({ x: c * T + 1, y: (r + 1) * T - 9, w: 10, h: 9, vx: -0.35, vy: 0, alive: true, dead: 0 }); m[r][c] = '.'; }
    }
  }

  function tileAt(c, r) {
    if (c < 0 || c >= st.W) return '#';
    if (r < 0 || r >= st.H) return '.';
    return st.m[r][c];
  }
  function solidBox(x, y, w, h) {
    const c0 = Math.floor(x / T), c1 = Math.floor((x + w - 0.001) / T), r0 = Math.floor(y / T), r1 = Math.floor((y + h - 0.001) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (SOLID[tileAt(c, r)]) return true;
    return false;
  }
  function eachTile(x, y, w, h, fn) {
    const c0 = Math.floor(x / T), c1 = Math.floor((x + w - 0.001) / T), r0 = Math.floor(y / T), r1 = Math.floor((y + h - 0.001) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(c, r);
  }
  function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) st.parts.push({ x: x, y: y, vx: (Math.random() - 0.5) * 2.2, vy: -Math.random() * 2, life: 24 + Math.random() * 14, color: color });
  }
  function say(txt) { st.msg = txt; st.msgT = 120; }

  // 沿一個軸移動，逐像素檢查；衝刺時撞碎脆石牆
  function moveAxis(e, horiz, amt, dash) {
    let rem = Math.abs(amt); const s = amt >= 0 ? 1 : -1;
    while (rem > 1e-6) {
      const d = Math.min(1, rem); rem -= d;
      const nx = horiz ? e.x + s * d : e.x, ny = horiz ? e.y : e.y + s * d;
      if (dash) eachTile(nx, ny, e.w, e.h, function (c, r) { if (tileAt(c, r) === 'x') { st.m[r][c] = '.'; burst(c * T + 6, r * T + 6, '#9a7a5a', 6); } });
      if (solidBox(nx, ny, e.w, e.h)) return true;
      e.x = nx; e.y = ny;
    }
    return false;
  }

  function die() {
    if (st.dead || st.over) return;
    st.dead = 1; st.deadT = DEAD_T; st.lives--;
    burst(st.p.x + 4, st.p.y + 6, '#ff8a7a', 14);
  }

  function openGate() {
    st.gateOpen = true;
    for (let r = 0; r < st.H; r++) for (let c = 0; c < st.W; c++) if (st.m[r][c] === 'W') { st.m[r][c] = '.'; burst(c * T + 6, r * T + 6, '#8fa3ab', 8); }
    say('齒輪門打開了！');
  }

  function stepPlayer(inp) {
    const p = st.p, pr = st.prev;
    const jumpPressed = inp.jump && !pr.jump, dashPressed = inp.dash && !pr.dash;
    pr.jump = inp.jump; pr.dash = inp.dash;
    if (p.cd > 0) p.cd--;
    if (dashPressed && p.cd === 0 && p.dash === 0) { p.dash = DASH_T; p.cd = DASH_CD; p.vx = DASH_V * p.face; p.vy = 0; }
    if (p.dash > 0) {
      p.dash--;
      if (p.dash === 0) p.vx = p.face * RUN * 0.6;
    } else {
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (dir) p.face = dir;
      const target = dir * RUN, step = dir ? ACC : FRIC;
      if (p.vx < target) p.vx = Math.min(target, p.vx + step);
      else if (p.vx > target) p.vx = Math.max(target, p.vx - step);
    }
    p.jbuf = jumpPressed ? JBUF : Math.max(0, p.jbuf - 1);
    p.coy = p.on ? COYOTE : Math.max(0, p.coy - 1);
    if (p.jbuf > 0 && p.coy > 0 && p.dash === 0) { p.vy = JUMP; p.on = false; p.coy = 0; p.jbuf = 0; }
    if (p.dash === 0) {
      if (!inp.jump && p.vy < -2) p.vy = -2;   // 放開跳鍵就矮跳
      p.vy = Math.min(MAXFALL, p.vy + GRAV);
    }
    if (moveAxis(p, true, p.vx, p.dash > 0)) { p.vx = 0; p.dash = 0; }
    p.on = false;
    if (moveAxis(p, false, p.vy, false)) { if (p.vy > 0) p.on = true; p.vy = 0; }
  }

  function stepBeasts() {
    st.beasts.forEach(function (b) {
      if (!b.alive) { b.dead++; return; }
      b.vy = Math.min(MAXFALL, b.vy + GRAV);
      if (moveAxis(b, false, b.vy, false)) b.vy = 0;
      if (moveAxis(b, true, b.vx, false)) b.vx = -b.vx;
      const frontX = b.vx > 0 ? b.x + b.w : b.x - 1;
      if (!solidBox(frontX, b.y + b.h + 1, 1, 1)) b.vx = -b.vx;   // 前面沒地就轉身
      if (overlap(st.p, b)) {
        if (st.p.dash > 0) { b.alive = false; b.dead = 0; burst(b.x + 5, b.y + 5, '#9aa0a9', 10); }
        else die();
      }
    });
  }

  function collectAndCheck() {
    const p = st.p;
    st.gearList.forEach(function (g) {
      if (g.got) return;
      const gb = { x: g.c * T + 3, y: g.r * T + 3, w: 6, h: 6 };
      if (overlap(p, gb)) { g.got = true; st.gears++; burst(gb.x + 3, gb.y + 3, '#e8b84a', 6); }
    });
    if (!st.gateOpen && st.gears >= GEARS_NEED) openGate();
    eachTile(p.x, p.y, p.w, p.h, function (c, r) {
      if (tileAt(c, r) !== 'G' || st.over) return;
      if (st.gateOpen) { st.over = 'win'; st.won = true; }
      else say('還差 ' + (GEARS_NEED - st.gears) + ' 個齒輪');
    });
  }

  function updateParts() {
    st.parts = st.parts.filter(function (q) {
      q.x += q.vx; q.y += q.vy; q.vy += 0.12; q.life--;
      return q.life > 0;
    });
  }

  function stepGame(inp) {
    if (st.over) return;
    updateParts();
    if (st.msgT > 0) st.msgT--;
    if (st.dead) {
      st.deadT--;
      if (st.deadT <= 0) { if (st.lives <= 0) st.over = 'lose'; else loadLevel(st.lives, st.t); }
      return;
    }
    st.t += STEP;
    stepPlayer(inp);
    if (st.p.y > st.H * T + 10) { die(); return; }   // 掉進坑裡
    stepBeasts();
    if (!st.dead) collectAndCheck();
  }

  // ---- 畫面 ----
  const COL = { player: { hood: '#2bb3a3', face: '#f2d7b5', coat: '#6b5a43', pack: '#c9a24b', legs: '#2e2a26', eye: '#222' } };
  function drawGear(g, cx, cy, ang) {
    g.save(); g.translate(cx, cy); g.rotate(ang);
    g.fillStyle = '#e8b84a';
    g.fillRect(-4, -1, 8, 2); g.fillRect(-1, -4, 2, 8);
    g.beginPath(); g.arc(0, 0, 2.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6b4a14'; g.fillRect(-0.5, -0.5, 1, 1);
    g.restore();
  }
  function drawPlayer(g, cam) {
    const p = st.p, px = Math.round(p.x - cam), py = Math.round(p.y), f = p.face;
    if (p.dash > 0) { g.fillStyle = 'rgba(120,255,230,.55)'; g.fillRect(px - f * 7, py + 4, 7, 2); g.fillRect(px - f * 5, py + 8, 5, 2); }
    g.fillStyle = COL.player.pack; g.fillRect(f > 0 ? px - 1 : px + 7, py + 5, 2, 5);
    g.fillStyle = COL.player.coat; g.fillRect(px + 1, py + 5, 6, 5);
    g.fillStyle = COL.player.hood; g.fillRect(px + 1, py, 6, 4); g.fillRect(f > 0 ? px : px + 6, py + 3, 2, 2);
    g.fillStyle = COL.player.face; g.fillRect(f > 0 ? px + 3 : px + 1, py + 2, 3, 3);
    g.fillStyle = COL.player.eye; g.fillRect(f > 0 ? px + 5 : px + 1, py + 3, 1, 1);
    const walking = p.on && Math.abs(p.vx) > 0.1, alt = walking ? (st.t * 12 | 0) & 1 : 0;
    g.fillStyle = COL.player.legs;
    if (!p.on) { g.fillRect(px + 1, py + 10, 2, 3); g.fillRect(px + 5, py + 10, 2, 3); }
    else { g.fillRect(px + 1, py + 10 + alt, 2, 3); g.fillRect(px + 5, py + 11 - alt, 2, 2 + alt); }
  }
  function draw() {
    const g = ctx, p = st.p;
    st.cam = Math.max(0, Math.min(st.W * T - VW, p.x + PW / 2 - VW * 0.42));
    const cam = Math.floor(st.cam);
    const grad = g.createLinearGradient(0, 0, 0, VH); grad.addColorStop(0, '#2a3a4c'); grad.addColorStop(1, '#6d8b86');
    g.fillStyle = grad; g.fillRect(0, 0, VW, VH);
    g.fillStyle = '#e9e0bd'; g.beginPath(); g.arc(262, 30, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1f2f3b';
    for (let i = -1; i < 12; i++) { const bx = Math.floor(i * 60 - cam * 0.35); g.fillRect(bx, 92, 12, 60); g.fillRect(bx + 6, 84, 14, 8); }
    g.fillStyle = '#2b3f4d';
    for (let i = -1; i < 8; i++) { const bx = Math.floor(i * 90 - cam * 0.6); g.fillRect(bx, 118, 30, 40); g.fillRect(bx + 4, 110, 10, 8); }
    const c0 = Math.max(0, Math.floor(cam / T)), c1 = Math.min(st.W - 1, Math.floor((cam + VW) / T) + 1);
    for (let r = 0; r < st.H; r++) for (let c = c0; c <= c1; c++) {
      const ch = st.m[r][c], x = c * T - cam, y = r * T;
      if (ch === '#') {
        g.fillStyle = '#5f7379'; g.fillRect(x, y, T, T);
        g.fillStyle = '#4c5e64'; g.fillRect(x, y + 6, T, 1); g.fillRect(x + (r % 2 ? 3 : 8), y, 1, 6);
        if (tileAt(c, r - 1) !== '#') { g.fillStyle = '#5e8a58'; g.fillRect(x, y, T, 2); }
      } else if (ch === '=') {
        g.fillStyle = '#8b9a7c'; g.fillRect(x, y, T, 4);
        g.fillStyle = '#6a7a5e'; g.fillRect(x, y + 4, T, T - 4);
        g.fillStyle = '#4e5c45'; g.fillRect(x, y + 4, T, 1);
      } else if (ch === 'x') {
        g.fillStyle = '#9a7a5a'; g.fillRect(x, y, T, T);
        g.fillStyle = '#4a3a2a'; g.fillRect(x + 2, y + 2, 1, 6); g.fillRect(x + 6, y + 5, 1, 6); g.fillRect(x + 3, y + 8, 4, 1);
      } else if (ch === 'W') {
        g.fillStyle = '#4b5b63'; g.fillRect(x, y, T, T);
        g.fillStyle = '#8fa3ab'; for (let k = 0; k < 4; k++) g.fillRect(x + k * 3, y, 1, T);
      } else if (ch === 'G' && r === 11) {
        const pulse = 0.5 + 0.5 * Math.sin(st.t * 4);
        g.fillStyle = 'rgba(95,242,210,' + (0.2 + 0.2 * pulse).toFixed(2) + ')';
        g.beginPath(); g.arc(x + 6, y + 12, 11, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#5ff2d2'; g.lineWidth = 2; g.stroke();
      }
    }
    st.gearList.forEach(function (gr) {
      if (gr.got) return;
      const gx = gr.c * T - cam + 6, gy = gr.r * T + 6;
      if (gx < -10 || gx > VW + 10) return;
      drawGear(g, gx, gy, st.t * 2 + gr.c);
    });
    st.beasts.forEach(function (b) {
      const x = Math.round(b.x - cam), y = Math.round(b.y);
      if (!b.alive) { if (b.dead <= 20) { g.fillStyle = '#9aa0a9'; g.fillRect(x, y + 4, 2, 2); g.fillRect(x + 7, y + 2 + (b.dead >> 2), 2, 2); } return; }
      g.fillStyle = '#6f747d'; g.fillRect(x, y + 2, b.w, b.h - 2);
      g.fillStyle = '#9aa0a9'; g.fillRect(x + 1, y, b.w - 2, 3);
      g.fillStyle = '#ff5a4e'; g.fillRect(x + 2, y + 4, 2, 2); g.fillRect(x + b.w - 4, y + 4, 2, 2);
    });
    drawPlayer(g, cam);
    st.parts.forEach(function (q) { g.fillStyle = q.color; g.fillRect(Math.round(q.x - cam), Math.round(q.y), 2, 2); });
    // HUD
    g.fillStyle = 'rgba(20,30,38,.65)'; g.fillRect(0, 0, VW, 12);
    g.fillStyle = '#e8e0c0'; g.font = '8px sans-serif'; g.textBaseline = 'top';
    const sec = Math.floor(st.t);
    g.fillText('命 ' + st.lives + '　齒輪 ' + st.gears + '/' + GEARS_NEED + '　' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'), 4, 2);
    if (st.msgT > 0) { g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#1d2b33'; g.fillText(st.msg, VW / 2 + 1, 23); g.fillStyle = '#fff'; g.fillText(st.msg, VW / 2, 22); g.textAlign = 'left'; }
    if (st.dead) { g.fillStyle = 'rgba(200,40,40,.18)'; g.fillRect(0, 0, VW, VH); }
    if (st.over) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, VW, VH);
      g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
      g.fillText(st.over === 'win' ? '抵達回收點！' : '遺跡把你吞了', VW / 2, VH / 2 - 14);
      g.font = '10px sans-serif'; g.fillText('齒輪 ' + st.gears + '　用時 ' + st.t.toFixed(1) + ' 秒', VW / 2, VH / 2 + 6); g.textAlign = 'left';
    }
  }

  function currentInput() {
    return { left: !!(keys.left || touch.left), right: !!(keys.right || touch.right), jump: !!(keys.jump || touch.jump), dash: !!(keys.dash || touch.dash) };
  }
  function loop(ts) {
    if (!st) return;
    if (!last) last = ts;
    acc += Math.min(100, ts - last); last = ts;
    while (acc >= STEP * 1000) { stepGame(currentInput()); acc -= STEP * 1000; if (st.over) break; }
    draw();
    if (st.over && !endTimer) {
      const r = { win: st.won, gears: st.gears, time: st.t };
      endTimer = setTimeout(function () { const cb = onDone; stop(); if (cb) cb(r); }, END_DELAY);
    }
    raf = requestAnimationFrame(loop);
  }

  function onKey(e, down) {
    const action = KEYMAP[e.code];
    if (!action) return;
    keys[action] = down;
    e.preventDefault();
  }
  function onKeyDown(e) { if (host && host.offsetParent !== null) onKey(e, true); }
  function onKeyUp(e) { if (host) onKey(e, false); }

  function start(el, done) {
    stop();
    host = el; onDone = done; host.innerHTML = '';
    cvs = document.createElement('canvas'); cvs.width = VW; cvs.height = VH; cvs.className = 'platCanvas';
    ctx = cvs.getContext('2d'); ctx.imageSmoothingEnabled = false;
    host.appendChild(cvs);
    const pad = document.createElement('div'); pad.className = 'platPad';
    pad.innerHTML = '<button type="button" data-k="left" aria-label="左">◀</button><button type="button" data-k="jump" aria-label="跳">跳</button><button type="button" data-k="dash" aria-label="衝刺">衝</button><button type="button" data-k="right" aria-label="右">▶</button>';
    host.appendChild(pad);
    Array.prototype.forEach.call(pad.querySelectorAll('button'), function (b) {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); touch[k] = true; });
      const up = function () { touch[k] = false; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    });
    keys = {}; touch = {};
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    loadLevel(LIVES, 0); last = 0; acc = 0; raf = requestAnimationFrame(loop);
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; st = null; onDone = null;
    clearTimeout(endTimer); endTimer = 0;
    window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
    keys = {}; touch = {};
    if (host) host.innerHTML = '';
  }
  function state() { return st ? { lives: st.lives, gears: st.gears, over: st.over, t: st.t, x: st.p.x, y: st.p.y, beasts: st.beasts.filter(function (b) { return b.alive; }).map(function (b) { return [b.x, b.y]; }) } : null; }

  root.RR = root.RR || {};
  root.RR.Plat = { start: start, stop: stop, state: state };
})(typeof window !== 'undefined' ? window : this);
