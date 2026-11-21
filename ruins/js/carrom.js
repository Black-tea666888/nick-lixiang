/* 康樂球（桌上撞擊，克朗棋）：純物理與規則，不碰畫面。
 * 正方形木板 400×400，四角有洞。16 顆棋子（紅、黑各 8）放在中央，兩人各自撞擊己方底線上的射子。
 * 規則：
 *   - 打進己方顏色棋子：得 1 分，可再打一次。
 *   - 打進對方顏色棋子：該子放回中央，換對方。
 *   - 射子落洞：犯規，換對方。
 *   - 沒有打進任何棋子：換對方。
 *   - 先打完己方 8 顆者獲勝；棋子打完時分數多者勝。
 * shoot() 回傳整段幀資料供畫面播放，結果同時寫回狀態。 */
(function (root) {
  'use strict';
  const W = 400, H = 400, PIECE_R = 11, STRIKER_R = 15, POCKET_R = 22;
  const FRICTION = 0.42, WALL_E = 0.8, HIT_E = 0.9, STOP_V = 4, MAX_V = 1000, DT = 1 / 120, MAX_T = 30;
  const POCKETS = [[0, 0], [W, 0], [0, H], [W, H]];
  const BASE_Y = { 0: H - 40, 1: 40 };   // 0：紅（下方），1：黑（上方）
  const CENTER = [W / 2, H / 2];

  function newGame() {
    const pieces = [];
    const add = function (x, y) {
      pieces.push({ x: x, y: y, c: pieces.length % 2 === 0 ? 'r' : 'b', alive: true, vx: 0, vy: 0 });
    };
    add(CENTER[0], CENTER[1]);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; add(CENTER[0] + Math.cos(a) * 26, CENTER[1] + Math.sin(a) * 26); }
    for (let i = 0; i < 9; i++) { const a = i * 2 * Math.PI / 9 + 0.2; add(CENTER[0] + Math.cos(a) * 54, CENTER[1] + Math.sin(a) * 54); }
    return { pieces: pieces, turn: 0, score: [0, 0], winner: null, msg: '' };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** 射子位置 x（60～340）、角度（弧度，0 為正前方）、力道 0～1；回傳 {state, frames} */
  function shoot(state, sx, angle, power) {
    if (state.winner !== null) return { state: state, frames: [] };
    const turn = state.turn, dirY = turn === 0 ? -1 : 1;
    const bodies = state.pieces.map(function (p) { return { x: p.x, y: p.y, vx: 0, vy: 0, r: PIECE_R, c: p.c, alive: p.alive, ref: p }; });
    const striker = { x: clamp(sx, 60, W - 60), y: BASE_Y[turn], vx: 0, vy: 0, r: STRIKER_R, c: 's', alive: true };
    const v = clamp(power, 0, 1) * MAX_V;
    striker.vx = Math.sin(angle) * v; striker.vy = dirY * Math.cos(angle) * v;
    bodies.push(striker);
    const pocketed = [];
    const frames = [];
    let t = 0, step = 0;
    while (t < MAX_T) {
      for (let k = 0; k < bodies.length; k++) {
        const b = bodies[k];
        if (!b.alive) continue;
        b.x += b.vx * DT; b.y += b.vy * DT;
        const decay = Math.pow(FRICTION, DT); b.vx *= decay; b.vy *= decay;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * WALL_E; }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * WALL_E; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * WALL_E; }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * WALL_E; }
        for (let q = 0; q < POCKETS.length; q++) {
          const dx = b.x - POCKETS[q][0], dy = b.y - POCKETS[q][1];
          if (dx * dx + dy * dy < POCKET_R * POCKET_R) { b.alive = false; pocketed.push(b.c); break; }
        }
      }
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const o = bodies[j];
          if (!o.alive) continue;
          const dx = o.x - a.x, dy = o.y - a.y, d2 = dx * dx + dy * dy, minD = a.r + o.r;
          if (d2 >= minD * minD || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const overlap = minD - d;
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; o.x += nx * overlap / 2; o.y += ny * overlap / 2;
          const rv = (o.vx - a.vx) * nx + (o.vy - a.vy) * ny;
          if (rv < 0) {
            const imp = -(1 + HIT_E) * rv / 2;
            a.vx -= imp * nx; a.vy -= imp * ny; o.vx += imp * nx; o.vy += imp * ny;
          }
        }
      }
      t += DT; step++;
      if (step % 2 === 0) frames.push(bodies.filter(function (b) { return b.alive; }).map(function (b) { return { x: b.x, y: b.y, c: b.c }; }));
      const moving = bodies.some(function (b) { return b.alive && Math.hypot(b.vx, b.vy) > STOP_V; });
      if (!moving) break;
    }
    // 寫回棋子狀態
    const next = {
      pieces: state.pieces.map(function (p) { return { x: p.x, y: p.y, c: p.c, alive: p.alive, vx: 0, vy: 0 }; }),
      turn: turn, score: state.score.slice(), winner: null, msg: ''
    };
    bodies.forEach(function (b) { if (b.ref) { b.ref.x = b.x; b.ref.y = b.y; b.ref.alive = b.alive; } });
    const mine = turn === 0 ? 'r' : 'b', theirs = turn === 0 ? 'b' : 'r';
    let foul = pocketed.indexOf('s') >= 0, switchTurn = foul, got = 0, gotOpp = false;
    bodies.forEach(function (b) {
      if (!b.ref || b.alive) return;
      if (b.c === mine) { next.score[turn]++; got++; b.ref.alive = false; }
      else if (b.c === theirs) {
        gotOpp = true; switchTurn = true;
        b.ref.alive = true; b.ref.x = CENTER[0]; b.ref.y = CENTER[1]; b.ref.vx = 0; b.ref.vy = 0;
      }
    });
    if (got === 0) switchTurn = true;
    next.pieces = bodies.filter(function (b) { return b.ref; }).map(function (b) { return { x: b.ref.x, y: b.ref.y, c: b.c, alive: b.ref.alive, vx: 0, vy: 0 }; });
    if (next.score[turn] >= 8) { next.winner = turn; next.msg = (turn === 0 ? '紅方' : '黑方') + '先打完己方 8 顆，獲勝！'; }
    else if (!next.pieces.some(function (p) { return p.alive; })) {
      next.winner = next.score[0] === next.score[1] ? 'draw' : (next.score[0] > next.score[1] ? 0 : 1);
      next.msg = '棋子打完，' + (next.winner === 'draw' ? '平手。' : (next.winner === 0 ? '紅方' : '黑方') + '分數較多，獲勝！');
    } else {
      if (foul) next.msg = '射子落洞，犯規。';
      else if (gotOpp) next.msg = '打進對方棋子，放回中央。';
      else if (got) next.msg = '打進 ' + got + ' 顆，可再打一次。';
      else next.msg = '沒有打進棋子。';
      next.turn = switchTurn ? 1 - turn : turn;
    }
    return { state: next, frames: frames, pocketed: pocketed };
  }

  const api = { W: W, H: H, PIECE_R: PIECE_R, STRIKER_R: STRIKER_R, POCKET_R: POCKET_R, POCKETS: POCKETS, BASE_Y: BASE_Y, newGame: newGame, shoot: shoot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Carrom = api; }
})(typeof window !== 'undefined' ? window : globalThis);
