(function () {
  'use strict';
  const D = window.DIGITAL_TWIN;
  const WM = window.WM;
  if (!D || !WM) throw new Error('Digital-twin assets are missing. Run tools/extract_digital_twin.py.');
  const blue = '#1f6feb', amber = '#bd7b15', muted = '#637080', red = '#d7263d';
  let selectedView = 2;

  function animate(id, period, draw, representative) {
    const root = document.getElementById(id);
    if (!root) return () => {};   // the page may leave a section out
    let time = 0, initialized = false;
    function render() {
      const box = root.getBoundingClientRect();
      if (!initialized || (box.bottom > 0 && box.top < window.innerHeight + 150)) draw(time);
      initialized = true;
    }
    WM.runner({root: root, button: root.querySelector('.wm-controls button'),
      advance: dt => { time = (time + dt) % period; }, render: render,
      representative: () => { time = representative || 0; }});
    return render;
  }

  function canvasFrame(canvas, height) {
    const frame = WM.fitCanvas(canvas, height);
    frame.ctx.clearRect(0, 0, frame.W, frame.H);
    return frame;
  }

  function text(ctx, value, x, y, size, color, align) {
    ctx.fillStyle = color || '#333';
    ctx.font = `${size || 13}px "Noto Sans", sans-serif`;
    ctx.textAlign = align || 'left';
    ctx.fillText(value, x, y);
  }

  function box(ctx, x, y, w, h, title, subtitle, active) {
    ctx.fillStyle = active ? '#eaf2ff' : '#fff';
    ctx.strokeStyle = active ? blue : '#d9dee5';
    ctx.lineWidth = active ? 2 : 1;
    WM.roundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();
    text(ctx, title, x + w / 2, y + h / 2 - (subtitle ? 3 : -4), 12, '#333', 'center');
    if (subtitle) text(ctx, subtitle, x + w / 2, y + h / 2 + 15, 10, muted, 'center');
  }

  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(parent, name, attrs, value) {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, val]) => node.setAttribute(key, val));
    if (value !== undefined) node.textContent = value;
    if (parent) parent.appendChild(node);   // a section left out of the page builds detached nodes
    return node;
  }

  const pipeline = document.querySelector('#dt-pipeline svg');
  const stages = [
    ['Photos', 'COLMAP', 'Calibrated photographs give the cameras and a 3D point cloud of the counter.'],
    ['Masks', 'SAM2', 'Each tin and the jar is outlined in the photographs.'],
    ['Shapes', 'SAM 3D Objects', 'One photo and its mask give a complete 3D mesh, hidden sides included (they are a guess).'],
    ['Placement', 'fit to the photos', 'Each mesh is scaled and placed so that it matches the point cloud and the outlines.'],
    ['Simulation', 'Isaac Sim + PhysX', 'Each object becomes a rigid body with a collision shape; PhysX computes the motion.']
  ];
  const stageBoxes = [];
  stages.forEach((stage, i) => {
    const x = 8 + i * 180;
    stageBoxes.push(svgEl(pipeline, 'rect', {x, y: 28, width: 164, height: 104, rx: 8, fill: '#fff', stroke: '#d9dee5'}));
    svgEl(pipeline, 'text', {x: x + 82, y: 54, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 600}, stage[0]);
    svgEl(pipeline, 'text', {x: x + 82, y: 122, 'text-anchor': 'middle', 'font-size': 14, fill: muted}, stage[1]);
    if (i < 4) svgEl(pipeline, 'path', {d: `M${x + 166},81 h12 m-4,-4 l4,4 -4,4`, fill: 'none', stroke: muted});
    if (i === 0) for (let j = 0; j < 3; j++) svgEl(pipeline, 'rect', {x: x + 51 + j * 12, y: 70 - j * 3, width: 42, height: 26, rx: 2, fill: '#e3ebf7', stroke: blue});
    if (i === 1) svgEl(pipeline, 'path', {d: `M${x + 68},69 h28 v28 h-28z`, fill: '#eef3fb', stroke: blue, 'stroke-width': 3, 'stroke-dasharray': '5 3'});
    if (i === 2) svgEl(pipeline, 'path', {d: `M${x + 67},70 l30,-5 5,27 -30,7z M${x + 67},70 l35,22 M${x + 97},65 l-25,34`, fill: '#dbe6f5', stroke: blue});
    if (i === 3) {
      svgEl(pipeline, 'ellipse', {cx: x + 82, cy: 84, rx: 25, ry: 15, fill: 'none', stroke: blue});
      for (let j = 0; j < 7; j++) svgEl(pipeline, 'circle', {cx: x + 60 + j * 7, cy: 76 + (j % 3) * 7, r: 2.5, fill: amber});
    }
    if (i === 4) {
      svgEl(pipeline, 'path', {d: `M${x + 42},98 h80 M${x + 70},69 h24 v26 h-24z`, fill: '#eaf2ff', stroke: blue});
      svgEl(pipeline, 'path', {d: `M${x + 111},63 v22 m-4,-4 l4,4 4,-4`, fill: 'none', stroke: amber, 'stroke-width': 2});
    }
  });
  const pulse = svgEl(pipeline, 'circle', {cy: 81, r: 4, fill: '#f5a623'});
  animate('dt-pipeline', 15, t => {
    const active = Math.floor(t / 3);
    stageBoxes.forEach((node, i) => {node.setAttribute('fill', i === active ? '#edf4ff' : '#fff'); node.setAttribute('stroke', i === active ? blue : '#d9dee5');});
    pulse.setAttribute('cx', 14 + t / 15 * 872);
    document.querySelector('#dt-pipeline .wm-caption').textContent = `${active + 1} / 5. ${stages[active][2]}`;
  }, 7);

  D.views.forEach((view, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'dt-view'; button.setAttribute('aria-pressed', String(i === selectedView));
    button.setAttribute('aria-label', `Highlight source camera ${view.id}`);
    const image = document.createElement('img'); image.src = view.image; image.alt = `Source photograph ${view.id}`; image.loading = 'lazy';
    const label = document.createElement('span'); label.textContent = view.id;
    button.append(image, label); document.getElementById('dt-view-strip').appendChild(button);
    button.addEventListener('click', () => {
      selectedView = i;
      document.querySelectorAll('.dt-view').forEach((node, j) => node.setAttribute('aria-pressed', String(j === i)));
      drawGeometry();
    });
  });

  function project(point, yaw, scale, cx, cy) {
    const x = point[0] * Math.cos(yaw) - point[1] * Math.sin(yaw);
    const y = point[0] * Math.sin(yaw) + point[1] * Math.cos(yaw);
    return [cx + x * scale, cy + (y * .42 - point[2] * .9) * scale, y * .9 + point[2] * .42];
  }

  function color(rgb) { return `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`; }
  const geometryCanvas = document.querySelector('#dt-geometry canvas');
  const drawGeometry = animate('dt-geometry', 30, t => {
    const {ctx, W, H} = canvasFrame(geometryCanvas, 330);
    const yaw = .25 + t / 30 * Math.PI * 2;
    const scale = W * .21;
    const p = xyz => project(xyz, yaw, scale, W / 2, H * .73);
    ctx.strokeStyle = '#e2e7ef'; ctx.lineWidth = 1;
    for (let v = -.9; v <= .9; v += .3) {
      let a = p([v, -.85, 0]), b = p([v, .85, 0]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      a = p([-.9, v, 0]); b = p([.9, v, 0]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    const dots = D.context.points.map((point, i) => ({p: p(point), c: D.context.colors[i]})).sort((a, b) => a.p[2] - b.p[2]);
    dots.forEach(dot => {ctx.fillStyle = color(dot.c); ctx.fillRect(dot.p[0], dot.p[1], 2, 2);});
    D.views.forEach((view, i) => {
      const a = p(view.position), target = p([0, 0, .12]);
      ctx.strokeStyle = i === selectedView ? blue : '#bac8da'; ctx.lineWidth = i === selectedView ? 2 : 1;
      ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(target[0], target[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = i === selectedView ? blue : '#8d9fb5'; ctx.fillRect(a[0] - 5, a[1] - 4, 10, 8);
      text(ctx, view.id, a[0], a[1] - 10, W < 500 ? 12 : 13, i === selectedView ? blue : muted, 'center');
    });
    text(ctx, 'The counter in 3D and the seven cameras used for the objects', 14, 22, 14, muted);
    text(ctx, 'up', W - 24, H - 38, 13, blue, 'center');
    WM.arrow(ctx, W - 24, H - 12, W - 24, H - 30, blue, 1.5);
  }, 4);

  const meshCanvases = [];
  D.objects.forEach(obj => {
    const card = document.createElement('article'); card.className = 'dt-mask-card';
    card.innerHTML = `<h3>${obj.label}</h3><p class="dt-small">from photograph ${obj.source_view}</p><div class="dt-mask-pair"><figure><img src="${obj.rgb}" alt="Actual RGB input crop for ${obj.label}" loading="lazy"><figcaption>photograph</figcaption></figure><figure><img src="${obj.mask}" alt="Actual binary SAM2 input mask for ${obj.label}" loading="lazy"><figcaption>outline (SAM2)</figcaption></figure></div><img class="dt-cutout" src="${obj.cutout}" alt="The masked source appearance of ${obj.label}" loading="lazy">`;
    document.getElementById('dt-mask-grid').appendChild(card);
    const meshCard = document.createElement('article'); meshCard.className = 'dt-mesh-card';
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 245; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Rotating reconstructed ${obj.label} mesh`);
    const title = document.createElement('h3'); title.textContent = obj.label;
    meshCard.append(canvas, title); document.getElementById('dt-mesh-grid').appendChild(meshCard);
    const min = [0, 1, 2].map(axis => Math.min(...obj.vertices.map(v => v[axis])));
    const max = [0, 1, 2].map(axis => Math.max(...obj.vertices.map(v => v[axis])));
    const center = min.map((v, axis) => (v + max[axis]) / 2);
    const faceColors = obj.triangles.map(face => color([0, 1, 2].map(c => face.reduce((sum, index) => sum + obj.colors[index][c], 0) / 3)));
    meshCanvases.push({obj, canvas, center, height: max[2] - min[2], faceColors});
  });
  const drawMeshes = animate('dt-meshes', 18, t => {
    meshCanvases.forEach(({obj, canvas, center, height, faceColors}) => {
      const {ctx, W} = canvasFrame(canvas, 245);
      const scale = 155 / height;
      const projection = vertices => vertices.map(v => project(v.map((x, i) => x - center[i]), t / 18 * Math.PI * 2 + .3, scale, W / 2, 125));
      const points = projection(obj.vertices);
      ctx.fillStyle = '#dde3eb'; ctx.beginPath(); ctx.ellipse(W / 2, 216, Math.min(72, W * .3), 10, 0, 0, Math.PI * 2); ctx.fill();
      const faces = obj.triangles.map((face, i) => ({face, i, depth: face.reduce((sum, id) => sum + points[id][2], 0)})).sort((a, b) => a.depth - b.depth);
      faces.forEach(({face, i}) => {
        ctx.fillStyle = faceColors[i]; ctx.beginPath(); face.forEach((index, j) => j ? ctx.lineTo(points[index][0], points[index][1]) : ctx.moveTo(points[index][0], points[index][1])); ctx.closePath(); ctx.fill();
      });
      if (document.getElementById('dt-show-colliders').checked) {
        const hull = projection(obj.collider.vertices);
        ctx.strokeStyle = '#c98b21'; ctx.globalAlpha = .75; ctx.lineWidth = .75;
        obj.collider.triangles.forEach(face => {ctx.beginPath(); face.forEach((index, j) => j ? ctx.lineTo(hull[index][0], hull[index][1]) : ctx.moveTo(hull[index][0], hull[index][1])); ctx.closePath(); ctx.stroke();});
        ctx.globalAlpha = 1;
      }
    });
  }, 3);
  document.getElementById('dt-show-colliders').addEventListener('change', drawMeshes);

  function tin(ctx, x, y, angle, fill, wire, dots) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    if (dots) {
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = i % 4 === 0 ? '#82a7d8' : fill;
        const px = Math.sin(i * 2.41) * 20, py = (i % 15) * 5 - 36;
        ctx.beginPath(); ctx.ellipse(px, py, 3.2, 2.3, i % 3, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.strokeStyle = wire ? amber : '#374151'; ctx.lineWidth = wire ? 2 : 1;
      ctx.fillStyle = fill; ctx.beginPath(); ctx.rect(-22, -40, 44, 80);
      if (!wire) ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -40, 22, 7, 0, 0, Math.PI * 2); if (!wire) ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  const physicsCanvas = document.querySelector('#dt-physics-animation canvas');
  animate('dt-physics-animation', 8, t => {
    const {ctx, W} = canvasFrame(physicsCanvas, 230);
    ctx.save(); ctx.scale(W / 900, 1);
    const angle = Math.sin(t / 8 * Math.PI * 2) * .23;
    text(ctx, 'Visual appearance', 140, 27, 13, '#333', 'center');
    text(ctx, 'Collision geometry', 445, 27, 13, '#333', 'center');
    text(ctx, 'Physical state', 745, 27, 13, '#333', 'center');
    tin(ctx, 140, 111, angle, '#3d4c63', false, false);
    tin(ctx, 445, 111, angle, '#fff', true, false);
    WM.arrow(ctx, 208, 110, 361, 110, blue, 1.8);
    text(ctx, 'same object ID', 282, 96, 11, blue, 'center');
    WM.arrow(ctx, 512, 110, 631, 110, blue, 1.8);
    text(ctx, 'one rigid pose', 571, 96, 11, blue, 'center');
    ['position + orientation', 'linear + angular velocity', 'mass + inertia', 'contact response'].forEach((value, i) => text(ctx, value, 745, 77 + i * 23, 11, muted, 'center'));
    ctx.strokeStyle = '#9aa6b7'; ctx.beginPath(); ctx.moveTo(375, 159); ctx.lineTo(515, 159); ctx.stroke();
    text(ctx, 'fixed tabletop', 445, 184, 11, muted, 'center');
    text(ctx, 'Shared body frame', 140, 184, 11, muted, 'center');
    ctx.restore();
  }, 2);

  const graph = document.querySelector('#dt-scene-graph svg');
  const nodes = [];
  D.objects.forEach((obj, i) => {
    const x = 78 + i * 300;
    svgEl(graph, 'path', {d: `M${x + 72},108 L450,160`, stroke: '#9badc4', 'stroke-width': 1.4, fill: 'none'});
    nodes.push(svgEl(graph, 'rect', {x, y: 20, width: 145, height: 88, rx: 8, fill: '#fff', stroke: blue}));
    svgEl(graph, 'text', {x: x + 72, y: 47, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600}, obj.label);
    svgEl(graph, 'text', {x: x + 72, y: 68, 'text-anchor': 'middle', 'font-size': 10, fill: muted}, obj.id);
    svgEl(graph, 'text', {x: x + 72, y: 89, 'text-anchor': 'middle', 'font-size': 10, fill: muted}, `mass ${obj.mass_kg} kg · pose · hull`);
  });
  svgEl(graph, 'rect', {x: 345, y: 160, width: 210, height: 55, rx: 7, fill: '#edf2f9', stroke: '#9badc4'});
  svgEl(graph, 'text', {x: 450, y: 183, 'text-anchor': 'middle', 'font-size': 12}, 'Fixed countertop support');
  svgEl(graph, 'text', {x: 450, y: 201, 'text-anchor': 'middle', 'font-size': 10, fill: muted}, 'geometry + confirmed support contacts');
  svgEl(graph, 'rect', {x: 665, y: 160, width: 170, height: 55, rx: 7, fill: '#f3f5f8', stroke: '#b1bdcb'});
  svgEl(graph, 'text', {x: 750, y: 190, 'text-anchor': 'middle', 'font-size': 12}, 'Fixed nearby clutter');
  const identityPulse = svgEl(graph, 'circle', {r: 5, fill: amber});
  animate('dt-scene-graph', 9, t => {
    const active = Math.floor(t / 3), q = (t % 3) / 3;
    nodes.forEach((node, i) => node.setAttribute('fill', i === active ? '#edf4ff' : '#fff'));
    identityPulse.setAttribute('cx', (150 + active * 300) * (1 - q) + 450 * q);
    identityPulse.setAttribute('cy', 108 * (1 - q) + 160 * q);
  }, 1);

  const worldCanvas = document.querySelector('#dt-world-animation canvas');
  const captions = [
    'Condition on the initial scene graph and a concrete action. Object identities remain stable across the trajectory.',
    'Training: mix a stored PhysX trajectory with noise and learn the direction back toward the trajectory.',
    'Prediction: refine a noisy future-state tensor, keeping the graph and action fixed.',
    'Rank the candidate action by the predicted outcome, then execute it in PhysX before rendering the verified motion.'
  ];
  animate('dt-world-animation', 16, t => {
    const {ctx, W} = canvasFrame(worldCanvas, 285);
    ctx.save(); ctx.scale(W / 900, 1);
    const stage = Math.floor(t / 4), tau = (t % 4) / 4;
    box(ctx, 10, 28, 180, 88, 'Initial scene graph', 'object state + geometry', stage === 0);
    for (let i = 0; i < 5; i++) {ctx.fillStyle = i < 3 ? blue : '#9faec1'; ctx.fillRect(32 + i * 28, 88, 15, 12);}
    box(ctx, 10, 132, 180, 58, 'Candidate action', 'release / throw / impulse', stage === 0);
    WM.arrow(ctx, 198, 110, 246, 110, blue, 1.8);
    box(ctx, 255, 45, 195, 132, 'Flow-matching model', 'joint future object states', stage === 1 || stage === 2);
    for (let i = 0; i < 3; i++) {ctx.strokeStyle = '#a6bfdf'; ctx.strokeRect(287, 76 + i * 21, 130, 12);}
    WM.arrow(ctx, 458, 110, 504, 110, blue, 1.8);
    box(ctx, 514, 28, 210, 162, 'Trajectory tensor', 'position / rotation / velocities', stage === 2);
    for (let row = 0; row < 3; row++) {
      ctx.beginPath(); ctx.strokeStyle = row === 0 ? red : blue; ctx.lineWidth = 1.8;
      for (let j = 0; j < 60; j++) {
        const clean = Math.sin(j / 60 * Math.PI) * (18 - row * 5);
        const noise = Math.sin(j * 2.16 + row) * 12 + Math.cos(j * .93 + row) * 7;
        const blend = stage === 0 ? 0 : stage === 3 ? 1 : tau;
        const x = 531 + j * 2.95, y = 89 + row * 27 - (blend * clean + (1 - blend) * noise);
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    WM.arrow(ctx, 733, 110, 776, 110, blue, 1.8);
    box(ctx, 784, 48, 106, 120, 'PhysX', 'execute action', stage === 3);
    box(ctx, 255, 220, 195, 44, 'Offline training targets', 'saved PhysX trajectories', stage === 1);
    WM.arrow(ctx, 352, 214, 352, 184, amber, 1.6);
    text(ctx, 'Training: simulator teaches dynamics', 12, 249, 10, muted);
    text(ctx, 'Test: reconstructed graph, same schema', 515, 249, 10, muted);
    ctx.restore();
    document.querySelector('#dt-world-animation .wm-caption').textContent = captions[stage];
  }, 9);

  const transferCanvas = document.querySelector('#dt-transfer-animation canvas');
  animate('dt-transfer-animation', 10, t => {
    const {ctx, W} = canvasFrame(transferCanvas, 260);
    ctx.save(); ctx.scale(W / 900, 1);
    const q = (1 - Math.cos(t / 10 * Math.PI * 2)) / 2;
    const angle = q * Math.PI / 2;
    text(ctx, 'Simulator rigid body', 170, 28, 13, '#333', 'center');
    text(ctx, 'Object-assigned captured appearance', 730, 28, 13, '#333', 'center');
    tin(ctx, 150 + q * 45, 124 + q * 15, -angle, '#3d4c63', false, false);
    tin(ctx, 710 + q * 45, 124 + q * 15, -angle, '#426da7', false, true);
    WM.arrow(ctx, 260, 119, 620, 119, blue, 1.8);
    text(ctx, 'coordinate transform + shared object pose', 440, 98, 11, blue, 'center');
    text(ctx, 'translation + rotation', 440, 142, 11, muted, 'center');
    text(ctx, 'same object-local reference', 440, 163, 11, muted, 'center');
    ctx.strokeStyle = '#c3ccd8'; ctx.beginPath(); ctx.moveTo(65, 190); ctx.lineTo(270, 190); ctx.moveTo(625, 190); ctx.lineTo(835, 190); ctx.stroke();
    text(ctx, 'Schematic only · Gaussian rendering bridge proposed', 450, 235, 11, amber, 'center');
    ctx.restore();
  }, 3);

  const gallery = document.getElementById('dt-video-gallery');
  const videoGrid = document.getElementById('dt-video-grid');
  const videos = [];
  const descriptions = {topple: 'A spin tips the black tin onto its side.', throw: 'The red tin, lifted beside the jar, is thrown at it, hits it and lands on the counter.', drop: 'The jar is lifted 12 cm and released.'};
  D.demos.forEach(demo => {
    const card = document.createElement('article'); card.className = 'dt-video-card';
    const video = document.createElement('video');
    video.src = demo.video; video.poster = demo.poster; video.preload = 'metadata'; video.muted = true; video.playsInline = true;
    video.tabIndex = 0; video.setAttribute('role', 'button'); video.setAttribute('aria-label', `${demo.label}. Hover to play all; click or press Enter to keep playing.`);
    const copy = document.createElement('div'); copy.className = 'dt-video-copy';
    const heading = document.createElement('h3'); heading.textContent = demo.label;
    const description = document.createElement('p'); description.textContent = descriptions[demo.id];
    copy.append(heading, description); card.append(video, copy); videoGrid.appendChild(card); videos.push(video);
    card.addEventListener('pointerenter', event => {if (event.pointerType !== 'touch' && !pinned) start(false);});
    card.addEventListener('pointerleave', () => {if (!pinned) stop(true);});
    video.addEventListener('click', toggle);
    video.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); toggle();}});
    video.addEventListener('error', () => {document.getElementById('dt-video-status').textContent = `Unable to load ${demo.label}.`;});
  });
  let playing = false, pinned = false, speed = 1, raf = 0, generation = 0;
  const toggleButton = document.getElementById('dt-video-toggle');
  const speedButton = document.getElementById('dt-video-speed');
  const clock = document.getElementById('dt-video-clock');
  const longest = Math.max(...D.demos.map(d => d.duration_s));
  const equalDuration = D.demos.every(d => Math.abs(d.duration_s - longest) < .04);
  document.getElementById('dt-video-note').textContent = equalDuration ?
    'The three clips start and loop together.' :
    'The clips start together; shorter ones hold their last frame until the loop restarts.';

  function updateControls() {
    toggleButton.textContent = !playing ? 'Play all' : pinned ? 'Pause all' : 'Keep playing';
    toggleButton.setAttribute('aria-pressed', String(playing));
    videos.forEach(v => v.setAttribute('aria-pressed', String(playing)));
  }

  function stop(reset) {
    generation++; playing = false; pinned = false;
    cancelAnimationFrame(raf);
    videos.forEach(video => {video.pause(); if (reset) video.currentTime = 0;});
    updateControls();
    if (reset) clock.textContent = 'Hover over a video, or click to keep playing.';
  }

  function playVideo(video) {
    return video.play().catch(error => {
      if (error.name === 'AbortError') return;
      stop(false);
      document.getElementById('dt-video-status').textContent = `Playback could not start: ${error.message}. Use Play all.`;
    });
  }

  function tick() {
    if (!playing) return;
    const time = videos[0].currentTime;
    clock.textContent = `t = ${time.toFixed(2)} s · ${speed === 1 ? 'normal speed' : 'quarter speed'}`;
    if (videos[0].ended || time >= longest - .012) {
      videos.forEach(video => {video.currentTime = 0; playVideo(video);});
    } else {
      videos.slice(1).forEach((video, i) => {
        if (time < D.demos[i + 1].duration_s - .06 && Math.abs(video.currentTime - time) > .14) video.currentTime = time;
      });
    }
    raf = requestAnimationFrame(tick);
  }

  function start(pin) {
    if (playing) {pinned = pin || pinned; updateControls(); return;}
    const current = ++generation;
    pinned = pin; playing = true;
    videos.forEach(video => {video.currentTime = 0; video.playbackRate = speed;});
    updateControls();
    Promise.all(videos.map(playVideo)).then(() => {if (playing && current === generation) raf = requestAnimationFrame(tick);});
  }

  function toggle() {if (playing && pinned) stop(true); else start(true);}
  toggleButton.addEventListener('click', toggle);
  speedButton.addEventListener('click', () => {
    speed = speed === 1 ? .25 : 1; videos.forEach(video => {video.playbackRate = speed;});
    speedButton.textContent = `Slow motion: ${speed === 1 ? 'off' : '0.25×'}`;
  });
  new IntersectionObserver(entries => {if (!entries[0].isIntersecting && playing) stop(false);}).observe(gallery);
  document.addEventListener('visibilitychange', () => {if (document.hidden) stop(false);});
  updateControls();
})();
