/* Overview of one benchmark attempt as an icon pipeline (SVG): room -> prompt -> model -> answer -> simulator -> verdict.
   A pulse travels along the arrows, the active stage lights up; one short caption per stage. */
(function () {
  'use strict';
  var WM = window.WM, D = window.HW_DATA;
  var root = document.getElementById('hw-anim-overview');
  if (!root || !WM || !D) return;
  var svg = root.querySelector('svg'), btn = root.querySelector('button'), cap = root.querySelector('.wm-caption');
  var NS = 'http://www.w3.org/2000/svg', XL = 'http://www.w3.org/1999/xlink';
  var C = { ref: '#2b8a3e', gpt: '#1f6feb', qwen: '#c2255c', instruction: '#f59f00', images: '#12b886', checks: '#7048e8', output: '#1098ad',
            scene: '#8da2c0', rules: '#c3cad5', border: '#d9dee5', muted: '#767676', amber: '#f5a623', red: '#d7263d', ink: '#222' };
  function el(name, attrs, parent, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    (parent || svg).appendChild(e);
    return e;
  }
  var ex = D.examples.static, views = ex.prompt.sections.filter(function (s) { return s.key === 'IMAGES'; })[0].views;
  var W = 940, H = 230, N = 6, BW = 128, BH = 128, GAP = (W - 20 - N * BW) / (N - 1), TOP = 30;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  var defs = el('defs', {});
  var mk = el('marker', { id: 'hw-ov-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', fill: C.muted }, mk);
  var clip = el('clipPath', { id: 'hw-ov-clip' }, defs);
  var X = []; for (var i = 0; i < N; i++) X.push(10 + i * (BW + GAP));
  el('rect', { x: X[0] + 8, y: TOP + 14, width: BW - 16, height: 84, rx: 6 }, clip);
  var TITLES = ['Room', 'Prompt', 'Model', 'Answer', 'Simulator', 'Verdict'];
  var CAPS = ['A simulated room: furniture, small objects, balls; every object has a pose, size, mass and friction.',
              'The prompt: the instruction, two renders, every rule and check, and the whole scene as data.',
              'One call to GPT-5.4 or Qwen3-VL-30B Thinking: no tools, no feedback, one answer.',
              'The answer: new poses as JSON, a short program, or a launch velocity as numbers.',
              'PhysX applies the answer exactly as given and runs the physics (two seconds for a launch).',
              'Measured checks decide pass or fail; a reviewer AI comments but cannot overrule them.'];
  var boxes = [], titles = [];
  for (var b = 0; b < N; b++) {
    boxes.push(el('rect', { x: X[b], y: TOP, width: BW, height: BH, rx: 10, fill: '#fff', stroke: C.border, 'stroke-width': 1.6 }));
    titles.push(el('text', { x: X[b] + BW / 2, y: TOP + BH + 22, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: C.ink, 'font-family': '"Google Sans", sans-serif' }, null, TITLES[b]));
    if (b < N - 1) el('line', { x1: X[b] + BW + 4, y1: TOP + BH / 2, x2: X[b + 1] - 4, y2: TOP + BH / 2, stroke: C.muted, 'stroke-width': 1.6, 'marker-end': 'url(#hw-ov-arrow)' });
  }
  /* 1 room: a real render */
  var img = el('image', { x: X[0] + 8, y: TOP + 14, width: BW - 16, height: 84, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#hw-ov-clip)' });
  img.setAttributeNS(XL, 'href', './' + views[0]); img.setAttribute('href', './' + views[0]);
  el('text', { x: X[0] + BW / 2, y: TOP + 116, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, null, '24 to 34 objects');
  /* 2 prompt: a page with coloured stripes in the real proportions */
  var px = X[1] + 30, py = TOP + 12, pw = 68, ph = 100;
  el('rect', { x: px, y: py, width: pw, height: ph, rx: 4, fill: '#fafbfc', stroke: C.border });
  var secs = ex.prompt.sections.filter(function (s) { return s.chars > 0; }), total = secs.reduce(function (a, s) { return a + s.chars; }, 0), yy = py + 6;
  var stripes = [];
  secs.forEach(function (s) {
    var h = Math.max(3, (ph - 12) * s.chars / total);
    stripes.push(el('rect', { x: px + 6, y: yy, width: pw - 12, height: h - 1, rx: 1, fill: C[s.role] || C.rules }));
    yy += h;
  });
  /* 3 models: two chips */
  [['GPT-5.4', C.gpt], ['Qwen3-VL-30B', C.qwen]].forEach(function (m, k) {
    el('rect', { x: X[2] + 12, y: TOP + 26 + k * 44, width: BW - 24, height: 32, rx: 16, fill: m[1] });
    el('text', { x: X[2] + BW / 2, y: TOP + 47 + k * 44, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#fff' }, null, m[0]);
  });
  /* 4 answer: braces and a code glyph */
  el('text', { x: X[3] + BW / 2, y: TOP + 66, 'text-anchor': 'middle', 'font-size': 40, fill: C.output, 'font-family': 'ui-monospace, Menlo, monospace' }, null, '{ }');
  el('text', { x: X[3] + BW / 2, y: TOP + 100, 'text-anchor': 'middle', 'font-size': 12, fill: C.muted, 'font-family': 'ui-monospace, Menlo, monospace' }, null, 'poses · code · v');
  /* 5 simulator: a floor, a barrier and a ball on a lob */
  var sx = X[4] + 14, sy = TOP + 104;
  el('line', { x1: sx, y1: sy, x2: sx + BW - 28, y2: sy, stroke: C.muted, 'stroke-width': 1.5 });
  el('rect', { x: sx + 44, y: sy - 26, width: 8, height: 26, fill: '#9aa3ad' });
  el('path', { d: 'M' + (sx + 6) + ',' + (sy - 6) + ' Q' + (sx + 50) + ',' + (sy - 92) + ' ' + (sx + 92) + ',' + (sy - 6), fill: 'none', stroke: C.rules, 'stroke-width': 2, 'stroke-dasharray': '4 4' });
  var ball = el('circle', { cx: sx + 6, cy: sy - 6, r: 6, fill: C.red });
  /* 6 verdict */
  var tick = el('text', { x: X[5] + BW / 2 - 24, y: TOP + 74, 'text-anchor': 'middle', 'font-size': 42, 'font-weight': 700, fill: C.ref }, null, '✓');
  var cross = el('text', { x: X[5] + BW / 2 + 24, y: TOP + 74, 'text-anchor': 'middle', 'font-size': 42, 'font-weight': 700, fill: C.red }, null, '✗');
  el('text', { x: X[5] + BW / 2, y: TOP + 106, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, null, 'measured, not guessed');
  var pulse = el('g', { visibility: 'hidden' });
  el('circle', { r: 11, fill: C.amber, opacity: 0.3 }, pulse);
  el('circle', { r: 6, fill: C.amber }, pulse);

  var STAGE = 2.4, ARROW = 0.6, segs = [];
  for (var s = 0; s < N; s++) { segs.push({ kind: 'stage', i: s, dur: STAGE }); if (s < N - 1) segs.push({ kind: 'arrow', i: s, dur: ARROW }); }
  segs.push({ kind: 'pause', i: N - 1, dur: 0.8 });
  var st = { seg: 0, t: 0 }, last = null;
  function advance(dt) { st.t += dt; while (st.t >= segs[st.seg].dur) { st.t -= segs[st.seg].dur; st.seg = (st.seg + 1) % segs.length; } }
  function render() {
    var sg = segs[st.seg], q = st.t / sg.dur, active = sg.kind === 'stage' ? sg.i : -1;
    for (var k = 0; k < N; k++) {
      boxes[k].setAttribute('stroke', k === active ? C.gpt : C.border);
      boxes[k].setAttribute('stroke-width', k === active ? 3 : 1.6);
      titles[k].setAttribute('fill', k === active ? C.gpt : C.ink);
    }
    if (sg.kind === 'arrow') {
      var x = WM.lerp(X[sg.i] + BW + 6, X[sg.i + 1] - 8, WM.ease(q));
      pulse.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + (TOP + BH / 2) + ')'); pulse.setAttribute('visibility', 'visible');
    } else pulse.setAttribute('visibility', 'hidden');
    stripes.forEach(function (r, j) { r.setAttribute('opacity', active === 1 ? (j <= Math.floor(q * stripes.length * 1.2) ? 1 : 0.15) : 1); });
    var u = active === 4 ? WM.ease(q) : (st.seg > 8 ? 1 : 0);
    var bx = (1 - u) * (1 - u) * (sx + 6) + 2 * (1 - u) * u * (sx + 50) + u * u * (sx + 92), by = (1 - u) * (1 - u) * (sy - 6) + 2 * (1 - u) * u * (sy - 92) + u * u * (sy - 6);
    ball.setAttribute('cx', bx.toFixed(1)); ball.setAttribute('cy', by.toFixed(1));
    tick.setAttribute('opacity', active === 5 || sg.kind === 'pause' ? 1 : 0.25);
    cross.setAttribute('opacity', active === 5 || sg.kind === 'pause' ? 1 : 0.25);
    var text = CAPS[sg.i];
    if (text !== last) { cap.textContent = text; last = text; }
  }
  function representative() { for (var k = 0; k < segs.length; k++) if (segs[k].kind === 'stage' && segs[k].i === 1) st.seg = k; st.t = STAGE * 0.9; }
  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
