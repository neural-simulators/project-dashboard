/* Pipeline animation (SVG built here, animated with requestAnimationFrame):
   scene graph rows -> tokens -> transformer -> output tensor -> loss, with a
   bright pulse travelling along the arrows and the active stage lit up. */
(function () {
  'use strict';
  var WM = window.WM, S = window.WM_SAMPLE || null;
  var root = document.getElementById('anim-pipeline');
  if (!root || !WM) return;
  var svg = root.querySelector('svg'), btn = root.querySelector('button'), cap = root.querySelector('.wm-caption');
  var C = WM.colors, NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    (parent || svg).appendChild(e);
    return e;
  }

  var BW = 150, BH = 164, BY = 34, BX = [10, 192.5, 375, 557.5, 740], MID = BY + 86;
  var TITLES = ['Scene graph: 27 rows', '29 tokens', 'Transformer', 'Output: 18 x 60 x 15', 'Loss vs PhysX truth'];
  var CAPS = [
    'Stage 1 of 5, scene graph: one row per object (76 numbers + 3 ids). The red and blue rows are the two balls.',
    'Stage 2 of 5, tokens: a small layer turns each row into a 512-number token; one action token (A) and one global token (G) join the 27 object tokens.',
    'Stage 3 of 5, transformer: all tokens attend to each other.',
    'Stage 4 of 5, output: 15 numbers per object per frame. The two highlighted rows are the balls that move; the other 16 rows stay zero.',
    'Stage 5 of 5, loss: squared error against the stored PhysX trajectory.'
  ];

  /* indices used for the highlights (from the sample data when present) */
  var objIds = S && S.object_ids ? S.object_ids : null;
  var movIds = S && S.movable_object_ids ? S.movable_object_ids : null;
  var rowRed = objIds ? objIds.indexOf('o024') : 23, rowBlue = objIds ? objIds.indexOf('o025') : 24;
  var movRed = movIds ? movIds.indexOf('o024') : 15, movBlue = movIds ? movIds.indexOf('o025') : 16;
  var blueFirstMove = 27;   /* frame at which the blue ball first moved more than 1 cm */
  if (S && S.objects && S.objects.o025) {
    var P = S.objects.o025.position, p0 = P[0];
    for (var f = 1; f < P.length; f++) {
      var d = Math.sqrt(Math.pow(P[f][0] - p0[0], 2) + Math.pow(P[f][1] - p0[1], 2) + Math.pow(P[f][2] - p0[2], 2));
      if (d > 0.01) { blueFirstMove = f; break; }
    }
  }

  svg.setAttribute('viewBox', '0 0 900 ' + (BY + BH + 14));
  var defs = el('defs', {});
  var marker = el('marker', { id: 'pl-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', fill: C.muted }, marker);

  var boxes = [], titles = [];
  for (var i = 0; i < 5; i++) {
    var g = el('g', { 'font-family': '"Noto Sans", sans-serif' });
    boxes.push(el('rect', { x: BX[i], y: BY, width: BW, height: BH, rx: 8, fill: '#fff', stroke: C.border, 'stroke-width': 1.5 }, g));
    titles.push(el('text', { x: BX[i] + BW / 2, y: BY + 20, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 'bold', fill: '#222' }, g, TITLES[i]));
    if (i < 4) {
      el('line', { x1: BX[i] + BW + 2, y1: MID, x2: BX[i + 1] - 2, y2: MID, stroke: C.muted, 'stroke-width': 1.5, 'marker-end': 'url(#pl-arrow)' });
    }
  }

  /* stage 0: 27 rows */
  for (var r = 0; r < 27; r++) {
    var col = r === rowRed ? C.red : (r === rowBlue ? C.ballBlue : C.faintGray);
    el('line', { x1: BX[0] + 22, y1: BY + 40 + r * 4.3, x2: BX[0] + 128, y2: BY + 40 + r * 4.3, stroke: col, 'stroke-width': r === rowRed || r === rowBlue ? 2.6 : 2 });
  }
  el('text', { x: BX[0] + BW / 2, y: BY + BH - 6, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, 'one row = 76 numbers + 3 ids');

  /* stage 1: 29 tokens in a 6 x 5 grid */
  for (var t = 0; t < 29; t++) {
    var cx = BX[1] + 20 + (t % 6) * 19, cy = BY + 38 + Math.floor(t / 6) * 19;
    var fill = C.dotGray, stroke = 'none', text = null, textFill = '#fff';
    if (t === rowRed) { fill = C.red; }
    if (t === 27) { fill = '#fff'; stroke = C.red; text = 'A'; textFill = C.red; }
    if (t === 28) { fill = '#333'; text = 'G'; }
    el('rect', { x: cx, y: cy, width: 14, height: 14, rx: 2, fill: fill, stroke: stroke, 'stroke-width': 1.5 });
    if (text) el('text', { x: cx + 7, y: cy + 11, 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 'bold', fill: textFill }, null, text);
  }
  el('text', { x: BX[1] + BW / 2, y: BY + BH - 18, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, '27 objects + action (A)');
  el('text', { x: BX[1] + BW / 2, y: BY + BH - 6, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, '+ global physics (G)');

  /* stage 2: stacked layers */
  for (var L = 0; L < 5; L++) {
    el('rect', { x: BX[2] + 25, y: BY + 42 + L * 18, width: 100, height: 12, rx: 3, fill: '#e8eef9', stroke: C.blue, 'stroke-width': 1 });
  }
  for (var a = 0; a < 6; a++) {
    el('line', { x1: BX[2] + 30 + a * 18, y1: BY + 136, x2: BX[2] + 120 - a * 14, y2: BY + 150, stroke: C.blue, 'stroke-width': 0.8, opacity: 0.6 });
  }
  el('text', { x: BX[2] + BW / 2, y: BY + BH - 6, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, 'every token attends to all');

  /* stage 3: 18 x 60 grid, two rows highlighted */
  var GX = BX[3] + 18, GY = BY + 36, CW = 2, CH = 4;
  for (var row = 0; row < 18; row++) {
    el('rect', { x: GX, y: GY + row * CH, width: 60 * CW, height: CH - 1, fill: '#e4e8ee' });
  }
  el('rect', { x: GX, y: GY + movRed * CH, width: 60 * CW, height: CH - 1, fill: C.red });
  el('rect', { x: GX + (blueFirstMove - 1) * CW, y: GY + movBlue * CH, width: (60 - blueFirstMove + 1) * CW, height: CH - 1, fill: C.ballBlue });
  for (var tick = 0; tick <= 60; tick += 30) {
    el('line', { x1: GX + tick * CW, y1: GY + 18 * CH + 1, x2: GX + tick * CW, y2: GY + 18 * CH + 5, stroke: C.muted, 'stroke-width': 1 });
  }
  el('text', { x: GX + 60 * CW / 2, y: GY + 18 * CH + 16, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, '60 frames (2 s)');
  el('text', { x: GX - 5, y: GY + 9 * CH, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted, transform: 'rotate(-90 ' + (GX - 5) + ' ' + (GY + 9 * CH) + ')' }, null, '18 objects');
  el('text', { x: BX[3] + BW / 2, y: BY + BH - 6, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, '15 numbers per cell');

  /* stage 4: truth vs prediction with gap ticks */
  var ox = BX[4] + 20, oy = BY + 128;
  el('line', { x1: ox, y1: oy, x2: ox + 110, y2: oy, stroke: C.muted, 'stroke-width': 1 });
  el('path', { d: 'M' + ox + ',' + (oy - 4) + ' Q' + (ox + 40) + ',' + (oy - 95) + ' ' + (ox + 70) + ',' + (oy - 4) + ' L' + (ox + 110) + ',' + (oy - 4), fill: 'none', stroke: C.red, 'stroke-width': 2 });
  el('path', { d: 'M' + ox + ',' + (oy - 4) + ' Q' + (ox + 44) + ',' + (oy - 80) + ' ' + (ox + 78) + ',' + (oy - 4) + ' L' + (ox + 110) + ',' + (oy - 10), fill: 'none', stroke: C.blue, 'stroke-width': 2, 'stroke-dasharray': '4 3' });
  var gapX = [ox + 25, ox + 45, ox + 62, ox + 100], gapTop = [oy - 50, oy - 72, oy - 42, oy - 10], gapBot = [oy - 42, oy - 61, oy - 32, oy - 4];
  for (var gI = 0; gI < gapX.length; gI++) {
    el('line', { x1: gapX[gI], y1: gapTop[gI], x2: gapX[gI], y2: gapBot[gI], stroke: C.red, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
  }
  el('text', { x: BX[4] + BW / 2, y: BY + BH - 18, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, 'red: PhysX truth, blue: model');
  el('text', { x: BX[4] + BW / 2, y: BY + BH - 6, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.muted }, null, 'red bars: squared gaps');

  /* the pulse */
  var pulse = el('g', { visibility: 'hidden' });
  el('circle', { r: 11, fill: C.amber, opacity: 0.3 }, pulse);
  el('circle', { r: 6, fill: C.amber }, pulse);

  /* timeline */
  var STAGE = 1.5, ARROW = 0.55, PAUSE = 0.5, segs = [];
  for (var sIdx = 0; sIdx < 5; sIdx++) {
    segs.push({ kind: 'stage', i: sIdx, dur: STAGE });
    if (sIdx < 4) segs.push({ kind: 'arrow', i: sIdx, dur: ARROW });
  }
  segs.push({ kind: 'pause', i: 4, dur: PAUSE });
  var st = { seg: 0, t: 0 }, lastCap = null;

  function advance(dt) {
    st.t += dt;
    while (st.t >= segs[st.seg].dur) {
      st.t -= segs[st.seg].dur;
      st.seg = (st.seg + 1) % segs.length;
    }
  }
  function render() {
    var sg = segs[st.seg], q = st.t / sg.dur;
    var active = sg.kind === 'stage' ? sg.i : -1;
    for (var b = 0; b < 5; b++) {
      boxes[b].setAttribute('stroke', b === active ? C.blue : C.border);
      boxes[b].setAttribute('stroke-width', b === active ? 2.5 : 1.5);
      boxes[b].setAttribute('fill', b === active ? '#fffaf0' : '#fff');
      titles[b].setAttribute('fill', b === active ? C.blue : '#222');
    }
    if (sg.kind === 'arrow') {
      var x = WM.lerp(BX[sg.i] + BW + 4, BX[sg.i + 1] - 6, WM.ease(q));
      pulse.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + MID + ')');
      pulse.setAttribute('visibility', 'visible');
    } else {
      pulse.setAttribute('visibility', 'hidden');
    }
    var text = CAPS[sg.i];
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }
  function representative() {
    for (var k = 0; k < segs.length; k++) if (segs[k].kind === 'stage' && segs[k].i === 3) st.seg = k;
    st.t = 0;
  }

  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
