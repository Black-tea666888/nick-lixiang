// 廢墟回收隊 配對伺服器（只負責讓玩家找到彼此，遊戲與語音資料是玩家之間直連）
const { PeerServer } = require('peer');

const port = Number(process.env.PORT) || 9000;
PeerServer(
  {
    port,
    host: process.env.HOST || undefined,   // 本機測試可設 HOST=127.0.0.1
    path: '/',
    key: 'peerjs',
    proxied: true,          // 部署在 Render 等平台後面（由平台處理 HTTPS）
    allow_discovery: false  // 不公開列出所有連線中的玩家
  },
  () => console.log('ruins-peer listening on', port)
);
