/* Shared code for the project page: tab switching, a play/pause animation
   runner that honours prefers-reduced-motion, canvas fitting, a seeded RNG and
   the side-view scene (x horizontal, z vertical) shared by two animations.
   Vanilla JS, no dependencies; works from file://. */
(function () {
  'use strict';

  var reducedMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* Debugging aid: ?t=<seconds> in the URL pre-rolls every animation by that
     many seconds and starts it paused, so screenshots of a phase are
     reproducible (python3 tools/check_page.py explains the checks). */
  var preroll = (function () {
    var m = /[?&]t=([0-9.]+)/.exec(window.location.search || '');
    var t = m ? parseFloat(m[1]) : 0;
    return isFinite(t) ? Math.min(600, Math.max(0, t)) : 0;
  })();

  var COLORS = {
    bg: '#fafbfc', text: '#333', border: '#d9dee5', muted: '#767676',
    red: '#d7263d', blue: '#1f6feb', amber: '#f5a623', slate: '#55606e',
    ballBlue: '#4a6fa5', barrier: '#9aa3ad', faintRed: '#f3c1c8',
    faintGray: '#c5ccd6', dotGray: '#8a94a3', band: '#eef1f4'
  };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ---------- tabs: #overview (default, the first panel), #design (the world model), #post-training and #results ---------- */
  var TAB_NAMES = ['overview', 'design', 'post-training', 'results'];   /* fallback; the panels on the page decide */

  function tabNames() {
    var panels = document.querySelectorAll('[data-tab-panel]'), names = [];
    for (var i = 0; i < panels.length; i++) names.push(panels[i].getAttribute('data-tab-panel'));
    return names.length ? names : TAB_NAMES;
  }

  function tabFromHash() {
    var h = (window.location.hash || '').replace(/^#/, '');
    var names = tabNames();
    return names.indexOf(h) >= 0 ? h : names[0];
  }

  function showTab(name) {
    var panels = document.querySelectorAll('[data-tab-panel]');
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-tab-panel') !== name;
    }
    var items = document.querySelectorAll('[data-tab]');
    for (var j = 0; j < items.length; j++) {
      var on = items[j].getAttribute('data-tab') === name;
      items[j].classList.toggle('is-active', on);
      var link = items[j].querySelector('a');
      if (link) link.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    document.dispatchEvent(new CustomEvent('wm:tab', { detail: { tab: name } }));
  }

  function initTabs() {
    showTab(tabFromHash());
    window.addEventListener('hashchange', function () {
      showTab(tabFromHash());
      var nav = document.getElementById('wm-tabs');
      if (nav && nav.scrollIntoView) {
        nav.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    });
  }

  /* ---------- animation runner ----------
     cfg = { root, button, advance(dtSeconds), render(), representative() }.
     With prefers-reduced-motion the animation starts paused on the
     representative frame; otherwise it plays and loops. Hidden animations
     (the other tab) do not advance. */
  function runner(cfg) {
    var btn = cfg.button, root = cfg.root;
    var playing = false, last = null, raf = 0;

    function visible() { return !root || root.offsetParent !== null; }
    function label() {
      btn.textContent = playing ? 'Pause' : 'Play';
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }
    function frame(ts) {
      if (!playing) return;
      var dt = last === null ? 0 : (ts - last) / 1000;
      last = ts;
      if (dt > 0.1) dt = 0.1;
      if (visible()) { cfg.advance(dt); cfg.render(); }
      raf = window.requestAnimationFrame(frame);
    }
    function play() {
      if (playing) return;
      playing = true; last = null; label();
      raf = window.requestAnimationFrame(frame);
    }
    function pause() {
      playing = false; label();
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    }
    function redraw() { if (visible()) cfg.render(); }

    btn.addEventListener('click', function () { if (playing) pause(); else play(); });
    window.addEventListener('resize', redraw);
    document.addEventListener('wm:tab', redraw);
    if (reducedMotion) { cfg.representative(); cfg.render(); pause(); }
    else if (preroll > 0) {
      for (var k = 0; k < Math.round(preroll * 60); k++) cfg.advance(1 / 60);
      cfg.render(); pause();
    }
    else { cfg.render(); play(); }
    return { play: play, pause: pause };
  }

  /* ---------- canvas helpers ---------- */
  function fitCanvas(canvas, cssH) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || parseInt(canvas.getAttribute('width'), 10) || 900;
    var bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    if (canvas.style.height !== cssH + 'px') canvas.style.height = cssH + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: cssW, H: cssH };
  }

  function rng(seed) {   /* mulberry32: small, deterministic, good enough for dots */
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    var u = 1 - r(), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function ease(q) { q = clamp(q, 0, 1); return q * q * (3 - 2 * q); }
  function lerp(a, b, q) { return a + (b - a) * q; }

  function arrow(ctx, x0, y0, x1, y1, color, width, head) {
    head = head || 7;
    var dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy);
    if (L < 0.5) return;
    var ux = dx / L, uy = dy / L;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * head * 0.6, y1 - uy * head * 0.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
    ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ---------- side view of the sample scene ----------
     World window x in [-1.05, 1.95] m, z from the floor band up to 1.0 m.
     Returns mapping functions and a drawScene(ctx, sample, opts) painter. */
  function sideView(W, top, padL, padR) {
    var X0 = -1.05, X1 = 1.95, Z1 = 1.0;
    var s = (W - padL - padR) / (X1 - X0);
    var Z0 = -(22 / s);                       /* a 22 px band below the floor */
    var v = {
      X0: X0, X1: X1, Z0: Z0, Z1: Z1, s: s, top: top,
      bottom: top + s * (Z1 - Z0), left: padL, right: W - padR, W: W,
      small: W < 600
    };
    v.x = function (x) { return padL + (x - X0) * s; };
    v.z = function (z) { return top + (Z1 - z) * s; };
    v.font = function (px, bold) { return (bold ? 'bold ' : '') + px + 'px "Noto Sans", sans-serif'; };
    v.fs = v.small ? 10 : 12;
    v.clip = function (ctx) {                 /* call between ctx.save() and ctx.restore() */
      ctx.beginPath(); ctx.rect(v.left, v.top, v.right - v.left, v.bottom - v.top); ctx.clip();
    };

    v.drawScene = function (ctx, S, opts) {
      opts = opts || {};
      var red = S.objects.o024, blue = S.objects.o025, b = S.barrier;
      var bluePos = opts.bluePos || [blue.start_position[0], blue.start_position[2]];
      var fs = v.fs;
      ctx.save();
      /* plot frame */
      ctx.fillStyle = '#fff';
      ctx.fillRect(v.left, v.top, v.right - v.left, v.bottom - v.top);
      ctx.fillStyle = COLORS.band;
      ctx.fillRect(v.left, v.z(0), v.right - v.left, v.bottom - v.z(0));
      ctx.strokeStyle = COLORS.border; ctx.lineWidth = 1;
      ctx.strokeRect(v.left + 0.5, v.top + 0.5, v.right - v.left - 1, v.bottom - v.top - 1);
      /* floor */
      ctx.strokeStyle = COLORS.muted; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(v.left, v.z(0)); ctx.lineTo(v.right, v.z(0)); ctx.stroke();
      /* axis labels */
      ctx.fillStyle = COLORS.muted; ctx.font = v.font(fs);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (var xt = -1; xt <= 1.5; xt += 0.5) {
        ctx.fillText(xt.toFixed(1), v.x(xt), v.z(0) + 4);
        ctx.beginPath(); ctx.moveTo(v.x(xt), v.z(0)); ctx.lineTo(v.x(xt), v.z(0) + 3); ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.fillText('x (m)', v.right - 4, v.z(0) + 4);
      ctx.textBaseline = 'middle';
      for (var zt = 0.5; zt <= 1.0; zt += 0.5) {          /* z labels sit outside the frame, left */
        ctx.fillText(zt.toFixed(1), v.left - 5, v.z(zt));
        ctx.beginPath(); ctx.moveTo(v.left - 3, v.z(zt)); ctx.lineTo(v.left, v.z(zt)); ctx.stroke();
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('z (m)', v.left + 4, v.top + 4);
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('floor', v.left + 4, v.z(0) - 4);
      if (!opts.minimal) {                       /* minimal: floor and axes only (the flow animation shows one object) */
        /* barrier */
        var bx0 = v.x(b.position[0] - b.size[0] / 2), bx1 = v.x(b.position[0] + b.size[0] / 2);
        var bz0 = v.z(b.position[2] - b.size[2] / 2), bz1 = v.z(b.position[2] + b.size[2] / 2);
        ctx.fillStyle = COLORS.barrier;
        ctx.fillRect(bx0, bz1, Math.max(2, bx1 - bx0), bz0 - bz1);
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(b.label, (bx0 + bx1) / 2, bz1 - 5);
        /* blue ball */
        ctx.fillStyle = COLORS.ballBlue;
        ctx.beginPath(); ctx.arc(v.x(bluePos[0]), v.z(bluePos[1]), blue.radius_m * s, 0, 2 * Math.PI); ctx.fill();
        if (!opts.noBlueLabel) {
          ctx.fillStyle = COLORS.muted;
          ctx.fillText(blue.label, v.x(bluePos[0]), v.z(bluePos[1] + blue.radius_m) - 5);
        }
      }
      ctx.textAlign = 'center';
      /* red ball start, dashed outline */
      if (opts.redStart) {
        ctx.strokeStyle = COLORS.red; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(v.x(red.start_position[0]), v.z(red.start_position[2]), red.radius_m * s, 0, 2 * Math.PI);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COLORS.red;
        ctx.fillText(red.label + ' (t = 0)', v.x(red.start_position[0]), v.z(red.start_position[2] + red.radius_m) - 5);
      }
      ctx.restore();
    };
    return v;
  }

  window.WM = {
    reducedMotion: reducedMotion, colors: COLORS, ready: ready, showTab: showTab,
    runner: runner, fitCanvas: fitCanvas, rng: rng, gauss: gauss, clamp: clamp,
    ease: ease, lerp: lerp, arrow: arrow, roundRect: roundRect, sideView: sideView
  };

  ready(initTabs);
})();
