// 把網頁版（../ruins）複製到 app/，給 Electron 打包。不帶說明文件和 Firebase 規則檔。
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'ruins');
const DEST = path.join(__dirname, 'app');
const SKIP = new Set(['README.md', 'firestore.rules', 'firebase.json', '.DS_Store']);

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true, filter: function (p) { return !SKIP.has(path.basename(p)); } });
console.log('已複製遊戲到 ' + DEST);
