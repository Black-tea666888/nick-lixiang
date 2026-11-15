/* 遊戲核心（房主端權威模擬）。純邏輯、不碰 DOM，可在 Node 測試。 */
(function (root) {
'use strict';

/* 地圖：# 牆、. 地板、S 回收車（起點）、M 怪物出生點（每張至少 3 個） */
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
  ] },
  { name: '海邊', theme: { wall: '#8f8166', floor: '#c2ae78', ceil: '#000000', fog: 0.012, amb: 0xfff4e0, open: true, sky: 0x8fd0f5, style: 'beach', wallH: 2.3, sun: 0.55, torch: 0.15 }, rows: [
    '#####################',
    '#S........#........M#',
    '#...................#',
    '#..##.....#....##...#',
    '#..#...........#....#',
    '#......##...........#',
    '#......#....##...#..#',
    '#....M......#....#..#',
    '#...........#.......#',
    '#..#....##......##..#',
    '#..##...#........#..#',
    '#...................#',
    '#.....#....##.......#',
    '#M....#....#........#',
    '#####################'
  ] },
  { name: '城市', theme: { wall: '#59616e', floor: '#3b3e44', ceil: '#000000', fog: 0.014, amb: 0xffe6c8, open: true, sky: 0xf2a56b, style: 'city', wallH: 3.6, sun: 0.5, torch: 0.5 }, rows: [
    '#####################',
    '#S..................#',
    '#.##.##.###.##.##.#.#',
    '#.##.##.###.##.##.#.#',
    '#...................#',
    '#.##.#..##.##.#.##..#',
    '#.##.#..##.##.#.##.M#',
    '#.........M.........#',
    '#.##.##.#.##.##.#.#.#',
    '#.##.##.#.##.##.#.#.#',
    '#...................#',
    '#.#.###.##.#.##.##..#',
    '#.#.###.##.#.##.##..#',
    '#M..................#',
    '#####################'
  ] },
  { name: '太空站', theme: { wall: '#66727f', floor: '#3f4854', ceil: '#000000', fog: 0.006, amb: 0xdde8ff, open: true, sky: 0x04060d, style: 'space', wallH: 3.0, sun: 0.45, torch: 1.0 }, rows: [
    '#####################',
    '#S....#.......#.....#',
    '#.....#.......#.....#',
    '#..#.....###.....#..#',
    '#..#.....#M#.....#..#',
    '#...................#',
    '###..##.......##..###',
    '#....#....#....#....#',
    '###..##.......##..###',
    '#...................#',
    '#..#.....#.#.....#..#',
    '#..#.....###.....#..#',
    '#.....#.......#.....#',
    '#M....#.......#....M#',
    '#####################'
  ] },
  { name: '辦公室', theme: { wall: '#b9c2c9', floor: '#5d6f84', ceil: '#cfd2cf', fog: 0.018, amb: 0xffffff, style: 'office', bright: 0.72, torch: 0.3 }, rows: [
    '#####################',
    '#S....#....#....#...#',
    '#.....#....#....#...#',
    '#.##.......#........#',
    '#.....#.........#.M.#',
    '###.###.##.###.######',
    '#...................#',
    '#.##.##.##.##.##.##.#',
    '#...................#',
    '###.####.###.###.####',
    '#.....#....#....#...#',
    '#..M..#.........#...#',
    '#..........#........#',
    '#.....#....#....#..M#',
    '#####################'
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

const CHARS = ['回收員', '機器人', '太空人', '貓貓', '南瓜頭', '紙箱人', '恐龍', '外星人'];
const COSTUMES = ['隊伍色', '迷彩', '霓虹', '黃金', '忍者', '雪白'];        // 服裝（純外觀）
const PETS = ['無', '小狗', '貓頭鷹', '小機器人', '史萊姆'];   // 寵物：小狗 速度+5%、貓頭鷹 怪物偵測距離+8 公尺、小機器人 賣出+10%、史萊姆 體力回復+20%
const WEAPONS = ['鐵管', '扳手', '球棒', '平底鍋', '雨傘', '鹹魚'];
const HATS = ['無', '安全帽', '頭燈', '天線', '光環', '皇冠'];   // 頭飾（純外觀）
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

let LOCKERS = [];
const SPAWN_OFF = [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
const r2 = (v) => Math.round(v * 100) / 100;

// 怪物種類（依序）：0 紅＝火（追逐較快）、1 藍＝冰（靠近減速）、2 綠＝毒（緩慢、靠近扣血）、3 紫＝暗影（追逐更快）
const KIND_CHASE = [1.15, 1, 1, 1.08];
const TT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function newTT() { return { cells: ['', '', '', '', '', '', '', '', ''], x: null, o: null, turn: 'X', over: null, winner: null, timer: 0 }; }
function quotaFor(day, n) { return 200 + 100 * day + 120 * (n - 1); }

function Sim(rng) {
  this.rng = rng || Math.random;
  this.players = [];
  this.phase = 'lobby'; this.smokes = [];
  this.day = 1; this.money = 0; this.quota = 0; this.time = 0;
  this.items = []; this.monsters = []; this.events = [];
  this.pvp = true;   // 互相傷害（房主可在大廳開關）
  this.map = 0;      // 地圖編號（房主可在大廳選）
  this.mode = 'coop'; // coop 回收模式／hunt 獵殺模式（用槍擊倒怪物）
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
  const p = { id: id, name: String(name || '玩家').slice(0, 12), slot: slot, c: pick(look.c, CHARS.length), w: pick(look.w, WEAPONS.length), h: pick(look.h, HATS.length), o: pick(look.o, COSTUMES.length), pet: pick(look.pet, PETS.length), x: VAN[0], z: VAN[1], yaw: 0,
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
  return this.players.map(function (p) { return { id: p.id, name: p.name, slot: p.slot, c: p.c, w: p.w, h: p.h || 0, o: p.o || 0, pet: p.pet || 0 }; });
};

Sim.prototype.startDay = function (day) {
  this.map = setMap(this.map);
  const self = this, n = Math.max(1, this.players.length);
  this.day = day; this.phase = 'play'; this.money = 0; this.time = DAY_TIME; this.pad = null;
  this.boardPos = this._spotAt(VAN[0], VAN[1], 2.5, 4) || [VAN[0] + 2.5, VAN[1]];
  this.tt = newTT();
  this.trophy = this._spotAt(VAN[0], VAN[1], 12, 25);   // 搶獎盃：地圖上一座獎盃，按住 E 3 秒的人拿走
  const hunt = this.mode === 'hunt';
  this.quota = hunt ? 50 * (5 + 2 * (day - 1) + 2 * (n - 1)) : quotaFor(day, n); this.events = [];   // 獵殺：每擊倒一隻 $50
  this.smokes = [];
  this.players.forEach(function (p) { p.skCd = 0; p.smCd = 0; p.shieldT = 0; p.hideT = 0; p.stealthT = 0; p.rallyT = 0; });   // 每天開始技能冷卻歸零
  // 物品：隨機放在離起點有段距離的格子
  const cands = floorCells.filter(function (c) {
    if (Math.abs(c[0] - startCell[0]) + Math.abs(c[1] - startCell[1]) < 4) return false;
    return !MONSTER_CELLS.some(function (m) { return m[0] === c[0] && m[1] === c[1]; });
  });
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(this.rng() * (i + 1)), t = cands[i]; cands[i] = cands[j]; cands[j] = t;
  }
  const count = hunt ? 0 : Math.min(cands.length, Math.round(floorCells.length / 12) + 2 * n + Math.min(day, 6));
  this.items = [];
  for (let i = 0; i < count; i++) {
    const p = center(cands[i][0], cands[i][1]);
    const kind = Math.floor(this.rng() * KINDS.length), k = KINDS[kind];
    this.items.push({ x: r2(p[0] + (this.rng() - 0.5) * 2), z: r2(p[1] + (this.rng() - 0.5) * 2), kind: kind,
      value: Math.round((k.lo + this.rng() * (k.hi - k.lo)) / 5) * 5, taken: false });
  }
  // 怪物：第 3 天起 2 隻，第 6 天起 3 隻
  const mc = hunt ? Math.min(4, 1 + day) : day >= 6 ? 4 : day >= 3 ? 2 : 1;
  this.monsters = [];
  for (let i = 0; i < mc; i++) {
    const mcell = MONSTER_CELLS[i] || floorCells[Math.floor(this.rng() * floorCells.length)];   // 地圖的怪物點不夠時，隨機放在地板上
    const p = center(mcell[0], mcell[1]);
    this.monsters.push({ x: p[0], z: p[1], rot: 0, state: 'wander', path: null, goal: null, lost: 0, repath: 0, cool: 0, target: null, hp: 100, dead: 0 });
  }
  if (hunt) this.trophy = null;
  this.chaseSpeed = Math.min(3.9 + 0.1 * (day - 1), 4.9);   // 跑步（9）一定甩得掉；走路（4.2）在後期甩不掉
  this.wanderSpeed = Math.min(2.1 + 0.05 * (day - 1), 2.8);
  this.players.forEach(function (p) {
    const o = SPAWN_OFF[p.slot % 4];
    p.alive = true; p.bag = []; p.x = VAN[0] + o[0]; p.z = VAN[1] + o[1]; p.yaw = -Math.PI * 0.75;
    p.run = p.loud = false; p.hp = 100; p.atkCd = 0; p.hurtT = 99;
    p.ammo = hunt ? 12 : 6; p.gunCd = 0; p.reload = 0;   // 回收模式每天 6 發（擊中讓怪物暈 2.5 秒）；獵殺模式彈匣 12 發、自動裝填
    if (day === 1) { p.earned = 0; p.kills = 0; p.mk = 0; }
  });
  return self.dayInfo();
};
Sim.prototype.dayInfo = function () {
  const spawns = {};
  this.players.forEach(function (p) { spawns[p.id] = [p.x, p.z]; });
  return { t: 'day', map: this.map, mode: this.mode, day: this.day, quota: this.quota, time: this.time, monsters: this.monsters.length,
    items: this.items.map(function (i) { return [i.x, i.z, i.kind, i.value]; }), spawns: spawns };
};
Sim.prototype.toLobby = function () { this.phase = 'lobby'; this.day = 1; this.events = []; };

Sim.prototype.setInput = function (id, m) {
  const p = this.player(id);
  if (!p || !m) return;
  p.spk = !!m.spk;
  p.rs = !!m.rs;   // 按住 E 救援
  if (this.phase !== 'play' || !p.alive) return;
  if (m.sm && (p.smCd || 0) <= 0) { p.smCd = 20; this.smokes.push({ x: p.x, z: p.z, t: 6 }); this.events.push({ t: 'smoke', id: p.id, x: p.x, z: p.z }); }   // 煙霧彈：冷卻 20 秒，不影響金額
  // 太空人技能「月光波」：7 公尺內怪物暫停 3 秒，冷卻 25 秒
  if (m.sk && (p.skCd || 0) <= 0) this._skill(p);
  if (typeof m.tt === 'number') this._ttMove(p, m.tt);
  const x = +m.x, z = +m.z, yaw = +m.yaw;
  if (isFinite(x) && isFinite(z) && !blocked(x, z, 0.3)) { p.x = x; p.z = z; }
  if (isFinite(yaw)) p.yaw = yaw;
  p.run = !!m.run; p.loud = !!m.loud; p.air = !!m.air;
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
    stats: this.players.map(function (p) { return { id: p.id, name: p.name, slot: p.slot, earned: p.earned, kills: p.kills, mk: p.mk || 0, alive: p.alive }; }) });
};

/** 開槍：沿面對方向的直線，打中最近、沒被牆擋住的怪物。回收模式＝暈 2.5 秒；獵殺模式＝扣 34 血，歸零擊倒並得 $50，3 秒後在遠處重生。 */
Sim.prototype.shoot = function (id, yaw) {
  const p = this.player(id);
  if (!p || this.phase !== 'play' || !p.alive || p.gunCd > 0 || p.reload > 0) return;
  if (!(p.ammo > 0)) { this.events.push({ t: 'noammo', id: id }); p.gunCd = 0.4; return; }
  if (isFinite(+yaw)) p.yaw = +yaw;
  const hunt = this.mode === 'hunt', fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  p.gunCd = 0.22; p.ammo--;
  if (hunt && p.ammo <= 0) p.reload = 1.4;
  let hit = -1, hd = 45;
  for (let i = 0; i < this.monsters.length; i++) {
    const m = this.monsters[i];
    if (m.dead > 0) continue;
    const dx = m.x - p.x, dz = m.z - p.z, along = dx * fx + dz * fz;
    if (along <= 0 || along > hd || Math.abs(dx * fz - dz * fx) > 0.8) continue;
    if (!los(p.x, p.z, m.x, m.z)) continue;
    hit = i; hd = along;
  }
  let hx, hz, kill = false;
  if (hit >= 0) {
    const m = this.monsters[hit]; hx = m.x; hz = m.z;
    if (hunt) {
      m.hp -= 34; m.cool = 0.25;
      if (m.hp <= 0) { kill = true; m.dead = 3; m.state = 'wander'; m.path = null; this.money += 50; p.earned += 50; p.mk = (p.mk || 0) + 1; }
      else { m.state = 'chase'; m.target = p.id; m.goal = cellOf(p.x, p.z); m.lost = 0; m.repath = 0; }
    } else m.cool = 2.5;
  } else {
    let d = 0; hx = p.x; hz = p.z;
    while (d < 45 && !isWall(Math.floor((p.x + fx * (d + 0.5)) / CS), Math.floor((p.z + fz * (d + 0.5)) / CS))) { d += 0.5; hx = p.x + fx * d; hz = p.z + fz * d; }
  }
  this.events.push({ t: 'shot', id: id, x: r2(p.x), z: r2(p.z), hx: r2(hx), hz: r2(hz), mi: hit, kill: kill, ammo: p.ammo });
};
// 獵殺模式：被擊倒的怪物在離玩家最遠的候選格重生
Sim.prototype._respawn = function (m) {
  let best = null, bd = -1;
  for (let k = 0; k < 14; k++) {
    const fc = floorCells[Math.floor(this.rng() * floorCells.length)], c = center(fc[0], fc[1]);
    let near = 1e9;
    this.players.forEach(function (p) { if (p.alive) near = Math.min(near, Math.hypot(p.x - c[0], p.z - c[1])); });
    if (near > bd) { bd = near; best = c; }
  }
  m.x = best[0]; m.z = best[1]; m.hp = 100; m.dead = 0; m.state = 'wander'; m.path = null; m.goal = null; m.cool = 0.5;
};

/** 近戰攻擊：前方 2.4 公尺、約 110 度扇形內最近的玩家。兩下致死。 */
Sim.prototype.attack = function (id, yaw) {
  const a = this.player(id);
  if (!a || this.phase !== 'play' || !a.alive || a.atkCd > 0) return;
  if (isFinite(+yaw)) a.yaw = +yaw;
  a.atkCd = a.c === 4 ? 0.49 : 0.65;   // 南瓜頭攻擊冷卻 -25%
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
  best.hp -= a.c === 1 ? 65 : 50; best.hurtT = 0;   // 機器人攻擊力 +30%
  this.events.push({ t: 'hit', id: best.id, by: id, hp: Math.max(0, best.hp) });
  if (best.hp <= 0) {
    best.alive = false; best.run = best.loud = false; a.kills++;
    this.events.push({ t: 'killed', id: best.id, by: id });
    this._dropBag(best);
  }
};

// 在離玩家 8～14 公尺的可走地板上找一格放傳送陣
// 角色技能：0 回收員「鼓舞」、1 機器人「護盾」、2 太空人「月光波」、3 貓貓「潛行」、4 南瓜頭「加血」、5 紙箱人「隱身」
Sim.prototype._skill = function (p) {
  const self = this;
  switch (p.c) {
    case 0: {
      const ids = [];
      this.players.forEach(function (q) { if (q.alive && Math.hypot(q.x - p.x, q.z - p.z) < 6) { q.rallyT = 5; ids.push(q.id); } });
      p.skCd = 25; this.events.push({ t: 'rally', id: p.id, ids: ids }); break;
    }
    case 1: p.shieldT = 4; p.skCd = 30; this.events.push({ t: 'shield', id: p.id }); break;
    case 2: {
      p.skCd = 25;
      this.monsters.forEach(function (mo) { if (Math.hypot(mo.x - p.x, mo.z - p.z) < 7) mo.cool = 3; });
      this.events.push({ t: 'moon', id: p.id, x: p.x, z: p.z }); break;
    }
    case 3: p.stealthT = 6; p.skCd = 25; this.events.push({ t: 'stealth', id: p.id }); break;
    case 4: p.hp = Math.min(100, p.hp + 35); p.skCd = 25; this.events.push({ t: 'heal', id: p.id, hp: Math.round(p.hp) }); break;
    case 5: p.hideT = 4; p.skCd = 30; this.events.push({ t: 'hide', id: p.id }); break;
    case 6: {   // 恐龍「咆哮」：6 公尺內怪物嚇呆 2.5 秒
      p.skCd = 22;
      this.monsters.forEach(function (mo) { if (!(mo.dead > 0) && Math.hypot(mo.x - p.x, mo.z - p.z) < 6) mo.cool = 2.5; });
      this.events.push({ t: 'roar', id: p.id, x: r2(p.x), z: r2(p.z) }); break;
    }
    case 7: p.skCd = 18; this.events.push({ t: 'blink', id: p.id }); break;   // 外星人「瞬移」：位置由該玩家自己的裝置往前移 6 公尺
  }
};

// 在 (cx, cz) 周圍 lo～hi 公尺的可走地板上隨機找一點
Sim.prototype._spotAt = function (cx, cz, lo, hi) {
  const pool = [];
  for (let i = 0; i < floorCells.length; i++) {
    const c = center(floorCells[i][0], floorCells[i][1]);
    const d = Math.hypot(c[0] - cx, c[1] - cz);
    if (d >= lo && d <= hi && !blocked(c[0], c[1], 0.5)) pool.push(c);
  }
  if (!pool.length) return null;
  return pool[Math.floor(this.rng() * pool.length)];
};

// 圈圈叉叉：在棋盤旁落子。前兩位落子的玩家分別是 X 與 O，輪流下。
Sim.prototype._ttMove = function (p, idx) {
  const b = this.tt;
  if (!b || b.over || idx < 0 || idx > 8 || b.cells[idx]) return;
  if (!b.x) b.x = p.id;
  else if (!b.o && b.x !== p.id) b.o = p.id;
  const mark = b.x === p.id ? 'X' : b.o === p.id ? 'O' : null;
  if (!mark || b.turn !== mark) return;
  b.cells[idx] = mark;
  b.turn = mark === 'X' ? 'O' : 'X';
  const win = TT_LINES.some(function (l) { return b.cells[l[0]] && b.cells[l[0]] === b.cells[l[1]] && b.cells[l[0]] === b.cells[l[2]]; });
  if (win) { b.over = 'win'; b.winner = mark; this.money += 150; b.timer = 6; this.events.push({ t: 'ttwin', mark: mark }); }
  else if (b.cells.every(function (c) { return c; })) { b.over = 'draw'; b.timer = 6; this.events.push({ t: 'ttdraw' }); }
  this.events.push({ t: 'ttmove', id: p.id, idx: idx, mark: mark });
};

Sim.prototype._padSpot = function (p) {
  const pool = [];
  for (let i = 0; i < floorCells.length; i++) {
    const c = center(floorCells[i][0], floorCells[i][1]);
    const d = Math.hypot(c[0] - p.x, c[1] - p.z);
    if (d >= 8 && d <= 14 && !blocked(c[0], c[1], 0.5)) pool.push(c);
  }
  if (!pool.length) return center(floorCells[0][0], floorCells[0][1]);
  return pool[Math.floor(this.rng() * pool.length)];
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
  if (m.dead > 0) { m.dead -= dt; if (m.dead <= 0) this._respawn(m); return; }
  if (m.cool > 0) { m.cool -= dt; return; }
  let best = null, bd = 1e9, bestSees = false;
  for (let i = 0; i < alive.length; i++) {
    const p = alive[i], d = Math.hypot(p.x - m.x, p.z - m.z) * (p.c === 5 ? 1.33 : 1) * (p.stealthT > 0 ? 2 : 1);   // 紙箱人較難被發現
    // 躲在櫃子旁（1.4 公尺內、沒有在跑）：怪物看不到，除非牠已經貼到 2.5 公尺內
    const hid = !p.run && d > 2.5 && LOCKERS.some(function (k) { return Math.hypot(k[0] - p.x, k[1] - p.z) < 1.4; });
    const inSmoke = (this.smokes || []).some(function (k) { return Math.hypot(k.x - p.x, k.z - p.z) < 3; });   // 站在煙裡怪物看不到
    const sees = !(p.hideT > 0) && !inSmoke && !hid && d < 30 && los(m.x, m.z, p.x, p.z);
    const hears = (p.run && d < 12) || (p.loud && d < 18) || (p.bag.length >= 3 && d < 40);   // 身上集滿 3 件會把怪物引過來
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
    if (m.lost > 3.5 || !m.goal) { m.state = 'wander'; m.path = null; }
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
  // 紅色（火）怪物追逐時較快；藍色（冰）怪物的減速光環在客戶端計算
  const sp = m.state === 'chase' ? this.chaseSpeed * KIND_CHASE[mi % 4] : this.wanderSpeed * (mi % 4 === 2 ? 0.8 : 1);
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
    if (p.alive && !(p.shieldT > 0) && !p.air && Math.hypot(p.x - m.x, p.z - m.z) < 1.15) {   // 跳在空中時抓不到
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
  if (this.smokes && this.smokes.length) { this.smokes.forEach(function (k) { k.t -= dt; }); this.smokes = this.smokes.filter(function (k) { return k.t > 0; }); }
  const alive = this.players.filter(function (p) { return p.alive; });
  for (let k = 0; k < alive.length; k++) {
    const p = alive[k];
    if (p.atkCd > 0) p.atkCd -= dt;
    if ((p.smCd || 0) > 0) p.smCd -= dt;
    if (p.gunCd > 0) p.gunCd -= dt;
    if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { p.reload = 0; p.ammo = 12; } }
    if ((p.skCd || 0) > 0) p.skCd -= dt;
    for (const k of ['shieldT', 'hideT', 'stealthT', 'rallyT']) if ((p[k] || 0) > 0) p[k] -= dt;
    p.hurtT += dt;
    if (p.hurtT > 5 && p.hp < 100) p.hp = Math.min(100, p.hp + 6 * dt);   // 5 秒沒受傷後慢慢回血
  }
  // 救援：按住 E 站在倒地隊友 2 公尺內 2 秒，把隊友救起（血量 50，身上廢料留在原地）
  for (let k = 0; k < alive.length; k++) {
    const p = alive[k];
    if (!p.rs) { p.rescT = 0; continue; }
    let t = null;
    for (let q = 0; q < this.players.length; q++) {
      const o = this.players[q];
      if (!o.alive && Math.hypot(o.x - p.x, o.z - p.z) < 2) { t = o; break; }
    }
    if (!t) { p.rescT = 0; continue; }
    p.rescT = (p.rescT || 0) + dt;
    if (p.rescT >= 2) {
      p.rescT = 0; t.alive = true; t.hp = 50; t.hurtT = 0; t.run = t.loud = false;
      this.events.push({ t: 'revive', id: t.id, by: p.id });
    }
  }
  // 搶獎盃：按住 E 3 秒
  if (this.trophy) {
    for (let k = 0; k < alive.length; k++) {
      const p = alive[k];
      if (p.rs && Math.hypot(p.x - this.trophy[0], p.z - this.trophy[1]) < 2.2) {
        p.grabT = (p.grabT || 0) + dt;
        if (p.grabT >= 3) {
          this.money += 120; p.earned += 120; this.trophy = null;
          this.events.push({ t: 'trophy', id: p.id });
          break;
        }
      } else p.grabT = 0;
    }
  }
  // 棋盤結束後 6 秒重新開局
  if (this.tt && this.tt.over) {
    this.tt.timer -= dt;
    if (this.tt.timer <= 0) this.tt = newTT();
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
    // 傳送陣：身上集滿 3 件時，在附近隨機出現；踩上去會被傳回基地
    if (!this.pad && p.bag.length >= BAG_MAX) {
      this.pad = this._padSpot(p);
      this.events.push({ t: 'pad', x: this.pad[0], z: this.pad[1] });
    }
    if (this.pad && Math.hypot(this.pad[0] - p.x, this.pad[1] - p.z) < 1.2) {
      p.x = VAN[0]; p.z = VAN[1];
      this.pad = null;
      this.events.push({ t: 'warp', id: p.id, x: VAN[0], z: VAN[1] });
    }
    if (p.bag.length && Math.hypot(VAN[0] - p.x, VAN[1] - p.z) < 1.9) {
      let sum = 0;
      for (let b = 0; b < p.bag.length; b++) sum += this.items[p.bag[b]].value;
      if (p.pet === 3) sum = Math.round(sum * 1.1);   // 寵物小機器人：賣出 +10%
      p.bag = []; this.money += sum; p.earned += sum;
      this.events.push({ t: 'sell', id: p.id, sum: sum });
    }
  }
  if (this.money >= this.quota) { this._end(true, 'quota'); return; }
  for (let i = 0; i < this.monsters.length; i++) {
    if (i % 4 !== 2) continue;
    const mo = this.monsters[i];
    if (mo.dead > 0) continue;
    for (let k = 0; k < alive.length; k++) { const p = alive[k]; if (Math.hypot(p.x - mo.x, p.z - mo.z) < 3) { p.hp = Math.max(1, p.hp - 6 * dt); p.hurtT = 0; } }
  }
  for (let i = 0; i < this.monsters.length; i++) this._monster(this.monsters[i], i, dt, alive);
  if (!this.players.some(function (p) { return p.alive; })) { this._end(false, 'dead'); return; }
  if (this.time <= 0) this._end(false, 'time');
};

Sim.prototype.snapshot = function () {
  let it = '';
  for (let i = 0; i < this.items.length; i++) it += this.items[i].taken ? '1' : '0';
  return { t: 's', ph: this.phase, day: this.day, money: this.money, quota: this.quota, time: Math.round(this.time * 10) / 10,
    p: this.players.map(function (p) {
      return [p.id, r2(p.x), r2(p.z), r2(p.yaw), p.alive ? 1 : 0, p.bag.length, (p.run ? 1 : 0) | (p.spk ? 2 : 0) | (p.loud ? 4 : 0) | (p.air ? 8 : 0), Math.round(p.hp), p.ammo || 0, p.reload > 0 ? 1 : 0];
    }),
    pad: this.pad ? [r2(this.pad[0]), r2(this.pad[1])] : null,
    tr: this.trophy ? [r2(this.trophy[0]), r2(this.trophy[1])] : null,
    bp: this.boardPos ? [r2(this.boardPos[0]), r2(this.boardPos[1])] : null,
    tt: this.tt ? [this.tt.cells.map(function (c) { return c || '.'; }).join(''), this.tt.turn, this.tt.x, this.tt.o, this.tt.over, this.tt.winner] : null,
    m: this.monsters.map(function (m) { return [r2(m.x), r2(m.z), r2(m.rot), m.state === 'chase' ? 1 : 0, m.dead > 0 ? 0 : Math.max(1, Math.round(m.hp))]; }),
    it: it };
};

const api = { MAPS: MAPS, CS: CS, WH: WH, BAG_MAX: BAG_MAX, DAY_TIME: DAY_TIME, MAX_PLAYERS: MAX_PLAYERS,
  KINDS: KINDS, CHARS: CHARS, WEAPONS: WEAPONS, HATS: HATS, COSTUMES: COSTUMES, PETS: PETS, isWall: isWall, cellOf: cellOf, center: center, blocked: blocked, los: los, bfs: bfs,
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
  // 櫃子（躲藏點）：先放死巷（三面牆），不夠再放轉角（兩面相鄰的牆）；貼牆放、彼此至少隔 3 格、離起點 4 格以上，最多 6 個
  LOCKERS = [];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], cellsUsed = [];
  const tryLocker = function (fc, wantOpen) {
    if (LOCKERS.length >= 6) return;
    const c = fc[0], r = fc[1];
    if (MAP[r][c] !== '.' || Math.abs(c - startCell[0]) + Math.abs(r - startCell[1]) < 4) return;
    const open = DIRS.filter(function (d) { return !isWall(c + d[0], r + d[1]); });
    if (open.length !== wantOpen) return;
    if (wantOpen === 2 && open[0][0] === -open[1][0] && open[0][1] === -open[1][1]) return;   // 直走廊不是轉角
    if (cellsUsed.some(function (u) { return Math.abs(u[0] - c) + Math.abs(u[1] - r) < 3; })) return;
    const wd = DIRS.filter(function (d) { return isWall(c + d[0], r + d[1]); })[0], p = center(c, r);
    const back = wantOpen === 1 ? [-open[0][0], -open[0][1]] : wd;
    LOCKERS.push([p[0] + back[0] * (CS / 2 - 0.45), p[1] + back[1] * (CS / 2 - 0.45), Math.atan2(-back[0], -back[1])]);
    cellsUsed.push([c, r]);
  };
  floorCells.forEach(function (fc) { tryLocker(fc, 1); });
  floorCells.forEach(function (fc) { tryLocker(fc, 2); });
  floorCells.forEach(function (fc) { tryLocker(fc, 3); });   // 開放地圖轉角少：貼著單面牆也可以放
  api.lockers = LOCKERS;
  api.MAP = MAP; api.ROWS = ROWS; api.COLS = COLS; api.VAN = VAN; api.floorCells = floorCells; api.mapIndex = i;
  api.theme = MAPS[i].theme; api.mapName = MAPS[i].name; api.monsterCells = MONSTER_CELLS;
  return i;
}
setMap(0);
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { root.RR = root.RR || {}; root.RR.World = api; }
})(typeof window !== 'undefined' ? window : globalThis);
