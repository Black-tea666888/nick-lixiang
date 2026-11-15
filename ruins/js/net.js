/* 連線：房主 = 星狀資料中心。優先用 PeerJS（WebRTC）直連；直連不了（行動網路、App 內建瀏覽器）就改由伺服器中繼。語音只走直連。 */
(function () {
'use strict';
const RR = window.RR = window.RR || {};

const PREFIX = 'ruinsrr-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let peer = null, mode = null, code = null, hostConn = null, session = null, peerLink = false;
const conns = new Map();
const handlers = {};
function emit(ev, a, b) { if (handlers[ev]) { try { handlers[ev](a, b); } catch (e) { console.error(e); } } }
function makeCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
function newPeer(id) {
  if (!window.Peer) throw new Error('PeerJS 沒有載入');
  const opt = Object.assign({ debug: 1 }, (RR.CONFIG && RR.CONFIG.peer) || {});
  if (RR.CONFIG && RR.CONFIG.iceServers) opt.config = { iceServers: RR.CONFIG.iceServers };
  return id ? new window.Peer(id, opt) : new window.Peer(opt);
}
function common(p) {
  p.on('call', function (call) { emit('call', call); });
  p.on('disconnected', function () { if (peer === p && !p.destroyed) { try { p.reconnect(); } catch (e) {} } });
}

/* ---------- 中繼（直連失敗時，遊戲資料改由伺服器轉送） ---------- */
let myId = null, relayWs = null, relayIds = null;
const FORCE_RELAY = /[?&]relay=1/.test(location.search);
const hasRTC = !!(window.Peer && window.RTCPeerConnection);
function relayUrl(c, role, id, meta) {
  const k = RR.CONFIG && RR.CONFIG.peer;
  if (!k || !k.host || !window.WebSocket) return null;
  return (k.secure === false ? 'ws://' : 'wss://') + k.host + (k.port && k.port !== 443 && k.port !== 80 ? ':' + k.port : '') + '/relay?room=' + c + '&role=' + role +
    '&id=' + encodeURIComponent(id) + (meta ? '&meta=' + encodeURIComponent(JSON.stringify(meta)) : '');
}
function randId() { let s = 'r'; for (let i = 0; i < 14; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }

const Net = {
  on: function (ev, fn) { handlers[ev] = fn; },
  mode: function () { return mode; },
  code: function () { return code; },
  id: function () { return myId; },
  /** 目前是否有人走中繼（顯示用） */
  relayed: function () { return mode === 'client' ? !!(relayWs && !peerLink) : !!(relayIds && relayIds.size); },
  normalizeCode: function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); },

  /** 建立房間。cb(err, code)。同時開直連（PeerJS）與中繼兩條路，任一條成功就算成功。 */
  host: function (cb, tries) {
    tries = tries || 0;
    Net.leave();
    const c = makeCode(), token = {};
    session = token;
    let peerOk = null, relayOk = null, done = false, lastErr = null, p = null, ws = null;
    const retry = function () { if (done || session !== token) return; done = true; Net.leave(); if (tries < 5) Net.host(cb, tries + 1); else cb({ type: 'unavailable-id' }); };
    const settle = function () {
      if (done || session !== token || peerOk === null || relayOk === null) return;
      done = true; clearTimeout(timer);
      if (!peerOk && !relayOk) { Net.leave(); cb(lastErr || { type: 'network' }); return; }
      mode = 'host'; code = c; myId = PREFIX + c; cb(null, c);
    };
    const timer = setTimeout(function () { if (done || session !== token) return; if (peerOk === null) peerOk = false; if (relayOk === null) relayOk = false; if (!lastErr) lastErr = { type: 'timeout' }; settle(); }, 45000);
    // 直連
    if (hasRTC && !FORCE_RELAY) {
      try { p = newPeer(PREFIX + c); } catch (e) { p = null; peerOk = false; lastErr = e; }
      if (p) {
        peer = p; common(p);
        p.on('open', function () { if (peerOk === null) { peerOk = true; settle(); } });
        p.on('error', function (e) {
          if (session !== token) return;
          if (peerOk === null) { if (e.type === 'unavailable-id') { retry(); return; } peerOk = false; lastErr = e; settle(); }
          else if (e.type !== 'peer-unavailable') emit('error', e);
        });
        p.on('connection', function (conn) {
          conn.on('open', function () { conns.set(conn.peer, { open: true, send: function (m) { conn.send(m); }, close: function () { conn.close(); }, raw: conn }); emit('join', conn.peer, conn.metadata || {}); });
          conn.on('data', function (d) { emit('msg', conn.peer, d); });
          const gone = function () { const k = conns.get(conn.peer); if (k && k.raw === conn) { conns.delete(conn.peer); emit('leave', conn.peer); } };
          conn.on('close', gone); conn.on('error', gone);
        });
      }
    } else peerOk = false;
    // 中繼
    const url = relayUrl(c, 'host', PREFIX + c);
    if (url) {
      try { ws = new WebSocket(url); } catch (e) { ws = null; }
    }
    if (!ws) { relayOk = false; settle(); return; }
    relayWs = ws; relayIds = new Set();
    ws.onmessage = function (ev) {
      if (session !== token) return;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.r === 'ok') { if (relayOk === null) { relayOk = true; settle(); } }
      else if (m.r === 'join') {
        relayIds.add(m.id);
        conns.set(m.id, { open: true, relay: true, send: function (d) { ws.send(JSON.stringify({ to: m.id, d: d })); }, close: function () { ws.send(JSON.stringify({ r: 'drop', id: m.id })); } });
        emit('join', m.id, m.meta || {});
      } else if (m.r === 'msg') emit('msg', m.id, m.d);
      else if (m.r === 'leave') { relayIds.delete(m.id); const k = conns.get(m.id); if (k && k.relay) { conns.delete(m.id); emit('leave', m.id); } }
    };
    ws.onclose = function (ev) {
      if (session !== token) return;
      if (relayOk === null) { if (ev.code === 4001) { retry(); return; } relayOk = false; settle(); return; }
      // 中繼斷了：走中繼的玩家視為離開；直連的不受影響
      Array.from(relayIds).forEach(function (id) { relayIds.delete(id); if (conns.get(id) && conns.get(id).relay) { conns.delete(id); emit('leave', id); } });
    };
    ws.onerror = function () {};
  },

  /** 加入房間。cb(err, myId)。先試直連，10 秒內連不上就改走中繼。 */
  join: function (c, meta, cb) {
    Net.leave();
    const token = {}; session = token;
    let done = false, joined = false, p = null, firstErr = null, triedRelay = false;
    const finish = function (err, id) {
      if (done || session !== token) return; done = true; clearTimeout(timer); clearTimeout(p2pTimer);
      if (err) { Net.leave(); cb(err); return; }
      joined = true; mode = 'client'; code = c; myId = id; cb(null, id);
    };
    const timer = setTimeout(function () { finish(firstErr || { type: 'timeout' }); }, 60000);
    let p2pTimer = null;
    const viaRelay = function (why) {
      if (done || triedRelay || session !== token) return;
      triedRelay = true; clearTimeout(p2pTimer);
      if (why && !firstErr) firstErr = why;
      if (p) { try { p.destroy(); } catch (e) {} if (peer === p) peer = null; p = null; }
      const id = randId(), url = relayUrl(c, 'client', id, meta);
      let ws = null;
      if (url) { try { ws = new WebSocket(url); } catch (e) { ws = null; } }
      if (!ws) { finish(firstErr || { type: 'network' }); return; }
      relayWs = ws;
      ws.onmessage = function (ev) {
        if (session !== token) return;
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!joined) { if (m && m.r === 'ok') { hostConn = { open: true, send: function (d) { ws.send(JSON.stringify(d)); } }; finish(null, id); } return; }
        emit('msg', 'host', m);
      };
      ws.onclose = function (ev) {
        if (session !== token) return;
        if (!joined) { finish(ev.code === 4004 ? { type: 'peer-unavailable' } : ev.code === 4005 ? { type: 'full' } : (firstErr || { type: 'network' })); return; }
        if (hostConn) hostConn.open = false;
        emit('hostleft');
      };
      ws.onerror = function () {};
    };
    if (!hasRTC || FORCE_RELAY) { viaRelay(null); return; }
    try { p = newPeer(); } catch (e) { viaRelay(e); return; }
    peer = p; common(p);
    p.on('open', function (id) {
      if (done || triedRelay) return;
      const conn = p.connect(PREFIX + c, { reliable: true, serialization: 'json', metadata: meta });
      p2pTimer = setTimeout(function () { viaRelay({ type: 'negotiation-failed' }); }, 10000);
      conn.on('open', function () { if (done || triedRelay) return; peerLink = true; hostConn = { open: true, send: function (d) { conn.send(d); } }; finish(null, id); });
      conn.on('data', function (d) { emit('msg', 'host', d); });
      conn.on('close', function () { if (session === token && joined) { if (hostConn) hostConn.open = false; emit('hostleft'); } });
      conn.on('error', function (e) { if (!joined) viaRelay(e); });
    });
    p.on('error', function (e) {
      if (session !== token) return;
      if (!joined) viaRelay(e);
      else if (e.type !== 'peer-unavailable') emit('error', e);
    });
  },

  send: function (msg) { if (hostConn && hostConn.open) { try { hostConn.send(msg); } catch (e) {} } },
  sendTo: function (id, msg) { const c = conns.get(id); if (c && c.open) { try { c.send(msg); } catch (e) {} } },
  broadcast: function (msg) {
    let relayed = false;
    conns.forEach(function (c) { if (c.relay) relayed = true; else if (c.open) { try { c.send(msg); } catch (e) {} } });
    if (relayed && relayWs && relayWs.readyState === 1) { try { relayWs.send(JSON.stringify({ to: '*', d: msg })); } catch (e) {} }
  },
  drop: function (id) { const c = conns.get(id); if (c) { try { c.close(); } catch (e) {} } },
  call: function (id, stream) { try { return peer ? peer.call(id, stream) : null; } catch (e) { return null; } },
  /** 先叫醒訊號伺服器（免費主機閒置會休眠，喚醒要 10～40 秒），之後建房／加入就快了 */
  warm: function () {
    const c = RR.CONFIG && RR.CONFIG.peer;
    if (!c || !c.host || !window.fetch) return;
    try { fetch((c.secure === false ? 'http://' : 'https://') + c.host + (c.port && c.port !== 443 ? ':' + c.port : '') + (c.path || '/') + 'id', { mode: 'no-cors', cache: 'no-store' }).catch(function () {}); } catch (e) {}
  },
  leave: function () {
    const p = peer, w = relayWs;
    session = null; peer = null; mode = null; code = null; hostConn = null; myId = null; relayWs = null; relayIds = null; peerLink = false; conns.clear();
    if (p) { try { p.destroy(); } catch (e) {} }
    if (w) { try { w.onclose = null; w.close(); } catch (e) {} }
  }
};
RR.Net = Net;
})();
