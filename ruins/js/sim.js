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
  ] },
  { name: '森林營地', theme: { wall: '#4d6b38', floor: '#6d8c47', ceil: '#000000', fog: 0.016, amb: 0xf2ffe6, open: true, sky: 0x9fd3ee, style: 'forest', wallH: 2.6, sun: 0.6, torch: 0.2 }, rows: [
    '#####################',
    '#S.....##.......##..#',
    '#......##...#.......#',
    '#..#........#...##..#',
    '#..##...M.......#...#',
    '#.......##..........#',
    '#...#...##...##..#..#',
    '#...#........##..#..#',
    '#.......#...........#',
    '#..##...#....M..##..#',
    '#..#.........#...#..#',
    '#......##....#......#',
    '#..M...##.........M.#',
    '#...................#',
    '#####################'
  ] },
  { name: '雪地小鎮', theme: { wall: '#7b5b43', floor: '#e6edf3', ceil: '#000000', fog: 0.02, amb: 0xffffff, open: true, sky: 0xc7dbec, style: 'snow', wallH: 2.8, sun: 0.5, torch: 0.25 }, rows: [
    '#####################',
    '#S..................#',
    '#.##..##..##..##.##.#',
    '#.##..##..##..##.##.#',
    '#...................#',
    '#..M....#.....#.....#',
    '#.##.##.#.###.#.##..#',
    '#.##.##...###...##..#',
    '#...........M.......#',
    '#.##..#.##..##.#.##.#',
    '#.##..#.##..##.#.##.#',
    '#...................#',
    '#.###..##.##..###...#',
    '#M.................M#',
    '#####################'
  ] },
  { name: '廢棄遊樂園', theme: { wall: '#c04a38', floor: '#c7b28c', ceil: '#000000', fog: 0.01, amb: 0xffe4cc, open: true, sky: 0xf3a06c, style: 'park', wallH: 2.2, sun: 0.5, torch: 0.4 }, rows: [
    '#####################',
    '#S.......#.........M#',
    '#.######.#.#######..#',
    '#.#......#.......#..#',
    '#.#.###.....###..#..#',
    '#...#.........#.....#',
    '#.#.#..##.##..#.#...#',
    '#.#....#M..#....#...#',
    '#.#.#..##.##..#.#...#',
    '#...#.........#.....#',
    '#.#.###.....###..#..#',
    '#.#..............#..#',
    '#.######.#.#######..#',
    '#M.......#.........M#',
    '#####################'
  ] },
  { name: '建築工地', theme: { wall: '#9c9b93', floor: '#8c7b62', ceil: '#000000', fog: 0.012, amb: 0xfff6e8, open: true, sky: 0x96c6ec, style: 'site', wallH: 3.0, sun: 0.62, torch: 0.2 }, rows: [
    '#####################',
    '#S...#.......#......#',
    '#....#..###..#..##..#',
    '#.##.......#.....#..#',
    '#.##..##...#..M..#..#',
    '#.....##............#',
    '#..........###...##.#',
    '###..#..M..#.....##.#',
    '#....#.....#........#',
    '#.##...##.....#.....#',
    '#.##...##..#..#..##.#',
    '#..........#.....##.#',
    '#...#..........#....#',
    '#M..#....##....#...M#',
    '#####################'
  ] }
];
const CS = 4, WH = 3.6;
let MAP = MAPS[0].rows, ROWS = MAP.length, COLS = MAP[0].length, mapIndex = -1;
let BROKEN = [];   // 這一天被炸開的牆 [c, r]
let startCell = [1, 1], floorCells = [], VAN = [6, 6], MONSTER_CELLS = [];
const BAG_MAX = 3, DAY_TIME = 240, MAX_PLAYERS = 4;
// 配件（最多同時裝 2 個，對局中可換）與寶石（每顆 0～5 級）
const ACCS = ['', '跑鞋', '大背包', '擴充彈匣', '護甲', '消音鞋', '急救針'];
const ACC_NOTE = ['', '移動速度 +6%', '背包多 1 格（共 4 格）', '子彈 +50%', '生命上限 130', '怪物聽到跑步聲的距離 12 → 7 公尺', '被抓到時自動掙脫一次（每天一次）'];
const GEMS = ['紅寶石', '藍寶石', '黃寶石'];
const GEM_NOTE = ['每級：槍傷害 +8%、擊暈 +0.2 秒', '每級：跑步耗體力 −5%', '每級：賣出金額 +3%'];
function cleanEq(a) { const out = []; (Array.isArray(a) ? a : []).forEach(function (v) { v = v | 0; if (v > 0 && v < ACCS.length && out.indexOf(v) < 0 && out.length < 2) out.push(v); }); return out; }
function cleanGems(a) { const out = [0, 0, 0]; if (Array.isArray(a)) for (let i = 0; i < 3; i++) out[i] = Math.max(0, Math.min(5, a[i] | 0)); return out; }
function hasAcc(p, k) { return !!p.eq && p.eq.indexOf(k) >= 0; }
function bagCap(p) { return (hasAcc(p, 2) ? BAG_MAX + 1 : BAG_MAX) + (p.veh ? 2 : 0); }   // 推車上可以多放 2 件
// 天氣：0 晴朗、1 下雨（開放場景；雨聲蓋過腳步，怪物聽力 ×0.7）、2 濃霧（怪物視線變短）、3 停電（室內；很暗，怪物視線變短）、4 沙塵暴／太陽風暴（開放場景；能見度低、小地圖不顯示怪物）
const WEATHERS = ['晴朗', '下雨', '濃霧', '停電', '風暴'];
const WX_SIGHT = [1, 1.15, 2.1, 1.6, 1.9], WX_HEAR = [1, 0.7, 1, 1, 0.85];
function maxHp(p) { return hasAcc(p, 4) ? 130 : 100; }
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
// 槍械：dmg＝對怪物（獵殺／塔防）每顆傷害、pvp＝大逃殺對人傷害、cd＝射擊間隔、clip＝[回收模式每天子彈, 其他模式彈匣]、
// range＝射程、w＝命中寬度、n＝一次幾顆、spread＝散布（弧度）、stun＝回收模式暈眩秒數、reload＝換彈秒數、auto＝按住連發（槍全部免費，造型才要抽）
const GUNS = [
  { name: '手槍', dmg: 34, pvp: 25, cd: 0.22, clip: [6, 12], range: 45, w: 0.8, n: 1, spread: 0, stun: 2.5, reload: 1.4, auto: false, cost: 0 },
  { name: '霰彈槍', dmg: 15, pvp: 11, cd: 0.75, clip: [3, 6], range: 16, w: 0.9, n: 6, spread: 0.16, stun: 2.2, reload: 1.9, auto: false, cost: 0 },
  { name: '步槍', dmg: 22, pvp: 17, cd: 0.13, clip: [12, 24], range: 52, w: 0.7, n: 1, spread: 0.025, stun: 1.6, reload: 1.8, auto: true, cost: 0 },
  { name: '衝鋒槍', dmg: 15, pvp: 11, cd: 0.08, clip: [16, 32], range: 28, w: 0.8, n: 1, spread: 0.07, stun: 1.1, reload: 1.6, auto: true, cost: 0 },
  { name: '狙擊槍', dmg: 95, pvp: 75, cd: 1.1, clip: [3, 5], range: 80, w: 0.45, n: 1, spread: 0, stun: 4.2, reload: 2.3, auto: false, cost: 0 }
];
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
  const p = { id: id, name: String(name || '玩家').slice(0, 12), slot: slot, c: pick(look.c, CHARS.length), w: pick(look.w, WEAPONS.length), h: pick(look.h, HATS.length), o: pick(look.o, COSTUMES.length), pet: pick(look.pet, PETS.length), gun: pick(look.gun, GUNS.length), eq: cleanEq(look.eq), gems: cleanGems(look.gems), x: VAN[0], z: VAN[1], yaw: 0,
    run: false, loud: false, spk: false, alive: true, bag: [], hp: 100, atkCd: 0, hurtT: 99, earned: 0, kills: 0 };
  this.players.push(p);
  return p;
};
Sim.prototype.removePlayer = function (id) {
  const p = this.player(id);
  if (!p) return;
  if (this.phase === 'play') this._dropBag(p);
  this.players = this.players.filter(function (q) { return q.id !== id; });
  if (this.phase === 'play' && this.mode !== 'br' && !this.players.some(function (q) { return q.alive; })) this._end(false, 'dead');
};
Sim.prototype.roster = function () {
  return this.players.map(function (p) { return { id: p.id, name: p.name, slot: p.slot, c: p.c, w: p.w, h: p.h || 0, o: p.o || 0, pet: p.pet || 0, gun: p.gun || 0, eq: p.eq || [], gems: p.gems || [0, 0, 0] }; });
};

