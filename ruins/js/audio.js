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

/* ---------- 背景音樂（程式即時合成，不需要音檔） ---------- */
const Music = (function () {
  const LEVEL = { off: 0, menu: 0.55, lobby: 0.6, calm: 0.7, tense: 0.85, chase: 1 };
  const CHORDS = [[110, 130.81, 164.81], [87.31, 110, 130.81], [98, 123.47, 146.83], [82.41, 103.83, 123.47]]; // Am F G E
  const BEAT = 60 / 76;
  let mood = 'off', vol = 0.6, out = null, lpf = null, timer = null, step = 0, nextT = 0, noiseBuf = null;

  function ensure() {
    const c = ctx();
    if (!c) return false;
    if (!out) {
      lpf = c.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 750;
      out = c.createGain(); out.gain.value = 0;
      lpf.connect(out); out.connect(master);
      nextT = c.currentTime + 0.2;
      timer = setInterval(tick, 120);
    }
    return true;
  }
  function note(f, t, dur, type, v, atk, dest) {
    try {
      const o = ac.createOscillator(), g = ac.createGain();
      const a = Math.min(atk, dur * 0.5);
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + a);
      g.gain.setValueAtTime(v, t + Math.max(a, dur - 0.4));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || lpf); o.start(t); o.stop(t + dur + 0.05);
    } catch (e) {}
  }
  function kick(t) {
    try {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
      g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(lpf); o.start(t); o.stop(t + 0.32);
    } catch (e) {}
  }
  function hat(t) {
    try {
      if (!noiseBuf) {
        noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.1), ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 6000;
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + 0.1);
    } catch (e) {}
  }
  function bar(n, t) {
    const ch = CHORDS[n % 4], len = BEAT * 4;
    const tense = mood === 'tense' || mood === 'chase', chase = mood === 'chase';
    ch.forEach(function (f) { note(f, t, len * 2, 'triangle', 0.035, 2.5); });        // 鋪底音
    note(ch[0] / 2, t, len, 'sine', 0.14, 0.4);                                        // 低音
    note(ch[0] / 2, t + len / 2, len / 2, 'sine', 0.09, 0.3);
    if (tense) for (let b = 0; b < 4; b++) { kick(t + b * BEAT); if (b % 2 === 1) hat(t + b * BEAT + BEAT / 2); }
    if (chase) {                                                                       // 追逐：不協和刺音
      note(ch[1] * 2, t + BEAT * 2, BEAT * 1.6, 'sawtooth', 0.025, 0.05);
      note(ch[1] * 2 * 1.0595, t + BEAT * 2, BEAT * 1.6, 'sawtooth', 0.02, 0.05);
      note(ch[2] * 2, t + BEAT * 3.5, BEAT * 0.4, 'sawtooth', 0.02, 0.02);
    }
  }
  function tick() {
    if (!ac || !out) return;
    const now = ac.currentTime;
    out.gain.setTargetAtTime(mood === 'off' ? 0 : vol * (LEVEL[mood] || 0) * 0.45, now, 0.5);
    lpf.frequency.setTargetAtTime(mood === 'chase' ? 1700 : mood === 'tense' ? 1100 : 750, now, 0.8);
    if (nextT < now) nextT = now + 0.1;   // 分頁被暫停後不要一次補播
    while (nextT < now + 0.5) { bar(step, nextT); step++; nextT += BEAT * 4; }
  }

  return {
    setMood: function (m) { mood = m; if (ac) ensure(); },
    setVolume: function (v) { vol = Math.max(0, Math.min(1, +v)); },
    sting: function (kind) {
      if (!ensure()) return;
      const t = ac.currentTime + 0.05;
      if (kind === 'win') [220, 277.18, 329.63, 440].forEach(function (f, i) { note(f, t + i * 0.14, 2.4, 'triangle', 0.09, 0.03, master); });
      else { note(55, t, 2.8, 'sawtooth', 0.12, 0.02, master); note(58.27, t, 2.8, 'sawtooth', 0.1, 0.02, master); }
    }
  };
})();
Sfx.drone = function () {};   // 舊的低頻嗡嗡聲改由背景音樂負責
RR.Music = Music;
RR.Sfx = Sfx; RR.Voice = Voice;
})();
