/* 遊戲核心（房主端權威模擬）。純邏輯、不碰 DOM，可在 Node 測試。 */
(function (root) {
'use strict';

/* 地圖：# 牆、. 地板、S 回收車（起點）、M 怪物出生點（每張 3 個） */
const MAPS = [
  { name: '廢棄設施', theme: { wall: '#5a5f58', floor: '#3a3d3f', ceil: '#232527', fog: 0.075, amb: 0x4a5568 }, rows: [
    '#####################',
    '#S..#.....#.....#..M#',
    '#...#.###.#.###.#.#.#',
    '#.....#...#...#...#.#',
    '###.###.#####.#####.#',
    '#...#.........#.....#',
    '#.###.#######.#.###.#',
    '#.....#..M..#...#...#',
    '#.#####.###.#####.###',
    '#...#.....#.....#...#',
    '###.#####.#####.#.#.#',
    '#.....#.......#...#.#',
    '#.###.#.#####.#####.#',
    '#...#...#..........M#',
    '#####################'
  ] },
  { name: '大倉庫', theme: { wall: '#6b5a48', floor: '#4a4038', ceil: '#2a2420', fog: 0.06, amb: 0x5a5048 }, rows: [
    '#####################',
    '#S........#.........#',
    '#.........#.##.##.#.#',
    '#..##.##..#.........#',
    '#.........#.##.##.#.#',
    '#..##.##............#',
    '#.........#.##.##.#.#',
    '####.######....M....#',
    '#.........#.##.##.#.#',
    '#.##.##.#.#.........#',
    '#.........####.######',
    '#.##.##.#...........#',
    '#.........#.##.##.#.#',
    '#M..........#......M#',
    '#####################'
  ] },
  { name: '地下水道', theme: { wall: '#3f5a58', floor: '#2c3a3a', ceil: '#1c2626', fog: 0.09, amb: 0x3a5560 }, rows: [
    '#########################',
    '#S..#.......#.......#...#',
    '#.#.#.#####.#.#####.#.#.#',
    '#.#...#...#...#...#...#.#',
    '#.#####.#.#####.#.#####.#',
    '#.......#...M...#.......#',
    '#.#####.#########.#####.#',
    '#.#...#...........#...#.#',
    '#.#.#.###.#####.###.#.#.#',
    '#...#.....#...#.....#...#',
    '###.#######.#.#######.###',
    '#...#.......#.......#...#',
    '#.###.#####.#.#####.###.#',
    '#.....#...#...#...#.....#',
    '#.#####.#.#####.#.#####.#',
    '#M......#.......#......M#',
    '#########################'
  ] }
];
const CS = 4, WH = 3.6;
let MAP = MAPS[0].rows, ROWS = MAP.length, COLS = MAP[0].length, mapIndex = -1;
let startCell = [1, 1], floorCells = [], VAN = [6, 6], MONSTER_CELLS = [];
const BAG_MAX = 3, DAY_TIME = 240, MAX_PLAYERS = 4;
const KINDS = [
  { n: '齒輪', lo: 25, hi: 45 }, { n: '電池', lo: 40, hi: 70 }, { n: '銅線圈', lo: 60, hi: 95 },
  { n: '舊收音機', lo: 35, hi: 60 }, { n: '玩具', lo: 20, hi: 40 }, { n: '馬達', lo: 50, hi: 80 },
  { n: '金條', lo: 100, hi: 140 }, { n: '燈泡', lo: 30, hi: 50 }, { n: '電路板', lo: 45, hi: 70 },
  { n: '儀表', lo: 55, hi: 85 }, { n: '鐵罐', lo: 20, hi: 40 }
];

const CHARS = ['回收員', '機器人', '太空人', '貓貓', '南瓜頭', '紙箱人'];
const WEAPONS = ['鐵管', '扳手', '球棒', '平底鍋', '雨傘', '鹹魚'];
const pick = (v, n) => { v = Math.floor(+v); return v >= 0 && v < n ? v : 0; };

const isWall = (c, r) => r < 0 || c < 0 || r >= ROWS || c >= COLS || MAP[r][c] === '#';
const cellOf = (x, z) => [Math.floor(x / CS), Math.floor(z / CS)];
const center = (c, r) => [c * CS + CS / 2, r * CS + CS / 2];

function blocked(x, z, rad) {
  return isWall(Math.floor((x - rad) / CS), Math.floor((z - rad) / CS)) ||
         isWall(Math.floor((x + rad) / CS), Math.floor((z - rad) / CS)) ||
         isWall(Math.floor((x - rad) / CS), Math.floor((z + rad) / CS)) ||
         isWall(Math.floor((x + rad) / CS), Math.floor((z + rad) / CS));
}
function los(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isWall(Math.floor((x0 + (x1 - x0) * t) / CS), Math.floor((z0 + (z1 - z0) * t) / CS))) return false;
  }
  return true;
}
function bfs(sc, sr, gc, gr) {
  if (isWall(sc, sr) || isWall(gc, gr)) return null;
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const start = sr * COLS + sc, goal = gr * COLS + gc;
  const q = [start]; prev[start] = start;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    if (cur === goal) break;
    const c = cur % COLS, r = (cur - c) / COLS;
    const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
    for (let k = 0; k < 4; k++) {
      const nc = nb[k][0], nr = nb[k][1];
      if (isWall(nc, nr)) continue;
      const id = nr * COLS + nc;
      if (prev[id] !== -1) continue;
      prev[id] = cur; q.push(id);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let cur = goal; ; cur = prev[cur]) {
    path.push([cur % COLS, Math.floor(cur / COLS)]);
    if (cur === start) break;
  }
  return path.reverse();
}

