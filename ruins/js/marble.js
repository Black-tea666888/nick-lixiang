/* 彈珠（休閒模式，仿怪物彈珠）：在下方拖曳瞄準、放開發射彈珠，彈珠反彈打怪物方塊。
   每回合發 5 顆；所有彈珠落回後，方塊下降一格、上方補新的一排。撐過 15 回合即過關。 */
(function (root) {
  'use strict';
  const W = 320, H = 480, COLS = 7, CW = 44, TOP = 40, RH = 36, LOSE_ROW = 10, ROUNDS = 15;
  const LX = 160, LY = 446, SHOTS = 5, SPEED = 5.5, RAD = 3.5, FIRE_GAP = 6, MAXR = 10;
  let st = null, raf = 0, last = 0, acc = 0, host = null, cvs = null, ctx = null, onDone = null, endTimer = 0;
  let pointer = null, dragging = false;

  function hpFor(round) { return 1 + Math.floor(round / 2) + (Math.random() < 0.25 ? 1 : 0); }
  function newRow(r) {
    for (let c = 0; c < COLS; c++) if (Math.random() < 0.6) st.blocks.push({ c: c, r: r, hp: hpFor(st.round) });
  }
  function reset(round, gears) {
    st = { blocks: [], balls: [], fireLeft: 0, fireT: 0, round: round || 1, gears: gears || 0, shots: SHOTS,
      over: 0, won: false, msg: '', msgT: 0, parts: [], vx: 0, vy: 0, aimed: false };
    for (let r = 0; r < 3; r++) newRow(r);
    st.round = 1;
  }
  function say(t) { st.msg = t; st.msgT = 120; }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) st.parts.push({ x: x, y: y, vx: (Math.random() - 0.5) * 2.4, vy: (Math.random() - 0.5) * 2.4, life: 20 + Math.random() * 12, color: color });
  }
  function blockAt(c, r) { for (let i = 0; i < st.blocks.length; i++) { const b = st.blocks[i]; if (b.c === c && b.r === r) return b; } return null; }
  function bx(b) { return b.c * CW + 2; }
  function by(b) { return TOP + b.r * RH + 2; }

  function endTurn() {
    // 下降一格，補新的一排
    st.blocks.forEach(function (b) { b.r++; });
    st.round++;
    if (st.blocks.some(function (b) { return b.r >= LOSE_ROW; })) { st.over = 'lose'; return; }
    if (st.round > ROUNDS) { st.over = 'win'; st.won = true; return; }
    newRow(0);
    st.shots = SHOTS;
    say('第 ' + st.round + ' 回合');
  }

  function stepBall(ball) {
    for (let k = 0; k < 2; k++) {
      ball.x += ball.vx / 2; ball.y += ball.vy / 2;
      if (ball.x < RAD) { ball.x = RAD; ball.vx = Math.abs(ball.vx); }
      if (ball.x > W - RAD) { ball.x = W - RAD; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < RAD) { ball.y = RAD; ball.vy = Math.abs(ball.vy); }
      for (let i = 0; i < st.blocks.length; i++) {
        const b = st.blocks[i], rx = bx(b), ry = by(b), rw = CW - 4, rh = RH - 4;
        const nx = Math.max(rx, Math.min(ball.x, rx + rw)), ny = Math.max(ry, Math.min(ball.y, ry + rh));
        const dx = ball.x - nx, dy = ball.y - ny;
        if (dx * dx + dy * dy < RAD * RAD) {
          if (Math.abs(dx) > Math.abs(dy)) ball.vx = dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
          else ball.vy = dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
          b.hp--;
          burst(ball.x, ball.y, '#ffe27a', 3);
          if (b.hp <= 0) { st.blocks.splice(i, 1); st.gears++; burst(rx + rw / 2, ry + rh / 2, '#ff8a7a', 8); }
          break;
        }
      }
    }
  }

  function step() {
    if (st.over) return;
    st.parts = st.parts.filter(function (q) { q.x += q.vx; q.y += q.vy; q.life--; return q.life > 0; });
    if (st.msgT > 0) st.msgT--;
    if (st.fireLeft > 0) {
      st.fireT--;
      if (st.fireT <= 0) { st.balls.push({ x: LX, y: LY, vx: st.vx, vy: st.vy }); st.fireLeft--; st.fireT = FIRE_GAP; }
    }
    st.balls.forEach(stepBall);
    st.balls = st.balls.filter(function (q) { return q.y < LY + 14; });
    if (st.fireLeft === 0 && st.balls.length === 0 && st.aimed) { st.aimed = false; endTurn(); }
  }

  function aimVec() {
    if (!pointer) return null;
    const dx = pointer.x - LX, dy = pointer.y - LY;
    if (dy > -12) return null;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }

  function draw() {
    const g = ctx;
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#1d2f44'); grad.addColorStop(1, '#3d5a6e');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8e0c0'; g.font = '10px sans-serif'; g.textBaseline = 'top';
    g.fillText('回合 ' + st.round + '/' + ROUNDS + '　齒輪 ' + st.gears, 6, 6);
    g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(0, LY + 10, W, 2);
    st.blocks.forEach(function (b) {
      const x = bx(b), y = by(b), w = CW - 4, h = RH - 4;
      g.fillStyle = b.hp <= 2 ? '#8fb6a6' : (b.hp <= 5 ? '#c9a24b' : '#ff7a6b');
      g.fillRect(x, y, w, h);
      g.fillStyle = '#1d2b33'; g.fillRect(x, y + h - 3, w, 3);
      g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(b.hp), x + w / 2, y + h / 2 - 1); g.textAlign = 'left'; g.textBaseline = 'top';
    });
    const av = aimVec();
    if (av && !st.aimed && st.fireLeft === 0) {
      g.fillStyle = 'rgba(255,255,255,.7)';
      for (let i = 1; i <= 8; i++) g.fillRect(LX + av.x * i * 10 - 1, LY + av.y * i * 10 - 1, 2, 2);
    }
    st.balls.forEach(function (q) { g.fillStyle = '#f4fff9'; g.beginPath(); g.arc(q.x, q.y, RAD, 0, Math.PI * 2); g.fill(); });
    st.parts.forEach(function (q) { g.fillStyle = q.color; g.fillRect(q.x, q.y, 2, 2); });
    // 撿荒者（發射台）
    g.fillStyle = '#2bb3a3'; g.beginPath(); g.arc(LX, LY, 11, Math.PI, 0); g.fill();
    g.fillStyle = '#6b5a43'; g.fillRect(LX - 8, LY, 16, 9);
    g.fillStyle = '#f2d7b5'; g.fillRect(LX - 4, LY - 3, 8, 4);
    g.fillStyle = '#222'; g.fillRect(LX - 2, LY - 2, 1, 1); g.fillRect(LX + 1, LY - 2, 1, 1);
    g.fillStyle = '#e8e0c0'; g.font = '10px sans-serif'; g.textAlign = 'left';
    g.fillText('剩 ' + (st.aimed ? st.fireLeft + st.balls.length : st.shots) + ' 顆', LX + 16, LY + 2);
    if (st.msgT > 0) { g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(st.msg, W / 2, 24); g.textAlign = 'left'; }
    if (st.over) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center';
      g.fillText(st.over === 'win' ? '撐住了！' : '被怪物吞了', W / 2, H / 2 - 14);
      g.font = '11px sans-serif'; g.fillText('齒輪 ' + st.gears + '　回合 ' + Math.min(st.round, ROUNDS), W / 2, H / 2 + 8); g.textAlign = 'left';
    }
  }

  function toCanvas(e) {
    const r = cvs.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  function onDown(e) {
    if (!st || st.over || st.fireLeft > 0 || st.balls.length > 0) return;
    dragging = true; pointer = toCanvas(e); cvs.setPointerCapture && cvs.setPointerCapture(e.pointerId); e.preventDefault();
  }
  function onMove(e) { if (dragging) { pointer = toCanvas(e); e.preventDefault(); } }
  function onUp(e) {
    if (!dragging) return;
    dragging = false; const av = aimVec(); pointer = null;
    if (!av || st.shots <= 0) return;
    st.vx = av.x * SPEED; st.vy = av.y * SPEED;
    st.shots = 0; st.fireLeft = SHOTS; st.fireT = 0; st.aimed = true;
  }

  function loop(ts) {
    if (!st) return;
    if (!last) last = ts;
    acc += Math.min(100, ts - last); last = ts;
    while (acc >= 1000 / 60) { step(); acc -= 1000 / 60; if (st.over) break; }
    draw();
    if (st.over && !endTimer) {
      const r = { win: st.won, gears: st.gears, round: Math.min(st.round, ROUNDS) };
      endTimer = setTimeout(function () { const cb = onDone; stop(); if (cb) cb(r); }, 1500);
    }
    raf = requestAnimationFrame(loop);
  }

  function start(el, done) {
    stop();
    host = el; onDone = done; host.innerHTML = '';
    cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H; cvs.className = 'platCanvas marbleCanvas';
    ctx = cvs.getContext('2d');
    host.appendChild(cvs);
    cvs.addEventListener('pointerdown', onDown);
    cvs.addEventListener('pointermove', onMove);
    cvs.addEventListener('pointerup', onUp);
    cvs.addEventListener('pointercancel', onUp);
    reset(1, 0);
    last = 0; acc = 0; raf = requestAnimationFrame(loop);
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; st = null; onDone = null;
    clearTimeout(endTimer); endTimer = 0; dragging = false; pointer = null;
    if (host) host.innerHTML = '';
  }
  function state() { return st ? { round: st.round, gears: st.gears, over: st.over, balls: st.balls.length, blocks: st.blocks.length } : null; }

  root.RR = root.RR || {};
  root.RR.Marble = { start: start, stop: stop, state: state };
})(typeof window !== 'undefined' ? window : this);