Sim.prototype.startDay = function (day) {
  restoreMap();
  this.map = setMap(this.map);
  const self = this, n = Math.max(1, this.players.length);
  this.day = day; this.phase = 'play'; this.money = 0; this.time = DAY_TIME; this.pad = null;
  this.boardPos = this._spotAt(VAN[0], VAN[1], 2.5, 4) || [VAN[0] + 2.5, VAN[1]];
  this.tt = newTT();
  this.trophy = this._spotAt(VAN[0], VAN[1], 12, 25);   // 搶獎盃：地圖上一座獎盃，按住 E 3 秒的人拿走
  const td = this.mode === 'td', hunt = this.mode === 'hunt' || td, br = this.mode === 'br';   // 塔防沿用獵殺的槍與彈匣
  this.players = this.players.filter(function (p) { return !p.ai; });   // 上一局的機器人先清掉
  this.quota = br ? 0 : hunt ? 50 * (5 + 2 * (day - 1) + 2 * (n - 1)) : quotaFor(day, n); this.events = [];   // 獵殺：每擊倒一隻 $50
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
  const count = hunt || br ? 0 : Math.min(cands.length, Math.round(floorCells.length / 12) + 2 * n + Math.min(day, 6));
  this.items = [];
  for (let i = 0; i < count; i++) {
    const p = center(cands[i][0], cands[i][1]);
    const kind = Math.floor(this.rng() * KINDS.length), k = KINDS[kind];
    this.items.push({ x: r2(p[0] + (this.rng() - 0.5) * 2), z: r2(p[1] + (this.rng() - 0.5) * 2), kind: kind,
      value: Math.round((k.lo + this.rng() * (k.hi - k.lo)) / 5) * 5, taken: false });
  }
  // 怪物：第 3 天起 2 隻，第 6 天起 3 隻
  const mc = br || td ? 0 : hunt ? Math.min(4, 1 + day) : day >= 6 ? 4 : day >= 3 ? 2 : 1;
  this.monsters = [];
  for (let i = 0; i < mc; i++) {
    const mcell = MONSTER_CELLS[i] || floorCells[Math.floor(this.rng() * floorCells.length)];   // 地圖的怪物點不夠時，隨機放在地板上
    const p = center(mcell[0], mcell[1]);
    this.monsters.push({ x: p[0], z: p[1], rot: 0, state: 'wander', path: null, goal: null, lost: 0, repath: 0, cool: 0, target: null, hp: 100, dead: 0 });
  }
  if (hunt || br) this.trophy = null;
  this.chaseSpeed = Math.min(3.9 + 0.1 * (day - 1), 4.9);   // 跑步（9）一定甩得掉；走路（4.2）在後期甩不掉
  this.wanderSpeed = Math.min(2.1 + 0.05 * (day - 1), 2.8);
  this.players.forEach(function (p) {
    const o = SPAWN_OFF[p.slot % 4];
    p.alive = true; p.bag = []; p.x = VAN[0] + o[0]; p.z = VAN[1] + o[1]; p.yaw = -Math.PI * 0.75;
    p.bombs = 99; p.bombCd = 0;   // 炸藥不限量，只有 2 秒冷卻（顯示成 ∞）
    p.run = p.loud = false; p.hp = maxHp(p); p.atkCd = 0; p.hurtT = 99; p.esc = false;
    p.clip = Math.round(GUNS[p.gun | 0].clip[hunt || br ? 1 : 0] * (hasAcc(p, 3) ? 1.5 : 1)); p.ammo = p.clip; p.gunCd = 0; p.reload = 0;   // 回收模式每天 6 發（擊中讓怪物暈 2.5 秒）；獵殺模式彈匣 12 發、自動裝填
    if (day === 1) { p.earned = 0; p.kills = 0; p.mk = 0; }
  });
  this.zone = null;
  // 塔防：怪物一波一波走向回收車（核心），玩家開槍、花錢蓋砲塔守住它
  this.td = null; this.towers = [];
  if (td) {
    const total = 10 + 4 * (day - 1) + 3 * (n - 1);
    this.td = { core: 100, total: total, left: total, spawnT: 3, gap: Math.max(1.3, 3.2 - 0.2 * day), hp: 55 + 15 * day, speed: Math.min(2.4 + 0.15 * day, 4) };
    this.money = 100; this.quota = 0;   // 開局 $100，剛好蓋一座砲塔；每擊倒一隻 +$50
    for (let i = 0; i < 6; i++) this.monsters.push({ x: VAN[0], z: VAN[1], rot: 0, state: 'wander', path: null, goal: null, lost: 0, repath: 0, cool: 0, target: null, hp: 0, dead: 1e9, idle: true });
  }
  // 天氣與天然災害（第 1 天固定晴朗、沒有災害；大逃殺不啟用）
  const openMap = !!MAPS[this.map].theme.open;
  this.weather = 0; this.disT = -1; this.strikes = [];
  if (!br && day > 1) {
    const r = this.rng();
    this.weather = r < 0.35 ? 0 : r < 0.6 ? 2 : openMap ? (r < 0.82 ? 1 : 4) : 3;
    this.disT = 60 + this.rng() * 100;   // 剩餘時間到這個秒數時發生
    this.disKind = this.rng() < 0.5 ? 'quake' : 'strike';
  }
  // 載具：回收車旁的推車（大逃殺沒有）
  this.players.forEach(function (p) { p.veh = false; });
  const vs = br ? null : this._spotAt(VAN[0], VAN[1], 2.5, 6);
  this.veh = vs ? { x: vs[0], z: vs[1], rider: null } : null;
  if (br) this._startBR();
  return self.dayInfo();
};
Sim.prototype.dayInfo = function () {
  const spawns = {};
  this.players.forEach(function (p) { spawns[p.id] = [p.x, p.z]; });
  return { t: 'day', map: this.map, mode: this.mode, day: this.day, quota: this.quota, time: this.time, monsters: this.monsters.length,
    items: this.items.map(function (i) { return [i.x, i.z, i.kind, i.value]; }), spawns: spawns, weather: this.weather || 0, zone: this.zone ? [this.zone.x, this.zone.z, this.zone.r0] : null };
};
Sim.prototype.toLobby = function () { this.phase = 'lobby'; this.day = 1; this.events = []; this.zone = null; this.players = this.players.filter(function (p) { return !p.ai; }); };

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
  p.run = !!m.run; p.loud = !!m.loud; p.air = !!m.air; if (m.vh) p.vq = true;
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
  this.events.push({ t: 'end', win: win, why: why, core: this.td ? this.td.core : undefined, day: this.day, money: this.money, quota: this.quota, time: Math.max(0, Math.ceil(this.time)),
    stats: this.players.map(function (p) { return { id: p.id, name: p.name, slot: p.slot, earned: p.earned, kills: p.kills, mk: p.mk || 0, alive: p.alive, rank: p.rank || 0, ai: !!p.ai }; }) });
};

