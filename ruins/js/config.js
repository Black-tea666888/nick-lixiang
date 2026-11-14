/* 廢墟回收隊 — 設定檔
 * 只需要改這個檔案。設定步驟請看 README.md。
 */
window.RR = window.RR || {};
RR.CONFIG = {
  // 1) Firebase 專案設定（Firebase Console → 專案設定 → 你的應用程式 → SDK 設定）
  //    留 null 時：只有「訪客登入」可用，連線與語音照常運作。
  firebase: null,
  /* 範例：
  firebase: {
    apiKey: 'AIza...',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    appId: '1:1234567890:web:abcdef'
  },
  */

  // 2) 要顯示哪些登入按鈕（沒在 Firebase 啟用的請設成 false）
  providers: { google: true, apple: true, line: true, facebook: true },

  // 3) LINE 在 Firebase（Identity Platform）裡的 OIDC 供應商 ID
  lineProviderId: 'oidc.line',

  // 4) PeerJS 選項。留空 = 使用 PeerJS 免費公用配對伺服器。
  //    自架範例：{ host: 'peer.example.com', port: 443, path: '/', secure: true }
  peer: {},

  // 5) 自訂 STUN/TURN（選填）。有玩家連不上時再加 TURN 伺服器。
  //    範例：[{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }]
  iceServers: null
};
