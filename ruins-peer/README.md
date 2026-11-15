# ruins-peer

廢墟回收隊的配對伺服器。只轉送連線資訊（WebRTC 握手），不經手遊戲資料或語音。

## 部署到 Render（免費方案）
1. Render → New → **Web Service** → 連到這個 repo，Root Directory 填 `ruins-peer`。
2. Build Command: `npm install`　Start Command: `npm start`
3. 部署完成後會得到網址，例如 `ruins-peer.onrender.com`。
4. 到 `ruins/js/config.js`，把 `peer` 改成：
   `peer: { host: 'ruins-peer.onrender.com', port: 443, path: '/', secure: true },`

注意：免費方案閒置約 15 分鐘會休眠，第一次連線會慢 30 秒左右。

## 本機測試
```
npm install
npm start    # 預設 port 9000
```
