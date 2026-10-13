/* What the model receives (canvas): the real prompt of one task, assembled section by section.
   Left: a minimap of the prompt text (one bar per 150 characters of text, coloured by section) that fills in as each
   section arrives. Right: a lens with the section's real text, the two images, and the share of the prompt so far.
   The buttons switch between three tasks (static edit; throw answered with a program; throw answered with numbers). */
(function () {
  'use strict';
  var WM = window.WM, D = window.HW_DATA;
  var root = document.getElementById('hw-anim-prompt');
  if (!root || !WM || !D) return;
  var canvas = root.querySelector('canvas'), btn = root.querySelector('button.hw-play'), cap = root.querySelector('.wm-caption');
  var switches = root.querySelectorAll('.hw-switch .button');
  var ROLE = { instruction: '#f59f00', images: '#12b886', rules: '#c3cad5', checks: '#7048e8', output: '#1098ad', scene: '#8da2c0' };
  var GPT = '#1f6feb', QWEN = '#c2255c', INK = '#222', MUTED = '#767676', BORDER = '#d9dee5';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', SANS = '"Noto Sans", sans-serif';
  var images = {};
  function image(src) {
    if (!images[src]) { var im = new Image(); im.onload = function () { render(); }; im.src = './' + src; images[src] = im; }
    return images[src];
  }
  var key = 'static', ex, steps, st = { step: 0, t: 0 }, lastCap = null;
  function build() {
    ex = D.examples[key];
    steps = ex.prompt.sections.map(function (s, i) {
      return { kind: 'section', i: i, enter: s.key === 'IMAGES' ? 0.4 : 0.9, dur: s.key === 'SCENE JSON' ? 4.2 : (s.key === 'IMAGES' ? 2.8 : 2.6) };
    });
    steps.push({ kind: 'send', enter: 0.4, dur: 3.4 });
    ex.prompt.sections.forEach(function (s) { if (s.views) s.views.forEach(image); });
  }
  build();
  function advance(dt) {
    st.t += dt;
    while (st.t >= steps[st.step].dur) { st.t -= steps[st.step].dur; st.step = (st.step + 1) % steps.length; }
  }
  function wrapText(ctx, text, maxW) {
    var out = [], line = '';
    String(text).split(/(\s+)/).forEach(function (w) {
      if (ctx.measureText(line + w).width > maxW && line) { out.push(line); line = w.replace(/^\s+/, ''); }
      else line += w;
      while (ctx.measureText(line).width > maxW) {        /* very long tokens (JSON rows): hard-wrap */
        var cut = Math.max(1, Math.floor(line.length * maxW / ctx.measureText(line).width) - 1);
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    });
    if (line) out.push(line);
    return out;
  }
  function render() {
    var H = 470, f = WM.fitCanvas(canvas, H), ctx = f.ctx, W = f.W;
    ctx.clearRect(0, 0, W, H);
    var small = W < 640, sc = steps[st.step], secs = ex.prompt.sections;
    var current = sc.kind === 'section' ? sc.i : secs.length;
    var enterQ = WM.clamp(st.t / sc.enter, 0, 1);
    /* ---- left: minimap ---- */
    var mmX = 14, mmY = 40, mmW = Math.round(W * (small ? 0.3 : 0.24)), mmH = H - 60;
    ctx.fillStyle = INK; ctx.font = 'bold 13px ' + SANS; ctx.textBaseline = 'alphabetic';
    ctx.fillText('The prompt, to scale', mmX, 24);
    ctx.fillStyle = '#fff'; WM.roundRect(ctx, mmX, mmY, mmW, mmH, 6); ctx.fill();
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1; WM.roundRect(ctx, mmX, mmY, mmW, mmH, 6); ctx.stroke();
    var rows = ex.prompt.minimap, rowH = Math.max(0.9, (mmH - 16) / rows.length), innerW = mmW - 16;
    var rowsOf = {}; rows.forEach(function (r, j) { (rowsOf[r[0]] = rowsOf[r[0]] || []).push(j); });
    var marker = null;
    rows.forEach(function (r, j) {
      var s = r[0], y = mmY + 8 + j * rowH, w = Math.max(2, innerW * Math.min(1, r[1] / 150));
      if (s > current) { ctx.fillStyle = '#f1f3f6'; ctx.fillRect(mmX + 8, y, w, Math.max(0.7, rowH - 0.4)); return; }
      var list = rowsOf[s], k = list.indexOf(j);
      if (s === current && k > enterQ * list.length) { ctx.fillStyle = '#f1f3f6'; ctx.fillRect(mmX + 8, y, w, Math.max(0.7, rowH - 0.4)); return; }
      ctx.globalAlpha = s === current || sc.kind === 'send' ? 1 : 0.45;
      ctx.fillStyle = ROLE[secs[s].role] || ROLE.rules;
      ctx.fillRect(mmX + 8, y, w, Math.max(0.7, rowH - 0.4));
      ctx.globalAlpha = 1;
      if (s === current) marker = marker || { y0: mmY + 8 + list[0] * rowH, y1: mmY + 8 + (list[list.length - 1] + 1) * rowH };
    });
    if (marker) {           /* bracket pointing from the minimap to the lens */
      ctx.strokeStyle = ROLE[secs[current].role]; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(mmX + mmW + 4, marker.y0); ctx.lineTo(mmX + mmW + 9, marker.y0); ctx.lineTo(mmX + mmW + 9, Math.max(marker.y1, marker.y0 + 4));
      ctx.lineTo(mmX + mmW + 4, Math.max(marker.y1, marker.y0 + 4)); ctx.stroke();
    }
    /* ---- right: lens ---- */
    var lx = mmX + mmW + 26, lw = W - lx - 14, ly = 40;
    if (sc.kind === 'section') {
      var s = secs[current], col = ROLE[s.role] || ROLE.rules;
      ctx.font = 'bold 15px ' + SANS;
      var chipW = ctx.measureText(s.label).width + 24;
      ctx.fillStyle = col; WM.roundRect(ctx, lx, ly - 22, chipW, 28, 14); ctx.fill();
      ctx.fillStyle = s.role === 'rules' || s.role === 'scene' ? INK : '#fff'; ctx.fillText(s.label, lx + 12, ly - 3);
      ctx.fillStyle = MUTED; ctx.font = (small ? 12 : 13) + 'px ' + SANS;
      ctx.fillText(s.meaning, lx + chipW + 10, ly - 3);
      var by = ly + 18, bh = H - by - 92;
      ctx.fillStyle = '#f6f8fa'; WM.roundRect(ctx, lx, by, lw, bh, 6); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; WM.roundRect(ctx, lx, by, lw, bh, 6); ctx.stroke();
      if (s.views) {
        var gap = 12, iw = (lw - 3 * gap) / 2, ih = Math.min(bh - 2 * gap, iw * 0.75);
        s.views.forEach(function (src, k) {
          var im = image(src), x = lx + gap + k * (iw + gap), y = by + (bh - ih) / 2;
          ctx.globalAlpha = WM.ease(enterQ);
          if (im.complete && im.naturalWidth) ctx.drawImage(im, x, y, iw, ih);
          ctx.globalAlpha = 1; ctx.strokeStyle = BORDER; ctx.strokeRect(x, y, iw, ih);
        });
      } else {
        var fs = small ? 10.5 : 12; ctx.font = fs + 'px ' + MONO; ctx.fillStyle = INK;
        var lines = [];
        (s.excerpt || []).forEach(function (l) { lines = lines.concat(wrapText(ctx, l, lw - 24)); });
        var maxLines = Math.floor((bh - 20) / (fs + 5)), shown = Math.ceil(WM.clamp(st.t / (sc.enter + 0.6), 0, 1) * Math.min(lines.length, maxLines));
        for (var k = 0; k < shown; k++) {
          var t = lines[k]; if (k === maxLines - 1 && lines.length > maxLines) t = '...';
          ctx.fillStyle = s.key === 'SCENE JSON' && /"label": "(orange book|red chair|red ball|gray barrier)"/.test(t) ? '#000' : '#333';
          ctx.fillText(t, lx + 12, by + 22 + k * (fs + 5));
        }
      }
    } else {
      /* final: the same prompt is sent to both models */
      ctx.fillStyle = INK; ctx.font = 'bold 16px ' + SANS;
      ctx.fillText('The same prompt goes to both models, word for word', lx, ly);
      [['gpt54', GPT], ['qwen30t', QWEN]].forEach(function (m, k) {
        var y = ly + 40 + k * 76, q = WM.ease(WM.clamp((st.t - 0.3 * k) / 0.8, 0, 1));
        ctx.globalAlpha = q;
        ctx.fillStyle = m[1]; WM.roundRect(ctx, lx, y, Math.min(320, lw * 0.55), 44, 22); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 15px ' + SANS; ctx.fillText(D.providers[m[0]], lx + 18, y + 28);
        ctx.fillStyle = INK; ctx.font = '13px ' + SANS;
        var mm = ex.models[m[0]];
        ctx.fillText('reads ' + (mm.input_tokens || 0).toLocaleString() + ' tokens', lx + Math.min(320, lw * 0.55) + 14, y + 20);
        ctx.fillStyle = MUTED; ctx.fillText('then thinks for ' + (mm.reasoning_tokens || 0).toLocaleString() + ' hidden tokens', lx + Math.min(320, lw * 0.55) + 14, y + 38);
        ctx.globalAlpha = 1;
      });
      ctx.fillStyle = MUTED; ctx.font = '12px ' + SANS;
      ctx.fillText('Token counts differ because the two models split text differently; the text is identical.', lx, ly + 210);
    }
    /* ---- composition bar ---- */
    var cy = H - 58, cw = lw, total = secs.reduce(function (a, s) { return a + s.chars; }, 0), x0 = lx;
    ctx.fillStyle = INK; ctx.font = 'bold 12px ' + SANS; ctx.fillText('What the prompt text is made of', lx, cy - 8);
    secs.forEach(function (s, i) {
      if (!s.chars) return;
      var w = cw * s.chars / total;
      ctx.fillStyle = i <= current ? (ROLE[s.role] || ROLE.rules) : '#eef1f4';
      if (i === current && sc.kind === 'section') { ctx.globalAlpha = 0.4 + 0.6 * enterQ; }
      ctx.fillRect(x0, cy, Math.max(1, w - 1), 18); ctx.globalAlpha = 1;
      x0 += w;
    });
    ctx.font = '12px ' + SANS; ctx.fillStyle = MUTED;
    if (sc.kind === 'section' && secs[current].chars) {
      var pc = Math.round(100 * secs[current].chars / total);
      ctx.fillText(secs[current].label + ': ' + (pc < 1 ? 'under 1' : pc) + '% of ' + ex.prompt.chars.toLocaleString() + ' characters', lx, cy + 36);
    } else if (sc.kind === 'section') {
      ctx.fillText('Images are attached separately; they are not part of the text.', lx, cy + 36);
    } else {
      ctx.fillText(ex.prompt.chars.toLocaleString() + ' characters in total; the scene data is about ' + Math.round(100 * secs.filter(function (s) { return s.key === 'SCENE JSON'; })[0].chars / total) + '% of it.', lx, cy + 36);
    }
    var text = sc.kind === 'section' ? 'Part ' + (current + 1) + ' of ' + secs.length + ': ' + secs[current].label.toLowerCase() + '. ' + secs[current].meaning
                                     : 'Room ' + ex.room + ': "' + ex.instruction + '"';
    if (text !== lastCap) { cap.textContent = text; lastCap = text; }
  }
  function representative() { st.step = ex.prompt.sections.map(function (s) { return s.key; }).indexOf('SCENE JSON'); st.t = 2.5; }
  Array.prototype.forEach.call(switches, function (b) {
    b.addEventListener('click', function () {
      key = b.getAttribute('data-example');
      Array.prototype.forEach.call(switches, function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      build(); st.step = 0; st.t = 0; lastCap = null; render();
    });
  });
  WM.runner({ root: root, button: btn, advance: advance, render: render, representative: representative });
})();