const SPAWN_OFF = [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
const r2 = (v) => Math.round(v * 100) / 100;

function quotaFor(day, n) { return 200 + 100 * day + 120 * (n - 1); }

function Sim(rng) {
  this.rng = rng || Math.random;
  this.players = [];
  this.phase = 'lobby';
  this.day = 1; this.money = 0; this.quota = 0; this.time = 0;
  this.items = []; this.monsters = []; this.events = [];
  this.pvp = true;   // 互相傷害（房主可在大廳開關）
  this.map = 0;      // 地圖編號（房主可在大廳選）
}
Sim.prototype.player = function (id) {
  for (let i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
  return null;
};
Sim.prototype.addPlayer = function (id, name, look) {
  if (this.player(id)) return this.player(id);
  if (this.players.length >= MAX_PLAYERS) return null;
  let slot = 0;
  while (this.players.some(function (p) { return p.slot === slot; })) slot++;
  look = look || {};
  const p = { id: id, name: String(name || '玩家').slice(0, 12), slot: slot, c: pick(look.c, CHARS.length), w: pick(look.w, WEAPONS.length), x: VAN[0], z: VAN[1], yaw: 0,
    run: false, loud: false, spk: false, alive: true, bag: [], hp: 100, atkCd: 0, hurtT: 99, earned: 0, kills: 0 };
  this.players.push(p);
  return p;
};
Sim.prototype.removePlayer = function (id) {
  const p = this.player(id);
  if (!p) return;
  if (this.phase === 'play') this._dropBag(p);
  this.players = this.players.filter(function (q) { return q.id !== id; });
  if (this.phase === 'play' && !this.players.some(function (q) { return q.alive; })) this._end(false, 'dead');
};
Sim.prototype.roster = function () {
  return this.players.map(function (p) { return { id: p.id, name: p.name, slot: p.slot, c: p.c, w: p.w }; });
};

Sim.prototype.startDay = function (day) {
  this.map = setMap(this.map);
  const self = this, n = Math.max(1, this.players.length);
  this.day = day; this.phase = 'play'; this.money = 0; this.time = DAY_TIME;
  this.quota = quotaFor(day, n); this.events = [];
  // 物品：隨機放在離起點有段距離的格子
  const cands = floorCells.filter(function (c) {
    if (Math.abs(c[0] - startCell[0]) + Math.abs(c[1] - startCell[1]) < 4) return false;
    return !MONSTER_CELLS.some(function (m) { return m[0] === c[0] && m[1] === c[1]; });
  });
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(this.rng() * (i + 1)), t = cands[i]; cands[i] = cands[j]; cands[j] = t;
  }
  const count = Math.min(cands.length, Math.round(floorCells.length / 12) + 2 * n + Math.min(day, 6));
  this.items = [];
  for (let i = 0; i < count; i++) {
    const p = center(cands[i][0], cands[i][1]);
    const kind = Math.floor(this.rng() * KINDS.length), k = KINDS[kind];
    this.items.push({ x: r2(p[0] + (this.rng() - 0.5) * 2), z: r2(p[1] + (this.rng() - 0.5) * 2), kind: kind,
      value: Math.round((k.lo + this.rng() * (k.hi - k.lo)) / 5) * 5, taken: false });
  }
  // 怪物：第 3 天起 2 隻，第 6 天起 3 隻
  const mc = Math.min(MONSTER_CELLS.length, day >= 6 ? 3 : day >= 3 ? 2 : 1);
  this.monsters = [];
  for (let i = 0; i < mc; i++) {
    const p = center(MONSTER_CELLS[i][0], MONSTER_CELLS[i][1]);
    this.monsters.push({ x: p[0], z: p[1], rot: 0, state: 'wander', path: null, goal: null, lost: 0, repath: 0, cool: 0, target: null });
  }
  this.chaseSpeed = Math.min(4.5 + 0.12 * (day - 1), 5.6);
  this.wanderSpeed = Math.min(2.1 + 0.05 * (day - 1), 2.8);
  this.players.forEach(function (p) {
    const o = SPAWN_OFF[p.slot % 4];
    p.alive = true; p.bag = []; p.x = VAN[0] + o[0]; p.z = VAN[1] + o[1]; p.yaw = -Math.PI * 0.75;
    p.run = p.loud = false; p.hp = 100; p.atkCd = 0; p.hurtT = 99;
    if (day === 1) { p.earned = 0; p.kills = 0; }
  });
  return self.dayInfo();
};
Sim.prototype.dayInfo = function () {
  const spawns = {};
  this.players.forEach(function (p) { spawns[p.id] = [p.x, p.z]; });
  return { t: 'day', map: this.map, day: this.day, quota: this.quota, time: this.time, monsters: this.monsters.length,
    items: this.items.map(function (i) { return [i.x, i.z, i.kind, i.value]; }), spawns: spawns };
};
Sim.prototype.toLobby = function () { this.phase = 'lobby'; this.day = 1; this.events = []; };

Sim.prototype.setInput = function (id, m) {
  const p = this.player(id);
  if (!p || !m) return;
  p.spk = !!m.spk;
  if (this.phase !== 'play' || !p.alive) return;
  const x = +m.x, z = +m.z, yaw = +m.yaw;
  if (isFinite(x) && isFinite(z) && !blocked(x, z, 0.3)) { p.x = x; p.z = z; }
  if (isFinite(yaw)) p.yaw = yaw;
  p.run = !!m.run; p.loud = !!m.loud;
};

Sim.prototype._dropBag = function (p) {
  if (!p.bag.length) return;
  const list = [];
  for (let k = 0; k < p.bag.length; k++) {
    const it = this.items[p.bag[k]];
    let x = p.x + (this.rng() - 0.5) * 1.2, z = p.z + (this.rng() - 0.5) * 1.2;
    if (blocked(x, z, 0.3)) { x = p.x; z = p.z; }
    it.x = r2(x); it.z = r2(z); it.taken = false; it.cool = 1.5;
    list.push([p.bag[k], it.x, it.z]);
  }
  p.bag = [];
  this.events.push({ t: 'drop', list: list });
};
Sim.prototype._end = function (win, why) {
  if (this.phase !== 'play') return;
  this.phase = win ? 'won' : 'lost';
  this.events.push({ t: 'end', win: win, why: why, day: this.day, money: this.money, quota: this.quota, time: Math.max(0, Math.ceil(this.time)),
    stats: this.players.map(function (p) { return { id: p.id, name: p.name, slot: p.slot, earned: p.earned, kills: p.kills, alive: p.alive }; }) });
};

/** 近戰攻擊：前方 2.4 公尺、約 110 度扇形內最近的玩家。兩下致死。 */
Sim.prototype.attack = function (id, yaw) {
  const a = this.player(id);
  if (!a || this.phase !== 'play' || !a.alive || a.atkCd > 0) return;
  if (isFinite(+yaw)) a.yaw = +yaw;
  a.atkCd = 0.65;
  this.events.push({ t: 'swing', id: id });
  if (!this.pvp) return;
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  let best = null, bd = 2.4;
  for (let i = 0; i < this.players.length; i++) {
    const p = this.players[i];
    if (p === a || !p.alive) continue;
    const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz);
    if (d > bd) continue;
    if (d > 0.3 && (dx * fx + dz * fz) / d < 0.57) continue;
    if (!los(a.x, a.z, p.x, p.z)) continue;
    best = p; bd = d;
  }
  if (!best) return;
  best.hp -= 50; best.hurtT = 0;
  this.events.push({ t: 'hit', id: best.id, by: id, hp: Math.max(0, best.hp) });
  if (best.hp <= 0) {
    best.alive = false; best.run = best.loud = false; a.kills++;
    this.events.push({ t: 'killed', id: best.id, by: id });
    this._dropBag(best);
  }
};

