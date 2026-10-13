/* Step-loop animation for variant D (canvas, uses window.WM_SAMPLE).
   The red ball advances one recorded PhysX frame per tick along its path;
   the loop diagram at the top shows state t -> network -> state t+1 and the
   arrow that feeds state t+1 back as the next input. The per-frame change
   and velocities are computed live from the recorded data. */
(function () {
  'use strict';
  var WM = window.WM, S = window.WM_SAMPLE;
  var root = document.getElementById('anim-step');
  if (!root || !WM || !S) return;
  var canvas = root.querySelector('canvas'), btn = root.querySelector('button');
  var cap = root.querySelector('.wm-caption'), live = root.querySelector('.wm-live');
  var C = WM.colors;
  var red = S.objects.o024, blue = S.objects.o025, T = S.time_s;
  var LAST = T.length - 1;                                  /* 60 */
  var TICK = 0.22, HOLD = 1.4, TOP = 108, PADL = 36, PADR = 14;

  function frameAtOrAfter(ts) { for (var i = 0; i < T.length; i++) if (T[i] >= ts - 1e-9) return i; return LAST; }
  function findEvent(a, b) {
    for (var i = 0; i < S.contact_events.length; i++) {
      var e = S.contact_events[i];
      if ((e.id_a === a && e.id_b === b) || (e.id_a === b && e.id_b === a)) return e;
    }
    return null;
  }
  var evFloor = findEvent('o024', 'o001'), evHit = findEvent('o024', 'o025');
  var fFloor = evFloor ? frameAtOrAfter(evFloor.time_s) : LAST + 1;
  var fHit = evHit ? frameAtOrAfter(evHit.time_s) : LAST + 1;

  var st = { t: 0, acc: 0 }, lastCap = null, lastLive = null;

  function advance(dt) {
    st.acc += dt;
    if (st.t >= LAST) {
      if (st.acc >= HOLD) { st.t = 0; st.acc = 0; }
      return;
    }
    while (st.acc >= TICK && st.t < LAST) { st.acc -= TICK; st.t++; }
  }
  function representative() { st.t = 20; st.acc = TICK * 0.3; }

  function drawLoop(ctx, W, small, fs) {
    var pad = small ? 6 : 14, gap = small ? 26 : 50;
    var bw = Math.min(small ? 120 : 200, (W - 2 * pad - 2 * gap) / 3), bh = 44, y = 12;
    var xs = [pad, (W - bw) / 2, W - pad - bw];
    var labels = [['state t', 't = ' + st.t + ' of ' + LAST], ['network', small ? '1/30 s step' : 'change over 1/30 s'], ['state t+1', 't+1 = ' + Math.min(LAST, st.t + 1)]];
    var strokes = [C.border, C.blue, C.border];
    ctx.save();
    ctx.font = v2font(fs); ctx.textAlign = 'center';
    for (var i = 0; i < 3; i++) {
      WM.roundRect(ctx, xs[i], y, bw, bh, 7);
      ctx.fillStyle = i === 1 ? '#e8eef9' : '#fff'; ctx.fill();
      ctx.strokeStyle = strokes[i]; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = i === 1 ? C.blue : '#222'; ctx.font = v2font(fs, true); ctx.textBaseline = 'alphabetic';
      ctx.fillText(labels[i][0], xs[i] + bw / 2, y + 18);
      ctx.fillStyle = C.text; ctx.font = v2font(fs - 1);
      ctx.fillText(labels[i][1], xs[i] + bw / 2, y + 34);
    }
    var mid = y + bh / 2;
    WM.arrow(ctx, xs[0] + bw + 2, mid, xs[1] - 2, mid, C.muted, 1.5, 7);
    WM.arrow(ctx, xs[1] + bw + 2, mid, xs[2] - 2, mid, C.muted, 1.5, 7);
    /* return path: down from state t+1, left, up into state t */
    var yb = y + bh + 16;
    var rx = xs[2] + bw / 2, lx = xs[0] + bw / 2;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(rx, y + bh); ctx.lineTo(rx, yb); ctx.lineTo(lx, yb); ctx.stroke();
    WM.arrow(ctx, lx, yb, lx, y + bh + 2, C.muted, 1.5, 7);
    ctx.fillStyle = C.muted; ctx.font = v2font(fs - 1); ctx.textBaseline = 'top';
    ctx.fillText(small ? 'feed state t+1 back as the next input (60 passes)' : 'integrate the change, then feed state t+1 back as the next input (60 passes)', W / 2, yb + 4);
    /* the pulse */
    if (st.t < LAST) {
      var p = WM.clamp(st.acc / TICK, 0, 1), px, py;
      if (p < 0.5) {
        var q = p / 0.5;
        px = WM.lerp(xs[0] + bw, xs[2], q); py = mid;
      } else {
        var q2 = (p - 0.5) / 0.5, L1 = yb - (y + bh), L2 = rx - lx, L3 = yb - (y + bh), Ltot = L1 + L2 + L3, dist = q2 * Ltot;
        if (dist < L1) { px = rx; py = y + bh + dist; }
        else if (dist < L1 + L2) { px = rx - (dist - L1); py = yb; }
        else { px = lx; py = yb - (dist - L1 - L2); }
      }
      ctx.fillStyle = C.amber; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(px, py, 10, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
  }
  function v2font(px, bold) { return (bold ? 'bold ' : '') + px + 'px "Noto Sans", sans-serif'; }

  function render() {
    var W0 = canvas.clientWidth || 900;
    var v = WM.sideView(W0, TOP, PADL, PADR);
    var fit = WM.fitCanvas(canvas, Math.round(v.bottom + 4));
    var ctx = fit.ctx, W = fit.W, fs = v.fs, s = v.s, t = st.t;
    ctx.clearRect(0, 0, W, fit.H);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, fit.H);

    drawLoop(ctx, W, v.small, fs);

    var bp = blue.position[t];
    v.drawScene(ctx, S, { bluePos: [bp[0], bp[2]], noBlueLabel: t > 0 });

    /* recorded path: remaining faint, traversed bright (clipped to the plot frame) */
    ctx.save();
    v.clip(ctx);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.faintRed; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i <= LAST; i++) { var px = v.x(red.position[i][0]), pz = v.z(red.position[i][2]); if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz); }
    ctx.stroke();
    if (t > 0) {
      ctx.strokeStyle = C.red; ctx.lineWidth = 2;
      ctx.beginPath();
      for (var j = 0; j <= t; j++) { var qx = v.x(red.position[j][0]), qz = v.z(red.position[j][2]); if (j === 0) ctx.moveTo(qx, qz); else ctx.lineTo(qx, qz); }
      ctx.stroke();
    }
    /* current state: the red ball at frame t, its velocity */
    var p = red.position[t], vel = red.linear_velocity[t];
    ctx.globalAlpha = 0.9; ctx.fillStyle = C.red;
    ctx.beginPath(); ctx.arc(v.x(p[0]), v.z(p[2]), red.radius_m * s, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 1;
    var speed = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
    if (speed > 0.05) {
      WM.arrow(ctx, v.x(p[0]), v.z(p[2]), v.x(p[0] + vel[0] * 0.08), v.z(p[2] + vel[2] * 0.08), C.red, 1.5, 6);
    }
    /* next state: hollow circle at t+1 and the one-frame change in blue */
    if (t < LAST) {
      var n = red.position[t + 1];
      ctx.strokeStyle = C.blue; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(v.x(n[0]), v.z(n[2]), red.radius_m * s, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      WM.arrow(ctx, v.x(p[0]), v.z(p[2]), v.x(n[0]), v.z(n[2]), C.blue, 2.2, 7);
    }
    ctx.restore();                                 /* end of the clipped region */

    /* labels; the legend is left to the caption on phones */
    ctx.save();
    ctx.font = v.font(fs); ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    var lx = v.right - 8, ly = v.top + 6, lh = fs + 4;
    if (!v.small) {
      ctx.fillStyle = C.red; ctx.fillText('red: state t (velocity arrow = 0.08 s of motion)', lx, ly);
      ctx.fillStyle = C.blue; ctx.fillText('blue: change to state t+1 (the network\'s output)', lx, ly + lh);
      ctx.fillStyle = C.muted; ctx.fillText('faint red: the rest of the recorded PhysX path', lx, ly + 2 * lh);
    }
    ctx.fillStyle = C.text; ctx.font = v.font(fs + 4, true); ctx.textAlign = 'left';
    ctx.fillText('t = ' + t, v.left + 8, v.top + 6 + fs + 6);
    ctx.restore();

    /* live line and caption */
    var liveText;
    if (t < LAST) {
      var n2 = red.position[t + 1], v2 = red.linear_velocity[t + 1];
      liveText = 'frame ' + t + ' -> ' + (t + 1) + ': moves by (' + (n2[0] - p[0]).toFixed(3) + ', ' + (n2[2] - p[2]).toFixed(3) +
        ') m; velocity (' + vel[0].toFixed(2) + ', ' + vel[2].toFixed(2) + ') -> (' + v2[0].toFixed(2) + ', ' + v2[2].toFixed(2) + ') m/s';
    } else {
      liveText = 'frame 60 of 60: end of the ' + S.horizon_s + ' s horizon; the loop restarts from frame 0.';
    }
    if (liveText !== lastLive) { live.textContent = liveText; lastLive = liveText; }
    var capText;
    if (t < fFloor) capText = 'Frames 0 to ' + (fFloor - 1) + ': the red ball is in flight; each tick is one 1/30 s step of the recorded PhysX path, the step a single network pass would have to predict.';
    else if (t < fHit) capText = 'Frame ' + fFloor + ' onwards: the red ball has landed (first floor contact at ' + evFloor.time_s.toFixed(2) + ' s) and rolls toward the blue ball.';
    else capText = 'Frame ' + fHit + ' onwards: after the hit at ' + evHit.time_s.toFixed(2) + ' s both balls roll; the network would have had to predict each of these 60 changes in turn, feeding its own output back.';
    if (capText !== lastCap) { cap.textContent = capText; lastCap = capText; }
  }

  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
