/* One model, both directions (canvas). A toy scene: a red crate is thrown along x, bounces, slides and hits a
   resting blue crate of known mass (1 kg). Its hidden properties are P = (e bounciness, mu floor friction, m red
   crate mass). The same masked model answers four questions, each animated as what it generates:
     1 forward: P and the action given, the motion is generated, then played;
     2 backward: the whole motion given as a recording (it never moves), P is generated, then the evidence in the
       recording is pointed out;
     3 both at once: the first 0.9 s given, P and the rest of the motion are generated together and the continuations
       fan out;
     4 backwards in time: only the last 0.3 s given, P and the 2.7 s before are generated together, the chunks cleaned
       from the end backwards (Diffusion Forcing order), and the histories are played in reverse.
   The family switch shows how regression, flow matching and diffusion reach their answers.
   Trajectories come from a closed-form model of the toy (parabolic flights; a landing keeps a fraction e of the
   vertical speed and loses mu (1 + e) times it horizontally; sliding slows at mu g; a 1-D collision). Samples are
   drawn from the exact posterior of the toy on a grid (tracked centres, 3 cm noise), which is what a perfect model of
   either generative family would return; regression returns that posterior's mean. Nothing here is a trained
   model's output. The grid (20,196 property values) is computed when the block is first shown. */
