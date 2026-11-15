// 廢墟回收隊 連線伺服器
// 1) PeerJS 配對：讓玩家找到彼此，之後遊戲與語音資料是玩家之間直連（WebRTC）
// 2) 中繼（/relay）：有些網路（行動網路、公司／學校網路、App 內建瀏覽器）無法直連，
//    這時遊戲資料改由這台伺服器轉送。語音不走中繼。
const http = require('http');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const { WebSocketServer } = require('ws');

const port = Number(process.env.PORT) || 9000;
const app = express();
const server = http.createServer(app);

app.get('/relay-health', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.json({ ok: true, rooms: rooms.size }); });
app.use('/', ExpressPeerServer(server, { path: '/', key: 'peerjs', proxied: true, allow_discovery: false }));

/* ---------- 中繼 ---------- */
const rooms = new Map();   // 房間代碼 -> { host: ws, clients: Map<id, ws> }
const relay = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const CODE = /^[A-Z0-9]{5}$/, ID = /^[A-Za-z0-9_-]{4,64}$/;
const sendTo = (ws, text) => { if (ws && ws.readyState === 1) { try { ws.send(text); } catch (e) {} } };

relay.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const code = String(q.get('room') || ''), role = q.get('role'), id = String(q.get('id') || '');
  if (!CODE.test(code) || !ID.test(id)) { ws.close(4000, 'bad'); return; }
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });

  if (role === 'host') {
    const old = rooms.get(code);
    if (old && old.host && old.host.readyState <= 1) { ws.close(4001, 'taken'); return; }
    const room = { host: ws, clients: new Map() };
    rooms.set(code, room);
    sendTo(ws, '{"r":"ok"}');
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (!m) return;
      if (m.r === 'drop') { const c = room.clients.get(m.id); if (c) c.close(4003, 'dropped'); return; }
      if (m.d === undefined) return;
      const text = JSON.stringify(m.d);
      if (m.to === '*') room.clients.forEach((c) => sendTo(c, text)); else sendTo(room.clients.get(m.to), text);
    });
    ws.on('close', () => {
      if (rooms.get(code) === room) rooms.delete(code);
      room.clients.forEach((c) => c.close(4002, 'hostleft'));
    });
    return;
  }

  const room = rooms.get(code);
  if (!room || room.host.readyState !== 1) { ws.close(4004, 'noroom'); return; }
  if (room.clients.has(id) || room.clients.size >= 8) { ws.close(4005, 'full'); return; }
  let meta = {}; try { meta = JSON.parse(q.get('meta') || '{}'); } catch (e) {}
  room.clients.set(id, ws);
  sendTo(ws, '{"r":"ok"}');
  sendTo(room.host, JSON.stringify({ r: 'join', id, meta }));
  ws.on('message', (data) => {
    const raw = data.toString();
    if (raw.length > 65536) return;
    try { JSON.parse(raw); } catch (e) { return; }
    sendTo(room.host, '{"r":"msg","id":' + JSON.stringify(id) + ',"d":' + raw + '}');
  });
  ws.on('close', () => {
    if (room.clients.get(id) === ws) { room.clients.delete(id); sendTo(room.host, JSON.stringify({ r: 'leave', id })); }
  });
});
setInterval(() => {
  relay.clients.forEach((ws) => { if (!ws.isAlive) { ws.terminate(); return; } ws.isAlive = false; try { ws.ping(); } catch (e) {} });
}, 25000);

// PeerJS 也在同一個 HTTP 伺服器上處理 WebSocket；/relay 交給中繼，其他照舊交給 PeerJS
const peerUpgrade = server.listeners('upgrade').slice();
server.removeAllListeners('upgrade');
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/relay')) relay.handleUpgrade(req, socket, head, (ws) => relay.emit('connection', ws, req));
  else peerUpgrade.forEach((fn) => fn.call(server, req, socket, head));
});

server.listen(port, process.env.HOST || undefined, () => console.log('ruins-peer listening on', port));
