/* The masked flow model, one question at a time (canvas, Next steps tab). The masks follow
   simagent/unified/wm/masked.py (masks_from, sample_masked, masked_loss) under configs/wm/mechanics_v5/masked_oneshot_prior.json.
   The sample is one real PhysX record (static/data/masked_anim.js, tools/extract_masked_anim.py). The hidden tokens are drawn on the
   straight path from noise to that record, x_t = (1 - t) x_0 + t eps, which is not a trained model's output.
   Nothing moves on load and nothing loops: a run plays through its steps once and stops. */
(function () {
  'use strict';
  var D = window.MASKED_ANIM, root = document.getElementById('masked-anim');
  if (!D || !root) return;
  var K = D.K, B = D.bodies, M = B.length, PS = D.patch_s, H = D.horizon_s, A = D.action;
  var TOOL = B.findIndex(function (b) { return b.tool; });
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var N_PRE = 4, N_POST = 8, UNK = [0, 3, 5, 6], STEPS = 10;           /* one illustrative draw of the random masks */
  var VW = 1000, VH = 392, FONT = "'Google Sans','Noto Sans',sans-serif";
  var P_X = 84, P_W = 35, Y_X = 196, Y_W = 10, ROW_Y = 120, ROW_H = 25;
  var MX = 562, MY = 66, MW = 130, MH = 254, TX = 716, TY = 26, TW = 272, TH = 294;
  var BLUE = [31, 111, 235], BLUE_L = [228, 238, 254], AMB = [214, 120, 8], AMB_L = [255, 240, 212], N0 = [226, 229, 234], N1 = [84, 92, 102];
  var INK = '#222', SOFT = '#55606e';

  var Q = {
    fwd: { name: 'Forward', ask: 'What happens, given everything?',
      given: 'scene, properties, action, start state', gen: 'the motion',
      mask: "Only the motion is hidden. The piston's path stays given, because it is the command.",
      out: 'Out: 6 s of motion for the seven balls, with their contacts and events.', loss: '' },
    prop: { name: 'Property inference', ask: 'What must these objects be made of, to move like this?',
      given: 'scene, action, start state, the whole motion', gen: 'mass, friction, bounciness',
      mask: 'Only the properties are hidden. The whole motion stays given: it is the evidence.',
      out: 'Out: the properties of every object that moved. An object that never moves gets no answer, because nothing shows its properties.', loss: '' },
    cause: { name: 'Backward', ask: 'What action produced this ending?',
      given: 'scene, properties, start state, final frame', gen: 'the action and the whole motion',
      mask: "The action and the whole motion are hidden, including the piston's path. The start and the final frame stay given.",
      out: 'Out: which object was pushed, how hard and when, and the motion that reaches the given end. The action is then replayed forward to check that it gets there.',
      loss: ' Two more checks: the generated end must match the given one, and the generated action, replayed forward, must reach it.' },
    prefix: { name: 'Completion', ask: 'Seen for the first 0.8 s, how does it continue?',
      given: 'scene, properties, action, the first patches', gen: 'the rest of the motion',
      mask: 'Everything after the first 0.8 s is hidden, so the break at ' + D.first_hit_s + ' s has to be predicted.',
      out: 'Out: the remaining 5.2 s, continuing from what was seen.',
      loss: ' One more check: the generated motion must agree with a forward replay.' },
    bridge: { name: 'Infilling', ask: 'Seen at the start and the end, what happened in between?',
      given: 'scene, properties, action, a start and an end portion', gen: 'the motion in between',
      mask: 'The middle of the motion is hidden. The start and end portions stay given.',
      out: 'Out: the missing 3.6 s between the two given portions.',
      loss: ' One more check: the generated motion must agree with a forward replay.' },
    unk: { name: 'Unknown properties', ask: "What happens if some objects' properties are not known?",
      given: "scene, action, start state, some objects' properties", gen: 'the motion and the other properties',
      mask: 'The motion and the properties of four objects are hidden. The other properties stay given.',
      out: 'Out: 6 s of motion, and a value for each hidden property.', loss: '' }
  };
  var ORDER = ['fwd', 'prop', 'cause', 'prefix', 'bridge', 'unk'];
  var STAGE = { infer: ['The example', 'Mask', 'Into the model', 'Denoise', 'Answer'], train: ['The example', 'Mask', 'Into the model', 'One pass', 'Loss'] };
  var DUR = [5.5, 1.6, 2.4, 5.5, 6];

  var S = { kind: 'fwd', mode: 'infer', stage: 0, p: 0, playing: false, until: 4, manual: null, s: 0.6 };

  /* ---------- masks, as in masks_from ---------- */
  function hidY(i, k) {
    if (i === TOOL) return S.kind === 'cause';                         /* a supplied tool path is never generated, unless the action is hidden */
    switch (S.kind) {
      case 'fwd': case 'unk': case 'cause': return true;
      case 'prefix': return k >= N_PRE;
      case 'bridge': return k >= N_PRE && k < K - N_POST;
      default: return false;
    }
  }
  function hidP(i) { return i !== TOOL && (S.kind === 'prop' || (S.kind === 'unk' && UNK.indexOf(i) >= 0)); }
  function toolPropsOut() { return S.kind === 'prop' || S.kind === 'unk'; }
  function hidA() { return S.kind === 'cause'; }
  function endGiven() { return S.kind === 'cause'; }

  /* ---------- fixed noise, one draw ---------- */
  var seed = 20261105;
  function rnd() { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }
  var eCell = [], eXY = [], eP = [], PM = [[0.2, 0.2], [0.5, 0.3], [0.5, 0.3]], PROP = ['mass', 'friction', 'restitution'];
  B.forEach(function () {
    var c = [], xy = [], k;
    for (k = 0; k < K; k++) { c.push(rnd()); xy.push([gauss() * 0.95, gauss() * 0.95]); }
    eCell.push(c); eXY.push(xy);
    eP.push(PM.map(function (m) { return m[0] + m[1] * gauss(); }));
  });
  var maxSpeed = 0;
  B.forEach(function (b) { b.speed.forEach(function (v) { if (v > maxSpeed) maxSpeed = v; }); });
  function bright(i, k) { return Math.sqrt(B[i].speed[k] / maxSpeed); }

  /* ---------- the view from above ---------- */
  var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  B.forEach(function (b) { b.path.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }); });
  var SC = Math.min((TW - 24) / (x1 - x0 + 0.3), (TH - 44) / (y1 - y0 + 0.3));
  function vx(x) { return TX + TW / 2 + (x - (x0 + x1) / 2) * SC; }
  function vy(y) { return TY + (TH + 4) / 2 - (y - (y0 + y1) / 2) * SC; }
  function at(i, sec) {
    var p = B[i].path, u = Math.max(0, Math.min(p.length - 1, sec * D.path_hz)), a = Math.floor(u), f = u - a, b = Math.min(p.length - 1, a + 1);
    return [p[a][0] + (p[b][0] - p[a][0]) * f, p[a][1] + (p[b][1] - p[a][1]) * f];
  }
  function patchXY(i, k) { return at(i, (k + 0.5) * PS); }

  /* ---------- controls ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  var qRow = el('div', 'ma-q'), head = el('div', 'ma-head'), ask = el('p', 'ma-ask'), modeBox = el('div', 'ma-mode');
  var gg = el('p', 'ma-gg'), scroll = el('div', 'ma-scroll'), cv = el('canvas'), tip = el('div', 'ma-tip');
  var steps = el('div', 'ma-steps'), back = el('button', 'ma-nav', '◀'), next = el('button', 'ma-nav', '▶'), play = el('button', 'ma-play', 'Play');
  var sl = el('label', 'ma-slider'), slT = el('span'), range = el('input'), cap = el('p', 'ma-cap');
  qRow.setAttribute('role', 'group'); qRow.setAttribute('aria-label', 'Question');
  back.type = next.type = play.type = 'button'; back.setAttribute('aria-label', 'Previous step'); next.setAttribute('aria-label', 'Next step');
  range.type = 'range'; range.min = 0; range.max = 100; sl.appendChild(slT); sl.appendChild(range);
  cap.setAttribute('aria-live', 'polite'); tip.hidden = true;
  cv.setAttribute('role', 'img');
  var qBtns = ORDER.map(function (k) {
    var b = el('button', 'ma-qb', Q[k].name); b.type = 'button';
    b.addEventListener('click', function () { S.kind = k; run(1, 4); }); qRow.appendChild(b); return b;
  });
  var mBtns = [['infer', 'Inference'], ['train', 'Training']].map(function (m) {
    var b = el('button', 'ma-mb', m[1]); b.type = 'button';
    b.addEventListener('click', function () { S.mode = m[0]; run(S.stage === 0 ? 0 : 1, S.stage === 0 ? 0 : 4); if (S.stage === 0) stop(); }); modeBox.appendChild(b); return b;
  });
  steps.appendChild(back);
  var sBtns = [0, 1, 2, 3, 4].map(function (i) {
    var b = el('button', 'ma-sb'); b.type = 'button';
    b.addEventListener('click', function () { run(i, i); }); steps.appendChild(b); return b;
  });
  steps.appendChild(next); steps.appendChild(play);
  head.appendChild(ask); head.appendChild(modeBox); scroll.appendChild(cv); scroll.appendChild(tip);
  [qRow, head, gg, scroll, steps, sl, cap].forEach(function (e) { root.appendChild(e); });
  back.addEventListener('click', function () { if (S.stage > 0) run(S.stage - 1, S.stage - 1); });
  next.addEventListener('click', function () { if (S.stage < 4) run(S.stage + 1, S.stage + 1); });
  play.addEventListener('click', function () {
    if (S.playing) { stop(); return; }
    if (S.stage === 4 && S.p >= 1) { run(0, 4); return; }
    if (S.p >= 1) { run(S.stage + 1, 4); return; }
    S.until = 4; S.manual = null; start();
  });
  range.addEventListener('input', function () {
    var v = range.value / 100; stop();
    if (S.mode === 'infer') S.manual = v; else S.s = Math.max(0.02, v);
    S.p = S.mode === 'infer' ? 1 - v : 1; syncUI(); draw();
  });

  /* ---------- the run: once through, then it stops ---------- */
  var raf = 0, last = null;
  function start() { S.playing = true; last = null; syncUI(); if (!raf) raf = requestAnimationFrame(tick); }
  function stop() { S.playing = false; syncUI(); draw(); }
  function run(from, until) {
    S.stage = from; S.until = until; S.p = 0; S.manual = null;
    if (reduced) { S.stage = until; S.p = 1; S.playing = false; syncUI(); draw(); return; }
    start();
  }
  function tick(ts) {
    raf = 0;
    if (!S.playing) return;
    var dt = last === null ? 0 : Math.min(0.1, (ts - last) / 1000); last = ts;
    S.p += dt / DUR[S.stage];
    if (S.p >= 1) {
      S.p = 1;
      if (S.stage < S.until) { S.stage++; S.p = 0; syncUI(); } else { S.playing = false; syncUI(); }
    }
    draw();
    if (S.playing) raf = requestAnimationFrame(tick);
  }

  /* ---------- state of the picture ---------- */
  function smooth(x) { return x * x * (3 - 2 * x); }
  function noise() {
    if (S.stage === 0) return 0;
    if (S.mode === 'train') return S.s;
    if (S.stage < 3) return 1;
    if (S.stage > 3) return 0;
    if (S.manual !== null) return S.manual;
    var x = Math.min(S.p, 0.9999) * STEPS, i = Math.floor(x), f = x - i;
    return S.p >= 1 ? 0 : 1 - (i + smooth(Math.max(0, (f - 0.5) * 2))) / STEPS;
  }
  function revealed(k) { return S.stage === 1 ? k / K < S.p * 1.15 : S.stage > 1; }
  function revealedP() { return S.stage === 1 ? S.p > 0.15 : S.stage > 1; }
  function mix(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function css(c, al) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (al === undefined ? 1 : al) + ')'; }

  function syncUI() {
    var q = Q[S.kind], names = STAGE[S.mode];
    qBtns.forEach(function (b, i) { var on = ORDER[i] === S.kind && S.stage > 0; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    mBtns.forEach(function (b, i) { var on = (i === 0) === (S.mode === 'infer'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    sBtns.forEach(function (b, i) { b.textContent = (i + 1) + ' ' + names[i]; b.classList.toggle('on', i === S.stage); });
    back.disabled = S.stage === 0; next.disabled = S.stage === 4;
    play.textContent = S.playing ? 'Pause' : (S.stage === 4 && S.p >= 1 ? 'Replay' : 'Play');
    if (S.stage === 0) {
      ask.textContent = 'Pick a question above, or press Play.'; gg.innerHTML = '';
    } else {
      ask.textContent = q.ask;
      gg.innerHTML = '<span class="ma-g">Given</span> ' + q.given + ' <span class="ma-h">Generated</span> ' + q.gen;
    }
    var showS = S.stage === 3;
    sl.hidden = !showS;
    slT.textContent = S.mode === 'infer' ? 'Noise level, drag to scrub' : 'Noise level of this pass, drag to change';
    cap.textContent = caption();
    cv.setAttribute('aria-label', names[S.stage] + '. ' + cap.textContent);
  }
  function caption() {
    var q = Q[S.kind], tr = S.mode === 'train';
    switch (S.stage) {
      case 0: return 'A real PhysX simulation: a piston pushes the cue ball, which breaks a rack of six balls at ' + D.first_hit_s + ' s. Each row is one object: its properties, then its motion in 0.2 s patches (darker means faster).';
      case 1: return q.mask + (tr ? ' In training the hidden tokens get one random noise level.' : ' Hidden tokens are replaced by pure noise.');
      case 2: return 'Everything enters as one sequence of tokens; there is no separate conditioning branch. Given tokens are clean, and hidden ones carry their noise level.';
      case 3: return tr ? (S.kind === 'prop' ? 'One pass through the network. It must predict the direction from the noisy properties back to the true ones.'
        : 'One pass through the network. It must predict the direction from each noisy token back to the truth (the lines on the right, drawn for the cue ball only).')
        : 'Ten flow-matching steps. At each step the network predicts a velocity for every token; only the hidden ones move along it, and the given ones stay fixed.';
      default: return tr ? 'The loss is measured on the hidden tokens only; given tokens cost nothing.' + q.loss + ' Each example in a batch draws its own question.' : q.out;
    }
  }

  /* ---------- drawing ---------- */
  var ctx = cv.getContext('2d'), scale = 1;
  function fit() {
    var w = cv.clientWidth || VW, dpr = window.devicePixelRatio || 1;
    scale = w / VW;
    var bw = Math.round(w * dpr), bh = Math.round(VH * scale * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cv.style.height = Math.round(VH * scale) + 'px';
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }
  function text(s, x, y, size, color, weight, align) {
    ctx.font = (weight || 400) + ' ' + size + 'px ' + FONT; ctx.fillStyle = color || INK; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y);
  }
  function round(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function dot(x, y, r, fill, stroke) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.3; ctx.stroke(); } }

  function drawChips() {
    text('Always given, never generated', 12, 17, 12, SOFT);
    var items = [['Scene: ' + D.n_objects + ' objects', true], [D.n_joints + ' joint', true], ['Start state', true], ['End state', endGiven() && S.stage > 0]];
    var x = 12;
    items.forEach(function (it) {
      ctx.font = '12.5px ' + FONT;
      var w = ctx.measureText(it[0]).width + 20;
      round(x, 26, w, 24, 5);
      if (it[1]) { ctx.fillStyle = css(BLUE); ctx.fill(); text(it[0], x + 10, 42, 12.5, '#fff'); }
      else { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#b4bcc6'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); text(it[0], x + 10, 42, 12.5, '#8a94a0'); }
      x += w + 7;
    });
  }
  var ACT_TEXT = A.semantic + ': ' + A.object + ' on ' + A.payload + ', ' + A.force_N + ' N, ' + A.onset_s + ' to ' + A.end_s + ' s';
  var GLYPHS = 'abcdefghkmnpqrstuvwxyz0123456789';
  function drawAction(t) {
    text('Action', 12, 83, 12.5, INK, 500);
    var hid = hidA() && revealedP(), x = P_X, w = Y_X + K * Y_W - P_X;
    round(x, 66, w, 26, 4);
    ctx.fillStyle = css(hid ? mix(AMB_L, N1, t * 0.75) : BLUE_L); ctx.fill();
    var s = ACT_TEXT;
    if (hid && t > 0) {
      var out = '', stepSeed = Math.floor(t * 40);
      for (var i = 0; i < s.length; i++) {
        var r = eCell[i % M][(i * 3 + 1) % K];
        var g = eCell[(i + stepSeed) % M][(i * 7 + stepSeed) % K];
        out += r < t && s[i] !== ' ' ? GLYPHS[Math.floor(g * GLYPHS.length)] : s[i];
      }
      s = out;
    }
    text(s, x + 10, 83, 12.5, hid && t > 0.45 ? '#fff' : '#1a2a44');
  }
  function drawBoard(t) {
    ['mass', 'fric.', 'bounce'].forEach(function (s, c) { text(s, P_X + (c + 0.5) * P_W, ROW_Y - 7, 10.5, SOFT, 400, 'center'); });
    text('motion, one cell = 0.2 s', Y_X, ROW_Y - 7, 10.5, SOFT);
    var dim = S.mode === 'train' && S.stage === 4;
    for (var i = 0; i < M; i++) {
      var y = ROW_Y + i * ROW_H, b = B[i];
      dot(17, y + ROW_H / 2, 4.5, css(b.rgb.map(function (v) { return v * 255; })));
      text(b.label, 26, y + 16, 12, INK);
      var hp = hidP(i) && revealedP(), out = i === TOOL && toolPropsOut() && revealedP();
      for (var c = 0; c < 3; c++) {
        var cx = P_X + c * P_W;
        ctx.globalAlpha = dim && !hp ? 0.35 : 1;
        ctx.fillStyle = out ? '#eef0f3' : css(hp ? mix(AMB_L, N1, t * 0.6) : BLUE_L);
        ctx.fillRect(cx + 1, y + 2, P_W - 2, ROW_H - 4);
        var v = b[PROP[c]];
        if (hp) v = (1 - t) * v + t * eP[i][c];
        if (!out) text(v.toFixed(2), cx + P_W / 2, y + 16.5, 10.5, hp && t > 0.5 ? '#fff' : '#1a2a44', 400, 'center');
        ctx.globalAlpha = 1;
      }
      for (var k = 0; k < K; k++) {
        var h = hidY(i, k) && revealed(k), I = bright(i, k), col;
        if (h) col = mix(mix(AMB_L, AMB, I), mix(N0, N1, eCell[i][k]), t);
        else col = mix(BLUE_L, BLUE, I);
        ctx.globalAlpha = dim && !h ? 0.3 : 1;
        ctx.fillStyle = css(col);
        ctx.fillRect(Y_X + k * Y_W + 0.5, y + 2, Y_W - 1, ROW_H - 4);
        ctx.globalAlpha = 1;
      }
    }
    var ax = ROW_Y + M * ROW_H + 13;
    [0, 2, 4, 6].forEach(function (s) { text(s + ' s', Y_X + s / PS * Y_W, ax, 10.5, SOFT, 400, s === 0 ? 'left' : (s === 6 ? 'right' : 'center')); });
    var sec = playSec();
    if (sec !== null) { ctx.fillStyle = INK; ctx.fillRect(Y_X + sec / PS * Y_W - 0.75, ROW_Y, 1.5, M * ROW_H); }
    /* legend */
    var ly = ax + 25, lx = 12;
    [[css(BLUE), 'given'], [css(AMB), 'hidden, then generated'], [css(mix(N0, N1, 0.55)), 'noise']].forEach(function (e) {
      ctx.fillStyle = e[0]; ctx.fillRect(lx, ly - 10, 12, 12);
      text(e[1], lx + 17, ly, 12, SOFT);
      ctx.font = '12px ' + FONT; lx += 17 + ctx.measureText(e[1]).width + 18;
    });
  }
  function bez(a, b, c, u) { var v = 1 - u; return [v * v * a[0] + 2 * v * u * b[0] + u * u * c[0], v * v * a[1] + 2 * v * u * b[1] + u * u * c[1]]; }
  function stream(a, c, colors, phase, n) {
    var b = [(a[0] + c[0]) / 2, a[1]];
    for (var i = 0; i < n; i++) {
      var u = (i / n + phase) % 1, q = bez(a, b, c, u);
      ctx.globalAlpha = Math.min(1, Math.min(u, 1 - u) * 6);
      dot(q[0], q[1], 2.4, colors[i % colors.length]);
    }
    ctx.globalAlpha = 1;
  }
  function rowColors(i) {
    var any = false, given = false;
    for (var k = 0; k < K; k++) { if (hidY(i, k)) any = true; else given = true; }
    if (hidP(i)) any = true; else given = true;
    return any && given ? [css(AMB), css(BLUE)] : [any ? css(AMB) : css(BLUE)];
  }
  function drawFlows() {
    var inflow = -1, outflow = -1;
    if (S.stage === 2) inflow = S.p * 2.5;
    if (S.stage === 3 && S.manual === null) {
      var x = S.mode === 'train' ? S.p : (Math.min(S.p, 0.9999) * STEPS) % 1;
      if (x < 0.5) inflow = x; else outflow = x - 0.5;
      if (S.p >= 1) { inflow = -1; outflow = -1; }
    }
    var mx = MX, xr = Y_X + K * Y_W + 2, i;
    if (inflow >= 0) {
      stream([430, 38], [mx, MY + 34], [css(BLUE)], inflow, 7);
      stream([xr, 79], [mx, MY + 58], [hidA() ? css(AMB) : css(BLUE)], inflow, 7);
      for (i = 0; i < M; i++) stream([xr, ROW_Y + (i + 0.5) * ROW_H], [mx, MY + 86 + i * 20], rowColors(i), inflow, 6);
    }
    if (outflow >= 0) {
      if (hidA()) stream([mx, MY + 58], [xr, 79], [css(AMB)], outflow, 7);
      for (i = 0; i < M; i++) {
        var any = hidP(i);
        for (var k = 0; k < K; k++) if (hidY(i, k)) any = true;
        if (any) stream([mx, MY + 86 + i * 20], [xr, ROW_Y + (i + 0.5) * ROW_H], [css(AMB)], outflow, 6);
      }
    }
  }
  function drawModel(t) {
    round(MX, MY, MW, MH, 10); ctx.fillStyle = css(BLUE); ctx.fill();
    text('World model', MX + MW / 2, MY + 30, 16.5, '#fff', 600, 'center');
    text('one transformer', MX + MW / 2, MY + 49, 11.5, '#d8e6ff', 400, 'center');
    var active = S.stage === 2 || (S.stage === 3 && S.manual === null && S.p < 1);
    for (var i = 0; i < 8; i++) {
      var al = 0.28;
      if (active) { var ph = (S.p * (S.stage === 3 && S.mode === 'infer' ? STEPS : 2.5) * 2 - i / 8) % 1; al = 0.25 + 0.55 * Math.max(0, 1 - Math.abs(ph - 0.5) * 3); }
      ctx.fillStyle = 'rgba(255,255,255,' + al + ')';
      ctx.fillRect(MX + 18, MY + 66 + i * 13, MW - 36, 8);
    }
    var ry = MY + 188, big, small;
    if (S.stage === 0) { big = ''; small = ''; }
    else if (S.mode === 'train') { big = 'noise ' + t.toFixed(2); small = S.stage === 4 ? 'loss on hidden tokens' : (S.stage === 3 ? 'one pass' : ''); }
    else if (S.stage === 3) { big = 'noise ' + t.toFixed(2); small = S.manual !== null ? 'scrubbing' : 'step ' + Math.min(STEPS, Math.floor(Math.min(S.p, 0.9999) * STEPS) + 1) + ' of ' + STEPS; }
    else if (S.stage === 4) { big = 'noise 0'; small = 'done'; }
    else { big = 'noise 1'; small = 'hidden tokens'; }
    text(big, MX + MW / 2, ry + 14, 14, '#fff', 500, 'center');
    text(small, MX + MW / 2, ry + 33, 11.5, '#d8e6ff', 400, 'center');
  }
  function playSec() {
    if (S.stage === 0 && S.p > 0) return S.p * H;
    if (S.stage === 4 && S.mode === 'infer' && S.p > 0) return S.p * H;
    return null;
  }
  function drawTop(t) {
    text('Seen from above', TX, 17, 12, SOFT);
    round(TX, TY, TW, TH, 8); ctx.fillStyle = '#f7f8fa'; ctx.fill(); ctx.strokeStyle = '#d9dee5'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); round(TX, TY, TW, TH, 8); ctx.clip();
    var sec = playSec(), i, k, q;
    if (S.stage === 0) {
      for (i = 0; i < M; i++) for (k = 0; k < K; k++) if (sec !== null && (k + 0.5) * PS <= sec) { q = patchXY(i, k); dot(vx(q[0]), vy(q[1]), 1.7, css(BLUE, 0.7)); }
    } else {
      for (i = 0; i < M; i++) {
        var s0 = B[i].path[0];
        for (k = 0; k < K; k++) {
          q = patchXY(i, k);
          var h = hidY(i, k) && revealed(k);
          if (!h) { dot(vx(q[0]), vy(q[1]), 1.9, css(BLUE, 0.85)); continue; }
          var nx = (1 - t) * q[0] + t * (s0[0] + eXY[i][k][0]), ny = (1 - t) * q[1] + t * (s0[1] + eXY[i][k][1]);
          if (S.mode === 'train' && S.stage >= 3 && i === 0) { ctx.strokeStyle = css(AMB, 0.7); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(vx(nx), vy(ny)); ctx.lineTo(vx(q[0]), vy(q[1])); ctx.stroke(); }
          var c = mix(AMB, N1, Math.min(1, t * 1.2));
          dot(vx(nx), vy(ny), 2.1, t < 0.02 ? css(AMB_L) : css(c, 0.8), t < 0.02 ? css(AMB) : null);
        }
      }
    }
    if (endGiven() && S.stage > 0) {
      for (i = 0; i < M; i++) { q = B[i].path[B[i].path.length - 1]; ctx.setLineDash([3, 2]); dot(vx(q[0]), vy(q[1]), Math.max(4, B[i].r * SC), null, css(BLUE)); ctx.setLineDash([]); }
    }
    for (i = 0; i < M; i++) {
      q = sec === null ? (S.stage === 4 && S.mode === 'infer' && S.p >= 1 ? B[i].path[B[i].path.length - 1] : B[i].path[0]) : at(i, sec);
      var col = css(B[i].rgb.map(function (v) { return v * 255; }));
      if (B[i].tool) { ctx.fillStyle = col; ctx.strokeStyle = SOFT; ctx.lineWidth = 1; ctx.fillRect(vx(q[0]) - 6, vy(q[1]) - 7, 12, 14); ctx.strokeRect(vx(q[0]) - 6, vy(q[1]) - 7, 12, 14); }
      else dot(vx(q[0]), vy(q[1]), Math.max(4, B[i].r * SC), col, '#fff');
    }
    ctx.restore();
    if (sec !== null) text(sec.toFixed(1) + ' s', TX + TW - 10, TY + TH - 10, 12, SOFT, 500, 'right');
    if (endGiven() && S.stage > 0) text('dashed: the given end', TX + 10, TY + TH - 10, 11.5, SOFT);
  }
  function draw() {
    fit();
    ctx.clearRect(0, 0, VW, VH);
    var t = noise();
    drawChips(); drawAction(t); drawBoard(t); drawFlows(); drawModel(t); drawTop(t);
    if (S.stage === 3) range.value = Math.round((S.mode === 'infer' ? t : S.s) * 100);
  }

  /* ---------- hover: read one token ---------- */
  cv.addEventListener('mousemove', function (e) {
    var r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale, i = Math.floor((y - ROW_Y) / ROW_H), msg = '';
    if (i >= 0 && i < M) {
      var b = B[i];
      if (x >= Y_X && x < Y_X + K * Y_W) {
        var k = Math.floor((x - Y_X) / Y_W), q = patchXY(i, k), h = hidY(i, k) && revealed(k);
        msg = b.label + ', ' + (k * PS).toFixed(1) + ' to ' + ((k + 1) * PS).toFixed(1) + ' s: at (' + q[0].toFixed(2) + ', ' + q[1].toFixed(2) + ') m, ' + b.speed[k].toFixed(2) + ' m/s. ' + (h ? 'Hidden.' : 'Given.');
      } else if (x >= P_X && x < P_X + 3 * P_W) {
        var c = Math.floor((x - P_X) / P_W);
        if (i === TOOL && toolPropsOut() && revealedP()) msg = 'The tool’s properties are not asked for.';
        else msg = b.label + ' ' + ['mass ' + b.mass + ' kg', 'friction ' + b.friction, 'bounciness (restitution) ' + b.restitution][c] + '. ' + (hidP(i) && revealedP() ? 'Hidden.' : 'Given.');
      }
    }
    if (!msg) { tip.hidden = true; return; }
    tip.textContent = msg; tip.hidden = false;
    var sr = scroll.getBoundingClientRect();
    tip.style.left = Math.min(sr.width - 250, Math.max(0, e.clientX - sr.left + scroll.scrollLeft + 12)) + 'px';
    tip.style.top = (e.clientY - sr.top + 14) + 'px';
  });
  cv.addEventListener('mouseleave', function () { tip.hidden = true; });

  window.addEventListener('resize', draw);
  function init() { syncUI(); draw(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  init();
})();