/** 對局中更換配件：立刻生效（子彈上限等下一天才變） */
Sim.prototype.setEquip = function (id, eq) {
  const p = this.player(id);
  if (!p) return false;
  p.eq = cleanEq(eq); p.hp = Math.min(p.hp, maxHp(p));
  return true;
};
/** 開槍：依槍種（GUNS）沿面對方向打出一或多顆子彈，每顆打中最近、沒被牆擋住的怪物（大逃殺也會打到人）。
 *  回收模式＝暈眩；獵殺／塔防＝扣血，歸零擊倒並得 $50。 */
Sim.prototype.shoot = function (id, yaw) {
  const p = this.player(id);
  if (!p || this.phase !== 'play' || !p.alive || p.gunCd > 0 || p.reload > 0) return;
  if (!(p.ammo > 0)) { this.events.push({ t: 'noammo', id: id }); p.gunCd = 0.4; return; }
  if (isFinite(+yaw)) p.yaw = +yaw;
  const G = GUNS[p.gun | 0], td = this.mode === 'td', hunt = this.mode === 'hunt' || td, br = this.mode === 'br';
  const gem = 1 + 0.08 * (p.gems ? p.gems[0] : 0);
  p.gunCd = G.cd; p.ammo--;
  if ((hunt || br) && p.ammo <= 0) p.reload = G.reload;
  for (let k = 0; k < G.n; k++) {
    const a = p.yaw + (G.spread ? (this.rng() - 0.5) * 2 * G.spread : 0), fx = -Math.sin(a), fz = -Math.cos(a);
    let hit = -1, hd = G.range;
    for (let i = 0; i < this.monsters.length; i++) {
      const m = this.monsters[i];
      if (m.dead > 0) continue;
      const dx = m.x - p.x, dz = m.z - p.z, along = dx * fx + dz * fz;
      if (along <= 0 || along > hd || Math.abs(dx * fz - dz * fx) > G.w) continue;
      if (!los(p.x, p.z, m.x, m.z)) continue;
      hit = i; hd = along;
    }
    let hitP = null;
    if (br) {
      for (let i = 0; i < this.players.length; i++) {
        const q = this.players[i];
        if (q === p || !q.alive) continue;
        const dx = q.x - p.x, dz = q.z - p.z, along = dx * fx + dz * fz;
        if (along <= 0 || along > hd || Math.abs(dx * fz - dz * fx) > G.w * 0.7) continue;
        if (!los(p.x, p.z, q.x, q.z)) continue;
        hitP = q; hd = along; hit = -1;
      }
    }
    let hx, hz, kill = false;
    if (hitP) {
      hx = hitP.x; hz = hitP.z;
      hitP.hp -= G.pvp * (p.boost ? 1.5 : 1) * gem; hitP.hurtT = 0;
      if (hitP.hp <= 0) { kill = true; this._brKill(hitP, p); }
      else this.events.push({ t: 'hit', id: hitP.id, by: p.id, hp: Math.round(hitP.hp) });
    } else if (hit >= 0) {
      const m = this.monsters[hit]; hx = m.x; hz = m.z;
      if (hunt) {
        m.hp -= G.dmg * gem; m.cool = 0.25;
        if (m.hp <= 0) { kill = true; m.dead = td ? 1e9 : 3; m.idle = td; m.state = 'wander'; m.path = null; this.money += 50; p.earned += 50; p.mk = (p.mk || 0) + 1; }
        else if (!td) { m.state = 'chase'; m.target = p.id; m.goal = cellOf(p.x, p.z); m.lost = 0; m.repath = 0; }
      } else m.cool = Math.max(m.cool || 0, G.stun + 0.2 * (p.gems ? p.gems[0] : 0));
    } else {
      let d = 0; hx = p.x; hz = p.z;
      while (d < G.range && !isWall(Math.floor((p.x + fx * (d + 0.5)) / CS), Math.floor((p.z + fz * (d + 0.5)) / CS))) { d += 0.5; hx = p.x + fx * d; hz = p.z + fz * d; }
    }
    // 第一顆帶聲音與後座力；霰彈其餘顆 q=1 只畫彈道
    this.events.push({ t: 'shot', id: id, g: p.gun | 0, q: k ? 1 : undefined, x: r2(p.x), z: r2(p.z), hx: r2(hx), hz: r2(hz), mi: hit, kill: kill && !hitP, pk: hitP ? hitP.id : undefined, ammo: p.ammo });
  }
};
/* ---------- 大逃殺 ---------- */
const BR_TOTAL = 6;   // 真人 + 機器人的總人數
const BOT_NAMES = ['阿鐵', '小綠', '老皮', '閃電', '麻糬', '黑糖', '豆花'];
Sim.prototype._startBR = function () {
  const self = this;
  // 機器人補滿人數
  for (let i = 0; this.players.length < BR_TOTAL; i++) {
    let slot = 0; while (this.players.some(function (q) { return q.slot === slot; })) slot++;
    this.players.push({ id: 'bot' + i, name: BOT_NAMES[i % BOT_NAMES.length], slot: slot, c: Math.floor(this.rng() * CHARS.length), w: Math.floor(this.rng() * WEAPONS.length), h: Math.floor(this.rng() * HATS.length), o: 0, pet: 0, gun: Math.floor(this.rng() * 4), eq: [], gems: [0, 0, 0],
      ai: true, x: 0, z: 0, yaw: 0, run: false, loud: false, spk: false, alive: true, bag: [], hp: 100, atkCd: 0, hurtT: 99, earned: 0, kills: 0, mk: 0, gunCd: 0, reload: 0, clip: 12, ammo: 12 });
    { const b = this.players[this.players.length - 1]; b.clip = b.ammo = GUNS[b.gun].clip[1]; }
  }
  // 出生點：盡量彼此分開
  const used = [];
  this.players.forEach(function (p) {
    let best = null, bd = -1;
    for (let k = 0; k < 30; k++) {
      const fc = floorCells[Math.floor(self.rng() * floorCells.length)], c = center(fc[0], fc[1]);
      let near = 1e9; used.forEach(function (u) { near = Math.min(near, Math.hypot(u[0] - c[0], u[1] - c[1])); });
      if (near > bd) { bd = near; best = c; }
    }
    used.push(best); p.x = best[0]; p.z = best[1]; p.hp = 100; p.alive = true; p.boost = false; p.kills = 0; p.rank = 0; p.path = null; p.think = 0;
  });
  // 安全區：圓心在地圖中段的地板上，半徑從涵蓋全圖縮到 5 公尺
  const W2 = COLS * CS, D2 = ROWS * CS;
  let zc = null, zd = 1e9;
  floorCells.forEach(function (fc) { const c = center(fc[0], fc[1]), d = Math.hypot(c[0] - W2 / 2, c[1] - D2 / 2) + self.rng() * 10; if (d < zd) { zd = d; zc = c; } });
  const r0 = Math.hypot(W2, D2) * 0.62;
  this.zone = { x: zc[0], z: zc[1], r0: r0, r: r0 };
  this.time = 210; this.dead = 0;
  // 補給箱：kind 20 急救（+40）、21 護甲（生命上限到 150，+50）、22 火力（傷害 ×1.5）
  const cells = floorCells.slice();
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)), t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
  this.items = [];
  for (let i = 0; i < Math.min(12, cells.length); i++) { const c = center(cells[i][0], cells[i][1]); this.items.push({ x: c[0], z: c[1], kind: 20 + (i % 3 === 2 ? (i % 2 ? 22 - 20 : 1) : 0), value: 0, taken: false }); }
};
Sim.prototype._brKill = function (v, by) {
  if (!v.alive) return;
  v.alive = false; v.hp = 0; v.run = v.loud = false;
  v.rank = this.players.length - this.dead; this.dead++;
  if (by) by.kills = (by.kills || 0) + 1;
  this.events.push({ t: 'brkill', id: v.id, by: by ? by.id : null, rank: v.rank });
};
Sim.prototype._stepBR = function (dt, alive) {
  const self = this, z = this.zone, T = 210 - this.time;
  // 縮圈：20 秒後開始，170 秒時縮到最小
  z.r = T < 20 ? z.r0 : Math.max(5, z.r0 - (z.r0 - 5) * Math.min(1, (T - 20) / 150));
  const zoneDps = 5 + T / 20;
  for (let k = 0; k < alive.length; k++) {
    const p = alive[k];
    if (!p.alive) continue;
    if (Math.hypot(p.x - z.x, p.z - z.z) > z.r) { p.hp -= zoneDps * dt; p.hurtT = 0; if (p.hp <= 0) { this._brKill(p, null); continue; } }
    // 補給
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.taken || Math.hypot(it.x - p.x, it.z - p.z) > 1.5) continue;
      if (it.kind === 20) { if (p.hp >= (p.armor ? 150 : 100)) continue; p.hp = Math.min(p.armor ? 150 : 100, p.hp + 40); }
      else if (it.kind === 21) { p.armor = true; p.hp = Math.min(150, p.hp + 50); }
      else p.boost = true;
      it.taken = true; this.events.push({ t: 'loot', id: p.id, k: it.kind, hp: Math.round(p.hp) });
    }
    if (p.ai) this._bot(p, dt, alive);
  }
  const left = this.players.filter(function (p) { return p.alive; });
  if (left.length <= 1 || this.time <= 0) {
    left.sort(function (a, b) { return (b.kills || 0) - (a.kills || 0) || b.hp - a.hp; });
    left.forEach(function (p, i) { p.rank = i + 1; });
    this._end(true, left.length <= 1 ? 'last' : 'time');
  }
};
// 機器人：往圈內走、看到人就開槍（有瞄準誤差）、血少會找急救箱
Sim.prototype._bot = function (p, dt, alive) {
  const z = this.zone;
  let tgt = null, td = 20;
  for (let i = 0; i < alive.length; i++) { const q = alive[i]; if (q === p || !q.alive) continue; const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < td && los(p.x, p.z, q.x, q.z)) { tgt = q; td = d; } }
  if (tgt) {
    const want = Math.atan2(-(tgt.x - p.x), -(tgt.z - p.z));
    p.yaw = want;
    if (p.gunCd <= 0 && p.reload <= 0) { p.aim = (p.aim || 0) + dt; if (p.aim > 0.7) { p.aim = 0.25; this.shoot(p.id, want + (this.rng() - 0.5) * 0.3); } }
  } else p.aim = 0;
  p.think -= dt;
  const pc = cellOf(p.x, p.z);
  if (!p.path || !p.path.length || p.think <= 0) {
    p.think = 2 + this.rng() * 2;
    let goal = null;
    if (p.hp < 60) { let bd = 1e9; this.items.forEach(function (it) { if (it.taken || it.kind !== 20) return; const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd && Math.hypot(it.x - z.x, it.z - z.z) < z.r) { bd = d; goal = cellOf(it.x, it.z); } }); }
    if (!goal) {
      for (let k = 0; k < 12 && !goal; k++) { const fc = floorCells[Math.floor(this.rng() * floorCells.length)], c = center(fc[0], fc[1]); if (Math.hypot(c[0] - z.x, c[1] - z.z) < z.r * 0.8) goal = fc; }
      if (!goal) goal = cellOf(z.x, z.z);
    }
    const path = bfs(pc[0], pc[1], goal[0], goal[1]);
    p.path = path ? path.slice(1) : null;
  }
  if (p.path && p.path.length && !(tgt && td < 7)) {
    const c = center(p.path[0][0], p.path[0][1]), dx = c[0] - p.x, dz = c[1] - p.z, d = Math.hypot(dx, dz);
    if (d < 0.3) p.path.shift();
    else { const sp = 4.6 * dt; p.x += dx / d * Math.min(sp, d); p.z += dz / d * Math.min(sp, d); if (!tgt) p.yaw = Math.atan2(-dx, -dz); p.run = false; }
  }
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
  if (!this.pvp && this.mode !== 'br') return;
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
  if (best.hp <= 0 && this.mode === 'br') { this._brKill(best, a); return; }
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
    case 4: p.hp = Math.min(maxHp(p), p.hp + 35); p.skCd = 25; this.events.push({ t: 'heal', id: p.id, hp: Math.round(p.hp) }); break;
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

