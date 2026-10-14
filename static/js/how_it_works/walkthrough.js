/* "How models are prompted": one real attempt, step by step (task, prompt, answer format, answer, harness, checks, outcome).
   Everything comes from window.HW_DATA (tools/extract_how_it_works.py). Nothing advances on its own: the reader moves with
   Back / Next, the step list or the arrow keys, and picks the example and the model. */
(function () {
  'use strict';
  var D = window.HW_DATA, root = document.getElementById('hw-walk');
  if (!D || !root) { return; }
  var STEPS = ['The task', 'The prompt', 'The answer format', 'The answer', 'From answer to simulation', 'The checks', 'The outcome'];
  var MODEL_STEPS = { 3: true, 4: true, 5: true, 6: true };
  var state = { example: D.order[0], model: 'gpt54', step: 0 };
  var stepsEl = root.querySelector('.hw-steps'), panel = root.querySelector('.hw-panel'), count = root.querySelector('.hw-count');
  var exPick = root.querySelector('[data-pick="example"]'), mdPick = root.querySelector('[data-pick="model"]');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(x, d) { return (+x).toFixed(d == null ? 2 : d); }
  function thousands(n) { return n == null ? '?' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function vec(v, d) { return '(' + v.map(function (x) { return num(x, d); }).join(', ') + ')'; }
  function ex() { return D.examples[state.example]; }
  function mod() { return ex().models[state.model]; }
  function name(p) { return D.providers[p]; }
  function chip(p) { return '<span class="hw-chip hw-' + p + '">' + esc(name(p)) + '</span>'; }
  function verdict(s) { return '<span class="hw-verdict ' + s + '">' + (s === 'pass' ? 'PASS' : 'FAIL') + '</span>'; }
  function pre(text, cls) { return '<pre class="hw-pre' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</pre>'; }

  /* ---------- pickers and step list ---------- */
  function buttons(el, items, current, attr) {
    el.innerHTML = items.map(function (it) {
      return '<button type="button" class="button is-small" data-' + attr + '="' + it[0] + '" aria-pressed="' + (it[0] === current) + '">' + esc(it[1]) + '</button>';
    }).join('');
  }
  function drawControls() {
    buttons(exPick, D.order.map(function (k) { return [k, D.examples[k].title]; }), state.example, 'example');
    buttons(mdPick, Object.keys(D.providers).map(function (p) { return [p, name(p)]; }), state.model, 'model');
    mdPick.classList.toggle('is-idle', !MODEL_STEPS[state.step]);
    stepsEl.innerHTML = STEPS.map(function (s, i) {
      return '<li><button type="button" role="tab" data-step="' + i + '" aria-selected="' + (i === state.step) + '"><span class="n">' + (i + 1) + '</span>' + esc(s) + '</button></li>';
    }).join('');
    count.textContent = 'Step ' + (state.step + 1) + ' of ' + STEPS.length;
    root.querySelector('[data-go="-1"]').disabled = state.step === 0;
    root.querySelector('[data-go="1"]').disabled = state.step === STEPS.length - 1;
  }

  /* ---------- step 1: the task ---------- */
  function stepTask() {
    var e = ex(), h = '<p class="hw-instruction">' + esc(e.instruction) + '</p>';
    h += '<div class="hw-views">' + e.views.map(function (v) {
      return '<figure><img src="./' + esc(v.src) + '" alt="The ' + esc(v.label) + ' view the models receive" loading="lazy"><figcaption>' + esc(v.label) + ' view, as attached to the prompt</figcaption></figure>';
    }).join('') + '</div><ul class="hw-facts">';
    h += '<li><b>Room ' + e.room + '</b>' + e.prompt.scene_rows.length + ' objects, ' + e.prompt.scene_rows.filter(function (r) { return r.moves; }).length + ' of them movable</li>';
    if (e.control) {
      var c = e.control, axes = ['x', 'y', 'z'];
      h += '<li><b>What may be launched</b>' + esc(c.label) + ' (' + esc(c.id) + '), once, at t = 0: velocity ' +
        axes.map(function (a, i) { return 'v' + a + ' ' + num(c.linear[i][0], 1) + ' to ' + num(c.linear[i][1], 1); }).join(', ') + ' m/s; ' +
        (c.angular.every(function (r) { return !r[0] && !r[1]; }) ? 'no spin allowed' : 'spin ' + axes.map(function (a, i) { return num(c.angular[i][0], 0) + ' to ' + num(c.angular[i][1], 0); }).join(', ') + ' rad/s') + '</li>';
    }
    h += '<li><b>How hard</b>' + e.chance.passes + ' of ' + e.chance.samples + ' ' + esc(e.chance.what) + ' pass this task</li>';
    h += '<li><b>Not shown to the models</b>the reference answer (a solution the simulator has verified) and the checking code; the checks are described in words in the prompt</li></ul>';
    return h;
  }

  /* ---------- step 2: the prompt ---------- */
  function sceneTable(rows) {
    var h = '<div class="table-container hw-scroll"><table class="table is-narrow is-fullwidth wm-table hw-scene"><thead><tr><th>id</th><th>object</th><th>moves</th><th>position (m)</th><th>size (m)</th><th>mass (kg)</th><th>friction</th><th>bounce</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr' + (r.moves ? '' : ' class="hw-fixed"') + '><td>' + esc(r.id) + '</td><td>' + esc(r.label) + '</td><td>' + (r.moves ? 'yes' : 'fixed') + '</td><td>' + vec(r.position, 2) + '</td><td>' + vec(r.size, 2) +
        '</td><td>' + (r.mass == null ? '' : num(r.mass, 2)) + '</td><td>' + (r.friction == null ? '' : num(r.friction, 2)) + '</td><td>' + (r.restitution == null ? '' : num(r.restitution, 2)) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function stepPrompt() {
    var e = ex(), total = e.prompt.chars, g = e.models.gpt54, q = e.models.qwen30t;
    var h = '<p>One text prompt of <b>' + thousands(total) + ' characters</b> (' + thousands(g.input_tokens) + ' tokens for GPT-5.4, ' + thousands(q.input_tokens) +
      ' for Qwen, whose tokenizer splits text differently), plus the two images. Both models receive exactly the same text. Click a part to read it.</p>';
    h += '<div class="hw-bar" aria-hidden="true">' + e.prompt.sections.map(function (s, i) {
      return '<span class="r-' + s.role + '" style="flex-grow:' + Math.max(s.chars, 120) + '" data-open="' + i + '" title="' + esc(s.label) + ': ' + thousands(s.chars) + ' characters"></span>';
    }).join('') + '</div>';
    h += '<div class="hw-sections">' + e.prompt.sections.map(function (s, i) {
      var body = s.key === 'SCENE JSON'
        ? '<p class="hw-note">The model reads this as one line of JSON. As a table, rounded:</p>' + sceneTable(e.prompt.scene_rows) +
          '<details class="hw-raw"><summary>Show the exact text (' + thousands(s.chars) + ' characters)</summary>' + pre(s.text, 'hw-wrap') + '</details>'
        : pre(s.text, 'hw-wrap');
      return '<details class="hw-sec r-' + s.role + '" data-index="' + i + '"' + (i === 0 ? ' open' : '') + '><summary><span class="sw"></span><b>' + esc(s.label) +
        '</b><span class="m">' + esc(s.meaning) + '</span><span class="c">' + thousands(s.chars) + ' chars</span></summary>' + body + '</details>';
    }).join('') + '</div>';
    return h;
  }

  /* ---------- step 3: the answer format ---------- */
  function stepFormat() {
    var e = ex(), f = e.format, g = e.models.gpt54, q = e.models.qwen30t, h = '';
    if (f.kind === 'schema') {
      h += e.kind === 'static'
        ? '<ul class="hw-plain"><li>A list of <b>changes</b>: each names one object by <code>id</code> and gives its new <code>position</code> (3 numbers, metres) and/or ' +
          '<code>quaternion_wxyz</code> (4 numbers); <code>null</code> means "keep as it is".</li><li>Objects not listed stay exactly where they are.</li>' +
          '<li>The bookkeeping fields must repeat the task’s own values, so an answer cannot be filed against the wrong scene.</li></ul>'
        : '<ul class="hw-plain"><li>The <code>id</code> of the one object that may be launched.</li><li>Its <code>linear_velocity</code> (3 numbers, m/s) and ' +
          '<code>angular_velocity</code> (3 numbers in rad/s, or <code>null</code> for no spin), each inside the stated limits.</li>' +
          '<li>A short <code>reason</code> (at most 400 characters): recorded, never scored.</li></ul>';
      h += '<p><b>The schema sent with the request</b> (' + esc(f.name) + '). GPT-5.4 receives it as a strict structured-output format; Qwen’s server uses it to constrain ' +
        'decoding. Neither model can return text outside it; whether the numbers make sense is the next steps’ job.</p>' + pre(f.schema_text, 'hw-json');
    } else {
      h += '<ul class="hw-plain"><li>No JSON schema here: the model writes one Python program that defines <code>simulate(scene, task)</code> and returns the launch.</li>' +
        '<li>The harness runs it in a sandbox: Python’s standard library and NumPy only, no files and no network, 30 s of CPU and 4 GB of memory.</li>' +
        '<li>In this condition the program also states its own forecast of where the ball ends; it is scored but does not affect the verdict.</li>' +
        '<li>A program that fails to run, or returns a launch outside the limits, counts as no answer.</li></ul>';
    }
    h += '<p><b>What the prompt says about it</b></p>' + pre(f.section, 'hw-wrap');
    h += '<p class="hw-note">Length limits: the visible answer may use at most ' + thousands(g.answer_budget) + ' tokens; hidden thinking may use the rest of the request’s output limit (' +
      thousands(g.output_limit) + ' tokens for GPT-5.4, ' + thousands(q.output_limit) + ' for Qwen). An answer cut off at the limit counts as no answer.</p>';
    return h;
  }

  /* ---------- step 4: the answer ---------- */
  function yawDeg(q) { return 2 * Math.atan2(q[3], q[0]) * 180 / Math.PI; }
  function plainLaunch(v) {
    var s = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]), el = Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1])) * 180 / Math.PI;
    return num(s, 2) + ' m/s, ' + num(el, 0) + ' degrees above the horizontal';
  }
  function stepAnswer() {
    var e = ex(), m = mod(), h = '<p>' + chip(state.model) + ' thought for <b>' + thousands(m.thinking_tokens) + ' tokens</b> (hidden from us, but counted) and answered in <b>' +
      thousands(m.answer_tokens) + ' tokens</b>. This is its reply as returned' + (m.answer_text ? ', laid out for reading' : '') + ':</p>';
    if (m.program) {
      var lines = m.program.split('\n');
      h += '<p class="hw-note">' + lines.length + ' lines of Python.</p><pre class="hw-pre hw-code">' + lines.map(function (l, i) {
        return '<span class="ln">' + (i + 1) + '</span>' + esc(l);
      }).join('\n') + '</pre>';
    } else {
      h += pre(m.answer_text, 'hw-json');
    }
    if (m.reason) { h += '<p class="hw-reason"><b>Its stated reason</b> (recorded, not scored): ' + esc(m.reason) + '</p>'; }
    if (e.kind === 'static' && m.conversion) {
      h += '<ul class="hw-plain">' + m.conversion.map(function (c) {
        var parts = [];
        if (c.position) { parts.push('move it to ' + vec(c.position, 3) + ' m'); }
        if (c.quaternion_in) { parts.push('turn it to a heading of ' + num(yawDeg(c.quaternion_in), 1) + ' degrees about the vertical'); }
        return '<li>In words: <b>' + esc(c.label) + '</b>: ' + parts.join(', ') + (c.kept.length ? '; keep its ' + c.kept.map(function (k) { return k === 'position' ? 'position' : 'orientation'; }).join(' and ') : '') + '.</li>';
      }).join('') + '</ul>';
    } else if (m.launch) {
      h += '<p>In words: launch the ' + esc(e.control.label) + ' at ' + plainLaunch(m.launch[0].linear_velocity) + (m.launch[0].angular_velocity && m.launch[0].angular_velocity.some(function (x) { return x; }) ? ', with spin' : ', without spin') +
        (m.program ? ' (the program returned this launch)' : '') + '. The reference solution: ' + plainLaunch(e.reference.linear_velocity) + '.</p>';
    }
    return h;
  }

  /* ---------- step 5: from answer to simulation ---------- */
  function flow(items) {
    return '<ol class="hw-flow">' + items.map(function (it) { return '<li><b>' + esc(it[0]) + '</b><div>' + it[1] + '</div></li>'; }).join('') + '</ol>';
  }
  function stepHarness() {
    var e = ex(), m = mod(), items = [];
    if (e.kind === 'static') {
      items.push(['Read the reply', 'Parsed as JSON; it matches the schema. Contract status: <b>' + esc(m.contract) + '</b>.']);
      items.push(['Check the contract', 'Every named object exists and may move; each appears once; positions have 3 numbers and orientations 4 of unit length (a deviation up to 0.001 is rescaled, anything larger is rejected, never repaired).']);
      items.push(['Convert to the simulator’s edit', '<ul>' + m.conversion.map(function (c) {
        var s = '<li><b>' + esc(c.label) + '</b> (' + esc(c.id) + '): ';
        var bits = [];
        if (c.position) { bits.push('position ' + vec(c.position, 4)); }
        if (c.kept.length) { bits.push(c.kept.map(function (k) { return k === 'position' ? 'position' : 'orientation'; }).join(' and ') + ' <code>null</code>, so unchanged'); }
        if (c.quaternion_in) {
          bits.push('quaternion of length ' + num(c.quaternion_norm_in, 7) + ' rescaled to length 1: [' + c.quaternion_in.join(', ') + '] → [' + c.quaternion_out.map(function (x) { return num(x, 9); }).join(', ') + ']');
        }
        return s + bits.join('; ') + '</li>';
      }).join('') + '</ul>']);
      items.push(['Complete the scene', 'The other ' + (e.prompt.scene_rows.length - m.conversion.length) + ' objects keep their poses exactly; nothing is interpolated, snapped or moved to make the edit fit.']);
      items.push(['Simulate', 'PhysX places every object at its new pose, measures contacts after one physics step (1/1,920 s), then lets the whole scene settle for one second at 1,920 steps per second and renders it.']);
    } else {
      var L = m.launch[0], c = e.control, axes = ['vx', 'vy', 'vz'];
      if (m.program) {
        items.push(['Run the program', 'In the sandbox (standard library and NumPy, no files or network, ' + m.sandbox.limits.cpu_seconds + ' s of CPU): it finished in ' + num(m.sandbox.seconds, 2) +
          ' s and returned the launch ' + vec(L.linear_velocity, 3) + ' m/s.' + (m.forecast ? ' Its own forecast: the ball ends at ' + vec(m.forecast.predicted, 2) + ' m.' : '')]);
      } else {
        items.push(['Read the reply', 'Parsed as JSON; it matches the schema. Contract status: <b>' + esc(m.contract) + '</b>.']);
      }
      var rows = axes.map(function (a, i) {
        var v = L.linear_velocity[i], ok = v >= c.linear[i][0] && v <= c.linear[i][1];
        return '<tr><td>' + a + '</td><td>' + num(v, 3) + '</td><td>' + num(c.linear[i][0], 1) + ' to ' + num(c.linear[i][1], 1) + '</td><td>' + (ok ? 'inside' : 'outside') + '</td></tr>';
      }).join('');
      items.push(['Check the contract', 'The id must be the controlled object, ' + esc(c.label) + ' (' + esc(c.id) + '): it is. Each component must lie inside its limit; a value outside is rejected, not clipped.' +
        '<table class="table is-narrow wm-table hw-mini"><thead><tr><th>component</th><th>answer (m/s)</th><th>allowed (m/s)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>']);
      items.push(['Convert to the simulator’s action', 'One intervention at t = 0: set the velocity of the ' + esc(c.label) + ' to ' + vec(L.linear_velocity, 3) + ' m/s and its spin to ' +
        (L.angular_velocity ? vec(L.angular_velocity, 1) + ' rad/s' : 'zero') + ', exactly as answered.']);
      items.push(['Simulate', 'Two seconds of motion at 1,920 physics steps per second; contacts are recorded at every step and the state of every object 30 times per second (60 frames). The clip in the last step is rendered from those states.']);
    }
    return '<p>What the harness does with the answer of ' + chip(state.model) + ', with the real values. No step changes the answer.</p>' + flow(items);
  }

  /* ---------- step 6: the checks ---------- */
  function stepChecks() {
    var m = mod(), failed = m.checks.filter(function (c) { return !c.passed; }).length;
    var h = '<p class="hw-banner ' + m.status + '">' + chip(state.model) + verdict(m.status) + (failed ? failed + ' of ' + m.checks.length + ' checks failed' : 'all ' + m.checks.length + ' checks passed') + '</p>';
    var groups = [['instruction', 'What the instruction asks'], ['physics', 'Physical screens (every task)']];
    h += '<div class="table-container"><table class="table is-narrow is-fullwidth wm-table hw-checks"><thead><tr><th>Check</th><th>Measured</th><th>Limit</th><th></th></tr></thead><tbody>';
    groups.forEach(function (g) {
      h += '<tr class="hw-group"><td colspan="4">' + g[1] + '</td></tr>';
      m.checks.filter(function (c) { return c.group === g[0]; }).forEach(function (c) {
        h += '<tr class="' + (c.passed ? 'ok' : 'bad') + '"><td>' + esc(c.name.charAt(0).toUpperCase() + c.name.slice(1)) + '</td><td>' + esc(c.measured) + '</td><td>' + esc(c.limit) + '</td><td>' + verdict(c.passed ? 'pass' : 'fail') + '</td></tr>';
      });
    });
    h += '</tbody></table></div><p class="hw-note">The verdict is a pass only if every check passes; it is computed by code. ' +
      (m.review ? 'A reviewer AI then looks at the renders and may comment, but cannot overrule a measured result. Its view here: <b>' + esc(m.review.overall) + '</b>. ' + esc(m.review.reason || '') : '') + '</p>';
    return h;
  }

  /* ---------- step 7: the outcome ---------- */
  function stepOutcome() {
    var e = ex(), r = e.result, h = '';
    var order = [['reference', 'Reference', 'ref']].concat(Object.keys(D.providers).map(function (p) { return [p, name(p), p]; }));
    if (e.kind === 'static') {
      h += '<figure class="hw-overview"><img src="./' + esc(r.overview) + '" alt="The whole room; the outlined area is shown in the close-ups" loading="lazy"><figcaption>The whole room before the edit; the outlined area is enlarged below.</figcaption></figure>';
      h += '<div class="hw-outcomes four"><figure><img src="./' + esc(r.before) + '" alt="Before the edit" loading="lazy"><figcaption>Before</figcaption></figure>' + order.map(function (o) {
        var src = o[0] === 'reference' ? r.reference : r.models[o[0]], st = o[0] === 'reference' ? 'pass' : e.models[o[0]].status;
        return '<figure class="' + (o[0] === state.model ? 'is-picked ' : '') + 'c-' + o[2] + '"><img src="./' + esc(src) + '" alt="' + esc(o[1]) + ' after settling" loading="lazy"><figcaption>' + esc(o[1]) + ' ' + verdict(st) + '</figcaption></figure>';
      }).join('') + '</div><p class="hw-note">Renders after the one-second settling; the checks in the previous step give the measured numbers.</p>';
    } else {
      h += '<p><button type="button" class="button is-small hw-playall">Play all three</button> <span class="hw-note">Two simulated seconds, in real time.</span></p><div class="hw-outcomes three">' + order.map(function (o) {
        var src = o[0] === 'reference' ? r.reference : e.models[o[0]].video, st = o[0] === 'reference' ? 'pass' : e.models[o[0]].status;
        return '<figure class="' + (o[0] === state.model ? 'is-picked ' : '') + 'c-' + o[2] + '"><video src="./' + esc(src) + '" muted playsinline preload="auto" controls></video><figcaption>' + esc(o[1]) + ' ' + verdict(st) + '</figcaption></figure>';
      }).join('') + '</div>';
      var m = mod();
      if (m.forecast) { h += '<p class="hw-note">' + chip(state.model) + ' forecast that the ball ends at ' + vec(m.forecast.predicted, 2) + ' m; it ended at ' + vec(m.forecast.actual, 2) + ' m, ' + num(100 * m.forecast.error_m, 0) + ' cm away.</p>'; }
    }
    return h;
  }

  var RENDER = [stepTask, stepPrompt, stepFormat, stepAnswer, stepHarness, stepChecks, stepOutcome];
  function draw() {
    drawControls();
    panel.innerHTML = '<h3 class="hw-step-title">' + (state.step + 1) + '. ' + esc(STEPS[state.step]) + '</h3>' + RENDER[state.step]();
  }
  function go(step) { state.step = Math.max(0, Math.min(STEPS.length - 1, step)); draw(); }

  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button, [data-open]');
    if (!t || !root.contains(t)) { return; }
    if (t.hasAttribute('data-example')) { state.example = t.getAttribute('data-example'); draw(); }
    else if (t.hasAttribute('data-model')) { state.model = t.getAttribute('data-model'); draw(); }
    else if (t.hasAttribute('data-step')) { go(+t.getAttribute('data-step')); }
    else if (t.hasAttribute('data-go')) { go(state.step + (+t.getAttribute('data-go'))); root.scrollIntoView({ block: 'start', behavior: 'auto' }); }
    else if (t.hasAttribute('data-open')) {
      var d = panel.querySelector('.hw-sec[data-index="' + t.getAttribute('data-open') + '"]');
      if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); }
    } else if (t.classList.contains('hw-playall')) {
      panel.querySelectorAll('video').forEach(function (v) { v.currentTime = 0; var p = v.play(); if (p && p.catch) { p.catch(function () {}); } });
    }
  });
  root.addEventListener('keydown', function (ev) {
    if (ev.target.closest('pre, summary, input, textarea')) { return; }
    if (ev.key === 'ArrowRight') { go(state.step + 1); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { go(state.step - 1); ev.preventDefault(); }
  });
  draw();
})();