(function () {
  'use strict';
  var WM = window.WM;
  var root = document.getElementById('anim-bidirectional');
  if (!root || !WM) return;
  var canvas = root.querySelector('canvas'), btn = root.querySelector('button'), cap = root.querySelector('.wm-caption');
  var controls = root.querySelector('.wm-controls');
  var C = WM.colors, AMBER = '#e08e0b', GRAY = '#9aa3ad', INK = '#333';

  /* ---------- the toy scene ---------- */
  var G = 9.81, HR = 0.1, HB = 0.12, MB = 1.0, X0 = 0.25, Z0 = 0.3, XB0 = 3.2, VX = 3.2, VZ = 1.2, VSETTLE = 0.25;
  var FPS = 30, NF = 91, CHUNK = 9, NCH = 10, PREFIX = 27, END = NF - CHUNK, SIG = 0.03;
  var TRUTH = { e: 0.55, mu: 0.18, m: 2.0 };
  var NE = 33, NMU = 36, NLM = 17, DE = 0.025, DMU = 0.02, DLM = 0.25;    /* grid: e 0.05..0.85, mu 0.10..0.80, log2 m -2..2 */
  var PROPS = [
    { key: 'e', name: 'e', label: 'bounciness', lo: 0.05, hi: 0.85, ticks: [0.2, 0.4, 0.6, 0.8] },
    { key: 'mu', name: 'μ', label: 'floor friction', lo: 0.10, hi: 0.80, ticks: [0.2, 0.4, 0.6, 0.8] },
    { key: 'lm', name: 'm', label: 'red crate mass (kg)', lo: -2, hi: 2, ticks: [-2, -1, 0, 1, 2] }];
  var NPART = 40, NSHOW = 16, NSTEP = 50, TMAX = (NF - 1) / FPS;

  function sim(p) {
    var e = p.e, mu = p.mu, m = p.m, face = XB0 - HB - HR, T = TMAX + 1e-9;
    var x = X0, z = Z0, vx = VX, vz = VZ, t = 0, air = true, segs = [], hitT = -1, vb = 0, guard = 0, s, kind;
    while (t < T && guard++ < 100) {
      if (air) {                                             /* flight until landing (z = HR) or the blue crate's face */
        s = (vz + Math.sqrt(vz * vz + 2 * G * (z - HR))) / G; kind = 'land';
        if (hitT < 0 && vx > 0 && x < face && (face - x) / vx < s) { s = (face - x) / vx; kind = 'hit'; }
        segs.push([t, x, z, vx, vz, 0, 1]);
        var s1 = Math.min(s, T - t);
        x += vx * s1; z += vz * s1 - 0.5 * G * s1 * s1; vz -= G * s1; t += s1;
        if (s1 < s) break;
        if (kind === 'land') {
          var vin = -vz, dv = mu * (1 + e) * vin;
          z = HR; vx = vx > 0 ? Math.max(0, vx - dv) : Math.min(0, vx + dv);
          if (e * vin < VSETTLE) { vz = 0; air = false; } else vz = e * vin;
        }
      } else {                                               /* sliding until it stops or reaches the blue crate */
        if (vx === 0) { segs.push([t, x, z, 0, 0, 0, 0]); break; }
        var dec = vx > 0 ? -mu * G : mu * G;
        s = Math.abs(vx) / (mu * G); kind = 'stop';
        if (hitT < 0 && vx > 0 && x < face) {
          var d2 = vx * vx + 2 * dec * (face - x);
          if (d2 >= 0) { var sh = (-vx + Math.sqrt(d2)) / dec; if (sh > 0 && sh < s) { s = sh; kind = 'hit'; } }
        }
        segs.push([t, x, z, vx, 0, dec, 0]);
        var s2 = Math.min(s, T - t);
        x += vx * s2 + 0.5 * dec * s2 * s2; vx += dec * s2; t += s2;
        if (s2 < s) break;
        if (kind === 'stop') vx = 0;
      }
      if (kind === 'hit') { hitT = t; vb = m * (1 + e) * vx / (m + MB); vx = (m - MB * e) * vx / (m + MB); }
    }
    segs.push([Infinity]);
    var out = { x: new Float64Array(NF), z: new Float64Array(NF), b: new Float64Array(NF), hit: hitT }, k = 0;
    for (var f = 0; f < NF; f++) {
      var tf = f / FPS;
      while (segs[k + 1][0] <= tf) k++;
      var g = segs[k], u = tf - g[0];
      if (g[6]) { out.x[f] = g[1] + g[3] * u; out.z[f] = g[2] + g[4] * u - 0.5 * G * u * u; }
      else {
        var um = g[5] !== 0 ? Math.min(u, Math.abs(g[3] / g[5])) : 0;
        out.x[f] = g[1] + g[3] * um + 0.5 * g[5] * um * um; out.z[f] = HR;
      }
      var ub = hitT >= 0 && tf > hitT ? Math.min(tf - hitT, vb / (mu * G)) : 0;
      out.b[f] = XB0 + vb * ub - 0.5 * mu * G * ub * ub;
    }
    return out;
  }
  function params(q) { return { e: q.e, mu: q.mu, m: Math.pow(2, q.lm) }; }
  function bounces(tr) {                                     /* apexes after the throw's own arc */
    var n = 0;
    for (var f = 1; f < NF - 1; f++) if (tr.z[f] > tr.z[f - 1] && tr.z[f] >= tr.z[f + 1] && tr.z[f] > HR + 0.01) n++;
    return Math.max(0, n - 1);
  }

  /* deterministic noise with mean 0 and spread 1 (a centred sum of three uniforms), from two integers */
  function hnoise(a, b) {
    var h = (Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)) >>> 0, s = 0;
    for (var r = 0; r < 3; r++) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; h = (h ^ (h >>> 16)) >>> 0; s += h / 4294967296; }
    return (s - 1.5) * 2;
  }

  /* ---------- the exact posterior of the toy on the grid, given the whole motion, its first 0.9 s, or its last 0.3 s ---------- */
  var P = null;
  function prepare() {
    if (P) return P;
    var obs = sim(TRUTH), n = NE * NMU * NLM, cells = [], c = 0;
    var ll = { all: new Float64Array(n), pre: new Float64Array(n), end: new Float64Array(n) };
    for (var i = 0; i < NE; i++) for (var j = 0; j < NMU; j++) for (var k = 0; k < NLM; k++, c++) {
      var q = { e: 0.05 + DE * i, mu: 0.10 + DMU * j, lm: -2 + DLM * k }, s = sim(params(q)), acc = 0, accEnd = 0;
      cells.push(q);
      for (var f = 1; f < NF; f++) {
        var dx = s.x[f] - obs.x[f], dz = s.z[f] - obs.z[f], db = s.b[f] - obs.b[f], d = dx * dx + dz * dz + db * db;
        acc += d;
        if (f === PREFIX) ll.pre[c] = -acc / (2 * SIG * SIG);
        if (f >= END) accEnd += d;
      }
      ll.all[c] = -acc / (2 * SIG * SIG); ll.end[c] = -accEnd / (2 * SIG * SIG);
    }
    function posterior(l) {
      var mx = -Infinity, z = 0, w = new Float64Array(n), r, mean = { e: 0, mu: 0, lm: 0 };
      for (r = 0; r < n; r++) if (l[r] > mx) mx = l[r];
      for (r = 0; r < n; r++) { w[r] = Math.exp(l[r] - mx); z += w[r]; }
      for (r = 0; r < n; r++) { w[r] /= z; mean.e += w[r] * cells[r].e; mean.mu += w[r] * cells[r].mu; mean.lm += w[r] * cells[r].lm; }
      return { w: w, mean: mean };
    }
    /* regression's answer for the motion: the posterior mean of the trajectory, not the trajectory of the mean properties */
    function meanTrack(w) {
      var mt = { x: new Float64Array(NF), z: new Float64Array(NF), b: new Float64Array(NF) };
      for (var r = 0; r < n; r++) {
        if (w[r] < 1e-7) continue;
        var tr = sim(params(cells[r]));
        for (var f = 0; f < NF; f++) { mt.x[f] += w[r] * tr.x[f]; mt.z[f] += w[r] * tr.z[f]; mt.b[f] += w[r] * tr.b[f]; }
      }
      return mt;
    }
    P = { obs: obs, cells: cells, all: posterior(ll.all), pre: posterior(ll.pre), end: posterior(ll.end), cycle: -1 };
    P.pre.meanTrack = meanTrack(P.pre.w); P.end.meanTrack = meanTrack(P.end.w);
    P.evidence = evidence(obs);
    return P;
  }
  /* what in the recorded motion carries each property: the apexes (e), the slide into the hit (mu), the push (m) */
  function evidence(obs) {
    var apex = [], land = [], f, hitF = obs.hit >= 0 ? Math.round(obs.hit * FPS) : NF - 1, slideFrom = 0;
    for (f = 1; f < NF - 1; f++) {
      if (obs.z[f] > obs.z[f - 1] && obs.z[f] >= obs.z[f + 1] && obs.z[f] > HR + 0.01) apex.push(f);
      if (obs.z[f - 1] > HR + 1e-6 && obs.z[f] <= HR + 1e-6 && f < hitF) { land.push(f); slideFrom = f; }
    }
    return { apex: apex, land: land, hitF: hitF, slideFrom: slideFrom };
  }

  /* samples for one loop of the animation: systematic resampling of the grid posterior, jittered within a cell */
  function draw(post, seed) {
    var rand = WM.rng(seed), u0 = rand() / NPART, out = [], acc = 0, r = 0;
    for (var p = 0; p < NPART; p++) {
      var target = u0 + p / NPART;
      while (r < post.w.length - 1 && acc + post.w[r] < target) { acc += post.w[r]; r++; }
      var q = P.cells[r];
      out.push({ cell: r, e: WM.clamp(q.e + (rand() - 0.5) * DE, 0.05, 0.85), mu: WM.clamp(q.mu + (rand() - 0.5) * DMU, 0.10, 0.80),
                 lm: WM.clamp(q.lm + (rand() - 0.5) * DLM, -2, 2) });
    }
    for (var k = out.length - 1; k > 0; k--) { var j = Math.floor(rand() * (k + 1)), tmp = out[k]; out[k] = out[j]; out[j] = tmp; }
    return out;
  }
  /* the histories drawn on the scene: up to NSHOW samples from distinct grid cells, so that a peaked posterior does
     not draw the same history sixteen times */
  function distinct(samples) {
    var seen = {}, out = [];
    for (var i = 0; i < samples.length && out.length < NSHOW; i++) {
      if (seen[samples[i].cell]) continue;
      seen[samples[i].cell] = true; out.push(samples[i]);
    }
    return out;
  }
  function ensureCycle() {
    if (P.cycle === st.cycle) return;
    P.cycle = st.cycle;
    P.all.samples = draw(P.all, 900 + st.cycle);
    ['pre', 'end'].forEach(function (key, n) {
      var post = P[key];
      post.samples = draw(post, 700 + 100 * n + st.cycle);
      post.shown = distinct(post.samples);
      post.tracks = post.shown.map(function (q) { return sim(params(q)); });
      var ends = post.samples.map(function (q) { return sim(params(q)).b[NF - 1] - XB0; }).sort(function (a, b) { return a - b; });
      post.slideLo = ends[Math.floor(0.05 * (ends.length - 1))]; post.slideHi = ends[Math.ceil(0.95 * (ends.length - 1))];
      var lo = { e: Infinity, mu: Infinity, lm: Infinity }, hi = { e: -Infinity, mu: -Infinity, lm: -Infinity };
      post.samples.forEach(function (q) { ['e', 'mu', 'lm'].forEach(function (k) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }); });
      post.lo = lo; post.hi = hi;
      var bl = Infinity, bh = -Infinity;
      post.tracks.forEach(function (tr) { var nb = bounces(tr); bl = Math.min(bl, nb); bh = Math.max(bh, nb); });
      post.bouncesLo = bl; post.bouncesHi = bh;
    });
  }

  /* ---------- timeline ---------- */
  var MODES = [
    { key: 'forward', title: '1. Forward', hidP: false, post: null, hidden: function (f) { return f >= 1; } },
    { key: 'backward', title: '2. Backward', hidP: true, post: 'all', hidden: function () { return false; } },
    { key: 'both', title: '3. Infer and continue', hidP: true, post: 'pre', hidden: function (f) { return f > PREFIX; } },
    { key: 'reverse', title: '4. Backwards in time', hidP: true, post: 'end', hidden: function (f) { return f >= 1 && f < END; } }];
  var FAMILIES = [{ key: 'reg', title: 'Regression' }, { key: 'flow', title: 'Flow matching' }, { key: 'diff', title: 'Diffusion' }];
  var PHASES = ['mask', 'denoise', 'play', 'hold'];
  var family = 1, st = { cycle: 0, mode: 0, phase: 0, t: 0 }, lastCap = null, modeChips = [], famChips = [];

  function dur(ph) { return [2.8, FAMILIES[family].key === 'reg' ? 1.6 : 5.0, 4.4, 4.0][ph]; }
  function advance(dt) {
    st.t += dt;
    while (st.t >= dur(st.phase)) {
      st.t -= dur(st.phase);
      st.phase++;
      if (st.phase >= PHASES.length) {
        st.phase = 0; st.mode++;
        if (st.mode >= MODES.length) { st.mode = 0; st.cycle++; }
      }
    }
  }
  function representative() { st.cycle = 0; st.mode = 3; st.phase = 2; st.t = 0.2 + (dur(2) - 0.6) * 0.75; }   /* t = 0.75 s, among the bounces */
  function goTo(mode, phase) {
    if (phase >= PHASES.length) { phase = 0; mode++; }
    if (phase < 0) { mode--; phase = PHASES.length - 1; }
    if (mode >= MODES.length) { mode = 0; st.cycle++; }
    if (mode < 0) mode = MODES.length - 1;
    st.mode = mode; st.phase = phase; st.t = 0;
    render();
  }

  /* noise level of the hidden tokens, and the sampler step it corresponds to */
  function noiseLevel() {
    var ph = PHASES[st.phase];
    if (ph === 'mask') return { sigma: 1, step: 0 };
    if (ph !== 'denoise') return { sigma: 0, step: NSTEP };
    if (FAMILIES[family].key === 'reg') return st.t < 0.35 ? { sigma: 1, step: 0 } : { sigma: 0, step: 1 };
    var q = WM.clamp(st.t / (dur(1) - 0.6), 0, 1), k = Math.min(NSTEP, Math.floor(q * NSTEP + 1e-9));
    return { sigma: 1 - k / NSTEP, step: k };
  }
  function chunkOf(f) { return f < 1 ? 0 : Math.min(NCH - 1, Math.floor((f - 1) / CHUNK)); }
  /* one level for every hidden chunk, except backwards in time with a generative family: Diffusion Forcing's per-chunk
     levels clean the chunk just before the end first and earlier chunks after it */
  function sigmaChunk(k, nl) {
    if (MODES[st.mode].key !== 'reverse' || FAMILIES[family].key === 'reg') return nl.sigma;
    var q = 1 - nl.sigma, R = 3;
    return WM.clamp(1 - (q * (NCH - 1 + R) - (NCH - 2 - k)) / R, 0, 1);
  }
  function sigmaFrame(f, nl) { return MODES[st.mode].hidden(f) ? sigmaChunk(chunkOf(f), nl) : 0; }
  function playTime() {                                     /* seconds of simulated motion shown */
    var key = MODES[st.mode].key, ph = PHASES[st.phase];
    var q = ph === 'play' ? WM.clamp((st.t - 0.2) / (dur(2) - 0.6), 0, 1) : (ph === 'hold' ? 1 : 0);
    if (key === 'forward') return q * TMAX;
    if (key === 'both') return PREFIX / FPS + q * (TMAX - PREFIX / FPS);
    if (key === 'reverse') return (1 - q) * TMAX;
    return TMAX;                                            /* backward: the whole recording is given */
  }
  /* where a generated value sits at noise level sigma: on the straight line from its noise (flow), with fresh noise
     added at every step (diffusion), or at once (regression) */
  function along(target, noise, sigma, step, id, amp) {
    var v = (1 - sigma) * target + sigma * noise;
    if (FAMILIES[family].key === 'diff' && sigma > 0 && sigma < 1) v += amp * Math.sqrt(sigma * (1 - sigma)) * hnoise(id, 3000 + step);
    return v;
  }

  /* ---------- layout ---------- */
  var XMIN = -0.05, XMAX = 4.45, ZTOP = 0.62;
  function layout(W) {
    var L = { W: W, wide: W >= 600 };
    L.fs = L.wide ? 12 : 10.5;
    L.tok = L.wide ? 25 : Math.max(12, Math.floor((W - 16 - 13 * 3 - 3 * 8) / 17));
    L.tgap = L.wide ? 4 : 3; L.ggap = L.wide ? 20 : 8;
    var tw = 17 * L.tok + 13 * L.tgap + 3 * L.ggap;
    L.tx = L.wide ? Math.max(118, (W - tw) / 2) : (W - tw) / 2;
    L.ty = L.wide ? 30 : 26;
    L.meterY = L.ty + L.tok + 26;
    L.s = (W - (L.wide ? 52 : 34)) / (XMAX - XMIN);
    L.sx0 = L.wide ? 40 : 26;
    L.sceneTop = L.meterY + (L.wide ? 14 : 22);
    L.floorY = L.sceneTop + ZTOP * L.s;
    L.propTop = L.floorY + (L.wide ? 40 : 34);
    L.propH = L.wide ? 104 : 84;
    L.H = Math.round(L.propTop + (L.wide ? L.propH : 3 * L.propH) + 6);
    return L;
  }
  function font(px, bold) { return (bold ? 'bold ' : '') + px + 'px "Noto Sans", sans-serif'; }
  function sx(L, x) { return L.sx0 + (x - XMIN) * L.s; }
  function sz(L, z) { return L.floorY - z * L.s; }
  function lerpColor(a, b, q) {
    function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
    var A = hex(a), B = hex(b);
    return 'rgb(' + A.map(function (v, i) { return Math.round(v + (B[i] - v) * q); }).join(',') + ')';
  }

  /* ---------- token strip ---------- */
  function drawTokens(ctx, L, mode, nl) {
    var T = L.tok, x = L.tx, y = L.ty, id = 0, post = mode.post ? P[mode.post] : null;
    var gen = post && post.tracks ? (FAMILIES[family].key === 'reg' ? post.meanTrack : post.tracks[0]) : P.obs;   /* what a hidden chunk shows once clean */
    var groups = [['scene G∖P', 3], ['properties P', 3], ['action a', 1], [L.wide ? 'motion Y (10 × 0.3 s)' : 'motion Y', 10]];
    var zmax = 0;
    for (var f0 = 0; f0 < NF; f0++) zmax = Math.max(zmax, P.obs.z[f0] - HR);
    ctx.save();
    ctx.font = font(L.wide ? 11.5 : 9.5, true); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.muted;
    groups.forEach(function (g, gi) {
      var w = g[1] * T + (g[1] - 1) * L.tgap;
      ctx.fillText(L.wide || gi !== 2 ? g[0] : 'a', x + w / 2, y - 8);
      for (var k = 0; k < g[1]; k++) {
        var tx = x + k * (T + L.tgap), hidden = (gi === 1 && mode.hidP) || (gi === 3 && mode.hidden(k * CHUNK + 1));
        var sig = hidden ? (gi === 3 ? sigmaChunk(k, nl) : nl.sigma) : 0, track = hidden ? gen : P.obs;
        var fill = ['#eef1f4', '#fff3d6', '#fdecee', '#e8eef9'][gi], stroke = [C.border, C.amber, C.red, C.blue][gi];
        WM.roundRect(ctx, tx, y, T, T, 3);
        ctx.fillStyle = fill; ctx.fill();
        ctx.globalAlpha = 1 - 0.85 * sig;                     /* the token's content fades in as its noise goes */
        if (gi === 0) {
          if (k === 0) { ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx + 4, y + T * 0.68); ctx.lineTo(tx + T - 4, y + T * 0.68); ctx.stroke(); }
          else { ctx.fillStyle = k === 1 ? C.red : C.ballBlue; ctx.fillRect(tx + T * 0.25, y + T * 0.25, T * 0.5, T * 0.5); }
        } else if (gi === 3) {
          ctx.strokeStyle = C.blue; ctx.lineWidth = 1.5; ctx.beginPath();
          for (var f = k * CHUNK; f <= k * CHUNK + CHUNK; f++) {
            var px = tx + 3 + (T - 6) * (f - k * CHUNK) / CHUNK, py = y + T - 4 - (T - 8) * WM.clamp((track.z[Math.min(f, NF - 1)] - HR) / zmax, 0, 1);
            if (f === k * CHUNK) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        } else {
          ctx.fillStyle = INK; ctx.font = font(L.wide ? 13 : 10, true); ctx.textBaseline = 'middle';
          ctx.fillText(gi === 2 ? 'a' : PROPS[k].name, tx + T / 2, y + T / 2 + 1);
          ctx.textBaseline = 'alphabetic'; ctx.font = font(L.wide ? 11.5 : 9.5, true); ctx.fillStyle = C.muted;
        }
        ctx.globalAlpha = 1;
        if (sig > 0) {                                        /* speckle: the noise still in the token */
          var n = 5, c = T / n;
          for (var a = 0; a < n * n; a++) {
            var v = 0.5 + 0.5 * hnoise(id * 31 + a, st.cycle * 7 + nl.step);
            ctx.fillStyle = 'rgba(' + Math.round(110 + 140 * v) + ',' + Math.round(118 + 136 * v) + ',' + Math.round(130 + 125 * v) + ',' + sig.toFixed(3) + ')';
            ctx.fillRect(tx + (a % n) * c, y + Math.floor(a / n) * c, c + 0.3, c + 0.3);
          }
        }
        WM.roundRect(ctx, tx, y, T, T, 3);
        ctx.strokeStyle = hidden ? C.muted : stroke; ctx.lineWidth = 1.3;
        ctx.setLineDash(hidden ? [3, 2] : []); ctx.stroke(); ctx.setLineDash([]);
        /* the mask bit under the token: filled = hidden */
        var bs = L.wide ? 7 : 5, bx = tx + T / 2 - bs / 2, by = y + T + 5;
        if (hidden) { ctx.fillStyle = INK; ctx.fillRect(bx, by, bs, bs); }
        else { ctx.strokeStyle = GRAY; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1); }
        id++;
      }
      x += w + L.ggap;
    });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.muted; ctx.font = font(L.wide ? 11 : 9);
    if (L.wide) {
      ctx.fillText('mask m', L.tx - 10, y + T + 9);
      ctx.font = font(11.5, true); ctx.fillStyle = C.blue;
      ctx.fillText('one network vθ', L.tx - 10, y + T / 2 - 7);
      ctx.font = font(11); ctx.fillStyle = C.muted;
      ctx.fillText('reads every token', L.tx - 10, y + T / 2 + 8);
    }
    /* noise meter */
    var fam = FAMILIES[family].key, mText, reverse = mode.key === 'reverse' && fam !== 'reg';
    if (fam === 'reg') mText = L.wide ? (nl.sigma > 0 ? 'regression: no noise, one pass' : 'regression: one pass, done') : 'one pass';
    else if (L.wide) mText = (reverse ? 'chunks cleaned from the end, ' : 'noise level ') + 'σ = ' + nl.sigma.toFixed(2) + (fam === 'flow' ? '   Euler step ' : '   sampler step ') + nl.step + ' of ' + NSTEP;
    else mText = 'σ = ' + nl.sigma.toFixed(2) + ', step ' + nl.step + '/' + NSTEP;
    var mw = L.wide ? 170 : Math.min(150, L.W * 0.4), mx = L.W - mw - (L.wide ? 8 : 4), my = L.meterY;
    ctx.fillStyle = '#eef1f4'; ctx.fillRect(mx, my - 3, mw, 6);
    ctx.fillStyle = fam === 'reg' ? C.slate : C.blue; ctx.fillRect(mx, my - 3, mw * nl.sigma, 6);
    ctx.textAlign = 'right'; ctx.fillStyle = C.text; ctx.font = font(L.wide ? 11.5 : 9.5);
    ctx.fillText(mText, mx - 8, my);
    ctx.restore();
  }

  /* ---------- the scene, side view ---------- */
  function crate(ctx, L, x, z, h, color, style) {
    var x0 = sx(L, x - h), y0 = sz(L, z + h), w = 2 * h * L.s;
    ctx.save();
    if (style === 'ghost') {
      ctx.fillStyle = color; ctx.globalAlpha = 0.07; ctx.fillRect(x0, y0, w, w);
      ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.1; ctx.strokeRect(x0, y0, w, w);
    } else if (style === 'strobe') { ctx.strokeStyle = color; ctx.globalAlpha = 0.28; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, w); }
    else if (style === 'truth' || style === 'start') {
      ctx.strokeStyle = style === 'truth' ? INK : color; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.strokeRect(x0, y0, w, w);
    } else { ctx.fillStyle = color; ctx.fillRect(x0, y0, w, w); }
    ctx.restore();
  }
  function frameAt(tr, t) {                                 /* linear interpolation between recorded frames */
    var f = WM.clamp(t * FPS, 0, NF - 1), i = Math.min(NF - 2, Math.floor(f)), q = f - i;
    return { x: WM.lerp(tr.x[i], tr.x[i + 1], q), z: WM.lerp(tr.z[i], tr.z[i + 1], q), b: WM.lerp(tr.b[i], tr.b[i + 1], q) };
  }
  function label(ctx, L, text, x, y, color, align) {
    ctx.save(); ctx.font = font(L.fs, true); ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
  }
  function dots(ctx, L, tr, frames, sIdx, nl, given) {
    var r = L.wide ? 2.4 : 1.8;
    for (var o = 0; o < 2; o++) {
      var col = o === 0 ? C.red : C.ballBlue, solid = o === 0 ? '#d7263d' : '#4a6fa5';
      for (var n = 0; n < frames.length; n++) {
        var f = frames[n], tx = o === 0 ? tr.x[f] : tr.b[f], tz = o === 0 ? tr.z[f] : HB, x = tx, z = tz, sig = given ? 0 : sigmaFrame(f, nl);
        if (!given) {
          var id = ((st.cycle * NSHOW + sIdx) * 2 + o) * NF + f;
          var nx = WM.clamp(2.2 + 1.15 * hnoise(id, 11), 0, 4.4), nz = WM.clamp(0.3 + 0.16 * hnoise(id, 12), 0.02, 0.6);
          x = along(tx, nx, sig, nl.step, id * 2, 0.9); z = WM.clamp(along(tz, nz, sig, nl.step, id * 2 + 1, 0.3), 0, ZTOP);
        }
        ctx.beginPath(); ctx.arc(sx(L, x), sz(L, z), r, 0, 2 * Math.PI);
        if (given) { ctx.fillStyle = col; ctx.fill(); }
        else if (sig > 0) { ctx.fillStyle = lerpColor(GRAY, solid, Math.pow(1 - sig, 2)); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; }
        else { ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke(); }
      }
    }
  }
  function strobe(ctx, L, O) {                              /* the recording: faint outlines of the crates along the given motion */
    for (var f = 0; f < NF; f += 5) {
      if (f > P.evidence.hitF && Math.abs(O.x[f] - O.x[NF - 1]) < 0.01) break;
      crate(ctx, L, O.x[f], O.z[f], HR, C.red, 'strobe');
    }
    for (var g = P.evidence.hitF + 4; g < NF; g += 6) {
      if (Math.abs(O.b[g] - O.b[NF - 1]) < 0.01) break;
      crate(ctx, L, O.b[g], HB, HB, C.ballBlue, 'strobe');
    }
  }
  function cut(ctx, L, x, text, side) {                     /* the border between given and hidden frames */
    var cx = sx(L, x);
    ctx.save(); ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, L.sceneTop + 8); ctx.lineTo(cx, L.floorY); ctx.stroke(); ctx.restore();
    label(ctx, L, text, side === 'right' ? cx - 4 : cx + 4, L.sceneTop + 14, C.muted, side);
  }
  function drawEvidence(ctx, L, step) {                     /* step 0 apexes (e), 1 the slide (mu), 2 the push (m); 3 = all */
    var E = P.evidence, O = P.obs;
    ctx.save(); ctx.strokeStyle = AMBER; ctx.lineWidth = 1.6;
    if (step === 0 || step === 3) {
      E.apex.forEach(function (f) {
        var x = sx(L, O.x[f]), ya = sz(L, O.z[f]) - 4;
        ctx.beginPath(); ctx.moveTo(x, sz(L, HR)); ctx.lineTo(x, ya); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 4, ya); ctx.lineTo(x + 4, ya); ctx.stroke();
      });
      var a1 = E.apex[Math.min(1, E.apex.length - 1)];
      if (a1 !== undefined) label(ctx, L, L.wide ? 'bounce heights → e' : '→ e', sx(L, O.x[a1]) + 8, sz(L, O.z[a1]) - 10, AMBER, 'left');
    }
    if (step === 1 || step === 3) {
      var xa = sx(L, O.x[E.slideFrom]), xb = sx(L, O.x[E.hitF]), yy = sz(L, 2 * HR + 0.05);
      WM.arrow(ctx, xa, yy, xb, yy, AMBER, 1.6, 6);
      label(ctx, L, L.wide ? 'slows at μg → μ' : '→ μ', (xa + xb) / 2, yy - 12, AMBER);
    }
    if (step === 2 || step === 3) {
      var xc = sx(L, XB0), xd = sx(L, O.b[NF - 1]), y2 = sz(L, 2 * HB + 0.05);
      WM.arrow(ctx, xc, y2, xd, y2, AMBER, 1.6, 6);
      label(ctx, L, L.wide ? 'the 1 kg crate\'s push → m' : '→ m', (xc + xd) / 2, y2 - 12, AMBER);
    }
    ctx.restore();
  }
  function evidenceStep() { return PHASES[st.phase] === 'hold' ? 3 : Math.min(2, Math.floor(st.t / dur(2) * 3)); }

  function drawScene(ctx, L, mode, nl) {
    var top = L.sceneTop, fam = FAMILIES[family].key, ph = PHASES[st.phase], t = playTime(), O = P.obs, i, f;
    var post = mode.post ? P[mode.post] : null;
    var gen = post && post.tracks ? (fam === 'reg' ? [post.meanTrack] : post.tracks) : [];   /* the generated motion(s) */
    var ghost = fam === 'reg' ? 'solid' : 'ghost';
    ctx.save();
    ctx.fillStyle = '#eef1f4'; ctx.fillRect(sx(L, XMIN), L.floorY, (XMAX - XMIN) * L.s, 16);
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx(L, XMIN), L.floorY); ctx.lineTo(sx(L, XMAX), L.floorY); ctx.stroke();
    ctx.font = font(L.wide ? 11 : 9.5); ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var xt = 0; xt <= 4; xt++) { ctx.fillText(xt + (xt === 4 ? ' m' : ''), sx(L, xt), L.floorY + 3); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(L.wide ? 'side view; the blue crate weighs 1 kg' : 'side view', sx(L, XMIN) + 2, top - 6);
    /* the action and the start pose, given in every question */
    var ax = sx(L, X0), az = sz(L, Z0), k = L.wide ? 0.16 : 0.13;
    WM.arrow(ctx, ax, az, ax + VX * k * L.s, az - VZ * k * L.s, C.red, 2, 7);
    if (L.wide) label(ctx, L, 'a: throw (3.2, 1.2) m/s', ax + VX * k * L.s + 6, az - VZ * k * L.s - 4, C.red, 'left');
    if (mode.key !== 'forward') {
      crate(ctx, L, X0, Z0, HR, C.red, 'start'); crate(ctx, L, XB0, HB, HB, C.ballBlue, 'start');
      if (L.wide) label(ctx, L, 'start', sx(L, X0 - HR) - 4, az, C.red, 'right');
    }

    var frames = [];
    if (mode.key === 'forward') {
      for (f = 2; f < NF; f += 2) frames.push(f);
      dots(ctx, L, O, frames, 0, nl, false);
    } else if (mode.key === 'backward') {
      for (f = 1; f < NF; f += 2) frames.push(f);
      strobe(ctx, L, O);
      dots(ctx, L, O, frames, 0, nl, true);
    } else if (mode.key === 'both') {
      var seen = [], later = [];
      for (f = 1; f <= PREFIX; f++) seen.push(f);
      for (f = PREFIX + 3; f < NF; f += 3) later.push(f);
      dots(ctx, L, O, seen, 0, nl, true);
      for (i = 0; i < gen.length; i++) dots(ctx, L, gen[i], later, i, nl, false);
      cut(ctx, L, O.x[PREFIX] + HR + 0.03, L.wide ? 'seen up to 0.9 s' : '0.9 s', 'right');
    } else {
      var early = [], late = [];
      for (f = 2; f < END; f += 3) early.push(f);
      for (f = END; f < NF; f += 2) late.push(f);
      for (i = 0; i < gen.length; i++) dots(ctx, L, gen[i], early, i, nl, false);
      dots(ctx, L, O, late, 0, nl, true);
      cut(ctx, L, O.x[END] - HR - 0.04, L.wide ? 'the end, seen: last 0.3 s' : 'end seen', 'left');
    }

    /* the crates */
    if (mode.key === 'forward') {
      var pt = frameAt(O, t); crate(ctx, L, pt.x, pt.z, HR, C.red, 'solid'); crate(ctx, L, pt.b, HB, HB, C.ballBlue, 'solid');
    } else if (mode.key === 'backward') {
      crate(ctx, L, O.x[NF - 1], O.z[NF - 1], HR, C.red, 'solid'); crate(ctx, L, O.b[NF - 1], HB, HB, C.ballBlue, 'solid');
    } else if (mode.key === 'both') {
      if (t > PREFIX / FPS + 1e-9) {
        gen.forEach(function (tr) { var p = frameAt(tr, t); crate(ctx, L, p.x, p.z, HR, C.red, ghost); crate(ctx, L, p.b, HB, HB, C.ballBlue, ghost); });
        if (ph === 'hold') crate(ctx, L, O.b[NF - 1], HB, HB, INK, 'truth');
      } else { var pp = frameAt(O, t); crate(ctx, L, pp.x, pp.z, HR, C.red, 'solid'); crate(ctx, L, pp.b, HB, HB, C.ballBlue, 'solid'); }
    } else {                                                /* backwards in time: the end state stays (given); the histories run back from it */
      crate(ctx, L, O.x[NF - 1], O.z[NF - 1], HR, C.red, 'solid'); crate(ctx, L, O.b[NF - 1], HB, HB, C.ballBlue, 'solid');
      if (ph === 'play' || ph === 'hold') {
        gen.forEach(function (tr) { var p = frameAt(tr, t); crate(ctx, L, p.x, p.z, HR, C.red, 'ghost'); crate(ctx, L, p.b, HB, HB, C.ballBlue, 'ghost'); });
      }
    }
    if (mode.key === 'backward') label(ctx, L, L.wide ? 'the whole motion, given' : 'given', sx(L, XMAX) - 2, top + 2, C.muted, 'right');
    else if (ph === 'play' || ph === 'hold') {
      var tl = 't = ' + t.toFixed(2) + ' s' + (mode.key === 'reverse' ? (L.wide ? ', running backwards' : ' ◀') : '');
      if (L.wide) label(ctx, L, tl, sx(L, XMAX) - 2, top + 2, C.text, 'right');
      else label(ctx, L, tl, sx(L, XMIN) + 62, top - 1, C.text, 'left');
    }

    /* what in the recording carries each property (backward), and the spread of outcomes (infer and continue) */
    if (mode.key === 'backward' && (ph === 'play' || ph === 'hold')) drawEvidence(ctx, L, evidenceStep());
    if (mode.key === 'both' && ph === 'hold') {
      var lo = fam === 'reg' ? post.meanTrack.b[NF - 1] : XB0 + post.slideLo, hi = fam === 'reg' ? lo : XB0 + post.slideHi, yb = sz(L, 2 * HB + 0.1);
      if (fam !== 'reg') {
        ctx.strokeStyle = C.ballBlue; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx(L, lo), yb + 4); ctx.lineTo(sx(L, lo), yb); ctx.lineTo(sx(L, hi), yb); ctx.lineTo(sx(L, hi), yb + 4); ctx.stroke();
        label(ctx, L, L.wide ? 'samples: the blue crate ends anywhere here' : 'samples spread', (sx(L, lo) + sx(L, hi)) / 2, yb - 10, C.ballBlue);
      } else label(ctx, L, L.wide ? 'one averaged answer' : 'average', sx(L, lo), yb - 10, C.slate);
      label(ctx, L, 'true', sx(L, O.b[NF - 1]), sz(L, -0.06) + 14, INK);
    }
    ctx.restore();
  }

  /* ---------- the properties ---------- */
  function drawProps(ctx, L, mode, nl) {
    var fam = FAMILIES[family].key, ph = PHASES[st.phase], post = mode.post ? P[mode.post] : null;
    var active = mode.key === 'backward' && ph === 'play' ? evidenceStep() : -1;
    var colW = L.wide ? (L.W - 28 - 2 * 36) / 3 : L.W - 28, truthVals = { e: TRUTH.e, mu: TRUTH.mu, lm: Math.log(TRUTH.m) / Math.LN2 };
    ctx.save();
    PROPS.forEach(function (pr, k) {
      var x0 = L.wide ? 14 + k * (colW + 36) : 14, y0 = L.wide ? L.propTop : L.propTop + k * L.propH;
      var axY = y0 + L.propH - 34, w = colW;
      function px(v) { return x0 + w * (v - pr.lo) / (pr.hi - pr.lo); }
      if (k === active) {                                    /* the property the evidence being pointed out carries */
        WM.roundRect(ctx, x0 - 8, y0 - 4, w + 16, L.propH - 6, 6);
        ctx.fillStyle = 'rgba(245,166,35,0.12)'; ctx.fill();
      }
      ctx.font = font(L.wide ? 12.5 : 11, true); ctx.fillStyle = k === active ? AMBER : INK; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(pr.name + '  ' + pr.label, x0, y0 + 10);
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, axY); ctx.lineTo(x0 + w, axY); ctx.stroke();
      ctx.font = font(L.wide ? 11 : 9.5); ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      pr.ticks.forEach(function (v) {
        ctx.beginPath(); ctx.moveTo(px(v), axY); ctx.lineTo(px(v), axY + 3); ctx.stroke();
        ctx.fillText(pr.key === 'lm' ? String(Math.pow(2, v)) : v.toFixed(1), px(v), axY + 5);
      });
      var tv = truthVals[pr.key], showTruth = !mode.hidP || ph === 'hold';
      if (!mode.hidP) {                                      /* given: one known value */
        var gx = px(tv), gy = axY - 14;
        ctx.fillStyle = AMBER; ctx.beginPath(); ctx.moveTo(gx, gy - 7); ctx.lineTo(gx + 7, gy); ctx.lineTo(gx, gy + 7); ctx.lineTo(gx - 7, gy); ctx.closePath(); ctx.fill();
        label(ctx, L, 'given', gx + 12, gy, C.muted, 'left');
      } else if (fam === 'reg') {                            /* one pass: the posterior mean, one value */
        if (nl.sigma === 0) {
          var rx = px(post.mean[pr.key]);
          ctx.fillStyle = C.slate; ctx.fillRect(rx - 2, axY - 32, 4, 30);
          label(ctx, L, pr.key === 'lm' ? kg(post.mean.lm) + ' kg' : post.mean[pr.key].toFixed(2), rx + 7, axY - 24, C.slate, 'left');
        }
      } else {                                               /* samples, carried from noise to the posterior */
        for (var p = 0; p < NPART; p++) {
          var id = (st.cycle * NPART + p) * 3 + k, target = (post.samples[p][pr.key] - pr.lo) / (pr.hi - pr.lo);
          var noise = 0.5 + 0.3 * hnoise(id, 21), u = WM.clamp(along(target, noise, nl.sigma, nl.step, id + 50000, 0.45), -0.04, 1.04);
          var yy = axY - 6 - 26 * (0.5 + 0.5 * hnoise(id, 22) / 1.7);
          ctx.beginPath(); ctx.arc(x0 + w * u, WM.clamp(yy, axY - 34, axY - 4), L.wide ? 3.2 : 2.6, 0, 2 * Math.PI);
          ctx.fillStyle = lerpColor(GRAY, AMBER, Math.pow(1 - nl.sigma, 2)); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.stroke();
        }
      }
      if (showTruth && mode.hidP) {
        var tx = px(tv);
        ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(tx, axY + 1); ctx.lineTo(tx - 5, axY + 9); ctx.lineTo(tx + 5, axY + 9); ctx.closePath(); ctx.fill();
        ctx.font = font(L.wide ? 11 : 9.5, true); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = INK;
        ctx.fillText('true', tx, axY + 18);
      }
    });
    ctx.restore();
  }

  /* ---------- captions ---------- */
  function fmt(v, d) { return v.toFixed(d === undefined ? 2 : d); }
  function kg(lm) { var m = Math.pow(2, lm); return fmt(m, m >= 1 ? 1 : 2); }
  function caption(mode, ph) {
    var fam = FAMILIES[family].key, O = P.obs, slide = O.b[NF - 1] - XB0, all = P.all, pre = P.pre, end = P.end;
    var regSlide = pre.meanTrack.b[NF - 1] - XB0;
    if (mode.key === 'forward') {
      if (ph === 'mask') return 'Forward. Given: the scene, its properties (bounciness e = 0.55, floor friction μ = 0.18, red crate 2 kg; the blue crate weighs 1 kg) and the action, a throw at (3.2, 1.2) m/s. Hidden: the 3 s of motion.';
      if (ph === 'denoise') return fam === 'reg' ? 'Regression writes the motion in one pass: no noise, no steps.'
        : fam === 'flow' ? 'Flow matching: the motion tokens start as noise (σ = 1); each of 50 Euler steps moves every frame\'s point straight toward the trajectory.'
        : 'Diffusion: the same start, but each step removes noise and adds a little fresh noise back, so the points wander before they settle.';
      if (ph === 'play') return 'The generated motion, played forward: ' + bounces(O) + ' bounces, a slide, and a push that moves the blue crate ' + fmt(slide) + ' m.';
      return 'With every property given there is one future, so the three families agree. This is the direction trained so far (sections 3 to 10).';
    }
    if (mode.key === 'backward') {
      if (ph === 'mask') return 'Backward, with the same network. Given: the scene without its properties, the action, and the whole motion as a recording (both crates\' tracked centres, 91 frames; the faint outlines). Hidden: e, μ and m. Nothing moves in this question: the three numbers are what the model produces.';
      if (ph === 'denoise') return fam === 'reg' ? 'Regression needs a second network trained from motion to properties; it answers in one pass with one value per property.'
        : fam === 'flow' ? 'Only the property tokens are noise; the recording stays put. 40 noise draws give 40 samples, each carried straight to a value the recording allows.'
        : '40 noise draws with stochastic steps: the samples wander, then settle on the values the recording allows.';
      if (ph === 'play') {
        var step = evidenceStep();
        return step === 0 ? 'Where the answer comes from, 1 of 3: the bounce heights. A landing keeps a fraction e of the vertical speed, so the apexes set e.'
          : step === 1 ? '2 of 3: the slide. From the last landing to the hit the crate slows at μg, so its loss of speed sets μ (as does the speed lost at every landing).'
          : '3 of 3: the push. How far the 1 kg crate slides after the hit depends on the red crate\'s momentum, so it sets the mass.';
      }
      return fam === 'reg' ? 'One value each (e ' + fmt(all.mean.e) + ', μ ' + fmt(all.mean.mu) + ', m ' + kg(all.mean.lm) + ' kg): right here, because the recording leaves one explanation. Questions 3 and 4 show cases where it leaves several.'
        : 'All three pinned (true: e 0.55, μ 0.18, m 2 kg): the whole recording leaves one explanation, so the samples agree.';
    }
    if (mode.key === 'both') {
      if (ph === 'mask') return 'Both directions at once. Given: only the first 0.9 s (the throw and its bounces, no collision yet). Hidden: the properties and the remaining 2.1 s, generated together, so each sample pairs a mass with the push that mass would give.';
      if (ph === 'denoise') return fam === 'reg' ? 'Regression: one pass, one set of properties and one continuation.' : 'Properties and future frames come out of the noise together; ' + pre.shown.length + ' of the 40 continuations are drawn.';
      if (ph === 'play') return fam === 'reg' ? 'Regression returns averages: a mass of ' + kg(pre.mean.lm) + ' kg (the middle of the range, in log mass) and the mean of all possible slides, ' + fmt(regSlide) + ' m.'
        : 'The continuations fan out: the bounces pin e and μ, but nothing seen so far depends on the mass, so the samples span ' + kg(pre.lo.lm) + ' to ' + kg(pre.hi.lm) + ' kg and the blue crate slides ' + fmt(pre.slideLo) + ' to ' + fmt(pre.slideHi) + ' m.';
      return fam === 'reg' ? 'One confident answer (' + fmt(regSlide) + ' m; the truth is ' + fmt(slide) + ' m) and no sign that it could be anywhere from ' + fmt(pre.slideLo) + ' to ' + fmt(pre.slideHi) + ' m. A single answer cannot say how sure it is (WM-E1).'
        : 'The spread is the right answer: the true outcome (dashed, ' + fmt(slide) + ' m) is one of the samples. Seeing the collision, as in question 2, pins the mass and closes the spread.';
    }
    /* backwards in time */
    if (ph === 'mask') return 'Backwards in time. Given: the scene\'s shapes, the action, and only the end of the motion: the last 0.3 s, both crates at rest (red at ' + fmt(O.x[NF - 1]) + ' m, blue at ' + fmt(O.b[NF - 1]) + ' m). Hidden: the properties and the 2.7 s before, generated together.';
    if (ph === 'denoise') return fam === 'reg' ? 'Regression: one pass, one history, the average of every history that ends here.'
      : fam === 'flow' ? 'With Diffusion Forcing\'s per-chunk noise levels (objective 4) the hidden chunks are cleaned from the end backwards: the 0.3 s before the end first, then earlier ones; the mirror image of continuing a known beginning.'
      : 'The same order with stochastic steps: each chunk wanders before it settles, the one just before the end first.';
    if (ph === 'play') return fam === 'reg' ? 'Time runs backwards along regression\'s single history: the average of every history that ends here, a crate drifting through the mean of their bounces, a path no single history follows.'
      : 'Time runs backwards from the end state along ' + end.shown.length + ' sampled histories. They differ in how the crate got there: ' + end.bouncesLo + ' to ' + end.bouncesHi + ' bounces, a light crate (' + kg(end.lo.lm) + ' kg) hitting hard or a heavy one (' + kg(end.hi.lm) + ' kg) hitting softly; every one ends within a few centimetres of the observed state.';
    return fam === 'reg' ? 'One confident history, and no sign that the end state allows bounciness anywhere from ' + fmt(end.lo.e) + ' to ' + fmt(end.hi.e) + ', with the mass from ' + kg(end.lo.lm) + ' to ' + kg(end.hi.lm) + ' kg to match.'
      : 'The end state alone leaves a one-dimensional family: bounciness ' + fmt(end.lo.e) + ' to ' + fmt(end.hi.e) + ' with the mass ' + kg(end.lo.lm) + ' to ' + kg(end.hi.lm) + ' kg to match, and friction ' + fmt(end.lo.mu) + ' to ' + fmt(end.hi.mu) + ' (it set where the crates stopped). The spread is the answer, and the training data decides which of these histories count as likely: the question a collapsed structure asks of its rubble.';
  }

  /* ---------- controls ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function chipRow(items, onPick, store, lead) {
    var row = el('div', 'tags');
    row.style.margin = '0 0 .4rem'; row.style.justifyContent = 'center'; row.style.alignItems = 'center';
    var head = el('span', null, lead); head.style.cssText = 'color:' + C.muted + ';font-size:.85rem;margin:0 .5rem .5rem 0';
    row.appendChild(head);
    items.forEach(function (it, k) {
      var chip = el('a', 'tag is-rounded is-medium', it.title);
      chip.setAttribute('role', 'button'); chip.setAttribute('tabindex', '0'); chip.style.cursor = 'pointer';
      chip.addEventListener('click', function () { onPick(k); });
      chip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(k); } });
      store.push(chip); row.appendChild(chip);
    });
    root.insertBefore(row, canvas);
  }
  function buildControls() {
    chipRow(MODES, function (k) { goTo(k, 0); }, modeChips, 'question');
    chipRow(FAMILIES, function (k) { family = k; st.t = Math.min(st.t, dur(st.phase) - 0.01); render(); }, famChips, 'family');
    var back = el('button', 'button is-small is-light', '◀ Step'), fwd = el('button', 'button is-small is-light', 'Step ▶');
    back.type = fwd.type = 'button';
    back.setAttribute('aria-label', 'Previous step'); fwd.setAttribute('aria-label', 'Next step');
    back.addEventListener('click', function () { goTo(st.mode, st.phase - (st.t < 0.5 ? 1 : 0)); });
    fwd.addEventListener('click', function () { goTo(st.mode, st.phase + 1); });
    controls.insertBefore(back, btn);
    controls.insertBefore(fwd, btn.nextSibling);
  }
  function markChips() {
    modeChips.forEach(function (c, k) { c.classList.toggle('is-link', k === st.mode); c.setAttribute('aria-current', k === st.mode ? 'step' : 'false'); });
    famChips.forEach(function (c, k) { c.classList.toggle('is-info', k === family); c.setAttribute('aria-pressed', k === family ? 'true' : 'false'); });
  }

  function render() {
    if (root.offsetParent === null) return;                 /* hidden tab: nothing to draw, nothing to compute yet */
    prepare(); ensureCycle();
    var W = canvas.clientWidth || 900, L = layout(W), fit = WM.fitCanvas(canvas, L.H), ctx = fit.ctx;
    var mode = MODES[st.mode], nl = noiseLevel(), ph = PHASES[st.phase];
    ctx.clearRect(0, 0, W, L.H);
    drawTokens(ctx, L, mode, nl);
    drawScene(ctx, L, mode, nl);
    drawProps(ctx, L, mode, nl);
    var text = MODES[st.mode].title + ' · ' + FAMILIES[family].title + '. ' + caption(mode, ph);
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
    markChips();
  }

  buildControls();
  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
