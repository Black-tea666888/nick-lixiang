/* 廢墟回收隊 — 設定檔
 * 只需要改這個檔案。設定步驟請看 README.md。
 */
window.RR = window.RR || {};
RR.CONFIG = {
  // 1) Firebase 專案設定（Firebase Console → 專案設定 → 你的應用程式 → SDK 設定）
  //    留 null 時：只有「訪客登入」可用，連線與語音照常運作。
  firebase: {
    apiKey: 'AIzaSyALZALthpWkonz2QVdlqCGIANkRM-lgfYQ',
    authDomain: 'ruins-recovery-team.firebaseapp.com',
    projectId: 'ruins-recovery-team',
    storageBucket: 'ruins-recovery-team.firebasestorage.app',
    messagingSenderId: '307577807603',
    appId: '1:307577807603:web:16aa3851df35b987cbcd86'
  },
  /* 範例：
  firebase: {
    apiKey: 'AIza...',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    appId: '1:1234567890:web:abcdef'
  },
  */

  // 2) 要顯示哪些登入按鈕（沒在 Firebase 啟用的請設成 false）
  providers: { google: true, apple: false, line: false, facebook: false },   // 目前只在 Firebase 啟用了 Google 與匿名

  // 2b) Google 官方登入按鈕用的「Web 用戶端 ID」（Firebase 後台 → Authentication → Google → Web SDK 設定）。
  //     加到主畫面（iPhone 獨立視窗）時，彈窗和跳轉登入會被 Apple 擋住，這時改用官方按鈕。留空就不啟用。
  //     另外要到 Google Cloud 主控台 → API 與服務 → 憑證 → 這個用戶端 → 已授權的 JavaScript 來源，加入 https://black-tea666888.github.io
  googleClientId: '',

  // 3) LINE 在 Firebase（Identity Platform）裡的 OIDC 供應商 ID
  lineProviderId: 'oidc.line',

  // 4) PeerJS 選項。留空 = 使用 PeerJS 免費公用配對伺服器。
  //    自架範例：{ host: 'peer.example.com', port: 443, path: '/', secure: true }
  peer: { host: 'nick-lixiang.onrender.com', port: 443, path: '/', secure: true },

  // 5) 自訂 STUN/TURN（選填）。有玩家連不上時再加 TURN 伺服器。
  //    範例：[{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }]
  iceServers: null
};