/** 炸藥：炸開面前 3.5 公尺內的第一格牆，地形就此改變（怪物與玩家都能走新開的路）；8 公尺內的怪物暈 2 秒 */
Sim.prototype.bomb = function (id, yaw) {
  const p = this.player(id);
  if (!p || this.phase !== 'play' || !p.alive) return;
  if (p.bombCd > 0) { this.events.push({ t: 'nobomb', id: id, why: 'cd' }); return; }
  if (isFinite(+yaw)) p.yaw = +yaw;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let hit = null;
  for (let d = 0.4; d <= 3.5 && !hit; d += 0.2) {
    const c = Math.floor((p.x + fx * d) / CS), r = Math.floor((p.z + fz * d) / CS);
    if (isWall(c, r)) hit = [c, r];
  }
  if (!hit) { this.events.push({ t: 'nobomb', id: id, why: 'far' }); return; }
  if (!breakWall(hit[0], hit[1])) { this.events.push({ t: 'nobomb', id: id, why: 'edge' }); return; }
  p.bombCd = 2;
  const cp = center(hit[0], hit[1]);
  this.monsters.forEach(function (m) { if (!(m.dead > 0) && Math.hypot(m.x - cp[0], m.z - cp[1]) < 8) { m.cool = Math.max(m.cool, 2); m.path = null; } });
  this.events.push({ t: 'break', id: id, c: hit[0], r: hit[1], n: p.bombs });
};
/** 塔防：花 $100 在腳邊蓋一座砲塔（最多 6 座、彼此至少隔 3 公尺） */
Sim.prototype.buildTower = function (id) {
  const p = this.player(id);
  if (!p || this.phase !== 'play' || this.mode !== 'td' || !p.alive) return;
  let why = null;
  if (this.towers.length >= 6) why = 'max';
  else if (this.money < 100) why = 'money';
  else if (this.towers.some(function (t) { return Math.hypot(t.x - p.x, t.z - p.z) < 3; })) why = 'near';
  if (why) { this.events.push({ t: 'notower', id: id, why: why }); return; }
  this.money -= 100; this.towers.push({ x: r2(p.x), z: r2(p.z), cd: 0.5 });
  this.events.push({ t: 'tower', id: id, x: r2(p.x), z: r2(p.z) });
};
Sim.prototype._stepTD = function (dt) {
  const T = this.td, self = this;
  // 出怪：從離回收車最遠的幾個點進場
  T.spawnT -= dt;
  if (T.left > 0 && T.spawnT <= 0) {
    const slot = this.monsters.find(function (m) { return m.idle; });
    if (slot) {
      let best = null, bd = -1;
      for (let k = 0; k < 10; k++) {
        const fc = floorCells[Math.floor(this.rng() * floorCells.length)], c = center(fc[0], fc[1]), d = Math.hypot(c[0] - VAN[0], c[1] - VAN[1]) + this.rng() * 6;
        if (d > bd) { bd = d; best = c; }
      }
      slot.x = best[0]; slot.z = best[1]; slot.hp = T.hp; slot.dead = 0; slot.idle = false; slot.path = null; slot.repath = 0; slot.cool = 0; slot.state = 'chase';
      T.left--; T.spawnT = T.gap;
    } else T.spawnT = 0.3;
  }
  // 怪物沿最短路走向回收車；走到就扣核心
  for (let i = 0; i < this.monsters.length; i++) {
    const m = this.monsters[i];
    if (m.idle) continue;
    if (m.cool > 0) { m.cool -= dt; continue; }
    const mc = cellOf(m.x, m.z);
    m.repath -= dt;
    if (m.repath <= 0 || !m.path) { m.path = bfs(mc[0], mc[1], startCell[0], startCell[1]); m.repath = 1; }
    const pth = m.path;
    if (pth) { while (pth.length > 1 && pth[1][0] === mc[0] && pth[1][1] === mc[1]) pth.shift(); }
    const next = pth ? (pth[1] || pth[0]) : startCell, cp = pth && pth.length > 1 ? center(next[0], next[1]) : VAN;
    const dx = cp[0] - m.x, dz = cp[1] - m.z, dd = Math.hypot(dx, dz), sp = T.speed * KIND_CHASE[i % 4];
    if (dd > 0.05) { const st = Math.min(dd, sp * dt); m.x += dx / dd * st; m.z += dz / dd * st; m.rot = Math.atan2(dx, dz); }
    if (Math.hypot(m.x - VAN[0], m.z - VAN[1]) < 1.6) {
      m.idle = true; m.dead = 1e9; T.core = Math.max(0, T.core - 15);
      this.events.push({ t: 'leak', core: T.core });
    }
  }
  // 砲塔：自動打 11 公尺內、沒被牆擋住的最近怪物
  this.towers.forEach(function (t) {
    t.cd -= dt;
    if (t.cd > 0) return;
    let best = -1, bd = 11;
    for (let i = 0; i < self.monsters.length; i++) {
      const m = self.monsters[i];
      if (m.idle) continue;
      const d = Math.hypot(m.x - t.x, m.z - t.z);
      if (d < bd && los(t.x, t.z, m.x, m.z)) { bd = d; best = i; }
    }
    if (best < 0) { t.cd = 0.2; return; }
    const m = self.monsters[best]; t.cd = 0.55; m.hp -= 25;
    let kill = false;
    if (m.hp <= 0) { kill = true; m.idle = true; m.dead = 1e9; self.money += 50; }
    self.events.push({ t: 'tshot', x: t.x, z: t.z, hx: r2(m.x), hz: r2(m.z), mi: best, kill: kill });
  });
  if (T.core <= 0) { this._end(false, 'core'); return; }
  if (T.left <= 0 && this.monsters.every(function (m) { return m.idle; })) { this._end(true, 'quota'); return; }
  if (this.time <= 0) this._end(false, 'time');
};
Sim.prototype._monster = function (m, mi, dt, alive) {
  if (m.dead > 0) { m.dead -= dt; if (m.dead <= 0) this._respawn(m); return; }
  if (m.cool > 0) { m.cool -= dt; return; }
  let best = null, bd = 1e9, bestSees = false;
  for (let i = 0; i < alive.length; i++) {
    const wx = this.weather || 0, hf = WX_HEAR[wx];
    const p = alive[i], d = Math.hypot(p.x - m.x, p.z - m.z) * (p.c === 5 ? 1.33 : 1) * (p.stealthT > 0 ? 2 : 1) * WX_SIGHT[wx];   // 紙箱人較難被發現；壞天氣怪物看不遠
    // 躲在櫃子旁（1.4 公尺內、沒有在跑）：怪物看不到，除非牠已經貼到 2.5 公尺內
    const hid = !p.run && d > 2.5 && LOCKERS.some(function (k) { return Math.hypot(k[0] - p.x, k[1] - p.z) < 1.4; });
    const inSmoke = (this.smokes || []).some(function (k) { return Math.hypot(k.x - p.x, k.z - p.z) < 3; });   // 站在煙裡怪物看不到
    const sees = !(p.hideT > 0) && !inSmoke && !hid && d < 30 && los(m.x, m.z, p.x, p.z);
    const dh = d / WX_SIGHT[wx];
    const hears = (p.veh && dh < 20 * hf) || (p.run && dh < (hasAcc(p, 5) ? 7 : 12) * hf) || (p.loud && dh < 18 * hf) ||   // 推車很吵
      (p.bag.length >= bagCap(p) && d < 40);   // 身上集滿 3 件會把怪物引過來
    if ((sees || hears) && d < bd && !inBase(this, p)) { best = p; bd = d; bestSees = sees; }   // 在光圈裡的人不會被當成目標
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
    if (p.alive && !(p.shieldT > 0) && !p.air && !inBase(this, p) && Math.hypot(p.x - m.x, p.z - m.z) < 1.15) {   // 跳在空中時、在光圈裡抓不到
      if (hasAcc(p, 6) && !p.esc) { p.esc = true; m.cool = 2.5; m.state = 'wander'; m.path = null; this.events.push({ t: 'escape', id: p.id }); break; }   // 急救針
      p.alive = false; p.run = p.loud = false;
      this.events.push({ t: 'caught', id: p.id, x: r2(m.x), z: r2(m.z) });
      this._dropBag(p);
      m.state = 'wander'; m.path = null; m.cool = 3;
      break;
    }
  }
};

