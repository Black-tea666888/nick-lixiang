/* 雲端（Firebase Firestore）：存檔同步、排行榜、區域賽季、好友、戰隊。
 * 沒有設定 Firebase、或玩家用本機訪客時，全部功能安靜地停用（RR.Cloud.ready() 為 false）。
 * 注意：分數由玩家裝置回報，沒有伺服器驗證；安全規則只保證「不能改別人的資料」。 */
(function () {
'use strict';
const RR = window.RR = window.RR || {};

const REGIONS = ['台灣', '港澳', '日本', '韓國', '東南亞', '北美', '歐洲', '其他'];
const REGION_KEY = ['tw', 'hk', 'jp', 'kr', 'sea', 'na', 'eu', 'xx'];
const MODES = ['coop', 'hunt', 'td', 'br'];
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function rcode(n) { let s = ''; for (let i = 0; i < n; i++) s += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; return s; }
function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
/** 週次：以台灣時間每週一 00:00 換週 */
function weekId(off) { return Math.floor((Date.now() / 864e5 + 8 / 24 + 3) / 7) + (off || 0); }

let db = null, uid = null, me = null, saveT = null, beatT = null, room = null;
const H = { prog: function () { return {}; }, adopt: function () {}, name: function () { return '玩家'; }, level: function () { return 1; } };

function userRef(id) { return db.collection('users').doc(id || uid); }
function fail(cb) { return function (e) { console.warn('cloud', e && (e.code || e.message)); if (cb) cb(e || { code: 'unknown' }); }; }
function clean(s, n) { return String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n); }

function profile() {
  const p = H.prog();
  return { name: clean(H.name(), 12), lv: H.level(), coins: p.coins | 0, xp: p.xp | 0, region: REGION_KEY[p.region | 0] || 'tw',
    prog: JSON.stringify(p), seen: Date.now(), room: room || '', v: 1 };
}
function push() {
  if (!db || !uid) return;
  const d = profile();
  if (me && me.code) d.code = me.code;
  userRef().set(d, { merge: true }).catch(fail());
}

const Cloud = {
  REGIONS: REGIONS, MODES: MODES, weekId: weekId,
  ready: function () { return !!(db && uid); },
  uid: function () { return uid; },
  me: function () { return me; },
  /** main.js 提供：prog() 讀本機進度、adopt(p) 採用雲端進度、name()、level() */
  hooks: function (h) { Object.keys(h).forEach(function (k) { H[k] = h[k]; }); },

  /** 登入狀態改變時呼叫。user 為 null 或本機訪客時停用雲端。 */
  onUser: function (user, cb) {
    clearInterval(beatT); beatT = null; uid = null; me = null;
    const fb = window.firebase;
    if (!user || !fb || !fb.firestore || !(RR.CONFIG && RR.CONFIG.firebase) || /^guest-/.test(user.uid)) { if (cb) cb(false); return; }
    try { db = db || fb.firestore(); } catch (e) { db = null; if (cb) cb(false); return; }
    uid = user.uid;
    userRef().get().then(function (snap) {
      const local = H.prog();
      me = snap.exists ? snap.data() : {};
      if (snap.exists && me.prog) {
        let remote = null; try { remote = JSON.parse(me.prog); } catch (e) {}
        // 進度以經驗值高的為準（換手機、清資料後能拿回來）
        if (remote && (remote.xp | 0) > (local.xp | 0)) H.adopt(remote);
      }
      if (!me.code) me.code = rcode(6);
      push();
      beatT = setInterval(function () { if (!document.hidden) userRef().set({ seen: Date.now(), room: room || '' }, { merge: true }).catch(fail()); }, 90000);
      if (cb) cb(true);
    }).catch(function (e) { fail()(e); uid = null; if (cb) cb(false); });
  },
  /** 本機進度有變時呼叫；3 秒內的多次變更合併成一次寫入 */
  saveSoon: function () { if (!Cloud.ready()) return; clearTimeout(saveT); saveT = setTimeout(push, 3000); },
  /** 目前所在的房間代碼（好友可以直接加入）；離開時傳 null */
  setRoom: function (code) { room = code || null; if (Cloud.ready()) userRef().set({ room: room || '', seen: Date.now() }, { merge: true }).catch(fail()); },

  /* ---------- 排行榜 ---------- */
  board: function (mode, scope) { return 'lb_' + mode + '_' + scope; },
  /** 回報成績：總榜、本週榜、本週地區榜各留最高分 */
  submit: function (mode, score) {
    if (!Cloud.ready() || MODES.indexOf(mode) < 0 || !(score > 0)) return;
    const p = profile(), w = weekId(), row = { name: p.name, lv: p.lv, score: Math.floor(score), region: p.region, clan: (me && me.clanTag) || '', t: Date.now() };
    ['all', 'w' + w, p.region + '_w' + w].forEach(function (scope) {
      const ref = db.collection(Cloud.board(mode, scope)).doc(uid);
      ref.get().then(function (s) {
        // 大逃殺是累計勝場，其餘取最高紀錄
        if (mode === 'br') row.score = ((s.exists && s.data().score) | 0) + Math.floor(score);
        else if (s.exists && (s.data().score | 0) >= row.score) return;
        return ref.set(Object.assign({}, row));
      }).catch(fail());
    });
  },
  /** 讀前 20 名。cb(err, rows) */
  top: function (mode, scope, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    db.collection(Cloud.board(mode, scope)).orderBy('score', 'desc').limit(20).get().then(function (q) {
      const rows = []; q.forEach(function (d) { const x = d.data(); x.uid = d.id; rows.push(x); }); cb(null, rows);
    }).catch(fail(cb));
  },

  /* ---------- 好友（用 6 碼好友代碼互加，加了雙方都看得到） ---------- */
  addFriend: function (code, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (code.length !== 6) { cb({ code: 'bad-code' }); return; }
    if (me && code === me.code) { cb({ code: 'self' }); return; }
    db.collection('users').where('code', '==', code).limit(1).get().then(function (q) {
      if (q.empty) { cb({ code: 'not-found' }); return; }
      const other = q.docs[0], od = other.data(), now = Date.now();
      return userRef().collection('friends').doc(other.id).set({ name: od.name || '玩家', since: now }).then(function () {
        return userRef(other.id).collection('friends').doc(uid).set({ name: profile().name, since: now });
      }).then(function () { cb(null, od.name || '玩家'); });
    }).catch(fail(cb));
  },
  removeFriend: function (fid, cb) {
    if (!Cloud.ready()) return;
    userRef().collection('friends').doc(fid).delete().then(function () { return userRef(fid).collection('friends').doc(uid).delete(); })
      .then(function () { if (cb) cb(null); }).catch(fail(cb));
  },
  /** cb(err, [{uid, name, lv, online, room}])，線上的排前面 */
  friends: function (cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    userRef().collection('friends').get().then(function (q) {
      const ids = []; q.forEach(function (d) { ids.push(d.id); });
      return Promise.all(ids.slice(0, 40).map(function (id) { return userRef(id).get(); }));
    }).then(function (snaps) {
      const now = Date.now(), rows = [];
      snaps.forEach(function (s) { if (!s.exists) return; const d = s.data(); rows.push({ uid: s.id, name: d.name || '玩家', lv: d.lv | 0, online: now - (Number(d.seen) || 0) < 200000, room: d.room || '', clan: d.clanTag || '' }); });
      rows.sort(function (a, b) { return (b.online - a.online) || (b.lv - a.lv); });
      cb(null, rows);
    }).catch(fail(cb));
  },

  /* ---------- 戰隊 ---------- */
  createClan: function (name, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    name = clean(name, 12);
    if (name.length < 2) { cb({ code: 'bad-name' }); return; }
    if (me && me.clan) { cb({ code: 'in-clan' }); return; }
    const tag = rcode(4), ref = db.collection('clans').doc();
    ref.set({ name: name, tag: tag, owner: uid, count: 1, score: 0, created: Date.now() }).then(function () {
      return ref.collection('members').doc(uid).set({ name: profile().name, score: 0, joined: Date.now() });
    }).then(function () {
      me.clan = ref.id; me.clanTag = tag; me.clanName = name;
      return userRef().set({ clan: ref.id, clanTag: tag, clanName: name }, { merge: true });
    }).then(function () { cb(null, { id: ref.id, tag: tag, name: name }); }).catch(fail(cb));
  },
  joinClan: function (tag, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    tag = String(tag || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (tag.length !== 4) { cb({ code: 'bad-code' }); return; }
    if (me && me.clan) { cb({ code: 'in-clan' }); return; }
    db.collection('clans').where('tag', '==', tag).limit(1).get().then(function (q) {
      if (q.empty) { cb({ code: 'not-found' }); return; }
      const c = q.docs[0], cd = c.data();
      if ((cd.count | 0) >= 30) { cb({ code: 'full' }); return; }
      return c.ref.collection('members').doc(uid).set({ name: profile().name, score: 0, joined: Date.now() }).then(function () {
        return c.ref.update({ count: window.firebase.firestore.FieldValue.increment(1) });
      }).then(function () {
        me.clan = c.id; me.clanTag = cd.tag; me.clanName = cd.name;
        return userRef().set({ clan: c.id, clanTag: cd.tag, clanName: cd.name }, { merge: true });
      }).then(function () { cb(null, { id: c.id, tag: cd.tag, name: cd.name }); });
    }).catch(fail(cb));
  },
  leaveClan: function (cb) {
    if (!Cloud.ready() || !me || !me.clan) { if (cb) cb({ code: 'no-clan' }); return; }
    const ref = db.collection('clans').doc(me.clan);
    ref.collection('members').doc(uid).delete().then(function () {
      return ref.update({ count: window.firebase.firestore.FieldValue.increment(-1) });
    }).then(function () {
      me.clan = ''; me.clanTag = ''; me.clanName = '';
      return userRef().set({ clan: '', clanTag: '', clanName: '' }, { merge: true });
    }).then(function () { if (cb) cb(null); }).catch(fail(cb));
  },
  /** 每局結束把得分貢獻給戰隊 */
  clanAdd: function (pts) {
    if (!Cloud.ready() || !me || !me.clan || !(pts > 0)) return;
    const inc = window.firebase.firestore.FieldValue.increment(Math.floor(pts)), ref = db.collection('clans').doc(me.clan);
    ref.collection('members').doc(uid).set({ name: profile().name, score: inc }, { merge: true }).catch(fail());
    ref.update({ score: inc }).catch(fail());
  },
  /** cb(err, { clan, members }) */
  clan: function (cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    if (!me || !me.clan) { cb(null, null); return; }
    const ref = db.collection('clans').doc(me.clan);
    Promise.all([ref.get(), ref.collection('members').get()]).then(function (r) {
      if (!r[0].exists) { cb(null, null); return; }
      const members = []; r[1].forEach(function (d) { const x = d.data(); x.uid = d.id; members.push(x); });
      members.sort(function (a, b) { return (b.score | 0) - (a.score | 0); });
      const c = r[0].data(); c.id = r[0].id;
      cb(null, { clan: c, members: members });
    }).catch(fail(cb));
  },
  topClans: function (cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    db.collection('clans').orderBy('score', 'desc').limit(20).get().then(function (q) {
      const rows = []; q.forEach(function (d) { const x = d.data(); x.id = d.id; rows.push(x); }); cb(null, rows);
    }).catch(fail(cb));
  },
  message: function (e) {
    const c = e && e.code;
    return { offline: '雲端功能要先登入（Google 或訪客）並連上網路。', 'bad-code': '代碼格式不對。', self: '這是你自己的代碼。', 'not-found': '找不到這個代碼。',
      'bad-name': '名稱至少 2 個字。', 'in-clan': '你已經在一個戰隊裡，請先退出。', full: '這個戰隊已滿（30 人）。', 'no-clan': '你不在任何戰隊。',
      'permission-denied': '雲端拒絕了這個操作：請確認 Firestore 的安全規則已經發布。', unavailable: '連不到雲端，請檢查網路。' }[c] || ('雲端錯誤：' + (c || (e && e.message) || '未知'));
  }
};
RR.Cloud = Cloud;
})();
