/* 彈珠台：純物理與結算，不碰畫面。
 * 球場 300×400。釘子交錯排列，球從上方發射，落到底部五個袋子之一。
 * sim() 回傳整段軌跡，畫面只負責播放，方便測試。 */
(function (root) {
  'use strict';
  const W = 300, H = 400, PIN_R = 4, BALL_R = 4, G = 900, DT = 1 / 120, E = 0.55, MAX_T = 20;
  const PAYOUT = [0, 1, 3, 1, 0];   // 五個袋子回收的顆數（每發射一顆需花一顆），中間為大獎
  const POCKET_W = W / PAYOUT.length;

  function pins() {
    const out = [];
    for (let r = 0; r < 8; r++) {
      const y = 90 + r * 36;
      if (r % 2 === 0) for (let i = 0; i < 5; i++) out.push({ x: 30 + i * 60, y: y });
      else for (let i = 0; i < 4; i++) out.push({ x: 60 + i * 60, y: y });
    }
    return out;
  }

  /** 發射一顆球。angle：0 為正上方，正值向右偏（弧度，約 ±0.45）；power：0～1 */
  function sim(angle, power, rng) {
    const P = pins();
    const speed = 260 + Math.max(0, Math.min(1, power)) * 320;
    let x = W / 2, y = 14;
    let vx = Math.sin(angle) * speed, vy = Math.cos(angle) * speed;
    const path = [{ x: x, y: y }];
    let t = 0;
    while (t < MAX_T) {
      vy += G * DT;
      x += vx * DT; y += vy * DT; t += DT;
      // 牆
      if (x < BALL_R) { x = BALL_R; vx = Math.abs(vx) * E; }
      if (x > W - BALL_R) { x = W - BALL_R; vx = -Math.abs(vx) * E; }
      // 釘子
      for (let k = 0; k < P.length; k++) {
        const dx = x - P[k].x, dy = y - P[k].y, d2 = dx * dx + dy * dy, minD = PIN_R + BALL_R;
        if (d2 < minD * minD && d2 > 0) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          x = P[k].x + nx * minD; y = P[k].y + ny * minD;
          const vn = vx * nx + vy * ny;
          if (vn < 0) {
            vx -= (1 + E) * vn * nx; vy -= (1 + E) * vn * ny;
            // 些微隨機，讓結果有變化
            vx += (rng() - 0.5) * 30; vy += (rng() - 0.5) * 10;
          }
        }
      }
      if (y > H - 14) break;
      path.push({ x: x, y: y });
    }
    // 落到底部後，依 x 決定袋子
    y = H - 10;
    path.push({ x: x, y: y });
    const pocket = Math.max(0, Math.min(PAYOUT.length - 1, Math.floor(x / POCKET_W)));
    return { path: path, pocket: pocket, payout: PAYOUT[pocket], jackpot: pocket === Math.floor(PAYOUT.length / 2) };
  }

  const api = { W: W, H: H, PIN_R: PIN_R, BALL_R: BALL_R, PAYOUT: PAYOUT, pins: pins, sim: sim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Pachinko = api; }
})(typeof window !== 'undefined' ? window : globalThis);
