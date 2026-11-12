# 廢墟回收隊

1–4 人 3D 合作恐怖網頁遊戲。純靜態網站，不需要自己的伺服器，可直接放 GitHub Pages。

- 玩法：潛入廢墟撿廢料 → 帶回綠色回收車賣錢 → 時限內達標就進下一天（目標更高、怪物更快更多）
- 連線：建立房間取得 5 碼代碼，朋友輸入代碼或開邀請連結加入（PeerJS / WebRTC）
- 語音：近距離語音，越遠越小聲、隔牆變小聲；講太大聲或跑步會引來怪物；死掉後只有死人聽得到你
- 互相傷害：每人一根鐵管，兩下打死隊友，死者身上的廢料掉在原地；結算會列出每人賣出金額與擊殺數（房主可在大廳關閉）
- 造型：6 種角色（回收員、機器人、太空人、貓貓、南瓜頭、紙箱人）× 6 種攻擊物（鐵管、扳手、球棒、平底鍋、雨傘、鹹魚），在主選單切換，純外觀、傷害相同
- 地圖：3 張（廢棄設施、大倉庫、地下水道），主選單選（單人／建房預設），房主也可在大廳切換；要加新地圖，在 `js/sim.js` 的 `MAPS` 多寫一組即可
- 小地圖：每張地圖自動產生，顯示自己的位置與方向、隊友、回收車（點一下放大）；怪物和廢料不顯示
- 背景音樂：程式即時合成，不需要音檔；大廳平靜、怪物靠近變緊張、被追逐強烈，過關與失敗有提示音；音量在設定調整
- 聊天：大廳與遊戲中都有文字聊天框（電腦按 Enter，手機按「聊天」）
- 登入：Google / Apple / LINE / Facebook / 訪客

## 馬上玩（不用任何設定）

把整個資料夾放到任何 **HTTPS** 靜態主機（GitHub Pages、Netlify…）就能玩：
訪客登入、單人、多人連線、語音、聊天都能用。麥克風一定要 HTTPS（或 localhost）才拿得到權限。

本機測試：

```
cd 這個資料夾
python3 -m http.server 8080
# 開 http://localhost:8080
```

## 檔案

```
index.html        畫面結構
css/style.css     樣式
js/config.js      ★ 唯一需要改的設定檔
js/sim.js         遊戲規則（房主端計算：怪物 AI、物品、天數、勝敗）
js/net.js         連線（PeerJS）
js/audio.js       音效 + 麥克風 + 近距離語音
js/auth.js        登入（Firebase Authentication）
js/game.js        3D 畫面與操作
js/main.js        流程（登入→選單→大廳→遊戲→結算）、聊天
vendor/           three.js、PeerJS、Firebase SDK（已內含，不用另外下載）
```

## 開啟社群登入（只有開發者要做一次；玩家不用申請任何東西）

### 1. 建 Firebase 專案
1. 到 Firebase Console 建專案 → 新增「網頁應用程式」→ 把 SDK 設定貼進 `js/config.js` 的 `firebase`。
2. Authentication → 設定 → **已授權網域**：加入你的網址（例如 `你的帳號.github.io`）。
3. Authentication → 登入方式，依序啟用下面要用的項目。

### 2. 訪客
啟用「匿名」。（沒啟用也沒關係，程式會自動改用本機訪客。）

### 3. Google
啟用「Google」即可，不用另外申請。

### 4. Facebook
到 Meta for Developers 建應用程式、加入「Facebook 登入」，把 App ID / App Secret 貼到 Firebase 的 Facebook 項目；
再把 Firebase 顯示的 OAuth 重新導向 URI（`https://你的專案.firebaseapp.com/__/auth/handler`）貼回 Meta 後台。
應用程式要切到「上線」模式，別人才登得進來。

### 5. Apple
需要付費的 Apple Developer Program。在 Apple Developer 建 Services ID、設定網域與回呼網址（同上 `__/auth/handler`）、
建立 Sign in with Apple 金鑰，再把 Services ID、Team ID、Key ID、私鑰填進 Firebase 的 Apple 項目。

### 6. LINE
Firebase 沒有內建 LINE，走 OpenID Connect：
1. Firebase Authentication 升級為「Identity Platform」（OIDC 供應商需要升級後才能用）。
2. LINE Developers Console 建一個 **LINE Login** channel（Web app），Callback URL 填 `https://你的專案.firebaseapp.com/__/auth/handler`。
3. Firebase → 登入方式 → 新增供應商 → OpenID Connect：
   - 名稱：LINE　供應商 ID：`oidc.line`（要和 `config.js` 的 `lineProviderId` 一樣）
   - 授權類型：Code flow
   - Client ID：LINE 的 Channel ID　Client secret：Channel secret
   - Issuer：`https://access.line.me`
4. LINE channel 記得從 Developing 切到 Published。

已知狀況：手機上如果裝了 LINE App，登入後有可能被帶到 LINE 內建瀏覽器而失敗；遇到時請玩家改用訪客或其他方式登入。

### 7. 不想顯示某個按鈕
`js/config.js` 的 `providers` 把它設成 `false`。

## 連線說明與限制

- 配對預設用 PeerJS 的免費公用伺服器（只負責讓玩家互相找到，遊戲資料與語音是玩家之間直連）。
  公用伺服器不保證穩定，正式營運建議自架 PeerServer，再填 `config.js` 的 `peer`。
- 少數網路環境（部分行動網路、公司／學校防火牆）無法直連，需要 TURN 伺服器，填在 `config.js` 的 `iceServers`。
- 房主的裝置負責計算遊戲。房主離開房間就關閉；房主把分頁切到背景，遊戲會變慢或暫停。
- 遊戲開始後不能中途加入，要等回到大廳。
- 用喇叭玩可能有回音，建議戴耳機。
- 這是合作遊戲，位置由各玩家自己回報，沒有防作弊。

## 之後可以加的東西
排行榜（Firestore）、更多地圖與怪物種類、道具商店、自架伺服器改成伺服器權威。
