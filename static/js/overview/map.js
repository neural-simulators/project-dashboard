/* Overview tab: the project map. The SVG in index.html (#ov-map) is complete without this script;
   the script walks through the links one at a time, lights the arrow, sends a pulse along it and
   writes one caption line. Uses WM.runner (play/pause, reduced motion, ?t= preroll). */
(function () {
  'use strict';
  var STEP = 3.4;   /* seconds per link */
  var STEPS = [
    { edges: ['d-w'], text: 'PhysX rollouts of simulated rooms are the training data of the world model.' },
    { edges: ['d-b'], text: 'The same rooms become benchmark tasks, each with an answer the simulator has verified.' },
    { edges: ['b-p'], text: 'The simulator’s verdicts on a model’s answers become the reward for post-training.' },
    { edges: ['p-e'], text: 'Language models propose actions for a task.' },
    { edges: ['w-e'], text: 'A learned simulator previews each action before anything is executed.' },
    { edges: ['w-p'], text: 'The aim: the world model as a fast judge during post-training, a network pass instead of a simulation.' },
    { edges: ['r-d'], text: 'Today a real scene must be rebuilt as a digital twin before PhysX can move anything.' },
    { edges: ['r-w', 'w-r'], text: 'The aim: a scene graph read from photographs goes straight into the world model, and the motion is watched in the real scene.' }
  ];

  WM.ready(function () {
    var root = document.getElementById('ov-map');
    if (!root) return;
    var svg = root.querySelector('svg'), button = root.querySelector('.wm-controls .button'), caption = root.querySelector('.wm-caption');
    if (!svg || !button || !caption) return;
    var NS = 'http://www.w3.org/2000/svg', edges = {}, groups = svg.querySelectorAll('[data-edge]');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i], dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '6'); dot.setAttribute('class', 'ov-pulse'); dot.style.opacity = 0;
      g.appendChild(dot);
      edges[g.getAttribute('data-edge')] = { g: g, path: g.querySelector('path'), dot: dot };
    }
    var t = 0, shown = -1;

    function render() {
      var k = Math.floor(t / STEP) % STEPS.length, f = (t % STEP) / STEP, step = STEPS[k];
      Object.keys(edges).forEach(function (id) {
        var e = edges[id], on = step.edges.indexOf(id) >= 0;
        e.g.classList.toggle('is-on', on);
        if (!on || !e.path) { e.dot.style.opacity = 0; return; }
        var q = WM.ease(Math.min(1, f * 1.5)), L = e.path.getTotalLength(), p = e.path.getPointAtLength(q * L);
        e.dot.setAttribute('cx', p.x.toFixed(1)); e.dot.setAttribute('cy', p.y.toFixed(1));
        e.dot.style.opacity = f < 0.8 ? 1 : Math.max(0, (1 - f) / 0.2);
      });
      svg.classList.add('is-walking');
      if (k !== shown) { caption.textContent = step.text; shown = k; }
    }

    WM.runner({
      root: root, button: button,
      advance: function (dt) { t += dt; },
      render: render,
      representative: function () { t = STEP * (STEPS.length - 1) + STEP * 0.55; }
    });
  });
})();
