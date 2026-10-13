/* Results block "toy_world_model": renders window.WM_TOY_RESULTS (written by
   scripts/wm_results_to_page.py in the simagent repository) into the table and
   three SVG charts: position error per model and split, the counterfactual
   speed sweep against PhysX truths, and one predicted-versus-true trajectory.
   Vanilla JS, no dependencies; works from file://. */
(function () {
  'use strict';
  var R = window.WM_TOY_RESULTS;
  var table = document.getElementById('toy-results-table');
  var host = document.getElementById('toy-results');
  if (!R || !table || !host) return;
  var C = (window.WM && window.WM.colors) || { red: '#d7263d', blue: '#1f6feb', amber: '#f5a623', muted: '#767676', border: '#d9dee5', text: '#333' };
  var SPLITS = ['test_seen_rooms', 'test_new_rooms', 'train'];
  var COLS = [['position_rmse_moving_m', 'Position RMSE, moved objects (m)', 2], ['endpoint_error_acted_median_m', 'End-point error, median (m)', 2],
              ['rotation_error_moving_deg', 'Rotation error (deg)', 0], ['ghost_motion_rate', 'Ghost motion', 2]];
  var SVG = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, text) {
    var node = document.createElementNS(SVG, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function h(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function fmt(v, d) { return (typeof v === 'number') ? v.toFixed(d) : '-'; }

  /* ---------- table: baseline and the main variants (first configuration), one row each ---------- */
  function renderTable() {
    var primary = R.rows.filter(function (r) { return r.variant !== 'still'; })[0];
    var config = primary ? primary.config : null;
    var models = [];
    R.rows.forEach(function (r) {
      if ((r.variant === 'still' || r.config === config) && models.indexOf(r.model) < 0) models.push(r.model);
    });
    var cell = function (model, split, key) {
      var r = R.rows.filter(function (row) { return row.model === model && row.split === split; })[0];
      return r ? r[key] : null;
    };
    var columns = [['train', 'position_rmse_moving_m', 'RMSE, training (m)', 2],
                   ['test_seen_rooms', 'position_rmse_moving_m', 'RMSE, held-out tasks (m)', 2],
                   ['test_new_rooms', 'position_rmse_moving_m', 'RMSE, new rooms (m)', 2],
                   ['test_new_rooms', 'endpoint_error_acted_median_m', 'End point, new rooms (m)', 2],
                   ['test_new_rooms', 'rotation_error_moving_deg', 'Rotation, new rooms (deg)', 0],
                   ['test_new_rooms', 'ghost_motion_rate', 'Ghost motion, new rooms', 2]];
    table.innerHTML = '';
    var thead = h('thead'), tr = h('tr');
    ['Model'].concat(columns.map(function (c) { return c[2]; })).forEach(function (t) { tr.appendChild(h('th', null, t)); });
    thead.appendChild(tr); table.appendChild(thead);
    var tbody = h('tbody');
    var best = columns.map(function (c) {
      var vals = models.filter(function (m) { return m !== R.rows[0].model || R.rows[0].variant !== 'still'; })
        .map(function (m) { return cell(m, c[0], c[1]); }).filter(function (v) { return typeof v === 'number'; });
      return vals.length ? Math.min.apply(null, vals) : null;
    });
    models.forEach(function (m) {
      var isBase = R.rows.filter(function (r) { return r.model === m; })[0].variant === 'still';
      var row = h('tr', isBase ? 'wm-baseline' : null);
      row.appendChild(h('td', 'wm-model', m.replace(/ \((default losses|baseline)\)$/, '')));
      columns.forEach(function (c, i) {
        var v = cell(m, c[0], c[1]);
        var td = h('td', null, fmt(v, c[3]));
        if (!isBase && best[i] !== null && v === best[i]) td.className = 'wm-best';
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    var note = h('p', 'wm-note', 'Lower is better everywhere; blue marks the best model in each column. The loss ablations and the 0.22 M model are in the chart below.');
    table.parentNode.insertBefore(note, table.nextSibling);
  }

  /* ---------- chart helpers ---------- */
  function figure(title, svg, caption) {
    var fig = h('figure', 'wm-figure');
    var head = h('p', 'wm-chart-title', title); fig.appendChild(head);
    var scroll = h('div', 'wm-svg-scroll'); scroll.appendChild(svg); fig.appendChild(scroll);
    var cap = h('figcaption', null, caption); fig.appendChild(cap);
    return fig;
  }
  function axisY(svg, x0, y0, y1, vmax, unit, ticks) {
    svg.appendChild(el('line', { x1: x0, y1: y0, x2: x0, y2: y1, stroke: C.muted, 'stroke-width': 1 }));
    for (var i = 0; i <= ticks; i++) {
      var v = vmax * i / ticks, y = y1 - (y1 - y0) * i / ticks;
      svg.appendChild(el('line', { x1: x0 - 4, y1: y, x2: x0, y2: y, stroke: C.muted }));
      svg.appendChild(el('text', { x: x0 - 7, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: C.muted }, v.toFixed(vmax >= 1 ? 1 : 2)));
    }
    svg.appendChild(el('text', { x: x0 - 40, y: y0 - 8, 'font-size': 11, fill: C.muted }, unit));
  }

  /* ---------- chart 1: position RMSE per model and split ---------- */
  function renderBars() {
    var models = [];
    R.rows.forEach(function (r) { if (models.indexOf(r.model) < 0) models.push(r.model); });
    var W = 900, left = 56, right = 20, top = 20, bottom = 150, H = 380;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'wm-diagram', role: 'img', 'aria-label': 'Position RMSE per model and split' });
    var vmax = 0;
    R.rows.forEach(function (r) { if (r.position_rmse_moving_m > vmax) vmax = r.position_rmse_moving_m; });
    vmax = Math.ceil(vmax * 10) / 10;
    var y0 = top, y1 = H - bottom, plotW = W - left - right, group = plotW / models.length, bw = Math.min(22, (group - 10) / 3);
    axisY(svg, left, y0, y1, vmax, 'metres', 4);
    var colors = { test_seen_rooms: C.blue, test_new_rooms: C.red, train: '#b8c0ca' };
    models.forEach(function (m, i) {
      var gx = left + i * group + (group - 3 * bw) / 2;
      SPLITS.forEach(function (split, k) {
        var r = R.rows.filter(function (row) { return row.model === m && row.split === split; })[0];
        if (!r) return;
        var hgt = (y1 - y0) * r.position_rmse_moving_m / vmax;
        svg.appendChild(el('rect', { x: gx + k * bw, y: y1 - hgt, width: bw - 2, height: hgt, fill: colors[split], opacity: r.variant === 'still' ? 0.45 : 0.95 }));
      });
      var label = el('text', { x: gx + 1.5 * bw, y: y1 + 10, 'font-size': 10.5, fill: C.text, 'text-anchor': 'end', transform: 'rotate(-38 ' + (gx + 1.5 * bw) + ' ' + (y1 + 10) + ')' }, m);
      svg.appendChild(label);
    });
    var lx = left + 10;
    [['test_seen_rooms', 'held-out tasks, same rooms'], ['test_new_rooms', 'new rooms'], ['train', 'training samples']].forEach(function (pair, i) {
      svg.appendChild(el('rect', { x: lx + i * 230, y: y0 - 14, width: 12, height: 12, fill: colors[pair[0]] }));
      svg.appendChild(el('text', { x: lx + i * 230 + 16, y: y0 - 4, 'font-size': 11, fill: C.text }, pair[1]));
    });
    host.appendChild(figure('Position error over the objects that moved, lower is better',
      svg, 'RMSE between the predicted and the PhysX positions over the 60 frames, for the objects that actually moved. The baseline predicts that nothing moves. The training bars show how far each model fits its 96 samples; the two test bars show transfer.'));
  }

  /* ---------- chart 2: counterfactual speed sweep ---------- */
  function renderSweep() {
    var keys = Object.keys(R.counterfactual || {});
    var withSweep = keys.filter(function (k) { return R.counterfactual[k].sweep; });
    if (!withSweep.length) return;
    var sweep = R.counterfactual[withSweep[0]].sweep;
    var W = 900, H = 330, left = 56, right = 20, top = 24, bottom = 44;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'wm-diagram', role: 'img', 'aria-label': 'End point of the launched object against launch speed: PhysX truths and model predictions' });
    var speeds = [], ends = [];
    withSweep.forEach(function (k) { R.counterfactual[k].sweep.predictions.forEach(function (p) { speeds.push(p.speed_m_s); ends.push(p.end_x_m); }); });
    sweep.physx_truths.forEach(function (t) { speeds.push(t.speed_m_s); ends.push(t.end_x_m); });
    var smax = Math.ceil(Math.max.apply(null, speeds) * 2) / 2, emax = Math.ceil(Math.max.apply(null, ends) * 2) / 2;
    var x = function (s) { return left + (W - left - right) * s / smax; }, y = function (e) { return H - bottom - (H - bottom - top) * e / emax; };
    axisY(svg, left, top, H - bottom, emax, 'end point, x (m)', 4);
    svg.appendChild(el('line', { x1: left, y1: H - bottom, x2: W - right, y2: H - bottom, stroke: C.muted }));
    for (var s = 0; s <= smax + 1e-9; s += 0.5) {
      svg.appendChild(el('text', { x: x(s), y: H - bottom + 16, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, s.toFixed(1)));
    }
    svg.appendChild(el('text', { x: W - right, y: H - bottom + 32, 'text-anchor': 'end', 'font-size': 11, fill: C.muted }, 'launch speed (m/s)'));
    var palette = [C.blue, C.amber, '#9a4d8e', '#42949e'];
    withSweep.forEach(function (k, i) {
      var pts = R.counterfactual[k].sweep.predictions;
      var d = pts.map(function (p, j) { return (j ? 'L' : 'M') + x(p.speed_m_s).toFixed(1) + ',' + y(p.end_x_m).toFixed(1); }).join(' ');
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: palette[i % palette.length], 'stroke-width': 2.2 }));
      pts.forEach(function (p) { svg.appendChild(el('circle', { cx: x(p.speed_m_s), cy: y(p.end_x_m), r: 3.5, fill: palette[i % palette.length] })); });
      svg.appendChild(el('rect', { x: left + 12, y: top + 2 + i * 18, width: 14, height: 3, fill: palette[i % palette.length] }));
      svg.appendChild(el('text', { x: left + 32, y: top + 7 + i * 18, 'font-size': 11, fill: C.text }, 'model prediction: ' + k));
    });
    sweep.physx_truths.forEach(function (t) {
      svg.appendChild(el('circle', { cx: x(t.speed_m_s), cy: y(t.end_x_m), r: 5, fill: C.red, stroke: '#fff', 'stroke-width': 1.2 }));
    });
    svg.appendChild(el('circle', { cx: left + 19, cy: top + 7 + withSweep.length * 18, r: 5, fill: C.red }));
    svg.appendChild(el('text', { x: left + 32, y: top + 11 + withSweep.length * 18, 'font-size': 11, fill: C.text }, 'PhysX truth (recorded launches of this task)'));
    host.appendChild(figure('Counterfactual: change only the launch speed',
      svg, 'Task: "' + sweep.instruction + '" The model is asked the same scene with launch speeds it was never trained on, along the recorded launch direction; the red dots are every launch of this task that PhysX actually ran. The model never saw this task with these launches' + (sweep.split === 'train' ? ', though it saw the scene with other launches.' : '.')));
  }

  /* ---------- chart 3: one trajectory ---------- */
  function renderTrajectory() {
    var names = Object.keys(R.samples || {});
    var pick = null;
    for (var i = 0; i < names.length && !pick; i++) {
      var s = R.samples[names[i]].test_new_rooms;
      if (s && s.length) pick = { name: names[i], sample: s[0] };
    }
    if (!pick) return;
    var tru = pick.sample.true_displacement_m, pre = pick.sample.predicted_displacement_m;
    var mag = function (v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); };
    var W = 900, H = 300, left = 56, right = 20, top = 24, bottom = 44;
    var vmax = Math.ceil(Math.max.apply(null, tru.concat(pre).map(mag)) * 2) / 2 || 0.5;
    var x = function (t) { return left + (W - left - right) * t / (tru.length - 1); }, y = function (v) { return H - bottom - (H - bottom - top) * v / vmax; };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'wm-diagram', role: 'img', 'aria-label': 'Distance moved by the launched object over 60 frames: PhysX truth and model prediction' });
    axisY(svg, left, top, H - bottom, vmax, 'distance moved (m)', 4);
    svg.appendChild(el('line', { x1: left, y1: H - bottom, x2: W - right, y2: H - bottom, stroke: C.muted }));
    [0, 15, 30, 45, 59].forEach(function (t) { svg.appendChild(el('text', { x: x(t), y: H - bottom + 16, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, ((t + 1) / 30).toFixed(1) + ' s')); });
    [[tru, C.red, 'PhysX truth'], [pre, C.blue, 'model prediction']].forEach(function (series, i) {
      var d = series[0].map(function (v, t) { return (t ? 'L' : 'M') + x(t).toFixed(1) + ',' + y(mag(v)).toFixed(1); }).join(' ');
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: series[1], 'stroke-width': 2.2 }));
      svg.appendChild(el('rect', { x: left + 12, y: top + 2 + i * 18, width: 14, height: 3, fill: series[1] }));
      svg.appendChild(el('text', { x: left + 32, y: top + 7 + i * 18, 'font-size': 11, fill: C.text }, series[2]));
    });
    host.appendChild(figure('One unseen room: how far the launched object has moved, frame by frame',
      svg, 'Task ' + pick.sample.task_id.replace(/^b2_/, '').replace(/_/g, ' ') + ' (' + pick.name + '). A room the model never saw: the shape of the motion is roughly right, the distances are not.'));
  }

  function render() {
    renderTable();
    host.innerHTML = '';
    renderBars(); renderSweep(); renderTrajectory();
    host.hidden = false;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
