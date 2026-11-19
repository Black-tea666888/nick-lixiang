/* 國際象棋規則（同機雙人用）：純邏輯，不碰畫面。
 * 棋盤是 64 格的陣列，index = r*8 + c；r=0 是黑方底線，r=7 是白方底線。
 * 棋子用 FEN 字母：大寫白方、小寫黑方、null 是空格。
 * 規則：走法、吃過路兵、王車易位、升變（自動升后）、將軍、將死、逼和。
 * 沒有做：50 步和棋、三次重複和棋（同機玩不會卡住，之後要加再補）。 */
(function (root) {
  'use strict';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const RD = [[-1, 0], [1, 0], [0, -1], [0, 1]], BD = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const color = function (p) { return p === null ? null : (p === p.toUpperCase() ? 'w' : 'b'); };
  const kind = function (p) { return p.toUpperCase(); };
  const inb = function (r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; };

  function start() {
    const b = []; const rows = START.split('/');
    rows.forEach(function (row) { row.split('').forEach(function (ch) { if (/[1-8]/.test(ch)) for (let i = 0; i < +ch; i++) b.push(null); else b.push(ch); }); });
    return { b: b, turn: 'w', cr: 'KQkq', ep: -1, log: [] };
  }

  /** 某格的棋子能攻擊到的格子（不含王車易位；兵只算斜前方） */
  function targets(b, sq) {
    const p = b[sq], out = [], col = color(p), k = kind(p), r = Math.floor(sq / 8), c = sq % 8;
    if (k === 'P') { const d = col === 'w' ? -1 : 1; [-1, 1].forEach(function (dc) { if (inb(r + d, c + dc)) out.push((r + d) * 8 + c + dc); }); return out; }
    if (k === 'N' || k === 'K') { (k === 'N' ? KN : KG).forEach(function (o) { if (inb(r + o[0], c + o[1])) out.push((r + o[0]) * 8 + c + o[1]); }); return out; }
    const dirs = k === 'B' ? BD : k === 'R' ? RD : KG;   // Q 兩者都算
    const ds = k === 'Q' ? RD.concat(BD) : dirs;
    ds.forEach(function (o) {
      let nr = r + o[0], nc = c + o[1];
      while (inb(nr, nc)) { out.push(nr * 8 + nc); if (b[nr * 8 + nc] !== null) break; nr += o[0]; nc += o[1]; }
    });
    return out;
  }

  function attacked(b, sq, by) {
    for (let i = 0; i < 64; i++) if (b[i] !== null && color(b[i]) === by && targets(b, i).indexOf(sq) >= 0) return true;
    return false;
  }

  function kingSq(b, col) { const ch = col === 'w' ? 'K' : 'k'; return b.indexOf(ch); }
  function inCheck(s, col) { const k = kingSq(s.b, col); return k >= 0 && attacked(s.b, k, col === 'w' ? 'b' : 'w'); }

  /** 所有合法走法（已排除會讓自己被將軍的走法） */
  function legalMoves(s, from) {
    const col = s.turn, opp = col === 'w' ? 'b' : 'w', b = s.b, out = [];
    for (let i = 0; i < 64; i++) {
      if (from !== undefined && i !== from) continue;
      const p = b[i]; if (p === null || color(p) !== col) continue;
      const k = kind(p), r = Math.floor(i / 8), c = i % 8;
      if (k === 'P') {
        const d = col === 'w' ? -1 : 1, last = col === 'w' ? 0 : 7, start = col === 'w' ? 6 : 1;
        if (inb(r + d, c) && b[(r + d) * 8 + c] === null) {
          out.push({ from: i, to: (r + d) * 8 + c });
          if (r === start && b[(r + 2 * d) * 8 + c] === null) out.push({ from: i, to: (r + 2 * d) * 8 + c, two: true });
        }
        [-1, 1].forEach(function (dc) {
          if (!inb(r + d, c + dc)) return;
          const t = (r + d) * 8 + c + dc;
          if (b[t] !== null && color(b[t]) === opp) out.push({ from: i, to: t });
          else if (t === s.ep) out.push({ from: i, to: t, ep: true });
        });
        out.forEach(function (m) { if (m.from === i && Math.floor(m.to / 8) === last) m.promo = true; });
      } else {
        targets(b, i).forEach(function (t) { if (b[t] === null || color(b[t]) === opp) out.push({ from: i, to: t }); });
        if (k === 'K') castles(s, col, i).forEach(function (m) { out.push(m); });
      }
    }
    return out.filter(function (m) { return !inCheck(apply(s, m), col); });
  }

  /** 王車易位：王不在將軍中、路徑不受攻擊、中間格子是空的、車還在原位、權利還在 */
  function castles(s, col, k) {
    const b = s.b, opp = col === 'w' ? 'b' : 'w', out = [];
    const home = col === 'w' ? 60 : 4, rights = col === 'w' ? ['K', 'Q'] : ['k', 'q'];
    if (k !== home || attacked(b, home, opp)) return out;
    const ch = col === 'w' ? 'R' : 'r';
    if (s.cr.indexOf(rights[0]) >= 0 && b[home + 3] === ch && b[home + 1] === null && b[home + 2] === null && !attacked(b, home + 1, opp) && !attacked(b, home + 2, opp))
      out.push({ from: home, to: home + 2, castle: [home + 3, home + 1] });
    if (s.cr.indexOf(rights[1]) >= 0 && b[home - 4] === ch && b[home - 1] === null && b[home - 2] === null && b[home - 3] === null && !attacked(b, home - 1, opp) && !attacked(b, home - 2, opp))
      out.push({ from: home, to: home - 2, castle: [home - 4, home - 1] });
    return out;
  }

  /** 走一步，回傳新狀態（不改舊的） */
  function apply(s, m) {
    const b = s.b.slice(), p = b[m.from], col = color(p), k = kind(p);
    let cr = s.cr, ep = -1;
    b[m.from] = null;
    if (m.ep) b[m.to + (col === 'w' ? 8 : -8)] = null;
    if (m.castle) { b[m.castle[1]] = b[m.castle[0]]; b[m.castle[0]] = null; }
    b[m.to] = m.promo ? (col === 'w' ? 'Q' : 'q') : p;
    if (k === 'K') cr = cr.replace(col === 'w' ? /[KQ]/g : /[kq]/g, '');
    [0, 7, 56, 63].forEach(function (sq) {   // 車的原位被動或被吃，就失去那一邊的易位權
      if (m.from === sq || m.to === sq) cr = cr.replace({ 0: 'q', 7: 'k', 56: 'Q', 63: 'K' }[sq], '');
    });
    if (k === 'P' && m.two) ep = (m.from + m.to) / 2;
    return { b: b, turn: col === 'w' ? 'b' : 'w', cr: cr, ep: ep, log: s.log.concat([m]) };
  }

  /** 目前局面：play（進行中）、check（將軍）、mate（將死，winner 是贏的一方）、stale（逼和） */
  function status(s) {
    const moves = legalMoves(s);
    if (!moves.length) return inCheck(s, s.turn) ? { k: 'mate', winner: s.turn === 'w' ? 'b' : 'w' } : { k: 'stale' };
    return { k: inCheck(s, s.turn) ? 'check' : 'play' };
  }

  const api = { start: start, legalMoves: legalMoves, apply: apply, status: status, inCheck: inCheck, color: color };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RR = root.RR || {}; root.RR.Chess = api; }
})(typeof window !== 'undefined' ? window : globalThis);
