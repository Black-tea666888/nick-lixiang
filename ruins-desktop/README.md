# 廢墟回收隊 桌面版（上架 Steam 用）

遊戲本體就是 `../ruins` 的網頁版。這個資料夾用 Electron 把它包成 Windows／Mac／Linux 程式。
程式裡會開一個只有本機連得到的小伺服器（`serve.js`），因為 Firebase 登入不支援直接開 `file://`。

## 在自己電腦上打包（Windows）

1. 安裝 [Node.js](https://nodejs.org/)（LTS 版）。
2. 在這個資料夾打開終端機，執行：
   ```
   npm install
   npm start          # 先開起來試玩
   npm run dist:win   # 打包成 dist/win-unpacked/ 資料夾
   ```
3. 上傳到 Steam 的是 `dist/win-unpacked/` 整個資料夾，啟動檔是裡面的 `廢墟回收隊.exe`。

每次網頁版更新後，重新執行 `npm run dist:win` 就會把最新的遊戲包進去（`copy-app.js` 會先複製 `../ruins`）。

快捷鍵：F11 或 Alt+Enter 切換全螢幕。

## 上架 Steam 檢查表

### 只有你能做的
- [ ] 註冊 [Steamworks](https://partner.steamgames.com/steamdirect)，填稅務與銀行資料。
- [ ] 付 Steam Direct 費用：每款遊戲 US$100，不退費；遊戲在 Steam 收入達 US$1,000 後會退回。
- [ ] 付費後要等 30 天才能發行，商店頁也要先上線一段時間（「即將推出」）。
- [ ] 填內容分級問卷、決定價格（或免費）。
- [ ] 確認授權：
  - 角色模型 `models/Soldier.glb` 來自 three.js 範例，原始角色出自 Adobe Mixamo，請自行確認 Mixamo 的使用條款允許在你的商業遊戲裡使用。
  - 槍名裡的真實商標（例如 M4A1、巴雷特）建議改成原創名字。
  - Google 登入在桌面程式裡可能被 Google 擋（不允許內嵌瀏覽器登入），訪客登入與存檔不受影響；要用 Google 帳號登入，之後需要改成用系統瀏覽器登入。

### 商店圖片（尺寸要完全一樣，否則會被退件）
| 圖 | 尺寸（px） |
|---|---|
| Header Capsule | 920 × 430 |
| Small Capsule | 462 × 174 |
| Main Capsule | 1232 × 706 |
| Vertical Capsule | 748 × 896 |
| Library Capsule | 600 × 900 |
| Library Header | 920 × 430 |
| Library Hero | 3840 × 1240 |
| Library Logo（透明背景） | 最大 1280 × 720 |
| 截圖 | 至少 5 張，1920 × 1080 |

尺寸以 [Steamworks 圖片說明](https://partner.steamgames.com/doc/store/assets) 為準，上架前再確認一次。

### 遊戲本身（程式這邊會繼續做）
- [x] 桌面程式外殼、全螢幕切換
- [x] 遊戲手把（Xbox／PS／Steam Deck）
- [ ] 選單也能用手把操作（Steam Deck 驗證需要）
- [x] 電腦版設定：全螢幕、按鍵自訂、暫停選單
- [x] 槍名換成原創名字
- [ ] Steamworks SDK（成就、雲端存檔）—— 可選，之後再加
