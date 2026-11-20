/* 國際象棋的棋子外型：全部改成我們自己的怪物（規則不變，只換圖）。
   白方：撿荒者這邊的石像與機械（青色標記）；黑方：廢墟怪物（紅眼）。
   王＝石像守衛　后＝幽燈　車＝石堡　象＝獨眼飛怪　馬＝石獸　兵＝碎石獸 */
(function (root) {
  'use strict';
  const BODY = {
    w: { fill: '#eef6f2', stroke: '#1d2b33', accent: '#2bb3a3', eye: '#1d2b33' },
    b: { fill: '#4a4658', stroke: '#15121c', accent: '#ff5a4e', eye: '#ff5a4e' }
  };
  const SHAPES = {
    // 碎石獸（兵）：圓滾滾的石頭身體，上面一顆小頭
    p: function (c) {
      return '<ellipse cx="24" cy="31" rx="13" ry="10"/><circle cx="24" cy="19" r="7"/>' +
        '<circle cx="21" cy="18" r="1.6" class="eye"/><circle cx="27" cy="18" r="1.6" class="eye"/>';
    },
    // 石堡（車）：城垛、中間一扇窗
    r: function (c) {
      return '<rect x="12" y="14" width="24" height="26"/>' +
        '<rect x="11" y="9" width="6" height="6"/><rect x="21" y="9" width="6" height="6"/><rect x="31" y="9" width="6" height="6"/>' +
        '<rect x="21" y="23" width="6" height="8" class="dark"/><rect x="12" y="35" width="24" height="2" class="accent"/>';
    },
    // 石獸（馬）：耳朵、長臉、一隻眼
    n: function (c) {
      return '<path d="M14 40 L14 22 L20 12 L28 14 L34 24 L34 40 Z"/><path d="M20 12 L22 5 L26 12 Z"/>' +
        '<circle cx="27" cy="22" r="2" class="eye"/><rect x="14" y="36" width="20" height="2" class="accent"/>';
    },
    // 獨眼飛怪（象）：圓眼球加尾巴
    b: function (c) {
      return '<circle cx="24" cy="19" r="10"/><path d="M16 26 L24 44 L32 26 Z"/>' +
        '<circle cx="24" cy="19" r="4" class="white"/><circle cx="24" cy="19" r="2" class="eye"/>';
    },
    // 幽燈（后）：斗篷與頭頂的火焰
    q: function (c) {
      return '<path d="M14 40 Q14 18 24 10 Q34 18 34 40 Z"/><path d="M24 1 Q30 8 24 13 Q18 8 24 1 Z" class="accent"/>' +
        '<circle cx="21" cy="24" r="1.8" class="eye"/><circle cx="27" cy="24" r="1.8" class="eye"/>';
    },
    // 石像守衛（王）：方正的身體、頭冠、狹長的眼縫
    k: function (c) {
      return '<rect x="14" y="20" width="20" height="22"/><rect x="17" y="8" width="14" height="12"/>' +
        '<polygon points="17,8 19,3 24,6 29,3 31,8"/><rect x="19" y="13" width="10" height="2" class="dark"/>' +
        '<rect x="14" y="36" width="20" height="2" class="accent"/>';
    }
  };
  /* p：棋子字母（大寫白方，小寫黑方）；回傳一段靜態 SVG 字串 */
  function svg(p) {
    if (!p) return '';
    const side = p === p.toUpperCase() ? 'w' : 'b', kind = p.toLowerCase(), col = BODY[side];
    const shape = SHAPES[kind];
    if (!shape) return '';
    return '<svg viewBox="0 0 48 48" aria-hidden="true" style="--fill:' + col.fill + ';--stroke:' + col.stroke + ';--accent:' + col.accent + ';--eye:' + col.eye + '">' +
      '<g class="pc">' + shape(side) + '</g></svg>';
  }
  root.RR = root.RR || {};
  root.RR.ChessArt = { svg: svg };
})(typeof window !== 'undefined' ? window : this);