// 回收車的黃色光圈＝安全區：怪物打不到、會回血（大逃殺沒有安全區）
const BASE_R = 1.85;
function inBase(sim, p) { return sim.mode !== 'br' && Math.hypot(p.x - VAN[0], p.z - VAN[1]) < BASE_R; }
Sim.prototype.step = function (dt) {
  if (this.phase !== 'play') return;
  dt = Math.min(dt, 0.1);
  this.time -= dt;
  if (this.smokes && this.smokes.length) { this.smokes.forEach(function (k) { k.t -= dt; }); this.smokes = this.smokes.filter(function (k) { return k.t > 0; }); }
  const alive = this.players.filter(function (p) { return p.alive; });
  for (let k = 0; k < alive.length; k++) {
    const p = alive[k];
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.bombCd > 0) p.bombCd -= dt;
    if ((p.smCd || 0) > 0) p.smCd -= dt;
    if (p.gunCd > 0) p.gunCd -= dt;
    if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { p.reload = 0; p.ammo = p.clip || 12; } }
    if ((p.skCd || 0) > 0) p.skCd -= dt;
    for (const k of ['shieldT', 'hideT', 'stealthT', 'rallyT']) if ((p[k] || 0) > 0) p[k] -= dt;
    p.hurtT += dt;
    if (inBase(this, p)) { if (p.hp < maxHp(p)) p.hp = Math.min(maxHp(p), p.hp + 15 * dt); }   // 光圈裡每秒回 15 血
    else if (this.mode !== 'br' && p.hurtT > 5 && p.hp < maxHp(p)) p.hp = Math.min(maxHp(p), p.hp + 6 * dt);   // 5 秒沒受傷後慢慢回血
  }
  if (this.mode === 'br') { this._stepBR(dt, alive); return; }
  if (this.mode === 'td') { this._stepTD(dt); return; }
  // 天然災害
  if (this.disT > 0 && this.time <= this.disT) {
    this.disT = -1;
    if (this.disKind === 'quake') {   // 地震：怪物站不穩 3 秒，玩家畫面搖晃並變慢（由各自裝置處理）
      this.monsters.forEach(function (mo) { mo.cool = Math.max(mo.cool, 3); });
      this.events.push({ t: 'quake', dur: 4 });
    } else {                         // 落石／隕石：玩家附近 6 個落點，2.5 秒後砸下
      const pts = [], self2 = this;
      for (let k = 0; k < 6 && alive.length; k++) {
        const q = alive[k % alive.length], sp = this._spotAt(q.x, q.z, k < alive.length ? 0 : 2.5, k < alive.length ? 2.5 : 9) || [q.x, q.z];   // 每位玩家腳邊一顆，其餘散在附近
        pts.push([r2(sp[0]), r2(sp[1])]); self2.strikes.push({ x: sp[0], z: sp[1], t: 2.5 });
      }
      this.events.push({ t: 'strike', pts: pts, delay: 2.5 });
    }
  }
  for (let i = this.strikes.length - 1; i >= 0; i--) {
    const st = this.strikes[i]; st.t -= dt;
    if (st.t > 0) continue;
    this.strikes.splice(i, 1);
    for (let k = 0; k < alive.length; k++) { const p = alive[k]; if (p.alive && !(p.shieldT > 0) && Math.hypot(p.x - st.x, p.z - st.z) < 2.5) { p.hp = Math.max(1, p.hp - 40); p.hurtT = 0; this.events.push({ t: 'hit', id: p.id, by: null, hp: Math.round(p.hp) }); } }
    this.monsters.forEach(function (mo) { if (Math.hypot(mo.x - st.x, mo.z - st.z) < 2.5) mo.cool = Math.max(mo.cool, 3); });
    this.events.push({ t: 'boom', x: r2(st.x), z: r2(st.z) });
  }
  // 載具：按「車」上下推車
  if (this.veh) {
    const v = this.veh;
    for (let k = 0; k < this.players.length; k++) {
      const p = this.players[k];
      if (p.veh && !p.alive) { p.veh = false; v.rider = null; }
      if (!p.vq) continue;
      p.vq = false;
      if (p.veh) { p.veh = false; v.rider = null; this.events.push({ t: 'veh', id: p.id, on: false }); }
      else if (p.alive && !v.rider && Math.hypot(p.x - v.x, p.z - v.z) < 2.4) { p.veh = true; v.rider = p.id; this.events.push({ t: 'veh', id: p.id, on: true }); }
    }
    if (v.rider) { const rp = this.player(v.rider); if (rp && rp.veh) { v.x = rp.x; v.z = rp.z; } else v.rider = null; }
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
      if (p.bag.length < bagCap(p) && Math.hypot(it.x - p.x, it.z - p.z) < 1.5) {
        it.taken = true; p.bag.push(i);
        this.events.push({ t: 'pickup', id: p.id, i: i });
        break;
      }
    }
  }
  for (let k = 0; k < alive.length; k++) {
    const p = alive[k];
    // 傳送陣：身上集滿 3 件時，在附近隨機出現；踩上去會被傳回基地
    if (!this.pad && p.bag.length >= bagCap(p)) {
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
      if (p.pet === 3) sum = Math.round(sum * 1.1);
      if (p.gems && p.gems[2]) sum = Math.round(sum * (1 + 0.03 * p.gems[2]));   // 黃寶石   // 寵物小機器人：賣出 +10%
      p.bag = []; this.money += sum; p.earned += sum;
      this.events.push({ t: 'sell', id: p.id, sum: sum });
    }
  }
  if (this.money >= this.quota) { this._end(true, 'quota'); return; }
  for (let i = 0; i < this.monsters.length; i++) {
    if (i % 4 !== 2) continue;
    const mo = this.monsters[i];
    if (mo.dead > 0) continue;
    for (let k = 0; k < alive.length; k++) { const p = alive[k]; if (!inBase(this, p) && Math.hypot(p.x - mo.x, p.z - mo.z) < 3) { p.hp = Math.max(1, p.hp - 6 * dt); p.hurtT = 0; } }
  }
  for (let i = 0; i < this.monsters.length; i++) this._monster(this.monsters[i], i, dt, alive);
  if (!this.players.some(function (p) { return p.alive; })) { this._end(false, 'dead'); return; }
  if (this.time <= 0) this._end(false, 'time');
};

