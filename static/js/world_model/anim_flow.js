/* Flow-matching animation (canvas, uses window.WM_SAMPLE).
   One object only: the red ball's recorded 61-frame PhysX path is the clean
   sample x1. Six phases per cycle make the pairing explicit: show the truth,
   show the noise (each noise point tied to its own frame's truth point), draw
   tau, mix, predict, score. The "network" is illustrative (a fixed perturbation
   of the true direction), not a trained model. tau cycles through 0.2, 0.5, 0.8. */
(function () {
  'use strict';
  var WM = window.WM, S = window.WM_SAMPLE;
  var root = document.getElementById('anim-flow');
  if (!root || !WM || !S) return;
  var canvas = root.querySelector('canvas'), btn = root.querySelector('button'), cap = root.querySelector('.wm-caption');
  var C = WM.colors;
  var red = S.objects.o024;
  var X1 = red.position.map(function (p) { return [p[0], p[2]]; });
  var N = X1.length;                                   /* 61 frames */
  var TAUS = [0.2, 0.5, 0.8];
  var PHASES = [['truth', 1.6], ['noise', 1.8], ['tau', 1.2], ['mix', 1.8], ['predict', 1.8], ['loss', 2.6]];
  var IDX = [0, 12, 24, 36, 48, 60];                   /* the six highlighted pairs */
  var ANG = [8, -10, 12, -7, 9, -11];                  /* fixed direction errors of the pretend network, degrees */
  var SCL = [0.10, -0.08, 0.12, -0.10, 0.07, -0.12];   /* fixed length errors */
  var TOP = 96, PADL = 36, PADR = 14, LOSS_SCALE = 0.12;
  var st = { cycle: -1, phase: 0, t: 0, tau: 0.5, x0: [] }, lastCap = null;

  function newCycle(c) {
    st.cycle = c;
    st.tau = TAUS[c % TAUS.length];
    var r = WM.rng(1000 + c);
    st.x0 = [];
    for (var i = 0; i < N; i++) {
      var x, z, tries = 0;
      do { x = 0.45 + WM.gauss(r) * 0.75; z = 0.5 + WM.gauss(r) * 0.26; tries++; }
      while ((x < -0.95 || x > 1.85 || z < 0.03 || z > 0.95) && tries < 50);
      st.x0.push([WM.clamp(x, -0.95, 1.85), WM.clamp(z, 0.03, 0.95)]);
    }
    st.phase = 0; st.t = 0;
  }
  function advance(dt) {
    if (st.cycle < 0) newCycle(0);
    st.t += dt;
    while (st.t >= PHASES[st.phase][1]) {
      st.t -= PHASES[st.phase][1];
      st.phase++;
      if (st.phase >= PHASES.length) { var keep = st.t; newCycle(st.cycle + 1); st.t = keep; }
    }
  }
  function representative() { newCycle(1); st.phase = 5; st.t = PHASES[5][1] - 0.001; }

  function mixPoints(m) {
    var out = [];
    for (var i = 0; i < N; i++) {
      out.push([st.x0[i][0] + m * (X1[i][0] - st.x0[i][0]), st.x0[i][1] + m * (X1[i][1] - st.x0[i][1])]);
    }
    return out;
  }
  function vectors() {
    var f = 1.3 - st.tau, out = [];          /* the pretend network errs more at low tau */
    for (var k = 0; k < IDX.length; k++) {
      var i = IDX[k];
      var ux = X1[i][0] - st.x0[i][0], uz = X1[i][1] - st.x0[i][1];
      var a = ANG[k] * f * Math.PI / 180, sc = 1 + SCL[k] * f;
      out.push({ i: i, u: [ux, uz], uh: [(ux * Math.cos(a) - uz * Math.sin(a)) * sc, (ux * Math.sin(a) + uz * Math.cos(a)) * sc] });
    }
    return out;
  }
  function mse(vs) {
    var sum = 0;
    for (var k = 0; k < vs.length; k++) {
      var gx = vs[k].uh[0] - vs[k].u[0], gz = vs[k].uh[1] - vs[k].u[1];
      sum += gx * gx + gz * gz;
    }
    return sum / vs.length;
  }
  function logitNormalPdf(t) {
    var l = Math.log(t / (1 - t));
    return Math.exp(-0.5 * l * l) / (Math.sqrt(2 * Math.PI) * t * (1 - t));
  }

  function drawTauInset(ctx, v, phase, q, shown) {
    var small = v.small, fs = v.fs;
    var x0 = PADL, w = small ? Math.floor(v.W * 0.44) : 230, y0 = 12, h = 62;
    var baseY = y0 + h, maxPdf = 0, pts = [], n = 80;
    for (var i = 1; i < n; i++) { var t = i / n, p = logitNormalPdf(t); pts.push([t, p]); if (p > maxPdf) maxPdf = p; }
    ctx.save();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, baseY + 0.5); ctx.lineTo(x0 + w, baseY + 0.5); ctx.stroke();
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
      var px = x0 + pts[j][0] * w, py = baseY - (pts[j][1] / maxPdf) * (h - 16);
      if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = C.slate; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = v.font(fs - 1); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('how tau is drawn (logit-normal)', x0, y0 - 2);
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', x0, baseY + fs);
    ctx.textAlign = 'right'; ctx.fillText('1', x0 + w, baseY + fs);
    if (shown) {
      var tx = x0 + st.tau * w, ty = baseY - (logitNormalPdf(st.tau) / maxPdf) * (h - 16);
      var drop = phase === 'tau' ? WM.ease(Math.min(1, q / 0.7)) : 1;
      var my = WM.lerp(y0 - 6, ty, drop);
      if (drop >= 1) {
        ctx.setLineDash([2, 3]); ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, baseY); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = C.amber;
      ctx.beginPath(); ctx.arc(tx, my, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = C.text; ctx.font = v.font(fs, true); ctx.textAlign = st.tau > 0.6 ? 'right' : 'left';
      ctx.fillText('tau = ' + st.tau.toFixed(2), tx + (st.tau > 0.6 ? -8 : 8), baseY - 6);
    }
    ctx.restore();
  }

  function drawLossBar(ctx, v, phase, q) {
    var small = v.small, fs = v.fs;
    var w = small ? Math.floor(v.W * 0.44) : 230, x0 = v.W - PADR - w, y0 = 12;
    var frac = Math.min(1, mse(vectors()) / LOSS_SCALE);
    var fill = phase === 'loss' ? WM.ease(Math.min(1, q / 0.6)) * frac : 0;
    ctx.save();
    ctx.fillStyle = C.muted; ctx.font = v.font(fs - 1); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('loss = mean squared red gap (illustrative)', x0, y0 - 2);
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 16.5, w - 1, 18);
    if (fill > 0) { ctx.fillStyle = C.red; ctx.fillRect(x0 + 1, y0 + 17, (w - 2) * fill, 17); }
    ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic';
    if (!small) {
      ctx.fillText('mean of w (u_hat - (x1 - x0))^2', x0, y0 + 48);
      ctx.fillText('w = 1: the ball moves', x0, y0 + 48 + fs + 2);
    }
    ctx.restore();
  }

  function dot(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }

  function render() {
    if (st.cycle < 0) newCycle(0);
    var W0 = canvas.clientWidth || 900;
    var v = WM.sideView(W0, TOP, PADL, PADR);
    var fit = WM.fitCanvas(canvas, Math.round(v.bottom + 4));
    var ctx = fit.ctx, W = fit.W, fs = v.fs;
    var phase = PHASES[st.phase][0], q = WM.clamp(st.t / PHASES[st.phase][1], 0, 1);
    var step = st.phase + 1;
    var afterNoise = st.phase >= 1, afterTau = st.phase >= 2, afterMix = st.phase >= 3, afterPredict = st.phase >= 4, inLoss = phase === 'loss';
    ctx.clearRect(0, 0, W, fit.H);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, fit.H);

    drawTauInset(ctx, v, phase, q, afterTau);
    drawLossBar(ctx, v, phase, q);
    if (!v.small) {
      ctx.fillStyle = C.text; ctx.font = v.font(13, true); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('x_tau = (1 - tau) x0 + tau x1', W / 2, 14);
      ctx.fillStyle = C.muted; ctx.font = v.font(fs);
      var names = { truth: 'the truth', noise: 'the noise, paired frame by frame', tau: 'draw tau', mix: 'mix', predict: 'the network guesses the direction', loss: 'the loss' };
      ctx.fillText('step ' + step + ' of 6: ' + names[phase], W / 2, 36);
      ctx.fillText('one object, two of its 15 channels (x and z)', W / 2, 54);
    }

    v.drawScene(ctx, S, { minimal: true });
    ctx.save();
    v.clip(ctx);                                   /* nothing below is drawn outside the plot frame */

    /* x1: the recorded path, faded once the noise is in so the moving points stand out */
    var truthAlpha = afterNoise ? 0.55 : 1;
    ctx.save();
    ctx.globalAlpha = truthAlpha;
    ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < N; i++) { var px = v.x(X1[i][0]), pz = v.z(X1[i][1]); if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz); }
    ctx.stroke();
    var reveal = phase === 'truth' ? Math.floor(WM.ease(q) * N) : N;
    for (var d = 0; d < reveal; d++) dot(ctx, v.x(X1[d][0]), v.z(X1[d][1]), 2.4, C.red);
    ctx.restore();

    if (afterNoise) {
      var appear = phase === 'noise' ? WM.ease(Math.min(1, q / 0.5)) : 1;
      var m = phase === 'mix' ? WM.ease(q) * st.tau : (afterMix ? st.tau : 0);
      var P = mixPoints(m);
      /* pairing lines: every point's own frame, faint; the six highlighted pairs darker */
      ctx.save();
      ctx.globalAlpha = appear;
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      for (var j = 0; j < N; j++) {
        var hi = IDX.indexOf(j) >= 0;
        if (afterPredict && !hi) continue;        /* once arrows are drawn, keep only the six reference pairs */
        ctx.strokeStyle = hi ? 'rgba(100, 110, 125, 0.9)' : 'rgba(160, 170, 182, 0.45)';
        ctx.beginPath(); ctx.moveTo(v.x(P[j][0]), v.z(P[j][1])); ctx.lineTo(v.x(X1[j][0]), v.z(X1[j][1])); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (var k = 0; k < N; k++) dot(ctx, v.x(P[k][0]), v.z(P[k][1]), IDX.indexOf(k) >= 0 ? 4 : 2.8, C.dotGray);
      ctx.restore();

      if (afterPredict) {
        var vs = vectors(), scale = 1 - st.tau;
        for (var a = 0; a < vs.length; a++) {
          var base = P[vs[a].i], truth = X1[vs[a].i];
          var showBlue = inLoss || q > a / 8;
          var bx = base[0] + scale * vs[a].uh[0], bz = base[1] + scale * vs[a].uh[1];
          if (showBlue) WM.arrow(ctx, v.x(base[0]), v.z(base[1]), v.x(bx), v.z(bz), C.blue, 2.4, 8);
          if (inLoss && q > a / 10) {
            ctx.save();
            ctx.strokeStyle = C.red; ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(v.x(bx), v.z(bz)); ctx.lineTo(v.x(truth[0]), v.z(truth[1])); ctx.stroke();
            ctx.restore();
            dot(ctx, v.x(truth[0]), v.z(truth[1]), 3.2, C.red);
          }
        }
      }
    }
    ctx.restore();                                 /* end of the clipped region */

    /* legend, top right of the plot */
    if (!v.small) {
      ctx.save();
      ctx.font = v.font(fs); ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      var lx = v.right - 8, ly = v.top + 6, lh = fs + 4, row = 0;
      ctx.fillStyle = C.red; ctx.fillText('red: x1, the recorded path, one point per frame', lx, ly + lh * row++);
      if (afterNoise) { ctx.fillStyle = C.dotGray; ctx.fillText(afterMix ? 'gray: x_tau, each point partway to its own frame' : 'gray: x0, noise, one point per frame', lx, ly + lh * row++); }
      if (afterNoise) { ctx.fillStyle = C.slate; ctx.fillText('dashed: the true direction x1 - x0, pair by pair', lx, ly + lh * row++); }
      if (afterPredict) { ctx.fillStyle = C.blue; ctx.fillText('blue: u_hat, the network\'s guess (illustrative)', lx, ly + lh * row++); }
      if (inLoss) { ctx.fillStyle = C.red; ctx.fillText('red gap: what the loss squares', lx, ly + lh * row++); }
      ctx.restore();
    }

    var text = captionText(phase);
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }

  function captionText(phase) {
    var tau = st.tau.toFixed(2);
    if (phase === 'truth') return 'Step 1 of 6, the truth: x1 is the red ball\'s recorded PhysX path, one point per frame (61). This is what the model must learn to produce.';
    if (phase === 'noise') return 'Step 2 of 6, the noise: x0 is one random point per frame. Each gray point belongs to one frame, so it is paired with that frame\'s red point; the dashed line is their difference, x1 - x0, the direction from noise to truth.';
    if (phase === 'tau') return 'Step 3 of 6, draw tau: tau = ' + tau + ' is drawn from a logit-normal distribution (bell curve, top left). It says how far along the dashed line the mixed point will sit.';
    if (phase === 'mix') return 'Step 4 of 6, mix: every gray point slides along its own dashed line and stops at x_tau = (1 - tau) x0 + tau x1, here ' + Math.round(st.tau * 100) + ' percent of the way to the truth.';
    if (phase === 'predict') return 'Step 5 of 6, predict: the network reads the mixed points (and the scene tokens) and outputs u_hat, its guess of the direction to the truth, shown as a blue arrow at six of the pairs. The dashed line is the right answer.';
    return 'Step 6 of 6, the loss: for every pair, the red gap between the blue arrow\'s tip and the red truth point is squared; the loss is the mean of these squares over all 61 points and all 15 channels (w = 1 because the ball moves). Then a new tau and a new noise sample.';
  }

  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
