/* Diffusion Forcing strip (SVG built here): 60 squares, one per frame, whose
   opacity encodes the noise level. Training: a random level per frame.
   Sampling: a denoising wavefront sweeps left to right until every frame is
   clean. Alternate cycles start with a known 15-frame prefix at noise zero. */
(function () {
  'use strict';
  var WM = window.WM;
  var root = document.getElementById('anim-forcing');
  if (!root || !WM) return;
  var svg = root.querySelector('svg'), btn = root.querySelector('button'), cap = root.querySelector('.wm-caption');
  var C = WM.colors, NS = 'http://www.w3.org/2000/svg';
  var NF = 60, CELL = 12, PITCH = 15, X0 = 5, Y0 = 24, PREFIX = 15, RAMP = 12;

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    svg.appendChild(e);
    return e;
  }
  svg.setAttribute('viewBox', '0 0 910 86');
  el('text', { x: X0, y: 14, 'font-size': 11, fill: C.muted, 'font-family': '"Noto Sans", sans-serif' }, 'noise level per frame: faint = fully noisy, solid = clean');
  var rects = [];
  for (var i = 0; i < NF; i++) {
    rects.push(el('rect', { x: X0 + i * PITCH, y: Y0, width: CELL, height: CELL, rx: 2, fill: C.blue, stroke: C.border, 'stroke-width': 1 }));
  }
  el('text', { x: X0, y: Y0 + CELL + 14, 'font-size': 11, fill: C.muted, 'font-family': '"Noto Sans", sans-serif' }, 'frame 1');
  el('text', { x: X0 + (NF - 1) * PITCH + CELL, y: Y0 + CELL + 14, 'font-size': 11, fill: C.muted, 'text-anchor': 'end', 'font-family': '"Noto Sans", sans-serif' }, 'frame 60');
  var bracket = el('path', { d: 'M' + X0 + ',' + (Y0 + CELL + 20) + ' v5 H' + (X0 + PREFIX * PITCH - 3) + ' v-5', fill: 'none', stroke: C.amber, 'stroke-width': 1.5, visibility: 'hidden' });
  var bracketText = el('text', { x: X0, y: Y0 + CELL + 38, 'font-size': 11, fill: C.text, 'text-anchor': 'start', visibility: 'hidden', 'font-family': '"Noto Sans", sans-serif' }, 'known prefix, frames 1 to ' + PREFIX + ' (noise level zero)');
  var frontText = el('text', { x: X0 + (NF - 1) * PITCH + CELL, y: Y0 + CELL + 38, 'font-size': 11, fill: C.muted, 'text-anchor': 'end', 'font-family': '"Noto Sans", sans-serif' }, '');

  var PHASES = [['train', 2.6], ['sweep', 3.6], ['clean', 1.6]];
  var st = { cycle: -1, phase: 0, t: 0, prefix: 0, drawIdx: -1, levels: [] }, lastCap = null;

  function newCycle(c) {
    st.cycle = c; st.prefix = c % 2 === 1 ? PREFIX : 0;
    st.phase = 0; st.t = 0; st.drawIdx = -1;
    st.levels = [];
    for (var i = 0; i < NF; i++) st.levels.push(1);
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
  function representative() { newCycle(0); st.phase = 1; st.t = PHASES[1][1] * 0.5; }

  function computeLevels(phase, q) {
    var i;
    if (phase === 'train') {
      var idx = Math.min(2, Math.floor(q * 3));
      if (idx !== st.drawIdx) {
        var r = WM.rng(77 + st.cycle * 10 + idx);
        for (i = 0; i < NF; i++) st.levels[i] = i < st.prefix ? 0 : r();
        st.drawIdx = idx;
      }
    } else if (phase === 'sweep') {
      var f = st.prefix + (NF - st.prefix + RAMP) * WM.ease(q);
      for (i = 0; i < NF; i++) st.levels[i] = i < st.prefix ? 0 : WM.clamp((i - (f - RAMP)) / RAMP, 0, 1);
    } else {
      for (i = 0; i < NF; i++) st.levels[i] = 0;
    }
  }
  function render() {
    if (st.cycle < 0) newCycle(0);
    var phase = PHASES[st.phase][0], q = WM.clamp(st.t / PHASES[st.phase][1], 0, 1);
    computeLevels(phase, q);
    for (var i = 0; i < NF; i++) {
      rects[i].setAttribute('fill-opacity', (0.1 + 0.9 * (1 - st.levels[i])).toFixed(3));
    }
    var vis = st.prefix > 0 ? 'visible' : 'hidden';
    bracket.setAttribute('visibility', vis); bracketText.setAttribute('visibility', vis);
    var clean = 0;
    for (var j = 0; j < NF; j++) if (st.levels[j] < 0.02) clean++;
    frontText.textContent = phase === 'train' ? 'training: independent noise levels' : (clean + ' of 60 frames clean');
    var text;
    if (phase === 'train') {
      text = st.prefix ? 'Training: every frame draws its own noise level, independently; here frames 1 to 15 are a known prefix held at noise level zero.'
        : 'Training: every frame draws its own noise level, independently, so the network learns to complete a trajectory from any mixture of clean and noisy frames.';
    } else if (phase === 'sweep') {
      text = st.prefix ? 'Sampling with a known prefix: frames 1 to 15 stay clamped and the denoising wavefront continues from frame 16.'
        : 'Sampling: frames are denoised in order, early frames ahead of late ones; later frames are still being refined while earlier ones are already clean.';
    } else {
      text = 'All 60 frames clean. Sliding the window forward lets a rollout extend past 60 frames.';
    }
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }

  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