Sim.prototype.snapshot = function () {
  let it = '';
  for (let i = 0; i < this.items.length; i++) it += this.items[i].taken ? '1' : '0';
  return { t: 's', zr: this.zone ? r2(this.zone.r) : undefined, ph: this.phase, day: this.day, money: this.money, quota: this.quota, time: Math.round(this.time * 10) / 10,
    p: this.players.map(function (p) {
      return [p.id, r2(p.x), r2(p.z), r2(p.yaw), p.alive ? 1 : 0, p.bag.length, (p.run ? 1 : 0) | (p.spk ? 2 : 0) | (p.loud ? 4 : 0) | (p.air ? 8 : 0), Math.round(p.hp), p.ammo || 0, p.reload > 0 ? 1 : 0, p.bombs || 0];
    }),
    bk: BROKEN.length ? BROKEN : undefined,
    td: this.td ? [this.td.core, this.td.left + this.monsters.filter(function (m) { return !m.idle; }).length, this.td.total] : undefined,
    tw: this.towers && this.towers.length ? this.towers.map(function (t) { return [t.x, t.z]; }) : undefined,
    veh: this.veh ? [r2(this.veh.x), r2(this.veh.z), this.veh.rider || 0] : undefined,
    pad: this.pad ? [r2(this.pad[0]), r2(this.pad[1])] : null,
    tr: this.trophy ? [r2(this.trophy[0]), r2(this.trophy[1])] : null,
    bp: this.boardPos ? [r2(this.boardPos[0]), r2(this.boardPos[1])] : null,
    tt: this.tt ? [this.tt.cells.map(function (c) { return c || '.'; }).join(''), this.tt.turn, this.tt.x, this.tt.o, this.tt.over, this.tt.winner] : null,
    m: this.monsters.map(function (m) { return [r2(m.x), r2(m.z), r2(m.rot), m.state === 'chase' ? 1 : 0, m.dead > 0 ? 0 : Math.max(1, Math.round(m.hp))]; }),
    it: it };
};

