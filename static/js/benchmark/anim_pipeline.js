/* Benchmark pipeline animation (SVG built here, animated with requestAnimationFrame, same runner as the world-model block):
   scene + instruction -> language model -> answer (JSON or program) -> PhysX simulation and checks -> verdict and reviewer.
   The captions quote one real GPT-5.4 attempt; the buttons switch between a static edit and a launch task. */
(function () {
  'use strict';
  var WM = window.WM, D = window.BM_RESULTS || null;
  var root = document.getElementById('bm-anim-pipeline');
  if (!root || !WM) return;
  var svg = root.querySelector('svg'), btn = root.querySelector('button.bm-play'), cap = root.querySelector('.wm-caption');
  var toggles = root.querySelectorAll('.bm-toggle .button');
  var C = WM.colors, NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    (parent || svg).appendChild(e);
    return e;
  }
  function trim(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function vec(v) { return '[' + v.map(function (x) { return (Math.round(x * 100) / 100).toFixed(2); }).join(', ') + ']'; }

  var BW = 158, BH = 150, BY = 30, BX = [8, 185, 362, 539, 716], MID = BY + 78;
  var TITLES = ['1. Scene + instruction', '2. Language model', '3. Answer', '4. PhysX simulation', '5. Verdict + reviewer'];
  svg.setAttribute('viewBox', '0 0 900 ' + (BY + BH + 12));
  var defs = el('defs', {});
  var marker = el('marker', { id: 'bm-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', fill: C.muted }, marker);

  var boxes = [], titles = [], bodies = [];
  for (var i = 0; i < 5; i++) {
    var g = el('g', { 'font-family': '"Noto Sans", sans-serif' });
    boxes.push(el('rect', { x: BX[i], y: BY, width: BW, height: BH, rx: 8, fill: '#fff', stroke: C.border, 'stroke-width': 1.5 }, g));
    titles.push(el('text', { x: BX[i] + BW / 2, y: BY + 20, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 'bold', fill: '#222' }, g, TITLES[i]));
    var body = [];
    for (var r = 0; r < 7; r++) body.push(el('text', { x: BX[i] + 10, y: BY + 40 + r * 15, 'font-size': 9.6, fill: '#333' }, g, ''));
    bodies.push(body);
    if (i < 4) el('line', { x1: BX[i] + BW + 2, y1: MID, x2: BX[i + 1] - 2, y2: MID, stroke: C.muted, 'stroke-width': 1.5, 'marker-end': 'url(#bm-arrow)' });
  }
  /* small pictograms: a scene (stage 1), a brain-ish block (2), braces (3), a ball arc (4), a tick (5) */
  el('rect', { x: BX[1] + 24, y: BY + 112, width: 110, height: 22, rx: 5, fill: '#e8eef9', stroke: C.blue, 'stroke-width': 1 });
  el('text', { x: BX[1] + BW / 2, y: BY + 127, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.blue }, null, 'one call, no tools');
  var arc = el('path', { d: 'M' + (BX[3] + 18) + ',' + (BY + 136) + ' Q' + (BX[3] + 70) + ',' + (BY + 96) + ' ' + (BX[3] + 125) + ',' + (BY + 136), fill: 'none', stroke: C.red, 'stroke-width': 2 });
  el('line', { x1: BX[3] + 12, y1: BY + 137, x2: BX[3] + 146, y2: BY + 137, stroke: C.muted, 'stroke-width': 1 });
  var ball = el('circle', { cx: BX[3] + 18, cy: BY + 134, r: 5, fill: C.red });
  var verdict = el('text', { x: BX[4] + BW / 2, y: BY + 132, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 'bold', fill: '#1b6f3a' }, null, '');

  var pulse = el('g', { visibility: 'hidden' });
  el('circle', { r: 11, fill: C.amber, opacity: 0.3 }, pulse);
  el('circle', { r: 6, fill: C.amber }, pulse);

  function sampleTexts(kind) {
    var s = D && D.pipeline ? D.pipeline[kind] : null;
    if (!s) return null;
    var lines = [[], [], [], [], []];
    lines[0] = ['"' + trim(s.instruction, 34) + '"', trim(s.instruction.slice(34), 34), '', 'two rendered views', s.objects + ' object rows as JSON', '(pose, size, mass, friction)', 'rules of the game, disclosed'];
    lines[1] = [s.provider, 'reads about ' + (s.prompt_tokens ? Math.round(s.prompt_tokens / 1000) + ',000' : '10,000') + ' tokens', s.reasoning_tokens ? 'thinks for ' + s.reasoning_tokens.toLocaleString() + ' hidden tokens' : '', 'returns one committed answer'];
    if (kind === 'static') {
      lines[2] = ['new poses as JSON:'].concat((s.answer || []).slice(0, 3).map(function (a) { return a.position ? a.id + ' position ' + vec(a.position) : a.id + ' turned ' + Math.round(2 * Math.acos(Math.abs(a.quaternion_wxyz[0])) * 180 / Math.PI) + '°'; }));
      lines[3] = ['the edit is applied as sent,', 'settled for one second,', 'measured:', 'relations (between, faces, closer)', 'overlap, support, stays put'];
    } else {
      var a = (s.answer || [])[0];
      lines[2] = ['a short program computes', 'the launch; its result:', a ? a.id + ' velocity' : '', a ? vec(a.linear_velocity) + ' m/s' : '', 'checked against the bounds'];
      lines[3] = ['the launch is applied at t = 0,', 'two seconds of physics,', 'measured:', 'contact in time, end region,', 'came to rest, no overlap'];
    }
    var passes = (s.checks || []).filter(function (c) { return c.indexOf('PASS') === 0; }).length;
    lines[4] = [passes + ' of ' + (s.checks || []).length + ' checks passed', s.status === 'pass' ? 'goal met' : 'goal failed', '', 'reviewer AI looks at the renders', 'with the numbers in hand:', s.reviewer ? '"' + s.reviewer.overall + '" (advisory only)' : ''];
    return { lines: lines, status: s.status, caps: [
      'Stage 1 of 5. The model receives the instruction, two renders of the room and the scene as a list of objects with poses, sizes, masses and friction. The rules of every check are stated in the prompt.',
      'Stage 2 of 5. One call, no tools, no feedback: ' + s.provider + ' answers once.' + (s.reasoning_tokens ? ' Here it spent ' + s.reasoning_tokens.toLocaleString() + ' hidden reasoning tokens.' : ''),
      kind === 'static' ? 'Stage 3 of 5. The answer is the new pose of every object it moves, as JSON. Objects it does not mention stay exactly where they were.' : 'Stage 3 of 5. The answer is a small program; the benchmark runs it and takes the launch velocity it returns (the direct-answer variant returns the velocity itself).',
      kind === 'static' ? 'Stage 4 of 5. PhysX places the objects exactly as answered, lets the room settle for one second and measures distances, angles, overlaps and drift.' : 'Stage 4 of 5. PhysX applies the velocity at t = 0 and runs two seconds of physics; contacts, positions and speeds are measured.',
      'Stage 5 of 5. The measurements decide: here ' + passes + ' of ' + (s.checks || []).length + ' checks passed, so the goal ' + (s.status === 'pass' ? 'is met' : 'is not met') + '. A reviewer AI then looks at the renders and comments; it can never overturn a failed measurement.'
    ] };
  }
  var fallback = { lines: [['instruction + two views', 'scene as JSON rows'], ['one call, one answer'], ['JSON poses or a launch'], ['settle or run 2 s', 'measure'], ['pass / fail', 'reviewer comment']], status: 'pass',
    caps: ['Scene and instruction go in.', 'The model answers once.', 'The answer is JSON or a program.', 'PhysX simulates and measures.', 'The measurements decide; the reviewer comments.'] };
  var kind = 'static', T = sampleTexts(kind) || fallback;

  function fillTexts() {
    for (var b = 0; b < 5; b++) for (var r = 0; r < 7; r++) bodies[b][r].textContent = (T.lines[b] && T.lines[b][r]) ? T.lines[b][r] : '';
    verdict.textContent = T.status === 'pass' ? 'PASS' : 'FAIL';
    verdict.setAttribute('fill', T.status === 'pass' ? '#1b6f3a' : C.red);
  }
  fillTexts();

  var STAGE = 2.2, ARROW = 0.55, PAUSE = 0.6, segs = [];
  for (var sIdx = 0; sIdx < 5; sIdx++) { segs.push({ kind: 'stage', i: sIdx, dur: STAGE }); if (sIdx < 4) segs.push({ kind: 'arrow', i: sIdx, dur: ARROW }); }
  segs.push({ kind: 'pause', i: 4, dur: PAUSE });
  var st = { seg: 0, t: 0 }, lastCap = null;
  function advance(dt) { st.t += dt; while (st.t >= segs[st.seg].dur) { st.t -= segs[st.seg].dur; st.seg = (st.seg + 1) % segs.length; } }
  function render() {
    var sg = segs[st.seg], q = st.t / sg.dur, active = sg.kind === 'stage' ? sg.i : -1;
    for (var b = 0; b < 5; b++) {
      boxes[b].setAttribute('stroke', b === active ? C.blue : C.border);
      boxes[b].setAttribute('stroke-width', b === active ? 2.5 : 1.5);
      boxes[b].setAttribute('fill', b === active ? '#fffaf0' : '#fff');
      titles[b].setAttribute('fill', b === active ? C.blue : '#222');
    }
    if (sg.kind === 'arrow') {
      var x = WM.lerp(BX[sg.i] + BW + 4, BX[sg.i + 1] - 6, WM.ease(q));
      pulse.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + MID + ')'); pulse.setAttribute('visibility', 'visible');
    } else pulse.setAttribute('visibility', 'hidden');
    /* the ball moves along the arc while stage 4 is active */
    var u = active === 3 ? WM.ease(q) : (st.seg > 6 ? 1 : 0);
    var x0 = BX[3] + 18, x1 = BX[3] + 125, cx = BX[3] + 70;
    var bx = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x1;
    var by = (1 - u) * (1 - u) * (BY + 136) + 2 * (1 - u) * u * (BY + 96) + u * u * (BY + 136);
    ball.setAttribute('cx', bx.toFixed(1)); ball.setAttribute('cy', (by - 2).toFixed(1));
    arc.setAttribute('opacity', active === 3 || st.seg > 6 ? 1 : 0.35);
    verdict.setAttribute('opacity', active === 4 || sg.kind === 'pause' ? 1 : 0.25);
    var text = T.caps[sg.i];
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }
  function representative() { for (var k = 0; k < segs.length; k++) if (segs[k].kind === 'stage' && segs[k].i === 3) st.seg = k; st.t = 0; }

  Array.prototype.forEach.call(toggles, function (b) {
    b.addEventListener('click', function () {
      kind = b.getAttribute('data-kind') || 'static';
      Array.prototype.forEach.call(toggles, function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      T = sampleTexts(kind) || fallback; fillTexts(); lastCap = null; st.seg = 0; st.t = 0; render();
    });
  });
  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
