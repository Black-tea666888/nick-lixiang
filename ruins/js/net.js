/* 連線：PeerJS（WebRTC）。房主 = 星狀資料中心；語音另外走玩家間的網狀連線。 */
(function () {
'use strict';
const RR = window.RR = window.RR || {};

const PREFIX = 'ruinsrr-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let peer = null, mode = null, code = null, hostConn = null;
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

const Net = {
  on: function (ev, fn) { handlers[ev] = fn; },
  mode: function () { return mode; },
  code: function () { return code; },
  id: function () { return peer ? peer.id : null; },
  normalizeCode: function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); },

  /** 建立房間。cb(err, code) */
  host: function (cb, tries) {
    tries = tries || 0;
    Net.leave();
    const c = makeCode();
    let opened = false, p;
    try { p = newPeer(PREFIX + c); } catch (e) { cb(e); return; }
    peer = p; common(p);
    const timer = setTimeout(function () { if (!opened && peer === p) { Net.leave(); cb({ type: 'timeout' }); } }, 15000);
    p.on('open', function () { opened = true; clearTimeout(timer); mode = 'host'; code = c; cb(null, c); });
    p.on('error', function (e) {
      if (peer !== p) return;
      if (!opened) {
        clearTimeout(timer);
        if (e.type === 'unavailable-id' && tries < 5) { Net.host(cb, tries + 1); return; }
        Net.leave(); cb(e);
      } else if (e.type !== 'peer-unavailable') emit('error', e);
    });
    p.on('connection', function (conn) {
      conn.on('open', function () { conns.set(conn.peer, conn); emit('join', conn.peer, conn.metadata || {}); });
      conn.on('data', function (d) { emit('msg', conn.peer, d); });
      const gone = function () { if (conns.get(conn.peer) === conn) { conns.delete(conn.peer); emit('leave', conn.peer); } };
      conn.on('close', gone); conn.on('error', gone);
    });
  },

  /** 加入房間。cb(err, myId) */
  join: function (c, meta, cb) {
    Net.leave();
    let joined = false, done = false, p;
    try { p = newPeer(); } catch (e) { cb(e); return; }
    peer = p; common(p);
    const fail = function (e) { if (done) return; done = true; clearTimeout(timer); if (peer === p) Net.leave(); cb(e); };
    const timer = setTimeout(function () { if (!joined) fail({ type: 'timeout' }); }, 15000);
    p.on('open', function (id) {
      const conn = p.connect(PREFIX + c, { reliable: true, serialization: 'json', metadata: meta });
      hostConn = conn;
      conn.on('open', function () { if (done) return; joined = true; done = true; clearTimeout(timer); mode = 'client'; code = c; cb(null, id); });
      conn.on('data', function (d) { emit('msg', 'host', d); });
      conn.on('close', function () { if (peer === p && joined) emit('hostleft'); });
      conn.on('error', function (e) { if (!joined) fail(e); });
    });
    p.on('error', function (e) {
      if (peer !== p) return;
      if (!joined) fail(e);
      else if (e.type !== 'peer-unavailable') emit('error', e);
    });
  },

  send: function (msg) { if (hostConn && hostConn.open) { try { hostConn.send(msg); } catch (e) {} } },
  sendTo: function (id, msg) { const c = conns.get(id); if (c && c.open) { try { c.send(msg); } catch (e) {} } },
  broadcast: function (msg) { conns.forEach(function (c) { if (c.open) { try { c.send(msg); } catch (e) {} } }); },
  drop: function (id) { const c = conns.get(id); if (c) { try { c.close(); } catch (e) {} } },
  call: function (id, stream) { try { return peer ? peer.call(id, stream) : null; } catch (e) { return null; } },
  leave: function () {
    const p = peer;
    peer = null; mode = null; code = null; hostConn = null; conns.clear();
    if (p) { try { p.destroy(); } catch (e) {} }
  }
};
RR.Net = Net;
})();