const api = { MAPS: MAPS, CS: CS, WH: WH, BAG_MAX: BAG_MAX, DAY_TIME: DAY_TIME, MAX_PLAYERS: MAX_PLAYERS,
  KINDS: KINDS, CHARS: CHARS, WEAPONS: WEAPONS, GUNS: GUNS, BASE_R: BASE_R, HATS: HATS, COSTUMES: COSTUMES, PETS: PETS, WEATHERS: WEATHERS, ACCS: ACCS, ACC_NOTE: ACC_NOTE, GEMS: GEMS, GEM_NOTE: GEM_NOTE, isWall: isWall, breakWall: breakWall, restoreMap: restoreMap, cellOf: cellOf, center: center, blocked: blocked, los: los, bfs: bfs,
  quotaFor: quotaFor, Sim: Sim, setMap: setMap };

/** 切換目前地圖（碰撞、視線、尋路都跟著換）。房主與每位玩家各自呼叫。 */
/** 炸開一格牆（最外圈不能炸）。成功回傳 true。 */
function breakWall(c, r) {
  if (!(r > 0 && c > 0 && r < ROWS - 1 && c < COLS - 1) || MAP[r][c] !== '#') return false;
  MAP[r] = MAP[r].slice(0, c) + '.' + MAP[r].slice(c + 1);
  floorCells.push([c, r]); BROKEN.push([c, r]);
  return true;
}
/** 把炸開的牆恢復原狀（每天開始時）。有恢復回傳 true。 */
function restoreMap() {
  if (!BROKEN.length) return false;
  const i = mapIndex; mapIndex = -1; setMap(i);
  return true;
}
function setMap(i) {
  i = pick(i, MAPS.length);
  if (i === mapIndex) return i;
  mapIndex = i; MAP = MAPS[i].rows.slice(); BROKEN = []; ROWS = MAP.length;   // 複製一份：牆可以被炸開，但不能改到原始地圖 COLS = MAP[0].length;
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
