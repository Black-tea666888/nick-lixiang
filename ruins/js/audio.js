/* 音效 + 語音（麥克風、WebRTC 語音網狀連線、近距離音量） */
(function () {
'use strict';
const RR = window.RR = window.RR || {};

let ac = null, master = null, sfxGain = null, voiceGain = null, droneNodes = null;
function ctx() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try {
      ac = new C();
      master = ac.createGain(); master.connect(ac.destination);
      sfxGain = ac.createGain(); sfxGain.connect(master);
      voiceGain = ac.createGain(); voiceGain.connect(master);
    } catch (e) { ac = null; return null; }
  }
  if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
  return ac;
}

const Sfx = {
  unlock: ctx,
  setVolume: function (v) { if (ctx()) sfxGain.gain.value = v; },
  tone: function (freq, dur, type, vol, slideTo) {
    if (!ac) return;
    try {
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  noise: function (dur, vol) {
    if (!ac) return;
    try {
      const len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = ac.createBufferSource(), g = ac.createGain(); g.gain.value = vol;
      s.buffer = buf; s.connect(g); g.connect(sfxGain); s.start();
    } catch (e) {}
  },
  drone: function (on) {
    if (!ctx()) return;
    try {
      if (on && !droneNodes) {
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 130;
        const g = ac.createGain(); g.gain.value = 0.05;
        const os = [49, 51.5].map(function (f) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
        lp.connect(g); g.connect(sfxGain);
        droneNodes = { os: os, g: g };
      } else if (!on && droneNodes) {
        droneNodes.os.forEach(function (o) { try { o.stop(); } catch (e) {} });
        droneNodes.g.disconnect(); droneNodes = null;
      }
    } catch (e) {}
  }
};

/* ---------- 語音 ---------- */
let local = null, hasMic = false, muted = false, analyser = null, abuf = null, micError = null;
const calls = new Map();   // peerId -> { call, el, src, gain, pan, t0 }

const Voice = {
  /** 取得麥克風（失敗就用無聲音軌，仍可聽別人說話）。回傳是否有麥克風。 */
  init: async function (wantMic) {
    if (!ctx()) return false;
    if (local && (hasMic || !wantMic)) return hasMic;
    if (wantMic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        local = s; hasMic = true; micError = null;
        const src = ac.createMediaStreamSource(s);
        analyser = ac.createAnalyser(); analyser.fftSize = 512; abuf = new Float32Array(analyser.fftSize);
        src.connect(analyser);
        Voice.setMuted(muted);
      } catch (e) { micError = (e && e.name) || 'Error'; }
    } else if (wantMic) { micError = 'NotSupported'; }
    if (!local) { try { local = ac.createMediaStreamDestination().stream; } catch (e) { local = null; } hasMic = false; }
    return hasMic;
  },
  hasMic: function () { return hasMic; },
  micError: function () { return micError; },
  isMuted: function () { return muted; },
  setMuted: function (b) {
    muted = !!b;
    if (local && hasMic) local.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
  },
  setVolume: function (v) { if (ctx()) voiceGain.gain.value = v; },
  /** 目前麥克風音量（RMS，0~1） */
  level: function () {
    if (!analyser || muted) return 0;
    try {
      analyser.getFloatTimeDomainData(abuf);
      let s = 0; for (let i = 0; i < abuf.length; i++) s += abuf[i] * abuf[i];
      return Math.sqrt(s / abuf.length);
    } catch (e) { return 0; }
  },
  _attach: function (call) {
    const old = calls.get(call.peer);
    if (old && old.call !== call) { try { old.call.close(); } catch (e) {} Voice._cleanup(call.peer); }
    const entry = { call: call, el: null, src: null, gain: null, pan: null, t0: Date.now() };
    calls.set(call.peer, entry);
    call.on('stream', function (stream) {
      if (entry.src || !ctx()) return;
      try {
        // Chrome 需要把遠端串流掛到媒體元素上，WebAudio 才收得到聲音
        const el = new Audio(); el.muted = true; el.srcObject = stream;
        const pr = el.play(); if (pr && pr.catch) pr.catch(function () {});
        entry.el = el;
        entry.src = ac.createMediaStreamSource(stream);
        entry.gain = ac.createGain(); entry.gain.gain.value = 1;
        entry.src.connect(entry.gain);
        if (ac.createStereoPanner) { entry.pan = ac.createStereoPanner(); entry.gain.connect(entry.pan); entry.pan.connect(voiceGain); }
        else entry.gain.connect(voiceGain);
      } catch (e) {}
    });
    const gone = function () { if (calls.get(call.peer) === entry) Voice._cleanup(call.peer); };
    call.on('close', gone); call.on('error', gone);
  },
  _cleanup: function (id) {
    const e = calls.get(id);
    if (!e) return;
    calls.delete(id);
    try { if (e.src) e.src.disconnect(); if (e.gain) e.gain.disconnect(); if (e.pan) e.pan.disconnect(); } catch (err) {}
    if (e.el) { try { e.el.srcObject = null; } catch (err) {} }
  },
  /** 房主把名單傳來時呼叫：對 ID 比自己大的人撥號，移除已離開的人 */
  sync: function (myId, peerIds) {
    if (!local || !RR.Net) return;
    const now = Date.now();
    peerIds.forEach(function (id) {
      const e = calls.get(id);
      if (e && !e.src && now - e.t0 > 9000) { try { e.call.close(); } catch (err) {} Voice._cleanup(id); }
      if (!calls.has(id) && myId < id) {
        const call = RR.Net.call(id, local);
        if (call) Voice._attach(call);
      }
    });
    Array.from(calls.keys()).forEach(function (id) {
      if (peerIds.indexOf(id) === -1) { const e = calls.get(id); try { e.call.close(); } catch (err) {} Voice._cleanup(id); }
    });
  },
  onIncoming: function (call) {
    if (!local) { try { call.close(); } catch (e) {} return; }
    try { call.answer(local); } catch (e) { return; }
    Voice._attach(call);
  },
  /** 設定某位玩家的聲音大小（0~1）與左右聲道（-1~1） */
  spatial: function (id, gain, pan) {
    const e = calls.get(id);
    if (!e || !e.gain) return;
    try {
      e.gain.gain.setTargetAtTime(gain, ac.currentTime, 0.08);
      if (e.pan) e.pan.pan.setTargetAtTime(pan, ac.currentTime, 0.08);
    } catch (err) {}
  },
  connected: function (id) { const e = calls.get(id); return !!(e && e.src); },
  closeAll: function () {
    Array.from(calls.keys()).forEach(function (id) { const e = calls.get(id); try { e.call.close(); } catch (err) {} Voice._cleanup(id); });
  }
};

RR.Sfx = Sfx; RR.Voice = Voice;
})();
