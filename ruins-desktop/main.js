// 廢墟回收隊 桌面版（Electron）：上架 Steam 用的 Windows／Mac／Linux 程式外殼。
// 遊戲本體就是 ../ruins 的網頁版，打包前用 copy-app.js 複製到 app/。
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { serve } = require('./serve');

let win = null;

async function createWindow() {
  const url = await serve(path.join(__dirname, 'app'));
  win = new BrowserWindow({
    width: 1280, height: 720, minWidth: 960, minHeight: 540,
    backgroundColor: '#1e1a16', title: '廢墟回收隊', autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  Menu.setApplicationMenu(null);   // 不要上方的選單列
  win.once('ready-to-show', function () { win.show(); });
  // 外部連結（隱私權政策等）用系統瀏覽器開，不在遊戲視窗裡開
  win.webContents.setWindowOpenHandler(function (d) { if (/^https?:/.test(d.url) && !d.url.startsWith(url)) shell.openExternal(d.url); return { action: 'deny' }; });
  // F11 或 Alt+Enter 切換全螢幕；F12 開發者工具只在開發時有用
  win.webContents.on('before-input-event', function (e, input) {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  await win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', function () { app.quit(); });
