/* 雲端（Firebase Firestore）：存檔同步、排行榜、區域賽季、好友、戰隊。
 * 沒有設定 Firebase、或玩家用本機訪客時，全部功能安靜地停用（RR.Cloud.ready() 為 false）。
 * 注意：分數由玩家裝置回報，沒有伺服器驗證；安全規則只保證「不能改別人的資料」。 */
(function () {
'use strict';
const RR = window.RR = window.RR || {};

const REGIONS = ['台灣', '香港'];
const REGION_KEY = ['tw', 'hk'];
const MODES = ['coop', 'hunt', 'td', 'br'];
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function rcode(n) { let s = ''; for (let i = 0; i < n; i++) s += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; return s; }
function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
/** 週次：以台灣時間每週一 00:00 換週 */
function weekId(off) { return Math.floor((Date.now() / 864e5 + 8 / 24 + 3) / 7) + (off || 0); }
/** 戰隊段位：依「本週積分」分級，每週一重算；best 記錄歷史最高段位（索引） */
const TIERS = [
  { n: '青銅', min: 0 }, { n: '白銀', min: 300 }, { n: '黃金', min: 800 }, { n: '白金', min: 1800 },
  { n: '鑽石', min: 3500 }, { n: '大師', min: 6000 }, { n: '宗師', min: 10000 }
];
function tierOf(s) { let i = 0; for (let k = 0; k < TIERS.length; k++) if ((s | 0) >= TIERS[k].min) i = k; return i; }

let db = null, uid = null, me = null, saveT = null, savePending = false, beatT = null, room = null, fsLoading = false;
const H = { prog: function () { return {}; }, adopt: function () {}, name: function () { return '玩家'; }, level: function () { return 1; } };

function userRef(id) { return db.collection('users').doc(id || uid); }
function fail(cb) { return function (e) { console.warn('cloud', e && (e.code || e.message)); if (cb) cb(e || { code: 'unknown' }); }; }
function clean(s, n) { return String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n); }

function saveRef(id) { return userRef(id).collection('save').doc('main'); }
/** 裝備與造型跟著帳號走，換裝置也一樣；按鍵位置、音效、靈敏度等仍留在每台裝置 */
const LOADOUT_KEYS = ['rr_c', 'rr_w', 'rr_h', 'rr_o', 'rr_pet', 'rr_gun', 'rr_gs', 'rr_is', 'rr_ms', 'rr_fx', 'rr_eq', 'rr_map'];
const SYNC_KEYS = ['rr_trades', 'rr_best'];   // 交易紀錄、最高紀錄：跟著帳號合併
function loadoutSnap() {
  const v = {}; let t = 0;
  try { LOADOUT_KEYS.forEach(function (k) { const x = localStorage.getItem(k); if (x !== null) v[k] = x; }); t = +localStorage.getItem('rr_lo_t') || 0; } catch (e) {}
  return { t: t, v: v };
}
/** 交易紀錄與最高紀錄：合併雙方的內容（交易按時間合併，最高紀錄取較大的） */
function localJson(k, dflt) { try { const x = JSON.parse(localStorage.getItem(k) || 'null'); return x == null ? dflt : x; } catch (e) { return dflt; } }
function tradesMerge(a, b) {
  const seen = {}, out = [];
  (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []).forEach(function (r) { if (r && !seen[r.t + ':' + r.k]) { seen[r.t + ':' + r.k] = 1; out.push(r); } });
  out.sort(function (x, y) { return (y.t || 0) - (x.t || 0); });
  return out.slice(0, 50);
}
/** 雲端的裝備比較新（時間較晚）才採用，否則保留本機的 */
function loadoutAdopt(remote) {
  if (!remote || typeof remote !== 'object' || !remote.v) return;
  let t = 0; try { t = +localStorage.getItem('rr_lo_t') || 0; } catch (e) {}
  if ((+remote.t || 0) <= t) return;
  try {
    LOADOUT_KEYS.forEach(function (k) { if (typeof remote.v[k] === 'string') localStorage.setItem(k, remote.v[k]); else localStorage.removeItem(k); });
    localStorage.setItem('rr_lo_t', String(remote.t));
  } catch (e) {}
}
/** 頭像：底色與 64×64 小照片一起上傳，別人點你的頭像、戰績都看得到（太大的照片就不傳） */
function avatarData() {
  let av = '', img = ''; try { av = localStorage.getItem('rr_avatar') || ''; img = localStorage.getItem('rr_avatar_img') || ''; } catch (e) {}
  return { av: clean(av, 20), avImg: img.length < 12000 ? img : '' };
}
function profile() {
  const p = H.prog(), st = p.st || {};
  return Object.assign({ name: clean(H.name(), 12), bio: clean(p.bio, 30), ach: (Array.isArray(p.ach) ? p.ach : []).slice(0, 80).map(function (a) { return clean(a, 16); }), lv: H.level(), coins: p.coins | 0, xp: p.xp | 0, region: REGION_KEY[p.region | 0] || 'tw',
    st: { games: st.games | 0, wins: st.wins | 0, mk: st.mk | 0, brWins: st.brWins | 0 }, seen: Date.now(), room: room || '', v: 1 }, avatarData());
}
/** 公開資料寫在 users 文件；進度寫在只有本人能讀的 save/main（舊版進度欄位會順便清掉） */
function push() {
  if (!db || !uid) return;
  const d = profile(), FV = window.firebase.firestore.FieldValue;
  if (me && me.code) d.code = me.code;
  if (me && me.prog) d.prog = FV.delete();
  userRef().set(d, { merge: true }).catch(fail());
  saveRef().set({ prog: JSON.stringify(H.prog()), seen: Date.now(), loadout: loadoutSnap(), trades: localJson('rr_trades', []), best: parseInt(localStorage.getItem('rr_best') || '0', 10) || 0 }).catch(fail());
}

const Cloud = {
  REGIONS: REGIONS, MODES: MODES, weekId: weekId, TIERS: TIERS, tierOf: tierOf,
  ready: function () { return !!(db && uid); },
  /** 本機的同步資料改了（裝備、交易紀錄、最高紀錄）：記下時間並存雲端（main.js 的 lsSet 會呼叫） */
  localChanged: function (k) {
    if (LOADOUT_KEYS.indexOf(k) >= 0) { try { localStorage.setItem('rr_lo_t', String(Date.now())); } catch (e) {} }
    else if (SYNC_KEYS.indexOf(k) < 0) return;
    Cloud.saveSoon();
  },
  uid: function () { return uid; },
  me: function () { return me; },
  /** main.js 提供：prog() 讀本機進度、adopt(p) 採用雲端進度、name()、level() */
  hooks: function (h) { Object.keys(h).forEach(function (k) { H[k] = h[k]; }); },

  /** 登入狀態改變時呼叫。user 為 null 或本機訪客時停用雲端。 */
  onUser: function (user, cb) {
    clearInterval(beatT); beatT = null; uid = null; me = null;
    const fb = window.firebase;
    if (!user || !fb || !(RR.CONFIG && RR.CONFIG.firebase) || /^guest-/.test(user.uid)) { if (cb) cb(false); return; }
    // Firestore SDK 有 550 KB，只在真的登入雲端帳號時才下載，訪客與首次載入都更快
    if (!fb.firestore) {
      if (fsLoading) return;
      fsLoading = true;
      const sc = document.createElement('script'); sc.src = 'vendor/firebase-firestore-compat.js';
      sc.onload = function () { fsLoading = false; Cloud.onUser(user, cb); };
      sc.onerror = function () { fsLoading = false; if (cb) cb(false); };
      document.head.appendChild(sc); return;
    }
    try { db = db || fb.firestore(); } catch (e) { db = null; if (cb) cb(false); return; }
    uid = user.uid;
    Promise.all([userRef().get(), saveRef().get().catch(function () { return null; })]).then(function (r) {
      const snap = r[0], sv = r[1], local = H.prog();
      me = snap.exists ? snap.data() : {};
      // 頭像以雲端為準：換手機登入後，底色與照片會跟著過來
      if (me.av !== undefined || me.avImg !== undefined) { try { if (me.av) localStorage.setItem('rr_avatar', me.av); else localStorage.removeItem('rr_avatar'); if (me.avImg) localStorage.setItem('rr_avatar_img', me.avImg); else localStorage.removeItem('rr_avatar_img'); } catch (e) {} }
      let raw = (sv && sv.exists) ? sv.data().prog : me.prog;   // 舊版進度還在 users 文件裡時也讀得到
      let remote = null; try { remote = raw ? JSON.parse(raw) : null; } catch (e) {}
      // 進度以經驗值高的為準（換手機、清資料後能拿回來）
      if (remote && (remote.xp | 0) > (local.xp | 0)) H.adopt(remote);
      loadoutAdopt(sv && sv.exists ? sv.data().loadout : null);
      if (sv && sv.exists) {
        const sd = sv.data(), bestHere = parseInt(localStorage.getItem('rr_best') || '0', 10) || 0;
        try {
          localStorage.setItem('rr_trades', JSON.stringify(tradesMerge(localJson('rr_trades', []), sd.trades)));
          if ((sd.best | 0) > bestHere) localStorage.setItem('rr_best', String(sd.best | 0));
        } catch (e) {}
      }
      if (!me.code) me.code = rcode(6);
      push();
      beatT = setInterval(function () { if (!document.hidden) userRef().set({ seen: Date.now(), room: room || '' }, { merge: true }).catch(fail()); }, 90000);
      if (cb) cb(true);
    }).catch(function (e) { fail()(e); uid = null; if (cb) cb(false); });
  },
  /** 本機進度有變時呼叫；3 秒內的多次變更合併成一次寫入 */
  saveSoon: function () { if (!Cloud.ready()) return; clearTimeout(saveT); savePending = true; saveT = setTimeout(function () { savePending = false; push(); }, 3000); },
  /** 關頁、切到背景時立刻寫入還沒送出的進度（抽獎、交易後 3 秒內離開也不會遺失） */
  flush: function () { if (savePending && Cloud.ready()) { clearTimeout(saveT); savePending = false; push(); } },
  /** 目前所在的房間代碼（好友可以直接加入）；離開時傳 null */
  setRoom: function (code) { room = code || null; if (Cloud.ready()) userRef().set({ room: room || '', seen: Date.now() }, { merge: true }).catch(fail()); },

  /** 刪除雲端上所有屬於自己的資料：進度、排行榜、好友、戰隊發言、戰隊身分。
   * 隊長要先把位子轉給別人。Firebase 登入帳號另外由 RR.Auth.deleteAccount() 刪除。cb(err) */
  deleteMyData: function (cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    const id = uid, U = userRef(id), clanId = me && me.clan;
    const dropAll = function (q) { return Promise.all(q.docs.map(function (d) { return d.ref.delete(); })); };
    let chain = Promise.resolve();
    if (clanId) {
      chain = db.collection('clans').doc(clanId).get().then(function (s) {
        if (s.exists && s.data().owner === id) throw { code: 'owner' };
        return db.collection('clans').doc(clanId).collection('msgs').where('uid', '==', id).get();
      }).then(dropAll).then(function () {
        return new Promise(function (res, rej) { Cloud.leaveClan(function (e) { if (e && e.code !== 'no-clan') rej(e); else res(); }); });
      });
    }
    return chain.then(function () {
      return db.collection('world').where('uid', '==', id).get().then(dropAll);
    }).then(function () {
      return db.collection('market').where('seller', '==', id).where('status', '==', 'open').get().then(dropAll).catch(function () {});
    }).then(function () {
      return U.get();
    }).then(function (s) {
      const boards = (s.exists && s.data().boards) || [];
      return Promise.all(boards.map(function (p) { return db.doc(p).delete().catch(function () {}); }));
    }).then(function () {
      return U.collection('friends').get();
    }).then(function (q) {
      const ids = []; q.forEach(function (d) { ids.push(d.id); });
      return Promise.all(ids.map(function (fid) { return userRef(fid).collection('friends').doc(id).delete().catch(function () {}); }))
        .then(function () { return dropAll(q); });
    }).then(function () {
      return U.collection('matches').get().then(dropAll);
    }).then(function () {
      return U.collection('save').doc('main').delete();
    }).then(function () {
      return U.delete();
    }).then(function () {
      clearInterval(beatT); beatT = null; uid = null; me = null;
      cb(null);
    }).catch(fail(cb));
  },

  /* ---------- 歷史戰績 ---------- */
  /** 存一場戰績，雲端只留最近 30 場（多的刪掉） */
  addMatch: function (rec) {
    if (!Cloud.ready()) return;
    const col = userRef().collection('matches');
    col.add(rec).then(function () { return col.orderBy('t', 'desc').offset(30).limit(50).get(); })
      .then(function (q) { return Promise.all(q.docs.map(function (d) { return d.ref.delete(); })); }).catch(fail());
  },
  /** 讀某個玩家的公開資料與最近 30 場戰績。cb(err, { prof, rows }) */
  playerStats: function (id, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    Promise.all([userRef(id).get(), userRef(id).collection('matches').orderBy('t', 'desc').limit(30).get()]).then(function (r) {
      const rows = []; r[1].forEach(function (d) { rows.push(d.data()); });
      cb(null, { prof: r[0].exists ? r[0].data() : null, rows: rows });
    }).catch(fail(cb));
  },

  /* ---------- 快速組隊：公開房間 ---------- */
  roomPublish: function (code, info) {
    if (!Cloud.ready() || !code) return;
    db.collection('rooms').doc(code).set({ code: code, host: uid, hostName: profile().name, lv: profile().lv | 0, mode: info.mode || 'coop', map: info.map || '', n: info.n | 0, max: info.max || 4, play: !!info.play, t: Date.now() }).catch(fail());
  },
  roomClose: function (code) { if (Cloud.ready() && code) db.collection('rooms').doc(code).delete().catch(function () {}); },
  /** 即時訂閱公開房間：只留 2.5 分鐘內有更新、還沒滿的房間 */
  roomsWatch: function (onRows) {
    if (!Cloud.ready()) { onRows({ code: 'offline' }); return function () {}; }
    return db.collection('rooms').orderBy('t', 'desc').limit(40).onSnapshot(function (q) {
      const now = Date.now(), rows = [];
      q.forEach(function (d) { const x = d.data(); if (now - (x.t || 0) < 150000 && (x.n | 0) < (x.max || 4) && x.host !== uid) rows.push(x); });
      onRows(null, rows);
    }, fail(onRows));
  },

  /* ---------- 世界頻道與交易所 ---------- */
  /** 即時訂閱世界頻道最新 50 則；回傳取消函式。onRows(err, rows)（新到舊） */
  worldChat: function (onRows) {
    if (!Cloud.ready()) { onRows({ code: 'offline' }); return function () {}; }
    return db.collection('world').orderBy('t', 'desc').limit(50).onSnapshot(function (q) {
      const rows = []; q.forEach(function (d) { const x = d.data(); x.id = d.id; rows.push(x); }); onRows(null, rows);
    }, fail(onRows));
  },
  worldSay: function (text, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    text = clean(text, 80); if (!text) { cb(null); return; }
    db.collection('world').add({ uid: uid, name: profile().name, lv: profile().lv | 0, text: text, t: Date.now() }).then(function () { cb(null); }).catch(fail(cb));
  },
  /** 即時訂閱交易所的掛單（open 的最多 80 筆，新到舊） */
  marketWatch: function (onRows) {
    if (!Cloud.ready()) { onRows({ code: 'offline' }); return function () {}; }
    return db.collection('market').where('status', '==', 'open').limit(80).onSnapshot(function (q) {
      const rows = []; q.forEach(function (d) { const x = d.data(); x.id = d.id; rows.push(x); });
      rows.sort(function (a, b) { return (b.t || 0) - (a.t || 0); }); onRows(null, rows);
    }, fail(onRows));
  },
  /** 掛單：item = { cat, i }（造型）、{ i }（配件或寶石）；呼叫前本機要先把東西扣掉 */
  marketPost: function (kind, item, label, price, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    db.collection('market').add({ seller: uid, sellerName: profile().name, kind: kind, item: item, label: clean(label, 30), price: Math.floor(price), status: 'open', t: Date.now() })
      .then(function (r) { cb(null, r.id); }).catch(fail(cb));
  },
  /** 下架：成功才把東西還給賣家 */
  marketCancel: function (id, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    const ref = db.collection('market').doc(id);
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (s) {
        if (!s.exists || s.data().seller !== uid) throw { code: 'gone' };
        if (s.data().status !== 'open') throw { code: 'sold' };
        tx.update(ref, { status: 'cancel' }); return s.data();
      });
    }).then(function (d) { ref.delete().catch(function () {}); cb(null, d); }).catch(fail(cb));
  },
  /** 購買：交易成功（搶到）才回傳掛單內容，呼叫端再扣金幣、給東西，最後 marketGot 標記已收貨 */
  marketBuy: function (id, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    const ref = db.collection('market').doc(id);
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (s) {
        if (!s.exists) throw { code: 'gone' };
        const d = s.data();
        if (d.seller === uid) throw { code: 'own-offer' };
        if (d.status !== 'open') throw { code: 'sold' };
        tx.update(ref, { status: 'sold', buyer: uid, buyerName: profile().name, tb: Date.now() }); return d;
      });
    }).then(function (d) { cb(null, d); }).catch(fail(cb));
  },
  marketGot: function (id) { if (Cloud.ready()) db.collection('market').doc(id).update({ got: true }).catch(fail()); },
  /** 賣家收款：找出自己已賣出、還沒收款的掛單。cb(err, [{id, price, label, buyerName}]) */
  marketPayouts: function (cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    db.collection('market').where('seller', '==', uid).where('status', '==', 'sold').get().then(function (q) {
      const out = [];
      q.forEach(function (d) { const x = d.data(); if (!x.paid) out.push({ id: d.id, price: x.price | 0, label: x.label, buyerName: x.buyerName || '玩家', got: !!x.got }); });
      return Promise.all(out.map(function (o) { return db.collection('market').doc(o.id).update({ paid: true }).then(function () { return o; }, function () { return null; }); }));
    }).then(function (rows) { cb(null, rows.filter(Boolean)); }).catch(fail(cb));
  },

  /* ---------- 排行榜 ---------- */
  /** 刪掉自己在「其他地區」本週榜上的紀錄（換地區後不會同時出現在兩區）；mode 省略＝全部模式 */
  cleanRegions: function (mode) {
    if (!Cloud.ready()) return;
    const mine = profile().region, w = weekId();
    (mode ? [mode] : MODES.concat(['ar'])).forEach(function (m) {
      REGION_KEY.forEach(function (rk) { if (rk !== mine) db.collection(Cloud.board(m, rk + '_w' + w)).doc(uid).delete().catch(function () {}); });
    });
  },
  board: function (mode, scope) { return 'lb_' + mode + '_' + scope; },
  /** 回報成績：總榜、本週榜、本週地區榜各留最高分 */
  submit: function (mode, score) {
    if (!Cloud.ready() || (MODES.indexOf(mode) < 0 && mode !== 'ar') || !(score > 0)) return;
    const p = profile(), w = weekId(), row = { name: p.name, lv: p.lv, score: Math.floor(score), region: p.region, clan: (me && me.clanTag) || '', t: Date.now() };
    ['all', 'w' + w, p.region + '_w' + w].forEach(function (scope) {
      const ref = db.collection(Cloud.board(mode, scope)).doc(uid);
      ref.get().then(function (s) {
        // 大逃殺是累計勝場，其餘取最高紀錄
        if (mode === 'br' || mode === 'ar') row.score = ((s.exists && s.data().score) | 0) + Math.floor(score);   // AR 是累計抓到的隻數
        else if (s.exists && (s.data().score | 0) >= row.score) return;
        return ref.set(Object.assign({}, row));
      }).catch(fail());
    });
    Cloud.cleanRegions(mode);   // 一個人只會在自己地區的榜上，其他地區本週的舊紀錄刪掉
    // 記下寫過哪些排行榜文件，刪除資料時才找得到
    const paths = ['all', 'w' + w, p.region + '_w' + w].map(function (s) { return Cloud.board(mode, s) + '/' + uid; });
    userRef().set({ boards: window.firebase.firestore.FieldValue.arrayUnion.apply(null, paths) }, { merge: true }).catch(fail());
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
  /** 用名字搜尋玩家（開頭相同就算），cb(err, [{uid, name, lv, code}]) */
  searchUsers: function (text, cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    text = clean(text, 12); if (!text) { cb(null, []); return; }
    db.collection('users').where('name', '>=', text).where('name', '<=', text + '\uf8ff').limit(12).get().then(function (q) {
      const rows = []; q.forEach(function (d) { const x = d.data(); if (d.id !== uid && x.code) rows.push({ uid: d.id, name: x.name || '玩家', lv: x.lv | 0, code: x.code }); });
      cb(null, rows);
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
  /** 隊長設定或取消副隊長（寫在戰隊文件的 deputies 陣列裡） */
  setDeputy: function (target, on, cb) {
    if (!Cloud.ready() || !me || !me.clan) { if (cb) cb({ code: 'no-clan' }); return; }
    const FV = window.firebase.firestore.FieldValue;
    db.collection('clans').doc(me.clan).update({ deputies: on ? FV.arrayUnion(target) : FV.arrayRemove(target) }).then(function () { if (cb) cb(null); }).catch(fail(cb));
  },
  /** 隊長把位子轉給成員：owner 改成對方，並把對方從副隊長名單移除 */
  transferLeader: function (target, cb) {
    if (!Cloud.ready() || !me || !me.clan) { if (cb) cb({ code: 'no-clan' }); return; }
    const FV = window.firebase.firestore.FieldValue;
    db.collection('clans').doc(me.clan).update({ owner: target, deputies: FV.arrayRemove(target) }).then(function () { if (cb) cb(null); }).catch(fail(cb));
  },
  /** 隊長／副隊長踢人：刪掉成員文件並把人數減 1 */
  kickMember: function (target, cb) {
    if (!Cloud.ready() || !me || !me.clan) { if (cb) cb({ code: 'no-clan' }); return; }
    const ref = db.collection('clans').doc(me.clan);
    ref.collection('members').doc(target).delete().then(function () {
      return ref.update({ count: window.firebase.firestore.FieldValue.increment(-1) });
    }).then(function () { if (cb) cb(null); }).catch(fail(cb));
  },
  leaveClan: function (cb) {
    if (!Cloud.ready() || !me || !me.clan) { if (cb) cb({ code: 'no-clan' }); return; }
    const ref = db.collection('clans').doc(me.clan);
    // 先改人數（此時自己還是隊員，規則允許），再刪自己的隊員文件
    ref.update({ count: window.firebase.firestore.FieldValue.increment(-1) }).then(function () {
      return ref.collection('members').doc(uid).delete();
    }).then(function () {
      me.clan = ''; me.clanTag = ''; me.clanName = '';
      return userRef().set({ clan: '', clanTag: '', clanName: '' }, { merge: true });
    }).then(function () { if (cb) cb(null); }).catch(fail(cb));
  },
  /** 每局結束把得分貢獻給戰隊 */
  clanAdd: function (pts) {
    if (!Cloud.ready() || !me || !me.clan || !(pts > 0)) return;
    pts = Math.floor(pts);
    const FV = window.firebase.firestore.FieldValue, ref = db.collection('clans').doc(me.clan), w = weekId();
    ref.collection('members').doc(uid).set({ name: profile().name, score: FV.increment(pts) }, { merge: true }).catch(fail());
    // 同一筆交易更新累計積分、本週積分（跨週自動歸零）與歷史最高段位
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (s) {
        if (!s.exists) return;
        const d = s.data(), ws = (d.wk === w ? (d.wscore | 0) : 0) + pts;
        tx.update(ref, { score: FV.increment(pts), wk: w, wscore: ws, best: Math.max(d.best | 0, tierOf(ws)) });
      });
    }).catch(fail());
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
      if (!members.some(function (x) { return x.uid === uid; })) {   // 已被踢出：清掉本機的戰隊資料
        me.clan = ''; me.clanTag = ''; me.clanName = ''; userRef().set({ clan: '', clanTag: '', clanName: '' }, { merge: true }).catch(fail());
        cb(null, null); return;
      }
      const c = r[0].data(); c.id = r[0].id;
      cb(null, { clan: c, members: members });
    }).catch(fail(cb));
  },
  topClans: function (cb) {
    if (!Cloud.ready()) { cb({ code: 'offline' }); return; }
    // 本週排行：只取本週有積分的戰隊
    db.collection('clans').orderBy('wscore', 'desc').limit(40).get().then(function (q) {
      const rows = []; q.forEach(function (d) { const x = d.data(); x.id = d.id; if (x.wk === weekId()) rows.push(x); }); cb(null, rows.slice(0, 20));
    }).catch(fail(cb));
  },
  /* ---------- 戰隊聊天：文字、請求金幣、捐贈 ---------- */
  ASK_NEED: 100, GIVE: 10, GIVE_MAX: 30,
  msgs: function () { return db.collection('clans').doc(me.clan).collection('msgs'); },
  /** 即時訂閱最新 40 則；回傳取消函式。onRows(err, rows)（新到舊） */
  clanChat: function (onRows) {
    if (!Cloud.ready() || !me || !me.clan) { onRows({ code: me && !me.clan ? 'no-clan' : 'offline' }); return function () {}; }
    return Cloud.msgs().orderBy('t', 'desc').limit(40).onSnapshot(function (q) {
      const rows = []; q.forEach(function (d) { const x = d.data(); x.id = d.id; rows.push(x); }); onRows(null, rows);
    }, fail(onRows));
  },
  clanSay: function (text, cb) {
    if (!Cloud.ready() || !me || !me.clan) { cb({ code: 'no-clan' }); return; }
    text = clean(text, 80); if (!text) { cb(null); return; }
    // 等級與頭像底色跟著訊息存（頭像照片只留在本機，不會上傳）
    let av = ''; try { av = localStorage.getItem('rr_avatar') || ''; } catch (e) {}
    Cloud.msgs().add({ uid: uid, name: profile().name, k: 'say', text: text, t: Date.now(), lv: profile().lv | 0, av: av }).then(function () { cb(null); }).catch(fail(cb));
  },
  clanAsk: function (cb) {
    if (!Cloud.ready() || !me || !me.clan) { cb({ code: 'no-clan' }); return; }
    Cloud.msgs().add({ uid: uid, name: profile().name, k: 'req', need: Cloud.ASK_NEED, got: 0, claimed: 0, donors: {}, t: Date.now() }).then(function () { cb(null); }).catch(fail(cb));
  },
  /** 捐 10 金幣給一則請求；cb(err) 成功才扣捐贈者的金幣 */
  clanGive: function (mid, cb) {
    if (!Cloud.ready() || !me || !me.clan) { cb({ code: 'no-clan' }); return; }
    const ref = Cloud.msgs().doc(mid);
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (s) {
        if (!s.exists) throw { code: 'gone' };
        const d = s.data(), mine = (d.donors && d.donors[uid]) | 0;
        if (d.uid === uid) throw { code: 'own-req' };
        if ((d.got | 0) >= (d.need | 0)) throw { code: 'req-full' };
        if (mine >= Cloud.GIVE_MAX) throw { code: 'give-max' };
        const donors = Object.assign({}, d.donors || {}); donors[uid] = mine + Cloud.GIVE;
        tx.update(ref, { got: (d.got | 0) + Cloud.GIVE, donors: donors });
      });
    }).then(function () { cb(null); }).catch(fail(cb));
  },
  /** 自己的請求：把已收到、還沒領的金幣領走；cb(err, 領到的數量) */
  clanClaim: function (mid, cb) {
    if (!Cloud.ready() || !me || !me.clan) { cb({ code: 'no-clan' }); return; }
    const ref = Cloud.msgs().doc(mid); let n = 0;
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (s) {
        if (!s.exists) throw { code: 'gone' };
        const d = s.data(); n = (d.got | 0) - (d.claimed | 0);
        if (d.uid !== uid || n <= 0) { n = 0; return; }
        tx.update(ref, { claimed: d.got | 0 });
      });
    }).then(function () { cb(null, n); }).catch(fail(cb));
  },
  message: function (e) {
    const c = e && e.code;
    return { offline: '雲端功能要先登入（Google 或訪客）並連上網路。', 'bad-code': '代碼格式不對。', self: '這是你自己的代碼。', 'not-found': '找不到這個代碼。',
      'bad-name': '名稱至少 2 個字。', 'in-clan': '你已經在一個戰隊裡，請先退出。', full: '這個戰隊已滿（30 人）。', 'no-clan': '你不在任何戰隊。', gone: '這則請求已經不見了。', 'own-req': '不能捐給自己。', 'req-full': '這則請求已經收滿了。', 'give-max': '每則請求你最多捐 30 金幣。',
      'permission-denied': '雲端拒絕了這個操作：請確認 Firestore 的安全規則已經發布。', unavailable: '連不到雲端，請檢查網路。' }[c] || ('雲端錯誤：' + (c || (e && e.message) || '未知'));
  }
};
RR.Cloud = Cloud;
})();