Sim.prototype._pickWander = function (m) {
  const mc = cellOf(m.x, m.z);
  for (let tries = 0; tries < 20; tries++) {
    const g = floorCells[Math.floor(this.rng() * floorCells.length)];
    if (Math.abs(g[0] - mc[0]) + Math.abs(g[1] - mc[1]) < 5) continue;
    const p = bfs(mc[0], mc[1], g[0], g[1]);
    if (p) { m.path = p; return; }
  }
  m.path = null;
};

Sim.prototype._monster = function (m, mi, dt, alive) {
  if (m.cool > 0) { m.cool -= dt; return; }
  let best = null, bd = 1e9, bestSees = false;
  for (let i = 0; i < alive.length; i++) {
    const p = alive[i], d = Math.hypot(p.x - m.x, p.z - m.z);
    const sees = d < 30 && los(m.x, m.z, p.x, p.z);
    const hears = (p.run && d < 22) || (p.loud && d < 18);
    if ((sees || hears) && d < bd) { best = p; bd = d; bestSees = sees; }
  }
  const mc = cellOf(m.x, m.z);
  if (best) {
    if (m.state !== 'chase') { m.state = 'chase'; m.repath = 0; this.events.push({ t: 'chase', id: best.id, mi: mi }); }
    m.lost = 0; m.target = best.id; m.goal = cellOf(best.x, best.z);
  } else if (m.state === 'chase') {
    m.lost += dt;
    const tp = this.player(m.target);
    if (m.lost < 1.5 && tp && tp.alive) m.goal = cellOf(tp.x, tp.z);
    if (m.lost > 5 || !m.goal) { m.state = 'wander'; m.path = null; }
  }

  let tx, tz, direct = false;
  if (m.state === 'chase') {
    m.repath -= dt;
    if (m.repath <= 0 || !m.path) { m.path = bfs(mc[0], mc[1], m.goal[0], m.goal[1]); m.repath = 0.3; }
    if (best && bestSees && bd < CS * 1.3) { tx = best.x; tz = best.z; direct = true; }
  } else if (!m.path || m.path.length <= 1) {
    this._pickWander(m);
  }
  if (!direct) {
    const p = m.path;
    if (p) { while (p.length > 1 && p[1][0] === mc[0] && p[1][1] === mc[1]) p.shift(); }
    const next = p ? (p[1] || p[0]) : mc;
    const cp = center(next[0], next[1]); tx = cp[0]; tz = cp[1];
    if (p && p.length <= 1 && Math.hypot(tx - m.x, tz - m.z) < 0.2) {
      if (m.state === 'chase' && !best) m.lost = Math.max(m.lost, 3.5);
      m.path = null;
    }
  }
  const ddx = tx - m.x, ddz = tz - m.z, dd = Math.hypot(ddx, ddz);
  const sp = m.state === 'chase' ? this.chaseSpeed : this.wanderSpeed;
  if (dd > 0.05) {
    const step = Math.min(dd, sp * dt), mx = ddx / dd * step, mz = ddz / dd * step;
    if (direct) {
      if (!blocked(m.x + mx, m.z, 0.4)) m.x += mx;
      if (!blocked(m.x, m.z + mz, 0.4)) m.z += mz;
    } else { m.x += mx; m.z += mz; }
    m.rot = Math.atan2(ddx, ddz);
  }
  for (let i = 0; i < alive.length; i++) {
    const p = alive[i];
    if (p.alive && Math.hypot(p.x - m.x, p.z - m.z) < 1.15) {
      p.alive = false; p.run = p.loud = false;
      this.events.push({ t: 'caught', id: p.id, x: r2(m.x), z: r2(m.z) });
      this._dropBag(p);
      m.state = 'wander'; m.path = null; m.cool = 3;
      break;
    }
  }
};

