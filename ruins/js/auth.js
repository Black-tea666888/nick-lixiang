/* 登入：Firebase Authentication（Google / Apple / LINE / Facebook / 匿名訪客）
 * 沒有設定 Firebase 時，自動退回「本機訪客」。 */
(function () {
'use strict';
const RR = window.RR = window.RR || {};

const LS_GUEST = 'rr_guest', LS_NICK = 'rr_nick';
function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function rid(n) { let s = ''; const ch = 'abcdefghjkmnpqrstuvwxyz23456789'; for (let i = 0; i < n; i++) s += ch[Math.floor(Math.random() * ch.length)]; return s; }

let auth = null, fbUser = null, user = null, onChange = function () {}, memGuest = null;

const LABEL = { 'google.com': 'Google', 'apple.com': 'Apple', 'facebook.com': 'Facebook', guest: '訪客' };
function providerLabel(id) { if (id && id.indexOf('oidc.') === 0) return 'LINE'; return LABEL[id] || id || '訪客'; }

function configured() { const c = RR.CONFIG && RR.CONFIG.firebase; return !!(c && c.apiKey && window.firebase && window.firebase.auth); }

function build() {
  const nick = ls(LS_NICK);
  if (fbUser) {
    let prov = 'guest';
    if (!fbUser.isAnonymous && fbUser.providerData && fbUser.providerData[0]) prov = fbUser.providerData[0].providerId;
    user = { uid: fbUser.uid, provider: prov, providerLabel: providerLabel(prov), guest: !!fbUser.isAnonymous,
      name: nick || fbUser.displayName || ('訪客' + fbUser.uid.slice(0, 4)) };
  } else {
    const g = ls(LS_GUEST) || memGuest;
    user = g ? { uid: g, provider: 'guest', providerLabel: '訪客', guest: true, name: nick || ('訪客' + g.slice(-4)) } : null;
  }
  onChange(user);
}

function makeProvider(name) {
  const A = window.firebase.auth;
  if (name === 'google') return new A.GoogleAuthProvider();
  if (name === 'facebook') return new A.FacebookAuthProvider();
  if (name === 'apple') { const p = new A.OAuthProvider('apple.com'); p.addScope('name'); return p; }
  if (name === 'line') { const p = new A.OAuthProvider(RR.CONFIG.lineProviderId || 'oidc.line'); p.addScope('profile'); return p; }
  throw new Error('unknown provider');
}

const ERR = {
  'rr/popup-blocked': '瀏覽器擋住了登入視窗，請再按一次登入。',
  'rr/not-configured': '這個登入方式還沒設定金鑰（請看 README 的設定步驟）。現在可以先用訪客登入。',
  'auth/operation-not-allowed': '這個登入方式尚未在 Firebase 後台啟用。',
  'auth/unauthorized-domain': '這個網域還沒加入 Firebase 的「已授權網域」。',
  'auth/account-exists-with-different-credential': '這個 Email 已經用其他登入方式註冊過，請改用原本的方式登入。',
  'auth/popup-closed-by-user': '登入視窗被關掉了。',
  'auth/network-request-failed': '網路連線失敗，請再試一次。',
  'auth/invalid-api-key': 'Firebase 的 apiKey 不正確，請檢查 js/config.js。'
};

RR.Auth = {
  configured: configured,
  user: function () { return user; },
  message: function (e) { return (e && ERR[e.code]) || ('登入失敗：' + ((e && (e.code || e.message)) || '未知錯誤')); },
  init: function (cb) {
    onChange = cb || onChange;
    if (configured()) {
      try {
        window.firebase.initializeApp(RR.CONFIG.firebase);
        auth = window.firebase.auth();
        auth.getRedirectResult().catch(function (e) { if (RR.UI) RR.UI.say(RR.Auth.message(e)); });
        auth.onAuthStateChanged(function (u) { fbUser = u || null; build(); });
        return;
      } catch (e) { auth = null; }
    }
    build();
  },
  signIn: function (name) {
    if (!auth) return Promise.reject({ code: 'rr/not-configured' });
    let provider;
    try { provider = makeProvider(name); } catch (e) { return Promise.reject(e); }
    // 不再改用整頁跳轉：iPhone Safari 會把跳轉前的 sessionStorage 隔離，回來時出現「missing initial state」錯誤頁
    return auth.signInWithPopup(provider).catch(function (e) {
      const c = e && e.code;
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') throw { code: 'rr/popup-blocked' };
      throw e;
    });
  },
  /** 加到主畫面（獨立視窗）時，Firebase 的彈窗與跳轉登入在 iPhone 上都會失敗；改用 Google 官方按鈕拿 ID token 再交給 Firebase */
  standalone: function () { try { return !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)); } catch (e) { return false; } },
  gisReady: function () { return !!(auth && RR.CONFIG.googleClientId && RR.Auth.standalone()); },
  /** 把官方按鈕畫進 el；onError(e) 在失敗時呼叫 */
  gisButton: function (el, onError) {
    const go = function () {
      try {
        window.google.accounts.id.initialize({ client_id: RR.CONFIG.googleClientId, use_fedcm_for_prompt: false, callback: function (r) {
          try { auth.signInWithCredential(window.firebase.auth.GoogleAuthProvider.credential(r.credential)).catch(onError); } catch (e) { onError(e); }
        } });
        el.textContent = ''; window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', width: Math.min(300, Math.max(200, el.clientWidth || 280)) });
      } catch (e) { onError(e); }
    };
    if (window.google && window.google.accounts && window.google.accounts.id) { go(); return; }
    const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = go; sc.onerror = function () { onError({ code: 'network-request-failed' }); };
    document.head.appendChild(sc);
  },
  guest: function () {
    const local = function () { if (!ls(LS_GUEST)) { memGuest = 'guest-' + rid(10); lsSet(LS_GUEST, memGuest); } build(); };
    if (auth) {
      // 雲端連不上（離線、被擋）時不要卡在登入頁：6 秒沒回應就改用本機訪客
      let done = false;
      const t = setTimeout(function () { if (!done && !fbUser) { done = true; local(); } }, 6000);
      return auth.signInAnonymously().then(function () { done = true; clearTimeout(t); }).catch(function () { if (!done) { done = true; clearTimeout(t); local(); } });
    }
    local(); return Promise.resolve();
  },
  signOut: function () {
    lsSet(LS_GUEST, null); memGuest = null;
    if (auth && fbUser) return auth.signOut().catch(function () {}).then(function () { fbUser = null; build(); });
    build(); return Promise.resolve();
  },
  setNick: function (n) {
    n = String(n || '').replace(/\s+/g, ' ').trim().slice(0, 12);
    lsSet(LS_NICK, n || null); build();
  }
};
})();
