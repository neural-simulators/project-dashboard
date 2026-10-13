/* Renders the benchmark results (window.BM_RESULTS) into containers marked with data-bm attributes:
     data-bm="table"                    headline table, one row per task type
     data-bm="tiers"                    the three difficulty tiers with pass counts per tier
     data-bm="examples" data-type=...   example cards of one task type (data-limit caps the number)
     data-bm="io" data-sample=...       what goes in and what comes out for one real attempt
     data-bm="status"                   what is complete, running and planned
   Vanilla JS, no dependencies; works from file://. */
(function () {
  'use strict';
  var D = window.BM_RESULTS;
  if (!D) return;
  var P = D.providers, KEYS = Object.keys(P);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : ''; }
  function fmtVec(v) { return '[' + v.map(function (x) { return (Math.round(x * 100) / 100).toFixed(2); }).join(', ') + ']'; }
  function badge(status) {
    var cls = status === 'pass' ? 'pass' : (status === 'fail' ? 'fail' : 'noanswer');
    var text = status === 'pass' ? 'passed' : (status === 'fail' ? 'failed' : (status === 'no answer' ? 'no usable answer' : status));
    return '<span class="bm-badge ' + cls + '">' + esc(text) + '</span>';
  }
  function reviewerBadge(rev) {
    if (!rev || !rev.overall) return '';
    return '<span class="bm-badge reviewer">reviewer: ' + esc(rev.overall) + '</span>';
  }

  /* ---------- headline table ---------- */
  function renderTable(el) {
    var h = '<table class="table is-fullwidth bm-table"><thead><tr><th>Task type</th><th>Tasks</th>';
    KEYS.forEach(function (k) { h += '<th>' + esc(P[k]) + '<span class="sub">goal met</span></th>'; });
    h += '<th>Random answers<span class="sub">average pass rate</span></th><th>Hard tasks<span class="sub">random under 15%</span></th></tr></thead><tbody>';
    D.types.forEach(function (t) {
      if (!t.available) {
        h += '<tr><td>' + esc(t.label) + '<span class="sub">' + esc(t.blurb) + '</span></td><td class="muted" colspan="' + (KEYS.length + 3) + '">' + esc(t.note || 'pending') + '</td></tr>';
        return;
      }
      var rates = {}, best = null;
      KEYS.forEach(function (k) { var m = t.models[k]; rates[k] = m.evaluated ? m.passed / t.tasks : -1; if (best === null || rates[k] > rates[best]) best = k; });
      var gap = KEYS.length > 1 && rates[KEYS[0]] >= 0 && rates[KEYS[1]] >= 0 && Math.abs(rates[KEYS[0]] - rates[KEYS[1]]) >= 0.3;
      h += '<tr' + (gap ? ' class="highlight"' : '') + '><td>' + esc(t.label) + '<span class="sub">' + esc(t.blurb) + '</span></td>';
      h += '<td class="num">' + t.tasks + '<span class="sub">' + t.rooms + ' rooms, ' + t.families + ' task families</span></td>';
      KEYS.forEach(function (k) {
        var m = t.models[k];
        if (m.pending > 0 && m.evaluated === 0) { h += '<td class="num pending">running</td>'; return; }
        var cls = 'num' + (k === best && t.complete ? ' best' : '') + (rates[k] >= 0 && rates[k] < 0.4 ? ' weak' : '');
        var cell = m.passed + ' / ' + (m.pending > 0 ? m.evaluated : t.tasks) + ' (' + pct(m.passed, m.pending > 0 ? m.evaluated : t.tasks) + ')';
        var sub = [];
        if (m.no_answer) sub.push(m.no_answer + ' no usable answer');
        if (m.pending) sub.push(m.pending + ' still running');
        h += '<td class="' + cls + '">' + cell + (sub.length ? '<span class="sub">' + esc(sub.join(', ')) + '</span>' : '') + '</td>';
      });
      h += '<td class="num">' + (t.chance_mean == null ? '<span class="muted">not graded</span>' : Math.round(100 * t.chance_mean) + '%') +
        (t.graded < t.tasks ? '<span class="sub">' + t.graded + ' of ' + t.tasks + ' graded</span>' : '') + '</td>';
      h += '<td class="num">' + (t.tiers ? t.tiers.hard + ' of ' + t.graded : '') + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="bm-legend"><span style="--bm-swatch:#eaf6ec">best of the two on a finished set</span><span style="--bm-swatch:#fdecee">under 40% of the tasks</span><span style="--bm-swatch:#fff8e8">row where the two models differ by 30 points or more</span></p>';
    el.innerHTML = h;
  }

  /* ---------- difficulty tiers ---------- */
  function renderTiers(el) {
    var tot = { easy: 0, medium: 0, hard: 0 }, passed = {};
    KEYS.forEach(function (k) { passed[k] = { easy: 0, medium: 0, hard: 0 }; });
    D.types.forEach(function (t) {
      if (!t.available || t.key === 'direct') return;   /* the direct-answer set repeats the launch and throw tasks */
      ['easy', 'medium', 'hard'].forEach(function (n) {
        tot[n] += t.tiers[n];
        KEYS.forEach(function (k) { passed[k][n] += t.models[k].tiers[n].passed; });
      });
    });
    var h = '';
    [['hard', 'Hard'], ['medium', 'Medium'], ['easy', 'Easy']].forEach(function (pair) {
      var n = pair[0];
      h += '<div class="bm-tier ' + n + '"><b>' + pair[1] + ': ' + tot[n] + ' tasks</b><small>' + esc(D.difficulty[n]) + '</small><br>' +
        KEYS.map(function (k) { return '<small>' + esc(P[k]) + ': ' + passed[k][n] + ' of ' + tot[n] + '</small>'; }).join('<br>') + '</div>';
    });
    el.innerHTML = h;
  }

  /* ---------- example cards ---------- */
  function staticCard(ex) {
    var h = '<div class="bm-grid">';
    h += '<figure><img src="./' + ex.media.before + '" alt="Room before the edit" loading="lazy"><figcaption>Before (what the model sees)</figcaption></figure>';
    h += '<figure><img src="./' + ex.media.truth + '" alt="Reference answer" loading="lazy"><figcaption>Ground truth: one reference answer</figcaption></figure>';
    KEYS.forEach(function (k) {
      var m = ex.models[k];
      h += '<figure>' + (m.media.after ? '<img src="./' + m.media.after + '" alt="' + esc(P[k]) + ' result" loading="lazy">' : '<div class="bm-noimg"></div>') +
        '<figcaption>' + esc(P[k]) + ' ' + badge(m.status) + ' ' + reviewerBadge(m.reviewer) + '</figcaption></figure>';
    });
    h += '</div>';
    return h;
  }
  function launchFigure(src, video, caption) {
    if (video) {
      return '<figure><video src="./' + video + '" poster="./' + src + '" muted loop playsinline preload="none" controls aria-label="' + esc(caption) + '"></video><figcaption>' + caption + '</figcaption></figure>';
    }
    return '<figure><img src="./' + src + '" alt="' + esc(caption) + '" loading="lazy"><figcaption>' + caption + '</figcaption></figure>';
  }
  function dynamicCard(ex) {
    var h = '<div class="bm-strips">';
    var truthCap = 'Ground truth: the simulator run of one reference launch' + (ex.truth_launch && ex.truth_launch[0] ? ' (' + fmtVec(ex.truth_launch[0].linear_velocity) + ' m/s)' : '');
    h += launchFigure(ex.media.truth_strip, ex.media.truth_video, truthCap);
    KEYS.forEach(function (k) {
      var m = ex.models[k];
      var cap = esc(P[k]) + ' ' + badge(m.status) + ' ' + reviewerBadge(m.reviewer);
      if (m.answer && m.answer.length) cap += ' <small>launch ' + m.answer.map(function (a) { return fmtVec(a.linear_velocity); }).join(' ') + ' m/s</small>';
      if (m.media.strip) h += launchFigure(m.media.strip, m.media.video, cap);
      else h += '<figure><div class="bm-lines"><li class="fail">' + esc(m.error || 'no usable answer') + '</li></div><figcaption>' + cap + '</figcaption></figure>';
    });
    h += '</div>';
    return h;
  }
  function detailBlock(ex) {
    var h = '<div class="bm-io">';
    KEYS.forEach(function (k) {
      var m = ex.models[k];
      h += '<div class="bm-box"><h5>' + esc(P[k]) + ' ' + badge(m.status) + '</h5>';
      if (m.lines && m.lines.length) h += '<ul class="bm-lines">' + m.lines.map(function (l) { return '<li class="' + (l.indexOf('PASS') === 0 ? 'pass' : 'fail') + '">' + esc(l.slice(5)) + '</li>'; }).join('') + '</ul>';
      else if (m.error) h += '<ul class="bm-lines"><li class="fail">' + esc(m.error) + '</li></ul>';
      if (m.forecast_error_m != null) h += '<p class="bm-meta">Its own forecast of the end point was off by ' + m.forecast_error_m + ' m.</p>';
      if (m.reviewer && m.reviewer.reason) h += '<p class="bm-reviewer">Reviewer (' + esc(m.reviewer.overall) + '): ' + esc(m.reviewer.reason) + '</p>';
      if (m.answer) h += '<details class="bm-more"><summary>the answer as sent</summary><pre>' + esc(JSON.stringify(m.answer, null, 1)) + '</pre></details>';
      h += '</div>';
    });
    return h + '</div>';
  }
  function renderExamples(el) {
    var type = el.getAttribute('data-type'), limit = parseInt(el.getAttribute('data-limit') || '99', 10);
    var list = (D.examples[type] || []).slice(0, limit);
    if (!list.length) { el.innerHTML = '<p class="bm-meta">No evaluated examples of this type yet.</p>'; return; }
    el.innerHTML = list.map(function (ex) {
      var meta = 'Room ' + ex.room + ' · ' + esc(ex.family_label) + (ex.tier ? ' · ' + ex.tier + ' (random answers pass ' + Math.round(100 * ex.chance) + '% of the time)' : '');
      return '<div class="bm-card"><h4>' + esc(ex.family_label) + '</h4><p class="bm-instruction">"' + esc(ex.instruction) + '"</p><p class="bm-meta">' + meta + '</p>' +
        (ex.type === 'static' ? staticCard(ex) : dynamicCard(ex)) + detailBlock(ex) + '</div>';
    }).join('');
    /* hover plays every video of a card together */
    Array.prototype.forEach.call(el.querySelectorAll('.bm-card'), function (card) {
      var vids = card.querySelectorAll('video');
      if (!vids.length) return;
      card.addEventListener('mouseenter', function () { Array.prototype.forEach.call(vids, function (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }); });
      card.addEventListener('mouseleave', function () { Array.prototype.forEach.call(vids, function (v) { v.pause(); }); });
    });
  }

  /* ---------- what goes in, what comes out ---------- */
  function renderIO(el) {
    var s = D.pipeline[el.getAttribute('data-sample') || 'static'];
    if (!s) return;
    var h = '<div class="bm-box"><h5>In: the instruction</h5><p>"' + esc(s.instruction) + '"</p></div>';
    h += '<div class="bm-box"><h5>In: two rendered views</h5><div class="bm-inputs">' + s.view_images.map(function (src, i) { return '<img src="./' + src + '" alt="input view ' + (i + 1) + '" loading="lazy">'; }).join('') + '</div></div>';
    h += '<div class="bm-box"><h5>In: the scene as a list of objects (' + s.objects + ' rows, about ' + (s.prompt_tokens ? Math.round(s.prompt_tokens / 1000) + ',000' : '10,000') + ' tokens with the rules)</h5><pre>' + esc(JSON.stringify(s.object_row)) + '\n... one row per object: id, label, pose, size, mass, friction</pre></div>';
    h += '<div class="bm-box"><h5>Out: ' + (s.program_lines ? 'a small program (' + s.program_lines + ' lines) whose result is the launch' : 'the new poses as JSON') + '</h5><pre>' + esc(JSON.stringify(s.answer, null, 1)) + '</pre>' +
      (s.reasoning_tokens ? '<p class="bm-meta">' + esc(s.provider) + ' used ' + s.reasoning_tokens.toLocaleString() + ' hidden reasoning tokens for ' + s.answer_tokens + ' answer tokens.</p>' : '') + '</div>';
    h += '<div class="bm-box"><h5>Then: the simulator measures</h5><ul class="bm-lines">' + s.checks.map(function (l) { return '<li class="' + (l.indexOf('PASS') === 0 ? 'pass' : 'fail') + '">' + esc(l.slice(5)) + '</li>'; }).join('') + '</ul>' +
      '<p class="bm-meta">Verdict: ' + badge(s.status) + (s.reviewer ? ' ' + reviewerBadge(s.reviewer) + '<br>' + esc(s.reviewer.reason) : '') + '</p></div>';
    el.innerHTML = h;
  }

  /* ---------- status ---------- */
  function renderStatus(el) {
    var items = [];
    D.types.forEach(function (t) {
      if (!t.available) { items.push(esc(t.label) + ': ' + esc(t.note || 'planned')); return; }
      var pending = KEYS.map(function (k) { return t.models[k].pending; }).reduce(function (a, b) { return a + b; }, 0);
      items.push(esc(t.label) + ': ' + (pending ? pending + ' of ' + (t.tasks * KEYS.length) + ' attempts still being simulated' : 'complete'));
    });
    el.innerHTML = '<ul class="bm-status-list">' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul><p class="bm-meta">Data generated ' + esc(D.generated_at) + '.</p>';
  }

  function run() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-bm]'), function (el) {
      var kind = el.getAttribute('data-bm');
      if (kind === 'table') renderTable(el);
      else if (kind === 'tiers') renderTiers(el);
      else if (kind === 'examples') renderExamples(el);
      else if (kind === 'io') renderIO(el);
      else if (kind === 'status') renderStatus(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