Sim.prototype.step = function (dt) {
  if (this.phase !== 'play') return;
  dt = Math.min(dt, 0.1);
  this.time -= dt;
  const alive = this.players.filter(function (p) { return p.alive; });
  for (let k = 0; k < alive.length; k++) {
    const p = alive[k];
    if (p.atkCd > 0) p.atkCd -= dt;
    p.hurtT += dt;
    if (p.hurtT > 5 && p.hp < 100) p.hp = Math.min(100, p.hp + 6 * dt);   // 5 秒沒受傷後慢慢回血
  }
  // 撿取與賣出
  for (let i = 0; i < this.items.length; i++) {
    const it = this.items[i];
    if (it.cool > 0) { it.cool -= dt; continue; }
    if (it.taken) continue;
    for (let k = 0; k < alive.length; k++) {
      const p = alive[k];
      if (p.bag.length < BAG_MAX && Math.hypot(it.x - p.x, it.z - p.z) < 1.5) {
        it.taken = true; p.bag.push(i);
        this.events.push({ t: 'pickup', id: p.id, i: i });
        break;
      }
    }
  }
  for (let k = 0; k < alive.length; k++) {
    const p = alive[k];
    if (p.bag.length && Math.hypot(VAN[0] - p.x, VAN[1] - p.z) < 1.9) {
      let sum = 0;
      for (let b = 0; b < p.bag.length; b++) sum += this.items[p.bag[b]].value;
      p.bag = []; this.money += sum; p.earned += sum;
      this.events.push({ t: 'sell', id: p.id, sum: sum });
    }
  }
  if (this.money >= this.quota) { this._end(true, 'quota'); return; }
  for (let i = 0; i < this.monsters.length; i++) this._monster(this.monsters[i], i, dt, alive);
  if (!this.players.some(function (p) { return p.alive; })) { this._end(false, 'dead'); return; }
  if (this.time <= 0) this._end(false, 'time');
};

