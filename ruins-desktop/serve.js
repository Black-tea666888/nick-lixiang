// 本機小伺服器：把 app/ 資料夾用 http://127.0.0.1:埠號 提供給視窗。
// Firebase 登入不支援直接開 file://，用本機網址才能正常登入與存檔。
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};

/** 啟動伺服器，回傳 Promise<網址>。只聽 127.0.0.1，外面連不進來。 */
function serve(root) {
  root = path.resolve(root);
  const server = http.createServer(function (req, res) {
    let p = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(root, '.' + p);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }   // 不准跑出 app 資料夾
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise(function (resolve, reject) {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () { resolve('http://127.0.0.1:' + server.address().port + '/'); });
  });
}

module.exports = { serve: serve };
