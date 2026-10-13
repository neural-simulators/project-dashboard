/* Flow-matching animation (canvas, uses window.WM_SAMPLE).
   Side view (x horizontal, z vertical) of the red ball's recorded 61-frame
   PhysX path as the clean sample x1. Four phases per cycle: draw tau, mix
   noise and truth, predict the direction, score the loss; tau cycles through
   0.2, 0.5, 0.8. The "network" is illustrative (a fixed perturbation of the
   true direction), not a trained model. */
(function () {
  'use strict';
  var WM = window.WM, S = window.WM_SAMPLE;
  var root = document.getElementById('anim-flow');
  if (!root || !WM || !S) return;
  var canvas = root.querySelector('canvas'), btn = root.querySelector('button'), cap = root.querySelector('.wm-caption');
  var C = WM.colors;
  var red = S.objects.o024;
  var X1 = red.position.map(function (p) { return [p[0], p[2]]; });
  var N = X1.length;                                   /* 61 */
  var TAUS = [0.2, 0.5, 0.8];
  var PHASES = [['draw', 1.7], ['mix', 1.9], ['predict', 2.2], ['loss', 2.8]];
  var IDX = [0, 12, 24, 36, 48, 60];                   /* the six arrows */
  var ANG = [8, -10, 12, -7, 9, -11];                  /* fixed direction errors, degrees */
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
  function representative() { newCycle(1); st.phase = 2; st.t = PHASES[2][1] - 0.001; }

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

  function drawTauInset(ctx, v, phase, q) {
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
    ctx.fillText('p(tau), logit-normal', x0, y0 - 2);
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', x0, baseY + fs);
    ctx.textAlign = 'right'; ctx.fillText('1', x0 + w, baseY + fs);
    /* marker */
    var tx = x0 + st.tau * w, ty = baseY - (logitNormalPdf(st.tau) / maxPdf) * (h - 16);
    var drop = phase === 'draw' ? WM.ease(Math.min(1, q / 0.7)) : 1;
    var my = WM.lerp(y0 - 6, ty, drop);
    if (drop >= 1) {
      ctx.setLineDash([2, 3]); ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, baseY); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = C.amber;
    ctx.beginPath(); ctx.arc(tx, my, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = C.text; ctx.font = v.font(fs, true); ctx.textAlign = st.tau > 0.6 ? 'right' : 'left';
    ctx.fillText('tau = ' + st.tau.toFixed(2), tx + (st.tau > 0.6 ? -8 : 8), baseY - 6);
    ctx.restore();
  }

  function drawLossBar(ctx, v, phase, q) {
    var small = v.small, fs = v.fs;
    var w = small ? Math.floor(v.W * 0.44) : 230, x0 = v.W - PADR - w, y0 = 12;
    var frac = Math.min(1, mse(vectors()) / LOSS_SCALE);
    var fill = phase === 'loss' ? WM.ease(Math.min(1, q / 0.6)) * frac : 0;
    ctx.save();
    ctx.fillStyle = C.muted; ctx.font = v.font(fs - 1); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('loss (illustrative)', x0, y0 - 2);
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 16.5, w - 1, 18);
    if (fill > 0) { ctx.fillStyle = C.red; ctx.fillRect(x0 + 1, y0 + 17, (w - 2) * fill, 17); }
    ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic';
    if (!small) {
      ctx.fillText('mean of w (u_hat - (x1 - x0))^2', x0, y0 + 48);
      ctx.fillText('w: 1 for the moving ball, 0.1 if still', x0, y0 + 48 + fs + 2);
    }
    ctx.restore();
  }

  function render() {
    if (st.cycle < 0) newCycle(0);
    var W0 = canvas.clientWidth || 900;
    var v = WM.sideView(W0, TOP, PADL, PADR);
    var fit = WM.fitCanvas(canvas, Math.round(v.bottom + 4));
    var ctx = fit.ctx, W = fit.W, fs = v.fs;
    var phase = PHASES[st.phase][0], q = WM.clamp(st.t / PHASES[st.phase][1], 0, 1);
    ctx.clearRect(0, 0, W, fit.H);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, fit.H);

    drawTauInset(ctx, v, phase, q);
    drawLossBar(ctx, v, phase, q);
    if (!v.small) {
      ctx.fillStyle = C.text; ctx.font = v.font(13, true); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('x_tau = (1 - tau) x0 + tau x1', W / 2, 14);
      ctx.fillStyle = C.muted; ctx.font = v.font(fs);
      var names = { draw: 'phase 1 of 4: draw tau', mix: 'phase 2 of 4: mix noise and truth', predict: 'phase 3 of 4: predict the direction', loss: 'phase 4 of 4: loss' };
      ctx.fillText(names[phase], W / 2, 36);
      ctx.fillText('network input: x_tau, tau, scene graph, action', W / 2, 54);
    }

    v.drawScene(ctx, S, { redStart: true });
    ctx.save();
    v.clip(ctx);                                   /* nothing below is drawn outside the plot frame */

    /* clean sample x1: the recorded path */
    ctx.save();
    ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < N; i++) { var px = v.x(X1[i][0]), pz = v.z(X1[i][1]); if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz); }
    ctx.stroke();
    ctx.fillStyle = C.red;
    for (var d = 0; d < N; d++) { ctx.beginPath(); ctx.arc(v.x(X1[d][0]), v.z(X1[d][1]), 2.2, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();

    /* noise sample x0 moving to x_tau */
    var m = phase === 'draw' ? 0 : (phase === 'mix' ? WM.ease(q) * st.tau : st.tau);
    var P = mixPoints(m);
    ctx.save();
    ctx.strokeStyle = 'rgba(184, 192, 202, 0.65)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var j = 0; j < N; j++) { var qx = v.x(P[j][0]), qz = v.z(P[j][1]); if (j === 0) ctx.moveTo(qx, qz); else ctx.lineTo(qx, qz); }
    ctx.stroke();
    ctx.fillStyle = C.dotGray;
    for (var k = 0; k < N; k++) { ctx.beginPath(); ctx.arc(v.x(P[k][0]), v.z(P[k][1]), 2.8, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();

    /* arrows and gaps */
    if (phase === 'predict' || phase === 'loss') {
      var vs = vectors(), scale = 1 - st.tau;
      for (var a = 0; a < vs.length; a++) {
        var base = P[vs[a].i];
        var showGray = phase === 'loss' || q > a / 12, showBlue = phase === 'loss' || q > 0.5 + a / 12;
        var gx = base[0] + scale * vs[a].u[0], gz = base[1] + scale * vs[a].u[1];
        var bx = base[0] + scale * vs[a].uh[0], bz = base[1] + scale * vs[a].uh[1];
        if (showGray) WM.arrow(ctx, v.x(base[0]), v.z(base[1]), v.x(gx), v.z(gz), C.dotGray, 2, 7);
        if (showBlue) WM.arrow(ctx, v.x(base[0]), v.z(base[1]), v.x(bx), v.z(bz), C.blue, 2.2, 8);
        if (phase === 'loss' && q > a / 12) {
          ctx.save();
          ctx.strokeStyle = C.red; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(v.x(gx), v.z(gz)); ctx.lineTo(v.x(bx), v.z(bz)); ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.restore();                                 /* end of the clipped region */

    /* legend, top right of the plot (empty region); the caption carries it on phones */
    if (!v.small) {
      ctx.save();
      ctx.font = v.font(fs); ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      var lx = v.right - 8, ly = v.top + 6, lh = fs + 4;
      ctx.fillStyle = C.red; ctx.fillText('red: x1, the PhysX path (61 frames)', lx, ly);
      ctx.fillStyle = C.dotGray; ctx.fillText(m === 0 ? 'gray: x0, noise' : 'gray: x_tau, noise mixed with truth', lx, ly + lh);
      if (phase === 'predict' || phase === 'loss') {
        ctx.fillStyle = C.blue; ctx.fillText('blue: u_hat (illustrative, untrained)', lx, ly + 2 * lh);
        ctx.fillStyle = C.dotGray; ctx.fillText('gray arrow: x1 - x0 (true)', lx, ly + 3 * lh);
      }
      ctx.restore();
    }

    var text = captionText(phase);
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }

  function captionText(phase) {
    var tau = st.tau.toFixed(2);
    if (phase === 'draw') return 'Phase 1 of 4, draw tau: tau = ' + tau + ' is drawn from a logit-normal distribution (bell curve, top left). Gray dots are the noise sample x0; the red path is the stored PhysX trajectory x1.';
    if (phase === 'mix') return 'Phase 2 of 4, mix: every point slides from its noise position x0 toward the truth x1 and stops at x_tau = (1 - tau) x0 + tau x1 with tau = ' + tau + '.';
    if (phase === 'predict') return 'Phase 3 of 4, predict: the network reads x_tau and outputs u_hat, the direction from noise to truth (blue arrows; illustrative, untrained network). Gray arrows are the true direction x1 - x0, drawn at the remaining length (1 - tau) so they end on the truth.';
    return 'Phase 4 of 4, loss: loss = mean of w (u_hat - (x1 - x0))^2, w = 1 for the ball (it moves). The red gaps between the arrow tips are what the loss penalises; the bar (top right) is their mean square.';
  }

  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