Sim.prototype.snapshot = function () {
  let it = '';
  for (let i = 0; i < this.items.length; i++) it += this.items[i].taken ? '1' : '0';
  return { t: 's', ph: this.phase, day: this.day, money: this.money, quota: this.quota, time: Math.round(this.time * 10) / 10,
    p: this.players.map(function (p) {
      return [p.id, r2(p.x), r2(p.z), r2(p.yaw), p.alive ? 1 : 0, p.bag.length, (p.run ? 1 : 0) | (p.spk ? 2 : 0) | (p.loud ? 4 : 0), Math.round(p.hp)];
    }),
    m: this.monsters.map(function (m) { return [r2(m.x), r2(m.z), r2(m.rot), m.state === 'chase' ? 1 : 0]; }),
    it: it };
};

const api = { MAPS: MAPS, CS: CS, WH: WH, BAG_MAX: BAG_MAX, DAY_TIME: DAY_TIME, MAX_PLAYERS: MAX_PLAYERS,
  KINDS: KINDS, CHARS: CHARS, WEAPONS: WEAPONS, isWall: isWall, cellOf: cellOf, center: center, blocked: blocked, los: los, bfs: bfs,
  quotaFor: quotaFor, Sim: Sim, setMap: setMap };

/** 切換目前地圖（碰撞、視線、尋路都跟著換）。房主與每位玩家各自呼叫。 */
function setMap(i) {
  i = pick(i, MAPS.length);
  if (i === mapIndex) return i;
  mapIndex = i; MAP = MAPS[i].rows; ROWS = MAP.length; COLS = MAP[0].length;
  floorCells = []; MONSTER_CELLS = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = MAP[r][c];
    if (ch === '#') continue;
    floorCells.push([c, r]);
    if (ch === 'S') startCell = [c, r];
    if (ch === 'M') MONSTER_CELLS.push([c, r]);
  }
  // 離起點最遠的出生點先用
  MONSTER_CELLS.sort(function (a, b) { return (Math.abs(b[0] - startCell[0]) + Math.abs(b[1] - startCell[1])) - (Math.abs(a[0] - startCell[0]) + Math.abs(a[1] - startCell[1])); });
  VAN = center(startCell[0], startCell[1]);
  api.MAP = MAP; api.ROWS = ROWS; api.COLS = COLS; api.VAN = VAN; api.floorCells = floorCells; api.mapIndex = i;
  api.theme = MAPS[i].theme; api.mapName = MAPS[i].name; api.monsterCells = MONSTER_CELLS;
  return i;
}
setMap(0);
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { root.RR = root.RR || {}; root.RR.World = api; }
})(typeof window !== 'undefined' ? window : globalThis);
