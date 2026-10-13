/* Renders the benchmark results (window.BM_RESULTS) into containers marked with data-bm attributes:
     data-bm="table"                         headline table, one row per task type
     data-bm="tiers"                         the three difficulty tiers with pass counts per tier
     data-bm="featured"                      the four featured examples (one static edit, a hard and a medium launch, a throw)
     data-bm="examples" data-type=...        example cards of one task type; data-skip-featured omits the featured ones
     data-bm="io" data-sample=...            what goes in and what comes out for one real attempt
     data-bm="status"                        what is complete and what is still running
   Example cards are horizontal grids: reference | GPT-5.4 | Qwen (launches, as clips that play together), or
   room overview | reference | GPT-5.4 | Qwen (static edits, close-ups; hover a close-up to see the room before the edit).
   Vanilla JS, no dependencies; works from file://. */
(function () {
  'use strict';
  var D = window.BM_RESULTS;
  if (!D) return;
  var P = D.providers, KEYS = Object.keys(P);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : ''; }
  function fmtVec(v) { return '(' + v.map(function (x) { return (Math.round(x * 100) / 100).toFixed(2); }).join(', ') + ')'; }
  function launches(list) {   /* one line per launched object; the spin only when there is one */
    if (!list || !list.length) return '';
    return list.map(function (a) {
      var spin = a.angular_velocity && a.angular_velocity.some(function (x) { return Math.abs(x) > 1e-9; });
      return '<span class="bm-launch">' + (list.length > 1 && a.label ? esc(a.label) + ': ' : 'launch ') + esc(fmtVec(a.linear_velocity)) + ' m/s' +
        (spin ? ', spin ' + esc(fmtVec(a.angular_velocity)) + ' rad/s' : '') + '</span>';
    }).join('');
  }
  function badge(status) {
    var cls = status === 'pass' ? 'pass' : (status === 'fail' ? 'fail' : 'noanswer');
    var text = status === 'pass' ? 'goal met' : (status === 'fail' ? 'goal failed' : (status === 'no answer' ? 'no usable answer' : status));
    return '<span class="bm-badge ' + cls + '">' + esc(text) + '</span>';
  }
  function checkList(lines) {
    if (!lines || !lines.length) return '';
    return '<ul class="bm-lines">' + lines.map(function (l) {
      var ok = l.indexOf('PASS') === 0, fail = l.indexOf('FAIL') === 0;
      return '<li class="' + (ok ? 'pass' : (fail ? 'fail' : 'req')) + '">' + esc(ok || fail ? l.slice(5) : l) + '</li>';
    }).join('') + '</ul>';
  }
  function reviewer(rev) {
    if (!rev || !rev.overall) return '';
    return '<p class="bm-reviewer"><b>Reviewer AI: ' + esc(rev.overall) + '.</b> ' + esc(rev.reason) + '</p>';
  }

  /* ---------- headline table ---------- */
  function renderTable(el) {
    var h = '<table class="table is-fullwidth bm-table"><thead><tr><th>Task type</th><th class="num">Tasks</th>';
    KEYS.forEach(function (k) { h += '<th class="num">' + esc(P[k]) + '<span class="sub">goal met</span></th>'; });
    h += '<th class="num">Random answers<span class="sub">average pass rate</span></th></tr></thead><tbody>';
    D.types.forEach(function (t) {
      if (!t.available) {
        h += '<tr><td>' + esc(t.label) + '<span class="sub">' + esc(t.blurb) + '</span></td><td class="muted" colspan="' + (KEYS.length + 2) + '">' + esc(t.note || 'in progress') + '</td></tr>';
        return;
      }
      var rates = {}, best = null;
      KEYS.forEach(function (k) { var m = t.models[k]; rates[k] = m.evaluated ? m.passed / t.tasks : -1; if (best === null || rates[k] > rates[best]) best = k; });
      var gap = rates[KEYS[0]] >= 0 && rates[KEYS[1]] >= 0 && Math.abs(rates[KEYS[0]] - rates[KEYS[1]]) >= 0.3;
      h += '<tr' + (gap && t.complete ? ' class="highlight"' : '') + '><td>' + esc(t.label) + '<span class="sub">' + esc(t.blurb) + '</span></td>';
      h += '<td class="num">' + t.tasks + '<span class="sub">' + t.rooms + ' rooms</span></td>';
      KEYS.forEach(function (k) {
        var m = t.models[k];
        if (m.evaluated === 0) { h += '<td class="num pending">in progress</td>'; return; }
        if (!t.complete) { h += '<td class="num pending">in progress<span class="sub">' + m.evaluated + ' of ' + t.tasks + ' done</span></td>'; return; }
        var cls = 'num' + (k === best ? ' best' : '') + (rates[k] < 0.4 ? ' weak' : '');
        h += '<td class="' + cls + '"><b>' + m.passed + '</b> of ' + t.tasks + ' <span class="pc">' + pct(m.passed, t.tasks) + '</span>' +
          (m.no_answer ? '<span class="sub">' + m.no_answer + ' without a usable answer</span>' : '') + '</td>';
      });
      h += '<td class="num">' + (t.chance_mean == null ? '<span class="muted">in progress</span>' : Math.round(100 * t.chance_mean) + '%' +
        (t.graded < t.tasks ? '<span class="sub">' + t.graded + ' of ' + t.tasks + ' tasks graded so far</span>' : '')) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="bm-legend"><span style="--bm-swatch:#eaf6ec">the better of the two</span><span style="--bm-swatch:#fdecee">under 40% of the tasks</span><span style="--bm-swatch:#fff8e8">the two models differ by 30 points or more</span></p>';
    el.innerHTML = h;
  }

  /* ---------- difficulty tiers ---------- */
  function renderTiers(el) {
    var tot = { easy: 0, medium: 0, hard: 0 }, passed = {};
    KEYS.forEach(function (k) { passed[k] = { easy: 0, medium: 0, hard: 0 }; });
    D.types.forEach(function (t) {
      if (!t.available || !t.complete || t.key === 'direct') return;   /* the direct-answer set repeats the launch and throw tasks */
      ['easy', 'medium', 'hard'].forEach(function (n) {
        tot[n] += t.tiers[n];
        KEYS.forEach(function (k) { passed[k][n] += t.models[k].tiers[n].passed; });
      });
    });
    el.innerHTML = [['hard', 'Hard'], ['medium', 'Medium'], ['easy', 'Easy']].map(function (pair) {
      var n = pair[0];
      return '<div class="bm-tier ' + n + '"><b>' + pair[1] + ': ' + tot[n] + ' tasks</b><small>' + esc(D.difficulty[n]) + '</small>' +
        KEYS.map(function (k) { return '<div class="bm-tierrow"><span>' + esc(P[k]) + '</span><span>' + passed[k][n] + ' of ' + tot[n] + '</span></div>'; }).join('') + '</div>';
    }).join('');
  }

  /* ---------- example cards ---------- */
  function header(ex, headline) {
    var meta = 'Room ' + ex.room + (ex.tier ? ' · ' + ex.tier + ': random answers pass ' + Math.round(100 * ex.chance) + '% of the time' : '');
    return '<div class="bm-cardhead">' + (headline ? '<span class="bm-kicker">' + esc(headline) + '</span>' : '') +
      '<h4>' + esc(ex.family_label) + '</h4><p class="bm-instruction">"' + esc(ex.instruction) + '"</p><p class="bm-meta">' + meta + '</p></div>';
  }
  function dynamicCard(ex, headline) {
    var cols = [];
    cols.push('<div class="bm-col"><figure><video src="./' + ex.truth.video + '" poster="./' + ex.truth.poster + '" muted playsinline preload="metadata" aria-label="Reference launch in the simulator"></video>' +
      '<figcaption><b>Reference</b> <span class="bm-badge truth">' + (ex.truth.launch && ex.truth.launch.length > 1 ? 'one set of launches that works' : 'one launch that works') + '</span>' + launches(ex.truth.launch) + '</figcaption></figure>' +
      '<p class="bm-what">What is checked</p>' + checkList(ex.truth.requirements) + '</div>');
    KEYS.forEach(function (k) {
      var m = ex.models[k];
      var media = m.video ? '<video src="./' + m.video + '" poster="./' + m.poster + '" muted playsinline preload="metadata" aria-label="' + esc(P[k]) + ' launch in the simulator"></video>'
        : '<div class="bm-noimg"><span>' + esc(m.error || 'no usable answer') + '</span></div>';
      cols.push('<div class="bm-col"><figure>' + media + '<figcaption><b>' + esc(P[k]) + '</b> ' + badge(m.status) + launches(m.answer) + '</figcaption></figure>' +
        '<p class="bm-what">Measured</p>' + (m.lines.length ? checkList(m.lines) : '<p class="bm-meta">nothing to simulate</p>') +
        (m.forecast_error_m != null ? '<p class="bm-meta">Its own forecast of where the launched object ends: off by ' + m.forecast_error_m + ' m.</p>' : '') + reviewer(m.reviewer) + '</div>');
    });
    var note = ex.closeup ? '<p class="bm-meta">Close-up replay of the recorded simulations, framed on the objects that matter here.</p>' : '';
    return '<div class="bm-card bm-dynamic">' + header(ex, headline) + note +
      '<div class="bm-playrow"><button class="button is-small is-light" type="button">Play all three together</button><span class="bm-meta">or hover over the clips</span></div>' +
      '<div class="bm-cols bm-cols-3">' + cols.join('') + '</div></div>';
  }
  function swapImage(src, before, alt) {
    if (!before) return '<img src="./' + src + '" alt="' + esc(alt) + '" loading="lazy">';
    return '<div class="bm-swap"><img src="./' + src + '" alt="' + esc(alt) + '" loading="lazy"><img class="bm-before" src="./' + before + '" alt="the same view before the edit" loading="lazy"><span class="bm-hint">hover: before the edit</span></div>';
  }
  function staticCard(ex, headline) {
    var before = ex.truth.closeup_before;
    var cols = ['<div class="bm-col"><figure><img src="./' + ex.truth.overview + '" alt="The room before the edit" loading="lazy"><figcaption><b>The room</b> before the edit; the close-ups show the outlined area</figcaption></figure>' +
      '<p class="bm-what">What is checked</p>' + checkList(ex.truth.requirements.concat(['nothing overlaps, everything stays put after one second of physics'])) + '</div>'];
    cols.push('<div class="bm-col"><figure>' + swapImage(ex.truth.closeup_truth, before, 'Reference answer, close-up') + '<figcaption><b>Reference</b> <span class="bm-badge truth">one answer that works</span></figcaption></figure></div>');
    KEYS.forEach(function (k) {
      var m = ex.models[k];
      var media = m.closeup ? swapImage(m.closeup, before, P[k] + ' answer, close-up') : '<div class="bm-noimg"><span>' + esc(m.error || 'no usable answer') + '</span></div>';
      cols.push('<div class="bm-col"><figure>' + media + '<figcaption><b>' + esc(P[k]) + '</b> ' + badge(m.status) + '</figcaption></figure>' +
        (m.lines.length ? '<p class="bm-what">Measured</p>' + checkList(m.lines) : '') + reviewer(m.reviewer) + '</div>');
    });
    return '<div class="bm-card bm-static">' + header(ex, headline) + '<div class="bm-cols bm-cols-4">' + cols.join('') + '</div></div>';
  }
  function card(ex, headline) { return ex.type === 'static' ? staticCard(ex, headline) : dynamicCard(ex, headline); }

  function bindVideos(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.bm-dynamic'), function (c) {
      var vids = c.querySelectorAll('video');
      function playAll() { Array.prototype.forEach.call(vids, function (v) { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); }); }
      function stopAll() { Array.prototype.forEach.call(vids, function (v) { v.pause(); }); }
      var grid = c.querySelector('.bm-cols');
      grid.addEventListener('mouseenter', playAll);
      grid.addEventListener('mouseleave', stopAll);
      var btn = c.querySelector('.bm-playrow button');
      if (btn) btn.addEventListener('click', playAll);
      Array.prototype.forEach.call(vids, function (v) { v.addEventListener('click', playAll); });
    });
  }
  function renderFeatured(el) {
    el.innerHTML = (D.featured || []).map(function (ex) { return card(ex, ex.headline); }).join('');
    bindVideos(el);
  }
  function renderExamples(el) {
    var type = el.getAttribute('data-type'), limit = parseInt(el.getAttribute('data-limit') || '99', 10);
    var skip = el.hasAttribute('data-skip-featured') ? (D.featured || []).map(function (f) { return f.task_id; }) : [];
    var list = (D.examples[type] || []).filter(function (ex) { return skip.indexOf(ex.task_id) < 0; }).slice(0, limit);
    if (!list.length) { el.innerHTML = '<p class="bm-meta">Examples will appear here when the simulations are finished.</p>'; return; }
    el.innerHTML = list.map(function (ex) { return card(ex); }).join('');
    bindVideos(el);
  }

  /* ---------- what goes in, what comes out ---------- */
  function renderIO(el) {
    var s = D.pipeline[el.getAttribute('data-sample') || 'static'];
    if (!s) return;
    var h = '<div class="bm-box"><h5>In: the instruction</h5><p>"' + esc(s.instruction) + '"</p></div>';
    h += '<div class="bm-box"><h5>In: two rendered views</h5><div class="bm-inputs">' + s.view_images.map(function (src, i) { return '<img src="./' + src + '" alt="input view ' + (i + 1) + '" loading="lazy">'; }).join('') + '</div></div>';
    h += '<div class="bm-box"><h5>In: the scene as a list of ' + s.objects + ' objects</h5><pre>' + esc(JSON.stringify(s.object_row)) + '\n... one row per object: name, position, size, mass, friction</pre></div>';
    h += '<div class="bm-box"><h5>Out: ' + (s.program_lines ? 'a short program whose result is the launch' : 'the new poses') + '</h5><pre>' + esc(JSON.stringify(s.answer, null, 1)) + '</pre></div>';
    h += '<div class="bm-box"><h5>Then: the simulator measures</h5>' + checkList(s.checks) + '<p class="bm-meta">Verdict: ' + badge(s.status) + '</p>' + reviewer(s.reviewer) + '</div>';
    el.innerHTML = h;
  }

  /* ---------- what topples a chair (composite tasks) ---------- */
  function renderChairs(el) {
    var C = D.chair_patterns;
    if (!C) { el.innerHTML = ''; return; }
    function cell(x, strong) {
      if (!x[1]) return '<td class="num muted">none</td>';
      var r = x[0] / x[1], cls = 'num' + (strong ? (r >= 0.7 ? ' best' : (r < 0.3 ? ' weak' : '')) : '');
      return '<td class="' + cls + '"><b>' + Math.round(100 * r) + '%</b> <span class="pc">' + x[0] + ' of ' + x[1] + '</span></td>';
    }
    var h = '<table class="table is-fullwidth bm-table"><thead><tr><th>Horizontal push given to the chair</th><th class="num">Random launches<span class="sub">share that toppled the chair</span></th>' +
      '<th class="num">' + esc(P.gpt54) + '<span class="sub">its chair launches that toppled</span></th><th class="num">' + esc(P.qwen30t) + '<span class="sub">its chair launches that toppled</span></th></tr></thead><tbody>';
    C.bins.forEach(function (b, k) {
      h += '<tr' + (k < 2 ? ' class="highlight"' : '') + '><td>' + esc(b) + '</td>' + cell(C.rows.random[k], true) + cell(C.rows.gpt54[k]) + cell(C.rows.qwen30t[k]) + '</tr>';
    });
    el.innerHTML = h + '</tbody></table>';
  }

  /* ---------- status ---------- */
  function renderStatus(el) {
    var items = D.types.map(function (t) {
      if (!t.available) return esc(t.label) + ': in progress';
      var pending = KEYS.map(function (k) { return t.models[k].pending; }).reduce(function (a, b) { return a + b; }, 0);
      return esc(t.label) + ': ' + (pending ? 'in progress (' + (t.tasks * KEYS.length - pending) + ' of ' + (t.tasks * KEYS.length) + ' attempts scored)' : 'complete');
    });
    el.innerHTML = '<ul class="bm-status-list">' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul><p class="bm-meta">Updated ' + esc(D.generated_at) + '.</p>';
  }

  function run() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-bm]'), function (el) {
      var kind = el.getAttribute('data-bm');
      if (kind === 'table') renderTable(el);
      else if (kind === 'tiers') renderTiers(el);
      else if (kind === 'featured') renderFeatured(el);
      else if (kind === 'examples') renderExamples(el);
      else if (kind === 'io') renderIO(el);
      else if (kind === 'status') renderStatus(el);
      else if (kind === 'chairs') renderChairs(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
