/* The masked flow model, one question at a time (canvas, Next steps tab). Three places, and only these: conditioning (known, stays
   fixed), to denoise (hidden, starts as noise), output (only what was hidden). A question decides which cards go where.
   The masks come from simagent/unified/wm/masked.py (masks_from, given_tool) through tools/extract_masked_anim.py; the sample is one
   real PhysX record. Hidden tokens are drawn on the straight path from noise to that record, x_t = (1 - t) x_0 + t eps, which is
   not a trained model's output. Nothing moves on load and nothing loops: a run plays through its steps once and stops. */
(function () {
  'use strict';
  var D = window.MASKED_ANIM, root = document.getElementById('masked-anim');
  if (!D || !root) return;
  var K = D.K, B = D.bodies, M = B.length, PS = D.patch_s, H = D.horizon_s, A = D.action, MASK = D.masks, STEPS = 10;
  var TOOL = B.findIndex(function (b) { return b.tool; }), BALLS = [], FIRST;
  B.forEach(function (b, i) { if (i !== TOOL) BALLS.push(i); });
  FIRST = BALLS[0];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var VW = 1000, VH = 470, FONT = "'Google Sans','Noto Sans',sans-serif";
  var LX = 12, LW = 450, R0 = 30, RH = 112, GAP = 8, CW = (LW - GAP) / 2, HY = 292, HH = 166;
  var MX = 510, MW = 100, MY = 118, MH = 270, RX = 650, RW = 338, RB = HY + HH;
  var BLUE = [31, 111, 235], AMB = [214, 120, 8], N0 = [226, 229, 234], N1 = [84, 92, 102], PALE = [232, 235, 239];
  var INK = '#222', SOFT = '#55606e', NAVY = '#1a3a78', BROWN = '#8a5300';

  /* ---------- text, one sentence per step ---------- */
  function fmt(x) { return String(Math.round(x * 10) / 10); }
  function runs(kind, hidden) {                                     /* the time spans of the balls' patches that are (not) hidden */
    var y = MASK[kind].y[FIRST], out = [], k = 0;
    while (k < K) {
      if ((y[k] === '1') === hidden) { var a = k; while (k < K && (y[k] === '1') === hidden) k++; out.push(fmt(a * PS) + ' to ' + fmt(k * PS) + ' s'); } else k++;
    }
    return out.join(' and ');
  }
  function span(kind, hidden) { var y = MASK[kind].y[FIRST], n = 0; for (var k = 0; k < K; k++) if ((y[k] === '1') === hidden) n++; return fmt(n * PS); }
  var PRE = fmt(MASK.prefix.y[FIRST].indexOf('1') * PS);
  var POST = fmt((K - MASK.bridge.y[FIRST].lastIndexOf('1') - 1) * PS);
  var Q = {
    fwd: { name: 'Forward', ask: 'What happens next?', den: 'the motion',
      mask: 'Forward hides only the motion. Scene, start state, properties and action are the conditioning.',
      out: 'Output: 6 s of motion for the seven balls, with their contacts and events.', loss: '' },
    prop: { name: 'Property inference', ask: 'What are they made of?', den: 'the properties',
      mask: 'Property inference hides only the properties. The whole motion, end state included, is conditioning: it is the evidence.',
      out: 'Output: numbers, no trajectory. Each ball that moved gets a mass, friction and bounciness; a still object gets no answer, because nothing shows its properties.', loss: '' },
    cause: { name: 'Backward', ask: 'What caused this ending?', den: 'the action and the motion',
      mask: 'Backward hides the action and the whole motion. Scene, start state, properties and the final frame are the conditioning.',
      out: 'Output: the action, and the motion that leads from the start to the given end. They are generated together, not by running time in reverse, and the action is then replayed forward to check that it reaches that end.',
      loss: ' Two more checks: the generated end must match the given one, and the generated action, replayed forward, must reach it.' },
    prefix: { name: 'Completion', ask: 'Seen at first, how does it continue?', den: 'the rest of the motion',
      mask: 'Completion is forward with the first ' + PRE + ' s already seen: those patches are conditioning, and only what follows is hidden.',
      out: 'Output: the remaining ' + span('prefix', true) + ' s, continuing from what was seen.',
      loss: ' One more check: the generated motion must agree with a forward replay.' },
    bridge: { name: 'Infilling', ask: 'Seen at both ends, what happened between?', den: 'the middle of the motion',
      mask: 'Infilling sees the first ' + PRE + ' s and the last ' + POST + ' s: both are conditioning, and only the ' + span('bridge', true) + ' s between them is hidden.',
      out: 'Output: the missing ' + span('bridge', true) + ' s, joining the two given portions.',
      loss: ' One more check: the generated motion must agree with a forward replay.' },
    unk: { name: 'Unknown properties', ask: 'What if some properties are missing?', den: 'the motion and the missing properties',
      mask: "Forward, except that four balls' properties are hidden too. The motion and those properties are denoised together.",
      out: 'Output: 6 s of motion, and a value for each hidden property.', loss: '' }
  };
  var ORDER = ['fwd', 'prop', 'cause', 'prefix', 'bridge', 'unk'];
  var STAGE = { infer: ['The simulation', 'Mask', 'Into the model', 'Denoise', 'Output'], train: ['The simulation', 'Mask', 'Into the model', 'One pass', 'Loss'] };

  var S = { kind: 'fwd', picked: false, mode: 'infer', stage: 0, p: 0, playing: false, until: 4, manual: null, s: 0.6 };
  function mk() { return MASK[S.kind]; }
  function hasMotion() { return mk().y[FIRST].indexOf('1') >= 0; }
  function rowsHidden() { return BALLS.filter(function (i) { return mk().p[i]; }); }
  function rowsKnown() { return BALLS.filter(function (i) { return !mk().p[i]; }); }

  /* ---------- where each card sits ---------- */
  function slot(c, r, wide) { return { x: LX + c * (CW + GAP), y: R0 + r * (RH + GAP), w: wide ? LW : CW, h: RH }; }
  function hid(c, wide) { return { x: LX + c * (CW + GAP), y: HY, w: wide ? LW : CW, h: HH }; }
  var EX = { scene: slot(0, 0), props: slot(1, 0), action: slot(0, 1, true), motion: hid(0, true) };
  var PARENT = { motionSeen: 'motion', end: 'motion', propsHid: 'props' };
  function layout() {
    var scene = { id: 'scene', r: slot(0, 0) }, k = S.kind;
    if (k === 'fwd') return [scene, { id: 'props', r: slot(1, 0) }, { id: 'action', r: slot(0, 1, true) }, { id: 'motion', r: hid(0, true), hid: true }];
    if (k === 'prop') return [scene, { id: 'action', r: slot(1, 0) }, { id: 'motionSeen', r: slot(0, 1, true) }, { id: 'propsHid', r: hid(0, true), hid: true }];
    if (k === 'cause') return [scene, { id: 'props', r: slot(1, 0) }, { id: 'end', r: slot(0, 1, true) }, { id: 'action', r: hid(0), hid: true }, { id: 'motion', r: hid(1), hid: true }];
    if (k === 'unk') return [scene, { id: 'action', r: slot(1, 0) }, { id: 'props', r: slot(0, 1, true) }, { id: 'propsHid', r: hid(0), hid: true }, { id: 'motion', r: hid(1), hid: true }];
    return [scene, { id: 'props', r: slot(1, 0) }, { id: 'action', r: slot(0, 1) }, { id: 'motionSeen', r: slot(1, 1) }, { id: 'motion', r: hid(0, true), hid: true }];
  }
  function outputs() {
    var all = { x: RX, y: R0, w: RW, h: RB - R0 }, k = S.kind;
    if (k === 'prop') return [{ id: 'propsHid', r: { x: RX, y: R0, w: RW, h: 250 } }];
    if (k === 'cause') return [{ id: 'action', r: { x: RX, y: R0, w: RW, h: 92 } }, { id: 'motion', r: { x: RX, y: R0 + 100, w: RW, h: RB - R0 - 100 } }];
    if (k === 'unk') return [{ id: 'propsHid', r: { x: RX, y: R0, w: RW, h: 126 } }, { id: 'motion', r: { x: RX, y: R0 + 134, w: RW, h: RB - R0 - 134 } }];
    return [{ id: 'motion', r: all }];
  }
  function lerp(a, b, f) { return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f }; }

  /* ---------- fixed noise, one draw ---------- */
  var seed = 20261105;
  function rnd() { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }
  var eCell = [], eXY = [], eP = [], PM = [[0.2, 0.2], [0.5, 0.3], [0.5, 0.3]], PROP = ['mass', 'friction', 'restitution'];
  B.forEach(function () {
    var c = [], xy = [], k;
    for (k = 0; k < K; k++) { c.push(rnd()); xy.push([gauss() * 0.9, gauss() * 0.9]); }
    eCell.push(c); eXY.push(xy);
    eP.push(PM.map(function (m) { return m[0] + m[1] * gauss(); }));
  });
  var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  B.forEach(function (b) { b.path.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }); });
  function at(i, sec) {
    var p = B[i].path, u = Math.max(0, Math.min(p.length - 1, sec * D.path_hz)), a = Math.floor(u), f = u - a, b = Math.min(p.length - 1, a + 1);
    return [p[a][0] + (p[b][0] - p[a][0]) * f, p[a][1] + (p[b][1] - p[a][1]) * f];
  }
  function endOf(i) { return B[i].path[B[i].path.length - 1]; }

  /* ---------- controls ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  var table = el('div', 'ma-table'), legend = el('div', 'ma-legend'), modeBox = el('div', 'ma-mode');
  var scroll = el('div', 'ma-scroll'), cv = el('canvas');
  var steps = el('div', 'ma-steps'), back = el('button', 'ma-nav', '◀'), next = el('button', 'ma-nav', '▶'), play = el('button', 'ma-play', 'Play');
  var sl = el('label', 'ma-slider'), slT = el('span'), range = el('input'), cap = el('p', 'ma-cap');
  back.type = next.type = play.type = 'button'; back.setAttribute('aria-label', 'Previous step'); next.setAttribute('aria-label', 'Next step');
  range.type = 'range'; range.min = 0; range.max = 100; sl.appendChild(slT); sl.appendChild(range);
  cap.setAttribute('aria-live', 'polite'); cv.setAttribute('role', 'img');

  var headRow = el('div', 'ma-row ma-th');
  ['Question', 'It asks', 'Properties', 'Action', 'Motion, 0 to 6 s'].forEach(function (t, i) { headRow.appendChild(el('span', ['', 'ma-a', '', '', ''][i], t)); });
  table.appendChild(headRow);
  function cells(box, n, isHidden) { for (var i = 0; i < n; i++) box.appendChild(el('i', isHidden(i) ? 'h' : 'k')); return box; }
  var rows = ORDER.map(function (k) {
    var q = Q[k], m = MASK[k], b = el('button', 'ma-row');
    b.type = 'button';
    b.appendChild(el('b', '', q.name)); b.appendChild(el('span', 'ma-a', q.ask));
    b.appendChild(cells(el('span', 'ma-g'), BALLS.length, function (i) { return m.p[BALLS[i]]; }));
    b.appendChild(cells(el('span', 'ma-g'), 1, function () { return m.a; }));
    var y = cells(el('span', 'ma-g ma-y'), K, function (c) { return m.y[FIRST][c] === '1'; });
    if (m.end) { var e = el('i', 'e'); e.title = 'The final frame is given'; y.appendChild(e); }
    b.appendChild(y);
    b.addEventListener('click', function () { S.kind = k; S.picked = true; run(1, 4); });
    table.appendChild(b);
    return b;
  });
  legend.innerHTML = '<span class="ma-key"><i class="k"></i>known: conditioning</span><span class="ma-key"><i class="h"></i>hidden: denoised</span>' +
    '<span class="ma-always">The scene and the start state are known in every question.</span>';
  var mBtns = [['infer', 'Inference'], ['train', 'Training']].map(function (m) {
    var b = el('button', 'ma-mb', m[1]); b.type = 'button';
    b.addEventListener('click', function () { S.mode = m[0]; if (S.picked) run(1, 4); else { syncUI(); draw(); } }); modeBox.appendChild(b); return b;
  });
  legend.appendChild(modeBox);
  steps.appendChild(back);
  var sBtns = [0, 1, 2, 3, 4].map(function (i) {
    var b = el('button', 'ma-sb'); b.type = 'button';
    b.addEventListener('click', function () { if (i > 0) S.picked = true; run(i, i); }); steps.appendChild(b); return b;
  });
  steps.appendChild(next); steps.appendChild(play);
  scroll.appendChild(cv);
  [table, legend, scroll, steps, sl, cap].forEach(function (e) { root.appendChild(e); });
  back.addEventListener('click', function () { if (S.stage > 0) run(S.stage - 1, S.stage - 1); });
  next.addEventListener('click', function () { if (S.stage < 4) { S.picked = true; run(S.stage + 1, S.stage + 1); } });
  play.addEventListener('click', function () {
    if (S.playing) { stop(); return; }
    S.picked = S.picked || S.stage > 0;
    if (S.stage === 4 && S.p >= 1) { run(1, 4); return; }
    if (S.p >= 1) { run(S.stage + 1, 4); return; }
    if (S.stage === 0 && S.p === 0) { run(0, S.picked ? 4 : 0); return; }
    S.until = 4; S.manual = null; start();
  });
  range.addEventListener('input', function () {
    var v = range.value / 100; stop();
    if (S.mode === 'infer') { S.manual = v; S.p = 1 - v; } else { S.s = Math.max(0.02, v); S.p = 1; }
    syncUI(); draw();
  });

  /* ---------- the run: once through, then it stops ---------- */
  var raf = 0, last = null;
  function dur(stage) {
    if (stage === 4) return S.mode === 'train' ? 1.2 : (hasMotion() ? 7 : 1.6);
    return [5.5, 1.8, 2.4, S.mode === 'train' ? 2.4 : 6][stage];
  }
  function start() { S.playing = true; last = null; syncUI(); if (!raf) raf = requestAnimationFrame(tick); }
  function stop() { S.playing = false; syncUI(); draw(); }
  function run(from, until) {
    S.stage = from; S.until = until; S.p = 0; S.manual = null;
    if (reduced) { S.stage = until; S.p = 1; S.playing = false; syncUI(); draw(); return; }
    start(); draw();
  }
  function tick(ts) {
    raf = 0;
    if (!S.playing) return;
    var dt = last === null ? 0 : Math.min(0.1, (ts - last) / 1000); last = ts;
    S.p += dt / dur(S.stage);
    if (S.p >= 1) {
      S.p = 1;
      if (S.stage < S.until) { S.stage++; S.p = 0; syncUI(); } else { S.playing = false; syncUI(); }
    }
    draw();
    if (S.playing) raf = requestAnimationFrame(tick);
  }

  /* ---------- state of the picture ---------- */
  function ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function noise() {
    if (S.stage === 0) return 0;
    if (S.mode === 'train') return S.stage === 1 ? ease(S.p) * S.s : S.s;
    if (S.stage === 1) return ease(S.p);
    if (S.stage === 2) return 1;
    if (S.stage === 4) return 0;
    if (S.manual !== null) return S.manual;
    if (S.p >= 1) return 0;
    var x = S.p * STEPS, i = Math.floor(x);
    return 1 - (i + ease((x - i - 0.5) * 2)) / STEPS;
  }
  var FLY = 0.2;
  function playSec() {
    if (S.stage === 0) return S.p > 0 ? S.p * H : null;
    if (S.stage === 4 && S.mode === 'infer' && hasMotion()) return S.p <= FLY ? 0 : (S.p - FLY) / (1 - FLY) * H;
    return null;
  }
  function mix(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function css(c, al) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (al === undefined ? 1 : al) + ')'; }

  function syncUI() {
    var names = STAGE[S.mode];
    rows.forEach(function (b, i) { var on = S.picked && ORDER[i] === S.kind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    mBtns.forEach(function (b, i) { var on = (i === 0) === (S.mode === 'infer'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    sBtns.forEach(function (b, i) { b.textContent = (i + 1) + ' ' + names[i]; b.classList.toggle('on', i === S.stage); });
    back.disabled = S.stage === 0; next.disabled = S.stage === 4;
    play.textContent = S.playing ? 'Pause' : (S.stage === 4 && S.p >= 1 ? 'Replay' : 'Play');
    sl.hidden = S.stage !== 3;
    slT.textContent = S.mode === 'infer' ? 'Noise level, drag to scrub' : 'Noise level of this pass, drag to change';
    cap.textContent = caption();
    cv.setAttribute('aria-label', names[S.stage] + '. ' + cap.textContent);
  }
  function caption() {
    var q = Q[S.kind], tr = S.mode === 'train';
    switch (S.stage) {
      case 0: return 'One real PhysX simulation: a piston pushes the cue ball, which breaks a rack of six balls at ' + D.first_hit_s + ' s. Here everything is known. Pick a question to see what gets hidden.';
      case 1: return q.mask + (S.kind === 'cause' ? " The piston's path is hidden too, because it is the action's execution." : '');
      case 2: return 'Both groups enter the same transformer as one sequence of tokens: known tokens are clean, hidden ones carry their noise level. There is no separate conditioning branch.';
      case 3: return tr ? 'One pass at one random noise level, drawn per example. The network must predict the direction from the noisy ' + q.den + ' back to the truth.'
        : 'Ten flow-matching steps. Each step moves only ' + q.den + ' towards the answer; the conditioning never changes.';
      default: return tr ? 'The loss compares that prediction with the truth on ' + q.den + ' only; the conditioning costs nothing.' + q.loss + ' Each example in a batch draws its own question.' : q.out;
    }
  }

  /* ---------- drawing ---------- */
  var ctx = cv.getContext('2d');
  function fit() {
    var w = cv.clientWidth || VW, dpr = window.devicePixelRatio || 1, s = w / VW;
    var bw = Math.round(w * dpr), bh = Math.round(VH * s * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cv.style.height = Math.round(VH * s) + 'px';
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
  }
  function text(s, x, y, size, color, weight, align) {
    ctx.font = (weight || 400) + ' ' + size + 'px ' + FONT; ctx.fillStyle = color || INK; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y);
  }
  function round(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function dot(x, y, r, fill, stroke) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.1; ctx.stroke(); } }
  function rgb(i) { return css(B[i].rgb.map(function (v) { return v * 255; })); }

  function frame(r, style) {
    round(r.x, r.y, r.w, r.h, 7);
    if (style === 'hid') { ctx.fillStyle = '#fff8ec'; ctx.fill(); ctx.setLineDash([4, 3]); ctx.strokeStyle = css(AMB); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]); }
    else if (style === 'out') { ctx.fillStyle = '#fff8ec'; ctx.fill(); ctx.strokeStyle = css(AMB); ctx.lineWidth = 1.8; ctx.stroke(); }
    else if (style === 'slot') { ctx.setLineDash([3, 4]); ctx.strokeStyle = '#c9cfd8'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = '#f1f6fe'; ctx.fill(); ctx.strokeStyle = '#a8c6f6'; ctx.lineWidth = 1.1; ctx.stroke(); }
  }
  function titles(r, style, title, sub) {
    text(title, r.x + 10, r.y + 18, 13, style === 'known' ? NAVY : BROWN, 600);
    if (sub) text(sub, r.x + 10, r.y + 33, 11, SOFT);
  }
  /* a view from above inside rectangle a */
  function view(a) {
    var sc = Math.min(a.w / (x1 - x0 + 0.5), a.h / (y1 - y0 + 0.5)), cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    return { sc: sc, x: function (x) { return cx + (x - (x0 + x1) / 2) * sc; }, y: function (y) { return cy - (y - (y0 + y1) / 2) * sc; } };
  }
  function bodyAt(v, i, q) {
    if (B[i].tool) { var w = Math.max(5, v.sc * 0.1), h = Math.max(6, v.sc * 0.12); ctx.fillStyle = rgb(i); ctx.fillRect(v.x(q[0]) - w / 2, v.y(q[1]) - h / 2, w, h); ctx.strokeStyle = SOFT; ctx.lineWidth = 0.8; ctx.strokeRect(v.x(q[0]) - w / 2, v.y(q[1]) - h / 2, w, h); return; }
    dot(v.x(q[0]), v.y(q[1]), Math.max(2.6, B[i].r * v.sc), rgb(i), '#fff');
  }
  function sideArea(r) { var w = Math.min(r.w * 0.56, 190); return { x: r.x + r.w - w - 4, y: r.y + 4, w: w, h: r.h - 8 }; }

  function strip(x, y, w, cell) {
    var cw = w / K, h = 9;
    for (var k = 0; k < K; k++) { ctx.fillStyle = cell(k); ctx.fillRect(x + k * cw + 0.25, y, Math.max(0.8, cw - 0.5), h); }
    text('0', x, y + 20, 10, SOFT); text('6 s', x + w, y + 20, 10, SOFT, 400, 'right');
  }
  function cardScene(r) {
    frame(r, 'known'); titles(r, 'known', 'Scene and start state', D.n_objects + ' objects, ' + D.n_joints + ' joint');
    var v = view(sideArea(r));
    B.forEach(function (b, i) { bodyAt(v, i, b.path[0]); });
  }
  function cardProps(r, list, hidden, t, style, title) {
    frame(r, style); titles(r, style, title);
    var big = r.w > 300, lab = r.x + 10, colW = big ? 76 : Math.min(46, (r.w - 88) / 3), cx0 = r.x + r.w - 8 - colW * 3;
    var top = r.y + (big ? 42 : 34), rowH = Math.min(big ? 26 : 19, (r.y + r.h - 6 - top) / list.length), fs = Math.max(9.5, Math.min(big ? 14 : 11.5, rowH * 0.8));
    ['mass', 'friction', 'bounce'].forEach(function (s, c) { text(s + (big && c === 0 ? ' (kg)' : ''), cx0 + (c + 0.5) * colW, top - 5, big ? 11.5 : 10, SOFT, 400, 'center'); });
    list.forEach(function (i, n) {
      var y = top + n * rowH;
      dot(lab + 3.5, y + rowH / 2, Math.min(3.5, rowH * 0.28), rgb(i));
      text(B[i].label, lab + 11, y + rowH * 0.5 + fs * 0.36, fs, INK);
      for (var c = 0; c < 3; c++) {
        var v = B[i][PROP[c]];
        if (hidden) {
          ctx.fillStyle = css(mix([255, 232, 190], N1, t * 0.7));
          ctx.fillRect(cx0 + c * colW + 1, y + 1, colW - 2, rowH - 2);
          v = (1 - t) * v + t * eP[i][c];
        }
        text(v.toFixed(2), cx0 + (c + 0.5) * colW, y + rowH * 0.5 + fs * 0.36, fs, hidden && t > 0.5 ? '#fff' : (hidden ? '#5a3600' : NAVY), 400, 'center');
      }
    });
  }
  var ACT_1 = A.semantic[0].toUpperCase() + A.semantic.slice(1) + ': ' + A.object.toLowerCase() + ' on ' + A.payload.toLowerCase(), ACT_2 = A.force_N + ' N, from ' + A.onset_s + ' to ' + A.end_s + ' s';
  var GLYPHS = 'abcdefghkmnpqrstuvwxyz0123456789';
  function scramble(s, t, salt) {
    if (t <= 0) return s;
    var out = '', step = Math.floor(t * 40);
    for (var i = 0; i < s.length; i++) {
      var a = eCell[(i + salt) % M][(i * 3 + 1) % K], g = eCell[(i + step) % M][(i * 7 + step) % K];
      out += a < t && s[i] !== ' ' ? GLYPHS[Math.floor(g * GLYPHS.length)] : s[i];
    }
    return out;
  }
  function cardAction(r, hidden, t, style) {
    frame(r, style); titles(r, style, hidden && style !== 'out' ? 'Action to denoise' : 'Action', hidden && style !== 'out' ? 'which object, how hard, when' : '');
    var c = style === 'known' ? NAVY : '#5a3600', fs = r.w > 300 ? 15.5 : 13;
    var cy = r.y + (r.h > 70 ? r.h / 2 + 2 : 38);
    if (hidden && t > 0) { ctx.fillStyle = css(mix([255, 232, 190], N1, t * 0.7)); ctx.fillRect(r.x + 8, cy - 15, r.w - 16, 40); }
    var white = hidden && t > 0.5;
    text(scramble(ACT_1, hidden ? t : 0, 0), r.x + 14, cy + 1, fs, white ? '#fff' : c, 500);
    text(scramble(ACT_2, hidden ? t : 0, 3), r.x + 14, cy + 19, fs - 1.5, white ? '#fff' : c);
    if (style === 'known' && r.h > 70) text("Plus the piston's recorded path.", r.x + 14, r.y + r.h - 12, 11, SOFT);
  }
  function hiddenCell(k) { return mk().y[FIRST][k] === '1'; }
  function cardMotion(r, which, t, sec, style) {
    var stack = r.h >= 150, title, sub = '', anyGiven = false;
    frame(r, style);
    if (which === 'all') { title = 'Motion'; sub = 'all 6 s, in 0.2 s patches'; }
    else if (which === 'given') { title = S.kind === 'prop' ? 'The whole motion' : 'Motion seen'; sub = S.kind === 'prop' ? 'all 6 s, end state included' : runs(S.kind, false); }
    else if (which === 'hidden') { title = 'Motion to denoise'; sub = runs(S.kind, true); }
    else { title = 'Motion'; }
    titles(r, style, title, sub);
    var a = stack ? { x: r.x + 8, y: r.y + (sub ? 38 : 26), w: r.w - 16, h: r.h - (sub ? 38 : 26) - 32 } : sideArea(r), v = view(a), rr = Math.max(1.3, Math.min(2.4, v.sc * 0.022));
    ctx.save(); ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip();
    for (var i = 0; i < M; i++) {
      var s0 = B[i].path[0];
      for (var k = 0; k < K; k++) {
        var h = mk().y[i][k] === '1', q = at(i, (k + 0.5) * PS), tk = (k + 0.5) * PS;
        if (which === 'all') { if (sec !== null && tk <= sec) dot(v.x(q[0]), v.y(q[1]), rr, css(BLUE, 0.8)); continue; }
        if (which === 'given') { if (!h) dot(v.x(q[0]), v.y(q[1]), rr, css(BLUE, 0.85)); continue; }
        if (which === 'answer') {
          if (!h) { anyGiven = true; dot(v.x(q[0]), v.y(q[1]), rr, css(BLUE, 0.85)); continue; }
          var al = sec === null || tk <= sec ? 1 : 0.18;
          dot(v.x(q[0]), v.y(q[1]), rr + 0.3, css(AMB, al));
          continue;
        }
        if (!h) continue;
        var nx = (1 - t) * q[0] + t * (s0[0] + eXY[i][k][0]), ny = (1 - t) * q[1] + t * (s0[1] + eXY[i][k][1]);
        dot(v.x(nx), v.y(ny), rr + 0.2, css(mix(AMB, N1, Math.min(1, t * 1.15)), 0.85));
      }
    }
    if (which === 'answer' && mk().end) { for (var e = 0; e < M; e++) { var q2 = endOf(e); ctx.setLineDash([2, 2]); dot(v.x(q2[0]), v.y(q2[1]), Math.max(3, B[e].r * v.sc), null, css(BLUE)); ctx.setLineDash([]); } }
    for (var j = 0; j < M; j++) bodyAt(v, j, sec === null ? B[j].path[0] : at(j, sec));
    ctx.restore();
    var sx = stack ? r.x + 12 : r.x + 10, sw = stack ? r.w - 24 : r.w - sideArea(r).w - 22, sy = r.y + r.h - 28;
    strip(sx, sy, sw, function (k) {
      var h = hiddenCell(k);
      if (which === 'all') return css(BLUE);
      if (which === 'given') return h ? css(PALE) : css(BLUE);
      if (which === 'answer') return h ? css(AMB) : css(BLUE);
      return h ? css(mix(AMB, mix(N0, N1, eCell[FIRST][k]), t)) : css(PALE);
    });
    if (sec !== null && which !== 'given' && (S.stage === 0 || S.stage === 4)) {
      ctx.fillStyle = INK; ctx.fillRect(sx + sec / H * sw - 0.75, sy - 2, 1.5, 13);
      if (stack) text(sec.toFixed(1) + ' s', r.x + r.w - 10, r.y + 18, 11.5, SOFT, 500, 'right');
    }
    return anyGiven;
  }
  function cardEnd(r) {
    frame(r, 'known'); titles(r, 'known', 'End state', 'the final frame only, at 6 s');
    var v = view(sideArea(r));
    B.forEach(function (b, i) { var q = b.path[0]; ctx.setLineDash([2, 2]); dot(v.x(q[0]), v.y(q[1]), Math.max(2.4, b.r * v.sc), null, '#a7b0bb'); ctx.setLineDash([]); });
    B.forEach(function (b, i) { bodyAt(v, i, endOf(i)); });
    var sx = r.x + 10, sw = r.w - sideArea(r).w - 22, sy = r.y + r.h - 28;
    strip(sx, sy, sw, function (k) { return k === K - 1 ? css(BLUE) : css(PALE); });
  }

  function drawCard(c, r, t, style, sec) {
    var hidden = !!c.hid && style !== 'out';
    switch (c.id) {
      case 'scene': cardScene(r); break;
      case 'action': cardAction(r, !!c.hid, style === 'out' ? 0 : t, style); break;
      case 'end': cardEnd(r); break;
      case 'motionSeen': cardMotion(r, 'given', 0, null, 'known'); break;
      case 'motion': cardMotion(r, style === 'out' ? 'answer' : (c.hid ? 'hidden' : 'all'), t, sec, style); break;
      case 'propsHid': cardProps(r, rowsHidden(), hidden, style === 'out' ? 0 : t, style, style === 'out' ? 'Properties, generated' : 'Properties to denoise'); break;
      default: cardProps(r, c.all ? BALLS : rowsKnown(), false, 0, 'known', S.kind === 'unk' && !c.all ? 'Known properties' : 'Properties');
    }
  }
  function bez(a, b, c, u) { var v = 1 - u; return [v * v * a[0] + 2 * v * u * b[0] + u * u * c[0], v * v * a[1] + 2 * v * u * b[1] + u * u * c[1]]; }
  function stream(a, c, color, phase, n) {
    var b = [(a[0] + c[0]) / 2, a[1]];
    for (var i = 0; i < n; i++) {
      var u = (i / n + phase) % 1, q = bez(a, b, c, u);
      ctx.globalAlpha = Math.min(1, Math.min(u, 1 - u) * 7);
      dot(q[0], q[1], 2.5, color);
    }
    ctx.globalAlpha = 1;
  }
  var XL = LX + LW + 3;
  var P_COND = [XL, R0 + RH + 4], P_COND_M = [MX - 1, MY + 62], P_HID = [XL, HY + 36], P_HID_M = [MX - 1, MY + MH - 96], P_BACK_M = [MX - 1, MY + MH - 52], P_BACK = [XL, HY + 110];
  function drawFlows() {
    var inflow = -1, outflow = -1;
    if (S.stage === 2) inflow = S.p * 3;
    if (S.stage === 3 && S.manual === null && S.p < 1) {
      var x = S.mode === 'train' ? S.p : (S.p * STEPS) % 1;
      if (x < 0.5) inflow = x * 2; else outflow = (x - 0.5) * 2;
    }
    if (inflow >= 0) { stream(P_COND, P_COND_M, css(BLUE), inflow, 6); stream(P_HID, P_HID_M, css(AMB), inflow, 6); }
    if (outflow >= 0) stream(P_BACK_M, P_BACK, css(AMB), outflow, 6);
    if (S.stage === 2 || S.stage === 3) {
      text('known', 486, P_COND[1] - 8, 10.5, css(BLUE), 500, 'center');
      text('noisy', 486, P_HID[1] + 28, 10.5, BROWN, 500, 'center');
      if (S.stage === 3) text(S.mode === 'train' ? 'direction' : 'velocity', 486, P_BACK[1] + 18, 10.5, BROWN, 500, 'center');
    }
    if (S.stage === 4 && S.mode === 'infer') {
      var f = Math.min(1, S.p / FLY);
      if (f < 1) stream([MX + MW, MY + MH / 2], [RX - 2, MY + MH / 2], css(AMB), f * 2, 5);
    }
  }
  function drawModel(t) {
    round(MX, MY, MW, MH, 10); ctx.fillStyle = css(BLUE); ctx.fill();
    text('World', MX + MW / 2, MY + 28, 16, '#fff', 600, 'center');
    text('model', MX + MW / 2, MY + 47, 16, '#fff', 600, 'center');
    text('one transformer', MX + MW / 2, MY + 66, 10.5, '#d8e6ff', 400, 'center');
    var active = S.stage === 2 || (S.stage === 3 && S.manual === null && S.p < 1);
    for (var i = 0; i < 8; i++) {
      var al = 0.28;
      if (active) { var ph = (S.p * (S.stage === 3 && S.mode === 'infer' ? STEPS : 3) - i / 8 + 8) % 1; al = 0.25 + 0.55 * Math.max(0, 1 - Math.abs(ph - 0.5) * 3); }
      ctx.fillStyle = 'rgba(255,255,255,' + al + ')';
      ctx.fillRect(MX + 14, MY + 80 + i * 13, MW - 28, 8);
    }
    var big = '', small = '';
    if (S.stage > 0) {
      big = 'noise ' + (t === 0 || t === 1 ? t : t.toFixed(2));
      if (S.mode === 'train') small = S.stage === 4 ? 'loss' : (S.stage === 3 ? 'one pass' : '');
      else if (S.stage === 3) small = S.manual !== null ? 'scrubbing' : (S.p >= 1 ? 'done' : 'step ' + Math.min(STEPS, Math.floor(S.p * STEPS) + 1) + ' of ' + STEPS);
      else if (S.stage === 4) small = 'done';
    }
    text(big, MX + MW / 2, MY + 208, 13.5, '#fff', 500, 'center');
    text(small, MX + MW / 2, MY + 226, 11.5, '#d8e6ff', 400, 'center');
  }
  function head(x, y, color, s) { ctx.fillStyle = color; ctx.fillRect(x, y - 9, 10, 10); text(s, x + 15, y, 12.5, INK, 600); }
  function draw() {
    fit();
    ctx.clearRect(0, 0, VW, VH);
    var t = noise(), sec = playSec(), st = S.stage, i;
    if (st === 0) {
      head(LX, 18, css(BLUE), 'One simulation: everything is known');
      cardScene(EX.scene);
      drawCard({ id: 'props', all: true }, EX.props, 0, 'known');
      cardAction(EX.action, false, 0, 'known');
      cardMotion(EX.motion, 'all', 0, sec, 'known');
      drawModel(0);
      text('Pick a question above', RX + RW / 2, MY + MH / 2 - 8, 15, SOFT, 500, 'center');
      text('to see what it hides and what it returns', RX + RW / 2, MY + MH / 2 + 13, 12.5, SOFT, 400, 'center');
    } else {
      head(LX, 18, css(BLUE), 'Conditioning: known, stays fixed');
      head(LX, HY - 8, css(AMB), 'To denoise: hidden, starts as noise');
      var train = S.mode === 'train', cards = layout(), outs = outputs(), e = st === 1 ? ease(S.p) : 1, fly = st === 4 && !train ? ease(S.p / FLY) : 0;
      head(RX, 18, css(AMB), train && st === 4 ? 'The loss: compared with the truth' : 'Output: only what was hidden');
      /* output slots, filled at the last step */
      var outById = {};
      outs.forEach(function (o) { outById[o.id] = o; if (st < 4 || (!train && fly < 1)) { frame(o.r, 'slot'); text(o.id === 'propsHid' ? 'Properties' : (o.id === 'action' ? 'Action' : 'Motion'), o.r.x + 10, o.r.y + 18, 13, '#a0a8b2', 500); } });
      ctx.globalAlpha = st === 4 ? 0.5 : 1;
      cards.forEach(function (c) {
        if (c.hid) return;
        var from = EX[PARENT[c.id] || c.id];
        drawCard(c, lerp(from, c.r, e), t, 'known', null);
      });
      ctx.globalAlpha = 1;
      if (st === 4 && !train) cards.forEach(function (c) { if (c.hid) frame(c.r, 'slot'); });
      drawFlows();
      drawModel(t);
      cards.forEach(function (c) {
        if (!c.hid) return;
        var from = EX[PARENT[c.id] || c.id], r = lerp(from, c.r, e), o = outById[c.id];
        if (st === 4 && train) { drawCard(c, r, t, 'hid', null); drawCard(c, o.r, 0, 'out', null); return; }
        if (st === 4) { drawCard(c, lerp(c.r, o.r, fly), 0, 'out', c.id === 'motion' ? sec : null); return; }
        drawCard(c, r, t, 'hid', null);
      });
      if (st === 4 && !train && S.kind === 'prop' && fly >= 1) text('No trajectory here: the motion was an input.', RX + RW / 2, R0 + 275, 12.5, SOFT, 400, 'center');
    }
    if (st === 3) range.value = Math.round((S.mode === 'infer' ? t : S.s) * 100);
  }

  window.addEventListener('resize', draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  syncUI(); draw();
})();
