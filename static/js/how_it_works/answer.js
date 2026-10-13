/* What comes back, and what the simulator does with it (canvas). Three columns: reference, GPT-5.4, Qwen3-VL-30B Thinking.
   Phase 1: the real answer types out (JSON poses, an excerpt of the program with its real line numbers, or the launch as numbers).
   Phase 2: the simulator plays it: a floor plan where the moved objects slide and turn into the answered poses, or a side
   view where the ball follows its recorded PhysX path. Phase 3: the measured checks light up and the verdict appears. */
(function () {
  'use strict';
  var WM = window.WM, D = window.HW_DATA;
  var root = document.getElementById('hw-anim-answer');
  if (!root || !WM || !D) return;
  var canvas = root.querySelector('canvas'), btn = root.querySelector('button.hw-play'), cap = root.querySelector('.wm-caption');
  var switches = root.querySelectorAll('.hw-switch .button');
  var COL = { ref: '#2b8a3e', gpt54: '#1f6feb', qwen30t: '#c2255c' };
  var INK = '#222', MUTED = '#767676', BORDER = '#d9dee5', RED = '#d7263d', PASSC = '#1b6f3a';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', SANS = '"Noto Sans", sans-serif';
  var OBJ = { 'brown table': '#a9744f', 'red chair': '#d7263d', 'yellow cup': '#f2c230', 'purple cup': '#7b3fb3', 'orange book': '#f08c00', 'pink vase': '#e64980', 'green sofa': '#3a8a4a' };
  var key = 'static', ex, cols, phases, panelH = 104, st = { phase: 0, t: 0 }, lastCap = null;

  function vec(v, d) { return '[' + v.map(function (x) { return (Math.round(x * 1000) / 1000).toFixed(d == null ? 2 : d); }).join(', ') + ']'; }
  function labelOf(id) { var o = (ex.plan ? ex.plan.before : []).filter(function (p) { return p.id === id; })[0]; return o ? o.label : (id === 'o024' ? 'red ball' : id); }
  function headingOf(list, id) { var o = list.filter(function (p) { return p.id === id; })[0]; return o ? o.heading : 0; }
  function poseLines(changes, after) {
    var out = [];
    changes.forEach(function (c) {
      out.push({ t: c.id + '  ' + labelOf(c.id), cls: 'head' });
      if (c.position) out.push({ t: '  position ' + vec(c.position), cls: 'val' });
      if (c.quaternion_wxyz) {
        var turn = Math.round((headingOf(after, c.id) - headingOf(ex.plan.before, c.id)) * 180 / Math.PI);
        turn = ((turn + 540) % 360) - 180;
        out.push({ t: '  rotation ' + vec(c.quaternion_wxyz), cls: 'val' });
        out.push({ t: '  (turned ' + Math.abs(turn) + '°)', cls: 'note' });
      }
    });
    return out;
  }
  function build() {
    ex = D.examples[key];
    var refChecks = (ex.models.gpt54.checks || []).map(function (l) { return 'PASS ' + l.slice(5); });
    cols = [{ id: 'ref', name: 'Reference', sub: 'one answer that works' }];
    ['gpt54', 'qwen30t'].forEach(function (p) {
      var m = ex.models[p];
      cols.push({ id: p, name: D.providers[p], sub: 'thought for ' + (m.reasoning_tokens || 0).toLocaleString() + ' hidden tokens', m: m });
    });
    cols.forEach(function (c) {
      var m = c.m, lines = [];
      if (key === 'static') {
        lines = c.id === 'ref' ? poseLines(ex.reference.answer, ex.reference.after) : poseLines(m.answer, m.after);
        c.after = c.id === 'ref' ? ex.reference.after : m.after;
      } else if (key === 'code') {
        if (c.id === 'ref') {
          lines = [{ t: 'a launch worked out by', cls: 'note' }, { t: 'the benchmark authors', cls: 'note' }, { t: 'and checked in PhysX:', cls: 'note' },
                   { t: '', cls: 'val' }, { t: 'velocity ' + vec(ex.reference.answer[0].linear_velocity) + ' m/s', cls: 'out' }];
        } else {
          lines.push({ t: 'program, ' + m.program_lines + ' lines; excerpt:', cls: 'note' });
          m.excerpt.forEach(function (block, b) {
            if (b) lines.push({ t: '   ⋮', cls: 'note' });
            block.lines.forEach(function (l, k) { lines.push({ t: String(block.from + k).padStart(3, ' ') + ' ' + l.replace(/^    /, ''), cls: 'code' }); });
          });
          lines.push({ t: 'returns ' + vec(m.launch[0].linear_velocity) + ' m/s', cls: 'out' });
        }
      } else {
        if (c.id === 'ref') {
          lines = [{ t: 'a launch worked out by', cls: 'note' }, { t: 'the benchmark authors', cls: 'note' }, { t: 'and checked in PhysX:', cls: 'note' },
                   { t: '', cls: 'val' }, { t: '"linear_velocity": ' + vec(ex.reference.answer[0].linear_velocity), cls: 'out' }];
        } else {
          var a = JSON.parse(m.answer_text);
          lines = [{ t: '{"id": "' + a.id + '",', cls: 'val' }, { t: ' "linear_velocity": ' + JSON.stringify(a.linear_velocity) + ',', cls: 'out' },
                   { t: ' "angular_velocity": ' + JSON.stringify(a.angular_velocity) + ',', cls: 'val' }, { t: ' "reason": "' + a.reason + '"}', cls: 'reason' }];
        }
      }
      c.lines = lines;
      c.checks = c.id === 'ref' ? refChecks : (m.checks || []);
      c.status = c.id === 'ref' ? 'pass' : m.status;
      c.path = key === 'static' ? null : (c.id === 'ref' ? ex.reference.path : m.path);
    });
    panelH = { static: 104, code: 318, numbers: 206 }[key];
    phases = [{ name: 'type', dur: 5.0 }, { name: 'sim', dur: key === 'static' ? 2.4 : 3.2 }, { name: 'check', dur: 2.6 }, { name: 'hold', dur: 2.6 }];
  }
  build();
  function advance(dt) { st.t += dt; while (st.t >= phases[st.phase].dur) { st.t -= phases[st.phase].dur; st.phase = (st.phase + 1) % phases.length; } }
  function progress(name) {
    var idx = phases.map(function (p) { return p.name; }).indexOf(name);
    return st.phase > idx ? 1 : (st.phase < idx ? 0 : st.t / phases[idx].dur);
  }
  function fitLines(ctx, lines, maxW) {      /* wrap reasons, truncate code */
    var out = [];
    lines.forEach(function (l) {
      if (ctx.measureText(l.t).width <= maxW) { out.push(l); return; }
      if (l.cls === 'reason' || l.cls === 'note') {
        var words = l.t.split(' '), cur = '';
        words.forEach(function (w) { if (ctx.measureText(cur + ' ' + w).width > maxW && cur) { out.push({ t: cur, cls: l.cls }); cur = ' ' + w; } else cur += (cur ? ' ' : '') + w; });
        if (cur) out.push({ t: cur, cls: l.cls });
      } else {
        var t = l.t; while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
        out.push({ t: t + '…', cls: l.cls });
      }
    });
    return out;
  }
  /* ---- plan view (static edit) ---- */
  function anyMoved(id) {
    var o = ex.plan.before.filter(function (p) { return p.id === id; })[0];
    return cols.some(function (c) { var a = c.after.filter(function (p) { return p.id === id; })[0];
      return a && (Math.abs(a.x - o.x) + Math.abs(a.y - o.y) > 1e-4 || Math.abs(a.heading - o.heading) > 1e-3); });
  }
  function planBounds() {
    var xs = [], ys = [];
    var lists = [ex.plan.before].concat(cols.map(function (c) { return c.after; }));
    lists.forEach(function (list) { list.forEach(function (o) { if (o.label === 'green sofa') return; o.poly.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); }); });
    return { x0: Math.min.apply(null, xs) - 0.15, x1: Math.max.apply(null, xs) + 0.15, y0: Math.min.apply(null, ys) - 0.15, y1: Math.max.apply(null, ys) + 0.15 };
  }
  function drawPlan(ctx, c, x, y, w, h, q) {
    var b = planBounds(), s = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
    var ox = x + (w - s * (b.x1 - b.x0)) / 2, oy = y + (h - s * (b.y1 - b.y0)) / 2;
    function P(px, py) { return [ox + (px - b.x0) * s, oy + (b.y1 - py) * s]; }
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    var order = ['brown table', 'green sofa', 'red chair', 'yellow cup', 'purple cup', 'pink vase', 'orange book'];
    var before = ex.plan.before.slice().sort(function (a, b2) { return order.indexOf(a.label) - order.indexOf(b2.label); });
    before.forEach(function (o) {
      var a = c.after.filter(function (p) { return p.id === o.id; })[0] || o;
      var moved = Math.abs(a.x - o.x) + Math.abs(a.y - o.y) > 1e-4 || Math.abs(a.heading - o.heading) > 1e-3;
      var dh = (o.tilt_deg < 45 && a.tilt_deg < 45) ? a.heading - o.heading : 0;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      var e = WM.ease(q), cx = o.x + (a.x - o.x) * e, cy = o.y + (a.y - o.y) * e, ang = dh * e;
      function poly(cxx, cyy, an) { return o.poly.map(function (p) { var dx = p[0] - o.x, dy = p[1] - o.y; return P(cxx + dx * Math.cos(an) - dy * Math.sin(an), cyy + dx * Math.sin(an) + dy * Math.cos(an)); }); }
      if (moved) {          /* ghost of the starting pose */
        ctx.setLineDash([3, 3]); ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 1;
        var g = poly(o.x, o.y, 0); ctx.beginPath(); g.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      }
      var pts = poly(cx, cy, ang);
      ctx.fillStyle = OBJ[o.label] || '#adb5bd'; ctx.globalAlpha = o.label === 'brown table' ? 0.55 : (o.label === 'green sofa' ? 0.5 : 0.95);
      ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      if (moved) { ctx.strokeStyle = COL[c.id]; ctx.lineWidth = 2; ctx.stroke(); }
      if (anyMoved(o.id)) {            /* name the objects an answer moves */
        var lp = P(cx, cy); ctx.fillStyle = '#333'; ctx.font = '10.5px ' + SANS;
        var lt = o.label.replace(/^(red|orange|yellow|purple|pink) /, ''); ctx.fillText(lt, lp[0] - ctx.measureText(lt).width / 2, Math.max.apply(null, pts.map(function (pp) { return pp[1]; })) + 12);
      }
      if (o.front && o.tilt_deg < 45) {   /* the chair's front */
        var hd = o.heading + ang, c0 = P(cx, cy), L = 0.42;
        WM.arrow(ctx, c0[0], c0[1], c0[0] + Math.cos(hd) * L * s, c0[1] - Math.sin(hd) * L * s, '#000', 1.6, 6);
      }
    });
    if (c.m && c.m.book_height_above_table_m > 0.02 && q > 0.9) {
      var book = c.after.filter(function (p) { return p.label === 'orange book'; })[0], bp = P(book.x, book.y);
      var txt = 'book ' + Math.round(100 * c.m.book_height_above_table_m) + ' cm above the table';
      ctx.font = 'bold 11px ' + SANS; var tw = ctx.measureText(txt).width + 12;
      ctx.fillStyle = RED; WM.roundRect(ctx, Math.min(bp[0] - tw / 2, x + w - tw - 2), bp[1] - 34, tw, 18, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, Math.min(bp[0] - tw / 2, x + w - tw - 2) + 6, bp[1] - 21);
    }
    ctx.restore();
  }
  /* ---- side view (throw) ---- */
  function sideBounds() {
    var xs = [], zs = [0.4];
    cols.forEach(function (c) { c.path.forEach(function (p) { xs.push(p[0]); zs.push(p[2]); }); });
    ex.side.boxes.forEach(function (b) { xs.push(b.x - b.sx / 2, b.x + b.sx / 2); });
    return { x0: Math.min.apply(null, xs) - 0.2, x1: Math.max.apply(null, xs) + 0.2, z1: Math.max.apply(null, zs) + 0.2 };
  }
  function drawSide(ctx, c, x, y, w, h, q) {
    var b = sideBounds(), s = Math.min(w / (b.x1 - b.x0), (h - 14) / b.z1);
    var ox = x + (w - s * (b.x1 - b.x0)) / 2, floor = y + h - 10;
    function P(px, pz) { return [ox + (px - b.x0) * s, floor - pz * s]; }
    ctx.strokeStyle = MUTED; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, floor); ctx.lineTo(x + w, floor); ctx.stroke();
    ex.side.boxes.forEach(function (bx) {
      var p0 = P(bx.x - bx.sx / 2, bx.z + bx.sz / 2), p1 = P(bx.x + bx.sx / 2, bx.z - bx.sz / 2);
      ctx.fillStyle = bx.label.indexOf('barrier') >= 0 ? '#9aa3ad' : '#4a7fd6';
      ctx.fillRect(p0[0], p0[1], Math.max(2, p1[0] - p0[0]), Math.max(2, p1[1] - p0[1]));
    });
    var n = c.path.length, upto = Math.min(n - 1, Math.floor(q * (n - 1)));
    ctx.strokeStyle = COL[c.id]; ctx.lineWidth = 2; ctx.beginPath();
    for (var i = 0; i <= upto; i++) { var p = P(c.path[i][0], c.path[i][2]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    ctx.stroke();
    var cur = P(c.path[upto][0], c.path[upto][2]);
    ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(cur[0], cur[1], Math.max(3, ex.side.ball_radius * s), 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = MUTED; ctx.font = '11px ' + SANS; ctx.fillText('t = ' + (upto / 30).toFixed(2) + ' s', x + 4, y + 12);
  }
  function render() {
    var nChecks = Math.max.apply(null, cols.map(function (c) { return c.checks.length; }));
    var H = 46 + panelH + 12 + 196 + 18 + nChecks * 17 + 36, f = WM.fitCanvas(canvas, H), ctx = f.ctx, W = f.W;
    ctx.clearRect(0, 0, W, H);
    var gap = 12, cw = (W - 2 * gap - 8) / 3, small = cw < 220;
    var typeQ = progress('type'), simQ = progress('sim'), checkQ = progress('check');
    cols.forEach(function (c, k) {
      var x = 4 + k * (cw + gap);
      /* header */
      ctx.fillStyle = COL[c.id]; ctx.beginPath(); ctx.arc(x + 7, 16, 6, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = INK; ctx.font = 'bold ' + (small ? 12 : 14) + 'px ' + SANS; ctx.fillText(c.name, x + 18, 21);
      ctx.fillStyle = MUTED; ctx.font = (small ? 10 : 11.5) + 'px ' + SANS; ctx.fillText(c.sub, x + 18, 37);
      /* answer panel */
      var ay = 46, ah = panelH;
      ctx.fillStyle = key === 'code' && c.id !== 'ref' ? '#1f2430' : '#f6f8fa'; WM.roundRect(ctx, x, ay, cw, ah, 6); ctx.fill();
      ctx.strokeStyle = COL[c.id]; ctx.lineWidth = 1.5; WM.roundRect(ctx, x, ay, cw, ah, 6); ctx.stroke();
      var fs = key === 'code' ? (small ? 8.5 : 9.5) : (small ? 9.5 : 11); ctx.font = fs + 'px ' + MONO;
      var lines = fitLines(ctx, c.lines, cw - 16), total = lines.reduce(function (a, l) { return a + l.t.length; }, 0), budget = Math.floor(typeQ * total * 1.05);
      var maxLines = Math.floor((ah - 14) / (fs + 4));
      for (var i = 0; i < Math.min(lines.length, maxLines) && budget > 0; i++) {
        var l = lines[i], t = l.t.slice(0, budget); budget -= l.t.length;
        var dark = key === 'code' && c.id !== 'ref';
        ctx.fillStyle = l.cls === 'out' ? (dark ? '#ffd43b' : COL[c.id]) : (l.cls === 'note' || l.cls === 'reason' ? (dark ? '#a5b1c2' : MUTED) : (dark ? '#e9ecef' : INK));
        if (l.cls === 'out' || l.cls === 'head') ctx.font = 'bold ' + fs + 'px ' + MONO; else ctx.font = fs + 'px ' + MONO;
        ctx.fillText(t, x + 8, ay + 16 + i * (fs + 4));
      }
      /* simulator panel */
      var sy = ay + ah + 12, sh = 196;
      ctx.fillStyle = '#fff'; WM.roundRect(ctx, x, sy, cw, sh, 6); ctx.fill();
      ctx.strokeStyle = BORDER; ctx.lineWidth = 1; WM.roundRect(ctx, x, sy, cw, sh, 6); ctx.stroke();
      ctx.fillStyle = MUTED; ctx.font = '11px ' + SANS;
      ctx.fillText(key === 'static' ? 'in the simulator, seen from above' : 'in the simulator, seen from the side', x + 8, sy + 15);
      if (key === 'static') drawPlan(ctx, c, x + 6, sy + 20, cw - 12, sh - 26, simQ);
      else drawSide(ctx, c, x + 6, sy + 20, cw - 12, sh - 26, simQ);
      /* checks and verdict */
      var cy0 = sy + sh + 18, n = c.checks.length, shown = Math.ceil(checkQ * n);
      ctx.font = (small ? 10.5 : 12) + 'px ' + SANS;
      for (var j = 0; j < shown; j++) {
        var ok = c.checks[j].indexOf('PASS') === 0;
        ctx.fillStyle = ok ? PASSC : RED; ctx.font = 'bold ' + (small ? 10.5 : 12) + 'px ' + SANS; ctx.fillText(ok ? '✓' : '✗', x + 4, cy0 + j * 17);
        ctx.fillStyle = INK; ctx.font = (small ? 10.5 : 12) + 'px ' + SANS; ctx.fillText(c.checks[j].slice(5), x + 20, cy0 + j * 17);
      }
      if (checkQ >= 1) {
        var vy = cy0 + n * 17 + 4, txt = c.status === 'pass' ? 'GOAL MET' : 'GOAL FAILED';
        ctx.font = 'bold 13px ' + SANS; var tw = ctx.measureText(txt).width + 22;
        ctx.fillStyle = c.status === 'pass' ? '#eaf6ec' : '#fdecee'; WM.roundRect(ctx, x, vy, tw, 24, 12); ctx.fill();
        ctx.fillStyle = c.status === 'pass' ? PASSC : RED; ctx.fillText(txt, x + 11, vy + 17);
      }
    });
    var ph = phases[st.phase].name;
    var text = ph === 'type' ? (key === 'static' ? '1. Each model answers with new poses as JSON: which object moves where, and how it turns.'
                                                 : key === 'code' ? '1. Each model writes a program; the benchmark runs it and takes the launch velocity it returns.'
                                                                  : '1. Each model gives the launch velocity directly, as numbers, with a short stated reason.')
             : ph === 'sim' ? (key === 'static' ? '2. The simulator places the objects exactly as answered (dashed: where they started).'
                                                : '2. PhysX launches the red ball with that velocity and records two seconds of motion.')
             : '3. The measured checks decide. ' + cols.slice(1).map(function (c) { return c.name + ': ' + (c.status === 'pass' ? 'goal met' : 'goal failed') + '.'; }).join(' ');
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }
  function representative() { st.phase = 2; st.t = phases[2].dur * 0.99; }
  Array.prototype.forEach.call(switches, function (b) {
    b.addEventListener('click', function () {
      key = b.getAttribute('data-example');
      Array.prototype.forEach.call(switches, function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      build(); st.phase = 0; st.t = 0; lastCap = null; render();
    });
  });
  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
