/* Flow-matching animation (canvas, uses window.WM_SAMPLE).
   One object only: the red ball's recorded PhysX path is the clean sample x1, shown at every fourth of its 61
   frames. Six slow steps, each ending in a short pause: the truth, the noise (each noise point tied to its own
   frame), draw tau, mix, the network's guess, the loss. One pair is highlighted and labelled throughout so the
   story of a single point can be followed. Controls added here: step back, play/pause, step forward, speed, and
   clickable step labels. The "network" is illustrative (a fixed perturbation of the true direction). */
(function () {
  'use strict';
  var WM = window.WM, S = window.WM_SAMPLE;
  var root = document.getElementById('anim-flow');
  if (!root || !WM || !S) return;
  var canvas = root.querySelector('canvas'), btn = root.querySelector('button'), cap = root.querySelector('.wm-caption');
  var controls = root.querySelector('.wm-controls');
  var C = WM.colors;
  var ALL = S.objects.o024.position.map(function (p) { return [p[0], p[2]]; });
  var FRAMES = [];
  for (var f = 0; f < ALL.length; f += 4) FRAMES.push(f);
  if (FRAMES[FRAMES.length - 1] !== ALL.length - 1) FRAMES.push(ALL.length - 1);
  var X1 = FRAMES.map(function (i) { return ALL[i]; });
  var N = X1.length;
  var FOCUS = 3;                                        /* frame 12, near the top of the arc: the highlighted, labelled pair */
  var ARROWS = [1, FOCUS, 7, 10, 13];                   /* pairs that get a guess arrow */
  var ERR = { 1: [10, 0.10], 3: [14, 0.12], 7: [-12, -0.08], 10: [-9, -0.10], 13: [11, 0.08] };  /* pretend network: degrees, length */
  var TAUS = [0.5, 0.25, 0.8];
  var STEPS = [
    { key: 'truth', title: 'The truth', dur: 5, formula: 'x1 = the recorded path, one point per frame' },
    { key: 'noise', title: 'Pair with noise', dur: 6.5, formula: 'x0 = random noise, one point per frame' },
    { key: 'tau', title: 'Draw tau', dur: 4.5, formula: 'tau is drawn between 0 and 1 (logit-normal)' },
    { key: 'mix', title: 'Mix', dur: 6, formula: 'x_tau = (1 - tau) x0 + tau x1' },
    { key: 'predict', title: 'The guess', dur: 6.5, formula: 'u_hat = network(x_tau, tau, scene, action)' },
    { key: 'loss', title: 'The loss', dur: 7, formula: 'loss = mean of w (u_hat - (x1 - x0))^2' }];
  var HOLD = 2;                                         /* still seconds at the end of every step */
  var SPEEDS = [0.5, 1, 2];
  var speed = 1, TOP = 104, PADL = 44, PADR = 16, LOSS_SCALE = 0.05;
  var st = { cycle: -1, phase: 0, t: 0, tau: 0.5, x0: [] }, lastCap = null, chips = [], speedButtons = [];

  function newCycle(c) {
    st.cycle = c;
    st.tau = TAUS[((c % TAUS.length) + TAUS.length) % TAUS.length];
    var r = WM.rng(2000 + c);
    st.x0 = [];
    for (var i = 0; i < N; i++) {
      var x, z, tries = 0;
      do { x = 0.45 + WM.gauss(r) * 0.75; z = 0.5 + WM.gauss(r) * 0.25; tries++; }
      while ((x < -0.95 || x > 1.85 || z < 0.05 || z > 0.95) && tries < 50);
      st.x0.push([WM.clamp(x, -0.95, 1.85), WM.clamp(z, 0.05, 0.95)]);
    }
    st.phase = 0; st.t = 0;
  }
  function advance(dt) {
    if (st.cycle < 0) newCycle(0);
    st.t += dt * speed;
    while (st.t >= STEPS[st.phase].dur) {
      st.t -= STEPS[st.phase].dur;
      st.phase++;
      if (st.phase >= STEPS.length) { var keep = st.t; newCycle(st.cycle + 1); st.t = keep; }
    }
  }
  function representative() { newCycle(0); st.phase = 5; st.t = STEPS[5].dur - 0.01; }
  function goTo(k) {
    if (st.cycle < 0) newCycle(0);
    if (k >= STEPS.length) { newCycle(st.cycle + 1); k = 0; }
    st.phase = Math.max(0, k); st.t = 0;
    render();
  }
  function progress() { return WM.clamp(st.t / Math.max(0.1, STEPS[st.phase].dur - HOLD), 0, 1); }

  function mixed(m) {
    return st.x0.map(function (p, i) { return [p[0] + m * (X1[i][0] - p[0]), p[1] + m * (X1[i][1] - p[1])]; });
  }
  function guess(i) {                                   /* the pretend network's direction for pair i */
    var ux = X1[i][0] - st.x0[i][0], uz = X1[i][1] - st.x0[i][1];
    var e = ERR[i], f = 1.3 - st.tau, a = e[0] * f * Math.PI / 180, sc = 1 + e[1] * f;
    return [(ux * Math.cos(a) - uz * Math.sin(a)) * sc, (ux * Math.sin(a) + uz * Math.cos(a)) * sc];
  }
  function lossValue() {
    var sum = 0;
    ARROWS.forEach(function (i) {
      var g = guess(i), ux = X1[i][0] - st.x0[i][0], uz = X1[i][1] - st.x0[i][1];
      sum += (g[0] - ux) * (g[0] - ux) + (g[1] - uz) * (g[1] - uz);
    });
    return sum / ARROWS.length;
  }
  function logitNormalPdf(t) {
    var l = Math.log(t / (1 - t));
    return Math.exp(-0.5 * l * l) / (Math.sqrt(2 * Math.PI) * t * (1 - t));
  }

  /* ---------- controls added to the block ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function buildControls() {
    var row = el('div', 'tags wm-flow-steps');
    row.style.margin = '0 0 .5rem'; row.style.justifyContent = 'center';
    STEPS.forEach(function (s, k) {
      var chip = el('a', 'tag is-rounded is-medium', (k + 1) + '. ' + s.title);
      chip.setAttribute('role', 'button'); chip.setAttribute('tabindex', '0'); chip.style.cursor = 'pointer';
      chip.addEventListener('click', function () { goTo(k); });
      chip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(k); } });
      chips.push(chip); row.appendChild(chip);
    });
    root.insertBefore(row, canvas);
    var back = el('button', 'button is-small is-light', '◀ Step');
    var fwd = el('button', 'button is-small is-light', 'Step ▶');
    back.type = fwd.type = 'button';
    back.setAttribute('aria-label', 'Previous step'); fwd.setAttribute('aria-label', 'Next step');
    back.addEventListener('click', function () { goTo(st.phase - (st.t < 0.5 ? 1 : 0)); });
    fwd.addEventListener('click', function () { goTo(st.phase + 1); });
    controls.insertBefore(back, btn);
    controls.insertBefore(fwd, btn.nextSibling);
    var group = el('div', 'buttons has-addons');
    group.style.margin = '0 .5rem 0 0';
    SPEEDS.forEach(function (v) {
      var b = el('button', 'button is-small', v + '×');
      b.type = 'button'; b.setAttribute('aria-label', 'Speed ' + v + ' times'); b.style.minWidth = '3.2rem';
      b.addEventListener('click', function () { speed = v; markSpeed(); });
      speedButtons.push([v, b]); group.appendChild(b);
    });
    controls.insertBefore(group, fwd.nextSibling);
    markSpeed();
    var legend = el('p', 'wm-note');
    legend.innerHTML = '<span style="color:' + C.red + '">● red: x1, the recorded path (every 4th of 61 frames)</span> &nbsp; ' +
      '<span style="color:#6b7686">● gray: x0, noise, then x_tau</span> &nbsp; <span style="color:#6b7686">- - dashed: the true direction x1 - x0</span> &nbsp; ' +
      '<span style="color:' + C.blue + '">→ blue: the network\'s guess u_hat</span> &nbsp; <span style="color:' + C.red + '">— red gap: what the loss squares</span>';
    root.insertBefore(legend, controls);
  }
  function markSpeed() {
    speedButtons.forEach(function (pair) {   /* the page styles aria-pressed buttons (blue border and text) */
      pair[1].setAttribute('aria-pressed', pair[0] === speed ? 'true' : 'false'); pair[1].style.fontWeight = pair[0] === speed ? '700' : '400';
    });
  }
  function markStep() {
    chips.forEach(function (chip, k) { chip.classList.toggle('is-link', k === st.phase); chip.setAttribute('aria-current', k === st.phase ? 'step' : 'false'); });
  }

  /* ---------- drawing ---------- */
  function dot(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
  function label(ctx, v, text, x, y, color, dx, dy) {
    ctx.save(); ctx.font = v.font(v.small ? 13 : 15, true); ctx.fillStyle = color;
    ctx.textAlign = dx < 0 ? 'right' : 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(text, x + dx, y + dy); ctx.fillText(text, x + dx, y + dy);
    ctx.restore();
  }

  function drawTop(ctx, v, W, q) {
    var small = v.small, fs = small ? 12 : 14, phase = st.phase;
    /* tau panel, left */
    var x0 = PADL, w = small ? Math.floor(W * 0.4) : 200, y0 = 16, h = 60, base = y0 + h, maxPdf = 0, pts = [];
    for (var i = 1; i < 80; i++) { var t = i / 80, p = logitNormalPdf(t); pts.push([t, p]); if (p > maxPdf) maxPdf = p; }
    ctx.save();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, base + 0.5); ctx.lineTo(x0 + w, base + 0.5); ctx.stroke();
    ctx.beginPath();
    pts.forEach(function (pt, j) { var px = x0 + pt[0] * w, py = base - pt[1] / maxPdf * (h - 18); if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.strokeStyle = phase === 2 ? C.amber : C.slate; ctx.lineWidth = phase === 2 ? 2.5 : 1.5; ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = v.font(fs - 1); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('how tau is drawn', x0, y0 - 6);
    ctx.textBaseline = 'alphabetic'; ctx.fillText('0', x0, base + fs + 2); ctx.textAlign = 'right'; ctx.fillText('1', x0 + w, base + fs + 2);
    if (phase >= 2) {
      var tx = x0 + st.tau * w, ty = base - logitNormalPdf(st.tau) / maxPdf * (h - 18);
      var drop = phase === 2 ? WM.ease(q) : 1, my = WM.lerp(y0 - 4, ty, drop);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = C.amber; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tx, my); ctx.lineTo(tx, base); ctx.stroke(); ctx.setLineDash([]);
      dot(ctx, tx, my, 6, C.amber);
      ctx.fillStyle = C.text; ctx.font = v.font(fs + 1, true); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('tau = ' + st.tau.toFixed(2), x0 + w / 2, base + fs + 3);
    }
    /* loss panel, right */
    var lw = small ? Math.floor(W * 0.4) : 200, lx = W - PADR - lw;
    ctx.fillStyle = C.muted; ctx.font = v.font(fs - 1); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('loss (illustrative)', lx, y0 - 6);
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, y0 + 14.5, lw - 1, 20);
    var fill = phase === 5 ? WM.ease(q) * Math.min(1, lossValue() / LOSS_SCALE) : 0;
    if (fill > 0) { ctx.fillStyle = C.red; ctx.fillRect(lx + 1, y0 + 15, (lw - 2) * fill, 19); }
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.muted;
    if (!small) ctx.fillText('mean of the squared red gaps', lx, y0 + 52);
    /* the step's formula, centre */
    if (!small) {
      ctx.fillStyle = C.text; ctx.font = v.font(16, true); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('Step ' + (phase + 1) + ' of 6: ' + STEPS[phase].title, W / 2, 10);
      ctx.font = v.font(15); ctx.fillStyle = phase >= 3 ? C.blue : C.slate;
      ctx.fillText(STEPS[phase].formula, W / 2, 38);
    }
    ctx.restore();
  }

  function render() {
    if (st.cycle < 0) newCycle(0);
    var W0 = canvas.clientWidth || 900;
    var v = WM.sideView(W0, TOP, PADL, PADR);
    var fit = WM.fitCanvas(canvas, Math.round(v.bottom + 6));
    var ctx = fit.ctx, W = fit.W, q = progress(), phase = st.phase;
    ctx.clearRect(0, 0, W, fit.H); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, fit.H);
    drawTop(ctx, v, W, q);
    v.drawScene(ctx, S, { minimal: true });
    ctx.save(); v.clip(ctx);

    /* x1: the full recorded path as a thin line, the sampled frames as dots (revealed in step 1) */
    var reveal = phase === 0 ? Math.max(1, Math.round(WM.ease(q) * N)) : N;
    ctx.save();
    ctx.globalAlpha = phase >= 1 ? 0.5 : 1;
    ctx.strokeStyle = C.red; ctx.lineWidth = 1.5;
    ctx.beginPath();
    var lastFrame = FRAMES[reveal - 1];
    for (var a = 0; a <= lastFrame; a++) { var px = v.x(ALL[a][0]), pz = v.z(ALL[a][1]); if (a) ctx.lineTo(px, pz); else ctx.moveTo(px, pz); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (var d = 0; d < reveal; d++) dot(ctx, v.x(X1[d][0]), v.z(X1[d][1]), d === FOCUS ? 6 : 4, C.red);
    ctx.restore();

    if (phase >= 1) {
      var appear = phase === 1 ? WM.ease(Math.min(1, q * 1.6)) : 1;
      var m = phase === 3 ? WM.ease(q) * st.tau : (phase > 3 ? st.tau : 0);
      var P = mixed(m);
      ctx.save(); ctx.globalAlpha = appear;
      /* pairing lines: the true direction from each noise point to its own frame's truth */
      for (var j = 0; j < N; j++) {
        var focus = j === FOCUS;
        if (phase >= 4 && ARROWS.indexOf(j) < 0) continue;
        ctx.setLineDash([4, 4]); ctx.lineWidth = focus ? 1.8 : 1.1;
        ctx.strokeStyle = focus ? 'rgba(70, 80, 95, 0.95)' : 'rgba(120, 130, 145, 0.55)';
        ctx.beginPath(); ctx.moveTo(v.x(st.x0[j][0]), v.z(st.x0[j][1])); ctx.lineTo(v.x(X1[j][0]), v.z(X1[j][1])); ctx.stroke();
      }
      ctx.setLineDash([]);
      /* where the noise started, faint, once the points have moved */
      if (m > 0) for (var k0 = 0; k0 < N; k0++) dot(ctx, v.x(st.x0[k0][0]), v.z(st.x0[k0][1]), 2.5, 'rgba(138,148,163,0.45)');
      for (var k = 0; k < N; k++) dot(ctx, v.x(P[k][0]), v.z(P[k][1]), k === FOCUS ? 6 : 4.5, '#6b7686');
      ctx.restore();

      /* labels on the highlighted pair */
      var fx = v.x(X1[FOCUS][0]), fz = v.z(X1[FOCUS][1]);
      label(ctx, v, 'x1', fx, fz, C.red, 10, -12);
      label(ctx, v, 'x0', v.x(st.x0[FOCUS][0]), v.z(st.x0[FOCUS][1]), '#4d5866', -10, 12);
      if (phase >= 3 && m > 0.02) label(ctx, v, 'x_tau', v.x(P[FOCUS][0]), v.z(P[FOCUS][1]), '#4d5866', 10, 14);

      if (phase >= 4) {
        var scale = 1 - st.tau;
        ARROWS.forEach(function (i, n) {
          var show = phase === 5 || q > n / ARROWS.length;
          if (!show) return;
          var g = guess(i), bx = P[i][0] + scale * g[0], bz = P[i][1] + scale * g[1];
          WM.arrow(ctx, v.x(P[i][0]), v.z(P[i][1]), v.x(bx), v.z(bz), C.blue, i === FOCUS ? 3 : 2.4, i === FOCUS ? 11 : 9);
          if (phase === 5 && q > n / (ARROWS.length + 1)) {
            ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = i === FOCUS ? 4 : 3; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(v.x(bx), v.z(bz)); ctx.lineTo(v.x(X1[i][0]), v.z(X1[i][1])); ctx.stroke(); ctx.restore();
          }
          if (i === FOCUS && phase === 4) label(ctx, v, 'u_hat', v.x(bx), v.z(bz), C.blue, -12, -10);
          if (i === FOCUS && phase === 5) label(ctx, v, 'gap', (v.x(bx) + v.x(X1[i][0])) / 2, (v.z(bz) + v.z(X1[i][1])) / 2, C.red, -14, 0);
        });
      }
    }
    ctx.restore();
    markStep();
    var text = captionText();
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }

  function captionText() {
    var pct = Math.round(st.tau * 100);
    switch (STEPS[st.phase].key) {
      case 'truth': return 'Step 1. The truth: the red ball\'s path recorded by the physics engine, one dot per frame. This is what the model must learn to produce.';
      case 'noise': return 'Step 2. Every frame gets one random noise point (gray). The dashed line from each gray point leads to the red point of the same frame: that is the true direction from noise to truth, x1 - x0. Follow the labelled pair.';
      case 'tau': return 'Step 3. A number tau between 0 and 1 is drawn at random (here ' + st.tau.toFixed(2) + '). It decides how far along its dashed line each gray point will be placed.';
      case 'mix': return 'Step 4. Every gray point slides along its own dashed line and stops ' + pct + ' percent of the way to the truth: x_tau = (1 - tau) x0 + tau x1. The faint dots show where the noise started.';
      case 'predict': return 'Step 5. The network sees only the mixed points, tau, the scene and the action, and guesses the direction to the truth (blue arrows; illustrative, not a trained network). The dashed line is the right answer.';
      default: return 'Step 6. The loss squares the red gap between each guess and the truth, and averages over all frames, objects and the 15 numbers (w = 1 here because the ball moves). Then a new tau and new noise are drawn and it repeats.';
    }
  }

  buildControls();
  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
